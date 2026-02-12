# Japfa API Platform — Fargate Infrastructure Architecture

## Overview

Two-tier deployment model: shared infrastructure deployed once via `deploy.sh`, per-project stacks deployed for each service via `deploy-project.sh`.

```
  Step 1: deploy.sh                → main.yaml     (Shared infra)
  Step 2: deploy-project.sh        → project.yaml  (Per-project)
```

---

## Deployment Model

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  SHARED INFRASTRUCTURE (deploy.sh — run once)                          │
  │                                                                        │
  │  main.yaml (Root Stack) — 7 nested stacks:                             │
  │  ├── VpcStack              → VPC, Subnets, NAT Gateways, IGW          │
  │  ├── SecurityGroupsStack   → VpcLink SG, ALB SG, ECS SG, CB SG       │
  │  ├── IamStack              → Pipeline, CodeBuild, ECS Exec/Task roles │
  │  ├── AlbStack              → Internal ALB, HTTP Listener (404 default)│
  │  ├── ApiGatewayStack       → HTTP API, VPC Link, ALB Integration,     │
  │  │                           Webhook Lambda (POST /webhook/{service})  │
  │  ├── EcsClusterStack       → Fargate Cluster, Container Insights      │
  │  └── MonitoringStack       → SNS, CloudWatch Dashboard, Alarms        │
  │                                                                        │
  │  Stack name: {project}-{env}-main                                      │
  │                                                                        │
  │  Exports (Fn::ImportValue):                                            │
  │  • ${ProjectName}-${Environment}-VpcId, SubnetIds, SG IDs             │
  │  • ECS Cluster ARN/Name, IAM Role ARNs                                │
  │  • ALB Listener ARN, API Gateway Endpoint                             │
  │  • SNS Notification Topic ARN                                          │
  └─────────────────────────────────────────────────────────────────────────┘
```

                                    │
                    Fn::ImportValue  │  (references shared resources)
                                    ▼

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PER-PROJECT STACK (deploy-project.sh — run per service)               │
  │                                                                        │
  │  project.yaml — one stack per service:                                 │
  │  ├── ECR Repository        → {infra}-{env}-{service}                   │
  │  ├── Secrets               → PAT + DB connection strings               │
  │  ├── ALB Target Group      → Health check on /health (configurable)    │
  │  ├── ALB Listener Rule     → Path-based routing (unique priority)      │
  │  ├── ECS Task Definition   → Fargate, container from ECR              │
  │  │   RequiresCompatibilities: [FARGATE]                                │
  │  │   Supports PathBase for ASP.NET UsePathBase                         │
  │  │   Configurable ContainerPort (default: 80)                          │
  │  ├── ECS Service           → LaunchType: FARGATE                       │
  │  │   Rolling deploy + circuit breaker                                  │
  │  │   Configurable HealthCheckGracePeriod                               │
  │  ├── CodeBuild (Source)    → Clone from Azure DevOps via PAT           │
  │  ├── CodeBuild (SwaggerGen)→ Extract OpenAPI spec from ASP.NET build   │
  │  ├── CodeBuild (Lint)      → API governance with Spectral              │
  │  ├── CodeBuild (Build)     → Docker build (generic, Dockerfile only)   │
  │  ├── CodeBuild (Push)      → ECR auth + push (generic)                 │
  │  ├── CodeBuild (ContractTest)→ Dredd contract testing (warnings only)  │
  │  ├── Artifact Bucket       → S3 for pipeline artifacts                 │
  │  └── CodePipeline          → 8-stage pipeline                          │
  │      Stage 7 Deploy targets EcsClusterName (Fargate cluster)           │
  │                                                                        │
  │  Stack name: {infra}-{env}-{service}                                   │
  │  Log group: /ecs/{infra}-{env}-{service}                               │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## CI/CD Pipeline Architecture (Per-Project — 8 Stages)

```
  Azure DevOps                          AWS
  ┌──────────┐    ┌──────────────────────┐
  │  Source   │    │  S3 Artifact Bucket  │
  │  Repo     │    │  trigger/trigger.zip │
  │           │    └──────────┬───────────┘
  │  Contains:│               │
  │  • Code   │               ▼
  │  • Docker-│    ┌────────────────────────────────────────────────────────────────────────────────────┐
  │    file   │    │  CodePipeline (8 Stages)                                                          │
  └──────────┘    │                                                                                    │
                  │  ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌────────┐ ┌──────────────┐
                  │  │1.Source│→│2.Clone  │→│3.Swagger│→│4.Lint│→│5.Build│→│6.Push│→│7.Deploy│→│8.ContractTest│
                  │  │  (S3)  │ │  Src    │ │  Gen    │ │(Spec)│ │  (CB) │ │(CB)  │ │  (ECS) │ │   (Dredd)    │
                  │  └────────┘ └─────────┘ └──────────┘ └──────┘ └───────┘ └──────┘ └────────┘ └──────────────┘
                  │                                                                                    │
                  │  Artifact Store: S3 (AES256, versioned)                                            │
                  └────────────────────────────────────────────────────────────────────────────────────┘

  Stage Details:
  ─────────────
  1. Source      → S3 trigger (trigger/trigger.zip)
  2. CloneSource → CodeBuild: git clone Azure DevOps repo via PAT (VPC mode)
  3. SwaggerGen  → CodeBuild: Extract OpenAPI spec from ASP.NET Swashbuckle
  4. Lint        → CodeBuild: Spectral API governance (error→block+SNS, warn→report)
  5. Build       → CodeBuild: docker build (Dockerfile at repo root)
  6. Push        → CodeBuild: ECR auth + push (tags: latest + commit SHA)
  7. Deploy      → ECS: Rolling deployment with circuit breaker
  8. ContractTest→ CodeBuild: Dredd contract testing (warnings only, never blocks)
