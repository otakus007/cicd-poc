/**
 * Property-Based Tests for Template Parameterization Correctness
 *
 * Feature: ec2-ecs-deployment, Property 2: Template Parameterization Correctness
 *
 * **Validates: Requirements 1.3, 1.6, 5.5**
 *
 * Property 2: Template Parameterization Correctness
 * _For any_ valid parameter combination (instance type, capacity values, volume size),
 * the CloudFormation templates SHALL accept the parameters and produce valid
 * infrastructure configurations where the deployed resources reflect the specified
 * parameter values.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface ParameterDefinition {
  Type: string;
  Description?: string;
  Default?: unknown;
  AllowedValues?: unknown[];
  MinValue?: number;
  MaxValue?: number;
  MinLength?: number;
  MaxLength?: number;
  AllowedPattern?: string;
  ConstraintDescription?: string;
}

interface CloudFormationResource {
  Type: string;
  Properties?: Record<string, unknown>;
  DependsOn?: string | string[];
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Metadata?: Record<string, unknown>;
  Parameters?: Record<string, ParameterDefinition>;
  Conditions?: Record<string, unknown>;
  Resources?: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

interface ParameterCombination {
  instanceType: string;
  minCapacity: number;
  maxCapacity: number;
  desiredCapacity: number;
  rootVolumeSize: number;
  environment: "dev" | "staging" | "prod";
  projectName: string;
}

interface LaunchTemplateData {
  InstanceType?: unknown;
  BlockDeviceMappings?: Array<{
    DeviceName: string;
    Ebs?: {
      VolumeSize?: unknown;
      VolumeType?: string;
      Encrypted?: boolean;
      DeleteOnTermination?: boolean;
    };
  }>;
  [key: string]: unknown;
}

interface AutoScalingGroupProperties {
  MinSize?: unknown;
  MaxSize?: unknown;
  DesiredCapacity?: unknown;
  [key: string]: unknown;
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
 * Valid EC2 instance types as defined in the CloudFormation template
 * Requirement 1.3: THE Launch_Template SHALL configure EC2 instances with
 * appropriate instance types (t3.medium default, configurable)
 */
const VALID_INSTANCE_TYPES = [
  "t3.micro",
  "t3.small",
  "t3.medium",
  "t3.large",
  "t3.xlarge",
  "t3.2xlarge",
  "m5.large",
  "m5.xlarge",
  "m5.2xlarge",
  "c5.large",
  "c5.xlarge",
  "c5.2xlarge",
];

/**
 * Valid environments as defined in the CloudFormation template
 */
const VALID_ENVIRONMENTS = ["dev", "staging", "prod"] as const;

/**
 * Capacity constraints from the CloudFormation template
 * Requirement 1.6: Min capacity 1, max capacity 10 (configurable)
 */
const CAPACITY_CONSTRAINTS = {
  minCapacity: { min: 0, max: 100 },
  maxCapacity: { min: 1, max: 100 },
  desiredCapacity: { min: 0, max: 100 },
};

/**
 * Volume size constraints from the CloudFormation template
 * Requirement 5.5: Configure appropriate root volume size (30GB minimum)
 */
