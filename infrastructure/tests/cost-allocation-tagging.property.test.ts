/**
 * Property-Based Tests for Cost Allocation Tagging Consistency
 *
 * Feature: ec2-ecs-deployment, Property 1: Cost Allocation Tagging Consistency
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * Property 1: Cost Allocation Tagging Consistency
 * _For any_ CloudFormation template in the EC2 deployment, all billable resources
 * (EC2 instances, ECS services, Auto Scaling Groups, EBS volumes) SHALL include a
 * tag with key "ComputeType" and value matching the deployment type ("ec2" for EC2
 * deployments, "fargate" for Fargate deployments).
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface Tag {
  Key: string;
  Value: unknown;
  PropagateAtLaunch?: boolean;
}

interface TagSpecification {
  ResourceType: string;
  Tags: Tag[];
}

interface ResourceProperties {
  Tags?: Tag[];
  TagSpecifications?: TagSpecification[];
  [key: string]: unknown;
}

interface CloudFormationResource {
  Type: string;
  Properties?: ResourceProperties;
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


type DeploymentType = "fargate" | "ec2";

interface TemplateInfo {
  name: string;
  path: string;
  deploymentType: DeploymentType;
}

interface BillableResourceInfo {
  resourceName: string;
  resourceType: string;
  hasComputeTypeTag: boolean;
  computeTypeValue: string | null;
  templateName: string;
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

/**
 * Billable resource types that must have ComputeType tags
 * Requirement 3.3: THE Cost_Allocation_Tag SHALL be applied to all billable resources
 */
const BILLABLE_RESOURCE_TYPES = [
  "AWS::ECS::Cluster",
  "AWS::ECS::Service",
  "AWS::ECS::TaskDefinition",
  "AWS::Logs::LogGroup",
  "AWS::AutoScaling::AutoScalingGroup",
  "AWS::EC2::LaunchTemplate",
];

/**
 * Fargate-specific templates
 * Requirement 3.2: THE Fargate deployment resources SHALL include ComputeType=fargate
 */
const FARGATE_TEMPLATES: TemplateInfo[] = [
  { name: "ecs-cluster.yaml", path: "ecs-cluster.yaml", deploymentType: "fargate" },
  { name: "ecs-service.yaml", path: "ecs-service.yaml", deploymentType: "fargate" },
  { name: "task-definition.yaml", path: "task-definition.yaml", deploymentType: "fargate" },
  { name: "main.yaml", path: "main.yaml", deploymentType: "fargate" },
];

/**
 * EC2-specific templates
 * Requirement 3.1: THE EC2 deployment resources SHALL include ComputeType=ec2
 */
const EC2_TEMPLATES: TemplateInfo[] = [
  { name: "ecs-ec2-cluster.yaml", path: "ecs-ec2-cluster.yaml", deploymentType: "ec2" },
  { name: "ecs-ec2-service.yaml", path: "ecs-ec2-service.yaml", deploymentType: "ec2" },
  { name: "task-definition-ec2.yaml", path: "task-definition-ec2.yaml", deploymentType: "ec2" },
  { name: "main-ec2.yaml", path: "main-ec2.yaml", deploymentType: "ec2" },
];

/**
 * All templates to verify
 */
const ALL_TEMPLATES: TemplateInfo[] = [...FARGATE_TEMPLATES, ...EC2_TEMPLATES];


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse a CloudFormation template
 */
function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Check if a resource type is a billable resource
 */
function isBillableResource(resourceType: string): boolean {
  return BILLABLE_RESOURCE_TYPES.includes(resourceType);
}

/**
 * Extract the ComputeType tag value from a Tags array
 */
function extractComputeTypeFromTags(tags: Tag[] | undefined): string | null {
  if (!tags || !Array.isArray(tags)) {
    return null;
  }

  const computeTypeTag = tags.find((tag) => tag.Key === "ComputeType");
  if (!computeTypeTag) {
    return null;
  }

  const value = computeTypeTag.Value;
  if (typeof value === "string") {
    return value;
  }

  // Handle CloudFormation references like { Ref: "ComputeType" }
  if (typeof value === "object" && value !== null) {
    const refValue = (value as { Ref?: string }).Ref;
    if (refValue === "ComputeType") {
      // This is a parameter reference, which is valid
      return "parameter-reference";
    }
  }

  return null;
}


