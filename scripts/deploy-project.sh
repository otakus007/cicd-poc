#!/bin/bash
# =============================================================================
# Deploy a new project on top of shared infrastructure
# =============================================================================
# Usage:
#   ./scripts/deploy-project.sh \
#     -s cash-collection \
#     -o trungvudinh \
#     -p "5. Cash Collection" \
#     -r api-core \
#     --branch feature/hsbc \
#     --path "/api/cash-collection/*" \
#     --priority 100 \
#     -b japfa-api-cfn-us-east-1 \
#     -e dev
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults
INFRA_PROJECT_NAME="japfa-api"
ENVIRONMENT="dev"
SERVICE_NAME=""
AZURE_DEVOPS_ORG=""
AZURE_DEVOPS_PROJECT=""
AZURE_DEVOPS_REPO=""
BRANCH_NAME="main"
PATH_PATTERN="/api/*"
PRIORITY="100"
CONTAINER_CPU="512"
CONTAINER_MEMORY="1024"
DESIRED_COUNT="0"
TEMPLATES_BUCKET=""
TEMPLATES_PREFIX="infrastructure"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
AZURE_DEVOPS_PAT=""
HEALTH_CHECK_PATH="/health"
CONTAINER_PORT="80"
HEALTH_CHECK_GRACE="120"
PATH_BASE=""
COMPUTE_TYPE="fargate"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy a new project/service on shared infrastructure.

Required:
    -s, --service           Service name (e.g. cash-collection)
    -o, --organization      Azure DevOps organization
    -p, --project           Azure DevOps project
    -r, --repository        Azure DevOps repository
    -b, --bucket            S3 bucket for CloudFormation templates
    -e, --environment       Environment (dev, staging, prod)

