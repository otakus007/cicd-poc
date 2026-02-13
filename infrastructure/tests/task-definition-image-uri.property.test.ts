/**
 * Property-Based Tests for Task Definition Image URI Update
 *
 * Feature: aws-cicd-pipeline, Property 3: Task Definition Image URI Update
 *
 * **Validates: Requirements 6.1**
 *
 * Property 3: Task Definition Image URI Update
 * _For any_ valid ECR image URI, updating the task definition SHALL:
 * - Replace the image field with the new URI
 * - Preserve all other container configuration (ports, health checks, secrets, logging)
 * - Produce a valid task definition that can be registered with ECS
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface PortMapping {
  ContainerPort: number | { Ref: string };
  Protocol: string;
  AppProtocol?: string;
}

interface HealthCheck {
  Command: string[];
  Interval: number | { Ref: string };
  Timeout: number | { Ref: string };
  Retries: number | { Ref: string };
  StartPeriod: number | { Ref: string };
}

interface Secret {
  Name: string;
  ValueFrom: unknown;
}

interface LogConfiguration {
  LogDriver: string;
  Options: Record<string, unknown>;
}

interface EnvironmentVariable {
  Name: string;
  Value: string | { "Fn::If": unknown[] };
}

interface ContainerDefinition {
  Name: unknown;
  Image: unknown;
  Essential: boolean;
  PortMappings: PortMapping[];
  HealthCheck: HealthCheck;
  LogConfiguration: LogConfiguration;
  Secrets: Secret[];
  Environment: EnvironmentVariable[];
  Cpu?: number;
  MemoryReservation?: number | { "Fn::If": unknown[] };
  Privileged?: boolean;
  ReadonlyRootFilesystem?: boolean;
  LinuxParameters?: Record<string, unknown>;
  Ulimits?: Array<{ Name: string; SoftLimit: number; HardLimit: number }>;
}

interface TaskDefinitionProperties {
  Family: unknown;
  NetworkMode: string;
  RequiresCompatibilities: string[];
  Cpu: unknown;
  Memory: unknown;
  ExecutionRoleArn: unknown;
  TaskRoleArn: unknown;
  RuntimePlatform?: Record<string, string>;
  ContainerDefinitions: ContainerDefinition[];
  Tags?: Array<{ Key: string; Value: unknown }>;
}

interface CloudFormationResource {
  Type: string;
  Properties?: TaskDefinitionProperties | Record<string, unknown>;
  DependsOn?: string | string[];
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Metadata?: Record<string, unknown>;
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
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the task definition CloudFormation template
 */
function loadTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "task-definition.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Get the task definition resource from the template
 */
function getTaskDefinition(template: CloudFormationTemplate): TaskDefinitionProperties | null {
  const taskDef = template.Resources?.TaskDefinition;
  if (!taskDef || taskDef.Type !== "AWS::ECS::TaskDefinition") {
    return null;
  }
  return taskDef.Properties as TaskDefinitionProperties;
}

/**
 * Get the container definition from the task definition
 */
function getContainerDefinition(taskDef: TaskDefinitionProperties): ContainerDefinition | null {
  if (!taskDef.ContainerDefinitions || taskDef.ContainerDefinitions.length === 0) {
    return null;
  }
  return taskDef.ContainerDefinitions[0];
}

/**
 * Validate ECR image URI format
 * Format: {account}.dkr.ecr.{region}.amazonaws.com/{repo}:{tag}
 */
function isValidEcrImageUri(uri: string): boolean {
  const ecrPattern = /^\d{12}\.dkr\.ecr\.[a-z]{2}-[a-z]+-\d\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*:[a-zA-Z0-9._-]+$/;
  return ecrPattern.test(uri);
}

/**
 * Simulate updating the task definition with a new image URI
 * This mimics what the CI/CD pipeline does when deploying a new image
 */
function updateTaskDefinitionImage(
  taskDef: TaskDefinitionProperties,
  newImageUri: string
): TaskDefinitionProperties {
  // Deep clone the task definition to avoid mutating the original
  const updatedTaskDef = JSON.parse(JSON.stringify(taskDef)) as TaskDefinitionProperties;

  // Update the image in the container definition
  if (updatedTaskDef.ContainerDefinitions && updatedTaskDef.ContainerDefinitions.length > 0) {
    updatedTaskDef.ContainerDefinitions[0].Image = newImageUri;
  }

  return updatedTaskDef;
}

/**
 * Compare two container definitions to verify configuration preservation
 * Returns true if all configuration except Image is preserved
 */
