# Japfa API Platform — Infrastructure Architecture (Mermaid)

## 1. High-Level Infrastructure Overview

```mermaid
flowchart TB
    subgraph Internet
        Client[Client / Browser]
        AzureDevOps[Azure DevOps<br/>Git Repositories]
    end

    subgraph AWS["AWS Cloud (us-east-1)"]
        subgraph APIGW["API Gateway"]
            HttpApi[HTTP API Gateway<br/>HTTPS + TLS 1.2+<br/>Throttle: 500 rps / Burst: 1000]
            WebhookLambda[Webhook Lambda<br/>POST /webhook/service]
        end

        subgraph VPC["VPC 10.0.0.0/16"]
            VpcLink[VPC Link<br/>Private Subnets]

            subgraph AZa["AZ-a"]
                PubSub1[Public Subnet<br/>10.0.1.0/24]
                PrivSub1[Private Subnet<br/>10.0.10.0/24]
                NAT1[NAT Gateway 1<br/>+ Elastic IP]
            end

            subgraph AZb["AZ-b"]
                PubSub2[Public Subnet<br/>10.0.2.0/24]
                PrivSub2[Private Subnet<br/>10.0.11.0/24]
                NAT2[NAT Gateway 2<br/>+ Elastic IP]
            end

            IGW[Internet Gateway]

            subgraph ALBLayer["Load Balancing (Shared)"]
                ALB[Internal ALB<br/>HTTP :80<br/>Default: 404 JSON]
            end

            subgraph ProjectA["Project: cash-collection"]
                TG_A[Target Group A<br/>/api/cash/*]
                SVC_A[ECS Service A<br/>Fargate / EC2]
                Pipeline_A[Pipeline A<br/>8 stages]
            end

            subgraph ProjectB["Project: poultry-sale"]
                TG_B[Target Group B<br/>/api/poultry/*]
                SVC_B[ECS Service B<br/>Fargate / EC2]
                Pipeline_B[Pipeline B<br/>8 stages]
            end
        end

        subgraph SharedInfra["Shared Resources (per compute type)"]
            ECSCluster[ECS Cluster<br/>Fargate: FARGATE + FARGATE_SPOT<br/>EC2: separate cluster + Capacity Provider<br/>Both: 7 shared stacks + per-project stacks]
            IAMRoles[IAM Roles<br/>Pipeline, CodeBuild,<br/>ECS Exec, ECS Task,<br/>EC2 Instance, Webhook Lambda]
        end

        subgraph PerProject["Per-Project Resources"]
            ECR_A[ECR: cash-collection]
            ECR_B[ECR: poultry-sale]
            PAT_A[Secrets: PAT A]
            PAT_B[Secrets: PAT B]
            S3_A[Artifacts: A]
            S3_B[Artifacts: B]
        end

        subgraph Monitoring["Monitoring (Shared)"]
            SNS[SNS Topic<br/>KMS Encrypted]
            CWDash[CloudWatch Dashboard]
            Alarms[CloudWatch Alarms]
        end
    end


    Client -->|HTTPS| HttpApi
    HttpApi --> VpcLink
    HttpApi --> WebhookLambda
    WebhookLambda -.->|StartPipeline| Pipeline_A
    WebhookLambda -.->|StartPipeline| Pipeline_B
    VpcLink --> ALB
    ALB -->|/api/cash/*| TG_A
    ALB -->|/api/poultry/*| TG_B
    TG_A --> SVC_A
    TG_B --> SVC_B
    ECSCluster --> SVC_A
    ECSCluster --> SVC_B

    AzureDevOps -.->|PAT clone| Pipeline_A
    AzureDevOps -.->|PAT clone| Pipeline_B
    AzureDevOps -.->|Webhook POST| WebhookLambda

    Pipeline_A -->|Deploy| SVC_A
    Pipeline_B -->|Deploy| SVC_B
    Pipeline_A -->|Push| ECR_A
    Pipeline_B -->|Push| ECR_B

    IGW --- PubSub1
    IGW --- PubSub2
    NAT1 -.->|Outbound| PrivSub1
    NAT2 -.->|Outbound| PrivSub2

    Alarms --> SNS

    style AWS fill:#f5f5f5,stroke:#232f3e,stroke-width:2px
    style VPC fill:#e8f4e8,stroke:#1b660f,stroke-width:2px
    style ALBLayer fill:#fce4ec,stroke:#c62828,stroke-width:1px
    style ProjectA fill:#e3f2fd,stroke:#1565c0,stroke-width:1px
    style ProjectB fill:#fff3e0,stroke:#e65100,stroke-width:1px
    style SharedInfra fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px
    style Monitoring fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px

```

