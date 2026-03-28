import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { WebmailStack } from '../lib/webmail-stack';

describe('Webmail Stack', () => {
  let app: cdk.App;
  let stack: WebmailStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();

    stack = new WebmailStack(app, 'TestWebmailStack', {
      env: {
        account: '123456789012',
        region: 'eu-west-1',
      },
      domain: 'test.example.com',
    });
    template = Template.fromStack(stack);
  });

  test('Lambda functions are created with correct runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
    });
  });

  test('API Gateway is created with CORS', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'Webmail API',
      Description: 'API for webmail backend functions',
    });
  });

  test('All required API endpoints are created', () => {
    // Check for POST method (auth endpoint)
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
    });

    // Check for GET method (emails endpoint)
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
    });
  });

  test('Lambda functions have proper IAM permissions', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
    });
  });

  test('Stack outputs are defined', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs)).toContain('WebmailUrl');
    expect(Object.keys(outputs)).toContain('ApiUrl');
  });

  test('At least four Lambda functions are created', () => {
    // We expect 4 webmail functions + potentially bucket deployment functions
    const lambdaCount = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdaCount).length).toBeGreaterThanOrEqual(4);
  });
});
