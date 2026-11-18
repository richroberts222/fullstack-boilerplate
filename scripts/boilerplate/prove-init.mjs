#!/usr/bin/env node
// Repeatable functional proof of the template: copies this repository to a temp directory, initializes
// it as an example app, then (with --full) installs from the rewritten lockfile and runs the generated
// app's own validation plus an offline migration generation. The example app takes every add-on
// (`addons/`), so the proof covers each one; an app without add-ons is the template itself, which
// `pnpm validate` proves. Needs network only for `pnpm install`.
// Creates no external resources and touches no database.
//
//   pnpm prove:init            # copy + init + leak check (seconds, offline)
//   pnpm prove:init --full     # also install, lint, typecheck, test, build, db:generate
//   pnpm prove:init --full --keep   # keep the directory and print its path
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkBoilerplate } from "./check-boilerplate.mjs";
import { initApp } from "./init-app.mjs";
import { isLocalEnvFile, listSourceFiles, untrackedSourceFiles } from "./manifest.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const identity = { name: "Harbor Notes", slug: "harbor-notes", scope: "harbor", bundleId: "com.harbornotes.app" };
const full = process.argv.includes("--full");
const keep = process.argv.includes("--keep");

const untracked = untrackedSourceFiles(repo);
if (untracked.length > 0) {
  console.error(`prove:init copies the files git tracks, so these new files would be missing from the proof. Stage them first (git add):\n  ${untracked.join("\n  ")}`);
  process.exit(1);
}

const root = mkdtempSync(path.join(tmpdir(), "harbor-notes-"));
for (const file of listSourceFiles(repo)) {
  if (isLocalEnvFile(path.posix.basename(file))) continue; // never copy local secrets into the temp copy
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  cpSync(path.join(repo, file), path.join(root, file));
}
// Remove the temp copy on every exit path (including a failed step), unless --keep.
if (!keep) process.on("exit", () => rmSync(root, { recursive: true, force: true }));
console.log(`== copied template to ${root}`);

initApp({ root, ...identity, addons: "all" });
if (checkBoilerplate(root).length > 0) throw new Error("leak check not clean");

function run(label, command, args, extraEnv = {}, cwd = root) {
  console.log(`\n== ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, CI: "1", ...extraEnv } });
  if (result.status !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
}

if (full) {
  run("install from rewritten lockfile", "pnpm", ["install", "--frozen-lockfile"]);
  run("lint", "pnpm", ["lint"]);
  run("typecheck", "pnpm", ["typecheck"]);
  run("unit tests", "pnpm", ["test:run"]);
  run("build", "pnpm", ["build"]);

  // First migration for the new app, generated offline from a throwaway table.
  const schema = path.join(root, "apps/web/db/schema.ts");
  const original = readFileSync(schema, "utf8");
  writeFileSync(
    schema,
    `import { pgTable, text, uuid } from "drizzle-orm/pg-core";\nexport const note = pgTable("note", { id: uuid("id").primaryKey().defaultRandom(), ownerId: text("owner_id").notNull() });\n`,
  );
  // Generation is offline: it needs the variables to exist, not a reachable database.
  run("db:generate (offline, first migration)", "pnpm", ["--filter", "web", "db:generate"], {
    DATABASE_ENV: "dev",
    DATABASE_URL: "postgresql://localhost/offline_generate_only",
  });
  const migrations = path.join(root, "apps/web/drizzle");
  if (!existsSync(path.join(migrations, "meta/_journal.json"))) throw new Error("no journal generated");
  console.log(`generated: ${readFileSync(path.join(migrations, "meta/_journal.json"), "utf8").match(/"tag": "[^"]+"/)?.[0]}`);
  writeFileSync(schema, original);
  rmSync(migrations, { recursive: true, force: true });
  run("unit tests again with empty migrations", "pnpm", ["--filter", "web", "test"]);
}

console.log(`\nPROOF OK (${full ? "full" : "init + leak check"})`);
if (keep) console.log(`kept: ${root}`);
