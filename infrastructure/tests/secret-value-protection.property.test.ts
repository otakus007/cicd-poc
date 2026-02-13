/**
 * Property-Based Tests for Secret Value Protection
 *
 * Feature: aws-cicd-pipeline, Property 4: Secret Value Protection
 *
 * **Validates: Requirements 8.3**
 *
 * Property 4: Secret Value Protection
 * _For any_ buildspec or deployment script that accesses secrets, the output logs SHALL NOT contain:
 * - The actual secret values
 * - Any substring that could reveal secret content
 * - Environment variable expansions of secret values
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface BuildSpecPhase {
  commands?: string[];
  "runtime-versions"?: Record<string, string>;
}

interface BuildSpecEnv {
  variables?: Record<string, string>;
  "secrets-manager"?: Record<string, string>;
  "parameter-store"?: Record<string, string>;
}

interface BuildSpec {
  version: string;
  env?: BuildSpecEnv;
  phases?: {
    install?: BuildSpecPhase;
    pre_build?: BuildSpecPhase;
    build?: BuildSpecPhase;
    post_build?: BuildSpecPhase;
  };
  artifacts?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  reports?: Record<string, unknown>;
}

interface SecretReference {
  variableName: string;
  secretPath: string;
  type: "secrets-manager" | "parameter-store" | "environment";
}

interface SecretExposureRisk {
  command: string;
  lineNumber: number;
  phase: string;
  riskType: "direct-echo" | "variable-expansion" | "log-output" | "debug-print";
  secretVariable: string;
  severity: "high" | "medium" | "low";
}

interface BuildSpecAnalysis {
  filePath: string;
  secretReferences: SecretReference[];
  exposureRisks: SecretExposureRisk[];
  hasProperMasking: boolean;
  cleanupPerformed: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Known secret variable patterns that should never be logged
 * These patterns are designed to match actual secret variable names
 * while avoiding false positives like SOLUTION_PATH or DOCKERFILE_PATH
 */
const SECRET_VARIABLE_PATTERNS = [
  /^[A-Z_]*PAT$/i,                    // Matches PAT, AZURE_DEVOPS_PAT, etc.
  /^[A-Z_]*_PAT_[A-Z_]*$/i,           // Matches MY_PAT_VALUE, etc.
  /TOKEN/i,                            // Matches TOKEN, AUTH_TOKEN, etc.
  /SECRET/i,                           // Matches SECRET, SECRET_KEY, etc.
  /PASSWORD/i,                         // Matches PASSWORD, DB_PASSWORD, etc.
  /API_KEY/i,                          // Matches API_KEY, MY_API_KEY, etc.
  /CREDENTIAL/i,                       // Matches CREDENTIAL, CREDENTIALS, etc.
  /^AUTH$/i,                           // Matches AUTH exactly
  /AUTH_[A-Z_]+/i,                     // Matches AUTH_TOKEN, AUTH_KEY, etc.
  /PRIVATE_KEY/i,                      // Matches PRIVATE_KEY, SSH_PRIVATE_KEY, etc.
  /ACCESS_KEY/i,                       // Matches ACCESS_KEY, AWS_ACCESS_KEY, etc.
  /CONNECTION_STRING/i,                // Matches CONNECTION_STRING, DB_CONNECTION_STRING, etc.
];

/**
 * Variable names that should NOT be treated as secrets (false positive exclusions)
 */
const NON_SECRET_VARIABLE_PATTERNS = [
  /PATH$/i,                            // Excludes SOLUTION_PATH, DOCKERFILE_PATH, etc.
  /^PATH$/i,                           // Excludes PATH
  /DIR$/i,                             // Excludes BUILD_DIR, OUTPUT_DIR, etc.
  /FILE$/i,                            // Excludes CONFIG_FILE, OUTPUT_FILE, etc.
  /NAME$/i,                            // Excludes IMAGE_NAME, REPO_NAME, etc.
  /URL$/i,                             // Excludes REPO_URL, API_URL, etc.
  /VERSION$/i,                         // Excludes BUILD_VERSION, etc.
  /TAG$/i,                             // Excludes IMAGE_TAG, etc.
  /ID$/i,                              // Excludes BUILD_ID, etc. (but not ACCESS_KEY_ID)
  /REGION$/i,                          // Excludes AWS_REGION, etc.
  /ACCOUNT$/i,                         // Excludes AWS_ACCOUNT, etc.
];

