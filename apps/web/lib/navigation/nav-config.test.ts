import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavItemActive } from "./nav-config";

const item = (label: string) => NAV_ITEMS.find((i) => i.label === label)!;

describe("isNavItemActive", () => {
  it("matches Home only on exactly /", () => {
    expect(isNavItemActive(item("Home"), "/")).toBe(true);
    expect(isNavItemActive(item("Home"), "/dashboard")).toBe(false);
  });

  it("lists Dashboard for signed-in users only, active on nested routes but not look-alike paths", () => {
    expect(item("Dashboard").signedInOnly).toBe(true);
    expect(isNavItemActive(item("Dashboard"), "/dashboard")).toBe(true);
    expect(isNavItemActive(item("Dashboard"), "/dashboard/settings")).toBe(true);
    expect(isNavItemActive(item("Dashboard"), "/dashboards")).toBe(false);
  });
});
