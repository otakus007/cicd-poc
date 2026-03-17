---
name: aws-cost-optimizer
description: Analyze AWS resources and provide specific recommendations to reduce monthly billing.
triggers:
  - cost-optimize
  - billing-analysis
  - reduce-aws-bill
---
# AWS Cost Optimizer

Specialized in identifying waste and recommending cost-saving strategies on AWS.

## Focus Areas
- **Right-sizing:** Identifying over-provisioned instances (EC2, RDS).
- **Idle Resources:** Finding unattached EIPs, orphaned EBS volumes, and idle Load Balancers.
- **Commitment Models:** Recommending Savings Plans and Reserved Instances.
- **Spot Instances:** Identifying workloads suitable for EC2 Spot or Fargate Spot.

## Best Practices
- Use AWS Compute Optimizer for data-driven right-sizing.
- Implement S3 Intelligent-Tiering for unpredictable access patterns.
- Delete snapshots older than 90 days unless required for compliance.
