import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export interface WebmailStackProps extends cdk.StackProps {
  webmailBucket: s3.Bucket;
  domain: string;
}

export class WebmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebmailStackProps) {
    super(scope, id, props);

    const { webmailBucket, domain } = props;
    const webmailSubdomain = `webmail.${domain}`;

    // SSL Certificate for CloudFront
    const certificate = new acm.Certificate(this, 'WebmailCertificate', {
      domainName: webmailSubdomain,
      validation: acm.CertificateValidation.fromDns(),
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'WebmailDistribution', {
      defaultBehavior: {
        origin: new origins.S3StaticWebsiteOrigin(webmailBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [webmailSubdomain],
      certificate: certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // API Gateway for backend functions
    const api = new apigateway.RestApi(this, 'WebmailApi', {
      restApiName: 'Webmail API',
      description: 'API for webmail backend functions',
      defaultCorsPreflightOptions: {
        allowOrigins: [`https://${webmailSubdomain}`],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda execution role with S3 and SES permissions
    const lambdaRole = new iam.Role(this, 'WebmailLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        WebmailPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
              ],
              resources: [
                `arn:aws:s3:::email-storage-*`,
                `arn:aws:s3:::email-storage-*/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ses:SendEmail',
                'ses:SendRawEmail',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Placeholder Lambda functions (will be implemented in Task 3)
    const authFunction = new lambda.Function(this, 'AuthFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'https://${webmailSubdomain}',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'Auth endpoint - coming soon' }),
          };
        };
      `),
    });

    const listEmailsFunction = new lambda.Function(this, 'ListEmailsFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'https://${webmailSubdomain}',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'List emails endpoint - coming soon' }),
          };
        };
      `),
    });

    const readEmailFunction = new lambda.Function(this, 'ReadEmailFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'https://${webmailSubdomain}',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'Read email endpoint - coming soon' }),
          };
        };
      `),
    });

    const sendEmailFunction = new lambda.Function(this, 'SendEmailFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'https://${webmailSubdomain}',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'Send email endpoint - coming soon' }),
          };
        };
      `),
    });

    // API Gateway endpoints
    const auth = api.root.addResource('auth');
    auth.addMethod('POST', new apigateway.LambdaIntegration(authFunction));

    const emails = api.root.addResource('emails');
    emails.addMethod('GET', new apigateway.LambdaIntegration(listEmailsFunction));
    emails.addMethod('POST', new apigateway.LambdaIntegration(sendEmailFunction));

    const emailById = emails.addResource('{id}');
    emailById.addMethod('GET', new apigateway.LambdaIntegration(readEmailFunction));

    // Route 53 DNS record
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: domain,
    });

    new route53.ARecord(this, 'WebmailAliasRecord', {
      zone: hostedZone,
      recordName: 'webmail',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Deploy frontend files
    new s3deploy.BucketDeployment(this, 'WebmailDeployment', {
      sources: [s3deploy.Source.asset('./frontend')],
      destinationBucket: webmailBucket,
      distribution: distribution,
      distributionPaths: ['/*'],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebmailUrl', {
      value: `https://${webmailSubdomain}`,
      description: 'Webmail URL',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });
  }
}
