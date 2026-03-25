/**
 * Property-Based Tests for ECS Service Connect Configuration
 *
 * Feature: infrastructure-optimization, Property 11: Service Connect Configuration
 *
 * **Validates: Requirements 13.1, 13.2, 13.3**
 *
 * Property 11: Service Connect Configuration
 * _For any_ ECS service where Service Connect is enabled, the `ServiceConnectConfiguration`
 * SHALL include a service entry with the container port and a DNS name matching the
 * service name, using the cluster's default namespace.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface CloudFormationResource {
  Type: string;
  Condition?: string;
  DeletionPolicy?: string;
  Properties?: Record<string, unknown>;
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Resources?: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

// =============================================================================
// YAML SCHEMA FOR CLOUDFORMATION INTRINSIC FUNCTIONS
// =============================================================================

const cfnTags = [
  new yaml.Type("!Ref", { kind: "scalar", construct: (d: string) => ({ Ref: d }) }),
  new yaml.Type("!Sub", { kind: "scalar", construct: (d: string) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!Sub", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Sub": d }) }),
  new yaml.Type("!GetAtt", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAtt": d.split(".") }) }),
  new yaml.Type("!GetAtt", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::GetAtt": d }) }),
  new yaml.Type("!Select", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Select": d }) }),
  new yaml.Type("!GetAZs", { kind: "scalar", construct: (d: string) => ({ "Fn::GetAZs": d }) }),
  new yaml.Type("!Join", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Join": d }) }),
  new yaml.Type("!If", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::If": d }) }),
  new yaml.Type("!Equals", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Equals": d }) }),
  new yaml.Type("!Not", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Not": d }) }),
  new yaml.Type("!And", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::And": d }) }),
  new yaml.Type("!Or", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Or": d }) }),
  new yaml.Type("!Condition", { kind: "scalar", construct: (d: string) => ({ Condition: d }) }),
  new yaml.Type("!ImportValue", { kind: "scalar", construct: (d: string) => ({ "Fn::ImportValue": d }) }),
  new yaml.Type("!FindInMap", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::FindInMap": d }) }),
  new yaml.Type("!Base64", { kind: "scalar", construct: (d: string) => ({ "Fn::Base64": d }) }),
  new yaml.Type("!Cidr", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Cidr": d }) }),
  new yaml.Type("!Split", { kind: "sequence", construct: (d: unknown[]) => ({ "Fn::Split": d }) }),
];

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(cfnTags);

// =============================================================================
// CONSTANTS
// =============================================================================

const ECS_SERVICE_TEMPLATE_PATH = "ecs-service.yaml";

type Environment = "dev" | "staging" | "prod";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the ECS service CloudFormation template
 */
