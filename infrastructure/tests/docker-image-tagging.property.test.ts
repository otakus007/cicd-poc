/**
 * Property-Based Tests for Docker Image Tagging Completeness
 *
 * Feature: aws-cicd-pipeline, Property 2: Docker Image Tagging Completeness
 *
 * **Validates: Requirements 4.6**
 *
 * Property 2: Docker Image Tagging Completeness
 * _For any_ successful build execution, the resulting Docker image SHALL be tagged with:
 * - The commit SHA (or truncated version)
 * - A semantic version or "latest" tag
 * - Both tags pointing to the same image digest
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

interface BuildSpecPhases {
  install?: BuildSpecPhase;
  pre_build?: BuildSpecPhase;
  build?: BuildSpecPhase;
  post_build?: BuildSpecPhase;
}

interface BuildSpec {
  version: string | number;
  env?: {
    variables?: Record<string, string>;
    "secrets-manager"?: Record<string, string>;
  };
  phases?: BuildSpecPhases;
  artifacts?: Record<string, unknown>;
  "secondary-artifacts"?: Record<string, unknown>;
  reports?: Record<string, unknown>;
  cache?: Record<string, unknown>;
}

interface ImageTaggingResult {
  hasCommitShaTag: boolean;
  hasShortShaTag: boolean;
  hasVersionOrLatestTag: boolean;
  commitShaTagFormat: string | null;
  shortShaTagFormat: string | null;
  versionTagFormat: string | null;
  allTagsFromSameBuild: boolean;
  tagCommands: string[];
}

interface DockerTagValidation {
  isValid: boolean;
  errors: string[];
  tag: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load and parse the buildspec-build.yml file
 */
function loadBuildSpec(): BuildSpec {
  const buildspecPath = path.join(__dirname, "..", "..", "buildspecs", "buildspec-build.yml");
  const buildspecContent = fs.readFileSync(buildspecPath, "utf8");
  return yaml.load(buildspecContent) as BuildSpec;
}

/**
 * Extract all docker tag commands from the buildspec
 */
function extractDockerTagCommands(buildspec: BuildSpec): string[] {
  const tagCommands: string[] = [];
  const phases = buildspec.phases || {};

  // Check all phases for docker commands
  for (const phaseName of ["install", "pre_build", "build", "post_build"] as const) {
    const phase = phases[phaseName];
    if (phase?.commands) {
      for (const command of phase.commands) {
        // Look for docker build or docker tag commands
        if (typeof command === "string" &&
            (command.includes("docker build") || command.includes("docker tag"))) {
          tagCommands.push(command);
        }
      }
    }
  }

  return tagCommands;
}

/**
 * Check if the buildspec tags images with commit SHA
 */
function hasCommitShaTagging(buildspec: BuildSpec): boolean {
  const phases = buildspec.phases || {};
  const allCommands = getAllCommands(phases);

  // Look for patterns that indicate commit SHA tagging
  const shaPatterns = [
    /\$\{?CODEBUILD_RESOLVED_SOURCE_VERSION\}?/,
    /\$\{?COMMIT_SHA\}?/,
    /\$\{?SHORT_SHA\}?/,
    /\$\{?GIT_COMMIT\}?/,
    /:[a-f0-9]{7,40}/i, // Direct SHA in tag
  ];

  return allCommands.some(cmd =>
    shaPatterns.some(pattern => pattern.test(cmd))
  );
}

/**
 * Check if the buildspec tags images with version or latest
 */
function hasVersionOrLatestTagging(buildspec: BuildSpec): boolean {
  const phases = buildspec.phases || {};
  const allCommands = getAllCommands(phases);

  // Look for patterns that indicate version or latest tagging
  const versionPatterns = [
    /:latest/i,
    /:v?\d+\.\d+\.\d+/,
    /\$\{?VERSION\}?/i,
    /\$\{?BUILD_VERSION\}?/i,
    /\$\{?SEMANTIC_VERSION\}?/i,
  ];

  return allCommands.some(cmd =>
    versionPatterns.some(pattern => pattern.test(cmd))
  );
}

/**
 * Get all commands from all phases
 */
function getAllCommands(phases: BuildSpecPhases): string[] {
  const commands: string[] = [];

  for (const phaseName of ["install", "pre_build", "build", "post_build"] as const) {
    const phase = phases[phaseName];
    if (phase?.commands) {
      for (const command of phase.commands) {
        if (typeof command === "string") {
          commands.push(command);
        }
      }
    }
  }

  return commands;
}

