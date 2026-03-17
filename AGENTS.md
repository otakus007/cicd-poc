# Antigravity Configuration


<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- BEGIN DEPLOY-ON-AWS SKILL -->
## Deploy on AWS

**Triggers:** "deploy to AWS", "host on AWS", "run this on AWS", "AWS architecture", "estimate AWS cost", "generate infrastructure"

Take any application and deploy it to AWS with minimal user decisions.

### Philosophy
**Minimize cognitive burden.** User has code, wants it on AWS. Pick the most straightforward services. Don't ask questions with obvious answers.

### Workflow
1. **Analyze** - Scan codebase for framework, database, dependencies
2. **Recommend** - Select AWS services, concisely explain rationale
3. **Estimate** - Show monthly cost before proceeding (use `awspricing` MCP)
4. **Generate** - Write IaC code with security defaults applied
5. **Deploy** - Run security checks, then execute with user confirmation

### Defaults
See [.kiro/aws-deploy/references/defaults.md](.kiro/aws-deploy/references/defaults.md) for the complete service selection matrix.

Core principle: Default to **dev-sized** (cost-conscious: small instance sizes, minimal redundancy, non-HA/single-AZ) unless user says "production-ready".

### MCP Servers

**awsknowledge** — Consult for architecture decisions. Use when choosing between AWS services or validating that a service fits the use case. Key topics: `general` for architecture, `amplify_docs` for static sites/SPAs, `cdk_docs` and `cdk_constructs` for IaC patterns.

**awspricing** — Get cost estimates. **Always present costs before generating IaC** so user can adjust before committing. See [.kiro/aws-deploy/references/cost-estimation.md](.kiro/aws-deploy/references/cost-estimation.md) for query patterns.

**awsiac** (power-aws-infrastructure-as-code-awslabs.aws-iac-mcp-server) — Consult for IaC best practices. Use when writing CDK/CloudFormation/Terraform to ensure patterns follow AWS recommendations.

### Principles
- Concisely explain why each service was chosen
- Always show cost estimate before generating code
- Apply [security defaults](.kiro/aws-deploy/references/security.md) automatically (encryption, private subnets, least privilege)
- Run IaC security scans (cfn-nag, checkov) before deployment
- Don't ask "Lambda or Fargate?" — just pick the obvious one
- If genuinely ambiguous, then ask

<!-- END DEPLOY-ON-AWS SKILL -->

<!-- BEGIN AMAZON-LOCATION-SERVICE SKILL -->
## Amazon Location Service

**Triggers:** "add a map", "geocode an address", "calculate a route", "location-aware app", "Amazon Location Service", "geospatial", "places search", "reverse geocode", "find nearby places", "address autocomplete"

Integrate Amazon Location Service APIs for maps, geocoding, routing, places search, geofencing, and tracking.

### When to Use This Skill
- Building location-aware web or mobile applications
- Implementing maps, geocoding, routing, or places search
- Adding geofencing or device tracking functionality
- Integrating geospatial features into AWS applications

Do NOT use for Google Maps, Mapbox, or Leaflet-with-OSM projects (unless migrating to Amazon Location).

### API Overview
- **Places** (`@aws-sdk/client-geo-places`): Geocode, ReverseGeocode, SearchText, SearchNearby, Autocomplete, Suggest, GetPlace
- **Maps** (`@aws-sdk/client-geo-maps`): Dynamic tiles (MapLibre), Static map images
- **Routes** (`@aws-sdk/client-geo-routes`): CalculateRoutes, CalculateRouteMatrix, CalculateIsolines, OptimizeWaypoints
- **Geofences & Trackers** (`@aws-sdk/client-location`): Geofences, device location tracking

### Defaults
- **JavaScript SDK**: Bundled client (`@aws/amazon-location-client`) for browser-only apps; npm modular SDKs for React/build tool apps
- **Authentication**: API Key for Maps/Places/Routes; Cognito for Geofencing/Tracking
- **Operations**: Resourceless for Maps/Places/Routes (Geofencing/Tracking always require pre-created resources)
- **Map style**: Standard
- **Coordinate format**: [longitude, latitude] (GeoJSON order)

### Common Mistakes to Avoid
1. **Using `Title` instead of `Address.Label`** for display in Autocomplete results
2. **Using GetStyleDescriptor API** for map initialization — MUST use direct URL passing to MapLibre
3. **Forgetting `validateStyle: false`** in MapLibre Map constructor
4. **Wrong action names in API Key permissions** — use `geo-maps:`, `geo-places:`, `geo-routes:` prefixes

