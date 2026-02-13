/**
 * Property-Based Tests for User Data Cluster Configuration
 *
 * Feature: ec2-ecs-deployment, Property 6: User Data Cluster Configuration
 *
 * **Validates: Requirements 5.1**
 *
 * Property 6: User Data Cluster Configuration
 * _For any_ EC2 instance launched by the Auto Scaling Group, the user data script
 * SHALL configure the ECS agent with the correct cluster name, ensuring the instance
 * registers with the intended ECS cluster.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface LaunchTemplateData {
  ImageId?: unknown;
  InstanceType?: unknown;
  UserData?: { "Fn::Base64": { "Fn::Sub": string } | string } | unknown;
  IamInstanceProfile?: unknown;
  SecurityGroupIds?: unknown[];
  Monitoring?: { Enabled: boolean };
  EbsOptimized?: boolean;
  BlockDeviceMappings?: unknown[];
  TagSpecifications?: unknown[];
}

interface LaunchTemplateProperties {
  LaunchTemplateName?: unknown;
  LaunchTemplateData?: LaunchTemplateData;
}

interface EcsClusterProperties {
  ClusterName?: unknown;
  ClusterSettings?: Array<{ Name: string; Value: unknown }>;
  ServiceConnectDefaults?: unknown;
  Tags?: Array<{ Key: string; Value: unknown }>;
}

interface CloudFormationResource {
  Type: string;
  Properties?: LaunchTemplateProperties | EcsClusterProperties | Record<string, unknown>;
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

interface ClusterConfig {
  projectName: string;
  environment: "dev" | "staging" | "prod";
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
 * Load and parse the EC2 ECS cluster CloudFormation template
 */
function loadTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "ecs-ec2-cluster.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Get the Launch Template resource from the template
 */
function getLaunchTemplate(template: CloudFormationTemplate): LaunchTemplateProperties | null {
  const launchTemplate = template.Resources?.LaunchTemplate;
  if (!launchTemplate || launchTemplate.Type !== "AWS::EC2::LaunchTemplate") {
    return null;
  }
  return launchTemplate.Properties as LaunchTemplateProperties;
}

/**
 * Get the ECS Cluster resource from the template
 */
function getEcsCluster(template: CloudFormationTemplate): EcsClusterProperties | null {
  const ecsCluster = template.Resources?.EcsEc2Cluster;
  if (!ecsCluster || ecsCluster.Type !== "AWS::ECS::Cluster") {
    return null;
  }
  return ecsCluster.Properties as EcsClusterProperties;
}

/**
 * Extract the user data script content from the Launch Template
 */
function extractUserDataScript(launchTemplate: LaunchTemplateProperties): string | null {
  const userData = launchTemplate.LaunchTemplateData?.UserData;
  if (!userData) {
    return null;
  }

  // UserData is typically wrapped in Fn::Base64 with Fn::Sub
  if (typeof userData === "object" && userData !== null) {
    const base64Content = (userData as { "Fn::Base64"?: unknown })["Fn::Base64"];
    if (typeof base64Content === "object" && base64Content !== null) {
      const subContent = (base64Content as { "Fn::Sub"?: string })["Fn::Sub"];
      if (typeof subContent === "string") {
        return subContent;
      }
    }
    if (typeof base64Content === "string") {
      return base64Content;
    }
  }

  return null;
}

/**
 * Extract the cluster name pattern from the ECS Cluster resource
 */
function extractClusterNamePattern(ecsCluster: EcsClusterProperties): string | null {
  const clusterName = ecsCluster.ClusterName;
  if (!clusterName) {
    return null;
  }

  if (typeof clusterName === "object" && clusterName !== null) {
    const subValue = (clusterName as { "Fn::Sub"?: string })["Fn::Sub"];
    if (typeof subValue === "string") {
      return subValue;
    }
  }

  if (typeof clusterName === "string") {
    return clusterName;
  }

  return null;
}

/**
 * Simulate parameter substitution for cluster name
 */
function substituteClusterName(pattern: string, config: ClusterConfig): string {
  return pattern
    .replace(/\$\{ProjectName\}/g, config.projectName)
    .replace(/\$\{Environment\}/g, config.environment);
}

/**
 * Check if user data script contains ECS_CLUSTER configuration
 */
function hasEcsClusterConfig(userDataScript: string): boolean {
  return userDataScript.includes("ECS_CLUSTER=");
}

/**
 * Check if user data script references the ECS cluster correctly
 * The user data should reference ${EcsEc2Cluster} which CloudFormation resolves
 */
function hasCorrectClusterReference(userDataScript: string): boolean {
  // The user data script should contain a reference to the ECS cluster
  // This can be either ${EcsEc2Cluster} (CloudFormation Ref) or the cluster name pattern
  return (
    userDataScript.includes("${EcsEc2Cluster}") ||
    userDataScript.includes("ECS_CLUSTER=${ProjectName}-${Environment}")
  );
}

/**
 * Check if user data script writes to the correct ECS config file
 */
