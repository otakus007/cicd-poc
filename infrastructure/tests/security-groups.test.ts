/**
 * Unit Tests for Security Groups CloudFormation Template Validation
 *
 * Validates: Requirements 9.4 - THE templates SHALL include all required IAM roles, policies, and security groups
 * Validates: Requirements 8.5 - THE Pipeline SHALL use IAM roles with least-privilege permissions for all AWS service interactions
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. All required security groups are defined (VPC Link, ALB, ECS, CodeBuild)
 * 3. Ingress/egress rules follow least-privilege principle
 * 4. Security group IDs are exported for other stacks
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected security group configurations from design document
const EXPECTED_SECURITY_GROUPS = {
	vpcLink: {
		name: "vpclink-sg",
		ingress: [{ port: 443, protocol: "tcp", source: "0.0.0.0/0" }],
	},
	alb: {
		name: "alb-sg",
		ingress: [
			{
				port: 80,
				protocol: "tcp",
				sourceSecurityGroup: "VpcLinkSecurityGroup",
			},
			{
				port: 443,
				protocol: "tcp",
				sourceSecurityGroup: "VpcLinkSecurityGroup",
			},
		],
	},
	ecs: {
		name: "ecs-sg",
		ingress: [
			{ port: 80, protocol: "tcp", sourceSecurityGroup: "AlbSecurityGroup" },
		],
		egress: [
			{ port: 443, protocol: "tcp", destination: "0.0.0.0/0" },
			{ port: 1433, protocol: "tcp", destinationVpcCidr: true },
		],
	},
	codeBuild: {
		name: "codebuild-sg",
		egress: [
			{ port: 443, protocol: "tcp", destination: "0.0.0.0/0" },
			{ port: 80, protocol: "tcp", destination: "0.0.0.0/0" },
		],
	},
};

// Type definitions for CloudFormation template structure
interface SecurityGroupIngress {
	IpProtocol: string;
	FromPort: number;
	ToPort: number;
	CidrIp?: string;
	SourceSecurityGroupId?: { Ref: string };
	Description?: string;
}

interface SecurityGroupEgress {
	IpProtocol: string;
	FromPort: number;
	ToPort: number;
	CidrIp?: string | { Ref: string };
	Description?: string;
}

interface CloudFormationResource {
	Type: string;
	Properties?: {
		GroupName?: { "Fn::Sub": string } | string;
		GroupDescription?: string;
		VpcId?: { Ref: string };
		SecurityGroupIngress?: SecurityGroupIngress[];
		SecurityGroupEgress?: SecurityGroupEgress[];
		Tags?: Array<{ Key: string; Value: unknown }>;
	};
	DependsOn?: string | string[];
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

describe("Security Groups CloudFormation Template Validation", () => {
	let template: CloudFormationTemplate;
	const templatePath = path.join(__dirname, "..", "security-groups.yaml");

	beforeAll(() => {
		// Load and parse the security groups template with CloudFormation schema
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

	describe("Required Security Groups", () => {
		test("should define VPC Link Security Group", () => {
			const sg = template.Resources?.VpcLinkSecurityGroup;
			expect(sg).toBeDefined();
			expect(sg?.Type).toBe("AWS::EC2::SecurityGroup");
		});

		test("should define ALB Security Group", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			expect(sg).toBeDefined();
			expect(sg?.Type).toBe("AWS::EC2::SecurityGroup");
		});

		test("should define ECS Security Group", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			expect(sg).toBeDefined();
			expect(sg?.Type).toBe("AWS::EC2::SecurityGroup");
		});

		test("should define CodeBuild Security Group", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			expect(sg).toBeDefined();
			expect(sg?.Type).toBe("AWS::EC2::SecurityGroup");
		});

		test("should have exactly 4 security groups", () => {
			const securityGroups = Object.entries(template.Resources || {}).filter(
				([_, resource]) => resource.Type === "AWS::EC2::SecurityGroup",
			);
			expect(securityGroups.length).toBe(4);
		});
	});

	describe("VPC Link Security Group Configuration", () => {
		test("should allow HTTPS (443) ingress from anywhere for API Gateway", () => {
			const sg = template.Resources?.VpcLinkSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			expect(ingress).toBeDefined();
			expect(ingress?.length).toBeGreaterThanOrEqual(1);

			const httpsRule = ingress?.find(
				(rule) => rule.FromPort === 443 && rule.ToPort === 443,
			);
			expect(httpsRule).toBeDefined();
			expect(httpsRule?.IpProtocol).toBe("tcp");
			expect(httpsRule?.CidrIp).toBe("0.0.0.0/0");
		});

		test("should have descriptive description for HTTPS rule", () => {
			const sg = template.Resources?.VpcLinkSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;
			const httpsRule = ingress?.find((rule) => rule.FromPort === 443);

			expect(httpsRule?.Description).toBeDefined();
			expect(httpsRule?.Description?.toLowerCase()).toContain("api gateway");
		});

		test("should reference VpcId parameter", () => {
			const sg = template.Resources?.VpcLinkSecurityGroup;
			expect(sg?.Properties?.VpcId).toEqual({ Ref: "VpcId" });
		});
	});

	describe("ALB Security Group Configuration", () => {
		test("should allow HTTP (80) ingress from VPC Link Security Group only", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			expect(ingress).toBeDefined();

			const httpRule = ingress?.find(
				(rule) => rule.FromPort === 80 && rule.ToPort === 80,
			);
			expect(httpRule).toBeDefined();
			expect(httpRule?.IpProtocol).toBe("tcp");
			expect(httpRule?.SourceSecurityGroupId).toEqual({
				Ref: "VpcLinkSecurityGroup",
			});
			// Should NOT have CidrIp - only from VPC Link SG
			expect(httpRule?.CidrIp).toBeUndefined();
		});

		test("should allow HTTPS (443) ingress from VPC Link Security Group only", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			const httpsRule = ingress?.find(
				(rule) => rule.FromPort === 443 && rule.ToPort === 443,
			);
			expect(httpsRule).toBeDefined();
			expect(httpsRule?.IpProtocol).toBe("tcp");
			expect(httpsRule?.SourceSecurityGroupId).toEqual({
				Ref: "VpcLinkSecurityGroup",
			});
			// Should NOT have CidrIp - only from VPC Link SG
			expect(httpsRule?.CidrIp).toBeUndefined();
		});

		test("should NOT allow ingress from 0.0.0.0/0 (least-privilege)", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			const publicRules = ingress?.filter(
				(rule) => rule.CidrIp === "0.0.0.0/0",
			);
			expect(publicRules?.length || 0).toBe(0);
		});

		test("should reference VpcId parameter", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			expect(sg?.Properties?.VpcId).toEqual({ Ref: "VpcId" });
		});
	});

	describe("ECS Security Group Configuration", () => {
		test("should allow HTTP (80) ingress from ALB Security Group only", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			expect(ingress).toBeDefined();
			expect(ingress?.length).toBe(1); // Only one ingress rule

			const httpRule = ingress?.[0];
			expect(httpRule?.FromPort).toBe(80);
			expect(httpRule?.ToPort).toBe(80);
			expect(httpRule?.IpProtocol).toBe("tcp");
			expect(httpRule?.SourceSecurityGroupId).toEqual({
				Ref: "AlbSecurityGroup",
			});
		});

		test("should allow HTTPS (443) egress to anywhere for AWS APIs", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			expect(egress).toBeDefined();

			const httpsRule = egress?.find(
				(rule) => rule.FromPort === 443 && rule.ToPort === 443,
			);
			expect(httpsRule).toBeDefined();
			expect(httpsRule?.IpProtocol).toBe("tcp");
			expect(httpsRule?.CidrIp).toBe("0.0.0.0/0");
		});

		test("should allow SQL Server (1433) egress to VPC CIDR only for database access", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			const sqlRule = egress?.find(
				(rule) => rule.FromPort === 1433 && rule.ToPort === 1433,
			);
			expect(sqlRule).toBeDefined();
			expect(sqlRule?.IpProtocol).toBe("tcp");
			// Should reference VpcCidr parameter, not 0.0.0.0/0
			expect(sqlRule?.CidrIp).toEqual({ Ref: "VpcCidr" });
		});

		test("should NOT allow SQL Server egress to 0.0.0.0/0 (least-privilege)", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			const sqlRule = egress?.find(
				(rule) => rule.FromPort === 1433 && rule.ToPort === 1433,
			);
			expect(sqlRule?.CidrIp).not.toBe("0.0.0.0/0");
		});

		test("should have exactly 2 egress rules (HTTPS and SQL Server)", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			expect(egress?.length).toBe(2);
		});

		test("should reference VpcId parameter", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			expect(sg?.Properties?.VpcId).toEqual({ Ref: "VpcId" });
		});
	});

	describe("CodeBuild Security Group Configuration", () => {
		test("should allow HTTPS (443) egress to anywhere for package downloads and AWS APIs", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			expect(egress).toBeDefined();

			const httpsRule = egress?.find(
				(rule) => rule.FromPort === 443 && rule.ToPort === 443,
			);
			expect(httpsRule).toBeDefined();
			expect(httpsRule?.IpProtocol).toBe("tcp");
			expect(httpsRule?.CidrIp).toBe("0.0.0.0/0");
		});

		test("should allow HTTP (80) egress to anywhere for package downloads", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			const httpRule = egress?.find(
				(rule) => rule.FromPort === 80 && rule.ToPort === 80,
			);
			expect(httpRule).toBeDefined();
			expect(httpRule?.IpProtocol).toBe("tcp");
			expect(httpRule?.CidrIp).toBe("0.0.0.0/0");
		});

		test("should have exactly 2 egress rules (HTTPS and HTTP)", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			expect(egress?.length).toBe(2);
		});

		test("should NOT have any ingress rules (egress-only)", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			// CodeBuild SG should not have ingress rules - it only needs outbound access
			expect(ingress).toBeUndefined();
		});

		test("should reference VpcId parameter", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			expect(sg?.Properties?.VpcId).toEqual({ Ref: "VpcId" });
		});
	});

	describe("Least-Privilege Validation", () => {
		test("ALB should only accept traffic from VPC Link SG, not from internet", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			// All ingress rules should reference VpcLinkSecurityGroup
			ingress?.forEach((rule) => {
				expect(rule.SourceSecurityGroupId).toEqual({
					Ref: "VpcLinkSecurityGroup",
				});
				expect(rule.CidrIp).toBeUndefined();
			});
		});

		test("ECS should only accept traffic from ALB SG, not from internet", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const ingress = sg?.Properties?.SecurityGroupIngress;

			// All ingress rules should reference AlbSecurityGroup
			ingress?.forEach((rule) => {
				expect(rule.SourceSecurityGroupId).toEqual({
					Ref: "AlbSecurityGroup",
				});
				expect(rule.CidrIp).toBeUndefined();
			});
		});

		test("ECS database access should be restricted to VPC CIDR", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			const egress = sg?.Properties?.SecurityGroupEgress;

			const sqlRule = egress?.find((rule) => rule.FromPort === 1433);
			expect(sqlRule?.CidrIp).toEqual({ Ref: "VpcCidr" });
		});

		test("CodeBuild should have no ingress rules", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			expect(sg?.Properties?.SecurityGroupIngress).toBeUndefined();
		});
	});

	describe("CloudFormation Outputs", () => {
		test("should export VPC Link Security Group ID", () => {
			expect(template.Outputs?.VpcLinkSecurityGroupId).toBeDefined();
		});

		test("should export ALB Security Group ID", () => {
			expect(template.Outputs?.AlbSecurityGroupId).toBeDefined();
		});

		test("should export ECS Security Group ID", () => {
			expect(template.Outputs?.EcsSecurityGroupId).toBeDefined();
		});

		test("should export CodeBuild Security Group ID", () => {
			expect(template.Outputs?.CodeBuildSecurityGroupId).toBeDefined();
		});

		test("should export security group names", () => {
			expect(template.Outputs?.VpcLinkSecurityGroupName).toBeDefined();
			expect(template.Outputs?.AlbSecurityGroupName).toBeDefined();
			expect(template.Outputs?.EcsSecurityGroupName).toBeDefined();
			expect(template.Outputs?.CodeBuildSecurityGroupName).toBeDefined();
		});
	});

	describe("Resource Tagging", () => {
		test("should have Name tags on all security groups", () => {
			const securityGroups = [
				"VpcLinkSecurityGroup",
				"AlbSecurityGroup",
				"EcsSecurityGroup",
				"CodeBuildSecurityGroup",
			];

			securityGroups.forEach((sgName) => {
				const sg = template.Resources?.[sgName];
				const tags = sg?.Properties?.Tags as Array<{
					Key: string;
					Value: unknown;
				}>;
				expect(tags).toBeDefined();
				const nameTag = tags?.find((tag) => tag.Key === "Name");
				expect(nameTag).toBeDefined();
			});
		});

		test("should have Environment tags on all security groups", () => {
			const securityGroups = [
				"VpcLinkSecurityGroup",
				"AlbSecurityGroup",
				"EcsSecurityGroup",
				"CodeBuildSecurityGroup",
			];

			securityGroups.forEach((sgName) => {
				const sg = template.Resources?.[sgName];
				const tags = sg?.Properties?.Tags as Array<{
					Key: string;
					Value: unknown;
				}>;
				const envTag = tags?.find((tag) => tag.Key === "Environment");
				expect(envTag).toBeDefined();
			});
		});

		test("should have Project tags on all security groups", () => {
			const securityGroups = [
				"VpcLinkSecurityGroup",
				"AlbSecurityGroup",
				"EcsSecurityGroup",
				"CodeBuildSecurityGroup",
			];

			securityGroups.forEach((sgName) => {
				const sg = template.Resources?.[sgName];
				const tags = sg?.Properties?.Tags as Array<{
					Key: string;
					Value: unknown;
				}>;
				const projectTag = tags?.find((tag) => tag.Key === "Project");
				expect(projectTag).toBeDefined();
			});
		});

		test("should have Purpose tags on all security groups", () => {
			const securityGroups = [
				"VpcLinkSecurityGroup",
				"AlbSecurityGroup",
				"EcsSecurityGroup",
				"CodeBuildSecurityGroup",
			];

			securityGroups.forEach((sgName) => {
				const sg = template.Resources?.[sgName];
				const tags = sg?.Properties?.Tags as Array<{
					Key: string;
					Value: unknown;
				}>;
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

		test("should have VpcId parameter of type AWS::EC2::VPC::Id", () => {
			const vpcIdParam = template.Parameters?.VpcId as Record<string, unknown>;
			expect(vpcIdParam).toBeDefined();
			expect(vpcIdParam.Type).toBe("AWS::EC2::VPC::Id");
		});

		test("should have VpcCidr parameter with CIDR pattern constraint", () => {
			const vpcCidrParam = template.Parameters?.VpcCidr as Record<
				string,
				unknown
			>;
			expect(vpcCidrParam).toBeDefined();
			expect(vpcCidrParam.AllowedPattern).toBeDefined();
		});
	});

	describe("Security Group Descriptions", () => {
		test("VPC Link SG should have descriptive GroupDescription", () => {
			const sg = template.Resources?.VpcLinkSecurityGroup;
			expect(sg?.Properties?.GroupDescription).toBeDefined();
			expect(sg?.Properties?.GroupDescription?.toLowerCase()).toContain(
				"vpc link",
			);
		});

		test("ALB SG should have descriptive GroupDescription", () => {
			const sg = template.Resources?.AlbSecurityGroup;
			expect(sg?.Properties?.GroupDescription).toBeDefined();
			expect(sg?.Properties?.GroupDescription?.toLowerCase()).toContain("alb");
		});

		test("ECS SG should have descriptive GroupDescription", () => {
			const sg = template.Resources?.EcsSecurityGroup;
			expect(sg?.Properties?.GroupDescription).toBeDefined();
			expect(sg?.Properties?.GroupDescription?.toLowerCase()).toContain("ecs");
		});

		test("CodeBuild SG should have descriptive GroupDescription", () => {
			const sg = template.Resources?.CodeBuildSecurityGroup;
			expect(sg?.Properties?.GroupDescription).toBeDefined();
			expect(sg?.Properties?.GroupDescription?.toLowerCase()).toContain(
				"codebuild",
			);
		});
	});
});

