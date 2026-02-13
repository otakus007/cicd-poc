#!/bin/bash
# =============================================================================
# AWS Write Permission Check Script for CI/CD Pipeline Deployment
# =============================================================================
# This script validates write permissions by creating temporary test resources
# and logs all actions to a file for audit purposes.
#
# Usage: ./check-write-permissions.sh [--profile <profile>] [--region <region>]
#
# =============================================================================
# AWS NAMING CONVENTIONS REFERENCE
# =============================================================================
# Service              | Convention
# ---------------------|----------------------------------------------------------
# S3 Bucket            | 3-63 chars, lowercase, numbers, hyphens, start with letter/number
# IAM Role             | 1-64 chars, alphanumeric, +=,.@-_ allowed
# IAM Policy           | 1-128 chars, alphanumeric, +=,.@-_ allowed
# EC2 (Name Tag)       | 1-256 chars, any characters
# Security Group       | 1-255 chars, alphanumeric, spaces, ._-:/()#,@[]+=&;{}!$*
# ECR Repository       | 2-256 chars, lowercase, numbers, hyphens, underscores, /
# ECS Cluster          | 1-255 chars, letters, numbers, hyphens, underscores
# ECS Task Definition  | 1-255 chars, letters, numbers, hyphens, underscores
# Secrets Manager      | 1-512 chars, alphanumeric, /_+=.@-
# CloudWatch Log Group | 1-512 chars, alphanumeric, _./#-, start with alphanumeric or /
# SNS Topic            | 1-256 chars, alphanumeric, hyphens, underscores
# CodeBuild Project    | 2-255 chars, alphanumeric, -_
# CloudFormation Stack | 1-128 chars, start with letter, alphanumeric, hyphens
# API Gateway          | 1-128 chars, any characters
# =============================================================================

# Don't exit on error - we want to continue checking all permissions
# set -e

# Configuration
AWS_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
AWS_PROFILE=""
TIMESTAMP=$(date +%Y%m%d%H%M%S)
LOG_FILE="permission-check-${TIMESTAMP}.log"
# AWS Naming Convention: lowercase alphanumeric with hyphens, must start with letter
TEST_PREFIX="permcheck${TIMESTAMP}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
SKIPPED=0
CLEANUP_ITEMS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile) AWS_PROFILE="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        --log-file) LOG_FILE="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--profile <profile>] [--region <region>] [--log-file <file>]"
            exit 0
            ;;
        *) shift ;;
    esac
done

AWS_CLI_OPTS="--region $AWS_REGION"
[[ -n "$AWS_PROFILE" ]] && AWS_CLI_OPTS="--profile $AWS_PROFILE $AWS_CLI_OPTS"

# =============================================================================
# Logging Functions
# =============================================================================
log() {
    local level="$1"
    local action="$2"
    local resource="$3"
    local status="$4"
    local details="$5"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Log to file in CSV format
    echo "${timestamp},${level},${action},${resource},${status},\"${details}\"" >> "$LOG_FILE"
    
    # Console output
    case "$status" in
        "SUCCESS") echo -e "${GREEN}✓${NC} [${level}] ${action}: ${resource}" ;;
        "FAILED")  echo -e "${RED}✗${NC} [${level}] ${action}: ${resource} - ${details}" ;;
        "SKIPPED") echo -e "${YELLOW}○${NC} [${level}] ${action}: ${resource} - ${details}" ;;
        "INFO")    echo -e "${BLUE}ℹ${NC} [${level}] ${action}: ${resource}" ;;
        *)         echo "[${level}] ${action}: ${resource} - ${status}" ;;
    esac
}

print_header() {
    echo ""
    echo -e "${BLUE}=============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=============================================================================${NC}"
    echo ""
    log "HEADER" "$1" "-" "INFO" ""
}

# =============================================================================
# Test Functions
# =============================================================================
test_permission() {
    local service="$1"
    local action="$2"
    local test_cmd="$3"
    local cleanup_cmd="$4"
    local resource_name="$5"
    
    log "$service" "$action" "$resource_name" "INFO" "Testing..."
    
    if eval "$test_cmd" > /dev/null 2>&1; then
        log "$service" "$action" "$resource_name" "SUCCESS" "Permission granted"
        ((PASSED++))
        
        # Add cleanup if provided
        if [[ -n "$cleanup_cmd" ]]; then
            CLEANUP_ITEMS+=("$cleanup_cmd")
        fi
        return 0
    else
        local error=$(eval "$test_cmd" 2>&1 || true)
        log "$service" "$action" "$resource_name" "FAILED" "$error"
        ((FAILED++))
        return 1
    fi
}

