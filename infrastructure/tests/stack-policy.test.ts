/**
 * Property-Based Tests for Stack Policy
 *
 * Feature: infrastructure-optimization, Property 15: Production Stack Policy Protects Stateful Resources
 *
 * **Validates: Requirements 12.1, 12.2**
 *
 * Property 15: Production Stack Policy Protects Stateful Resources
 * _For any_ production deployment, the stack policy SHALL deny `Update:Replace`
 * and `Update:Delete` actions on `AWS::RDS::DBInstance`, `AWS::S3::Bucket`,
 * and `AWS::SecretsManager::Secret` resource types.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONSTANTS
// =============================================================================

const STACK_OPERATIONS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "lib",
  "stack-operations.sh"
);

const PROTECTED_RESOURCE_TYPES = [
  "AWS::RDS::DBInstance",
  "AWS::S3::Bucket",
  "AWS::SecretsManager::Secret",
];

const DENIED_ACTIONS = ["Update:Replace", "Update:Delete"];

// =============================================================================
// HELPER FUNCTIONS — Parse bash script to extract stack policy JSON
// =============================================================================

/**
 * Read the stack-operations.sh script content
 */
function readStackOperations(): string {
  return fs.readFileSync(STACK_OPERATIONS_PATH, "utf8");
}

/**
 * Extract the PROD_STACK_POLICY JSON from the bash script.
 * The policy is assigned as: PROD_STACK_POLICY='{...}'
 */
function extractStackPolicy(scriptContent: string): any {
  const match = scriptContent.match(
    /PROD_STACK_POLICY='(\{[\s\S]*?\})'/
  );
  if (!match) {
    throw new Error("Could not find PROD_STACK_POLICY in stack-operations.sh");
  }
  return JSON.parse(match[1]);
}

/**
 * Find the Deny statement(s) in the policy.
 */
function findDenyStatements(policy: any): any[] {
  return (policy.Statement || []).filter(
    (s: any) => s.Effect === "Deny"
  );
}

/**
 * Find the Allow statement(s) in the policy.
 */
function findAllowStatements(policy: any): any[] {
  return (policy.Statement || []).filter(
    (s: any) => s.Effect === "Allow"
  );
}

/**
 * Check if a resource type is protected by the Deny statement.
 */
function isResourceTypeProtected(
  denyStatements: any[],
  resourceType: string
): boolean {
  return denyStatements.some((stmt: any) => {
    const conditionTypes =
      stmt.Condition?.StringEquals?.ResourceType || [];
    const types = Array.isArray(conditionTypes)
      ? conditionTypes
      : [conditionTypes];
    return types.includes(resourceType);
  });
}

/**
 * Get the denied actions from a Deny statement.
 */
function getDeniedActions(denyStatement: any): string[] {
  const action = denyStatement.Action;
  return Array.isArray(action) ? action : [action];
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for protected resource types
 */
const protectedResourceTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  ...PROTECTED_RESOURCE_TYPES
);

/**
 * Generator for denied actions
 */
