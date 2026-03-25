/**
 * Unit Tests for Trivy Security Scan Buildspec and CodeBuild Configuration
 *
 * Feature: infrastructure-optimization
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 *
 * - 9.1: Execute Trivy container image scanning against the built Docker image
 * - 9.2: Fail the build when HIGH or CRITICAL severity vulnerabilities are found
 * - 9.3: Output a scan report as a CodeBuild artifact in JSON format
 * - 9.4: Install Trivy during the install phase if not available
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface CloudFormationResource {
  Type: string;
  Condition?: string;
  Properties?: Record<string, unknown>;
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Resources?: Record<string, CloudFormationResource>;
}

interface BuildSpecPhase {
  commands?: string[];
}

interface BuildSpec {
  version?: number | string;
  phases?: {
    install?: BuildSpecPhase;
    pre_build?: BuildSpecPhase;
    build?: BuildSpecPhase;
    post_build?: BuildSpecPhase;
  };
  artifacts?: {
    files?: string[];
    name?: string;
    "discard-paths"?: string | boolean;
  };
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
// HELPERS
// =============================================================================

function loadBuildSpec(): BuildSpec {
  const fullPath = path.join(__dirname, "..", "..", "buildspecs", "buildspec-security-scan.yml");
  const content = fs.readFileSync(fullPath, "utf8");
  return yaml.load(content) as BuildSpec;
}

function loadCodeBuildTemplate(): CloudFormationTemplate {
  const fullPath = path.join(__dirname, "..", "codebuild.yaml");
  const content = fs.readFileSync(fullPath, "utf8");
  return yaml.load(content, { schema: CFN_SCHEMA }) as CloudFormationTemplate;
}

/**
 * Flatten all commands in a phase into a single string for easier searching.
 * Multi-line YAML strings (using |) are preserved as-is.
 */
function flattenCommands(phase?: BuildSpecPhase): string {
  if (!phase?.commands) return "";
  return phase.commands.join("\n");
}

// =============================================================================
// TESTS
// =============================================================================

describe("Trivy Security Scan Buildspec", () => {
  let buildspec: BuildSpec;

  beforeAll(() => {
    buildspec = loadBuildSpec();
  });

  /**
   * **Validates: Requirement 9.4**
   * IF Trivy is not available in the build environment, THEN the SecurityScanProject
   * SHALL install it during the install phase.
   */
  describe("Install Phase — Trivy Installation (Req 9.4)", () => {
    test("install phase exists with commands", () => {
      expect(buildspec.phases?.install).toBeDefined();
      expect(buildspec.phases!.install!.commands).toBeDefined();
      expect(buildspec.phases!.install!.commands!.length).toBeGreaterThan(0);
    });

    test("install phase downloads and installs trivy", () => {
      const installCmds = flattenCommands(buildspec.phases?.install);
      // Should download trivy (from GitHub releases)
      expect(installCmds).toMatch(/trivy/i);
      // Should make trivy executable or move it to a bin path
      expect(installCmds).toMatch(/\/usr\/local\/bin\/trivy|chmod \+x/);
    });

    test("install phase verifies trivy version", () => {
      const installCmds = flattenCommands(buildspec.phases?.install);
      expect(installCmds).toContain("trivy --version");
    });
  });

  /**
   * **Validates: Requirement 9.1**
   * The SecurityScanProject SHALL execute Trivy container image scanning
   * against the built Docker image.
   */
  describe("Build Phase — Trivy Image Scan (Req 9.1)", () => {
    test("build phase exists with commands", () => {
      expect(buildspec.phases?.build).toBeDefined();
      expect(buildspec.phases!.build!.commands).toBeDefined();
      expect(buildspec.phases!.build!.commands!.length).toBeGreaterThan(0);
    });

    test("build phase contains 'trivy image' command", () => {
      const buildCmds = flattenCommands(buildspec.phases?.build);
      expect(buildCmds).toContain("trivy image");
    });
  });

  /**
   * **Validates: Requirement 9.2**
   * WHEN Trivy finds HIGH or CRITICAL severity vulnerabilities,
   * the SecurityScanProject SHALL fail the build.
   */
  describe("Build Phase — Severity and Exit Code (Req 9.2)", () => {
    test("trivy scan uses --severity HIGH,CRITICAL", () => {
      const buildCmds = flattenCommands(buildspec.phases?.build);
      expect(buildCmds).toMatch(/--severity\s+HIGH,CRITICAL/);
    });

    test("trivy scan uses --exit-code 1 to fail on findings", () => {
      const buildCmds = flattenCommands(buildspec.phases?.build);
      expect(buildCmds).toMatch(/--exit-code\s+1/);
    });
  });

  /**
   * **Validates: Requirement 9.3**
   * The SecurityScanProject SHALL output a scan report as a CodeBuild artifact
   * in JSON format.
   */
  describe("Artifact Output — JSON Report (Req 9.3)", () => {
    test("trivy scan outputs JSON format", () => {
      const buildCmds = flattenCommands(buildspec.phases?.build);
      expect(buildCmds).toMatch(/--format\s+json/);
    });

    test("artifacts section includes trivy-report.json", () => {
      expect(buildspec.artifacts).toBeDefined();
      expect(buildspec.artifacts!.files).toBeDefined();
      expect(buildspec.artifacts!.files).toContain("trivy-report.json");
    });
  });
});

