import { describe, expect, it } from "vitest";
import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import { createSampleSite } from "../site-model/sample";
import type { SiteModel, SiteSection } from "../site-model/schema";
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

  // 生成CSSに折り返しの指定(overflow-wrap: anywhere)があるため、長い文字列は不合格にせず、説明で知らせる(#121)。
  it("空白を含まない長い文字列(URL等)は、折り返されることを説明して合格にする", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(41);
    const result = evaluateQuality(site);
    const mobile = result.find((item) => item.id === "mobile");
    expect(mobile?.passed).toBe(true);
    expect(mobile?.detail).toContain("途中で折り返す指定");
  });

  it("40文字ちょうどの連続文字列は、折り返しの説明を出さない境界値", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(40);
    const mobile = evaluateQuality(site).find((item) => item.id === "mobile");
    expect(mobile?.passed).toBe(true);
    expect(mobile?.detail).not.toContain("途中で折り返す指定");
  });

  it("非表示のセクションの長い文字列は判定に含めない", () => {
    const site = createSampleSite();
    site.sections[0].body = "a".repeat(41);
    site.sections[0].visible = false;
    const mobile = evaluateQuality(site).find((item) => item.id === "mobile");
    expect(mobile?.passed).toBe(true);
    expect(mobile?.detail).not.toContain("途中で折り返す指定");
  });

  it("スペースの無い長い日本語文は長い文字列として扱わない(文字単位で改行できるため)", () => {
    const site = createSampleSite();
    site.sections[0].body = "あ".repeat(60);
    const mobile = evaluateQuality(site).find((item) => item.id === "mobile");
    expect(mobile?.passed).toBe(true);
    expect(mobile?.detail).not.toContain("途中で折り返す指定");
  });
});

// 見出しの判定は、生成したHTMLのh1の数と一致していなければならない(#121)。
describe("evaluateQualityの見出し構造", () => {
  const heading = (site: SiteModel) => evaluateQuality(site).find((item) => item.id === "headings");
  const countH1 = (site: SiteModel) => buildSiteArtifacts(site).html.match(/<h1>/g)?.length ?? 0;
  const addHero = (site: SiteModel, id: string): SiteSection => {
    const section: SiteSection = { id, kind: "hero", title: "もう1つのヒーロー", body: "本文", imageAlt: "説明", visible: true };
    site.sections.push(section);
    return section;
  };

  it("サンプルサイトはh1が1つで合格する", () => {
    const site = createSampleSite();
    expect(countH1(site)).toBe(1);
    expect(heading(site)?.passed).toBe(true);
  });

  it("先頭のヒーローを削除して末尾にヒーローを追加すると、h1が2つになり不合格になる", () => {
    const site = createSampleSite();
    site.sections.shift();
    addHero(site, "hero-2");
    expect(countH1(site)).toBe(2);
    const result = heading(site);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain("h1が2つあります");
    expect(result?.detail).toContain("「私たちについて」「もう1つのヒーロー」");
    expect(result?.detail).toContain("表示中の先頭以外にあるヒーローを、非表示にするか削除してください");
  });

  it("先頭のヒーローを非表示にして末尾にヒーローを追加しても、h1が2つになり不合格になる", () => {
    const site = createSampleSite();
    site.sections[0].visible = false;
    addHero(site, "hero-2");
    expect(countH1(site)).toBe(2);
    expect(heading(site)?.passed).toBe(false);
  });

  it("ヒーローを2つ表示すると不合格になり、片方を非表示にすると合格に戻る", () => {
    const site = createSampleSite();
    const added = addHero(site, "hero-2");
    expect(countH1(site)).toBe(2);
    expect(heading(site)?.passed).toBe(false);

    added.visible = false;
    expect(countH1(site)).toBe(1);
    expect(heading(site)?.passed).toBe(true);
  });

  it("ヒーローが無くても、先頭がh1になりh2が続くので合格する", () => {
    const site = createSampleSite();
    site.sections.shift();
    expect(countH1(site)).toBe(1);
    expect(heading(site)?.passed).toBe(true);
  });

  it("ヒーローを先頭以外へ並べ替えると不合格になり、先頭へ戻すと合格に戻る", () => {
    const site = createSampleSite();
    const [hero, ...rest] = site.sections;
    site.sections = [...rest, hero];
    expect(countH1(site)).toBe(2);
    expect(heading(site)?.passed).toBe(false);

    site.sections = [hero, ...rest];
    expect(countH1(site)).toBe(1);
    expect(heading(site)?.passed).toBe(true);
  });

  it("表示中のセクションが1つだけなら不合格になる", () => {
    const site = createSampleSite();
    for (const section of site.sections.slice(1)) section.visible = false;
    expect(countH1(site)).toBe(1);
    const result = heading(site);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain("セクションが1つだけです");
  });

  it("表示中のセクションが無ければ不合格になる", () => {
    const site = createSampleSite();
    for (const section of site.sections) section.visible = false;
    expect(countH1(site)).toBe(0);
    const result = heading(site);
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain("表示中のセクションがありません");
  });
});

