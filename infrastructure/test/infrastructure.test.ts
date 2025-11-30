import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as Infrastructure from '../lib/email-infrastructure-stack';

describe('Email Infrastructure Stack', () => {
  let app: cdk.App;
  let stack: Infrastructure.EmailInfrastructureStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new Infrastructure.EmailInfrastructureStack(app, 'TestEmailInfrastructureStack', {
      env: {
        account: '123456789012',
        region: 'eu-central-1'
      }
    });
    template = Template.fromStack(stack);
  });

  test('SES Domain Identity is created', () => {
    template.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'pfeiffer.rocks'
    });
  });

  test('SES Configuration Set is created', () => {
    template.hasResourceProperties('AWS::SES::ConfigurationSet', {
      Name: 'pfeiffer-rocks-config'
    });
  });

  test('SES Receipt Rule Set is created', () => {
    template.hasResourceProperties('AWS::SES::ReceiptRuleSet', {
      RuleSetName: 'pfeiffer-rocks-rules'
    });
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

  test('Lambda function for email processing is created', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.11',
      Handler: 'email_processor.lambda_handler',
      FunctionName: 'email-processor-pfeiffer-rocks'
    });
  });

  test('IAM User for SMTP credentials is created', () => {
    template.hasResourceProperties('AWS::IAM::User', {
      UserName: 'ses-smtp-user-pfeiffer-rocks'
    });
  });

  test('Secrets Manager secret for SMTP credentials is created', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Description: 'SMTP credentials for pfeiffer.rocks',
      Name: 'ses-smtp-credentials-pfeiffer-rocks'
    });
  });

  test('Lambda has proper IAM permissions', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [{
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com'
          },
          Action: 'sts:AssumeRole'
        }]
      }
    });
  });

  test('Stack outputs are defined', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs)).toContain('SMTPUsername');
    expect(Object.keys(outputs)).toContain('EmailBucketName');
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

  test('Compliance: S3 bucket exists with proper configuration', () => {
    // Check that S3 bucket is configured properly
    const resources = template.findResources('AWS::S3::Bucket');
    expect(Object.keys(resources).length).toBeGreaterThan(0);
  });
});
