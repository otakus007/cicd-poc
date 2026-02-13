#!/bin/bash
# =============================================================================
# ECS Operations — Used by teardown.sh
# =============================================================================
# ECR cleanup, ECS service stop/drain, shared resource checks,
# termination protection, log group deletion, S3 bucket deletion.
# Requires: lib/common.sh sourced first.
# =============================================================================

# =============================================================================
# ECR CLEANUP
# =============================================================================

empty_ecr_repository() {
    print_header "Emptying ECR Repository"

    local repo_name="${PROJECT_NAME}-${ENVIRONMENT}"

    if ! aws ecr describe-repositories --repository-names "$repo_name" $AWS_CLI_OPTS > /dev/null 2>&1; then
        print_info "ECR repository '$repo_name' does not exist or already deleted"
        return 0
    fi

    local image_ids=$(aws ecr list-images --repository-name "$repo_name" $AWS_CLI_OPTS \
        --query 'imageIds[*]' --output json 2>/dev/null)

    if [[ -z "$image_ids" || "$image_ids" == "[]" ]]; then
        print_info "ECR repository is already empty"
        return 0
    fi

    print_info "Deleting all images from ECR repository: $repo_name"

    echo "$image_ids" | jq -c '.[:100]' | while read batch; do
        if [[ "$batch" != "[]" ]]; then
            aws ecr batch-delete-image \
                --repository-name "$repo_name" \
                --image-ids "$batch" \
                $AWS_CLI_OPTS > /dev/null 2>&1 || true
        fi
    done

    print_success "ECR repository emptied"
}

# =============================================================================
# ECS SERVICE OPERATIONS
# =============================================================================

stop_ecs_services() {
    print_header "Stopping ECS Services"

    local cluster_name="${PROJECT_NAME}-${ENVIRONMENT}-cluster"
    local service_name="${PROJECT_NAME}-${ENVIRONMENT}-service"

    if ! aws ecs describe-clusters --clusters "$cluster_name" $AWS_CLI_OPTS \
        --query 'clusters[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        print_info "ECS cluster '$cluster_name' does not exist or is not active"
        return 0
    fi

    local service_status=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        $AWS_CLI_OPTS \
        --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")

    if [[ "$service_status" == "MISSING" || "$service_status" == "INACTIVE" ]]; then
        print_info "ECS service '$service_name' does not exist or is inactive"
        return 0
    fi

    print_info "Scaling down ECS service to 0 tasks..."

    aws ecs update-service \
        --cluster "$cluster_name" \
        --service "$service_name" \
        --desired-count 0 \
        $AWS_CLI_OPTS > /dev/null 2>&1 || true

    print_info "Waiting for tasks to stop (max 2 minutes)..."
    local timeout=120
    local elapsed=0

    while [[ $elapsed -lt $timeout ]]; do
        local running_count=$(aws ecs describe-services \
            --cluster "$cluster_name" \
            --services "$service_name" \
            $AWS_CLI_OPTS \
            --query 'services[0].runningCount' --output text 2>/dev/null || echo "0")

        if [[ "$running_count" == "0" ]]; then
            print_success "All ECS tasks stopped"
            return 0
        fi

        sleep 10
        elapsed=$((elapsed + 10))
        print_info "Still waiting... ($running_count tasks running)"
    done

    print_warning "Timeout waiting for tasks to stop, proceeding anyway"
}

