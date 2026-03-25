/**
 * Property-Based Tests for CloudWatch Log Group KMS Encryption
 *
 * Feature: infrastructure-optimization, Property 2: Environment-Aware CloudWatch Log Group KMS Encryption
 *
 * **Validates: Requirements 2.1, 2.2**
 *
 * Property 2: Environment-Aware CloudWatch Log Group KMS Encryption
 * _For any_ CloudWatch Log Group resource across all templates, WHEN the environment
 * is `prod`, the resource SHALL have a `KmsKeyId` property referencing the
 * `alias/aws/cloudwatch` managed key. WHEN the environment is `dev`, the resource
 * SHALL NOT have a `KmsKeyId` property.
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

type Environment = "dev" | "staging" | "prod";

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

/** Templates that contain CloudWatch Log Group resources */
const TEMPLATES_WITH_LOG_GROUPS = [
  "ecs-cluster.yaml",
  "api-gateway.yaml",
  "codebuild.yaml",
];

/** The KMS alias that should be referenced for CloudWatch encryption */
const CLOUDWATCH_KMS_ALIAS = "alias/aws/cloudwatch";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse a CloudFormation template
 */
function loadTemplate(templateFile: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templateFile);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Find all AWS::Logs::LogGroup resources in a template
 */
function findLogGroups(
  template: CloudFormationTemplate
): Array<{ name: string; resource: CloudFormationResource }> {
  const resources = template.Resources || {};
  return Object.entries(resources)
    .filter(([, resource]) => resource.Type === "AWS::Logs::LogGroup")
    .map(([name, resource]) => ({ name, resource }));
}

/**
 * Check if a KmsKeyId property uses an !If conditional on IsProduction
 * with the correct KMS alias for the prod branch and AWS::NoValue for non-prod.
 *
 * Expected parsed structure:
 * { "Fn::If": ["IsProduction", { "Fn::Sub": "arn:aws:kms:...alias/aws/cloudwatch" }, { "Ref": "AWS::NoValue" }] }
 */
function getKmsKeyIdConfig(resource: CloudFormationResource): {
  hasKmsKeyId: boolean;
  usesConditional: boolean;
  conditionName: string | null;
  prodValue: unknown;
  nonProdValue: unknown;
} {
  const props = resource.Properties;
  if (!props || !("KmsKeyId" in props)) {
    return {
      hasKmsKeyId: false,
      usesConditional: false,
      conditionName: null,
      prodValue: null,
      nonProdValue: null,
    };
  }

  const kmsKeyId = props.KmsKeyId as Record<string, unknown> | undefined;

  // Check if it's an !If conditional
  if (kmsKeyId && "Fn::If" in kmsKeyId) {
    const ifArray = kmsKeyId["Fn::If"] as unknown[];
    return {
      hasKmsKeyId: true,
      usesConditional: true,
      conditionName: ifArray[0] as string,
      prodValue: ifArray[1],
      nonProdValue: ifArray[2],
    };
  }

  return {
    hasKmsKeyId: true,
    usesConditional: false,
    conditionName: null,
    prodValue: kmsKeyId,
    nonProdValue: null,
  };
}

/**
 * Check if a value references the alias/aws/cloudwatch KMS key.
 * The value can be a Fn::Sub string containing the alias.
 */
function referencesCloudWatchKmsAlias(value: unknown): boolean {
  if (!value) return false;

  // Direct string check
  if (typeof value === "string") {
    return value.includes(CLOUDWATCH_KMS_ALIAS);
  }

  // Fn::Sub string check
  if (typeof value === "object" && value !== null && "Fn::Sub" in value) {
    const subValue = (value as Record<string, unknown>)["Fn::Sub"];
    if (typeof subValue === "string") {
      return subValue.includes(CLOUDWATCH_KMS_ALIAS);
    }
  }

  return false;
}

/**
 * Check if a value is AWS::NoValue (meaning the property is effectively absent)
 */
function isNoValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.Ref === "AWS::NoValue";
}

/**
 * Evaluate whether the IsProduction condition is true for a given environment
 */
