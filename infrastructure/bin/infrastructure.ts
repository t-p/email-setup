#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EmailInfrastructureStack } from '../lib/email-infrastructure-stack';

const app = new cdk.App();

new EmailInfrastructureStack(app, 'EmailInfrastructureStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1' // SES is available in eu-central-1
  },
  description: 'Email infrastructure for pfeiffer.rocks domain using AWS SES'
});
