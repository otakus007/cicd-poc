#!/bin/bash
# =============================================================================
# Teardown a per-project deployment
# =============================================================================
# Removes everything created by deploy-project.sh:
#   ECR images, artifact bucket (versioned), ECS service, CodePipeline,
#   CodeBuild projects, Secrets Manager secrets, log groups, ALB target group,
#   and the CloudFormation stack itself.
#
# Usage:
#   ./scripts/teardown-project.sh -s hsbc -e dev
#   ./scripts/teardown-project.sh -s hsbc -e dev --force
#   ./scripts/teardown-project.sh --all -e dev          # teardown ALL projects
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"

# Defaults
INFRA_PROJECT_NAME="japfa-api"
ENVIRONMENT=""
SERVICE_NAME=""
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
AWS_PROFILE=""
FORCE_DELETE="false"
RETAIN_LOGS="false"
TEARDOWN_ALL="false"
DELETE_SECRETS="false"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Teardown a per-project deployment created by deploy-project.sh.

Required:
    -s, --service           Service name to teardown (e.g. hsbc, cash-collection)
    -e, --environment       Environment (dev, staging, prod)

    OR:
    --all                   Teardown ALL project stacks in the environment
    -e, --environment       Environment (dev, staging, prod)

Optional:
    --infra-name            Shared infra project name (default: japfa-api)
    --region                AWS region (default: us-east-1)
    --profile               AWS CLI profile to use
    --force                 Skip confirmation prompts
    --retain-logs           Keep CloudWatch log groups
    --delete-secrets        Force-delete secrets immediately (skip 30-day recovery)
    -h, --help              Show help

Examples:
    $(basename "$0") -s hsbc -e dev
    $(basename "$0") -s hsbc -e dev --force --delete-secrets
    $(basename "$0") --all -e dev --force
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--service)       SERVICE_NAME="$2"; shift 2 ;;
        -e|--environment)   ENVIRONMENT="$2"; shift 2 ;;
        --infra-name)       INFRA_PROJECT_NAME="$2"; shift 2 ;;
        --region)           AWS_REGION="$2"; shift 2 ;;
        --profile)          AWS_PROFILE="$2"; shift 2 ;;
        --force)            FORCE_DELETE="true"; shift ;;
        --retain-logs)      RETAIN_LOGS="true"; shift ;;
        --delete-secrets)   DELETE_SECRETS="true"; shift ;;
        --all)              TEARDOWN_ALL="true"; shift ;;
        -h|--help)          usage ;;
        *)                  echo "Unknown option: $1"; usage ;;
    esac
done

# Validate
if [[ -z "$ENVIRONMENT" ]]; then
    print_error "Environment (-e) is required"
    usage
fi
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Environment must be one of: dev, staging, prod"
    exit 1
fi
if [[ "$TEARDOWN_ALL" != "true" && -z "$SERVICE_NAME" ]]; then
    print_error "Either --service or --all is required"
    usage
fi

# =============================================================================
# DISCOVER PROJECT STACKS
# =============================================================================

discover_project_stacks() {
    local prefix="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-"
    local main_stack="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-main"

    aws cloudformation list-stacks $AWS_CLI_OPTS \
        --query "StackSummaries[?StackStatus!='DELETE_COMPLETE' && starts_with(StackName, \`${prefix}\`) && StackName!=\`${main_stack}\` && !contains(StackName, \`-main-\`)].StackName" \
        --output text 2>/dev/null || echo ""
}

# =============================================================================
# EMPTY VERSIONED S3 BUCKET
# =============================================================================

