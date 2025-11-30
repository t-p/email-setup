#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EmailInfrastructureStack } from '../lib/email-infrastructure-stack';

const app = new cdk.App();

new EmailInfrastructureStack(app, 'EmailInfrastructureStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1' // SES email receiving is only available in eu-west-1, us-east-1, us-west-2
  },
  description: 'Email infrastructure for pfeiffer.rocks domain using AWS SES'
});
