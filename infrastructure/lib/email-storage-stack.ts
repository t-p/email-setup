import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class EmailStorageStack extends cdk.Stack {
    public readonly emailBucket: s3.Bucket;

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

        // Outputs
        new cdk.CfnOutput(this, 'EmailBucketName', {
            value: this.emailBucket.bucketName,
            description: 'S3 bucket name for email storage',
            exportName: `EmailBucket-${domainName.replace('.', '-')}`
        });
    }
}