## 2. Deployment Model — Two-Tier Architecture

```mermaid
flowchart TB
    subgraph SharedFargate["Shared Infrastructure — Fargate (deploy.sh)"]
        Main["main.yaml<br/>(Root Stack)"]
        Main --> VPC["VpcStack<br/>vpc.yaml"]
        Main --> SG["SecurityGroupsStack<br/>security-groups.yaml"]
        Main --> IAM["IamStack<br/>iam.yaml"]
        Main --> ALB["AlbStack<br/>alb.yaml"]
        Main --> APIGW["ApiGatewayStack<br/>api-gateway.yaml<br/>+ Webhook Lambda"]
        Main --> ECS["EcsClusterStack<br/>ecs-cluster.yaml"]
        Main --> MON["MonitoringStack<br/>monitoring.yaml"]
    end

    subgraph SharedEC2["EC2 Infrastructure — SEPARATE (deploy.sh --compute-type ec2)"]
        MainEC2["main-ec2.yaml<br/>(Root Stack)<br/>Mirrors Fargate — separate resources"]
        MainEC2 --> VPC2["VpcStack<br/>vpc.yaml"]
        MainEC2 --> SG2["SecurityGroupsStack<br/>security-groups.yaml"]
        MainEC2 --> IAM2["IamStack<br/>iam.yaml<br/>+ EC2 Instance Profile"]
        MainEC2 --> ALB2["AlbStack<br/>alb.yaml"]
        MainEC2 --> APIGW2["ApiGatewayStack<br/>api-gateway.yaml<br/>+ Webhook Lambda"]
        MainEC2 --> EC2Cluster["EcsEc2ClusterStack<br/>ecs-ec2-cluster.yaml<br/>ASG + Launch Template<br/>+ Capacity Provider"]
        MainEC2 --> MON2["MonitoringStack<br/>monitoring.yaml<br/>Points to EC2 cluster"]
    end

    subgraph FargateExports["Fargate Exports"]
        E1[VpcId, SubnetIds]
        E2[SecurityGroupIds]
        E3[IAM Role ARNs]
        E4[ALB ListenerArn]
        E5[ECS ClusterArn]
        E6[ApiGatewayEndpoint]
        E7[NotificationTopicArn]
    end

    subgraph EC2Exports["EC2 Exports (-ec2- prefix + Ec2 prefix)"]
        E8[ec2-VpcId, ec2-SubnetIds]
        E9[ec2-AlbDnsName, ec2-AlbArn]
        E10[Ec2ClusterArn, Ec2CapacityProviderName]
        E11[ec2-ApiGatewayEndpoint]
        E12[ec2-NotificationTopicArn]
    end

    subgraph FargateProjects["Per-Project — Fargate (deploy-project.sh)"]
        P1["project.yaml<br/>cash-collection"]
        P2["project.yaml<br/>poultry-sale"]
        P3["project.yaml<br/>swine-api"]
    end

    subgraph EC2Projects["Per-Project — EC2 (deploy-project.sh --compute-type ec2)"]
        P4["project-ec2.yaml<br/>cash-collection"]
        P5["project-ec2.yaml<br/>poultry-sale"]
        P6["project-ec2.yaml<br/>swine-api"]
    end

    SharedFargate --> FargateExports
    SharedEC2 --> EC2Exports
    FargateExports --> P1
    FargateExports --> P2
    FargateExports --> P3
    EC2Exports --> P4
    EC2Exports --> P5
    EC2Exports --> P6

    style SharedFargate fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style SharedEC2 fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style FargateExports fill:#fff9c4,stroke:#f57f17,stroke-width:1px
    style EC2Exports fill:#fff9c4,stroke:#f57f17,stroke-width:1px
    style FargateProjects fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style EC2Projects fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Main fill:#ffcc80,stroke:#e65100,stroke-width:3px
    style MainEC2 fill:#b2dfdb,stroke:#00695c,stroke-width:3px
```

