#!/bin/bash
# =============================================================================
# Deploy Oracle RDS Infrastructure
# =============================================================================
# Usage:
#   ./scripts/deploy-db.sh \
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
DB_CLASS="db.t3.medium"
DB_STORAGE=20
DB_NAME="ORCL"
DB_USER="admin"
DB_PASSWORD=""

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the Oracle RDS stack on shared infrastructure.

Required:
    -b, --bucket            S3 bucket for CloudFormation templates
    -e, --environment       Environment (dev, staging, prod)

Optional:
    -n, --name              Project name (default: japfa-api)
    --db-class              RDS instance class (default: db.t3.medium)
    --db-storage            Allocated storage in GB (default: 20)
    --db-sid                Oracle SID (default: ORCL)
    --db-user               Master username (default: admin)
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
        --db-class) DB_CLASS="$2"; shift 2 ;;
        --db-storage) DB_STORAGE="$2"; shift 2 ;;
        --db-sid) DB_NAME="$2"; shift 2 ;;
        --db-user) DB_USER="$2"; shift 2 ;;
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

# Securely ask for password
echo -n "Enter Master Database Password: "
read -s DB_PASSWORD
echo ""

STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-rds"
TEMPLATE_FILE="rds-oracle.yaml"
TEMPLATE_URL="https://${TEMPLATES_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${TEMPLATES_PREFIX}/${TEMPLATE_FILE}"

echo "============================================"
echo "Deploying Oracle RDS Infrastructure"
echo "============================================"
echo "Stack:        ${STACK_NAME}"
echo "Environment:  ${ENVIRONMENT}"
echo "DB Class:     ${DB_CLASS}"
echo "Storage:      ${DB_STORAGE} GB"
echo "SID:          ${DB_NAME}"
echo "Region:       ${AWS_REGION}"
echo "============================================"

# 1. Upload RDS template to S3
echo "Uploading template to S3..."
aws s3 cp "${PROJECT_ROOT}/infrastructure/${TEMPLATE_FILE}" \
    "s3://${TEMPLATES_BUCKET}/${TEMPLATES_PREFIX}/${TEMPLATE_FILE}" \
    --region "$AWS_REGION"

# 2. Check if stack exists
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

# Import shared resources (VPC, Subnets, SG)
VPC_ID=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-main" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text)
SUBNET1=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-main" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnet1Id'].OutputValue" --output text)
SUBNET2=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-main" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnet2Id'].OutputValue" --output text)
RDS_SG=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-${ENVIRONMENT}-main" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='RdsSecurityGroupId'].OutputValue" --output text)

PARAMETERS=(
    "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
    "ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME}"
    "ParameterKey=DBInstanceClass,ParameterValue=${DB_CLASS}"
    "ParameterKey=AllocatedStorage,ParameterValue=${DB_STORAGE}"
    "ParameterKey=DBName,ParameterValue=${DB_NAME}"
    "ParameterKey=MasterUsername,ParameterValue=${DB_USER}"
    "ParameterKey=MasterUserPassword,ParameterValue=${DB_PASSWORD}"
    "ParameterKey=VpcId,ParameterValue=${VPC_ID}"
    "ParameterKey=PrivateSubnet1Id,ParameterValue=${SUBNET1}"
    "ParameterKey=PrivateSubnet2Id,ParameterValue=${SUBNET2}"
    "ParameterKey=RdsSecurityGroupId,ParameterValue=${RDS_SG}"
)

if [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
    echo "Creating new RDS stack (this may take 15-20 minutes)..."
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
        --region "$AWS_REGION" \
        --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Project,Value=${PROJECT_NAME}" "Key=Type,Value=Database"

    echo "Waiting for stack creation..."
    aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
else
    echo "Updating existing RDS stack (status: ${STACK_STATUS})..."
    update_output=$(aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-url "$TEMPLATE_URL" \
        --parameters "${PARAMETERS[@]}" \
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
echo "RDS Stack deployed successfully!"
echo "============================================"

# Show outputs
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
    --output table
