import { describe, expect, it } from "vitest";
import timestampCases from "../../../../testdata/learning-timestamps.json";
import {
  isValidTimestamp,
  learningNoteSchema,
  learningRecordBytes,
  learningRecordProblem,
  MAX_LEARNING_RECORD_BYTES,
  type LearningNote,
} from "./schema";

const note: LearningNote = {
  id: "note-1",
  target: "内容変更（活動紹介）",
  reason: "撮影会の様子が伝わるよう説明を足した",
  createdAt: "2026-09-29T01:02:03.456Z",
};

describe("学習記録の日時", () => {
  // サーバー側(backend/internal/project/learning_test.go)と同じ境界値で確かめる。
  // どちらかだけが受け付ける日時があると、画面の検証を通ったのに保存で400になる。
  it.each(timestampCases.valid)("%s を受け付ける", (value) => {
    expect(isValidTimestamp(value)).toBe(true);
  });

  it.each(timestampCases.invalid)("%s を受け付けない", (value) => {
    expect(isValidTimestamp(value)).toBe(false);
  });

  it("toISOString()の出力を受け付ける", () => {
    expect(isValidTimestamp(new Date().toISOString())).toBe(true);
  });
});

describe("学習メモの上限", () => {
  it("本文の & がエスケープされて長くなった変更行も保存できる", () => {
    // 本文は800文字までだが、& は &amp; になるため、変更行は本文の上限より長くなる。
    const codeChanges = [`+ <p>${"&amp;".repeat(800)}</p>`];
    expect(learningNoteSchema.safeParse({ ...note, codeChanges }).success).toBe(true);
  });

  it("構成変更のラベルをいくつもつないだ対象も保存できる", () => {
    const target = Array.from({ length: 8 }, () => `セクション削除（${"長".repeat(80)}）`).join(" / ");
    expect(learningNoteSchema.safeParse({ ...note, target }).success).toBe(true);
  });
});

describe("学習記録の大きさ", () => {
  it("保存リクエストに乗る notes と aiUsage の部分と同じバイト数を数える", () => {
    // サーバーは受け取ったJSONのまま数える。U+2028はJSON.stringifyでは3バイトのまま送られる。
    const record = {
      notes: [{ ...note, codeChanges: [String.fromCharCode(0x2028).repeat(100), '<a href="?a=1&b=2">詳しく</a>'] }],
      aiUsage: [{ provider: "gemini" as const, purpose: "サイト構成と仮文章の生成", generatedAt: "2026-09-29T00:59:00.000Z" }],
    };
    const body = JSON.stringify({ site: {}, notes: record.notes, aiUsage: record.aiUsage });
    const encoder = new TextEncoder();
    const bodyBytes = encoder.encode(body).length;
    const otherBytes = encoder.encode('{"site":{},"notes":,"aiUsage":}').length;

    expect(learningRecordBytes(record)).toBe(bodyBytes - otherBytes);
  });

  it("上限を超えたら理由を返す", () => {
    const bigNote = { ...note, reason: "x".repeat(10000) };
    const notes = Array.from({ length: Math.ceil(MAX_LEARNING_RECORD_BYTES / 10000) + 1 }, (_, index) => ({ ...bigNote, id: `note-${index}` }));

    expect(learningRecordProblem({ notes, aiUsage: [] })).toBe("学習メモが大きすぎて保存できません。提出物ZIPで書き出して手元に残してください。");
  });
});