function isProduction(env: Environment): boolean {
  return env === "prod";
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/** Generator for all valid environments */
const environmentArb: fc.Arbitrary<Environment> = fc.constantFrom(
  "dev" as Environment,
  "staging" as Environment,
  "prod" as Environment
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("CloudWatch KMS Encryption Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 2: Environment-Aware CloudWatch Log Group KMS Encryption
   * **Validates: Requirements 2.1, 2.2**
   */
  describe("Property 2: Environment-Aware CloudWatch Log Group KMS Encryption", () => {
    /** Parsed templates and their log groups */
    const templateLogGroups: Array<{
      templateFile: string;
      logGroups: Array<{ name: string; resource: CloudFormationResource }>;
    }> = [];

    beforeAll(() => {
      for (const templateFile of TEMPLATES_WITH_LOG_GROUPS) {
        const template = loadTemplate(templateFile);
        const logGroups = findLogGroups(template);
        templateLogGroups.push({ templateFile, logGroups });
      }
    });

    /**
     * Precondition: Each template should contain at least one LogGroup resource
     */
    test("each template should contain at least one AWS::Logs::LogGroup resource", () => {
      for (const { templateFile, logGroups } of templateLogGroups) {
        expect(logGroups.length).toBeGreaterThanOrEqual(
          1,
          // Custom message for clarity
        );
        if (logGroups.length < 1) {
          throw new Error(
            `Template "${templateFile}" has no AWS::Logs::LogGroup resources`
          );
        }
      }
    });

    /**
     * Property: For any environment, all LogGroup resources across all templates
     * SHALL use an !If conditional on IsProduction for KmsKeyId.
     *
     * This ensures the KMS encryption is environment-aware.
     */
    test("all LogGroup resources should use !If [IsProduction, ...] conditional for KmsKeyId", () => {
      for (const { templateFile, logGroups } of templateLogGroups) {
        for (const { name, resource } of logGroups) {
          const config = getKmsKeyIdConfig(resource);

          if (!config.hasKmsKeyId) {
            throw new Error(
              `LogGroup "${name}" in "${templateFile}" is missing KmsKeyId property entirely`
            );
          }

          if (!config.usesConditional) {
            throw new Error(
              `LogGroup "${name}" in "${templateFile}" has KmsKeyId but does not use an !If conditional`
            );
          }

          expect(config.conditionName).toBe("IsProduction");
        }
      }
    });

    /**
     * Property: For any environment = prod, all LogGroup resources SHALL have
     * KmsKeyId referencing alias/aws/cloudwatch.
     *
     * **Validates: Requirement 2.1**
     */
    test("WHEN environment is prod, all LogGroups SHALL have KmsKeyId referencing alias/aws/cloudwatch", () => {
      fc.assert(
        fc.property(
          fc.constant("prod" as Environment),
          (env: Environment) => {
            expect(isProduction(env)).toBe(true);

            for (const { templateFile, logGroups } of templateLogGroups) {
              for (const { name, resource } of logGroups) {
                const config = getKmsKeyIdConfig(resource);

                if (!config.hasKmsKeyId || !config.usesConditional) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}" missing conditional KmsKeyId for prod`
                  );
                }

                // For prod, the IsProduction condition is true, so the prod branch is used
                if (!referencesCloudWatchKmsAlias(config.prodValue)) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}" prod branch does not reference ` +
                      `"${CLOUDWATCH_KMS_ALIAS}". Got: ${JSON.stringify(config.prodValue)}`
                  );
                }
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any environment = dev, all LogGroup resources SHALL NOT have
     * KmsKeyId set (the !If resolves to AWS::NoValue).
     *
     * **Validates: Requirement 2.2**
     */
    test("WHEN environment is dev, all LogGroups SHALL NOT have KmsKeyId set (AWS::NoValue)", () => {
      fc.assert(
        fc.property(
          fc.constant("dev" as Environment),
          (env: Environment) => {
            expect(isProduction(env)).toBe(false);

            for (const { templateFile, logGroups } of templateLogGroups) {
              for (const { name, resource } of logGroups) {
                const config = getKmsKeyIdConfig(resource);

                if (!config.hasKmsKeyId || !config.usesConditional) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}" missing conditional KmsKeyId`
                  );
                }

                // For dev, the IsProduction condition is false, so the non-prod branch is used
                if (!isNoValue(config.nonProdValue)) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}" non-prod branch is not AWS::NoValue. ` +
                      `Got: ${JSON.stringify(config.nonProdValue)}`
                  );
                }
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Combined property: For any environment ∈ {dev, staging, prod}, the KmsKeyId
     * conditional correctly resolves — prod gets the KMS key, dev/staging get NoValue.
     *
     * **Validates: Requirements 2.1, 2.2**
     */
    test("for any environment, KmsKeyId conditional correctly resolves per environment", () => {
      fc.assert(
        fc.property(environmentArb, (env: Environment) => {
          const isProd = isProduction(env);

          for (const { templateFile, logGroups } of templateLogGroups) {
            for (const { name, resource } of logGroups) {
              const config = getKmsKeyIdConfig(resource);

              if (!config.hasKmsKeyId || !config.usesConditional) {
                throw new Error(
                  `LogGroup "${name}" in "${templateFile}" missing conditional KmsKeyId`
                );
              }

              if (isProd) {
                // Prod: KmsKeyId should reference alias/aws/cloudwatch
                if (!referencesCloudWatchKmsAlias(config.prodValue)) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}": prod branch should reference ` +
                      `"${CLOUDWATCH_KMS_ALIAS}" but got: ${JSON.stringify(config.prodValue)}`
                  );
                }
              } else {
                // Dev/Staging: KmsKeyId should resolve to AWS::NoValue
                if (!isNoValue(config.nonProdValue)) {
                  throw new Error(
                    `LogGroup "${name}" in "${templateFile}": non-prod branch should be ` +
                      `AWS::NoValue for env="${env}" but got: ${JSON.stringify(config.nonProdValue)}`
                  );
                }
              }
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