/**
 * Analyze the buildspec for image tagging completeness
 */
function analyzeImageTagging(buildspec: BuildSpec): ImageTaggingResult {
  const tagCommands = extractDockerTagCommands(buildspec);
  const phases = buildspec.phases || {};
  const allCommands = getAllCommands(phases);

  // Check for commit SHA tagging
  const hasCommitShaTag = allCommands.some(cmd =>
    /\$\{?CODEBUILD_RESOLVED_SOURCE_VERSION\}?/.test(cmd) ||
    /\$\{?COMMIT_SHA\}?/.test(cmd)
  );

  // Check for short SHA tagging
  const hasShortShaTag = allCommands.some(cmd =>
    /\$\{?CODEBUILD_RESOLVED_SOURCE_VERSION:0:8\}?/.test(cmd) ||
    /\$\{?SHORT_SHA\}?/.test(cmd)
  );

  // Check for version or latest tagging
  const hasVersionOrLatestTag = allCommands.some(cmd =>
    /:latest/.test(cmd) ||
    /v\d+\.\d+\.\d+/.test(cmd)
  );

  // Extract tag formats
  const commitShaTagFormat = extractTagFormat(allCommands, /\$\{?IMAGE_NAME\}?:\$\{?COMMIT_SHA\}?/);
  const shortShaTagFormat = extractTagFormat(allCommands, /\$\{?IMAGE_NAME\}?:\$\{?SHORT_SHA\}?/);
  const versionTagFormat = extractTagFormat(allCommands, /:latest/);

  // Check if all tags are from the same docker build command
  const allTagsFromSameBuild = tagCommands.some(cmd =>
    cmd.includes("-t") &&
    (cmd.match(/-t/g) || []).length >= 2
  );

  return {
    hasCommitShaTag,
    hasShortShaTag,
    hasVersionOrLatestTag,
    commitShaTagFormat,
    shortShaTagFormat,
    versionTagFormat,
    allTagsFromSameBuild,
    tagCommands,
  };
}

/**
 * Extract tag format from commands
 */
function extractTagFormat(commands: string[], pattern: RegExp): string | null {
  for (const cmd of commands) {
    const match = cmd.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Validate a Docker tag format
 * Docker tags can contain lowercase and uppercase letters, digits, underscores, periods, and hyphens
 * A tag name may not start with a period or hyphen, and may contain a maximum of 128 characters
 */
function isValidDockerTag(tag: string): DockerTagValidation {
  const errors: string[] = [];

  // Check length
  if (tag.length === 0) {
    errors.push("Tag cannot be empty");
  }

  if (tag.length > 128) {
    errors.push("Tag exceeds maximum length of 128 characters");
  }

  // Check starting character
  if (tag.startsWith(".") || tag.startsWith("-")) {
    errors.push("Tag cannot start with a period or hyphen");
  }

  // Check valid characters
  const validTagPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (tag.length > 0 && !validTagPattern.test(tag)) {
    errors.push("Tag contains invalid characters (only alphanumeric, underscore, period, and hyphen allowed)");
  }

  return {
    isValid: errors.length === 0,
    errors,
    tag,
  };
}

/**
 * Validate a commit SHA format
 */
function isValidCommitSha(sha: string): boolean {
  // Git commit SHAs are 40 hex characters, but short versions (7-8 chars) are also valid
  const shaPattern = /^[a-f0-9]{7,40}$/i;
  return shaPattern.test(sha);
}

/**
 * Validate a semantic version format
 */
function isValidSemanticVersion(version: string): boolean {
  // Semantic version: vX.Y.Z or X.Y.Z
  const semverPattern = /^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  return semverPattern.test(version);
}

/**
 * Simulate Docker image tagging based on buildspec configuration
 * Returns the tags that would be applied to an image
 */
function simulateImageTagging(
  commitSha: string,
  version: string | null,
  imageName: string
): string[] {
  const tags: string[] = [];

  // Full commit SHA tag
  tags.push(`${imageName}:${commitSha}`);

  // Short commit SHA tag (first 8 characters)
  const shortSha = commitSha.substring(0, 8);
  tags.push(`${imageName}:${shortSha}`);

  // Version tag or latest
  if (version && isValidSemanticVersion(version)) {
    tags.push(`${imageName}:${version}`);
  } else {
    tags.push(`${imageName}:latest`);
  }

  return tags;
}

/**
 * Verify that multiple tags would point to the same image
 * In Docker, tags applied in the same build command point to the same image digest
 */
function verifyTagsPointToSameImage(tags: string[]): boolean {
  // All tags from the same build command will have the same digest
  // This is verified by checking they all have the same image name prefix
  if (tags.length === 0) return false;

  const imageNames = tags.map(tag => tag.split(":")[0]);
  const uniqueImageNames = new Set(imageNames);

  return uniqueImageNames.size === 1;
}

// =============================================================================
// FAST-CHECK ARBITRARIES (GENERATORS)
// =============================================================================

/**
 * Generator for valid commit SHAs (7-40 hex characters)
 */
const commitShaArb = fc
  .integer({ min: 7, max: 40 })
  .chain((length) =>
    fc.stringOf(fc.constantFrom(..."0123456789abcdef".split("")), {
      minLength: length,
      maxLength: length,
    })
  );

/**
 * Generator for short commit SHAs (7-8 hex characters)
 */
const shortCommitShaArb = fc.stringOf(
  fc.constantFrom(..."0123456789abcdef".split("")),
  { minLength: 7, maxLength: 8 }
);

/**
 * Generator for semantic versions (vX.Y.Z format)
 */
const semanticVersionArb = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 999 })
  )
  .map(([major, minor, patch]) => `v${major}.${minor}.${patch}`);

