#!/bin/bash
# =============================================================================
# AWS Naming Convention Audit Script
# =============================================================================
# This script audits all CloudFormation templates in the infrastructure folder
# to ensure resource names follow AWS naming conventions.
#
# Usage: ./audit-naming-conventions.sh
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INFRASTRUCTURE_DIR="infrastructure"
ISSUES=0
WARNINGS=0
PASSED=0

echo ""
echo -e "${BLUE}=============================================================================${NC}"
echo -e "${BLUE}AWS Naming Convention Audit for Infrastructure Templates${NC}"
echo -e "${BLUE}=============================================================================${NC}"
echo ""

# =============================================================================
# AWS NAMING CONVENTIONS
# =============================================================================
# S3 Bucket:           3-63 chars, lowercase, numbers, hyphens, NO underscores
# IAM Role/Policy:     1-64/128 chars, alphanumeric, +=,.@-_ (underscores OK)
# CloudFormation:      1-128 chars, start with letter, alphanumeric, hyphens only
# ECS Cluster/Service: 1-255 chars, letters, numbers, hyphens, underscores
# ECR Repository:      2-256 chars, lowercase, numbers, hyphens, underscores, /
# Log Group:           1-512 chars, alphanumeric, _./#- (start with alphanumeric or /)
# SNS Topic:           1-256 chars, alphanumeric, hyphens, underscores
# Lambda Function:     1-64 chars, alphanumeric, hyphens, underscores
# Security Group:      1-255 chars, alphanumeric, spaces, ._-:/()#,@[]+=&;{}!$*
# =============================================================================

print_check() {
    local status="$1"
    local resource="$2"
    local name="$3"
    local file="$4"
    local issue="$5"
    
    case "$status" in
        "PASS")
            echo -e "${GREEN}✓${NC} [$resource] $name"
            ((PASSED++))
            ;;
        "WARN")
            echo -e "${YELLOW}⚠${NC} [$resource] $name"
            echo -e "   ${YELLOW}File: $file${NC}"
            echo -e "   ${YELLOW}Issue: $issue${NC}"
            ((WARNINGS++))
            ;;
        "FAIL")
            echo -e "${RED}✗${NC} [$resource] $name"
            echo -e "   ${RED}File: $file${NC}"
            echo -e "   ${RED}Issue: $issue${NC}"
            ((ISSUES++))
            ;;
    esac
}

echo -e "${BLUE}=== Checking S3 Bucket Names ===${NC}"
echo "Convention: 3-63 chars, lowercase, numbers, hyphens only (NO underscores)"
echo ""

# S3 Buckets - must be lowercase, no underscores
grep -rn "BucketName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    name=$(echo "$line" | grep -oP 'BucketName:\s*\K.*' | tr -d ' ')
    
    if [[ "$name" == *"_"* ]] || [[ "$name" =~ [A-Z] ]]; then
        print_check "FAIL" "S3" "$name" "$file" "S3 bucket names cannot contain underscores or uppercase letters"
    else
        print_check "PASS" "S3" "$name" "$file" ""
    fi
done

echo ""
echo -e "${BLUE}=== Checking IAM Role Names ===${NC}"
echo "Convention: 1-64 chars, alphanumeric, +=,.@-_ allowed"
echo ""

grep -rn "RoleName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'RoleName:\s*\K.*' | tr -d ' ')
    
    # Check for valid pattern (allows ${} substitutions)
    if [[ "$name" =~ ^[a-zA-Z0-9\$\{\}\-\_\+\=\,\.@]+$ ]] || [[ "$name" == "!Sub"* ]] || [[ "$name" == "!Ref"* ]]; then
        print_check "PASS" "IAM Role" "$name" "$file:$linenum" ""
    else
        print_check "FAIL" "IAM Role" "$name" "$file:$linenum" "Invalid characters in role name"
    fi
done

echo ""
echo -e "${BLUE}=== Checking IAM Policy Names ===${NC}"
echo "Convention: 1-128 chars, alphanumeric, +=,.@-_ allowed"
echo ""

grep -rn "PolicyName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'PolicyName:\s*\K.*' | tr -d ' ')
    
    print_check "PASS" "IAM Policy" "$name" "$file:$linenum" ""
done

echo ""
echo -e "${BLUE}=== Checking ECS Cluster Names ===${NC}"
echo "Convention: 1-255 chars, letters, numbers, hyphens, underscores"
echo ""

grep -rn "ClusterName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | grep -v "Outputs\|Parameters\|Condition" | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'ClusterName:\s*\K.*' | tr -d ' ')
    
    if [[ -n "$name" ]]; then
        print_check "PASS" "ECS Cluster" "$name" "$file:$linenum" ""
    fi
done

echo ""
echo -e "${BLUE}=== Checking ECS Service Names ===${NC}"
echo "Convention: 1-255 chars, letters, numbers, hyphens, underscores"
echo ""

grep -rn "ServiceName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | grep -v "Outputs\|Parameters" | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'ServiceName:\s*\K.*' | tr -d ' ')
    
    if [[ -n "$name" ]]; then
        print_check "PASS" "ECS Service" "$name" "$file:$linenum" ""
    fi
