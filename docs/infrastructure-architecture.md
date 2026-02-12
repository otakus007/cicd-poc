# Japfa API Platform — Infrastructure Architecture

## Overview

Two-tier deployment model with dual compute support: shared infrastructure deployed once, per-project stacks deployed for each service. Supports both Fargate and EC2 launch types for cost comparison.

```
  Step 1: deploy.sh                → Shared infra (VPC, ALB, ECS Cluster, IAM, API Gateway, Monitoring)
  Step 2: deploy-project.sh        → Per-project  (ECR, Pipeline, ECS Service, Secrets, ALB rule)

  Compute types:
    --compute-type fargate  → main.yaml    (Fargate cluster, default)
    --compute-type ec2      → main-ec2.yaml (EC2 cluster with ASG + Capacity Provider)
```

> **⚠️ Important: Fargate and EC2 are SEPARATE deployments.**
> Each root stack creates its own independent nested stacks. They use the same child templates
> (`vpc.yaml`, `alb.yaml`, etc.) but instantiate separate CloudFormation resources.
> EC2 exports use `-ec2-` prefix (e.g., `${ProjectName}-${Environment}-ec2-VpcId`).
> Both architectures follow the same two-tier model: shared infra + per-project stacks.

---

## Deployment Model

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  SHARED INFRASTRUCTURE (deploy.sh — run once)                          │
  │                                                                        │
  │  Fargate mode: main.yaml (Root Stack) — 7 nested stacks:              │
  │  ├── VpcStack              → VPC, Subnets, NAT Gateways, IGW          │
  │  ├── SecurityGroupsStack   → VpcLink SG, ALB SG, ECS SG, CB SG       │
  │  ├── IamStack              → Pipeline, CodeBuild, ECS Exec/Task roles │
  │  ├── AlbStack              → Internal ALB, HTTP Listener (404 default)│
  │  ├── ApiGatewayStack       → HTTP API, VPC Link, ALB Integration,     │
  │  │                           Webhook Lambda (POST /webhook/{service})  │
  │  ├── EcsClusterStack       → Fargate Cluster, Container Insights      │
  │  └── MonitoringStack       → SNS, CloudWatch Dashboard, Alarms        │
  │                                                                        │
  │  EC2 mode: main-ec2.yaml (Root Stack) — 7 nested stacks:              │
  │  ⚠️ Creates SEPARATE resources (does NOT share with Fargate stack)     │
  │  ├── VpcStack              → vpc.yaml (SEPARATE VPC)                   │
  │  ├── SecurityGroupsStack   → security-groups.yaml (SEPARATE)           │
  │  ├── IamStack              → iam.yaml (SEPARATE + EC2 Instance Profile)│
  │  ├── AlbStack              → alb.yaml (SEPARATE ALB)                   │
  │  ├── ApiGatewayStack       → api-gateway.yaml (SEPARATE API Gateway)   │
  │  ├── EcsEc2ClusterStack    → EC2 Cluster, ASG, Launch Template,        │
  │  │                           Capacity Provider, Container Insights     │
  │  └── MonitoringStack       → monitoring.yaml (points to EC2 cluster)   │
  │                                                                        │
  │  Both architectures are identical except for the compute layer:        │
  │  • Fargate: EcsClusterStack (Fargate capacity providers)               │
  │  • EC2: EcsEc2ClusterStack (ASG + EC2 capacity provider)              │
  │                                                                        │
  │  Exports (Fn::ImportValue):                                            │
  │  Fargate exports:                                                      │
  │  • ${ProjectName}-${Environment}-VpcId, SubnetIds, SG IDs             │
  │  • ECS Cluster ARN/Name, IAM Role ARNs                                │
  │  • ALB Listener ARN, API Gateway Endpoint                             │
  │  • SNS Notification Topic ARN                                          │
  │                                                                        │
  │  EC2 exports (separate namespace, -ec2- prefix for shared resources):  │
  │  • ${ProjectName}-${Environment}-ec2-VpcId, SubnetIds, SG IDs         │
  │  • ${ProjectName}-${Environment}-Ec2ClusterArn, Ec2ClusterName        │
  │  • ${ProjectName}-${Environment}-Ec2CapacityProviderName              │
  │  • ${ProjectName}-${Environment}-ec2-ApiGatewayEndpoint               │
  │  • ${ProjectName}-${Environment}-ec2-NotificationTopicArn             │
  └─────────────────────────────────────────────────────────────────────────┘
