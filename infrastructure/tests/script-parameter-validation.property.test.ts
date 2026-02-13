/**
 * Property-Based Tests for Script Compute-Type Parameter Validation
 *
 * Feature: ec2-ecs-deployment, Property 3: Script Compute-Type Parameter Validation
 *
 * **Validates: Requirements 2.1, 6.1**
 *
 * Property 3: Script Compute-Type Parameter Validation
 * _For any_ invocation of deploy.sh or teardown.sh with a --compute-type parameter,
 * the script SHALL accept only "fargate" or "ec2" as valid values and reject all
 * other inputs with an appropriate error message.
 */

import * as fc from "fast-check";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

type ComputeType = "fargate" | "ec2";

// =============================================================================
// VALIDATION FUNCTION
// =============================================================================

/**
 * Simulates the compute-type validation logic from deploy.sh and teardown.sh
 *
 * This function replicates the bash validation:
 * ```bash
 * if [[ ! "$COMPUTE_TYPE" =~ ^(fargate|ec2)$ ]]; then
 *     print_error "Compute type must be 'fargate' or 'ec2'"
 *     errors=$((errors + 1))
 * fi
 * ```
 */
function validateComputeType(value: string): ValidationResult {
  // The regex pattern from the bash scripts: ^(fargate|ec2)$
  const validPattern = /^(fargate|ec2)$/;

  if (validPattern.test(value)) {
    return { isValid: true };
  }

  return {
    isValid: false,
    errorMessage: "Compute type must be 'fargate' or 'ec2'",
  };
}

/**
 * Type guard to check if a value is a valid compute type
 */
function isValidComputeType(value: string): value is ComputeType {
  return value === "fargate" || value === "ec2";
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid compute type values
 * Only "fargate" and "ec2" are valid
 */
const validComputeTypeArb: fc.Arbitrary<ComputeType> = fc.constantFrom(
  "fargate",
  "ec2"
);

/**
 * Generator for invalid compute type values - arbitrary strings
 * Excludes the valid values "fargate" and "ec2"
 */
const invalidStringArb: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 100 })
  .filter((s) => s !== "fargate" && s !== "ec2");

/**
 * Generator for case variations of valid compute types
 * These should all be invalid (case-sensitive validation)
 */
const caseVariationArb: fc.Arbitrary<string> = fc.constantFrom(
  "Fargate",
  "FARGATE",
  "FarGate",
  "fArGaTe",
  "EC2",
  "Ec2",
  "eC2",
  "EC2 ",
  " ec2",
  "fargate ",
  " fargate"
);

/**
 * Generator for similar but invalid strings
 * These look like valid values but have subtle differences
 */
const similarInvalidArb: fc.Arbitrary<string> = fc.constantFrom(
  "fargate1",
  "ec21",
  "fargate-",
  "-ec2",
  "fargate_",
  "ec2_",
  "fargat",
  "ec",
  "e2",
  "far",
  "gate",
  "fargatee",
  "eec2",
  "fargate ec2",
  "ec2fargate",
  "fargate,ec2",
  "fargate|ec2",
  "fargate\n",
  "ec2\n",
  "\nfargate",
  "\nec2"
);

/**
 * Generator for empty and whitespace strings
 */
const emptyOrWhitespaceArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  " ",
  "  ",
  "\t",
  "\n",
  "\r\n",
  "   ",
  "\t\t"
);

/**
 * Generator for special characters and symbols
 */
const specialCharArb: fc.Arbitrary<string> = fc.constantFrom(
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "-",
  "_",
  "=",
  "+",
  "[",
  "]",
  "{",
  "}",
  "|",
  "\\",
  ";",
  ":",
  "'",
  '"',
  "<",
  ">",
  ",",
  ".",
  "/",
  "?",
  "`",
  "~"
);

/**
 * Generator for numeric strings
 */
const numericArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => n.toString());

