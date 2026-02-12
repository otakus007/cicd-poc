# Japfa API Platform — EC2 Infrastructure Architecture

## Overview

Two-tier deployment model mirroring the Fargate architecture but using EC2 instances as the compute layer. Shared infrastructure deployed once via `deploy.sh --compute-type ec2`, per-project stacks deployed for each service via `deploy-project.sh --compute-type ec2`.

```
  Step 1: deploy.sh --compute-type ec2    → main-ec2.yaml     (Shared infra)
  Step 2: deploy-project.sh --compute-type ec2 → project-ec2.yaml (Per-project)
```

> **Note:** EC2 and Fargate are separate deployments with separate resources.
> EC2 stack name: `{project}-{env}-ec2-main`, exports use `-ec2-` prefix.

---

## Deployment Model

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  SHARED INFRASTRUCTURE (deploy.sh --compute-type ec2 — run once)       │
  │                                                                        │
  │  main-ec2.yaml (Root Stack) — 7 nested stacks:                         │
  │  ├── VpcStack              → VPC, Subnets, NAT Gateways, IGW          │
  │  ├── SecurityGroupsStack   → VpcLink SG, ALB SG, ECS SG, CB SG       │
  │  ├── IamStack              → Pipeline, CodeBuild, ECS Exec/Task roles │
  │  │                           + EC2 Instance Role & Instance Profile    │
  │  ├── AlbStack              → Internal ALB, HTTP Listener (404 default)│
  │  ├── ApiGatewayStack       → HTTP API, VPC Link, ALB Integration,     │
  │  │                           Webhook Lambda (POST /webhook/{service})  │
  │  ├── EcsEc2ClusterStack    → EC2 Cluster, ASG, Launch Template,        │
  │  │                           Capacity Provider, Container Insights     │
  │  └── MonitoringStack       → SNS, CloudWatch Dashboard, Alarms        │
  │                                                                        │
  │  Stack name: {project}-{env}-ec2-main                                  │
  │                                                                        │
  │  EC2-Specific Parameters:                                              │
  │  • InstanceType (default: t3.medium)                                   │
  │  • Ec2MinCapacity (default: 1), Ec2MaxCapacity (default: 10)          │
  │  • Ec2DesiredCapacity (default: 2)                                     │
  │  • RootVolumeSize (default: 30 GB)                                     │
  │                                                                        │
  │  Exports (Fn::ImportValue):                                            │
  │  • ${ProjectName}-${Environment}-ec2-VpcId, SubnetIds, SG IDs         │
  │  • ${ProjectName}-${Environment}-Ec2ClusterArn, Ec2ClusterName        │
  │  • ${ProjectName}-${Environment}-Ec2CapacityProviderName              │
  │  • ${ProjectName}-${Environment}-ec2-ApiGatewayEndpoint               │
  │  • ${ProjectName}-${Environment}-ec2-NotificationTopicArn             │
  │  • Ec2AsgName, Ec2AsgArn, Ec2LaunchTemplateId                        │
  └─────────────────────────────────────────────────────────────────────────┘
