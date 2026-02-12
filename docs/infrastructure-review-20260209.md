# Infrastructure & CI/CD Pipeline Review

**Date:** 2026-02-09
**Reviewer:** Claude Code
**Scope:** AWS Infrastructure Deployment Scripts & CloudFormation Templates

---

## Executive Summary

The infrastructure follows a well-designed two-tier deployment model with shared infrastructure and per-project resources. The codebase is production-ready with several improvements recommended.

| Priority | Count |
|----------|-------|
| 🔴 Critical | 4 |
| 🟡 Medium | 6 |
| 🟢 Low | 5 |

---

## Changes Required

### 🔴 Critical Priority

#### 1. Stack Update Command Executed Twice on Failure

**File:** `scripts/lib/stack-operations.sh`
**Lines:** 82-101

**Current Code:**
```bash
if ! aws cloudformation update-stack \
    --stack-name "$stack_name" \
    --template-url "$template_url" \
    --parameters "${parameters[@]}" \
    --capabilities "$capabilities" \
    --tags "${tags[@]}" \
    $AWS_CLI_OPTS 2>&1; then

    local error_msg=$(aws cloudformation update-stack \
        --stack-name "$stack_name" \
        --template-url "$template_url" \
        --parameters "${parameters[@]}" \
        --capabilities "$capabilities" \
        $AWS_CLI_OPTS 2>&1 || true)

    if [[ "$error_msg" == *"No updates are to be performed"* ]]; then
        print_warning "No updates are to be performed"
        return 0
    fi
fi
```

**Problem:** The `update-stack` command is executed twice when it fails - once in the `if` condition and again to capture the error message. This is wasteful and could cause race conditions.

**Proposed Change:**
```bash
local update_output
update_output=$(aws cloudformation update-stack \
    --stack-name "$stack_name" \
    --template-url "$template_url" \
    --parameters "${parameters[@]}" \
    --capabilities "$capabilities" \
    --tags "${tags[@]}" \
    $AWS_CLI_OPTS 2>&1) || {
    if [[ "$update_output" == *"No updates are to be performed"* ]]; then
        print_warning "No updates are to be performed"
        return 0
    fi
    print_error "Stack update failed: $update_output"
    return 1
}
```

---

#### 2. IAM Policies Too Restrictive for Per-Project Resources (BLOCKING)

**File:** `infrastructure/iam.yaml`
**Lines:** 98-99, 200-202, 221-222, 231

**Problem:** IAM policies use resource patterns that don't match per-project resources. This will cause **AccessDenied** errors when deploying multiple independent projects.

**Current Patterns vs Required:**

| Resource | Current Pattern | Required Pattern |
|----------|-----------------|------------------|
| S3 Artifacts | `${ProjectName}-${Environment}-pipeline-artifacts-*` | `${ProjectName}-${Environment}-*-artifacts-*` |
| ECR Repository | `${ProjectName}-${Environment}` | `${ProjectName}-${Environment}-*` |
| Secrets Manager | `${ProjectName}/${Environment}/azure-devops-pat*` | `${ProjectName}/${Environment}/*/azure-devops-pat*` |

**Proposed Changes in `iam.yaml`:**

```yaml
# Line 98-99: S3 Artifact Access for CodePipeline
Resource:
  - !Sub arn:aws:s3:::${ProjectName}-${Environment}-*-artifacts-${AWS::AccountId}
  - !Sub arn:aws:s3:::${ProjectName}-${Environment}-*-artifacts-${AWS::AccountId}/*

# Line 200-202: Secrets Manager PAT Access for CodeBuild
Resource:
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/${Environment}/*/azure-devops-pat*

# Line 221-222: ECR Repository Access for CodeBuild
Resource:
  - !Sub arn:aws:ecr:${AWS::Region}:${AWS::AccountId}:repository/${ProjectName}-${Environment}-*

# Line 231: S3 Artifact Access for CodeBuild
Resource:
  - !Sub arn:aws:s3:::${ProjectName}-${Environment}-*-artifacts-${AWS::AccountId}/*
```

---

#### 3. Missing Dependency Validation in deploy-project.sh (BLOCKING)

**File:** `scripts/deploy-project.sh`
**Lines:** After line 108

**Problem:** The script doesn't verify that shared infrastructure exists before deploying a project. If shared infra is missing, CloudFormation will fail with cryptic `Fn::ImportValue` errors.

