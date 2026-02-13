/**
 * Unit Tests for IAM Roles and Policies CloudFormation Template Validation
 *
 * Validates: Requirements 8.5 - THE Pipeline SHALL use IAM roles with least-privilege permissions
 * Validates: Requirements 9.4 - THE templates SHALL include all required IAM roles, policies, and security groups
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. All required IAM roles are defined (CodePipeline, CodeBuild, ECS Execution, ECS Task)
 * 3. Policies follow least-privilege principle (no wildcard resources where specific ARNs are possible)
 * 4. Role ARNs are exported for other stacks
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Type definitions for CloudFormation template structure
interface PolicyStatement {
	Sid?: string;
	Effect: string;
	Action: string | string[];
	Resource: unknown;
	Condition?: Record<string, Record<string, unknown>>;
}

interface PolicyDocument {
	Version: string;
	Statement: PolicyStatement[];
}

interface IamRoleProperties {
	RoleName?: unknown;
	Description?: string;
	AssumeRolePolicyDocument?: {
		Version: string;
		Statement: Array<{
			Effect: string;
			Principal: { Service: string };
			Action: string;
		}>;
	};
	ManagedPolicyArns?: string[];
	Policies?: Array<{ PolicyName: unknown; PolicyDocument: PolicyDocument }>;
	Tags?: Array<{ Key: string; Value: unknown }>;
}

interface IamPolicyProperties {
	PolicyName?: unknown;
	Roles?: Array<{ Ref: string }>;
	PolicyDocument?: PolicyDocument;
}

interface CloudFormationResource {
	Type: string;
	Properties?: IamRoleProperties | IamPolicyProperties;
}

interface CloudFormationTemplate {
	AWSTemplateFormatVersion?: string;
	Description?: string;
	Metadata?: Record<string, unknown>;
	Parameters?: Record<string, unknown>;
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

// Helper function to check if a resource string contains wildcards
function hasWildcardResource(resource: unknown): boolean {
	if (typeof resource === "string") {
		return resource === "*";
	}
	if (Array.isArray(resource)) {
		return resource.some((r) => hasWildcardResource(r));
	}
	if (typeof resource === "object" && resource !== null) {
		const subValue = (resource as { "Fn::Sub"?: string })["Fn::Sub"];
		if (typeof subValue === "string") {
			return subValue === "*";
		}
	}
	return false;
}

// Helper to get policy document from IAM::Policy resource
function getPolicyDocument(
	template: CloudFormationTemplate,
	policyName: string,
): PolicyDocument | undefined {
	const policy = template.Resources?.[policyName];
	if (policy?.Type === "AWS::IAM::Policy") {
		return (policy.Properties as IamPolicyProperties)?.PolicyDocument;
	}
	return undefined;
}

// Helper to get role properties
function getRoleProperties(
	template: CloudFormationTemplate,
	roleName: string,
): IamRoleProperties | undefined {
	const role = template.Resources?.[roleName];
	if (role?.Type === "AWS::IAM::Role") {
		return role.Properties as IamRoleProperties;
	}
	return undefined;
}

describe("IAM Roles and Policies CloudFormation Template Validation", () => {
	let template: CloudFormationTemplate;
	const templatePath = path.join(__dirname, "..", "iam.yaml");

	beforeAll(() => {
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
	});

	describe("Required IAM Roles", () => {
		test("should define CodePipeline Service Role", () => {
			const role = template.Resources?.CodePipelineRole;
			expect(role).toBeDefined();
			expect(role?.Type).toBe("AWS::IAM::Role");
		});

		test("should define CodeBuild Service Role", () => {
			const role = template.Resources?.CodeBuildRole;
			expect(role).toBeDefined();
			expect(role?.Type).toBe("AWS::IAM::Role");
		});

		test("should define ECS Task Execution Role", () => {
			const role = template.Resources?.EcsExecutionRole;
			expect(role).toBeDefined();
			expect(role?.Type).toBe("AWS::IAM::Role");
		});

		test("should define ECS Task Role", () => {
			const role = template.Resources?.EcsTaskRole;
			expect(role).toBeDefined();
			expect(role?.Type).toBe("AWS::IAM::Role");
		});

		test("should have exactly 5 IAM roles", () => {
			const roles = Object.entries(template.Resources || {}).filter(
				([_, resource]) => resource.Type === "AWS::IAM::Role",
			);
			expect(roles.length).toBe(5);
		});

		test("should have exactly 5 IAM policies", () => {
			const policies = Object.entries(template.Resources || {}).filter(
				([_, resource]) => resource.Type === "AWS::IAM::Policy",
			);
			expect(policies.length).toBe(5);
		});
	});

	describe("CodePipeline Role Configuration", () => {
		test("should have correct assume role policy for CodePipeline service", () => {
			const roleProps = getRoleProperties(template, "CodePipelineRole");
			const assumeRolePolicy = roleProps?.AssumeRolePolicyDocument;

			expect(assumeRolePolicy?.Version).toBe("2012-10-17");
			expect(assumeRolePolicy?.Statement).toHaveLength(1);
			expect(assumeRolePolicy?.Statement[0].Effect).toBe("Allow");
			expect(assumeRolePolicy?.Statement[0].Principal.Service).toBe(
				"codepipeline.amazonaws.com",
			);
			expect(assumeRolePolicy?.Statement[0].Action).toBe("sts:AssumeRole");
		});

		test("should have CodeBuild permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const codeBuildStatement = statements.find(
				(s) => s.Sid === "CodeBuildAccess",
			);
			expect(codeBuildStatement).toBeDefined();

			const actions = Array.isArray(codeBuildStatement?.Action)
				? codeBuildStatement?.Action
				: [codeBuildStatement?.Action];
			expect(actions).toContain("codebuild:StartBuild");
			expect(actions).toContain("codebuild:BatchGetBuilds");
		});

		test("should have ECS service permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const ecsStatement = statements.find((s) => s.Sid === "EcsServiceAccess");
			expect(ecsStatement).toBeDefined();

			const actions = Array.isArray(ecsStatement?.Action)
				? ecsStatement?.Action
				: [ecsStatement?.Action];
			expect(actions).toContain("ecs:UpdateService");
			expect(actions).toContain("ecs:DescribeServices");
		});

		test("should have SNS publish permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const snsStatement = statements.find((s) => s.Sid === "SnsPublishAccess");
			expect(snsStatement).toBeDefined();

			const actions = Array.isArray(snsStatement?.Action)
				? snsStatement?.Action
				: [snsStatement?.Action];
			expect(actions).toContain("sns:Publish");
		});

		test("should have IAM PassRole permission for ECS roles", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const passRoleStatement = statements.find(
				(s) => s.Sid === "IamPassRoleAccess",
			);
			expect(passRoleStatement).toBeDefined();

			const actions = Array.isArray(passRoleStatement?.Action)
				? passRoleStatement?.Action
				: [passRoleStatement?.Action];
			expect(actions).toContain("iam:PassRole");
			expect(passRoleStatement?.Condition).toBeDefined();
		});
	});

	describe("CodeBuild Role Configuration", () => {
		test("should have correct assume role policy for CodeBuild service", () => {
			const roleProps = getRoleProperties(template, "CodeBuildRole");
			const assumeRolePolicy = roleProps?.AssumeRolePolicyDocument;

			expect(assumeRolePolicy?.Version).toBe("2012-10-17");
			expect(assumeRolePolicy?.Statement).toHaveLength(1);
			expect(assumeRolePolicy?.Statement[0].Effect).toBe("Allow");
			expect(assumeRolePolicy?.Statement[0].Principal.Service).toBe(
				"codebuild.amazonaws.com",
			);
			expect(assumeRolePolicy?.Statement[0].Action).toBe("sts:AssumeRole");
		});

		test("should have CloudWatch Logs permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const logsStatement = statements.find(
				(s) => s.Sid === "CloudWatchLogsAccess",
			);
			expect(logsStatement).toBeDefined();

			const actions = Array.isArray(logsStatement?.Action)
				? logsStatement?.Action
				: [logsStatement?.Action];
			expect(actions).toContain("logs:CreateLogGroup");
			expect(actions).toContain("logs:CreateLogStream");
			expect(actions).toContain("logs:PutLogEvents");
		});

		test("should have Secrets Manager permissions for PAT", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const secretsStatement = statements.find(
				(s) => s.Sid === "SecretsManagerPatAccess",
			);
			expect(secretsStatement).toBeDefined();

			const actions = Array.isArray(secretsStatement?.Action)
				? secretsStatement?.Action
				: [secretsStatement?.Action];
			expect(actions).toContain("secretsmanager:GetSecretValue");
		});

		test("should have ECR authentication permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const ecrAuthStatement = statements.find(
				(s) => s.Sid === "EcrAuthAccess",
			);
			expect(ecrAuthStatement).toBeDefined();

			const actions = Array.isArray(ecrAuthStatement?.Action)
				? ecrAuthStatement?.Action
				: [ecrAuthStatement?.Action];
			expect(actions).toContain("ecr:GetAuthorizationToken");
		});

		test("should have ECR repository permissions", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const ecrRepoStatement = statements.find(
				(s) => s.Sid === "EcrRepositoryAccess",
			);
			expect(ecrRepoStatement).toBeDefined();

			const actions = Array.isArray(ecrRepoStatement?.Action)
				? ecrRepoStatement?.Action
				: [ecrRepoStatement?.Action];
			expect(actions).toContain("ecr:PutImage");
			expect(actions).toContain("ecr:BatchCheckLayerAvailability");
			expect(actions).toContain("ecr:InitiateLayerUpload");
			expect(actions).toContain("ecr:UploadLayerPart");
			expect(actions).toContain("ecr:CompleteLayerUpload");
		});

		test("should have VPC permissions for CodeBuild in VPC", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const vpcStatement = statements.find((s) => s.Sid === "VpcAccess");
			expect(vpcStatement).toBeDefined();

			const actions = Array.isArray(vpcStatement?.Action)
				? vpcStatement?.Action
				: [vpcStatement?.Action];
			expect(actions).toContain("ec2:CreateNetworkInterface");
			expect(actions).toContain("ec2:DescribeNetworkInterfaces");
			expect(actions).toContain("ec2:DeleteNetworkInterface");
		});
	});

	describe("ECS Execution Role Configuration", () => {
		test("should have correct assume role policy for ECS tasks service", () => {
			const roleProps = getRoleProperties(template, "EcsExecutionRole");
			const assumeRolePolicy = roleProps?.AssumeRolePolicyDocument;

			expect(assumeRolePolicy?.Version).toBe("2012-10-17");
			expect(assumeRolePolicy?.Statement).toHaveLength(1);
			expect(assumeRolePolicy?.Statement[0].Effect).toBe("Allow");
			expect(assumeRolePolicy?.Statement[0].Principal.Service).toBe(
				"ecs-tasks.amazonaws.com",
			);
			expect(assumeRolePolicy?.Statement[0].Action).toBe("sts:AssumeRole");
		});

		test("should have AmazonECSTaskExecutionRolePolicy managed policy", () => {
			const roleProps = getRoleProperties(template, "EcsExecutionRole");
			const managedPolicies = roleProps?.ManagedPolicyArns;

			expect(managedPolicies).toBeDefined();
			expect(managedPolicies).toContain(
				"arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
			);
		});

		test("should have Secrets Manager permissions for database credentials", () => {
			const policyDoc = getPolicyDocument(template, "EcsExecutionRolePolicy");
			const statements = policyDoc?.Statement || [];

			const secretsStatement = statements.find(
				(s) => s.Sid === "SecretsManagerDatabaseAccess",
			);
			expect(secretsStatement).toBeDefined();

			const actions = Array.isArray(secretsStatement?.Action)
				? secretsStatement?.Action
				: [secretsStatement?.Action];
			expect(actions).toContain("secretsmanager:GetSecretValue");
		});

		test("should have KMS decrypt permissions for encrypted secrets", () => {
			const policyDoc = getPolicyDocument(template, "EcsExecutionRolePolicy");
			const statements = policyDoc?.Statement || [];

			const kmsStatement = statements.find((s) => s.Sid === "KmsDecryptAccess");
			expect(kmsStatement).toBeDefined();

			const actions = Array.isArray(kmsStatement?.Action)
				? kmsStatement?.Action
				: [kmsStatement?.Action];
			expect(actions).toContain("kms:Decrypt");
			expect(kmsStatement?.Condition).toBeDefined();
		});
	});

	describe("ECS Task Role Configuration", () => {
		test("should have correct assume role policy for ECS tasks service", () => {
			const roleProps = getRoleProperties(template, "EcsTaskRole");
			const assumeRolePolicy = roleProps?.AssumeRolePolicyDocument;

			expect(assumeRolePolicy?.Version).toBe("2012-10-17");
			expect(assumeRolePolicy?.Statement).toHaveLength(1);
			expect(assumeRolePolicy?.Statement[0].Effect).toBe("Allow");
			expect(assumeRolePolicy?.Statement[0].Principal.Service).toBe(
				"ecs-tasks.amazonaws.com",
			);
			expect(assumeRolePolicy?.Statement[0].Action).toBe("sts:AssumeRole");
		});

		test("should have CloudWatch Logs permissions for application logging", () => {
			const policyDoc = getPolicyDocument(template, "EcsTaskRolePolicy");
			const statements = policyDoc?.Statement || [];

			const logsStatement = statements.find(
				(s) => s.Sid === "CloudWatchLogsAccess",
			);
			expect(logsStatement).toBeDefined();

			const actions = Array.isArray(logsStatement?.Action)
				? logsStatement?.Action
				: [logsStatement?.Action];
			expect(actions).toContain("logs:CreateLogStream");
			expect(actions).toContain("logs:PutLogEvents");
		});

		test("should have SSM Messages permissions for ECS Exec", () => {
			const policyDoc = getPolicyDocument(template, "EcsTaskRolePolicy");
			const statements = policyDoc?.Statement || [];

			const ssmStatement = statements.find(
				(s) => s.Sid === "SsmMessagesAccess",
			);
			expect(ssmStatement).toBeDefined();

			const actions = Array.isArray(ssmStatement?.Action)
				? ssmStatement?.Action
				: [ssmStatement?.Action];
			expect(actions).toContain("ssmmessages:CreateControlChannel");
			expect(actions).toContain("ssmmessages:CreateDataChannel");
			expect(actions).toContain("ssmmessages:OpenControlChannel");
			expect(actions).toContain("ssmmessages:OpenDataChannel");
		});
	});

	describe("Least-Privilege Validation", () => {
		test("CodePipeline policy should not use wildcard (*) for CodeBuild resources", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const codeBuildStatement = statements.find(
				(s) => s.Sid === "CodeBuildAccess",
			);
			expect(hasWildcardResource(codeBuildStatement?.Resource)).toBe(false);
		});

		test("CodePipeline policy should not use wildcard (*) for ECS resources", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const ecsStatement = statements.find((s) => s.Sid === "EcsServiceAccess");
			expect(hasWildcardResource(ecsStatement?.Resource)).toBe(false);
		});

		test("CodePipeline policy should not use wildcard (*) for SNS resources", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const snsStatement = statements.find((s) => s.Sid === "SnsPublishAccess");
			expect(hasWildcardResource(snsStatement?.Resource)).toBe(false);
		});

		test("CodeBuild policy should not use wildcard (*) for CloudWatch Logs resources", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const logsStatement = statements.find(
				(s) => s.Sid === "CloudWatchLogsAccess",
			);
			expect(hasWildcardResource(logsStatement?.Resource)).toBe(false);
		});

		test("CodeBuild policy should not use wildcard (*) for Secrets Manager resources", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const secretsStatement = statements.find(
				(s) => s.Sid === "SecretsManagerPatAccess",
			);
			expect(hasWildcardResource(secretsStatement?.Resource)).toBe(false);
		});

		test("CodeBuild policy should not use wildcard (*) for ECR repository resources", () => {
			const policyDoc = getPolicyDocument(template, "CodeBuildPolicy");
			const statements = policyDoc?.Statement || [];

			const ecrRepoStatement = statements.find(
				(s) => s.Sid === "EcrRepositoryAccess",
			);
			expect(hasWildcardResource(ecrRepoStatement?.Resource)).toBe(false);
		});

		test("ECS Execution policy should not use wildcard (*) for Secrets Manager resources", () => {
			const policyDoc = getPolicyDocument(template, "EcsExecutionRolePolicy");
			const statements = policyDoc?.Statement || [];

			const secretsStatement = statements.find(
				(s) => s.Sid === "SecretsManagerDatabaseAccess",
			);
			expect(hasWildcardResource(secretsStatement?.Resource)).toBe(false);
		});

		test("ECS Task policy should not use wildcard (*) for CloudWatch Logs resources", () => {
			const policyDoc = getPolicyDocument(template, "EcsTaskRolePolicy");
			const statements = policyDoc?.Statement || [];

			const logsStatement = statements.find(
				(s) => s.Sid === "CloudWatchLogsAccess",
			);
			expect(hasWildcardResource(logsStatement?.Resource)).toBe(false);
		});

		test("IAM PassRole should have condition restricting to ECS service", () => {
			const policyDoc = getPolicyDocument(template, "CodePipelinePolicy");
			const statements = policyDoc?.Statement || [];

			const passRoleStatement = statements.find(
				(s) => s.Sid === "IamPassRoleAccess",
			);
			expect(passRoleStatement?.Condition).toBeDefined();
			expect(
				passRoleStatement?.Condition?.StringEquals?.["iam:PassedToService"],
			).toBe("ecs-tasks.amazonaws.com");
		});
	});

	describe("CloudFormation Outputs", () => {
		test("should export CodePipeline Role ARN", () => {
			expect(template.Outputs?.CodePipelineRoleArn).toBeDefined();
		});

		test("should export CodePipeline Role Name", () => {
			expect(template.Outputs?.CodePipelineRoleName).toBeDefined();
		});

		test("should export CodeBuild Role ARN", () => {
			expect(template.Outputs?.CodeBuildRoleArn).toBeDefined();
		});

		test("should export CodeBuild Role Name", () => {
			expect(template.Outputs?.CodeBuildRoleName).toBeDefined();
		});

		test("should export ECS Execution Role ARN", () => {
			expect(template.Outputs?.EcsExecutionRoleArn).toBeDefined();
		});

		test("should export ECS Execution Role Name", () => {
			expect(template.Outputs?.EcsExecutionRoleName).toBeDefined();
		});

		test("should export ECS Task Role ARN", () => {
			expect(template.Outputs?.EcsTaskRoleArn).toBeDefined();
		});

		test("should export ECS Task Role Name", () => {
			expect(template.Outputs?.EcsTaskRoleName).toBeDefined();
		});
	});

	describe("Resource Tagging", () => {
		test("should have Name tags on all IAM roles", () => {
			const roles = [
				"CodePipelineRole",
				"CodeBuildRole",
				"EcsExecutionRole",
				"EcsTaskRole",
			];

			roles.forEach((roleName) => {
				const roleProps = getRoleProperties(template, roleName);
				const tags = roleProps?.Tags;
				expect(tags).toBeDefined();
				const nameTag = tags?.find((tag) => tag.Key === "Name");
				expect(nameTag).toBeDefined();
			});
		});

		test("should have Environment tags on all IAM roles", () => {
			const roles = [
				"CodePipelineRole",
				"CodeBuildRole",
				"EcsExecutionRole",
				"EcsTaskRole",
			];

			roles.forEach((roleName) => {
				const roleProps = getRoleProperties(template, roleName);
				const tags = roleProps?.Tags;
				const envTag = tags?.find((tag) => tag.Key === "Environment");
				expect(envTag).toBeDefined();
			});
		});

		test("should have Project tags on all IAM roles", () => {
			const roles = [
				"CodePipelineRole",
				"CodeBuildRole",
				"EcsExecutionRole",
				"EcsTaskRole",
			];

			roles.forEach((roleName) => {
				const roleProps = getRoleProperties(template, roleName);
				const tags = roleProps?.Tags;
				const projectTag = tags?.find((tag) => tag.Key === "Project");
				expect(projectTag).toBeDefined();
			});
		});

		test("should have Purpose tags on all IAM roles", () => {
			const roles = [
				"CodePipelineRole",
				"CodeBuildRole",
				"EcsExecutionRole",
				"EcsTaskRole",
			];

			roles.forEach((roleName) => {
				const roleProps = getRoleProperties(template, roleName);
				const tags = roleProps?.Tags;
				const purposeTag = tags?.find((tag) => tag.Key === "Purpose");
				expect(purposeTag).toBeDefined();
			});
		});
	});

	describe("Parameter Validation", () => {
		test("should have Environment parameter with allowed values", () => {
			const envParam = template.Parameters?.Environment as Record<
				string,
				unknown
			>;
			expect(envParam).toBeDefined();
			expect(envParam.AllowedValues).toEqual(["dev", "staging", "prod"]);
		});

		test("should have ProjectName parameter with pattern constraint", () => {
			const projectParam = template.Parameters?.ProjectName as Record<
				string,
				unknown
			>;
			expect(projectParam).toBeDefined();
			expect(projectParam.AllowedPattern).toBeDefined();
		});

		test("should have default values for parameters", () => {
			const envParam = template.Parameters?.Environment as Record<
				string,
				unknown
			>;
			const projectParam = template.Parameters?.ProjectName as Record<
				string,
				unknown
			>;

			expect(envParam.Default).toBe("dev");
			expect(projectParam.Default).toBe("japfa-api");
		});
	});

	describe("Role Descriptions", () => {
		test("CodePipeline Role should have descriptive Description", () => {
			const roleProps = getRoleProperties(template, "CodePipelineRole");
			expect(roleProps?.Description).toBeDefined();
			expect(roleProps?.Description?.toLowerCase()).toContain("codepipeline");
		});

		test("CodeBuild Role should have descriptive Description", () => {
			const roleProps = getRoleProperties(template, "CodeBuildRole");
			expect(roleProps?.Description).toBeDefined();
			expect(roleProps?.Description?.toLowerCase()).toContain("codebuild");
		});

		test("ECS Execution Role should have descriptive Description", () => {
			const roleProps = getRoleProperties(template, "EcsExecutionRole");
			expect(roleProps?.Description).toBeDefined();
			expect(roleProps?.Description?.toLowerCase()).toContain("ecs");
		});

		test("ECS Task Role should have descriptive Description", () => {
			const roleProps = getRoleProperties(template, "EcsTaskRole");
			expect(roleProps?.Description).toBeDefined();
			expect(roleProps?.Description?.toLowerCase()).toContain("ecs");
		});
	});

	describe("Policy Statement Sids", () => {
		test("all policy statements should have Sid for identification", () => {
			const policies = [
				"CodePipelinePolicy",
				"CodeBuildPolicy",
				"EcsExecutionRolePolicy",
				"EcsTaskRolePolicy",
			];

			policies.forEach((policyName) => {
				const policyDoc = getPolicyDocument(template, policyName);
				const statements = policyDoc?.Statement || [];

				statements.forEach((statement) => {
					expect(statement.Sid).toBeDefined();
					expect(statement.Sid!.length).toBeGreaterThan(0);
				});
			});
		});
	});
});

