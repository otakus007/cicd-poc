/**
 * Property-Based Tests for IAM Policy Least-Privilege Validation
 *
 * Feature: aws-cicd-pipeline, Property 5: Template Environment Parameterization
 *
 * **Validates: Requirements 8.5, 9.2**
 *
 * Property 5: Template Environment Parameterization
 * _For any_ CloudFormation/CDK template, parameterized deployment SHALL:
 * - Accept environment-specific values (dev, staging, prod) for all configurable resources
 * - Produce valid infrastructure for each environment
 * - Maintain consistent resource naming patterns across environments
 *
 * Additional validation:
 * - Verify IAM policies don't use wildcard (*) resources where specific ARNs are possible
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

interface EnvironmentConfig {
	environment: "dev" | "staging" | "prod";
	projectName: string;
	region: string;
	accountId: string;
}

interface ResourceNamingResult {
	roleName: string;
	policyName: string;
	environment: string;
	projectName: string;
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
 * Load and parse the IAM CloudFormation template
 */
function loadTemplate(): CloudFormationTemplate {
	const templatePath = path.join(__dirname, "..", "iam.yaml");
	const templateContent = fs.readFileSync(templatePath, "utf8");
	return yaml.load(templateContent, {
		schema: CFN_SCHEMA,
	}) as CloudFormationTemplate;
}

/**
 * Check if a resource value is a pure wildcard (*)
 * Returns true only if the resource is exactly "*" (not a pattern like "arn:aws:*")
 */
function isPureWildcardResource(resource: unknown): boolean {
	if (typeof resource === "string") {
		return resource === "*";
	}
	if (Array.isArray(resource)) {
		return resource.some((r) => isPureWildcardResource(r));
	}
	if (typeof resource === "object" && resource !== null) {
		const subValue = (resource as { "Fn::Sub"?: string })["Fn::Sub"];
		if (typeof subValue === "string") {
			return subValue === "*";
		}
	}
	return false;
}

/**
 * Check if a resource ARN uses wildcards inappropriately
 * Wildcards are acceptable in certain contexts (e.g., log streams, conditions)
 * but not for primary resources like buckets, roles, etc.
 */
function hasInappropriateWildcard(resource: unknown, sid: string): boolean {
	// These Sids are allowed to have wildcards due to AWS API requirements
	const allowedWildcardSids = [
		"EcrAuthAccess", // ecr:GetAuthorizationToken requires "*"
		"VpcAccess", // EC2 describe operations require "*"
		"SsmMessagesAccess", // SSM messages require "*"
		"XRayAccess", // X-Ray requires "*"
		"EcsTaskDefinitionAccess", // ECS task definition registration requires "*"
	];

	if (allowedWildcardSids.includes(sid)) {
		return false;
	}

	return isPureWildcardResource(resource);
}

/**
 * Extract the Fn::Sub string value from a CloudFormation intrinsic function
 */
function extractSubValue(value: unknown): string | null {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object" && value !== null) {
		const subValue = (value as { "Fn::Sub"?: string | unknown[] })["Fn::Sub"];
		if (typeof subValue === "string") {
			return subValue;
		}
		if (Array.isArray(subValue) && typeof subValue[0] === "string") {
			return subValue[0];
		}
	}
	return null;
}

/**
 * Simulate parameter substitution in a CloudFormation template
 */
function substituteParameters(
	template: CloudFormationTemplate,
	config: EnvironmentConfig,
): Map<string, string> {
	const substitutions = new Map<string, string>();

	// Substitute standard CloudFormation pseudo-parameters
	substitutions.set("AWS::Region", config.region);
	substitutions.set("AWS::AccountId", config.accountId);

	// Substitute template parameters
	substitutions.set("Environment", config.environment);
	substitutions.set("ProjectName", config.projectName);

	return substitutions;
}

/**
 * Apply parameter substitutions to a string with ${} placeholders
 */
function applySubstitutions(
	value: string,
	substitutions: Map<string, string>,
): string {
	let result = value;
	for (const [key, val] of substitutions) {
		result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), val);
	}
	return result;
}

/**
 * Generate resource names based on environment configuration
 */
