#!/bin/bash
# =============================================================================
# Cleanup Utilities — Shared by deploy.sh and teardown.sh
# =============================================================================
# VPC Link cleanup, force stack deletion, artifact bucket cleanup.
# Requires: lib/common.sh sourced first.
# =============================================================================

# ---------------------------------------------------------------------------
# Delete orphaned VPC Links that block CloudFormation stack deletion.
# When a stack rollback happens, API Gateway VPC Links can get stuck in
# PENDING or AVAILABLE state, preventing the nested stack from being deleted.
# ---------------------------------------------------------------------------
cleanup_vpc_links() {
    local project_prefix="${PROJECT_NAME}-${ENVIRONMENT}"
    print_info "Checking for orphaned VPC Links matching '${project_prefix}'..."

    local vpc_links
    vpc_links=$(aws apigatewayv2 get-vpc-links $AWS_CLI_OPTS \
        --query "Items[?contains(Name, \`${project_prefix}\`)].{Id:VpcLinkId,Name:Name,Status:VpcLinkStatus}" \
        --output json 2>/dev/null || echo "[]")

    local count
    count=$(echo "$vpc_links" | jq 'length')

    if [[ "$count" -eq 0 ]]; then
        print_info "No orphaned VPC Links found"
        return 0
    fi

    print_warning "Found $count orphaned VPC Link(s), deleting..."

    echo "$vpc_links" | jq -r '.[].Id' | while read -r vpc_link_id; do
        local name
        name=$(echo "$vpc_links" | jq -r ".[] | select(.Id==\"$vpc_link_id\") | .Name")
        print_info "Deleting VPC Link: $name ($vpc_link_id)..."
        if aws apigatewayv2 delete-vpc-link --vpc-link-id "$vpc_link_id" $AWS_CLI_OPTS 2>/dev/null; then
            print_success "Deleted VPC Link: $vpc_link_id"
        else
            print_warning "Could not delete VPC Link $vpc_link_id (may already be gone)"
        fi
    done

    # Wait for VPC Links to fully delete
    print_info "Waiting for VPC Link deletion to propagate..."
    local retries=0
    while [[ $retries -lt 12 ]]; do
        local remaining
        remaining=$(aws apigatewayv2 get-vpc-links $AWS_CLI_OPTS \
            --query "Items[?contains(Name, \`${project_prefix}\`)] | length(@)" \
            --output text 2>/dev/null || echo "0")
        if [[ "$remaining" -eq 0 ]]; then
            print_success "All VPC Links deleted"
            return 0
        fi
        sleep 10
        retries=$((retries + 1))
    done
    print_warning "Some VPC Links may still be deleting"
}

