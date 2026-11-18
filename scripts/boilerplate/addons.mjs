// Optional add-ons (owner decision, 2026-11-18; see /docs/boilerplate.md "Add-ons"). The template stays
// domain-free; an add-on is a reviewed, reusable piece (for example payments) that a new application
// takes only when it asks for it: `pnpm init:app ... --with=<name>[,<name>]` or `--with=all`.
//
// An add-on is a folder `addons/<name>/` with:
//   addon.json   { "name": "<name>", "description": "...", "requires": ["<other add-on>"],
//                  "inserts": [{ "file": "<path>", "marker": "<exact line text>", "text": "<lines to add>" }] }
//   files/       an overlay: every file is copied to the same path in the new application. An overlay
//                file may only create a new file; changing a base file is done with an insert after a
//                marker line the base file carries on purpose, so an add-on can never silently replace
//                foundation code.
// Plain Node, no dependencies.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";

import { walk } from "./manifest.mjs";

export const ADDONS_DIR = "addons";
const NAME = /^[a-z][a-z0-9-]{1,30}$/;

/** The add-ons this copy offers, sorted by name. */
export function listAddons(root) {
  const dir = path.join(root, ADDONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isDirectory() && existsSync(path.join(dir, n, "addon.json")))
    .sort();
}

/** Reads and checks one add-on's description. Throws with a plain message on anything malformed. */
export function readAddon(root, name) {
  const file = path.join(root, ADDONS_DIR, name, "addon.json");
  if (!NAME.test(name) || !existsSync(file)) throw new Error(`Unknown add-on: ${name}. Available: ${listAddons(root).join(", ") || "none"}.`);
  const spec = JSON.parse(readFileSync(file, "utf8"));
  if (spec.name !== name) throw new Error(`addons/${name}/addon.json: "name" must be "${name}".`);
  if (typeof spec.description !== "string" || spec.description.trim() === "") throw new Error(`addons/${name}/addon.json: "description" is required.`);
  const requires = spec.requires ?? [];
  const inserts = spec.inserts ?? [];
  if (!Array.isArray(requires) || requires.some((r) => typeof r !== "string")) throw new Error(`addons/${name}/addon.json: "requires" must be a list of add-on names.`);
  if (!Array.isArray(inserts) || inserts.some((i) => typeof i?.file !== "string" || typeof i?.marker !== "string" || typeof i?.text !== "string" || i.marker.trim() === "")) {
    throw new Error(`addons/${name}/addon.json: each insert needs "file", "marker" and "text".`);
  }
  return { name, description: spec.description, requires, inserts };
}

/**
 * Which add-ons `--with` asks for, in an order where each comes after what it requires. "all" means every
 * add-on; an empty value means none.
 */
export function resolveAddons(root, withArg) {
  if (withArg === undefined || withArg.trim() === "") return [];
  const asked = withArg.trim() === "all" ? listAddons(root) : withArg.split(",").map((s) => s.trim()).filter(Boolean);
  const specs = new Map(asked.map((n) => [n, readAddon(root, n)]));
  for (const spec of specs.values()) {
    const missing = spec.requires.filter((r) => !specs.has(r));
    if (missing.length > 0) throw new Error(`Add-on ${spec.name} needs ${missing.join(", ")}: add it to --with.`);
  }
  const ordered = [];
  const visit = (name, trail = []) => {
    if (ordered.includes(name)) return;
    if (trail.includes(name)) throw new Error(`Add-ons require each other in a loop: ${[...trail, name].join(" -> ")}.`);
    for (const r of specs.get(name).requires) visit(r, [...trail, name]);
    ordered.push(name);
  };
  for (const name of specs.keys()) visit(name);
  return ordered.map((n) => specs.get(n));
}

/** Inserts `text` on the lines after the one marker line in `content`. */
export function insertAfterMarker(content, marker, text, where) {
  const lines = content.split(/\r?\n/);
  const hits = lines.flatMap((l, i) => (l.trim() === marker.trim() ? [i] : []));
  if (hits.length !== 1) throw new Error(`${where}: the marker line "${marker}" must appear exactly once (found ${hits.length}).`);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const added = text.replace(/\r?\n$/, "").split(/\r?\n/);
  lines.splice(hits[0] + 1, 0, ...added);
  return lines.join(eol);
}

/**
 * Copies each add-on's overlay into `root` and applies its inserts. Every check runs before anything is
 * written, so a refused add-on leaves the copy untouched.
 */
export function applyAddons(root, specs, { dryRun = false, log = console.log } = {}) {
  const copies = [];
  const edits = new Map();
  /** A file as it will be after the edits so far: an earlier edit, an add-on's new file, or the base file. */
  const current = (rel) => {
    if (edits.has(rel)) return edits.get(rel);
    const added = copies.find((c) => c.rel === rel);
    if (added) return readFileSync(added.from, "utf8");
    return existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), "utf8") : null;
  };
  for (const spec of specs) {
    const filesDir = path.join(root, ADDONS_DIR, spec.name, "files");
    const overlay = existsSync(filesDir) ? walk(filesDir) : [];
    for (const rel of overlay) {
      if (existsSync(path.join(root, rel)) || copies.some((c) => c.rel === rel)) throw new Error(`Add-on ${spec.name} would replace ${rel}; an add-on may only add files (use an insert after a marker to change a base file).`);
      copies.push({ rel, from: path.join(filesDir, rel), addon: spec.name });
    }
    for (const ins of spec.inserts) {
      const text = current(ins.file);
      if (text === null) throw new Error(`Add-on ${spec.name}: ${ins.file} does not exist.`);
      edits.set(ins.file, insertAfterMarker(text, ins.marker, ins.text, `Add-on ${spec.name}, ${ins.file}`));
    }
  }
  for (const c of copies) {
    log(`${dryRun ? "[dry-run] would add" : "add"} ${c.rel} (add-on ${c.addon})`);
    if (!dryRun) {
      mkdirSync(path.dirname(path.join(root, c.rel)), { recursive: true });
      cpSync(c.from, path.join(root, c.rel));
    }
  }
  for (const [rel, text] of edits) {
    log(`${dryRun ? "[dry-run] would edit" : "edit"} ${rel} (add-on insert)`);
    if (!dryRun) writeFileSync(path.join(root, rel), text);
  }
  return { added: copies.map((c) => c.rel), edited: [...edits.keys()] };
}