```

                                    │
                    Fn::ImportValue  │  (references shared resources)
                                    ▼

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PER-PROJECT STACK (deploy-project.sh --compute-type ec2 — per svc)    │
  │                                                                        │
  │  project-ec2.yaml — one stack per service:                             │
  │  ├── ECR Repository        → {infra}-{env}-{service}                   │
  │  ├── Secrets               → PAT + DB connection strings               │
  │  ├── ALB Target Group      → Health check on /health (configurable)    │
  │  ├── ALB Listener Rule     → Path-based routing (unique priority)      │
  │  ├── ECS Task Definition   → EC2, container from ECR                   │
  │  │   RequiresCompatibilities: [EC2]                                    │
  │  │   Network mode: awsvpc (for ALB integration)                        │
  │  │   Container: Cpu: 0, MemoryReservation: 512 (soft limits)          │
  │  │   Task family: {infra}-{env}-{service}-ec2                         │
  │  ├── ECS Service           → CapacityProviderStrategy                  │
  │  │   Rolling deploy + circuit breaker                                  │
  │  │   EnableExecuteCommand, EnableECSManagedTags                        │
  │  │   PropagateTags: SERVICE                                            │
  │  ├── CodeBuild (Source)    → Clone from Azure DevOps via PAT           │
  │  ├── CodeBuild (SwaggerGen)→ Extract OpenAPI spec from ASP.NET build   │
  │  ├── CodeBuild (Lint)      → API governance with Spectral              │
  │  ├── CodeBuild (Build)     → Docker build (generic, Dockerfile only)   │
  │  ├── CodeBuild (Push)      → ECR auth + push (generic)                 │
  │  ├── CodeBuild (ContractTest)→ Dredd contract testing (warnings only)  │
  │  ├── Artifact Bucket       → S3 for pipeline artifacts                 │
  │  └── CodePipeline          → 8-stage pipeline                          │
  │      Stage 7 Deploy targets Ec2ClusterName (EC2 cluster)               │
  │                                                                        │
  │  Stack name: {infra}-{env}-{service}-ec2                               │
  │  Log group: /ecs/{infra}-{env}-{service}-ec2                           │
  │                                                                        │
  │  Fn::ImportValue references:                                           │
  │  • Base prefix for child template exports:                             │
  │    ${InfraProjectName}-${Environment}-VpcId, HttpListenerArn,          │
  │    EcsSecurityGroupId, CodeBuildRoleArn, etc.                          │
  │  • Ec2 prefix for EC2-specific exports:                                │
  │    ${InfraProjectName}-${Environment}-Ec2ClusterArn,                   │
  │    ${InfraProjectName}-${Environment}-Ec2CapacityProviderName          │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## EC2 Compute Resources (EcsEc2ClusterStack)

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Launch Template                                                       │
  │  • ECS-optimized Amazon Linux 2023 AMI (SSM parameter)                │
  │  • Instance type: t3.medium (configurable)                             │
  │  • EBS gp3, encrypted, 30GB+ root volume                              │
  │  • Detailed CloudWatch monitoring enabled                              │
  │  • User data: ECS_CLUSTER config, metadata, spot draining              │
  ├────────────────────────────────────────────────────────────────────────┤
  │  Auto Scaling Group                                                    │
  │  • Multi-AZ (private subnets)                                          │
  │  • Min: 1, Max: 10, Desired: 2 (configurable)                         │
  │  • Scale-in protection for ECS-managed instances                       │
  │  • Rolling update policy                                               │
  ├────────────────────────────────────────────────────────────────────────┤
  │  Capacity Provider                                                     │
  │  • Managed scaling: target capacity 100%                               │
  │  • Managed termination protection: enabled                             │
  │  • Instance warmup: 300s                                               │
  ├────────────────────────────────────────────────────────────────────────┤
  │  ECS EC2 Cluster                                                       │
  │  • Container Insights enabled                                          │
  │  • Capacity provider associated with ASG                               │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## CI/CD Pipeline Architecture (Per-Project — 8 Stages)

```
  Same 8-stage pipeline as Fargate. Only difference: Stage 7 deploys to EC2 cluster.

  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  CodePipeline (8 Stages)                                                          │
  │                                                                                    │
  │  1.Source → 2.Clone → 3.SwaggerGen → 4.Lint → 5.Build → 6.Push → 7.Deploy → 8.ContractTest
  │    (S3)     (ADO)     (OpenAPI)     (Spectral) (Docker)  (ECR)   (ECS EC2)   (Dredd)
  └────────────────────────────────────────────────────────────────────────────────────┘

  Stage Details:
  ─────────────
  1. Source      → S3 trigger (trigger/trigger.zip)
  2. CloneSource → CodeBuild: git clone Azure DevOps repo via PAT (VPC mode)
  3. SwaggerGen  → CodeBuild: Extract OpenAPI spec from ASP.NET Swashbuckle
  4. Lint        → CodeBuild: Spectral API governance (error→block+SNS, warn→report)
  5. Build       → CodeBuild: docker build (Dockerfile at repo root)
  6. Push        → CodeBuild: ECR auth + push (tags: latest + commit SHA)
  7. Deploy      → ECS: Rolling deployment to EC2 cluster (Ec2ClusterName)
  8. ContractTest→ CodeBuild: Dredd contract testing (warnings only, never blocks)
```

---

## Buildspec Strategy

```
  All 6 buildspecs are GENERIC — identical to Fargate.
  Each project only needs a Dockerfile in its source repo.

  ┌──────────────────────────────────────────────────────────────────────┐
  │  buildspecs/                                                        │
  │                                                                     │
  │  buildspec-source.yml      — Clone Azure DevOps repo via PAT        │
  │  buildspec-swagger-gen.yml — Generate OpenAPI spec from ASP.NET     │
  │  buildspec-lint.yml        — API governance with Spectral            │
  │  buildspec-build.yml       — Generic Docker build                    │
  │  buildspec-push.yml        — Generic ECR push                        │
  │  buildspec-contract-test.yml — Dredd API contract testing            │
  └──────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │  buildspecs/governance/                                             │
  │                                                                     │
  │  .spectral.yml   — Spectral ruleset for API governance              │
  │  dredd.yml       — Dredd configuration for contract testing         │
  │  dredd-hooks.js  — Dredd hooks: convert failures to warnings        │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow

