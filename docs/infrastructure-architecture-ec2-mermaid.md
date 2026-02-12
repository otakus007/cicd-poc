# Japfa API Platform — EC2 Infrastructure Architecture (Mermaid)

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

            subgraph ALBLayer["Load Balancing"]
                ALB[Internal ALB<br/>HTTP :80<br/>Default: 404 JSON]
            end

            subgraph EC2Layer["EC2 Instances (ASG)"]
                EC2_A[EC2 Instance AZ-a<br/>ECS Agent]
                EC2_B[EC2 Instance AZ-b<br/>ECS Agent]
            end

            subgraph ProjectA["Project: cash-collection"]
                TG_A[Target Group A<br/>/api/cash/*]
                SVC_A[ECS EC2 Service A]
                Pipeline_A[Pipeline A<br/>8 stages]
            end

            subgraph ProjectB["Project: poultry-sale"]
                TG_B[Target Group B<br/>/api/poultry/*]
                SVC_B[ECS EC2 Service B]
                Pipeline_B[Pipeline B<br/>8 stages]
            end
        end

        subgraph SharedInfra["Shared Resources"]
            ECSCluster[ECS EC2 Cluster<br/>Capacity Provider<br/>Managed Scaling]
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

        subgraph Monitoring["Monitoring"]
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
    ECSCluster --> EC2_A
    ECSCluster --> EC2_B
    EC2_A --> SVC_A
    EC2_B --> SVC_B

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
    style EC2Layer fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style ProjectA fill:#e3f2fd,stroke:#1565c0,stroke-width:1px
    style ProjectB fill:#fff3e0,stroke:#e65100,stroke-width:1px
    style SharedInfra fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px
    style Monitoring fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px
```

## 2. Deployment Model — Two-Tier Architecture

```mermaid
flowchart TB
    subgraph SharedInfra["Shared Infrastructure (deploy.sh --compute-type ec2)"]
        Main["main-ec2.yaml<br/>(Root Stack)"]
        Main --> VPC["VpcStack<br/>vpc.yaml"]
        Main --> SG["SecurityGroupsStack<br/>security-groups.yaml"]
        Main --> IAM["IamStack<br/>iam.yaml<br/>+ EC2 Instance Profile"]
        Main --> ALB["AlbStack<br/>alb.yaml"]
        Main --> APIGW["ApiGatewayStack<br/>api-gateway.yaml<br/>+ Webhook Lambda"]
        Main --> EC2["EcsEc2ClusterStack<br/>ecs-ec2-cluster.yaml<br/>ASG + Launch Template<br/>+ Capacity Provider"]
        Main --> MON["MonitoringStack<br/>monitoring.yaml<br/>Points to EC2 cluster"]
    end

    subgraph Exports["EC2 Exports (Fn::ImportValue)"]
        E1[ec2-VpcId, ec2-SubnetIds]
        E2[ec2-SecurityGroupIds]
        E3[IAM Role ARNs]
        E4[ec2-AlbDnsName, ListenerArn]
        E5[Ec2ClusterArn, Ec2CapacityProviderName]
        E6[ec2-ApiGatewayEndpoint]
        E7[ec2-NotificationTopicArn]
    end

    subgraph ProjectStacks["Per-Project Stacks (deploy-project.sh --compute-type ec2)"]
        P1["project-ec2.yaml<br/>cash-collection"]
        P2["project-ec2.yaml<br/>poultry-sale"]
        P3["project-ec2.yaml<br/>swine-api"]
    end

    SharedInfra --> Exports
    Exports --> P1
    Exports --> P2
    Exports --> P3

    style SharedInfra fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style Exports fill:#fff9c4,stroke:#f57f17,stroke-width:1px
    style ProjectStacks fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Main fill:#b2dfdb,stroke:#00695c,stroke-width:3px
```

---

## 3. EC2 Compute Resources (EcsEc2ClusterStack)

```mermaid
flowchart TB
    subgraph SSM["SSM Parameter"]
        AMI["ECS-Optimized<br/>Amazon Linux 2023 AMI"]
    end

    subgraph LT["Launch Template"]
        LTConfig["Instance Type: t3.medium<br/>EBS gp3, encrypted, 30GB+<br/>Detailed monitoring: ON<br/>User data: ECS_CLUSTER config"]
    end

    subgraph ASG["Auto Scaling Group"]
        ASGConfig["Multi-AZ (private subnets)<br/>Min: 1 / Max: 10 / Desired: 2<br/>Scale-in protection: ON<br/>Rolling update policy"]
        EC2a["EC2 Instance AZ-a<br/>ECS Agent"]
        EC2b["EC2 Instance AZ-b<br/>ECS Agent"]
    end

    subgraph CP["Capacity Provider"]
        CPConfig["Managed scaling: target 100%<br/>Managed termination protection: ON<br/>Instance warmup: 300s"]
    end

    subgraph Cluster["ECS EC2 Cluster"]
        ClusterConfig["Container Insights: ON<br/>Capacity provider associated"]
    end

    subgraph IAM["IAM"]
        InstanceProfile["EC2 Instance Profile<br/>ECS agent, ECR pull,<br/>CloudWatch, SSM"]
    end

    AMI --> LT
    IAM --> LT
    LT --> ASG
    ASG --> EC2a
    ASG --> EC2b
    ASG --> CP
    CP --> Cluster

    style LT fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style ASG fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style CP fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style Cluster fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    style IAM fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px
```

---

## 4. CI/CD Pipeline Flow (Per-Project — 8 Stages)

```mermaid
flowchart LR
    subgraph Trigger["Trigger"]
        S3T[S3 trigger.zip<br/>buildspecs/ + governance]
    end

    subgraph Pipeline["CodePipeline — 8 Stages"]
        S1["1 Source<br/>S3"]
        S2["2 CloneSource<br/>git clone via PAT"]
        S3["3 SwaggerGen<br/>OpenAPI spec"]
        S4["4 Lint<br/>Spectral"]
        S5["5 Build<br/>docker build"]
        S6["6 Push<br/>ECR push"]
        S7["7 Deploy<br/>ECS EC2"]
        S8["8 ContractTest<br/>Dredd"]
    end

    subgraph External["External Services"]
        ADO[Azure DevOps]
        ECR[ECR Repository]
        ECSvc[ECS EC2 Service]
        SM[Secrets Manager]
        SNST[SNS Topic]
    end

    S3T --> S1
    S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8

    S2 -.->|Get PAT| SM
    S2 -.->|Clone| ADO
    S4 -.->|Error alert| SNST
    S6 -.->|Push image| ECR
    S7 -.->|Update service| ECSvc

    style Pipeline fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    style S7 fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style S4 fill:#fff9c4,stroke:#f57f17,stroke-width:2px
```

---

## 5. Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant APIGW as API Gateway
    participant VL as VPC Link
    participant ALB as Internal ALB
    participant TG as Target Group
    participant ECS as ECS EC2 Task
    participant DB as Database

    C->>+APIGW: HTTPS Request
    APIGW->>+VL: Forward via VPC Link
    VL->>+ALB: HTTP to ALB
    Note over ALB: Path-based routing
    ALB->>+TG: Route by path
    TG->>+ECS: Forward to container
    ECS->>DB: Query
    DB-->>ECS: Result
    ECS-->>-TG: Response
    TG-->>-ALB: Response
    ALB-->>-VL: Response
    VL-->>-APIGW: Response
    APIGW-->>-C: HTTPS Response
```

---

## 6. Security Groups Chain

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

    style VpcLinkSG fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style AlbSG fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    style EcsSG fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

---

## 7. ALB Path-Based Routing

```mermaid
flowchart TB
    ALB[Internal ALB<br/>HTTP :80]
    ALB -->|Priority 100<br/>/api/cash/*| TG1[Target Group<br/>cash-collection]
    ALB -->|Priority 200<br/>/api/poultry/*| TG2[Target Group<br/>poultry-sale]
    ALB -->|Default| D[404 JSON]
    TG1 --> SVC1[ECS EC2 Service]
    TG2 --> SVC2[ECS EC2 Service]

    style ALB fill:#fce4ec,stroke:#c62828,stroke-width:2px
    style D fill:#ffcdd2,stroke:#c62828,stroke-width:1px
```

---

## 8. ECS Deployment Strategy (EC2 — Capacity Provider)

```mermaid
flowchart TD
    Start([Service Running<br/>CapacityProviderStrategy]) --> Trigger[New image pushed]
    Trigger --> Launch[Launch new task<br/>MaxPercent 200%<br/>Capacity Provider places on EC2]
    Launch --> HC{Health Check<br/>/health}
    HC -->|200 OK| Register[Register with ALB TG<br/>Deregister old task]
    HC -->|Fails| CB[Circuit Breaker]
    Register --> Drain[Drain old task<br/>30s deregistration]
    Drain --> Done([All tasks updated<br/>MinHealthy 50%<br/>ECS Exec enabled])
    CB --> Rollback[Auto Rollback]
    Rollback --> Done

    style Start fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style Done fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style CB fill:#ffcdd2,stroke:#c62828,stroke-width:2px
```

---

## 9. Monitoring & Observability

```mermaid
flowchart TB
    subgraph Sources["Metric Sources"]
        ECS_M["ECS EC2 Services"]
        ALB_M["ALB"]
        CP["CodePipeline"]
        LINT["Lint Stage"]
    end

    subgraph CWAlarms["CloudWatch Alarms"]
        A1["CPU >= 80%"]
        A2["Memory >= 80%"]
        A3["Tasks < 1"]
        A4["Unhealthy Hosts"]
        A5["Latency >= 5s"]
        A6["5xx >= 10"]
    end

    SNS["SNS Topic<br/>KMS Encrypted"]
    Dashboard["CloudWatch Dashboard<br/>Points to EC2 cluster"]

    ECS_M --> A1 & A2 & A3
    ALB_M --> A4 & A5 & A6
    LINT -.->|error| SNS
    A1 & A2 & A3 & A4 & A5 & A6 --> SNS

    style Sources fill:#e3f2fd,stroke:#1565c0
    style CWAlarms fill:#fce4ec,stroke:#c62828
    style SNS fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
```

---

## 10. Webhook Integration (Azure DevOps → AWS)

```mermaid
sequenceDiagram
    participant ADO as Azure DevOps
    participant APIGW as API Gateway
    participant Lambda as Webhook Lambda
    participant CP as CodePipeline

    ADO->>+APIGW: POST /webhook/{service}
    APIGW->>+Lambda: Invoke
    Note over Lambda: Build pipeline name:<br/>{project}-{env}-{service}-pipeline
    Lambda->>+CP: StartPipelineExecution
    CP-->>-Lambda: executionId
    Lambda-->>-APIGW: 200 OK
    APIGW-->>-ADO: Pipeline triggered
```