```

---

## Buildspec Strategy

```
  All 6 buildspecs are GENERIC — live in the infra repo, not per-project.
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

  Per-project requirement: Only a Dockerfile at the repo root.
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
                  │  ECS Fargate Service    │
                  │  (per project)          │
                  │  ECS SG: IN 80 from ALB │
                  │                         │
                  │  Task Definition:       │
                  │   LaunchType: FARGATE   │
                  │   CPU/Memory per project│
                  │   Container: {svc}-     │
                  │     container           │
                  │   Port: configurable    │
                  │   Health: /health       │
                  │   PathBase: optional    │
                  │                         │
                  │  Deploy: Rolling        │
                  │   Circuit Breaker: ON   │
                  │   Auto Rollback: ON     │
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
  │  Shared IAM Roles (from main.yaml IamStack)                           │
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
  │  Webhook Lambda Role                                                   │
  │  • Lambda basic exec                                                   │
  │  • CodePipeline start (*-pipeline pattern)                             │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## Secrets Management (Per-Project)

```
  ┌──────────────────────────────────────────────────────────────┐
  │  AWS Secrets Manager (created by project.yaml)               │
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
  │  Monitoring Stack (shared — from main.yaml MonitoringStack)             │
  │                                                                          │
  │  SNS Topic (KMS encrypted) ← Alarms + EventBridge rules + Lint errors  │
  │                                                                          │
  │  CloudWatch Alarms:                                                      │
  │  • ECS CPU >= 80%, Memory >= 80%, Running Tasks < 1                     │
  │  • ALB Unhealthy Hosts >= 1, Response Time >= 5s, 5xx >= 10            │
  │  • Pipeline Failure (conditional)                                        │
  │                                                                          │
  │  Per-Project Log Groups (created by project.yaml):                       │
  │  • /ecs/{infra}-{env}-{service}                                         │
  │  • /aws/codebuild/{infra}-{env}-{service}-{source|build|push|...}      │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Scripts Reference

```
  deploy.sh              — Deploy shared infrastructure (main.yaml)
                           Supports --custom-domain, --certificate-arn
                           Supports --dry-run for template validation

  deploy-project.sh      — Deploy per-project stack (project.yaml)
                           Supports --path-base, --port, --grace-period
                           Supports --health-check (default: /health)
                           Seeds trigger.zip, re-triggers pipeline

  teardown.sh            — Delete shared infrastructure
  teardown-project.sh    — Delete per-project stack (--all for all)
  setup-pat.sh           — Securely set Azure DevOps PAT
  check-permissions.sh   — Validate AWS IAM permissions
```

---

## Deploy Commands

```bash
# Step 1: Deploy shared infrastructure (once)
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1

# With custom domain
./scripts/deploy.sh -e prod -b japfa-api-cfn-us-east-1 \
  --custom-domain api.my-company.com.vn \
  --certificate-arn arn:aws:acm:us-east-1:123456789:certificate/abc-123

# Dry run
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1 --dry-run

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
./scripts/teardown.sh -e dev
```