**Proposed Change:** Add validation after parameter checks:

```bash
# After line 108, add:
echo "Validating shared infrastructure..."
SHARED_STACK_NAME="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-main"
SHARED_STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$SHARED_STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [[ "$SHARED_STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "============================================"
    echo "ERROR: Shared infrastructure not found!"
    echo "============================================"
    echo "Stack '$SHARED_STACK_NAME' does not exist."
    echo ""
    echo "Deploy shared infrastructure first:"
    echo "  ./scripts/deploy.sh -e ${ENVIRONMENT} -b ${TEMPLATES_BUCKET}"
    echo "============================================"
    exit 1
elif [[ "$SHARED_STACK_STATUS" != "CREATE_COMPLETE" && "$SHARED_STACK_STATUS" != "UPDATE_COMPLETE" ]]; then
    echo "ERROR: Shared infrastructure is in state: $SHARED_STACK_STATUS"
    echo "Please wait for it to complete or fix any issues."
    exit 1
fi
echo "Shared infrastructure validated (status: $SHARED_STACK_STATUS)"
```

---

#### 4. Missing DB Secrets Path in ECS Execution Role

**File:** `infrastructure/iam.yaml`
**Lines:** 318-320

**Current Code:**
```yaml
Resource:
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/${Environment}/db/*
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/db/*
```

**Problem:** Per-project DB secrets are created at `${ProjectName}/${Environment}/${ServiceName}/db/*` but IAM policy doesn't include this path. ECS tasks can't retrieve their DB connection strings.

**Proposed Change:**
```yaml
Resource:
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/${Environment}/*/db/*
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/${Environment}/db/*
  - !Sub arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${ProjectName}/db/*
```

---

### 🟡 Medium Priority

#### 5. Inconsistent Artifact Filename Between Templates

**Files:**
- `infrastructure/codepipeline.yaml` (line 392)
- `infrastructure/project.yaml` (line 515)
- `buildspecs/buildspec-push.yml` (line 64)

**Current State:**

| File | Value |
|------|-------|
| `codepipeline.yaml:392` | `FileName: imageDetail.json` |
| `project.yaml:515` | `FileName: imagedefinitions.json` |
| `buildspec-push.yml:64` | Outputs `imagedefinitions.json` |

**Problem:** `codepipeline.yaml` expects `imageDetail.json` but buildspec produces `imagedefinitions.json`. ECS deployment will fail.

**Proposed Change in `codepipeline.yaml:392`:**
```yaml
# Before
FileName: imageDetail.json

# After
FileName: imagedefinitions.json
```

---

#### 6. Missing Lint and ContractTest Stages in project.yaml

**File:** `infrastructure/project.yaml`
**Lines:** 433-519

**Current State:**

| Template | Stages |
|----------|--------|
| `codepipeline.yaml` | Source → CloneSource → Lint → Build → Push → Deploy → ContractTest (7 stages) |
| `project.yaml` | Source → CloneSource → Build → Push → Deploy (5 stages) |

**Problem:** Per-project pipelines lack API governance (Lint) and contract testing stages.

**Proposed Change:** Add LintProject and ContractTestProject CodeBuild resources and corresponding pipeline stages to `project.yaml`, OR document that these are shared-infrastructure-only features.

**Option A - Add to project.yaml:**
```yaml
# Add CodeBuild projects
LintProject:
  Type: AWS::CodeBuild::Project
  Properties:
    Name: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-lint
    # ... (similar to SourceProject)
    Source:
      Type: CODEPIPELINE
      BuildSpec: buildspecs/buildspec-lint.yml

ContractTestProject:
  Type: AWS::CodeBuild::Project
  Properties:
    Name: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-contract-test
    # ... (similar to SourceProject)
    Source:
      Type: CODEPIPELINE
      BuildSpec: buildspecs/buildspec-contract-test.yml

# Add pipeline stages after CloneSource and after Deploy respectively
```

**Option B - Document as intentional:**
Add comment in `project.yaml`:
```yaml
# NOTE: Lint and ContractTest stages are omitted for per-project pipelines.
# These are available only in the shared codepipeline.yaml template.
```

---

#### 7. PAT Exposed in Command Line Arguments

**File:** `scripts/deploy-project.sh`
**Lines:** 200-206

