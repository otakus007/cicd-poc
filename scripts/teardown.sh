#!/bin/bash
# =============================================================================
# CI/CD Pipeline Teardown Script
# =============================================================================
# This script deletes all AWS resources created by the CI/CD pipeline deployment.
# It handles proper deletion order, empties S3 buckets and ECR repositories,
# and provides safety confirmations before destructive operations.
#
# WARNING: This script will permanently delete all infrastructure resources!
# =============================================================================

set -e

# =============================================================================
# CONFIGURATION
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
DEFAULT_PROJECT_NAME="japfa-api"
DEFAULT_COMPUTE_TYPE="fargate"

# =============================================================================
# SOURCE LIBRARY MODULES
# =============================================================================
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/cleanup.sh"
source "${SCRIPT_DIR}/lib/ecs-operations.sh"

# =============================================================================
# USAGE
# =============================================================================

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Delete all AWS resources created by the CI/CD Pipeline.

Required Options:
    -e, --environment       Environment to teardown (dev, staging, prod)

Optional Options:
    -n, --project-name      Project name used during deployment (default: ${DEFAULT_PROJECT_NAME})
    --compute-type          Compute type to teardown: fargate or ec2 (default: ${DEFAULT_COMPUTE_TYPE})
    -b, --bucket            S3 bucket name for CloudFormation templates (will be emptied)
    --region                AWS region (default: uses AWS_DEFAULT_REGION or us-east-1)
    --profile               AWS CLI profile to use
    --force                 Skip confirmation prompts (use with caution!)
    --delete-bucket         Also delete the S3 templates bucket
    --retain-logs           Retain CloudWatch log groups
    -h, --help              Show this help message

Examples:
    # Teardown development environment (with confirmation)
    $(basename "$0") -e dev

    # Teardown EC2-based deployment
    $(basename "$0") -e dev --compute-type ec2

    # Teardown production with force (no confirmation)
    $(basename "$0") -e prod --force

    # Teardown and also delete the S3 templates bucket
    $(basename "$0") -e dev -b my-cfn-bucket --delete-bucket

EOF
    exit 1
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

ENVIRONMENT=""
PROJECT_NAME="${DEFAULT_PROJECT_NAME}"
COMPUTE_TYPE="${DEFAULT_COMPUTE_TYPE}"
TEMPLATES_BUCKET=""
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
AWS_PROFILE=""
FORCE_DELETE="false"
DELETE_BUCKET="false"
RETAIN_LOGS="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -n|--project-name)
            PROJECT_NAME="$2"
            shift 2
            ;;
        --compute-type)
            COMPUTE_TYPE="$2"
            shift 2
            ;;
        -b|--bucket)
            TEMPLATES_BUCKET="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --profile)
            AWS_PROFILE="$2"
            shift 2
            ;;
        --force)
            FORCE_DELETE="true"
            shift
            ;;
        --delete-bucket)
            DELETE_BUCKET="true"
            shift
            ;;
        --retain-logs)
            RETAIN_LOGS="true"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            ;;
    esac
done

# =============================================================================
# VALIDATION
# =============================================================================

