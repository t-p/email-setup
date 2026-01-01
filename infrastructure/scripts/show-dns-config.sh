#!/bin/bash

# DNS Configuration Helper Script
# This script extracts SES DNS configuration from CloudFormation stack outputs
# and displays them in a format ready for DNS configuration

set -e

DOMAIN=${1:-pfeiffer.rocks}
STACK_NAME="EmailInfrastructureStack"
REGION=${AWS_REGION:-eu-central-1}

echo "🌐 DNS Configuration for SES Domain: $DOMAIN"
echo "📍 Region: $REGION"
echo "📦 Stack: $STACK_NAME"
echo ""

# Function to get stack output
get_output() {
    local key=$1
    aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" \
        --output text 2>/dev/null || echo "Not found"
}

# Function to get SES domain verification attributes
get_verification_token() {
    aws ses get-identity-verification-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "VerificationAttributes.\"$DOMAIN\".VerificationToken" \
        --output text 2>/dev/null || echo "Not found"
}

# Function to get DKIM tokens
get_dkim_tokens() {
    aws ses get-identity-dkim-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "DkimAttributes.\"$DOMAIN\".DkimTokens" \
        --output text 2>/dev/null || echo "Not found"
}

echo "=== DNS RECORDS TO ADD ==="
echo ""

# MX Record
echo "📧 MX Record (Mail Exchange)"
echo "   Name: $DOMAIN"
echo "   Type: MX"
echo "   Priority: 10"
echo "   Value: inbound-smtp.$REGION.amazonaws.com"
echo "   TTL: 300"
echo ""

# SPF Record
echo "🛡️  SPF Record (Spam Protection)"
echo "   Name: $DOMAIN"
echo "   Type: TXT"
echo "   Value: \"v=spf1 include:amazonses.com ~all\""
echo "   TTL: 300"
echo ""

# Domain Verification
echo "✅ Domain Verification Record"
VERIFICATION_TOKEN=$(get_verification_token)
if [[ "$VERIFICATION_TOKEN" != "Not found" ]] && [[ "$VERIFICATION_TOKEN" != "None" ]]; then
    echo "   Name: _amazonses.$DOMAIN"
    echo "   Type: TXT"
    echo "   Value: $VERIFICATION_TOKEN"
    echo "   TTL: 300"
else
    echo "   ⚠️  Verification token not yet available"
    echo "   Run this script again after stack deployment completes"
fi
echo ""

# DKIM Records
echo "🔐 DKIM Records (Email Authentication)"
DKIM_TOKENS=$(get_dkim_tokens)
if [[ "$DKIM_TOKENS" != "Not found" ]] && [[ "$DKIM_TOKENS" != "None" ]]; then
    counter=1
    for token in $DKIM_TOKENS; do
        echo "   DKIM Record $counter:"
        echo "   Name: ${token}._domainkey.$DOMAIN"
        echo "   Type: CNAME"
        echo "   Value: ${token}.dkim.amazonses.com"
        echo "   TTL: 300"
        echo ""
        ((counter++))
    done
else
    echo "   ⚠️  DKIM tokens not yet available"
    echo "   Run this script again after stack deployment completes"
    echo ""
fi

# MAIL FROM domain (optional but recommended)
echo "📮 MAIL FROM Domain (Optional)"
echo "   Name: mail.$DOMAIN"
echo "   Type: MX"
echo "   Priority: 10"
echo "   Value: feedback-smtp.$REGION.amazonses.com"
echo "   TTL: 300"
echo ""
echo "   Name: mail.$DOMAIN"
echo "   Type: TXT"
echo "   Value: \"v=spf1 include:amazonses.com ~all\""
echo "   TTL: 300"
echo ""

echo "=== VERIFICATION COMMANDS ==="
echo ""
echo "🔍 Check MX record:"
echo "   dig MX $DOMAIN"
echo ""
echo "🔍 Check SPF record:"
echo "   dig TXT $DOMAIN"
echo ""
echo "🔍 Check domain verification:"
echo "   dig TXT _amazonses.$DOMAIN"
echo ""
echo "🔍 Check DKIM records:"
if [[ "$DKIM_TOKENS" != "Not found" ]] && [[ "$DKIM_TOKENS" != "None" ]]; then
    for token in $DKIM_TOKENS; do
        echo "   dig CNAME ${token}._domainkey.$DOMAIN"
    done
