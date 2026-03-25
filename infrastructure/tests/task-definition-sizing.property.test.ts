/**
 * Property-Based Tests for Environment-Aware Task Definition Sizing
 *
 * Feature: infrastructure-optimization, Property 6: Environment-Aware Task Definition Sizing
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * Property 6: Environment-Aware Task Definition Sizing
 * _For any_ environment value in {dev, staging, prod}, the task definition Mappings
 * SHALL map to the correct CPU/Memory defaults: dev → (256/512), staging → (512/1024),
 * prod → (1024/2048).
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
  Mappings?: Record<string, Record<string, Record<string, string>>>;
  Resources?: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

type Environment = "dev" | "staging" | "prod";

interface ExpectedSizing {
  Cpu: string;
  Memory: string;
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

const TASK_DEF_TEMPLATE_PATH = "task-definition.yaml";

const EXPECTED_SIZING: Record<Environment, ExpectedSizing> = {
  dev: { Cpu: "256", Memory: "512" },
  staging: { Cpu: "512", Memory: "1024" },
  prod: { Cpu: "1024", Memory: "2048" },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

// =============================================================================
// FAST-CHECK ARBITRARIES
// =============================================================================

const envArb: fc.Arbitrary<Environment> = fc.constantFrom("dev", "staging", "prod");

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Task Definition Sizing Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 6: Environment-Aware Task Definition Sizing
   * **Validates: Requirements 8.1, 8.2**
   */
  describe("Property 6: Environment-Aware Task Definition Sizing", () => {
    let template: CloudFormationTemplate;

    beforeAll(() => {
      template = loadTemplate(TASK_DEF_TEMPLATE_PATH);
    });

    /**
     * Precondition: The EnvironmentTaskSizing Mappings section exists in the template.
     */
    test("should have EnvironmentTaskSizing Mappings section", () => {
      expect(template.Mappings).toBeDefined();
      expect(template.Mappings!.EnvironmentTaskSizing).toBeDefined();
    });

    /**
     * Property: For any environment in {dev, staging, prod}, the EnvironmentTaskSizing
     * Mappings SHALL contain the correct CPU and Memory values:
     * dev → (256/512), staging → (512/1024), prod → (1024/2048).
     *
     * **Validates: Requirements 8.1**
     */
    test("should map each environment to correct CPU/Memory defaults", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const mappings = template.Mappings!.EnvironmentTaskSizing;
          const envMapping = mappings[env];

          if (!envMapping) {
            throw new Error(
              `EnvironmentTaskSizing Mappings missing entry for environment "${env}"`
            );
          }

          const expected = EXPECTED_SIZING[env];

          if (envMapping.Cpu !== expected.Cpu) {
            throw new Error(
              `Environment "${env}" has Cpu "${envMapping.Cpu}", expected "${expected.Cpu}"`
            );
          }

          if (envMapping.Memory !== expected.Memory) {
            throw new Error(
              `Environment "${env}" has Memory "${envMapping.Memory}", expected "${expected.Memory}"`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment in {dev, staging, prod}, the Mappings values
     * SHALL be valid Fargate CPU/Memory combinations (CPU and Memory are strings
     * representing valid Fargate resource units).
     *
     * **Validates: Requirements 8.1**
     */
    test("should have valid Fargate CPU/Memory string values for all environments", () => {
      const validCpuValues = ["256", "512", "1024", "2048", "4096"];
      const validMemoryValues = [
        "512", "1024", "2048", "3072", "4096",
        "5120", "6144", "7168", "8192",
      ];

      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const envMapping = template.Mappings!.EnvironmentTaskSizing[env];

          if (!validCpuValues.includes(envMapping.Cpu)) {
            throw new Error(
              `Environment "${env}" has invalid Cpu value "${envMapping.Cpu}". ` +
              `Valid values: ${validCpuValues.join(", ")}`
            );
          }

          if (!validMemoryValues.includes(envMapping.Memory)) {
            throw new Error(
              `Environment "${env}" has invalid Memory value "${envMapping.Memory}". ` +
              `Valid values: ${validMemoryValues.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment in {dev, staging, prod}, the Memory value
     * SHALL be at least double the CPU value (Fargate constraint: Memory >= 2x CPU
     * for 256 CPU units).
     *
     * **Validates: Requirements 8.1**
     */
    test("should have Memory >= 2x CPU for all environments", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const envMapping = template.Mappings!.EnvironmentTaskSizing[env];
          const cpu = parseInt(envMapping.Cpu, 10);
          const memory = parseInt(envMapping.Memory, 10);

          if (memory < 2 * cpu) {
            throw new Error(
              `Environment "${env}" has Memory ${memory} < 2x CPU ${cpu}. ` +
              `Fargate requires Memory >= 2x CPU for this CPU tier.`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The Mappings SHALL cover all three environments (dev, staging, prod)
     * with no missing entries.
     *
     * **Validates: Requirements 8.1**
     */
    test("should have entries for all three environments", () => {
      const mappings = template.Mappings!.EnvironmentTaskSizing;
      const requiredEnvs: Environment[] = ["dev", "staging", "prod"];

      for (const env of requiredEnvs) {
        expect(mappings[env]).toBeDefined();
        expect(mappings[env].Cpu).toBeDefined();
        expect(mappings[env].Memory).toBeDefined();
      }
    });

    /**
     * Property: For any environment in {dev, staging, prod}, the TaskDefinition resource
     * SHALL reference the EnvironmentTaskSizing Mappings via FindInMap for default sizing.
     *
     * **Validates: Requirements 8.2**
     */
    test("should reference EnvironmentTaskSizing via FindInMap in TaskDefinition resource", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const resources = template.Resources || {};
          const taskDef = Object.entries(resources).find(
            ([, r]) => r.Type === "AWS::ECS::TaskDefinition"
          );

          if (!taskDef) {
            throw new Error("No AWS::ECS::TaskDefinition resource found in template");
          }

          const [taskDefName, taskDefResource] = taskDef;
          const props = taskDefResource.Properties;

          if (!props) {
            throw new Error(`TaskDefinition "${taskDefName}" has no Properties`);
          }

          // The Cpu and Memory properties should use !If with FindInMap
          // When "auto" is selected, it uses FindInMap[EnvironmentTaskSizing, env, Cpu/Memory]
          const cpuProp = props.Cpu as Record<string, unknown> | undefined;
          const memoryProp = props.Memory as Record<string, unknown> | undefined;

          // Verify Cpu references FindInMap with EnvironmentTaskSizing
          const cpuStr = JSON.stringify(cpuProp);
          if (!cpuStr.includes("EnvironmentTaskSizing")) {
            throw new Error(
              `TaskDefinition "${taskDefName}" Cpu property does not reference ` +
              `EnvironmentTaskSizing Mappings. Got: ${cpuStr}`
            );
          }

          // Verify Memory references FindInMap with EnvironmentTaskSizing
          const memoryStr = JSON.stringify(memoryProp);
          if (!memoryStr.includes("EnvironmentTaskSizing")) {
            throw new Error(
              `TaskDefinition "${taskDefName}" Memory property does not reference ` +
              `EnvironmentTaskSizing Mappings. Got: ${memoryStr}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
