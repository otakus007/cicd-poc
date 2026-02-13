/**
 * Unit Tests for ECR CloudFormation Template Validation
 *
 * Validates: Requirements 5.2 - THE ECR SHALL retain images according to the configured lifecycle policy
 * Validates: Requirements 5.5 - THE ECR SHALL maintain at least the last 10 tagged images per repository
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. Scan-on-push is enabled for vulnerability detection
 * 3. Lifecycle policy retains last 10 tagged images with "v" prefix
 * 4. Lifecycle policy deletes untagged images older than 7 days
 * 5. Repository outputs are exported
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected ECR configurations from design document
const EXPECTED_CONFIG = {
	scanOnPush: true,
	imageTagMutability: "MUTABLE",
	encryptionType: "AES256",
	lifecyclePolicy: {
		taggedImagesRetention: 10,
		tagPrefix: "v",
		untaggedImagesDays: 7,
	},
};

// Type definitions for CloudFormation template structure
interface LifecyclePolicyRule {
	rulePriority: number;
	description: string;
	selection: {
		tagStatus: string;
		tagPrefixList?: string[];
		countType: string;
		countNumber: number;
		countUnit?: string;
	};
	action: {
		type: string;
	};
}

interface LifecyclePolicy {
	rules: LifecyclePolicyRule[];
}

interface CloudFormationResource {
	Type: string;
	Properties?: {
		RepositoryName?: { "Fn::Sub": string } | string;
		ImageScanningConfiguration?: {
			ScanOnPush: boolean;
		};
		ImageTagMutability?: string;
		EncryptionConfiguration?: {
			EncryptionType: string;
		};
		LifecyclePolicy?: {
			LifecyclePolicyText: string;
		};
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

describe("ECR CloudFormation Template Validation", () => {
	let template: CloudFormationTemplate;
	let lifecyclePolicy: LifecyclePolicy;
	const templatePath = path.join(__dirname, "..", "ecr.yaml");

	beforeAll(() => {
		// Load and parse the ECR template with CloudFormation schema
		const templateContent = fs.readFileSync(templatePath, "utf8");
		template = yaml.load(templateContent, {
			schema: CFN_SCHEMA,
		}) as CloudFormationTemplate;

		// Parse the lifecycle policy JSON
		const lifecyclePolicyText =
			template.Resources?.ECRRepository?.Properties?.LifecyclePolicy
				?.LifecyclePolicyText;
		if (lifecyclePolicyText) {
			lifecyclePolicy = JSON.parse(lifecyclePolicyText) as LifecyclePolicy;
		}
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

	describe("ECR Repository Configuration", () => {
		test("should define an ECR Repository resource", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo).toBeDefined();
			expect(ecrRepo?.Type).toBe("AWS::ECR::Repository");
		});

		test("should have repository name using project and environment", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const repoName = ecrRepo?.Properties?.RepositoryName;
			expect(repoName).toBeDefined();
			// Should use Fn::Sub with ProjectName and Environment
			expect(repoName).toEqual({ "Fn::Sub": "${ProjectName}-${Environment}" });
		});

		test("should have AES256 encryption configured", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const encryption = ecrRepo?.Properties?.EncryptionConfiguration;
			expect(encryption).toBeDefined();
			expect(encryption?.EncryptionType).toBe(EXPECTED_CONFIG.encryptionType);
		});

		test("should have MUTABLE image tag mutability", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo?.Properties?.ImageTagMutability).toBe(
				EXPECTED_CONFIG.imageTagMutability,
			);
		});
	});

	describe("Scan-on-Push Configuration (Requirement 5.3)", () => {
		test("should have scan-on-push enabled", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const scanConfig = ecrRepo?.Properties?.ImageScanningConfiguration;
			expect(scanConfig).toBeDefined();
			expect(scanConfig?.ScanOnPush).toBe(EXPECTED_CONFIG.scanOnPush);
		});

		test("should have ImageScanningConfiguration defined", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo?.Properties?.ImageScanningConfiguration).toBeDefined();
		});
	});

	describe("Lifecycle Policy Configuration (Requirements 5.2, 5.5)", () => {
		test("should have lifecycle policy defined", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo?.Properties?.LifecyclePolicy).toBeDefined();
			expect(
				ecrRepo?.Properties?.LifecyclePolicy?.LifecyclePolicyText,
			).toBeDefined();
		});

		test("should have valid JSON lifecycle policy", () => {
			expect(lifecyclePolicy).toBeDefined();
			expect(lifecyclePolicy.rules).toBeDefined();
			expect(Array.isArray(lifecyclePolicy.rules)).toBe(true);
		});

		test("should have exactly 2 lifecycle rules", () => {
			expect(lifecyclePolicy.rules.length).toBe(2);
		});

		describe("Tagged Images Retention Rule (Requirement 5.5)", () => {
			let taggedRule: LifecyclePolicyRule;

			beforeAll(() => {
				taggedRule = lifecyclePolicy.rules.find(
					(rule) => rule.selection.tagStatus === "tagged",
				)!;
			});

			test("should have a rule for tagged images", () => {
				expect(taggedRule).toBeDefined();
			});

			test("should retain last 10 tagged images", () => {
				expect(taggedRule.selection.countNumber).toBe(
					EXPECTED_CONFIG.lifecyclePolicy.taggedImagesRetention,
				);
			});

			test("should use imageCountMoreThan count type", () => {
				expect(taggedRule.selection.countType).toBe("imageCountMoreThan");
			});

			test('should filter by "v" tag prefix', () => {
				expect(taggedRule.selection.tagPrefixList).toBeDefined();
				expect(taggedRule.selection.tagPrefixList).toContain(
					EXPECTED_CONFIG.lifecyclePolicy.tagPrefix,
				);
			});

			test("should have expire action", () => {
				expect(taggedRule.action.type).toBe("expire");
			});

			test("should have rule priority 1", () => {
				expect(taggedRule.rulePriority).toBe(1);
			});

			test("should have descriptive description", () => {
				expect(taggedRule.description).toBeDefined();
				expect(taggedRule.description.toLowerCase()).toContain("tagged");
				expect(taggedRule.description).toContain("10");
			});
		});

		describe("Untagged Images Cleanup Rule", () => {
			let untaggedRule: LifecyclePolicyRule;

			beforeAll(() => {
				untaggedRule = lifecyclePolicy.rules.find(
					(rule) => rule.selection.tagStatus === "untagged",
				)!;
			});

			test("should have a rule for untagged images", () => {
				expect(untaggedRule).toBeDefined();
			});

			test("should delete untagged images older than 7 days", () => {
				expect(untaggedRule.selection.countNumber).toBe(
					EXPECTED_CONFIG.lifecyclePolicy.untaggedImagesDays,
				);
			});

			test("should use sinceImagePushed count type", () => {
				expect(untaggedRule.selection.countType).toBe("sinceImagePushed");
			});

			test("should use days as count unit", () => {
				expect(untaggedRule.selection.countUnit).toBe("days");
			});

			test("should have expire action", () => {
				expect(untaggedRule.action.type).toBe("expire");
			});

			test("should have rule priority 2", () => {
				expect(untaggedRule.rulePriority).toBe(2);
			});

			test("should have descriptive description", () => {
				expect(untaggedRule.description).toBeDefined();
				expect(untaggedRule.description.toLowerCase()).toContain("untagged");
				expect(untaggedRule.description).toContain("7");
			});
		});

		describe("Lifecycle Policy Rule Priorities", () => {
			test("should have unique rule priorities", () => {
				const priorities = lifecyclePolicy.rules.map(
					(rule) => rule.rulePriority,
				);
				const uniquePriorities = new Set(priorities);
				expect(uniquePriorities.size).toBe(priorities.length);
			});

			test("should have sequential rule priorities starting from 1", () => {
				const priorities = lifecyclePolicy.rules
					.map((rule) => rule.rulePriority)
					.sort((a, b) => a - b);
				expect(priorities[0]).toBe(1);
				expect(priorities[1]).toBe(2);
			});
		});
	});

	describe("CloudFormation Outputs", () => {
		test("should export Repository URI", () => {
			expect(template.Outputs?.RepositoryUri).toBeDefined();
		});

		test("should export Repository ARN", () => {
			expect(template.Outputs?.RepositoryArn).toBeDefined();
		});

		test("should export Repository Name", () => {
			expect(template.Outputs?.RepositoryName).toBeDefined();
		});

		test("Repository URI output should use GetAtt", () => {
			const output = template.Outputs?.RepositoryUri as Record<string, unknown>;
			expect(output?.Value).toEqual({
				"Fn::GetAtt": ["ECRRepository", "RepositoryUri"],
			});
		});

		test("Repository ARN output should use GetAtt", () => {
			const output = template.Outputs?.RepositoryArn as Record<string, unknown>;
			expect(output?.Value).toEqual({
				"Fn::GetAtt": ["ECRRepository", "Arn"],
			});
		});

		test("Repository Name output should use Ref", () => {
			const output = template.Outputs?.RepositoryName as Record<
				string,
				unknown
			>;
			expect(output?.Value).toEqual({ Ref: "ECRRepository" });
		});

		test("should have Export names for cross-stack references", () => {
			const uriOutput = template.Outputs?.RepositoryUri as Record<
				string,
				unknown
			>;
			const arnOutput = template.Outputs?.RepositoryArn as Record<
				string,
				unknown
			>;
			const nameOutput = template.Outputs?.RepositoryName as Record<
				string,
				unknown
			>;

			expect(uriOutput?.Export).toBeDefined();
			expect(arnOutput?.Export).toBeDefined();
			expect(nameOutput?.Export).toBeDefined();
		});
	});

	describe("Resource Tagging", () => {
		test("should have Name tag on ECR repository", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const tags = ecrRepo?.Properties?.Tags as Array<{
				Key: string;
				Value: unknown;
			}>;
			expect(tags).toBeDefined();
			const nameTag = tags?.find((tag) => tag.Key === "Name");
			expect(nameTag).toBeDefined();
		});

		test("should have Environment tag on ECR repository", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const tags = ecrRepo?.Properties?.Tags as Array<{
				Key: string;
				Value: unknown;
			}>;
			const envTag = tags?.find((tag) => tag.Key === "Environment");
			expect(envTag).toBeDefined();
		});

		test("should have Project tag on ECR repository", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const tags = ecrRepo?.Properties?.Tags as Array<{
				Key: string;
				Value: unknown;
			}>;
			const projectTag = tags?.find((tag) => tag.Key === "Project");
			expect(projectTag).toBeDefined();
		});

		test("should have Purpose tag on ECR repository", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			const tags = ecrRepo?.Properties?.Tags as Array<{
				Key: string;
				Value: unknown;
			}>;
			const purposeTag = tags?.find((tag) => tag.Key === "Purpose");
			expect(purposeTag).toBeDefined();
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

		test("should have ProjectName parameter with min/max length constraints", () => {
			const projectParam = template.Parameters?.ProjectName as Record<
				string,
				unknown
			>;
			expect(projectParam.MinLength).toBeDefined();
			expect(projectParam.MaxLength).toBeDefined();
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
			expect(projectParam.Default).toBeDefined();
		});
	});

	describe("Security Configuration", () => {
		test("should have encryption enabled", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo?.Properties?.EncryptionConfiguration).toBeDefined();
		});

		test("should use AES256 encryption (AWS managed key)", () => {
			const ecrRepo = template.Resources?.ECRRepository;
			expect(ecrRepo?.Properties?.EncryptionConfiguration?.EncryptionType).toBe(
				"AES256",
			);
		});
	});
});

