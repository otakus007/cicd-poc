#!/bin/bash
# =============================================================================
# AWS Permission Check Script for CI/CD Pipeline Deployment
# =============================================================================
# This script validates that the current AWS user/role has sufficient permissions
# to deploy the CI/CD pipeline infrastructure.
#
# Usage: ./check-permissions.sh [--profile <profile>] [--region <region>]
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}=============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=============================================================================${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ $1${NC}"; }

# Parse arguments
AWS_PROFILE=""
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --profile) AWS_PROFILE="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--profile <profile>] [--region <region>]"
            exit 0
            ;;
        *) shift ;;
    esac
done

AWS_CLI_OPTS="--region $AWS_REGION"
[[ -n "$AWS_PROFILE" ]] && AWS_CLI_OPTS="--profile $AWS_PROFILE $AWS_CLI_OPTS"

# Track results
PASSED=0
FAILED=0
WARNINGS=0

check_permission() {
    local service="$1"
    local action="$2"
    local resource="$3"
    local description="$4"
    
    # Use simulate-principal-policy to check permission
    local result
    result=$(aws iam simulate-principal-policy \
        --policy-source-arn "$CALLER_ARN" \
        --action-names "$action" \
        --resource-arns "$resource" \
        $AWS_CLI_OPTS \
        --query 'EvaluationResults[0].EvalDecision' \
        --output text 2>/dev/null || echo "ERROR")
    
    if [[ "$result" == "allowed" ]]; then
        print_success "$description"
        ((PASSED++))
        return 0
    elif [[ "$result" == "ERROR" ]]; then
        print_warning "$description (unable to simulate - may still work)"
        ((WARNINGS++))
        return 0
    else
        print_error "$description"
        ((FAILED++))
        return 1
    fi
}

# Simple permission check by attempting a read-only operation
check_service_access() {
    local service="$1"
    local check_command="$2"
    local description="$3"
    
    if eval "$check_command" > /dev/null 2>&1; then
        print_success "$description"
        ((PASSED++))
        return 0
    else
        print_error "$description"
        ((FAILED++))
        return 1
    fi
}

print_header "AWS Permission Check for CI/CD Pipeline Deployment"

# =============================================================================
# Step 1: Validate AWS Credentials
# =============================================================================
print_header "Step 1: Validating AWS Credentials"

if ! aws sts get-caller-identity $AWS_CLI_OPTS > /dev/null 2>&1; then
    print_error "AWS credentials are not configured or invalid"
    print_info "Please configure AWS credentials using 'aws configure' or set environment variables"
    exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity $AWS_CLI_OPTS --output json)
ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | jq -r '.Account')
CALLER_ARN=$(echo "$CALLER_IDENTITY" | jq -r '.Arn')
USER_ID=$(echo "$CALLER_IDENTITY" | jq -r '.UserId')

print_success "AWS credentials validated"
print_info "Account ID: $ACCOUNT_ID"
print_info "Caller ARN: $CALLER_ARN"
print_info "Region: $AWS_REGION"
echo ""

# =============================================================================
# Step 2: Check CloudFormation Permissions
# =============================================================================
print_header "Step 2: CloudFormation Permissions"

check_service_access "cloudformation" \
    "aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE $AWS_CLI_OPTS" \
    "cloudformation:ListStacks"

check_service_access "cloudformation" \
    "aws cloudformation describe-account-limits $AWS_CLI_OPTS" \
    "cloudformation:DescribeAccountLimits"

# Additional CloudFormation actions needed (can't easily test without creating resources)
print_info "Required actions (cannot verify without deployment):"
echo "  - cloudformation:CreateStack"
echo "  - cloudformation:UpdateStack"
echo "  - cloudformation:DeleteStack"
echo "  - cloudformation:DescribeStacks"
echo "  - cloudformation:DescribeStackEvents"
echo "  - cloudformation:GetTemplate"
echo "  - cloudformation:ValidateTemplate"

# =============================================================================
# Step 3: Check S3 Permissions
# =============================================================================
print_header "Step 3: S3 Permissions"

check_service_access "s3" \
    "aws s3api list-buckets $AWS_CLI_OPTS" \
    "s3:ListBuckets"

print_info "Required actions for template bucket:"
echo "  - s3:CreateBucket"
echo "  - s3:PutBucketVersioning"
echo "  - s3:PutObject"
echo "  - s3:GetObject"
echo "  - s3:HeadBucket"

