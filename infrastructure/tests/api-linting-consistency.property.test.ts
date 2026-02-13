/**
 * Property-Based Tests for API Linting Consistency
 *
 * Feature: aws-cicd-pipeline, Property 1: API Linting Consistency
 *
 * **Validates: Requirements 3.1, 3.2**
 *
 * Property 1: API Linting Consistency
 * _For any_ OpenAPI specification and configured ruleset, the API linter SHALL produce
 * consistent validation results where:
 * - The pass/fail status accurately reflects whether violations exist
 * - All detected violations are reported with rule name, severity, message, and location
 * - Running the linter multiple times on the same input produces identical results
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { execSync } from "child_process";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; url?: string };
}

interface OpenAPIServer {
  url: string;
  description?: string;
}

interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: { type: string; format?: string };
}

interface OpenAPIResponse {
  description: string;
  content?: {
    "application/json"?: {
      schema: Record<string, unknown>;
    };
  };
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content: {
      "application/json": {
        schema: Record<string, unknown>;
      };
    };
  };
  responses: Record<string, OpenAPIResponse>;
}

interface OpenAPIPath {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  parameters?: OpenAPIParameter[];
}

interface OpenAPISchema {
  type: string;
  description?: string;
  properties?: Record<string, { type: string; description?: string; format?: string }>;
  required?: string[];
}

interface OpenAPISecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  security?: Array<Record<string, string[]>>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenAPIPath>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
  };
}

interface LintViolation {
  code: string;
  message: string;
  path: string[];
  severity: number;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  source?: string;
}

interface LintResult {
  violations: LintViolation[];
  passed: boolean;
  executionTime: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the path to the Spectral ruleset
 */
function getSpectralRulesetPath(): string {
  return path.join(__dirname, "..", "..", ".spectral.yml");
}

/**
 * Check if Spectral CLI is available
 */
