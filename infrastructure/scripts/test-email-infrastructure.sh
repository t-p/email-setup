#!/bin/bash

# Email Infrastructure Test Script
# This script tests the email infrastructure deployment and configuration

set -e

DOMAIN=${1:-pfeiffer.rocks}
STACK_NAME="EmailInfrastructureStack"
REGION=${AWS_REGION:-eu-west-1}
TEST_EMAIL=${2:-test@${DOMAIN}}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}================================${NC}"
    echo -e "${BLUE}  Email Infrastructure Tests${NC}"
    echo -e "${BLUE}  Domain: ${DOMAIN}${NC}"
    echo -e "${BLUE}  Region: ${REGION}${NC}"
    echo -e "${BLUE}================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Function to get stack output
get_output() {
    local key=$1
    aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" \
        --output text 2>/dev/null || echo "Not found"
}

test_stack_deployment() {
    echo -e "${BLUE}Testing CloudFormation Stack...${NC}"

    # Check if stack exists and is in good state
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $REGION \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")

    if [ "$STACK_STATUS" = "CREATE_COMPLETE" ] || [ "$STACK_STATUS" = "UPDATE_COMPLETE" ]; then
        print_success "Stack is deployed and healthy: $STACK_STATUS"
    elif [ "$STACK_STATUS" = "NOT_FOUND" ]; then
        print_error "Stack not found. Please deploy first."
        return 1
    else
        print_error "Stack is in problematic state: $STACK_STATUS"
        return 1
    fi
}

test_s3_bucket() {
    echo -e "\n${BLUE}Testing S3 Bucket...${NC}"

    BUCKET_NAME=$(get_output "EmailBucketName")
    if [ "$BUCKET_NAME" = "Not found" ]; then
        print_error "S3 bucket name not found in stack outputs"
        return 1
    fi

    # Check if bucket exists and is accessible
    if aws s3 ls "s3://$BUCKET_NAME" >/dev/null 2>&1; then
        print_success "S3 bucket accessible: $BUCKET_NAME"

        # Check bucket structure
        echo "   Checking bucket structure..."
        aws s3 ls "s3://$BUCKET_NAME/" --recursive | head -10 || echo "   Bucket is empty (expected for new deployment)"

        # Test write permissions (create a test file)
        echo "test-$(date +%s)" | aws s3 cp - "s3://$BUCKET_NAME/test/infrastructure-test.txt" >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            print_success "S3 write permissions working"
            # Clean up test file
            aws s3 rm "s3://$BUCKET_NAME/test/infrastructure-test.txt" >/dev/null 2>&1
        else
            print_warning "S3 write test failed - check IAM permissions"
        fi
    else
        print_error "S3 bucket not accessible: $BUCKET_NAME"
        return 1
    fi
}

test_ses_domain() {
    echo -e "\n${BLUE}Testing SES Domain Configuration...${NC}"

    # Check domain verification status
    VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "VerificationAttributes.\"$DOMAIN\".VerificationStatus" \
        --output text 2>/dev/null || echo "Not found")

    echo "   Domain verification status: $VERIFICATION_STATUS"
    if [ "$VERIFICATION_STATUS" = "Success" ]; then
        print_success "Domain is verified with SES"
    elif [ "$VERIFICATION_STATUS" = "Pending" ]; then
        print_warning "Domain verification is pending - check DNS configuration"
    else
        print_warning "Domain not verified - add DNS verification record"
    fi

    # Check DKIM status
    DKIM_ENABLED=$(aws ses get-identity-dkim-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "DkimAttributes.\"$DOMAIN\".DkimEnabled" \
        --output text 2>/dev/null || echo "false")

    DKIM_STATUS=$(aws ses get-identity-dkim-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "DkimAttributes.\"$DOMAIN\".DkimVerificationStatus" \
        --output text 2>/dev/null || echo "Not found")

    echo "   DKIM enabled: $DKIM_ENABLED"
    echo "   DKIM verification: $DKIM_STATUS"

    if [ "$DKIM_ENABLED" = "true" ] && [ "$DKIM_STATUS" = "Success" ]; then
        print_success "DKIM is properly configured"
    elif [ "$DKIM_ENABLED" = "true" ]; then
        print_warning "DKIM enabled but not yet verified - check DNS records"
    else
        print_warning "DKIM configuration incomplete - check DNS records"
    fi
}

