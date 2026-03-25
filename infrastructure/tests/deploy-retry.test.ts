/**
 * Property-Based Tests for Deploy Script Retry with Exponential Backoff
 *
 * Feature: infrastructure-optimization, Property 12: Deploy Script Retry with Exponential Backoff
 *
 * **Validates: Requirements 10.1**
 *
 * Property 12: Deploy Script Retry with Exponential Backoff
 * _For any_ AWS CLI command that fails with a throttling or transient error code,
 * the retry function SHALL attempt up to 3 retries with delays of 2s, 4s, and 8s
 * respectively before failing.
 */

import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEPLOY_UTILS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "lib",
  "deploy-utils.sh"
);

// =============================================================================
// HELPER FUNCTIONS — Parse bash script to extract retry configuration
// =============================================================================

/**
 * Read the deploy-utils.sh script content
 */
function readDeployUtils(): string {
  return fs.readFileSync(DEPLOY_UTILS_PATH, "utf8");
}

/**
 * Extract the delays array from the retry_with_backoff function.
 * Looks for: local delays=(2 4 8)
 */
function extractDelays(scriptContent: string): number[] {
  const match = scriptContent.match(
    /local\s+delays=\(([^)]+)\)/
  );
  if (!match) {
    throw new Error("Could not find delays array in retry_with_backoff");
  }
  return match[1]
    .trim()
    .split(/\s+/)
    .map(Number);
}

/**
 * Extract max_retries from the retry_with_backoff function.
 * Looks for: local max_retries=3
 */
function extractMaxRetries(scriptContent: string): number {
  const match = scriptContent.match(
    /local\s+max_retries=(\d+)/
  );
  if (!match) {
    throw new Error("Could not find max_retries in retry_with_backoff");
  }
  return parseInt(match[1], 10);
}

/**
 * Extract the transient error patterns array from the script.
 * Looks for: _TRANSIENT_ERROR_PATTERNS=( ... )
 */
function extractTransientErrorPatterns(scriptContent: string): string[] {
  const match = scriptContent.match(
    /_TRANSIENT_ERROR_PATTERNS=\(\s*([\s\S]*?)\)/
  );
  if (!match) {
    throw new Error("Could not find _TRANSIENT_ERROR_PATTERNS array");
  }
  // Extract quoted strings from the array
  const patterns: string[] = [];
  const patternRegex = /"([^"]+)"/g;
  let patternMatch;
  while ((patternMatch = patternRegex.exec(match[1])) !== null) {
    patterns.push(patternMatch[1]);
  }
  return patterns;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for retry attempt indices (0-based)
 */
const retryAttemptArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 2 });

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Deploy Retry Property-Based Tests", () => {
  /**
   * Feature: infrastructure-optimization, Property 12: Deploy Script Retry with Exponential Backoff
   * **Validates: Requirements 10.1**
   */
  describe("Property 12: Deploy Script Retry with Exponential Backoff", () => {
    let scriptContent: string;
    let delays: number[];
    let maxRetries: number;
    let transientPatterns: string[];

    beforeAll(() => {
      scriptContent = readDeployUtils();
      delays = extractDelays(scriptContent);
      maxRetries = extractMaxRetries(scriptContent);
      transientPatterns = extractTransientErrorPatterns(scriptContent);
    });

    /**
     * Precondition: deploy-utils.sh exists and is readable
     */
    test("should have deploy-utils.sh script", () => {
      expect(fs.existsSync(DEPLOY_UTILS_PATH)).toBe(true);
      expect(scriptContent.length).toBeGreaterThan(0);
    });

    /**
     * Property: The retry function SHALL have exactly 3 max retries.
     *
     * **Validates: Requirements 10.1**
     */
    test("should configure max_retries as 3", () => {
      expect(maxRetries).toBe(3);
    });

    /**
     * Property: The retry delays SHALL be exactly [2, 4, 8] seconds
     * (exponential backoff with base 2).
     *
     * **Validates: Requirements 10.1**
     */
    test("should configure delays as [2, 4, 8] seconds", () => {
      expect(delays).toEqual([2, 4, 8]);
    });

    /**
     * Property: The number of delay values SHALL equal max_retries.
     *
     * **Validates: Requirements 10.1**
     */
    test("should have one delay value per retry attempt", () => {
      expect(delays.length).toBe(maxRetries);
    });

    /**
     * Property: For any retry attempt index i, the delay SHALL be 2^(i+1) seconds,
     * forming an exponential backoff sequence.
     *
     * **Validates: Requirements 10.1**
     */
    test("should use exponential backoff delays for any retry attempt", () => {
      fc.assert(
        fc.property(retryAttemptArb, (attemptIndex: number) => {
          const expectedDelay = Math.pow(2, attemptIndex + 1);
          const actualDelay = delays[attemptIndex];

          if (actualDelay !== expectedDelay) {
            throw new Error(
              `Retry attempt ${attemptIndex} has delay ${actualDelay}s, ` +
                `expected ${expectedDelay}s (2^${attemptIndex + 1})`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The transient error patterns list SHALL contain expected
     * AWS throttling and transient error codes.
     *
     * **Validates: Requirements 10.1**
     */
    test("should include expected transient error patterns", () => {
      const requiredPatterns = [
        "Throttling",
        "ThrottlingException",
        "RequestLimitExceeded",
        "TooManyRequestsException",
        "ServiceUnavailable",
        "InternalError",
        "RequestTimeout",
        "429",
        "503",
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...requiredPatterns),
          (pattern: string) => {
            if (!transientPatterns.includes(pattern)) {
              throw new Error(
                `Required transient error pattern "${pattern}" not found in ` +
                  `_TRANSIENT_ERROR_PATTERNS. Found: [${transientPatterns.join(", ")}]`
              );
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: All delay values SHALL be positive integers.
     *
     * **Validates: Requirements 10.1**
     */
    test("should have all positive integer delay values", () => {
      fc.assert(
        fc.property(retryAttemptArb, (attemptIndex: number) => {
          const delay = delays[attemptIndex];
          if (!Number.isInteger(delay) || delay <= 0) {
            throw new Error(
              `Delay at index ${attemptIndex} is ${delay}, expected a positive integer`
            );
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Each successive delay SHALL be strictly greater than the previous,
     * confirming exponential growth.
     *
     * **Validates: Requirements 10.1**
     */
    test("should have strictly increasing delays", () => {
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    });
  });
});
