/**
 * Unit Tests for RDS Cross-Region Backup Replication
 *
 * Feature: infrastructure-optimization
 *
 * **Validates: Requirements 4.1, 4.2**
 *
 * - 4.1: WHILE the environment is prod, enable RDS automated backup replication
 *        to a configurable secondary AWS region
 * - 4.2: IF the backup replication target region is not specified, default to
 *        `ap-southeast-2` as the DR region
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface CloudFormationResource {
  Type: string;
  Condition?: string;
  Properties?: Record<string, unknown>;
}

interface CloudFormationParameter {
  Type: string;
  Default?: unknown;
  Description?: string;
  AllowedValues?: unknown[];
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Parameters?: Record<string, CloudFormationParameter>;
  Resources?: Record<string, CloudFormationResource>;
  Conditions?: Record<string, unknown>;
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
// HELPERS
// =============================================================================

function loadRdsTemplate(): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", "rds-oracle.yaml");
  const content = fs.readFileSync(fullPath, "utf8");
  return yaml.load(content, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

// =============================================================================
// TESTS — RDS Cross-Region Backup Replication
// =============================================================================

describe("RDS Cross-Region Backup Replication", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadRdsTemplate();
  });

  /**
   * **Validates: Requirement 4.2**
   * IF the backup replication target region is not specified,
   * THEN default to `ap-southeast-2`.
   */
  describe("BackupReplicationRegion parameter (Req 4.2)", () => {
    test("BackupReplicationRegion parameter exists", () => {
      const params = template.Parameters || {};
      expect(params.BackupReplicationRegion).toBeDefined();
    });

    test("BackupReplicationRegion has type String", () => {
      const param = template.Parameters!.BackupReplicationRegion;
      expect(param.Type).toBe("String");
    });

    test("BackupReplicationRegion defaults to ap-southeast-2", () => {
      const param = template.Parameters!.BackupReplicationRegion;
      expect(param.Default).toBe("ap-southeast-2");
    });
  });

  /**
   * **Validates: Requirement 4.1**
   * WHILE the environment is prod, enable RDS automated backup replication
   * to a configurable secondary AWS region.
   */
  describe("BackupReplicationConfig resource (Req 4.1)", () => {
    test("BackupReplicationConfig resource exists", () => {
      const resources = template.Resources || {};
      expect(resources.BackupReplicationConfig).toBeDefined();
    });

    test("BackupReplicationConfig is an AWS::SSM::Parameter", () => {
      const resource = template.Resources!.BackupReplicationConfig;
      expect(resource.Type).toBe("AWS::SSM::Parameter");
    });

    test("BackupReplicationConfig is conditioned on IsProduction", () => {
      const resource = template.Resources!.BackupReplicationConfig;
      expect(resource.Condition).toBe("IsProduction");
    });

    test("IsProduction condition is defined in the template", () => {
      const conditions = template.Conditions || {};
      expect(conditions.IsProduction).toBeDefined();
    });

    test("SSM parameter value references BackupReplicationRegion parameter", () => {
      const resource = template.Resources!.BackupReplicationConfig;
      const value = resource.Properties?.Value as Record<string, unknown> | undefined;
      expect(value).toBeDefined();
      // The value should be { Ref: "BackupReplicationRegion" }
      expect(value).toEqual({ Ref: "BackupReplicationRegion" });
    });

    test("SSM parameter name follows the expected path pattern", () => {
      const resource = template.Resources!.BackupReplicationConfig;
      const name = resource.Properties?.Name as Record<string, unknown> | undefined;
      expect(name).toBeDefined();
      // Should be a !Sub expression containing the backup-replication-region path
      const subValue = name?.["Fn::Sub"] as string | undefined;
      expect(subValue).toBeDefined();
      expect(subValue).toContain("rds/backup-replication-region");
    });
  });
});

// =============================================================================
// PROPERTY-BASED TESTS — RDS Performance Insights
// =============================================================================

import * as fc from "fast-check";

/**
 * Feature: infrastructure-optimization, Property 9: Environment-Aware RDS Performance Insights
 *
 * **Validates: Requirements 14.1, 14.2**
 *
 * - 14.1: WHILE the environment is prod or staging, enable EnablePerformanceInsights
 *         on the Oracle RDS instance with a 7-day retention period
 * - 14.2: WHILE the environment is dev, disable Performance Insights to reduce cost
 */
describe("Feature: infrastructure-optimization, Property 9: Environment-Aware RDS Performance Insights", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadRdsTemplate();
  });

  /**
   * Helper: resolve a CloudFormation !If expression given an environment value.
   *
   * Evaluates conditions:
   *   IsProduction      → env === "prod"
   *   IsNotDevelopment   → env !== "dev"
   */
  function resolveIf(expr: unknown, env: string): unknown {
    if (expr == null || typeof expr !== "object") return expr;

    const obj = expr as Record<string, unknown>;

    if (obj["Fn::If"]) {
      const [conditionName, trueVal, falseVal] = obj["Fn::If"] as [string, unknown, unknown];
      const conditionResult = evaluateCondition(conditionName, env);
      return conditionResult ? resolveIf(trueVal, env) : resolveIf(falseVal, env);
    }

    if (obj["Ref"] === "AWS::NoValue") {
      return undefined; // AWS::NoValue means the property is omitted
    }

    return expr;
  }

  function evaluateCondition(name: string, env: string): boolean {
    if (name === "IsProduction") return env === "prod";
    if (name === "IsNotDevelopment") return env !== "dev";
    throw new Error(`Unknown condition: ${name}`);
  }

  function getRdsInstance(): CloudFormationResource {
    const resources = template.Resources || {};
    const rdsInstance = Object.values(resources).find(
      (r) => r.Type === "AWS::RDS::DBInstance"
    );
    expect(rdsInstance).toBeDefined();
    return rdsInstance!;
  }

  test("prod/staging environments have Performance Insights enabled with 7-day retention", () => {
    const envArb = fc.constantFrom("prod", "staging");

    fc.assert(
      fc.property(envArb, (env) => {
        const rds = getRdsInstance();
        const props = rds.Properties || {};

        const enablePI = resolveIf(props.EnablePerformanceInsights, env);
        const retentionPeriod = resolveIf(props.PerformanceInsightsRetentionPeriod, env);

        expect(enablePI).toBe(true);
        expect(retentionPeriod).toBe(7);
      }),
      { numRuns: 100 }
    );
  });

  test("dev environment has Performance Insights disabled", () => {
    const envArb = fc.constant("dev");

    fc.assert(
      fc.property(envArb, (env) => {
        const rds = getRdsInstance();
        const props = rds.Properties || {};

        const enablePI = resolveIf(props.EnablePerformanceInsights, env);

        expect(enablePI).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test("all environments resolve Performance Insights correctly", () => {
    const envArb = fc.constantFrom("dev", "staging", "prod");

    fc.assert(
      fc.property(envArb, (env) => {
        const rds = getRdsInstance();
        const props = rds.Properties || {};

        const enablePI = resolveIf(props.EnablePerformanceInsights, env);
        const retentionPeriod = resolveIf(props.PerformanceInsightsRetentionPeriod, env);

        if (env === "dev") {
          expect(enablePI).toBe(false);
          // Retention period should be omitted (AWS::NoValue) for dev
          expect(retentionPeriod).toBeUndefined();
        } else {
          expect(enablePI).toBe(true);
          expect(retentionPeriod).toBe(7);
        }
      }),
      { numRuns: 100 }
    );
  });
});
