/**
 * Property-Based Tests for ECS Exec Configuration
 *
 * Feature: infrastructure-optimization, Property 8: Environment-Aware ECS Exec Configuration
 *
 * **Validates: Requirements 19.1, 19.2, 19.3**
 *
 * Property 8: Environment-Aware ECS Exec Configuration
 * _For any_ environment value, the ECS service SHALL have `EnableExecuteCommand: true`
 * when environment is `dev` or `staging`, and `EnableExecuteCommand: false` when
 * environment is `prod`.
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

const cfnTags = [
  new yaml.Type("!Ref", { kind: "scalar", construct: (d: string) => ({ Ref: d }) }),
  new yaml.Type("!Sub", { kind: "scalar", construct: (d: string) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!Sub", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!GetAtt", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAtt": d.split(".") }) }),
  new yaml.Type("!GetAtt", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::GetAtt": d }) }),
  new yaml.Type("!Select", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Select": d }) }),
  new yaml.Type("!GetAZs", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAZs": d }) }),
  new yaml.Type("!Join", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Join": d }) }),
  new yaml.Type("!If", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::If": d }) }),
  new yaml.Type("!Equals", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Equals": d }) }),
  new yaml.Type("!Not", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Not": d }) }),
  new yaml.Type("!And", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::And": d }) }),
  new yaml.Type("!Or", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Or": d }) }),
  new yaml.Type("!Condition", { kind: "scalar", construct: (d: string) => ({ Condition: d }) }),
  new yaml.Type("!ImportValue", { kind: "scalar", construct: (d: string) => ({ "Fn::ImportValue": d }) }),
  new yaml.Type("!FindInMap", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::FindInMap": d }) }),
  new yaml.Type("!Base64", { kind: "scalar", construct: (d: string) => ({ "Fn::Base64": d }) }),
  new yaml.Type("!Cidr", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Cidr": d }) }),
  new yaml.Type("!Split", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Split": d }) }),
];

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(cfnTags);

// =============================================================================
// CONSTANTS
// =============================================================================

const ECS_SERVICE_TEMPLATE_PATH = "ecs-service.yaml";

type Environment = "dev" | "staging" | "prod";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the ECS service CloudFormation template
 */
function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Find the EcsService resource in the template
 */
function findEcsService(
  template: CloudFormationTemplate
): { name: string; resource: CloudFormationResource } | undefined {
  const resources = template.Resources || {};
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.Type === "AWS::ECS::Service") {
      return { name, resource };
    }
  }
  return undefined;
}

/**
 * Evaluate the IsProduction condition for a given environment.
 */
function isProduction(env: Environment): boolean {
  return env === "prod";
}

/**
 * Resolve the expected EnableExecuteCommand value based on environment.
 * Dev/staging → true, prod → false
 */
function expectedEnableExecuteCommand(env: Environment): boolean {
  return !isProduction(env);
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

describe("ECS Exec Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 8: Environment-Aware ECS Exec Configuration
   * **Validates: Requirements 19.1, 19.2, 19.3**
   */
  describe("Property 8: Environment-Aware ECS Exec Configuration", () => {
    let template: CloudFormationTemplate;

    beforeAll(() => {
      template = loadTemplate(ECS_SERVICE_TEMPLATE_PATH);
    });

    // =========================================================================
    // Precondition tests
    // =========================================================================

    /**
     * Precondition: EcsService resource exists with correct type.
     */
    test("should have an EcsService resource of type AWS::ECS::Service", () => {
      const service = findEcsService(template);
      expect(service).toBeDefined();
      expect(service!.resource.Type).toBe("AWS::ECS::Service");
    });

    /**
     * Precondition: IsProduction condition is defined in the template.
     */
    test("should have IsProduction condition defined", () => {
      expect(template.Conditions).toBeDefined();
      expect(template.Conditions!.IsProduction).toBeDefined();
    });

    /**
     * Precondition: EnableExecuteCommand parameter exists with default "true".
     */
    test("should have EnableExecuteCommand parameter with default true", () => {
      expect(template.Parameters).toBeDefined();
      const param = template.Parameters!.EnableExecuteCommand as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBe("true");
    });

    /**
     * Precondition: EcsService has EnableExecuteCommand property.
     */
    test("should have EnableExecuteCommand property on EcsService", () => {
      const service = findEcsService(template);
      expect(service).toBeDefined();
      expect(service!.resource.Properties?.EnableExecuteCommand).toBeDefined();
    });

    // =========================================================================
    // Property: EnableExecuteCommand uses !If [IsProduction, false, true]
    // =========================================================================

    /**
     * Property: The EcsService SHALL use !If [IsProduction, false, true] for
     * EnableExecuteCommand, resulting in false for prod and true for dev/staging.
     *
     * **Validates: Requirements 19.1, 19.2**
     */
    test("should use !If [IsProduction, false, true] for EnableExecuteCommand", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const enableExec = service.resource.Properties?.EnableExecuteCommand as Record<string, unknown>;
          if (!enableExec || typeof enableExec !== "object") {
            throw new Error(
              `EnableExecuteCommand is not a conditional. Found: ${JSON.stringify(enableExec)}`
            );
          }

          const fnIf = enableExec["Fn::If"] as unknown[];
          if (!Array.isArray(fnIf) || fnIf.length !== 3) {
            throw new Error(
              `EnableExecuteCommand !If has invalid structure. Found: ${JSON.stringify(fnIf)}`
            );
          }

          // Verify condition name
          expect(fnIf[0]).toBe("IsProduction");
          // Verify prod value (true branch of IsProduction) → false
          expect(fnIf[1]).toBe(false);
          // Verify non-prod value (false branch of IsProduction) → true
          expect(fnIf[2]).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment, the resolved EnableExecuteCommand SHALL be
     * true for dev/staging and false for prod.
     *
     * Simulates CloudFormation condition evaluation.
     *
     * **Validates: Requirements 19.1, 19.2**
     */
    test("should resolve EnableExecuteCommand to true for dev/staging and false for prod", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const enableExec = service.resource.Properties?.EnableExecuteCommand as Record<string, unknown>;
          const fnIf = enableExec["Fn::If"] as unknown[];

          // Simulate condition evaluation
          const conditionResult = isProduction(env);
          const resolvedValue = conditionResult ? fnIf[1] : fnIf[2];
          const expected = expectedEnableExecuteCommand(env);

          if (resolvedValue !== expected) {
            throw new Error(
              `EnableExecuteCommand resolves to ${resolvedValue} for env "${env}", ` +
                `but expected ${expected}. IsProduction=${conditionResult}.`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