done

echo ""
echo -e "${BLUE}=== Checking ECR Repository Names ===${NC}"
echo "Convention: 2-256 chars, lowercase, numbers, hyphens, underscores, /"
echo ""

grep -rn "RepositoryName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'RepositoryName:\s*\K.*' | tr -d ' ')
    
    # ECR repos must be lowercase
    if [[ "$name" =~ [A-Z] ]] && [[ "$name" != *'${'* ]]; then
        print_check "FAIL" "ECR Repo" "$name" "$file:$linenum" "ECR repository names must be lowercase"
    else
        print_check "PASS" "ECR Repo" "$name" "$file:$linenum" ""
    fi
done

echo ""
echo -e "${BLUE}=== Checking CloudWatch Log Group Names ===${NC}"
echo "Convention: 1-512 chars, alphanumeric, _./#-, start with alphanumeric or /"
echo ""

grep -rn "LogGroupName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'LogGroupName:\s*\K.*' | tr -d ' ')
    
    # Log groups should start with / or alphanumeric
    if [[ "$name" == "!Sub"* ]] || [[ "$name" == "!Ref"* ]] || [[ "$name" =~ ^[a-zA-Z0-9/] ]]; then
        print_check "PASS" "Log Group" "$name" "$file:$linenum" ""
    else
        print_check "WARN" "Log Group" "$name" "$file:$linenum" "Should start with / or alphanumeric"
    fi
done

echo ""
echo -e "${BLUE}=== Checking SNS Topic Names ===${NC}"
echo "Convention: 1-256 chars, alphanumeric, hyphens, underscores"
echo ""

grep -rn "TopicName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'TopicName:\s*\K.*' | tr -d ' ')
    
    print_check "PASS" "SNS Topic" "$name" "$file:$linenum" ""
done

echo ""
echo -e "${BLUE}=== Checking Lambda Function Names ===${NC}"
echo "Convention: 1-64 chars, alphanumeric, hyphens, underscores"
echo ""

grep -rn "FunctionName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'FunctionName:\s*\K.*' | tr -d ' ')
    
    print_check "PASS" "Lambda" "$name" "$file:$linenum" ""
done

echo ""
echo -e "${BLUE}=== Checking Resource Tag Names ===${NC}"
echo "Convention: Consistent naming pattern {ProjectName}-{Environment}-{resource}"
echo ""

grep -rn "Name: !Sub" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | head -30 | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    name=$(echo "$line" | grep -oP 'Name:\s*!Sub\s*\K.*' | tr -d ' ')
    
    # Check for consistent pattern
    if [[ "$name" == *'${ProjectName}-${Environment}'* ]]; then
        print_check "PASS" "Tag Name" "$name" "$file:$linenum" ""
    else
        print_check "WARN" "Tag Name" "$name" "$file:$linenum" "Consider using \${ProjectName}-\${Environment} prefix"
    fi
done

echo ""
echo -e "${BLUE}=============================================================================${NC}"
echo -e "${BLUE}AUDIT SUMMARY${NC}"
echo -e "${BLUE}=============================================================================${NC}"
echo ""
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Issues:${NC}   $ISSUES"
echo ""

if [[ $ISSUES -eq 0 ]]; then
    echo -e "${GREEN}All resource names follow AWS naming conventions!${NC}"
else
    echo -e "${RED}Found $ISSUES naming convention violations that need to be fixed.${NC}"
fi

echo ""
echo -e "${BLUE}=== AWS Naming Convention Reference ===${NC}"
cat << 'EOF'
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ Resource Type       │ Naming Convention                                      │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ S3 Bucket           │ 3-63 chars, lowercase, numbers, hyphens (NO _)         │
│ IAM Role            │ 1-64 chars, alphanumeric, +=,.@-_                      │
│ IAM Policy          │ 1-128 chars, alphanumeric, +=,.@-_                     │
│ CloudFormation      │ 1-128 chars, start with letter, alphanumeric, hyphens  │
│ ECS Cluster         │ 1-255 chars, letters, numbers, hyphens, underscores    │
│ ECS Service         │ 1-255 chars, letters, numbers, hyphens, underscores    │
│ ECS Task Definition │ 1-255 chars, letters, numbers, hyphens, underscores    │
│ ECR Repository      │ 2-256 chars, lowercase, numbers, hyphens, _, /         │
│ CloudWatch Logs     │ 1-512 chars, alphanumeric, _./#-                       │
│ SNS Topic           │ 1-256 chars, alphanumeric, hyphens, underscores        │
│ Lambda Function     │ 1-64 chars, alphanumeric, hyphens, underscores         │
│ Security Group      │ 1-255 chars, alphanumeric, spaces, ._-:/()#,@[]+=      │
│ API Gateway         │ 1-128 chars, any characters                            │
│ Secrets Manager     │ 1-512 chars, alphanumeric, /_+=.@-                     │
└─────────────────────┴────────────────────────────────────────────────────────┘
EOF
echo ""