**Current Code:**
```bash
if [[ -n "$AZURE_DEVOPS_PAT" ]]; then
    echo "Populating Azure DevOps PAT in Secrets Manager..."
    aws secretsmanager put-secret-value \
        --secret-id "${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${SERVICE_NAME}/azure-devops-pat" \
        --secret-string "{\"pat\":\"${AZURE_DEVOPS_PAT}\"}" \
        --region "$AWS_REGION"
    echo "PAT configured."
```

**Problem:** The PAT value appears in:
- Process listing (`ps aux`)
- Shell history (`~/.bash_history`)
- System audit logs

**Solution Implemented:** Created `scripts/setup-pat.sh` for secure PAT configuration.

**Recommended Workflow:**
```bash
# Step 1: Deploy project WITHOUT --pat flag
./scripts/deploy-project.sh -s cash-collection -o myorg -p myproject \
    -r myrepo --branch main -b bucket -e dev

# Step 2: Set PAT securely using the helper script
./scripts/setup-pat.sh -e dev -s cash-collection

# Step 3: Verify PAT is configured
./scripts/setup-pat.sh -e dev -s cash-collection --verify
```

**Also update `deploy-project.sh`** to use temp file if --pat is provided:
```bash
if [[ -n "$AZURE_DEVOPS_PAT" ]]; then
    echo "Populating Azure DevOps PAT in Secrets Manager..."
    local tmp_secret=$(mktemp)
    chmod 600 "$tmp_secret"
    printf '{"pat":"%s"}' "$AZURE_DEVOPS_PAT" > "$tmp_secret"
    aws secretsmanager put-secret-value \
        --secret-id "${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${SERVICE_NAME}/azure-devops-pat" \
        --secret-string "file://${tmp_secret}" \
        --region "$AWS_REGION"
    rm -f "$tmp_secret"
    echo "PAT configured."
```

---

#### 8. Silent Failure on Stack Update

**File:** `scripts/deploy-project.sh`
**Lines:** 180-192

**Current Code:**
```bash
else
    echo "Updating existing stack (status: ${STACK_STATUS})..."
    aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" 2>&1 || true  # ← Silent failure

    echo "Waiting for stack update..."
    aws cloudformation wait stack-update-complete \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" 2>/dev/null || true  # ← Silent failure
fi
```

**Problem:** All update errors are silently ignored, including actual failures.

**Proposed Change:**
```bash
else
    echo "Updating existing stack (status: ${STACK_STATUS})..."
    local update_output
    update_output=$(aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" 2>&1) || {
        if [[ "$update_output" == *"No updates are to be performed"* ]]; then
            echo "No updates are to be performed"
        else
            echo "ERROR: Stack update failed: $update_output"
            exit 1
        fi
    }

    if [[ "$update_output" != *"No updates"* ]]; then
        echo "Waiting for stack update..."
        aws cloudformation wait stack-update-complete \
            --stack-name "$STACK_NAME" \
            --region "$AWS_REGION"
    fi
fi
```

---

### 🟢 Low Priority

#### 9. Missing ComputeType Parameter in Stack Deployment

**File:** `scripts/lib/stack-operations.sh`
**Lines:** 26-32

**Current Code:**
```bash
local parameters=(
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
    "ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME}"
    "ParameterKey=VpcCidr,ParameterValue=${VPC_CIDR}"
    "ParameterKey=TemplatesBucketName,ParameterValue=${TEMPLATES_BUCKET}"
    "ParameterKey=TemplatesBucketPrefix,ParameterValue=${TEMPLATES_PREFIX}"
)
```

**Problem:** `main.yaml` accepts `ComputeType` parameter but it's not passed from the deployment script.

**Proposed Change:**
```bash
local parameters=(
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
    "ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME}"
    "ParameterKey=ComputeType,ParameterValue=${COMPUTE_TYPE}"
    "ParameterKey=VpcCidr,ParameterValue=${VPC_CIDR}"
    "ParameterKey=TemplatesBucketName,ParameterValue=${TEMPLATES_BUCKET}"
    "ParameterKey=TemplatesBucketPrefix,ParameterValue=${TEMPLATES_PREFIX}"
)
```

---

#### 10. No Health Check Grace Period in ECS Service

**File:** `infrastructure/project.yaml`
**Lines:** 229-258

**Current Code:**
```yaml
EcsService:
  Type: AWS::ECS::Service
  DependsOn: ListenerRule
  Properties:
    ServiceName: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-svc
    # ... other properties
    DeploymentConfiguration:
      MinimumHealthyPercent: 50
      MaximumPercent: 200
    # Missing: HealthCheckGracePeriodSeconds
```

