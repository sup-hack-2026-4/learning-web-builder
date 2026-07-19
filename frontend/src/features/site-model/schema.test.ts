import { describe, expect, it } from "vitest";
import { createSampleSite } from "./sample";
import { siteModelSchema } from "./schema";

describe("siteModelSchema", () => {
  it("サンプルサイトを正常に検証できる", () => {
    expect(() => siteModelSchema.parse(createSampleSite())).not.toThrow();
  });

  it("不正なカラーコードを拒否する", () => {
    const site = createSampleSite();
    site.theme.primary = "blue";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("セクションが2件未満だと拒否する", () => {
    const site = createSampleSite();
    site.sections = site.sections.slice(0, 1);
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("セクションが8件を超えると拒否する", () => {
    const site = createSampleSite();
    const extra = site.sections[0];
    site.sections = Array.from({ length: 9 }, (_, index) => ({ ...extra, id: `${extra.id}-${index}` }));
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("不明なsection.kindを拒否する", () => {
    const site = createSampleSite();
    // @ts-expect-error 意図的に不正な値を渡す
    site.sections[0].kind = "unknown";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("上限を超えるtitleを拒否する", () => {
    const site = createSampleSite();
    site.sections[0].title = "あ".repeat(81);
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("空のtopicを拒否する", () => {
    const site = createSampleSite();
    site.topic = "";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });
});