---

## 3. CI/CD Pipeline Flow (Per-Project — 8 Stages)

```mermaid
flowchart LR
    subgraph Trigger["Trigger"]
        S3T[S3 trigger.zip<br/>Contains buildspecs/<br/>+ governance configs]
    end

    subgraph Pipeline["CodePipeline — 8 Stages"]
        direction LR
        S1["1 Source<br/>S3 Source<br/>trigger.zip"]
        S2["2 CloneSource<br/>CodeBuild<br/>git clone via PAT<br/>SMALL, VPC mode<br/>Copies buildspecs/<br/>+ governance configs"]
        S3["3 SwaggerGen<br/>CodeBuild<br/>Extract OpenAPI spec<br/>dotnet build +<br/>Swashbuckle CLI"]
        S4["4 Lint<br/>CodeBuild<br/>Spectral API<br/>governance<br/>error→block+SNS<br/>warn→report only"]
        S5["5 Build<br/>CodeBuild<br/>docker build<br/>(Dockerfile only)<br/>MEDIUM, Privileged"]
        S6["6 Push<br/>CodeBuild<br/>ECR auth + push<br/>SMALL, Privileged"]
        S7["7 Deploy<br/>ECS Deploy<br/>Rolling update<br/>Circuit breaker"]
        S8["8 ContractTest<br/>CodeBuild<br/>Dredd testing<br/>Warnings only<br/>Never blocks"]
    end

    subgraph Artifacts["Artifacts"]
        A_Trigger[TriggerOutput<br/>buildspecs/ + governance]
        A_Source[SourceOutput<br/>code + buildspecs/]
        A_Swagger[SwaggerGenOutput<br/>code + swagger.json]
        A_Lint[LintOutput<br/>spectral-report.json]
        A_Build[BuildOutput<br/>code + metadata]
        A_Push[PushOutput<br/>imagedefinitions.json]
        A_Contract[ContractTestOutput<br/>dredd-report.xml]
    end

    subgraph External["External Services"]
        ADO[Azure DevOps<br/>Source Repo]
        ECR[ECR Repository]
        ECSvc[ECS Fargate/EC2 Service]
        SM[Secrets Manager<br/>PAT]
        SNST[SNS Topic<br/>Lint error alerts]
    end

    S3T --> S1
    S1 -->|TriggerOutput| S2
    S2 -->|SourceOutput| S3
    S3 -->|SwaggerGenOutput| S4
    S4 -->|LintOutput| S5
    S5 -->|BuildOutput| S6
    S6 -->|PushOutput| S7
    S7 --> S8

    S2 -.->|Get PAT| SM
    S2 -.->|Clone| ADO
    S4 -.->|Error alert| SNST
    S6 -.->|Push image| ECR
    S7 -.->|Update service| ECSvc

    S1 --- A_Trigger
    S2 --- A_Source
    S3 --- A_Swagger
    S4 --- A_Lint
    S5 --- A_Build
    S6 --- A_Push
    S8 --- A_Contract

    style Pipeline fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style Trigger fill:#fff3e0,stroke:#e65100,stroke-width:1px
    style S7 fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style S4 fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style S8 fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
```

---

## 4. Buildspec Strategy — Generic (Dockerfile Only) + API Governance

