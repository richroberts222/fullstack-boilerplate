import { describe, expect, it } from "vitest";

import { safeNextPath } from "./legal-gate";

describe("legal gate: where the accept page goes next", () => {
  it("follows a path on this site", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/settings?x=1")).toBe("/settings?x=1");
  });

  it("refuses anything that could leave the site, and defaults to the dashboard", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "dashboard", "", undefined]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});