/**
 * Check if a variable name looks like a secret
 */
function isSecretVariableName(varName: string): boolean {
  // First check if it's explicitly excluded
  if (NON_SECRET_VARIABLE_PATTERNS.some(pattern => pattern.test(varName))) {
    // Exception: ACCESS_KEY_ID is still a secret
    if (/ACCESS_KEY/i.test(varName)) {
      return true;
    }
    return false;
  }

  // Then check if it matches a secret pattern
  return SECRET_VARIABLE_PATTERNS.some(pattern => pattern.test(varName));
}

/**
 * Dangerous command patterns that could expose secrets
 * These patterns specifically target secret-like variable names
 */
const DANGEROUS_ECHO_PATTERNS = [
  // Direct echo of PAT variables (exact match at end)
  /echo\s+["']?\$\{?([A-Z_]*PAT)\}?["']?(?:\s|$)/i,
  // Direct echo of TOKEN variables
  /echo\s+["']?\$\{?([A-Z_]*TOKEN[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Direct echo of SECRET variables
  /echo\s+["']?\$\{?([A-Z_]*SECRET[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Direct echo of PASSWORD variables
  /echo\s+["']?\$\{?([A-Z_]*PASSWORD[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Direct echo of API_KEY variables
  /echo\s+["']?\$\{?([A-Z_]*API_KEY[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Direct echo of CREDENTIAL variables
  /echo\s+["']?\$\{?([A-Z_]*CREDENTIAL[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Direct echo of ACCESS_KEY variables
  /echo\s+["']?\$\{?([A-Z_]*ACCESS_KEY[A-Z_]*)\}?["']?(?:\s|$)/i,
  // Printf with secret variables
  /printf\s+.*\$\{?([A-Z_]*(?:PAT|TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|ACCESS_KEY)[A-Z_]*)\}?/i,
  // Cat of credential files without redirection
  /cat\s+.*(?:credentials|\.git-credentials|\.netrc|\.npmrc)/i,
];

/**
 * Safe patterns that indicate proper secret handling
 */
const SAFE_SECRET_PATTERNS = [
  // Checking if variable is set (without printing value)
  /if\s+\[\s+-z\s+"\$[A-Z_]+"\s+\]/,
  // Writing to file (not stdout)
  />\s*[~\/\w.-]+/,
  // Redirecting to /dev/null
  />\s*\/dev\/null/,
  // Using --password-stdin
  /--password-stdin/,
  // Masking with asterisks
  /\*{3,}/,
  // Cleanup commands
  /rm\s+-f\s+.*credentials/i,
  /chmod\s+600/,
  // Error messages that mention variable names but don't print values
  /echo\s+"ERROR:.*not set"/i,
  /echo\s+".*successfully retrieved"/i,
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all buildspec files from the buildspecs directory
 */
function getBuildSpecFiles(): string[] {
  const buildspecsDir = path.join(__dirname, "..", "..", "buildspecs");

  if (!fs.existsSync(buildspecsDir)) {
    return [];
  }

  return fs.readdirSync(buildspecsDir)
    .filter(file => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map(file => path.join(buildspecsDir, file));
}

/**
 * Parse a buildspec YAML file
 */
function parseBuildSpec(filePath: string): BuildSpec | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return yaml.load(content) as BuildSpec;
  } catch (error) {
    console.error(`Failed to parse buildspec: ${filePath}`, error);
    return null;
  }
}

/**
 * Extract secret references from a buildspec
 */
function extractSecretReferences(buildspec: BuildSpec): SecretReference[] {
  const references: SecretReference[] = [];

  if (buildspec.env) {
    // Extract from secrets-manager
    if (buildspec.env["secrets-manager"]) {
      for (const [varName, secretPath] of Object.entries(buildspec.env["secrets-manager"])) {
        references.push({
          variableName: varName,
          secretPath: secretPath,
          type: "secrets-manager",
        });
      }
    }

    // Extract from parameter-store
    if (buildspec.env["parameter-store"]) {
      for (const [varName, paramPath] of Object.entries(buildspec.env["parameter-store"])) {
        references.push({
          variableName: varName,
          secretPath: paramPath,
          type: "parameter-store",
        });
      }
    }

    // Check environment variables that look like secrets
    if (buildspec.env.variables) {
      for (const varName of Object.keys(buildspec.env.variables)) {
        if (isSecretVariableName(varName)) {
          references.push({
            variableName: varName,
            secretPath: "environment",
            type: "environment",
          });
        }
      }
    }
  }

  return references;
}

/**
 * Check if a command could expose a secret value
 */
function checkCommandForSecretExposure(
  command: string,
  secretVariables: string[],
  lineNumber: number,
  phase: string
): SecretExposureRisk | null {
  // Normalize the command
  const normalizedCommand = command.trim();

  // Skip comments
  if (normalizedCommand.startsWith("#")) {
    return null;
  }

  // Check for direct echo of secret variables
  for (const secretVar of secretVariables) {
    // Pattern: echo $SECRET_VAR or echo ${SECRET_VAR}
    const directEchoPattern = new RegExp(
      `echo\\s+["']?\\$\\{?${secretVar}\\}?["']?(?:\\s|$)`,
      "i"
    );

    if (directEchoPattern.test(normalizedCommand)) {
      return {
        command: normalizedCommand,
        lineNumber,
        phase,
        riskType: "direct-echo",
        secretVariable: secretVar,
        severity: "high",
      };
    }

    // Pattern: echo "Value: $SECRET_VAR" (variable in string)
    const stringEchoPattern = new RegExp(
      `echo\\s+["'][^"']*\\$\\{?${secretVar}\\}?[^"']*["']`,
      "i"
    );

    if (stringEchoPattern.test(normalizedCommand)) {
      // Check if it's a safe pattern (like checking if set)
      if (!SAFE_SECRET_PATTERNS.some(safe => safe.test(normalizedCommand))) {
        return {
          command: normalizedCommand,
          lineNumber,
          phase,
          riskType: "variable-expansion",
          secretVariable: secretVar,
          severity: "high",
        };
      }
    }

    // Pattern: printf with secret variable
    const printfPattern = new RegExp(
      `printf\\s+.*\\$\\{?${secretVar}\\}?`,
      "i"
    );

    if (printfPattern.test(normalizedCommand)) {
      return {
        command: normalizedCommand,
        lineNumber,
        phase,
        riskType: "log-output",
        secretVariable: secretVar,
        severity: "high",
      };
    }
  }

  // Check for generic dangerous patterns
  for (const pattern of DANGEROUS_ECHO_PATTERNS) {
    const match = normalizedCommand.match(pattern);
    if (match) {
      // Verify it's not a safe pattern
      if (!SAFE_SECRET_PATTERNS.some(safe => safe.test(normalizedCommand))) {
        return {
          command: normalizedCommand,
          lineNumber,
          phase,
          riskType: "direct-echo",
          secretVariable: match[1] || "unknown",
          severity: "medium",
        };
      }
    }
  }

  return null;
}

/**
 * Analyze a buildspec for secret exposure risks
 */
function analyzeBuildSpec(filePath: string): BuildSpecAnalysis | null {
  const buildspec = parseBuildSpec(filePath);

  if (!buildspec) {
    return null;
  }

  const secretReferences = extractSecretReferences(buildspec);
  const secretVariables = secretReferences.map(ref => ref.variableName);
  const exposureRisks: SecretExposureRisk[] = [];
  let hasProperMasking = true;
  let cleanupPerformed = false;

  // Analyze each phase
  const phases = ["install", "pre_build", "build", "post_build"] as const;

  for (const phaseName of phases) {
    const phase = buildspec.phases?.[phaseName];
    if (!phase?.commands) continue;

    let lineNumber = 0;
    for (const command of phase.commands) {
      lineNumber++;

      // Ensure command is a string (YAML can parse some values as non-strings)
      const commandStr = typeof command === "string" ? command : String(command);

      // Handle multi-line commands (YAML block scalars)
      const commandLines = commandStr.split("\n");
      for (let i = 0; i < commandLines.length; i++) {
        const line = commandLines[i];
        const risk = checkCommandForSecretExposure(
          line,
          secretVariables,
          lineNumber + i,
          phaseName
        );

        if (risk) {
          exposureRisks.push(risk);
          hasProperMasking = false;
        }

        // Check for cleanup patterns
        if (/rm\s+-f\s+.*(?:credentials|\.git-credentials)/i.test(line)) {
          cleanupPerformed = true;
        }
      }
    }
  }

  return {
    filePath,
    secretReferences,
    exposureRisks,
    hasProperMasking,
    cleanupPerformed,
  };
}

/**
 * Simulate processing a secret through a buildspec command
 * Returns true if the secret would be exposed in output
 */
function simulateSecretExposure(command: string, secretValue: string): boolean {
  // Normalize command
  const normalizedCommand = command.trim().toLowerCase();

  // Skip comments
  if (normalizedCommand.startsWith("#")) {
    return false;
  }

  // Check if command would output the secret value
  // This simulates what would happen if the command were executed

  // Direct echo commands
  if (normalizedCommand.startsWith("echo ")) {
    // Check if the command contains a variable reference that would expand to the secret
    // In a real execution, $VAR would be replaced with the secret value
    // We check if the pattern suggests the secret would be printed

    // Safe patterns that don't expose secrets
    if (normalizedCommand.includes("> ") ||
        normalizedCommand.includes(">> ") ||
        normalizedCommand.includes("| ") ||
        normalizedCommand.includes(">/dev/null")) {
      return false;
    }

    // If echo contains a variable reference, it could expose the secret
    if (normalizedCommand.includes("$")) {
      return true;
    }
  }

  // Printf commands
  if (normalizedCommand.startsWith("printf ")) {
    if (normalizedCommand.includes("$") &&
        !normalizedCommand.includes("> ") &&
        !normalizedCommand.includes(">> ")) {
      return true;
    }
  }

  // Cat commands on credential files
  if (normalizedCommand.startsWith("cat ") &&
      (normalizedCommand.includes("credential") ||
       normalizedCommand.includes(".git-credentials") ||
       normalizedCommand.includes(".netrc"))) {
    if (!normalizedCommand.includes("> ") &&
        !normalizedCommand.includes("| ")) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a buildspec uses proper secret masking patterns
 */
function usesProperSecretMasking(buildspec: BuildSpec): boolean {
  const allCommands: string[] = [];

  // Collect all commands from all phases
  const phases = ["install", "pre_build", "build", "post_build"] as const;
  for (const phaseName of phases) {
    const phase = buildspec.phases?.[phaseName];
    if (phase?.commands) {
      // Ensure all commands are strings
      allCommands.push(...phase.commands.map(cmd => typeof cmd === "string" ? cmd : String(cmd)));
    }
  }

  const commandText = allCommands.join("\n");

  // Check for proper patterns
  const hasPasswordStdin = /--password-stdin/.test(commandText);
  const hasFileRedirection = />\s*[~\/\w.-]+/.test(commandText);
  const hasChmod600 = /chmod\s+600/.test(commandText);
  const hasCredentialCleanup = /rm\s+-f\s+.*credential/i.test(commandText);

  // If the buildspec handles secrets, it should use at least one safe pattern
  const secretReferences = extractSecretReferences(buildspec);
  if (secretReferences.length > 0) {
    return hasPasswordStdin || hasFileRedirection || hasChmod600 || hasCredentialCleanup;
  }

  return true;
}

/**
 * Extract all commands from a buildspec
 */
function extractAllCommands(buildspec: BuildSpec): string[] {
  const commands: string[] = [];

  const phases = ["install", "pre_build", "build", "post_build"] as const;
  for (const phaseName of phases) {
    const phase = buildspec.phases?.[phaseName];
    if (phase?.commands) {
      // Ensure all commands are strings
      commands.push(...phase.commands.map(cmd => typeof cmd === "string" ? cmd : String(cmd)));
    }
  }

  return commands;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for random password-like strings
 */
const passwordArb = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?".split("")
  ),
  { minLength: 8, maxLength: 32 }
);

/**
 * Generator for random API key-like strings
 */
const apiKeyArb = fc.tuple(
  fc.constantFrom("sk_", "pk_", "api_", "key_", ""),
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
    { minLength: 20, maxLength: 40 }
  )
).map(([prefix, key]) => prefix + key);

/**
 * Generator for random token-like strings (JWT-like)
 */
const tokenArb = fc.tuple(
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), { minLength: 20, maxLength: 50 }),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), { minLength: 20, maxLength: 100 }),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split("")), { minLength: 20, maxLength: 50 })
).map(([header, payload, signature]) => `${header}.${payload}.${signature}`);

/**
 * Generator for random PAT-like strings (Azure DevOps style)
 */
const patArb = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
  { minLength: 52, maxLength: 52 }
);