function generateResourceNames(
	template: CloudFormationTemplate,
	config: EnvironmentConfig,
): ResourceNamingResult[] {
	const results: ResourceNamingResult[] = [];
	const substitutions = substituteParameters(template, config);

	const roles = Object.entries(template.Resources || {}).filter(
		([_, resource]) => resource.Type === "AWS::IAM::Role",
	);

	for (const [logicalId, resource] of roles) {
		const props = resource.Properties as IamRoleProperties;
		const roleNameValue = extractSubValue(props?.RoleName);

		if (roleNameValue) {
			const resolvedRoleName = applySubstitutions(roleNameValue, substitutions);
			results.push({
				roleName: resolvedRoleName,
				policyName: `${resolvedRoleName}-policy`,
				environment: config.environment,
				projectName: config.projectName,
			});
		}
	}

	return results;
}

/**
 * Validate that resource naming follows the expected pattern
 */
function validateResourceNaming(
	naming: ResourceNamingResult,
	config: EnvironmentConfig,
): boolean {
	// Resource names should follow pattern: {projectName}-{environment}-{resourceType}
	const expectedPattern = new RegExp(
		`^${config.projectName}-${config.environment}-[a-z0-9-]+$`,
	);
	return expectedPattern.test(naming.roleName);
}

/**
 * Get all policy statements from the template
 */
function getAllPolicyStatements(
	template: CloudFormationTemplate,
): Array<{ policyName: string; statement: PolicyStatement }> {
	const results: Array<{ policyName: string; statement: PolicyStatement }> = [];

	const policies = Object.entries(template.Resources || {}).filter(
		([_, resource]) => resource.Type === "AWS::IAM::Policy",
	);

	for (const [policyName, resource] of policies) {
		const props = resource.Properties as IamPolicyProperties;
		const statements = props?.PolicyDocument?.Statement || [];

		for (const statement of statements) {
			results.push({ policyName, statement });
		}
	}

	return results;
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
	"prod",
) as fc.Arbitrary<"dev" | "staging" | "prod">;

/**
 * Generator for valid project names following the allowed pattern
 * Pattern: ^[a-z0-9][a-z0-9-]*[a-z0-9]$ with length 3-32
 */
const projectNameArb = fc
	.tuple(
		fc.stringOf(
			fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
			{
				minLength: 1,
				maxLength: 1,
			},
		),
		fc.stringOf(
			fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
			{
				minLength: 0,
				maxLength: 28,
			},
		),
		fc.stringOf(
			fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
			{
				minLength: 1,
				maxLength: 1,
			},
		),
	)
	.map(([first, middle, last]) => `${first}${middle}${last}`)
	.filter(
		(name) => name.length >= 3 && name.length <= 32 && !name.includes("--"),
	);

/**
 * Generator for valid AWS regions
 */
const regionArb = fc.constantFrom(
	"us-east-1",
	"us-east-2",
	"us-west-1",
	"us-west-2",
	"eu-west-1",
	"eu-west-2",
	"eu-central-1",
	"ap-southeast-1",
	"ap-southeast-2",
	"ap-northeast-1",
);

/**
 * Generator for valid AWS account IDs (12-digit numbers)
 */
const accountIdArb = fc
	.stringOf(fc.constantFrom(..."0123456789".split("")), {
		minLength: 12,
		maxLength: 12,
	})
	.filter((id) => !id.startsWith("0")); // Account IDs don't start with 0

/**
 * Generator for complete environment configurations
 */