function writesToEcsConfigFile(userDataScript: string): boolean {
  return userDataScript.includes("/etc/ecs/ecs.config");
}

/**
 * Check if user data script enables container metadata
 */
function hasContainerMetadataConfig(userDataScript: string): boolean {
  return userDataScript.includes("ECS_ENABLE_CONTAINER_METADATA=true");
}

/**
 * Check if user data script enables spot instance draining
 */
function hasSpotInstanceDrainingConfig(userDataScript: string): boolean {
  return userDataScript.includes("ECS_ENABLE_SPOT_INSTANCE_DRAINING=true");
}

/**
 * Validate that the user data script is a valid bash script
 */
function isValidBashScript(userDataScript: string): boolean {
  // Should start with shebang
  return userDataScript.trim().startsWith("#!/bin/bash");
}

/**
 * Simulate the resolved cluster name for a given configuration
 * This mimics what CloudFormation does when it resolves ${EcsEc2Cluster}
 */
function resolveClusterName(config: ClusterConfig): string {
  return `${config.projectName}-${config.environment}-ec2-cluster`;
}

/**
 * Simulate the resolved user data script with parameter substitution
 */
function resolveUserDataScript(userDataScript: string, config: ClusterConfig): string {
  const clusterName = resolveClusterName(config);
  return userDataScript
    .replace(/\$\{EcsEc2Cluster\}/g, clusterName)
    .replace(/\$\{ProjectName\}/g, config.projectName)
    .replace(/\$\{Environment\}/g, config.environment);
}

/**
 * Extract the ECS_CLUSTER value from a resolved user data script
 * Handles both quoted and unquoted values in echo statements
 */
