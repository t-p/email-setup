# Email Infrastructure for example.com

A simplified, storage-only email infrastructure using AWS SES for receiving and sending emails, with direct S3 storage for raw email data.

## Current Status: **FULLY OPERATIONAL**

**Domain Verified**: example.com  
**DKIM Configured**: AWS-managed keys with automatic rotation  
**Email Receiving**: Active via SES → Direct S3 storage  
**Email Sending**: SMTP available via SES  
**Production Access**: Enabled (50,000 emails/day)  
**DNS Records**: All properly configured  
**Cost**: ~$3.50/month (storage-only approach)  

## Architecture Overview

```
Internet Email → AWS SES → S3 Storage (Raw RFC822)
                              ↓
                         IMAP Servers (sync from S3)
                              ↓
                         Email Clients
```

### Components

- **AWS SES**: Email receiving and sending with DKIM authentication
- **S3 Bucket**: Raw email storage with lifecycle management (IA → Glacier → Deep Archive)
- **Route 53**: DNS management with automated DKIM records
- **IAM Users**: Separate credentials for SMTP sending and S3 sync access

**Simplified Design**: No Lambda functions, no DynamoDB, no email processing - just direct storage of raw emails for IMAP sync.

## Quick Start

### Prerequisites
- AWS CLI configured
- Node.js 22+ and npm
- Domain hosted in Route 53

### Deploy Infrastructure

```bash
cd infrastructure
npm install
npm run build
./deploy.sh deploy
```

### Verify Setup

```bash
# Test all components
./scripts/test-email-infrastructure.sh example.com

# Show DNS configuration
./scripts/show-dns-config.sh example.com
```

## Email Configuration

### Receiving Emails
- **MX Record**: `10 inbound-smtp.eu-west-1.amazonaws.com`
- **Storage**: Raw emails stored in S3 `incoming/` folder
- **Format**: RFC822 standard email format

### Sending Emails
- **SMTP Server**: `email-smtp.eu-west-1.amazonaws.com:587`
- **Username**: Available in stack outputs
- **Password**: Retrieved via AWS IAM access keys
- **Authentication**: TLS required

### IMAP Access (Future)
Your IMAP servers will sync emails from S3:
- **Primary**: Kubernetes deployment on local cluster
- **Backup**: AWS Lightsail with Roundcube webmail

## DNS Records (Auto-Configured)

All DNS records are automatically managed via Route 53:

- **MX**: Mail routing to AWS SES
- **SPF**: `"v=spf1 include:amazonses.com ~all"`
- **DKIM**: 3 CNAME records for AWS-managed keys
- **Domain Verification**: TXT record for SES

## Storage Structure

```
S3 Bucket: email-storage-example-com-************-v2
├── incoming/           # Raw emails from SES
│   └── {messageId}     # Individual email files
```

## Cost Breakdown

- **AWS SES**: ~$1/month (receiving + sending)
- **S3 Storage**: ~$2/month (with lifecycle archiving)
- **Route 53**: ~$0.50/month (hosted zone)
- **Total**: ~$3.50/month (AWS only)

*Additional costs for IMAP servers (Lightsail ~$5/month) when implemented*

## Security Features

- **TLS Encryption**: All email transport encrypted
- **DKIM Signing**: AWS-managed key rotation
- **SPF Records**: Sender authentication
- **IAM Permissions**: Least-privilege access
- **Account ID Masking**: Sensitive data protected in outputs

## Management Commands

```bash
# Deploy infrastructure
./deploy.sh deploy

# Show DNS configuration
./scripts/show-dns-config.sh example.com

# Test infrastructure
./scripts/test-email-infrastructure.sh example.com

# Clean up resources
./cleanup.sh
```

## File Structure

```
infrastructure/
├── lib/
│   └── email-infrastructure-stack.ts  # Main CDK stack
├── scripts/
│   ├── show-dns-config.sh            # DNS configuration helper
│   └── test-email-infrastructure.sh  # Infrastructure testing
├── bin/
│   └── infrastructure.ts             # CDK app entry point
├── deploy.sh                         # Main deployment script
├── cleanup.sh                        # Resource cleanup
└── package.json                      # Dependencies
```

## Next Steps

1. **IMAP Server Setup**: Deploy Kubernetes IMAP server to sync from S3
2. **Backup Server**: Set up Lightsail instance with Roundcube
3. **Email Clients**: Configure Apple Mail, mobile apps
4. **Monitoring**: Add CloudWatch alerts for email delivery

## Troubleshooting

### Common Issues

**Emails not receiving**: Check that SES receipt rule set is active
```bash
aws ses describe-active-receipt-rule-set --region eu-west-1
```

**SMTP not working**: Verify production access is enabled
```bash
aws ses get-send-quota --region eu-west-1
```

**DNS issues**: Verify all records are propagated
```bash
dig MX example.com
dig TXT example.com
```

## Support

- **AWS SES Documentation**: https://docs.aws.amazon.com/ses/
- **CDK Documentation**: https://docs.aws.amazon.com/cdk/
- **Test Scripts**: Built-in validation and troubleshooting

---

**Status**: Production Ready  
**Last Updated**: January 1, 2026  
**Region**: eu-west-1  
**Domain**: example.com