empty_versioned_bucket() {
    local bucket="$1"

    if ! aws s3api head-bucket --bucket "$bucket" $AWS_CLI_OPTS 2>/dev/null; then
        print_info "Bucket '$bucket' does not exist"
        return 0
    fi

    print_info "Emptying bucket: $bucket"

    # Delete current objects
    aws s3 rm "s3://${bucket}" --recursive $AWS_CLI_OPTS 2>/dev/null || true

    # Delete all object versions
    local versions
    versions=$(aws s3api list-object-versions --bucket "$bucket" $AWS_CLI_OPTS \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$versions" | jq '.Objects // [] | length') -gt 0 ]]; then
        echo "$versions" | aws s3api delete-objects --bucket "$bucket" \
            --delete file:///dev/stdin $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    # Delete all delete markers
    local markers
    markers=$(aws s3api list-object-versions --bucket "$bucket" $AWS_CLI_OPTS \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$markers" | jq '.Objects // [] | length') -gt 0 ]]; then
        echo "$markers" | aws s3api delete-objects --bucket "$bucket" \
            --delete file:///dev/stdin $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    # Delete the bucket itself
    print_info "Deleting bucket: $bucket"
    aws s3api delete-bucket --bucket "$bucket" $AWS_CLI_OPTS 2>/dev/null || true

    print_success "Bucket deleted: $bucket"
}

# =============================================================================
# TEARDOWN A SINGLE PROJECT
# =============================================================================

teardown_project() {
    local svc="$1"
    local stack_name="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}"
    local ecr_repo="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}"
    local cluster="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-cluster"
    local ecs_svc="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}-svc"

    print_header "Tearing down project: ${svc}"

    # Check stack exists
    local stack_status
    stack_status=$(get_stack_status "$stack_name")
    if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
        print_info "Stack '$stack_name' does not exist — nothing to do"
        return 0
    fi
    print_info "Stack status: $stack_status"

    # Get account ID for bucket name
    local account_id
    account_id=$(aws sts get-caller-identity $AWS_CLI_OPTS --query Account --output text)
    local artifact_bucket="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}-artifacts-${account_id}"

    # -------------------------------------------------------------------------
    # 1. Scale down ECS service
    # -------------------------------------------------------------------------
    print_info "Scaling down ECS service..."
    local svc_status
    svc_status=$(aws ecs describe-services --cluster "$cluster" --services "$ecs_svc" $AWS_CLI_OPTS \
        --query 'services[0].{s:status,r:runningCount}' --output json 2>/dev/null || echo '{"s":"MISSING"}')

    if [[ $(echo "$svc_status" | jq -r '.s') != "MISSING" ]]; then
        aws ecs update-service --cluster "$cluster" --service "$ecs_svc" --desired-count 0 \
            $AWS_CLI_OPTS > /dev/null 2>&1 || true

        # Wait up to 90s for tasks to drain
        local waited=0
        while [[ $waited -lt 90 ]]; do
            local running
            running=$(aws ecs describe-services --cluster "$cluster" --services "$ecs_svc" $AWS_CLI_OPTS \
                --query 'services[0].runningCount' --output text 2>/dev/null || echo "0")
            [[ "$running" == "0" ]] && break
            sleep 10
            waited=$((waited + 10))
        done
        print_success "ECS service scaled to 0"
    else
        print_info "ECS service not found (may already be deleted)"
    fi

    # -------------------------------------------------------------------------
    # 2. Stop pipeline executions
    # -------------------------------------------------------------------------
    print_info "Stopping active pipeline executions..."
    local pipeline_name="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}-pipeline"
    local active_executions
    active_executions=$(aws codepipeline list-pipeline-executions --pipeline-name "$pipeline_name" $AWS_CLI_OPTS \
        --query "pipelineExecutionSummaries[?status=='InProgress'].pipelineExecutionId" \
        --output text 2>/dev/null || echo "")

    for exec_id in $active_executions; do
        if [[ -n "$exec_id" && "$exec_id" != "None" ]]; then
            aws codepipeline stop-pipeline-execution \
                --pipeline-name "$pipeline_name" \
                --pipeline-execution-id "$exec_id" \
                --abandon \
                --reason "Teardown in progress" \
                $AWS_CLI_OPTS > /dev/null 2>&1 || true
            print_info "Stopped execution: $exec_id"
        fi
    done

    # -------------------------------------------------------------------------
    # 3. Empty ECR repository
    # -------------------------------------------------------------------------
    print_info "Emptying ECR repository: $ecr_repo"
    local image_ids
    image_ids=$(aws ecr list-images --repository-name "$ecr_repo" $AWS_CLI_OPTS \
        --query 'imageIds[*]' --output json 2>/dev/null || echo "[]")

    if [[ "$image_ids" != "[]" && -n "$image_ids" ]]; then
        echo "$image_ids" | jq -c '[.[:100]]' | while read -r batch; do
            aws ecr batch-delete-image --repository-name "$ecr_repo" \
                --image-ids "$batch" $AWS_CLI_OPTS > /dev/null 2>&1 || true
        done
        print_success "ECR images deleted"
    else
        print_info "ECR repository already empty"
    fi

    # -------------------------------------------------------------------------
    # 4. Empty artifact bucket (versioned, DeletionPolicy: Retain)
    # -------------------------------------------------------------------------
    empty_versioned_bucket "$artifact_bucket"

    # -------------------------------------------------------------------------
    # 5. Delete CloudFormation stack
    # -------------------------------------------------------------------------
    print_info "Deleting CloudFormation stack: $stack_name"
    aws cloudformation delete-stack --stack-name "$stack_name" $AWS_CLI_OPTS

    print_info "Waiting for stack deletion (this may take a few minutes)..."
    local start_time
    start_time=$(date +%s)

    while true; do
        local current_status
        current_status=$(get_stack_status "$stack_name")
        local elapsed=$(( $(date +%s) - start_time ))

        case "$current_status" in
            "DOES_NOT_EXIST")
                print_success "Stack deleted"
                break
                ;;
            "DELETE_IN_PROGRESS")
                if [[ $elapsed -gt 900 ]]; then
                    print_error "Timeout after 15 minutes"
                    return 1
                fi
                sleep 15
                ;;
            "DELETE_FAILED")
                print_warning "Stack delete failed — retrying with retained resources..."
                local failed_resources
                failed_resources=$(aws cloudformation describe-stack-resources \
                    --stack-name "$stack_name" $AWS_CLI_OPTS \
                    --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].LogicalResourceId' \
                    --output text 2>/dev/null || echo "")

                if [[ -n "$failed_resources" && "$failed_resources" != "None" ]]; then
                    # shellcheck disable=SC2086
                    aws cloudformation delete-stack --stack-name "$stack_name" \
                        --retain-resources $failed_resources $AWS_CLI_OPTS 2>/dev/null || true
                    sleep 15
                else
                    print_error "Could not determine failed resources for $stack_name"
                    return 1
                fi
                ;;
            *)
                print_error "Unexpected status: $current_status"
                return 1
                ;;
        esac
    done

    # -------------------------------------------------------------------------
    # 6. Force-delete secrets (skip 30-day recovery window)
    # -------------------------------------------------------------------------
    if [[ "$DELETE_SECRETS" == "true" ]]; then
        print_info "Force-deleting Secrets Manager secrets..."
        for secret_id in \
            "${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${svc}/azure-devops-pat" \
            "${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${svc}/db/connection-strings"; do
            aws secretsmanager delete-secret --secret-id "$secret_id" \
                --force-delete-without-recovery $AWS_CLI_OPTS 2>/dev/null || true
        done
        print_success "Secrets force-deleted"
    fi

    # -------------------------------------------------------------------------
    # 7. Delete log groups (CloudFormation may leave these if stack had issues)
    # -------------------------------------------------------------------------
    if [[ "$RETAIN_LOGS" != "true" ]]; then
        print_info "Cleaning up log groups..."
        for suffix in source swagger-gen lint build push contract-test; do
            local lg="/aws/codebuild/${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}-${suffix}"
            aws logs delete-log-group --log-group-name "$lg" $AWS_CLI_OPTS 2>/dev/null || true
        done
        local ecs_lg="/ecs/${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}"
        aws logs delete-log-group --log-group-name "$ecs_lg" $AWS_CLI_OPTS 2>/dev/null || true
        print_success "Log groups cleaned up"
    fi

    # -------------------------------------------------------------------------
    # 8. Deregister task definition revisions
    # -------------------------------------------------------------------------
    print_info "Deregistering task definitions..."
    local task_family="${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${svc}"
    local task_arns
    task_arns=$(aws ecs list-task-definitions --family-prefix "$task_family" $AWS_CLI_OPTS \
        --query 'taskDefinitionArns' --output text 2>/dev/null || echo "")

    for arn in $task_arns; do
        if [[ -n "$arn" && "$arn" != "None" ]]; then
            aws ecs deregister-task-definition --task-definition "$arn" $AWS_CLI_OPTS > /dev/null 2>&1 || true
        fi
    done
    # Delete inactive task definitions
    local inactive_arns
    inactive_arns=$(aws ecs list-task-definitions --family-prefix "$task_family" --status INACTIVE $AWS_CLI_OPTS \
        --query 'taskDefinitionArns' --output text 2>/dev/null || echo "")
    for arn in $inactive_arns; do
        if [[ -n "$arn" && "$arn" != "None" ]]; then
            aws ecs delete-task-definitions --task-definitions "$arn" $AWS_CLI_OPTS > /dev/null 2>&1 || true
        fi
    done
    print_success "Task definitions cleaned up"

    print_success "Project '${svc}' teardown complete"
    echo ""
}

