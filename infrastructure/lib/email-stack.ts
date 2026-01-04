import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import { Construct } from 'constructs';

export interface EmailStackProps extends cdk.StackProps {
  emailBucket: s3.Bucket;
  domain: string;
}

export class EmailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);

    const { emailBucket, domain } = props;

    // SES Domain Identity with DKIM
    const domainIdentity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(domain),
      dkimSigning: true,
      feedbackForwarding: false,
      mailFromDomain: `mail.${domain}`
    });

    // Create SMTP user for sending emails
    const smtpUser = new iam.User(this, 'SESSmtpUser', {
      userName: `ses-smtp-user-${domain.replace('.', '-')}`,
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
    new iam.AccessKey(this, 'SMTPAccessKey', {
      user: smtpUser
    });

    // IAM user for email sync services (for IMAP server sync jobs)
    const syncUser = new iam.User(this, 'EmailSyncUser', {
      userName: `email-sync-user-${domain.replace('.', '-')}`
    });

    // Grant read access to email bucket for sync user
    emailBucket.grantRead(syncUser);

    // Create access key for email sync user
    new iam.AccessKey(this, 'EmailSyncAccessKey', {
      user: syncUser
    });

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, 'EmailReceiptRuleSet', {
      receiptRuleSetName: `${domain.replace('.', '-')}-rules`
    });

    // SES Receipt Rule for storing emails in S3
    new ses.ReceiptRule(this, 'EmailReceiptRule', {
      ruleSet: ruleSet,
      recipients: [domain],
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
      configurationSetName: `${domain.replace('.', '-')}-config`,
      sendingEnabled: true
    });

    // Associate domain identity with configuration set
    domainIdentity.node.addDependency(configurationSet);

    // Outputs
    new cdk.CfnOutput(this, 'SESMXRecord', {
      value: `10 inbound-smtp.${this.region}.amazonaws.com`,
      description: 'MX record to configure for the domain',
      exportName: `MXRecord-${domain.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SESSMTPEndpoint', {
      value: `email-smtp.${this.region}.amazonaws.com:587`,
      description: 'SMTP endpoint for sending emails',
      exportName: `SMTPEndpoint-${domain.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'SPFRecord', {
      value: '"v=spf1 include:amazonses.com ~all"',
      description: 'SPF record to add to DNS',
      exportName: `SPFRecord-${domain.replace('.', '-')}`
    });

    new cdk.CfnOutput(this, 'ActivateRuleSetCommand', {
      value: `aws ses set-active-receipt-rule-set --rule-set-name ${ruleSet.receiptRuleSetName} --region ${this.region}`,
      description: 'Command to manually activate the receipt rule set',
      exportName: `ActivateRuleSet-${domain.replace('.', '-')}`
    });
  }
}
