/**
 * Property-Based Tests for ECS Auto-Scaling Configuration
 *
 * Feature: infrastructure-optimization, Property 3: ECS Auto-Scaling Target with Environment-Aware Minimums
 *
 * **Validates: Requirements 3.1, 3.4**
 *
 * Property 3: ECS Auto-Scaling Target with Environment-Aware Minimums
 * _For any_ ECS Fargate service and any environment value, the template SHALL include
 * an `AWS::ApplicationAutoScaling::ScalableTarget` resource with `MinCapacity` of 1
 * for dev and 2 for staging/prod, and a configurable `MaxCapacity`.
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
 * Find the ScalableTarget resource in the template
 */
function findScalableTarget(
  template: CloudFormationTemplate
): { name: string; resource: CloudFormationResource } | undefined {
  const resources = template.Resources || {};
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.Type === "AWS::ApplicationAutoScaling::ScalableTarget") {
      return { name, resource };
    }
  }
  return undefined;
}

/**
 * Find the CpuScalingPolicy resource in the template
 */
function findCpuScalingPolicy(
  template: CloudFormationTemplate
): { name: string; resource: CloudFormationResource } | undefined {
  const resources = template.Resources || {};
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.Type === "AWS::ApplicationAutoScaling::ScalingPolicy") {
      return { name, resource };
    }
  }
  return undefined;
}

/**
 * Evaluate the IsDevelopment condition for a given environment.
 */
function isDevelopment(env: Environment): boolean {
  return env === "dev";
}

/**
 * Resolve the expected MinCapacity value based on environment.
 * Dev → 1, staging/prod → 2
 */
