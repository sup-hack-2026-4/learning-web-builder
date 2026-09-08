import { z } from "zod";

/**
 * 生成前にコンセプトを固めるための対話。
 *
 * ここで扱うのは生成"前"の下書きだけで、SiteModelには触れない。
 * 生成後の編集を対話でやると、学習メモのリセットや差分適用が必要になるうえ、
 * 「変更理由は学習者自身が書く」という狙いとも衝突するため、役割を生成前に限っている。
 */

// バックエンドの concept パッケージと同じ上限。片側だけ緩いと、
// 送れたのにサーバーで弾かれたり、異常な応答をそのまま画面へ出したりする。
export const maxMessageLength = 500;
export const maxMessages = 24;
export const maxTopicLength = 100;
export const maxAudienceLength = 80;
export const maxGoalLength = 120;
export const maxToneLength = 40;
export const maxMustInclude = 5;
export const maxMustIncludeLength = 60;
export const maxReplyLength = 400;
export const maxChoices = 4;
export const maxChoiceLength = 40;

/** 必須項目。この3つがそろうまで生成へ進ませない。 */
export const requiredFields = ["topic", "audience", "goal"] as const;
export type RequiredField = (typeof requiredFields)[number];

export const chatRoleSchema = z.enum(["user", "model"]);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  text: z.string().min(1).max(maxMessageLength),
});

export const conceptDraftSchema = z.object({
  topic: z.string().max(maxTopicLength).default(""),
  audience: z.string().max(maxAudienceLength).default(""),
  goal: z.string().max(maxGoalLength).default(""),
  tone: z.string().max(maxToneLength).default(""),
  mustInclude: z.array(z.string().max(maxMustIncludeLength)).max(maxMustInclude).default([]),
});

export const conceptReplySchema = z
  .object({
    reply: z.string().min(1).max(maxReplyLength),
    choices: z.array(z.string().min(1).max(maxChoiceLength)).max(maxChoices),
    draft: conceptDraftSchema,
    missing: z.array(z.enum(requiredFields)),
    ready: z.boolean(),
    provider: z.enum(["gemini", "static-sample"]),
  })
  // ready と draft が食い違う応答をそのまま信じると、
  // 空欄のまま生成へ進めたり、そろっているのに進めなくなったりする。
  .superRefine((reply, ctx) => {
    if (reply.ready !== isDraftReady(reply.draft)) {
      ctx.addIssue({ code: "custom", message: "readyとdraftの内容が一致しません。", path: ["ready"] });
    }
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

/**
 * 下書きに足りない必須項目を返す。
 *
 * サーバーの missing をそのまま使うと、保存から復元したときに手元へ何も残らない。
 * 判定は下書きだけで決まるので、画面側でも同じ規則で導出する。
 */
export function missingFields(draft: ConceptDraft): RequiredField[] {
  return requiredFields.filter((field) => draft[field].trim() === "");
}

/** 必須項目がそろい、生成へ進めるか。 */
export function isDraftReady(draft: ConceptDraft): boolean {
  return missingFields(draft).length === 0;
}

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

/**
 * 保存から読み戻した相談の状態を、安全な形へそろえる。
 *
 * localStorageの中身は古い版のまま残ることも、壊れていることもある。
 * 検証せずに使うと、mustInclude が配列でないだけで描画中に例外になり、
 * 画面全体が落ちる。読めない部分は捨てて、空の相談として扱う。
 */
export const conceptStateSchema = z
  .object({
    chatMessages: z.array(chatMessageSchema).catch([]),
    conceptDraft: conceptDraftSchema.catch(emptyDraft),
    conceptChoices: z.array(z.string().min(1).max(maxChoiceLength)).max(maxChoices).catch([]),
  })
  .partial()
  .transform((state) => ({
    chatMessages: trimHistory(state.chatMessages ?? []),
    conceptDraft: state.conceptDraft ?? emptyDraft,
    conceptChoices: state.conceptChoices ?? [],
  }));