/**
 * Extract ComputeType tag from TagSpecifications (used by EC2 Launch Template)
 */
function extractComputeTypeFromTagSpecifications(
  tagSpecs: TagSpecification[] | undefined
): string | null {
  if (!tagSpecs || !Array.isArray(tagSpecs)) {
    return null;
  }

  for (const spec of tagSpecs) {
    const computeType = extractComputeTypeFromTags(spec.Tags);
    if (computeType) {
      return computeType;
    }
  }

  return null;
}

/**
 * Extract ComputeType tag from LaunchTemplateData (nested structure in Launch Template)
 */
function extractComputeTypeFromLaunchTemplateData(
  launchTemplateData: Record<string, unknown> | undefined
): string | null {
  if (!launchTemplateData) {
    return null;
  }

  // Check TagSpecifications inside LaunchTemplateData
  const tagSpecs = launchTemplateData.TagSpecifications as TagSpecification[] | undefined;
  if (tagSpecs) {
    const computeType = extractComputeTypeFromTagSpecifications(tagSpecs);
    if (computeType) {
      return computeType;
    }
  }

  return null;
}

/**
 * Check if a resource has a ComputeType tag
 */
function hasComputeTypeTag(resource: CloudFormationResource): boolean {
  const props = resource.Properties;
  if (!props) {
    return false;
  }

  // Check Tags array
  if (props.Tags) {
    const computeType = extractComputeTypeFromTags(props.Tags);
    if (computeType) {
      return true;
    }
  }

  // Check TagSpecifications (for EC2 Launch Template at Properties level)
  if (props.TagSpecifications) {
    const computeType = extractComputeTypeFromTagSpecifications(
      props.TagSpecifications as TagSpecification[]
    );
    if (computeType) {
      return true;
    }
  }

  // Check LaunchTemplateData.TagSpecifications (for EC2 Launch Template nested structure)
  if (props.LaunchTemplateData) {
    const computeType = extractComputeTypeFromLaunchTemplateData(
      props.LaunchTemplateData as Record<string, unknown>
    );
    if (computeType) {
      return true;
    }
  }

  return false;
}


/**
 * Get the ComputeType tag value from a resource
 */
function getComputeTypeValue(resource: CloudFormationResource): string | null {
  const props = resource.Properties;
  if (!props) {
    return null;
  }

  // Check Tags array
  if (props.Tags) {
    const computeType = extractComputeTypeFromTags(props.Tags);
    if (computeType) {
      return computeType;
    }
  }

  // Check TagSpecifications (for EC2 Launch Template at Properties level)
  if (props.TagSpecifications) {
    const computeType = extractComputeTypeFromTagSpecifications(
      props.TagSpecifications as TagSpecification[]
    );
    if (computeType) {
      return computeType;
    }
  }

  // Check LaunchTemplateData.TagSpecifications (for EC2 Launch Template nested structure)
  if (props.LaunchTemplateData) {
    const computeType = extractComputeTypeFromLaunchTemplateData(
      props.LaunchTemplateData as Record<string, unknown>
    );
    if (computeType) {
      return computeType;
    }
  }

  return null;
}

/**
 * Get all billable resources from a template
 */
function getBillableResources(template: CloudFormationTemplate): Map<string, CloudFormationResource> {
  const billableResources = new Map<string, CloudFormationResource>();

  if (!template.Resources) {
    return billableResources;
  }

  for (const [name, resource] of Object.entries(template.Resources)) {
    if (isBillableResource(resource.Type)) {
      billableResources.set(name, resource);
    }
  }

  return billableResources;
}


/**
 * Analyze billable resources in a template for ComputeType tagging
 */
