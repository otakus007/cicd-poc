#!/bin/bash
# =============================================================================
# Common Utilities — Shared by deploy.sh and teardown.sh
# =============================================================================
# Colors, print helpers, stack query functions, AWS credential validation.
# =============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# PRINT HELPERS
# =============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}=============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=============================================================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# =============================================================================
# STACK QUERY FUNCTIONS
# =============================================================================

get_stack_name() {
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        echo "${PROJECT_NAME}-${ENVIRONMENT}-ec2-main"
    else
        echo "${PROJECT_NAME}-${ENVIRONMENT}-main"
    fi
}

get_stack_status() {
    local stack_name="$1"
    aws cloudformation describe-stacks --stack-name "$stack_name" $AWS_CLI_OPTS \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST"
}

check_stack_exists() {
    local stack_name="$1"
    local status=$(get_stack_status "$stack_name")
    [[ "$status" != "DOES_NOT_EXIST" ]]
}

get_stack_events() {
    local stack_name="$1"
    local limit="${2:-10}"

    aws cloudformation describe-stack-events --stack-name "$stack_name" $AWS_CLI_OPTS \
        --query "StackEvents[:${limit}].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]" \
        --output table 2>/dev/null || true
}

wait_for_stack() {
    local stack_name="$1"
    local operation="$2"  # create or update

    print_info "Waiting for stack $operation to complete..."

    local wait_command="stack-${operation}-complete"

    if aws cloudformation wait "$wait_command" --stack-name "$stack_name" $AWS_CLI_OPTS; then
        print_success "Stack $operation completed successfully"
        return 0
    else
        print_error "Stack $operation failed"
        return 1
    fi
}

# =============================================================================
# AWS CREDENTIAL VALIDATION
# =============================================================================

validate_aws_credentials() {
    print_header "Validating AWS Credentials"

    # Build AWS CLI options
    AWS_CLI_OPTS=""
    if [[ -n "$AWS_PROFILE" ]]; then
        AWS_CLI_OPTS="--profile $AWS_PROFILE"
    fi
    AWS_CLI_OPTS="$AWS_CLI_OPTS --region $AWS_REGION"

    if ! aws sts get-caller-identity $AWS_CLI_OPTS > /dev/null 2>&1; then
        print_error "AWS credentials are not configured or invalid"
        print_info "Please configure AWS credentials using 'aws configure' or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
        exit 1
    fi

    AWS_ACCOUNT_ID=$(aws sts get-caller-identity $AWS_CLI_OPTS --query 'Account' --output text)
    AWS_USER_ARN=$(aws sts get-caller-identity $AWS_CLI_OPTS --query 'Arn' --output text)

    print_success "AWS credentials validated"
    print_info "Account ID: $AWS_ACCOUNT_ID"
    print_info "User/Role: $AWS_USER_ARN"
    print_info "Region: $AWS_REGION"
}
