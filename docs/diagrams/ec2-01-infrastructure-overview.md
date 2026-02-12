# EC2 — High-Level Infrastructure Overview

```mermaid
flowchart TB
    subgraph Internet
        Client[Client / Browser]
        AzureDevOps[Azure DevOps - Git Repositories]
    end

    subgraph AWS["AWS Cloud (us-east-1)"]
        subgraph APIGW["API Gateway"]
            HttpApi[HTTP API Gateway - HTTPS + TLS 1.2+ - Throttle: 500 rps / Burst: 1000]
            WebhookLambda[Webhook Lambda - POST /webhook/service]
        end

        subgraph VPC["VPC 10.0.0.0/16"]
            VpcLink[VPC Link - Private Subnets]

            subgraph AZa["AZ-a"]
                PubSub1[Public Subnet - 10.0.1.0/24]
                PrivSub1[Private Subnet - 10.0.10.0/24]
                NAT1[NAT Gateway 1 - Elastic IP]
            end

            subgraph AZb["AZ-b"]
                PubSub2[Public Subnet - 10.0.2.0/24]
                PrivSub2[Private Subnet - 10.0.11.0/24]
                NAT2[NAT Gateway 2 - Elastic IP]
            end

            IGW[Internet Gateway]

            subgraph ALBLayer["Load Balancing"]
                ALB[Internal ALB - HTTP :80 - Default: 404 JSON]
            end

            subgraph EC2Layer["EC2 Instances (ASG)"]
                EC2_A[EC2 Instance AZ-a - ECS Agent]
                EC2_B[EC2 Instance AZ-b - ECS Agent]
            end

            subgraph ProjectA["Project: cash-collection"]
                TG_A[Target Group A - /api/cash/*]
                SVC_A[ECS EC2 Service A]
                Pipeline_A[Pipeline A - 8 stages]
            end

            subgraph ProjectB["Project: poultry-sale"]
                TG_B[Target Group B - /api/poultry/*]
                SVC_B[ECS EC2 Service B]
                Pipeline_B[Pipeline B - 8 stages]
            end
        end

        subgraph SharedInfra["Shared Resources"]
            ECSCluster[ECS EC2 Cluster - Capacity Provider - Managed Scaling]
            IAMRoles[IAM Roles - Pipeline, CodeBuild, - ECS Exec, ECS Task, - EC2 Instance, Webhook Lambda]
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
            SNS[SNS Topic - KMS Encrypted]
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
