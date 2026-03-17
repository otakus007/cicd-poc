---
name: database-architect
description: Expert in designing and managing cloud-native databases (RDS, Aurora, DynamoDB).
triggers:
  - db-design
  - schema-design
  - rds-architecture
---
# Database Architect

Guidance on data modeling, scaling, and database reliability.

## Key Strategies
- **Storage Engines:** Choosing between RDS SQL Server, Aurora, or DynamoDB.
- **Scaling:** Implementing Read Replicas and Multi-AZ deployments.
- **Performance:** Optimizing Buffer Pools, IOPS (gp3/io2), and Connections.
- **Security:** Data-at-rest encryption and IAM Database Authentication.

## Patterns
- Relational for complex transactions (.NET apps).
- NoSQL for high-throughput, low-latency key-value data.
- Global databases for multi-region resilience.
