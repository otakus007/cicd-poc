# DevOps Audit Report (Security & Cost) — CI/CD PoC

**Project:** `cicd-poc`  
**Path audited:** `/home/tuannh/repos/cicd-poc/`  
**Date:** 2026-02-12  
**Auditor:** DevOps sub-agent  

## Scope
### Security audit
- IAM least-privilege compliance
- Secrets management (Secrets Manager, environment variables)
- Pipeline security (access controls, approval gates)
- Container security (build + registry + runtime posture)

### Cost audit
- Resource usage analysis (design-time, based on IaC defaults)
- Cost optimization opportunities
- Free tier utilization
- Over-provisioned resources / default settings that may create spend

## Method
Static review of CloudFormation templates, buildspecs, and deployment scripts:
- `infrastructure/*.yaml`
- `buildspecs/*.yml`
- `scripts/*.sh`

> Note: This is a **design/configuration audit**. No AWS account billing data, CloudTrail, or runtime metrics were available. Cost items are therefore **expected cost drivers** and **risk hotspots** based on the provisioned architecture.

---

# 1) Security Audit Report

## 1.1 Architecture & trust boundaries (quick recap)
- Source: Azure DevOps repo cloned by **CodeBuild** using **PAT** retrieved from **AWS Secrets Manager** (`buildspecs/buildspec-source.yml`).
- CI/CD Orchestration: **CodePipeline** with stages `Source (S3) → CloneSource → SwaggerGen → Lint → Build → Push → Deploy → ContractTest` (per-service pipeline in `infrastructure/project.yaml`, shared variant in `infrastructure/codepipeline.yaml`).
- Deployment target: **ECS Fargate** in private subnets behind an **internal ALB**.
- Entry: **API Gateway HTTP API** with **VPC Link** to internal ALB.
- Webhook trigger: API Gateway route `POST /webhook/{service}` invokes Lambda to start CodePipeline execution (`infrastructure/api-gateway.yaml`).

---

## 1.2 Findings summary
| ID | Area | Severity | Finding |
|---|------|----------|---------|
| SEC-01 | Pipeline access control | **Critical** | Webhook endpoint can trigger pipelines without authentication/authorization (publicly callable) |
| SEC-02 | Network / SG | **High** | VPC Link security group allows **ingress 443 from 0.0.0.0/0** (unnecessary exposure) |
| SEC-03 | IAM | **High** | CodeBuild SecretsManager access pattern includes overly broad secret ARNs (risk of secret sprawl access) |
| SEC-04 | Secrets Mgmt | **Medium** | Secrets Manager resource policies use `Principal: root` + tag condition (works, but is easier to bypass via role tagging than explicit role ARN) |
| SEC-05 | Pipeline governance | **Medium** | No approval gates for prod deployments (manual approval / change control) |
| SEC-06 | Container security | **Medium** | No image vulnerability scan gating/signing; ECR tags are mutable; no SBOM/provenance |
| SEC-07 | CodeBuild hardening | **Medium** | Docker builds require `PrivilegedMode: true`; no extra isolation controls; Build/Push projects are not VPC-attached in per-service stack |
| SEC-08 | Runtime hardening | **Low/Medium** | ECS task definitions don’t enforce `ReadonlyRootFilesystem`, non-root user, or seccomp options (depends on app needs) |

---

## 1.3 Detailed security assessment

### SEC-01 (Critical) — Unauthenticated webhook can trigger deployments
**Evidence**
- `infrastructure/api-gateway.yaml` defines `POST /webhook/{service}` → Lambda proxy integration.
- Lambda code accepts request and triggers pipeline based only on `{service}` path parameter and optional header `x-azure-devops-event`.
- No authN/authZ controls (no Lambda Authorizer/JWT authorizer; no shared secret validation; no IP allow-list; no signature verification).

**Impact**
- Anyone with the endpoint URL can:
  - Trigger pipelines repeatedly (DoS + cost increase)
  - Cause repeated deployments (availability risk)
  - Create noise in logs/alerts

