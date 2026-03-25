/**
 * Unit Tests for Teardown Dry-Run Mode
 *
 * Feature: infrastructure-optimization, Teardown Dry-Run
 *
 * **Validates: Requirements 16.1, 16.2**
 *
 * Verifies that both teardown.sh and teardown-project.sh:
 * - Parse the `--dry-run` flag (DRY_RUN variable)
 * - Call `dry_run_report` and exit before any `delete-stack` calls when DRY_RUN is true
 * - Define a `dry_run_report` function
 * - Do NOT contain `delete-stack` or `delete-bucket` commands in the dry-run path
 * - Document `--dry-run` in the usage function
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONSTANTS
// =============================================================================

const TEARDOWN_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "teardown.sh"
);

const TEARDOWN_PROJECT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "teardown-project.sh"
);

const SCRIPTS = [
  { name: "teardown.sh", path: TEARDOWN_PATH },
  { name: "teardown-project.sh", path: TEARDOWN_PROJECT_PATH },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Read a script file and return its content.
 */
function readScript(scriptPath: string): string {
  return fs.readFileSync(scriptPath, "utf8");
}

/**
 * Extract the block of code that runs when DRY_RUN is true.
 * Looks for: if [[ "$DRY_RUN" == "true" ]]; then ... fi
 */
function extractDryRunBlock(scriptContent: string): string | null {
  // Match the dry-run conditional block in the main function
  const match = scriptContent.match(
    /if\s+\[\[\s+"\$DRY_RUN"\s*==\s*"true"\s*\]\];\s*then\s*([\s\S]*?)\s*fi/
  );
  return match ? match[1] : null;
}

/**
 * Extract the usage function content from a script.
 */