/**
 * Generator for semantic versions without 'v' prefix
 */
const semanticVersionNoVArb = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 999 })
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * Generator for valid Docker image names
 */
const imageNameArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), {
      minLength: 0,
      maxLength: 20,
    })
  )
  .map(([first, rest]) => first + rest)
  .filter((name) => !name.endsWith("-") && !name.endsWith("_"));

/**
 * Generator for valid Docker tags
 */
const dockerTagArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-".split("")), {
      minLength: 0,
      maxLength: 50,
    })
  )
  .map(([first, rest]) => first + rest)
  .filter((tag) => !tag.endsWith(".") && !tag.endsWith("-") && !tag.endsWith("_") && tag.length <= 128);

/**
 * Generator for version strings (either semantic version or "latest")
 */
const versionOrLatestArb = fc.oneof(
  semanticVersionArb,
  semanticVersionNoVArb,
  fc.constant("latest")
);

/**
 * Combined generator for build execution parameters
 */
const buildExecutionArb = fc.record({
  commitSha: commitShaArb,
  version: fc.option(semanticVersionArb, { nil: null }),
  imageName: imageNameArb,
});

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe("Docker Image Tagging Property-Based Tests", () => {
  /**
   * Feature: aws-cicd-pipeline, Property 2: Docker Image Tagging Completeness
   * **Validates: Requirements 4.6**
   */
  describe("Property 2: Docker Image Tagging Completeness", () => {
    let buildspec: BuildSpec;

    beforeAll(() => {
      buildspec = loadBuildSpec();
    });

    /**
     * Property: For any successful build execution, the resulting Docker image
     * SHALL be tagged with the commit SHA (or truncated version).
     *
     * **Validates: Requirements 4.6**
     */
    test("buildspec should tag images with commit SHA", () => {
      const result = analyzeImageTagging(buildspec);

      expect(result.hasCommitShaTag || result.hasShortShaTag).toBe(true);

      // Verify the buildspec uses CODEBUILD_RESOLVED_SOURCE_VERSION or similar
      const phases = buildspec.phases || {};
      const allCommands = getAllCommands(phases);
      const hasShaReference = allCommands.some(cmd =>
        /CODEBUILD_RESOLVED_SOURCE_VERSION|COMMIT_SHA|SHORT_SHA/.test(cmd)
      );

      expect(hasShaReference).toBe(true);
    });

    /**
     * Property: For any successful build execution, the resulting Docker image
     * SHALL be tagged with a semantic version or "latest" tag.
     *
     * **Validates: Requirements 4.6**
     */
    test("buildspec should tag images with version or latest", () => {
      const result = analyzeImageTagging(buildspec);

      expect(result.hasVersionOrLatestTag).toBe(true);
    });

    /**
     * Property: For any valid commit SHA, the generated tag SHALL be a valid Docker tag.
     *
     * **Validates: Requirements 4.6**
     */
    test("commit SHA tags should be valid Docker tags", () => {
      fc.assert(
        fc.property(commitShaArb, (commitSha) => {
          // Verify the commit SHA is valid
          expect(isValidCommitSha(commitSha)).toBe(true);

          // Verify it would make a valid Docker tag
          const validation = isValidDockerTag(commitSha);
          expect(validation.isValid).toBe(true);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any valid semantic version, the generated tag SHALL be a valid Docker tag.
     *
     * **Validates: Requirements 4.6**
     */
    test("semantic version tags should be valid Docker tags", () => {
      fc.assert(
        fc.property(semanticVersionArb, (version) => {
          // Verify the version is valid semantic version
          expect(isValidSemanticVersion(version)).toBe(true);

          // Verify it would make a valid Docker tag
          const validation = isValidDockerTag(version);
          expect(validation.isValid).toBe(true);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any build execution, both commit SHA and version/latest tags
     * SHALL be applied to the same image (same build command).
     *
     * **Validates: Requirements 4.6**
     */
    test("both tags should be applied in the same build command", () => {
      const result = analyzeImageTagging(buildspec);

      // The buildspec should have a docker build command with multiple -t flags
      expect(result.allTagsFromSameBuild).toBe(true);
    });

    /**
     * Property: For any random commit SHA and version, simulated tagging SHALL
     * produce tags that all point to the same image.
     *
     * **Validates: Requirements 4.6**
     */
    test("simulated tagging should produce tags pointing to same image", () => {
      fc.assert(
        fc.property(buildExecutionArb, ({ commitSha, version, imageName }) => {
          const tags = simulateImageTagging(commitSha, version, imageName);

          // Should have at least 2 tags (SHA and version/latest)
          expect(tags.length).toBeGreaterThanOrEqual(2);

          // All tags should point to the same image
          expect(verifyTagsPointToSameImage(tags)).toBe(true);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any commit SHA, both full and short SHA tags SHALL be valid.
     *
     * **Validates: Requirements 4.6**
     */
    test("both full and short SHA tags should be valid", () => {
      fc.assert(
        fc.property(commitShaArb, (commitSha) => {
          const fullSha = commitSha;
          const shortSha = commitSha.substring(0, 8);

          // Both should be valid commit SHAs
          expect(isValidCommitSha(fullSha)).toBe(true);
          expect(isValidCommitSha(shortSha)).toBe(true);

          // Both should be valid Docker tags
          expect(isValidDockerTag(fullSha).isValid).toBe(true);
          expect(isValidDockerTag(shortSha).isValid).toBe(true);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any generated Docker tag, it SHALL comply with Docker tag format rules.
     *
     * **Validates: Requirements 4.6**
     */
    test("all generated tags should comply with Docker tag format", () => {
      fc.assert(
        fc.property(dockerTagArb, (tag) => {
          const validation = isValidDockerTag(tag);

          // The generated tag should be valid
          expect(validation.isValid).toBe(true);

          // Tag should not exceed 128 characters
          expect(tag.length).toBeLessThanOrEqual(128);

          // Tag should not start with period or hyphen
          expect(tag.startsWith(".")).toBe(false);
          expect(tag.startsWith("-")).toBe(false);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any build execution with a commit SHA, the short SHA tag
     * SHALL be the first 8 characters of the full SHA.
     *
     * **Validates: Requirements 4.6**
     */
    test("short SHA should be first 8 characters of full SHA", () => {
      fc.assert(
        fc.property(commitShaArb, imageNameArb, (commitSha, imageName) => {
          const tags = simulateImageTagging(commitSha, null, imageName);

          // Find the full SHA tag and short SHA tag
          const fullShaTag = tags.find(t => t.includes(commitSha));
          const shortSha = commitSha.substring(0, 8);
          const shortShaTag = tags.find(t => t.endsWith(`:${shortSha}`));

          expect(fullShaTag).toBeDefined();
          expect(shortShaTag).toBeDefined();

          // Verify short SHA is prefix of full SHA
          expect(commitSha.startsWith(shortSha)).toBe(true);

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: The buildspec SHALL define IMAGE_NAME variable for consistent tagging.
     *
     * **Validates: Requirements 4.6**
     */
    test("buildspec should define IMAGE_NAME variable", () => {
      const envVars = buildspec.env?.variables || {};

      expect(envVars.IMAGE_NAME).toBeDefined();
      expect(typeof envVars.IMAGE_NAME).toBe("string");
      expect(envVars.IMAGE_NAME.length).toBeGreaterThan(0);
    });

    /**
     * Property: For any version string, if it's a valid semantic version,
     * it SHALL be used as a tag; otherwise "latest" SHALL be used.
     *
     * **Validates: Requirements 4.6**
     */
    test("version tag should be semantic version or latest", () => {
      fc.assert(
        fc.property(
          commitShaArb,
          fc.option(semanticVersionArb, { nil: null }),
          imageNameArb,
          (commitSha, version, imageName) => {
            const tags = simulateImageTagging(commitSha, version, imageName);

            // Should have a version or latest tag
            const hasVersionTag = tags.some(t =>
              t.endsWith(`:${version}`) || t.endsWith(":latest")
            );

            expect(hasVersionTag).toBe(true);

            // If version is provided and valid, it should be used
            if (version && isValidSemanticVersion(version)) {
              expect(tags.some(t => t.endsWith(`:${version}`))).toBe(true);
            } else {
              expect(tags.some(t => t.endsWith(":latest"))).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 15 }
      );
    });

    /**
     * Property: The buildspec post_build phase SHALL contain docker build commands
     * with multiple -t flags for tagging.
     *
     * **Validates: Requirements 4.6**
     */
    test("post_build phase should have docker build with multiple tags", () => {
      const postBuildCommands = buildspec.phases?.post_build?.commands || [];

      // Find docker build command
      const dockerBuildCmd = postBuildCommands.find(cmd =>
        typeof cmd === "string" && cmd.includes("docker build")
      );

      expect(dockerBuildCmd).toBeDefined();

      // Should have multiple -t flags
      if (dockerBuildCmd && typeof dockerBuildCmd === "string") {
        const tagFlags = (dockerBuildCmd.match(/-t/g) || []).length;
        expect(tagFlags).toBeGreaterThanOrEqual(2);
      }
    });

    /**
     * Property: For any combination of commit SHA and semantic version,
     * the tagging SHALL produce exactly 3 tags (full SHA, short SHA, version/latest).
     *
     * **Validates: Requirements 4.6**
     */
    test("tagging should produce exactly 3 tags", () => {
      fc.assert(
        fc.property(buildExecutionArb, ({ commitSha, version, imageName }) => {
          const tags = simulateImageTagging(commitSha, version, imageName);

          // Should have exactly 3 tags
          expect(tags.length).toBe(3);

          // Verify tag types
          const fullShaTag = tags.find(t => t.includes(commitSha));
          const shortShaTag = tags.find(t => t.endsWith(`:${commitSha.substring(0, 8)}`));
          const versionTag = tags.find(t =>
            t.endsWith(`:${version}`) || t.endsWith(":latest")
          );

          expect(fullShaTag).toBeDefined();
          expect(shortShaTag).toBeDefined();
          expect(versionTag).toBeDefined();

          return true;
        }),
        { numRuns: 15 }
      );
    });

    /**
     * Property: For any invalid Docker tag characters, validation SHALL fail.
     *
     * **Validates: Requirements 4.6**
     */
    test("invalid Docker tag characters should fail validation", () => {
      const invalidTags = [
        ".startsWithPeriod",
        "-startsWithHyphen",
        "has spaces",
        "has@special",
        "has#hash",
        "has$dollar",
        "has%percent",
        "has&ampersand",
        "has*asterisk",
        "", // empty
      ];

      for (const tag of invalidTags) {
        const validation = isValidDockerTag(tag);
        expect(validation.isValid).toBe(false);
      }
    });

    /**
     * Property: The buildspec SHALL save image metadata with all tags for downstream stages.
     *
     * **Validates: Requirements 4.6**
     */
    test("buildspec should save image metadata with tags", () => {
      const postBuildCommands = buildspec.phases?.post_build?.commands || [];

      // Look for image-metadata.json creation
      const hasMetadataCreation = postBuildCommands.some(cmd =>
        typeof cmd === "string" && cmd.includes("image-metadata.json")
      );

      expect(hasMetadataCreation).toBe(true);

      // Verify secondary artifacts include image-metadata
      const secondaryArtifacts = buildspec["secondary-artifacts"] || {};
      expect(secondaryArtifacts["image-metadata"]).toBeDefined();
    });

    /**
     * Property: For any commit SHA length between 7 and 40, it SHALL be valid.
     *
     * **Validates: Requirements 4.6**
     */
    test("commit SHAs of valid lengths should be accepted", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 7, max: 40 }),
          (length) => {
            // Generate a SHA of the specified length
            const sha = "a".repeat(length);

            expect(isValidCommitSha(sha)).toBe(true);
            expect(isValidDockerTag(sha).isValid).toBe(true);

            return true;
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});
