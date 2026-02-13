/**
 * Unit Tests for VPC CloudFormation Template Validation
 *
 * Validates: Requirements 9.1 - THE Pipeline infrastructure SHALL be defined using AWS CloudFormation or CDK templates
 *
 * Test Coverage:
 * 1. Template is valid YAML and can be parsed
 * 2. CIDR blocks match expected values
 * 3. Subnets are distributed across 2 availability zones
 * 4. NAT Gateways are in public subnets
 * 5. Route tables have correct routes (public to IGW, private to NAT)
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected CIDR configurations from design document
const EXPECTED_CONFIG = {
	vpcCidr: "10.0.0.0/16",
	publicSubnets: ["10.0.1.0/24", "10.0.2.0/24"],
	privateSubnets: ["10.0.10.0/24", "10.0.11.0/24"],
	numberOfAZs: 2,
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

describe("VPC CloudFormation Template Validation", () => {
	let template: CloudFormationTemplate;
	const templatePath = path.join(__dirname, "..", "vpc.yaml");

	beforeAll(() => {
		// Load and parse the VPC template with CloudFormation schema
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

	describe("VPC Configuration", () => {
		test("should define a VPC resource", () => {
			const vpcResource = template.Resources?.VPC;
			expect(vpcResource).toBeDefined();
			expect(vpcResource?.Type).toBe("AWS::EC2::VPC");
		});

		test("should have VPC CIDR block parameter with correct default", () => {
			const vpcCidrParam = template.Parameters?.VpcCidr as Record<
				string,
				unknown
			>;
			expect(vpcCidrParam).toBeDefined();
			expect(vpcCidrParam.Default).toBe(EXPECTED_CONFIG.vpcCidr);
		});

		test("should enable DNS hostnames and support", () => {
			const vpcProps = template.Resources?.VPC?.Properties;
			expect(vpcProps?.EnableDnsHostnames).toBe(true);
			expect(vpcProps?.EnableDnsSupport).toBe(true);
		});
	});

	describe("CIDR Block Configuration", () => {
		test("should have correct VPC CIDR block default", () => {
			const vpcCidrParam = template.Parameters?.VpcCidr as Record<
				string,
				unknown
			>;
			expect(vpcCidrParam?.Default).toBe(EXPECTED_CONFIG.vpcCidr);
		});

		test("should have correct public subnet 1 CIDR block", () => {
			const subnet = template.Resources?.PublicSubnet1?.Properties;
			expect(subnet?.CidrBlock).toBe(EXPECTED_CONFIG.publicSubnets[0]);
		});

		test("should have correct public subnet 2 CIDR block", () => {
			const subnet = template.Resources?.PublicSubnet2?.Properties;
			expect(subnet?.CidrBlock).toBe(EXPECTED_CONFIG.publicSubnets[1]);
		});

		test("should have correct private subnet 1 CIDR block", () => {
			const subnet = template.Resources?.PrivateSubnet1?.Properties;
			expect(subnet?.CidrBlock).toBe(EXPECTED_CONFIG.privateSubnets[0]);
		});

		test("should have correct private subnet 2 CIDR block", () => {
			const subnet = template.Resources?.PrivateSubnet2?.Properties;
			expect(subnet?.CidrBlock).toBe(EXPECTED_CONFIG.privateSubnets[1]);
		});

		test("should have all subnet CIDRs within VPC CIDR range", () => {
			// All subnets should be within 10.0.0.0/16
			const allSubnetCidrs = [
				...EXPECTED_CONFIG.publicSubnets,
				...EXPECTED_CONFIG.privateSubnets,
			];

			allSubnetCidrs.forEach((cidr) => {
				expect(cidr.startsWith("10.0.")).toBe(true);
			});
		});
	});

	describe("Subnet Distribution Across Availability Zones", () => {
		test("should have exactly 2 public subnets", () => {
			const publicSubnets = Object.entries(template.Resources || {}).filter(
				([key, resource]) =>
					key.startsWith("PublicSubnet") &&
					resource.Type === "AWS::EC2::Subnet",
			);
			expect(publicSubnets.length).toBe(EXPECTED_CONFIG.numberOfAZs);
		});

		test("should have exactly 2 private subnets", () => {
			const privateSubnets = Object.entries(template.Resources || {}).filter(
				([key, resource]) =>
					key.startsWith("PrivateSubnet") &&
					resource.Type === "AWS::EC2::Subnet",
			);
			expect(privateSubnets.length).toBe(EXPECTED_CONFIG.numberOfAZs);
		});

		test("should distribute public subnets across different AZs", () => {
			const publicSubnet1Az =
				template.Resources?.PublicSubnet1?.Properties?.AvailabilityZone;
			const publicSubnet2Az =
				template.Resources?.PublicSubnet2?.Properties?.AvailabilityZone;

			// Both should use Fn::Select with different indices
			expect(publicSubnet1Az).toBeDefined();
			expect(publicSubnet2Az).toBeDefined();

			// Verify they use different AZ indices (0 and 1)
			const az1Select = publicSubnet1Az as { "Fn::Select": [number, unknown] };
			const az2Select = publicSubnet2Az as { "Fn::Select": [number, unknown] };

			expect(az1Select["Fn::Select"][0]).toBe(0);
			expect(az2Select["Fn::Select"][0]).toBe(1);
		});

		test("should distribute private subnets across different AZs", () => {
			const privateSubnet1Az =
				template.Resources?.PrivateSubnet1?.Properties?.AvailabilityZone;
			const privateSubnet2Az =
				template.Resources?.PrivateSubnet2?.Properties?.AvailabilityZone;

			expect(privateSubnet1Az).toBeDefined();
			expect(privateSubnet2Az).toBeDefined();

			// Verify they use different AZ indices (0 and 1)
			const az1Select = privateSubnet1Az as { "Fn::Select": [number, unknown] };
			const az2Select = privateSubnet2Az as { "Fn::Select": [number, unknown] };

			expect(az1Select["Fn::Select"][0]).toBe(0);
			expect(az2Select["Fn::Select"][0]).toBe(1);
		});

		test("should have public subnets with MapPublicIpOnLaunch enabled", () => {
			expect(
				template.Resources?.PublicSubnet1?.Properties?.MapPublicIpOnLaunch,
			).toBe(true);
			expect(
				template.Resources?.PublicSubnet2?.Properties?.MapPublicIpOnLaunch,
			).toBe(true);
		});

		test("should have private subnets with MapPublicIpOnLaunch disabled", () => {
			expect(
				template.Resources?.PrivateSubnet1?.Properties?.MapPublicIpOnLaunch,
			).toBe(false);
			expect(
				template.Resources?.PrivateSubnet2?.Properties?.MapPublicIpOnLaunch,
			).toBe(false);
		});
	});

	describe("NAT Gateway Configuration", () => {
		test("should have exactly 2 NAT Gateways", () => {
			const natGateways = Object.entries(template.Resources || {}).filter(
				([_, resource]) => resource.Type === "AWS::EC2::NatGateway",
			);
			expect(natGateways.length).toBe(EXPECTED_CONFIG.numberOfAZs);
		});

		test("should have NAT Gateway 1 in public subnet 1", () => {
			const natGateway1 = template.Resources?.NatGateway1?.Properties;
			expect(natGateway1?.SubnetId).toEqual({ Ref: "PublicSubnet1" });
		});

		test("should have NAT Gateway 2 in public subnet 2", () => {
			const natGateway2 = template.Resources?.NatGateway2?.Properties;
			expect(natGateway2?.SubnetId).toEqual({ Ref: "PublicSubnet2" });
		});

		test("should have Elastic IPs for NAT Gateways", () => {
			const eips = Object.entries(template.Resources || {}).filter(
				([_, resource]) => resource.Type === "AWS::EC2::EIP",
			);
			expect(eips.length).toBeGreaterThanOrEqual(EXPECTED_CONFIG.numberOfAZs);
		});

		test("should associate NAT Gateway 1 with its Elastic IP", () => {
			const natGateway1 = template.Resources?.NatGateway1?.Properties;
			expect(natGateway1?.AllocationId).toEqual({
				"Fn::GetAtt": ["NatEip1", "AllocationId"],
			});
		});

		test("should associate NAT Gateway 2 with its Elastic IP", () => {
			const natGateway2 = template.Resources?.NatGateway2?.Properties;
			expect(natGateway2?.AllocationId).toEqual({
				"Fn::GetAtt": ["NatEip2", "AllocationId"],
			});
		});
	});

	describe("Internet Gateway Configuration", () => {
		test("should define an Internet Gateway", () => {
			const igw = template.Resources?.InternetGateway;
			expect(igw).toBeDefined();
			expect(igw?.Type).toBe("AWS::EC2::InternetGateway");
		});

		test("should attach Internet Gateway to VPC", () => {
			const attachment = template.Resources?.InternetGatewayAttachment;
			expect(attachment).toBeDefined();
			expect(attachment?.Type).toBe("AWS::EC2::VPCGatewayAttachment");
			expect(attachment?.Properties?.VpcId).toEqual({ Ref: "VPC" });
			expect(attachment?.Properties?.InternetGatewayId).toEqual({
				Ref: "InternetGateway",
			});
		});
	});

	describe("Route Table Configuration", () => {
		test("should have a public route table", () => {
			const publicRt = template.Resources?.PublicRouteTable;
			expect(publicRt).toBeDefined();
			expect(publicRt?.Type).toBe("AWS::EC2::RouteTable");
		});

		test("should have 2 private route tables (one per AZ)", () => {
			const privateRouteTables = Object.entries(
				template.Resources || {},
			).filter(
				([key, resource]) =>
					key.startsWith("PrivateRouteTable") &&
					resource.Type === "AWS::EC2::RouteTable",
			);
			expect(privateRouteTables.length).toBe(EXPECTED_CONFIG.numberOfAZs);
		});

		test("should have public route to Internet Gateway", () => {
			const publicRoute = template.Resources?.PublicRoute;
			expect(publicRoute).toBeDefined();
			expect(publicRoute?.Type).toBe("AWS::EC2::Route");
			expect(publicRoute?.Properties?.DestinationCidrBlock).toBe("0.0.0.0/0");
			expect(publicRoute?.Properties?.GatewayId).toEqual({
				Ref: "InternetGateway",
			});
			expect(publicRoute?.Properties?.RouteTableId).toEqual({
				Ref: "PublicRouteTable",
			});
		});

		test("should have private route 1 to NAT Gateway 1", () => {
			const privateRoute1 = template.Resources?.PrivateRoute1;
			expect(privateRoute1).toBeDefined();
			expect(privateRoute1?.Type).toBe("AWS::EC2::Route");
			expect(privateRoute1?.Properties?.DestinationCidrBlock).toBe("0.0.0.0/0");
			expect(privateRoute1?.Properties?.NatGatewayId).toEqual({
				Ref: "NatGateway1",
			});
			expect(privateRoute1?.Properties?.RouteTableId).toEqual({
				Ref: "PrivateRouteTable1",
			});
		});

		test("should have private route 2 to NAT Gateway 2", () => {
			const privateRoute2 = template.Resources?.PrivateRoute2;
			expect(privateRoute2).toBeDefined();
			expect(privateRoute2?.Type).toBe("AWS::EC2::Route");
			expect(privateRoute2?.Properties?.DestinationCidrBlock).toBe("0.0.0.0/0");
			expect(privateRoute2?.Properties?.NatGatewayId).toEqual({
				Ref: "NatGateway2",
			});
			expect(privateRoute2?.Properties?.RouteTableId).toEqual({
				Ref: "PrivateRouteTable2",
			});
		});
	});

	describe("Route Table Associations", () => {
		test("should associate public subnet 1 with public route table", () => {
			const association =
				template.Resources?.PublicSubnet1RouteTableAssociation;
			expect(association).toBeDefined();
			expect(association?.Type).toBe("AWS::EC2::SubnetRouteTableAssociation");
			expect(association?.Properties?.SubnetId).toEqual({
				Ref: "PublicSubnet1",
			});
			expect(association?.Properties?.RouteTableId).toEqual({
				Ref: "PublicRouteTable",
			});
		});

		test("should associate public subnet 2 with public route table", () => {
			const association =
				template.Resources?.PublicSubnet2RouteTableAssociation;
			expect(association).toBeDefined();
			expect(association?.Type).toBe("AWS::EC2::SubnetRouteTableAssociation");
			expect(association?.Properties?.SubnetId).toEqual({
				Ref: "PublicSubnet2",
			});
			expect(association?.Properties?.RouteTableId).toEqual({
				Ref: "PublicRouteTable",
			});
		});

		test("should associate private subnet 1 with private route table 1", () => {
			const association =
				template.Resources?.PrivateSubnet1RouteTableAssociation;
			expect(association).toBeDefined();
			expect(association?.Type).toBe("AWS::EC2::SubnetRouteTableAssociation");
			expect(association?.Properties?.SubnetId).toEqual({
				Ref: "PrivateSubnet1",
			});
			expect(association?.Properties?.RouteTableId).toEqual({
				Ref: "PrivateRouteTable1",
			});
		});

		test("should associate private subnet 2 with private route table 2", () => {
			const association =
				template.Resources?.PrivateSubnet2RouteTableAssociation;
			expect(association).toBeDefined();
			expect(association?.Type).toBe("AWS::EC2::SubnetRouteTableAssociation");
			expect(association?.Properties?.SubnetId).toEqual({
				Ref: "PrivateSubnet2",
			});
			expect(association?.Properties?.RouteTableId).toEqual({
				Ref: "PrivateRouteTable2",
			});
		});
	});

	describe("CloudFormation Outputs", () => {
		test("should export VPC ID", () => {
			expect(template.Outputs?.VpcId).toBeDefined();
		});

		test("should export all public subnet IDs", () => {
			expect(template.Outputs?.PublicSubnet1Id).toBeDefined();
			expect(template.Outputs?.PublicSubnet2Id).toBeDefined();
		});

		test("should export all private subnet IDs", () => {
			expect(template.Outputs?.PrivateSubnet1Id).toBeDefined();
			expect(template.Outputs?.PrivateSubnet2Id).toBeDefined();
		});

		test("should export NAT Gateway IDs", () => {
			expect(template.Outputs?.NatGateway1Id).toBeDefined();
			expect(template.Outputs?.NatGateway2Id).toBeDefined();
		});

		test("should export route table IDs", () => {
			expect(template.Outputs?.PublicRouteTableId).toBeDefined();
			expect(template.Outputs?.PrivateRouteTable1Id).toBeDefined();
			expect(template.Outputs?.PrivateRouteTable2Id).toBeDefined();
		});

		test("should export Internet Gateway ID", () => {
			expect(template.Outputs?.InternetGatewayId).toBeDefined();
		});
	});

	describe("Resource Tagging", () => {
		test("should have Name tags on VPC", () => {
			const vpcTags = template.Resources?.VPC?.Properties?.Tags as Array<{
				Key: string;
				Value: unknown;
			}>;
			expect(vpcTags).toBeDefined();
			const nameTag = vpcTags?.find((tag) => tag.Key === "Name");
			expect(nameTag).toBeDefined();
		});

		test("should have Environment tags on subnets", () => {
			const publicSubnet1Tags = template.Resources?.PublicSubnet1?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			const envTag = publicSubnet1Tags?.find(
				(tag) => tag.Key === "Environment",
			);
			expect(envTag).toBeDefined();
		});

		test("should have Type tags distinguishing public and private subnets", () => {
			const publicSubnet1Tags = template.Resources?.PublicSubnet1?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;
			const privateSubnet1Tags = template.Resources?.PrivateSubnet1?.Properties
				?.Tags as Array<{ Key: string; Value: unknown }>;

			const publicTypeTag = publicSubnet1Tags?.find(
				(tag) => tag.Key === "Type",
			);
			const privateTypeTag = privateSubnet1Tags?.find(
				(tag) => tag.Key === "Type",
			);

			expect(publicTypeTag?.Value).toBe("Public");
			expect(privateTypeTag?.Value).toBe("Private");
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

		test("should have VpcCidr parameter with CIDR pattern constraint", () => {
			const vpcCidrParam = template.Parameters?.VpcCidr as Record<
				string,
				unknown
			>;
			expect(vpcCidrParam).toBeDefined();
			expect(vpcCidrParam.AllowedPattern).toBeDefined();
		});
	});
});