# =============================================================================
# Initialize Log File
# =============================================================================
init_log() {
    echo "timestamp,level,action,resource,status,details" > "$LOG_FILE"
    log "SYSTEM" "Initialize" "Log File" "SUCCESS" "$LOG_FILE"
    
    # Get caller identity
    IDENTITY=$(aws sts get-caller-identity $AWS_CLI_OPTS 2>/dev/null)
    ACCOUNT_ID=$(echo "$IDENTITY" | jq -r '.Account')
    USER_ARN=$(echo "$IDENTITY" | jq -r '.Arn')
    
    log "SYSTEM" "GetCallerIdentity" "$USER_ARN" "SUCCESS" "Account: $ACCOUNT_ID"
    
    echo ""
    echo -e "${BLUE}Account:${NC} $ACCOUNT_ID"
    echo -e "${BLUE}User:${NC} $USER_ARN"
    echo -e "${BLUE}Region:${NC} $AWS_REGION"
    echo -e "${BLUE}Log File:${NC} $LOG_FILE"
    echo -e "${BLUE}Test Prefix:${NC} $TEST_PREFIX"
}

# =============================================================================
# Cleanup Function
# =============================================================================
cleanup() {
    print_header "Cleanup Test Resources"
    
    for cmd in "${CLEANUP_ITEMS[@]}"; do
        log "CLEANUP" "Delete" "$cmd" "INFO" "Cleaning up..."
        if eval "$cmd" > /dev/null 2>&1; then
            log "CLEANUP" "Delete" "Resource" "SUCCESS" "Cleaned up"
        else
            log "CLEANUP" "Delete" "Resource" "FAILED" "Manual cleanup may be required"
        fi
    done
}

trap cleanup EXIT

# =============================================================================
# Main Permission Tests
# =============================================================================

init_log

print_header "Step 1: S3 Write Permissions"

# Test S3 bucket creation
# S3 Naming: 3-63 chars, lowercase letters, numbers, hyphens, must start with letter/number
S3_BUCKET="permcheck-$(date +%s)-$(echo $RANDOM | md5sum | head -c 6)"
# Note: Non-us-east-1 regions require LocationConstraint
if [[ "$AWS_REGION" == "us-east-1" ]]; then
    S3_CREATE_CMD="aws s3api create-bucket --bucket $S3_BUCKET $AWS_CLI_OPTS"
else
    S3_CREATE_CMD="aws s3api create-bucket --bucket $S3_BUCKET --create-bucket-configuration LocationConstraint=$AWS_REGION $AWS_CLI_OPTS"
fi
test_permission "S3" "CreateBucket" \
    "$S3_CREATE_CMD" \
    "aws s3api delete-bucket --bucket $S3_BUCKET $AWS_CLI_OPTS" \
    "$S3_BUCKET"

# Test S3 put object (if bucket was created)
if aws s3api head-bucket --bucket "$S3_BUCKET" $AWS_CLI_OPTS 2>/dev/null; then
    test_permission "S3" "PutObject" \
        "aws s3api put-object --bucket $S3_BUCKET --key test.txt --body /dev/null $AWS_CLI_OPTS" \
        "aws s3api delete-object --bucket $S3_BUCKET --key test.txt $AWS_CLI_OPTS" \
        "$S3_BUCKET/test.txt"
fi

print_header "Step 2: IAM Write Permissions"

# Test IAM role creation
# IAM Role Naming: alphanumeric plus +=,.@-_ chars, max 64 chars, must start with alphanumeric
IAM_ROLE="PermCheckRole-${TIMESTAMP}"
TRUST_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
test_permission "IAM" "CreateRole" \
    "aws iam create-role --role-name $IAM_ROLE --assume-role-policy-document '$TRUST_POLICY' $AWS_CLI_OPTS" \
    "aws iam delete-role --role-name $IAM_ROLE $AWS_CLI_OPTS" \
    "$IAM_ROLE"

