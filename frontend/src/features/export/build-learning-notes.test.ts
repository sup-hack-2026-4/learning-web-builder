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
    const markdown = buildLearningNotes([note({ codeChanges: ["--primary: #e11d48;", "--heading: #e11d48;"] })]);
    expect(markdown).toContain("- デザイン変更（メインカラーを #e11d48 に）: 元気な雰囲気を伝えたいから");
    expect(markdown).toContain("変わったコード:");
    expect(markdown).toContain("`--primary: #e11d48;`");
    expect(markdown).toContain("`--heading: #e11d48;`");
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