# =============================================================================
# CONFIRMATION
# =============================================================================

confirm_deletion() {
    local targets="$1"

    print_header "DESTRUCTIVE OPERATION WARNING"

    echo -e "${RED}This will PERMANENTLY DELETE the following project(s):${NC}"
    echo ""
    for t in $targets; do
        echo "  - $t"
    done
    echo ""
    echo "  Environment:  $ENVIRONMENT"
    echo "  Infra Name:   $INFRA_PROJECT_NAME"
    echo "  Region:       $AWS_REGION"
    echo ""
    echo "Resources per project:"
    echo "  - ECR repository + all images"
    echo "  - S3 artifact bucket (all versions)"
    echo "  - ECS service + task definitions"
    echo "  - CodePipeline + CodeBuild projects"
    echo "  - ALB target group + listener rule"
    echo "  - Secrets Manager secrets"
    if [[ "$RETAIN_LOGS" != "true" ]]; then
        echo "  - CloudWatch log groups"
    fi
    echo ""

    if [[ "$FORCE_DELETE" == "true" ]]; then
        print_warning "Force mode — skipping confirmation"
        return 0
    fi

    echo -e "${YELLOW}Type 'DELETE' to confirm:${NC}"
    read -r confirmation
    if [[ "$confirmation" != "DELETE" ]]; then
        print_info "Cancelled"
        exit 0
    fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    print_header "Project Teardown"

    validate_aws_credentials

    local targets=""

    if [[ "$TEARDOWN_ALL" == "true" ]]; then
        print_info "Discovering all project stacks for ${INFRA_PROJECT_NAME}-${ENVIRONMENT}..."
        targets=$(discover_project_stacks)
        if [[ -z "$targets" ]]; then
            print_info "No project stacks found"
            exit 0
        fi
        # Extract service names from stack names
        local service_list=""
        for stack in $targets; do
            local svc="${stack#${INFRA_PROJECT_NAME}-${ENVIRONMENT}-}"
            service_list="${service_list} ${svc}"
        done
        targets="$service_list"
        print_info "Found projects:$targets"
    else
        targets="$SERVICE_NAME"
    fi

    confirm_deletion "$targets"

    local failed=0
    for svc in $targets; do
        if ! teardown_project "$svc"; then
            print_error "Failed to teardown: $svc"
            failed=$((failed + 1))
        fi
    done

    print_header "Teardown Summary"
    if [[ $failed -eq 0 ]]; then
        print_success "All projects torn down successfully"
    else
        print_error "$failed project(s) had errors during teardown"
        exit 1
    fi

    # Check remaining stacks
    echo ""
    print_info "Remaining stacks:"
    aws cloudformation list-stacks $AWS_CLI_OPTS \
        --query "StackSummaries[?StackStatus!='DELETE_COMPLETE' && contains(StackName, \`${INFRA_PROJECT_NAME}-${ENVIRONMENT}\`)].{Name:StackName,Status:StackStatus}" \
        --output table 2>/dev/null || echo "  (none)"
    echo ""
}

main
