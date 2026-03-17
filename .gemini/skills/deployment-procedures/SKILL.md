---
name: deployment-procedures
description: Protocols for safe, repeatable, and automated deployments.
triggers:
  - deploy
  - rollout
  - release
  - pipeline
  - blue-green
---
# Deployment Procedures

Use this skill to plan and execute deployments with minimal downtime and risk.

## Deployment Strategies
- **Blue-Green:** Routing traffic between two identical environments.
- **Canary:** Gradual rollout to a small subset of users.
- **Rolling Update:** Updating instances one by one in a cluster.

## Pre-Deployment Steps
- **CI/CD Pipeline:** Ensure all tests pass and artifacts are built.
- **Database Migrations:** Run and verify migrations before code deployment.
- **Backup:** Take snapshots of critical data.

## Post-Deployment Steps
- **Health Checks:** Verify service availability.
- **Rollback Plan:** Have a clear path to revert if issues arise.

## Example Usage
"Use deployment-procedures to create a release plan for the upcoming v2.0 launch."
