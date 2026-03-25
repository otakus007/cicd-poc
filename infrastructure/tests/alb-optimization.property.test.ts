/**
 * Property-Based Tests for ALB Log Bucket Security Configuration
 *
 * Feature: infrastructure-optimization, Property 1: ALB Log Bucket Security Configuration
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * Property 1: ALB Log Bucket Security Configuration
 * _For any_ environment in {staging, prod} where the ALB access logs bucket is created,
 * the bucket SHALL have `BucketEncryption` with `SSEAlgorithm: aws:kms` using the
 * `alias/aws/s3` key, AND the bucket resource SHALL have `DeletionPolicy: Retain`.
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

interface BucketEncryptionRule {
  ServerSideEncryptionByDefault?: {
    SSEAlgorithm?: string;
    KMSMasterKeyID?: string;
  };
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

const ALB_TEMPLATE_PATH = "alb.yaml";

/**
 * Environments where ALB access logs are enabled (EnableAccessLogs condition).
 * The bucket is only created for staging and prod.
 */
type AccessLogEnvironment = "staging" | "prod";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the ALB CloudFormation template
 */
function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Find all S3 bucket resources that are conditioned on EnableAccessLogs
 * (i.e., the ALB access logs bucket)
 */
function findAccessLogBuckets(
  template: CloudFormationTemplate
): Array<{ name: string; resource: CloudFormationResource }> {
  const resources = template.Resources || {};
  return Object.entries(resources)
    .filter(
      ([, resource]) =>
        resource.Type === "AWS::S3::Bucket" &&
        resource.Condition === "EnableAccessLogs"
    )
    .map(([name, resource]) => ({ name, resource }));
}

/**
 * Extract the ServerSideEncryptionConfiguration rules from a bucket resource
 */
function getEncryptionRules(
  resource: CloudFormationResource
): BucketEncryptionRule[] {
  const props = resource.Properties;
  if (!props) return [];

  const bucketEncryption = props.BucketEncryption as
    | { ServerSideEncryptionConfiguration?: BucketEncryptionRule[] }
    | undefined;

  if (!bucketEncryption?.ServerSideEncryptionConfiguration) return [];

  return bucketEncryption.ServerSideEncryptionConfiguration;
}

/**
 * Check that the EnableAccessLogs condition evaluates to true for the given environment.
 * In the template, EnableAccessLogs = (env == prod) OR (env == staging).
 */
function isAccessLogsEnabled(env: AccessLogEnvironment): boolean {
  return env === "staging" || env === "prod";
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for environments where ALB access logs are enabled
 */
const accessLogEnvArb: fc.Arbitrary<AccessLogEnvironment> = fc.constantFrom(
  "staging" as AccessLogEnvironment,
  "prod" as AccessLogEnvironment
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("ALB Optimization Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 1: ALB Log Bucket Security Configuration
   * **Validates: Requirements 1.1, 1.2**
   */
  describe("Property 1: ALB Log Bucket Security Configuration", () => {
    let template: CloudFormationTemplate;
    let accessLogBuckets: Array<{
      name: string;
      resource: CloudFormationResource;
    }>;

    beforeAll(() => {
      template = loadTemplate(ALB_TEMPLATE_PATH);
      accessLogBuckets = findAccessLogBuckets(template);
    });

    /**
     * Precondition: The ALB access logs bucket exists in the template
     * and is conditioned on EnableAccessLogs.
     */
    test("should have at least one ALB access logs bucket conditioned on EnableAccessLogs", () => {
      expect(accessLogBuckets.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Property: For any environment in {staging, prod}, the ALB access logs bucket
     * SHALL have BucketEncryption with SSEAlgorithm: aws:kms using alias/aws/s3 key.
     *
     * **Validates: Requirements 1.1**
     */
    test("should have KMS encryption with aws:kms SSEAlgorithm on ALB access logs bucket for staging/prod", () => {
      fc.assert(
        fc.property(accessLogEnvArb, (env: AccessLogEnvironment) => {
          // Verify access logs are enabled for this environment
          expect(isAccessLogsEnabled(env)).toBe(true);

          for (const { name, resource } of accessLogBuckets) {
            const rules = getEncryptionRules(resource);

            // Must have at least one encryption rule
            if (rules.length === 0) {
              throw new Error(
                `ALB access logs bucket "${name}" has no BucketEncryption ` +
                  `ServerSideEncryptionConfiguration for environment "${env}"`
              );
            }

            // At least one rule must use aws:kms with alias/aws/s3
            const hasKmsRule = rules.some((rule) => {
              const defaults = rule.ServerSideEncryptionByDefault;
              return (
                defaults?.SSEAlgorithm === "aws:kms" &&
                defaults?.KMSMasterKeyID === "alias/aws/s3"
              );
            });

            if (!hasKmsRule) {
              throw new Error(
                `ALB access logs bucket "${name}" does not have SSEAlgorithm: aws:kms ` +
                  `with KMSMasterKeyID: alias/aws/s3 for environment "${env}". ` +
                  `Found rules: ${JSON.stringify(rules)}`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment in {staging, prod}, the ALB access logs bucket
     * resource SHALL have DeletionPolicy: Retain.
     *
     * **Validates: Requirements 1.2**
     */
    test("should have DeletionPolicy Retain on ALB access logs bucket for staging/prod", () => {
      fc.assert(
        fc.property(accessLogEnvArb, (env: AccessLogEnvironment) => {
          expect(isAccessLogsEnabled(env)).toBe(true);

          for (const { name, resource } of accessLogBuckets) {
            if (resource.DeletionPolicy !== "Retain") {
              throw new Error(
                `ALB access logs bucket "${name}" has DeletionPolicy ` +
                  `"${resource.DeletionPolicy}" instead of "Retain" ` +
                  `for environment "${env}"`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Combined property: For any environment in {staging, prod}, the ALB access logs
     * bucket SHALL have BOTH KMS encryption AND DeletionPolicy: Retain.
     *
     * **Validates: Requirements 1.1, 1.2**
     */
    test("should have both KMS encryption and DeletionPolicy Retain for staging/prod", () => {
      fc.assert(
        fc.property(accessLogEnvArb, (env: AccessLogEnvironment) => {
          expect(isAccessLogsEnabled(env)).toBe(true);

          for (const { name, resource } of accessLogBuckets) {
            // Check DeletionPolicy
            if (resource.DeletionPolicy !== "Retain") {
              throw new Error(
                `ALB access logs bucket "${name}" missing DeletionPolicy: Retain ` +
                  `for environment "${env}"`
              );
            }

            // Check KMS encryption
            const rules = getEncryptionRules(resource);
            const hasKmsRule = rules.some((rule) => {
              const defaults = rule.ServerSideEncryptionByDefault;
              return (
                defaults?.SSEAlgorithm === "aws:kms" &&
                defaults?.KMSMasterKeyID === "alias/aws/s3"
              );
            });

            if (!hasKmsRule) {
              throw new Error(
                `ALB access logs bucket "${name}" missing aws:kms encryption ` +
                  `with alias/aws/s3 for environment "${env}"`
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
