/**
 * Dredd Hooks - API Contract Testing
 *
 * This hooks file converts all Dredd failures to warnings, ensuring the build
 * never fails due to contract mismatches. All issues are collected and reported
 * in a warnings summary file.
 *
 * Requirements:
 * - 3.1: API_Linter SHALL validate OpenAPI specifications against the configured ruleset
 * - 3.2: CodeBuild SHALL report specific violations as warnings without failing the build
 * - 3.7: Dredd SHALL validate the deployed API against the OpenAPI specification and report mismatches as warnings
 */

const hooks = require("hooks");
const fs = require("fs");

// Collect all warnings during test execution
let warnings = [];

// Track test statistics
let stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
};

/**
 * Before each transaction - Add authentication and prepare request
 */
hooks.beforeEach((transaction, done) => {
  stats.total++;

  // Add authentication header if TEST_TOKEN environment variable is set
  const testToken = process.env.TEST_TOKEN;
  if (testToken) {
    transaction.request.headers["Authorization"] = `Bearer ${testToken}`;
  }

  // Add request ID header for tracing
  const requestId = `dredd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  transaction.request.headers["X-Request-Id"] = requestId;

  // Add content type header if not present
  if (!transaction.request.headers["Content-Type"]) {
    transaction.request.headers["Content-Type"] = "application/json";
  }

  done();
});

/**
 * After each transaction - Collect warnings instead of failing
 */
hooks.afterEach((transaction, done) => {
  // Check if transaction was skipped
  if (transaction.skip) {
    stats.skipped++;
    done();
    return;
  }

  // Check for status code mismatch
  const expectedStatus = transaction.expected.statusCode;
  const actualStatus = transaction.real ? transaction.real.statusCode : null;

  if (actualStatus !== null && actualStatus !== expectedStatus) {
    // Record as warning, don't fail the build
    const warning = {
      endpoint: transaction.name,
      method: transaction.request.method,
      path: transaction.request.uri,
      expected: expectedStatus,
      actual: actualStatus,
      message: `Status mismatch: expected ${expectedStatus}, got ${actualStatus}`,
      timestamp: new Date().toISOString(),
      severity: "warning",
    };

    // Add response body info if available (truncated for readability)
    if (transaction.real && transaction.real.body) {
      try {
        const bodyPreview = transaction.real.body.substring(0, 500);
        warning.responsePreview = bodyPreview;
      } catch (e) {
        warning.responsePreview = "[Unable to parse response body]";
      }
    }

    warnings.push(warning);
    stats.failed++;

    // CRITICAL: Clear fail flag to allow build to continue
    transaction.fail = false;

    console.log(`⚠️  Warning: ${warning.endpoint} - ${warning.message}`);
  } else if (actualStatus !== null) {
    stats.passed++;
  }

  // Check for body/schema validation issues
  if (transaction.results && transaction.results.body) {
    const bodyResults = transaction.results.body;
    if (bodyResults.results && bodyResults.results.length > 0) {
      bodyResults.results.forEach((result) => {
        if (result.severity === "error") {
          warnings.push({
            endpoint: transaction.name,
            method: transaction.request.method,
            path: transaction.request.uri,
            expected: "Valid response body",
            actual: "Body validation failed",
            message: result.message || "Response body does not match schema",
            timestamp: new Date().toISOString(),
            severity: "warning",
          });

          // Clear fail flag
          transaction.fail = false;
        }
      });
    }
  }

  done();
});

/**
 * Before specific transactions - Skip or configure special handling
 */

// Health endpoint should always be tested
hooks.before("Health > Health Check > Get health status", (transaction, done) => {
  transaction.skip = false;
  done();
});

// Skip transactions that require complex setup or external dependencies
hooks.before("*", (transaction, done) => {
  // Skip transactions that require database seeding or complex state
  const skipPatterns = [
    /delete/i,
    /remove/i,
  ];

  // Check if this transaction should be skipped based on patterns
  const shouldSkip = skipPatterns.some((pattern) =>
    pattern.test(transaction.name) || pattern.test(transaction.request.method)
  );

  if (shouldSkip && !transaction.skip) {
    // Don't auto-skip, but add a note
    console.log(`ℹ️  Note: ${transaction.name} may require special setup`);
  }

  done();
});

/**
 * After all transactions - Write warnings report
 */
hooks.afterAll((transactions, done) => {
  // Build comprehensive report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      skipped: stats.skipped,
      warningsCount: warnings.length,
    },
    status: warnings.length > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED_CLEAN",
    warnings: warnings,
    metadata: {
      endpoint: process.env.API_ENDPOINT || "http://localhost:5000",
      testToken: process.env.TEST_TOKEN ? "[REDACTED]" : "Not provided",
      nodeVersion: process.version,
    },
  };

  // Write warnings report to JSON file
  try {
    fs.writeFileSync("dredd-warnings.json", JSON.stringify(report, null, 2));
    console.log("\n📄 Warnings report written to dredd-warnings.json");
  } catch (err) {
    console.error("⚠️  Failed to write warnings report:", err.message);
  }

  // Print summary to console
  console.log("\n" + "=".repeat(60));
  console.log("📋 Contract Testing Report");
  console.log("=".repeat(60));
  console.log(`Total Tests:     ${stats.total}`);
  console.log(`Passed:          ${stats.passed}`);
  console.log(`Warnings:        ${stats.failed}`);
  console.log(`Skipped:         ${stats.skipped}`);
  console.log("=".repeat(60));

  if (warnings.length > 0) {
    console.log(`\n⚠️  Contract Testing Complete: ${warnings.length} warning(s) found`);
    console.log("\nWarning Details:");
    warnings.forEach((w, index) => {
      console.log(`  ${index + 1}. [${w.method}] ${w.endpoint}`);
      console.log(`     ${w.message}`);
    });
  } else {
    console.log("\n✅ Contract Testing Complete: No warnings found");
  }

  console.log("\n" + "=".repeat(60));
  console.log("⚠️  All issues reported as warnings only");
  console.log("✅ Build will proceed regardless of contract violations");
  console.log("=".repeat(60) + "\n");

  done();
});

/**
 * Handle connection errors gracefully
 */
hooks.beforeAll((transactions, done) => {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 Starting Dredd API Contract Testing");
  console.log("=".repeat(60));
  console.log(`Endpoint: ${process.env.API_ENDPOINT || "http://localhost:5000"}`);
  console.log(`Mode: Warnings Only (build will not fail)`);
  console.log("=".repeat(60) + "\n");

  done();
});
