import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EmailStorageStack } from '../lib/email-storage-stack';

describe('Email Storage Stack', () => {
  let app: cdk.App;
  let storageStack: EmailStorageStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();

    storageStack = new EmailStorageStack(app, 'TestEmailStorageStack', {
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      }
    });

    template = Template.fromStack(storageStack);
  });

  test('S3 Bucket for email storage is created', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  test('DynamoDB table for email metadata is created', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TableName: 'email-metadata-pfeiffer-rocks'
    });
  });

  test('Security: S3 bucket has proper access controls', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  test('Security: DynamoDB table has point-in-time recovery enabled', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true
      }
    });
  });

  test('Storage stack outputs are defined', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs)).toContain('EmailBucketName');
    expect(Object.keys(outputs)).toContain('EmailMetadataTableName');
  });
});
