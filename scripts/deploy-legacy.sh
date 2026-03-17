#!/bin/bash
# =============================================================================
# Deploy Legacy Windows IIS Infrastructure
# =============================================================================
# Usage:
#   ./scripts/deploy-legacy.sh \
#     -b japfa-api-cfn-us-east-1 \
#     -e dev
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults
PROJECT_NAME="japfa-api"
ENVIRONMENT="dev"
TEMPLATES_BUCKET=""
TEMPLATES_PREFIX="infrastructure"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
INSTANCE_TYPE="t3.medium"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the legacy Windows IIS stack on shared infrastructure.

Required:
    -b, --bucket            S3 bucket for CloudFormation templates
    -e, --environment       Environment (dev, staging, prod)

Optional:
    -n, --name              Project name (default: japfa-api)
    --instance-type         EC2 instance type (default: t3.medium)
    --region                AWS region (default: us-east-1)
    -h, --help              Show help

Example:
    $(basename "$0") -b japfa-api-cfn-us-east-1 -e dev
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket) TEMPLATES_BUCKET="$2"; shift 2 ;;
        -e|--environment) ENVIRONMENT="$2"; shift 2 ;;
        -n|--name) PROJECT_NAME="$2"; shift 2 ;;
        --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Validate required params
if [[ -z "$TEMPLATES_BUCKET" || -z "$ENVIRONMENT" ]]; then
    echo "ERROR: Bucket and Environment are required"
    usage
fi

STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-legacy"
TEMPLATE_FILE="legacy-project.yaml"
TEMPLATE_URL="https://${TEMPLATES_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${TEMPLATES_PREFIX}/${TEMPLATE_FILE}"

echo "============================================"
echo "Deploying Legacy Windows Infrastructure"
echo "============================================"
echo "Stack:        ${STACK_NAME}"
echo "Environment:  ${ENVIRONMENT}"
echo "Instance:     ${INSTANCE_TYPE}"
echo "Region:       ${AWS_REGION}"
echo "============================================"

# 1. Upload ALL templates to S3 (Required for Nested Stacks)
echo "Uploading all templates to S3..."
aws s3 sync "${PROJECT_ROOT}/infrastructure/" \
    "s3://${TEMPLATES_BUCKET}/${TEMPLATES_PREFIX}/" \
    --exclude "*" \
    --include "*.yaml" \
    --region "$AWS_REGION"

# 2. Check if stack exists
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

PARAMETERS=(
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
    "ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME}"
    "ParameterKey=TemplatesBucketName,ParameterValue=${TEMPLATES_BUCKET}"
    "ParameterKey=TemplatesBucketPrefix,ParameterValue=${TEMPLATES_PREFIX}"
    "ParameterKey=InstanceType,ParameterValue=${INSTANCE_TYPE}"
)

if [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "Creating new legacy stack..."
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
        --region "$AWS_REGION" \
        --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Project,Value=${PROJECT_NAME}" "Key=Type,Value=Legacy"

    echo "Waiting for stack creation..."
    aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
else
    echo "Updating existing legacy stack (status: ${STACK_STATUS})..."
    update_output=$(aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
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
        aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
    fi
fi

echo ""
echo "============================================"
echo "Legacy Stack deployed successfully!"
echo "============================================"

# Show outputs
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
    --output table
