import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class EmailStorageStack extends cdk.Stack {
    public readonly emailBucket: s3.Bucket;
    public readonly emailMetadataTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const domainName = 'pfeiffer.rocks';

        // S3 Bucket for email storage
        this.emailBucket = new s3.Bucket(this, 'EmailStorageBucket', {
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
        this.emailMetadataTable = new dynamodb.Table(this, 'EmailMetadataTable', {
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
        this.emailMetadataTable.addGlobalSecondaryIndex({
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
        this.emailMetadataTable.addGlobalSecondaryIndex({
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

        // Outputs
        new cdk.CfnOutput(this, 'EmailBucketName', {
            value: this.emailBucket.bucketName,
            description: 'S3 bucket name for email storage',
            exportName: `EmailBucket-${domainName.replace('.', '-')}`
        });

        new cdk.CfnOutput(this, 'EmailMetadataTableName', {
            value: this.emailMetadataTable.tableName,
            description: 'DynamoDB table name for email metadata',
            exportName: `EmailTable-${domainName.replace('.', '-')}`
        });
    }
}