```mermaid
flowchart TB
    subgraph InfraRepo["Infra Repo (buildspecs/)"]
        BS1["buildspec-source.yml<br/>Generic: clone + copy buildspecs<br/>+ governance configs"]
        BS2["buildspec-swagger-gen.yml<br/>Generic: extract OpenAPI spec<br/>from ASP.NET Swashbuckle"]
        BS3["buildspec-lint.yml<br/>Generic: Spectral API governance<br/>error→block, warn→report"]
        BS4["buildspec-build.yml<br/>Generic: docker build<br/>Convention: Dockerfile at root"]
        BS5["buildspec-push.yml<br/>Generic: ECR push<br/>All values from env vars"]
        BS6["buildspec-contract-test.yml<br/>Generic: Dredd contract testing<br/>All failures → warnings"]
    end

    subgraph GovernanceConfig["Governance Config (buildspecs/governance/)"]
        G1[".spectral.yml<br/>API linting ruleset<br/>naming, security, HTTP methods,<br/>response format, versioning"]
        G2["dredd.yml<br/>Dredd test configuration"]
        G3["dredd-hooks.js<br/>Convert failures to warnings<br/>Collect warnings report"]
    end

    subgraph TriggerZip["trigger.zip"]
        T1[buildspecs/buildspec-source.yml]
        T2[buildspecs/buildspec-swagger-gen.yml]
        T3[buildspecs/buildspec-lint.yml]
        T4[buildspecs/buildspec-build.yml]
        T5[buildspecs/buildspec-push.yml]
        T6[buildspecs/buildspec-contract-test.yml]
        T7[.spectral.yml]
        T8[dredd.yml + dredd-hooks.js]
        T9[trigger.json]
    end

    subgraph ProjectRepo["Project Source Repo<br/>(Azure DevOps)"]
        DF[Dockerfile<br/>Multi-stage build<br/>Handles compile/publish]
        Code[Application Code]
        OptSpec[swagger.json<br/>optional]
    end

    InfraRepo -->|bundled into| TriggerZip
    GovernanceConfig -->|bundled into| TriggerZip
    TriggerZip -->|Stage 1: Source| ST1[S3 Source]
    ST1 -->|Stage 2: Clone| ST2[CloneSource]
    ST2 -->|Clones| ProjectRepo
    ST2 -->|Stage 3| ST3[SwaggerGen<br/>Extract/use OpenAPI spec]
    ST3 -->|Stage 4| ST4[Lint<br/>Spectral governance]
    ST4 -->|Stage 5| ST5[Build<br/>docker build]
    ST5 -->|Stage 6| ST6[Push<br/>ECR push]
    ST6 -->|Stage 7| ST7[Deploy<br/>ECS rolling update]
    ST7 -->|Stage 8| ST8[ContractTest<br/>Dredd vs deployed API]

    style InfraRepo fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style GovernanceConfig fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style ProjectRepo fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style TriggerZip fill:#fff3e0,stroke:#e65100,stroke-width:1px
```

---

## 5. Request Flow (Detailed)

```mermaid
sequenceDiagram
    participant C as Client
    participant APIGW as API Gateway<br/>(HTTP API)
    participant WH as Webhook Lambda
    participant VL as VPC Link
    participant ALB as Internal ALB
    participant TG as Target Group<br/>(per project)
    participant ECS as ECS Fargate/EC2 Task
    participant SM as Secrets Manager
    participant DB as Database
    participant CW as CloudWatch Logs
    participant CP as CodePipeline

    C->>+APIGW: HTTPS Request<br/>ANY /api/{proxy+}
    Note over APIGW: TLS 1.2+ termination<br/>Throttle: 500 rps
    APIGW->>+VL: Forward via VPC Link
    VL->>+ALB: HTTP to ALB
    Note over ALB: Path-based routing<br/>/api/cash/* → TG-A<br/>/api/poultry/* → TG-B
    ALB->>+TG: Route by path pattern
    Note over TG: Health: GET /health<br/>Interval: 30s
    TG->>+ECS: Forward to container

    ECS->>SM: Get DB credentials
    SM-->>ECS: Connection strings

    ECS->>DB: Query
    DB-->>ECS: Result

    ECS->>CW: Log request

    ECS-->>-TG: HTTP Response
    TG-->>-ALB: Response
    ALB-->>-VL: Response
    VL-->>-APIGW: Response
    APIGW-->>-C: HTTPS Response

    Note over C,CP: Webhook Flow (Azure DevOps → Pipeline)
    C->>+APIGW: POST /webhook/{service}
    APIGW->>+WH: Invoke Lambda
    WH->>+CP: StartPipelineExecution
    CP-->>-WH: ExecutionId
    WH-->>-APIGW: 200 OK
    APIGW-->>-C: Pipeline triggered
```

