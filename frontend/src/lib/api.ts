import { z } from "zod";
import {
  aiUsageSchema,
  learningNoteSchema,
  learningRecordProblem,
  siteModelProblem,
  siteModelSchema,
  type LearningRecord,
  type SiteModel,
} from "@/features/site-model/schema";
import { conceptReplySchema, trimHistory, type ChatMessage, type ConceptDraft, type ConceptReply } from "@/features/concept/schema";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export type TokenProvider = () => Promise<string | null>;

type ApiRequestOptions = RequestInit & {
  getToken?: TokenProvider;
};

export async function requestApi(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { getToken, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  const token = await getToken?.();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${apiBaseUrl}${path}`, {
    ...requestOptions,
    headers,
  });
}

// AIを呼ぶAPIでトークンを待つ上限。
export const OPTIONAL_TOKEN_TIMEOUT_MS = 3000;

/**
 * トークンを取れないときは、待ち続けずにゲストとして続ける。
 *
 * 生成と相談はログインしていなくても使え、トークンは回数制限の単位を決めるためだけに付ける。
 * ClerkのgetTokenはClerkの読み込みが終わるまで返らないため、通信の遮断や障害で読み込めないと、
 * そのまま渡すと生成が始まらず、見本への切り替えも起きなくなる。
 */
function optionalToken(getToken: TokenProvider): TokenProvider {
  return () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), OPTIONAL_TOKEN_TIMEOUT_MS);
      getToken()
        .then(resolve, () => resolve(null))
        .finally(() => clearTimeout(timer));
    });
}

export type SessionStatus =
  | { authenticated: false; mode: "guest" }
  | { authenticated: true; mode: "clerk"; userId: string };

// notesとaiUsageは個別の取得と保存の結果にだけ含まれ、一覧には無い。
// 無いときは空の記録として扱う。
const projectSchema = z.object({
  id: z.uuid(),
  site: siteModelSchema,
  notes: z.array(learningNoteSchema).default([]),
  aiUsage: z.array(aiUsageSchema).default([]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const projectListSchema = z.object({
  projects: z.array(projectSchema),
});

export type Project = z.infer<typeof projectSchema>;

export async function getSession(getToken: TokenProvider): Promise<SessionStatus> {
  const response = await requestApi("/session", { getToken });
  if (!response.ok) {
    throw new Error("ログイン状態を確認できません。");
  }
  const payload = await response.json() as Partial<SessionStatus>;
  if (payload.authenticated === true && payload.mode === "clerk" && typeof payload.userId === "string") {
    return { authenticated: true, mode: "clerk", userId: payload.userId };
  }
  return { authenticated: false, mode: "guest" };
}

/**
 * 生成APIが入力の誤りとして断ったことを表す。
 * 通信やサーバーの障害とは違い、見本で代わりにすると誤りが見えなくなるため、呼び出し側で区別する(#117)。
 */
export class GenerateInputError extends Error {}

/**
 * 回数制限(429)や混雑(503)で、AIの呼び出しが一時的に断られたことを表す。
 * 少し待てば使えるため、通信やサーバーの障害とは区別する。メッセージには待ち時間を入れ、そのまま画面へ出せる(#133)。
 */
export class AiBusyError extends Error {}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Math.max(1, Number(value));
}

// 一時的に断られた応答なら、待ち時間を伝えるエラーを返す。それ以外はnull。
function aiBusyError(response: Response): AiBusyError | null {
  if (response.status !== 429 && response.status !== 503) return null;
  const seconds = retryAfterSeconds(response);
  // このAPIが混雑で断るときは、必ずRetry-Afterを付ける。
  // 付いていない503は手前の基盤の障害や起動待ちで、いつ使えるか分からないため、障害として扱う。
  if (response.status === 503 && seconds === null) return null;
  const reason = response.status === 429 ? "短い時間に続けて利用したため、いまは受け付けられません。" : "いまAIが混み合っています。";
  const wait = seconds === null ? "しばらく" : `約${seconds}秒`;
  return new AiBusyError(`${reason}${wait}待ってから、もう一度お試しください。`);
}

/**
 * 題材からたたき台を生成する。
 *
 * concept は相談で固めたコンセプト。省略できるため、相談を使わずに
 * 題材だけで生成する導線もこれまでどおり動く。
 *
 * トークンは回数制限の単位を決める。ログイン中に付けないと、ゲストと同じIP単位で数えられる(#120)。
 */
export async function generateSite(
  topic: string,
  getToken: TokenProvider,
  concept?: ConceptDraft,
): Promise<{ site: SiteModel; provider: "gemini" | "static-sample" }> {
  const response = await requestApi("/generate", {
    getToken: optionalToken(getToken),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(concept ? { topic, concept } : { topic }),
  });

  if (response.status === 400) {
    throw new GenerateInputError("題材またはコンセプトの内容を確認してください。題材は1〜100文字で入力してください。");
  }
  const busy = aiBusyError(response);
  if (busy) throw busy;
  if (!response.ok) {
    throw new Error("サイト生成APIを利用できません。");
  }

  const payload: unknown = await response.json();
  const envelope = payload as { site?: unknown; provider?: unknown };
  return {
    site: siteModelSchema.parse(envelope.site),
    provider: envelope.provider === "gemini" ? "gemini" : "static-sample",
  };
}

/**
 * 生成前のコンセプト相談を1ターン進める。
 *
 * 会話はサーバーに持たせず、毎回まとめて送る。DBを増やさずに済む一方、
 * 履歴はサーバーから見て未信頼な入力になるため、確定済みの項目は
 * サーバー側で保持される（こちらが送った下書きが勝手に書き換わることはない）。
 */
export async function conceptChat(messages: ChatMessage[], draft: ConceptDraft, getToken: TokenProvider): Promise<ConceptReply> {
  const response = await requestApi("/concept/chat", {
    // 生成と同じく、ログイン中はユーザー単位で回数を数えてもらう(#120)。
    getToken: optionalToken(getToken),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: trimHistory(messages), draft }),
  });

  const busy = aiBusyError(response);
  if (busy) throw busy;
  if (!response.ok) {
    throw new Error("コンセプト相談を利用できません。");
  }

  return conceptReplySchema.parse(await response.json());
}

export async function listProjects(getToken: TokenProvider): Promise<Project[]> {
  const response = await requestApi("/projects", { getToken });
  if (!response.ok) {
    throw new Error("保存済みプロジェクトを取得できません。");
  }
  return projectListSchema.parse(await response.json()).projects;
}

export async function getProject(projectId: string, getToken: TokenProvider): Promise<Project> {
  const response = await requestApi(`/projects/${encodeURIComponent(projectId)}`, { getToken });
  if (!response.ok) {
    throw new Error("プロジェクトを読み込めません。");
  }
  return projectSchema.parse(await response.json());
}

/**
 * 保存済みプロジェクトを1件消す。
 *
 * 関連する学習メモ・品質チェック結果もDB側のON DELETE CASCADEで一緒に消える。
 * 取り消せないため、呼び出す前に画面側で確認を挟む。
 */
export async function deleteProject(projectId: string, getToken: TokenProvider): Promise<void> {
  const response = await requestApi(`/projects/${encodeURIComponent(projectId)}`, {
    getToken,
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("プロジェクトを削除できません。");
  }
}

/**
 * 作品と学習の記録をまとめて保存する。
 *
 * 記録を作品と別に保存すると、読み込んだときに学習メモやAI利用記録が消え、
 * 提出物ZIPから学習の成果が抜け落ちる。そのため同じリクエストで送る。
 */
export async function saveProject(
  site: SiteModel,
  record: LearningRecord,
  getToken: TokenProvider,
  projectId?: string | null,
): Promise<Project> {
  // 送る前に確かめる。サーバーで断られると「保存できません」としか伝えられず、どこを直せばよいか分からない。
  const problem = siteModelProblem(site) ?? learningRecordProblem(record);
  if (problem) {
    throw new Error(problem);
  }
  const response = await requestApi(
    projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects",
    {
      getToken,
      method: projectId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, notes: record.notes, aiUsage: record.aiUsage }),
    },
  );
  if (!response.ok) {
    throw new Error(projectId ? "プロジェクトを更新できません。" : "プロジェクトを保存できません。");
  }
  return projectSchema.parse(await response.json());
}