```
                                    INTERNET
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │   API Gateway (HTTP)    │
                          │   HTTPS + TLS 1.2+      │
                          │   Throttle: 500 rps     │
                          │   Routes:               │
                          │    ANY /api/{proxy+}    │
                          │    GET /health          │
                          │    POST /webhook/{svc}  │
                          │    $default (catch-all) │
                          └───────────┬────────────┘
                                      │
                          ┌───────────┼────────────┐
                          │           │            │
                     /api/*,/health   │    /webhook/{service}
                          │           │            │
                          ▼           │            ▼
                  ┌───────────────┐   │   ┌────────────────┐
                  │   VPC Link    │   │   │ Webhook Lambda │
                  │  VpcLink SG   │   │   │ Triggers       │
                  └───────┬───────┘   │   │ CodePipeline   │
                          │           │   └────────────────┘
                          ▼           │
                  ┌───────────────────┘
                  │  Internal ALB
                  │  (Private Subnets)
                  │  Listener: HTTP :80
                  │  Default: 404 JSON
                  │
                  │  Per-project rules:
                  │   /api/cash/*    → TG-A
                  │   /api/poultry/* → TG-B
                  │   /api/swine/*   → TG-C
                  └───────────┬────────────┘
                              │
                  ┌───────────▼────────────┐
                  │  ECS EC2 Service        │
                  │  (per project)          │
                  │  ECS SG: IN 80 from ALB │
                  │                         │
                  │  Task Definition:       │
                  │   CapacityProvider      │
                  │   awsvpc network mode   │
                  │   Cpu: 0 (soft)         │
                  │   MemoryReservation: 512│
                  │   Container: {svc}-     │
                  │     container           │
                  │   Port: configurable    │
                  │   Health: /health       │
                  │                         │
                  │  Deploy: Rolling        │
                  │   Circuit Breaker: ON   │
                  │   Auto Rollback: ON     │
                  │   ECS Exec: enabled     │
                  └────────────────────────┘
```

---

## Security Groups Chain

```
  Internet → VpcLink SG (TCP 443) → ALB SG (TCP 80,443) → ECS SG (TCP 80)

  ┌──────────────────────────┐
  │  VpcLink SG              │
  │  Ingress: TCP 443 from   │
  │           0.0.0.0/0      │
  └───────────┬──────────────┘
              │
  ┌──────────────────────────┐
  │  ALB SG                  │
  │  Ingress: TCP 80,443     │
  │           from VpcLink SG│
  └───────────┬──────────────┘
              │
  ┌──────────────────────────┐
  │  ECS SG                  │
  │  Ingress: TCP 80 from    │
  │           ALB SG         │
  │  Egress: TCP 443 → any   │
  │  Egress: TCP 1433 → VPC  │
  └──────────────────────────┘

  ┌──────────────────────────┐
  │  CodeBuild SG            │
  │  Egress: TCP 443,80 → any│
  └──────────────────────────┘
```

---

## IAM Roles

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Shared IAM Roles (from main-ec2.yaml IamStack)                       │
  │                                                                        │
  │  CodePipeline Role       │  CodeBuild Role                             │
  │  • S3 artifact access    │  • CloudWatch Logs                          │
  │  • CodeBuild start/get   │  • Secrets Manager (PAT)                    │
  │  • ECS update/describe   │  • ECR auth + push                          │
  │  • SNS publish           │  • VPC network interface                    │
  │  • IAM PassRole (ECS)    │  • SNS publish (lint)                       │
  │                          │                                              │
  │  ECS Execution Role      │  ECS Task Role                              │
  │  • AmazonECSTaskExec     │  • CloudWatch Logs                          │
  │  • Secrets Manager (DB)  │  • SSM Messages                             │
  │  • KMS decrypt           │  • X-Ray tracing                            │
  │                          │                                              │
  │  EC2 Instance Role       │  Webhook Lambda Role                        │
  │  • ECS agent register    │  • Lambda basic exec                        │
  │  • ECR pull images       │  • CodePipeline start                       │
  │  • CloudWatch Logs       │    (*-pipeline pattern)                     │
  │  • SSM for management    │                                              │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## Secrets Management (Per-Project)

```
  ┌──────────────────────────────────────────────────────────────┐
  │  AWS Secrets Manager (created by project-ec2.yaml)           │
  │                                                              │
  │  {infra}/{env}/{service}/azure-devops-pat                    │
  │  • Azure DevOps PAT for CodeBuild Source stage               │
  │  • Set via: --pat flag or ./scripts/setup-pat.sh             │
  │                                                              │
  │  {infra}/{env}/{service}/db/connection-strings               │
  │  • ConnectionStrings__Default                                │
  │  • Injected as container environment variables               │
  └──────────────────────────────────────────────────────────────┘
```

