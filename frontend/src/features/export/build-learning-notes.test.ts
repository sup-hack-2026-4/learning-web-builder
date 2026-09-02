import { describe, expect, it } from "vitest";
import type { LearningNote } from "../site-model/schema";
import { buildLearningNotes } from "./export-project";

function note(values: Partial<LearningNote>): LearningNote {
  return {
    id: "note-1",
    target: "デザイン変更（メインカラーを #e11d48 に）",
    reason: "元気な雰囲気を伝えたいから",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...values,
  };
}

describe("buildLearningNotes", () => {
  it("理由と一緒に、実際に変わったコードを残す", () => {
    const markdown = buildLearningNotes([
      note({ codeChanges: ["+ --primary: #e11d48;", "- --primary: #2563eb;"] }),
    ]);
    expect(markdown).toContain("- デザイン変更（メインカラーを #e11d48 に）: 元気な雰囲気を伝えたいから");
    expect(markdown).toContain("変わったコード:");
    // 増減が読み取れるよう、diffのコードブロックとして囲む。
    expect(markdown).toContain("```diff");
    expect(markdown).toContain("+ --primary: #e11d48;");
    expect(markdown).toContain("- --primary: #2563eb;");
  });

  it("コードにバッククォートが含まれても、区切りが壊れない", () => {
    const markdown = buildLearningNotes([
      note({ codeChanges: ["+ <p>``ここ``に印``をつける```</p>"] }),
    ]);

    // 中身の最長連続(3つ)より長い区切りを使う。
    expect(markdown).toContain("````diff");
    expect(markdown).toContain("+ <p>``ここ``に印``をつける```</p>");
  });

  it("コードの記録がないメモは、理由だけの1行にする", () => {
    const markdown = buildLearningNotes([note({ codeChanges: undefined })]);
    expect(markdown).toContain("- デザイン変更（メインカラーを #e11d48 に）: 元気な雰囲気を伝えたいから");
    expect(markdown).not.toContain("変わったコード:");
  });

  it("コードの記録が空配列でも、見出しだけを残さない", () => {
    expect(buildLearningNotes([note({ codeChanges: [] })])).not.toContain("変わったコード:");
  });

  it("メモがないときは、その旨を書く", () => {
    expect(buildLearningNotes([])).toContain("まだ学習メモはありません。");
  });
});