```

                                    │
                    Fn::ImportValue  │  (references shared resources)
                                    ▼

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PER-PROJECT STACK (deploy-project.sh — run per service)               │
  │                                                                        │
  │  Fargate: project.yaml — one stack per service                         │
  │  EC2:     project-ec2.yaml — one stack per service (mirrors Fargate)   │
  │                                                                        │
  │  Both templates create the same resources:                             │
  │  ├── ECR Repository        → {infra}-{env}-{service}                   │
  │  ├── Secrets               → PAT + DB connection strings               │
  │  ├── ALB Target Group      → Health check on /health (configurable)    │
  │  ├── ALB Listener Rule     → Path-based routing (unique priority)      │
  │  ├── ECS Task Definition   → Container from ECR                        │
  │  │   Fargate: RequiresCompatibilities: [FARGATE], LaunchType: FARGATE  │
  │  │   EC2:     RequiresCompatibilities: [EC2], CapacityProviderStrategy │
  │  │            Cpu: 0 + MemoryReservation: 512 on container             │
  │  │            Task family: {infra}-{env}-{service}-ec2                 │
  │  ├── ECS Service           → Rolling deploy + circuit breaker          │
  │  │   Fargate: LaunchType: FARGATE                                      │
  │  │   EC2:     CapacityProviderStrategy, EnableExecuteCommand,          │
  │  │            EnableECSManagedTags, PropagateTags: SERVICE             │
  │  ├── CodeBuild (Source)    → Clone from Azure DevOps via PAT           │
  │  ├── CodeBuild (SwaggerGen)→ Extract OpenAPI spec from ASP.NET build   │
  │  ├── CodeBuild (Lint)      → API governance with Spectral              │
  │  ├── CodeBuild (Build)     → Docker build (generic, Dockerfile only)   │
  │  ├── CodeBuild (Push)      → ECR auth + push (generic)                 │
  │  ├── CodeBuild (ContractTest)→ Dredd contract testing (warnings only)  │
  │  ├── Artifact Bucket       → S3 for pipeline artifacts                 │
  │  └── CodePipeline          → 8-stage pipeline                          │
  │      Stage 7 Deploy targets:                                           │
  │        Fargate: EcsClusterName (Fargate cluster)                       │
  │        EC2:     Ec2ClusterName (EC2 cluster)                           │
  │                                                                        │
  │  Fn::ImportValue references (project-ec2.yaml):                        │
  │  • Base prefix for shared child template exports:                      │
  │    ${InfraProjectName}-${Environment}-VpcId, HttpListenerArn,          │
  │    EcsSecurityGroupId, CodeBuildRoleArn, etc.                          │
  │  • Ec2 prefix for EC2-specific exports:                                │
  │    ${InfraProjectName}-${Environment}-Ec2ClusterArn,                   │
  │    ${InfraProjectName}-${Environment}-Ec2CapacityProviderName          │
  │                                                                        │
  │  Log group: /ecs/{infra}-{env}-{service} (Fargate)                     │
  │             /ecs/{infra}-{env}-{service}-ec2 (EC2)                     │
  └─────────────────────────────────────────────────────────────────────────┘

```

---

## CI/CD Pipeline Architecture (Per-Project — 8 Stages)

