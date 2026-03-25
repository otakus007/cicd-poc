/**
 * Property-Based Tests for VPC Endpoints Configuration
 *
 * Feature: infrastructure-optimization, Property 4 & 5: VPC Endpoints
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 *
 * Property 4: VPC Endpoints Exist for Required Services
 * _For any_ deployment environment, `vpc.yaml` SHALL contain a Gateway VPC Endpoint
 * for S3 associated with all private route tables, AND Interface VPC Endpoints for
 * `ecr.api`, `ecr.dkr`, and `logs` services in private subnets with the ECS Security Group.
 *
 * Property 5: VPC Endpoint Standard Tagging
 * _For any_ VPC Endpoint resource in `vpc.yaml`, the resource SHALL have `Name`,
 * `Environment`, and `Project` tags matching the standard tagging convention.
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

interface Tag {
  Key: string;
  Value: unknown;
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

const VPC_TEMPLATE_PATH = "vpc.yaml";

type Environment = "dev" | "staging" | "prod";

/** Expected VPC Endpoint logical IDs and their service name suffixes */
const EXPECTED_ENDPOINTS = {
  S3VpcEndpoint: { suffix: "s3", type: "Gateway" },
  EcrApiVpcEndpoint: { suffix: "ecr.api", type: "Interface" },
  EcrDkrVpcEndpoint: { suffix: "ecr.dkr", type: "Interface" },
  LogsVpcEndpoint: { suffix: "logs", type: "Interface" },
} as const;

const REQUIRED_TAG_KEYS = ["Name", "Environment", "Project"];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Find all VPC Endpoint resources in the template
 */
function findVpcEndpoints(
  template: CloudFormationTemplate
): Array<{ name: string; resource: CloudFormationResource }> {
  const resources = template.Resources || {};
  return Object.entries(resources)
    .filter(([, resource]) => resource.Type === "AWS::EC2::VPCEndpoint")
    .map(([name, resource]) => ({ name, resource }));
}

/**
 * Extract the service name from a VPC Endpoint resource.
 * The ServiceName is typically a !Sub intrinsic: com.amazonaws.${AWS::Region}.<suffix>
 */
function getServiceNameSuffix(resource: CloudFormationResource): string | null {
  const props = resource.Properties;
  if (!props) return null;

  const serviceName = props.ServiceName as { "Fn::Sub": string } | string | undefined;
  if (!serviceName) return null;

  let serviceStr: string;
  if (typeof serviceName === "string") {
    serviceStr = serviceName;
  } else if (typeof serviceName === "object" && "Fn::Sub" in serviceName) {
    serviceStr = serviceName["Fn::Sub"] as string;
  } else {
    return null;
  }

  // Extract suffix after the last region placeholder pattern
  // e.g. "com.amazonaws.${AWS::Region}.s3" → "s3"
  const match = serviceStr.match(/com\.amazonaws\.\$\{AWS::Region\}\.(.+)$/);
  if (match) return match[1];

  // Fallback: extract after last dot pattern for literal region
  const literalMatch = serviceStr.match(/com\.amazonaws\.[^.]+\.(.+)$/);
  return literalMatch ? literalMatch[1] : null;
}

/**
 * Get the VpcEndpointType from a VPC Endpoint resource
 */
function getEndpointType(resource: CloudFormationResource): string | null {
  return (resource.Properties?.VpcEndpointType as string) || null;
}

/**
 * Get tags from a resource
 */
function getTags(resource: CloudFormationResource): Tag[] {
  return (resource.Properties?.Tags as Tag[]) || [];
}

/**
 * Check if a resource has a specific tag key
 */
