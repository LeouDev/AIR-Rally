import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  /**
   * Agent worktrees under .claude/ are full copies of the repo, so Jest was
   * collecting every test file twice — 86 duplicates producing ~190 extra
   * failures against whatever stale code that worktree happened to hold.
   *
   * The danger was never the noise itself: a suite that is expected to fail
   * is a suite where a real regression goes unnoticed. Ignoring the path
   * makes a red run mean something again.
   */
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/", "<rootDir>/.claude/"],
  modulePathIgnorePatterns: ["<rootDir>/.claude/worktrees/"],
};

export default createJestConfig(config);