drain_ec2_cluster() {
    if [[ "$COMPUTE_TYPE" != "ec2" ]]; then
        return 0
    fi

    print_header "Draining EC2 ECS Cluster"

    local cluster_name="${PROJECT_NAME}-${ENVIRONMENT}-ec2-cluster"
    local service_name="${PROJECT_NAME}-${ENVIRONMENT}-ec2-service"

    if ! aws ecs describe-clusters --clusters "$cluster_name" $AWS_CLI_OPTS \
        --query 'clusters[0].status' --output text 2>/dev/null | grep -q "ACTIVE"; then
        print_info "EC2 ECS cluster '$cluster_name' does not exist or is not active"
        return 0
    fi

    local service_status=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        $AWS_CLI_OPTS \
        --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")

    if [[ "$service_status" == "MISSING" || "$service_status" == "INACTIVE" ]]; then
        print_info "EC2 ECS service '$service_name' does not exist or is inactive"
    else
        print_info "Scaling down EC2 ECS service to 0 tasks..."

        aws ecs update-service \
            --cluster "$cluster_name" \
            --service "$service_name" \
            --desired-count 0 \
            $AWS_CLI_OPTS > /dev/null 2>&1 || true

        print_info "Waiting for EC2 tasks to drain (max 5 minutes)..."
        local timeout=300
        local elapsed=0

        while [[ $elapsed -lt $timeout ]]; do
            local running_count=$(aws ecs describe-services \
                --cluster "$cluster_name" \
                --services "$service_name" \
                $AWS_CLI_OPTS \
                --query 'services[0].runningCount' --output text 2>/dev/null || echo "0")

            if [[ "$running_count" == "0" ]]; then
                print_success "All EC2 ECS tasks drained"
                break
            fi

            sleep 15
            elapsed=$((elapsed + 15))
            print_info "Still draining... ($running_count tasks running)"
        done

        if [[ $elapsed -ge $timeout ]]; then
            print_warning "Timeout waiting for EC2 tasks to drain, proceeding anyway"
        fi
    fi

    # Drain container instances from the cluster
    print_info "Draining container instances from cluster..."

    local container_instances=$(aws ecs list-container-instances \
        --cluster "$cluster_name" \
        $AWS_CLI_OPTS \
        --query 'containerInstanceArns' --output text 2>/dev/null || echo "")

    if [[ -n "$container_instances" && "$container_instances" != "None" ]]; then
        for instance_arn in $container_instances; do
            print_info "Setting container instance to DRAINING: $instance_arn"
            aws ecs update-container-instances-state \
                --cluster "$cluster_name" \
                --container-instances "$instance_arn" \
                --status DRAINING \
                $AWS_CLI_OPTS > /dev/null 2>&1 || true
        done

        print_info "Waiting for container instances to drain (max 3 minutes)..."
        local drain_timeout=180
        local drain_elapsed=0

        while [[ $drain_elapsed -lt $drain_timeout ]]; do
            local running_tasks=$(aws ecs describe-container-instances \
                --cluster "$cluster_name" \
                --container-instances $container_instances \
                $AWS_CLI_OPTS \
                --query 'sum(containerInstances[].runningTasksCount)' --output text 2>/dev/null || echo "0")

            if [[ "$running_tasks" == "0" || "$running_tasks" == "None" ]]; then
                print_success "All container instances drained"
                break
            fi

            sleep 15
            drain_elapsed=$((drain_elapsed + 15))
            print_info "Still draining container instances... ($running_tasks tasks running)"
        done

        if [[ $drain_elapsed -ge $drain_timeout ]]; then
            print_warning "Timeout waiting for container instances to drain, proceeding anyway"
        fi
    else
        print_info "No container instances found in cluster"
    fi

    print_success "EC2 cluster drain complete"
}

# =============================================================================
# SHARED RESOURCE CHECKS
# =============================================================================

check_shared_resources() {
    print_header "Checking for Shared Resources"

    local other_type=""
    local other_stack=""

    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        other_type="fargate"
        other_stack="${PROJECT_NAME}-${ENVIRONMENT}-main"
    else
        other_type="ec2"
        other_stack="${PROJECT_NAME}-${ENVIRONMENT}-ec2-main"
    fi

    if check_stack_exists "$other_stack"; then
        print_warning "The $other_type deployment still exists (stack: $other_stack)"
        print_warning "Shared resources (VPC, ALB, ECR) will NOT be deleted until both deployments are removed."
        print_info "To fully clean up, also run: ./teardown.sh -e $ENVIRONMENT --compute-type $other_type"
        echo ""
    else
        print_info "No other compute type deployment found"
    fi
}

# =============================================================================
# TERMINATION PROTECTION
# =============================================================================

disable_termination_protection() {
    print_header "Disabling Termination Protection"

    local stack_name=$(get_stack_name)

    if ! check_stack_exists "$stack_name"; then
        print_info "Stack does not exist"
        return 0
    fi

    local protection=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        $AWS_CLI_OPTS \
        --query 'Stacks[0].EnableTerminationProtection' --output text 2>/dev/null || echo "false")

    if [[ "$protection" == "true" ]]; then
        print_info "Disabling termination protection..."
        aws cloudformation update-termination-protection \
            --no-enable-termination-protection \
            --stack-name "$stack_name" \
            $AWS_CLI_OPTS
        print_success "Termination protection disabled"
    else
        print_info "Termination protection is not enabled"
    fi
}

# =============================================================================
# STACK DELETION (TEARDOWN)
# =============================================================================

delete_stack() {
    print_header "Deleting CloudFormation Stack"

    local stack_name=$(get_stack_name)
    local stack_status=$(get_stack_status "$stack_name")

    print_info "Stack: $stack_name"
    print_info "Current Status: $stack_status"

    if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
        print_info "Stack does not exist, nothing to delete"
        return 0
    fi

    if [[ "$stack_status" == *"IN_PROGRESS"* ]]; then
        print_error "Stack is currently in progress ($stack_status)"
        print_info "Please wait for the current operation to complete"
        exit 1
    fi

    print_info "Initiating stack deletion..."

    aws cloudformation delete-stack --stack-name "$stack_name" $AWS_CLI_OPTS

    print_info "Waiting for stack deletion to complete (this may take 15-30 minutes)..."

    local start_time=$(date +%s)
    local timeout=1800  # 30 minutes

    while true; do
        local current_status=$(get_stack_status "$stack_name")
        local elapsed=$(($(date +%s) - start_time))

        case "$current_status" in
            "DOES_NOT_EXIST")
                print_success "Stack deleted successfully"
                return 0
                ;;
            "DELETE_IN_PROGRESS")
                if [[ $elapsed -gt $timeout ]]; then
                    print_error "Timeout waiting for stack deletion"
                    exit 1
                fi
                print_info "Deletion in progress... (${elapsed}s elapsed)"
                sleep 30
                ;;
            "DELETE_FAILED")
                print_error "Stack deletion failed"
                print_info "Checking for resources that failed to delete..."
                show_failed_resources "$stack_name"

                print_info "Attempting to clean up blocking resources..."
                cleanup_vpc_links

                local failed_resources
                failed_resources=$(aws cloudformation describe-stack-resources \
                    --stack-name "$stack_name" $AWS_CLI_OPTS \
                    --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].LogicalResourceId' \
                    --output text 2>/dev/null || echo "")

                if [[ -n "$failed_resources" && "$failed_resources" != "None" ]]; then
                    print_info "Retrying delete, retaining stuck resources: $failed_resources"
                    # shellcheck disable=SC2086
                    aws cloudformation delete-stack --stack-name "$stack_name" \
                        --retain-resources $failed_resources $AWS_CLI_OPTS 2>/dev/null || true
                    sleep 15
                else
                    print_error "Could not determine failed resources. Manual cleanup may be needed."
                    exit 1
                fi
                ;;
            *)
                print_error "Unexpected stack status: $current_status"
                exit 1
                ;;
        esac
    done
}