---

## 6. VPC Network Architecture

```mermaid
flowchart TB
    Internet((Internet))

    subgraph VPC["VPC 10.0.0.0/16"]
        IGW[Internet Gateway]

        subgraph PublicLayer["Public Subnets"]
            subgraph PubAZa["AZ-a: 10.0.1.0/24"]
                NAT1[NAT Gateway 1<br/>Elastic IP]
            end
            subgraph PubAZb["AZ-b: 10.0.2.0/24"]
                NAT2[NAT Gateway 2<br/>Elastic IP]
            end
        end

        subgraph PrivateLayer["Private Subnets"]
            subgraph PrivAZa["AZ-a: 10.0.10.0/24"]
                ALB_a[ALB Node]
                ECS_a[ECS Tasks<br/>Fargate / EC2]
                CB_a[CodeBuild]
            end
            subgraph PrivAZb["AZ-b: 10.0.11.0/24"]
                ALB_b[ALB Node]
                ECS_b[ECS Tasks<br/>Fargate / EC2]
                CB_b[CodeBuild]
            end
        end
    end

    Internet <-->|Public traffic| IGW
    IGW <--> PubAZa
    IGW <--> PubAZb

    NAT1 -->|Outbound for AZ-a| PrivAZa
    NAT2 -->|Outbound for AZ-b| PrivAZb

    style VPC fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    style PublicLayer fill:#e3f2fd,stroke:#0d47a1,stroke-width:1px
    style PrivateLayer fill:#fce4ec,stroke:#b71c1c,stroke-width:1px
```

---

## 7. Security Groups Chain

```mermaid
flowchart LR
    Internet((Internet)) -->|TCP 443| VpcLinkSG

    subgraph VpcLinkSG["VpcLink SG"]
        VL_IN["Ingress: TCP 443<br/>from 0.0.0.0/0"]
    end

    VpcLinkSG -->|TCP 80, 443| AlbSG

    subgraph AlbSG["ALB SG"]
        ALB_IN["Ingress: TCP 80, 443<br/>from VpcLink SG"]
    end

    AlbSG -->|TCP 80| EcsSG

    subgraph EcsSG["ECS SG"]
        ECS_IN["Ingress: TCP 80 from ALB SG"]
        ECS_OUT["Egress: TCP 443 → any<br/>TCP 1433 → VPC"]
    end

    EcsSG -->|TCP 443| AWSAPIs((AWS APIs))
    EcsSG -->|TCP 1433| DB[(Database)]

    subgraph CodeBuildSG["CodeBuild SG"]
        CB_OUT["Egress: TCP 443, 80<br/>→ 0.0.0.0/0"]
    end

    style VpcLinkSG fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style AlbSG fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    style EcsSG fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style CodeBuildSG fill:#e0f2f1,stroke:#00695c,stroke-width:2px
```

---

## 8. ALB Path-Based Routing (Multi-Project)

```mermaid
flowchart TB
    ALB[Internal ALB<br/>HTTP :80]

    ALB -->|Priority 100<br/>/api/cash/*| TG1[Target Group<br/>cash-collection]
    ALB -->|Priority 200<br/>/api/poultry/*| TG2[Target Group<br/>poultry-sale]
    ALB -->|Priority 300<br/>/api/swine/*| TG3[Target Group<br/>swine-api]
    ALB -->|Default<br/>No match| D[404 JSON<br/>Service not found]

    TG1 --> SVC1[ECS Service<br/>cash-collection]
    TG2 --> SVC2[ECS Service<br/>poultry-sale]
    TG3 --> SVC3[ECS Service<br/>swine-api]

    style ALB fill:#fce4ec,stroke:#c62828,stroke-width:2px
    style D fill:#ffcdd2,stroke:#c62828,stroke-width:1px
    style TG1 fill:#e3f2fd,stroke:#1565c0
    style TG2 fill:#fff3e0,stroke:#e65100
    style TG3 fill:#e8f5e9,stroke:#2e7d32
```

---

## 9. ECS Deployment Strategy

