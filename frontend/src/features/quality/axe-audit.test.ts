import { describe, expect, it } from "vitest";
import { AXE_MESSAGE_TYPE, buildAuditDocument, summarizeAxeFindings, toAxeFindings, type RawAxeViolation } from "./axe-audit";
import { createSampleSite } from "../site-model/sample";

describe("toAxeFindings", () => {
  it("監修済みの日本語がある場合は、axeの原文ではなくそちらを出す", () => {
    const findings = toAxeFindings([
      { id: "image-alt", impact: "critical", help: "Images must have alternative text", nodes: [{ target: ["img"] }] },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].summary).toBe("画像に代替テキスト（alt）がありません。");
    expect(findings[0].why).toContain("読み上げ");
    expect(findings[0].target).toBe("img");
    expect(findings[0].count).toBe(1);
  });

  it("辞書に無いルールでもaxeの原文を使って表示できる", () => {
    const findings = toAxeFindings([
      { id: "unknown-rule", impact: "serious", help: "Something must be fixed", nodes: [{ target: [".x"] }] },
    ]);

    expect(findings[0].summary).toBe("Something must be fixed");
    expect(findings[0].ruleId).toBe("unknown-rule");
  });

  it("影響の大きい指摘から順に並べる", () => {
    const violations: RawAxeViolation[] = [
      { id: "region", impact: "moderate", nodes: [{ target: ["h1"] }] },
      { id: "image-alt", impact: "critical", nodes: [{ target: ["img"] }] },
      { id: "link-name", impact: "serious", nodes: [{ target: ["a"] }] },
    ];

    expect(toAxeFindings(violations).map((finding) => finding.ruleId)).toEqual([
      "image-alt",
      "link-name",
      "region",
    ]);
  });

  it("impactが無い指摘も落とさず、軽い指摘として残す", () => {
    const findings = toAxeFindings([{ id: "region", impact: null, nodes: [{ target: ["h1"] }] }]);

    expect(findings).toHaveLength(1);
    expect(findings[0].impact).toBe("minor");
  });

  it("同じルールで複数の要素が引っかかった件数を数える", () => {
    const findings = toAxeFindings([
      { id: "image-alt", impact: "critical", nodes: [{ target: ["img"] }, { target: ["img.second"] }] },
    ]);

    expect(findings[0].count).toBe(2);
    expect(findings[0].target).toBe("img");
  });
});

describe("summarizeAxeFindings", () => {
  it("指摘が無いときは合格として扱う", () => {
    const check = summarizeAxeFindings([]);

    expect(check.id).toBe("axe");
    expect(check.passed).toBe(true);
  });

  it("指摘があるときは件数と内容をまとめる", () => {
    const check = summarizeAxeFindings(
      toAxeFindings([{ id: "image-alt", impact: "critical", nodes: [{ target: ["img"] }, { target: ["img.b"] }] }]),
    );

    expect(check.passed).toBe(false);
    expect(check.detail).toContain("2件");
    expect(check.detail).toContain("画像に代替テキスト");
  });

  it("保存APIの上限に合わせて、まとめ文を1000文字までに収める", () => {
    const violations: RawAxeViolation[] = Array.from({ length: 60 }, (_, index) => ({
      id: `rule-${index}`,
      impact: "serious",
      help: "とても長い説明文をここに入れて上限を超えさせる".repeat(3),
      nodes: [{ target: [`.selector-${index}`] }],
    }));

    expect(summarizeAxeFindings(toAxeFindings(violations)).detail.length).toBeLessThanOrEqual(1000);
  });
});

describe("buildAuditDocument", () => {
  const document = buildAuditDocument(createSampleSite("地域の小さな植物園"), "/assets/axe.min.js");

  it("提出物と同じCSSを埋め込み、外部参照を残さない", () => {
    expect(document).not.toContain('<link rel="stylesheet" href="style.css">');
    expect(document).toContain("--primary:");
  });

  it("プレビュー用のスクリプトは載せず、axeと実行スクリプトだけを載せる", () => {
    expect(document).not.toContain('<script src="script.js"></script>');
    expect(document).toContain('<script src="/assets/axe.min.js"></script>');
    expect(document).toContain(AXE_MESSAGE_TYPE);
  });

  it("編集画面用のスタイルは検査対象に混ぜない", () => {
    expect(document).not.toContain("cursor: pointer");
  });
});
