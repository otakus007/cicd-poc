#!/bin/bash
# =============================================================================
# Output Display & Deployment Log — Used by deploy.sh
# =============================================================================
# display_outputs and generate_deployment_log for shared infrastructure.
# Requires: lib/common.sh sourced first.
# =============================================================================

# =============================================================================
# OUTPUT DISPLAY
# =============================================================================

display_outputs() {
    print_header "Deployment Outputs"

    local stack_name=$(get_stack_name)

    if [[ "$DRY_RUN" == "true" ]]; then
        print_warning "Dry run mode - no outputs to display"
        return 0
    fi

    local outputs=$(aws cloudformation describe-stacks --stack-name "$stack_name" $AWS_CLI_OPTS \
        --query 'Stacks[0].Outputs' --output json 2>/dev/null)

    if [[ -z "$outputs" || "$outputs" == "null" ]]; then
        print_warning "No outputs available"
        return 0
    fi

    echo ""
    echo -e "${GREEN}=== Shared Infrastructure Resources ===${NC}"
    echo ""

    local api_endpoint=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="ApiGatewayEndpoint") | .OutputValue // empty')
    if [[ -n "$api_endpoint" ]]; then
        echo -e "${BLUE}API Gateway Endpoint:${NC}"
        echo "  $api_endpoint"
        echo ""
    fi

    local alb_dns=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="AlbDnsName") | .OutputValue // empty')
    if [[ -n "$alb_dns" ]]; then
        echo -e "${BLUE}ALB DNS Name:${NC}"
        echo "  $alb_dns"
        echo ""
    fi

    local ecs_cluster_arn=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="EcsClusterArn") | .OutputValue // empty')
    local ecs_cluster_name=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="EcsClusterName") | .OutputValue // empty')
    if [[ -n "$ecs_cluster_arn" ]]; then
        echo -e "${BLUE}ECS Cluster:${NC}"
        echo "  Name: $ecs_cluster_name"
        echo "  ARN: $ecs_cluster_arn"
        echo ""
    fi

    local vpc_id=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="VpcId") | .OutputValue // empty')
    if [[ -n "$vpc_id" ]]; then
        echo -e "${BLUE}VPC:${NC}"
        echo "  ID: $vpc_id"
        echo ""
    fi

    local sns_arn=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="NotificationTopicArn") | .OutputValue // empty')
    if [[ -n "$sns_arn" ]]; then
        echo -e "${BLUE}SNS Notification Topic:${NC}"
        echo "  ARN: $sns_arn"
        echo ""
    fi

    local dashboard_name=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="DashboardName") | .OutputValue // empty')
    if [[ -n "$dashboard_name" ]]; then
        echo -e "${BLUE}CloudWatch Dashboard:${NC}"
        echo "  Name: $dashboard_name"
        echo "  URL: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${dashboard_name}"
        echo ""
    fi

    echo -e "${GREEN}=== Deployment Summary ===${NC}"
    echo ""
    echo "  Environment:    $ENVIRONMENT"
    echo "  Project:        $PROJECT_NAME"
    echo "  Compute Type:   $COMPUTE_TYPE"
    echo "  Region:         $AWS_REGION"
    echo "  Stack Name:     $stack_name"
    echo ""

    local output_file="${PROJECT_ROOT}/deployment-outputs-${ENVIRONMENT}.json"
    echo "$outputs" | jq '.' > "$output_file"
    print_success "Outputs saved to: $output_file"
}

# =============================================================================
# DEPLOYMENT LOG (MARKDOWN)
# =============================================================================

generate_deployment_log() {
    print_header "Generating Deployment Log"

    local stack_name=$(get_stack_name)
    local log_file="${PROJECT_ROOT}/deployment-log-${ENVIRONMENT}.md"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat > "$log_file" << EOF
# Deployment Log — ${PROJECT_NAME} Shared Infrastructure (${ENVIRONMENT})

**Generated:** ${timestamp}
**Stack Name:** ${stack_name}
**Region:** ${AWS_REGION}
**Account:** ${AWS_ACCOUNT_ID}
**Compute Type:** ${COMPUTE_TYPE}

---

## Nested CloudFormation Stacks (Shared Infrastructure)

| Stack | Logical ID | Template |
|-------|-----------|----------|
| VPC & Networking | VpcStack | vpc.yaml |
| Security Groups | SecurityGroupsStack | security-groups.yaml |
| IAM Roles & Policies | IamStack | iam.yaml |
| Application Load Balancer | AlbStack | alb.yaml |
| API Gateway | ApiGatewayStack | api-gateway.yaml |
| ECS Cluster | EcsClusterStack | ecs-cluster.yaml |
| Monitoring & Notifications | MonitoringStack | monitoring.yaml |

---

## Per-Project Resources (deployed via deploy-project.sh)

Each project stack creates:
- ECR Repository
- Secrets Manager (PAT + DB)
- ALB Target Group + Listener Rule
- ECS Task Definition + Service
- CodeBuild Projects (Source, Build, Push)
- CodePipeline (5 stages)
- Pipeline Artifact S3 Bucket

Deploy a project:
\`\`\`bash
./scripts/deploy-project.sh -s <service-name> -o <org> -p <project> \\
    -r <repo> --branch <branch> -b ${TEMPLATES_BUCKET} -e ${ENVIRONMENT}
\`\`\`

---

## Resource Count Summary (Shared Infrastructure)

| Category | Count |
|----------|-------|
| CloudFormation Stacks | 7 |
| VPC / Networking | 20 |
| Security Groups | 4 |
| IAM Roles & Policies | 11 |
| ALB | 7 |
| API Gateway | 7 |
| ECS Cluster | 3 |
| Monitoring & Notifications | ~12 |
| **Total** | **~71** |
EOF

    print_success "Deployment log saved to: $log_file"
}