**Problem:** New containers may be marked unhealthy and terminated before the application fully starts (especially .NET apps which can take 30-60 seconds to initialize).

**Proposed Change:**
```yaml
EcsService:
  Type: AWS::ECS::Service
  DependsOn: ListenerRule
  Properties:
    ServiceName: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-svc
    # ... other properties
    HealthCheckGracePeriodSeconds: 120  # ← Add this
    DeploymentConfiguration:
      MinimumHealthyPercent: 50
      MaximumPercent: 200
```

---

#### 11. Hardcoded Container Port

**File:** `infrastructure/project.yaml`
**Lines:** 59-66 (parameters), 201-202, 249-250

**Current Code:**
```yaml
# TaskDefinition
PortMappings:
  - ContainerPort: 80
    Protocol: tcp

# EcsService LoadBalancers
LoadBalancers:
  - ContainerName: !Sub ${ServiceName}-container
    ContainerPort: 80
    TargetGroupArn: !Ref TargetGroup
```

**Problem:** Services must run on port 80. No flexibility for different application ports.

**Proposed Change:**

Add parameter:
```yaml
Parameters:
  ContainerPort:
    Type: Number
    Description: Container port the application listens on
    Default: 80
    MinValue: 1
    MaxValue: 65535
```

Update references:
```yaml
# TargetGroup
TargetGroup:
  Properties:
    Port: !Ref ContainerPort

# TaskDefinition
PortMappings:
  - ContainerPort: !Ref ContainerPort
    Protocol: tcp

# EcsService
LoadBalancers:
  - ContainerName: !Sub ${ServiceName}-container
    ContainerPort: !Ref ContainerPort
    TargetGroupArn: !Ref TargetGroup
```

Update `deploy-project.sh` to accept `--port` argument.

---

#### 12. Missing Deployment Circuit Breaker

**File:** `infrastructure/project.yaml`
**Lines:** 251-253

**Current Code:**
```yaml
DeploymentConfiguration:
  MinimumHealthyPercent: 50
  MaximumPercent: 200
```

**Problem:** Failed deployments will keep retrying indefinitely without automatic rollback.

**Proposed Change:**
```yaml
DeploymentConfiguration:
  MinimumHealthyPercent: 50
  MaximumPercent: 200
  DeploymentCircuitBreaker:
    Enable: true
    Rollback: true
```

---

#### 13. Artifact Bucket Lifecycle Missing in project.yaml

**File:** `infrastructure/project.yaml`
**Lines:** 398-418

**Current Code:**
```yaml
ArtifactBucket:
  Type: AWS::S3::Bucket
  DeletionPolicy: Retain
  Properties:
    BucketName: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-artifacts-${AWS::AccountId}
    VersioningConfiguration:
      Status: Enabled
    # Missing: LifecycleConfiguration
```

**Problem:** Old artifacts accumulate indefinitely, increasing storage costs.

**Proposed Change:**
```yaml
ArtifactBucket:
  Type: AWS::S3::Bucket
  DeletionPolicy: Retain
  Properties:
    BucketName: !Sub ${InfraProjectName}-${Environment}-${ServiceName}-artifacts-${AWS::AccountId}
    VersioningConfiguration:
      Status: Enabled
    LifecycleConfiguration:
      Rules:
        - Id: CleanupOldArtifacts
          Status: Enabled
          ExpirationInDays: 30
          NoncurrentVersionExpirationInDays: 7
```

---
so
## Files Affected Summary

| File | Changes |
|------|---------|
| `infrastructure/iam.yaml` | #2, #4 (Critical - BLOCKING) |
| `scripts/deploy-project.sh` | #3 (Critical), #7, #8 (Medium) |
| `scripts/lib/stack-operations.sh` | #1 (Critical), #9 (Low) |
| `infrastructure/codepipeline.yaml` | #5 (Medium) |
| `infrastructure/project.yaml` | #6 (Medium), #10-13 (Low) |

---

## Implementation Order

1. **Phase 1 - Critical Fixes (BLOCKING - Must fix before deploying multiple projects)**
   - [ ] #2: Update IAM policies to use wildcards for per-project resources in `iam.yaml`
   - [ ] #3: Add shared infrastructure validation in `deploy-project.sh`
   - [ ] #4: Fix DB secrets path pattern in `iam.yaml`
   - [ ] #1: Fix double command execution in `stack-operations.sh`

