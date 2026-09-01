import { describe, expect, it } from "vitest";
import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import { createSampleSite } from "../site-model/sample";
import {
  annotateCss,
  annotateHtml,
  annotateJavaScript,
  findChangedLines,
  idsForSelector,
  tokenizeCss,
  tokenizeHtml,
  tokenizeJavaScript,
} from "./annotate-code";

const site = createSampleSite("地域の小さな植物園");
const artifacts = buildSiteArtifacts(site);

// 行の対応付けは、実際に提出物となるコードに対して正しくないと意味がないため、
// 手書きのサンプルではなくbuildSiteArtifactsの出力で検証する。
function linesFor(lines: { relatedIds: string[]; text: string }[], id: string) {
  return lines.filter((line) => line.relatedIds.includes(id)).map((line) => line.text);
}

describe("annotateHtml", () => {
  const lines = annotateHtml(artifacts.html);

  it("行番号とテキストがHTMLの各行と一致する", () => {
    expect(lines).toHaveLength(artifacts.html.split("\n").length);
    expect(lines[0]).toMatchObject({ number: 1, text: "<!doctype html>" });
  });

  it("複数行にまたがるheaderを閉じタグまで対応付ける", () => {
    const headerLines = linesFor(lines, "site-header");
    expect(headerLines[0]).toContain('data-builder-id="site-header"');
    expect(headerLines.at(-1)).toContain("</header>");
    // ヘッダーの中身（ロゴとタグライン）も同じ要素の範囲に入る。
    expect(headerLines.some((line) => line.includes('class="logo"'))).toBe(true);
  });

  it("セクションごとに、その要素を書いている行だけを対応付ける", () => {
    const heroLines = linesFor(lines, "hero");
    expect(heroLines.some((line) => line.includes("<h1>"))).toBe(true);
    // 別のセクションの見出しは含まない。
    expect(heroLines.some((line) => line.includes("私たちについて"))).toBe(false);

    const aboutLines = linesFor(lines, "about");
    expect(aboutLines.some((line) => line.includes("私たちについて"))).toBe(true);
    expect(aboutLines.some((line) => line.includes("</section>"))).toBe(true);
  });

  it("1行で閉じる要素はその行だけを対応付ける", () => {
    const footerLines = linesFor(lines, "site-footer");
    expect(footerLines).toHaveLength(1);
    expect(footerLines[0]).toContain("<footer");
  });

  it("どの要素にも属さない行は対応付けを持たない", () => {
    const headLine = lines.find((line) => line.text.includes("<meta charset"));
    expect(headLine?.relatedIds).toEqual([]);
  });
});

describe("annotateCss", () => {
  const lines = annotateCss(artifacts.css, site);

  it("セクション専用のルールを、その種類のセクションだけに対応付ける", () => {
    const heroRule = lines.find((line) => line.text.startsWith(".section-hero"));
    expect(heroRule?.relatedIds).toEqual(["hero"]);
  });

  it("h1をヒーロー、h2をそれ以外のセクションに対応付ける", () => {
    const h1Rule = lines.find((line) => line.text.startsWith("h1 {"));
    expect(h1Rule?.relatedIds).toEqual(["hero"]);

    const h2Rule = lines.find((line) => line.text.startsWith("h2 {"));
    expect(h2Rule?.relatedIds).toEqual(["about", "features", "contact"]);
  });

  it("ヘッダーとフッターのルールをそれぞれの要素に対応付ける", () => {
    expect(lines.find((line) => line.text.startsWith(".site-header {"))?.relatedIds).toEqual(["site-header"]);
    expect(lines.find((line) => line.text.startsWith(".logo {"))?.relatedIds).toEqual(["site-header"]);
    expect(lines.find((line) => line.text.startsWith("footer {"))?.relatedIds).toEqual(["site-footer"]);
  });

  it("複数行にわたる:rootは、どの要素にも属さない行として扱う", () => {
    const rootLines = lines.filter((line) => line.text.includes("--primary:") || line.text.includes("--space:"));
    expect(rootLines).not.toHaveLength(0);
    for (const line of rootLines) expect(line.relatedIds).toEqual([]);
  });

  it("@media内のルールは、外側ではなく内側のセレクタで対応付ける", () => {
    const mobileHero = lines.find((line) => line.number > 30 && line.text.trim().startsWith(".section-hero {"));
    expect(mobileHero?.relatedIds).toEqual(["hero"]);

    const mediaLine = lines.find((line) => line.text.startsWith("@media"));
    expect(mediaLine?.relatedIds).toEqual([]);
  });

  it("非表示のセクションは対応付けの対象から外れる", () => {
    const hiddenAbout = {
      ...site,
      sections: site.sections.map((section) => (section.id === "about" ? { ...section, visible: false } : section)),
    };
    const hiddenLines = annotateCss(artifacts.css, hiddenAbout);
    const h2Rule = hiddenLines.find((line) => line.text.startsWith("h2 {"));
    expect(h2Rule?.relatedIds).toEqual(["features", "contact"]);
  });
});

