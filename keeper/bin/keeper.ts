#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { KeeperStack } from '../lib/keeper-stack';

const app = new cdk.App();

new KeeperStack(app, 'MoveXEquitiesKeeper', {
  description: 'MoveX Equities keeper: scheduled strike calibration',
  // Resolved from the CLI profile at synth time so the stack follows
  // whichever account is configured, rather than pinning an account id
  // into the repo.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