**Recommendation**
- Add at least one of the following controls (prefer layered controls):
  1. **Shared secret token**: Require a header (e.g. `X-Webhook-Token`) and validate against Secrets Manager/SSM Parameter Store.
  2. **Lambda Authorizer** (HTTP API): Validate HMAC/JWT/token.
  3. **IP allow-list**: Restrict to Azure DevOps outbound IP ranges (operationally heavy; ranges change).
  4. **Rate limiting**: Add WAF (if REST API) or implement throttling + token bucket logic in Lambda; also keep API Gateway throttles low for webhook route.
  5. **Service allow-list**: Maintain a mapping of allowed service names → pipeline names, not string concatenation.

**Remediation (example approach)**
- Store token in Secrets Manager (or SSM SecureString) and rotate periodically.
- Update Lambda to:
  - Reject if token missing/invalid
  - Validate Azure event type and optionally check payload fields
  - Enforce minimal request body size

---

### SEC-02 (High) — VPC Link SG ingress 0.0.0.0/0 is unnecessary
**Evidence**
- `infrastructure/security-groups.yaml`:
  - `VpcLinkSecurityGroup` has ingress `tcp/443` from `0.0.0.0/0`.

**Notes**
- API Gateway VPC Link creates ENIs in subnets and uses the SG primarily for **egress** to the integration target. Ingress rules are typically unnecessary and broaden the attack surface.

**Recommendation**
- Remove ingress rules for VPC Link SG (make it egress-only), or restrict ingress to VPC CIDR if absolutely required.
- Keep ALB SG allowing inbound only from VPC Link SG (already good).

---

### SEC-03 (High) — CodeBuild secret access is broader than needed
**Evidence**
- `infrastructure/iam.yaml` CodeBuild policy `SecretsManagerPatAccess` allows:
  - `arn:aws:secretsmanager:...:secret:${ProjectName}/${Environment}/*/azure-devops-pat*`
  - `arn:aws:secretsmanager:...:secret:${ProjectName}/${Environment}/azure-devops-pat*`
  - `arn:aws:secretsmanager:...:secret:azure-devops-pat*`

**Impact**
- If additional secrets are introduced that match these patterns, CodeBuild can read them.
- Increases blast radius if CodeBuild role is compromised.

**Recommendation**
- Restrict to **exact secret ARNs** per service:
  - For per-service stack: `${InfraProjectName}/${Environment}/${ServiceName}/azure-devops-pat`
  - For shared stack: only the secret(s) actually used.
- Consider adding `Condition` on `secretsmanager:ResourceTag/Service == <service>` to constrain access by tags.

---

### SEC-04 (Medium) — Secrets Manager resource policy uses root principal + tag condition
**Evidence**
- `infrastructure/secrets.yaml` resource policies:
  - `Principal: arn:aws:iam::<acct>:root`
  - Condition uses `aws:PrincipalTag/Purpose`.

**Impact**
- This works as a “tag-based allow”, but any principal in the account that can set its own tags (or be tagged by an admin) could satisfy the condition.

**Recommendation**
- Prefer explicit principal ARNs:
  - CodeBuild role ARN for PAT secret
  - ECS execution role ARN for DB secret
- Keep `DenyInsecureTransport` (good).

---

### SEC-05 (Medium) — No approval gate for production
**Evidence**
- `infrastructure/codepipeline.yaml` and `infrastructure/project.yaml` pipelines have no manual approval stage.

**Impact**
- Accidental or malicious pipeline triggers can promote changes straight to prod.

**Recommendation**
- Add `ManualApproval` action before `Deploy` for `prod` (and optionally `staging`).
- Optionally require lint/security scan stages to pass (see SEC-06).

---

### SEC-06 (Medium) — Container supply-chain controls missing
**Evidence**
- ECR scan-on-push enabled (`infrastructure/ecr.yaml`, `infrastructure/project.yaml`).
- No build step performs vulnerability scanning (Trivy/Grype), SBOM generation (Syft), or signing (cosign/Sigstore).
- ECR in shared template uses `ImageTagMutability: MUTABLE`.