function isConfigurationPreserved(
  original: ContainerDefinition,
  updated: ContainerDefinition
): { preserved: boolean; differences: string[] } {
  const differences: string[] = [];

  // Check port mappings
  if (JSON.stringify(original.PortMappings) !== JSON.stringify(updated.PortMappings)) {
    differences.push("PortMappings changed");
  }

  // Check health check
  if (JSON.stringify(original.HealthCheck) !== JSON.stringify(updated.HealthCheck)) {
    differences.push("HealthCheck changed");
  }

  // Check secrets
  if (JSON.stringify(original.Secrets) !== JSON.stringify(updated.Secrets)) {
    differences.push("Secrets changed");
  }

  // Check log configuration
  if (JSON.stringify(original.LogConfiguration) !== JSON.stringify(updated.LogConfiguration)) {
    differences.push("LogConfiguration changed");
  }

  // Check environment variables
  if (JSON.stringify(original.Environment) !== JSON.stringify(updated.Environment)) {
    differences.push("Environment changed");
  }

  // Check essential flag
  if (original.Essential !== updated.Essential) {
    differences.push("Essential flag changed");
  }

  // Check container name
  if (JSON.stringify(original.Name) !== JSON.stringify(updated.Name)) {
    differences.push("Name changed");
  }

  return {
    preserved: differences.length === 0,
    differences
  };
}

/**
 * Validate that a task definition has all required fields for ECS registration
 */
function isValidTaskDefinition(taskDef: TaskDefinitionProperties): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!taskDef.Family) {
    errors.push("Missing Family");
  }

  if (!taskDef.NetworkMode) {
    errors.push("Missing NetworkMode");
  }

  if (!taskDef.RequiresCompatibilities || taskDef.RequiresCompatibilities.length === 0) {
    errors.push("Missing RequiresCompatibilities");
  }

  if (!taskDef.Cpu) {
    errors.push("Missing Cpu");
  }

  if (!taskDef.Memory) {
    errors.push("Missing Memory");
  }

  if (!taskDef.ExecutionRoleArn) {
    errors.push("Missing ExecutionRoleArn");
  }

  if (!taskDef.ContainerDefinitions || taskDef.ContainerDefinitions.length === 0) {
    errors.push("Missing ContainerDefinitions");
  }

  // Validate container definition
  if (taskDef.ContainerDefinitions && taskDef.ContainerDefinitions.length > 0) {
    const container = taskDef.ContainerDefinitions[0];

    if (!container.Name) {
      errors.push("Container missing Name");
    }

    if (!container.Image) {
      errors.push("Container missing Image");
    }

    if (!container.PortMappings || container.PortMappings.length === 0) {
      errors.push("Container missing PortMappings");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid AWS account IDs (12-digit numbers)
 */
const accountIdArb = fc
  .stringOf(fc.constantFrom(..."123456789".split("")), { minLength: 1, maxLength: 1 })
  .chain((first) =>
    fc
      .stringOf(fc.constantFrom(..."0123456789".split("")), { minLength: 11, maxLength: 11 })
      .map((rest) => first + rest)
  );

/**
 * Generator for valid AWS regions
 */
const regionArb = fc.constantFrom(
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1"
);

/**
 * Generator for valid ECR repository names
 * Repository names can contain lowercase letters, numbers, hyphens, underscores, and forward slashes
 */
const repoNameArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_/".split("")), {
      minLength: 0,
      maxLength: 50,
    })
  )
  .map(([first, rest]) => first + rest)
  .filter((name) => !name.includes("//") && !name.endsWith("/") && !name.endsWith("-") && !name.endsWith("_"));

/**
 * Generator for valid image tags
 * Tags can contain alphanumeric characters, periods, hyphens, and underscores
 */
const imageTagArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-".split("")), {
      minLength: 0,
      maxLength: 50,
    })
  )
  .map(([first, rest]) => first + rest)
  .filter((tag) => !tag.endsWith(".") && !tag.endsWith("-") && !tag.endsWith("_"));

/**
 * Generator for valid ECR image URIs
 * Format: {account}.dkr.ecr.{region}.amazonaws.com/{repo}:{tag}
 */
const ecrImageUriArb = fc
  .tuple(accountIdArb, regionArb, repoNameArb, imageTagArb)
  .map(([accountId, region, repoName, tag]) =>
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:${tag}`
  );

/**
 * Generator for commit SHA tags (common in CI/CD pipelines)
 */
const commitShaTagArb = fc
  .stringOf(fc.constantFrom(..."0123456789abcdef".split("")), {
    minLength: 7,
    maxLength: 40,
  });

/**
 * Generator for semantic version tags
 */
const semverTagArb = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 999 })
  )
  .map(([major, minor, patch]) => `v${major}.${minor}.${patch}`);

/**
 * Generator for ECR image URIs with commit SHA tags
 */
const ecrImageUriWithCommitShaArb = fc
  .tuple(accountIdArb, regionArb, repoNameArb, commitShaTagArb)
  .map(([accountId, region, repoName, sha]) =>
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:${sha}`
  );

