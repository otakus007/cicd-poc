/**
 * Property-Based Tests for ECR Tag Immutability Configuration
 *
 * Feature: infrastructure-optimization, Property 7: Environment-Aware ECR Tag Immutability
 *
 * **Validates: Requirements 18.1, 18.2**
 *
 * Property 7: Environment-Aware ECR Tag Immutability
 * _For any_ environment value, the ECR repository SHALL have
 * `ImageTagMutability: IMMUTABLE` when environment is `prod`, and
 * `ImageTagMutability: MUTABLE` when environment is `dev` or `staging`.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface CloudFormationResource {
  Type: string;
  Condition?: string;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties?: Record<string, unknown>;
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Resources?: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

// =============================================================================
// YAML SCHEMA FOR CLOUDFORMATION INTRINSIC FUNCTIONS
// =============================================================================

const cfnRefType = new yaml.Type("!Ref", {
  kind: "scalar",
  construct: (data: string) => ({ Ref: data }),
});

const cfnSubType = new yaml.Type("!Sub", {
  kind: "scalar",
  construct: (data: string) => ({ "Fn::Sub": data }),
});

const cfnSubSequenceType = new yaml.Type("!Sub", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Sub": data }),
});

const cfnGetAttType = new yaml.Type("!GetAtt", {
  kind: "scalar",
  construct: (data: string) => ({ "Fn::GetAtt": data.split(".") }),
});

const cfnGetAttSequenceType = new yaml.Type("!GetAtt", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::GetAtt": data }),
});

const cfnSelectType = new yaml.Type("!Select", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Select": data }),
});

const cfnGetAZsType = new yaml.Type("!GetAZs", {
  kind: "scalar",
  construct: (data: string) => ({ "Fn::GetAZs": data }),
});

const cfnJoinType = new yaml.Type("!Join", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Join": data }),
});

const cfnIfType = new yaml.Type("!If", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::If": data }),
});

const cfnEqualsType = new yaml.Type("!Equals", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Equals": data }),
});

const cfnNotType = new yaml.Type("!Not", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Not": data }),
});

const cfnAndType = new yaml.Type("!And", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::And": data }),
});

const cfnOrType = new yaml.Type("!Or", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Or": data }),
});

const cfnConditionType = new yaml.Type("!Condition", {
  kind: "scalar",
  construct: (data: string) => ({ Condition: data }),
});

const cfnImportValueType = new yaml.Type("!ImportValue", {
  kind: "scalar",
  construct: (data: string) => ({ "Fn::ImportValue": data }),
});

const cfnFindInMapType = new yaml.Type("!FindInMap", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::FindInMap": data }),
});

const cfnBase64Type = new yaml.Type("!Base64", {
  kind: "scalar",
  construct: (data: string) => ({ "Fn::Base64": data }),
});

const cfnCidrType = new yaml.Type("!Cidr", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Cidr": data }),
});

const cfnSplitType = new yaml.Type("!Split", {
  kind: "sequence",
  construct: (data: unknown[]) => ({ "Fn::Split": data }),
});

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  cfnRefType,
  cfnSubType,
  cfnSubSequenceType,
  cfnGetAttType,
  cfnGetAttSequenceType,
  cfnSelectType,
  cfnGetAZsType,
  cfnJoinType,
  cfnIfType,
  cfnEqualsType,
  cfnNotType,
  cfnAndType,
  cfnOrType,
  cfnConditionType,
  cfnImportValueType,
  cfnFindInMapType,
  cfnBase64Type,
  cfnCidrType,
  cfnSplitType,
]);

// =============================================================================
// CONSTANTS
// =============================================================================

const ECR_TEMPLATE_PATH = "ecr.yaml";

type Environment = "dev" | "staging" | "prod";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the ECR CloudFormation template
 */
function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Find all ECR Repository resources in the template
 */
function findEcrRepositories(
  template: CloudFormationTemplate
): Array<{ name: string; resource: CloudFormationResource }> {
  const resources = template.Resources || {};
  return Object.entries(resources)
    .filter(([, resource]) => resource.Type === "AWS::ECR::Repository")
    .map(([name, resource]) => ({ name, resource }));
}

/**
 * Evaluate the IsProduction condition for a given environment.
 * IsProduction = !Equals [!Ref Environment, prod]
 */
function isProduction(env: Environment): boolean {
  return env === "prod";
}

/**
 * Resolve the expected ImageTagMutability value based on the !If conditional.
 * The template uses: !If [IsProduction, IMMUTABLE, MUTABLE]
 */
function expectedTagMutability(env: Environment): string {
  return isProduction(env) ? "IMMUTABLE" : "MUTABLE";
}

/**
 * Extract the ImageTagMutability value from an ECR resource.
 * Returns the parsed !If structure or a static string.
 */
function getImageTagMutability(resource: CloudFormationResource): unknown {
  return resource.Properties?.ImageTagMutability;
}

/**
 * Verify that an !If intrinsic function matches the expected pattern:
 * { "Fn::If": ["IsProduction", "IMMUTABLE", "MUTABLE"] }
 */