```

Azure DevOps AWS
┌──────────┐ ┌──────────────────────┐
│ Source │ │ S3 Artifact Bucket │
│ Repo │ │ trigger/trigger.zip │
│ │ └──────────┬───────────┘
│ Contains:│ │
│ • Code │ ▼
│ • Docker-│ ┌────────────────────────────────────────────────────────────────────────────────────┐
│ file │ │ CodePipeline (8 Stages) │
└──────────┘ │ │
│ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌────────┐ ┌──────────────┐
│ │1.Source│→│2.Clone │→│3.Swagger│→│4.Lint│→│5.Build│→│6.Push│→│7.Deploy│→│8.ContractTest│
│ │ (S3) │ │ Src │ │ Gen │ │(Spec)│ │ (CB) │ │(CB) │ │ (ECS) │ │ (Dredd) │
│ └────────┘ └─────────┘ └──────────┘ └──────┘ └───────┘ └──────┘ └────────┘ └──────────────┘
│ │
│ Artifact Store: S3 (AES256, versioned) │
└────────────────────────────────────────────────────────────────────────────────────┘

Stage Details:
─────────────

1. Source → S3 trigger (trigger/trigger.zip)
   Contains: buildspecs/ (source, swagger-gen, lint, build, push, contract-test)
   Also contains: .spectral.yml, dredd.yml, dredd-hooks.js (governance config)

2. CloneSource → CodeBuild: git clone Azure DevOps repo via PAT
   Buildspec: buildspecs/buildspec-source.yml (from trigger)
   PAT from: Secrets Manager ({infra}/{env}/{service}/azure-devops-pat)
   Copies buildspecs/ + governance configs into source output
   VPC: Yes (private subnets)
   Output: SourceOutput (cloned code + buildspecs/ + governance configs)

3. SwaggerGen → CodeBuild: Extract OpenAPI spec from ASP.NET build
   Buildspec: buildspecs/buildspec-swagger-gen.yml
   If swagger.json/openapi.json exists in source → uses as-is
   Otherwise → dotnet build + Swashbuckle CLI to generate spec
   Fallback → starts app briefly and curls swagger endpoint
   Output: SwaggerGenOutput (source + swagger.json)

4. Lint → CodeBuild: API governance linting with Spectral
   Buildspec: buildspecs/buildspec-lint.yml
   Ruleset: .spectral.yml (from trigger, shared governance config)
   Severity: error → BLOCKS build + SNS notification
   warn/info → reported, does NOT block
   Output: LintOutput (spectral-report.json, lint-summary.json)

5. Build → CodeBuild: docker build using project's Dockerfile
   Buildspec: buildspecs/buildspec-build.yml (generic)
   Input: SwaggerGenOutput (uses source from swagger stage)
   Convention: Dockerfile at repo root
   Override: DOCKERFILE_PATH env var
   Privileged: true (Docker)
   Output: BuildOutput (source + image-metadata.json)

6. Push → CodeBuild: ECR auth + docker push (tags: latest + commit SHA)
   Buildspec: buildspecs/buildspec-push.yml (generic)
   Env vars injected: ECR_REPO, SERVICE_NAME, AWS_ACCOUNT_ID, AWS_REGION
   Privileged: true (Docker)
   Output: PushOutput (imagedefinitions.json)

7. Deploy → ECS: Rolling deployment with circuit breaker
   Input: PushOutput (imagedefinitions.json)
   Container name: {service}-container

8. ContractTest → CodeBuild: Dredd API contract testing (post-deploy)
   Buildspec: buildspecs/buildspec-contract-test.yml
   Input: SwaggerGenOutput (uses swagger.json from stage 3)
   Tests deployed API against OpenAPI spec
   All mismatches reported as WARNINGS only (never fails build)
   Output: ContractTestOutput (dredd-report.xml, dredd-warnings.json)

```

```

---

## Buildspec Strategy

```

All 6 buildspecs are GENERIC — live in the infra repo, not per-project.
Each project only needs a Dockerfile in its source repo.

