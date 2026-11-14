// Shared inventory for the boilerplate tooling (see /docs/boilerplate.md).
// Plain Node, no dependencies. init-app.mjs and check-boilerplate.mjs both read this file so they can
// never disagree about what belongs only to the template.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Example or proof code that init removes. Empty: this template ships no product or demo code. If a
 * reusable example is ever added, list its paths here so a new application starts without it.
 */
export const PROOF_PATHS = [];

/** Files that only make sense in the template repository; init removes them. */
export const TEMPLATE_ONLY_PATHS = ["docs/boilerplate.md", "scripts/boilerplate"];

/**
 * Applications the foundation was built from or for. Their names must never appear in the template or in
 * a generated application (a leak means product text travelled; /docs/lessons.md, 2026-11-04).
 */
export const REFERENCE_APP_NAMES = /signal[\s_-]?one|ministry[\s_-]?software|certified[\s_-]?candidate|heavenly[\s_-]?training/i;

/** Directories never scanned or copied. */
export const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".expo", "dist", ".turbo", "playwright-report", "test-results"]);

/** Never scanned: these hold local, gitignored configuration by design. */
export const isLocalEnvFile = (name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example" && name !== ".env.sample";

const posix = (p) => p.split(path.sep).join("/");

/** All files under `root` as posix paths relative to it. */
export function walk(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(root, full) : [posix(path.relative(root, full))];
  });
}

/**
 * New files that git does not track yet (and does not ignore), other than the owner's local `.claude/` folder.
 * The proof copies only tracked files, so an unstaged new file would silently be missing from the generated app
 * and fail it in a confusing way; the proof refuses to run until they are staged. Empty outside a git checkout.
 */
export function untrackedSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) return [];
  return result.stdout.split("\0").filter((f) => f && !f.startsWith(".claude/"));
}

/**
 * Files to copy when building a test copy: only what git tracks, so untracked scratch files and local
 * settings can never travel. Falls back to a folder walk when `root` is not a git checkout.
 */
export function listSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) return walk(root);
  return result.stdout.split("\0").filter((f) => f && existsSync(path.join(root, f)));
}