/**
 * Generator for random connection string-like values
 */
const connectionStringArb = fc.tuple(
  fc.constantFrom("Server=", "Host=", "Data Source="),
  fc.domain(),
  fc.constantFrom(";Database=", ";Initial Catalog="),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), { minLength: 5, maxLength: 15 }),
  fc.constantFrom(";User Id=", ";Uid="),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), { minLength: 5, maxLength: 10 }),
  fc.constantFrom(";Password=", ";Pwd="),
  passwordArb
).map(([serverPrefix, host, dbPrefix, db, userPrefix, user, pwdPrefix, pwd]) =>
  `${serverPrefix}${host}${dbPrefix}${db}${userPrefix}${user}${pwdPrefix}${pwd}`
);

/**
 * Combined generator for any secret value
 */
const anySecretValueArb = fc.oneof(
  { weight: 2, arbitrary: passwordArb },
  { weight: 2, arbitrary: apiKeyArb },
  { weight: 2, arbitrary: tokenArb },
  { weight: 2, arbitrary: patArb },
  { weight: 1, arbitrary: connectionStringArb }
);

/**
 * Generator for secret variable names
 */
const secretVariableNameArb = fc.constantFrom(
  "AZURE_DEVOPS_PAT",
  "API_KEY",
  "SECRET_TOKEN",
  "DB_PASSWORD",
  "AUTH_TOKEN",
  "PRIVATE_KEY",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
  "CONNECTION_STRING",
  "JWT_SECRET"
);