---

## Monitoring & Observability

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Monitoring Stack (shared — from main-ec2.yaml MonitoringStack)         │
  │  Points to EC2 cluster (Ec2ClusterName)                                 │
  │                                                                          │
  │  SNS Topic (KMS encrypted) ← Alarms + EventBridge rules + Lint errors  │
  │                                                                          │
  │  CloudWatch Alarms:                                                      │
  │  • ECS CPU >= 80%, Memory >= 80%, Running Tasks < 1                     │
  │  • ALB Unhealthy Hosts >= 1, Response Time >= 5s, 5xx >= 10            │
  │  • Pipeline Failure (conditional)                                        │
  │                                                                          │
  │  Per-Project Log Groups (created by project-ec2.yaml):                   │
  │  • /ecs/{infra}-{env}-{service}-ec2                                     │
  │  • /aws/codebuild/{infra}-{env}-{service}-{source|build|push|...}      │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Scripts Reference

```
  deploy.sh --compute-type ec2    — Deploy shared infrastructure (main-ec2.yaml)
                                    Supports --custom-domain, --certificate-arn
                                    Supports --dry-run for template validation

  deploy-project.sh --compute-type ec2 — Deploy per-project stack (project-ec2.yaml)
                                    Supports --path-base, --port, --grace-period
                                    Supports --health-check (default: /health)
                                    Seeds trigger.zip, re-triggers pipeline

  teardown.sh --compute-type ec2  — Delete shared infrastructure
  teardown-project.sh             — Delete per-project stack (--all for all)
  setup-pat.sh                    — Securely set Azure DevOps PAT
  check-permissions.sh            — Validate AWS IAM permissions
```

---

## Deploy Commands

```bash
# Step 1: Deploy shared infrastructure (once)
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1 --compute-type ec2

# With custom domain
./scripts/deploy.sh -e prod -b japfa-api-cfn-us-east-1 --compute-type ec2 \
  --custom-domain api.my-company.com.vn \
  --certificate-arn arn:aws:acm:us-east-1:123456789:certificate/abc-123

# Dry run
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1 --compute-type ec2 --dry-run

# Step 2: Deploy a project (repeat per service)
./scripts/deploy-project.sh \
  -s cash-collection \
  -o trungvudinh \
  -p "5. Cash Collection" \
  -r api-core \
  --branch feature/hsbc \
  --path "/api/cash/*" \
  --priority 100 \
  --path-base "/collection/api/v2.1" \
  --port 80 \
  --health-check "/health" \
  --grace-period 120 \
  --compute-type ec2 \
  -b japfa-api-cfn-us-east-1 \
  -e dev \
  --pat "your-pat-here"

# Set PAT securely (interactive)
./scripts/setup-pat.sh -e dev -s cash-collection

# Trigger pipeline manually
aws codepipeline start-pipeline-execution \
  --name japfa-api-dev-cash-collection-pipeline \
  --region us-east-1

# Teardown
./scripts/teardown-project.sh -s cash-collection -e dev
./scripts/teardown.sh -e dev --compute-type ec2
```

---

## Key Differences from Fargate

```
  ┌──────────────────────────┬──────────────────────────────────────────┐
  │  Aspect                  │  EC2 vs Fargate                          │
  ├──────────────────────────┼──────────────────────────────────────────┤
  │  Shared template         │  main-ec2.yaml (vs main.yaml)            │
  │  Project template        │  project-ec2.yaml (vs project.yaml)      │
  │  Stack name (shared)     │  {proj}-{env}-ec2-main                   │
  │  Stack name (project)    │  {proj}-{env}-{svc}-ec2                  │
  │  Cluster stack           │  EcsEc2ClusterStack (ASG + CP)           │
  │  Task RequiresCompat     │  [EC2] (vs [FARGATE])                    │
  │  Task container          │  Cpu: 0, MemoryReservation: 512          │
  │  Task family             │  {infra}-{env}-{svc}-ec2                 │
  │  Service launch          │  CapacityProviderStrategy                │
  │  Service extras          │  ExecuteCommand, ManagedTags, Propagate  │
  │  Deploy target           │  Ec2ClusterName                          │
  │  Log group               │  /ecs/{infra}-{env}-{svc}-ec2            │
  │  Export prefix            │  -ec2- for shared, Ec2 for cluster       │
  │  Cost tag                │  ComputeType=ec2                         │
  └──────────────────────────┴──────────────────────────────────────────┘
```