**Impact**
- Vulnerable images may still deploy.
- Mutable tags complicate traceability and rollback safety.

**Recommendation**
- Add in pipeline after Build/Push:
  - **Vuln scan stage** (fail build on High/Critical in prod)
  - **SBOM generation** + store artifact
  - Optionally **sign images** and verify on deploy
- Set ECR repos to `IMMUTABLE` where feasible and deploy by digest.

---

### SEC-07 (Medium) — CodeBuild privileged builds need extra guardrails
**Evidence**
- Build and Push CodeBuild projects use `PrivilegedMode: true` (required for Docker builds).

**Risks**
- Privileged containers expand the blast radius in case of malicious build steps.

**Recommendation**
- Ensure build IAM role is extremely minimal (see SEC-03).
- Consider:
  - Separate AWS account for CI
  - Restrict outbound egress (VPC + egress proxy) if compliance requires
  - Use newer CodeBuild images (e.g., standard 7.x) for patched dependencies

---

### SEC-08 (Low/Medium) — ECS runtime hardening opportunities
**Evidence**
- `infrastructure/task-definition.yaml`:
  - `ReadonlyRootFilesystem: false`
  - No explicit `User` set for container

**Recommendation**
- If the application supports it:
  - Enable `ReadonlyRootFilesystem: true` and mount `/tmp` as writable
  - Run as non-root user (set in Dockerfile + optionally `User` in task definition)
  - Add healthcheck and least privilege environment variables (already present)

---

## 1.4 Positive controls observed
- S3 artifact buckets:
  - Encryption enabled (SSE-S3 AES256)
  - Versioning enabled
  - Lifecycle cleanup enabled
  - Deny insecure transport in bucket policy (`aws:SecureTransport: false`) in shared pipeline bucket
- Secrets are retrieved at runtime and not echoed in logs in `buildspec-source.yml`.
- ECR scan-on-push + lifecycle policies exist.
- ECS deployment uses circuit breaker + rollback in service templates.

---

## 1.5 Security remediation roadmap
### Phase 0 (0–3 days) — Stop the biggest risks
1. **Protect webhook** (SEC-01): shared secret header validation + rate limiting.
2. **Remove VPC Link SG ingress 0.0.0.0/0** (SEC-02).
3. **Restrict CodeBuild SecretsManager permissions** to exact PAT secret (SEC-03).

### Phase 1 (1–2 weeks) — Governance & supply chain
1. Add **Manual Approval** stage for prod (SEC-05).
2. Add container vuln scan stage and fail on policy thresholds (SEC-06).
3. Make ECR tags immutable / deploy by digest (SEC-06).

### Phase 2 (2–6 weeks) — Hardening
1. Tighten secrets resource policies to explicit principals (SEC-04).
2. Improve runtime hardening (non-root, read-only FS) where app permits (SEC-08).
3. Consider account separation for CI and stricter egress controls for CodeBuild (SEC-07).

---

# 2) Cost Optimization Report

## 2.1 Expected cost drivers in this PoC
### Highest expected fixed-cost items
1. **NAT Gateways (x2)** (`infrastructure/vpc.yaml`)
   - NAT Gateway hourly cost + data processing.
   - Often the **largest always-on cost** in small PoCs.

2. **Secrets Manager per secret per month** (`infrastructure/project.yaml`, `infrastructure/secrets.yaml`)
   - Per-service stack creates at least 2 secrets (PAT + DB).

3. **CodePipeline per pipeline per month**
   - Per-service pipeline model scales cost linearly with number of services.

4. **CloudWatch / Container Insights** (`infrastructure/ecs-cluster.yaml`)
   - Container Insights adds metrics/logs charges.

### Variable-cost items
- **CodeBuild minutes** (build/test/push stages; Docker builds can be slow)
- **ECR storage + image scanning**
- **CloudWatch Logs ingestion and retention**
- **API Gateway requests** (usually small unless abused—also ties to SEC-01)

---

