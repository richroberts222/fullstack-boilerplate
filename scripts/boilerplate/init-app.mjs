#!/usr/bin/env node
// Turns a fresh copy of this template into a new application: replaces the template identity in every
// text file (including pnpm-lock.yaml), strips template-only doc regions, resets the handoff notes,
// removes template-only files, then runs the leak check. Plain Node, no dependencies, no network.
//
//   node scripts/boilerplate/init-app.mjs --name="Harbor Notes" --slug=harbor-notes \
//        --bundle-id=com.harbornotes.app [--scope=harbor-notes] [--dir=<path>] [--dry-run]
//
// Run it once, in a fresh copy. It refuses to run twice. See /docs/boilerplate.md.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkBoilerplate, formatFindings } from "./check-boilerplate.mjs";
import { PROOF_PATHS, REFERENCE_APP_NAMES, TEMPLATE_ONLY_PATHS, isLocalEnvFile, walk } from "./manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--") && arg.includes("=")) {
      const i = arg.indexOf("=");
      out[arg.slice(2, i).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = arg.slice(i + 1);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

/** @returns {string[]} problems; empty means valid. */
export function validateIdentity({ name, slug, scope, bundleId }) {
  const problems = [];
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9 .-]{0,38}[A-Za-z0-9]$/.test(name)) {
    problems.push("--name: 2-40 letters, digits, spaces, '.' or '-' (display name).");
  }
  if (!slug || !/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/.test(slug)) {
    problems.push("--slug: lowercase letters, digits, '-' (repository / Expo slug / URL scheme).");
  }
  if (!scope || !/^[a-z][a-z0-9-]{0,38}$/.test(scope)) problems.push("--scope: npm package scope without '@', lowercase.");
  if (!bundleId || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(bundleId)) {
    problems.push("--bundle-id: reverse-DNS identifier valid for iOS and Android, e.g. com.yourco.app (lowercase, 2+ segments).");
  }
  for (const [k, v] of Object.entries({ name, slug, scope, bundleId })) {
    if (v && (/app[\s_-]?boilerplate/i.test(v) || REFERENCE_APP_NAMES.test(v))) problems.push(`--${k}: must not contain the template identity or a reference application's name.`);
  }
  if (bundleId && /^com\.example\./.test(bundleId)) problems.push("--bundle-id: com.example.* is a placeholder; choose your real identifier.");
  return problems;
}

/** The neutral identity this template ships with; init replaces it everywhere. */
export const TEMPLATE_IDENTITY = { name: "App Boilerplate", slug: "app-boilerplate", bundleId: "com.example.appboilerplate", repo: "fullstack-boilerplate" };

/** Applies the identity to text. Order matters: most specific tokens first. */
export function applyIdentity(text, { name, slug, scope, bundleId }, source = TEMPLATE_IDENTITY) {
  return text
    .replaceAll(`@${source.slug}/`, () => `@${scope}/`)
    .replaceAll(source.bundleId, () => bundleId)
    .replaceAll(`${source.slug.replace(/-/g, "_")}_`, () => `${slug.replace(/-/g, "_")}_`)
    .replaceAll(source.name.toUpperCase(), () => name.toUpperCase())
    .replaceAll(source.name, () => name)
    .replaceAll(source.slug, () => slug)
    .replaceAll(`/${source.repo}`, () => `/${slug}`);
}

/**
 * Removes `<!-- boilerplate:KIND:start -->...<!-- boilerplate:KIND:end -->` regions.
 * Markers alone on their own lines delimit whole sections (the blank line after
 * the end marker goes too); markers inside a line remove exactly the enclosed text.
 */
export function stripMarkedRegions(text, kinds = ["proof", "template"]) {
  const kind = `(${kinds.join("|")})`;
  return text
    .replace(new RegExp(`^<!-- boilerplate:${kind}:start -->\\r?\\n[\\s\\S]*?^<!-- boilerplate:\\1:end -->\\r?\\n(?:\\r?\\n)?`, "gm"), "")
    .replace(new RegExp(`<!-- boilerplate:${kind}:start -->[\\s\\S]*?<!-- boilerplate:\\1:end -->`, "g"), "");
}

