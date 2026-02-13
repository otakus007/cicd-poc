#!/bin/bash
# =============================================================================
# Shared Infrastructure Deployment Script
# =============================================================================
# Deploys shared AWS infrastructure: VPC, Security Groups, IAM, ALB,
# API Gateway, ECS Cluster, and Monitoring.
#
# Per-project resources (ECR, pipelines, services) are deployed separately
# using deploy-project.sh.
# =============================================================================

set -e

# =============================================================================
# CONFIGURATION
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INFRASTRUCTURE_DIR="${PROJECT_ROOT}/infrastructure"

# Default values
DEFAULT_PROJECT_NAME="japfa-api"
DEFAULT_VPC_CIDR="10.0.0.0/16"
DEFAULT_COMPUTE_TYPE="fargate"

# =============================================================================
# SOURCE LIBRARY MODULES
# =============================================================================
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/cleanup.sh"
source "${SCRIPT_DIR}/lib/templates.sh"
source "${SCRIPT_DIR}/lib/stack-operations.sh"
source "${SCRIPT_DIR}/lib/outputs.sh"

# =============================================================================
# USAGE
# =============================================================================

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the shared infrastructure to AWS.

Required Options:
    -e, --environment       Environment to deploy (dev, staging, prod)
    -b, --bucket            S3 bucket name for CloudFormation templates

Optional Options:
    -n, --project-name      Project name for resource naming (default: ${DEFAULT_PROJECT_NAME})
    -c, --vpc-cidr          VPC CIDR block (default: ${DEFAULT_VPC_CIDR})
    --compute-type          Compute type: fargate or ec2 (default: ${DEFAULT_COMPUTE_TYPE})
    --custom-domain         Custom domain name (e.g., api.my-company.com.vn)
    --certificate-arn       ACM Certificate ARN for the custom domain
    --prefix                S3 prefix for templates (default: infrastructure)
    --region                AWS region (default: uses AWS_DEFAULT_REGION or us-east-1)
    --profile               AWS CLI profile to use
    --rollback-on-failure   Enable automatic rollback on failure (default: true)
    --skip-upload           Skip uploading templates to S3 (use existing)
    --dry-run               Validate templates without deploying
    -h, --help              Show this help message

Examples:
    # Deploy shared infra to dev
    $(basename "$0") -e dev -b japfa-api-cfn-us-east-1

    # Deploy with custom project name
    $(basename "$0") -e dev -b japfa-api-cfn-us-east-1 -n my-platform

    # Dry run to validate templates
    $(basename "$0") -e dev -b japfa-api-cfn-us-east-1 --dry-run

After deploying shared infra, deploy each project:
    ./scripts/deploy-project.sh -s cash-collection -o myorg -p myproject \\
        -r myrepo --branch main -b japfa-api-cfn-us-east-1 -e dev

EOF
    exit 1
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

ENVIRONMENT=""
TEMPLATES_BUCKET=""
PROJECT_NAME="${DEFAULT_PROJECT_NAME}"
VPC_CIDR="${DEFAULT_VPC_CIDR}"
COMPUTE_TYPE="${DEFAULT_COMPUTE_TYPE}"
CUSTOM_DOMAIN=""
CERTIFICATE_ARN=""
TEMPLATES_PREFIX="infrastructure"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
AWS_PROFILE=""
ROLLBACK_ON_FAILURE="true"
SKIP_UPLOAD="false"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -b|--bucket)
            TEMPLATES_BUCKET="$2"
            shift 2
            ;;
        -n|--project-name)
            PROJECT_NAME="$2"
            shift 2
            ;;
        -c|--vpc-cidr)
            VPC_CIDR="$2"
            shift 2
            ;;
        --compute-type)
            COMPUTE_TYPE="$2"
            shift 2
            ;;
        --custom-domain)
            CUSTOM_DOMAIN="$2"
            shift 2
            ;;
        --certificate-arn)
            CERTIFICATE_ARN="$2"
            shift 2
            ;;
        --prefix)
            TEMPLATES_PREFIX="$2"
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
        --rollback-on-failure)
            ROLLBACK_ON_FAILURE="$2"
            shift 2
            ;;
        --skip-upload)
            SKIP_UPLOAD="true"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
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

    if [[ -z "$TEMPLATES_BUCKET" ]]; then
        print_error "S3 bucket (-b) is required"
        errors=$((errors + 1))
    fi

    if [[ ! "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]]; then
        print_error "Project name must be lowercase alphanumeric with hyphens"
        errors=$((errors + 1))
    fi

    if [[ ! "$VPC_CIDR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        print_error "Invalid VPC CIDR format"
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

    print_success "All input parameters validated"
}

# =============================================================================
# ERROR HANDLING
# =============================================================================

cleanup_on_error() {
    local exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        print_error "Deployment failed with exit code: $exit_code"

        local stack_name=$(get_stack_name)
        local stack_status=$(get_stack_status "$stack_name")

        if [[ "$stack_status" == *"FAILED"* || "$stack_status" == *"ROLLBACK"* ]]; then
            print_info "Stack status: $stack_status"
            print_info "Recent stack events:"
            get_stack_events "$stack_name" 10

            print_header "Cleaning Up Failed Deployment"
            print_info "Deleting all resources created by the failed deployment..."
            force_delete_stack "$stack_name"
        fi
    fi

    exit $exit_code
}

trap cleanup_on_error EXIT

# =============================================================================
# MAIN EXECUTION
# =============================================================================

main() {
    print_header "Shared Infrastructure Deployment"

    echo "Environment:      $ENVIRONMENT"
    echo "Project Name:     $PROJECT_NAME"
    echo "Compute Type:     $COMPUTE_TYPE"
    echo "AWS Region:       $AWS_REGION"
    echo "Templates Bucket: $TEMPLATES_BUCKET"
    echo ""

    # Validation phase
    validate_inputs
    validate_aws_credentials
    validate_s3_bucket
    validate_templates

    # Upload phase
    upload_templates

    # Deployment phase
    deploy_stack

    # Output phase
    display_outputs

    # Generate deployment log
    generate_deployment_log

    print_header "Deployment Complete"
    print_success "Shared infrastructure deployed successfully!"

    echo ""
    print_info "Next steps — deploy a project:"
    echo "  ./scripts/deploy-project.sh -s <service-name> -o <org> -p <project> -r <repo> \\"
    echo "      --branch <branch> -b ${TEMPLATES_BUCKET} -e ${ENVIRONMENT}"
    echo ""
}

# Run main function
main