validate_inputs() {
    print_header "Validating Input Parameters"

    local errors=0

    if [[ -z "$ENVIRONMENT" ]]; then
        print_error "Environment (-e) is required"
        errors=$((errors + 1))
    elif [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        print_error "Environment must be one of: dev, staging, prod"
        errors=$((errors + 1))
    fi

    if [[ ! "$COMPUTE_TYPE" =~ ^(fargate|ec2)$ ]]; then
        print_error "Compute type must be 'fargate' or 'ec2'"
        errors=$((errors + 1))
    else
        print_success "Compute type: $COMPUTE_TYPE"
    fi

    if [[ $errors -gt 0 ]]; then
        echo ""
        print_error "Validation failed with $errors error(s)"
        exit 1
    fi

    print_success "Input parameters validated"
}

# =============================================================================
# CONFIRMATION
# =============================================================================

confirm_deletion() {
    local stack_name=$(get_stack_name)

    print_header "⚠️  DESTRUCTIVE OPERATION WARNING ⚠️"

    echo -e "${RED}This will PERMANENTLY DELETE the following resources:${NC}"
    echo ""
    echo "  Stack Name:     $stack_name"
    echo "  Environment:    $ENVIRONMENT"
    echo "  Project:        $PROJECT_NAME"
    echo "  Compute Type:   $COMPUTE_TYPE"
    echo "  Region:         $AWS_REGION"
    echo ""
    echo "Resources to be deleted:"
    echo "  - VPC and all networking components (subnets, NAT gateways, etc.)"
    echo "  - Security Groups"
    echo "  - IAM Roles and Policies"
    echo "  - ECR Repository (including all container images)"
    echo "  - Secrets Manager secrets"
    echo "  - Application Load Balancer"
    echo "  - API Gateway"
    echo "  - ECS Cluster and Services"
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        echo "  - Auto Scaling Group and EC2 Instances"
        echo "  - Launch Template"
        echo "  - Capacity Provider"
    fi
    echo "  - CodeBuild Projects"
    echo "  - CodePipeline"
    echo "  - CloudWatch Alarms and Dashboard"
    if [[ "$RETAIN_LOGS" != "true" ]]; then
        echo "  - CloudWatch Log Groups"
    fi
    if [[ "$DELETE_BUCKET" == "true" && -n "$TEMPLATES_BUCKET" ]]; then
        echo "  - S3 Bucket: $TEMPLATES_BUCKET"
    fi
    echo ""

    if [[ "$FORCE_DELETE" == "true" ]]; then
        print_warning "Force mode enabled - skipping confirmation"
        return 0
    fi

    echo -e "${YELLOW}Are you sure you want to proceed? This action cannot be undone!${NC}"
    echo ""
    read -p "Type 'DELETE' to confirm: " confirmation

    if [[ "$confirmation" != "DELETE" ]]; then
        print_info "Teardown cancelled"
        exit 0
    fi

    echo ""
    print_warning "Proceeding with deletion..."
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

main() {
    print_header "CI/CD Pipeline Teardown"

    echo "Environment:     $ENVIRONMENT"
    echo "Project Name:    $PROJECT_NAME"
    echo "Compute Type:    $COMPUTE_TYPE"
    echo "AWS Region:      $AWS_REGION"
    echo ""

    # Validation
    validate_inputs
    validate_aws_credentials

    # Check for shared resources with other compute type
    check_shared_resources

    # Confirmation
    confirm_deletion

    # Pre-deletion cleanup
    empty_ecr_repository

    # Stop/drain services based on compute type
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        drain_ec2_cluster
    else
        stop_ecs_services
    fi

    disable_termination_protection

    # Delete main stack (this deletes all nested stacks)
    delete_stack

    # Post-deletion cleanup
    delete_log_groups
    cleanup_artifact_bucket
    empty_and_delete_s3_bucket
    cleanup_deployment_outputs

    print_header "Teardown Complete"
    print_success "All resources have been deleted successfully!"

    echo ""
    print_info "Summary:"
    echo "  - CloudFormation stack deleted"
    echo "  - ECR repository emptied and deleted"
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        echo "  - EC2 ECS cluster drained and deleted"
        echo "  - Auto Scaling Group instances terminated"
    else
        echo "  - ECS services stopped and deleted"
    fi
    if [[ "$RETAIN_LOGS" != "true" ]]; then
        echo "  - CloudWatch log groups deleted"
    else
        echo "  - CloudWatch log groups retained"
    fi
    if [[ "$DELETE_BUCKET" == "true" && -n "$TEMPLATES_BUCKET" ]]; then
        echo "  - S3 templates bucket deleted"
    fi
    echo ""
}

# Run main function
main
