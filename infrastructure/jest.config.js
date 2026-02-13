/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'tests/**/*.ts',
    '!tests/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 300000 // 5 minutes for property-based tests that invoke external tools
};
