---
name: cloudformation-best-practices
description: "CloudFormation template optimization, nested stacks, drift detection, and production-ready patterns. Use when writing or reviewing CF templates."
triggers:
  - cloudformation
  - aws-infra
  - stack
  - yaml
---
# CloudFormation Best Practices Skill

## Purpose
Expert guidance for AWS CloudFormation template optimization, stack architecture, and production-grade infrastructure deployment.

## When to Activate
- Writing or reviewing CloudFormation templates (YAML/JSON)
- Optimizing existing templates for maintainability and cost
- Designing nested or cross-stack architectures
- Troubleshooting stack creation/update failures and drift

## Workflow
1. Use YAML over JSON for readability.
2. Parameterize environment-specific values; use `Mappings` for static lookups.
3. Apply `DeletionPolicy: Retain` on stateful resources (RDS, S3, DynamoDB).
4. Use `Conditions` to support multi-environment templates.
5. Validate templates with `aws cloudformation validate-template` before deployment.
6. Prefer `!Sub` over `!Join` for string interpolation.

## Best Practices
- ✅ **Do:** Use `Outputs` with `Export` for cross-stack references
- ✅ **Do:** Add `DeletionPolicy` and `UpdateReplacePolicy` on stateful resources
- ✅ **Do:** Use `cfn-lint` and `cfn-nag` in CI pipelines
- ❌ **Don't:** Hardcode ARNs or account IDs — use `!Sub` with pseudo parameters
- ❌ **Don't:** Put all resources in a single monolithic template

## Troubleshooting
**Problem:** Stack stuck in `UPDATE_ROLLBACK_FAILED`
**Solution:** Use `continue-update-rollback` with `--resources-to-skip` for the failing resource, then fix the root cause.