const deniedActionArb: fc.Arbitrary<string> = fc.constantFrom(
  ...DENIED_ACTIONS
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Stack Policy Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 15: Production Stack Policy Protects Stateful Resources
   * **Validates: Requirements 12.1, 12.2**
   */
  describe("Property 15: Production Stack Policy Protects Stateful Resources", () => {
    let scriptContent: string;
    let policy: any;
    let denyStatements: any[];
    let allowStatements: any[];

    beforeAll(() => {
      scriptContent = readStackOperations();
      policy = extractStackPolicy(scriptContent);
      denyStatements = findDenyStatements(policy);
      allowStatements = findAllowStatements(policy);
    });

    /**
     * Precondition: stack-operations.sh exists and is readable
     */
    test("should have stack-operations.sh script", () => {
      expect(fs.existsSync(STACK_OPERATIONS_PATH)).toBe(true);
      expect(scriptContent.length).toBeGreaterThan(0);
    });

    /**
     * Precondition: The policy JSON is valid and has statements
     */
    test("should have a valid policy with Statement array", () => {
      expect(policy).toBeDefined();
      expect(policy.Statement).toBeDefined();
      expect(Array.isArray(policy.Statement)).toBe(true);
      expect(policy.Statement.length).toBeGreaterThan(0);
    });

    /**
     * Property: The policy SHALL have at least one Deny statement.
     *
     * **Validates: Requirements 12.1**
     */
    test("should have at least one Deny statement", () => {
      expect(denyStatements.length).toBeGreaterThan(0);
    });

    /**
     * Property: The policy SHALL have an Allow statement for Update:* on all resources.
     *
     * **Validates: Requirements 12.2**
     */
    test("should have an Allow statement for Update:* on all resources", () => {
      const allowAll = allowStatements.find((stmt: any) => {
        const action = Array.isArray(stmt.Action)
          ? stmt.Action
          : [stmt.Action];
        return action.includes("Update:*") && stmt.Resource === "*";
      });
      expect(allowAll).toBeDefined();
    });

    /**
     * Property: The Deny statement SHALL include both Update:Replace and
     * Update:Delete actions.
     *
     * **Validates: Requirements 12.1**
     */
    test("should deny both Update:Replace and Update:Delete actions", () => {
      const allDeniedActions = denyStatements.flatMap((stmt: any) =>
        getDeniedActions(stmt)
      );

      for (const action of DENIED_ACTIONS) {
        expect(allDeniedActions).toContain(action);
      }
    });

    /**
     * Property: For any resource type from the protected list, the Deny
     * statement SHALL cover that resource type.
     *
     * **Validates: Requirements 12.1**
     */
    test("should protect all stateful resource types", () => {
      fc.assert(
        fc.property(protectedResourceTypeArb, (resourceType: string) => {
          const isProtected = isResourceTypeProtected(
            denyStatements,
            resourceType
          );

          if (!isProtected) {
            throw new Error(
              `Resource type "${resourceType}" is NOT protected by the stack policy Deny statement`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any denied action, the Deny statement SHALL include it.
     *
     * **Validates: Requirements 12.1**
     */
    test("should include all denied actions in the Deny statement", () => {
      fc.assert(
        fc.property(deniedActionArb, (action: string) => {
          const allDeniedActions = denyStatements.flatMap((stmt: any) =>
            getDeniedActions(stmt)
          );

          if (!allDeniedActions.includes(action)) {
            throw new Error(
              `Action "${action}" is NOT included in the Deny statement`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any combination of protected resource type and denied action,
     * the stack policy SHALL deny that action on that resource type.
     *
     * **Validates: Requirements 12.1**
     */
    test("should deny every combination of protected resource type and denied action", () => {
      fc.assert(
        fc.property(
          protectedResourceTypeArb,
          deniedActionArb,
          (resourceType: string, action: string) => {
            // Verify the resource type is in the Deny condition
            const isProtected = isResourceTypeProtected(
              denyStatements,
              resourceType
            );

            // Verify the action is in the Deny actions
            const allDeniedActions = denyStatements.flatMap((stmt: any) =>
              getDeniedActions(stmt)
            );
            const actionDenied = allDeniedActions.includes(action);

            if (!isProtected || !actionDenied) {
              throw new Error(
                `Combination (${resourceType}, ${action}) is not fully denied. ` +
                  `Protected: ${isProtected}, Action denied: ${actionDenied}`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The script SHALL apply the stack policy only for prod environment.
     *
     * **Validates: Requirements 12.1**
     */
    test("should apply stack policy conditionally for prod environment", () => {
      expect(scriptContent).toMatch(
        /\$ENVIRONMENT.*==.*prod|ENVIRONMENT.*==.*"prod"/
      );
      expect(scriptContent).toContain("--stack-policy-body");
    });

    /**
     * Property: The script SHALL support --override-policy flag.
     *
     * **Validates: Requirements 12.2**
     */
    test("should support --override-policy flag", () => {
      expect(scriptContent).toContain("OVERRIDE_POLICY");
      expect(scriptContent).toContain(
        "--stack-policy-during-update-body"
      );
    });
  });
});