┌──────────────────────────────────────────────────────────────────────┐
│ buildspecs/ │
│ │
│ buildspec-source.yml — Clone Azure DevOps repo via PAT │
│ Retrieves PAT from Secrets Manager │
│ URL-encodes project name (spaces/dots) │
│ Copies buildspecs/ + governance configs │
│ into source output │
│ │
│ buildspec-swagger-gen.yml — Generate OpenAPI spec from ASP.NET │
│ Uses existing spec if found in source │
│ Otherwise: dotnet build + Swashbuckle │
│ Fallback: start app + curl swagger │
│ Output: swagger.json at artifact root │
│ │
│ buildspec-lint.yml — API governance with Spectral │
│ Uses .spectral.yml shared ruleset │
│ error severity → blocks build + SNS │
│ warn/info → reported, no block │
│ Output: spectral-report.json │
│ │
│ buildspec-build.yml — Generic Docker build │
│ Uses Dockerfile at repo root (convention)│
│ Tags image with commit SHA │
│ Override: DOCKERFILE_PATH env var │
│ │
│ buildspec-push.yml — Generic ECR push │
│ ECR auth + docker build + push │
│ Generates imagedefinitions.json │
│ Container name: ${SERVICE_NAME}-container│
│ All values from CodeBuild env vars │
│ │
│ buildspec-contract-test.yml — Dredd API contract testing │
│ Tests deployed API against OpenAPI spec │
│ All failures → warnings (never blocks) │
│ Uses dredd-hooks.js for failure→warning │
│ Output: dredd-report.xml, warnings JSON │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ buildspecs/governance/ │
│ │
│ .spectral.yml — Spectral ruleset for API governance │
│ Naming conventions (camelCase, kebab-case paths) │
│ Security definitions (auth required) │
│ HTTP method standards (no body on GET/DELETE) │
│ Response format (RFC 9457 Problem Details) │
│ Content type (application/json) │
│ Versioning (path-based /v1/) │
│ │
│ dredd.yml — Dredd configuration for contract testing │
│ dredd-hooks.js — Dredd hooks: convert failures to warnings │
│ Adds auth headers, request IDs │
│ Collects warnings report (dredd-warnings.json) │
└──────────────────────────────────────────────────────────────────────┘

