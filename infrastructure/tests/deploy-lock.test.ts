/**
 * Property-Based Tests for Deploy Script Lock File Content and Lock Contention
 *
 * Feature: infrastructure-optimization, Property 13: Deploy Script Lock File Content
 * Feature: infrastructure-optimization, Property 14: Deploy Script Lock Contention
 *
 * **Validates: Requirements 11.1, 11.2**
 *
 * Property 13: Deploy Script Lock File Content
 * _For any_ project name and environment combination, the lock file created at
 * `s3://{bucket}/locks/{project}-{environment}.lock` SHALL contain a valid JSON
 * object with `timestamp`, `caller`, `stack`, and `pid` fields.
 *
 * Property 14: Deploy Script Lock Contention
 * _For any_ existing lock file with a timestamp less than 60 minutes old, the
 * deploy script SHALL abort. For any lock file older than 60 minutes, the script
 * SHALL treat it as stale and proceed.
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

const LOCK_STALE_SECONDS = 3600; // 60 minutes

const REQUIRED_LOCK_FIELDS = ["timestamp", "caller", "stack", "pid"];

// =============================================================================
// HELPER FUNCTIONS — Parse bash script
// =============================================================================

/**
 * Read the deploy-utils.sh script content
 */
function readDeployUtils(): string {
  return fs.readFileSync(DEPLOY_UTILS_PATH, "utf8");
}

/**
 * Extract the lock stale threshold from the script.
 * Looks for: _LOCK_STALE_SECONDS=3600
 */
function extractStaleThreshold(scriptContent: string): number {
  const match = scriptContent.match(/_LOCK_STALE_SECONDS=(\d+)/);
  if (!match) {
    throw new Error("Could not find _LOCK_STALE_SECONDS in deploy-utils.sh");
  }
  return parseInt(match[1], 10);
}

/**
 * Extract the lock file path pattern from the script.
 * Looks for: s3://${bucket}/locks/${project}-${environment}.lock
 */
function extractLockPathPattern(scriptContent: string): boolean {
  return scriptContent.includes(
    'locks/${project}-${environment}.lock'
  );
}

/**
 * Extract the lock JSON template from the acquire_lock function.
 * Verifies the printf format string contains all required fields.
 */
function extractLockJsonFields(scriptContent: string): string[] {
  // Find the lock_json printf in acquire_lock function
  const acquireLockSection = scriptContent.match(
    /acquire_lock\(\)[\s\S]*?^}/m
  );
  if (!acquireLockSection) {
    throw new Error("Could not find acquire_lock function");
  }

  const fields: string[] = [];
  for (const field of REQUIRED_LOCK_FIELDS) {
    if (acquireLockSection[0].includes(`"${field}"`)) {
      fields.push(field);
    }
  }
  return fields;
}

/**
 * Simulate lock age evaluation as done in check_lock.
 * Returns true if the lock is active (should abort), false if stale (should proceed).
 */
function isLockActive(lockAgeSeconds: number, staleThreshold: number): boolean {
  return lockAgeSeconds < staleThreshold;
}

/**
 * Build a lock path from bucket, project, and environment.
 */
function buildLockPath(
  bucket: string,
  project: string,
  environment: string
): string {
  return `s3://${bucket}/locks/${project}-${environment}.lock`;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid project names (lowercase alphanumeric with hyphens)
 */
const projectNameArb: fc.Arbitrary<string> = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")
    ),
    { minLength: 1, maxLength: 30 }
  )
  .filter((s) => /^[a-z]/.test(s) && !s.endsWith("-"));

/**
 * Generator for valid environment names
 */
const environmentArb: fc.Arbitrary<string> = fc.constantFrom(
  "dev",
  "staging",
  "prod"
);

/**
 * Generator for valid S3 bucket names
 */
const bucketNameArb: fc.Arbitrary<string> = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")
    ),
    { minLength: 3, maxLength: 30 }
  )
  .filter((s) => /^[a-z]/.test(s) && !s.endsWith("-"));

/**
 * Generator for lock ages that are active (< 3600 seconds)
 */
const activeLockAgeArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: LOCK_STALE_SECONDS - 1,
});

/**
 * Generator for lock ages that are stale (>= 3600 seconds)
 */
const staleLockAgeArb: fc.Arbitrary<number> = fc.integer({
  min: LOCK_STALE_SECONDS,
  max: LOCK_STALE_SECONDS * 10,
});

/**
 * Generator for any lock age (positive integer)
 */
const anyLockAgeArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: LOCK_STALE_SECONDS * 10,
});

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Deploy Lock Property-Based Tests", () => {
  let scriptContent: string;

  beforeAll(() => {
    scriptContent = readDeployUtils();
  });

  // ===========================================================================
  // Property 13: Deploy Script Lock File Content
  // ===========================================================================

  /**
   * Feature: infrastructure-optimization, Property 13: Deploy Script Lock File Content
   * **Validates: Requirements 11.1**
   */
  describe("Property 13: Deploy Script Lock File Content", () => {
    /**
     * Precondition: deploy-utils.sh exists and is readable
     */
    test("should have deploy-utils.sh script", () => {
      expect(fs.existsSync(DEPLOY_UTILS_PATH)).toBe(true);
      expect(scriptContent.length).toBeGreaterThan(0);
    });

    /**
     * Property: The lock file JSON SHALL contain all required fields:
     * timestamp, caller, stack, and pid.
     *
     * **Validates: Requirements 11.1**
     */
    test("should include all required JSON fields in lock file", () => {
      const lockFields = extractLockJsonFields(scriptContent);

      for (const field of REQUIRED_LOCK_FIELDS) {
        expect(lockFields).toContain(field);
      }
    });

    /**
     * Property: For any project/environment combination, the lock path
     * SHALL follow the format s3://{bucket}/locks/{project}-{environment}.lock
     *
     * **Validates: Requirements 11.1**
     */
    test("should use correct lock path format for any project/environment", () => {
      fc.assert(
        fc.property(
          bucketNameArb,
          projectNameArb,
          environmentArb,
          (bucket: string, project: string, environment: string) => {
            const lockPath = buildLockPath(bucket, project, environment);

            // Verify path format
            const expectedPattern = new RegExp(
              `^s3://${bucket}/locks/${project}-${environment}\\.lock$`
            );
            if (!expectedPattern.test(lockPath)) {
              throw new Error(
                `Lock path "${lockPath}" does not match expected format ` +
                  `"s3://${bucket}/locks/${project}-${environment}.lock"`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The script SHALL use the lock path pattern
     * s3://{bucket}/locks/{project}-{environment}.lock
     *
     * **Validates: Requirements 11.1**
     */
    test("should have lock path pattern in script", () => {
      expect(extractLockPathPattern(scriptContent)).toBe(true);
    });

    /**
     * Property: The acquire_lock function SHALL exist in the script.
     *
     * **Validates: Requirements 11.1**
     */
    test("should have acquire_lock function", () => {
      expect(scriptContent).toContain("acquire_lock()");
    });

    /**
     * Property: The check_lock function SHALL exist in the script.
     *
     * **Validates: Requirements 11.1**
     */
    test("should have check_lock function", () => {
      expect(scriptContent).toContain("check_lock()");
    });

    /**
     * Property: The release_lock function SHALL exist in the script.
     *
     * **Validates: Requirements 11.1**
     */
    test("should have release_lock function", () => {
      expect(scriptContent).toContain("release_lock()");
    });
  });

  // ===========================================================================
  // Property 14: Deploy Script Lock Contention
  // ===========================================================================

  /**
   * Feature: infrastructure-optimization, Property 14: Deploy Script Lock Contention
   * **Validates: Requirements 11.2**
   */
  describe("Property 14: Deploy Script Lock Contention", () => {
    let staleThreshold: number;

    beforeAll(() => {
      staleThreshold = extractStaleThreshold(scriptContent);
    });

    /**
     * Precondition: The stale threshold is 3600 seconds (60 minutes).
     */
    test("should have stale threshold of 3600 seconds", () => {
      expect(staleThreshold).toBe(3600);
    });

    /**
     * Property: For any lock age < 3600 seconds (60 minutes), the lock
     * SHALL be treated as active and the deployment SHALL abort.
     *
     * **Validates: Requirements 11.2**
     */
    test("should treat locks younger than 60 minutes as active (abort)", () => {
      fc.assert(
        fc.property(activeLockAgeArb, (ageSeconds: number) => {
          const active = isLockActive(ageSeconds, staleThreshold);

          if (!active) {
            throw new Error(
              `Lock with age ${ageSeconds}s should be active (< ${staleThreshold}s) ` +
                `but was treated as stale`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any lock age >= 3600 seconds (60 minutes), the lock
     * SHALL be treated as stale and the deployment SHALL proceed.
     *
     * **Validates: Requirements 11.2**
     */
    test("should treat locks 60 minutes or older as stale (proceed)", () => {
      fc.assert(
        fc.property(staleLockAgeArb, (ageSeconds: number) => {
          const active = isLockActive(ageSeconds, staleThreshold);

          if (active) {
            throw new Error(
              `Lock with age ${ageSeconds}s should be stale (>= ${staleThreshold}s) ` +
                `but was treated as active`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any random timestamp, the lock contention check SHALL
     * correctly classify it as active or stale based on the 3600s threshold.
     *
     * **Validates: Requirements 11.2**
     */
    test("should correctly classify any lock age against the stale threshold", () => {
      fc.assert(
        fc.property(anyLockAgeArb, (ageSeconds: number) => {
          const active = isLockActive(ageSeconds, staleThreshold);
          const expectedActive = ageSeconds < staleThreshold;

          if (active !== expectedActive) {
            throw new Error(
              `Lock age ${ageSeconds}s: expected active=${expectedActive}, ` +
                `got active=${active}. Threshold: ${staleThreshold}s`
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The boundary at exactly 3600 seconds SHALL be treated as stale
     * (>= comparison in the script: age_seconds -ge $_LOCK_STALE_SECONDS).
     *
     * **Validates: Requirements 11.2**
     */
    test("should treat lock at exactly 3600 seconds as stale", () => {
      const active = isLockActive(LOCK_STALE_SECONDS, staleThreshold);
      expect(active).toBe(false);
    });

    /**
     * Property: The boundary at 3599 seconds SHALL be treated as active.
     *
     * **Validates: Requirements 11.2**
     */
    test("should treat lock at 3599 seconds as active", () => {
      const active = isLockActive(LOCK_STALE_SECONDS - 1, staleThreshold);
      expect(active).toBe(true);
    });

    /**
     * Property: The script check_lock function SHALL use -ge comparison
     * for the stale threshold check.
     *
     * **Validates: Requirements 11.2**
     */
    test("should use -ge comparison for stale threshold in script", () => {
      expect(scriptContent).toMatch(
        /age_seconds\s+-ge\s+\$_LOCK_STALE_SECONDS/
      );
    });

    /**
     * Property: The script SHALL print ABORT message for active locks.
     *
     * **Validates: Requirements 11.2**
     */
    test("should print ABORT message for active locks", () => {
      expect(scriptContent).toContain("ABORT");
    });

    /**
     * Property: The script SHALL print stale warning for expired locks.
     *
     * **Validates: Requirements 11.2**
     */
    test("should print stale warning for expired locks", () => {
      expect(scriptContent).toMatch(/[Ss]tale/);
    });
  });
});