Optional:
    --branch                Git branch (default: main)
    --path                  ALB path pattern (default: /api/*)
    --priority              ALB listener rule priority (default: 100)
    --cpu                   Container CPU (default: 512)
    --memory                Container memory (default: 1024)
    --desired-count         ECS desired count (default: 1)
    --infra-name            Shared infra project name (default: japfa-api)
    --region                AWS region (default: us-east-1)
    --pat                   Azure DevOps PAT (auto-populates secret)
    --health-check          Health check path (default: /health)
    --port                  Container port (default: 80)
    --grace-period          Health check grace period seconds (default: 120)
    --path-base             URL path prefix for ASP.NET UsePathBase (e.g. /collection/api/v2.1)
    --compute-type          Compute type: fargate or ec2 (default: fargate)
    -h, --help              Show help

Example:
    $(basename "$0") -s cash-collection -o trungvudinh \\
      -p "5. Cash Collection" -r api-core --branch feature/hsbc \\
      --path "/api/cash/*" --priority 100 \\
      -b japfa-api-cfn-us-east-1 -e dev --pat "your-pat-here"
EOF
    exit 1
}


while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--service) SERVICE_NAME="$2"; shift 2 ;;
        -o|--organization) AZURE_DEVOPS_ORG="$2"; shift 2 ;;
        -p|--project) AZURE_DEVOPS_PROJECT="$2"; shift 2 ;;
        -r|--repository) AZURE_DEVOPS_REPO="$2"; shift 2 ;;
        -b|--bucket) TEMPLATES_BUCKET="$2"; shift 2 ;;
        -e|--environment) ENVIRONMENT="$2"; shift 2 ;;
        --branch) BRANCH_NAME="$2"; shift 2 ;;
        --path) PATH_PATTERN="$2"; shift 2 ;;
        --priority) PRIORITY="$2"; shift 2 ;;
        --cpu) CONTAINER_CPU="$2"; shift 2 ;;
        --memory) CONTAINER_MEMORY="$2"; shift 2 ;;
        --desired-count) DESIRED_COUNT="$2"; shift 2 ;;
        --infra-name) INFRA_PROJECT_NAME="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        --pat) AZURE_DEVOPS_PAT="$2"; shift 2 ;;
        --health-check) HEALTH_CHECK_PATH="$2"; shift 2 ;;
        --port) CONTAINER_PORT="$2"; shift 2 ;;
        --grace-period) HEALTH_CHECK_GRACE="$2"; shift 2 ;;
        --path-base) PATH_BASE="$2"; shift 2 ;;
        --compute-type) COMPUTE_TYPE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Validate required params
for var in SERVICE_NAME AZURE_DEVOPS_ORG AZURE_DEVOPS_PROJECT AZURE_DEVOPS_REPO TEMPLATES_BUCKET ENVIRONMENT; do
    if [[ -z "${!var}" ]]; then
        echo "ERROR: $var is required"
        usage
    fi
done

# Validate compute type
if [[ ! "$COMPUTE_TYPE" =~ ^(fargate|ec2)$ ]]; then
    echo "ERROR: Compute type must be 'fargate' or 'ec2'"
    exit 1
fi

# Validate shared infrastructure exists
echo "Validating shared infrastructure..."
if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
    SHARED_STACK_NAME="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-ec2-main"
else
    SHARED_STACK_NAME="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-main"
fi
SHARED_STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$SHARED_STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [[ "$SHARED_STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "============================================"
    echo "ERROR: Shared infrastructure not found!"
    echo "============================================"
    echo "Stack '$SHARED_STACK_NAME' does not exist."
    echo ""
    echo "Deploy shared infrastructure first:"
    echo "  ./scripts/deploy.sh -e ${ENVIRONMENT} -b ${TEMPLATES_BUCKET}"
    echo "============================================"
    exit 1
elif [[ "$SHARED_STACK_STATUS" != "CREATE_COMPLETE" && "$SHARED_STACK_STATUS" != "UPDATE_COMPLETE" ]]; then
    echo "ERROR: Shared infrastructure is in state: $SHARED_STACK_STATUS"
    echo "Please wait for it to complete or fix any issues."
    exit 1
fi
echo "Shared infrastructure validated (status: $SHARED_STACK_STATUS)"
echo ""

STACK_NAME="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}"
if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
    STACK_NAME="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}-ec2"
    TEMPLATE_FILE="project-ec2.yaml"
else
    TEMPLATE_FILE="project.yaml"
fi
TEMPLATE_URL="https://${TEMPLATES_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${TEMPLATES_PREFIX}/${TEMPLATE_FILE}"

echo "============================================"
echo "Deploying Project: ${SERVICE_NAME}"
echo "============================================"
echo "Stack:        ${STACK_NAME}"
echo "Environment:  ${ENVIRONMENT}"
echo "Compute:      ${COMPUTE_TYPE}"
echo "Template:     ${TEMPLATE_FILE}"
echo "Infra:        ${INFRA_PROJECT_NAME}"
echo "Repo:         ${AZURE_DEVOPS_ORG}/${AZURE_DEVOPS_PROJECT}/${AZURE_DEVOPS_REPO}"
echo "Branch:       ${BRANCH_NAME}"
echo "Path:         ${PATH_PATTERN}"
echo "Priority:     ${PRIORITY}"
echo "Region:       ${AWS_REGION}"
echo "============================================"

# Upload project template to S3
echo "Uploading ${TEMPLATE_FILE} to S3..."
aws s3 cp "${PROJECT_ROOT}/infrastructure/${TEMPLATE_FILE}" \
    "s3://${TEMPLATES_BUCKET}/${TEMPLATES_PREFIX}/${TEMPLATE_FILE}" \
    --region "$AWS_REGION"

# Also upload buildspecs
if [[ -d "${PROJECT_ROOT}/buildspecs" ]]; then
    echo "Uploading buildspecs to S3..."
    aws s3 sync "${PROJECT_ROOT}/buildspecs/" \
        "s3://${TEMPLATES_BUCKET}/${TEMPLATES_PREFIX}/buildspecs/" \
        --region "$AWS_REGION"
fi

# Check if stack exists
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

PARAMETERS=(
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
    "ParameterKey=InfraProjectName,ParameterValue=${INFRA_PROJECT_NAME}"
    "ParameterKey=ServiceName,ParameterValue=${SERVICE_NAME}"
    "ParameterKey=AzureDevOpsOrganization,ParameterValue=${AZURE_DEVOPS_ORG}"
    "ParameterKey=AzureDevOpsProject,ParameterValue=${AZURE_DEVOPS_PROJECT}"
    "ParameterKey=AzureDevOpsRepository,ParameterValue=${AZURE_DEVOPS_REPO}"
    "ParameterKey=BranchName,ParameterValue=${BRANCH_NAME}"
    "ParameterKey=PathPattern,ParameterValue=${PATH_PATTERN}"
    "ParameterKey=ListenerRulePriority,ParameterValue=${PRIORITY}"
    "ParameterKey=ContainerCpu,ParameterValue=${CONTAINER_CPU}"
    "ParameterKey=ContainerMemory,ParameterValue=${CONTAINER_MEMORY}"
    "ParameterKey=DesiredCount,ParameterValue=${DESIRED_COUNT}"
    "ParameterKey=TemplatesBucketName,ParameterValue=${TEMPLATES_BUCKET}"
    "ParameterKey=TemplatesBucketPrefix,ParameterValue=${TEMPLATES_PREFIX}"
    "ParameterKey=HealthCheckPath,ParameterValue=${HEALTH_CHECK_PATH}"
    "ParameterKey=ContainerPort,ParameterValue=${CONTAINER_PORT}"
    "ParameterKey=HealthCheckGracePeriod,ParameterValue=${HEALTH_CHECK_GRACE}"
    "ParameterKey=PathBase,ParameterValue=${PATH_BASE}"
)

if [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "Creating new stack..."
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" \
        --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Service,Value=${SERVICE_NAME}" "Key=ComputeType,Value=${COMPUTE_TYPE}"

    echo "Waiting for stack creation..."
    aws cloudformation wait stack-create-complete \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION"
else
    echo "Updating existing stack (status: ${STACK_STATUS})..."
    update_output=""
    update_output=$(aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$AWS_REGION" 2>&1) || {
        if [[ "$update_output" == *"No updates are to be performed"* ]]; then
            echo "No updates are to be performed"
        else
            echo "ERROR: Stack update failed: $update_output"
            exit 1
        fi
    }

    if [[ "$update_output" != *"No updates"* ]]; then
        echo "Waiting for stack update..."
        aws cloudformation wait stack-update-complete \
            --stack-name "$STACK_NAME" \
            --region "$AWS_REGION"
    fi
fi

echo ""
echo "============================================"
echo "Stack deployed successfully!"
echo "============================================"

# Populate PAT if provided
if [[ -n "$AZURE_DEVOPS_PAT" ]]; then
    echo "Populating Azure DevOps PAT in Secrets Manager..."
    # Use temporary file to avoid exposing PAT in process listing
    tmp_secret=$(mktemp)
    chmod 600 "$tmp_secret"
    printf '{"pat":"%s"}' "$AZURE_DEVOPS_PAT" > "$tmp_secret"
    aws secretsmanager put-secret-value \
        --secret-id "${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${SERVICE_NAME}/azure-devops-pat" \
        --secret-string "file://${tmp_secret}" \
        --region "$AWS_REGION"
    rm -f "$tmp_secret"
    echo "PAT configured."
else
    echo "NOTE: Update PAT securely using the helper script:"
    echo "  ./scripts/setup-pat.sh -e ${ENVIRONMENT} -s ${SERVICE_NAME}"
fi

# Seed trigger file
echo ""
echo "Seeding pipeline trigger..."
# Get artifact bucket name from stack outputs (reliable) instead of reconstructing it
ARTIFACT_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ArtifactBucketName`].OutputValue' \
    --output text 2>/dev/null)

# Fallback to convention-based name if stack output not available
if [[ -z "$ARTIFACT_BUCKET" || "$ARTIFACT_BUCKET" == "None" ]]; then
    echo "WARN: Could not get artifact bucket from stack outputs, using convention..."
    ARTIFACT_BUCKET="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}-artifacts-$(aws sts get-caller-identity --query Account --output text --region "$AWS_REGION")"
fi
echo "Artifact bucket: ${ARTIFACT_BUCKET}"
TMP_DIR=$(mktemp -d)
echo "{\"triggered\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"service\":\"${SERVICE_NAME}\",\"branch\":\"${BRANCH_NAME}\"}" > "${TMP_DIR}/trigger.json"
# Include all buildspecs — they are generic and work for any project
if [[ -d "${PROJECT_ROOT}/buildspecs" ]]; then
    mkdir -p "${TMP_DIR}/buildspecs"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-source.yml" "${TMP_DIR}/buildspecs/"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-build.yml" "${TMP_DIR}/buildspecs/"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-push.yml" "${TMP_DIR}/buildspecs/"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-lint.yml" "${TMP_DIR}/buildspecs/"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-contract-test.yml" "${TMP_DIR}/buildspecs/"
    cp "${PROJECT_ROOT}/buildspecs/buildspec-swagger-gen.yml" "${TMP_DIR}/buildspecs/"
    # Include governance config files for lint/contract stages
    if [[ -d "${PROJECT_ROOT}/buildspecs/governance" ]]; then
        cp "${PROJECT_ROOT}/buildspecs/governance/.spectral.yml" "${TMP_DIR}/" 2>/dev/null || true
        cp "${PROJECT_ROOT}/buildspecs/governance/.spectral.yaml" "${TMP_DIR}/" 2>/dev/null || true
        cp "${PROJECT_ROOT}/buildspecs/governance/dredd.yml" "${TMP_DIR}/" 2>/dev/null || true
        cp "${PROJECT_ROOT}/buildspecs/governance/dredd-hooks.js" "${TMP_DIR}/" 2>/dev/null || true
    fi
fi
(cd "$TMP_DIR" && zip -qr trigger.zip .)
aws s3 cp "${TMP_DIR}/trigger.zip" "s3://${ARTIFACT_BUCKET}/trigger/trigger.zip" --region "$AWS_REGION"
rm -rf "$TMP_DIR"
echo "Trigger seeded."

# Re-trigger pipeline (first auto-run fails because trigger.zip didn't exist yet)
echo ""
echo "Re-triggering pipeline..."
aws codepipeline start-pipeline-execution \
    --name "${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}-pipeline" \
    --region "$AWS_REGION"
echo "Pipeline triggered."

# Show outputs
echo ""
echo "============================================"
echo "Project Outputs"
echo "============================================"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
    --output table

echo ""
echo "To trigger the pipeline:"
echo "  aws codepipeline start-pipeline-execution --name ${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}-pipeline --region ${AWS_REGION}"