2. **Phase 2 - Medium Priority**
   - [ ] #5: Fix artifact filename mismatch in `codepipeline.yaml`
   - [ ] #6: Decide on Lint/ContractTest stages for `project.yaml`
   - [ ] #7: Secure PAT handling in `deploy-project.sh`
   - [ ] #8: Add proper error handling in `deploy-project.sh`

3. **Phase 3 - Low Priority Improvements**
   - [ ] #9: Add ComputeType parameter to stack deployment
   - [ ] #10: Add HealthCheckGracePeriodSeconds to ECS Service
   - [ ] #11: Parameterize container port
   - [ ] #12: Add deployment circuit breaker
   - [ ] #13: Add lifecycle rules to artifact bucket

---

## Appendix A: Dependency Architecture

### Deployment Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE (deploy.sh)                     │
│                         main.yaml → Nested Stacks                        │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐   ┌─────────────────┐   ┌──────────┐   ┌───────────────┐  │
│  │   VPC    │ → │ Security Groups │ → │   IAM    │   │  ECS Cluster  │  │
│  │ vpc.yaml │   │security-grps.yml│   │ iam.yaml │   │ecs-cluster.yml│  │
│  └────┬─────┘   └────────┬────────┘   └────┬─────┘   └───────┬───────┘  │
│       │                  │                 │                 │          │
│       │    ┌─────────────┴──────┐          │                 │          │
│       │    │                    │          │                 │          │
│       ▼    ▼                    ▼          │                 │          │
│  ┌──────────────┐     ┌─────────────────┐  │  ┌─────────────────────┐   │
│  │     ALB      │     │   API Gateway   │  │  │     Monitoring      │   │
│  │   alb.yaml   │     │ api-gateway.yaml│  │  │   monitoring.yaml   │   │
│  └──────┬───────┘     └─────────────────┘  │  └─────────────────────┘   │
│         │                                  │                             │
└─────────┼──────────────────────────────────┼─────────────────────────────┘
          │                                  │
          │          EXPORTS (Fn::Export)    │
          ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PER-PROJECT (deploy-project.sh)                       │
│                              project.yaml                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Uses Fn::ImportValue to reference shared resources:                     │
│  • VpcId, PrivateSubnet1Id, PrivateSubnet2Id                            │
│  • EcsSecurityGroupId, CodeBuildSecurityGroupId                         │
│  • EcsClusterArn, EcsClusterName                                        │
│  • HttpListenerArn                                                       │
│  • CodeBuildRoleArn, CodePipelineRoleArn                                │
│  • EcsExecutionRoleArn, EcsTaskRoleArn                                  │
│                                                                          │
│  Creates per-project resources:                                          │
│  ┌─────────┐  ┌─────────┐  ┌────────────┐  ┌──────────────┐             │
│  │   ECR   │  │ Secrets │  │ Target Grp │  │ Listener Rule│             │
│  └─────────┘  └─────────┘  └────────────┘  └──────────────┘             │
│  ┌─────────────────────────────────────────────────────────┐             │
│  │                     CodePipeline                        │             │
│  │  Source → CloneSource → Build → Push → Deploy           │             │
│  └─────────────────────────────────────────────────────────┘             │
│  ┌─────────────────────────────────────────────────────────┐             │
│  │                      ECS Service                        │             │
│  │  Task Definition → Service → Load Balancer Integration  │             │
│  └─────────────────────────────────────────────────────────┘             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Required Exports for Per-Project Stacks

| Export Name | Source Template | Used By |
|-------------|-----------------|---------|
| `${ProjectName}-${Environment}-VpcId` | vpc.yaml | project.yaml (Target Group, CodeBuild VPC) |
| `${ProjectName}-${Environment}-PrivateSubnet1Id` | vpc.yaml | project.yaml (ECS Service, CodeBuild) |
| `${ProjectName}-${Environment}-PrivateSubnet2Id` | vpc.yaml | project.yaml (ECS Service, CodeBuild) |
| `${ProjectName}-${Environment}-EcsSecurityGroupId` | security-groups.yaml | project.yaml (ECS Service) |
| `${ProjectName}-${Environment}-CodeBuildSecurityGroupId` | security-groups.yaml | project.yaml (CodeBuild) |
| `${ProjectName}-${Environment}-EcsClusterArn` | ecs-cluster.yaml | project.yaml (ECS Service) |
| `${ProjectName}-${Environment}-EcsClusterName` | ecs-cluster.yaml | project.yaml (Pipeline Deploy) |
| `${ProjectName}-${Environment}-HttpListenerArn` | alb.yaml | project.yaml (Listener Rule) |
| `${ProjectName}-${Environment}-CodeBuildRoleArn` | iam.yaml | project.yaml (CodeBuild Projects) |
| `${ProjectName}-${Environment}-CodePipelineRoleArn` | iam.yaml | project.yaml (Pipeline) |
| `${ProjectName}-${Environment}-EcsExecutionRoleArn` | iam.yaml | project.yaml (Task Definition) |
| `${ProjectName}-${Environment}-EcsTaskRoleArn` | iam.yaml | project.yaml (Task Definition) |