function analyzeBillableResources(
  templateInfo: TemplateInfo
): BillableResourceInfo[] {
  const template = loadTemplate(templateInfo.path);
  const billableResources = getBillableResources(template);
  const results: BillableResourceInfo[] = [];

  for (const [name, resource] of billableResources) {
    const computeTypeValue = getComputeTypeValue(resource);
    results.push({
      resourceName: name,
      resourceType: resource.Type,
      hasComputeTypeTag: hasComputeTypeTag(resource),
      computeTypeValue: computeTypeValue,
      templateName: templateInfo.name,
    });
  }

  return results;
}

/**
 * Check if a ComputeType value matches the expected deployment type
 * Handles both literal values and parameter references
 */
function computeTypeMatchesDeployment(
  computeTypeValue: string | null,
  expectedType: DeploymentType
): boolean {
  if (!computeTypeValue) {
    return false;
  }

  // Direct match
  if (computeTypeValue === expectedType) {
    return true;
  }

  // Parameter reference is valid (the parameter will be set correctly at deployment)
  if (computeTypeValue === "parameter-reference") {
    return true;
  }

  return false;
}


// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid deployment types
 */
const deploymentTypeArb: fc.Arbitrary<DeploymentType> = fc.constantFrom("fargate", "ec2");

/**
 * Generator for Fargate template info
 */
const fargateTemplateArb: fc.Arbitrary<TemplateInfo> = fc.constantFrom(...FARGATE_TEMPLATES);

/**
 * Generator for EC2 template info
 */
const ec2TemplateArb: fc.Arbitrary<TemplateInfo> = fc.constantFrom(...EC2_TEMPLATES);

/**
 * Generator for any template info
 */
const anyTemplateArb: fc.Arbitrary<TemplateInfo> = fc.constantFrom(...ALL_TEMPLATES);

/**
 * Generator for billable resource types
 */
