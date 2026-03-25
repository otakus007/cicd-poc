#!/bin/bash
# =============================================================================
# Deploy Utilities — Retry, Locking, and Cost Estimation
# =============================================================================
# Shared utility functions for deploy.sh and deploy-project.sh.
# Source this file; do not execute directly.
# =============================================================================

# Guard against double-sourcing
if [[ -n "${_DEPLOY_UTILS_LOADED:-}" ]]; then
    return 0 2>/dev/null || true
fi
_DEPLOY_UTILS_LOADED=1

# =============================================================================
# RETRY WITH EXPONENTIAL BACKOFF
# =============================================================================
# Retries a command up to 3 times with exponential backoff (2s, 4s, 8s)
# when the failure is caused by a throttling or transient AWS error.
#
# Usage:
#   retry_with_backoff aws cloudformation describe-stacks --stack-name my-stack
#
# Returns the exit code of the last command attempt.
# =============================================================================

# AWS CLI error codes / messages considered transient and retryable
_TRANSIENT_ERROR_PATTERNS=(
    "Throttling"
    "ThrottlingException"
    "RequestLimitExceeded"
    "TooManyRequestsException"
    "ServiceUnavailable"
    "ServiceUnavailableException"
    "InternalError"
    "InternalFailure"
    "RequestTimeout"
    "RequestTimeoutException"
    "IDPCommunicationError"
    "EC2ThrottledException"
    "ProvisionedThroughputExceededException"
    "BandwidthLimitExceeded"
    "503"
    "429"
)

retry_with_backoff() {
    local max_retries=3
    local attempt=0
    local exit_code=0
    local cmd_output=""
    local delays=(2 4 8)

    while true; do
        # Capture both stdout and stderr; preserve stdout on success
        cmd_output=$("$@" 2>&1)
        exit_code=$?

        if [[ $exit_code -eq 0 ]]; then
            # Success — emit captured stdout
            if [[ -n "$cmd_output" ]]; then
                printf '%s\n' "$cmd_output"
            fi
            return 0
        fi

        # Check if the error is transient / retryable
        if _is_transient_error "$cmd_output"; then
            attempt=$((attempt + 1))
            if [[ $attempt -gt $max_retries ]]; then
                echo "$cmd_output" >&2
                echo "[retry] Max retries ($max_retries) exceeded. Giving up." >&2
                return $exit_code
            fi

            local delay=${delays[$((attempt - 1))]}
            echo "[retry] Transient error detected (attempt $attempt/$max_retries). Retrying in ${delay}s..." >&2
            sleep "$delay"
        else
            # Non-transient error — fail immediately
            echo "$cmd_output" >&2
            return $exit_code
        fi
    done
}

# ---------------------------------------------------------------------------
# _is_transient_error <error_output>
# Returns 0 (true) if the error output matches a known transient pattern.
# ---------------------------------------------------------------------------
_is_transient_error() {
    local error_output="$1"
    for pattern in "${_TRANSIENT_ERROR_PATTERNS[@]}"; do
        if [[ "$error_output" == *"$pattern"* ]]; then
            return 0
        fi
    done
    return 1
}

# =============================================================================
# S3 DEPLOYMENT LOCK MECHANISM
# =============================================================================
# Prevents concurrent deployments to the same project/environment by using
# an S3 lock file. Lock files older than 60 minutes are treated as stale.
#
# Lock file path: s3://{bucket}/locks/{project}-{environment}.lock
# Lock file content: JSON with timestamp, caller, stack, and pid fields.
#
# Usage:
#   acquire_lock  <bucket> <project> <environment> <stack_name>
#   check_lock    <bucket> <project> <environment>
#   release_lock  <bucket> <project> <environment>
# =============================================================================

# Stale lock threshold in seconds (60 minutes)
_LOCK_STALE_SECONDS=3600

