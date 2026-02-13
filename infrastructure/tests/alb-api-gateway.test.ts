/**
 * Unit Tests for ALB and API Gateway CloudFormation Template Validation
 *
 * Validates: Requirements 2.2 - THE API_Gateway SHALL connect to the internal ALB via a VPC Link
 * Validates: Requirements 2.3 - THE ALB SHALL be deployed in private subnets and not directly accessible from the internet
 * Validates: Requirements 2.9 - THE ALB SHALL perform health checks on the /health endpoint of the .NET application
 *
 * Test Coverage:
 * 1. ALB scheme is "internal" (not "internet-facing")
 * 2. Health check path is "/health"
 * 3. Health check interval is 30 seconds
 * 4. API Gateway uses VPC Link integration type
 * 5. API Gateway integration connection type is "VPC_LINK"
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Expected configurations from requirements
const EXPECTED_ALB_CONFIG = {
  scheme: "internal",
  healthCheckPath: "/health",
  healthCheckIntervalSeconds: 30,
};

const EXPECTED_API_GATEWAY_CONFIG = {
  protocolType: "HTTP",
  integrationType: "HTTP_PROXY",
  connectionType: "VPC_LINK",
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

// =============================================================================
// ALB TEMPLATE TESTS
// =============================================================================
describe("ALB CloudFormation Template Validation", () => {
  let template: CloudFormationTemplate;
  const templatePath = path.join(__dirname, "..", "alb.yaml");

  beforeAll(() => {
    // Load and parse the ALB template with CloudFormation schema
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

  describe("ALB Scheme Configuration (Requirement 2.3)", () => {
    test("should define an Application Load Balancer resource", () => {
      const alb = template.Resources?.InternalAlb;
      expect(alb).toBeDefined();
      expect(alb?.Type).toBe("AWS::ElasticLoadBalancingV2::LoadBalancer");
    });

    test("should have scheme set to 'internal' (not internet-facing)", () => {
      const alb = template.Resources?.InternalAlb;
      const properties = alb?.Properties as Record<string, unknown>;
      expect(properties?.Scheme).toBe(EXPECTED_ALB_CONFIG.scheme);
    });

    test("should have type set to 'application'", () => {
      const alb = template.Resources?.InternalAlb;
      const properties = alb?.Properties as Record<string, unknown>;
      expect(properties?.Type).toBe("application");
    });

    test("should be deployed in private subnets", () => {
      const alb = template.Resources?.InternalAlb;
      const properties = alb?.Properties as Record<string, unknown>;
      const subnets = properties?.Subnets as unknown[];
      expect(subnets).toBeDefined();
      expect(Array.isArray(subnets)).toBe(true);
      expect(subnets.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Target Group Health Check Configuration (Requirement 2.9)", () => {
    test("should define a Target Group resource", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      expect(targetGroup).toBeDefined();
      expect(targetGroup?.Type).toBe("AWS::ElasticLoadBalancingV2::TargetGroup");
    });

    test("should have health check path set to '/health'", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      // Health check path is parameterized, check the parameter default
      const healthCheckPath = properties?.HealthCheckPath;
      // If it's a Ref, check the parameter default
      if (healthCheckPath && typeof healthCheckPath === "object" && "Ref" in healthCheckPath) {
        const paramName = (healthCheckPath as { Ref: string }).Ref;
        const param = template.Parameters?.[paramName] as Record<string, unknown>;
        expect(param?.Default).toBe(EXPECTED_ALB_CONFIG.healthCheckPath);
      } else {
        expect(healthCheckPath).toBe(EXPECTED_ALB_CONFIG.healthCheckPath);
      }
    });

    test("should have health check interval set to 30 seconds", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      // Health check interval is parameterized, check the parameter default
      const healthCheckInterval = properties?.HealthCheckIntervalSeconds;
      // If it's a Ref, check the parameter default
      if (healthCheckInterval && typeof healthCheckInterval === "object" && "Ref" in healthCheckInterval) {
        const paramName = (healthCheckInterval as { Ref: string }).Ref;
        const param = template.Parameters?.[paramName] as Record<string, unknown>;
        expect(param?.Default).toBe(EXPECTED_ALB_CONFIG.healthCheckIntervalSeconds);
      } else {
        expect(healthCheckInterval).toBe(EXPECTED_ALB_CONFIG.healthCheckIntervalSeconds);
      }
    });

    test("should have health check enabled", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      expect(properties?.HealthCheckEnabled).toBe(true);
    });

    test("should have health check protocol set to HTTP", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      expect(properties?.HealthCheckProtocol).toBe("HTTP");
    });

    test("should have target type set to 'ip' for Fargate compatibility", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      expect(properties?.TargetType).toBe("ip");
    });

    test("should have HTTP 200 as success matcher", () => {
      const targetGroup = template.Resources?.ApiTargetGroup;
      const properties = targetGroup?.Properties as Record<string, unknown>;
      const matcher = properties?.Matcher as Record<string, unknown>;
      expect(matcher?.HttpCode).toBe("200");
    });
  });

  describe("ALB Listener Configuration", () => {
    test("should define HTTP listener for redirect", () => {
      const httpListener = template.Resources?.HttpListener;
      expect(httpListener).toBeDefined();
      expect(httpListener?.Type).toBe("AWS::ElasticLoadBalancingV2::Listener");
    });

    test("should define HTTPS listener", () => {
      const httpsListener = template.Resources?.HttpsListener;
      expect(httpsListener).toBeDefined();
      expect(httpsListener?.Type).toBe("AWS::ElasticLoadBalancingV2::Listener");
    });

    test("HTTP listener should redirect to HTTPS", () => {
      const httpListener = template.Resources?.HttpListener;
      const properties = httpListener?.Properties as Record<string, unknown>;
      const defaultActions = properties?.DefaultActions as Array<Record<string, unknown>>;
      expect(defaultActions).toBeDefined();
      expect(defaultActions.length).toBeGreaterThan(0);
      expect(defaultActions[0].Type).toBe("redirect");
      const redirectConfig = defaultActions[0].RedirectConfig as Record<string, unknown>;
      expect(redirectConfig?.Protocol).toBe("HTTPS");
      expect(redirectConfig?.StatusCode).toBe("HTTP_301");
    });

    test("HTTPS listener should use TLS 1.3 policy", () => {
      const httpsListener = template.Resources?.HttpsListener;
      const properties = httpsListener?.Properties as Record<string, unknown>;
      expect(properties?.SslPolicy).toBe("ELBSecurityPolicy-TLS13-1-2-2021-06");
    });

    test("HTTPS listener should forward to target group", () => {
      const httpsListener = template.Resources?.HttpsListener;
      const properties = httpsListener?.Properties as Record<string, unknown>;
      const defaultActions = properties?.DefaultActions as Array<Record<string, unknown>>;
      expect(defaultActions).toBeDefined();
      expect(defaultActions.length).toBeGreaterThan(0);
      expect(defaultActions[0].Type).toBe("forward");
    });
  });

  describe("ALB Parameter Validation", () => {
    test("should have HealthCheckPath parameter with default '/health'", () => {
      const param = template.Parameters?.HealthCheckPath as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBe("/health");
    });

    test("should have HealthCheckIntervalSeconds parameter with default 30", () => {
      const param = template.Parameters?.HealthCheckIntervalSeconds as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBe(30);
    });

    test("should have Environment parameter with allowed values", () => {
      const param = template.Parameters?.Environment as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.AllowedValues).toEqual(["dev", "staging", "prod"]);
    });
  });

  describe("ALB Outputs", () => {
    test("should export ALB ARN", () => {
      expect(template.Outputs?.AlbArn).toBeDefined();
    });

    test("should export ALB DNS Name", () => {
      expect(template.Outputs?.AlbDnsName).toBeDefined();
    });

    test("should export Target Group ARN", () => {
      expect(template.Outputs?.TargetGroupArn).toBeDefined();
    });

    test("should export HTTPS Listener ARN", () => {
      expect(template.Outputs?.HttpsListenerArn).toBeDefined();
    });
  });
});

// =============================================================================
// API GATEWAY TEMPLATE TESTS
// =============================================================================
describe("API Gateway CloudFormation Template Validation", () => {
  let template: CloudFormationTemplate;
  const templatePath = path.join(__dirname, "..", "api-gateway.yaml");

  beforeAll(() => {
    // Load and parse the API Gateway template with CloudFormation schema
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

  describe("HTTP API Configuration (Requirement 2.1)", () => {
    test("should define an HTTP API Gateway resource", () => {
      const httpApi = template.Resources?.HttpApi;
      expect(httpApi).toBeDefined();
      expect(httpApi?.Type).toBe("AWS::ApiGatewayV2::Api");
    });

    test("should have protocol type set to HTTP", () => {
      const httpApi = template.Resources?.HttpApi;
      const properties = httpApi?.Properties as Record<string, unknown>;
      expect(properties?.ProtocolType).toBe(EXPECTED_API_GATEWAY_CONFIG.protocolType);
    });

    test("should have CORS configuration", () => {
      const httpApi = template.Resources?.HttpApi;
      const properties = httpApi?.Properties as Record<string, unknown>;
      expect(properties?.CorsConfiguration).toBeDefined();
    });

    test("should allow required HTTP methods in CORS", () => {
      const httpApi = template.Resources?.HttpApi;
      const properties = httpApi?.Properties as Record<string, unknown>;
      const corsConfig = properties?.CorsConfiguration as Record<string, unknown>;
      const allowMethods = corsConfig?.AllowMethods as string[];
      expect(allowMethods).toContain("GET");
      expect(allowMethods).toContain("POST");
      expect(allowMethods).toContain("PUT");
      expect(allowMethods).toContain("DELETE");
      expect(allowMethods).toContain("OPTIONS");
    });
  });

  describe("VPC Link Configuration (Requirement 2.2)", () => {
    test("should define a VPC Link resource", () => {
      const vpcLink = template.Resources?.VpcLink;
      expect(vpcLink).toBeDefined();
      expect(vpcLink?.Type).toBe("AWS::ApiGatewayV2::VpcLink");
    });

    test("should have VPC Link configured with subnets", () => {
      const vpcLink = template.Resources?.VpcLink;
      const properties = vpcLink?.Properties as Record<string, unknown>;
      const subnetIds = properties?.SubnetIds as unknown[];
      expect(subnetIds).toBeDefined();
      expect(Array.isArray(subnetIds)).toBe(true);
      expect(subnetIds.length).toBeGreaterThanOrEqual(2);
    });

    test("should have VPC Link configured with security groups", () => {
      const vpcLink = template.Resources?.VpcLink;
      const properties = vpcLink?.Properties as Record<string, unknown>;
      const securityGroupIds = properties?.SecurityGroupIds as unknown[];
      expect(securityGroupIds).toBeDefined();
      expect(Array.isArray(securityGroupIds)).toBe(true);
      expect(securityGroupIds.length).toBeGreaterThan(0);
    });
  });

  describe("ALB Integration Configuration (Requirement 2.2)", () => {
    test("should define an ALB Integration resource", () => {
      const integration = template.Resources?.AlbIntegration;
      expect(integration).toBeDefined();
      expect(integration?.Type).toBe("AWS::ApiGatewayV2::Integration");
    });

    test("should have integration type set to HTTP_PROXY", () => {
      const integration = template.Resources?.AlbIntegration;
      const properties = integration?.Properties as Record<string, unknown>;
      expect(properties?.IntegrationType).toBe(EXPECTED_API_GATEWAY_CONFIG.integrationType);
    });

    test("should have connection type set to VPC_LINK", () => {
      const integration = template.Resources?.AlbIntegration;
      const properties = integration?.Properties as Record<string, unknown>;
      expect(properties?.ConnectionType).toBe(EXPECTED_API_GATEWAY_CONFIG.connectionType);
    });

    test("should reference the VPC Link", () => {
      const integration = template.Resources?.AlbIntegration;
      const properties = integration?.Properties as Record<string, unknown>;
      const connectionId = properties?.ConnectionId;
      expect(connectionId).toBeDefined();
      // Should reference the VpcLink resource
      expect(connectionId).toEqual({ Ref: "VpcLink" });
    });

    test("should have integration method set to ANY", () => {
      const integration = template.Resources?.AlbIntegration;
      const properties = integration?.Properties as Record<string, unknown>;
      expect(properties?.IntegrationMethod).toBe("ANY");
    });

    test("should have payload format version 1.0", () => {
      const integration = template.Resources?.AlbIntegration;
      const properties = integration?.Properties as Record<string, unknown>;
      expect(properties?.PayloadFormatVersion).toBe("1.0");
    });
  });

  describe("API Gateway Stage and Throttling (Requirement 2.4)", () => {
    test("should define an API Stage resource", () => {
      const stage = template.Resources?.ApiStage;
      expect(stage).toBeDefined();
      expect(stage?.Type).toBe("AWS::ApiGatewayV2::Stage");
    });

    test("should have auto deploy enabled", () => {
      const stage = template.Resources?.ApiStage;
      const properties = stage?.Properties as Record<string, unknown>;
      expect(properties?.AutoDeploy).toBe(true);
    });

    test("should have throttling configuration in default route settings", () => {
      const stage = template.Resources?.ApiStage;
      const properties = stage?.Properties as Record<string, unknown>;
      const defaultRouteSettings = properties?.DefaultRouteSettings as Record<string, unknown>;
      expect(defaultRouteSettings).toBeDefined();
      expect(defaultRouteSettings?.ThrottlingBurstLimit).toBeDefined();
      expect(defaultRouteSettings?.ThrottlingRateLimit).toBeDefined();
    });

    test("should have detailed metrics enabled", () => {
      const stage = template.Resources?.ApiStage;
      const properties = stage?.Properties as Record<string, unknown>;
      const defaultRouteSettings = properties?.DefaultRouteSettings as Record<string, unknown>;
      expect(defaultRouteSettings?.DetailedMetricsEnabled).toBe(true);
    });

    test("should have access log settings configured", () => {
      const stage = template.Resources?.ApiStage;
      const properties = stage?.Properties as Record<string, unknown>;
      expect(properties?.AccessLogSettings).toBeDefined();
    });
  });

  describe("API Gateway Routes", () => {
    test("should define a default route", () => {
      const defaultRoute = template.Resources?.DefaultRoute;
      expect(defaultRoute).toBeDefined();
      expect(defaultRoute?.Type).toBe("AWS::ApiGatewayV2::Route");
    });

    test("should define an API route for /api/* endpoints", () => {
      const apiRoute = template.Resources?.ApiRoute;
      expect(apiRoute).toBeDefined();
      expect(apiRoute?.Type).toBe("AWS::ApiGatewayV2::Route");
      const properties = apiRoute?.Properties as Record<string, unknown>;
      expect(properties?.RouteKey).toBe("ANY /api/{proxy+}");
    });

    test("should define a health route for /health endpoint", () => {
      const healthRoute = template.Resources?.HealthRoute;
      expect(healthRoute).toBeDefined();
      expect(healthRoute?.Type).toBe("AWS::ApiGatewayV2::Route");
      const properties = healthRoute?.Properties as Record<string, unknown>;
      expect(properties?.RouteKey).toBe("GET /health");
    });
  });

  describe("API Gateway Parameter Validation", () => {
    test("should have Environment parameter with allowed values", () => {
      const param = template.Parameters?.Environment as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.AllowedValues).toEqual(["dev", "staging", "prod"]);
    });

    test("should have ThrottlingBurstLimit parameter", () => {
      const param = template.Parameters?.ThrottlingBurstLimit as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBeDefined();
      expect(typeof param.Default).toBe("number");
    });

    test("should have ThrottlingRateLimit parameter", () => {
      const param = template.Parameters?.ThrottlingRateLimit as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBeDefined();
      expect(typeof param.Default).toBe("number");
    });

    test("should have AlbListenerArn parameter with ARN pattern", () => {
      const param = template.Parameters?.AlbListenerArn as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.AllowedPattern).toContain("arn:aws:elasticloadbalancing");
    });
  });

  describe("API Gateway Outputs", () => {
    test("should export API Gateway ID", () => {
      expect(template.Outputs?.ApiGatewayId).toBeDefined();
    });

    test("should export API Gateway Endpoint URL", () => {
      expect(template.Outputs?.ApiGatewayEndpoint).toBeDefined();
    });

    test("should export VPC Link ID", () => {
      expect(template.Outputs?.VpcLinkId).toBeDefined();
    });

    test("should export ALB Integration ID", () => {
      expect(template.Outputs?.AlbIntegrationId).toBeDefined();
    });

    test("should export throttling configuration", () => {
      expect(template.Outputs?.ThrottlingBurstLimit).toBeDefined();
      expect(template.Outputs?.ThrottlingRateLimit).toBeDefined();
    });
  });

  describe("CloudWatch Logging", () => {
    test("should define a CloudWatch Log Group for API Gateway", () => {
      const logGroup = template.Resources?.ApiGatewayLogGroup;
      expect(logGroup).toBeDefined();
      expect(logGroup?.Type).toBe("AWS::Logs::LogGroup");
    });

    test("should have log retention set to 90 days", () => {
      const logGroup = template.Resources?.ApiGatewayLogGroup;
      const properties = logGroup?.Properties as Record<string, unknown>;
      expect(properties?.RetentionInDays).toBe(90);
    });
  });
});
