import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/storage-stack';

describe('Storage Stack', () => {
  let app: cdk.App;
  let storageStack: StorageStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();

    // Set environment variable for test
    process.env.DOMAIN_NAME = 'test-domain.com';

    storageStack = new StorageStack(app, 'TestStorageStack', {
      env: {
        account: '123456789012',
        region: 'eu-west-1'
      },
      domain: 'test-domain.com'
    });

    template = Template.fromStack(storageStack);
    
    // Clean up environment variable after test
    delete process.env.DOMAIN_NAME;
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

  test('Storage stack has no sensitive outputs', () => {
    const outputs = template.findOutputs('*');
    // Verify no outputs contain sensitive data (bucket names with account IDs)
    expect(Object.keys(outputs)).toEqual([]);
  });
});