```mermaid
flowchart TD
    Start([Service Running<br/>Stable]) --> Trigger[New image pushed<br/>via CodePipeline]
    Trigger --> Launch[Launch new task<br/>MaxPercent 200%]
    Launch --> HC{Health Check<br/>/health}
    HC -->|200 OK| Register[Register with ALB TG<br/>Deregister old task]
    HC -->|Fails| CB[Circuit Breaker<br/>Triggered]
    Register --> Drain[Drain old task<br/>30s deregistration]
    Drain --> Done([All tasks updated<br/>MinHealthy 50%])
    CB --> Rollback[Auto Rollback<br/>Previous task def]
    Rollback --> Done

    style Start fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style Done fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style CB fill:#ffcdd2,stroke:#c62828,stroke-width:2px
    style Rollback fill:#fff9c4,stroke:#f57f17,stroke-width:2px
```

---

## 10. Monitoring & Observability

```mermaid
flowchart TB
    subgraph Sources["Metric Sources"]
        ECS_M["ECS Services<br/>CPU / Memory / Tasks"]
        ALB_M["ALB<br/>Health / Latency / 5xx"]
        CP["CodePipeline<br/>State Changes"]
        LINT["Lint Stage<br/>Governance Errors"]
    end

    subgraph CWAlarms["CloudWatch Alarms"]
        A1["ECS CPU >= 80%"]
        A2["ECS Memory >= 80%"]
        A3["Running Tasks < 1"]
        A4["Unhealthy Hosts >= 1"]
        A5["Response Time >= 5s"]
        A6["HTTP 5xx >= 10"]
        A7["Pipeline Failure<br/>(conditional)"]
    end

    subgraph EventRules["EventBridge Rules (conditional)"]
        ER1["Pipeline State Change"]
        ER2["Stage/Action Failure"]
    end

    SNS["SNS Topic<br/>KMS Encrypted"]
    Dashboard["CloudWatch Dashboard<br/>Cluster-level metrics"]

    ECS_M --> A1
    ECS_M --> A2
    ECS_M --> A3
    ALB_M --> A4
    ALB_M --> A5
    ALB_M --> A6
    CP --> A7
    CP --> ER1
    CP --> ER2
    LINT -.->|error severity| SNS

    A1 --> SNS
    A2 --> SNS
    A3 --> SNS
    A4 --> SNS
    A5 --> SNS
    A6 --> SNS
    A7 --> SNS
    ER1 --> SNS
    ER2 --> SNS

    style Sources fill:#e3f2fd,stroke:#1565c0
    style CWAlarms fill:#fce4ec,stroke:#c62828
    style EventRules fill:#fff3e0,stroke:#e65100
    style SNS fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    style Dashboard fill:#e0f2f1,stroke:#00695c,stroke-width:2px
```

---

## 11. EC2 Compute Architecture

