# Infrastructure Audit Report — cicd-poc

**Date:** 2026-03-19  
**Scope:** `/home/tuannh/repos/cicd-poc/infrastructure/`  
**Auditor:** Kiro (automated review using CloudFormation best practices, AWS Well-Architected, CI/CD security, and FinOps skills)

---

## Executive Summary

The infrastructure is a well-structured, multi-service ECS platform with nested CloudFormation stacks, dual compute support (Fargate + EC2), API Gateway fronting an internal ALB, and a 7-stage CI/CD pipeline sourcing from Azure DevOps. Overall architecture is solid, but there are actionable findings across security, CI/CD workflow, and cost optimization.

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| Security | 2 | 5 | 6 | 3 |
| CI/CD Workflow | 0 | 3 | 4 | 2 |
| Cost Optimization | 0 | 2 | 5 | 3 |

---

## 1. SECURITY FINDINGS

### 1.1 CRITICAL — Webhook Endpoint Has No Authentication

**File:** `api-gateway.yaml` (WebhookRoute, line ~300)  
**Issue:** The `POST /webhook/{service}` route has no authorization. Anyone who discovers the URL can trigger any pipeline.  
**Risk:** Unauthorized pipeline executions, potential supply chain attack vector.  
**Recommendation:**
```yaml
# Option A: Add API Key authorization
WebhookRoute:
  Properties:
    AuthorizationType: CUSTOM  # or API_KEY
    # Add a Lambda authorizer that validates Azure DevOps webhook secret
```
```python
# Option B: Validate Azure DevOps webhook signature in Lambda
import hmac, hashlib
def verify_signature(body, signature, secret):
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### 1.2 CRITICAL — RDS Master Password in Plain Text Parameter

**File:** `rds-oracle.yaml`  
**Issue:** `MasterUserPassword` is a `NoEcho` parameter but still passed as plain text through CloudFormation. It will be visible in CloudFormation console parameter history.  
**Recommendation:** Use `ManageMasterUserPassword: true` (RDS-managed secret) or reference a Secrets Manager secret:
```yaml
OracleDBInstance:
  Properties:
    ManageMasterUserPassword: true
    # OR
    MasterUserPassword: !Sub '{{resolve:secretsmanager:${ProjectName}/${Environment}/db/master-password:SecretString:password}}'
```

### 1.3 HIGH — VPC Flow Logs Not Enabled

**File:** `vpc.yaml`  
**Issue:** No VPC Flow Logs configured. Cannot audit network traffic or detect anomalous connections.  
**Recommendation:**
```yaml
VpcFlowLog:
  Type: AWS::EC2::FlowLog
  Properties:
    ResourceId: !Ref VPC
    ResourceType: VPC
    TrafficType: ALL
    LogDestinationType: cloud-watch-logs
    LogGroupName: !Sub /vpc/${ProjectName}-${Environment}/flow-logs
    MaxAggregationInterval: 60
```

### 1.4 HIGH — ALB Access Logs Disabled

**File:** `alb.yaml`  
**Issue:** `access_logs.s3.enabled` is set to `"false"`. No audit trail for HTTP requests hitting the ALB.  
**Recommendation:** Enable access logs, at minimum for staging/prod:
```yaml
- Key: access_logs.s3.enabled
  Value: !If [IsProduction, "true", "false"]
- Key: access_logs.s3.bucket
  Value: !Sub ${ProjectName}-${Environment}-alb-logs-${AWS::AccountId}
```

### 1.5 HIGH — ALB Deletion Protection Disabled

**File:** `alb.yaml`  
**Issue:** `deletion_protection.enabled` is `"false"` for all environments including production.  
**Recommendation:**
```yaml
- Key: deletion_protection.enabled
  Value: !If [IsProduction, "true", "false"]
```

### 1.6 HIGH — Secrets Manager Secrets Have No Rotation Policy

**File:** `secrets.yaml`  
**Issue:** Both `PatSecret` and `DbSecret` have no rotation configuration. Azure DevOps PATs and DB credentials should be rotated periodically.  
**Recommendation:** Add rotation for DB secrets at minimum:
```yaml
DbSecretRotation:
  Type: AWS::SecretsManager::RotationSchedule
  Properties:
    SecretId: !Ref DbSecret
    RotationRules:
      AutomaticallyAfterDays: 90
```

### 1.7 HIGH — ECS Security Group Allows Only Port 1433 (SQL Server) but RDS is Oracle (1521)

**File:** `security-groups.yaml`  
**Issue:** ECS SG egress allows port 1433 (SQL Server) to VPC CIDR, but the database is Oracle RDS on port 1521. The ECS tasks cannot reach the Oracle database through this security group.  
**Recommendation:** Change or add Oracle port:
```yaml
- IpProtocol: tcp
  FromPort: 1521
  ToPort: 1521
  CidrIp: !Ref VpcCidr
  Description: Oracle database access within VPC
