import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class EmailInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = 'pfeiffer.rocks';

    // SES Domain Identity with DKIM
    const domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(domainName),
      dkimSigning: true,
      feedbackForwarding: false,
      mailFromDomain: `mail.${domainName}`
    });

    // Create SMTP user for sending emails
    const smtpUser = new iam.User(this, 'SESSmtpUser', {
      userName: `ses-smtp-user-${domainName.replace('.', '-')}`,
      path: '/email/',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSesSendingAccess')
      ]
    });

    // Create access key for SMTP user
    const smtpAccessKey = new iam.AccessKey(this, 'SMTPAccessKey', {
      user: smtpUser
    });

    // Store SMTP credentials in Secrets Manager
    const smtpSecret = new secretsmanager.Secret(this, 'SMTPCredentials', {
      secretName: `ses-smtp-credentials-${domainName.replace('.', '-')}`,
      description: `SMTP credentials for ${domainName}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          accessKeyId: smtpAccessKey.accessKeyId,
          region: this.region,
          smtpEndpoint: `email-smtp.${this.region}.amazonaws.com`,
          smtpPort: '587'
        }),
        generateStringKey: 'secretAccessKey',
        excludeCharacters: '"@/\\'
      }
    });

    // S3 Bucket for email storage
    const emailBucket = new s3.Bucket(this, 'EmailStorageBucket', {
      bucketName: `email-storage-${domainName.replace('.', '-')}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'ArchiveOldEmails',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90)
            }
          ]
        }
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // DynamoDB table for email metadata
    const emailMetadataTable = new dynamodb.Table(this, 'EmailMetadataTable', {
      tableName: `email-metadata-${domainName.replace('.', '-')}`,
      partitionKey: {
        name: 'messageId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Add GSI for querying by recipient and timestamp
    emailMetadataTable.addGlobalSecondaryIndex({
      indexName: 'RecipientTimestampIndex',
      partitionKey: {
        name: 'recipient',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING
      }
    });

    // Add GSI for querying by date
    emailMetadataTable.addGlobalSecondaryIndex({
      indexName: 'DateIndex',
      partitionKey: {
        name: 'date',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING
      }
    });

    // Lambda function for processing incoming emails
    const emailProcessorFunction = new lambda.Function(this, 'EmailProcessorFunction', {
      functionName: `email-processor-${domainName.replace('.', '-')}`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'email_processor.lambda_handler',
      code: lambda.Code.fromAsset('./lambda'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        BUCKET_NAME: emailBucket.bucketName,
        TABLE_NAME: emailMetadataTable.tableName,
        DOMAIN_NAME: domainName
      }
    });

    // Grant permissions to Lambda function
    emailBucket.grantReadWrite(emailProcessorFunction);
    emailMetadataTable.grantReadWriteData(emailProcessorFunction);

    // Add S3 trigger for Lambda when emails are uploaded to incoming/
    emailBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(emailProcessorFunction),
      { prefix: 'incoming/' }
    );

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: `${domainName.replace('.', '-')}-rules`
    });

    // Note: Rule set needs to be manually activated after deployment
    // Run: aws ses set-active-receipt-rule-set --rule-set-name [rule-set-name] --region eu-central-1

    // SES Receipt Rule for storing emails in S3
    const receiptRule = new ses.ReceiptRule(this, 'EmailReceiptRule', {
      ruleSet: ruleSet,
      recipients: [domainName, `*.${domainName}`],
      actions: [
        new sesActions.S3({
          bucket: emailBucket,
          objectKeyPrefix: 'incoming/',
          topic: undefined // We'll use S3 notifications instead
        }),
        new sesActions.Lambda({
          function: emailProcessorFunction,
          invocationType: sesActions.LambdaInvocationType.EVENT
        })
      ],
      enabled: true,
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.REQUIRE
    });

    // IAM role for email sync services (to be used by external sync services)
    const emailSyncRole = new iam.Role(this, 'EmailSyncRole', {
      roleName: `email-sync-role-${domainName.replace('.', '-')}`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.AccountPrincipal(this.account) // Allow cross-service access within account
      ),
      description: 'Role for email sync services to access S3 and DynamoDB'
    });

    // Grant permissions to sync role
    emailBucket.grantRead(emailSyncRole);
    emailMetadataTable.grantReadData(emailSyncRole);

    // Create access keys for programmatic access (for external sync services)
    const syncUser = new iam.User(this, 'EmailSyncUser', {
      userName: `email-sync-user-${domainName.replace('.', '-')}`
    });

    emailBucket.grantRead(syncUser);
    emailMetadataTable.grantReadData(syncUser);

    // SES Configuration Set for monitoring
    const configurationSet = new ses.ConfigurationSet(this, 'EmailConfigurationSet', {
      configurationSetName: `${domainName.replace('.', '-')}-config`,
      sendingEnabled: true
    });

    // Associate domain identity with configuration set
    domainIdentity.node.addDependency(configurationSet);

    // Outputs
    new cdk.CfnOutput(this, 'EmailBucketName', {
      value: emailBucket.bucketName,
      description: 'S3 bucket name for email storage',
      exportName: `EmailBucket-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'EmailMetadataTableName', {
      value: emailMetadataTable.tableName,
      description: 'DynamoDB table name for email metadata',
      exportName: `EmailTable-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'EmailProcessorFunctionName', {
      value: emailProcessorFunction.functionName,
      description: 'Lambda function name for email processing',
      exportName: `EmailProcessor-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'EmailSyncRoleArn', {
      value: emailSyncRole.roleArn,
      description: 'IAM role ARN for email sync services',
      exportName: `EmailSyncRole-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'EmailSyncUserArn', {
      value: syncUser.userArn,
      description: 'IAM user ARN for email sync services',
      exportName: `EmailSyncUser-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SESReceiptRuleSetName', {
      value: ruleSet.receiptRuleSetName,
      description: 'SES receipt rule set name',
      exportName: `SESRuleSet-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SESConfigurationSetName', {
      value: configurationSet.configurationSetName,
      description: 'SES configuration set name for monitoring',
      exportName: `SESConfigSet-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SESMXRecord', {
      value: `10 inbound-smtp.${this.region}.amazonaws.com`,
      description: 'MX record to configure for the domain',
      exportName: `MXRecord-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SESSMTPEndpoint', {
      value: `email-smtp.${this.region}.amazonaws.com:587`,
      description: 'SMTP endpoint for sending emails',
      exportName: `SMTPEndpoint-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SMTPUsername', {
      value: smtpAccessKey.accessKeyId,
      description: 'SMTP username (Access Key ID)',
      exportName: `SMTPUsername-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SMTPCredentialsSecret', {
      value: smtpSecret.secretArn,
      description: 'ARN of secret containing SMTP credentials',
      exportName: `SMTPSecret-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'DomainIdentityArn', {
      value: domainIdentity.emailIdentityArn,
      description: 'SES Domain Identity ARN',
      exportName: `DomainIdentity-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'DKIMTokensInfo', {
      value: 'Check SES Console for DKIM tokens after deployment',
      description: 'DKIM tokens available in SES console',
      exportName: `DKIMInfo-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SPFRecord', {
      value: '"v=spf1 include:amazonses.com ~all"',
      description: 'SPF record to add to DNS',
      exportName: `SPFRecord-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'DNSConfigCommand', {
      value: `Run: ./scripts/show-dns-config.sh ${domainName}`,
      description: 'Command to show all DNS records',
      exportName: `DNSCommand-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'DNSInstructions', {
      value: `1. MX: ${domainName} MX 10 inbound-smtp.${this.region}.amazonaws.com | 2. SPF: ${domainName} TXT "v=spf1 include:amazonses.com ~all" | 3. Verification: _amazonses.${domainName} TXT [see VerificationTXTRecord] | 4. DKIM: See DKIM outputs above`,
      description: 'Complete DNS configuration instructions',
      exportName: `DNSInstructions-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'ActivateRuleSetCommand', {
      value: `aws ses set-active-receipt-rule-set --rule-set-name ${ruleSet.receiptRuleSetName} --region ${this.region}`,
      description: 'Command to manually activate the receipt rule set',
      exportName: `ActivateRuleSet-${domainName.replace('.', '-')}`
    });
  }
}
