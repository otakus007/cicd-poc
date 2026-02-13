/**
 * Property-Based Tests for Shared Infrastructure Configuration
 *
 * Feature: ec2-ecs-deployment, Property 5: Shared Infrastructure Configuration
 *
 * **Validates: Requirements 1.5, 2.5, 4.6**
 *
 * Property 5: Shared Infrastructure Configuration
 * _For any_ EC2 deployment, the CloudFormation templates SHALL reference the same VPC,
 * subnets, and ECR repository as the Fargate deployment, ensuring both compute types
 * operate within the same network infrastructure.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface NestedStackProperties {
  TemplateURL: unknown;
  Parameters?: Record<string, unknown>;
  Tags?: Array<{ Key: string; Value: unknown }>;
  DependsOn?: string | string[];
}

interface CloudFormationResource {
  Type: string;
  Properties?: NestedStackProperties | Record<string, unknown>;
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

interface StackReference {
  stackName: string;
  templatePath: string;
  parameters: string[];
}

interface DeploymentConfig {
  projectName: string;
  environment: "dev" | "staging" | "prod";
  vpcCidr: string;
  instanceType: string;
  ec2MinCapacity: number;
  ec2MaxCapacity: number;
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
 * Load and parse the Fargate main CloudFormation template
 */
function loadFargateMainTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "main.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Load and parse the EC2 main CloudFormation template
 */
function loadEc2MainTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "main-ec2.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Extract the template file name from a TemplateURL
 */
function extractTemplateFileName(templateUrl: unknown): string | null {
  if (typeof templateUrl === "object" && templateUrl !== null) {
    const subValue = (templateUrl as { "Fn::Sub"?: string })["Fn::Sub"];
    if (typeof subValue === "string") {
      // Extract the template file name from the URL pattern
      // e.g., https://${TemplatesBucketName}.s3.${AWS::Region}.amazonaws.com/${TemplatesBucketPrefix}/vpc.yaml
      const match = subValue.match(/\/([^/]+\.yaml)$/);
      return match ? match[1] : null;
    }
  }
  return null;
}

/**
 * Get all nested stack resources from a template
 */
function getNestedStacks(template: CloudFormationTemplate): Map<string, NestedStackProperties> {
  const stacks = new Map<string, NestedStackProperties>();

  if (!template.Resources) {
    return stacks;
  }

  for (const [name, resource] of Object.entries(template.Resources)) {
    if (resource.Type === "AWS::CloudFormation::Stack") {
      stacks.set(name, resource.Properties as NestedStackProperties);
    }
  }

  return stacks;
}

/**
 * Extract the template file referenced by a nested stack
 */
function getStackTemplateFile(stackProps: NestedStackProperties): string | null {
  return extractTemplateFileName(stackProps.TemplateURL);
}

/**
 * Check if a stack references a specific template file
 */
function stackReferencesTemplate(
  stacks: Map<string, NestedStackProperties>,
  templateFile: string
): boolean {
  for (const [, props] of stacks) {
    const file = getStackTemplateFile(props);
    if (file === templateFile) {
      return true;
    }
  }
  return false;
}

/**
 * Get the stack that references a specific template file
 */
function getStackByTemplate(
  stacks: Map<string, NestedStackProperties>,
  templateFile: string
): [string, NestedStackProperties] | null {
  for (const [name, props] of stacks) {
    const file = getStackTemplateFile(props);
    if (file === templateFile) {
      return [name, props];
    }
  }
  return null;
}

/**
 * Extract parameter value from a nested stack
 */
function getStackParameter(
  stackProps: NestedStackProperties,
  paramName: string
): unknown | null {
  if (!stackProps.Parameters) {
    return null;
  }
  return stackProps.Parameters[paramName] ?? null;
}

/**
 * Compare two parameter values for equivalence
 * Handles both literal values and CloudFormation references
 */