describe("idsForSelector", () => {
  it(".section-innerをセクション種別と取り違えず、全セクションに対応付ける", () => {
    expect(idsForSelector(".section-inner", site)).toEqual(["hero", "about", "features", "contact"]);
  });

  it("画像のルールは、画像を出力しない連絡先セクションを除外する", () => {
    expect(idsForSelector(".image-placeholder", site)).toEqual(["hero", "about", "features"]);
  });

  it("カンマ区切りのセレクタは、それぞれの対応先をまとめる", () => {
    expect(idsForSelector(".site-header, footer", site)).toEqual(["site-header", "site-footer"]);
  });

  it("要素と結び付かないセレクタは空を返す", () => {
    expect(idsForSelector("body", site)).toEqual([]);
    expect(idsForSelector(":root", site)).toEqual([]);
  });
});

describe("findChangedLines", () => {
  it("テーマを変えたときに、その値が書かれた行だけを変更として返す", () => {
    const changedSite = { ...site, theme: { ...site.theme, primary: "#e11d48" } };
    const changedCss = buildSiteArtifacts(changedSite).css;
    const changed = findChangedLines(changedCss, artifacts.css);

    const changedTexts = changedCss
      .split("\n")
      .filter((_, index) => changed.has(index + 1));
    expect(changedTexts).toContain("  --primary: #e11d48;");
    // 触っていない項目は変更として出ない。
    expect(changedTexts.some((text) => text.includes("--background"))).toBe(false);
  });

  it("同じ内容なら変更なしになる", () => {
    expect(findChangedLines(artifacts.css, artifacts.css).size).toBe(0);
  });

  it("閉じ括弧だけの行は差分として扱わない", () => {
    expect(findChangedLines("a {\n  color: red;\n}", "b {\n  color: red;\n}").has(3)).toBe(false);
  });
});

describe("トークン分割", () => {
  it("HTMLのタグ名・属性名・属性値を分けて色分けできる", () => {
    const [line] = tokenizeHtml('<a href="#main" class="logo">名前</a>');
    // 同じ種類が続く文字は1つのトークンにまとまるため、連結して確かめる。
    const tagText = line.filter((token) => token.kind === "tag").map((token) => token.text).join("");
    expect(tagText).toContain("<a");
    expect(tagText).toContain("</a>");
    expect(line.filter((token) => token.kind === "attribute").map((token) => token.text)).toContain("href");
    expect(line.filter((token) => token.kind === "string").map((token) => token.text)).toContain('"#main"');
    expect(line.filter((token) => token.kind === "plain").map((token) => token.text)).toContain("名前");
  });

  it("CSSのセレクタ・プロパティ・値を分ける", () => {
    const [line] = tokenizeCss("body { margin: 0; }");
    expect(line.find((token) => token.kind === "selector")?.text).toBe("body ");
    expect(line.find((token) => token.kind === "property")?.text.trim()).toBe("margin");
    expect(line.find((token) => token.kind === "value")?.text.trim()).toBe("0");
  });

  it("複数行にまたがるCSSコメントを、行をまたいでコメントとして扱う", () => {
    const lines = tokenizeCss("/* 1行目\n2行目 */\nbody { margin: 0; }");
    expect(lines[0].every((token) => token.kind === "comment")).toBe(true);
    expect(lines[1].some((token) => token.kind === "comment")).toBe(true);
    // コメントを抜けたあとはセレクタとして読み直す。
    expect(lines[2].some((token) => token.kind === "selector")).toBe(true);
  });

  it("JavaScriptの行コメントと文字列を分ける", () => {
    const [line] = tokenizeJavaScript("var style = 'text'; // 説明");
    expect(line.find((token) => token.kind === "keyword")?.text).toBe("var");
    expect(line.find((token) => token.kind === "string")?.text).toBe("'text'");
    expect(line.find((token) => token.kind === "comment")?.text).toContain("説明");
  });

  it("行数がコードの行数と一致する", () => {
    expect(tokenizeHtml(artifacts.html)).toHaveLength(artifacts.html.split("\n").length);
    expect(tokenizeCss(artifacts.css)).toHaveLength(artifacts.css.split("\n").length);
    expect(annotateJavaScript(artifacts.javascript)).toHaveLength(artifacts.javascript.split("\n").length);
  });
});