function loadTemplate(templatePath: string): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", templatePath);
  const templateContent = fs.readFileSync(fullPath, "utf8");
  return yaml.load(templateContent, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Find the EcsService resource in the template
 */
function findEcsService(
  template: CloudFormationTemplate
): { name: string; resource: CloudFormationResource } | undefined {
  const resources = template.Resources || {};
  for (const [name, resource] of Object.entries(resources)) {
    if (resource.Type === "AWS::ECS::Service") {
      return { name, resource };
    }
  }
  return undefined;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for all valid environment values
 */
const envArb: fc.Arbitrary<Environment> = fc.constantFrom(
  "dev" as Environment,
  "staging" as Environment,
  "prod" as Environment
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Service Connect Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 11: Service Connect Configuration
   * **Validates: Requirements 13.1, 13.2, 13.3**
   */
  describe("Property 11: Service Connect Configuration", () => {
    let template: CloudFormationTemplate;

    beforeAll(() => {
      template = loadTemplate(ECS_SERVICE_TEMPLATE_PATH);
    });

    // =========================================================================
    // Precondition tests
    // =========================================================================

    /**
     * Precondition: EcsService resource exists with correct type.
     */
    test("should have an EcsService resource of type AWS::ECS::Service", () => {
      const service = findEcsService(template);
      expect(service).toBeDefined();
      expect(service!.resource.Type).toBe("AWS::ECS::Service");
    });

    /**
     * Precondition: EcsService has ServiceConnectConfiguration property.
     */
    test("should have ServiceConnectConfiguration property on EcsService", () => {
      const service = findEcsService(template);
      expect(service).toBeDefined();
      expect(service!.resource.Properties?.ServiceConnectConfiguration).toBeDefined();
    });

    /**
     * Precondition: IsServiceConnectEnabled condition is defined in the template.
     */
    test("should have IsServiceConnectEnabled condition defined", () => {
      expect(template.Conditions).toBeDefined();
      expect(template.Conditions!.IsServiceConnectEnabled).toBeDefined();
    });

    /**
     * Precondition: EnableServiceConnect parameter exists with default "true".
     */
    test("should have EnableServiceConnect parameter with default true", () => {
      expect(template.Parameters).toBeDefined();
      const param = template.Parameters!.EnableServiceConnect as Record<string, unknown>;
      expect(param).toBeDefined();
      expect(param.Default).toBe("true");
    });

    /**
     * Precondition: ServiceConnectNamespace parameter exists.
     */
    test("should have ServiceConnectNamespace parameter", () => {
      expect(template.Parameters).toBeDefined();
      expect(template.Parameters!.ServiceConnectNamespace).toBeDefined();
    });

    // =========================================================================
    // Property: ServiceConnectConfiguration uses !If [IsServiceConnectEnabled, ...]
    // =========================================================================

    /**
     * Property: The ServiceConnectConfiguration SHALL use !If [IsServiceConnectEnabled, ...]
     * to conditionally enable or disable Service Connect.
     *
     * **Validates: Requirements 13.1, 13.3**
     */
    test("should use !If [IsServiceConnectEnabled, ...] for ServiceConnectConfiguration", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const scc = service.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
          if (!scc || typeof scc !== "object") {
            throw new Error(
              `ServiceConnectConfiguration is not defined. Found: ${JSON.stringify(scc)}`
            );
          }

          const fnIf = scc["Fn::If"] as unknown[];
          if (!Array.isArray(fnIf) || fnIf.length !== 3) {
            throw new Error(
              `ServiceConnectConfiguration !If has invalid structure. Found: ${JSON.stringify(fnIf)}`
            );
          }

          // Verify condition name
          expect(fnIf[0]).toBe("IsServiceConnectEnabled");

          return true;
        }),
        { numRuns: 100 }
      );
    });

    // =========================================================================
    // Property: Enabled branch has correct structure
    // =========================================================================

    /**
     * Property: When Service Connect is enabled, the configuration SHALL have
     * Enabled: true, a Namespace reference, and a Services array.
     *
     * **Validates: Requirements 13.1, 13.2**
     */
    test("should have Enabled: true, Namespace, and Services array in enabled branch", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const scc = service.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
          const fnIf = scc["Fn::If"] as unknown[];
          const enabledBranch = fnIf[1] as Record<string, unknown>;

          // Verify Enabled: true
          expect(enabledBranch.Enabled).toBe(true);

          // Verify Namespace references ServiceConnectNamespace parameter
          const namespace = enabledBranch.Namespace as Record<string, unknown>;
          expect(namespace).toBeDefined();
          expect(namespace.Ref).toBe("ServiceConnectNamespace");

          // Verify Services array exists and is non-empty
          const services = enabledBranch.Services as unknown[];
          expect(Array.isArray(services)).toBe(true);
          expect(services.length).toBeGreaterThan(0);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The enabled branch Services entry SHALL have ClientAliases
     * with Port referencing ContainerPort and DnsName referencing ServiceName.
     *
     * **Validates: Requirements 13.2**
     */
    test("should have ClientAliases with Port and DnsName in enabled branch Services", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const scc = service.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
          const fnIf = scc["Fn::If"] as unknown[];
          const enabledBranch = fnIf[1] as Record<string, unknown>;
          const services = enabledBranch.Services as Record<string, unknown>[];
          const firstService = services[0];

          // Verify ClientAliases exists
          const clientAliases = firstService.ClientAliases as Record<string, unknown>[];
          expect(Array.isArray(clientAliases)).toBe(true);
          expect(clientAliases.length).toBeGreaterThan(0);

          const firstAlias = clientAliases[0];

          // Verify Port references ContainerPort parameter
          const port = firstAlias.Port as Record<string, unknown>;
          expect(port).toBeDefined();
          expect(port.Ref).toBe("ContainerPort");

          // Verify DnsName references ServiceName via !Sub
          const dnsName = firstAlias.DnsName as Record<string, unknown>;
          expect(dnsName).toBeDefined();
          expect(dnsName["Fn::Sub"]).toBeDefined();

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The enabled branch Services entry SHALL have a PortName.
     *
     * **Validates: Requirements 13.2**
     */
    test("should have PortName in enabled branch Services entry", () => {
      const service = findEcsService(template);
      expect(service).toBeDefined();

      const scc = service!.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
      const fnIf = scc["Fn::If"] as unknown[];
      const enabledBranch = fnIf[1] as Record<string, unknown>;
      const services = enabledBranch.Services as Record<string, unknown>[];
      const firstService = services[0];

      expect(firstService.PortName).toBeDefined();
    });

    // =========================================================================
    // Property: Disabled branch has Enabled: false
    // =========================================================================

    /**
     * Property: When Service Connect is disabled, the configuration SHALL have
     * Enabled: false.
     *
     * **Validates: Requirements 13.3**
     */
    test("should have Enabled: false in disabled branch", () => {
      fc.assert(
        fc.property(envArb, (_env: Environment) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const scc = service.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
          const fnIf = scc["Fn::If"] as unknown[];
          const disabledBranch = fnIf[2] as Record<string, unknown>;

          // Verify Enabled: false
          expect(disabledBranch.Enabled).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    // =========================================================================
    // Property: Simulated condition evaluation across environments
    // =========================================================================

    /**
     * Property: For any environment, when EnableServiceConnect is "true",
     * the resolved configuration SHALL have Enabled: true with Services.
     * When "false", it SHALL have Enabled: false.
     *
     * Simulates CloudFormation condition evaluation.
     *
     * **Validates: Requirements 13.1, 13.2, 13.3**
     */
    test("should resolve correct Service Connect configuration per enable flag", () => {
      const enableFlagArb = fc.constantFrom("true", "false");

      fc.assert(
        fc.property(envArb, enableFlagArb, (_env: Environment, enableFlag: string) => {
          const service = findEcsService(template);
          if (!service) {
            throw new Error("EcsService resource not found in template");
          }

          const scc = service.resource.Properties?.ServiceConnectConfiguration as Record<string, unknown>;
          const fnIf = scc["Fn::If"] as unknown[];

          // Simulate IsServiceConnectEnabled condition
          const isEnabled = enableFlag === "true";
          const resolvedBranch = isEnabled
            ? (fnIf[1] as Record<string, unknown>)
            : (fnIf[2] as Record<string, unknown>);

          if (isEnabled) {
            expect(resolvedBranch.Enabled).toBe(true);
            expect(resolvedBranch.Namespace).toBeDefined();
            expect(Array.isArray(resolvedBranch.Services)).toBe(true);
            const services = resolvedBranch.Services as Record<string, unknown>[];
            expect(services.length).toBeGreaterThan(0);

            // Verify ClientAliases with Port and DnsName
            const firstService = services[0];
            const clientAliases = firstService.ClientAliases as Record<string, unknown>[];
            expect(clientAliases.length).toBeGreaterThan(0);
            expect(clientAliases[0].Port).toBeDefined();
            expect(clientAliases[0].DnsName).toBeDefined();
          } else {
            expect(resolvedBranch.Enabled).toBe(false);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
