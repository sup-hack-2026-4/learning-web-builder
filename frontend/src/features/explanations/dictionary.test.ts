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

  it("featuresの解説文が主張する内容(背景色に--surfaceを使う)が、実際の生成コードと一致する", () => {
    expect(explanationDictionary.features.css).toContain("背景色に--surfaceを指定");

    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);
    expect(artifacts.css).toContain(".section-features { background: var(--surface); }");
  });

  it("ヘッダー・フッターがテーマ変数を参照し、背景色や余白の変更が反映される", () => {
    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);

    // --surfaceは背景色からのみ派生させる。背景色を変えても境界が残る。
    expect(artifacts.css).toContain("--surface: color-mix(in srgb, var(--background)");
    // ヘッダーの余白がテーマの--spaceに追従する(以前は18px固定だった)。
    expect(artifacts.css).toContain(".site-header { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: calc(var(--space) * 0.9)");
    // ヘッダー・フッターとも背景に#fff等をハードコードしない。
    expect(artifacts.css).toContain("background: var(--surface); border-bottom: 1px solid var(--border);");
    expect(artifacts.css).toContain("footer { padding: calc(var(--space) * 1.4);");
  });

  it("提出物のCSSに編集用のスタイルが混ざらない", () => {
    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);

    // 提出物は生徒の成果物なので、選択中の枠やクリック用カーソルを残さない。
    expect(artifacts.css).not.toContain("cursor: pointer");
    expect(artifacts.css).not.toContain("outline:");
    // 編集画面のプレビューでは、クリックできることを示すために付ける。
    expect(artifacts.editorCss).toContain("cursor: pointer");
    expect(artifacts.editorCss).toContain(".section:focus, .section:hover");
    // 編集用CSSは提出物用CSSを含んだ上乗せ。テーマ変更はどちらにも反映される。
    expect(artifacts.editorCss).toContain(artifacts.css);
  });

  it("heroの解説文が主張する内容(背景がメインカラー)が、実際の生成コードと一致する", () => {
    expect(explanationDictionary.hero.css).toContain("背景にメインカラー");

    const site = createSampleSite();
    const artifacts = buildSiteArtifacts(site);
    // 色によって濁って見えるため、グラデーションは使わず単色にしている。
    expect(artifacts.css).toContain("background: var(--primary); }");
    expect(artifacts.css).not.toContain("linear-gradient");
  });

  it("テキストカラーの変更が本文とヘッダー・フッターに反映される", () => {
    const site = createSampleSite();
    const artifacts = buildSiteArtifacts({ ...site, theme: { ...site.theme, text: "#3b0764" } });

    expect(artifacts.css).toContain("--text: #3b0764;");
    // 本文はbodyのcolorから継承する。
    expect(artifacts.css).toContain("body { margin: 0; color: var(--text);");
    // ヘッダーは--textを直接、フッターは--text由来の--text-mutedを使う。
    expect(artifacts.css).toContain(".site-header { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: calc(var(--space) * 0.9) clamp(20px, 6vw, 80px); color: var(--text);");
    expect(artifacts.css).toContain("--text-muted: color-mix(in srgb, var(--text)");
  });

  it("テキストカラーを変えてもヘッダー・フッターの背景色は変わらない", () => {
    const site = createSampleSite();
    const extractSurface = (css: string) => css.match(/--surface: [^;]+;/)?.[0];
    const extractBorder = (css: string) => css.match(/--border: [^;]+;/)?.[0];

    const light = buildSiteArtifacts({ ...site, theme: { ...site.theme, text: "#172033" } });
    const dark = buildSiteArtifacts({ ...site, theme: { ...site.theme, text: "#f8fafc" } });

    // 面色・境界線は背景色からのみ作るため、文字色を変えても同一になる。
    expect(extractSurface(light.css)).toBe(extractSurface(dark.css));
    expect(extractBorder(light.css)).toBe(extractBorder(dark.css));
    expect(extractSurface(light.css)).not.toContain("var(--text)");
    expect(extractBorder(light.css)).not.toContain("var(--text)");
  });

  it("見出しの色をメインカラーから分離でき、未指定ならメインカラーを引き継ぐ", () => {
    const site = createSampleSite();

    // 未指定: h2はメインカラーと同じ色になる。
    const inherited = buildSiteArtifacts(site);
    expect(inherited.css).toContain(`--heading: ${site.theme.primary};`);
    expect(inherited.css).toContain("h2 { margin: 0 0 16px; color: var(--heading);");

    // 指定あり: メインカラーとは独立した色が入る。
    const separated = buildSiteArtifacts({ ...site, theme: { ...site.theme, heading: "#b91c1c" } });
    expect(separated.css).toContain("--heading: #b91c1c;");
    expect(separated.css).toContain(`--primary: ${site.theme.primary};`);
  });
});
