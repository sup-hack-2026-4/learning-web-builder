import { describe, expect, it } from "vitest";
import { buildSiteArtifacts, escapeHtml } from "./build-site-artifacts";
import { createSampleSite } from "../site-model/sample";

describe("buildSiteArtifacts", () => {
  it("危険な入力をHTMLとして実行できない形にする", () => {
    const site = createSampleSite('<script>alert("x")</script>');
    const artifacts = buildSiteArtifacts(site);
    expect(artifacts.html).not.toContain('<script>alert("x")</script>');
    expect(artifacts.html).toContain("&lt;script&gt;");
  });

  it("提出用の3ファイルとsrcdocを生成する", () => {
    const artifacts = buildSiteArtifacts(createSampleSite());
    expect(artifacts.html).toContain("<!doctype html>");
    expect(artifacts.css).toContain("@media (max-width: 640px)");
    expect(artifacts.javascript).toContain("postMessage");
    expect(artifacts.srcdoc).toContain('<style id="builder-theme">');
  });

  it("親からのテーマ更新メッセージを受け取るスクリプトを含む", () => {
    const artifacts = buildSiteArtifacts(createSampleSite());
    expect(artifacts.javascript).toContain("learning-builder:theme");
    expect(artifacts.javascript).toContain("builder-theme");
  });
});

describe("escapeHtml", () => {
  it("HTMLで意味を持つ文字をエスケープする", () => {
    expect(escapeHtml("<b>&\"'</b>")).toBe("&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;");
  });
});


describe("セクションの画像", () => {
  // 検証は形とサイズしか見ないため、テストの画像は最小限のバイト列で足りる。
  const image = { dataUri: "data:image/jpeg;base64,/9j/4AAQ", fileName: "about.jpg" };

  function siteWithImage() {
    const site = createSampleSite();
    return {
      ...site,
      sections: site.sections.map((section) =>
        section.id === "about" ? { ...section, image, imageAlt: "活動の写真" } : section,
      ),
    };
  }

  it("画像を選んでいなければ従来のプレースホルダーを出す", () => {
    const artifacts = buildSiteArtifacts(createSampleSite());
    expect(artifacts.html).toContain('class="image-placeholder"');
    expect(artifacts.html).not.toContain("<img");
    expect(artifacts.images).toHaveLength(0);
  });

  it("提出用のHTMLは画像を相対パスで参照する", () => {
    const artifacts = buildSiteArtifacts(siteWithImage());
    expect(artifacts.html).toContain('<img class="section-image" src="images/about.jpg" alt="活動の写真">');
    // コード表示にはこのHTMLをそのまま使うため、巨大なbase64が混ざってはいけない。
    expect(artifacts.html).not.toContain("data:image/jpeg");
  });

  it("プレビューのsrcdocではデータURIへ差し替える", () => {
    // srcdocはopaque originで開くため、相対パスの解決先が無い。
    const artifacts = buildSiteArtifacts(siteWithImage());
    expect(artifacts.srcdoc).toContain(`src="${image.dataUri}"`);
    expect(artifacts.srcdoc).not.toContain('src="images/about.jpg"');
  });

  it("提出物へ同梱する画像として返す", () => {
    const artifacts = buildSiteArtifacts(siteWithImage());
    expect(artifacts.images).toEqual([image]);
  });

  it("非表示のセクションの画像は同梱しない", () => {
    const site = siteWithImage();
    const artifacts = buildSiteArtifacts({
      ...site,
      sections: site.sections.map((section) =>
        section.id === "about" ? { ...section, visible: false } : section,
      ),
    });
    expect(artifacts.images).toHaveLength(0);
    expect(artifacts.html).not.toContain("images/about.jpg");
  });

  it("基本情報のセクションには画像を出さない", () => {
    const site = createSampleSite();
    const artifacts = buildSiteArtifacts({
      ...site,
      sections: site.sections.map((section) =>
        section.kind === "contact" ? { ...section, image } : section,
      ),
    });
    expect(artifacts.images).toHaveLength(0);
    expect(artifacts.html).not.toContain("images/about.jpg");
  });
});
