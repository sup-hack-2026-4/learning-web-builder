import { z } from "zod";

/**
 * 生成前にコンセプトを固めるための対話。
 *
 * ここで扱うのは生成"前"の下書きだけで、SiteModelには触れない。
 * 生成後の編集を対話でやると、学習メモのリセットや差分適用が必要になるうえ、
 * 「変更理由は学習者自身が書く」という狙いとも衝突するため、役割を生成前に限っている。
 */

// バックエンドの concept パッケージと同じ上限。片側だけ緩いと、
// 送れたのにサーバーで弾かれる状態になる。
export const maxMessageLength = 500;
export const maxMessages = 24;
export const maxTopicLength = 100;

export const chatRoleSchema = z.enum(["user", "model"]);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  text: z.string().min(1).max(maxMessageLength),
});

export const conceptDraftSchema = z.object({
  topic: z.string().max(maxTopicLength).default(""),
  audience: z.string().max(80).default(""),
  goal: z.string().max(120).default(""),
  tone: z.string().max(40).default(""),
  mustInclude: z.array(z.string().max(60)).max(5).default([]),
});

export const conceptReplySchema = z.object({
  reply: z.string().min(1),
  choices: z.array(z.string()),
  draft: conceptDraftSchema,
  missing: z.array(z.string()),
  ready: z.boolean(),
  provider: z.enum(["gemini", "static-sample"]),
});

export type ChatRole = z.infer<typeof chatRoleSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ConceptDraft = z.infer<typeof conceptDraftSchema>;
export type ConceptReply = z.infer<typeof conceptReplySchema>;

export const emptyDraft: ConceptDraft = {
  topic: "",
  audience: "",
  goal: "",
  tone: "",
  mustInclude: [],
};

/** 必須項目の表示名。missing に入る値と対応させる。 */
export const requiredFieldLabels: Record<string, string> = {
  topic: "題材",
  audience: "読んでほしい人",
  goal: "読んだあとどうしてほしいか",
};

/**
 * 送信する履歴を直近だけに絞る。
 *
 * 会話が伸びるほどサーバーのボディ上限に近づくうえ、題材をデータとして扱う指示も
 * 相対的に薄まる。古い往復を落として、直近のやり取りだけを渡す。
 */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
}

/**
 * 決まったコンセプトを、学習メモに残す1行へまとめる。
 *
 * 生成した本人が「誰に向けて何を伝えると決めたか」を、あとから提出物の中で読み返せるようにする。
 * 未確定の項目は書かない。
 */
export function conceptSummary(draft: ConceptDraft): string {
  const parts = [
    draft.audience.trim() && `誰に：${draft.audience.trim()}`,
    draft.goal.trim() && `読んだあと：${draft.goal.trim()}`,
    draft.tone.trim() && `雰囲気：${draft.tone.trim()}`,
    draft.mustInclude.length > 0 && `必ず載せる：${draft.mustInclude.join("、")}`,
  ].filter((part): part is string => typeof part === "string" && part !== "");

  if (parts.length === 0) return "AIと相談してコンセプトを決めました。";
  return parts.join(" / ");
}