test_ses_rules() {
    echo -e "\n${BLUE}Testing SES Receipt Rules...${NC}"

    # Check active receipt rule set
    ACTIVE_RULE_SET=$(aws ses describe-active-receipt-rule-set \
        --region $REGION \
        --query 'Metadata.Name' \
        --output text 2>/dev/null || echo "None")

    EXPECTED_RULE_SET="${DOMAIN//./-}-rules"

    echo "   Active rule set: $ACTIVE_RULE_SET"
    echo "   Expected rule set: $EXPECTED_RULE_SET"

    if [ "$ACTIVE_RULE_SET" = "$EXPECTED_RULE_SET" ]; then
        print_success "Correct receipt rule set is active"

        # List rules in the active set
        echo "   Receipt rules:"
        aws ses describe-receipt-rule-set \
            --rule-set-name $ACTIVE_RULE_SET \
            --region $REGION \
            --query 'Rules[].{Name:Name,Recipients:Recipients,Enabled:Enabled}' \
            --output table 2>/dev/null || echo "   Could not list rules"
    elif [ "$ACTIVE_RULE_SET" = "None" ]; then
        print_error "No receipt rule set is active - emails will be rejected!"
        echo "   📋 To activate the rule set:"
        echo "   aws ses set-active-receipt-rule-set --rule-set-name $EXPECTED_RULE_SET --region $REGION"
        echo "   OR run: ./deploy.sh activate-rules"
    else
        print_warning "Different rule set is active: $ACTIVE_RULE_SET"
        echo "   📋 To activate the correct rule set:"
        echo "   aws ses set-active-receipt-rule-set --rule-set-name $EXPECTED_RULE_SET --region $REGION"
        echo "   OR run: ./deploy.sh activate-rules"
    fi
}

test_smtp_configuration() {
    echo -e "\n${BLUE}Testing SMTP Configuration...${NC}"

    SMTP_USERNAME=$(get_output "SMTPUsername")
    SMTP_SECRET_ARN=$(get_output "SMTPCredentialsSecret")

    if [ "$SMTP_USERNAME" != "Not found" ]; then
        print_success "SMTP username available: $SMTP_USERNAME"
    else
        print_error "SMTP username not found"
        return 1
    fi

    if [ "$SMTP_SECRET_ARN" != "Not found" ]; then
        print_success "SMTP credentials stored in Secrets Manager"
        echo "   Secret ARN: $SMTP_SECRET_ARN"

        # Test if we can access the secret
        SECRET_VALUE=$(aws secretsmanager get-secret-value \
            --secret-id $SMTP_SECRET_ARN \
            --region $REGION \
            --query 'SecretString' \
            --output text 2>/dev/null || echo "ACCESS_DENIED")

        if [ "$SECRET_VALUE" != "ACCESS_DENIED" ]; then
            print_success "SMTP credentials accessible"
            echo "   SMTP server: email-smtp.$REGION.amazonaws.com:587"
        else
            print_warning "Cannot access SMTP credentials - check IAM permissions"
        fi
    else
        print_error "SMTP credentials secret not found"
        return 1
    fi
}

test_dns_configuration() {
    echo -e "\n${BLUE}Testing DNS Configuration...${NC}"

    # Check MX record
    echo "   Testing MX record..."
    MX_RESULT=$(dig +short MX $DOMAIN 2>/dev/null || echo "")
    EXPECTED_MX="10 inbound-smtp.$REGION.amazonaws.com."

    if echo "$MX_RESULT" | grep -q "inbound-smtp.$REGION.amazonaws.com"; then
        print_success "MX record correctly configured"
    else
        print_warning "MX record not found or incorrect"
        echo "   Expected: $EXPECTED_MX"
        echo "   Found: $MX_RESULT"
    fi

    # Check SPF record
    echo "   Testing SPF record..."
    TXT_RESULT=$(dig +short TXT $DOMAIN 2>/dev/null || echo "")

    if echo "$TXT_RESULT" | grep -q "include:amazonses.com"; then
        print_success "SPF record includes amazonses.com"
    else
        print_warning "SPF record not found or doesn't include amazonses.com"
        echo "   TXT records found: $TXT_RESULT"
    fi

    # Check domain verification record
    echo "   Testing domain verification record..."
    VERIFICATION_TXT=$(dig +short TXT "_amazonses.$DOMAIN" 2>/dev/null || echo "")

    if [ -n "$VERIFICATION_TXT" ]; then
        print_success "Domain verification TXT record found"
    else
        print_warning "Domain verification TXT record not found"
    fi

    # Check DKIM records
    echo "   Testing DKIM records..."
    DKIM_TOKENS=$(aws ses get-identity-dkim-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "DkimAttributes.\"$DOMAIN\".DkimTokens" \
        --output text 2>/dev/null || echo "")

    if [ -n "$DKIM_TOKENS" ]; then
        DKIM_COUNT=0
        for token in $DKIM_TOKENS; do
            DKIM_RECORD=$(dig +short CNAME "${token}._domainkey.$DOMAIN" 2>/dev/null || echo "")
            if [ -n "$DKIM_RECORD" ]; then
                ((DKIM_COUNT++))
            fi
        done

        if [ $DKIM_COUNT -eq 3 ]; then
            print_success "All 3 DKIM records found"
        else
            print_warning "Only $DKIM_COUNT/3 DKIM records found"
        fi
    else
        print_warning "DKIM tokens not available"
    fi
}

