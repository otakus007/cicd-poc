---
name: aws-iam-best-practices
description: Implementation of the Principle of Least Privilege across AWS IAM.
triggers:
  - iam-security
  - least-privilege
  - iam-audit
---
# AWS IAM Best Practices

Expert guidance on securing AWS access and identity.

## Principles
- **Least Privilege:** Grant only the permissions required to perform a task.
- **Role-based Access:** Use IAM Roles instead of IAM Users wherever possible.
- **Conditions:** Use IAM Conditions (e.g., `aws:SourceVpc`) to restrict access.
- **MFA:** Enforce Multi-Factor Authentication for all sensitive operations.

## Checklist
- No root user access keys.
- No wildcard `*` permissions on sensitive actions.
- Use `iam:PassRole` with strict resource constraints.
- Enable IAM Access Analyzer.