# Test IAM policy attachment
if aws iam get-role --role-name "$IAM_ROLE" $AWS_CLI_OPTS 2>/dev/null; then
    INLINE_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"logs:*","Resource":"*"}]}'
    test_permission "IAM" "PutRolePolicy" \
        "aws iam put-role-policy --role-name $IAM_ROLE --policy-name test-policy --policy-document '$INLINE_POLICY' $AWS_CLI_OPTS" \
        "aws iam delete-role-policy --role-name $IAM_ROLE --policy-name test-policy $AWS_CLI_OPTS" \
        "$IAM_ROLE/test-policy"
fi

print_header "Step 3: EC2/VPC Write Permissions"

# Test VPC creation
# EC2 Tags: Name tag for identification
VPC_ID=""
VPC_RESULT=$(aws ec2 create-vpc --cidr-block 10.99.0.0/24 --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=PermCheckVpc-${TIMESTAMP}}]" $AWS_CLI_OPTS 2>&1) || true
if echo "$VPC_RESULT" | jq -e '.Vpc.VpcId' > /dev/null 2>&1; then
    VPC_ID=$(echo "$VPC_RESULT" | jq -r '.Vpc.VpcId')
    log "EC2" "CreateVpc" "$VPC_ID" "SUCCESS" "VPC created"
    ((PASSED++))
    CLEANUP_ITEMS+=("aws ec2 delete-vpc --vpc-id $VPC_ID $AWS_CLI_OPTS")
else
    log "EC2" "CreateVpc" "VPC" "FAILED" "$VPC_RESULT"
    ((FAILED++))
fi

# Test Security Group creation (if VPC was created)
# Security Group Name: alphanumeric plus spaces and ._-:/()#,@[]+=&;{}!$* chars
SG_ID=""
if [[ -n "$VPC_ID" ]]; then
    SG_RESULT=$(aws ec2 create-security-group --group-name "PermCheckSG-${TIMESTAMP}" --description "Permission Check Test SG" --vpc-id "$VPC_ID" $AWS_CLI_OPTS 2>&1) || true
    if echo "$SG_RESULT" | jq -e '.GroupId' > /dev/null 2>&1; then
        SG_ID=$(echo "$SG_RESULT" | jq -r '.GroupId')
        log "EC2" "CreateSecurityGroup" "$SG_ID" "SUCCESS" "Security group created"
        ((PASSED++))
        CLEANUP_ITEMS+=("aws ec2 delete-security-group --group-id $SG_ID $AWS_CLI_OPTS")
    else
        log "EC2" "CreateSecurityGroup" "SecurityGroup" "FAILED" "$SG_RESULT"
        ((FAILED++))
    fi
fi

# Test Subnet creation
# Subnet: Uses Name tag for identification
SUBNET_ID=""
if [[ -n "$VPC_ID" ]]; then
    SUBNET_RESULT=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.99.0.0/28 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=PermCheckSubnet-${TIMESTAMP}}]" $AWS_CLI_OPTS 2>&1) || true
    if echo "$SUBNET_RESULT" | jq -e '.Subnet.SubnetId' > /dev/null 2>&1; then
        SUBNET_ID=$(echo "$SUBNET_RESULT" | jq -r '.Subnet.SubnetId')
        log "EC2" "CreateSubnet" "$SUBNET_ID" "SUCCESS" "Subnet created"
        ((PASSED++))
        CLEANUP_ITEMS+=("aws ec2 delete-subnet --subnet-id $SUBNET_ID $AWS_CLI_OPTS")
    else
        log "EC2" "CreateSubnet" "Subnet" "FAILED" "$SUBNET_RESULT"
        ((FAILED++))
    fi
fi

print_header "Step 4: ECR Write Permissions"

# Test ECR repository creation
# ECR Naming: lowercase letters, numbers, hyphens, underscores, forward slashes, max 256 chars
ECR_REPO="permcheck-repo-${TIMESTAMP}"
test_permission "ECR" "CreateRepository" \
    "aws ecr create-repository --repository-name $ECR_REPO $AWS_CLI_OPTS" \
    "aws ecr delete-repository --repository-name $ECR_REPO --force $AWS_CLI_OPTS" \
    "$ECR_REPO"

print_header "Step 5: ECS Write Permissions"