### Multi-Project Example

```bash
# Step 1: Deploy shared infrastructure (once per environment)
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1

# Step 2: Deploy multiple independent projects
./scripts/deploy-project.sh -s cash-collection -o myorg -p myproject \
    -r cash-repo --branch main --path "/api/cash/*" --priority 100 \
    -b japfa-api-cfn-us-east-1 -e dev

./scripts/deploy-project.sh -s poultry-sale -o myorg -p myproject \
    -r poultry-repo --branch main --path "/api/poultry/*" --priority 200 \
    -b japfa-api-cfn-us-east-1 -e dev

./scripts/deploy-project.sh -s dbs-integration -o myorg -p myproject \
    -r dbs-repo --branch main --path "/api/dbs/*" --priority 300 \
    -b japfa-api-cfn-us-east-1 -e dev
```

---

## Appendix B: Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Secrets in Secrets Manager | ✅ | PAT and DB credentials stored securely |
| S3 encryption enabled | ✅ | AES256 server-side encryption |
| S3 public access blocked | ✅ | All public access settings blocked |
| HTTPS enforcement | ✅ | DenyInsecureTransport policy |
| Credential cleanup after use | ✅ | `~/.git-credentials` removed in buildspec |
| VPC private subnets for ECS | ✅ | AssignPublicIp: DISABLED |
| PAT not logged | ✅ | Only status messages logged |
| ECR image scanning | ✅ | ScanOnPush: true |
| IAM least privilege | ⚠️ | Reviewed - needs wildcard patterns for per-project resources (Issue #2, #4) |
| Security Group ingress | ✅ | Properly scoped to source security groups only |
| KMS encryption | ✅ | Conditional KMS decrypt for Secrets Manager |
| VPC CodeBuild | ✅ | CodeBuild runs in VPC with proper security group |

---

## Appendix C: CloudFormation Export Verification

Run this command to verify all required exports exist before deploying projects:

```bash
#!/bin/bash
PROJECT_NAME="japfa-api"
ENVIRONMENT="dev"
REGION="us-east-1"

REQUIRED_EXPORTS=(
    "${PROJECT_NAME}-${ENVIRONMENT}-VpcId"
    "${PROJECT_NAME}-${ENVIRONMENT}-PrivateSubnet1Id"
    "${PROJECT_NAME}-${ENVIRONMENT}-PrivateSubnet2Id"
    "${PROJECT_NAME}-${ENVIRONMENT}-EcsSecurityGroupId"
    "${PROJECT_NAME}-${ENVIRONMENT}-CodeBuildSecurityGroupId"
    "${PROJECT_NAME}-${ENVIRONMENT}-EcsClusterArn"
    "${PROJECT_NAME}-${ENVIRONMENT}-EcsClusterName"
    "${PROJECT_NAME}-${ENVIRONMENT}-HttpListenerArn"
    "${PROJECT_NAME}-${ENVIRONMENT}-CodeBuildRoleArn"
    "${PROJECT_NAME}-${ENVIRONMENT}-CodePipelineRoleArn"
    "${PROJECT_NAME}-${ENVIRONMENT}-EcsExecutionRoleArn"
    "${PROJECT_NAME}-${ENVIRONMENT}-EcsTaskRoleArn"
)

echo "Checking CloudFormation exports..."
EXPORTS=$(aws cloudformation list-exports --region $REGION --query 'Exports[].Name' --output text)

for export in "${REQUIRED_EXPORTS[@]}"; do
    if echo "$EXPORTS" | grep -q "$export"; then
        echo "✅ $export"
    else
        echo "❌ $export (MISSING)"
    fi
done
```

---

*End of Review*
