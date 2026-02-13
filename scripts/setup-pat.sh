#!/bin/bash
# =============================================================================
# Secure PAT Setup Script
# =============================================================================
# Securely sets Azure DevOps PAT in AWS Secrets Manager without exposing
# the PAT value in command line arguments, process listing, or shell history.
#
# Usage:
#   ./scripts/setup-pat.sh -e dev -s cash-collection
#   ./scripts/setup-pat.sh -e prod -s poultry-sale --verify
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Defaults
INFRA_PROJECT_NAME="japfa-api"
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ENVIRONMENT=""
SERVICE_NAME=""
VERIFY_ONLY="false"

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Securely set Azure DevOps PAT in AWS Secrets Manager.

Required:
    -e, --environment   Environment (dev, staging, prod)
    -s, --service       Service name (e.g., cash-collection)

Optional:
    --infra-name        Shared infra project name (default: japfa-api)
    --region            AWS region (default: us-east-1)
    --verify            Only verify if PAT is configured (don't set)
    -h, --help          Show this help

Examples:
    # Set PAT for cash-collection service in dev
    $(basename "$0") -e dev -s cash-collection

    # Verify PAT is configured
    $(basename "$0") -e dev -s cash-collection --verify

    # Set PAT with custom infra name
    $(basename "$0") -e prod -s poultry-sale --infra-name my-api

Security Notes:
    - PAT is entered interactively (not visible while typing)
    - PAT is written to a temp file with 600 permissions
    - Temp file is deleted immediately after use
    - PAT never appears in process listing or shell history
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment) ENVIRONMENT="$2"; shift 2 ;;
        -s|--service) SERVICE_NAME="$2"; shift 2 ;;
        --infra-name) INFRA_PROJECT_NAME="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        --verify) VERIFY_ONLY="true"; shift ;;
        -h|--help) usage ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    esac
done

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]]; then
    echo -e "${RED}ERROR: Environment (-e) is required${NC}"
    usage
fi

if [[ -z "$SERVICE_NAME" ]]; then
    echo -e "${RED}ERROR: Service name (-s) is required${NC}"
    usage
fi

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo -e "${RED}ERROR: Environment must be dev, staging, or prod${NC}"
    exit 1
fi

SECRET_ID="${INFRA_PROJECT_NAME}/${ENVIRONMENT}/${SERVICE_NAME}/azure-devops-pat"

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Azure DevOps PAT Configuration${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "Environment:  ${GREEN}${ENVIRONMENT}${NC}"
echo -e "Service:      ${GREEN}${SERVICE_NAME}${NC}"
echo -e "Secret ID:    ${GREEN}${SECRET_ID}${NC}"
echo -e "Region:       ${GREEN}${AWS_REGION}${NC}"
echo ""

# Check if secret exists
SECRET_EXISTS=$(aws secretsmanager describe-secret \
    --secret-id "$SECRET_ID" \
    --region "$AWS_REGION" \
    --query 'Name' \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$SECRET_EXISTS" == "NOT_FOUND" ]]; then
    echo -e "${RED}ERROR: Secret does not exist${NC}"
    echo ""
    echo "Deploy the project first:"
    echo "  ./scripts/deploy-project.sh -s ${SERVICE_NAME} -e ${ENVIRONMENT} ..."
    exit 1
fi

# Get current secret value to check if configured
CURRENT_PAT=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_ID" \
    --region "$AWS_REGION" \
    --query 'SecretString' \
    --output text 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('pat',''))" 2>/dev/null || echo "")

if [[ "$VERIFY_ONLY" == "true" ]]; then
    echo -e "${BLUE}Verifying PAT configuration...${NC}"
    echo ""

    if [[ -z "$CURRENT_PAT" || "$CURRENT_PAT" == "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT" ]]; then
        echo -e "${RED}❌ PAT is NOT configured${NC}"
        echo ""
        echo "Run without --verify to set the PAT:"
        echo "  $(basename "$0") -e ${ENVIRONMENT} -s ${SERVICE_NAME}"
        exit 1
    else
        echo -e "${GREEN}✅ PAT is configured${NC}"
        echo -e "   Length: ${#CURRENT_PAT} characters"
        echo -e "   Prefix: ${CURRENT_PAT:0:4}..."
        exit 0
    fi
fi

# Check if already configured
if [[ -n "$CURRENT_PAT" && "$CURRENT_PAT" != "PLACEHOLDER_UPDATE_AFTER_DEPLOYMENT" ]]; then
    echo -e "${YELLOW}⚠ PAT is already configured (${#CURRENT_PAT} chars, prefix: ${CURRENT_PAT:0:4}...)${NC}"
    echo ""
    read -p "Do you want to replace it? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
    echo ""
fi

# Prompt for PAT securely
echo -e "${BLUE}Enter your Azure DevOps Personal Access Token${NC}"
echo -e "${YELLOW}(PAT will not be visible while typing)${NC}"
echo ""
read -s -p "PAT: " PAT_VALUE
echo ""

if [[ -z "$PAT_VALUE" ]]; then
    echo -e "${RED}ERROR: PAT cannot be empty${NC}"
    exit 1
fi

if [[ ${#PAT_VALUE} -lt 20 ]]; then
    echo -e "${RED}ERROR: PAT seems too short (${#PAT_VALUE} chars). Azure DevOps PATs are typically 52+ characters.${NC}"
    exit 1
fi

# Confirm
echo ""
echo -e "PAT length: ${GREEN}${#PAT_VALUE} characters${NC}"
echo -e "PAT prefix: ${GREEN}${PAT_VALUE:0:4}...${NC}"
echo ""
read -p "Confirm update? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo -e "${BLUE}Updating secret...${NC}"

# Create secure temp file
TMP_FILE=$(mktemp)
chmod 600 "$TMP_FILE"

# Write PAT to temp file (never appears in process list)
printf '{"pat":"%s"}' "$PAT_VALUE" > "$TMP_FILE"

# Update secret using file input
aws secretsmanager put-secret-value \
    --secret-id "$SECRET_ID" \
    --secret-string "file://${TMP_FILE}" \
    --region "$AWS_REGION" > /dev/null

# Securely delete temp file
rm -f "$TMP_FILE"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ PAT configured successfully!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "The pipeline can now clone from Azure DevOps."
echo ""
echo "To trigger the pipeline:"
echo "  aws codepipeline start-pipeline-execution \\"
echo "      --name ${INFRA_PROJECT_NAME}-${ENVIRONMENT}-${SERVICE_NAME}-pipeline \\"
echo "      --region ${AWS_REGION}"
echo ""
