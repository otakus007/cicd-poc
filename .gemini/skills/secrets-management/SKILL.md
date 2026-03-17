---
name: secrets-management
description: Secure handling of sensitive data (API keys, passwords, PATs) using AWS Secrets Manager.
triggers:
  - secret-safety
  - rotation
  - secrets-manager
---
# Secrets Management Expert

Standardized patterns for storing and retrieving secrets.

## Core Practices
- **No Inlining:** Never put secrets in CloudFormation templates or source code.
- **Automatic Rotation:** Implement Lambda-based rotation for database credentials.
- **Environment Isolation:** Use different secrets for dev, staging, and prod.
- **Access Control:** Use Resource-based policies to restrict secret access to specific roles.

## Integration
- Inject secrets into ECS tasks via `secrets` field in Task Definition.
- Use KMS CMK for encrypting highly sensitive secrets.