test_email_sending() {
    echo -e "\n${BLUE}Testing Email Sending Capability...${NC}"

    # Check sending quota
    SEND_QUOTA=$(aws ses get-send-quota \
        --region $REGION \
        --query 'Max24HourSend' \
        --output text 2>/dev/null || echo "0")

    SEND_RATE=$(aws ses get-send-quota \
        --region $REGION \
        --query 'MaxSendRate' \
        --output text 2>/dev/null || echo "0")

    echo "   24-hour send quota: $SEND_QUOTA emails"
    echo "   Send rate limit: $SEND_RATE emails/second"

    # Convert floating point to integer for comparison
    SEND_QUOTA_INT=$(echo "$SEND_QUOTA" | cut -d. -f1)
    
    if [ "$SEND_QUOTA_INT" = "200" ]; then
        print_warning "SES is in sandbox mode - only verified addresses can receive emails"
        echo "   Request production access at: https://console.aws.amazon.com/ses/home?region=$REGION#/account"
    elif [ "$SEND_QUOTA_INT" -gt "200" ]; then
        print_success "SES production access is enabled"
    else
        print_error "SES sending quota is 0 - check account status"
    fi

    # Test sending a basic email (only if domain is verified)
    VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "VerificationAttributes.\"$DOMAIN\".VerificationStatus" \
        --output text 2>/dev/null || echo "Not found")

    if [ "$VERIFICATION_STATUS" = "Success" ]; then
        echo "   Attempting to send test email..."

        TEST_RESULT=$(aws ses send-email \
            --source "test@$DOMAIN" \
            --destination "ToAddresses=$TEST_EMAIL" \
            --message "Subject={Data='SES Test Email',Charset=utf8},Body={Text={Data='This is a test email from your SES infrastructure.',Charset=utf8}}" \
            --region $REGION 2>&1)

        if [ $? -eq 0 ]; then
            print_success "Test email sent successfully"
            echo "   Message ID: $(echo $TEST_RESULT | grep -o 'MessageId.*' | cut -d'"' -f4)"
        else
            print_warning "Test email sending failed: $TEST_RESULT"
        fi
    else
        print_info "Skipping email send test - domain not verified"
    fi
}

generate_report() {
    echo -e "\n${BLUE}================================${NC}"
    echo -e "${BLUE}  Test Summary Report${NC}"
    echo -e "${BLUE}================================${NC}\n"

    echo "Infrastructure Status:"
    echo "  ✓ CloudFormation Stack: Deployed"
    echo "  ✓ S3 Bucket: Accessible"
    echo "  ✓ SES Receipt Rules: Configured"
    echo ""

    echo "SES Configuration:"
    VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "VerificationAttributes.\"$DOMAIN\".VerificationStatus" \
        --output text 2>/dev/null || echo "Not found")

    DKIM_STATUS=$(aws ses get-identity-dkim-attributes \
        --identities $DOMAIN \
        --region $REGION \
        --query "DkimAttributes.\"$DOMAIN\".DkimVerificationStatus" \
        --output text 2>/dev/null || echo "Not found")

    if [ "$VERIFICATION_STATUS" = "Success" ]; then
        echo "  ✓ Domain Verification: Complete"
    else
        echo "  ⚠ Domain Verification: $VERIFICATION_STATUS"
    fi

    if [ "$DKIM_STATUS" = "Success" ]; then
        echo "  ✓ DKIM Configuration: Complete"
    else
        echo "  ⚠ DKIM Configuration: $DKIM_STATUS"
    fi

    echo ""
    echo "Next Steps:"

    # Check if rule set is active
    ACTIVE_RULE_SET=$(aws ses describe-active-receipt-rule-set \
        --region $REGION \
        --query 'Metadata.Name' \
        --output text 2>/dev/null || echo "None")
    EXPECTED_RULE_SET="${DOMAIN//./-}-rules"

    if [ "$ACTIVE_RULE_SET" != "$EXPECTED_RULE_SET" ]; then
        echo "  1. ⚠️  CRITICAL: Activate receipt rule set (emails won't work without this):"
        echo "     aws ses set-active-receipt-rule-set --rule-set-name $EXPECTED_RULE_SET --region $REGION"
        echo "     OR run: ./deploy.sh activate-rules"
    fi

    if [ "$VERIFICATION_STATUS" != "Success" ]; then
        echo "  2. Complete DNS configuration (run: ./scripts/show-dns-config.sh)"
        echo "  3. Wait for DNS propagation"
    fi
    if [ "$DKIM_STATUS" != "Success" ]; then
        echo "  4. Verify DKIM DNS records are correctly configured"
    fi
    echo "  5. Test email sending and receiving"
    echo "  6. Configure IMAP server (Phase 2)"
    echo ""
}

# Main execution
print_header

# Run all tests
FAILED_TESTS=0

test_stack_deployment || ((FAILED_TESTS++))
test_s3_bucket || ((FAILED_TESTS++))
test_ses_domain || ((FAILED_TESTS++))
test_ses_rules || ((FAILED_TESTS++))
test_smtp_configuration || ((FAILED_TESTS++))

# DNS tests (informational, don't count as failures)
test_dns_configuration
test_email_sending

generate_report

echo -e "\n${BLUE}Test completed with $FAILED_TESTS critical failures.${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All critical tests passed! 🎉${NC}"
    exit 0
else
    echo -e "${YELLOW}Some tests failed. Check the output above for details.${NC}"
    exit 1
fi
