---
name: performance-optimizer
description: Holistic performance tuning for cloud applications, containers, and databases.
triggers:
  - speed-up
  - latency-reduction
  - tuning
---
# Performance Optimizer

End-to-end performance improvement guidance.

## Optimization Layers
1. **Infrastructure:** Graviton (ARM64), Right-sizing compute.
2. **Network:** Using VPC Endpoints, CDN (CloudFront), and regional locality.
3. **Application:** Asynchronous processing (SQS), Caching (ElastiCache).
4. **Container:** Small base images, proper resource limits (CPU/RAM).

## Tools
- AWS X-Ray for tracing.
- Container Insights for resource usage.
- Performance Insights for database load.