function isValidIfConditional(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const fnIf = (value as Record<string, unknown>)["Fn::If"];
  if (!Array.isArray(fnIf) || fnIf.length !== 3) return false;
  return (
    fnIf[0] === "IsProduction" &&
    fnIf[1] === "IMMUTABLE" &&
    fnIf[2] === "MUTABLE"
  );
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for all valid environment values
 */
const envArb: fc.Arbitrary<Environment> = fc.constantFrom(
  "dev" as Environment,
  "staging" as Environment,
  "prod" as Environment
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("ECR Optimization Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 7: Environment-Aware ECR Tag Immutability
   * **Validates: Requirements 18.1, 18.2**
   */
  describe("Property 7: Environment-Aware ECR Tag Immutability", () => {
    let template: CloudFormationTemplate;
    let ecrRepositories: Array<{
      name: string;
      resource: CloudFormationResource;
    }>;

    beforeAll(() => {
      template = loadTemplate(ECR_TEMPLATE_PATH);
      ecrRepositories = findEcrRepositories(template);
    });

    /**
     * Precondition: At least one ECR repository exists in the template.
     */
    test("should have at least one ECR repository resource", () => {
      expect(ecrRepositories.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Precondition: The IsProduction condition exists in the template.
     */
    test("should have IsProduction condition defined", () => {
      expect(template.Conditions).toBeDefined();
      expect(template.Conditions!.IsProduction).toBeDefined();
    });

    /**
     * Property: For any environment value, the ECR repository SHALL use an
     * !If conditional on IsProduction to set ImageTagMutability to IMMUTABLE
     * for prod and MUTABLE for dev/staging.
     *
     * We verify the template structure contains the correct !If intrinsic.
     *
     * **Validates: Requirements 18.1, 18.2**
     */
    test("should use !If [IsProduction, IMMUTABLE, MUTABLE] for ImageTagMutability", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          for (const { name, resource } of ecrRepositories) {
            const tagMutability = getImageTagMutability(resource);

            if (!isValidIfConditional(tagMutability)) {
              throw new Error(
                `ECR repository "${name}" does not use !If [IsProduction, IMMUTABLE, MUTABLE] ` +
                  `for ImageTagMutability. Found: ${JSON.stringify(tagMutability)}. ` +
                  `Expected conditional that resolves to "${expectedTagMutability(env)}" for env "${env}".`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment in {dev, staging, prod}, the resolved
     * ImageTagMutability value SHALL be IMMUTABLE for prod and MUTABLE otherwise.
     *
     * We simulate CloudFormation condition evaluation to verify the resolved value.
     *
     * **Validates: Requirements 18.1, 18.2**
     */
    test("should resolve to IMMUTABLE for prod and MUTABLE for dev/staging", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const expected = expectedTagMutability(env);

          for (const { name, resource } of ecrRepositories) {
            const tagMutability = getImageTagMutability(resource);

            // The value must be an !If conditional
            if (typeof tagMutability !== "object" || tagMutability === null) {
              throw new Error(
                `ECR repository "${name}" ImageTagMutability is not a conditional. ` +
                  `Found: ${JSON.stringify(tagMutability)}`
              );
            }

            const fnIf = (tagMutability as Record<string, unknown>)["Fn::If"];
            if (!Array.isArray(fnIf) || fnIf.length !== 3) {
              throw new Error(
                `ECR repository "${name}" ImageTagMutability !If has invalid structure. ` +
                  `Found: ${JSON.stringify(fnIf)}`
              );
            }

            // Simulate condition evaluation
            const conditionName = fnIf[0] as string;
            const trueValue = fnIf[1] as string;
            const falseValue = fnIf[2] as string;

            // IsProduction evaluates to true when env === "prod"
            const conditionResult = isProduction(env);
            const resolvedValue = conditionResult ? trueValue : falseValue;

            if (resolvedValue !== expected) {
              throw new Error(
                `ECR repository "${name}" resolves ImageTagMutability to "${resolvedValue}" ` +
                  `for env "${env}", but expected "${expected}". ` +
                  `Condition "${conditionName}" evaluated to ${conditionResult}.`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For prod environment, the ECR repository SHALL have
     * ImageTagMutability: IMMUTABLE to prevent tag overwrites.
     *
     * **Validates: Requirements 18.1**
     */
    test("should set IMMUTABLE for prod environment", () => {
      fc.assert(
        fc.property(fc.constant("prod" as Environment), (env: Environment) => {
          for (const { name, resource } of ecrRepositories) {
            const tagMutability = getImageTagMutability(resource);
            const fnIf = (tagMutability as Record<string, unknown>)?.["Fn::If"] as unknown[];

            if (!fnIf) {
              throw new Error(
                `ECR repository "${name}" missing !If conditional for ImageTagMutability`
              );
            }

            // For prod, IsProduction is true, so the true branch (index 1) applies
            const prodValue = fnIf[1] as string;
            if (prodValue !== "IMMUTABLE") {
              throw new Error(
                `ECR repository "${name}" !If true branch is "${prodValue}" ` +
                  `instead of "IMMUTABLE" for prod environment`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For dev and staging environments, the ECR repository SHALL have
     * ImageTagMutability: MUTABLE to allow iterative development.
     *
     * **Validates: Requirements 18.2**
     */
    test("should set MUTABLE for dev and staging environments", () => {
      const nonProdEnvArb = fc.constantFrom(
        "dev" as Environment,
        "staging" as Environment
      );

      fc.assert(
        fc.property(nonProdEnvArb, (env: Environment) => {
          for (const { name, resource } of ecrRepositories) {
            const tagMutability = getImageTagMutability(resource);
            const fnIf = (tagMutability as Record<string, unknown>)?.["Fn::If"] as unknown[];

            if (!fnIf) {
              throw new Error(
                `ECR repository "${name}" missing !If conditional for ImageTagMutability`
              );
            }

            // For non-prod, IsProduction is false, so the false branch (index 2) applies
            const nonProdValue = fnIf[2] as string;
            if (nonProdValue !== "MUTABLE") {
              throw new Error(
                `ECR repository "${name}" !If false branch is "${nonProdValue}" ` +
                  `instead of "MUTABLE" for env "${env}"`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