# Test ECS cluster creation
# ECS Cluster Naming: letters, numbers, hyphens, underscores, max 255 chars
ECS_CLUSTER="PermCheckCluster-${TIMESTAMP}"
test_permission "ECS" "CreateCluster" \
    "aws ecs create-cluster --cluster-name $ECS_CLUSTER $AWS_CLI_OPTS" \
    "aws ecs delete-cluster --cluster $ECS_CLUSTER $AWS_CLI_OPTS" \
    "$ECS_CLUSTER"

# Test ECS task definition registration
# Task Definition Family: letters, numbers, hyphens, underscores, max 255 chars
TASK_DEF_FAMILY="PermCheckTask-${TIMESTAMP}"
TASK_DEF='{
  "family": "'$TASK_DEF_FAMILY'",
  "containerDefinitions": [{
    "name": "test",
    "image": "nginx:latest",
    "memory": 256,
    "essential": true
  }],
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512"
}'
test_permission "ECS" "RegisterTaskDefinition" \
    "aws ecs register-task-definition --cli-input-json '$TASK_DEF' $AWS_CLI_OPTS" \
    "aws ecs deregister-task-definition --task-definition $TASK_DEF_FAMILY:1 $AWS_CLI_OPTS" \
    "$TASK_DEF_FAMILY"

print_header "Step 6: Secrets Manager Write Permissions"

# Test secret creation
# Secrets Manager Naming: alphanumeric plus /_+=.@- chars, max 512 chars
SECRET_NAME="PermCheck/Secret-${TIMESTAMP}"
test_permission "SecretsManager" "CreateSecret" \
    "aws secretsmanager create-secret --name $SECRET_NAME --secret-string 'test-value' $AWS_CLI_OPTS" \
    "aws secretsmanager delete-secret --secret-id $SECRET_NAME --force-delete-without-recovery $AWS_CLI_OPTS" \
    "$SECRET_NAME"

print_header "Step 7: CloudWatch Logs Write Permissions"

# Test log group creation
# Log Group Naming: alphanumeric plus _./#- chars, 1-512 chars, must start with alphanumeric or /
LOG_GROUP="/permcheck/loggroup-${TIMESTAMP}"
test_permission "CloudWatchLogs" "CreateLogGroup" \
    "aws logs create-log-group --log-group-name $LOG_GROUP $AWS_CLI_OPTS" \
    "aws logs delete-log-group --log-group-name $LOG_GROUP $AWS_CLI_OPTS" \
    "$LOG_GROUP"

print_header "Step 8: SNS Write Permissions"

# Test SNS topic creation
# SNS Topic Naming: alphanumeric plus hyphens and underscores, max 256 chars
SNS_TOPIC="PermCheckTopic-${TIMESTAMP}"
test_permission "SNS" "CreateTopic" \
    "aws sns create-topic --name $SNS_TOPIC $AWS_CLI_OPTS" \
    "aws sns delete-topic --topic-arn arn:aws:sns:$AWS_REGION:$ACCOUNT_ID:$SNS_TOPIC $AWS_CLI_OPTS" \
    "$SNS_TOPIC"

print_header "Step 9: CodeBuild Write Permissions"

# Test CodeBuild project creation (requires IAM role)
# CodeBuild Project Naming: 2-255 chars, alphanumeric plus -_
CODEBUILD_PROJECT="PermCheckBuild-${TIMESTAMP}"
if aws iam get-role --role-name "$IAM_ROLE" $AWS_CLI_OPTS 2>/dev/null; then
    ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$IAM_ROLE"
    CODEBUILD_DEF='{
      "name": "'$CODEBUILD_PROJECT'",
      "source": {"type": "NO_SOURCE", "buildspec": "version: 0.2\nphases:\n  build:\n    commands:\n      - echo test"},
      "artifacts": {"type": "NO_ARTIFACTS"},
      "environment": {"type": "LINUX_CONTAINER", "computeType": "BUILD_GENERAL1_SMALL", "image": "aws/codebuild/standard:5.0"},
      "serviceRole": "'$ROLE_ARN'"
    }'
    test_permission "CodeBuild" "CreateProject" \
        "aws codebuild create-project --cli-input-json '$CODEBUILD_DEF' $AWS_CLI_OPTS" \
        "aws codebuild delete-project --name $CODEBUILD_PROJECT $AWS_CLI_OPTS" \
        "$CODEBUILD_PROJECT"
