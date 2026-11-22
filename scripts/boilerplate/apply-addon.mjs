#!/usr/bin/env node
// Adds one or more add-ons to an application that already exists (made from this template, with or without
// add-ons). Run it from a copy of this template, pointing at the application:
//
//   node scripts/boilerplate/apply-addon.mjs --dir=<path to the application> --with=legal,payments [--dry-run] [--name="App Name"]
//   pnpm addon:apply --dir=<path> --with=<add-on>[,<add-on>]
//
// It reads the add-ons from THIS copy (an initialized application has no `addons/` folder), gives their text the
// application's own identity (package scope and slug, read from the application), then copies the overlay files
// and applies the inserts at the marker lines, exactly as init does. It never overwrites: if any file would be
// replaced, a target file is missing, or a marker line is missing or repeated, it lists every one of them and
// changes nothing. An add-on that is already there (all its files exist) is refused, and an add-on that needs
// another is allowed when the other is already in the application.
// After it runs: pnpm install is not needed (no new dependencies); generate the migration with
// `pnpm --filter web db:generate`, then run `pnpm validate`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ADDONS_DIR, applyAddons, checkAddons, readAddon, resolveAddons } from "./addons.mjs";
import { TEMPLATE_IDENTITY, applyIdentity, parseArgs, stripMarkedRegions } from "./init-app.mjs";
import { walk } from "./manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The application's own identity, read from its files (never guessed). */
export function readIdentity(appRoot, displayName) {
  const rootPkg = path.join(appRoot, "package.json");
  const validationPkg = path.join(appRoot, "packages/validation/package.json");
  if (!existsSync(rootPkg) || !existsSync(validationPkg)) throw new Error(`${appRoot} does not look like an application made from this template (package.json or packages/validation/package.json is missing).`);
  const slug = JSON.parse(readFileSync(rootPkg, "utf8")).name;
  const scope = /^@([^/]+)\/validation$/.exec(JSON.parse(readFileSync(validationPkg, "utf8")).name)?.[1];
  if (typeof slug !== "string" || !scope) throw new Error("Could not read the application's name and package scope from its package.json files.");
  const name = displayName ?? slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { name, slug, scope, bundleId: TEMPLATE_IDENTITY.bundleId };
}

/** An add-on counts as already in the application when it has files and every one of them exists there. */
function isApplied(appRoot, templateRoot, spec) {
  const filesDir = path.join(templateRoot, ADDONS_DIR, spec.name, "files");
  const files = existsSync(filesDir) ? walk(filesDir) : [];
  return files.length > 0 && files.every((rel) => existsSync(path.join(appRoot, rel)));
}

/** Every add-on the asked ones need, the asked ones included. */
function closure(templateRoot, asked) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const r of readAddon(templateRoot, name).requires) visit(r);
  };
  asked.forEach(visit);
  return [...seen];
}

export function applyToExistingApp({ templateRoot, appRoot, names, displayName, dryRun = false, log = console.log }) {
  if (existsSync(path.join(appRoot, "scripts/boilerplate/init-app.mjs"))) {
    throw new Error("This is still an uninitialized template copy: use `pnpm init:app ... --with=<add-on>` instead.");
  }
  const asked = names.split(",").map((s) => s.trim()).filter(Boolean);
  if (asked.length === 0) throw new Error("--with=<add-on>[,<add-on>] is required.");
  const identity = readIdentity(appRoot, displayName);
  const all = closure(templateRoot, asked);
  const specs = resolveAddons(templateRoot, all.join(","));
  const applied = new Set(specs.filter((s) => isApplied(appRoot, templateRoot, s)).map((s) => s.name));
  for (const a of asked) if (applied.has(a)) throw new Error(`Add-on ${a} is already in this application (all of its files exist).`);
  const chosen = specs.filter((s) => !applied.has(s.name));
  const notAsked = chosen.filter((s) => !asked.includes(s.name));
  if (notAsked.length > 0) throw new Error(`Add-on ${asked.join(", ")} needs ${notAsked.map((s) => s.name).join(", ")}, which is not in this application yet: add it to --with.`);

  // Stage the chosen add-ons with the application's identity, so the real files are never touched until every check passes.
  const stage = mkdtempSync(path.join(tmpdir(), "addon-apply-"));
  try {
    for (const spec of chosen) {
      const from = path.join(templateRoot, ADDONS_DIR, spec.name);
      const to = path.join(stage, ADDONS_DIR, spec.name);
      for (const rel of walk(from)) {
        const buf = readFileSync(path.join(from, rel));
        mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
        if (buf.includes(0) || rel === "addon.json") {
          cpSync(path.join(from, rel), path.join(to, rel));
          continue;
        }
        const text = buf.toString("utf8");
        writeFileSync(path.join(to, rel), applyIdentity(rel.endsWith(".md") ? stripMarkedRegions(text) : text, identity));
      }
      const staged = JSON.parse(readFileSync(path.join(to, "addon.json"), "utf8"));
      staged.inserts = (staged.inserts ?? []).map((i) => ({ ...i, text: applyIdentity(i.text, identity) }));
      writeFileSync(path.join(to, "addon.json"), JSON.stringify(staged, null, 2));
    }
    const stagedSpecs = chosen.map((s) => readAddon(stage, s.name));
    const problems = checkAddons(appRoot, stagedSpecs, { addonsRoot: stage });
    if (problems.length > 0) throw new Error(`Nothing was changed. ${problems.length} problem(s) stop these add-ons from being applied:\n- ${problems.join("\n- ")}`);
    log(`add-ons: ${chosen.map((s) => s.name).join(", ")}${applied.size > 0 ? ` (already there: ${[...applied].join(", ")})` : ""}`);
    return applyAddons(appRoot, stagedSpecs, { dryRun, log, addonsRoot: stage });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templateRoot = path.resolve(here, "../..");
  if (!args.dir || !args.with) {
    console.error('Usage: node scripts/boilerplate/apply-addon.mjs --dir=<application> --with=<add-on>[,<add-on>] [--dry-run] [--name="App Name"]');
    process.exit(1);
  }
  try {
    applyToExistingApp({ templateRoot, appRoot: path.resolve(args.dir), names: args.with, displayName: args.name, dryRun: Boolean(args.dryRun) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (!args.dryRun) console.log("\nNext: pnpm --filter web db:generate (a migration for the new tables), then pnpm validate. See each add-on's docs/features/<name>.md for the settings it needs.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
