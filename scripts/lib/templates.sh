#!/bin/bash
# =============================================================================
# Template Management — Used by deploy.sh
# =============================================================================
# Validate and upload CloudFormation templates to S3.
# Requires: lib/common.sh sourced first.
# =============================================================================

# =============================================================================
# TEMPLATE LIST HELPER
# =============================================================================

get_template_list() {
    # Shared infrastructure templates only.
    # Per-project templates (ecr, secrets, codebuild, codepipeline,
    # task-definition, ecs-service) are uploaded by deploy-project.sh.
    local templates=(
        "vpc.yaml"
        "security-groups.yaml"
        "iam.yaml"
        "alb.yaml"
        "api-gateway.yaml"
        "monitoring.yaml"
    )

    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        templates+=(
            "ecs-ec2-cluster.yaml"
            "main-ec2.yaml"
        )
    else
        templates+=(
            "ecs-cluster.yaml"
            "main.yaml"
        )
    fi

    # Also upload project template so deploy-project.sh can reference it from S3
    if [[ "$COMPUTE_TYPE" == "ec2" ]]; then
        templates+=("project-ec2.yaml")
    else
        templates+=("project.yaml")
    fi

    echo "${templates[@]}"
}

# =============================================================================
# VALIDATE TEMPLATES
# =============================================================================

validate_templates() {
    print_header "Validating CloudFormation Templates"

    local templates
    read -ra templates <<< "$(get_template_list)"

    local errors=0

    for template in "${templates[@]}"; do
        local template_path="${INFRASTRUCTURE_DIR}/${template}"

        if [[ ! -f "$template_path" ]]; then
            print_error "Template not found: $template"
            errors=$((errors + 1))
            continue
        fi

        if aws cloudformation validate-template --template-body "file://${template_path}" $AWS_CLI_OPTS > /dev/null 2>&1; then
            print_success "Valid: $template"
        else
            print_error "Invalid: $template"
            aws cloudformation validate-template --template-body "file://${template_path}" $AWS_CLI_OPTS 2>&1 || true
            errors=$((errors + 1))
        fi
    done

    if [[ $errors -gt 0 ]]; then
        print_error "Template validation failed with $errors error(s)"
        exit 1
    fi

    print_success "All templates validated successfully"
}

# =============================================================================
# UPLOAD TEMPLATES
# =============================================================================

upload_templates() {
    print_header "Uploading Templates to S3"

    if [[ "$SKIP_UPLOAD" == "true" ]]; then
        print_warning "Skipping template upload (--skip-upload specified)"
        return
    fi

    local templates
    read -ra templates <<< "$(get_template_list)"

    for template in "${templates[@]}"; do
        local template_path="${INFRASTRUCTURE_DIR}/${template}"
        local s3_key="${TEMPLATES_PREFIX}/${template}"

        print_info "Uploading: $template -> s3://${TEMPLATES_BUCKET}/${s3_key}"
        aws s3 cp "$template_path" "s3://${TEMPLATES_BUCKET}/${s3_key}" $AWS_CLI_OPTS
    done

    print_success "All templates uploaded to S3"
}

# =============================================================================
# VALIDATE S3 BUCKET
# =============================================================================

validate_s3_bucket() {
    print_header "Validating S3 Bucket"

    if ! aws s3api head-bucket --bucket "$TEMPLATES_BUCKET" $AWS_CLI_OPTS 2>/dev/null; then
        print_warning "S3 bucket '$TEMPLATES_BUCKET' does not exist or is not accessible"
        print_info "Creating S3 bucket..."

        if [[ "$AWS_REGION" == "us-east-1" ]]; then
            aws s3api create-bucket --bucket "$TEMPLATES_BUCKET" $AWS_CLI_OPTS
        else
            aws s3api create-bucket --bucket "$TEMPLATES_BUCKET" \
                --create-bucket-configuration LocationConstraint="$AWS_REGION" $AWS_CLI_OPTS
        fi

        aws s3api put-bucket-versioning --bucket "$TEMPLATES_BUCKET" \
            --versioning-configuration Status=Enabled $AWS_CLI_OPTS

        print_success "S3 bucket created: $TEMPLATES_BUCKET"
    else
        print_success "S3 bucket exists: $TEMPLATES_BUCKET"
    fi
}