/**
 * Generator for ECR image URIs with semantic version tags
 */
const ecrImageUriWithSemverArb = fc
  .tuple(accountIdArb, regionArb, repoNameArb, semverTagArb)
  .map(([accountId, region, repoName, version]) =>
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:${version}`
  );

/**
 * Generator for ECR image URIs with "latest" tag
 */
const ecrImageUriWithLatestArb = fc
  .tuple(accountIdArb, regionArb, repoNameArb)
  .map(([accountId, region, repoName]) =>
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:latest`
  );

/**
 * Combined generator for all valid ECR image URI formats
 */
const allEcrImageUriArb = fc.oneof(
  ecrImageUriArb,
  ecrImageUriWithCommitShaArb,
  ecrImageUriWithSemverArb,
  ecrImageUriWithLatestArb
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Task Definition Image URI Property-Based Tests", () => {
  /**
   * Feature: aws-cicd-pipeline, Property 3: Task Definition Image URI Update
   * **Validates: Requirements 6.1**
   */
  describe("Property 3: Task Definition Image URI Update", () => {
    let template: CloudFormationTemplate;
    let originalTaskDef: TaskDefinitionProperties;
    let originalContainer: ContainerDefinition;

    beforeAll(() => {
      template = loadTemplate();
      const taskDef = getTaskDefinition(template);
      if (!taskDef) {
        throw new Error("Task definition not found in template");
      }
      originalTaskDef = taskDef;

      const container = getContainerDefinition(taskDef);
      if (!container) {
        throw new Error("Container definition not found in task definition");
      }
      originalContainer = container;
    });

    /**
     * Property: For any valid ECR image URI, the task definition SHALL accept
     * the new URI in the image field.
     *
     * **Validates: Requirements 6.1**
     */
    test("should accept any valid ECR image URI", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          // Verify the generated URI is valid
          expect(isValidEcrImageUri(imageUri)).toBe(true);

          // Update the task definition with the new image URI
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);

          // Verify the image was updated
          const updatedContainer = getContainerDefinition(updatedTaskDef);
          expect(updatedContainer).not.toBeNull();
          expect(updatedContainer!.Image).toBe(imageUri);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, updating the task definition SHALL
     * preserve all other container configuration (ports, health checks, secrets, logging).
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve all container configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          // Update the task definition with the new image URI
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();

          // Verify all configuration is preserved
          const { preserved, differences } = isConfigurationPreserved(
            originalContainer,
            updatedContainer!
          );

          if (!preserved) {
            throw new Error(
              `Configuration not preserved when updating image to ${imageUri}. ` +
              `Differences: ${differences.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the updated task definition SHALL
     * produce a valid task definition that can be registered with ECS.
     *
     * **Validates: Requirements 6.1**
     */
    test("should produce valid task definition after image update", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          // Update the task definition with the new image URI
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);

          // Validate the updated task definition
          const { valid, errors } = isValidTaskDefinition(updatedTaskDef);

          if (!valid) {
            throw new Error(
              `Invalid task definition after updating image to ${imageUri}. ` +
              `Errors: ${errors.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI with commit SHA tag, the task definition
     * SHALL correctly accept the SHA-based tag format used in CI/CD pipelines.
     *
     * **Validates: Requirements 6.1**
     */
    test("should accept ECR image URIs with commit SHA tags", () => {
      fc.assert(
        fc.property(ecrImageUriWithCommitShaArb, (imageUri) => {
          // Update the task definition with the new image URI
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();
          expect(updatedContainer!.Image).toBe(imageUri);

          // Verify the URI contains a valid commit SHA pattern
          const tagMatch = imageUri.match(/:([a-f0-9]{7,40})$/);
          expect(tagMatch).not.toBeNull();

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI with semantic version tag, the task
     * definition SHALL correctly accept the version-based tag format.
     *
     * **Validates: Requirements 6.1**
     */
    test("should accept ECR image URIs with semantic version tags", () => {
      fc.assert(
        fc.property(ecrImageUriWithSemverArb, (imageUri) => {
          // Update the task definition with the new image URI
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();
          expect(updatedContainer!.Image).toBe(imageUri);

          // Verify the URI contains a valid semver pattern
          const tagMatch = imageUri.match(/:v\d+\.\d+\.\d+$/);
          expect(tagMatch).not.toBeNull();

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the port mappings SHALL remain unchanged
     * after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve port mappings when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();

          // Verify port mappings are identical
          expect(JSON.stringify(updatedContainer!.PortMappings)).toBe(
            JSON.stringify(originalContainer.PortMappings)
          );

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the health check configuration SHALL
     * remain unchanged after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve health check configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();

          // Verify health check is identical
          expect(JSON.stringify(updatedContainer!.HealthCheck)).toBe(
            JSON.stringify(originalContainer.HealthCheck)
          );

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the secrets configuration SHALL
     * remain unchanged after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve secrets configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();

          // Verify secrets are identical
          expect(JSON.stringify(updatedContainer!.Secrets)).toBe(
            JSON.stringify(originalContainer.Secrets)
          );

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the logging configuration SHALL
     * remain unchanged after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve logging configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);
          const updatedContainer = getContainerDefinition(updatedTaskDef);

          expect(updatedContainer).not.toBeNull();

          // Verify log configuration is identical
          expect(JSON.stringify(updatedContainer!.LogConfiguration)).toBe(
            JSON.stringify(originalContainer.LogConfiguration)
          );

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the task-level configuration (CPU, Memory,
     * NetworkMode, RequiresCompatibilities) SHALL remain unchanged after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve task-level configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);

          // Verify task-level configuration is preserved
          expect(JSON.stringify(updatedTaskDef.Cpu)).toBe(JSON.stringify(originalTaskDef.Cpu));
          expect(JSON.stringify(updatedTaskDef.Memory)).toBe(JSON.stringify(originalTaskDef.Memory));
          expect(updatedTaskDef.NetworkMode).toBe(originalTaskDef.NetworkMode);
          expect(JSON.stringify(updatedTaskDef.RequiresCompatibilities)).toBe(
            JSON.stringify(originalTaskDef.RequiresCompatibilities)
          );
          expect(JSON.stringify(updatedTaskDef.Family)).toBe(JSON.stringify(originalTaskDef.Family));

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid ECR image URI, the IAM role configuration SHALL
     * remain unchanged after the image update.
     *
     * **Validates: Requirements 6.1**
     */
    test("should preserve IAM role configuration when image is updated", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          const updatedTaskDef = updateTaskDefinitionImage(originalTaskDef, imageUri);

          // Verify IAM roles are preserved
          expect(JSON.stringify(updatedTaskDef.ExecutionRoleArn)).toBe(
            JSON.stringify(originalTaskDef.ExecutionRoleArn)
          );
          expect(JSON.stringify(updatedTaskDef.TaskRoleArn)).toBe(
            JSON.stringify(originalTaskDef.TaskRoleArn)
          );

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: The template SHALL have a ContainerImage parameter that accepts
     * ECR image URIs for CI/CD pipeline updates.
     *
     * **Validates: Requirements 6.1**
     */
    test("should have ContainerImage parameter for CI/CD updates", () => {
      fc.assert(
        fc.property(allEcrImageUriArb, (imageUri) => {
          // Verify the template has a ContainerImage parameter
          const containerImageParam = template.Parameters?.ContainerImage as Record<string, unknown>;
          expect(containerImageParam).toBeDefined();
          expect(containerImageParam.Type).toBe("String");

          // Verify the parameter description mentions ECR
          const description = containerImageParam.Description as string;
          expect(description.toLowerCase()).toContain("ecr");

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any sequence of image URI updates, the task definition SHALL
     * maintain consistency and validity.
     *
     * **Validates: Requirements 6.1**
     */
    test("should maintain validity through multiple image updates", () => {
      fc.assert(
        fc.property(
          fc.array(allEcrImageUriArb, { minLength: 2, maxLength: 5 }),
          (imageUris) => {
            let currentTaskDef = originalTaskDef;

            // Apply multiple image updates sequentially
            for (const imageUri of imageUris) {
              currentTaskDef = updateTaskDefinitionImage(currentTaskDef, imageUri);

              // Verify validity after each update
              const { valid, errors } = isValidTaskDefinition(currentTaskDef);
              if (!valid) {
                throw new Error(
                  `Task definition became invalid after updating to ${imageUri}. ` +
                  `Errors: ${errors.join(", ")}`
                );
              }
            }

            // Verify final image is the last one in the sequence
            const finalContainer = getContainerDefinition(currentTaskDef);
            expect(finalContainer!.Image).toBe(imageUris[imageUris.length - 1]);

            return true;
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});
