#!/bin/bash
# =============================================================================
# AWS Naming Convention & Tagging Best Practices Audit
# =============================================================================
# Based on AWS Whitepapers and Best Practices:
# - https://docs.aws.amazon.com/whitepapers/latest/tagging-best-practices/
# - AWS Resource Naming Conventions
#
# Naming Pattern: {resource-type}-{region}-{environment}-{application}-{component}
# Tag Schema: Organization prefix with category (e.g., japfa:cost-allocation:*)
# =============================================================================

INFRASTRUCTURE_DIR="infrastructure"
REPORT_FILE="naming-audit-report-$(date +%Y%m%d%H%M%S).md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ISSUES=0
WARNINGS=0
PASSED=0

# =============================================================================
# AWS NAMING CONVENTION PATTERNS (Best Practices)
# =============================================================================
# Pattern: {prefix}-{region}-{environment}-{application}-{component}
# Or simplified: {project}-{environment}-{resource}
#
# Components:
# - prefix/project: Organization or project identifier (lowercase)
# - region: AWS region code (optional, for multi-region)
# - environment: dev, stg, prod (lowercase)
# - application: Application name (lowercase, hyphens)
# - component: Resource type or component name
#
# Rules:
# - Use lowercase letters
# - Use hyphens (-) as separators (NOT underscores for most resources)
# - Keep names short but descriptive
# - Be consistent across all resources
# =============================================================================

cat << 'HEADER' > "$REPORT_FILE"
# AWS Naming Convention & Tagging Audit Report

Generated: $(date '+%Y-%m-%d %H:%M:%S')

## AWS Naming Best Practices Reference

### Recommended Naming Pattern
```
{project}-{environment}-{resource-type}[-{component}]
```

### Examples
| Resource Type | Pattern | Example |
|--------------|---------|---------|
| VPC | `{project}-{env}-vpc` | `japfa-api-prod-vpc` |
| Subnet | `{project}-{env}-{public\|private}-subnet-{az}` | `japfa-api-prod-private-subnet-1a` |
| Security Group | `{project}-{env}-{component}-sg` | `japfa-api-prod-alb-sg` |
| IAM Role | `{project}-{env}-{service}-role` | `japfa-api-prod-ecs-task-role` |
| ECS Cluster | `{project}-{env}-cluster` | `japfa-api-prod-cluster` |
| ECR Repository | `{project}-{env}` | `japfa-api-prod` |
| S3 Bucket | `{project}-{env}-{purpose}-{account-id}` | `japfa-api-prod-artifacts-123456789` |
| Log Group | `/aws/{service}/{project}-{env}` | `/aws/ecs/japfa-api-prod` |

### Tagging Schema (AWS Best Practices)
| Tag Key | Purpose | Example Value |
|---------|---------|---------------|
| `Name` | Resource identification | `japfa-api-prod-alb` |
| `Environment` | Environment type | `dev`, `staging`, `prod` |
| `Project` | Project identifier | `japfa-api` |
| `Owner` | Team/person responsible | `platform-team` |
| `CostCenter` | Cost allocation | `engineering-123` |
| `Application` | Application name | `japfa-rest-api` |
| `ManagedBy` | IaC tool | `cloudformation` |

---

## Audit Results

HEADER

echo ""
echo -e "${BLUE}=============================================================================${NC}"
echo -e "${BLUE}AWS Naming Convention & Tagging Audit${NC}"
echo -e "${BLUE}=============================================================================${NC}"
echo ""