# =============================================================================
# Step 4: Check EC2/VPC Permissions
# =============================================================================
print_header "Step 4: EC2/VPC Permissions"

check_service_access "ec2" \
    "aws ec2 describe-vpcs $AWS_CLI_OPTS" \
    "ec2:DescribeVpcs"

check_service_access "ec2" \
    "aws ec2 describe-subnets $AWS_CLI_OPTS" \
    "ec2:DescribeSubnets"

check_service_access "ec2" \
    "aws ec2 describe-security-groups $AWS_CLI_OPTS" \
    "ec2:DescribeSecurityGroups"

check_service_access "ec2" \
    "aws ec2 describe-availability-zones $AWS_CLI_OPTS" \
    "ec2:DescribeAvailabilityZones"

print_info "Required actions for VPC creation:"
echo "  - ec2:CreateVpc, ec2:DeleteVpc, ec2:ModifyVpcAttribute"
echo "  - ec2:CreateSubnet, ec2:DeleteSubnet"
echo "  - ec2:CreateInternetGateway, ec2:AttachInternetGateway"
echo "  - ec2:CreateNatGateway, ec2:DeleteNatGateway"
echo "  - ec2:AllocateAddress, ec2:ReleaseAddress"
echo "  - ec2:CreateRouteTable, ec2:CreateRoute"
echo "  - ec2:CreateSecurityGroup, ec2:AuthorizeSecurityGroupIngress/Egress"
echo "  - ec2:CreateTags"

# =============================================================================
# Step 5: Check IAM Permissions
# =============================================================================
print_header "Step 5: IAM Permissions"

check_service_access "iam" \
    "aws iam list-roles $AWS_CLI_OPTS" \
    "iam:ListRoles"

check_service_access "iam" \
    "aws iam list-policies --scope Local $AWS_CLI_OPTS" \
    "iam:ListPolicies"

print_info "Required actions for IAM role creation:"
echo "  - iam:CreateRole, iam:DeleteRole"
echo "  - iam:PutRolePolicy, iam:DeleteRolePolicy"
echo "  - iam:AttachRolePolicy, iam:DetachRolePolicy"
echo "  - iam:CreateInstanceProfile, iam:DeleteInstanceProfile"
echo "  - iam:AddRoleToInstanceProfile, iam:RemoveRoleFromInstanceProfile"
echo "  - iam:PassRole"
echo "  - iam:GetRole, iam:GetRolePolicy"
echo "  - iam:TagRole"

# =============================================================================
# Step 6: Check ECS Permissions
# =============================================================================
print_header "Step 6: ECS Permissions"

check_service_access "ecs" \
    "aws ecs list-clusters $AWS_CLI_OPTS" \
    "ecs:ListClusters"

check_service_access "ecs" \
    "aws ecs list-task-definitions $AWS_CLI_OPTS" \
    "ecs:ListTaskDefinitions"

print_info "Required actions for ECS deployment:"
echo "  - ecs:CreateCluster, ecs:DeleteCluster"
echo "  - ecs:RegisterTaskDefinition, ecs:DeregisterTaskDefinition"
echo "  - ecs:CreateService, ecs:UpdateService, ecs:DeleteService"
echo "  - ecs:DescribeServices, ecs:DescribeTasks"
echo "  - ecs:TagResource"

# =============================================================================
# Step 7: Check ECR Permissions
# =============================================================================
print_header "Step 7: ECR Permissions"

check_service_access "ecr" \
    "aws ecr describe-repositories $AWS_CLI_OPTS" \
    "ecr:DescribeRepositories"

print_info "Required actions for ECR:"
echo "  - ecr:CreateRepository, ecr:DeleteRepository"
echo "  - ecr:PutLifecyclePolicy"
echo "  - ecr:SetRepositoryPolicy"
echo "  - ecr:TagResource"

# =============================================================================
# Step 8: Check Elastic Load Balancing Permissions
# =============================================================================
print_header "Step 8: Elastic Load Balancing Permissions"

check_service_access "elbv2" \
    "aws elbv2 describe-load-balancers $AWS_CLI_OPTS" \
    "elasticloadbalancing:DescribeLoadBalancers"

check_service_access "elbv2" \
    "aws elbv2 describe-target-groups $AWS_CLI_OPTS" \
    "elasticloadbalancing:DescribeTargetGroups"