## 2.2 Over-provisioning / default settings to watch
- `infrastructure/vpc.yaml`: two NAT Gateways for HA (great for prod, costly for dev/PoC).
- `infrastructure/ecs-cluster.yaml`: Container Insights enabled by default.
- Shared `infrastructure/ecs-service.yaml` has defaults `DesiredCount=2`, `MinCapacity=2` (if used, this becomes always-on). Per-service `project.yaml` defaults `DesiredCount=0` (good for PoC).
- Log retention often set to 30–90 days; in dev it may be excessive.

---

## 2.3 Optimization opportunities (ranked)

### COST-01 — Reduce NAT Gateway spend (highest ROI)
**Current**: 2× NAT Gateways (one per AZ).

**Options**
1. **Dev/PoC**: Use **single NAT Gateway** (trade HA for cost).
2. Replace some NAT usage with **VPC Endpoints** (PrivateLink / Gateway endpoints):
   - S3 (Gateway endpoint)
   - ECR (api + dkr), CloudWatch Logs, Secrets Manager, STS
   - This can materially reduce NAT data processing.
3. For very small PoC: run ECS tasks in public subnets with public IPs (not recommended for prod; may conflict with “internal only” posture).

### COST-02 — Control pipeline fan-out cost
- Each service creates:
  - 1 CodePipeline
  - multiple CodeBuild projects
  - 1 artifact bucket

**Recommendations**
- For PoC environments:
  - Consolidate into fewer pipelines (mono-repo pipeline) or reuse CodeBuild projects.
  - Disable ContractTest / SwaggerGen stages when not needed.

### COST-03 — Tune observability cost
- Container Insights is useful but can be expensive.

**Recommendations**
- Parameterize `ContainerInsightsEnabled` and default it to **disabled** for dev.
- Lower log retention for dev (e.g., 7–14 days) and keep higher for prod.

### COST-04 — Secrets Manager usage efficiency
- Secrets Manager charges per secret.

**Recommendations**
- For PoC/dev:
  - Keep PAT in Secrets Manager.
  - Consider using **SSM Parameter Store (Standard)** for non-sensitive config.
  - Consolidate DB connection strings into a single secret per environment/service where possible.

### COST-05 — Use Fargate Spot effectively
**Good practice already present**
- ECS cluster has default capacity provider strategy with `FARGATE_SPOT` weighted higher (`FargateSpotWeight=4`, `FargateBase=1`).

**Recommendation**
- Ensure services actually use capacity providers (ECS service can set strategy). For critical prod services, keep baseline on on-demand.

---

## 2.4 Free tier utilization notes
- AWS Free Tier offers limited services, but **NAT Gateway and Fargate are not meaningfully covered**.
- Cost control in PoC depends more on:
  - Keeping `DesiredCount=0` when idle
  - Minimizing NAT
  - Limiting CodeBuild runtimes

---

## 2.5 Cost optimization roadmap
### Phase 0 (immediate)
1. Fix webhook auth (SEC-01) to prevent external trigger abuse → reduces unexpected CodeBuild/CodePipeline spend.
2. Ensure PoC services default to `DesiredCount=0` (already in `project.yaml`).

### Phase 1 (1–2 weeks)
1. Add a **dev mode** networking option: single NAT Gateway.
2. Reduce log retention in dev.
3. Disable Container Insights in dev.

### Phase 2 (2–6 weeks)
1. Add VPC endpoints for S3/ECR/Logs/Secrets Manager to reduce NAT data charges.
2. Consider pipeline consolidation if number of services grows.

---

# Appendix A — Files reviewed (high-signal)
- IAM: `infrastructure/iam.yaml`
- Secrets: `infrastructure/secrets.yaml`, `infrastructure/project.yaml`
- Pipeline: `infrastructure/codepipeline.yaml`, `infrastructure/codebuild.yaml`, `infrastructure/project.yaml`
- Webhook: `infrastructure/api-gateway.yaml`
- Networking: `infrastructure/vpc.yaml`, `infrastructure/security-groups.yaml`, `infrastructure/alb.yaml`
- Buildspecs: `buildspecs/buildspec-*.yml`
- Deployment scripts: `scripts/deploy-project.sh`, `scripts/setup-pat.sh`