else
    echo "   (DKIM tokens not available yet)"
fi
echo ""

echo "=== SES STATUS ==="
echo ""

# Check domain verification status
echo "📧 Domain Verification Status:"
VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
    --identities $DOMAIN \
    --region $REGION \
    --query "VerificationAttributes.\"$DOMAIN\".VerificationStatus" \
    --output text 2>/dev/null || echo "Not found")
echo "   Status: $VERIFICATION_STATUS"
echo ""

# Check DKIM status
echo "🔐 DKIM Status:"
DKIM_ENABLED=$(aws ses get-identity-dkim-attributes \
    --identities $DOMAIN \
    --region $REGION \
    --query "DkimAttributes.\"$DOMAIN\".DkimEnabled" \
    --output text 2>/dev/null || echo "Not found")
DKIM_VERIFICATION_STATUS=$(aws ses get-identity-dkim-attributes \
    --identities $DOMAIN \
    --region $REGION \
    --query "DkimAttributes.\"$DOMAIN\".DkimVerificationStatus" \
    --output text 2>/dev/null || echo "Not found")
echo "   DKIM Enabled: $DKIM_ENABLED"
echo "   DKIM Verification: $DKIM_VERIFICATION_STATUS"
echo ""

# Check sending quota
echo "📊 SES Sending Quota:"
SEND_QUOTA=$(aws ses get-send-quota --region $REGION --query 'Max24HourSend' --output text 2>/dev/null || echo "0")
SEND_RATE=$(aws ses get-send-quota --region $REGION --query 'MaxSendRate' --output text 2>/dev/null || echo "0")
echo "   24-hour limit: $SEND_QUOTA emails"
echo "   Rate limit: $SEND_RATE emails/second"
echo ""

# Check if in sandbox mode
SENDING_ENABLED=$(aws ses get-send-quota --region $REGION --query 'Max24HourSend' --output text 2>/dev/null)
if [[ "$SEND_QUOTA" == "200" ]]; then
    echo "⚠️  SES is in SANDBOX mode - only verified email addresses can receive emails"
    echo "   Request production access: https://console.aws.amazon.com/ses/home?region=$REGION#/account"
    echo ""
fi

echo "=== STACK OUTPUTS ==="
echo ""

# Show relevant stack outputs
echo "🔗 SMTP Configuration:"
SMTP_ENDPOINT=$(get_output "SESSMTPEndpoint")
SMTP_USERNAME=$(get_output "SMTPUsername")
SMTP_SECRET=$(get_output "SMTPCredentialsSecret")
echo "   Server: email-smtp.$REGION.amazonaws.com"
echo "   Port: 587 (TLS) or 465 (SSL)"
echo "   Username: $SMTP_USERNAME"
echo "   Password: Available in AWS Secrets Manager"
echo "   Secret ARN: $SMTP_SECRET"
echo ""

echo "📁 Storage Configuration:"
BUCKET_NAME=$(get_output "EmailBucketName")
echo "   S3 Bucket: $BUCKET_NAME"
echo ""

echo "=== NEXT STEPS ==="
echo ""
echo "1. 📝 Add the DNS records shown above to your domain's DNS configuration"
echo "2. 🔧 Activate SES receipt rule set (IMPORTANT - emails won't work without this):"
echo "   aws ses set-active-receipt-rule-set --rule-set-name ${DOMAIN//./-}-rules --region $REGION"
echo "3. ⏳ Wait for DNS propagation (up to 24 hours, usually much faster)"
echo "4. 🔍 Run verification commands to check DNS propagation"
echo "5. ✅ Check SES status in AWS Console: https://console.aws.amazon.com/ses/home?region=$REGION"
echo "6. 📧 Test email sending once domain is verified"
echo "7. 🚀 Request production access if needed (removes sandbox restrictions)"
echo ""

echo "💡 Re-run this script anytime to check current status:"
echo "   ./scripts/show-dns-config.sh $DOMAIN"
echo ""
echo "🔧 To activate receipt rule set manually:"
echo "   ./deploy.sh activate-rules"
echo ""
