// Self-test for the template tooling (node:test, no dependencies): `pnpm test:boilerplate`, part of
// `pnpm validate`. Copies the repository to a temp directory, runs the real init with an example
// identity, and checks the leak detector both ways.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkBoilerplate } from "./check-boilerplate.mjs";
import { applyIdentity, initApp, stripMarkedRegions, validateIdentity } from "./init-app.mjs";
import { listSourceFiles, untrackedSourceFiles } from "./manifest.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const identity = { name: "Harbor Notes", slug: "harbor-notes", scope: "harbor", bundleId: "com.harbornotes.app" };
const temps = [];

function copyTemplate() {
  const dir = mkdtempSync(path.join(tmpdir(), "boilerplate-"));
  temps.push(dir);
  for (const file of listSourceFiles(repo)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(dir, file));
  }
  return dir;
}
const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");

after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

// The proof copies only the files git tracks. A new file that was never staged would be missing from the generated
// app and fail it in a confusing way, so the proof refuses to run until such files are staged.
describe("untracked source files", () => {
  const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

  it("lists new files that are neither tracked nor ignored, and ignores the owner's .claude folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "untracked-"));
    temps.push(dir);
    git(dir, "init", "-q");
    writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(dir, "tracked.txt"), "a");
    git(dir, "add", ".gitignore", "tracked.txt");
    writeFileSync(path.join(dir, "new-file.ts"), "b");
    writeFileSync(path.join(dir, "ignored.txt"), "c");
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(path.join(dir, ".claude", "settings.local.json"), "{}");
    assert.deepEqual(untrackedSourceFiles(dir), ["new-file.ts"]);
    git(dir, "add", "new-file.ts");
    assert.deepEqual(untrackedSourceFiles(dir), []);
  });

  it("returns nothing outside a git checkout instead of failing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "no-git-"));
    temps.push(dir);
    writeFileSync(path.join(dir, "file.txt"), "x");
    assert.deepEqual(untrackedSourceFiles(dir), []);
  });
});

describe("template tooling", () => {
  it("the detector flags the unmodified template (negative control)", () => {
    const rules = new Set(checkBoilerplate(repo).map((f) => f.rule));
    for (const rule of ["identity", "template-only", "placeholder-id"]) assert.ok(rules.has(rule), `expected a ${rule} finding`);
  });

  it("the template itself carries no reference application's name and no secret", () => {
    const leaks = checkBoilerplate(repo).filter((f) => f.rule === "reference-app" || f.rule === "secret");
    assert.deepEqual(leaks, []);
  });

  it("init produces a clean, generic application and refuses to run twice", () => {
    const root = copyTemplate();
    initApp({ root, ...identity, log: () => {} });

    assert.deepEqual(checkBoilerplate(root), []);
    assert.equal(JSON.parse(read(root, "package.json")).name, "harbor-notes");
    assert.equal(JSON.parse(read(root, "packages/shared/package.json")).name, "@harbor/shared");
    assert.match(read(root, "apps/mobile/app.config.ts"), /bundleIdentifier: "com\.harbornotes\.app"/);
    assert.match(read(root, "apps/mobile/app.config.ts"), /package: "com\.harbornotes\.app"/);
    assert.match(read(root, "pnpm-lock.yaml"), /'@harbor\/shared'/);
    assert.match(read(root, "apps/web/db/tooling/seed.ts"), /harbor_notes_tooling/);
    assert.ok(!existsSync(path.join(root, "scripts/boilerplate")));
    assert.ok(!existsSync(path.join(root, "docs/boilerplate.md")));
    for (const kept of ["apps/web/db/tooling/guard.ts", "apps/web/lib/api/handler.ts", "apps/web/playwright.config.ts", "docs/issues.md", "docs/new-app-setup.md", ".github/workflows/ci.yml", "CLAUDE.md"]) {
      assert.ok(existsSync(path.join(root, kept)), `${kept} should remain`);
    }
    const pkg = read(root, "package.json");
    assert.ok(!/test:boilerplate|init:app|prove:init|check:boilerplate/.test(pkg));
    assert.ok(!/Template proof|prove:init/.test(read(root, ".github/workflows/ci.yml")), "the template-proof CI job is removed");
    assert.match(read(root, ".github/workflows/ci.yml"), /pnpm validate/);
    assert.ok(!/Template repository/.test(read(root, "README.md")), "template-only README text is removed");

    assert.throws(() => initApp({ root, ...identity, log: () => {} }), /already initialized/);
  });

  it("renames every form of the template identity", () => {
    const out = applyIdentity("App Boilerplate. APP BOILERPLATE. app-boilerplate. @app-boilerplate/shared. app_boilerplate_tooling. com.example.appboilerplate. richroberts222/fullstack-boilerplate", identity);
    assert.equal(out, "Harbor Notes. HARBOR NOTES. harbor-notes. @harbor/shared. harbor_notes_tooling. com.harbornotes.app. richroberts222/harbor-notes");
  });

  it("rejects identities that would leak the template, a reference application, or a placeholder", () => {
    assert.deepEqual(validateIdentity(identity), []);
    for (const bad of [{ name: "App Boilerplate" }, { name: "Signal One Clone" }, { slug: "ministry-software" }, { bundleId: "com.example.app" }, { bundleId: "notabundleid" }]) {
      assert.ok(validateIdentity({ ...identity, ...bad }).length > 0, JSON.stringify(bad));
    }
  });

  it("the detector catches a credential-shaped URL and a reference-app name added after init, and ignores local env files", () => {
    const root = copyTemplate();
    initApp({ root, ...identity, log: () => {} });
    const fake = ["post", "gres://someone:hunter2@db.invalid/app"].join("");
    writeFileSync(path.join(root, "apps/web/leak.ts"), `export const x = "${fake}";\n`);
    writeFileSync(path.join(root, "docs/leak.md"), ["Copied from Signal", " One Sound.\n"].join(""));
    writeFileSync(path.join(root, "apps/web/.env.local"), `DATABASE_URL=${fake}\n`);
    assert.deepEqual(checkBoilerplate(root).map((f) => `${f.rule}:${f.file}`).sort(), ["reference-app:docs/leak.md", "secret:apps/web/leak.ts"]);
  });

  it("copies only committed files: untracked files and local env files stay behind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "boilerplate-git-"));
    temps.push(dir);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(path.join(dir, "tracked.txt"), "kept");
    git("add", "tracked.txt");
    writeFileSync(path.join(dir, "untracked.txt"), "scratch");
    writeFileSync(path.join(dir, ".env.local"), "SECRET=x");
    assert.deepEqual(listSourceFiles(dir), ["tracked.txt"]);
    const plain = mkdtempSync(path.join(tmpdir(), "boilerplate-plain-"));
    temps.push(plain);
    writeFileSync(path.join(plain, "a.txt"), "a");
    assert.deepEqual(listSourceFiles(plain), ["a.txt"]);
  });

  it("region stripping handles block and inline markers", () => {
    const text = "a\n\n<!-- boilerplate:template:start -->\n## P\nx\n<!-- boilerplate:template:end -->\n\n## Keep\nline.<!-- boilerplate:template:start --> gone<!-- boilerplate:template:end -->\n";
    assert.equal(stripMarkedRegions(text), "a\n\n## Keep\nline.\n");
  });
});
