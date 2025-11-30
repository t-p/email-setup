#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EmailStorageStack } from '../lib/email-storage-stack';
import { EmailInfrastructureStack } from '../lib/email-infrastructure-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'eu-west-1' // SES email receiving is only available in eu-west-1, us-east-1, us-west-2
};

// Create storage stack first (stateful resources)
const storageStack = new EmailStorageStack(app, 'EmailStorageStack', {
  env,
  description: 'Stateful storage resources for email infrastructure (S3, DynamoDB)'
});

// Create infrastructure stack (stateless resources)
new EmailInfrastructureStack(app, 'EmailInfrastructureStack', {
  env,
  emailBucket: storageStack.emailBucket,
  emailMetadataTable: storageStack.emailMetadataTable,
  description: 'Email infrastructure for pfeiffer.rocks domain using AWS SES'
});