```mermaid
flowchart TB
    subgraph EC2Shared["main-ec2.yaml — Shared Infrastructure (mirrors main.yaml)"]
        direction TB
        Note["Separate deployment from Fargate<br/>Stack: {project}-{env}-ec2-main<br/>Exports: -ec2- prefix"]

        subgraph SharedStacks["7 Nested Stacks (same as Fargate)"]
            VPC2["VpcStack<br/>vpc.yaml"]
            SG2["SecurityGroupsStack<br/>security-groups.yaml"]
            IAM2["IamStack<br/>iam.yaml + EC2 Instance Profile"]
            ALB2["AlbStack<br/>alb.yaml"]
            APIGW2["ApiGatewayStack<br/>api-gateway.yaml<br/>+ Webhook Lambda"]
            MON2["MonitoringStack<br/>monitoring.yaml"]
        end

        subgraph EC2Specific["EC2-Specific: EcsEc2ClusterStack"]
            LT[Launch Template<br/>ECS-optimized AL2023 AMI<br/>t3.medium, gp3 30GB+<br/>ECS agent user data]
            ASG[Auto Scaling Group<br/>Min: 1, Max: 10<br/>Multi-AZ, Rolling Update<br/>Scale-in protection]
            CP[Capacity Provider<br/>Managed scaling: 100%<br/>Termination protection<br/>Warmup: 300s]
            Cluster[ECS EC2 Cluster<br/>Container Insights enabled]
        end
    end

    subgraph EC2Project["project-ec2.yaml — Per-Project (mirrors project.yaml)"]
        ECR["ECR Repository"]
        Secrets["Secrets<br/>PAT + DB"]
        TD[Task Definition<br/>RequiresCompatibilities: EC2<br/>awsvpc, Cpu: 0<br/>MemoryReservation: 512]
        SVC[ECS Service<br/>CapacityProviderStrategy<br/>Circuit breaker + rollback<br/>ECS Exec enabled]
        TG["ALB Target Group<br/>+ Listener Rule"]
        Pipeline["CodePipeline<br/>8 stages<br/>Deploy → Ec2ClusterName"]
    end

    LT --> ASG
    ASG --> CP
    CP --> Cluster
    Cluster --> SVC
    TD --> SVC
    TG --> SVC
    Pipeline -->|Stage 7| SVC
    Pipeline -->|Stage 6| ECR

    style EC2Shared fill:#f5f5f5,stroke:#424242,stroke-width:2px
    style SharedStacks fill:#e0f2f1,stroke:#00695c,stroke-width:1px
    style EC2Specific fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style EC2Project fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Note fill:#fff9c4,stroke:#f57f17,stroke-width:1px
```

---

## 12. API Governance Flow

```mermaid
flowchart TB
    subgraph SwaggerGen["Stage 3: SwaggerGen"]
        SG1{Existing spec<br/>in source?}
        SG1 -->|Yes| SG2[Use existing<br/>swagger.json]
        SG1 -->|No| SG3[dotnet build +<br/>Swashbuckle CLI]
        SG3 -->|Fails| SG4[Start app +<br/>curl swagger endpoint]
        SG2 --> SGOut[swagger.json<br/>in artifact root]
        SG3 --> SGOut
        SG4 --> SGOut
    end

    subgraph Lint["Stage 4: Lint (Spectral)"]
        L1[Load .spectral.yml<br/>shared ruleset]
        L1 --> L2[Validate OpenAPI spec]
        L2 --> L3{Errors found?}
        L3 -->|Yes| L4[BLOCK build<br/>Send SNS alert]
        L3 -->|No| L5[Report warnings<br/>Continue pipeline]
    end

    subgraph ContractTest["Stage 8: ContractTest (Dredd)"]
        CT1[Load dredd-hooks.js]
        CT1 --> CT2[Test deployed API<br/>against swagger.json]
        CT2 --> CT3[All failures →<br/>warnings only]
        CT3 --> CT4[Generate report<br/>dredd-warnings.json]
        CT4 --> CT5[Build ALWAYS<br/>proceeds]
    end

    SGOut --> L1
    L5 --> Build[Stage 5-7:<br/>Build → Push → Deploy]
    Build --> CT1

    style SwaggerGen fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Lint fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style ContractTest fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    style L4 fill:#ffcdd2,stroke:#c62828,stroke-width:2px
```

---

## 13. Webhook Integration (Azure DevOps → AWS)

```mermaid
sequenceDiagram
    participant ADO as Azure DevOps
    participant APIGW as API Gateway
    participant Lambda as Webhook Lambda
    participant CP as CodePipeline
    participant S3 as S3 Artifact Bucket

    ADO->>+APIGW: POST /webhook/{service}<br/>X-Azure-DevOps-Event: git.push
    APIGW->>+Lambda: Invoke (AWS_PROXY)
    Note over Lambda: Extract {service} from path<br/>Filter: only git.push events
    Lambda->>Lambda: Build pipeline name:<br/>{project}-{env}-{service}-pipeline
    Lambda->>+CP: StartPipelineExecution
    CP-->>-Lambda: pipelineExecutionId
    Lambda-->>-APIGW: 200 OK + executionId
    APIGW-->>-ADO: Response

    Note over CP,S3: Pipeline starts from S3 trigger.zip
    CP->>S3: Read trigger/trigger.zip
    S3-->>CP: buildspecs/ + governance configs
```
