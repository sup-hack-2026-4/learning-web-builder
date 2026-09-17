import { describe, expect, it } from "vitest";
import {
  conceptReplySchema,
  conceptStateSchema,
  conceptSummary,
  emptyDraft,
  isDraftReady,
  maxChoices,
  maxMessages,
  maxReplyLength,
  missingFields,
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

describe("missingFields / isDraftReady", () => {
  it("空欄の必須項目を順に返す", () => {
    expect(missingFields({ ...emptyDraft, topic: "植物園" })).toEqual(["audience", "goal"]);
  });

  it("空白だけの項目は未入力として扱う", () => {
    // AIは空欄を " " で埋めてくることがある。埋まった扱いにすると空のまま生成へ進む。
    const draft = { ...emptyDraft, topic: "植物園", audience: "   ", goal: "\t" };

    expect(missingFields(draft)).toEqual(["audience", "goal"]);
    expect(isDraftReady(draft)).toBe(false);
  });

  it("必須3項目がそろえば生成できる", () => {
    const draft = { ...emptyDraft, topic: "植物園", audience: "家族連れ", goal: "来園してほしい" };

    expect(isDraftReady(draft)).toBe(true);
    expect(missingFields(draft)).toEqual([]);
  });

  it("任意項目は生成の可否に影響しない", () => {
    const draft = { topic: "植物園", audience: "家族連れ", goal: "来園してほしい", tone: "", mustInclude: [] };

    expect(isDraftReady(draft)).toBe(true);
  });
});

describe("conceptReplySchema の整合性チェック", () => {
  it("readyとdraftが食い違う応答を弾く", () => {
    // 空欄が残っているのに ready を立てられると、何も決めずに生成へ進めてしまう。
    expect(() =>
      conceptReplySchema.parse({
        reply: "この内容で生成できます。",
        choices: [],
        draft: { topic: "植物園", audience: "", goal: "", tone: "", mustInclude: [] },
        missing: [],
        ready: true,
        provider: "gemini",
      }),
    ).toThrow();
  });

  it("そろっているのにready=falseの応答も弾く", () => {
    expect(() =>
      conceptReplySchema.parse({
        reply: "まだ決まっていません。",
        choices: [],
        draft: { topic: "植物園", audience: "家族連れ", goal: "来園してほしい", tone: "", mustInclude: [] },
        missing: [],
        ready: false,
        provider: "gemini",
      }),
    ).toThrow();
  });

  it("長すぎる返答を弾く", () => {
    expect(() =>
      conceptReplySchema.parse({
        reply: "あ".repeat(maxReplyLength + 1),
        choices: [],
        draft: emptyDraft,
        missing: ["topic", "audience", "goal"],
        ready: false,
        provider: "gemini",
      }),
    ).toThrow();
  });

  it("選択肢が多すぎる応答を弾く", () => {
    expect(() =>
      conceptReplySchema.parse({
        reply: "選んでください。",
        choices: Array.from({ length: maxChoices + 1 }, (_, index) => `選択肢${index}`),
        draft: emptyDraft,
        missing: ["topic", "audience", "goal"],
        ready: false,
        provider: "gemini",
      }),
    ).toThrow();
  });

  it("missingに未知の項目名が来たら弾く", () => {
    expect(() =>
      conceptReplySchema.parse({
        reply: "質問です。",
        choices: [],
        draft: emptyDraft,
        missing: ["unknownField"],
        ready: false,
        provider: "gemini",
      }),
    ).toThrow();
  });
});

describe("conceptStateSchema（保存からの復元）", () => {
  it("壊れた値を捨てて空の相談として扱う", () => {
    // 古い形式や壊れた値をそのまま使うと、描画中に例外になり画面ごと落ちる。
    const restored = conceptStateSchema.parse({
      chatMessages: "壊れた値",
      conceptDraft: { topic: 123, mustInclude: "配列ではない" },
      conceptChoices: [{ not: "a string" }],
    });

    expect(restored.chatMessages).toEqual([]);
    expect(restored.conceptDraft).toEqual(emptyDraft);
    expect(restored.conceptChoices).toEqual([]);
  });

  it("項目が無い保存データでも空の相談を返す", () => {
    const restored = conceptStateSchema.parse({});

    expect(restored.chatMessages).toEqual([]);
    expect(restored.conceptDraft.mustInclude).toEqual([]);
  });

  it("正しい保存データはそのまま復元する", () => {
    const restored = conceptStateSchema.parse({
      chatMessages: [{ role: "model", text: "何を紹介しますか" }, { role: "user", text: "植物園" }],
      conceptDraft: { topic: "植物園", audience: "家族連れ", goal: "来園してほしい", tone: "", mustInclude: [] },
      conceptChoices: ["近所の家族連れ"],
    });

    expect(restored.chatMessages).toHaveLength(2);
    expect(isDraftReady(restored.conceptDraft)).toBe(true);
    expect(restored.conceptChoices).toEqual(["近所の家族連れ"]);
  });

  it("上限を超えた履歴は直近だけ残す", () => {
    const messages = Array.from({ length: maxMessages + 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "model",
      text: `発言${index}`,
    }));

    const restored = conceptStateSchema.parse({ chatMessages: messages });

    expect(restored.chatMessages).toHaveLength(maxMessages);
  });
});
