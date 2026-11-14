import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard: a component that attaches event handlers (onClick, onMouseEnter, ...)
// must be a Client Component. Rendered from a Server Component page without "use client",
// it typechecks and builds but throws when the page is requested.
// Covers every component folder automatically, so a new feature folder is checked without
// anyone remembering to list it. components/ui is skipped: shadcn primitives take their handlers from the caller.
const FEATURE_DIRS = readdirSync(__dirname).filter(
  (name) => name !== "ui" && statSync(join(__dirname, name)).isDirectory(),
);

describe("feature components server/client boundary", () => {
  it("checks at least one component folder", () => {
    expect(FEATURE_DIRS.length).toBeGreaterThan(0);
  });

  it.each(FEATURE_DIRS)("files in components/%s with event handlers declare use client", (dir) => {
    const path = join(__dirname, dir);
    const files = readdirSync(path).filter((f) => f.endsWith(".tsx"));
    const offenders = files.filter((f) => {
      const src = readFileSync(join(path, f), "utf8");
      return /\son[A-Z][A-Za-z]*=\{/.test(src) && !/^\s*["']use client["']/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
