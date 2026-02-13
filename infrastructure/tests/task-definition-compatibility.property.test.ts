/**
 * Property-Based Tests for Task Definition Compatibility
 *
 * Feature: ec2-ecs-deployment, Property 4: Task Definition Compatibility
 *
 * **Validates: Requirements 7.1, 7.3, 7.5**
 *
 * Property 4: Task Definition Compatibility
 * _For any_ valid container image URI and resource configuration, the EC2 task definition
 * SHALL produce a configuration that is compatible with the EC2 launch type, uses awsvpc
 * network mode, and has identical health check settings to the Fargate task definition.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface HealthCheck {
  Command: string[];
  Interval: number | { Ref: string };
  Timeout: number | { Ref: string };
  Retries: number | { Ref: string };
  StartPeriod: number | { Ref: string };
}

interface PortMapping {
  ContainerPort: number | { Ref: string };
  Protocol: string;
  AppProtocol?: string;
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

interface HealthCheckConfig {
  interval: number | { Ref: string };
  timeout: number | { Ref: string };
  retries: number | { Ref: string };
  startPeriod: number | { Ref: string };
  command: string[];
}

interface ContainerConfig {
  projectName: string;
  environment: "dev" | "staging" | "prod";
  containerPort: number;
  taskCpu: string;
  taskMemory: string;
  healthCheckPath: string;
  healthCheckInterval: number;
  healthCheckTimeout: number;
  healthCheckRetries: number;
  healthCheckStartPeriod: number;
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
 * Load and parse the Fargate task definition CloudFormation template
 */
function loadFargateTemplate(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "task-definition.yaml");
  const templateContent = fs.readFileSync(templatePath, "utf8");
  return yaml.load(templateContent, {
    schema: CFN_SCHEMA,
  }) as CloudFormationTemplate;
}

/**
 * Load and parse the EC2 task definition CloudFormation template
 */
