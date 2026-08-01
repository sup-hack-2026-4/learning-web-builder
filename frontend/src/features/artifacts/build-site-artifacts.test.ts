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