print_info "Required actions for ALB:"
echo "  - elasticloadbalancing:CreateLoadBalancer, DeleteLoadBalancer"
echo "  - elasticloadbalancing:CreateTargetGroup, DeleteTargetGroup"
echo "  - elasticloadbalancing:CreateListener, DeleteListener"
echo "  - elasticloadbalancing:ModifyLoadBalancerAttributes"
echo "  - elasticloadbalancing:AddTags"

# =============================================================================
# Step 9: Check API Gateway Permissions
# =============================================================================
print_header "Step 9: API Gateway Permissions"

check_service_access "apigatewayv2" \
    "aws apigatewayv2 get-apis $AWS_CLI_OPTS" \
    "apigateway:GET /apis"

print_info "Required actions for API Gateway:"
echo "  - apigateway:POST, PUT, DELETE (various resources)"
echo "  - apigateway:CreateApi, DeleteApi"
echo "  - apigateway:CreateVpcLink, DeleteVpcLink"
echo "  - apigateway:CreateIntegration, CreateRoute"
echo "  - apigateway:CreateStage"
echo "  - apigateway:TagResource"

# =============================================================================
# Step 10: Check CodeBuild Permissions
# =============================================================================
print_header "Step 10: CodeBuild Permissions"

check_service_access "codebuild" \
    "aws codebuild list-projects $AWS_CLI_OPTS" \
    "codebuild:ListProjects"

print_info "Required actions for CodeBuild:"
echo "  - codebuild:CreateProject, DeleteProject"
echo "  - codebuild:UpdateProject"
echo "  - codebuild:BatchGetProjects"

# =============================================================================
# Step 11: Check CodePipeline Permissions
# =============================================================================
print_header "Step 11: CodePipeline Permissions"

check_service_access "codepipeline" \
    "aws codepipeline list-pipelines $AWS_CLI_OPTS" \
    "codepipeline:ListPipelines"

print_info "Required actions for CodePipeline:"
echo "  - codepipeline:CreatePipeline, DeletePipeline"
echo "  - codepipeline:UpdatePipeline"
echo "  - codepipeline:GetPipeline"
echo "  - codepipeline:TagResource"

# =============================================================================
# Step 12: Check Secrets Manager Permissions
# =============================================================================
print_header "Step 12: Secrets Manager Permissions"

check_service_access "secretsmanager" \
    "aws secretsmanager list-secrets $AWS_CLI_OPTS" \
    "secretsmanager:ListSecrets"

print_info "Required actions for Secrets Manager:"
echo "  - secretsmanager:CreateSecret, DeleteSecret"
echo "  - secretsmanager:PutSecretValue"
echo "  - secretsmanager:TagResource"

# =============================================================================
# Step 13: Check CloudWatch Permissions
# =============================================================================
print_header "Step 13: CloudWatch Permissions"

check_service_access "logs" \
    "aws logs describe-log-groups $AWS_CLI_OPTS" \
    "logs:DescribeLogGroups"

check_service_access "cloudwatch" \
    "aws cloudwatch describe-alarms $AWS_CLI_OPTS" \
    "cloudwatch:DescribeAlarms"

print_info "Required actions for CloudWatch:"
echo "  - logs:CreateLogGroup, DeleteLogGroup"
echo "  - logs:PutRetentionPolicy"
echo "  - logs:TagLogGroup"
echo "  - cloudwatch:PutMetricAlarm, DeleteAlarms"
echo "  - cloudwatch:PutDashboard, DeleteDashboards"

# =============================================================================
# Step 14: Check SNS Permissions
# =============================================================================
print_header "Step 14: SNS Permissions"

check_service_access "sns" \
    "aws sns list-topics $AWS_CLI_OPTS" \
    "sns:ListTopics"

print_info "Required actions for SNS:"
echo "  - sns:CreateTopic, DeleteTopic"
echo "  - sns:SetTopicAttributes"
echo "  - sns:TagResource"

# =============================================================================
# Step 15: Check Auto Scaling Permissions (for EC2 compute type)
# =============================================================================
print_header "Step 15: Auto Scaling Permissions (EC2 compute type)"

check_service_access "autoscaling" \
    "aws autoscaling describe-auto-scaling-groups $AWS_CLI_OPTS" \
    "autoscaling:DescribeAutoScalingGroups"

print_info "Required actions for Auto Scaling (EC2 mode):"
echo "  - autoscaling:CreateAutoScalingGroup, DeleteAutoScalingGroup"
echo "  - autoscaling:UpdateAutoScalingGroup"
echo "  - autoscaling:CreateLaunchConfiguration"
echo "  - autoscaling:PutScalingPolicy"
echo "  - ec2:CreateLaunchTemplate, DeleteLaunchTemplate"