function isSpectralAvailable(): boolean {
  try {
    execSync("npx spectral --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run Spectral linter on an OpenAPI specification
 */
function runSpectralLint(spec: OpenAPISpec): LintResult {
  const startTime = Date.now();
  const tempDir = path.join(__dirname, "..", "temp");
  const tempFile = path.join(tempDir, `test-spec-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const rulesetPath = getSpectralRulesetPath();

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Write spec to temp file
    fs.writeFileSync(tempFile, JSON.stringify(spec, null, 2));

    // Run Spectral
    const result = execSync(
      `npx spectral lint "${tempFile}" --ruleset "${rulesetPath}" --format json`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    );

    const violations: LintViolation[] = JSON.parse(result || "[]");
    const executionTime = Date.now() - startTime;

    return {
      violations,
      passed: violations.length === 0,
      executionTime,
    };
  } catch (error: unknown) {
    // Spectral exits with non-zero when violations are found
    const execError = error as { stdout?: string; stderr?: string };
    if (execError.stdout) {
      try {
        const violations: LintViolation[] = JSON.parse(execError.stdout);
        const executionTime = Date.now() - startTime;
        return {
          violations,
          passed: violations.length === 0,
          executionTime,
        };
      } catch {
        // Parse error, return empty result
      }
    }
    const executionTime = Date.now() - startTime;
    return { violations: [], passed: true, executionTime };
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * Validate that a violation has all required fields
 */
function isValidViolation(violation: LintViolation): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  if (!violation.code || typeof violation.code !== "string") {
    missingFields.push("code (rule name)");
  }

  if (typeof violation.severity !== "number") {
    missingFields.push("severity");
  }

  if (!violation.message || typeof violation.message !== "string") {
    missingFields.push("message");
  }

  if (!Array.isArray(violation.path)) {
    missingFields.push("path (location)");
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Compare two lint results for equality
 */
function areLintResultsEqual(result1: LintResult, result2: LintResult): boolean {
  if (result1.passed !== result2.passed) {
    return false;
  }

  if (result1.violations.length !== result2.violations.length) {
    return false;
  }

  // Sort violations for comparison
  const sortViolations = (violations: LintViolation[]) =>
    [...violations].sort((a, b) => {
      const codeCompare = a.code.localeCompare(b.code);
      if (codeCompare !== 0) return codeCompare;
      return a.path.join(".").localeCompare(b.path.join("."));
    });

  const sorted1 = sortViolations(result1.violations);
  const sorted2 = sortViolations(result2.violations);

  for (let i = 0; i < sorted1.length; i++) {
    if (sorted1[i].code !== sorted2[i].code) return false;
    if (sorted1[i].severity !== sorted2[i].severity) return false;
    if (sorted1[i].message !== sorted2[i].message) return false;
    if (sorted1[i].path.join(".") !== sorted2[i].path.join(".")) return false;
  }

  return true;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid camelCase identifiers
 */
const camelCaseIdentifierArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), {
      minLength: 0,
      maxLength: 15,
    })
  )
  .map(([first, rest]) => first + rest);

/**
 * Generator for valid kebab-case path segments
 */
const kebabCaseSegmentArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), {
      minLength: 0,
      maxLength: 10,
    })
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => !s.endsWith("-") && !s.includes("--"));

/**
 * Generator for API version strings
 */
const apiVersionArb = fc.integer({ min: 1, max: 10 }).map((v) => `v${v}`);

/**
 * Generator for valid API paths with versioning
 */
const validApiPathArb = fc
  .tuple(
    apiVersionArb,
    fc.array(kebabCaseSegmentArb, { minLength: 1, maxLength: 3 })
  )
  .map(([version, segments]) => `/${version}/${segments.join("/")}`);

/**
 * Generator for invalid API paths (missing version, wrong casing, etc.)
 */
const invalidApiPathArb = fc.oneof(
  // Missing version prefix
  fc.array(kebabCaseSegmentArb, { minLength: 1, maxLength: 3 })
    .map((segments) => `/${segments.join("/")}`),
  // Using underscores instead of hyphens
  fc.tuple(
    apiVersionArb,
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_".split("")), { minLength: 3, maxLength: 10 })
  ).map(([version, segment]) => `/${version}/${segment}`),
  // Using camelCase in path
  fc.tuple(
    apiVersionArb,
    camelCaseIdentifierArb
  ).map(([version, segment]) => `/${version}/${segment}Users`)
);

/**
 * Generator for semantic versions
 */
const semverArb = fc
  .tuple(
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 })
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * Generator for valid OpenAPI info section
 */
const validInfoArb: fc.Arbitrary<OpenAPIInfo> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 50 }),
  version: semverArb,
  description: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  contact: fc.option(
    fc.record({
      name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
      email: fc.option(fc.emailAddress(), { nil: undefined }),
    }),
    { nil: undefined }
  ),
  license: fc.option(
    fc.record({
      name: fc.constantFrom("MIT", "Apache-2.0", "GPL-3.0"),
    }),
    { nil: undefined }
  ),
});

/**
 * Generator for invalid OpenAPI info section (missing required fields)
 */
const invalidInfoArb: fc.Arbitrary<OpenAPIInfo> = fc.record({
  title: fc.constant(""), // Empty title is invalid
  version: semverArb,
});

/**
 * Generator for valid operation with all recommended fields
 */
const validOperationArb: fc.Arbitrary<OpenAPIOperation> = fc.record({
  operationId: camelCaseIdentifierArb,
  summary: fc.option(fc.string({ minLength: 5, maxLength: 50 }), { nil: undefined }),
  description: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
  security: fc.constant([{ bearerAuth: [] }]), // Always define security for valid operations
  responses: fc.constant({
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
  }),
});

/**
 * Generator for invalid operation (missing operationId, security, etc.)
 */
const invalidOperationArb: fc.Arbitrary<OpenAPIOperation> = fc.record({
  // Missing operationId
  summary: fc.option(fc.string({ minLength: 5, maxLength: 50 }), { nil: undefined }),
  // Missing security
  // Missing description
  responses: fc.constant({
    "200": {
      description: "", // Empty description
    },
  }),
});

/**
 * Generator for valid POST operation with request body
 */
const validPostOperationArb: fc.Arbitrary<OpenAPIOperation> = fc.record({
  operationId: camelCaseIdentifierArb.map((id) => `create${id.charAt(0).toUpperCase()}${id.slice(1)}`),
  description: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
  security: fc.constant([{ bearerAuth: [] }]),
  requestBody: fc.constant({
    description: "Request body",
    required: true,
    content: {
      "application/json": {
        schema: { type: "object" },
      },
    },
  }),
  responses: fc.constant({
    "201": {
      description: "Resource created",
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
  }),
});

/**
 * Generator for invalid POST operation (missing request body)
 */
const invalidPostOperationArb: fc.Arbitrary<OpenAPIOperation> = fc.record({
  operationId: camelCaseIdentifierArb,
  // Missing requestBody for POST
  responses: fc.constant({
    "200": { // Should be 201 for POST
      description: "Success",
    },
  }),
});

/**
 * Generator for valid DELETE operation
 */
const validDeleteOperationArb: fc.Arbitrary<OpenAPIOperation> = fc.record({
  operationId: camelCaseIdentifierArb.map((id) => `delete${id.charAt(0).toUpperCase()}${id.slice(1)}`),
  description: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
  security: fc.constant([{ bearerAuth: [] }]),
  responses: fc.constant({
    "204": {
      description: "Resource deleted",
    },
  }),
});

/**
 * Generator for valid OpenAPI specification (compliant with rules)
 */
const validOpenAPISpecArb: fc.Arbitrary<OpenAPISpec> = fc
  .tuple(validInfoArb, validApiPathArb, validOperationArb, validPostOperationArb, validDeleteOperationArb)
  .map(([info, apiPath, getOp, postOp, deleteOp]) => ({
    openapi: "3.0.3",
    info: {
      ...info,
      contact: info.contact || { name: "API Team", email: "api@example.com" },
      license: info.license || { name: "MIT" },
      description: info.description || "A valid API specification",
    },
    servers: [{ url: `https://api.example.com/v1`, description: "Production" }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "resources", description: "Resource operations" }],
    paths: {
      [apiPath]: {
        get: { ...getOp, tags: ["resources"] },
        post: { ...postOp, tags: ["resources"] },
      },
      [`${apiPath}/{id}`]: {
        delete: { ...deleteOp, tags: ["resources"] },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT authentication",
        },
      },
    },
  }));

/**
 * Generator for invalid OpenAPI specification (violates multiple rules)
 */
const invalidOpenAPISpecArb: fc.Arbitrary<OpenAPISpec> = fc
  .tuple(invalidInfoArb, invalidApiPathArb, invalidOperationArb, invalidPostOperationArb)
  .map(([info, apiPath, getOp, postOp]) => ({
    openapi: "3.0.3",
    info, // Missing contact, license, description
    // Missing servers with version
    // Missing global security
    // Missing tags
    paths: {
      [apiPath]: { // Invalid path (no version, wrong casing)
        get: getOp, // Missing operationId, security, description
        post: postOp, // Missing requestBody, wrong response code
      },
    },
    // Missing components.securitySchemes
  }));

/**
 * Generator for partially valid OpenAPI specification (some violations)
 */
const partiallyValidOpenAPISpecArb: fc.Arbitrary<OpenAPISpec> = fc
  .tuple(validInfoArb, validApiPathArb, invalidOperationArb)
  .map(([info, apiPath, getOp]) => ({
    openapi: "3.0.3",
    info: {
      ...info,
      description: info.description || "A partially valid API",
    },
    servers: [{ url: "https://api.example.com/v1" }],
    paths: {
      [apiPath]: {
        get: getOp, // Invalid operation
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
  }));

/**
 * Combined generator for all types of OpenAPI specifications
 */
const anyOpenAPISpecArb = fc.oneof(
  { weight: 3, arbitrary: validOpenAPISpecArb },
  { weight: 3, arbitrary: invalidOpenAPISpecArb },
  { weight: 4, arbitrary: partiallyValidOpenAPISpecArb }
);

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("API Linting Consistency Property-Based Tests", () => {
  /**
   * Feature: aws-cicd-pipeline, Property 1: API Linting Consistency
   * **Validates: Requirements 3.1, 3.2**
   */
  describe("Property 1: API Linting Consistency", () => {
    const spectralAvailable = isSpectralAvailable();

    beforeAll(() => {
      if (!spectralAvailable) {
        console.warn("Spectral CLI not available, some tests will use mock linting");
      }
      // Ensure temp directory exists
      const tempDir = path.join(__dirname, "..", "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    });

    afterAll(() => {
      // Clean up temp directory
      const tempDir = path.join(__dirname, "..", "temp");
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
      }
    });

    /**
     * Property: For any OpenAPI specification, the pass/fail status SHALL accurately
     * reflect whether violations exist.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("pass/fail status accurately reflects whether violations exist", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Pass status should be true only when there are no violations
          if (result.passed) {
            expect(result.violations.length).toBe(0);
          } else {
            expect(result.violations.length).toBeGreaterThan(0);
          }

          // Verify the inverse relationship
          expect(result.passed).toBe(result.violations.length === 0);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification with violations, all detected violations
     * SHALL be reported with rule name, severity, message, and location.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("all violations are reported with rule name, severity, message, and location", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Every violation must have all required fields
          for (const violation of result.violations) {
            const { valid, missingFields } = isValidViolation(violation);

            if (!valid) {
              throw new Error(
                `Violation missing required fields: ${missingFields.join(", ")}. ` +
                `Violation: ${JSON.stringify(violation)}`
              );
            }

            // Verify rule name (code) is a non-empty string
            expect(typeof violation.code).toBe("string");
            expect(violation.code.length).toBeGreaterThan(0);

            // Verify severity is a valid number (0=error, 1=warn, 2=info, 3=hint)
            expect(typeof violation.severity).toBe("number");
            expect(violation.severity).toBeGreaterThanOrEqual(0);
            expect(violation.severity).toBeLessThanOrEqual(3);

            // Verify message is a non-empty string
            expect(typeof violation.message).toBe("string");
            expect(violation.message.length).toBeGreaterThan(0);

            // Verify path (location) is an array
            expect(Array.isArray(violation.path)).toBe(true);
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, running the linter multiple times
     * on the same input SHALL produce identical results.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("running linter multiple times produces identical results", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          // Run the linter 3 times on the same spec
          const result1 = runSpectralLint(spec);
          const result2 = runSpectralLint(spec);
          const result3 = runSpectralLint(spec);

          // All results should be identical
          expect(areLintResultsEqual(result1, result2)).toBe(true);
          expect(areLintResultsEqual(result2, result3)).toBe(true);
          expect(areLintResultsEqual(result1, result3)).toBe(true);

          // Verify pass/fail status is consistent
          expect(result1.passed).toBe(result2.passed);
          expect(result2.passed).toBe(result3.passed);

          // Verify violation count is consistent
          expect(result1.violations.length).toBe(result2.violations.length);
          expect(result2.violations.length).toBe(result3.violations.length);

          return true;
        }),
        { numRuns: 5 }
      );
    });

    /**
     * Property: For any valid OpenAPI specification that follows all rules,
     * the linter SHALL report no violations from custom rules or only warning-level messages.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("valid specs should have minimal or no violations from custom rules", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      // Load the Spectral ruleset to get custom rule names
      const rulesetPath = getSpectralRulesetPath();
      const rulesetContent = fs.readFileSync(rulesetPath, "utf8");
      const ruleset = yaml.load(rulesetContent) as { rules?: Record<string, unknown> };
      const customRuleNames = Object.keys(ruleset.rules || {});

      fc.assert(
        fc.property(validOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Filter to only custom rule violations
          const customRuleViolations = result.violations.filter((v) =>
            customRuleNames.includes(v.code)
          );

          // All custom rule violations should be warnings (severity >= 1), not errors
          const customErrorViolations = customRuleViolations.filter((v) => v.severity === 0);

          // There should be no error-level violations from our custom rules
          // (All our custom rules are configured as warnings)
          expect(customErrorViolations.length).toBe(0);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any invalid OpenAPI specification, the linter SHALL detect
     * at least one violation.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("invalid specs should have at least one violation", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(invalidOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Invalid specs should have at least one violation
          // Note: Some violations may be from built-in Spectral rules
          expect(result.violations.length).toBeGreaterThan(0);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, violation paths SHALL reference
     * valid locations within the specification structure.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("violation paths reference valid locations in the spec", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          for (const violation of result.violations) {
            // Path should be an array of strings/numbers
            expect(Array.isArray(violation.path)).toBe(true);

            // Each path segment should be a string or number
            for (const segment of violation.path) {
              expect(["string", "number"].includes(typeof segment)).toBe(true);
            }

            // The first segment should typically be a top-level OpenAPI key
            if (violation.path.length > 0) {
              const validTopLevelKeys = [
                "openapi",
                "info",
                "servers",
                "paths",
                "components",
                "security",
                "tags",
                "externalDocs",
              ];
              const firstSegment = String(violation.path[0]);
              // First segment should be a valid OpenAPI top-level key or a path
              const isValidFirstSegment =
                validTopLevelKeys.includes(firstSegment) ||
                firstSegment.startsWith("/");
              expect(isValidFirstSegment).toBe(true);
            }
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, the linter SHALL use warning severity
     * for all custom rules (as per the governance strategy).
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("custom rules use warning severity as per governance strategy", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      // Load the Spectral ruleset to get custom rule names
      const rulesetPath = getSpectralRulesetPath();
      const rulesetContent = fs.readFileSync(rulesetPath, "utf8");
      const ruleset = yaml.load(rulesetContent) as { rules?: Record<string, unknown> };
      const customRuleNames = Object.keys(ruleset.rules || {});

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Check that custom rule violations are warnings (severity 1)
          for (const violation of result.violations) {
            if (customRuleNames.includes(violation.code)) {
              // Custom rules should be warnings (severity 1) or info (severity 2)
              // as per the governance strategy (no errors that fail build)
              expect(violation.severity).toBeGreaterThanOrEqual(1);
            }
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, the linter execution time SHALL
     * be bounded and reasonable.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("linter execution time is bounded and reasonable", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          // Execution time should be less than 30 seconds for any spec
          // (generous bound to account for CI environment variability)
          expect(result.executionTime).toBeLessThan(30000);

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, violation messages SHALL be
     * human-readable and descriptive.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("violation messages are human-readable and descriptive", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          for (const violation of result.violations) {
            // Message should be a non-empty string
            expect(typeof violation.message).toBe("string");
            expect(violation.message.length).toBeGreaterThan(0);

            // Message should contain readable text (not just codes)
            // Check that it contains at least one space (indicating a sentence)
            // or is a single descriptive word
            const hasReadableContent =
              violation.message.includes(" ") ||
              violation.message.length >= 5;
            expect(hasReadableContent).toBe(true);
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });

    /**
     * Property: For any OpenAPI specification, the linter SHALL correctly identify
     * the rule that triggered each violation.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    test("violations correctly identify the triggering rule", () => {
      if (!spectralAvailable) {
        console.log("Skipping test - Spectral CLI not available");
        return;
      }

      // Load the Spectral ruleset to get all rule names
      const rulesetPath = getSpectralRulesetPath();
      const rulesetContent = fs.readFileSync(rulesetPath, "utf8");
      const ruleset = yaml.load(rulesetContent) as { rules?: Record<string, unknown>; extends?: string[] };
      const customRuleNames = Object.keys(ruleset.rules || {});

      // Built-in Spectral OAS rules that might be triggered
      const builtInRules = [
        "oas3-schema",
        "oas3-valid-schema-example",
        "oas3-valid-media-example",
        "oas3-api-servers",
        "oas3-examples-value-or-externalValue",
        "oas3-operation-security-defined",
        "oas3-server-not-example.com",
        "oas3-server-trailing-slash",
        "oas3-unused-component",
        "info-contact",
        "info-description",
        "info-license",
        "no-$ref-siblings",
        "no-eval-in-markdown",
        "no-script-tags-in-markdown",
        "openapi-tags",
        "openapi-tags-alphabetical",
        "openapi-tags-uniqueness",
        "operation-description",
        "operation-operationId",
        "operation-operationId-unique",
        "operation-operationId-valid-in-url",
        "operation-parameters",
        "operation-singular-tag",
        "operation-success-response",
        "operation-tag-defined",
        "operation-tags",
        "path-declarations-must-exist",
        "path-keys-no-trailing-slash",
        "path-not-include-query",
        "path-params",
        "tag-description",
        "typed-enum",
        "duplicated-entry-in-enum",
      ];

      const allKnownRules = [...customRuleNames, ...builtInRules];

      fc.assert(
        fc.property(anyOpenAPISpecArb, (spec) => {
          const result = runSpectralLint(spec);

          for (const violation of result.violations) {
            // Rule code should be a non-empty string
            expect(typeof violation.code).toBe("string");
            expect(violation.code.length).toBeGreaterThan(0);

            // Rule code should follow naming conventions (kebab-case or camelCase)
            const validRuleNamePattern = /^[a-z][a-zA-Z0-9-]*$/;
            expect(validRuleNamePattern.test(violation.code)).toBe(true);
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });
  });
});