```

### 1.8 MEDIUM — IMDSv2 Not Enforced on EC2 Instances

**File:** `ecs-ec2-cluster.yaml` (LaunchTemplate)  
**Issue:** Launch template does not set `HttpTokens: required` for IMDSv2. Instances are vulnerable to SSRF-based credential theft via IMDSv1.  
**Recommendation:**
```yaml
LaunchTemplateData:
  MetadataOptions:
    HttpTokens: required
    HttpPutResponseHopLimit: 2
    HttpEndpoint: enabled
```

### 1.9 MEDIUM — KMS Decrypt Permission Too Broad

**File:** `iam.yaml` (EcsExecutionRolePolicy)  
**Issue:** KMS Decrypt allows `arn:aws:kms:${AWS::Region}:${AWS::AccountId}:key/*` — all KMS keys in the account.  
**Recommendation:** Restrict to specific key alias or ID used for Secrets Manager encryption.

### 1.10 MEDIUM — CodeBuild PrivilegedMode Enabled

**File:** `codebuild.yaml` (BuildProject, PushProject)  
**Issue:** `PrivilegedMode: true` gives Docker-in-Docker capability. While needed for Docker builds, it increases attack surface.  
**Recommendation:** Only enable on projects that actually build Docker images. The SourceProject, SwaggerGenProject, LintProject, and ContractTestProject should NOT have privileged mode.

### 1.11 MEDIUM — No WAF on API Gateway

**File:** `api-gateway.yaml`  
**Issue:** HTTP API Gateway has no AWS WAF integration. Exposed to common web attacks (SQL injection, XSS, bot traffic).  
**Recommendation:** For production, attach a WAF WebACL with AWS managed rule groups:
- AWSManagedRulesCommonRuleSet
- AWSManagedRulesKnownBadInputsRuleSet
- AWSManagedRulesSQLiRuleSet

### 1.12 MEDIUM — CORS AllowOrigins Defaults to Wildcard

**File:** `api-gateway.yaml`  
**Issue:** `CorsAllowOrigins` defaults to `"*"`. In production, this should be restricted to known frontend domains.  
**Recommendation:** Set environment-specific CORS origins.

### 1.13 MEDIUM — SNS Topic Encryption Uses AWS-Managed Key

**File:** `monitoring.yaml`  
**Issue:** `KmsMasterKeyId: alias/aws/sns` is fine for most cases, but consider CMK for compliance-sensitive environments.  
**Severity:** Low risk, noted for compliance awareness.

### 1.14 LOW — No DeletionPolicy on Secrets Manager Secrets

**File:** `secrets.yaml`  
**Issue:** Deleting the stack will permanently delete secrets. Add `DeletionPolicy: Retain` for production.

### 1.15 LOW — Legacy Windows EC2 Has No Patching Strategy

**File:** `legacy-windows-ec2.yaml`  
**Issue:** SSM Managed Instance Core is attached but no SSM Patch Manager baseline or maintenance window is configured.

### 1.16 LOW — No GuardDuty or Security Hub Integration

**Issue:** No mention of GuardDuty, Security Hub, or Config rules. Consider enabling for threat detection and compliance posture.

---

## 2. CI/CD WORKFLOW FINDINGS

### 2.1 HIGH — Pipeline Has No Manual Approval Gate Before Production Deploy

**File:** `codepipeline.yaml`  
**Issue:** The pipeline goes directly from Push → Deploy → ContractTest with no approval gate. Any code that passes build goes straight to ECS.  
**Recommendation:** Add a manual approval action before Deploy for staging/prod:
```yaml
- Name: Approval
  Actions:
    - Name: ManualApproval
      ActionTypeId:
        Category: Approval
        Owner: AWS
        Provider: Manual
        Version: "1"
      Configuration:
        NotificationArn: !Ref NotificationTopicArn
        CustomData: "Approve deployment of ${ServiceName} to ${Environment}"
```

### 2.2 HIGH — Contract Tests Run AFTER Deployment

**File:** `codepipeline.yaml`  
**Issue:** The ContractTest stage runs after Deploy. If contracts are broken, the broken version is already live. Contract tests should run before deployment or in a staging environment.  
**Recommendation:** Move ContractTest before Deploy, or add a rollback mechanism if contract tests fail post-deploy.

### 2.3 HIGH — No SAST/DAST Security Scanning in Pipeline

**File:** `codebuild.yaml`  
**Issue:** Pipeline has Source → SwaggerGen → Lint → Build → Push → Deploy → ContractTest but no security scanning stage. No container image vulnerability scanning beyond ECR's scan-on-push.  
**Recommendation:** Add a security scan stage:
```yaml
# Add between Build and Push stages
- Name: SecurityScan
  Actions:
    - Name: ContainerScan
      # Use Trivy, Snyk, or AWS Inspector for container scanning
```

### 2.4 MEDIUM — S3 Source with PollForSourceChanges: false but No EventBridge Trigger

**File:** `codepipeline.yaml`  
**Issue:** Pipeline source is S3 with `PollForSourceChanges: false`, relying on the webhook Lambda to upload `trigger/trigger.zip`. If the webhook fails silently, no pipeline runs. There's no dead-letter queue or retry mechanism.  
**Recommendation:** Add CloudWatch alarm on webhook Lambda errors and consider S3 EventBridge notification as backup trigger.

### 2.5 MEDIUM — Docker Image Built Twice (Build + Push Stages)

**File:** `buildspec-build.yml`, `buildspec-push.yml`  
**Issue:** The Build stage builds the Docker image, then the Push stage rebuilds it from source again (not from cached layers). This doubles build time and risks non-reproducible builds.  
**Recommendation:** Either:
1. Save the Docker image as a tar artifact from Build stage and load it in Push stage
2. Merge Build and Push into a single stage

### 2.6 MEDIUM — No Build Cache Strategy for Docker

**File:** `buildspec-build.yml`  
**Issue:** No Docker layer caching configured. Each build starts from scratch.  
**Recommendation:** Enable CodeBuild Docker layer caching:
```yaml
BuildProject:
  Properties:
    Cache:
      Type: LOCAL
      Modes:
        - LOCAL_DOCKER_LAYER_CACHE
```

### 2.7 MEDIUM — Pipeline Webhook Uses UNAUTHENTICATED Mode

**File:** `monitoring.yaml` (PipelineWebhook)  
**Issue:** `Authentication: UNAUTHENTICATED` on the CodePipeline webhook. Combined with finding 1.1, this is a double exposure.  
**Recommendation:** Use IP filtering or secret token validation.

### 2.8 LOW — No Pipeline Execution History Retention Policy

**Issue:** No configuration for how long pipeline execution history is retained. Old executions accumulate indefinitely.

### 2.9 LOW — BuildSpec Hardcodes dotnet 10.0 Runtime

**File:** `buildspec-swagger-gen.yml`  
**Issue:** `dotnet: 10.0` is hardcoded. If projects use different .NET versions, this will fail.  
**Recommendation:** Make runtime version configurable via CodeBuild environment variable.

---

## 3. COST OPTIMIZATION FINDINGS

### 3.1 HIGH — Dual NAT Gateways in Dev Environment

**File:** `vpc.yaml`  
**Issue:** Two NAT Gateways are deployed in all environments including dev. Each NAT Gateway costs ~$32/month + data processing charges. For dev, a single NAT Gateway is sufficient.  
**Estimated Savings:** ~$32/month per dev environment  
**Recommendation:**
```yaml
Conditions:
  UseHighAvailability: !Or [!Equals [!Ref Environment, prod], !Equals [!Ref Environment, staging]]

NatGateway2:
  Type: AWS::EC2::NatGateway
  Condition: UseHighAvailability
```

### 3.2 HIGH — EC2 Desired Capacity of 2 in Dev

**File:** `main-ec2.yaml`  
**Issue:** `Ec2DesiredCapacity` defaults to 2 for all environments. In dev, 1 instance is sufficient.  
**Estimated Savings:** ~$30/month (t3.medium) per dev environment  
**Recommendation:** Use condition-based defaults or set dev desired capacity to 1.

### 3.3 MEDIUM — No S3 Intelligent-Tiering on Artifact Buckets

**File:** `codepipeline.yaml`  
**Issue:** Artifact bucket has lifecycle rules (30-day expiry) but no Intelligent-Tiering for objects that may be accessed infrequently before expiry.  
**Recommendation:** Add Intelligent-Tiering for artifacts older than 7 days.

### 3.4 MEDIUM — ECR Lifecycle Keeps Only 10 Images

**File:** `ecr.yaml`  
**Issue:** Only 10 images retained. This is aggressive — if you need to rollback beyond 10 deployments, images are gone.  
**Recommendation:** Keep at least 30 images or use tag-based rules (keep all tagged images, expire untagged after 7 days).

### 3.5 MEDIUM — CloudWatch Log Retention Not Environment-Aware for CodeBuild

**File:** `codebuild.yaml`  
**Issue:** All CodeBuild log groups use 30-day retention regardless of environment. Dev logs could use 7 days.  
**Estimated Savings:** Minimal but good hygiene.  
**Recommendation:**
```yaml
RetentionInDays: !If [IsProduction, 90, !If [IsStaging, 30, 7]]
```

### 3.6 MEDIUM — API Gateway Log Retention Fixed at 90 Days

**File:** `api-gateway.yaml`  
**Issue:** `RetentionInDays: 90` for all environments. Dev/staging don't need 90 days.  
**Recommendation:** Use environment-based retention (dev: 14, staging: 30, prod: 90).

### 3.7 MEDIUM — No Fargate Spot Usage Analysis

**File:** `ecs-cluster.yaml`  
**Issue:** Fargate Spot weight is 4x vs Fargate weight 1x, which is good for cost savings. However, there's no alarm or metric tracking Spot interruptions. If Spot capacity is unavailable, services may not scale.  
**Recommendation:** Add CloudWatch alarm for Fargate Spot interruption events.

### 3.8 LOW — Container Insights Enabled in Dev

**File:** `ecs-cluster.yaml`, `ecs-ec2-cluster.yaml`  
**Issue:** Container Insights is enabled by default for all environments. It adds ~$3.50/month per task for custom metrics.  
**Recommendation:** Disable in dev unless actively debugging:
```yaml
ContainerInsightsEnabled:
  Default: !If [IsDevelopment, disabled, enabled]
```

### 3.9 LOW — No Reserved Instance or Savings Plan Guidance

**Issue:** EC2 instances use on-demand pricing. For staging/prod with predictable workloads, consider Compute Savings Plans (up to 66% savings).

### 3.10 LOW — RDS Instance Type Not Environment-Aware

**File:** `rds-oracle.yaml`  
**Issue:** `db.t3.medium` default for all environments. Dev could use `db.t3.small` (if available for Oracle SE2).  
**Recommendation:** Add environment-based mappings for instance types.

---

## 4. ARCHITECTURE & BEST PRACTICES

### 4.1 GOOD — Nested Stack Architecture
Well-organized separation of concerns: VPC, SGs, IAM, ALB, API GW, ECS, Monitoring as independent stacks.

### 4.2 GOOD — Consistent Tagging Strategy
All resources tagged with Environment, Project, ComputeType. Enables cost allocation and resource management.

### 4.3 GOOD — Deployment Circuit Breaker
ECS services have `DeploymentCircuitBreaker` with rollback enabled. Failed deployments auto-rollback.

### 4.4 GOOD — ECR Scan on Push
Image vulnerability scanning enabled on all ECR repositories.

### 4.5 GOOD — S3 Artifact Bucket Security
Public access blocked, versioning enabled, encryption enabled, lifecycle rules configured.

### 4.6 GOOD — Internal ALB Pattern
ALB is internal-only, fronted by API Gateway with VPC Link. No direct internet exposure.

### 4.7 GOOD — ECS Exec Enabled (EC2 variant)
`EnableExecuteCommand: true` on EC2 ECS service for debugging. Consider disabling in prod.

---

## 5. PRIORITIZED ACTION ITEMS

| Priority | Finding | Effort | Impact |
|---|---|---|---|
| P0 | 1.1 Add webhook authentication | Medium | Prevents unauthorized pipeline triggers |
| P0 | 1.2 Fix RDS password management | Low | Eliminates plaintext credential exposure |
| P0 | 1.7 Fix ECS SG port mismatch (1433→1521) | Low | ECS tasks can't reach Oracle DB currently |
| P1 | 1.3 Enable VPC Flow Logs | Low | Network audit trail |
| P1 | 1.8 Enforce IMDSv2 | Low | Prevents SSRF credential theft |
| P1 | 2.1 Add approval gate before prod deploy | Low | Prevents accidental production deployments |
| P1 | 2.3 Add security scanning stage | Medium | Supply chain security |
| P1 | 3.1 Single NAT Gateway for dev | Low | ~$32/month savings per dev env |
| P2 | 1.4 Enable ALB access logs | Low | HTTP audit trail |
| P2 | 1.5 Enable ALB deletion protection (prod) | Low | Prevents accidental deletion |
| P2 | 2.2 Move contract tests before deploy | Medium | Catch API breaks before they're live |
| P2 | 2.5 Eliminate double Docker build | Medium | Halves build time |
| P2 | 3.2 Reduce EC2 desired capacity in dev | Low | ~$30/month savings |
| P3 | Remaining medium/low findings | Various | Incremental improvements |

---

## 6. TEMPLATE VALIDATION NOTES

All templates follow valid CloudFormation syntax with proper use of:
- `!Sub`, `!Ref`, `!GetAtt` intrinsic functions
- Conditions for environment-specific behavior
- Cross-stack references via `Fn::ImportValue`
- Parameter constraints with `AllowedValues`, `AllowedPattern`, `MinLength`, `MaxLength`

The existing property-based test suite (`infrastructure/tests/`) covers IAM policies, security groups, task definitions, cost allocation tagging, and template parameterization — a strong foundation for infrastructure correctness validation.
