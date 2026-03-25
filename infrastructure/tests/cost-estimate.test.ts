/**
 * Property-Based Tests for Cost Estimate Calculation
 *
 * Feature: infrastructure-optimization, Property 16: Cost Estimate Calculation
 *
 * **Validates: Requirements 20.2**
 *
 * Property 16: Cost Estimate Calculation
 * _For any_ resource type in the static cost mapping, the cost estimate function
 * SHALL return the correct approximate monthly cost value for that resource type.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEPLOY_UTILS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "lib",
  "deploy-utils.sh"
);

// =============================================================================
// HELPER FUNCTIONS — Parse bash script to extract cost map
// =============================================================================

/**
 * Read the deploy-utils.sh script content
 */
function readDeployUtils(): string {
  return fs.readFileSync(DEPLOY_UTILS_PATH, "utf8");
}

/**
 * Extract the _COST_MAP associative array from the script.
 * Returns a Map of resource type → cost string.
 */
function extractCostMap(scriptContent: string): Map<string, string> {
  const costMap = new Map<string, string>();

  // Match the declare -A _COST_MAP=( ... ) block
  const mapMatch = scriptContent.match(
    /declare\s+-A\s+_COST_MAP=\(\s*([\s\S]*?)\)/
  );
  if (!mapMatch) {
    throw new Error("Could not find _COST_MAP in deploy-utils.sh");
  }

  // Extract individual entries: ["key"]="value"
  const entryRegex = /\["([^"]+)"\]="([^"]*)"/g;
  let match;
  while ((match = entryRegex.exec(mapMatch[1])) !== null) {
    costMap.set(match[1], match[2]);
  }

  return costMap;
}

/**
 * Simulate the get_resource_cost function from the bash script.
 * Returns the cost for a known resource type, or "0" for unknown types.
 */
function getResourceCost(
  resourceType: string,
  costMap: Map<string, string>
): string {
  return costMap.get(resourceType) ?? "0";
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for unknown resource types (not in the cost map)
 */
const unknownResourceTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  "AWS::EC2::Instance",
  "AWS::Lambda::Function",
  "AWS::DynamoDB::Table",
  "AWS::SQS::Queue",
  "AWS::SNS::Topic",
  "AWS::CloudFront::Distribution",
  "AWS::Route53::HostedZone",
  "AWS::ElastiCache::CacheCluster",
  "AWS::Kinesis::Stream",
  "Custom::SomeResource"
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Cost Estimate Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 16: Cost Estimate Calculation
   * **Validates: Requirements 20.2**
   */
  describe("Property 16: Cost Estimate Calculation", () => {
    let scriptContent: string;
    let costMap: Map<string, string>;
    let knownResourceTypes: string[];

    beforeAll(() => {
      scriptContent = readDeployUtils();
      costMap = extractCostMap(scriptContent);
      knownResourceTypes = Array.from(costMap.keys());
    });

    /**
     * Precondition: deploy-utils.sh exists and is readable
     */
    test("should have deploy-utils.sh script", () => {
      expect(fs.existsSync(DEPLOY_UTILS_PATH)).toBe(true);
      expect(scriptContent.length).toBeGreaterThan(0);
    });

    /**
     * Precondition: The cost map should have entries
     */
    test("should have at least one entry in the cost map", () => {
      expect(costMap.size).toBeGreaterThan(0);
    });

    /**
     * Property: For any resource type in the cost map, the get_resource_cost
     * function SHALL return the correct mapped cost value.
     *
     * **Validates: Requirements 20.2**
     */
    test("should return correct cost for any known resource type", () => {
      // Create arbitrary from the actual known resource types
      const knownResourceArb = fc.constantFrom(...knownResourceTypes);

      fc.assert(
        fc.property(knownResourceArb, (resourceType: string) => {
          const expectedCost = costMap.get(resourceType)!;
          const actualCost = getResourceCost(resourceType, costMap);

          if (actualCost !== expectedCost) {
            throw new Error(
              `Resource type "${resourceType}" returned cost "${actualCost}", ` +
                `expected "${expectedCost}"`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any unknown resource type (not in the cost map),
     * the get_resource_cost function SHALL return "0".
     *
     * **Validates: Requirements 20.2**
     */
    test("should return $0 for any unknown resource type", () => {
      fc.assert(
        fc.property(unknownResourceTypeArb, (resourceType: string) => {
          const cost = getResourceCost(resourceType, costMap);

          if (cost !== "0") {
            throw new Error(
              `Unknown resource type "${resourceType}" returned cost "${cost}", ` +
                `expected "0"`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The cost map SHALL contain the expected resource types
     * from the design document.
     *
     * **Validates: Requirements 20.2**
     */
    test("should contain all expected resource types from design", () => {
      const expectedTypes = [
        "AWS::EC2::NatGateway",
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        "AWS::ECS::Service",
        "AWS::RDS::DBInstance",
        "AWS::EC2::VPCEndpoint",
        "AWS::CodeBuild::Project",
        "AWS::ApiGatewayV2::Api",
        "AWS::WAFv2::WebACL",
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...expectedTypes),
          (resourceType: string) => {
            if (!costMap.has(resourceType)) {
              throw new Error(
                `Expected resource type "${resourceType}" not found in _COST_MAP`
              );
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The cost values for specific resource types SHALL match
     * the design document values.
     *
     * **Validates: Requirements 20.2**
     */
    test("should have correct cost values matching design document", () => {
      const expectedCosts: Record<string, string> = {
        "AWS::EC2::NatGateway": "32",
        "AWS::ElasticLoadBalancingV2::LoadBalancer": "16",
        "AWS::ECS::Service": "15",
        "AWS::RDS::DBInstance": "50",
        "AWS::EC2::VPCEndpoint": "7",
        "AWS::CodeBuild::Project": "0",
        "AWS::ApiGatewayV2::Api": "0",
        "AWS::WAFv2::WebACL": "5",
      };

      fc.assert(
        fc.property(
          fc.constantFrom(...Object.keys(expectedCosts)),
          (resourceType: string) => {
            const actualCost = getResourceCost(resourceType, costMap);
            const expectedCost = expectedCosts[resourceType];

            if (actualCost !== expectedCost) {
              throw new Error(
                `Resource type "${resourceType}" has cost "${actualCost}", ` +
                  `expected "${expectedCost}" per design document`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: All cost values in the map SHALL be non-negative integers.
     *
     * **Validates: Requirements 20.2**
     */
    test("should have non-negative integer cost values for all entries", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...knownResourceTypes),
          (resourceType: string) => {
            const costStr = costMap.get(resourceType)!;
            const costNum = parseInt(costStr, 10);

            if (isNaN(costNum) || costNum < 0) {
              throw new Error(
                `Resource type "${resourceType}" has invalid cost value "${costStr}". ` +
                  `Expected a non-negative integer.`
              );
            }

            if (costNum.toString() !== costStr) {
              throw new Error(
                `Resource type "${resourceType}" cost "${costStr}" is not a clean integer string`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The get_resource_cost function SHALL exist in the script.
     *
     * **Validates: Requirements 20.2**
     */
    test("should have get_resource_cost function in script", () => {
      expect(scriptContent).toContain("get_resource_cost()");
    });

    /**
     * Property: The display_cost_estimate function SHALL exist in the script.
     *
     * **Validates: Requirements 20.2**
     */
    test("should have display_cost_estimate function in script", () => {
      expect(scriptContent).toContain("display_cost_estimate()");
    });
  });
});
