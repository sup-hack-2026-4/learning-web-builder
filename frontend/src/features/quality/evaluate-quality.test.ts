import { describe, expect, it } from "vitest";
import { createSampleSite } from "../site-model/sample";
import { evaluateQuality } from "./evaluate-quality";

describe("evaluateQuality", () => {
  it("空のaltを失敗として報告する", () => {
    const result = evaluateQuality(createSampleSite());
    expect(result.find((item) => item.id === "alt")?.passed).toBe(false);
  });

  it("altを補うと成功になる", () => {
    const site = createSampleSite();
    site.sections = site.sections.map((section) => ({ ...section, imageAlt: section.imageAlt || "内容を説明する画像" }));
    const result = evaluateQuality(site);
    expect(result.every((item) => item.passed)).toBe(true);
  });
});

