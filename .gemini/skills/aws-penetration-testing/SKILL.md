---
name: aws-penetration-testing
description: Ethical hacking and security assessment for AWS environments.
triggers:
  - pen-test
  - vulnerability-scan
  - aws-security-audit
---
# AWS Penetration Testing

Guided security assessment focusing on cloud-specific vulnerabilities.

## Focus Areas
- **IAM Misconfigurations:** Searching for overly permissive roles or exposed keys.
- **Network Security:** Testing Security Groups, NACLs, and Public Endpoints.
- **Data Exposure:** Checking for public S3 buckets or unencrypted databases.
- **Compute Security:** Scanning for vulnerabilities in ECS/EC2 instances.

## Tools & Patterns
- Check for IMDSv1 vs IMDSv2.
- Scan for hardcoded secrets in UserData or Environment Variables.
- Validate VPC Link and Private Link isolation.