# ---------------------------------------------------------------------------
# Force-delete a CloudFormation stack that is in a FAILED state.
# Handles DELETE_FAILED by retaining problematic resources, then cleaning
# them up manually (VPC Links, etc.) and retrying the delete.
# ---------------------------------------------------------------------------
force_delete_stack() {
    local stack_name="$1"
    print_header "Force Deleting Stack: $stack_name"

    local stack_status
    stack_status=$(get_stack_status "$stack_name")

    if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
        print_info "Stack does not exist, nothing to delete"
        return 0
    fi

    # If stack is in progress, wait for it to settle
    if [[ "$stack_status" == *"IN_PROGRESS"* ]]; then
        print_info "Stack is $stack_status, waiting for it to settle..."
        local wait_retries=0
        while [[ $wait_retries -lt 60 ]]; do
            sleep 15
            stack_status=$(get_stack_status "$stack_name")
            if [[ "$stack_status" != *"IN_PROGRESS"* ]]; then
                break
            fi
            wait_retries=$((wait_retries + 1))
        done
    fi

    # First attempt: normal delete
    print_info "Attempting stack deletion (attempt 1)..."
    aws cloudformation delete-stack --stack-name "$stack_name" $AWS_CLI_OPTS 2>/dev/null || true
    aws cloudformation wait stack-delete-complete --stack-name "$stack_name" $AWS_CLI_OPTS 2>/dev/null

    stack_status=$(get_stack_status "$stack_name")
    if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
        print_success "Stack deleted successfully"
        return 0
    fi

    # If DELETE_FAILED, clean up blocking resources and retry
    if [[ "$stack_status" == "DELETE_FAILED" ]]; then
        print_warning "Stack delete failed. Cleaning up blocking resources..."

        cleanup_vpc_links

        local failed_resources
        failed_resources=$(aws cloudformation describe-stack-resources \
            --stack-name "$stack_name" $AWS_CLI_OPTS \
            --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].LogicalResourceId' \
            --output json 2>/dev/null || echo "[]")

        local retain_list
        retain_list=$(echo "$failed_resources" | jq -r '.[]' | tr '\n' ' ')

        if [[ -n "$retain_list" ]]; then
            print_info "Retrying delete, retaining stuck resources: $retain_list"
            # shellcheck disable=SC2086
            aws cloudformation delete-stack --stack-name "$stack_name" \
                --retain-resources $retain_list $AWS_CLI_OPTS 2>/dev/null || true
        else
            aws cloudformation delete-stack --stack-name "$stack_name" $AWS_CLI_OPTS 2>/dev/null || true
        fi

        aws cloudformation wait stack-delete-complete --stack-name "$stack_name" $AWS_CLI_OPTS 2>/dev/null

        stack_status=$(get_stack_status "$stack_name")
        if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
            print_success "Stack deleted successfully (with retained resources cleaned up)"
            return 0
        fi
    fi

    # Final attempt: retain all failed resources just to get the stack gone
    if [[ "$stack_status" == "DELETE_FAILED" ]]; then
        print_warning "Final delete attempt — retaining all failed resources..."
        local all_failed
        all_failed=$(aws cloudformation describe-stack-resources \
            --stack-name "$stack_name" $AWS_CLI_OPTS \
            --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].LogicalResourceId' \
            --output text 2>/dev/null || echo "")
        if [[ -n "$all_failed" ]]; then
            # shellcheck disable=SC2086
            aws cloudformation delete-stack --stack-name "$stack_name" \
                --retain-resources $all_failed $AWS_CLI_OPTS 2>/dev/null || true
            aws cloudformation wait stack-delete-complete --stack-name "$stack_name" $AWS_CLI_OPTS 2>/dev/null
        fi
    fi

    stack_status=$(get_stack_status "$stack_name")
    if [[ "$stack_status" == "DOES_NOT_EXIST" ]]; then
        print_success "Stack fully deleted"
        return 0
    else
        print_error "Could not fully delete stack (status: $stack_status)"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Empty and delete the pipeline artifacts S3 bucket (has DeletionPolicy: Retain)
# ---------------------------------------------------------------------------
cleanup_artifact_bucket() {
    print_header "Cleaning Up Pipeline Artifact Bucket"

    local bucket_name="${PROJECT_NAME}-${ENVIRONMENT}-pipeline-artifacts-${AWS_ACCOUNT_ID}"

    if ! aws s3api head-bucket --bucket "$bucket_name" $AWS_CLI_OPTS 2>/dev/null; then
        print_info "Artifact bucket '$bucket_name' does not exist"
        return 0
    fi

    print_info "Emptying artifact bucket: $bucket_name"
    aws s3 rm "s3://${bucket_name}" --recursive $AWS_CLI_OPTS 2>/dev/null || true

    # Delete all object versions
    local versions
    versions=$(aws s3api list-object-versions --bucket "$bucket_name" $AWS_CLI_OPTS \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$versions" | jq '.Objects // [] | length') -gt 0 ]]; then
        echo "$versions" | aws s3api delete-objects --bucket "$bucket_name" \
            --delete "$versions" $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    # Delete all delete markers
    local markers
    markers=$(aws s3api list-object-versions --bucket "$bucket_name" $AWS_CLI_OPTS \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null || echo '{"Objects": null}')

    if [[ $(echo "$markers" | jq '.Objects // [] | length') -gt 0 ]]; then
        echo "$markers" | aws s3api delete-objects --bucket "$bucket_name" \
            --delete "$markers" $AWS_CLI_OPTS > /dev/null 2>&1 || true
    fi

    print_info "Deleting artifact bucket..."
    aws s3api delete-bucket --bucket "$bucket_name" $AWS_CLI_OPTS 2>/dev/null || true

    print_success "Artifact bucket cleaned up"
}
