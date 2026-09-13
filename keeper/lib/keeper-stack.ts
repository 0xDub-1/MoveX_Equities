import * as cdk from 'aws-cdk-lib/core';
import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Schedule, ScheduleExpression } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

/**
 * MoveX Equities Keeper
 * ---------------------------------------------------------------------------
 * The keeper is a cron job, not a service. Its whole daily workload is a
 * handful of seconds of work, so it runs on Lambda behind EventBridge
 * Scheduler rather than on an instance billed for 43,200 idle minutes to buy
 * it. Both sit inside the permanent free tier at this volume.
 *
 *   - `ComputeStrikesLambda`   — calibrates the strike ladder for each
 *                                 ticker from the trailing 20 completed
 *                                 sessions.
 *   - `ComputeStrikesSchedule` — fires it at 15:55 ET on weekdays, five
 *                                 minutes before the close.
 *
 * Stack shape mirrors `MoveX_AWS`: resources live on private fields so the
 * `createXxx` methods can wire them together without juggling locals.
 *
 * Phase 3 adds a second lambda to crank `lock` and `settle` against the
 * Solana program at the close. It is deliberately absent until the program
 * exists, because a scheduled stub that logs "not implemented" every
 * weekday is noise pretending to be progress.
 */
export class KeeperStack extends cdk.Stack {
  // -- Resources -------------------------------------------------------------
  private lambdas: { [key: string]: lambda.NodejsFunction } = {};
  private schedules: { [key: string]: Schedule } = {};

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.createKeeperLambdas();
    this.createSchedules();
    this.createOutputs();
  }

  // =========================================================================
  // Lambdas
  // =========================================================================

  /**
   * NodejsFunction handles esbuild packing with the default settings, same
   * as the referral stack: we ship TypeScript, esbuild bundles and
   * transpiles on `cdk synth`.
   */
  private createKeeperLambdas(): void {
    this.lambdas['computeStrikes'] = new lambda.NodejsFunction(this, 'ComputeStrikesLambda', {
      runtime: Runtime.NODEJS_20_X,
      entry: 'lib/lambdas/strikes/handler.ts',
      handler: 'handler',
      memorySize: 256,
      // Three sequential provider requests, each capped at 10s internally.
      // 60s leaves room for a slow response without the invocation being
      // killed mid-calibration.
      timeout: Duration.seconds(60),
      logGroup: new logs.LogGroup(this, 'ComputeStrikesLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
  }

  // =========================================================================
  // Schedules
  // =========================================================================

  /**
   * Declaring the timezone is not a nicety. US market close is 16:00 ET,
   * which is 20:00 UTC in summer and 21:00 UTC in winter. A UTC cron
   * silently drifts an hour on the first Sunday of November, and every
   * settlement after that reads the wrong price. Naming the timezone makes
   * AWS absorb the change.
   *
   * Cron cannot express market holidays. The lambda does not need to check:
   * on a holiday the provider simply returns no new session, the trailing
   * window is unchanged, and the recomputed ladder is identical. That
   * becomes load-bearing in Phase 3, when this also opens markets, and the
   * holiday check moves into the handler.
   */
  private createSchedules(): void {
    this.schedules['computeStrikes'] = new Schedule(this, 'ComputeStrikesSchedule', {
      description: 'Calibrate MoveX Equities strike ladders shortly before the US close',
      schedule: ScheduleExpression.cron({
        minute: '55',
        hour: '15',
        weekDay: 'MON-FRI',
        timeZone: TimeZone.AMERICA_NEW_YORK,
      }),
      target: new LambdaInvoke(this.lambdas['computeStrikes'], {
        // The default is 185 attempts, which for a job that runs again
        // tomorrow means hammering a third-party endpoint all evening over
        // a run we no longer want. Three tries, then give up and alarm.
        retryAttempts: 3,
        maxEventAge: Duration.minutes(5),
      }),
    });
  }

  // =========================================================================
  // Outputs
  // =========================================================================

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ComputeStrikesFunctionName', {
      value: this.lambdas['computeStrikes'].functionName,
      description: 'Invoke manually to calibrate strikes on demand',
    });

    new cdk.CfnOutput(this, 'ComputeStrikesFunctionArn', {
      value: this.lambdas['computeStrikes'].functionArn,
      description: 'ARN of the strike calibration lambda',
    });

    new cdk.CfnOutput(this, 'ComputeStrikesScheduleName', {
      value: this.schedules['computeStrikes'].scheduleName,
      description: 'EventBridge schedule firing at 15:55 America/New_York, MON-FRI',
    });
  }
}