Per-project requirement: Only a Dockerfile at the repo root.
The Dockerfile handles all build logic (multi-stage builds for .NET, Node, etc.)

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
                  │  ALB SG: IN 80,443
                  │    from VpcLink SG
                  │
                  │  Listener: HTTP :80
                  │  Default: 404 JSON
                  │
                  │  Per-project rules:
                  │   /api/cash/*  → TG-A
                  │   /api/poultry/* → TG-B
                  │   /api/swine/*  → TG-C
                  │   (priority-based)
                  └───────────┬────────────┘
                              │
                  ┌───────────▼────────────┐
                  │  ECS Fargate/EC2 Service│
                  │  (per project)          │
                  │  ECS SG: IN 80 from ALB │
                  │                         │
                  │  Task Definition:       │
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

Internet
│
▼
┌──────────────────────────┐
│ VpcLink SG │
│ Ingress: TCP 443 from │
│ 0.0.0.0/0 │
└───────────┬──────────────┘
│
▼
┌──────────────────────────┐
│ ALB SG │
│ Ingress: TCP 80 from │
│ VpcLink SG │
│ Ingress: TCP 443 from │
│ VpcLink SG │
└───────────┬──────────────┘
│
▼
┌──────────────────────────┐
│ ECS SG │
│ Ingress: TCP 80 from │
│ ALB SG │
│ Egress: TCP 443 to │
│ 0.0.0.0/0 │
│ Egress: TCP 1433 to │
│ 10.0.0.0/16 │
└──────────────────────────┘

┌──────────────────────────┐
│ CodeBuild SG │
│ Ingress: (none) │
│ Egress: TCP 443 to │
│ 0.0.0.0/0 │
│ Egress: TCP 80 to │
│ 0.0.0.0/0 │
└──────────────────────────┘

```

---

## IAM Roles

```

┌────────────────────────────────────────────────────────────────────────┐
│ Shared IAM Roles (from main.yaml IamStack) │
│ │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ │
│ │ CodePipeline Role │ │ CodeBuild Role │ │
│ │ • S3 artifact access │ │ • CloudWatch Logs │ │
│ │ • CodeBuild start/get │ │ • Secrets Manager (PAT) │ │
│ │ • ECS update/describe │ │ • ECR auth + push │ │
│ │ • ECS register taskdef │ │ • S3 artifacts │ │
│ │ • SNS publish │ │ • VPC network interface │ │
│ │ • IAM PassRole (ECS) │ │ • CodeBuild reports │ │
│ │ │ │ • SNS publish (lint) │ │
│ └─────────────────────────┘ └─────────────────────────┘ │
│ │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ │
│ │ ECS Execution Role │ │ ECS Task Role │ │
│ │ • AmazonECSTaskExec │ │ • CloudWatch Logs │ │
│ │ • Secrets Manager (DB) │ │ • SSM Messages │ │
│ │ • KMS decrypt │ │ • X-Ray tracing │ │
│ └─────────────────────────┘ └─────────────────────────┘ │
│ │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ │
│ │ EC2 Instance Role │ │ Webhook Lambda Role │ │
│ │ (EC2 mode only) │ │ • Lambda basic exec │ │
│ │ • ECS agent register │ │ • CodePipeline start │ │
│ │ • ECR pull images │ │ (\*-pipeline pattern) │ │
│ │ • CloudWatch Logs │ │ │ │
│ │ • SSM for management │ │ │ │
│ └─────────────────────────┘ └─────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘

All per-project resources (pipelines, CodeBuild projects, ECS services)
reference these shared roles via Fn::ImportValue.

```

---

## EC2 Compute Type (Alternative to Fargate)

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  EC2-Based ECS Deployment                                              │
  │                                                                        │
  │  Two-tier model mirroring Fargate:                                     │
  │  • Shared: main-ec2.yaml (7 stacks — same as main.yaml)               │
  │  • Per-project: project-ec2.yaml (same resources as project.yaml)      │
  │                                                                        │
  │  ⚠️ SEPARATE DEPLOYMENT — does NOT share resources with Fargate.       │
  │  Stack name: {project}-{env}-ec2-main (vs {project}-{env}-main)       │
  │  Export prefix: -ec2- for shared resources                             │
  │                                                                        │
  │  Shared stacks (main-ec2.yaml — identical to main.yaml except cluster):│
  │  ├── VpcStack              → vpc.yaml                                  │
  │  ├── SecurityGroupsStack   → security-groups.yaml                      │
  │  ├── IamStack              → iam.yaml (+ EC2 Instance Profile)         │
  │  ├── AlbStack              → alb.yaml                                  │
  │  ├── ApiGatewayStack       → api-gateway.yaml                          │
  │  ├── EcsEc2ClusterStack    → ecs-ec2-cluster.yaml (EC2-specific)       │
  │  └── MonitoringStack       → monitoring.yaml (points to EC2 cluster)   │
  │                                                                        │
  │  EC2-Specific Resources (in EcsEc2ClusterStack):                       │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Launch Template                                                │   │
  │  │  • ECS-optimized Amazon Linux 2023 AMI (SSM parameter)         │   │
  │  │  • Instance type: t3.medium (configurable)                      │   │
  │  │  • EBS gp3, encrypted, 30GB+ root volume                       │   │
  │  │  • Detailed CloudWatch monitoring enabled                       │   │
  │  │  • User data: ECS_CLUSTER config, metadata, spot draining       │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Auto Scaling Group                                             │   │
  │  │  • Multi-AZ (private subnets)                                   │   │
  │  │  • Min: 1, Max: 10, Desired: 2 (configurable)                  │   │
  │  │  • Scale-in protection for ECS-managed instances                │   │
  │  │  • Rolling update policy                                        │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Capacity Provider                                              │   │
  │  │  • Managed scaling: target capacity 100%                        │   │
  │  │  • Managed termination protection: enabled                      │   │
  │  │  • Instance warmup: 300s                                        │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │                                                                        │
  │  Per-project differences (project-ec2.yaml vs project.yaml):           │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Task Definition                                                │   │
  │  │  • RequiresCompatibilities: [EC2] (vs [FARGATE])                │   │
  │  │  • Container: Cpu: 0, MemoryReservation: 512 (soft limits)     │   │
  │  │  • Family: {infra}-{env}-{service}-ec2                         │   │
  │  │  • Network mode: awsvpc (same as Fargate for ALB integration)  │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  ECS Service                                                    │   │
  │  │  • CapacityProviderStrategy (vs LaunchType: FARGATE)            │   │
  │  │  • Rolling deploy + circuit breaker + auto rollback             │   │
  │  │  • EnableExecuteCommand, EnableECSManagedTags, PropagateTags    │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Pipeline Stage 7 (Deploy)                                      │   │
  │  │  • Targets Ec2ClusterName (vs EcsClusterName)                   │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  Log Group                                                      │   │
  │  │  • /ecs/{infra}-{env}-{service}-ec2 (vs no -ec2 suffix)        │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │                                                                        │
  │  Cost tracking: ComputeType=ec2 tag on all resources                  │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## Secrets Management (Per-Project)

```

┌──────────────────────────────────────────────────────────────┐
│ AWS Secrets Manager (created by project.yaml / project-ec2.yaml) │
│ │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ {infra}/{env}/{service}/azure-devops-pat │ │
│ │ • pat: Azure DevOps Personal Access Token │ │
│ │ • Accessed by: CodeBuild (Source stage) │ │
│ │ • Set via: --pat flag or ./scripts/setup-pat.sh │ │
│ └────────────────────────────────────────────────────────┘ │
│ │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ {infra}/{env}/{service}/db/connection-strings │ │
│ │ • ConnectionStrings\_\_Default │ │
│ │ • Accessed by: ECS Execution Role │ │
│ │ • Injected as: Container environment variables │ │
│ └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

```

---

## API Governance

```

┌──────────────────────────────────────────────────────────────────────────┐
│ API Governance Pipeline Stages │
│ │
│ Stage 3: SwaggerGen │
│ • Extracts OpenAPI spec from ASP.NET Swashbuckle at build time │
│ • Uses existing swagger.json if found in source repo │
│ • Fallback: dotnet build + swagger tofile, or start app + curl │
│ │
│ Stage 4: Lint (Spectral) │
│ • Validates OpenAPI spec against .spectral.yml ruleset │
│ • Rules: naming conventions, security, HTTP methods, response format │
│ • error severity → BLOCKS build + SNS notification │
│ • warn/info severity → reported, does NOT block │
│ │
│ Stage 8: ContractTest (Dredd) │
│ • Tests deployed API against OpenAPI specification │
│ • All mismatches reported as WARNINGS only │
│ • Build NEVER fails due to contract violations │
│ • Rationale: specs may depend on partner specifications │
│ │
│ Governance Config (in trigger.zip): │
│ • .spectral.yml — Shared linting ruleset │
│ • dredd.yml — Dredd test configuration │
│ • dredd-hooks.js — Converts failures to warnings │
└──────────────────────────────────────────────────────────────────────────┘

```

---

## Webhook Integration (Azure DevOps → AWS)

```

┌──────────────────────────────────────────────────────────────────────────┐
│ Azure DevOps Webhook → API Gateway → Lambda → CodePipeline │
│ │
│ POST /webhook/{service} │
│ • Lambda extracts {service} from path parameter │
│ • Builds pipeline name: {project}-{env}-{service}-pipeline │
│ • Calls codepipeline:StartPipelineExecution │
│ • Filters: only git.push / code.push events trigger pipeline │
│ • Returns 404 if pipeline not found for service │
│ │
│ Example: │
│ POST https://api-id.execute-api.us-east-1.amazonaws.com/webhook/hsbc │
│ → Triggers: japfa-api-dev-hsbc-pipeline │
└──────────────────────────────────────────────────────────────────────────┘

```

---

## Monitoring & Observability

```

┌──────────────────────────────────────────────────────────────────────────┐
│ Monitoring Stack (shared — from main.yaml) │
│ │
│ SNS Topic (KMS encrypted) ← Alarms + EventBridge rules + Lint errors │
│ │
│ CloudWatch Dashboard: │
│ • ECS Cluster CPU/Memory utilization │
│ • Pipeline metrics (when pipeline name provided) │
│ │
│ CloudWatch Alarms: │
│ • ECS CPU >= 80%, Memory >= 80%, Running Tasks < 1 │
│ • ALB Unhealthy Hosts >= 1, Response Time >= 5s, 5xx >= 10 │
│ • Pipeline Failure (conditional — when pipeline exists) │
│ │
│ EventBridge Rules (conditional): │
│ • Pipeline State Change (FAILED, SUCCEEDED, CANCELED) │
│ • Pipeline Stage/Action Failure │
│ │
│ Per-Project Log Groups (created by project.yaml): │
│ • /ecs/{infra}-{env}-{service} │
│ • /aws/codebuild/{infra}-{env}-{service}-source │
│ • /aws/codebuild/{infra}-{env}-{service}-swagger-gen │
│ • /aws/codebuild/{infra}-{env}-{service}-lint │
│ • /aws/codebuild/{infra}-{env}-{service}-build │
│ • /aws/codebuild/{infra}-{env}-{service}-push │
│ • /aws/codebuild/{infra}-{env}-{service}-contract-test │
└──────────────────────────────────────────────────────────────────────────┘

```

---

## Scripts Reference

```

┌──────────────────────────────────────────────────────────────────────────┐
│ scripts/ │
│ │
│ deploy.sh — Deploy shared infrastructure │
│ Supports --compute-type fargate|ec2 │
│ Supports --custom-domain, --certificate-arn │
│ Supports --dry-run for template validation │
│ │
│  deploy-project.sh      — Deploy per-project stack                       │
  │                           Supports --compute-type fargate|ec2            │
  │                           Uses project.yaml (Fargate) or                 │
  │                           project-ec2.yaml (EC2) based on compute type   │
  │                           Supports --path-base (ASP.NET UsePathBase)     │
│ Supports --port (container port, default: 80) │
│ Supports --grace-period (health check grace) │
│ Supports --health-check (path, default: /health)│
│ Seeds trigger.zip with all buildspecs + │
│ governance configs, then re-triggers pipeline │
│ │
│ teardown.sh — Delete shared infrastructure │
│ Supports --compute-type fargate|ec2 │
│ Handles ECR cleanup, ECS drain, stack delete │
│ │
│ teardown-project.sh — Delete per-project stack │
│ Supports --all to teardown ALL projects │
│ Supports --delete-secrets (skip 30-day window) │
│ Handles: ECR images, versioned S3 bucket, │
│ ECS service drain, pipeline stop, task defs │
│ │
│ setup-pat.sh — Securely set Azure DevOps PAT │
│ Interactive prompt (PAT never in process list) │
│ Supports --verify to check if PAT is set │
│ │
│ check-permissions.sh — Validate AWS IAM permissions for deployment │
│ Checks 16 service categories │
│ Outputs minimum required IAM policy │
│ │
│ audit-naming-conventions.sh — Audit CloudFormation template naming │
│ Checks S3, IAM, ECS, ECR, Log Groups, SNS │
│ │
│ lib/common.sh — Colors, print helpers, stack query functions │
│ lib/cleanup.sh — Stack cleanup and force-delete utilities │
│ lib/templates.sh — Template upload and validation │
│ lib/stack-operations.sh— Stack create/update/wait operations │
│ lib/outputs.sh — Stack output display and logging │
│ lib/ecs-operations.sh — ECS service drain and EC2 cluster operations │
└──────────────────────────────────────────────────────────────────────────┘

````

---

## Deploy Commands

```bash
# Step 1: Deploy shared infrastructure (Fargate mode, once)
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1

# Step 1 (alt): Deploy shared infrastructure (EC2 mode)
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1 --compute-type ec2

# Step 1 (alt): Deploy with custom domain
./scripts/deploy.sh -e prod -b japfa-api-cfn-us-east-1 \
  --custom-domain api.my-company.com.vn \
  --certificate-arn arn:aws:acm:us-east-1:123456789:certificate/abc-123

# Step 1 (alt): Dry run to validate templates
./scripts/deploy.sh -e dev -b japfa-api-cfn-us-east-1 --dry-run

# Step 2: Deploy a project on Fargate (repeat per service)
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

# Step 2 (alt): Deploy a project on EC2
./scripts/deploy-project.sh \
  -s cash-collection \
  -o trungvudinh \
  -p "5. Cash Collection" \
  -r api-core \
  --branch feature/hsbc \
  --path "/api/cash/*" \
  --priority 100 \
  --compute-type ec2 \
  -b japfa-api-cfn-us-east-1 \
  -e dev \
  --pat "your-pat-here"

# Set PAT securely (interactive)
./scripts/setup-pat.sh -e dev -s cash-collection

# Verify PAT is configured
./scripts/setup-pat.sh -e dev -s cash-collection --verify

# Trigger pipeline manually
aws codepipeline start-pipeline-execution \
  --name japfa-api-dev-cash-collection-pipeline \
  --region us-east-1

# Teardown a single project
./scripts/teardown-project.sh -s cash-collection -e dev

# Teardown ALL projects in an environment
./scripts/teardown-project.sh --all -e dev --force

# Teardown shared infrastructure
./scripts/teardown.sh -e dev

# Check AWS permissions before deployment
./scripts/check-permissions.sh --region us-east-1

# Audit naming conventions in templates
./scripts/audit-naming-conventions.sh
````