const NOTES_STUB = `# Handoff notes

Optional. Holds only information that cannot be found in the code, the git history or the GitHub checks (\`/CLAUDE.md\` section 19).
Never include real or credential-shaped secrets here.
`;

export function initApp({ root, name, slug, scope = slug, bundleId, dryRun = false, log = console.log }) {
  const identity = { name, slug, scope, bundleId };
  const problems = validateIdentity(identity);
  if (problems.length > 0) throw new Error(`Invalid identity:\n${problems.join("\n")}`);
  if (!existsSync(path.join(root, "scripts/boilerplate/init-app.mjs"))) {
    throw new Error("scripts/boilerplate/init-app.mjs not found under --dir: already initialized, or not a template copy.");
  }
  const abs = (p) => path.join(root, p);
  const step = (message, fn) => {
    log(`${dryRun ? "[dry-run] would " : ""}${message}`);
    if (!dryRun) fn();
  };

  for (const p of PROOF_PATHS) if (existsSync(abs(p))) step(`remove example ${p}`, () => rmSync(abs(p), { recursive: true, force: true }));
  step("edit package.json", () => {
    const pkg = JSON.parse(readFileSync(abs("package.json"), "utf8"));
    for (const k of ["init:app", "check:boilerplate", "test:boilerplate", "prove:init"]) delete pkg.scripts[k];
    pkg.scripts.validate = pkg.scripts.validate.replace(" && pnpm test:boilerplate", "");
    writeFileSync(abs("package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  });
  step("remove the template-proof CI job", () => {
    const ci = abs(".github/workflows/ci.yml");
    if (existsSync(ci)) writeFileSync(ci, readFileSync(ci, "utf8").replace(/\r?\n[ \t]*# boilerplate:template:start[\s\S]*?# boilerplate:template:end\r?\n/, "\n"));
  });
  step("reset docs/notes.md", () => writeFileSync(abs("docs/notes.md"), NOTES_STUB));

  const files = walk(root).filter((f) => !f.startsWith("scripts/boilerplate/") && !isLocalEnvFile(path.posix.basename(f)));
  let changed = 0;
  for (const file of files) {
    const buf = readFileSync(abs(file));
    if (buf.includes(0)) continue; // binary
    const before = buf.toString("utf8");
    const after = applyIdentity(file.endsWith(".md") ? stripMarkedRegions(before) : before, identity);
    if (after === before) continue;
    changed += 1;
    if (!dryRun) writeFileSync(abs(file), after);
  }
  log(`${dryRun ? "[dry-run] would rewrite" : "rewrote"} ${changed} file(s) with the new identity / doc regions`);

  for (const p of TEMPLATE_ONLY_PATHS) if (existsSync(abs(p))) step(`remove template-only ${p}`, () => rmSync(abs(p), { recursive: true, force: true }));

  if (dryRun) return [];
  const findings = checkBoilerplate(root);
  if (findings.length > 0) {
    throw new Error(`Initialized, but the leak check found problems:\n${formatFindings(findings).join("\n")}`);
  }
  log("leak check: clean");
  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.dir ?? path.join(here, "../.."));
  const { name, slug, bundleId } = args;
  try {
    initApp({ root, name, slug, scope: args.scope ?? slug, bundleId, dryRun: Boolean(args.dryRun) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (!args.dryRun) {
    console.log(`
Next (see docs/new-app-setup.md for the steps that need a human):
  1. corepack enable && pnpm install
  2. pnpm validate
  3. Create the Clerk, Neon, and Vercel projects, then fill apps/web/.env.local (never commit it).
  4. Put the specs in docs/specs/, then design the first schema and run pnpm --filter web db:generate.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
