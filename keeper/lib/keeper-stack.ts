import * as cdk from 'aws-cdk-lib/core';
import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

/**
 * MoveX Equities Keeper
 * ---------------------------------------------------------------------------
 * Five cron jobs, not a service. Each one has a single responsibility and its
 * own cadence, so a failure in one does not take the others down with it.
 *
 *   Publisher      every minute      writes each ticker's PriceFeed
 *   HourlyMarkets  15:55 ET          creates the NEXT session's intraday
 *                  09:00 ET          markets, with a morning backstop
 *   DailyMarkets   15:55 ET          creates the next close-to-close markets
 *   Crank          every minute      locks and settles whatever is due
 *   Seeder         every 10 min      funds both sides, claims winnings (devnet)
 *
 * Every schedule declares `America/New_York` rather than a UTC hour. US
 * market close is 16:00 ET, which is 20:00 UTC in summer and 21:00 in winter:
 * a UTC cron drifts an hour on the first Sunday of November and every
 * settlement after that reads the wrong price.
 *
 * All five are idempotent. They ask the chain what is missing rather than
 * remembering what they did, so a missed invocation is repaired by the next.
 */
export class KeeperStack extends cdk.Stack {
  // -- Resources -------------------------------------------------------------
  private lambdas: { [key: string]: lambda.NodejsFunction } = {};
  private schedules: { [key: string]: Schedule } = {};

  /** SSM parameter holding the publisher's secret key. Read at runtime. */
  private readonly keypairParameter = '/movex_equities/main_keypair';

  /**
   * The USDX mint markets are quoted in.
   *
   * Hardcoded because it is the one address in the system that cannot be
   * derived: it came from a generated keypair rather than a seed. It is also
   * public information, so there is nothing to protect by hiding it.
   */
  private readonly quoteMint = 'FBnaipfxQK8M3ZMMM3bwnzgbgKDLPGJ2rJdUANHocBve';

  /**
   * SSM parameter holding the RPC endpoint, read at synth rather than
   * runtime.
   *
   * Not hardcoded, unlike the mint, because the Helius URL carries an API key
   * and this repository is public. CDK emits a `{{resolve:ssm:...}}` dynamic
   * reference, so the value appears neither in the repo nor in the
   * synthesised template: CloudFormation substitutes it at deploy time.
   *
   * Create it once with:
   *   aws ssm put-parameter --name /movex_equities/rpc_url --type String \
   *     --value "https://devnet.helius-rpc.com/?api-key=..."
   */
  private readonly rpcUrlParameter = '/movex_equities/rpc_url';

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

  /**
   * Everything the lambdas need, resolved from the stack rather than from
   * the shell. Nothing has to be exported before `cdk deploy`.
   */
  private lambdaEnv(): Record<string, string> {
    return {
      // Resolved by CloudFormation at deploy time from SSM, so the API key
      // it contains never lands in the repo or the template.
      RPC_URL: ssm.StringParameter.valueForStringParameter(this, this.rpcUrlParameter),
      KEYPAIR_PARAMETER: this.keypairParameter,
      QUOTE_MINT: this.quoteMint,
      // Empty means "the signing authority", which is what the handlers
      // fall back to. A separate treasury is a mainnet concern.
      TREASURY: '',
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

    // Devnet only. Funds both sides of every open market from three derived
    // wallets and claims their winnings, so markets resolve instead of voiding
    // and the whole lifecycle runs against the chain daily.
    this.lambdas["seeder"] = this.makeLambda(
      "SeederLambda",
      "lib/lambdas/keeper/seeder.ts",
      "handler",
      Duration.minutes(5),
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
    for (const key of ['publisher', 'hourlyMarkets', 'dailyMarkets', 'crank', 'seeder']) {
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
    /** Payload the handler reads, for a lambda driven by more than one cron. */
    input?: ScheduleTargetInput,
  ): void {
    // Keyed by schedule id rather than lambda, because one lambda can answer
    // to two crons with different payloads.
    this.schedules[id] = new Schedule(this, id, {
      description,
      schedule: expression,
      target: new LambdaInvoke(this.lambdas[lambdaKey], {
        // The default is 185 attempts. For a job that runs again in sixty
        // seconds that means hammering a third-party quote endpoint all
        // evening over a tick nobody wants any more.
        retryAttempts: 2,
        maxEventAge: Duration.minutes(2),
        input,
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

    // Alongside the daily ladder, for the next session rather than this one.
    // The first hour of tomorrow locks at 10:00, so creating it now gives it
    // an overnight deposit window instead of sixty minutes.
    this.schedule(
      'HourlyMarketsSchedule',
      'hourlyMarkets',
      ScheduleExpression.cron({ minute: '55', hour: '15', weekDay: 'MON-FRI', timeZone: ny }),
      "Create the next session's intraday markets",
      ScheduleTargetInput.fromObject({ session: 'next' }),
    );

    // A backstop an hour before the first lock. When the evening run did its
    // job this finds every market already there and creates nothing; when it
    // did not, the day still gets its markets with a shorter window.
    this.schedule(
      'HourlyBackstopSchedule',
      'hourlyMarkets',
      ScheduleExpression.cron({ minute: '0', hour: '9', weekDay: 'MON-FRI', timeZone: ny }),
      "Backstop: create today's intraday markets if the evening run did not",
      ScheduleTargetInput.fromObject({ session: 'today' }),
    );

    // Five minutes before the close, so the markets that lock at it exist
    // before the crank looks for them.
    this.schedule(
      'DailyMarketsSchedule',
      'dailyMarkets',
      ScheduleExpression.cron({ minute: '55', hour: '15', weekDay: 'MON-FRI', timeZone: ny }),
      'Create the close-to-close markets that lock at today\'s close',
    );

    // Every ten minutes through the session. Markets appear at 15:55 for the
    // next session; the next tick funds them, and later ticks are no-ops for
    // any market the wallets already hold positions in.
    this.schedule(
      'SeederSchedule',
      'seeder',
      ScheduleExpression.cron({ minute: '*/10', hour: '9-16', weekDay: 'MON-FRI', timeZone: ny }),
      'Fund both sides of open markets and claim seed-wallet winnings',
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
