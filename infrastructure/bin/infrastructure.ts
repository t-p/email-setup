#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EmailStack } from '../lib/email-stack';
import { StorageStack } from '../lib/storage-stack';
import { WebmailStack } from '../lib/webmail-stack';

const app = new cdk.App();

// Get domain from environment variable
const domain = process.env.DOMAIN_NAME || 'pfeiffer.rocks';

const storageStack = new StorageStack(app, 'StorageStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1'
  },
  description: 'Stateful storage resources for email infrastructure',
  domain: domain
});

new EmailStack(app, 'EmailStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1' // SES email receiving is only available in eu-west-1, us-east-1, us-west-2
  },
  description: 'Email infrastructure for pfeiffer.rocks domain using AWS SES',
  emailBucket: storageStack.emailBucket,
  domain: domain
});

new WebmailStack(app, 'WebmailStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-1'
  },
  description: 'Webmail interface for pfeiffer.rocks domain',
  webmailBucket: storageStack.webmailBucket,
  domain: domain
});
