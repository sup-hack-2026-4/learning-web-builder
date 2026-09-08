import { describe, expect, it } from "vitest";
import {
  conceptReplySchema,
  conceptSummary,
  emptyDraft,
  maxMessages,
  trimHistory,
  type ChatMessage,
} from "./schema";

describe("trimHistory", () => {
  it("上限以下の履歴はそのまま返す", () => {
    const messages: ChatMessage[] = [
      { role: "model", text: "何を紹介しますか" },
      { role: "user", text: "植物園" },
    ];

    expect(trimHistory(messages)).toEqual(messages);
  });

  it("上限を超えたら古い往復から落とす", () => {
    // 会話が伸びるほどサーバーのボディ上限に近づくため、直近だけを送る。
    const messages: ChatMessage[] = Array.from({ length: maxMessages + 4 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "model",
      text: `発言${index}`,
    }));

    const trimmed = trimHistory(messages);

    expect(trimmed).toHaveLength(maxMessages);
    expect(trimmed[0].text).toBe("発言4");
    expect(trimmed[trimmed.length - 1].text).toBe(`発言${messages.length - 1}`);
  });

  it("最後の発言は必ず残る", () => {
    // サーバーは「最後が学習者の発言」であることを求める。
    const messages: ChatMessage[] = Array.from({ length: maxMessages + 1 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "model",
      text: `発言${index}`,
    }));

    const trimmed = trimHistory(messages);

    expect(trimmed[trimmed.length - 1]).toEqual(messages[messages.length - 1]);
  });
});

describe("conceptSummary", () => {
  it("決まった項目だけを並べる", () => {
    const summary = conceptSummary({
      topic: "植物園",
      audience: "近所の家族連れ",
      goal: "週末に来てほしい",
      tone: "",
      mustInclude: [],
    });

    expect(summary).toBe("誰に：近所の家族連れ / 読んだあと：週末に来てほしい");
  });

  it("雰囲気と必須情報も含める", () => {
    const summary = conceptSummary({
      topic: "植物園",
      audience: "家族連れ",
      goal: "来園してほしい",
      tone: "やわらかい",
      mustInclude: ["開園時間", "アクセス"],
    });

    expect(summary).toContain("雰囲気：やわらかい");
    expect(summary).toContain("必ず載せる：開園時間、アクセス");
  });

  it("何も決まっていなくても空文字にはしない", () => {
    // 学習メモは空だと記録として意味をなさない。
    expect(conceptSummary(emptyDraft)).not.toBe("");
  });
});

describe("conceptReplySchema", () => {
  it("サーバーの応答をそのまま受け取れる", () => {
    const parsed = conceptReplySchema.parse({
      reply: "どんな人に読んでほしいですか。",
      choices: ["家族連れ", "大人"],
      draft: { topic: "植物園", audience: "", goal: "", tone: "", mustInclude: [] },
      missing: ["audience", "goal"],
      ready: false,
      provider: "gemini",
    });

    expect(parsed.ready).toBe(false);
    expect(parsed.choices).toHaveLength(2);
  });

  it("静的フォールバックの応答も受け取れる", () => {
    const parsed = conceptReplySchema.parse({
      reply: "AIとの相談を今は利用できません。",
      choices: [],
      draft: { topic: "", audience: "", goal: "", tone: "", mustInclude: [] },
      missing: ["topic", "audience", "goal"],
      ready: false,
      provider: "static-sample",
    });

    expect(parsed.provider).toBe("static-sample");
  });

  it("空の応答は受け付けない", () => {
    // 画面に空の吹き出しが出ると、失敗したのか考え中なのか分からなくなる。
    expect(() =>
      conceptReplySchema.parse({
        reply: "",
        choices: [],
        draft: emptyDraft,
        missing: [],
        ready: true,
        provider: "gemini",
      }),
    ).toThrow();
  });

  it("知らないproviderは受け付けない", () => {
    expect(() =>
      conceptReplySchema.parse({
        reply: "質問です。",
        choices: [],
        draft: emptyDraft,
        missing: [],
        ready: false,
        provider: "unknown",
      }),
    ).toThrow();
  });
});