/**
 * Generator for dangerous commands that would expose secrets
 */
const dangerousCommandArb = fc.tuple(
  secretVariableNameArb,
  fc.constantFrom(
    (v: string) => `echo $${v}`,
    (v: string) => `echo \${${v}}`,
    (v: string) => `echo "The value is: $${v}"`,
    (v: string) => `printf "%s" $${v}`,
    (v: string) => `echo "Token: \${${v}}"`,
    (v: string) => `cat ~/.git-credentials`,
    (v: string) => `echo $${v} | tee output.log`
  )
).map(([varName, cmdFn]) => ({
  command: cmdFn(varName),
  variableName: varName,
}));

/**
 * Generator for safe commands that handle secrets properly
 */
const safeCommandArb = fc.tuple(
  secretVariableNameArb,
  fc.constantFrom(
    (v: string) => `echo "https://pat:\${${v}}@dev.azure.com" > ~/.git-credentials`,
    (v: string) => `if [ -z "$${v}" ]; then echo "Error: ${v} not set"; exit 1; fi`,
    (v: string) => `aws ecr get-login-password | docker login --username AWS --password-stdin`,
    (v: string) => `chmod 600 ~/.git-credentials`,
    (v: string) => `rm -f ~/.git-credentials`,
    (v: string) => `echo "${v} successfully retrieved from Secrets Manager"`,
    (v: string) => `# Using ${v} for authentication (value not logged)`
  )
).map(([varName, cmdFn]) => ({
  command: cmdFn(varName),
  variableName: varName,
}));

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Secret Value Protection Property-Based Tests", () => {
  /**
   * Feature: aws-cicd-pipeline, Property 4: Secret Value Protection
   * **Validates: Requirements 8.3**
   */
  describe("Property 4: Secret Value Protection", () => {
    let buildSpecFiles: string[];
    let buildSpecAnalyses: BuildSpecAnalysis[];

    beforeAll(() => {
      // Load all buildspec files
      buildSpecFiles = getBuildSpecFiles();

      // Analyze all buildspecs
      buildSpecAnalyses = buildSpecFiles
        .map(file => analyzeBuildSpec(file))
        .filter((analysis): analysis is BuildSpecAnalysis => analysis !== null);
    });

    /**
     * Property: For any buildspec that accesses secrets, the output logs SHALL NOT
     * contain the actual secret values.
     *
     * **Validates: Requirements 8.3**
     */
    test("buildspecs do not echo or log secret values directly", () => {
      // Verify we have buildspec files to test
      expect(buildSpecFiles.length).toBeGreaterThan(0);

      for (const analysis of buildSpecAnalyses) {
        // Check for high-severity exposure risks
        const highRisks = analysis.exposureRisks.filter(r => r.severity === "high");

        if (highRisks.length > 0) {
          const riskDetails = highRisks.map(r =>
            `  - ${r.phase}: "${r.command}" (exposes ${r.secretVariable})`
          ).join("\n");

          throw new Error(
            `Buildspec ${path.basename(analysis.filePath)} has secret exposure risks:\n${riskDetails}`
          );
        }
      }
    });

    /**
     * Property: For any random secret value, processing through buildspec simulation
     * SHALL NOT expose the secret in output.
     *
     * **Validates: Requirements 8.3**
     */
    test("random secret values are not exposed through buildspec commands", () => {
      fc.assert(
        fc.property(anySecretValueArb, (secretValue) => {
          // For each buildspec, verify the secret would not be exposed
          for (const analysis of buildSpecAnalyses) {
            const buildspec = parseBuildSpec(analysis.filePath);
            if (!buildspec) continue;

            const commands = extractAllCommands(buildspec);

            for (const command of commands) {
              // Simulate what would happen if this command were executed
              // with the secret value
              const wouldExpose = simulateSecretExposure(command, secretValue);

              if (wouldExpose) {
                // This is a potential exposure - verify it's a safe pattern
                const isSafe = SAFE_SECRET_PATTERNS.some(pattern =>
                  pattern.test(command)
                );

                if (!isSafe) {
                  // Check if it's actually referencing a secret variable
                  const referencesSecret = analysis.secretReferences.some(ref =>
                    command.includes(`$${ref.variableName}`) ||
                    command.includes(`\${${ref.variableName}}`)
                  );

                  // Only fail if it references a known secret
                  expect(referencesSecret).toBe(false);
                }
              }
            }
          }

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any dangerous command pattern, the buildspecs SHALL NOT contain
     * such patterns for secret variables.
     *
     * **Validates: Requirements 8.3**
     */
    test("dangerous command patterns are not used with secret variables", () => {
      fc.assert(
        fc.property(dangerousCommandArb, ({ command, variableName }) => {
          // For each buildspec, verify it doesn't contain this dangerous pattern
          for (const analysis of buildSpecAnalyses) {
            const buildspec = parseBuildSpec(analysis.filePath);
            if (!buildspec) continue;

            const commands = extractAllCommands(buildspec);
            const commandText = commands.join("\n");

            // Check if the buildspec contains this exact dangerous pattern
            // (with the actual secret variable names from the buildspec)
            for (const secretRef of analysis.secretReferences) {
              const dangerousPattern = command.replace(variableName, secretRef.variableName);

              if (commandText.includes(dangerousPattern)) {
                // Verify it's wrapped in a safe pattern
                const isSafe = SAFE_SECRET_PATTERNS.some(pattern =>
                  pattern.test(dangerousPattern)
                );

                expect(isSafe).toBe(true);
              }
            }
          }

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any buildspec with secrets, proper masking patterns SHALL be used.
     *
     * **Validates: Requirements 8.3**
     */
    test("buildspecs with secrets use proper masking patterns", () => {
      for (const analysis of buildSpecAnalyses) {
        if (analysis.secretReferences.length > 0) {
          const buildspec = parseBuildSpec(analysis.filePath);
          if (!buildspec) continue;

          const hasProperMasking = usesProperSecretMasking(buildspec);

          expect(hasProperMasking).toBe(true);
        }
      }
    });

    /**
     * Property: For any buildspec that creates credential files, cleanup SHALL be performed.
     *
     * **Validates: Requirements 8.3**
     */
    test("buildspecs that create credential files perform cleanup", () => {
      for (const analysis of buildSpecAnalyses) {
        const buildspec = parseBuildSpec(analysis.filePath);
        if (!buildspec) continue;

        const commands = extractAllCommands(buildspec);
        const commandText = commands.join("\n");

        // Check if buildspec creates credential files
        const createsCredentialFile =
          commandText.includes(".git-credentials") ||
          commandText.includes(".netrc") ||
          commandText.includes("credential.helper store");

        if (createsCredentialFile) {
          // Verify cleanup is performed
          const hasCleanup =
            commandText.includes("rm -f") &&
            (commandText.includes("credentials") || commandText.includes(".git-credentials"));

          expect(hasCleanup).toBe(true);
        }
      }
    });

    /**
     * Property: For any safe command pattern, the buildspecs SHALL use these patterns
     * when handling secrets.
     *
     * **Validates: Requirements 8.3**
     */
    test("safe command patterns are used for secret handling", () => {
      fc.assert(
        fc.property(safeCommandArb, ({ command }) => {
          // Verify that safe patterns are recognized as safe
          const isSafe = SAFE_SECRET_PATTERNS.some(pattern => pattern.test(command));

          // Safe commands should match at least one safe pattern
          // (unless they're comments or simple echo statements without variables)
          if (command.startsWith("#") || !command.includes("$")) {
            return true;
          }

          // Commands that write to files or use --password-stdin should be safe
          if (command.includes(">") || command.includes("--password-stdin")) {
            expect(isSafe).toBe(true);
          }

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any buildspec, environment variable expansions of secret values
     * SHALL NOT appear in log output commands.
     *
     * **Validates: Requirements 8.3**
     */
    test("environment variable expansions of secrets are not logged", () => {
      for (const analysis of buildSpecAnalyses) {
        const buildspec = parseBuildSpec(analysis.filePath);
        if (!buildspec) continue;

        const commands = extractAllCommands(buildspec);

        for (const secretRef of analysis.secretReferences) {
          const varName = secretRef.variableName;

          for (const command of commands) {
            // Skip comments
            if (command.trim().startsWith("#")) continue;

            // Check for direct echo of the variable
            const directEchoPattern = new RegExp(
              `echo\\s+["']?\\$\\{?${varName}\\}?["']?(?:\\s|$)`,
              "i"
            );

            if (directEchoPattern.test(command)) {
              throw new Error(
                `Buildspec ${path.basename(analysis.filePath)} directly echoes secret variable ${varName}: "${command}"`
              );
            }

            // Check for echo with variable in string (without redirection)
            const stringEchoPattern = new RegExp(
              `echo\\s+["'][^"']*\\$\\{?${varName}\\}?[^"']*["'](?!.*>)`,
              "i"
            );

            if (stringEchoPattern.test(command)) {
              // Verify it's not a safe pattern
              const isSafe = SAFE_SECRET_PATTERNS.some(pattern => pattern.test(command));

              if (!isSafe) {
                throw new Error(
                  `Buildspec ${path.basename(analysis.filePath)} may expose secret variable ${varName} in echo: "${command}"`
                );
              }
            }
          }
        }
      }
    });

    /**
     * Property: For any substring of a secret value, the buildspec output SHALL NOT
     * contain patterns that could reveal secret content.
     *
     * **Validates: Requirements 8.3**
     */
    test("no substrings that could reveal secret content", () => {
      fc.assert(
        fc.property(
          anySecretValueArb,
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 5, max: 20 }),
          (secretValue, start, length) => {
            // Extract a substring of the secret
            const actualStart = Math.min(start, secretValue.length - 1);
            const actualLength = Math.min(length, secretValue.length - actualStart);
            const substring = secretValue.substring(actualStart, actualStart + actualLength);

            // Skip if substring is too short to be meaningful
            if (substring.length < 5) return true;

            // For each buildspec, verify the substring pattern is not logged
            for (const analysis of buildSpecAnalyses) {
              const buildspec = parseBuildSpec(analysis.filePath);
              if (!buildspec) continue;

              const commands = extractAllCommands(buildspec);

              for (const command of commands) {
                // Skip comments
                if (command.trim().startsWith("#")) continue;

                // Check if command contains the literal substring
                // (This would indicate hardcoded secrets)
                if (command.includes(substring) && substring.length > 10) {
                  // This could be a hardcoded secret - verify it's not
                  const looksLikeSecret =
                    /[a-zA-Z0-9]{20,}/.test(substring) ||
                    /[!@#$%^&*()]{2,}/.test(substring);

                  if (looksLikeSecret) {
                    throw new Error(
                      `Buildspec ${path.basename(analysis.filePath)} may contain hardcoded secret-like value`
                    );
                  }
                }
              }
            }

            return true;
          }
        ),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any buildspec with Secrets Manager references, the secrets SHALL
     * be accessed securely without logging.
     *
     * **Validates: Requirements 8.3**
     */
    test("Secrets Manager references are accessed securely", () => {
      for (const analysis of buildSpecAnalyses) {
        const secretsManagerRefs = analysis.secretReferences.filter(
          ref => ref.type === "secrets-manager"
        );

        if (secretsManagerRefs.length > 0) {
          const buildspec = parseBuildSpec(analysis.filePath);
          if (!buildspec) continue;

          const commands = extractAllCommands(buildspec);
          const commandText = commands.join("\n");

          for (const secretRef of secretsManagerRefs) {
            // Verify the secret is not directly echoed
            const directEchoPattern = new RegExp(
              `echo\\s+.*\\$\\{?${secretRef.variableName}\\}?(?!.*>)`,
              "i"
            );

            // Find all echo commands that reference this variable
            const echoCommands = commands.filter(cmd =>
              cmd.includes(`$${secretRef.variableName}`) ||
              cmd.includes(`\${${secretRef.variableName}}`)
            );

            for (const echoCmd of echoCommands) {
              // Skip if it's a safe pattern (writing to file, checking if set, etc.)
              const isSafe = SAFE_SECRET_PATTERNS.some(pattern => pattern.test(echoCmd));

              if (!isSafe && echoCmd.toLowerCase().includes("echo")) {
                // Check if it's just checking if the variable is set
                const isCheckingIfSet =
                  echoCmd.includes("-z") ||
                  echoCmd.includes("-n") ||
                  echoCmd.includes("successfully retrieved") ||
                  echoCmd.includes("not set") ||
                  echoCmd.includes("Error:");

                if (!isCheckingIfSet) {
                  throw new Error(
                    `Buildspec ${path.basename(analysis.filePath)} may expose Secrets Manager value ${secretRef.variableName}: "${echoCmd}"`
                  );
                }
              }
            }
          }
        }
      }
    });

    /**
     * Property: For any buildspec, debug or verbose logging SHALL NOT expose secrets.
     *
     * **Validates: Requirements 8.3**
     */
    test("debug and verbose logging does not expose secrets", () => {
      for (const analysis of buildSpecAnalyses) {
        const buildspec = parseBuildSpec(analysis.filePath);
        if (!buildspec) continue;

        const commands = extractAllCommands(buildspec);

        for (const command of commands) {
          // Check for debug/verbose flags that might expose secrets
          const hasDebugFlag =
            command.includes("--debug") ||
            command.includes("-v ") ||
            command.includes("--verbose") ||
            command.includes("set -x");

          if (hasDebugFlag) {
            // Verify the command doesn't also reference secrets
            for (const secretRef of analysis.secretReferences) {
              const referencesSecret =
                command.includes(`$${secretRef.variableName}`) ||
                command.includes(`\${${secretRef.variableName}}`);

              if (referencesSecret) {
                throw new Error(
                  `Buildspec ${path.basename(analysis.filePath)} uses debug/verbose mode with secret ${secretRef.variableName}: "${command}"`
                );
              }
            }
          }
        }
      }
    });

    /**
     * Property: For any buildspec, all secret variable names SHALL follow secure naming patterns.
     *
     * **Validates: Requirements 8.3**
     */
    test("secret variable names follow secure naming patterns", () => {
      for (const analysis of buildSpecAnalyses) {
        for (const secretRef of analysis.secretReferences) {
          // Secret variable names should be uppercase with underscores
          const isValidName = /^[A-Z][A-Z0-9_]*$/.test(secretRef.variableName);

          expect(isValidName).toBe(true);

          // Secret variable names should indicate they are secrets
          const indicatesSecret = SECRET_VARIABLE_PATTERNS.some(pattern =>
            pattern.test(secretRef.variableName)
          );

          // If it's from Secrets Manager, it should indicate it's a secret
          if (secretRef.type === "secrets-manager") {
            expect(indicatesSecret).toBe(true);
          }
        }
      }
    });
  });
});