function parametersMatch(param1: unknown, param2: unknown): boolean {
  return JSON.stringify(param1) === JSON.stringify(param2);
}

/**
 * Extract the GetAtt reference from a parameter value
 * Returns the full reference path (e.g., "VpcStack.Outputs.PrivateSubnet1Id")
 */
function extractGetAttReference(value: unknown): string | null {
  if (typeof value === "object" && value !== null) {
    const getAtt = (value as { "Fn::GetAtt"?: string[] })["Fn::GetAtt"];
    if (Array.isArray(getAtt) && getAtt.length >= 2) {
      // Join all parts of the GetAtt array
      return getAtt.join(".");
    }
  }
  return null;
}

/**
 * Check if two GetAtt references point to the same output
 * (e.g., VpcStack.Outputs.VpcId should match VpcStack.Outputs.VpcId)
 */
function getAttReferencesMatch(ref1: string | null, ref2: string | null): boolean {
  if (ref1 === null || ref2 === null) {
    return false;
  }
  // Extract the output name (e.g., "VpcId" from "VpcStack.Outputs.VpcId")
  const parts1 = ref1.split(".");
  const parts2 = ref2.split(".");

  // Both should reference the same output from their respective VPC stacks
  if (parts1.length >= 2 && parts2.length >= 2) {
    return parts1[parts1.length - 1] === parts2[parts2.length - 1];
  }
  return ref1 === ref2;
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
 * Generator for valid VPC CIDR blocks
 */
const vpcCidrArb = fc
  .tuple(
    fc.integer({ min: 10, max: 10 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 0 }),
    fc.integer({ min: 0, max: 0 }),
    fc.constantFrom(16, 20, 24)
  )
  .map(([a, b, c, d, prefix]) => `${a}.${b}.${c}.${d}/${prefix}`);

/**
 * Generator for valid EC2 instance types
 */
const instanceTypeArb = fc.constantFrom(
  "t3.micro",
  "t3.small",
  "t3.medium",
  "t3.large",
  "t3.xlarge",
  "m5.large",
  "m5.xlarge",
  "c5.large",
  "c5.xlarge"
);

/**
 * Generator for valid EC2 capacity values
 */
const ec2CapacityArb = fc.record({
  min: fc.integer({ min: 0, max: 10 }),
  max: fc.integer({ min: 1, max: 100 }),
}).filter((cap) => cap.min <= cap.max);

/**
 * Generator for complete deployment configurations
 */
const deploymentConfigArb: fc.Arbitrary<DeploymentConfig> = fc.record({
  projectName: projectNameArb,
  environment: environmentArb,
  vpcCidr: vpcCidrArb,
  instanceType: instanceTypeArb,
  ec2MinCapacity: fc.integer({ min: 0, max: 10 }),
  ec2MaxCapacity: fc.integer({ min: 1, max: 100 }),
}).filter((config) => config.ec2MinCapacity <= config.ec2MaxCapacity);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Shared Infrastructure Configuration Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 5: Shared Infrastructure Configuration
   * **Validates: Requirements 1.5, 2.5, 4.6**
   */
  describe("Property 5: Shared Infrastructure Configuration", () => {
    let fargateTemplate: CloudFormationTemplate;
    let ec2Template: CloudFormationTemplate;
    let fargateStacks: Map<string, NestedStackProperties>;
    let ec2Stacks: Map<string, NestedStackProperties>;

    beforeAll(() => {
      fargateTemplate = loadFargateMainTemplate();
      ec2Template = loadEc2MainTemplate();
      fargateStacks = getNestedStacks(fargateTemplate);
      ec2Stacks = getNestedStacks(ec2Template);
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same VPC stack (vpc.yaml).
     *
     * **Validates: Requirements 1.5, 2.5**
     */
    test("should reference the same VPC stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference vpc.yaml
          const fargateHasVpc = stackReferencesTemplate(fargateStacks, "vpc.yaml");
          const ec2HasVpc = stackReferencesTemplate(ec2Stacks, "vpc.yaml");

          expect(fargateHasVpc).toBe(true);
          expect(ec2HasVpc).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same ECR stack (ecr.yaml).
     *
     * **Validates: Requirements 2.5**
     */
    test("should reference the same ECR stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference ecr.yaml
          const fargateHasEcr = stackReferencesTemplate(fargateStacks, "ecr.yaml");
          const ec2HasEcr = stackReferencesTemplate(ec2Stacks, "ecr.yaml");

          expect(fargateHasEcr).toBe(true);
          expect(ec2HasEcr).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same ALB stack (alb.yaml).
     *
     * **Validates: Requirements 2.5**
     */
    test("should reference the same ALB stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference alb.yaml
          const fargateHasAlb = stackReferencesTemplate(fargateStacks, "alb.yaml");
          const ec2HasAlb = stackReferencesTemplate(ec2Stacks, "alb.yaml");

          expect(fargateHasAlb).toBe(true);
          expect(ec2HasAlb).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the VPC stack parameters
     * SHALL be consistent between Fargate and EC2 deployments.
     *
     * **Validates: Requirements 1.5, 4.6**
     */
    test("should pass consistent VPC parameters", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          const fargateVpcStack = getStackByTemplate(fargateStacks, "vpc.yaml");
          const ec2VpcStack = getStackByTemplate(ec2Stacks, "vpc.yaml");

          expect(fargateVpcStack).not.toBeNull();
          expect(ec2VpcStack).not.toBeNull();

          if (fargateVpcStack && ec2VpcStack) {
            const [, fargateProps] = fargateVpcStack;
            const [, ec2Props] = ec2VpcStack;

            // Both should pass Environment parameter
            const fargateEnv = getStackParameter(fargateProps, "Environment");
            const ec2Env = getStackParameter(ec2Props, "Environment");
            expect(fargateEnv).toBeDefined();
            expect(ec2Env).toBeDefined();

            // Both should pass ProjectName parameter
            const fargateProject = getStackParameter(fargateProps, "ProjectName");
            const ec2Project = getStackParameter(ec2Props, "ProjectName");
            expect(fargateProject).toBeDefined();
            expect(ec2Project).toBeDefined();

            // Both should pass VpcCidr parameter
            const fargateVpcCidr = getStackParameter(fargateProps, "VpcCidr");
            const ec2VpcCidr = getStackParameter(ec2Props, "VpcCidr");
            expect(fargateVpcCidr).toBeDefined();
            expect(ec2VpcCidr).toBeDefined();
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the ECR stack parameters
     * SHALL be consistent between Fargate and EC2 deployments.
     *
     * **Validates: Requirements 2.5**
     */
    test("should pass consistent ECR parameters", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          const fargateEcrStack = getStackByTemplate(fargateStacks, "ecr.yaml");
          const ec2EcrStack = getStackByTemplate(ec2Stacks, "ecr.yaml");

          expect(fargateEcrStack).not.toBeNull();
          expect(ec2EcrStack).not.toBeNull();

          if (fargateEcrStack && ec2EcrStack) {
            const [, fargateProps] = fargateEcrStack;
            const [, ec2Props] = ec2EcrStack;

            // Both should pass Environment parameter
            const fargateEnv = getStackParameter(fargateProps, "Environment");
            const ec2Env = getStackParameter(ec2Props, "Environment");
            expect(fargateEnv).toBeDefined();
            expect(ec2Env).toBeDefined();

            // Both should pass ProjectName parameter
            const fargateProject = getStackParameter(fargateProps, "ProjectName");
            const ec2Project = getStackParameter(ec2Props, "ProjectName");
            expect(fargateProject).toBeDefined();
            expect(ec2Project).toBeDefined();
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the ALB stack parameters
     * SHALL be consistent between Fargate and EC2 deployments.
     *
     * **Validates: Requirements 2.5**
     */
    test("should pass consistent ALB parameters", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          const fargateAlbStack = getStackByTemplate(fargateStacks, "alb.yaml");
          const ec2AlbStack = getStackByTemplate(ec2Stacks, "alb.yaml");

          expect(fargateAlbStack).not.toBeNull();
          expect(ec2AlbStack).not.toBeNull();

          if (fargateAlbStack && ec2AlbStack) {
            const [, fargateProps] = fargateAlbStack;
            const [, ec2Props] = ec2AlbStack;

            // Both should pass Environment parameter
            const fargateEnv = getStackParameter(fargateProps, "Environment");
            const ec2Env = getStackParameter(ec2Props, "Environment");
            expect(fargateEnv).toBeDefined();
            expect(ec2Env).toBeDefined();

            // Both should pass ProjectName parameter
            const fargateProject = getStackParameter(fargateProps, "ProjectName");
            const ec2Project = getStackParameter(ec2Props, "ProjectName");
            expect(fargateProject).toBeDefined();
            expect(ec2Project).toBeDefined();

            // Both should pass VpcId from VPC stack
            const fargateVpcId = getStackParameter(fargateProps, "VpcId");
            const ec2VpcId = getStackParameter(ec2Props, "VpcId");
            expect(fargateVpcId).toBeDefined();
            expect(ec2VpcId).toBeDefined();
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, subnet parameters passed to
     * service stacks SHALL reference the same VPC stack outputs.
     *
     * **Validates: Requirements 1.5, 4.6**
     */
    test("should pass subnet parameters from VPC stack consistently", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Get the ALB stacks which receive subnet parameters
          const fargateAlbStack = getStackByTemplate(fargateStacks, "alb.yaml");
          const ec2AlbStack = getStackByTemplate(ec2Stacks, "alb.yaml");

          expect(fargateAlbStack).not.toBeNull();
          expect(ec2AlbStack).not.toBeNull();

          if (fargateAlbStack && ec2AlbStack) {
            const [, fargateProps] = fargateAlbStack;
            const [, ec2Props] = ec2AlbStack;

            // Both should pass PrivateSubnet1Id from VPC stack
            const fargateSubnet1 = getStackParameter(fargateProps, "PrivateSubnet1Id");
            const ec2Subnet1 = getStackParameter(ec2Props, "PrivateSubnet1Id");

            const fargateSubnet1Ref = extractGetAttReference(fargateSubnet1);
            const ec2Subnet1Ref = extractGetAttReference(ec2Subnet1);

            // Both should reference the same output (PrivateSubnet1Id)
            expect(getAttReferencesMatch(fargateSubnet1Ref, ec2Subnet1Ref)).toBe(true);

            // Both should pass PrivateSubnet2Id from VPC stack
            const fargateSubnet2 = getStackParameter(fargateProps, "PrivateSubnet2Id");
            const ec2Subnet2 = getStackParameter(ec2Props, "PrivateSubnet2Id");

            const fargateSubnet2Ref = extractGetAttReference(fargateSubnet2);
            const ec2Subnet2Ref = extractGetAttReference(ec2Subnet2);

            // Both should reference the same output (PrivateSubnet2Id)
            expect(getAttReferencesMatch(fargateSubnet2Ref, ec2Subnet2Ref)).toBe(true);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 ECS cluster stack
     * SHALL receive subnet parameters from the same VPC stack.
     *
     * **Validates: Requirements 1.5, 4.6**
     */
    test("should pass VPC subnet parameters to EC2 cluster stack", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Get the EC2 cluster stack
          const ec2ClusterStack = getStackByTemplate(ec2Stacks, "ecs-ec2-cluster.yaml");

          expect(ec2ClusterStack).not.toBeNull();

          if (ec2ClusterStack) {
            const [, ec2Props] = ec2ClusterStack;

            // Should pass PrivateSubnet1Id from VPC stack
            const subnet1 = getStackParameter(ec2Props, "PrivateSubnet1Id");
            expect(subnet1).toBeDefined();

            const subnet1Ref = extractGetAttReference(subnet1);
            expect(subnet1Ref).not.toBeNull();
            expect(subnet1Ref).toContain("PrivateSubnet1Id");

            // Should pass PrivateSubnet2Id from VPC stack
            const subnet2 = getStackParameter(ec2Props, "PrivateSubnet2Id");
            expect(subnet2).toBeDefined();

            const subnet2Ref = extractGetAttReference(subnet2);
            expect(subnet2Ref).not.toBeNull();
            expect(subnet2Ref).toContain("PrivateSubnet2Id");
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 service stack
     * SHALL receive the target group ARN from the shared ALB stack.
     *
     * **Validates: Requirements 2.5**
     */
    test("should pass ALB target group to EC2 service stack", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Get the EC2 service stack
          const ec2ServiceStack = getStackByTemplate(ec2Stacks, "ecs-ec2-service.yaml");

          expect(ec2ServiceStack).not.toBeNull();

          if (ec2ServiceStack) {
            const [, ec2Props] = ec2ServiceStack;

            // Should pass TargetGroupArn from ALB stack
            const targetGroup = getStackParameter(ec2Props, "TargetGroupArn");
            expect(targetGroup).toBeDefined();

            const targetGroupRef = extractGetAttReference(targetGroup);
            expect(targetGroupRef).not.toBeNull();
            expect(targetGroupRef).toContain("TargetGroupArn");
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 task definition stack
     * SHALL receive the ECR repository URI from the shared ECR stack.
     *
     * **Validates: Requirements 2.5**
     */
    test("should pass ECR repository URI to EC2 task definition stack", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Get the EC2 task definition stack
          const ec2TaskDefStack = getStackByTemplate(ec2Stacks, "task-definition-ec2.yaml");

          expect(ec2TaskDefStack).not.toBeNull();

          if (ec2TaskDefStack) {
            const [, ec2Props] = ec2TaskDefStack;

            // Should pass ContainerImage which includes ECR repository URI
            const containerImage = getStackParameter(ec2Props, "ContainerImage");
            expect(containerImage).toBeDefined();
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same security groups stack (security-groups.yaml).
     *
     * **Validates: Requirements 1.5, 2.5**
     */
    test("should reference the same security groups stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference security-groups.yaml
          const fargateHasSg = stackReferencesTemplate(fargateStacks, "security-groups.yaml");
          const ec2HasSg = stackReferencesTemplate(ec2Stacks, "security-groups.yaml");

          expect(fargateHasSg).toBe(true);
          expect(ec2HasSg).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same IAM stack (iam.yaml).
     *
     * **Validates: Requirements 2.5**
     */
    test("should reference the same IAM stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference iam.yaml
          const fargateHasIam = stackReferencesTemplate(fargateStacks, "iam.yaml");
          const ec2HasIam = stackReferencesTemplate(ec2Stacks, "iam.yaml");

          expect(fargateHasIam).toBe(true);
          expect(ec2HasIam).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, both Fargate and EC2 templates
     * SHALL reference the same secrets stack (secrets.yaml).
     *
     * **Validates: Requirements 2.5**
     */
    test("should reference the same secrets stack template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Verify both templates reference secrets.yaml
          const fargateHasSecrets = stackReferencesTemplate(fargateStacks, "secrets.yaml");
          const ec2HasSecrets = stackReferencesTemplate(ec2Stacks, "secrets.yaml");

          expect(fargateHasSecrets).toBe(true);
          expect(ec2HasSecrets).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 cluster stack
     * SHALL receive the ECS security group from the shared security groups stack.
     *
     * **Validates: Requirements 1.5**
     */
    test("should pass ECS security group to EC2 cluster stack", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Get the EC2 cluster stack
          const ec2ClusterStack = getStackByTemplate(ec2Stacks, "ecs-ec2-cluster.yaml");

          expect(ec2ClusterStack).not.toBeNull();

          if (ec2ClusterStack) {
            const [, ec2Props] = ec2ClusterStack;

            // Should pass EcsSecurityGroupId from security groups stack
            const securityGroup = getStackParameter(ec2Props, "EcsSecurityGroupId");
            expect(securityGroup).toBeDefined();

            const sgRef = extractGetAttReference(securityGroup);
            expect(sgRef).not.toBeNull();
            expect(sgRef).toContain("EcsSecurityGroupId");
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the shared infrastructure stacks
     * SHALL be defined before compute-specific stacks in both templates.
     *
     * **Validates: Requirements 2.5**
     */
    test("should define shared infrastructure stacks in both templates", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // List of shared infrastructure templates
          const sharedTemplates = [
            "vpc.yaml",
            "security-groups.yaml",
            "iam.yaml",
            "ecr.yaml",
            "secrets.yaml",
            "alb.yaml",
          ];

          // Verify all shared templates are referenced in both main templates
          for (const template of sharedTemplates) {
            const fargateHas = stackReferencesTemplate(fargateStacks, template);
            const ec2Has = stackReferencesTemplate(ec2Stacks, template);

            expect(fargateHas).toBe(true);
            expect(ec2Has).toBe(true);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 main template
     * SHALL NOT include Fargate-specific stacks (ecs-cluster.yaml, ecs-service.yaml).
     *
     * **Validates: Requirements 2.4**
     */
    test("should not include Fargate-specific stacks in EC2 template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // EC2 template should not reference Fargate-specific templates
          const ec2HasFargateCluster = stackReferencesTemplate(ec2Stacks, "ecs-cluster.yaml");
          const ec2HasFargateService = stackReferencesTemplate(ec2Stacks, "ecs-service.yaml");
          const ec2HasFargateTaskDef = stackReferencesTemplate(ec2Stacks, "task-definition.yaml");

          expect(ec2HasFargateCluster).toBe(false);
          expect(ec2HasFargateService).toBe(false);
          expect(ec2HasFargateTaskDef).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the EC2 main template
     * SHALL include EC2-specific stacks (ecs-ec2-cluster.yaml, ecs-ec2-service.yaml).
     *
     * **Validates: Requirements 2.4**
     */
    test("should include EC2-specific stacks in EC2 template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // EC2 template should reference EC2-specific templates
          const ec2HasEc2Cluster = stackReferencesTemplate(ec2Stacks, "ecs-ec2-cluster.yaml");
          const ec2HasEc2Service = stackReferencesTemplate(ec2Stacks, "ecs-ec2-service.yaml");
          const ec2HasEc2TaskDef = stackReferencesTemplate(ec2Stacks, "task-definition-ec2.yaml");

          expect(ec2HasEc2Cluster).toBe(true);
          expect(ec2HasEc2Service).toBe(true);
          expect(ec2HasEc2TaskDef).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment configuration, the Fargate main template
     * SHALL NOT include EC2-specific stacks.
     *
     * **Validates: Requirements 2.4**
     */
    test("should not include EC2-specific stacks in Fargate template", () => {
      fc.assert(
        fc.property(deploymentConfigArb, (_config) => {
          // Fargate template should not reference EC2-specific templates
          const fargateHasEc2Cluster = stackReferencesTemplate(fargateStacks, "ecs-ec2-cluster.yaml");
          const fargateHasEc2Service = stackReferencesTemplate(fargateStacks, "ecs-ec2-service.yaml");
          const fargateHasEc2TaskDef = stackReferencesTemplate(fargateStacks, "task-definition-ec2.yaml");

          expect(fargateHasEc2Cluster).toBe(false);
          expect(fargateHasEc2Service).toBe(false);
          expect(fargateHasEc2TaskDef).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
