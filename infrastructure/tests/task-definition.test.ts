/**
 * Unit Tests for ECS Task Definition CloudFormation Template Validation
 *
 * Validates: Requirements 6.5, 8.4, 7.1
 * - Requirement 6.5: THE Task_Definition SHALL configure appropriate CPU and memory limits
 * - Requirement 8.4: THE ECS_Fargate SHALL inject secrets as environment variables from Secrets Manager
 * - Requirement 7.1: THE Pipeline SHALL log all stage transitions and execution details to CloudWatch Logs
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. Task definition is Fargate compatible
 * 3. CPU (512) and memory (1024) are correctly configured
 * 4. Health check is configured for /health endpoint
 * 5. Secrets injection from Secrets Manager is configured
 * 6. CloudWatch Logs configuration is present
 * 7. Environment parameterization works correctly
 * 8. Proper tagging is applied
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected configuration from design document
const EXPECTED_CONFIG = {
  taskCpu: "512",
  taskMemory: "1024",
  containerPort: 80,
  healthCheckPath: "/health",
  healthCheckInterval: 30,
  healthCheckTimeout: 5,
  healthCheckRetries: 3,
  healthCheckStartPeriod: 60,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  environments: ["dev", "staging", "prod"],
  secrets: [
    "ConnectionStrings__PoultrySale",
    "ConnectionStrings__MasterDb"
  ]
};

// Type definitions for CloudFormation template structure
interface CloudFormationResource {
  Type: string;
  Properties?: Record<string, unknown>;
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

// Custom YAML types for CloudFormation intrinsic functions
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

// Create custom schema with CloudFormation intrinsic functions
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


describe("ECS Task Definition CloudFormation Template Validation", () => {
  let template: CloudFormationTemplate;
  const templatePath = path.join(__dirname, "..", "task-definition.yaml");

  beforeAll(() => {
    // Load and parse the task definition template with CloudFormation schema
    const templateContent = fs.readFileSync(templatePath, "utf8");
    template = yaml.load(templateContent, {
      schema: CFN_SCHEMA,
    }) as CloudFormationTemplate;
  });

  describe("Template Structure Validation", () => {
    test("should be valid YAML and parseable", () => {
      expect(template).toBeDefined();
      expect(typeof template).toBe("object");
    });

    test("should have valid CloudFormation version", () => {
      expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    });

    test("should have a description", () => {
      expect(template.Description).toBeDefined();
      expect(typeof template.Description).toBe("string");
      expect(template.Description!.length).toBeGreaterThan(0);
    });

    test("should have Resources section", () => {
      expect(template.Resources).toBeDefined();
      expect(typeof template.Resources).toBe("object");
    });

    test("should have Outputs section", () => {
      expect(template.Outputs).toBeDefined();
      expect(typeof template.Outputs).toBe("object");
    });

    test("should have Parameters section", () => {
      expect(template.Parameters).toBeDefined();
      expect(typeof template.Parameters).toBe("object");
    });

    test("should have Conditions section", () => {
      expect(template.Conditions).toBeDefined();
      expect(typeof template.Conditions).toBe("object");
    });
  });

  describe("Task Definition Resource", () => {
    test("should define an ECS Task Definition resource", () => {
      const taskDefResource = template.Resources?.TaskDefinition;
      expect(taskDefResource).toBeDefined();
      expect(taskDefResource?.Type).toBe("AWS::ECS::TaskDefinition");
    });

    test("should have task family using project and environment", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      expect(taskDefProps?.Family).toBeDefined();
      const family = taskDefProps?.Family as { "Fn::Sub": string };
      expect(family["Fn::Sub"]).toContain("${ProjectName}");
      expect(family["Fn::Sub"]).toContain("${Environment}");
    });

    test("should depend on TaskLogGroup", () => {
      const taskDef = template.Resources?.TaskDefinition;
      expect(taskDef?.DependsOn).toBe("TaskLogGroup");
    });
  });


  describe("Fargate Compatibility (Requirement 6.5)", () => {
    test("should have awsvpc network mode", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      expect(taskDefProps?.NetworkMode).toBe(EXPECTED_CONFIG.networkMode);
    });

    test("should require FARGATE compatibility", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const compatibilities = taskDefProps?.RequiresCompatibilities as string[];
      expect(compatibilities).toBeDefined();
      expect(compatibilities).toContain("FARGATE");
    });

    test("should have RuntimePlatform configured for Linux x86_64", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const runtimePlatform = taskDefProps?.RuntimePlatform as Record<string, string>;
      expect(runtimePlatform).toBeDefined();
      expect(runtimePlatform.CpuArchitecture).toBe("X86_64");
      expect(runtimePlatform.OperatingSystemFamily).toBe("LINUX");
    });
  });

  describe("CPU and Memory Configuration (Requirement 6.5)", () => {
    test("should have default CPU of 512", () => {
      const cpuParam = template.Parameters?.TaskCpu as Record<string, unknown>;
      expect(cpuParam).toBeDefined();
      expect(cpuParam.Default).toBe(EXPECTED_CONFIG.taskCpu);
    });

    test("should have default memory of 1024", () => {
      const memoryParam = template.Parameters?.TaskMemory as Record<string, unknown>;
      expect(memoryParam).toBeDefined();
      expect(memoryParam.Default).toBe(EXPECTED_CONFIG.taskMemory);
    });

    test("should have CPU parameter with allowed Fargate values", () => {
      const cpuParam = template.Parameters?.TaskCpu as Record<string, unknown>;
      const allowedValues = cpuParam.AllowedValues as string[];
      expect(allowedValues).toContain("256");
      expect(allowedValues).toContain("512");
      expect(allowedValues).toContain("1024");
      expect(allowedValues).toContain("2048");
      expect(allowedValues).toContain("4096");
    });

    test("should have memory parameter with allowed Fargate values", () => {
      const memoryParam = template.Parameters?.TaskMemory as Record<string, unknown>;
      const allowedValues = memoryParam.AllowedValues as string[];
      expect(allowedValues).toContain("512");
      expect(allowedValues).toContain("1024");
      expect(allowedValues).toContain("2048");
    });

    test("should reference CPU parameter in task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const cpu = taskDefProps?.Cpu as { Ref: string };
      expect(cpu.Ref).toBe("TaskCpu");
    });

    test("should reference memory parameter in task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const memory = taskDefProps?.Memory as { Ref: string };
      expect(memory.Ref).toBe("TaskMemory");
    });
  });


  describe("Container Definition", () => {
    test("should have container definitions array", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as unknown[];
      expect(containerDefs).toBeDefined();
      expect(Array.isArray(containerDefs)).toBe(true);
      expect(containerDefs.length).toBeGreaterThan(0);
    });

    test("should have container name using project and environment", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const name = container.Name as { "Fn::Sub": string };
      expect(name["Fn::Sub"]).toContain("${ProjectName}");
      expect(name["Fn::Sub"]).toContain("${Environment}");
    });

    test("should have container marked as essential", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      expect(container.Essential).toBe(true);
    });

    test("should have port mappings configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const portMappings = container.PortMappings as Array<Record<string, unknown>>;
      expect(portMappings).toBeDefined();
      expect(portMappings.length).toBeGreaterThan(0);
    });

    test("should have container port referencing parameter", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const portMappings = container.PortMappings as Array<Record<string, unknown>>;
      const portMapping = portMappings[0];
      const containerPort = portMapping.ContainerPort as { Ref: string };
      expect(containerPort.Ref).toBe("ContainerPort");
    });

    test("should have TCP protocol for port mapping", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const portMappings = container.PortMappings as Array<Record<string, unknown>>;
      const portMapping = portMappings[0];
      expect(portMapping.Protocol).toBe("tcp");
    });

    test("should have default container port of 80", () => {
      const portParam = template.Parameters?.ContainerPort as Record<string, unknown>;
      expect(portParam).toBeDefined();
      expect(portParam.Default).toBe(EXPECTED_CONFIG.containerPort);
    });
  });


  describe("Health Check Configuration", () => {
    test("should have health check configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      expect(container.HealthCheck).toBeDefined();
    });

    test("should have health check command using curl", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const healthCheck = container.HealthCheck as Record<string, unknown>;
      const command = healthCheck.Command as string[];
      expect(command).toBeDefined();
      expect(command[0]).toBe("CMD-SHELL");
    });

    test("should have default health check path of /health", () => {
      const healthCheckPathParam = template.Parameters?.HealthCheckPath as Record<string, unknown>;
      expect(healthCheckPathParam).toBeDefined();
      expect(healthCheckPathParam.Default).toBe(EXPECTED_CONFIG.healthCheckPath);
    });

    test("should have default health check interval of 30 seconds", () => {
      const intervalParam = template.Parameters?.HealthCheckInterval as Record<string, unknown>;
      expect(intervalParam).toBeDefined();
      expect(intervalParam.Default).toBe(EXPECTED_CONFIG.healthCheckInterval);
    });

    test("should have default health check timeout of 5 seconds", () => {
      const timeoutParam = template.Parameters?.HealthCheckTimeout as Record<string, unknown>;
      expect(timeoutParam).toBeDefined();
      expect(timeoutParam.Default).toBe(EXPECTED_CONFIG.healthCheckTimeout);
    });

    test("should have default health check retries of 3", () => {
      const retriesParam = template.Parameters?.HealthCheckRetries as Record<string, unknown>;
      expect(retriesParam).toBeDefined();
      expect(retriesParam.Default).toBe(EXPECTED_CONFIG.healthCheckRetries);
    });

    test("should have default health check start period of 60 seconds", () => {
      const startPeriodParam = template.Parameters?.HealthCheckStartPeriod as Record<string, unknown>;
      expect(startPeriodParam).toBeDefined();
      expect(startPeriodParam.Default).toBe(EXPECTED_CONFIG.healthCheckStartPeriod);
    });

    test("should reference health check parameters in container definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const healthCheck = container.HealthCheck as Record<string, unknown>;

      const interval = healthCheck.Interval as { Ref: string };
      expect(interval.Ref).toBe("HealthCheckInterval");

      const timeout = healthCheck.Timeout as { Ref: string };
      expect(timeout.Ref).toBe("HealthCheckTimeout");

      const retries = healthCheck.Retries as { Ref: string };
      expect(retries.Ref).toBe("HealthCheckRetries");

      const startPeriod = healthCheck.StartPeriod as { Ref: string };
      expect(startPeriod.Ref).toBe("HealthCheckStartPeriod");
    });
  });


  describe("Secrets Injection (Requirement 8.4)", () => {
    test("should have secrets array in container definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const secrets = container.Secrets as unknown[];
      expect(secrets).toBeDefined();
      expect(Array.isArray(secrets)).toBe(true);
    });

    test("should have ConnectionStrings__PoultrySale secret", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const secrets = container.Secrets as Array<Record<string, unknown>>;

      const poultrySaleSecret = secrets.find(s => s.Name === "ConnectionStrings__PoultrySale");
      expect(poultrySaleSecret).toBeDefined();
    });

    test("should have ConnectionStrings__MasterDb secret", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const secrets = container.Secrets as Array<Record<string, unknown>>;

      const masterDbSecret = secrets.find(s => s.Name === "ConnectionStrings__MasterDb");
      expect(masterDbSecret).toBeDefined();
    });

    test("should have exactly 2 secrets configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const secrets = container.Secrets as unknown[];
      expect(secrets.length).toBe(EXPECTED_CONFIG.secrets.length);
    });

    test("secrets should reference Secrets Manager ARNs", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const secrets = container.Secrets as Array<Record<string, unknown>>;

      secrets.forEach(secret => {
        expect(secret.ValueFrom).toBeDefined();
        // ValueFrom should be a Fn::Sub construct referencing Secrets Manager
        const valueFrom = secret.ValueFrom as { "Fn::Sub": unknown };
        expect(valueFrom["Fn::Sub"]).toBeDefined();
      });
    });
  });


  describe("CloudWatch Logs Configuration (Requirement 7.1)", () => {
    test("should create CloudWatch Log Group", () => {
      const logGroup = template.Resources?.TaskLogGroup;
      expect(logGroup).toBeDefined();
      expect(logGroup?.Type).toBe("AWS::Logs::LogGroup");
    });

    test("should have log group name following ECS naming convention", () => {
      const logGroupProps = template.Resources?.TaskLogGroup?.Properties;
      const logGroupName = logGroupProps?.LogGroupName as { "Fn::Sub": string };
      expect(logGroupName["Fn::Sub"]).toContain("/ecs/");
    });

    test("should have log retention configured", () => {
      const logGroupProps = template.Resources?.TaskLogGroup?.Properties;
      expect(logGroupProps?.RetentionInDays).toBeDefined();
    });

    test("should have awslogs log driver in container definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const logConfig = container.LogConfiguration as Record<string, unknown>;
      expect(logConfig).toBeDefined();
      expect(logConfig.LogDriver).toBe("awslogs");
    });

    test("should have awslogs options configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const logConfig = container.LogConfiguration as Record<string, unknown>;
      const options = logConfig.Options as Record<string, unknown>;

      expect(options["awslogs-group"]).toBeDefined();
      expect(options["awslogs-region"]).toBeDefined();
      expect(options["awslogs-stream-prefix"]).toBe("ecs");
    });

    test("should reference log group in container log configuration", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const logConfig = container.LogConfiguration as Record<string, unknown>;
      const options = logConfig.Options as Record<string, unknown>;

      const logGroup = options["awslogs-group"] as { Ref: string };
      expect(logGroup.Ref).toBe("TaskLogGroup");
    });
  });


  describe("IAM Roles Configuration", () => {
    test("should have execution role ARN configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      expect(taskDefProps?.ExecutionRoleArn).toBeDefined();
    });

    test("should have task role ARN configured", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      expect(taskDefProps?.TaskRoleArn).toBeDefined();
    });

    test("execution role should reference project and environment", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const executionRole = taskDefProps?.ExecutionRoleArn as { "Fn::Sub": string };
      expect(executionRole["Fn::Sub"]).toContain("${ProjectName}");
      expect(executionRole["Fn::Sub"]).toContain("${Environment}");
      expect(executionRole["Fn::Sub"]).toContain("ecs-execution-role");
    });

    test("task role should reference project and environment", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const taskRole = taskDefProps?.TaskRoleArn as { "Fn::Sub": string };
      expect(taskRole["Fn::Sub"]).toContain("${ProjectName}");
      expect(taskRole["Fn::Sub"]).toContain("${Environment}");
      expect(taskRole["Fn::Sub"]).toContain("ecs-task-role");
    });
  });

  describe("Environment Variables", () => {
    test("should have environment variables array in container definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const environment = container.Environment as unknown[];
      expect(environment).toBeDefined();
      expect(Array.isArray(environment)).toBe(true);
    });

    test("should have ASPNETCORE_ENVIRONMENT variable", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const environment = container.Environment as Array<Record<string, unknown>>;

      const aspnetEnv = environment.find(e => e.Name === "ASPNETCORE_ENVIRONMENT");
      expect(aspnetEnv).toBeDefined();
    });

    test("should have ASPNETCORE_URLS variable", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const environment = container.Environment as Array<Record<string, unknown>>;

      const aspnetUrls = environment.find(e => e.Name === "ASPNETCORE_URLS");
      expect(aspnetUrls).toBeDefined();
    });

    test("should have DOTNET_CLI_TELEMETRY_OPTOUT variable", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const environment = container.Environment as Array<Record<string, unknown>>;

      const telemetryOptout = environment.find(e => e.Name === "DOTNET_CLI_TELEMETRY_OPTOUT");
      expect(telemetryOptout).toBeDefined();
      expect(telemetryOptout?.Value).toBe("1");
    });
  });


  describe("Environment Parameterization (Requirement 9.2)", () => {
    test("should have Environment parameter with allowed values", () => {
      const envParam = template.Parameters?.Environment as Record<string, unknown>;
      expect(envParam).toBeDefined();
      expect(envParam.AllowedValues).toEqual(EXPECTED_CONFIG.environments);
    });

    test("should have ProjectName parameter with pattern constraint", () => {
      const projectParam = template.Parameters?.ProjectName as Record<string, unknown>;
      expect(projectParam).toBeDefined();
      expect(projectParam.AllowedPattern).toBeDefined();
    });

    test("should have conditions for different environments", () => {
      expect(template.Conditions?.IsProduction).toBeDefined();
      expect(template.Conditions?.IsStaging).toBeDefined();
      expect(template.Conditions?.IsDevelopment).toBeDefined();
    });

    test("should have ContainerImage parameter for CI/CD updates", () => {
      const imageParam = template.Parameters?.ContainerImage as Record<string, unknown>;
      expect(imageParam).toBeDefined();
      expect(imageParam.Default).toBeDefined();
    });
  });

  describe("Resource Tagging", () => {
    test("should have tags on task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const tags = taskDefProps?.Tags as Array<{ Key: string; Value: unknown }>;
      expect(tags).toBeDefined();
      expect(tags.length).toBeGreaterThan(0);
    });

    test("should have Name tag on task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const tags = taskDefProps?.Tags as Array<{ Key: string; Value: unknown }>;
      const nameTag = tags?.find(tag => tag.Key === "Name");
      expect(nameTag).toBeDefined();
    });

    test("should have Environment tag on task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const tags = taskDefProps?.Tags as Array<{ Key: string; Value: unknown }>;
      const envTag = tags?.find(tag => tag.Key === "Environment");
      expect(envTag).toBeDefined();
    });

    test("should have Project tag on task definition", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const tags = taskDefProps?.Tags as Array<{ Key: string; Value: unknown }>;
      const projectTag = tags?.find(tag => tag.Key === "Project");
      expect(projectTag).toBeDefined();
    });

    test("should have tags on log group", () => {
      const logGroupProps = template.Resources?.TaskLogGroup?.Properties;
      const tags = logGroupProps?.Tags as Array<{ Key: string; Value: unknown }>;
      expect(tags).toBeDefined();
      expect(tags.length).toBeGreaterThan(0);
    });
  });


  describe("CloudFormation Outputs", () => {
    test("should export Task Definition ARN", () => {
      expect(template.Outputs?.TaskDefinitionArn).toBeDefined();
    });

    test("should export Task Definition Family", () => {
      expect(template.Outputs?.TaskDefinitionFamily).toBeDefined();
    });

    test("should export Container Name", () => {
      expect(template.Outputs?.ContainerName).toBeDefined();
    });

    test("should export Container Port", () => {
      expect(template.Outputs?.ContainerPort).toBeDefined();
    });

    test("should export Task CPU", () => {
      expect(template.Outputs?.TaskCpu).toBeDefined();
    });

    test("should export Task Memory", () => {
      expect(template.Outputs?.TaskMemory).toBeDefined();
    });

    test("should export Health Check Path", () => {
      expect(template.Outputs?.HealthCheckPath).toBeDefined();
    });

    test("should export Task Log Group ARN", () => {
      expect(template.Outputs?.TaskLogGroupArn).toBeDefined();
    });

    test("should export Task Log Group Name", () => {
      expect(template.Outputs?.TaskLogGroupName).toBeDefined();
    });

    test("should export Execution Role ARN", () => {
      expect(template.Outputs?.ExecutionRoleArn).toBeDefined();
    });

    test("should export Task Role ARN", () => {
      expect(template.Outputs?.TaskRoleArn).toBeDefined();
    });

    test("should have Export names for cross-stack references", () => {
      const taskDefArnOutput = template.Outputs?.TaskDefinitionArn as Record<string, unknown>;
      expect(taskDefArnOutput?.Export).toBeDefined();

      const containerNameOutput = template.Outputs?.ContainerName as Record<string, unknown>;
      expect(containerNameOutput?.Export).toBeDefined();
    });
  });

  describe("Security Configuration", () => {
    test("should have privileged mode disabled", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      expect(container.Privileged).toBe(false);
    });

    test("should have Linux parameters with init process enabled", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const linuxParams = container.LinuxParameters as Record<string, unknown>;
      expect(linuxParams).toBeDefined();
      expect(linuxParams.InitProcessEnabled).toBe(true);
    });

    test("should have ulimits configured for nofile", () => {
      const taskDefProps = template.Resources?.TaskDefinition?.Properties;
      const containerDefs = taskDefProps?.ContainerDefinitions as Array<Record<string, unknown>>;
      const container = containerDefs[0];
      const ulimits = container.Ulimits as Array<Record<string, unknown>>;
      expect(ulimits).toBeDefined();

      const nofileLimit = ulimits.find(u => u.Name === "nofile");
      expect(nofileLimit).toBeDefined();
    });
  });

  describe("Parameter Constraints", () => {
    test("should have HealthCheckInterval with min/max constraints", () => {
      const param = template.Parameters?.HealthCheckInterval as Record<string, unknown>;
      expect(param.MinValue).toBeDefined();
      expect(param.MaxValue).toBeDefined();
    });

    test("should have HealthCheckTimeout with min/max constraints", () => {
      const param = template.Parameters?.HealthCheckTimeout as Record<string, unknown>;
      expect(param.MinValue).toBeDefined();
      expect(param.MaxValue).toBeDefined();
    });

    test("should have HealthCheckRetries with min/max constraints", () => {
      const param = template.Parameters?.HealthCheckRetries as Record<string, unknown>;
      expect(param.MinValue).toBeDefined();
      expect(param.MaxValue).toBeDefined();
    });

    test("should have HealthCheckStartPeriod with min/max constraints", () => {
      const param = template.Parameters?.HealthCheckStartPeriod as Record<string, unknown>;
      expect(param.MinValue).toBeDefined();
      expect(param.MaxValue).toBeDefined();
    });

    test("should have ContainerPort with min/max constraints", () => {
      const param = template.Parameters?.ContainerPort as Record<string, unknown>;
      expect(param.MinValue).toBeDefined();
      expect(param.MaxValue).toBeDefined();
    });

    test("should have HealthCheckPath with pattern constraint", () => {
      const param = template.Parameters?.HealthCheckPath as Record<string, unknown>;
      expect(param.AllowedPattern).toBeDefined();
    });

    test("should have LogRetentionDays with allowed values", () => {
      const param = template.Parameters?.LogRetentionDays as Record<string, unknown>;
      expect(param.AllowedValues).toBeDefined();
      const allowedValues = param.AllowedValues as number[];
      expect(allowedValues).toContain(30);
      expect(allowedValues).toContain(90);
    });
  });
});
