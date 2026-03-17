---
name: deploy-on-aws
description: Guided workflow to deploy any application on AWS. Scans codebase, recommends architecture, and generates IaC.
triggers:
  - deploy-aws
  - aws-infra-gen
  - recommend-architecture
---
# Deploy on AWS Expert

Use this skill to accelerate the deployment of any application to AWS.

## Workflow
1. **Discovery:** Scan the project structure, languages, and dependencies.
2. **Recommendation:** Propose the best AWS services (e.g., App Runner, ECS, Lambda).
3. **Estimation:** Provide rough cost estimates for the proposed architecture.
4. **Implementation:** Generate CDK or CloudFormation templates.

## Best Practices
- Prefer Serverless (Fargate/Lambda) for new projects.
- Always include monitoring (CloudWatch) and security (IAM) in the generated templates.
- Use environment-specific parameters.
