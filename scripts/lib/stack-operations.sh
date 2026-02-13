#!/bin/bash
# =============================================================================
# Stack Operations — Used by deploy.sh
# =============================================================================
# deploy_stack for shared infrastructure.
# Requires: lib/common.sh and lib/cleanup.sh sourced first.
# =============================================================================

# =============================================================================
# STACK DEPLOYMENT
# =============================================================================

deploy_stack() {
    print_header "Deploying Main Stack"

    local stack_name=$(get_stack_name)

    # Select template based on compute type
    local template_file="main.yaml"
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        template_file="main-ec2.yaml"
    fi
    local template_url="https://${TEMPLATES_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${TEMPLATES_PREFIX}/${template_file}"

    # Build parameters — shared infra only, no per-project params
    local parameters=(
        "ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
        "ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME}"
        "ParameterKey=ComputeType,ParameterValue=${COMPUTE_TYPE}"
        "ParameterKey=VpcCidr,ParameterValue=${VPC_CIDR}"
        "ParameterKey=TemplatesBucketName,ParameterValue=${TEMPLATES_BUCKET}"
        "ParameterKey=TemplatesBucketPrefix,ParameterValue=${TEMPLATES_PREFIX}"
        "ParameterKey=CustomDomainName,ParameterValue=${CUSTOM_DOMAIN}"
        "ParameterKey=CertificateArn,ParameterValue=${CERTIFICATE_ARN}"
    )

    local capabilities="CAPABILITY_NAMED_IAM"

    local tags=(
        "Key=Environment,Value=${ENVIRONMENT}"
        "Key=Project,Value=${PROJECT_NAME}"
        "Key=ComputeType,Value=${COMPUTE_TYPE}"
    )

    local stack_status=$(get_stack_status "$stack_name")
    local operation=""

    print_info "Stack: $stack_name"
    print_info "Current Status: $stack_status"
    print_info "Template: $template_file"
    print_info "Template URL: $template_url"
    print_info "Compute Type: $COMPUTE_TYPE"

    if [[ "$DRY_RUN" == "true" ]]; then
        print_warning "Dry run mode - skipping actual deployment"
        print_info "Would deploy with parameters:"
        for param in "${parameters[@]}"; do
            echo "  - $param"
        done
        print_info "Would deploy with tags:"
        for tag in "${tags[@]}"; do
            echo "  - $tag"
        done
        return 0
    fi

    case "$stack_status" in
        "DOES_NOT_EXIST")
            operation="create"
            print_info "Creating new stack..."

            aws cloudformation create-stack \
                --stack-name "$stack_name" \
                --template-url "$template_url" \
                --parameters "${parameters[@]}" \
                --capabilities "$capabilities" \
                --tags "${tags[@]}" \
                --on-failure "$([ "$ROLLBACK_ON_FAILURE" == "true" ] && echo "ROLLBACK" || echo "DO_NOTHING")" \
                $AWS_CLI_OPTS
            ;;
        "CREATE_COMPLETE"|"UPDATE_COMPLETE"|"UPDATE_ROLLBACK_COMPLETE")
            operation="update"
            print_info "Updating existing stack..."

            local update_output
            update_output=$(aws cloudformation update-stack \
                --stack-name "$stack_name" \
                --template-url "$template_url" \
                --parameters "${parameters[@]}" \
                --capabilities "$capabilities" \
                --tags "${tags[@]}" \
                $AWS_CLI_OPTS 2>&1) || {
                if [[ "$update_output" == *"No updates are to be performed"* ]]; then
                    print_warning "No updates are to be performed"
                    return 0
                fi
                print_error "Stack update failed: $update_output"
                return 1
            }
            ;;
        "ROLLBACK_COMPLETE"|"ROLLBACK_FAILED"|"DELETE_COMPLETE"|"DELETE_FAILED")
            print_warning "Stack is in $stack_status state. Force-deleting and recreating..."

            force_delete_stack "$stack_name"

            operation="create"
            aws cloudformation create-stack \
                --stack-name "$stack_name" \
                --template-url "$template_url" \
                --parameters "${parameters[@]}" \
                --capabilities "$capabilities" \
                --tags "${tags[@]}" \
                --on-failure "$([ "$ROLLBACK_ON_FAILURE" == "true" ] && echo "ROLLBACK" || echo "DO_NOTHING")" \
                $AWS_CLI_OPTS
            ;;
        *"IN_PROGRESS"*)
            print_error "Stack is currently in progress ($stack_status). Please wait for it to complete."
            exit 1
            ;;
        *)
            print_error "Stack is in unexpected state: $stack_status"
            print_info "Recent stack events:"
            get_stack_events "$stack_name" 5
            print_info "Attempting force cleanup before exit..."
            force_delete_stack "$stack_name"
            exit 1
            ;;
    esac

    if ! wait_for_stack "$stack_name" "$operation"; then
        print_error "Stack deployment failed"
        print_info "Recent stack events:"
        get_stack_events "$stack_name" 10
        exit 1
    fi
}