show_failed_resources() {
    local stack_name="$1"

    echo ""
    print_warning "Resources that failed to delete:"

    aws cloudformation describe-stack-resources \
        --stack-name "$stack_name" \
        $AWS_CLI_OPTS \
        --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceType,ResourceStatusReason]' \
        --output table 2>/dev/null || true

    echo ""
    print_info "You may need to manually delete these resources and retry"
}

# =============================================================================
# POST-DELETION CLEANUP
# =============================================================================

delete_log_groups() {
    if [[ "$RETAIN_LOGS" == "true" ]]; then
        print_info "Retaining CloudWatch log groups (--retain-logs specified)"
        return 0
    fi

    print_header "Deleting CloudWatch Log Groups"

    local log_group_prefix="/aws/codebuild/${PROJECT_NAME}-${ENVIRONMENT}"
    local ecs_log_group="/ecs/${PROJECT_NAME}-${ENVIRONMENT}"

    local log_groups=$(aws logs describe-log-groups \
        --log-group-name-prefix "$log_group_prefix" \
        $AWS_CLI_OPTS \
        --query 'logGroups[*].logGroupName' --output text 2>/dev/null || echo "")

    for lg in $log_groups; do
        print_info "Deleting log group: $lg"
        aws logs delete-log-group --log-group-name "$lg" $AWS_CLI_OPTS 2>/dev/null || true
    done

    if aws logs describe-log-groups --log-group-name-prefix "$ecs_log_group" $AWS_CLI_OPTS \
        --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$ecs_log_group"; then
        print_info "Deleting log group: $ecs_log_group"
        aws logs delete-log-group --log-group-name "$ecs_log_group" $AWS_CLI_OPTS 2>/dev/null || true
    fi

    print_success "Log groups deleted"
}

empty_and_delete_s3_bucket() {
    if [[ "$DELETE_BUCKET" != "true" || -z "$TEMPLATES_BUCKET" ]]; then
        return 0
    fi

    print_header "Deleting S3 Templates Bucket"

    if ! aws s3api head-bucket --bucket "$TEMPLATES_BUCKET" $AWS_CLI_OPTS 2>/dev/null; then
        print_info "S3 bucket '$TEMPLATES_BUCKET' does not exist"
        return 0
    fi

    print_info "Emptying S3 bucket: $TEMPLATES_BUCKET"

    aws s3 rm "s3://${TEMPLATES_BUCKET}" --recursive $AWS_CLI_OPTS 2>/dev/null || true

    local versions=$(aws s3api list-object-versions \
        --bucket "$TEMPLATES_BUCKET" \
        $AWS_CLI_OPTS \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$versions" | jq '.Objects | length') -gt 0 ]]; then
        echo "$versions" | aws s3api delete-objects \
            --bucket "$TEMPLATES_BUCKET" \
            --delete "$versions" \
            $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    local markers=$(aws s3api list-object-versions \
        --bucket "$TEMPLATES_BUCKET" \
        $AWS_CLI_OPTS \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$markers" | jq '.Objects | length') -gt 0 ]]; then
        echo "$markers" | aws s3api delete-objects \
            --bucket "$TEMPLATES_BUCKET" \
            --delete "$markers" \
            $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    print_info "Deleting S3 bucket..."
    aws s3api delete-bucket --bucket "$TEMPLATES_BUCKET" $AWS_CLI_OPTS

    print_success "S3 bucket deleted: $TEMPLATES_BUCKET"
}

cleanup_deployment_outputs() {
    print_header "Cleaning Up Local Files"

    local output_file="${PROJECT_ROOT}/deployment-outputs-${ENVIRONMENT}.json"

    if [[ -f "$output_file" ]]; then
        rm -f "$output_file"
        print_success "Removed: $output_file"
    else
        print_info "No deployment outputs file to remove"
    fi
}
