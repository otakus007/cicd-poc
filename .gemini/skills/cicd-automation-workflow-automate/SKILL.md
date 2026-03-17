---
name: cicd-automation-workflow-automate
description: Designing and implementing high-efficiency CI/CD pipelines with AWS CodePipeline.
triggers:
  - pipeline-automate
  - workflow-optimization
  - automated-deploy
---
# CI/CD Automation Expert

Optimize your software delivery lifecycle.

## Pipeline Patterns
- **Source Seeding:** Using S3 triggers for cross-account or complex source actions.
- **Governance Gates:** Integrating automated linting and security scans.
- **Post-Deploy Testing:** Running contract tests (Dredd) and smoke tests.
- **Parallelization:** Running independent stages concurrently to reduce cycle time.

## Optimization
- Use small, specialized CodeBuild environments.
- Cache dependencies (npm, NuGet) between builds.
- Implement automated rollbacks on failure.