function extractUsageFunction(scriptContent: string): string | null {
  const match = scriptContent.match(
    /usage\(\)\s*\{[\s\S]*?cat\s*<<\s*['"]?EOF['"]?\s*([\s\S]*?)\s*EOF/
  );
  return match ? match[1] : null;
}

/**
 * Extract the dry_run_report function body from a script.
 */
function extractDryRunReportFunction(scriptContent: string): string | null {
  // Match from function declaration to the next function or section header
  const match = scriptContent.match(
    /dry_run_report\(\)\s*\{([\s\S]*?)^\}/m
  );
  return match ? match[1] : null;
}

// =============================================================================
// TESTS
// =============================================================================

describe("Teardown Dry-Run Unit Tests", () => {
  /**
   * Feature: infrastructure-optimization, Teardown Dry-Run
   * **Validates: Requirements 16.1, 16.2**
   */

  describe.each(SCRIPTS)("$name", ({ name, path: scriptPath }) => {
    let content: string;

    beforeAll(() => {
      content = readScript(scriptPath);
    });

    /**
     * Precondition: script file exists and is readable
     */
    test("should exist and be readable", () => {
      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(content.length).toBeGreaterThan(0);
    });

    /**
     * Verify --dry-run flag is parsed into DRY_RUN variable.
     *
     * **Validates: Requirements 16.1**
     */
    test("should parse --dry-run flag into DRY_RUN variable", () => {
      // DRY_RUN should be initialized to "false"
      expect(content).toMatch(/DRY_RUN="false"/);

      // The argument parser should handle --dry-run and set DRY_RUN="true"
      expect(content).toMatch(/--dry-run\)/);
      expect(content).toMatch(/DRY_RUN="true"/);
    });

    /**
     * Verify dry_run_report function exists in the script.
     *
     * **Validates: Requirements 16.1**
     */
    test("should define a dry_run_report function", () => {
      expect(content).toMatch(/dry_run_report\(\)/);

      const fnBody = extractDryRunReportFunction(content);
      expect(fnBody).not.toBeNull();
      expect(fnBody!.length).toBeGreaterThan(0);
    });

    /**
     * Verify that when DRY_RUN is true, the script calls dry_run_report and exits.
     *
     * **Validates: Requirements 16.1**
     */
    test("should call dry_run_report and exit when DRY_RUN is true", () => {
      const dryRunBlock = extractDryRunBlock(content);
      expect(dryRunBlock).not.toBeNull();

      // The dry-run block should call dry_run_report
      expect(dryRunBlock).toContain("dry_run_report");

      // The dry-run block should exit (exit 0) to prevent actual deletions
      expect(dryRunBlock).toMatch(/exit\s+0/);
    });

    /**
     * Verify the dry-run code path does NOT contain delete-stack or delete-bucket commands.
     *
     * **Validates: Requirements 16.1**
     */
    test("should NOT contain delete-stack or delete-bucket in dry-run path", () => {
      const dryRunBlock = extractDryRunBlock(content);
      expect(dryRunBlock).not.toBeNull();

      // The dry-run block must not perform any destructive operations
      expect(dryRunBlock).not.toContain("delete-stack");
      expect(dryRunBlock).not.toContain("delete-bucket");
      expect(dryRunBlock).not.toContain("delete-objects");
    });

    /**
     * Verify the dry_run_report function does NOT contain delete-stack or delete-bucket.
     *
     * **Validates: Requirements 16.1**
     */
    test("should NOT contain destructive commands in dry_run_report function", () => {
      const fnBody = extractDryRunReportFunction(content);
      expect(fnBody).not.toBeNull();

      expect(fnBody).not.toContain("delete-stack");
      expect(fnBody).not.toContain("delete-bucket");
      expect(fnBody).not.toContain("delete-objects");
      expect(fnBody).not.toContain("delete-secret");
    });

    /**
     * Verify --dry-run is documented in the usage function.
     *
     * **Validates: Requirements 16.1**
     */
    test("should document --dry-run in usage function", () => {
      const usageContent = extractUsageFunction(content);
      expect(usageContent).not.toBeNull();
      expect(usageContent).toContain("--dry-run");
    });

    /**
     * Verify the dry_run_report function displays resource types and cost estimates.
     *
     * **Validates: Requirements 16.2**
     */
    test("should display resource types and cost estimates in dry_run_report", () => {
      const fnBody = extractDryRunReportFunction(content);
      expect(fnBody).not.toBeNull();

      // Should reference list-stack-resources to enumerate resources
      expect(fnBody).toContain("list-stack-resources");

      // Should display cost information
      expect(fnBody).toMatch(/[Cc]ost|Est\.\s*Cost/);

      // Should indicate this is a dry run
      expect(fnBody).toMatch(/[Dd]ry.run/i);
    });

    /**
     * Verify the dry-run check in main() exits before any destructive function calls.
     * The dry-run block calls dry_run_report + exit 0, so no code after it executes.
     *
     * **Validates: Requirements 16.1**
     */
    test("should check DRY_RUN and exit before any destructive operations in main", () => {
      // Extract the main() function body
      const mainMatch = content.match(/^main\(\)\s*\{([\s\S]*?)^\}/m);
      expect(mainMatch).not.toBeNull();
      const mainBody = mainMatch![1];

      // The dry-run block should exist in main
      const dryRunCheckPos = mainBody.indexOf('DRY_RUN');
      expect(dryRunCheckPos).toBeGreaterThan(-1);

      // The dry-run block should contain exit 0
      const dryRunBlock = extractDryRunBlock(mainBody);
      expect(dryRunBlock).not.toBeNull();
      expect(dryRunBlock).toMatch(/exit\s+0/);

      // After the dry-run block, the script proceeds to destructive operations.
      // The key guarantee is that the dry-run block exits, so those never run.
      // Verify the dry-run check appears before any deletion-related calls in main.
      const dryRunPos = mainBody.indexOf('$DRY_RUN');

      // Look for destructive patterns that appear after the dry-run check
      const destructivePatterns = [
        "delete_stack", "delete-stack", "teardown_project",
        "confirm_deletion", "empty_ecr", "drain_ec2"
      ];

      for (const pattern of destructivePatterns) {
        const pos = mainBody.indexOf(pattern);
        if (pos > -1) {
          expect(dryRunPos).toBeLessThan(pos);
        }
      }
    });
  });
});