const environmentConfigArb: fc.Arbitrary<EnvironmentConfig> = fc.record({
	environment: environmentArb,
	projectName: projectNameArb,
	region: regionArb,
	accountId: accountIdArb,
});

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("IAM Policy Property-Based Tests", () => {
	/**
	 * Feature: aws-cicd-pipeline, Property 5: Template Environment Parameterization
	 * **Validates: Requirements 8.5, 9.2**
	 */
	describe("Property 5: Template Environment Parameterization", () => {
		let template: CloudFormationTemplate;

		beforeAll(() => {
			template = loadTemplate();
		});

		/**
		 * Property: For any environment configuration, the template SHALL accept
		 * environment-specific values (dev, staging, prod) for all configurable resources.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should accept environment-specific values for all environments", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					// Verify the template has Environment parameter with correct allowed values
					const envParam = template.Parameters?.Environment as Record<
						string,
						unknown
					>;
					expect(envParam).toBeDefined();
					expect(envParam.AllowedValues).toContain(config.environment);

					// Verify the template has ProjectName parameter
					const projectParam = template.Parameters?.ProjectName as Record<
						string,
						unknown
					>;
					expect(projectParam).toBeDefined();

					// Verify parameter substitution works for this configuration
					const substitutions = substituteParameters(template, config);
					expect(substitutions.get("Environment")).toBe(config.environment);
					expect(substitutions.get("ProjectName")).toBe(config.projectName);
					expect(substitutions.get("AWS::Region")).toBe(config.region);
					expect(substitutions.get("AWS::AccountId")).toBe(config.accountId);

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, the template SHALL produce
		 * valid infrastructure with properly named resources.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should produce valid infrastructure for each environment", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					// Generate resource names for this configuration
					const resourceNames = generateResourceNames(template, config);

					// Verify we have the expected number of roles (5 - including EC2 instance role)
					expect(resourceNames.length).toBe(5);

					// Verify each resource name is valid (non-empty, follows pattern)
					for (const naming of resourceNames) {
						expect(naming.roleName).toBeTruthy();
						expect(naming.roleName.length).toBeGreaterThan(0);
						expect(naming.environment).toBe(config.environment);
						expect(naming.projectName).toBe(config.projectName);

						// Verify the role name contains the environment
						expect(naming.roleName).toContain(config.environment);

						// Verify the role name contains the project name
						expect(naming.roleName).toContain(config.projectName);
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, resource naming SHALL be
		 * consistent across environments following the pattern {projectName}-{environment}-{resourceType}.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should maintain consistent resource naming patterns across environments", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					const resourceNames = generateResourceNames(template, config);

					for (const naming of resourceNames) {
						// Verify naming follows the expected pattern
						const isValid = validateResourceNaming(naming, config);
						expect(isValid).toBe(true);

						// Verify the naming pattern is consistent
						// Pattern: {projectName}-{environment}-{resourceType}
						const parts = naming.roleName.split("-");
						expect(parts.length).toBeGreaterThanOrEqual(3);

						// First part should be the project name (or start of it)
						expect(naming.roleName.startsWith(config.projectName)).toBe(true);

						// Should contain the environment
						expect(naming.roleName).toContain(`-${config.environment}-`);
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, IAM policies SHALL NOT use
		 * wildcard (*) resources where specific ARNs are possible.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should not use wildcard resources where specific ARNs are possible", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					const policyStatements = getAllPolicyStatements(template);

					for (const { policyName, statement } of policyStatements) {
						const sid = statement.Sid || "unknown";

						// Check for inappropriate wildcards
						const hasInappropriate = hasInappropriateWildcard(
							statement.Resource,
							sid,
						);

						if (hasInappropriate) {
							// Fail with descriptive message
							throw new Error(
								`Policy ${policyName}, statement ${sid} uses inappropriate wildcard resource. ` +
									`Environment: ${config.environment}, Project: ${config.projectName}`,
							);
						}
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, all IAM role ARNs in policy
		 * resources SHALL be parameterized with environment and project name.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should parameterize IAM role ARNs with environment and project name", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					const policyStatements = getAllPolicyStatements(template);

					for (const { policyName, statement } of policyStatements) {
						const resources = Array.isArray(statement.Resource)
							? statement.Resource
							: [statement.Resource];

						for (const resource of resources) {
							const resourceStr = extractSubValue(resource);

							if (resourceStr && resourceStr.includes("arn:aws:iam::")) {
								// IAM ARNs should be parameterized
								const hasEnvironmentParam =
									resourceStr.includes("${Environment}") ||
									resourceStr.includes("${ProjectName}");

								// If it's a specific IAM ARN (not a managed policy), it should be parameterized
								if (
									!resourceStr.includes("aws:policy/") &&
									resourceStr.includes(":role/")
								) {
									expect(hasEnvironmentParam).toBe(true);
								}
							}
						}
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, resource ARNs SHALL use
		 * the correct region and account ID placeholders.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should use correct region and account ID placeholders in resource ARNs", () => {
			fc.assert(
				fc.property(environmentConfigArb, (_config) => {
					const policyStatements = getAllPolicyStatements(template);

					for (const { statement } of policyStatements) {
						const resources = Array.isArray(statement.Resource)
							? statement.Resource
							: [statement.Resource];

						for (const resource of resources) {
							const resourceStr = extractSubValue(resource);

							if (resourceStr && resourceStr.startsWith("arn:aws:")) {
								// ARNs should use ${AWS::Region} and ${AWS::AccountId} placeholders
								// or be global resources (like IAM managed policies, S3 buckets)
								const isGlobalResource =
									resourceStr.includes("arn:aws:iam::aws:policy/") ||
									resourceStr === "*";

								// S3 bucket ARNs are global namespace (no region/account in ARN)
								const isS3Resource = resourceStr.includes("arn:aws:s3:::");

								// IAM resources are global (no region in ARN)
								const isIamResource = resourceStr.includes(":iam::");

								if (!isGlobalResource && !isS3Resource) {
									// Should have region placeholder or be a global service
									const hasRegionPlaceholder =
										resourceStr.includes("${AWS::Region}") || isIamResource; // IAM is global

									// Should have account ID placeholder for regional services
									const hasAccountPlaceholder =
										resourceStr.includes("${AWS::AccountId}") || isIamResource; // IAM uses account ID differently

									// At least one should be true for non-global resources
									expect(hasRegionPlaceholder || hasAccountPlaceholder).toBe(
										true,
									);
								}

								// For S3 resources, verify they use parameterized bucket names
								if (isS3Resource) {
									// S3 bucket names should be parameterized with project/environment
									const hasParameterizedBucket =
										resourceStr.includes("${ProjectName}") ||
										resourceStr.includes("${Environment}") ||
										resourceStr.includes("codepipeline-"); // CodePipeline managed buckets

									expect(hasParameterizedBucket).toBe(true);
								}
							}
						}
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, the template SHALL define
		 * all required IAM roles (CodePipeline, CodeBuild, ECS Execution, EC2 Instance, ECS Task).
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should define all required IAM roles for any environment", () => {
			fc.assert(
				fc.property(environmentConfigArb, (config) => {
					const requiredRoles = [
						"CodePipelineRole",
						"CodeBuildRole",
						"EcsExecutionRole",
						"Ec2InstanceRole",
						"EcsTaskRole",
					];

					for (const roleName of requiredRoles) {
						const role = template.Resources?.[roleName];
						expect(role).toBeDefined();
						expect(role?.Type).toBe("AWS::IAM::Role");
					}

					// Verify resource names would be generated correctly
					const resourceNames = generateResourceNames(template, config);
					expect(resourceNames.length).toBe(requiredRoles.length);

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, policy statements SHALL have
		 * unique Sids for identification and auditing.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should have unique Sids for all policy statements", () => {
			fc.assert(
				fc.property(environmentConfigArb, (_config) => {
					const policyStatements = getAllPolicyStatements(template);
					const sidsByPolicy = new Map<string, Set<string>>();

					for (const { policyName, statement } of policyStatements) {
						// Each statement should have a Sid
						expect(statement.Sid).toBeDefined();
						expect(statement.Sid!.length).toBeGreaterThan(0);

						// Track Sids per policy to ensure uniqueness within each policy
						if (!sidsByPolicy.has(policyName)) {
							sidsByPolicy.set(policyName, new Set());
						}

						const sids = sidsByPolicy.get(policyName)!;
						expect(sids.has(statement.Sid!)).toBe(false); // Should not be duplicate
						sids.add(statement.Sid!);
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});

		/**
		 * Property: For any environment configuration, conditions on wildcard resources
		 * SHALL restrict access appropriately.
		 *
		 * **Validates: Requirements 8.5, 9.2**
		 */
		test("should have conditions on statements with wildcard resources", () => {
			fc.assert(
				fc.property(environmentConfigArb, (_config) => {
					const policyStatements = getAllPolicyStatements(template);

					for (const { policyName, statement } of policyStatements) {
						const sid = statement.Sid || "unknown";

						// If the resource is a pure wildcard, there should be a condition
						// (except for certain AWS API requirements)
						if (isPureWildcardResource(statement.Resource)) {
							// These operations require "*" resource but should have conditions
							const requiresCondition = [
								"VpcAccess",
								"EcsTaskDefinitionAccess",
							].includes(sid);

							if (requiresCondition) {
								expect(statement.Condition).toBeDefined();
							}
						}
					}

					return true;
				}),
				{ numRuns: 100 },
			);
		});
	});
});

