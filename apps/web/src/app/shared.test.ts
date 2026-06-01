import { describe, expect, it } from "vitest";
import { isNavigationItemActive } from "./shared.js";

describe("navigation active state", () => {
  it("does not mark Settings active for plugin pages", () => {
    expect(
      isNavigationItemActive("settings", {
        type: "plugin",
        pluginId: "app.dibao.daily-brief",
        route: "daily-brief"
      })
    ).toBe(false);
  });

  it("keeps algorithm pages grouped under Settings", () => {
    expect(isNavigationItemActive("settings", { type: "algorithm-transparency" })).toBe(true);
    expect(isNavigationItemActive("settings", { type: "algorithm-clusters" })).toBe(true);
  });
});
