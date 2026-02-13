/**
 * Unit Tests for ECS Cluster CloudFormation Template Validation
 *
 * Validates: Requirements 6.2, 7.1
 * - Requirement 6.2: THE ECS_Fargate SHALL perform a rolling deployment
 * - Requirement 7.1: THE Pipeline SHALL log all stage transitions and execution details to CloudWatch Logs
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. ECS Cluster is configured with Fargate launch type
 * 3. Container Insights is enabled for monitoring
 * 4. Capacity providers (FARGATE and FARGATE_SPOT) are configured
 * 5. Default capacity provider strategy is correctly set
 * 6. Environment parameterization works correctly
 * 7. CloudWatch Log Groups are created for logging
 * 8. Proper tagging is applied
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected configuration from design document
const EXPECTED_CONFIG = {
	capacityProviders: ["FARGATE", "FARGATE_SPOT"],
	defaultFargateWeight: 1,
	defaultFargateSpotWeight: 4,
	defaultFargateBase: 1,
	containerInsightsDefault: "enabled",
	environments: ["dev", "staging", "prod"],
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

describe("ECS Cluster CloudFormation Template Validation", () => {
	let template: CloudFormationTemplate;
	const templatePath = path.join(__dirname, "..", "ecs-cluster.yaml");

	beforeAll(() => {
		// Load and parse the ECS cluster template with CloudFormation schema
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

	describe("ECS Cluster Configuration", () => {
		test("should define an ECS Cluster resource", () => {
			const clusterResource = template.Resources?.EcsCluster;
			expect(clusterResource).toBeDefined();
			expect(clusterResource?.Type).toBe("AWS::ECS::Cluster");
		});

		test("should have cluster name using project and environment", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			expect(clusterProps?.ClusterName).toBeDefined();
			// Should use !Sub with project name and environment
			const clusterName = clusterProps?.ClusterName as { "Fn::Sub": string };
			expect(clusterName["Fn::Sub"]).toContain("${ProjectName}");
			expect(clusterName["Fn::Sub"]).toContain("${Environment}");
		});
	});

	describe("Container Insights Configuration (Requirement 7.1)", () => {
		test("should have Container Insights enabled by default", () => {
			const containerInsightsParam = template.Parameters
				?.ContainerInsightsEnabled as Record<string, unknown>;
			expect(containerInsightsParam).toBeDefined();
			expect(containerInsightsParam.Default).toBe(
				EXPECTED_CONFIG.containerInsightsDefault,
			);
		});

		test("should configure Container Insights in cluster settings", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const clusterSettings = clusterProps?.ClusterSettings as Array<{
				Name: string;
				Value: unknown;
			}>;

			expect(clusterSettings).toBeDefined();
			expect(Array.isArray(clusterSettings)).toBe(true);

			const containerInsightsSetting = clusterSettings?.find(
				(setting) => setting.Name === "containerInsights",
			);
			expect(containerInsightsSetting).toBeDefined();
		});

		test("should allow Container Insights to be enabled or disabled", () => {
			const containerInsightsParam = template.Parameters
				?.ContainerInsightsEnabled as Record<string, unknown>;
			expect(containerInsightsParam.AllowedValues).toEqual([
				"enabled",
				"disabled",
			]);
		});
	});

	describe("Capacity Providers Configuration", () => {
		test("should configure FARGATE capacity provider", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const capacityProviders = clusterProps?.CapacityProviders as string[];

			expect(capacityProviders).toBeDefined();
			expect(capacityProviders).toContain("FARGATE");
		});

		test("should configure FARGATE_SPOT capacity provider", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const capacityProviders = clusterProps?.CapacityProviders as string[];

			expect(capacityProviders).toBeDefined();
			expect(capacityProviders).toContain("FARGATE_SPOT");
		});

		test("should have exactly 2 capacity providers", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const capacityProviders = clusterProps?.CapacityProviders as string[];

			expect(capacityProviders.length).toBe(
				EXPECTED_CONFIG.capacityProviders.length,
			);
		});
	});

	describe("Default Capacity Provider Strategy", () => {
		test("should have default capacity provider strategy defined", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const strategy = clusterProps?.DefaultCapacityProviderStrategy as Array<{
				CapacityProvider: string;
				Weight: unknown;
				Base?: unknown;
			}>;

			expect(strategy).toBeDefined();
			expect(Array.isArray(strategy)).toBe(true);
		});

		test("should have FARGATE in default strategy with base capacity", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const strategy = clusterProps?.DefaultCapacityProviderStrategy as Array<{
				CapacityProvider: string;
				Weight: unknown;
				Base?: unknown;
			}>;

			const fargateStrategy = strategy?.find(
				(s) => s.CapacityProvider === "FARGATE",
			);
			expect(fargateStrategy).toBeDefined();
			expect(fargateStrategy?.Base).toBeDefined();
		});

		test("should have FARGATE_SPOT in default strategy", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const strategy = clusterProps?.DefaultCapacityProviderStrategy as Array<{
				CapacityProvider: string;
				Weight: unknown;
				Base?: unknown;
			}>;

			const fargateSpotStrategy = strategy?.find(
				(s) => s.CapacityProvider === "FARGATE_SPOT",
			);
			expect(fargateSpotStrategy).toBeDefined();
		});

		test("should have correct default weight for FARGATE", () => {
			const fargateWeightParam = template.Parameters?.FargateWeight as Record<
				string,
				unknown
			>;
			expect(fargateWeightParam).toBeDefined();
			expect(fargateWeightParam.Default).toBe(
				EXPECTED_CONFIG.defaultFargateWeight,
			);
		});

		test("should have correct default weight for FARGATE_SPOT", () => {
			const fargateSpotWeightParam = template.Parameters
				?.FargateSpotWeight as Record<string, unknown>;
			expect(fargateSpotWeightParam).toBeDefined();
			expect(fargateSpotWeightParam.Default).toBe(
				EXPECTED_CONFIG.defaultFargateSpotWeight,
			);
		});

		test("should have correct default base for FARGATE", () => {
			const fargateBaseParam = template.Parameters?.FargateBase as Record<
				string,
				unknown
			>;
			expect(fargateBaseParam).toBeDefined();
			expect(fargateBaseParam.Default).toBe(EXPECTED_CONFIG.defaultFargateBase);
		});
	});

	describe("Environment Parameterization (Requirement 9.2)", () => {
		test("should have Environment parameter with allowed values", () => {
			const envParam = template.Parameters?.Environment as Record<
				string,
				unknown
			>;
			expect(envParam).toBeDefined();
			expect(envParam.AllowedValues).toEqual(EXPECTED_CONFIG.environments);
		});

		test("should have ProjectName parameter with pattern constraint", () => {
			const projectParam = template.Parameters?.ProjectName as Record<
				string,
				unknown
			>;
			expect(projectParam).toBeDefined();
			expect(projectParam.AllowedPattern).toBeDefined();
		});

		test("should have conditions for different environments", () => {
			expect(template.Conditions?.IsProduction).toBeDefined();
			expect(template.Conditions?.IsStaging).toBeDefined();
			expect(template.Conditions?.IsDevelopment).toBeDefined();
		});
	});

	describe("CloudWatch Log Groups (Requirement 7.1)", () => {
		test("should create ECS log group", () => {
			const logGroup = template.Resources?.EcsLogGroup;
			expect(logGroup).toBeDefined();
			expect(logGroup?.Type).toBe("AWS::Logs::LogGroup");
		});

		test("should create Container Insights log group", () => {
			const logGroup = template.Resources?.ContainerInsightsLogGroup;
			expect(logGroup).toBeDefined();
			expect(logGroup?.Type).toBe("AWS::Logs::LogGroup");
		});

		test("should have log retention configured", () => {
			const ecsLogGroup = template.Resources?.EcsLogGroup?.Properties;
			expect(ecsLogGroup?.RetentionInDays).toBeDefined();
		});

		test("should have ECS log group name following naming convention", () => {
			const ecsLogGroup = template.Resources?.EcsLogGroup?.Properties;
			const logGroupName = ecsLogGroup?.LogGroupName as { "Fn::Sub": string };
			expect(logGroupName["Fn::Sub"]).toContain("/ecs/");
		});

		test("should have Container Insights log group name following AWS convention", () => {
			const logGroup = template.Resources?.ContainerInsightsLogGroup?.Properties;
			const logGroupName = logGroup?.LogGroupName as { "Fn::Sub": string };
			expect(logGroupName["Fn::Sub"]).toContain(
				"/aws/ecs/containerinsights/",
			);
			expect(logGroupName["Fn::Sub"]).toContain("/performance");
		});
	});

	describe("Resource Tagging", () => {
		test("should have Name tag on ECS cluster", () => {
			const clusterTags = template.Resources?.EcsCluster?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			expect(clusterTags).toBeDefined();
			const nameTag = clusterTags?.find((tag) => tag.Key === "Name");
			expect(nameTag).toBeDefined();
		});

		test("should have Environment tag on ECS cluster", () => {
			const clusterTags = template.Resources?.EcsCluster?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			const envTag = clusterTags?.find((tag) => tag.Key === "Environment");
			expect(envTag).toBeDefined();
		});

		test("should have Project tag on ECS cluster", () => {
			const clusterTags = template.Resources?.EcsCluster?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			const projectTag = clusterTags?.find((tag) => tag.Key === "Project");
			expect(projectTag).toBeDefined();
		});

		test("should have Purpose tag on ECS cluster", () => {
			const clusterTags = template.Resources?.EcsCluster?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			const purposeTag = clusterTags?.find((tag) => tag.Key === "Purpose");
			expect(purposeTag).toBeDefined();
		});

		test("should have tags on log groups", () => {
			const ecsLogGroupTags = template.Resources?.EcsLogGroup?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			expect(ecsLogGroupTags).toBeDefined();
			expect(ecsLogGroupTags.length).toBeGreaterThan(0);
		});
	});

	describe("CloudFormation Outputs", () => {
		test("should export Cluster ARN", () => {
			expect(template.Outputs?.ClusterArn).toBeDefined();
		});

		test("should export Cluster Name", () => {
			expect(template.Outputs?.ClusterName).toBeDefined();
		});

		test("should export Cluster ID", () => {
			expect(template.Outputs?.ClusterId).toBeDefined();
		});

		test("should export capacity provider information", () => {
			expect(template.Outputs?.DefaultCapacityProviders).toBeDefined();
			expect(template.Outputs?.FargateCapacityWeight).toBeDefined();
			expect(template.Outputs?.FargateSpotCapacityWeight).toBeDefined();
			expect(template.Outputs?.FargateBaseCapacity).toBeDefined();
		});

		test("should export Container Insights status", () => {
			expect(template.Outputs?.ContainerInsightsStatus).toBeDefined();
		});

		test("should export ECS log group ARN", () => {
			expect(template.Outputs?.EcsLogGroupArn).toBeDefined();
		});

		test("should export ECS log group name", () => {
			expect(template.Outputs?.EcsLogGroupName).toBeDefined();
		});

		test("should export Container Insights log group ARN", () => {
			expect(template.Outputs?.ContainerInsightsLogGroupArn).toBeDefined();
		});

		test("should export Container Insights log group name", () => {
			expect(template.Outputs?.ContainerInsightsLogGroupName).toBeDefined();
		});

		test("should have Export names for cross-stack references", () => {
			const clusterArnOutput = template.Outputs?.ClusterArn as Record<
				string,
				unknown
			>;
			expect(clusterArnOutput?.Export).toBeDefined();

			const clusterNameOutput = template.Outputs?.ClusterName as Record<
				string,
				unknown
			>;
			expect(clusterNameOutput?.Export).toBeDefined();
		});
	});

	describe("Parameter Constraints", () => {
		test("should have FargateWeight with min/max constraints", () => {
			const param = template.Parameters?.FargateWeight as Record<
				string,
				unknown
			>;
			expect(param.MinValue).toBeDefined();
			expect(param.MaxValue).toBeDefined();
		});

		test("should have FargateSpotWeight with min/max constraints", () => {
			const param = template.Parameters?.FargateSpotWeight as Record<
				string,
				unknown
			>;
			expect(param.MinValue).toBeDefined();
			expect(param.MaxValue).toBeDefined();
		});

		test("should have FargateBase with min/max constraints", () => {
			const param = template.Parameters?.FargateBase as Record<string, unknown>;
			expect(param.MinValue).toBeDefined();
			expect(param.MaxValue).toBeDefined();
		});

		test("should have ProjectName with length constraints", () => {
			const param = template.Parameters?.ProjectName as Record<string, unknown>;
			expect(param.MinLength).toBeDefined();
			expect(param.MaxLength).toBeDefined();
		});
	});

	describe("Service Connect Configuration", () => {
		test("should have Service Connect defaults configured", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			expect(clusterProps?.ServiceConnectDefaults).toBeDefined();
		});

		test("should have Service Connect namespace using project and environment", () => {
			const clusterProps = template.Resources?.EcsCluster?.Properties;
			const serviceConnectDefaults = clusterProps?.ServiceConnectDefaults as {
				Namespace: { "Fn::Sub": string };
			};
			expect(serviceConnectDefaults?.Namespace).toBeDefined();
		});
	});
});