const billableResourceTypeArb: fc.Arbitrary<string> = fc.constantFrom(...BILLABLE_RESOURCE_TYPES);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Cost Allocation Tagging Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 1: Cost Allocation Tagging Consistency
   * **Validates: Requirements 3.1, 3.2, 3.3**
   */
  describe("Property 1: Cost Allocation Tagging Consistency", () => {
    // Cache loaded templates to avoid repeated file I/O
    const templateCache = new Map<string, CloudFormationTemplate>();

    beforeAll(() => {
      // Pre-load all templates
      for (const templateInfo of ALL_TEMPLATES) {
        try {
          const template = loadTemplate(templateInfo.path);
          templateCache.set(templateInfo.name, template);
        } catch (error) {
          // Template may not exist yet, which is fine for testing
          console.warn(`Could not load template ${templateInfo.name}: ${error}`);
        }
      }
    });


    /**
     * Property: For any Fargate CloudFormation template, all billable resources
     * SHALL have a ComputeType tag with value "fargate" or a parameter reference.
     *
     * **Validates: Requirements 3.2**
     */
    test("should have ComputeType tag on all billable resources in Fargate templates", () => {
      fc.assert(
        fc.property(fargateTemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          for (const resource of resources) {
            // Verify the resource has a ComputeType tag
            expect(resource.hasComputeTypeTag).toBe(true);

            // Verify the tag value matches the deployment type
            const matches = computeTypeMatchesDeployment(
              resource.computeTypeValue,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `Resource ${resource.resourceName} in ${resource.templateName} ` +
                `has ComputeType="${resource.computeTypeValue}" but expected "fargate" or parameter reference`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any EC2 CloudFormation template, all billable resources
     * SHALL have a ComputeType tag with value "ec2" or a parameter reference.
     *
     * **Validates: Requirements 3.1**
     */
    test("should have ComputeType tag on all billable resources in EC2 templates", () => {
      fc.assert(
        fc.property(ec2TemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          for (const resource of resources) {
            // Verify the resource has a ComputeType tag
            expect(resource.hasComputeTypeTag).toBe(true);

            // Verify the tag value matches the deployment type
            const matches = computeTypeMatchesDeployment(
              resource.computeTypeValue,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `Resource ${resource.resourceName} in ${resource.templateName} ` +
                `has ComputeType="${resource.computeTypeValue}" but expected "ec2" or parameter reference`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any CloudFormation template (Fargate or EC2), all billable
     * resources SHALL have a ComputeType tag.
     *
     * **Validates: Requirements 3.3**
     */
    test("should have ComputeType tag on all billable resources in any template", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          for (const resource of resources) {
            if (!resource.hasComputeTypeTag) {
              throw new Error(
                `Billable resource ${resource.resourceName} (${resource.resourceType}) ` +
                `in ${resource.templateName} is missing ComputeType tag`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any CloudFormation template, the ComputeType tag value
     * SHALL be consistent across all resources in that template.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    test("should have consistent ComputeType tag value across all resources in a template", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          if (resources.length === 0) {
            return true; // No billable resources to check
          }

          // Get the expected compute type for this template
          const expectedType = templateInfo.deploymentType;

          // Verify all resources have consistent tagging
          for (const resource of resources) {
            const matches = computeTypeMatchesDeployment(
              resource.computeTypeValue,
              expectedType
            );

            if (!matches) {
              throw new Error(
                `Resource ${resource.resourceName} in ${resource.templateName} ` +
                `has inconsistent ComputeType="${resource.computeTypeValue}" ` +
                `(expected "${expectedType}" or parameter reference)`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any billable resource type, if it exists in a template,
     * it SHALL have a ComputeType tag.
     *
     * **Validates: Requirements 3.3**
     */
    test("should tag all instances of billable resource types", () => {
      fc.assert(
        fc.property(
          fc.tuple(anyTemplateArb, billableResourceTypeArb),
          ([templateInfo, resourceType]) => {
            const template = loadTemplate(templateInfo.path);
            const resources = template.Resources || {};

            // Find all resources of this type
            const matchingResources = Object.entries(resources).filter(
              ([, resource]) => resource.Type === resourceType
            );

            // Verify each matching resource has a ComputeType tag
            for (const [name, resource] of matchingResources) {
              if (!hasComputeTypeTag(resource)) {
                throw new Error(
                  `Resource ${name} of type ${resourceType} in ${templateInfo.name} ` +
                  `is missing ComputeType tag`
                );
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For Fargate templates, the ComputeType tag value SHALL be "fargate".
     *
     * **Validates: Requirements 3.2**
     */
    test('should have ComputeType="fargate" for Fargate templates', () => {
      fc.assert(
        fc.property(fargateTemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          for (const resource of resources) {
            // Skip if no ComputeType tag (covered by other tests)
            if (!resource.hasComputeTypeTag) {
              continue;
            }

            // Verify the value is "fargate" or a parameter reference
            const validValues = ["fargate", "parameter-reference"];
            if (!validValues.includes(resource.computeTypeValue || "")) {
              throw new Error(
                `Resource ${resource.resourceName} in ${resource.templateName} ` +
                `has ComputeType="${resource.computeTypeValue}" but expected "fargate"`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For EC2 templates, the ComputeType tag value SHALL be "ec2".
     *
     * **Validates: Requirements 3.1**
     */
    test('should have ComputeType="ec2" for EC2 templates', () => {
      fc.assert(
        fc.property(ec2TemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          for (const resource of resources) {
            // Skip if no ComputeType tag (covered by other tests)
            if (!resource.hasComputeTypeTag) {
              continue;
            }

            // Verify the value is "ec2" or a parameter reference
            const validValues = ["ec2", "parameter-reference"];
            if (!validValues.includes(resource.computeTypeValue || "")) {
              throw new Error(
                `Resource ${resource.resourceName} in ${resource.templateName} ` +
                `has ComputeType="${resource.computeTypeValue}" but expected "ec2"`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment type, the ComputeType tag SHALL be present
     * on ECS Cluster resources.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    test("should have ComputeType tag on all ECS Cluster resources", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all ECS Cluster resources
          const clusterResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::ECS::Cluster"
          );

          for (const [name, resource] of clusterResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `ECS Cluster ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            const matches = computeTypeMatchesDeployment(
              computeType,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `ECS Cluster ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "${templateInfo.deploymentType}")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any deployment type, the ComputeType tag SHALL be present
     * on ECS Service resources.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    test("should have ComputeType tag on all ECS Service resources", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all ECS Service resources
          const serviceResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::ECS::Service"
          );

          for (const [name, resource] of serviceResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `ECS Service ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            const matches = computeTypeMatchesDeployment(
              computeType,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `ECS Service ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "${templateInfo.deploymentType}")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any deployment type, the ComputeType tag SHALL be present
     * on ECS Task Definition resources.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    test("should have ComputeType tag on all ECS Task Definition resources", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all ECS Task Definition resources
          const taskDefResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::ECS::TaskDefinition"
          );

          for (const [name, resource] of taskDefResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `ECS Task Definition ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            const matches = computeTypeMatchesDeployment(
              computeType,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `ECS Task Definition ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "${templateInfo.deploymentType}")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any deployment type, the ComputeType tag SHALL be present
     * on CloudWatch Log Group resources.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    test("should have ComputeType tag on all CloudWatch Log Group resources", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all Log Group resources
          const logGroupResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::Logs::LogGroup"
          );

          for (const [name, resource] of logGroupResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `Log Group ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            const matches = computeTypeMatchesDeployment(
              computeType,
              templateInfo.deploymentType
            );

            if (!matches) {
              throw new Error(
                `Log Group ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "${templateInfo.deploymentType}")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For EC2 templates, the ComputeType tag SHALL be present
     * on Auto Scaling Group resources.
     *
     * **Validates: Requirements 3.1, 3.3**
     */
    test("should have ComputeType tag on all Auto Scaling Group resources in EC2 templates", () => {
      fc.assert(
        fc.property(ec2TemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all Auto Scaling Group resources
          const asgResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::AutoScaling::AutoScalingGroup"
          );

          for (const [name, resource] of asgResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `Auto Scaling Group ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            if (computeType !== "ec2" && computeType !== "parameter-reference") {
              throw new Error(
                `Auto Scaling Group ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "ec2")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For EC2 templates, the ComputeType tag SHALL be present
     * on EC2 Launch Template resources (via TagSpecifications).
     *
     * **Validates: Requirements 3.1, 3.3**
     */
    test("should have ComputeType tag on all EC2 Launch Template resources in EC2 templates", () => {
      fc.assert(
        fc.property(ec2TemplateArb, (templateInfo) => {
          const template = loadTemplate(templateInfo.path);
          const resources = template.Resources || {};

          // Find all Launch Template resources
          const ltResources = Object.entries(resources).filter(
            ([, resource]) => resource.Type === "AWS::EC2::LaunchTemplate"
          );

          for (const [name, resource] of ltResources) {
            if (!hasComputeTypeTag(resource)) {
              throw new Error(
                `Launch Template ${name} in ${templateInfo.name} is missing ComputeType tag`
              );
            }

            const computeType = getComputeTypeValue(resource);
            if (computeType !== "ec2" && computeType !== "parameter-reference") {
              throw new Error(
                `Launch Template ${name} in ${templateInfo.name} has incorrect ` +
                `ComputeType="${computeType}" (expected "ec2")`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any template, the number of billable resources with
     * ComputeType tags SHALL equal the total number of billable resources.
     *
     * **Validates: Requirements 3.3**
     */
    test("should have 100% coverage of ComputeType tags on billable resources", () => {
      fc.assert(
        fc.property(anyTemplateArb, (templateInfo) => {
          const resources = analyzeBillableResources(templateInfo);

          const totalBillable = resources.length;
          const taggedCount = resources.filter((r) => r.hasComputeTypeTag).length;

          if (totalBillable > 0 && taggedCount !== totalBillable) {
            const untagged = resources
              .filter((r) => !r.hasComputeTypeTag)
              .map((r) => `${r.resourceName} (${r.resourceType})`)
              .join(", ");

            throw new Error(
              `Template ${templateInfo.name} has ${taggedCount}/${totalBillable} ` +
              `billable resources tagged. Untagged: ${untagged}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
