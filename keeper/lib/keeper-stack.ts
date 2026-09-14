import * as cdk from 'aws-cdk-lib/core';
import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

/**
 * MoveX Equities Keeper
 * ---------------------------------------------------------------------------
 * Four cron jobs, not a service. Each one has a single responsibility and its
 * own cadence, so a failure in one does not take the others down with it.
 *
 *   Publisher      every minute      writes each ticker's PriceFeed
 *   HourlyMarkets  09:00 ET          creates the session's intraday markets
 *   DailyMarkets   15:55 ET          creates tomorrow's close-to-close markets
 *   Crank          every minute      locks and settles whatever is due
 *
 * Every schedule declares `America/New_York` rather than a UTC hour. US
 * market close is 16:00 ET, which is 20:00 UTC in summer and 21:00 in winter:
 * a UTC cron drifts an hour on the first Sunday of November and every
 * settlement after that reads the wrong price.
 *
 * All four are idempotent. They ask the chain what is missing rather than
 * remembering what they did, so a missed invocation is repaired by the next.
 */
export class KeeperStack extends cdk.Stack {
  // -- Resources -------------------------------------------------------------
  private lambdas: { [key: string]: lambda.NodejsFunction } = {};
  private schedules: { [key: string]: Schedule } = {};

  /** SSM parameter holding the publisher's secret key. */
  private readonly keypairParameter = '/movex_equities/main_keypair';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.createKeeperLambdas();
    this.grantParameterAccess();
    this.createSchedules();
    this.createOutputs();
  }

  // =========================================================================
  // Lambdas
  // =========================================================================

  private lambdaEnv(): Record<string, string> {
    return {
      // Public devnet dropped blockhashes mid-run during setup, and a keeper
      // that silently misses its minute is worse than one that costs a little.
      RPC_URL: process.env.RPC_URL ?? 'https://api.devnet.solana.com',
      KEYPAIR_PARAMETER: this.keypairParameter,
      // Not derivable: the USDX mint is a generated keypair, so unlike every
      // other address the lambdas use it cannot be computed from a seed.
      QUOTE_MINT: process.env.QUOTE_MINT ?? '',
      TREASURY: process.env.TREASURY ?? '',
      POWERTOOLS_SERVICE_NAME: 'movex-equities-keeper',
    };
  }

  private makeLambda(
    id: string,
    entry: string,
    handler: string,
    timeout: Duration,
  ): lambda.NodejsFunction {
    return new lambda.NodejsFunction(this, id, {
      runtime: Runtime.NODEJS_20_X,
      entry,
      handler,
      memorySize: 512,
      timeout,
      environment: this.lambdaEnv(),
      bundling: {
        // The Anchor IDL is imported as JSON and has to travel with the
        // bundle, since fetching it from chain would read a copy that
        // `solana program deploy` does not update.
        loader: { '.json': 'json' },
      },
      logGroup: new logs.LogGroup(this, `${id}LogGroup`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
  }

  private createKeeperLambdas(): void {
    // Three quote fetches plus up to three transactions.
    this.lambdas['publisher'] = this.makeLambda(
      'PublisherLambda',
      'lib/lambdas/keeper/publisher.ts',
      'handler',
      Duration.seconds(60),
    );

    // Six market creations, each its own transaction.
    this.lambdas['hourlyMarkets'] = this.makeLambda(
      'HourlyMarketsLambda',
      'lib/lambdas/keeper/create-markets.ts',
      'hourlyHandler',
      Duration.minutes(3),
    );

    // Five markets across three tickers, each needing a calibrated ladder.
    this.lambdas['dailyMarkets'] = this.makeLambda(
      'DailyMarketsLambda',
      'lib/lambdas/keeper/create-markets.ts',
      'dailyHandler',
      Duration.minutes(3),
    );

    this.lambdas['crank'] = this.makeLambda(
      'CrankLambda',
      'lib/lambdas/keeper/crank.ts',
      'handler',
      Duration.minutes(2),
    );

    // The strike calibration report from Phase 0, kept as an on-demand tool
    // rather than a schedule: the market lambdas compute their own ladders.
    this.lambdas['computeStrikes'] = this.makeLambda(
      'ComputeStrikesLambda',
      'lib/lambdas/strikes/handler.ts',
      'handler',
      Duration.seconds(60),
    );
  }

  // =========================================================================
  // Permissions
  // =========================================================================

  /**
   * Read access to the one parameter holding the signing key, and nothing
   * else. Scoped to the exact ARN rather than a prefix, so a future parameter
   * under the same path is not readable by accident.
   */
  private grantParameterAccess(): void {
    const parameterArn = cdk.Arn.format(
      {
        service: 'ssm',
        resource: 'parameter',
        // Arn.format does not want the leading slash the parameter name has.
        resourceName: this.keypairParameter.replace(/^\//, ''),
      },
      this,
    );

    const policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [parameterArn],
    });

    // Stored as a String, not a SecureString, so no kms:Decrypt is needed.
    // If it is ever converted, this policy needs a matching kms:Decrypt on
    // the alias/aws/ssm key or every lambda starts failing at cold start.
    for (const key of ['publisher', 'hourlyMarkets', 'dailyMarkets', 'crank']) {
      this.lambdas[key].addToRolePolicy(policy);
    }
  }

  // =========================================================================
  // Schedules
  // =========================================================================

  private schedule(
    id: string,
    lambdaKey: string,
    expression: ScheduleExpression,
    description: string,
  ): void {
    this.schedules[lambdaKey] = new Schedule(this, id, {
      description,
      schedule: expression,
      target: new LambdaInvoke(this.lambdas[lambdaKey], {
        // The default is 185 attempts. For a job that runs again in sixty
        // seconds that means hammering a third-party quote endpoint all
        // evening over a tick nobody wants any more.
        retryAttempts: 2,
        maxEventAge: Duration.minutes(2),
      }),
    });
  }

  private createSchedules(): void {
    const ny = TimeZone.AMERICA_NEW_YORK;

    // Every minute. The handler decides whether the session is open, because
    // cron cannot express market holidays and half days.
    this.schedule(
      'PublisherSchedule',
      'publisher',
      ScheduleExpression.cron({ minute: '*', weekDay: 'MON-FRI', timeZone: ny }),
      'Publish equity prices into their PriceFeed accounts',
    );

    this.schedule(
      'CrankSchedule',
      'crank',
      ScheduleExpression.cron({ minute: '*', weekDay: 'MON-FRI', timeZone: ny }),
      'Lock and settle markets whose moment has arrived',
    );

    // An hour before the first lock at 10:00, so the shortest deposit window
    // of the day is still a full hour.
    this.schedule(
      'HourlyMarketsSchedule',
      'hourlyMarkets',
      ScheduleExpression.cron({ minute: '0', hour: '9', weekDay: 'MON-FRI', timeZone: ny }),
      "Create the session's intraday markets",
    );

    // Five minutes before the close, so the markets that lock at it exist
    // before the crank looks for them.
    this.schedule(
      'DailyMarketsSchedule',
      'dailyMarkets',
      ScheduleExpression.cron({ minute: '55', hour: '15', weekDay: 'MON-FRI', timeZone: ny }),
      'Create the close-to-close markets that lock at today\'s close',
    );
  }

  // =========================================================================
  // Outputs
  // =========================================================================

  private createOutputs(): void {
    for (const [key, fn] of Object.entries(this.lambdas)) {
      new cdk.CfnOutput(this, `${key}FunctionName`, {
        value: fn.functionName,
        description: `Invoke manually to run ${key} on demand`,
      });
    }

    new cdk.CfnOutput(this, 'KeypairParameter', {
      value: this.keypairParameter,
      description: 'SSM parameter the lambdas read their signing key from',
    });
  }
}