function loadEc2Template(): CloudFormationTemplate {
  const templatePath = path.join(__dirname, "..", "task-definition-ec2.yaml");
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
 * Extract health check configuration from a container definition
 */
function extractHealthCheckConfig(container: ContainerDefinition): HealthCheckConfig {
  const healthCheck = container.HealthCheck;
  return {
    interval: healthCheck.Interval,
    timeout: healthCheck.Timeout,
    retries: healthCheck.Retries,
    startPeriod: healthCheck.StartPeriod,
    command: healthCheck.Command,
  };
}


/**
 * Compare two health check configurations for equality
 * Handles both literal values and CloudFormation references
 */
function healthChecksMatch(
  fargate: HealthCheckConfig,
  ec2: HealthCheckConfig
): { match: boolean; differences: string[] } {
  const differences: string[] = [];

  // Compare interval
  if (JSON.stringify(fargate.interval) !== JSON.stringify(ec2.interval)) {
    differences.push(`Interval mismatch: Fargate=${JSON.stringify(fargate.interval)}, EC2=${JSON.stringify(ec2.interval)}`);
  }

  // Compare timeout
  if (JSON.stringify(fargate.timeout) !== JSON.stringify(ec2.timeout)) {
    differences.push(`Timeout mismatch: Fargate=${JSON.stringify(fargate.timeout)}, EC2=${JSON.stringify(ec2.timeout)}`);
  }

  // Compare retries
  if (JSON.stringify(fargate.retries) !== JSON.stringify(ec2.retries)) {
    differences.push(`Retries mismatch: Fargate=${JSON.stringify(fargate.retries)}, EC2=${JSON.stringify(ec2.retries)}`);
  }

  // Compare start period
  if (JSON.stringify(fargate.startPeriod) !== JSON.stringify(ec2.startPeriod)) {
    differences.push(`StartPeriod mismatch: Fargate=${JSON.stringify(fargate.startPeriod)}, EC2=${JSON.stringify(ec2.startPeriod)}`);
  }

  // Compare command structure (both should use CMD-SHELL with curl)
  if (fargate.command[0] !== ec2.command[0]) {
    differences.push(`Command type mismatch: Fargate=${fargate.command[0]}, EC2=${ec2.command[0]}`);
  }

  return {
    match: differences.length === 0,
    differences,
  };
}

/**
 * Verify that the EC2 task definition uses awsvpc network mode
 */
function hasAwsvpcNetworkMode(taskDef: TaskDefinitionProperties): boolean {
  return taskDef.NetworkMode === "awsvpc";
}

/**
 * Verify that the task definition has EC2 in RequiresCompatibilities
 */
function hasEc2Compatibility(taskDef: TaskDefinitionProperties): boolean {
  return taskDef.RequiresCompatibilities?.includes("EC2") ?? false;
}

/**
 * Verify that the task definition has FARGATE in RequiresCompatibilities
 */
function hasFargateCompatibility(taskDef: TaskDefinitionProperties): boolean {
  return taskDef.RequiresCompatibilities?.includes("FARGATE") ?? false;
}


/**
 * Simulate parameter substitution for health check command
 */
function resolveHealthCheckCommand(
  command: string[],
  config: ContainerConfig
): string[] {
  return command.map((part) => {
    if (typeof part === "string") {
      return part
        .replace(/\$\{ContainerPort\}/g, config.containerPort.toString())
        .replace(/\$\{HealthCheckPath\}/g, config.healthCheckPath);
    }
    // Handle Fn::Sub objects
    if (typeof part === "object" && part !== null) {
      const subValue = (part as { "Fn::Sub"?: string })["Fn::Sub"];
      if (typeof subValue === "string") {
        return subValue
          .replace(/\$\{ContainerPort\}/g, config.containerPort.toString())
          .replace(/\$\{HealthCheckPath\}/g, config.healthCheckPath);
      }
    }
    return part;
  });
}

/**
 * Validate that CPU and Memory configurations are compatible
 */
function areResourceConfigsCompatible(
  fargate: TaskDefinitionProperties,
  ec2: TaskDefinitionProperties
): { compatible: boolean; differences: string[] } {
  const differences: string[] = [];

  // Both should have CPU and Memory at task level for awsvpc mode
  if (!ec2.Cpu) {
    differences.push("EC2 task definition missing Cpu at task level");
  }
  if (!ec2.Memory) {
    differences.push("EC2 task definition missing Memory at task level");
  }

  // CPU and Memory should use the same parameter references
  if (JSON.stringify(fargate.Cpu) !== JSON.stringify(ec2.Cpu)) {
    differences.push(`CPU configuration differs: Fargate=${JSON.stringify(fargate.Cpu)}, EC2=${JSON.stringify(ec2.Cpu)}`);
  }
  if (JSON.stringify(fargate.Memory) !== JSON.stringify(ec2.Memory)) {
    differences.push(`Memory configuration differs: Fargate=${JSON.stringify(fargate.Memory)}, EC2=${JSON.stringify(ec2.Memory)}`);
  }

  return {
    compatible: differences.length === 0,
    differences,
  };
}

/**
 * Validate that secrets configuration matches between Fargate and EC2
 */
function secretsConfigMatch(
  fargateContainer: ContainerDefinition,
  ec2Container: ContainerDefinition
): { match: boolean; differences: string[] } {
  const differences: string[] = [];

  const fargateSecrets = fargateContainer.Secrets || [];
  const ec2Secrets = ec2Container.Secrets || [];

  if (fargateSecrets.length !== ec2Secrets.length) {
    differences.push(`Secret count mismatch: Fargate=${fargateSecrets.length}, EC2=${ec2Secrets.length}`);
    return { match: false, differences };
  }

  // Compare each secret by name
  for (const fargateSecret of fargateSecrets) {
    const ec2Secret = ec2Secrets.find((s) => s.Name === fargateSecret.Name);
    if (!ec2Secret) {
      differences.push(`Secret ${fargateSecret.Name} missing in EC2 task definition`);
    }
  }

  return {
    match: differences.length === 0,
    differences,
  };
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
 * Generator for valid container ports (1-65535)
 */
const containerPortArb = fc.integer({ min: 1, max: 65535 });

/**
 * Generator for valid Fargate/EC2 CPU values
 */
const taskCpuArb = fc.constantFrom("256", "512", "1024", "2048", "4096");

/**
 * Generator for valid Fargate/EC2 memory values
 */
const taskMemoryArb = fc.constantFrom(
  "512", "1024", "2048", "3072", "4096",
  "5120", "6144", "7168", "8192"
);

/**
 * Generator for valid health check paths
 */
const healthCheckPathArb = fc
  .stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_/".split("")),
    { minLength: 1, maxLength: 50 }
  )
  .map((path) => `/${path}`)
  .filter((path) => !path.includes("//"));


/**
 * Generator for valid health check interval (5-300 seconds)
 */
const healthCheckIntervalArb = fc.integer({ min: 5, max: 300 });

/**
 * Generator for valid health check timeout (2-60 seconds)
 */
const healthCheckTimeoutArb = fc.integer({ min: 2, max: 60 });

/**
 * Generator for valid health check retries (1-10)
 */
const healthCheckRetriesArb = fc.integer({ min: 1, max: 10 });

/**
 * Generator for valid health check start period (0-300 seconds)
 */
const healthCheckStartPeriodArb = fc.integer({ min: 0, max: 300 });

/**
 * Generator for complete container configurations
 */
const containerConfigArb: fc.Arbitrary<ContainerConfig> = fc.record({
  projectName: projectNameArb,
  environment: environmentArb,
  containerPort: containerPortArb,
  taskCpu: taskCpuArb,
  taskMemory: taskMemoryArb,
  healthCheckPath: healthCheckPathArb,
  healthCheckInterval: healthCheckIntervalArb,
  healthCheckTimeout: healthCheckTimeoutArb,
  healthCheckRetries: healthCheckRetriesArb,
  healthCheckStartPeriod: healthCheckStartPeriodArb,
});

/**
 * Generator for valid CPU/Memory combinations
 * Ensures memory is compatible with CPU selection
 */
const validCpuMemoryArb = fc.oneof(
  // 256 CPU: 512, 1024, 2048
  fc.record({ cpu: fc.constant("256"), memory: fc.constantFrom("512", "1024", "2048") }),
  // 512 CPU: 1024, 2048, 3072, 4096
  fc.record({ cpu: fc.constant("512"), memory: fc.constantFrom("1024", "2048", "3072", "4096") }),
  // 1024 CPU: 2048, 3072, 4096, 5120, 6144, 7168, 8192
  fc.record({ cpu: fc.constant("1024"), memory: fc.constantFrom("2048", "3072", "4096", "5120", "6144", "7168", "8192") }),
  // 2048 CPU: 4096, 5120, 6144, 7168, 8192
  fc.record({ cpu: fc.constant("2048"), memory: fc.constantFrom("4096", "5120", "6144", "7168", "8192") }),
  // 4096 CPU: 8192
  fc.record({ cpu: fc.constant("4096"), memory: fc.constant("8192") })
);


// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Task Definition Compatibility Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 4: Task Definition Compatibility
   * **Validates: Requirements 7.1, 7.3, 7.5**
   */
  describe("Property 4: Task Definition Compatibility", () => {
    let fargateTemplate: CloudFormationTemplate;
    let ec2Template: CloudFormationTemplate;
    let fargateTaskDef: TaskDefinitionProperties;
    let ec2TaskDef: TaskDefinitionProperties;
    let fargateContainer: ContainerDefinition;
    let ec2Container: ContainerDefinition;

    beforeAll(() => {
      fargateTemplate = loadFargateTemplate();
      ec2Template = loadEc2Template();

      const fargateTd = getTaskDefinition(fargateTemplate);
      if (!fargateTd) {
        throw new Error("Fargate task definition not found in template");
      }
      fargateTaskDef = fargateTd;

      const ec2Td = getTaskDefinition(ec2Template);
      if (!ec2Td) {
        throw new Error("EC2 task definition not found in template");
      }
      ec2TaskDef = ec2Td;

      const fargateC = getContainerDefinition(fargateTaskDef);
      if (!fargateC) {
        throw new Error("Fargate container definition not found");
      }
      fargateContainer = fargateC;

      const ec2C = getContainerDefinition(ec2TaskDef);
      if (!ec2C) {
        throw new Error("EC2 container definition not found");
      }
      ec2Container = ec2C;
    });

    /**
     * Property: For any valid container configuration, the EC2 task definition
     * SHALL use awsvpc network mode for ALB integration.
     *
     * **Validates: Requirements 7.3**
     */
    test("should use awsvpc network mode for EC2 task definition", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Verify EC2 task definition uses awsvpc network mode
          expect(hasAwsvpcNetworkMode(ec2TaskDef)).toBe(true);
          expect(ec2TaskDef.NetworkMode).toBe("awsvpc");

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the EC2 task definition
     * SHALL have EC2 in RequiresCompatibilities.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have EC2 in RequiresCompatibilities", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Verify EC2 task definition has EC2 compatibility
          expect(hasEc2Compatibility(ec2TaskDef)).toBe(true);
          expect(ec2TaskDef.RequiresCompatibilities).toContain("EC2");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the Fargate task definition
     * SHALL have FARGATE in RequiresCompatibilities.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have FARGATE in RequiresCompatibilities for Fargate task", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Verify Fargate task definition has FARGATE compatibility
          expect(hasFargateCompatibility(fargateTaskDef)).toBe(true);
          expect(fargateTaskDef.RequiresCompatibilities).toContain("FARGATE");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the health check settings
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check settings between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Extract health check configurations
          const fargateHealthCheck = extractHealthCheckConfig(fargateContainer);
          const ec2HealthCheck = extractHealthCheckConfig(ec2Container);

          // Verify health checks match
          const { match, differences } = healthChecksMatch(fargateHealthCheck, ec2HealthCheck);

          if (!match) {
            throw new Error(
              `Health check settings do not match between EC2 and Fargate. ` +
              `Differences: ${differences.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the health check interval
     * parameter reference SHALL be identical between EC2 and Fargate.
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check interval parameter reference", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateInterval = fargateContainer.HealthCheck.Interval;
          const ec2Interval = ec2Container.HealthCheck.Interval;

          expect(JSON.stringify(fargateInterval)).toBe(JSON.stringify(ec2Interval));

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the health check timeout
     * parameter reference SHALL be identical between EC2 and Fargate.
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check timeout parameter reference", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateTimeout = fargateContainer.HealthCheck.Timeout;
          const ec2Timeout = ec2Container.HealthCheck.Timeout;

          expect(JSON.stringify(fargateTimeout)).toBe(JSON.stringify(ec2Timeout));

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the health check retries
     * parameter reference SHALL be identical between EC2 and Fargate.
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check retries parameter reference", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateRetries = fargateContainer.HealthCheck.Retries;
          const ec2Retries = ec2Container.HealthCheck.Retries;

          expect(JSON.stringify(fargateRetries)).toBe(JSON.stringify(ec2Retries));

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the health check start period
     * parameter reference SHALL be identical between EC2 and Fargate.
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check start period parameter reference", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateStartPeriod = fargateContainer.HealthCheck.StartPeriod;
          const ec2StartPeriod = ec2Container.HealthCheck.StartPeriod;

          expect(JSON.stringify(fargateStartPeriod)).toBe(JSON.stringify(ec2StartPeriod));

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the health check command
     * structure SHALL be identical between EC2 and Fargate (both using CMD-SHELL).
     *
     * **Validates: Requirements 7.5**
     */
    test("should have identical health check command structure", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateCommand = fargateContainer.HealthCheck.Command;
          const ec2Command = ec2Container.HealthCheck.Command;

          // Both should use CMD-SHELL
          expect(fargateCommand[0]).toBe("CMD-SHELL");
          expect(ec2Command[0]).toBe("CMD-SHELL");

          // Both should have the same command structure (curl health check)
          expect(fargateCommand.length).toBe(ec2Command.length);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid CPU/memory combination, the EC2 task definition
     * SHALL have CPU and Memory at task level (required for awsvpc mode).
     *
     * **Validates: Requirements 7.3**
     */
    test("should have CPU and Memory at task level for awsvpc mode", () => {
      fc.assert(
        fc.property(validCpuMemoryArb, (_cpuMemory) => {
          // Verify EC2 task definition has CPU and Memory at task level
          expect(ec2TaskDef.Cpu).toBeDefined();
          expect(ec2TaskDef.Memory).toBeDefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the CPU parameter reference
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.3**
     */
    test("should have identical CPU parameter reference between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const { compatible, differences } = areResourceConfigsCompatible(fargateTaskDef, ec2TaskDef);

          if (!compatible) {
            throw new Error(
              `Resource configurations are not compatible. ` +
              `Differences: ${differences.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the secrets configuration
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical secrets configuration between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const { match, differences } = secretsConfigMatch(fargateContainer, ec2Container);

          if (!match) {
            throw new Error(
              `Secrets configuration does not match. ` +
              `Differences: ${differences.join(", ")}`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the container port mapping
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical port mappings between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargatePortMappings = fargateContainer.PortMappings;
          const ec2PortMappings = ec2Container.PortMappings;

          expect(fargatePortMappings.length).toBe(ec2PortMappings.length);

          for (let i = 0; i < fargatePortMappings.length; i++) {
            expect(JSON.stringify(fargatePortMappings[i].ContainerPort)).toBe(
              JSON.stringify(ec2PortMappings[i].ContainerPort)
            );
            expect(fargatePortMappings[i].Protocol).toBe(ec2PortMappings[i].Protocol);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the log configuration
     * SHALL use the same log driver between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical log driver between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateLogConfig = fargateContainer.LogConfiguration;
          const ec2LogConfig = ec2Container.LogConfiguration;

          expect(fargateLogConfig.LogDriver).toBe(ec2LogConfig.LogDriver);
          expect(fargateLogConfig.LogDriver).toBe("awslogs");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the EC2 task definition
     * SHALL have the ComputeType tag set to "ec2".
     *
     * **Validates: Requirements 7.1**
     */
    test("should have ComputeType tag set to ec2 for EC2 task definition", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const tags = ec2TaskDef.Tags || [];
          const computeTypeTag = tags.find((tag) => tag.Key === "ComputeType");

          expect(computeTypeTag).toBeDefined();
          expect(computeTypeTag?.Value).toBe("ec2");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the image parameter reference
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical image parameter reference between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Both should reference the ContainerImage parameter
          expect(JSON.stringify(fargateContainer.Image)).toBe(
            JSON.stringify(ec2Container.Image)
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the execution role ARN
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical execution role ARN between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          expect(JSON.stringify(fargateTaskDef.ExecutionRoleArn)).toBe(
            JSON.stringify(ec2TaskDef.ExecutionRoleArn)
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the task role ARN
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical task role ARN between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          expect(JSON.stringify(fargateTaskDef.TaskRoleArn)).toBe(
            JSON.stringify(ec2TaskDef.TaskRoleArn)
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid health check configuration, the resolved health check
     * command SHALL produce identical curl commands for both EC2 and Fargate.
     *
     * **Validates: Requirements 7.5**
     */
    test("should produce identical resolved health check commands", () => {
      fc.assert(
        fc.property(containerConfigArb, (config) => {
          const fargateCommand = fargateContainer.HealthCheck.Command;
          const ec2Command = ec2Container.HealthCheck.Command;

          // Resolve the commands with the same configuration
          const resolvedFargate = resolveHealthCheckCommand(fargateCommand, config);
          const resolvedEc2 = resolveHealthCheckCommand(ec2Command, config);

          // Both should produce the same resolved command
          expect(resolvedFargate).toEqual(resolvedEc2);

          return true;
        }),
        { numRuns: 100 }
      );
    });


    /**
     * Property: For any valid container configuration, the environment variables
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical environment variables between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          const fargateEnv = fargateContainer.Environment;
          const ec2Env = ec2Container.Environment;

          expect(fargateEnv.length).toBe(ec2Env.length);

          // Compare each environment variable by name
          for (const fargateVar of fargateEnv) {
            const ec2Var = ec2Env.find((v) => v.Name === fargateVar.Name);
            expect(ec2Var).toBeDefined();
            expect(JSON.stringify(ec2Var?.Value)).toBe(JSON.stringify(fargateVar.Value));
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, both task definitions
     * SHALL use the same network mode (awsvpc) for ALB integration.
     *
     * **Validates: Requirements 7.3**
     */
    test("should both use awsvpc network mode for ALB integration", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          // Both Fargate and EC2 should use awsvpc for ALB integration
          expect(fargateTaskDef.NetworkMode).toBe("awsvpc");
          expect(ec2TaskDef.NetworkMode).toBe("awsvpc");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid container configuration, the container name
     * SHALL be identical between EC2 and Fargate task definitions.
     *
     * **Validates: Requirements 7.1**
     */
    test("should have identical container name between EC2 and Fargate", () => {
      fc.assert(
        fc.property(containerConfigArb, (_config) => {
          expect(JSON.stringify(fargateContainer.Name)).toBe(
            JSON.stringify(ec2Container.Name)
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
