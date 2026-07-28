import { describe, expect, it } from "vitest";
import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import { createSampleSite } from "../site-model/sample";
import { explanationDictionary } from "./dictionary";

const SELECTABLE_KEYS = ["site-header", "hero", "about", "features", "contact", "site-footer"];

describe("explanationDictionary", () => {
  it("選択可能な要素すべてに解説が定義されている", () => {
    for (const key of SELECTABLE_KEYS) {
      expect(explanationDictionary[key]).toBeDefined();
    }
  });

  it("about/features/contactが使い回しでなく、それぞれ異なる解説を持つ", () => {
    const contents = SELECTABLE_KEYS.map((key) => JSON.stringify(explanationDictionary[key]));
    expect(new Set(contents).size).toBe(SELECTABLE_KEYS.length);
  });

  it("contactの解説文が主張する内容(画像プレースホルダー無し)が、実際の生成コードと一致する", () => {
    // 解説文自体にこの主張が書かれていなければ、以降の実装との突き合わせ自体が無意味になる
    expect(explanationDictionary.contact.html).toContain("画像プレースホルダーを出力していません");

    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);
    const contactSectionMatch = artifacts.html.match(
      /<section class="section section-contact"[\s\S]*?<\/section>/,
    );
    expect(contactSectionMatch).not.toBeNull();
    expect(contactSectionMatch?.[0]).not.toContain("image-placeholder");
  });

  it("aboutの解説文が主張する内容(画像プレースホルダーあり)が、実際の生成コードと一致する", () => {
    expect(explanationDictionary.about.html).toContain("画像の代わりのプレースホルダー");

    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);
    const aboutSectionMatch = artifacts.html.match(/<section class="section section-about"[\s\S]*?<\/section>/);
    expect(aboutSectionMatch).not.toBeNull();
    expect(aboutSectionMatch?.[0]).toContain("image-placeholder");
  });

  it("featuresの解説文が主張する内容(背景色が白)が、実際の生成コードと一致する", () => {
    expect(explanationDictionary.features.css).toContain("背景色を白(#fff)");

    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);
    expect(artifacts.css).toContain(".section-features { background: #fff; }");
  });
});
