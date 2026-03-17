---
name: aws-serverless
description: Specialized in AWS Serverless architecture (Lambda, API Gateway, DynamoDB, S3).
triggers:
  - lambda
  - serverless
  - dynamodb
  - api-gateway
  - sam
---
# AWS Serverless Expert

Use this skill for designing, implementing, and deploying serverless applications on AWS.

## Key Components
- **AWS Lambda:** Compute service for running code without provisioning servers.
- **Amazon API Gateway:** Create, publish, and secure APIs at scale.
- **Amazon DynamoDB:** NoSQL database for high-performance applications.
- **AWS SAM / Serverless Framework:** Infrastructure as Code (IaC) for serverless stacks.

## Best Practices
- **Cold Starts:** Minimize package size and use provisioned concurrency if needed.
- **IAM Roles:** Follow the principle of least privilege for Lambda execution roles.
- **Environment Variables:** Use for configuration, but keep secrets in AWS Secrets Manager.
- **Monitoring:** Use CloudWatch Logs and X-Ray for distributed tracing.

## Example Usage
"Use aws-serverless to design a REST API using Lambda and DynamoDB."