# =============================================================================
# Step 16: Check Application Auto Scaling Permissions
# =============================================================================
print_header "Step 16: Application Auto Scaling Permissions"

check_service_access "application-autoscaling" \
    "aws application-autoscaling describe-scalable-targets --service-namespace ecs $AWS_CLI_OPTS" \
    "application-autoscaling:DescribeScalableTargets"

print_info "Required actions for ECS Auto Scaling:"
echo "  - application-autoscaling:RegisterScalableTarget"
echo "  - application-autoscaling:DeregisterScalableTarget"
echo "  - application-autoscaling:PutScalingPolicy"
echo "  - application-autoscaling:DeleteScalingPolicy"

# =============================================================================
# Summary
# =============================================================================
print_header "Permission Check Summary"

echo ""
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [[ $FAILED -eq 0 ]]; then
    print_success "Basic permission checks passed!"
    echo ""
    print_info "Note: This script checks read-only permissions. Write permissions"
    print_info "will be validated during actual deployment. If deployment fails,"
    print_info "check the specific error message for missing permissions."
    echo ""
    print_info "Recommended: Use an IAM user/role with AdministratorAccess or"
    print_info "attach the custom policy below for least-privilege deployment."
else
    print_error "Some permission checks failed. Review the errors above."
    echo ""
    print_info "You may need to request additional IAM permissions from your administrator."
fi

echo ""
print_header "Minimum Required IAM Policy"
echo ""
echo "If you need a least-privilege policy, save the following to a file and"
echo "attach it to your IAM user/role:"
echo ""
cat << 'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationFullAccess",
      "Effect": "Allow",
      "Action": "cloudformation:*",
      "Resource": "*"
    },
    {
      "Sid": "S3TemplateAccess",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:PutBucketVersioning",
        "s3:PutObject",
        "s3:GetObject",
        "s3:GetBucketLocation",
        "s3:HeadBucket",
        "s3:ListBucket"
      ],
      "Resource": "*"
    },
    {
      "Sid": "VPCFullAccess",
      "Effect": "Allow",
      "Action": [
        "ec2:*Vpc*",
        "ec2:*Subnet*",
        "ec2:*Gateway*",
        "ec2:*Route*",
        "ec2:*SecurityGroup*",
        "ec2:*Address*",
        "ec2:*NetworkInterface*",
        "ec2:*Tags*",
        "ec2:Describe*",
        "ec2:CreateLaunchTemplate",
        "ec2:DeleteLaunchTemplate",
        "ec2:DescribeLaunchTemplates"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:PassRole",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:GetInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile",
        "iam:ListRoles",
        "iam:ListPolicies"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECSFullAccess",
      "Effect": "Allow",
      "Action": "ecs:*",
      "Resource": "*"
    },
    {
      "Sid": "ECRFullAccess",
      "Effect": "Allow",
      "Action": "ecr:*",
      "Resource": "*"
    },
    {
      "Sid": "ELBFullAccess",
      "Effect": "Allow",
      "Action": "elasticloadbalancing:*",
      "Resource": "*"
    },
    {
      "Sid": "APIGatewayFullAccess",
      "Effect": "Allow",
      "Action": "apigateway:*",
      "Resource": "*"
    },
    {
      "Sid": "CodeBuildFullAccess",
      "Effect": "Allow",
      "Action": "codebuild:*",
      "Resource": "*"
    },
    {
      "Sid": "CodePipelineFullAccess",
      "Effect": "Allow",
      "Action": "codepipeline:*",
      "Resource": "*"
    },
    {
      "Sid": "SecretsManagerFullAccess",
      "Effect": "Allow",
      "Action": "secretsmanager:*",
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchFullAccess",
      "Effect": "Allow",
      "Action": [
        "logs:*",
        "cloudwatch:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SNSFullAccess",
      "Effect": "Allow",
      "Action": "sns:*",
      "Resource": "*"
    },
    {
      "Sid": "AutoScalingFullAccess",
      "Effect": "Allow",
      "Action": [
        "autoscaling:*",
        "application-autoscaling:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STSGetCallerIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
POLICY

echo ""
print_info "Save the policy above to 'deploy-policy.json' and attach it to your IAM user/role."
echo ""
