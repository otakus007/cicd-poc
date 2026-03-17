---
name: docker-expert
description: Expert guidance for Docker containerization, multi-stage builds, and optimization.
triggers:
  - docker
  - container
  - dockerfile
  - docker-compose
---
# Docker Expert Skill

Use this skill when you need to containerize applications, optimize Dockerfiles, or troubleshoot container issues.

## Core Principles
- **Multi-stage builds:** Always use multi-stage builds to keep production images small.
- **Layer caching:** Order commands from least frequent to most frequent changes to leverage caching.
- **Security:** Run as a non-root user and use official, minimal base images (e.g., alpine, slim).
- **Persistence:** Use volumes for persistent data, not the container's writable layer.

## Common Tasks
- **Containerization:** Creating a Dockerfile for a new service.
- **Optimization:** Reducing image size and build time.
- **Compose:** Orchestrating multiple containers with `docker-compose.yml`.
- **Debugging:** Inspecting logs, exec-ing into containers, and checking resource usage.

## Example Usage
"Use docker-expert to create a production-ready Dockerfile for this Node.js app."
