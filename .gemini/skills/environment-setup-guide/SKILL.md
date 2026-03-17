---
name: environment-setup-guide
description: Standardized procedures for setting up development and production environments.
triggers:
  - setup
  - install
  - env
  - environment
  - prerequisites
---
# Environment Setup Guide

Use this skill to ensure consistent environment configuration across teams and stages.

## Setup Checklist
1. **Prerequisites:** List required tools (e.g., Node.js, Docker, Git).
2. **Cloning:** Standardized repository cloning and branch strategy.
3. **Dependencies:** Commands for installing packages (e.g., `npm install`, `pip install`).
4. **Configuration:** Setting up `.env` files from templates.
5. **Verification:** Running a smoke test or health check.

## Guidelines
- **Automation:** Prefer scripts (`setup.sh`) over manual steps.
- **Documentation:** Keep the README updated with setup instructions.
- **Isolation:** Use virtual environments or containers to avoid dependency conflicts.

## Example Usage
"Use environment-setup-guide to document the steps for a new developer to join this project."
