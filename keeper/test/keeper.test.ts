import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { KeeperStack } from '../lib/keeper-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  template = Template.fromStack(new KeeperStack(app, 'TestKeeper'));
});

describe('strike calibration lambda', () => {
  it('is created with enough headroom for three sequential provider calls', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Timeout: 60,
      MemorySize: 256,
    });
  });

  it('does not retain logs forever', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    });
  });
});

describe('schedule', () => {
  /**
   * The timezone assertion is the important one. US close is 16:00 ET, which
   * is 20:00 UTC in summer and 21:00 UTC in winter. A UTC cron would drift an
   * hour on the first Sunday of November and every settlement after that
   * would read the wrong price.
   */
  it('fires at 15:55 New York time on weekdays, not in UTC', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(55 15 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
  });

  it('gives up after a few retries instead of the 185-attempt default', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Target: Match.objectLike({
        RetryPolicy: {
          MaximumRetryAttempts: 3,
          MaximumEventAgeInSeconds: 300,
        },
      }),
    });
  });

  it('targets the calibration lambda', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Target: Match.objectLike({
        Arn: Match.objectLike({ 'Fn::GetAtt': Match.anyValue() }),
      }),
    });
  });

  it('runs exactly one schedule, so nothing fires twice per day', () => {
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });
});