describe("CodeBuild SecurityScanProject references buildspec", () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    template = loadCodeBuildTemplate();
  });

  test("SecurityScanProject resource exists", () => {
    const resources = template.Resources || {};
    expect(resources.SecurityScanProject).toBeDefined();
    expect(resources.SecurityScanProject.Type).toBe("AWS::CodeBuild::Project");
  });

  test("SecurityScanProject references buildspecs/buildspec-security-scan.yml", () => {
    const project = template.Resources!.SecurityScanProject;
    const source = project.Properties?.Source as Record<string, unknown> | undefined;
    expect(source).toBeDefined();
    expect(source!.BuildSpec).toBe("buildspecs/buildspec-security-scan.yml");
  });

  test("SecurityScanProject has PrivilegedMode enabled for Docker access", () => {
    const project = template.Resources!.SecurityScanProject;
    const env = project.Properties?.Environment as Record<string, unknown> | undefined;
    expect(env).toBeDefined();
    expect(env!.PrivilegedMode).toBe(true);
  });
});


// =============================================================================
// PROPERTY-BASED TESTS — CodeBuild Concurrent Build Limit
// =============================================================================

import * as fc from "fast-check";

/**
 * Property 10: Environment-Aware CodeBuild Concurrent Build Limit
 *
 * Feature: infrastructure-optimization, Property 10: Environment-Aware CodeBuild Concurrent Build Limit
 *
 * *For any* CodeBuild project resource in `codebuild.yaml` and any environment value,
 * WHEN environment is `dev`, the project SHALL have `ConcurrentBuildLimit: 1`.
 * WHEN environment is `staging` or `prod`, the project SHALL NOT have `ConcurrentBuildLimit`
 * set (or set to unlimited).
 *
 * **Validates: Requirements 15.1, 15.2**
 */
describe("Property 10: Environment-Aware CodeBuild Concurrent Build Limit", () => {
  let template: CloudFormationTemplate;

  const EXPECTED_CODEBUILD_PROJECTS = [
    "SourceProject",
    "SwaggerGenProject",
    "LintProject",
    "SecurityScanProject",
    "BuildProject",
    "ContractTestProject",
  ];

  beforeAll(() => {
    template = loadCodeBuildTemplate();
  });

  test("all 6 CodeBuild projects exist in the template", () => {
    const resources = template.Resources || {};
    for (const projectName of EXPECTED_CODEBUILD_PROJECTS) {
      expect(resources[projectName]).toBeDefined();
      expect(resources[projectName].Type).toBe("AWS::CodeBuild::Project");
    }
  });

  test("IsDevelopment condition is defined", () => {
    const raw = fs.readFileSync(
      path.join(__dirname, "..", "codebuild.yaml"),
      "utf8"
    );
    const fullTemplate = yaml.load(raw, { schema: CFN_SCHEMA }) as Record<string, unknown>;
    const conditions = fullTemplate.Conditions as Record<string, unknown> | undefined;
    expect(conditions).toBeDefined();
    expect(conditions!.IsDevelopment).toBeDefined();
  });

  test("every CodeBuild project uses !If [IsDevelopment, 1, !Ref AWS::NoValue] for ConcurrentBuildLimit", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXPECTED_CODEBUILD_PROJECTS),
        (projectName: string) => {
          const resources = template.Resources || {};
          const project = resources[projectName];
          expect(project).toBeDefined();

          const props = project.Properties as Record<string, unknown>;
          expect(props).toBeDefined();

          const concurrentBuildLimit = props.ConcurrentBuildLimit as Record<string, unknown>;
          expect(concurrentBuildLimit).toBeDefined();

          // Verify it uses Fn::If (which is how !If is parsed)
          expect(concurrentBuildLimit["Fn::If"]).toBeDefined();

          const ifArray = concurrentBuildLimit["Fn::If"] as unknown[];
          expect(ifArray).toHaveLength(3);

          // First element: condition name "IsDevelopment"
          expect(ifArray[0]).toBe("IsDevelopment");

          // Second element: value when dev → 1
          expect(ifArray[1]).toBe(1);

          // Third element: value when not dev → { Ref: "AWS::NoValue" }
          const noValueRef = ifArray[2] as Record<string, unknown>;
          expect(noValueRef).toEqual({ Ref: "AWS::NoValue" });
        }
      ),
      { numRuns: 100 }
    );
  });

  test.each(["dev", "staging", "prod"])(
    "for environment=%s, ConcurrentBuildLimit is correctly configured on all projects",
    (env: string) => {
      fc.assert(
        fc.property(
          fc.constantFrom(...EXPECTED_CODEBUILD_PROJECTS),
          (projectName: string) => {
            const resources = template.Resources || {};
            const project = resources[projectName];
            const props = project.Properties as Record<string, unknown>;
            const concurrentBuildLimit = props.ConcurrentBuildLimit as Record<string, unknown>;
            const ifArray = concurrentBuildLimit["Fn::If"] as unknown[];

            if (env === "dev") {
              // Dev: ConcurrentBuildLimit resolves to 1
              expect(ifArray[0]).toBe("IsDevelopment");
              expect(ifArray[1]).toBe(1);
            } else {
              // Staging/Prod: ConcurrentBuildLimit resolves to AWS::NoValue (absent)
              expect(ifArray[0]).toBe("IsDevelopment");
              expect(ifArray[2]).toEqual({ Ref: "AWS::NoValue" });
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