function expectedMinCapacity(env: Environment): number {
  return isDevelopment(env) ? 1 : 2;
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

describe("ECS Auto-Scaling Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 3: ECS Auto-Scaling Target with Environment-Aware Minimums
   * **Validates: Requirements 3.1, 3.4**
   */
  describe("Property 3: ECS Auto-Scaling Target with Environment-Aware Minimums", () => {
    let template: CloudFormationTemplate;

    beforeAll(() => {
      template = loadTemplate(ECS_SERVICE_TEMPLATE_PATH);
    });

    // =========================================================================
    // Precondition tests
    // =========================================================================

    /**
     * Precondition: ScalableTarget resource exists with correct type.
     */
    test("should have a ScalableTarget resource of type AWS::ApplicationAutoScaling::ScalableTarget", () => {
      const target = findScalableTarget(template);
      expect(target).toBeDefined();
      expect(target!.resource.Type).toBe("AWS::ApplicationAutoScaling::ScalableTarget");
    });

    /**
     * Precondition: IsDevelopment condition is defined in the template.
     */
    test("should have IsDevelopment condition defined", () => {
      expect(template.Conditions).toBeDefined();
      expect(template.Conditions!.IsDevelopment).toBeDefined();
    });

    /**
     * Precondition: CpuScalingPolicy resource exists with correct type.
     */
    test("should have a CpuScalingPolicy resource of type AWS::ApplicationAutoScaling::ScalingPolicy", () => {
      const policy = findCpuScalingPolicy(template);
      expect(policy).toBeDefined();
      expect(policy!.resource.Type).toBe("AWS::ApplicationAutoScaling::ScalingPolicy");
    });

    // =========================================================================
    // Property: MinCapacity uses !If [IsDevelopment, 1, 2]
    // =========================================================================

    /**
     * Property: The ScalableTarget SHALL use !If [IsDevelopment, 1, 2] for MinCapacity,
     * resulting in MinCapacity of 1 for dev and 2 for staging/prod.
     *
     * **Validates: Requirements 3.1, 3.4**
     */
    test("should use !If [IsDevelopment, 1, 2] for MinCapacity", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const target = findScalableTarget(template);
          if (!target) {
            throw new Error("ScalableTarget resource not found in template");
          }

          const minCapacity = target.resource.Properties?.MinCapacity as Record<string, unknown>;
          if (!minCapacity || typeof minCapacity !== "object") {
            throw new Error(
              `ScalableTarget MinCapacity is not a conditional. Found: ${JSON.stringify(minCapacity)}`
            );
          }

          const fnIf = minCapacity["Fn::If"] as unknown[];
          if (!Array.isArray(fnIf) || fnIf.length !== 3) {
            throw new Error(
              `ScalableTarget MinCapacity !If has invalid structure. Found: ${JSON.stringify(fnIf)}`
            );
          }

          // Verify condition name
          expect(fnIf[0]).toBe("IsDevelopment");
          // Verify dev value (true branch)
          expect(fnIf[1]).toBe(1);
          // Verify non-dev value (false branch)
          expect(fnIf[2]).toBe(2);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment, the resolved MinCapacity SHALL be 1 for dev
     * and 2 for staging/prod.
     *
     * Simulates CloudFormation condition evaluation.
     *
     * **Validates: Requirements 3.1, 3.4**
     */
    test("should resolve MinCapacity to 1 for dev and 2 for staging/prod", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const target = findScalableTarget(template);
          if (!target) {
            throw new Error("ScalableTarget resource not found in template");
          }

          const minCapacity = target.resource.Properties?.MinCapacity as Record<string, unknown>;
          const fnIf = minCapacity["Fn::If"] as unknown[];

          // Simulate condition evaluation
          const conditionResult = isDevelopment(env);
          const resolvedValue = conditionResult ? fnIf[1] : fnIf[2];
          const expected = expectedMinCapacity(env);

          if (resolvedValue !== expected) {
            throw new Error(
              `ScalableTarget MinCapacity resolves to ${resolvedValue} for env "${env}", ` +
                `but expected ${expected}. IsDevelopment=${conditionResult}.`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: MaxCapacity SHALL reference the MaxTaskCount parameter.
     *
     * **Validates: Requirements 3.1**
     */
    test("should reference MaxTaskCount parameter for MaxCapacity", () => {
      const target = findScalableTarget(template);
      expect(target).toBeDefined();

      const maxCapacity = target!.resource.Properties?.MaxCapacity as Record<string, unknown>;
      expect(maxCapacity).toBeDefined();
      expect(maxCapacity).toEqual({ Ref: "MaxTaskCount" });
    });

    // =========================================================================
    // CpuScalingPolicy configuration
    // =========================================================================

    /**
     * Verify CpuScalingPolicy has TargetValue: 70.
     *
     * **Validates: Requirements 3.1**
     */
    test("should have CpuScalingPolicy with TargetValue 70", () => {
      const policy = findCpuScalingPolicy(template);
      expect(policy).toBeDefined();

      const policyConfig = policy!.resource.Properties
        ?.TargetTrackingScalingPolicyConfiguration as Record<string, unknown>;
      expect(policyConfig).toBeDefined();
      expect(policyConfig.TargetValue).toBe(70);
    });

    /**
     * Verify CpuScalingPolicy has ScaleInCooldown: 300.
     *
     * **Validates: Requirements 3.1**
     */
    test("should have CpuScalingPolicy with ScaleInCooldown 300", () => {
      const policy = findCpuScalingPolicy(template);
      expect(policy).toBeDefined();

      const policyConfig = policy!.resource.Properties
        ?.TargetTrackingScalingPolicyConfiguration as Record<string, unknown>;
      expect(policyConfig).toBeDefined();
      expect(policyConfig.ScaleInCooldown).toBe(300);
    });

    /**
     * Verify CpuScalingPolicy has ScaleOutCooldown: 60.
     *
     * **Validates: Requirements 3.1**
     */
    test("should have CpuScalingPolicy with ScaleOutCooldown 60", () => {
      const policy = findCpuScalingPolicy(template);
      expect(policy).toBeDefined();

      const policyConfig = policy!.resource.Properties
        ?.TargetTrackingScalingPolicyConfiguration as Record<string, unknown>;
      expect(policyConfig).toBeDefined();
      expect(policyConfig.ScaleOutCooldown).toBe(60);
    });

    /**
     * Verify CpuScalingPolicy uses ECSServiceAverageCPUUtilization metric.
     *
     * **Validates: Requirements 3.1**
     */
    test("should use ECSServiceAverageCPUUtilization predefined metric", () => {
      const policy = findCpuScalingPolicy(template);
      expect(policy).toBeDefined();

      const policyConfig = policy!.resource.Properties
        ?.TargetTrackingScalingPolicyConfiguration as Record<string, unknown>;
      const metricSpec = policyConfig?.PredefinedMetricSpecification as Record<string, unknown>;
      expect(metricSpec).toBeDefined();
      expect(metricSpec.PredefinedMetricType).toBe("ECSServiceAverageCPUUtilization");
    });
  });
});