### MCP Server
**aws-mcp** — Access AWS documentation, API references, and direct API interactions. See [AWS MCP Server docs](https://docs.aws.amazon.com/aws-mcp/latest/userguide/what-is-aws-mcp-server.html).

### References
Load these files as needed for specific implementation guidance:
- [Address Input](.kiro/amazon-location-service/references/address-input.md) - Address forms with autocomplete
- [Address Verification](.kiro/amazon-location-service/references/address-verification.md) - Validate addresses before storage
- [Calculate Routes](.kiro/amazon-location-service/references/calculate-routes.md) - Route calculation and map display
- [Dynamic Map Rendering](.kiro/amazon-location-service/references/dynamic-map.md) - MapLibre GL JS integration
- [Places Search](.kiro/amazon-location-service/references/places-search.md) - SearchText, SearchNearby, Suggest
- [Web JavaScript](.kiro/amazon-location-service/references/web-javascript.md) - Bundled client authentication and usage

### LLM Context (fetch when needed)
- Developer Guide: https://docs.aws.amazon.com/location/latest/developerguide/llms.txt
- API Reference: https://docs.aws.amazon.com/location/latest/APIReference/llms.txt

<!-- END AMAZON-LOCATION-SERVICE SKILL -->

<!-- BEGIN AWS-SERVERLESS SKILL -->
## AWS Serverless

**Triggers:** "Lambda function", "serverless application", "API Gateway", "EventBridge", "Step Functions", "SAM template", "SAM deploy", "CDK Lambda", "NodejsFunction", "PythonFunction", "event-driven architecture", "Lambda trigger", "durable functions", "serverless CI/CD"

Build serverless applications with Lambda, API Gateway, EventBridge, Step Functions, and durable functions.

### Skills

#### aws-serverless-deployment
**Triggers:** "use SAM", "SAM template", "SAM init", "SAM deploy", "CDK serverless", "CDK Lambda construct", "NodejsFunction", "PythonFunction", "SAM and CDK together", "serverless CI/CD pipeline"

Deploy serverless applications using SAM or CDK. Covers project scaffolding, IaC templates, CDK constructs and patterns, deployment workflows, CI/CD pipelines, and SAM/CDK coexistence.

**IaC framework**: Default CDK (TypeScript). Override: "use SAM" → SAM YAML, "use CloudFormation" → CloudFormation YAML.

**References:**
- [SAM Project Setup](.kiro/aws-serverless/references/sam-project-setup.md) - SAM templates, deployment workflow, local testing, container images
- [CDK Project Setup](.kiro/aws-serverless/references/cdk-project-setup.md) - CDK project setup, constructs, testing, pipelines
- [CDK Lambda Constructs](.kiro/aws-serverless/references/cdk-lambda-constructs.md) - NodejsFunction, PythonFunction, base Function
- [CDK Serverless Patterns](.kiro/aws-serverless/references/cdk-serverless-patterns.md) - API Gateway, EventBridge, DynamoDB, SQS patterns
- [SAM and CDK Coexistence](.kiro/aws-serverless/references/sam-cdk-coexistence.md) - Migration strategies, using SAM CLI with CDK

#### aws-lambda
**Triggers:** "Lambda function", "event source", "serverless API", "event-driven architecture", "Lambda trigger", "Lambda Web Adapter", "DynamoDB Streams", "Kinesis", "SQS trigger"

Design, build, deploy, test, and debug serverless applications with AWS Lambda.

**Key capabilities:** SAM CLI integration, Lambda Web Adapter for web apps, Event Source Mappings, schema management, observability, performance optimization.

**Lambda Limits Quick Reference:**
| Resource | Limit |
| -------------------------------------------- | ----------------------------------- |
| Function timeout | 900 seconds (15 minutes) |
| Memory | 128 MB – 10,240 MB |
| Synchronous payload (request + response) | 6 MB each |
| Deployment package (.zip, uncompressed) | 250 MB |
| Container image | 10 GB |
| Account concurrent executions (default) | 1,000 |

#### aws-lambda-durable-functions
**Triggers:** "lambda durable functions", "workflow orchestration", "state machines", "retry/checkpoint patterns", "long-running stateful Lambda", "saga pattern", "human-in-the-loop callbacks"

Build resilient multi-step applications with automatic state persistence, retry logic, and orchestration for executions up to 1 year.

**Critical Rules:**
1. All non-deterministic code MUST be in steps (Date.now, Math.random, API calls)
2. Cannot nest durable operations — use `runInChildContext` to group operations
3. Closure mutations are lost on replay — return values from steps
4. Side effects outside steps repeat — use `context.logger` (replay-aware)

**Quick Pattern (TypeScript):**
```typescript
import { withDurableExecution, DurableContext } from '@aws/durable-execution-sdk-js';

export const handler = withDurableExecution(async (event, context: DurableContext) => {
  const result = await context.step('process', async () => processData(event));
  return result;
});
```

**IAM**: Execution role MUST have `AWSLambdaBasicDurableExecutionRolePolicy` managed policy.

### MCP Server
**aws-serverless-mcp** (`awslabs.aws-serverless-mcp-server@latest`) — Create projects, generate IaC, deploy, and manage serverless applications. Write access enabled by default. Add `--allow-sensitive-data-access` to enable Lambda/API Gateway log access.

### Configuration Requirements
- AWS CLI configured: `aws sts get-caller-identity`
- SAM CLI installed: `sam --version`
- Docker (for container builds and `sam local invoke`)
- CDK bootstrapped: `cdk bootstrap aws://ACCOUNT-ID/REGION`

### Best Practices
- Use TypeScript for CDK — type checking catches errors at synthesis time
- Prefer L2 constructs and `grant*` methods over L1 and raw IAM statements
- Separate stateful and stateless resources into different stacks
- Write idempotent function code — Lambda delivers events at least once
- Use AWS Lambda Powertools for structured logging, tracing, metrics, idempotency
- Store secrets in Secrets Manager or SSM Parameter Store, never in environment variables

<!-- END AWS-SERVERLESS SKILL -->