function extractEcsClusterValue(resolvedScript: string): string | null {
  // First try to match quoted value: echo "ECS_CLUSTER=value"
  const quotedMatch = resolvedScript.match(/echo\s+"ECS_CLUSTER=([^"]+)"/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Try to match unquoted value: ECS_CLUSTER=value
  const unquotedMatch = resolvedScript.match(/ECS_CLUSTER=([^\s\n"]+)/);
  return unquotedMatch ? unquotedMatch[1] : null;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid environment values
 */
const environmentArb = fc.constantFrom(
  "dev",
  "staging",
  "prod"
) as fc.Arbitrary<"dev" | "staging" | "prod">;

/**
 * Generator for valid project names following the CloudFormation parameter pattern
 * Pattern: ^[a-z0-9][a-z0-9-]*[a-z0-9]$ with length 3-32
 */
const projectNameArb = fc
  .tuple(
    fc.stringOf(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
      { minLength: 1, maxLength: 1 }
    ),
    fc.stringOf(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
      { minLength: 0, maxLength: 28 }
    ),
    fc.stringOf(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
      { minLength: 1, maxLength: 1 }
    )
  )
  .map(([first, middle, last]) => `${first}${middle}${last}`)
  .filter(
    (name) => name.length >= 3 && name.length <= 32 && !name.includes("--")
  );

/**
 * Generator for complete cluster configurations
 */
const clusterConfigArb: fc.Arbitrary<ClusterConfig> = fc.record({
  projectName: projectNameArb,
  environment: environmentArb,
});

/**
 * Generator for cluster names that follow the expected naming pattern
 * Pattern: {projectName}-{environment}-ec2-cluster
 */
const clusterNameArb = clusterConfigArb.map(
  (config) => `${config.projectName}-${config.environment}-ec2-cluster`
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("User Data Cluster Configuration Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 6: User Data Cluster Configuration
   * **Validates: Requirements 5.1**
   */
  describe("Property 6: User Data Cluster Configuration", () => {
    let template: CloudFormationTemplate;
    let launchTemplate: LaunchTemplateProperties;
    let ecsCluster: EcsClusterProperties;
    let userDataScript: string;

    beforeAll(() => {
      template = loadTemplate();

      const lt = getLaunchTemplate(template);
      if (!lt) {
        throw new Error("Launch Template not found in template");
      }
      launchTemplate = lt;

      const cluster = getEcsCluster(template);
      if (!cluster) {
        throw new Error("ECS Cluster not found in template");
      }
      ecsCluster = cluster;

      const userData = extractUserDataScript(launchTemplate);
      if (!userData) {
        throw new Error("User data script not found in Launch Template");
      }
      userDataScript = userData;
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * configure the ECS agent with the correct cluster name.
     *
     * **Validates: Requirements 5.1**
     */
    test("should configure ECS agent with correct cluster name for any configuration", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script with the given configuration
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Extract the ECS_CLUSTER value from the resolved script
          const ecsClusterValue = extractEcsClusterValue(resolvedScript);

          // Verify the cluster value is set
          expect(ecsClusterValue).not.toBeNull();

          // Verify the cluster name matches the expected pattern
          const expectedClusterName = resolveClusterName(config);
          expect(ecsClusterValue).toBe(expectedClusterName);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster name, the user data script SHALL write
     * the ECS_CLUSTER configuration to /etc/ecs/ecs.config.
     *
     * **Validates: Requirements 5.1**
     */
    test("should write ECS_CLUSTER to correct config file for any cluster name", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Verify the script writes to the correct config file
          expect(writesToEcsConfigFile(resolvedScript)).toBe(true);

          // Verify the ECS_CLUSTER line is written to the config file
          expect(resolvedScript).toMatch(
            /echo\s+"?ECS_CLUSTER=[^"]*"?\s*>>\s*\/etc\/ecs\/ecs\.config/
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * be a valid bash script that can be executed on EC2 instances.
     *
     * **Validates: Requirements 5.1**
     */
    test("should produce valid bash script for any cluster configuration", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Verify it's a valid bash script
          expect(isValidBashScript(resolvedScript)).toBe(true);

          // Verify the script doesn't have unresolved CloudFormation references
          // (except for AWS pseudo-parameters which are resolved at runtime)
          expect(resolvedScript).not.toMatch(/\$\{[A-Z][a-zA-Z0-9]*\}/);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the cluster name in user data
     * SHALL match the ECS cluster resource name pattern.
     *
     * **Validates: Requirements 5.1**
     */
    test("should have matching cluster names between user data and ECS cluster resource", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Get the cluster name pattern from the ECS cluster resource
          const clusterNamePattern = extractClusterNamePattern(ecsCluster);
          expect(clusterNamePattern).not.toBeNull();

          // Resolve both the cluster name and user data
          const resolvedClusterName = substituteClusterName(clusterNamePattern!, config);
          const resolvedScript = resolveUserDataScript(userDataScript, config);
          const userDataClusterName = extractEcsClusterValue(resolvedScript);

          // Verify they match
          expect(userDataClusterName).toBe(resolvedClusterName);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * enable container metadata for enhanced monitoring.
     *
     * **Validates: Requirements 5.1**
     */
    test("should enable container metadata for any cluster configuration", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Verify container metadata is enabled
          expect(hasContainerMetadataConfig(resolvedScript)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * enable spot instance draining for graceful shutdown.
     *
     * **Validates: Requirements 5.1**
     */
    test("should enable spot instance draining for any cluster configuration", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Verify spot instance draining is enabled
          expect(hasSpotInstanceDrainingConfig(resolvedScript)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid project name and environment combination, the resolved
     * cluster name SHALL follow the naming convention {projectName}-{environment}-ec2-cluster.
     *
     * **Validates: Requirements 5.1**
     */
    test("should follow cluster naming convention for any project/environment combination", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);
          const userDataClusterName = extractEcsClusterValue(resolvedScript);

          // Verify the cluster name follows the expected pattern
          const expectedPattern = new RegExp(
            `^${config.projectName}-${config.environment}-ec2-cluster$`
          );
          expect(userDataClusterName).toMatch(expectedPattern);

          // Verify the cluster name contains all required components
          expect(userDataClusterName).toContain(config.projectName);
          expect(userDataClusterName).toContain(config.environment);
          expect(userDataClusterName).toContain("ec2-cluster");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * have the ECS_CLUSTER configuration as the first ECS agent setting.
     *
     * **Validates: Requirements 5.1**
     */
    test("should set ECS_CLUSTER as first ECS agent configuration", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Find all ECS config lines
          const ecsConfigLines = resolvedScript
            .split("\n")
            .filter((line) => line.includes("/etc/ecs/ecs.config"));

          // Verify ECS_CLUSTER is set before other ECS configurations
          const clusterLineIndex = ecsConfigLines.findIndex((line) =>
            line.includes("ECS_CLUSTER=")
          );
          expect(clusterLineIndex).toBe(0);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the Launch Template SHALL
     * reference the ECS cluster using CloudFormation intrinsic functions.
     *
     * **Validates: Requirements 5.1**
     */
    test("should reference ECS cluster using CloudFormation intrinsic functions", () => {
      fc.assert(
        fc.property(clusterConfigArb, (_config) => {
          // Verify the raw user data script contains a reference to the ECS cluster
          expect(hasCorrectClusterReference(userDataScript)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid cluster configuration, the user data script SHALL
     * not contain any syntax errors that would prevent ECS agent configuration.
     *
     * **Validates: Requirements 5.1**
     */
    test("should not contain syntax errors in ECS configuration for any cluster", () => {
      fc.assert(
        fc.property(clusterConfigArb, (config) => {
          // Resolve the user data script
          const resolvedScript = resolveUserDataScript(userDataScript, config);

          // Verify no unclosed quotes in ECS config lines
          const ecsConfigLines = resolvedScript
            .split("\n")
            .filter((line) => line.includes("ECS_"));

          for (const line of ecsConfigLines) {
            // Count quotes - should be even
            const quoteCount = (line.match(/"/g) || []).length;
            expect(quoteCount % 2).toBe(0);

            // Verify proper echo syntax
            if (line.includes("echo")) {
              expect(line).toMatch(/echo\s+["']?[^"']*["']?\s*>>/);
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
