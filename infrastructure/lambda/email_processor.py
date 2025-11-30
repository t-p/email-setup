import json
import boto3
import email
import hashlib
import logging
import os
import re
from datetime import datetime
from email.utils import parseaddr, parsedate_to_datetime
from urllib.parse import unquote_plus
from typing import Dict, List, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
ses = boto3.client('ses')

# Environment variables
BUCKET_NAME = os.environ.get('BUCKET_NAME')
TABLE_NAME = os.environ.get('TABLE_NAME')
DOMAIN_NAME = os.environ.get('DOMAIN_NAME')

# Initialize DynamoDB table
table = dynamodb.Table(TABLE_NAME)

# Email forwarding rules - loaded from environment variable
# Format: JSON array of objects with 'pattern' and 'forward_to' keys
# Example: [{"pattern": "^user@domain\\.com$", "forward_to": "forward@example.com"}]
FORWARDING_RULES_JSON = os.environ.get('FORWARDING_RULES', '[]')
try:
    FORWARDING_RULES = json.loads(FORWARDING_RULES_JSON)
except json.JSONDecodeError:
    logger.warning("Invalid FORWARDING_RULES JSON, using empty rules")
    FORWARDING_RULES = []

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for processing incoming emails from SES or S3.

    Args:
        event: Lambda event containing SES or S3 notification
        context: Lambda context object

    Returns:
        Response dictionary with status code and message
    """
    logger.info(f"Received event: {json.dumps(event, default=str)}")

    try:
        processed_count = 0

        for record in event.get('Records', []):
            if 'ses' in record:
                process_ses_email(record['ses'])
                processed_count += 1
            elif 's3' in record:
                process_s3_email(record['s3'])
                processed_count += 1
            else:
                logger.warning(f"Unknown record type: {record}")

        logger.info(f"Successfully processed {processed_count} email(s)")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'Successfully processed {processed_count} email(s)',
                'processed_count': processed_count
            })
        }

    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Failed to process emails'
            })
        }

def process_ses_email(ses_mail: Dict[str, Any]) -> None:
    """
    Process email received via SES notification.

    Args:
        ses_mail: SES mail object from the event
    """
    try:
        message_id = ses_mail['mail']['messageId']
        timestamp = ses_mail['mail']['timestamp']
        source = ses_mail['mail']['source']
        destinations = ses_mail['mail']['destination']

        logger.info(f"Processing SES email: {message_id}")

        # Get the S3 object key from SES
        s3_key = f"incoming/{message_id}"

        # Download and parse the email
        email_obj = download_and_parse_email(BUCKET_NAME, s3_key)

        if email_obj:
            # Process and store the email
            process_email(email_obj, message_id, timestamp, source, destinations)
        else:
            logger.error(f"Failed to download or parse email: {message_id}")

    except Exception as e:
        logger.error(f"Error processing SES email: {str(e)}", exc_info=True)
        raise

def process_s3_email(s3_event: Dict[str, Any]) -> None:
    """
    Process email uploaded directly to S3.

    Args:
        s3_event: S3 event object from the notification
    """
    try:
        bucket = s3_event['bucket']['name']
        key = unquote_plus(s3_event['object']['key'])

        logger.info(f"Processing S3 email: {key}")

        if key.startswith('incoming/'):
            email_obj = download_and_parse_email(bucket, key)
            if email_obj:
                message_id = key.replace('incoming/', '').replace('.eml', '')
                timestamp = datetime.utcnow().isoformat() + 'Z'
                source = email_obj.get('From', 'unknown')
                destinations = [email_obj.get('To', 'unknown')]

                process_email(email_obj, message_id, timestamp, source, destinations)
            else:
                logger.error(f"Failed to download or parse email: {key}")
        else:
            logger.info(f"Ignoring S3 object not in incoming/: {key}")

    except Exception as e:
        logger.error(f"Error processing S3 email: {str(e)}", exc_info=True)
        raise

def download_and_parse_email(bucket: str, key: str) -> Optional[email.message.EmailMessage]:
    """
    Download email from S3 and parse it.

    Args:
        bucket: S3 bucket name
        key: S3 object key

    Returns:
        Parsed email object or None if failed
    """
    try:
        logger.info(f"Downloading email from s3://{bucket}/{key}")
        response = s3.get_object(Bucket=bucket, Key=key)
        email_content = response['Body'].read()

        # Parse the email
        email_obj = email.message_from_bytes(email_content)
        logger.info(f"Successfully parsed email with subject: {email_obj.get('Subject', 'No Subject')}")
        return email_obj

    except Exception as e:
        logger.error(f"Error downloading email from S3: {str(e)}", exc_info=True)
        return None

def process_email(email_obj: email.message.EmailMessage, message_id: str,
                  timestamp: str, source: str, destinations: List[str]) -> None:
    """
    Process and store email metadata and content.

    Args:
        email_obj: Parsed email object
        message_id: Unique message identifier
        timestamp: Email timestamp
        source: Email source address
        destinations: List of destination addresses
    """
    try:
        logger.info(f"Processing email {message_id}")

        # Extract email metadata
        subject = email_obj.get('Subject', '')
        from_addr = email_obj.get('From', source)
        to_addr = email_obj.get('To', ', '.join(destinations))
        date_header = email_obj.get('Date', '')
        reply_to = email_obj.get('Reply-To', '')
        cc_addr = email_obj.get('Cc', '')
        bcc_addr = email_obj.get('Bcc', '')

        # Parse sender and recipient
        sender_name, sender_email = parseaddr(from_addr)
        recipient_name, recipient_email = parseaddr(to_addr)

        # Parse date from header if available, otherwise use timestamp
        try:
            if date_header:
                email_date = parsedate_to_datetime(date_header)
                timestamp = email_date.isoformat()
        except (ValueError, TypeError):
            logger.warning(f"Could not parse date header: {date_header}")

        # Generate date for partitioning
        if timestamp.endswith('Z'):
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            dt = datetime.fromisoformat(timestamp)
        date_str = dt.strftime('%Y-%m-%d')

        # Get email body content
        body_text = extract_text_content(email_obj)
        body_html = extract_html_content(email_obj)
        attachments = extract_attachments_info(email_obj)

        # Calculate email size
        email_bytes = email_obj.as_bytes()
        email_size = len(email_bytes)

        # Store processed email in S3
        processed_key = f"processed/{date_str}/{message_id}.eml"
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=processed_key,
            Body=email_bytes,
            ContentType='message/rfc822',
            Metadata={
                'messageId': message_id,
                'subject': subject[:1000],  # Limit metadata size
                'from': from_addr[:1000],
                'to': to_addr[:1000],
                'date': date_str
            }
        )

        # Store metadata in DynamoDB
        metadata_item = {
            'messageId': message_id,
            'timestamp': timestamp,
            'date': date_str,
            'subject': subject,
            'from': from_addr,
            'to': to_addr,
            'cc': cc_addr,
            'bcc': bcc_addr,
            'reply_to': reply_to,
            'sender_email': sender_email,
            'recipient_email': recipient_email,
            'recipient': recipient_email,  # For GSI
            's3_key': processed_key,
            'size': email_size,
            'has_attachments': len(attachments) > 0,
            'attachment_count': len(attachments),
            'attachments': attachments,
            'body_text_preview': body_text[:500] if body_text else '',
            'body_html_preview': body_html[:500] if body_html else '',
            'processed_at': datetime.utcnow().isoformat() + 'Z',
            'domain': DOMAIN_NAME
        }

        # Remove empty values to save space
        metadata_item = {k: v for k, v in metadata_item.items() if v}

        table.put_item(Item=metadata_item)

        # Create manifest entry for IMAP sync
        create_manifest_entry(date_str, message_id, metadata_item)

        # Check forwarding rules and forward if matched
        forward_email_if_matched(email_obj, recipient_email)

        logger.info(f"Successfully processed email {message_id} ({email_size} bytes)")

    except Exception as e:
        logger.error(f"Error processing email {message_id}: {str(e)}", exc_info=True)
        raise

def extract_text_content(email_obj: email.message.EmailMessage) -> str:
    """Extract plain text content from email."""
    try:
        if email_obj.is_multipart():
            for part in email_obj.walk():
                if part.get_content_type() == 'text/plain':
                    payload = part.get_payload(decode=True)
                    if payload:
                        return payload.decode('utf-8', errors='ignore')
        else:
            if email_obj.get_content_type() == 'text/plain':
                payload = email_obj.get_payload(decode=True)
                if payload:
                    return payload.decode('utf-8', errors='ignore')
        return ''
    except Exception as e:
        logger.warning(f"Error extracting text content: {str(e)}")
        return ''

def extract_html_content(email_obj: email.message.EmailMessage) -> str:
    """Extract HTML content from email."""
    try:
        if email_obj.is_multipart():
            for part in email_obj.walk():
                if part.get_content_type() == 'text/html':
                    payload = part.get_payload(decode=True)
                    if payload:
                        return payload.decode('utf-8', errors='ignore')
        else:
            if email_obj.get_content_type() == 'text/html':
                payload = email_obj.get_payload(decode=True)
                if payload:
                    return payload.decode('utf-8', errors='ignore')
        return ''
    except Exception as e:
        logger.warning(f"Error extracting HTML content: {str(e)}")
        return ''

def extract_attachments_info(email_obj: email.message.EmailMessage) -> List[Dict[str, Any]]:
    """Extract attachment information from email."""
    attachments = []
    try:
        if email_obj.is_multipart():
            for part in email_obj.walk():
                if part.get_content_disposition() == 'attachment':
                    filename = part.get_filename()
                    if filename:
                        attachments.append({
                            'filename': filename,
                            'content_type': part.get_content_type(),
                            'size': len(part.get_payload(decode=True) or b'')
                        })
    except Exception as e:
        logger.warning(f"Error extracting attachment info: {str(e)}")

    return attachments

def create_manifest_entry(date_str: str, message_id: str, metadata: Dict[str, Any]) -> None:
    """
    Create manifest file for efficient IMAP syncing.

    Args:
        date_str: Date string in YYYY-MM-DD format
        message_id: Email message ID
        metadata: Email metadata dictionary
    """
    try:
        year, month, day = date_str.split('-')
        manifest_key = f"manifest/{year}/{month}/{day}/manifest.json"

        logger.info(f"Creating manifest entry for {date_str}")

        # Try to get existing manifest
        try:
            response = s3.get_object(Bucket=BUCKET_NAME, Key=manifest_key)
            manifest = json.loads(response['Body'].read())
        except s3.exceptions.NoSuchKey:
            manifest = {'emails': [], 'last_updated': '', 'date': date_str}
        except Exception as e:
            logger.warning(f"Error reading existing manifest: {str(e)}")
            manifest = {'emails': [], 'last_updated': '', 'date': date_str}

        # Add new email to manifest (avoid duplicates)
        email_entry = {
            'messageId': message_id,
            'timestamp': metadata['timestamp'],
            's3_key': metadata['s3_key'],
            'subject': metadata.get('subject', ''),
            'from': metadata.get('from', ''),
            'to': metadata.get('to', ''),
            'size': metadata.get('size', 0),
            'has_attachments': metadata.get('has_attachments', False)
        }

        # Remove existing entry with same messageId if present
        manifest['emails'] = [e for e in manifest['emails'] if e.get('messageId') != message_id]

        # Add new entry
        manifest['emails'].append(email_entry)
        manifest['last_updated'] = datetime.utcnow().isoformat() + 'Z'
        manifest['email_count'] = len(manifest['emails'])

        # Sort emails by timestamp (newest first)
        manifest['emails'].sort(key=lambda x: x.get('timestamp', ''), reverse=True)

        # Upload updated manifest
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=manifest_key,
            Body=json.dumps(manifest, indent=2, default=str),
            ContentType='application/json',
            Metadata={
                'date': date_str,
                'email_count': str(len(manifest['emails'])),
                'last_updated': manifest['last_updated']
            }
        )

        logger.info(f"Updated manifest for {date_str} with {len(manifest['emails'])} emails")

    except Exception as e:
        logger.error(f"Error creating manifest entry: {str(e)}", exc_info=True)
        # Don't raise - manifest is not critical for email processing


def forward_email_if_matched(email_obj: email.message.EmailMessage, recipient: str) -> None:
    """
    Check if email matches forwarding rules and forward if matched.

    Args:
        email_obj: Parsed email object
        recipient: Email recipient address
    """
    try:
        # Check each forwarding rule
        for rule in FORWARDING_RULES:
            if re.match(rule['pattern'], recipient, re.IGNORECASE):
                forward_to = rule['forward_to']
                logger.info(f"Forwarding email to {recipient} → {forward_to}")
                
                try:
                    # Send raw email via SES
                    ses.send_raw_email(
                        Source=recipient,  # Use original recipient as source
                        Destinations=[forward_to],
                        RawMessage={'Data': email_obj.as_bytes()}
                    )
                    logger.info(f"Successfully forwarded email to {forward_to}")
                except Exception as e:
                    logger.error(f"Failed to forward email to {forward_to}: {str(e)}")
                    # Don't raise - forwarding failure shouldn't stop email processing
                
                # Only forward to first matching rule
                break
    
    except Exception as e:
        logger.error(f"Error in forward_email_if_matched: {str(e)}", exc_info=True)
        # Don't raise - forwarding is optional
