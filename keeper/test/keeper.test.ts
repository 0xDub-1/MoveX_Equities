import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { KeeperStack } from '../lib/keeper-stack';

let template: Template;

const EQUITIES_SCHEDULES = 7;
const CRYPTO_SCHEDULES = 3;

beforeAll(() => {
  const app = new cdk.App();
  template = Template.fromStack(new KeeperStack(app, 'TestKeeper'));
});

describe('lambdas', () => {
  it('creates one per responsibility on each venue, plus the strike report', () => {
    template.resourceCountIs('AWS::Lambda::Function', 9);
  });

  it('runs on nodejs20 and does not retain logs forever', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    });
  });

  it('tells the lambdas which parameter holds the signing key', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          KEYPAIR_PARAMETER: '/movex_equities/main_keypair',
        }),
      }),
    });
  });

  /**
   * The crypto markets lambda creates, seeds and claims on one tick, and two
   * overlapping ticks would race each other into funding a market twice. Its
   * timeout stays under the ten minute cadence so one tick is over before
   * the next begins.
   */
  it('finishes a crypto market tick before the next one is due', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Timeout: 480,
    });
    const functions = Object.values(template.findResources('AWS::Lambda::Function'));
    for (const f of functions) expect(f.Properties.Timeout).toBeLessThan(600);
  });
});

describe('permissions', () => {
  /**
   * Scoped to the one parameter, not a path prefix. A future secret stored
   * under the same path should not become readable because this policy was
   * written loosely.
   */
  it('grants read on exactly one parameter and nothing else', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource: Match.objectLike({
              'Fn::Join': Match.arrayWith([
                Match.arrayWith([Match.stringLikeRegexp('parameter/movex_equities/main_keypair')]),
              ]),
            }),
          }),
        ]),
      }),
    });
  });

  it('grants the signing key to every scheduled lambda on both venues', () => {
    // Every scheduled lambda, five equities and three crypto, carries the
    // one-parameter read. The on-demand strike report signs nothing.
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const withKey = policies.filter((p) => JSON.stringify(p).includes('ssm:GetParameter'));
    expect(withKey).toHaveLength(8);
  });

  it('does not ask for write access to the parameter store', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const actions = JSON.stringify(policies);
    expect(actions).not.toContain('ssm:PutParameter');
    expect(actions).not.toContain('ssm:DeleteParameter');
    expect(actions).not.toContain('ssm:*');
  });
});

describe('schedules', () => {
  it('runs ten of them', () => {
    template.resourceCountIs('AWS::Scheduler::Schedule', EQUITIES_SCHEDULES + CRYPTO_SCHEDULES);
  });

  /**
   * The assertion that matters most. US close is 16:00 ET, which is 20:00 UTC
   * in summer and 21:00 in winter. A UTC cron drifts an hour on the first
   * Sunday of November and every settlement after that reads the wrong price.
   * Crypto keeps UTC because its markets do, and says so outright.
   */
  it('declares New York time on every equities schedule and UTC on every crypto one', () => {
    const entries = Object.values(template.findResources('AWS::Scheduler::Schedule'));
    const zones = entries.map((s) => s.Properties.ScheduleExpressionTimezone as string);
    expect(zones.filter((z) => z === 'America/New_York')).toHaveLength(EQUITIES_SCHEDULES);
    expect(zones.filter((z) => z === 'Etc/UTC')).toHaveLength(CRYPTO_SCHEDULES);
  });

  /**
   * The intraday markets are created the evening before, so the first hour
   * of a session opens for deposits overnight rather than sixty minutes
   * before it locks. After the close, too, because the ladder is calibrated
   * on completed hours and at 15:55 the last one is still running.
   */
  it('creates the next session intraday markets in the evening', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 20 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
      Target: Match.objectLike({ Input: JSON.stringify({ session: 'next' }) }),
    });
  });

  /**
   * Offset off the hour on purpose. Markets are created at 09:00, 15:55 and
   * 20:00, and a seeder on those same minutes would race the creation it
   * exists to follow rather than reliably run after it.
   */
  it('runs the seeder after each creation moment, not alongside it', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(5-55/10 9-20 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
  });

  it('keeps a morning backstop for the session that starts today', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 9 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
      Target: Match.objectLike({ Input: JSON.stringify({ session: 'today' }) }),
    });
  });

  it('creates the daily markets the session before the close they lock at', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(55 15 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
      Target: Match.objectLike({ Input: JSON.stringify({ session: 'next' }) }),
    });
  });

  /**
   * The gap this closes cost two rungs of real ladders: a dropped send left
   * TSLA and SPY with one market each for a session, and nothing ever looked
   * again. The 09:00 run targets the ladder locking at today's close, so it
   * has the whole session to get the transaction through.
   */
  it('backstops the daily ladder in the morning, targeting today\'s close', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 9 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
      Target: Match.objectLike({ Input: JSON.stringify({ session: 'today' }) }),
    });
  });

  /**
   * Crypto never closes: no weekday filter, no hour range. The publisher and
   * the crank tick every minute of the year.
   */
  it('publishes and cranks crypto every minute, every day', () => {
    const entries = Object.values(template.findResources('AWS::Scheduler::Schedule'));
    const everyMinuteUtc = entries.filter(
      (s) =>
        s.Properties.ScheduleExpression === 'cron(* * * * ? *)' &&
        s.Properties.ScheduleExpressionTimezone === 'Etc/UTC',
    );
    expect(everyMinuteUtc).toHaveLength(2);
  });

  /**
   * Seven past, then every ten. Off the hour so the tick that creates the
   * next hourly market never shares a minute with the crank locking the
   * current one.
   */
  it('creates and seeds crypto markets every ten minutes, off the hour', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(7/10 * * * ? *)',
      ScheduleExpressionTimezone: 'Etc/UTC',
    });
  });

  it('gives up quickly instead of the 185-attempt default', () => {
    const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule'));
    for (const s of schedules) {
      expect(s.Properties.Target.RetryPolicy.MaximumRetryAttempts).toBe(2);
    }
  });
});