# ---------------------------------------------------------------------------
# check_lock <bucket> <project> <environment>
# Returns 0 if no lock or stale lock (safe to proceed).
# Returns 1 if an active lock exists (< 60 minutes old).
# Prints lock holder info to stderr when an active lock is found.
# ---------------------------------------------------------------------------
check_lock() {
    local bucket="$1"
    local project="$2"
    local environment="$3"
    local lock_path="s3://${bucket}/locks/${project}-${environment}.lock"

    # Try to download the lock file
    local lock_content
    lock_content=$(aws s3 cp "$lock_path" - 2>/dev/null)
    if [[ $? -ne 0 || -z "$lock_content" ]]; then
        # No lock file exists — safe to proceed
        return 0
    fi

    # Parse the timestamp from the lock file
    local lock_timestamp
    lock_timestamp=$(printf '%s' "$lock_content" | grep -o '"timestamp"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"timestamp"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

    if [[ -z "$lock_timestamp" ]]; then
        echo "[lock] WARNING: Lock file exists but has no valid timestamp. Treating as stale." >&2
        return 0
    fi

    # Calculate lock age in seconds
    local lock_epoch
    local now_epoch
    lock_epoch=$(date -d "$lock_timestamp" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$lock_timestamp" +%s 2>/dev/null)
    now_epoch=$(date -u +%s)

    if [[ -z "$lock_epoch" ]]; then
        echo "[lock] WARNING: Could not parse lock timestamp '${lock_timestamp}'. Treating as stale." >&2
        return 0
    fi

    local age_seconds=$(( now_epoch - lock_epoch ))

    if [[ $age_seconds -ge $_LOCK_STALE_SECONDS ]]; then
        # Lock is stale (>= 60 minutes old)
        echo "[lock] WARNING: Stale lock detected (age: ${age_seconds}s). Treating as expired." >&2
        return 0
    fi

    # Active lock — extract caller info for the error message
    local lock_caller
    lock_caller=$(printf '%s' "$lock_content" | grep -o '"caller"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"caller"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    local lock_pid
    lock_pid=$(printf '%s' "$lock_content" | grep -o '"pid"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"pid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

    echo "[lock] ABORT: Active deployment lock exists for ${project}-${environment}." >&2
    echo "[lock]   Locked by: ${lock_caller:-unknown}" >&2
    echo "[lock]   PID: ${lock_pid:-unknown}" >&2
    echo "[lock]   Locked at: ${lock_timestamp}" >&2
    echo "[lock]   Age: ${age_seconds}s (stale after ${_LOCK_STALE_SECONDS}s)" >&2
    return 1
}

# ---------------------------------------------------------------------------
# acquire_lock <bucket> <project> <environment> <stack_name>
# Checks for an existing lock, then creates a new one if safe to proceed.
# Returns 0 on success, 1 if an active lock blocks acquisition.
# ---------------------------------------------------------------------------
acquire_lock() {
    local bucket="$1"
    local project="$2"
    local environment="$3"
    local stack_name="$4"
    local lock_path="s3://${bucket}/locks/${project}-${environment}.lock"

    # Check for existing lock
    if ! check_lock "$bucket" "$project" "$environment"; then
        return 1
    fi

    # Get caller identity
    local caller_arn
    caller_arn=$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null)
    if [[ -z "$caller_arn" ]]; then
        caller_arn="unknown"
    fi

    # Build lock file JSON
    local timestamp
    timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local lock_json
    lock_json=$(printf '{\n  "timestamp": "%s",\n  "caller": "%s",\n  "stack": "%s",\n  "pid": "%s"\n}' \
        "$timestamp" "$caller_arn" "$stack_name" "$$")

    # Upload lock file to S3
    if ! printf '%s' "$lock_json" | aws s3 cp - "$lock_path" >/dev/null 2>&1; then
        echo "[lock] ERROR: Failed to create lock file at ${lock_path}. Check S3/IAM permissions." >&2
        return 1
    fi

    echo "[lock] Acquired deployment lock: ${lock_path}" >&2
    return 0
}

# ---------------------------------------------------------------------------
# release_lock <bucket> <project> <environment>
# Removes the lock file from S3. Called on deployment completion
# (success or failure).
# Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
release_lock() {
    local bucket="$1"
    local project="$2"
    local environment="$3"
    local lock_path="s3://${bucket}/locks/${project}-${environment}.lock"

    if aws s3 rm "$lock_path" >/dev/null 2>&1; then
        echo "[lock] Released deployment lock: ${lock_path}" >&2
        return 0
    else
        echo "[lock] WARNING: Failed to release lock at ${lock_path}. It may need manual cleanup." >&2
        return 1
    fi
}

# =============================================================================
# COST ESTIMATE DISPLAY
# =============================================================================
# Displays estimated monthly costs for resources in a CloudFormation template.
# Uses a static cost mapping for common resource types and
# `aws cloudformation get-template-summary` to enumerate resources.
#
# Usage:
#   display_cost_estimate <template_url>
#
# Arguments:
#   template_url  — S3 URL of the CloudFormation template
#
# Output:
#   Formatted table of resource types, counts, and estimated monthly costs.
# =============================================================================

# Static cost mapping: resource type → approximate monthly cost in USD
declare -A _COST_MAP=(
    ["AWS::EC2::NatGateway"]="32"
    ["AWS::ElasticLoadBalancingV2::LoadBalancer"]="16"
    ["AWS::ECS::Service"]="15"
    ["AWS::RDS::DBInstance"]="50"
    ["AWS::EC2::VPCEndpoint"]="7"
    ["AWS::CodeBuild::Project"]="0"
    ["AWS::ApiGatewayV2::Api"]="0"
    ["AWS::WAFv2::WebACL"]="5"
)

# ---------------------------------------------------------------------------
# get_resource_cost <resource_type>
# Returns the estimated monthly cost for a given CloudFormation resource type.
# Returns 0 for unknown resource types.
# ---------------------------------------------------------------------------
get_resource_cost() {
    local resource_type="$1"
    if [[ -n "${_COST_MAP[$resource_type]+_}" ]]; then
        echo "${_COST_MAP[$resource_type]}"
    else
        echo "0"
    fi
}

# ---------------------------------------------------------------------------
# display_cost_estimate <template_url>
# Queries CloudFormation for the template summary, enumerates resource types,
# and displays a formatted cost estimate table.
# Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
display_cost_estimate() {
    local template_url="$1"

    if [[ -z "$template_url" ]]; then
        echo "[cost] ERROR: Template URL is required." >&2
        return 1
    fi

    # Get template summary from CloudFormation
    local summary
    summary=$(aws cloudformation get-template-summary --template-url "$template_url" 2>&1)
    if [[ $? -ne 0 ]]; then
        echo "[cost] ERROR: Failed to get template summary." >&2
        echo "[cost]   $summary" >&2
        return 1
    fi

    # Extract resource types from the summary JSON
    local resource_types
    resource_types=$(printf '%s' "$summary" | grep -o '"ResourceType"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"ResourceType"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | sort)

    if [[ -z "$resource_types" ]]; then
        echo "[cost] No resources found in template." >&2
        return 0
    fi

    # Count occurrences of each resource type
    local -A type_counts
    while IFS= read -r rtype; do
        type_counts["$rtype"]=$(( ${type_counts["$rtype"]:-0} + 1 ))
    done <<< "$resource_types"

    # Display formatted table
    local total_cost=0
    local line_cost=0
    local unit_cost=0

    echo ""
    echo "  Estimated Monthly Cost"
    echo "  ============================================================"
    printf "  %-50s %5s %10s\n" "Resource Type" "Count" "Est. Cost"
    echo "  ------------------------------------------------------------"

    # Sort resource types for consistent output
    local sorted_types
    sorted_types=$(printf '%s\n' "${!type_counts[@]}" | sort)

    while IFS= read -r rtype; do
        [[ -z "$rtype" ]] && continue
        local count="${type_counts[$rtype]}"
        unit_cost=$(get_resource_cost "$rtype")
        line_cost=$(( unit_cost * count ))
        total_cost=$(( total_cost + line_cost ))

        if [[ "$unit_cost" -eq 0 ]] && [[ -z "${_COST_MAP[$rtype]+_}" ]]; then
            printf "  %-50s %5d %9s*\n" "$rtype" "$count" "\$${line_cost}"
        else
            printf "  %-50s %5d %10s\n" "$rtype" "$count" "\$${line_cost}"
        fi
    done <<< "$sorted_types"

    echo "  ------------------------------------------------------------"
    printf "  %-50s %5s %10s\n" "TOTAL (estimated)" "" "\$${total_cost}/mo"
    echo "  ============================================================"
    echo ""
    echo "  * Cost not in mapping — shown as \$0. Actual cost may vary."
    echo "  Note: Estimates are approximate. Actual costs depend on usage."
    echo ""

    return 0
}
