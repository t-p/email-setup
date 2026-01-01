import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import { Construct } from 'constructs';

export class EmailInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Email infrastructure for domain from environment variable
    const domainName = process.env.DOMAIN_NAME || 'pfeiffer.rocks';

    // S3 Bucket for email storage (STATEFUL - will be retained)
    const emailBucket = new s3.Bucket(this, 'EmailStorageBucket', {
      bucketName: `email-storage-${domainName.replace('.', '-')}-${this.account}-v2`,
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
      path: '/email/'
    });

    // Add SES sending permissions to SMTP user
    smtpUser.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail'
      ],
      resources: ['*']
    }));

    // Create access key for SMTP user
    const smtpAccessKey = new iam.AccessKey(this, 'SMTPAccessKey', {
      user: smtpUser
    });

    // IAM user for email sync services (for IMAP server sync jobs)
    const syncUser = new iam.User(this, 'EmailSyncUser', {
      userName: `email-sync-user-${domainName.replace('.', '-')}`
    });

    // Grant read access to email bucket for sync user
    emailBucket.grantRead(syncUser);

    // Create access key for email sync user
    const syncAccessKey = new iam.AccessKey(this, 'EmailSyncAccessKey', {
      user: syncUser
    });

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: `${domainName.replace('.', '-')}-rules`
    });

    // SES Receipt Rule for storing emails in S3
    const receiptRule = new ses.ReceiptRule(this, 'EmailReceiptRule', {
      ruleSet: ruleSet,
      recipients: [domainName],
      actions: [
        new sesActions.S3({
          bucket: emailBucket,
          objectKeyPrefix: 'incoming/'
        })
      ],
      enabled: true,
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.REQUIRE
    });

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

    new cdk.CfnOutput(this, 'EmailSyncUserArn', {
      value: syncUser.userArn,
      description: 'IAM user ARN for email sync services',
      exportName: `EmailSyncUser-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'EmailSyncAccessKeyId', {
      value: syncAccessKey.accessKeyId,
      description: 'Access Key ID for email sync user (for IMAP server)',
      exportName: `EmailSyncAccessKey-${domainName.replace('.', '-')}`
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

    new cdk.CfnOutput(this, 'DomainIdentityArn', {
      value: domainIdentity.emailIdentityArn,
      description: 'SES Domain Identity ARN',
      exportName: `DomainIdentity-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SPFRecord', {
      value: '"v=spf1 include:amazonses.com ~all"',
      description: 'SPF record to add to DNS',
      exportName: `SPFRecord-${domainName.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'ActivateRuleSetCommand', {
      value: `aws ses set-active-receipt-rule-set --rule-set-name ${ruleSet.receiptRuleSetName} --region ${this.region}`,
      description: 'Command to manually activate the receipt rule set',
      exportName: `ActivateRuleSet-${domainName.replace('.', '-')}`
    });
  }
}