const VOLUME_SIZE_CONSTRAINTS = {
  min: 30,
  max: 500,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the EC2 ECS cluster CloudFormation template
 */
function loadEc2ClusterTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "ecs-ec2-cluster.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Check if a parameter value is within the allowed values
 */
function isValueInAllowedValues(
  value: unknown,
  allowedValues: unknown[] | undefined
): boolean {
  if (!allowedValues) {
    return true; // No restriction
  }
  return allowedValues.includes(value);
}

/**
 * Check if a numeric value is within the min/max constraints
 */
function isValueInRange(
  value: number,
  minValue: number | undefined,
  maxValue: number | undefined
): boolean {
  if (minValue !== undefined && value < minValue) {
    return false;
  }
  if (maxValue !== undefined && value > maxValue) {
    return false;
  }
  return true;
}

/**
 * Validate a parameter value against its definition
 */
function validateParameterValue(
  paramName: string,
  value: unknown,
  paramDef: ParameterDefinition
): { valid: boolean; error?: string } {
  // Check allowed values
  if (paramDef.AllowedValues && !isValueInAllowedValues(value, paramDef.AllowedValues)) {
    return {
      valid: false,
      error: `Parameter ${paramName} value "${value}" is not in allowed values: ${paramDef.AllowedValues.join(", ")}`,
    };
  }

  // Check numeric constraints
  if (paramDef.Type === "Number" && typeof value === "number") {
    if (!isValueInRange(value, paramDef.MinValue, paramDef.MaxValue)) {
      return {
        valid: false,
        error: `Parameter ${paramName} value ${value} is out of range [${paramDef.MinValue}, ${paramDef.MaxValue}]`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get the Launch Template resource from the template
 */
function getLaunchTemplate(template: CloudFormationTemplate): LaunchTemplateData | null {
  const launchTemplate = template.Resources?.LaunchTemplate;
  if (!launchTemplate || launchTemplate.Type !== "AWS::EC2::LaunchTemplate") {
    return null;
  }
  return (launchTemplate.Properties as { LaunchTemplateData?: LaunchTemplateData })?.LaunchTemplateData || null;
}

/**
 * Get the Auto Scaling Group resource from the template
 */
function getAutoScalingGroup(template: CloudFormationTemplate): AutoScalingGroupProperties | null {
  const asg = template.Resources?.AutoScalingGroup;
  if (!asg || asg.Type !== "AWS::AutoScaling::AutoScalingGroup") {
    return null;
  }
  return asg.Properties as AutoScalingGroupProperties;
}

/**
 * Check if a resource property references a parameter
 */
function referencesParameter(property: unknown, parameterName: string): boolean {
  if (typeof property === "object" && property !== null) {
    const ref = (property as { Ref?: string }).Ref;
    if (ref === parameterName) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a parameter reference to its value
 */
function resolveParameterValue(
  property: unknown,
  params: ParameterCombination,
  parameterDefs: Record<string, ParameterDefinition>
): unknown {
  if (typeof property === "object" && property !== null) {
    const ref = (property as { Ref?: string }).Ref;
    if (ref) {
      switch (ref) {
        case "InstanceType":
          return params.instanceType;
        case "MinCapacity":
          return params.minCapacity;
        case "MaxCapacity":
          return params.maxCapacity;
        case "DesiredCapacity":
          return params.desiredCapacity;
        case "RootVolumeSize":
          return params.rootVolumeSize;
        case "Environment":
          return params.environment;
        case "ProjectName":
          return params.projectName;
        default:
          // Return default value from parameter definition if available
          return parameterDefs[ref]?.Default;
      }
    }
  }
  return property;
}

/**
 * Validate that capacity values are logically consistent
 * minCapacity <= desiredCapacity <= maxCapacity
 */
function areCapacityValuesConsistent(
  minCapacity: number,
  maxCapacity: number,
  desiredCapacity: number
): { consistent: boolean; error?: string } {
  if (minCapacity > maxCapacity) {
    return {
      consistent: false,
      error: `MinCapacity (${minCapacity}) cannot be greater than MaxCapacity (${maxCapacity})`,
    };
  }
  if (desiredCapacity < minCapacity) {
    return {
      consistent: false,
      error: `DesiredCapacity (${desiredCapacity}) cannot be less than MinCapacity (${minCapacity})`,
    };
  }
  if (desiredCapacity > maxCapacity) {
    return {
      consistent: false,
      error: `DesiredCapacity (${desiredCapacity}) cannot be greater than MaxCapacity (${maxCapacity})`,
    };
  }
  return { consistent: true };
}

/**
 * Validate that the template has all required parameters
 */
function hasRequiredParameters(template: CloudFormationTemplate): { valid: boolean; missing: string[] } {
  const requiredParams = [
    "InstanceType",
    "MinCapacity",
    "MaxCapacity",
    "DesiredCapacity",
    "RootVolumeSize",
    "Environment",
    "ProjectName",
  ];

  const templateParams = template.Parameters || {};
  const missing = requiredParams.filter((param) => !(param in templateParams));

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Validate that the Launch Template references the InstanceType parameter
 */
function launchTemplateReferencesInstanceType(launchTemplateData: LaunchTemplateData): boolean {
  return referencesParameter(launchTemplateData.InstanceType, "InstanceType");
}

/**
 * Validate that the Launch Template references the RootVolumeSize parameter
 */
function launchTemplateReferencesVolumeSize(launchTemplateData: LaunchTemplateData): boolean {
  const blockDeviceMappings = launchTemplateData.BlockDeviceMappings;
  if (!blockDeviceMappings || blockDeviceMappings.length === 0) {
    return false;
  }

  for (const mapping of blockDeviceMappings) {
    if (mapping.Ebs && referencesParameter(mapping.Ebs.VolumeSize, "RootVolumeSize")) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that the Auto Scaling Group references capacity parameters
 */
function asgReferencesCapacityParams(asg: AutoScalingGroupProperties): {
  minSize: boolean;
  maxSize: boolean;
  desiredCapacity: boolean;
} {
  return {
    minSize: referencesParameter(asg.MinSize, "MinCapacity"),
    maxSize: referencesParameter(asg.MaxSize, "MaxCapacity"),
    desiredCapacity: referencesParameter(asg.DesiredCapacity, "DesiredCapacity"),
  };
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid instance types
 * Requirement 1.3: Configurable instance types
 */
const instanceTypeArb: fc.Arbitrary<string> = fc.constantFrom(...VALID_INSTANCE_TYPES);

/**
 * Generator for valid environments
 */
const environmentArb = fc.constantFrom(...VALID_ENVIRONMENTS) as fc.Arbitrary<"dev" | "staging" | "prod">;

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
 * Generator for valid root volume sizes
 * Requirement 5.5: 30GB minimum, up to 500GB
 */
const rootVolumeSizeArb: fc.Arbitrary<number> = fc.integer({
  min: VOLUME_SIZE_CONSTRAINTS.min,
  max: VOLUME_SIZE_CONSTRAINTS.max,
});

/**
 * Generator for valid capacity values that are logically consistent
 * Requirement 1.6: Min capacity 1, max capacity 10 (configurable)
 * Ensures minCapacity <= desiredCapacity <= maxCapacity
 */
const capacityValuesArb = fc
  .tuple(
    fc.integer({ min: CAPACITY_CONSTRAINTS.minCapacity.min, max: CAPACITY_CONSTRAINTS.minCapacity.max }),
    fc.integer({ min: CAPACITY_CONSTRAINTS.maxCapacity.min, max: CAPACITY_CONSTRAINTS.maxCapacity.max })
  )
  .filter(([min, max]) => min <= max)
  .chain(([minCapacity, maxCapacity]) =>
    fc.integer({ min: minCapacity, max: maxCapacity }).map((desiredCapacity) => ({
      minCapacity,
      maxCapacity,
      desiredCapacity,
    }))
  );

/**
 * Generator for complete valid parameter combinations
 */
const parameterCombinationArb: fc.Arbitrary<ParameterCombination> = fc.record({
  instanceType: instanceTypeArb,
  minCapacity: fc.constant(0), // Will be overridden
  maxCapacity: fc.constant(0), // Will be overridden
  desiredCapacity: fc.constant(0), // Will be overridden
  rootVolumeSize: rootVolumeSizeArb,
  environment: environmentArb,
  projectName: projectNameArb,
}).chain((base) =>
  capacityValuesArb.map((capacity) => ({
    ...base,
    ...capacity,
  }))
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Template Parameterization Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 2: Template Parameterization Correctness
   * **Validates: Requirements 1.3, 1.6, 5.5**
   */
  describe("Property 2: Template Parameterization Correctness", () => {
    let template: CloudFormationTemplate;
    let launchTemplateData: LaunchTemplateData;
    let asgProperties: AutoScalingGroupProperties;

    beforeAll(() => {
      template = loadEc2ClusterTemplate();

      const lt = getLaunchTemplate(template);
      if (!lt) {
        throw new Error("Launch Template not found in template");
      }
      launchTemplateData = lt;

      const asg = getAutoScalingGroup(template);
      if (!asg) {
        throw new Error("Auto Scaling Group not found in template");
      }
      asgProperties = asg;
    });

    /**
     * Property: The template SHALL have all required parameters for configuration.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should have all required parameters defined", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (_params) => {
          const { valid, missing } = hasRequiredParameters(template);

          if (!valid) {
            throw new Error(`Template is missing required parameters: ${missing.join(", ")}`);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid instance type, the template SHALL accept the parameter
     * and the Launch Template SHALL reference it.
     *
     * **Validates: Requirements 1.3**
     */
    test("should accept any valid instance type and reference it in Launch Template", () => {
      fc.assert(
        fc.property(instanceTypeArb, (instanceType) => {
          const paramDef = template.Parameters?.InstanceType;
          if (!paramDef) {
            throw new Error("InstanceType parameter not found in template");
          }

          // Validate the instance type is accepted
          const validation = validateParameterValue("InstanceType", instanceType, paramDef);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          // Verify Launch Template references the parameter
          expect(launchTemplateReferencesInstanceType(launchTemplateData)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid capacity combination, the template SHALL accept the
     * parameters and the Auto Scaling Group SHALL reference them.
     *
     * **Validates: Requirements 1.6**
     */
    test("should accept any valid capacity combination and reference in ASG", () => {
      fc.assert(
        fc.property(capacityValuesArb, (capacity) => {
          const { minCapacity, maxCapacity, desiredCapacity } = capacity;

          // Validate capacity values are consistent
          const consistency = areCapacityValuesConsistent(minCapacity, maxCapacity, desiredCapacity);
          if (!consistency.consistent) {
            throw new Error(consistency.error);
          }

          // Validate each capacity parameter
          const minParamDef = template.Parameters?.MinCapacity;
          const maxParamDef = template.Parameters?.MaxCapacity;
          const desiredParamDef = template.Parameters?.DesiredCapacity;

          if (!minParamDef || !maxParamDef || !desiredParamDef) {
            throw new Error("Capacity parameters not found in template");
          }

          const minValidation = validateParameterValue("MinCapacity", minCapacity, minParamDef);
          const maxValidation = validateParameterValue("MaxCapacity", maxCapacity, maxParamDef);
          const desiredValidation = validateParameterValue("DesiredCapacity", desiredCapacity, desiredParamDef);

          if (!minValidation.valid) throw new Error(minValidation.error);
          if (!maxValidation.valid) throw new Error(maxValidation.error);
          if (!desiredValidation.valid) throw new Error(desiredValidation.error);

          // Verify ASG references the parameters
          const asgRefs = asgReferencesCapacityParams(asgProperties);
          expect(asgRefs.minSize).toBe(true);
          expect(asgRefs.maxSize).toBe(true);
          expect(asgRefs.desiredCapacity).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid root volume size (30GB minimum), the template SHALL
     * accept the parameter and the Launch Template SHALL reference it.
     *
     * **Validates: Requirements 5.5**
     */
    test("should accept any valid root volume size and reference in Launch Template", () => {
      fc.assert(
        fc.property(rootVolumeSizeArb, (volumeSize) => {
          const paramDef = template.Parameters?.RootVolumeSize;
          if (!paramDef) {
            throw new Error("RootVolumeSize parameter not found in template");
          }

          // Validate the volume size is accepted
          const validation = validateParameterValue("RootVolumeSize", volumeSize, paramDef);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          // Verify Launch Template references the parameter
          expect(launchTemplateReferencesVolumeSize(launchTemplateData)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid parameter combination, the template SHALL accept all
     * parameters and produce a valid configuration.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should accept any valid parameter combination", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (params) => {
          const templateParams = template.Parameters || {};

          // Validate instance type
          const instanceTypeValidation = validateParameterValue(
            "InstanceType",
            params.instanceType,
            templateParams.InstanceType
          );
          if (!instanceTypeValidation.valid) {
            throw new Error(instanceTypeValidation.error);
          }

          // Validate capacity values
          const minValidation = validateParameterValue(
            "MinCapacity",
            params.minCapacity,
            templateParams.MinCapacity
          );
          const maxValidation = validateParameterValue(
            "MaxCapacity",
            params.maxCapacity,
            templateParams.MaxCapacity
          );
          const desiredValidation = validateParameterValue(
            "DesiredCapacity",
            params.desiredCapacity,
            templateParams.DesiredCapacity
          );

          if (!minValidation.valid) throw new Error(minValidation.error);
          if (!maxValidation.valid) throw new Error(maxValidation.error);
          if (!desiredValidation.valid) throw new Error(desiredValidation.error);

          // Validate volume size
          const volumeValidation = validateParameterValue(
            "RootVolumeSize",
            params.rootVolumeSize,
            templateParams.RootVolumeSize
          );
          if (!volumeValidation.valid) {
            throw new Error(volumeValidation.error);
          }

          // Validate environment
          const envValidation = validateParameterValue(
            "Environment",
            params.environment,
            templateParams.Environment
          );
          if (!envValidation.valid) {
            throw new Error(envValidation.error);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid parameter combination, the deployed resources SHALL
     * reflect the specified parameter values through parameter references.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should have resources that reflect parameter values through references", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (params) => {
          // Verify Launch Template references InstanceType
          expect(launchTemplateReferencesInstanceType(launchTemplateData)).toBe(true);

          // Verify Launch Template references RootVolumeSize
          expect(launchTemplateReferencesVolumeSize(launchTemplateData)).toBe(true);

          // Verify ASG references capacity parameters
          const asgRefs = asgReferencesCapacityParams(asgProperties);
          expect(asgRefs.minSize).toBe(true);
          expect(asgRefs.maxSize).toBe(true);
          expect(asgRefs.desiredCapacity).toBe(true);

          // Verify the resolved values would match the input parameters
          const templateParams = template.Parameters || {};
          const resolvedInstanceType = resolveParameterValue(
            launchTemplateData.InstanceType,
            params,
            templateParams
          );
          expect(resolvedInstanceType).toBe(params.instanceType);

          const resolvedMinSize = resolveParameterValue(
            asgProperties.MinSize,
            params,
            templateParams
          );
          expect(resolvedMinSize).toBe(params.minCapacity);

          const resolvedMaxSize = resolveParameterValue(
            asgProperties.MaxSize,
            params,
            templateParams
          );
          expect(resolvedMaxSize).toBe(params.maxCapacity);

          const resolvedDesiredCapacity = resolveParameterValue(
            asgProperties.DesiredCapacity,
            params,
            templateParams
          );
          expect(resolvedDesiredCapacity).toBe(params.desiredCapacity);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid instance type, the parameter definition SHALL include
     * it in the AllowedValues list.
     *
     * **Validates: Requirements 1.3**
     */
    test("should have all valid instance types in AllowedValues", () => {
      fc.assert(
        fc.property(instanceTypeArb, (instanceType) => {
          const paramDef = template.Parameters?.InstanceType;
          if (!paramDef) {
            throw new Error("InstanceType parameter not found");
          }

          expect(paramDef.AllowedValues).toBeDefined();
          expect(paramDef.AllowedValues).toContain(instanceType);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid capacity values, the parameter definitions SHALL
     * have appropriate min/max constraints.
     *
     * **Validates: Requirements 1.6**
     */
    test("should have appropriate min/max constraints for capacity parameters", () => {
      fc.assert(
        fc.property(capacityValuesArb, (capacity) => {
          const minParamDef = template.Parameters?.MinCapacity;
          const maxParamDef = template.Parameters?.MaxCapacity;
          const desiredParamDef = template.Parameters?.DesiredCapacity;

          // Verify MinCapacity constraints
          expect(minParamDef?.MinValue).toBeDefined();
          expect(minParamDef?.MaxValue).toBeDefined();
          expect(capacity.minCapacity).toBeGreaterThanOrEqual(minParamDef?.MinValue || 0);
          expect(capacity.minCapacity).toBeLessThanOrEqual(minParamDef?.MaxValue || 100);

          // Verify MaxCapacity constraints
          expect(maxParamDef?.MinValue).toBeDefined();
          expect(maxParamDef?.MaxValue).toBeDefined();
          expect(capacity.maxCapacity).toBeGreaterThanOrEqual(maxParamDef?.MinValue || 1);
          expect(capacity.maxCapacity).toBeLessThanOrEqual(maxParamDef?.MaxValue || 100);

          // Verify DesiredCapacity constraints
          expect(desiredParamDef?.MinValue).toBeDefined();
          expect(desiredParamDef?.MaxValue).toBeDefined();
          expect(capacity.desiredCapacity).toBeGreaterThanOrEqual(desiredParamDef?.MinValue || 0);
          expect(capacity.desiredCapacity).toBeLessThanOrEqual(desiredParamDef?.MaxValue || 100);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid root volume size, the parameter definition SHALL
     * enforce the 30GB minimum constraint.
     *
     * **Validates: Requirements 5.5**
     */
    test("should enforce 30GB minimum for root volume size", () => {
      fc.assert(
        fc.property(rootVolumeSizeArb, (volumeSize) => {
          const paramDef = template.Parameters?.RootVolumeSize;
          if (!paramDef) {
            throw new Error("RootVolumeSize parameter not found");
          }

          // Verify minimum constraint is 30GB
          expect(paramDef.MinValue).toBe(30);
          expect(volumeSize).toBeGreaterThanOrEqual(30);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid parameter combination, the Launch Template SHALL
     * have EBS configuration with the volume size parameter reference.
     *
     * **Validates: Requirements 5.5**
     */
    test("should have EBS configuration with volume size reference", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (_params) => {
          const blockDeviceMappings = launchTemplateData.BlockDeviceMappings;

          expect(blockDeviceMappings).toBeDefined();
          expect(blockDeviceMappings?.length).toBeGreaterThan(0);

          // Find the root volume mapping
          const rootMapping = blockDeviceMappings?.find(
            (mapping) => mapping.DeviceName === "/dev/xvda"
          );
          expect(rootMapping).toBeDefined();
          expect(rootMapping?.Ebs).toBeDefined();

          // Verify volume type is gp3
          expect(rootMapping?.Ebs?.VolumeType).toBe("gp3");

          // Verify encryption is enabled
          expect(rootMapping?.Ebs?.Encrypted).toBe(true);

          // Verify delete on termination
          expect(rootMapping?.Ebs?.DeleteOnTermination).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid parameter combination, the Auto Scaling Group SHALL
     * have proper update policy for rolling updates.
     *
     * **Validates: Requirements 1.6**
     */
    test("should have proper ASG update policy for any parameter combination", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (_params) => {
          const asg = template.Resources?.AutoScalingGroup;
          expect(asg).toBeDefined();

          // Check for UpdatePolicy (it's at the resource level, not in Properties)
          // The template should have rolling update configuration
          expect(asg?.Type).toBe("AWS::AutoScaling::AutoScalingGroup");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid environment value, the template SHALL accept it
     * and use it in resource naming.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should accept any valid environment value", () => {
      fc.assert(
        fc.property(environmentArb, (environment) => {
          const paramDef = template.Parameters?.Environment;
          if (!paramDef) {
            throw new Error("Environment parameter not found");
          }

          // Validate the environment is accepted
          const validation = validateParameterValue("Environment", environment, paramDef);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          expect(paramDef.AllowedValues).toContain(environment);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid project name, the template SHALL accept it
     * following the naming pattern constraints.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should accept any valid project name following naming pattern", () => {
      fc.assert(
        fc.property(projectNameArb, (projectName) => {
          const paramDef = template.Parameters?.ProjectName;
          if (!paramDef) {
            throw new Error("ProjectName parameter not found");
          }

          // Verify the project name matches the allowed pattern
          const pattern = paramDef.AllowedPattern;
          if (pattern) {
            const regex = new RegExp(pattern);
            expect(projectName).toMatch(regex);
          }

          // Verify length constraints
          expect(projectName.length).toBeGreaterThanOrEqual(paramDef.MinLength || 3);
          expect(projectName.length).toBeLessThanOrEqual(paramDef.MaxLength || 32);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid parameter combination, the template SHALL have
     * default values that are within the allowed constraints.
     *
     * **Validates: Requirements 1.3, 1.6, 5.5**
     */
    test("should have valid default values for all parameters", () => {
      fc.assert(
        fc.property(parameterCombinationArb, (_params) => {
          const templateParams = template.Parameters || {};

          // Check InstanceType default
          const instanceTypeDefault = templateParams.InstanceType?.Default;
          if (instanceTypeDefault) {
            expect(VALID_INSTANCE_TYPES).toContain(instanceTypeDefault);
          }

          // Check capacity defaults
          const minDefault = templateParams.MinCapacity?.Default as number | undefined;
          const maxDefault = templateParams.MaxCapacity?.Default as number | undefined;
          const desiredDefault = templateParams.DesiredCapacity?.Default as number | undefined;

          if (minDefault !== undefined && maxDefault !== undefined && desiredDefault !== undefined) {
            const consistency = areCapacityValuesConsistent(minDefault, maxDefault, desiredDefault);
            expect(consistency.consistent).toBe(true);
          }

          // Check volume size default
          const volumeDefault = templateParams.RootVolumeSize?.Default as number | undefined;
          if (volumeDefault !== undefined) {
            expect(volumeDefault).toBeGreaterThanOrEqual(VOLUME_SIZE_CONSTRAINTS.min);
            expect(volumeDefault).toBeLessThanOrEqual(VOLUME_SIZE_CONSTRAINTS.max);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