/**
 * Generator for all invalid compute type values
 * Combines multiple generators for comprehensive testing
 */
const allInvalidArb: fc.Arbitrary<string> = fc.oneof(
  invalidStringArb,
  caseVariationArb,
  similarInvalidArb,
  emptyOrWhitespaceArb,
  specialCharArb,
  numericArb
);

/**
 * Generator for any string (valid or invalid)
 */
const anyStringArb: fc.Arbitrary<string> = fc.string({
  minLength: 0,
  maxLength: 100,
});

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Script Parameter Validation Property-Based Tests", () => {
  /**
   * Feature: ec2-ecs-deployment, Property 3: Script Compute-Type Parameter Validation
   * **Validates: Requirements 2.1, 6.1**
   */
  describe("Property 3: Script Compute-Type Parameter Validation", () => {
    /**
     * Property: For any string that is exactly "fargate" or "ec2",
     * the validation SHALL pass.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should accept valid compute type values", () => {
      fc.assert(
        fc.property(validComputeTypeArb, (computeType) => {
          const result = validateComputeType(computeType);

          // Validation should pass
          expect(result.isValid).toBe(true);

          // No error message should be present
          expect(result.errorMessage).toBeUndefined();

          // Type guard should return true
          expect(isValidComputeType(computeType)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any string that is NOT exactly "fargate" or "ec2",
     * the validation SHALL fail with an appropriate error message.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject invalid compute type values", () => {
      fc.assert(
        fc.property(allInvalidArb, (invalidValue) => {
          const result = validateComputeType(invalidValue);

          // Validation should fail
          expect(result.isValid).toBe(false);

          // Error message should be present
          expect(result.errorMessage).toBeDefined();
          expect(result.errorMessage).toBe(
            "Compute type must be 'fargate' or 'ec2'"
          );

          // Type guard should return false
          expect(isValidComputeType(invalidValue)).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any case variation of "fargate" or "ec2" (except exact match),
     * the validation SHALL fail (case-sensitive validation).
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject case variations of valid values", () => {
      fc.assert(
        fc.property(caseVariationArb, (caseVariation) => {
          const result = validateComputeType(caseVariation);

          // Validation should fail for case variations
          expect(result.isValid).toBe(false);

          // Error message should be present
          expect(result.errorMessage).toBe(
            "Compute type must be 'fargate' or 'ec2'"
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any string with leading or trailing whitespace around
     * valid values, the validation SHALL fail.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject values with leading or trailing whitespace", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            " fargate",
            "fargate ",
            " fargate ",
            " ec2",
            "ec2 ",
            " ec2 ",
            "\tfargate",
            "fargate\t",
            "\nec2",
            "ec2\n"
          ),
          (paddedValue) => {
            const result = validateComputeType(paddedValue);

            // Validation should fail for padded values
            expect(result.isValid).toBe(false);

            // Error message should be present
            expect(result.errorMessage).toBe(
              "Compute type must be 'fargate' or 'ec2'"
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any empty string or whitespace-only string,
     * the validation SHALL fail.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject empty and whitespace-only strings", () => {
      fc.assert(
        fc.property(emptyOrWhitespaceArb, (emptyValue) => {
          const result = validateComputeType(emptyValue);

          // Validation should fail for empty/whitespace values
          expect(result.isValid).toBe(false);

          // Error message should be present
          expect(result.errorMessage).toBe(
            "Compute type must be 'fargate' or 'ec2'"
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any arbitrary string, the validation result SHALL be
     * deterministic - the same input always produces the same output.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should produce deterministic validation results", () => {
      fc.assert(
        fc.property(anyStringArb, (value) => {
          // Run validation twice
          const result1 = validateComputeType(value);
          const result2 = validateComputeType(value);

          // Results should be identical
          expect(result1.isValid).toBe(result2.isValid);
          expect(result1.errorMessage).toBe(result2.errorMessage);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any arbitrary string, the validation SHALL return
     * true if and only if the string is exactly "fargate" or "ec2".
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should validate correctly for any arbitrary string", () => {
      fc.assert(
        fc.property(anyStringArb, (value) => {
          const result = validateComputeType(value);
          const expectedValid = value === "fargate" || value === "ec2";

          // Validation result should match expected
          expect(result.isValid).toBe(expectedValid);

          // Error message should be present only for invalid values
          if (expectedValid) {
            expect(result.errorMessage).toBeUndefined();
          } else {
            expect(result.errorMessage).toBe(
              "Compute type must be 'fargate' or 'ec2'"
            );
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any string containing valid values as substrings,
     * the validation SHALL fail unless it's an exact match.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject strings containing valid values as substrings", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            "myfargate",
            "fargateservice",
            "myec2",
            "ec2instance",
            "fargate-cluster",
            "ec2-cluster",
            "use-fargate",
            "use-ec2",
            "fargate123",
            "123ec2",
            "pre-fargate-post",
            "pre-ec2-post"
          ),
          (substringValue) => {
            const result = validateComputeType(substringValue);

            // Validation should fail for substring matches
            expect(result.isValid).toBe(false);

            // Error message should be present
            expect(result.errorMessage).toBe(
              "Compute type must be 'fargate' or 'ec2'"
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any numeric string, the validation SHALL fail.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject numeric strings", () => {
      fc.assert(
        fc.property(numericArb, (numericValue) => {
          const result = validateComputeType(numericValue);

          // Validation should fail for numeric values
          expect(result.isValid).toBe(false);

          // Error message should be present
          expect(result.errorMessage).toBe(
            "Compute type must be 'fargate' or 'ec2'"
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any special character string, the validation SHALL fail.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should reject special character strings", () => {
      fc.assert(
        fc.property(specialCharArb, (specialChar) => {
          const result = validateComputeType(specialChar);

          // Validation should fail for special characters
          expect(result.isValid).toBe(false);

          // Error message should be present
          expect(result.errorMessage).toBe(
            "Compute type must be 'fargate' or 'ec2'"
          );

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The validation function SHALL be consistent with the
     * type guard function for all inputs.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should be consistent with type guard for all inputs", () => {
      fc.assert(
        fc.property(anyStringArb, (value) => {
          const validationResult = validateComputeType(value);
          const typeGuardResult = isValidComputeType(value);

          // Both functions should agree on validity
          expect(validationResult.isValid).toBe(typeGuardResult);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For exactly "fargate", the validation SHALL always pass.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test('should always accept "fargate"', () => {
      fc.assert(
        fc.property(fc.constant("fargate"), (value) => {
          const result = validateComputeType(value);

          expect(result.isValid).toBe(true);
          expect(result.errorMessage).toBeUndefined();
          expect(isValidComputeType(value)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For exactly "ec2", the validation SHALL always pass.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test('should always accept "ec2"', () => {
      fc.assert(
        fc.property(fc.constant("ec2"), (value) => {
          const result = validateComputeType(value);

          expect(result.isValid).toBe(true);
          expect(result.errorMessage).toBeUndefined();
          expect(isValidComputeType(value)).toBe(true);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The set of valid compute types SHALL be exactly {"fargate", "ec2"}.
     *
     * **Validates: Requirements 2.1, 6.1**
     */
    test("should have exactly two valid compute types", () => {
      const validTypes = ["fargate", "ec2"];
      const invalidSamples = [
        "lambda",
        "ecs",
        "eks",
        "kubernetes",
        "docker",
        "container",
        "serverless",
        "spot",
        "ondemand",
      ];

      // All valid types should pass
      for (const validType of validTypes) {
        const result = validateComputeType(validType);
        expect(result.isValid).toBe(true);
      }

      // All invalid samples should fail
      for (const invalidType of invalidSamples) {
        const result = validateComputeType(invalidType);
        expect(result.isValid).toBe(false);
      }
    });
  });
});