function hasTagKey(tags: Tag[], key: string): boolean {
  return tags.some((tag) => tag.Key === key);
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

const envArb: fc.Arbitrary<Environment> = fc.constantFrom(
  "dev" as Environment,
  "staging" as Environment,
  "prod" as Environment
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("VPC Endpoints Property-Based Tests", () => {
  let template: CloudFormationTemplate;
  let vpcEndpoints: Array<{ name: string; resource: CloudFormationResource }>;

  beforeAll(() => {
    template = loadTemplate(VPC_TEMPLATE_PATH);
    vpcEndpoints = findVpcEndpoints(template);
  });

  /**
   * Feature: infrastructure-optimization, Property 4: VPC Endpoints Exist for Required Services
   * **Validates: Requirements 5.1, 5.2, 5.3**
   */
  describe("Property 4: VPC Endpoints Exist for Required Services", () => {
    test("should have exactly 4 VPC Endpoint resources (1 Gateway + 3 Interface)", () => {
      expect(vpcEndpoints.length).toBe(4);

      const gatewayEndpoints = vpcEndpoints.filter(
        ({ resource }) => getEndpointType(resource) === "Gateway"
      );
      const interfaceEndpoints = vpcEndpoints.filter(
        ({ resource }) => getEndpointType(resource) === "Interface"
      );

      expect(gatewayEndpoints.length).toBe(1);
      expect(interfaceEndpoints.length).toBe(3);
    });

    /**
     * Property: For any environment, vpc.yaml SHALL contain a Gateway VPC Endpoint
     * for S3 associated with all private route tables, AND Interface VPC Endpoints
     * for ecr.api, ecr.dkr, and logs services.
     *
     * **Validates: Requirements 5.1, 5.2**
     */
    test("should contain VPC Endpoints for all required services (s3, ecr.api, ecr.dkr, logs)", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          for (const [logicalId, expected] of Object.entries(EXPECTED_ENDPOINTS)) {
            const endpoint = vpcEndpoints.find(({ name }) => name === logicalId);

            if (!endpoint) {
              throw new Error(
                `Missing VPC Endpoint "${logicalId}" for service "${expected.suffix}" ` +
                  `in environment "${env}"`
              );
            }

            // Verify service name suffix
            const suffix = getServiceNameSuffix(endpoint.resource);
            if (suffix !== expected.suffix) {
              throw new Error(
                `VPC Endpoint "${logicalId}" has service suffix "${suffix}" ` +
                  `but expected "${expected.suffix}" for environment "${env}"`
              );
            }

            // Verify endpoint type
            const endpointType = getEndpointType(endpoint.resource);
            if (endpointType !== expected.type) {
              throw new Error(
                `VPC Endpoint "${logicalId}" has type "${endpointType}" ` +
                  `but expected "${expected.type}" for environment "${env}"`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The S3 Gateway Endpoint SHALL be associated with private route tables.
     *
     * **Validates: Requirements 5.1**
     */
    test("should associate S3 Gateway Endpoint with private route tables", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const s3Endpoint = vpcEndpoints.find(({ name }) => name === "S3VpcEndpoint");
          if (!s3Endpoint) {
            throw new Error("S3VpcEndpoint not found");
          }

          const routeTableIds = s3Endpoint.resource.Properties?.RouteTableIds;
          if (!routeTableIds) {
            throw new Error("S3VpcEndpoint has no RouteTableIds property");
          }

          // RouteTableIds should reference at least PrivateRouteTable1
          // It may be a !If construct for conditional HA, so we check the structure
          const routeTableStr = JSON.stringify(routeTableIds);
          if (!routeTableStr.includes("PrivateRouteTable1")) {
            throw new Error(
              `S3VpcEndpoint RouteTableIds does not reference PrivateRouteTable1. ` +
                `Found: ${routeTableStr}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Interface VPC Endpoints SHALL be in private subnets with the
     * VPC Endpoint Security Group.
     *
     * **Validates: Requirements 5.2, 5.3**
     */
    test("should place Interface Endpoints in private subnets with VpcEndpointSecurityGroup", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          const interfaceEndpoints = vpcEndpoints.filter(
            ({ resource }) => getEndpointType(resource) === "Interface"
          );

          for (const { name, resource } of interfaceEndpoints) {
            // Check SubnetIds reference private subnets
            const subnetIds = resource.Properties?.SubnetIds as Array<{ Ref: string }> | undefined;
            if (!subnetIds || subnetIds.length === 0) {
              throw new Error(
                `Interface Endpoint "${name}" has no SubnetIds for environment "${env}"`
              );
            }

            const subnetRefs = subnetIds.map((s) => (typeof s === "object" && "Ref" in s ? s.Ref : JSON.stringify(s)));
            const hasPrivateSubnet1 = subnetRefs.includes("PrivateSubnet1");
            const hasPrivateSubnet2 = subnetRefs.includes("PrivateSubnet2");

            if (!hasPrivateSubnet1 || !hasPrivateSubnet2) {
              throw new Error(
                `Interface Endpoint "${name}" does not reference both PrivateSubnet1 and ` +
                  `PrivateSubnet2 for environment "${env}". Found: ${subnetRefs.join(", ")}`
              );
            }

            // Check SecurityGroupIds reference VpcEndpointSecurityGroup
            const sgIds = resource.Properties?.SecurityGroupIds as Array<{ Ref: string }> | undefined;
            if (!sgIds || sgIds.length === 0) {
              throw new Error(
                `Interface Endpoint "${name}" has no SecurityGroupIds for environment "${env}"`
              );
            }

            const sgRefs = sgIds.map((s) => (typeof s === "object" && "Ref" in s ? s.Ref : JSON.stringify(s)));
            if (!sgRefs.includes("VpcEndpointSecurityGroup")) {
              throw new Error(
                `Interface Endpoint "${name}" does not reference VpcEndpointSecurityGroup ` +
                  `for environment "${env}". Found: ${sgRefs.join(", ")}`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: infrastructure-optimization, Property 5: VPC Endpoint Standard Tagging
   * **Validates: Requirements 5.4**
   */
  describe("Property 5: VPC Endpoint Standard Tagging", () => {
    /**
     * Property: For any VPC Endpoint resource in vpc.yaml, the resource SHALL have
     * Name, Environment, and Project tags.
     *
     * **Validates: Requirements 5.4**
     */
    test("should have Name, Environment, and Project tags on all VPC Endpoint resources", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          for (const { name, resource } of vpcEndpoints) {
            const tags = getTags(resource);

            for (const requiredKey of REQUIRED_TAG_KEYS) {
              if (!hasTagKey(tags, requiredKey)) {
                throw new Error(
                  `VPC Endpoint "${name}" is missing required tag "${requiredKey}" ` +
                    `for environment "${env}". Found tags: ${tags.map((t) => t.Key).join(", ")}`
                );
              }
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The Environment tag value on each VPC Endpoint SHALL reference
     * the Environment parameter.
     *
     * **Validates: Requirements 5.4**
     */
    test("should have Environment tag referencing the Environment parameter", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          for (const { name, resource } of vpcEndpoints) {
            const tags = getTags(resource);
            const envTag = tags.find((t) => t.Key === "Environment");

            if (!envTag) {
              throw new Error(
                `VPC Endpoint "${name}" missing Environment tag for environment "${env}"`
              );
            }

            // Environment tag should be a !Ref to the Environment parameter
            const value = envTag.Value as { Ref?: string } | string;
            const isRef =
              typeof value === "object" && value !== null && value.Ref === "Environment";
            const isDirectValue =
              typeof value === "string" && ["dev", "staging", "prod"].includes(value);

            if (!isRef && !isDirectValue) {
              throw new Error(
                `VPC Endpoint "${name}" Environment tag does not reference the Environment ` +
                  `parameter for environment "${env}". Found: ${JSON.stringify(value)}`
              );
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The Project tag value on each VPC Endpoint SHALL reference
     * the ProjectName parameter.
     *
     * **Validates: Requirements 5.4**
     */
    test("should have Project tag referencing the ProjectName parameter", () => {
      fc.assert(
        fc.property(envArb, (env: Environment) => {
          for (const { name, resource } of vpcEndpoints) {
            const tags = getTags(resource);
            const projectTag = tags.find((t) => t.Key === "Project");

            if (!projectTag) {
              throw new Error(
                `VPC Endpoint "${name}" missing Project tag for environment "${env}"`
              );
            }

            const value = projectTag.Value as { Ref?: string } | string;
            const isRef =
              typeof value === "object" && value !== null && value.Ref === "ProjectName";

            if (!isRef) {
              throw new Error(
                `VPC Endpoint "${name}" Project tag does not reference the ProjectName ` +
                  `parameter for environment "${env}". Found: ${JSON.stringify(value)}`
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