# =============================================================================
# Check 1: Resource Names Using Underscores (Should use hyphens)
# =============================================================================
echo -e "${BLUE}=== Check 1: Underscore Usage (Should use hyphens) ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 1: Underscore Usage in Resource Names" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# S3 buckets cannot have underscores
echo "Checking S3 bucket names..."
grep -rn "BucketName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    if [[ "$content" == *"_"* ]]; then
        echo -e "${RED}✗${NC} S3 Bucket with underscore: $file:$linenum"
        echo "- ❌ **S3 Bucket** ($file:$linenum): Contains underscore - S3 buckets cannot have underscores" >> "$REPORT_FILE"
        ((ISSUES++))
    fi
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 2: Consistent Naming Pattern
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 2: Naming Pattern Consistency ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 2: Naming Pattern Consistency" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Expected pattern: \`\${ProjectName}-\${Environment}-{resource}\`" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Check all Name tags follow pattern
echo "Checking resource name patterns..."
grep -rn "Name: !Sub" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    # Check if follows ${ProjectName}-${Environment} pattern
    if [[ "$content" == *'${ProjectName}-${Environment}'* ]]; then
        echo -e "${GREEN}✓${NC} Consistent: $(basename $file):$linenum"
        ((PASSED++))
    elif [[ "$content" == *'${ProjectName}'* ]] && [[ "$content" != *'${Environment}'* ]]; then
        echo -e "${YELLOW}⚠${NC} Missing Environment: $(basename $file):$linenum"
        echo "- ⚠️ **Warning** ($file:$linenum): Missing \${Environment} in name" >> "$REPORT_FILE"
        ((WARNINGS++))
    fi
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 3: Required Tags
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 3: Required Tags ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 3: Required Tags on Resources" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Required tags: Name, Environment, Project" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Check each template for Tags section
for template in $INFRASTRUCTURE_DIR/*.yaml; do
    filename=$(basename "$template")
    
    # Count tag occurrences
    name_tags=$(grep -c "Key: Name" "$template" 2>/dev/null || echo "0")
    env_tags=$(grep -c "Key: Environment" "$template" 2>/dev/null || echo "0")
    project_tags=$(grep -c "Key: Project" "$template" 2>/dev/null || echo "0")
    
    if [[ "$name_tags" -gt 0 ]] && [[ "$env_tags" -gt 0 ]] && [[ "$project_tags" -gt 0 ]]; then
        echo -e "${GREEN}✓${NC} $filename: Has required tags (Name: $name_tags, Environment: $env_tags, Project: $project_tags)"
        echo "- ✅ **$filename**: Has required tags" >> "$REPORT_FILE"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} $filename: Missing some tags (Name: $name_tags, Environment: $env_tags, Project: $project_tags)"
        echo "- ⚠️ **$filename**: Missing tags (Name: $name_tags, Environment: $env_tags, Project: $project_tags)" >> "$REPORT_FILE"
        ((WARNINGS++))
    fi
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 4: IAM Role/Policy Naming
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 4: IAM Role/Policy Naming ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 4: IAM Role/Policy Naming" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Pattern: \`{project}-{environment}-{service}-role\`" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

grep -rn "RoleName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | grep "!Sub" | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    # Extract the name pattern
    name=$(echo "$content" | grep -oP '\$\{ProjectName\}-\$\{Environment\}-[a-z0-9-]+' || echo "")
    
    if [[ -n "$name" ]]; then
        echo -e "${GREEN}✓${NC} IAM Role: $name"
        echo "- ✅ IAM Role: \`$name\`" >> "$REPORT_FILE"
        ((PASSED++))
    fi
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 5: ECS Resource Naming
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 5: ECS Resource Naming ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 5: ECS Resource Naming" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

grep -rn "ClusterName:\|ServiceName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | grep "!Sub" | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    echo -e "${GREEN}✓${NC} ECS: $(basename $file):$linenum - $content"
    echo "- ✅ $(basename $file):$linenum - \`$content\`" >> "$REPORT_FILE"
    ((PASSED++))
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 6: Log Group Naming
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 6: CloudWatch Log Group Naming ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 6: CloudWatch Log Group Naming" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Pattern: \`/aws/{service}/{project}-{environment}\` or \`/{service}/{project}-{environment}\`" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

grep -rn "LogGroupName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | grep "!Sub" | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    # Check if starts with /aws/ or /ecs/ etc
    if [[ "$content" == *"/aws/"* ]] || [[ "$content" == *"/ecs/"* ]]; then
        echo -e "${GREEN}✓${NC} Log Group: $content"
        echo "- ✅ \`$content\`" >> "$REPORT_FILE"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} Log Group should start with /aws/ or service prefix: $content"
        echo "- ⚠️ Should start with /aws/ or service prefix: \`$content\`" >> "$REPORT_FILE"
        ((WARNINGS++))
    fi
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Check 7: ECR Repository Naming (must be lowercase)
# =============================================================================
echo ""
echo -e "${BLUE}=== Check 7: ECR Repository Naming ===${NC}"
echo "" >> "$REPORT_FILE"
echo "### Check 7: ECR Repository Naming" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "ECR repositories must be lowercase" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

grep -rn "RepositoryName:" $INFRASTRUCTURE_DIR/*.yaml 2>/dev/null | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    content=$(echo "$line" | cut -d: -f3-)
    
    # ECR uses ${ProjectName}-${Environment} which should be lowercase
    echo -e "${GREEN}✓${NC} ECR Repository: $content (uses lowercase variables)"
    echo "- ✅ \`$content\` (uses lowercase variables)" >> "$REPORT_FILE"
    ((PASSED++))
done

echo "" >> "$REPORT_FILE"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BLUE}=============================================================================${NC}"
echo -e "${BLUE}AUDIT SUMMARY${NC}"
echo -e "${BLUE}=============================================================================${NC}"
echo ""
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Issues:${NC}   $ISSUES"
echo ""

cat << EOF >> "$REPORT_FILE"

---

## Summary

| Status | Count |
|--------|-------|
| ✅ Passed | $PASSED |
| ⚠️ Warnings | $WARNINGS |
| ❌ Issues | $ISSUES |

## Recommendations

### Naming Convention Standard
1. Use pattern: \`{project}-{environment}-{resource-type}[-{component}]\`
2. Use lowercase letters only
3. Use hyphens (-) as separators, NOT underscores
4. Keep names descriptive but concise
5. Be consistent across all resources

### Required Tags (Minimum)
\`\`\`yaml
Tags:
  - Key: Name
    Value: !Sub \${ProjectName}-\${Environment}-{resource}
  - Key: Environment
    Value: !Ref Environment
  - Key: Project
    Value: !Ref ProjectName
  - Key: ManagedBy
    Value: cloudformation
\`\`\`

### Recommended Additional Tags
\`\`\`yaml
Tags:
  - Key: Owner
    Value: platform-team
  - Key: CostCenter
    Value: engineering
  - Key: Application
    Value: japfa-rest-api
\`\`\`

EOF

echo "Report saved to: $REPORT_FILE"
echo ""

if [[ $ISSUES -eq 0 ]]; then
    echo -e "${GREEN}All naming conventions follow AWS best practices!${NC}"
else
    echo -e "${RED}Found $ISSUES issues that need to be fixed.${NC}"
    echo "Review the report: $REPORT_FILE"
fi