else
    log "CodeBuild" "CreateProject" "$CODEBUILD_PROJECT" "SKIPPED" "IAM role not available"
    ((SKIPPED++))
fi

print_header "Step 10: CloudFormation Write Permissions"

# Test CloudFormation stack creation with minimal template
# CloudFormation Stack Naming: must start with letter, alphanumeric plus hyphens, max 128 chars
CFN_STACK="PermCheckStack-${TIMESTAMP}"
CFN_TEMPLATE='{"AWSTemplateFormatVersion":"2010-09-09","Description":"Test stack","Resources":{"WaitHandle":{"Type":"AWS::CloudFormation::WaitConditionHandle"}}}'
test_permission "CloudFormation" "CreateStack" \
    "aws cloudformation create-stack --stack-name $CFN_STACK --template-body '$CFN_TEMPLATE' $AWS_CLI_OPTS" \
    "aws cloudformation delete-stack --stack-name $CFN_STACK $AWS_CLI_OPTS" \
    "$CFN_STACK"

# Wait for stack creation if it was started
if aws cloudformation describe-stacks --stack-name "$CFN_STACK" $AWS_CLI_OPTS 2>/dev/null; then
    log "CloudFormation" "WaitForStack" "$CFN_STACK" "INFO" "Waiting for stack creation..."
    aws cloudformation wait stack-create-complete --stack-name "$CFN_STACK" $AWS_CLI_OPTS 2>/dev/null || true
fi

print_header "Step 11: ELB Write Permissions (Read-only check)"

# ELB requires VPC resources, so we do a read check
log "ELB" "DescribeLoadBalancers" "ALB" "INFO" "Checking read access (write requires VPC setup)"
if aws elbv2 describe-load-balancers $AWS_CLI_OPTS > /dev/null 2>&1; then
    log "ELB" "DescribeLoadBalancers" "ALB" "SUCCESS" "Read access confirmed"
    ((PASSED++))
else
    log "ELB" "DescribeLoadBalancers" "ALB" "FAILED" "No read access"
    ((FAILED++))
fi

print_header "Step 12: API Gateway Write Permissions"

# Test API Gateway creation
# API Gateway Naming: any characters, max 128 chars
API_NAME="PermCheckApi-${TIMESTAMP}"
API_RESULT=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP $AWS_CLI_OPTS 2>&1) || true
if echo "$API_RESULT" | jq -e '.ApiId' > /dev/null 2>&1; then
    API_ID=$(echo "$API_RESULT" | jq -r '.ApiId')
    log "APIGateway" "CreateApi" "$API_ID" "SUCCESS" "API created"
    ((PASSED++))
    CLEANUP_ITEMS+=("aws apigatewayv2 delete-api --api-id $API_ID $AWS_CLI_OPTS")
else
    log "APIGateway" "CreateApi" "$API_NAME" "FAILED" "$API_RESULT"
    ((FAILED++))
fi

# =============================================================================
# Summary
# =============================================================================
print_header "Permission Check Summary"

echo ""
echo -e "${GREEN}Passed:${NC}  $PASSED"
echo -e "${RED}Failed:${NC}  $FAILED"
echo -e "${YELLOW}Skipped:${NC} $SKIPPED"
echo ""

# Log summary
log "SUMMARY" "TotalPassed" "$PASSED" "INFO" ""
log "SUMMARY" "TotalFailed" "$FAILED" "INFO" ""
log "SUMMARY" "TotalSkipped" "$SKIPPED" "INFO" ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All write permission checks passed!${NC}"
    echo "Your user has sufficient permissions to run the deployment script."
    log "SUMMARY" "Result" "ALL_PASSED" "SUCCESS" "Ready for deployment"
else
    echo -e "${YELLOW}Some permission checks failed.${NC}"
    echo "Review the log file for details: $LOG_FILE"
    echo ""
    echo "Missing permissions may cause deployment failures."
    log "SUMMARY" "Result" "SOME_FAILED" "FAILED" "Review required"
fi

echo ""
echo -e "${BLUE}Log file saved to:${NC} $LOG_FILE"
echo ""

# Show failed items from log
if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}Failed Actions:${NC}"
    grep ",FAILED," "$LOG_FILE" | while IFS=',' read -r ts level action resource status details; do
        echo "  - $action: $resource"
    done
    echo ""
fi
