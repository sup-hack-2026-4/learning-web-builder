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

  it("サンプルサイトはモバイル判定に合格する", () => {
    const result = evaluateQuality(createSampleSite());
    expect(result.find((item) => item.id === "mobile")?.passed).toBe(true);
  });

  it("空白を含まない長い文字列(URL等)があるとモバイル判定が失敗する", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(41);
    const result = evaluateQuality(site);
    const mobile = result.find((item) => item.id === "mobile");
    expect(mobile?.passed).toBe(false);
    expect(mobile?.detail).toContain("横に溢れる可能性があります");
  });

  it("40文字ちょうどの連続文字列は合格する境界値", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(40);
    const result = evaluateQuality(site);
    expect(result.find((item) => item.id === "mobile")?.passed).toBe(true);
  });

  it("非表示のセクションの長い文字列は判定に含めない", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(41);
    site.sections[0].visible = false;
    const result = evaluateQuality(site);
    expect(result.find((item) => item.id === "mobile")?.passed).toBe(true);
  });

  it("スペースの無い長い日本語文はモバイル判定を失敗させない(文字単位で改行できるため)", () => {
    const site = createSampleSite();
    site.sections[0].body = "あ".repeat(60);
    const result = evaluateQuality(site);
    expect(result.find((item) => item.id === "mobile")?.passed).toBe(true);
  });
});

