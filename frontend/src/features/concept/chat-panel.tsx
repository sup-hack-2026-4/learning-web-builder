import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { conceptChat } from "@/lib/api";
import { useBuilderStore } from "@/features/site-model/store";
import {
  isDraftReady,
  maxMessageLength,
  missingFields,
  requiredFieldLabels,
  type ChatMessage,
  type ConceptDraft,
} from "./schema";

// 最初の一言。ここを空にすると、学習者が何を書けばよいか分からないまま止まる。
const openingQuestion = "どんなものを紹介するサイトを作りますか。ひとことで教えてください。";

type ConceptChatPanelProps = {
  /** コンセプトが固まったあと、その内容でたたき台を生成する。 */
  onGenerate: (draft: ConceptDraft) => void;
  generating: boolean;
};

/**
 * 生成前にコンセプトを対話で固めるパネル。
 *
 * AIが代わりに決めるのではなく、質問と選択肢を出して学習者に選ばせる。
 * ここで決めた内容は生成の入力になるだけで、SiteModelには触れない。
 */
export function ConceptChatPanel({ onGenerate, generating }: ConceptChatPanelProps) {
  const chatMessages = useBuilderStore((state) => state.chatMessages);
  const conceptDraft = useBuilderStore((state) => state.conceptDraft);
  const conceptChoices = useBuilderStore((state) => state.conceptChoices);
  const conceptGeneration = useBuilderStore((state) => state.conceptGeneration);
  const appendChatMessage = useBuilderStore((state) => state.appendChatMessage);
  const dropLastChatMessage = useBuilderStore((state) => state.dropLastChatMessage);
  const setConceptReply = useBuilderStore((state) => state.setConceptReply);
  const resetConcept = useBuilderStore((state) => state.resetConcept);

  const [input, setInput] = useState("");

  // ready と missing は下書きから決まる。画面のstateに持つと、
  // 保存から復元したときだけ「そろっているのに生成できない」状態になる。
  const ready = useMemo(() => isDraftReady(conceptDraft), [conceptDraft]);
  const missing = useMemo(() => missingFields(conceptDraft), [conceptDraft]);

  const started = chatMessages.length > 0;

  const chat = useMutation({
    mutationFn: async (text: string) => {
      const next: ChatMessage = { role: "user", text };
      // 送信した発言はすぐ画面へ出す。応答を待つ間、何を送ったか見えないと不安になる。
      appendChatMessage(next);
      // どの相談に対する応答かを覚えておく。返るころにやり直されていたら捨てる。
      const generation = conceptGeneration;
      const reply = await conceptChat([...chatMessages, next], conceptDraft);
      return { reply, generation };
    },
    onSuccess: ({ reply, generation }) => {
      // やり直したあとに古い応答が届くと、空にした会話が復活してしまう。
      if (generation !== useBuilderStore.getState().conceptGeneration) return;
      appendChatMessage({ role: "model", text: reply.reply });
      setConceptReply(reply.draft, reply.choices);
      setInput("");
    },
    onError: () => {
      // 楽観的に足した発言を残すと、再送のたびに同じ文が積み上がる。
      // 入力欄には文面が残っているので、そのまま送り直せる。
      dropLastChatMessage();
    },
  });

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending) return;
    chat.mutate(trimmed.slice(0, maxMessageLength));
  };

  // 最初の問いかけは決まりきっているため、AIを呼ばずに画面へ出す。
  // 1往復ぶんの待ち時間と呼び出しを省ける。
  const startChat = () => {
    appendChatMessage({ role: "model", text: openingQuestion });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const startOver = () => {
    // 進行中の通信は止められないが、世代が変わるので応答は捨てられる。
    resetConcept();
    setInput("");
    chat.reset();
  };

  const decided = [
    { label: "題材", value: conceptDraft.topic },
    { label: "読んでほしい人", value: conceptDraft.audience },
    { label: "読んだあと", value: conceptDraft.goal },
    { label: "雰囲気", value: conceptDraft.tone },
    { label: "必ず載せる", value: conceptDraft.mustInclude.join("、") },
  ].filter((item) => item.value.trim() !== "");

  return (
    <section aria-labelledby="concept-chat-heading" className="rounded-xl border border-slate-200 p-3">
      <h2 id="concept-chat-heading" className="flex items-center gap-2 text-sm font-black">
        <MessageCircle className="size-4 text-blue-600" />
        AIと相談して決める
      </h2>

      {/* 空状態。まだ一度も相談していないときに、何ができるのかを伝える。 */}
      {!started && (
        <div className="mt-2 space-y-3">
          <p className="text-xs leading-5 text-slate-600">
            誰に向けて、何を伝えるサイトなのかをAIと一緒に決められます。
            決めた内容はそのまま、たたき台の生成に使われます。
          </p>
          <Button variant="secondary" className="w-full" onClick={startChat}>
            相談をはじめる
          </Button>
        </div>
      )}

      {started && (
        <>
          <ol className="mt-3 space-y-2" data-testid="concept-chat-log">
            {chatMessages.map((message, index) => (
              <li
                key={`${message.role}-${index}`}
                className={
                  message.role === "user"
                    ? "ml-6 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950"
                    : "mr-6 rounded-xl bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800"
                }
              >
                <span className="sr-only">{message.role === "user" ? "あなた：" : "AI："}</span>
                {message.text}
              </li>
            ))}
          </ol>

          {/* ローディング状態 */}
          {chat.isPending && (
            <p className="mt-2 text-xs text-slate-500" data-testid="concept-chat-loading">
              考えています…
            </p>
          )}

          {/* エラー状態。相談できなくても、題材を直接入力すれば生成には進める。 */}
          {chat.isError && (
            <p className="mt-2 flex gap-2 text-xs text-red-700" data-testid="concept-chat-error">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="leading-5">
                相談を利用できませんでした。もう一度送信するか、下の題材入力から直接たたき台を作れます。
              </span>
            </p>
          )}

          {/* 選択肢。選ぶだけで前に進める。自由に書いてもよい。 */}
          {!chat.isPending && conceptChoices.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {conceptChoices.map((choice) => (
                <li key={choice}>
                  <Button variant="secondary" className="text-xs" onClick={() => send(choice)}>
                    {choice}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submit} className="mt-3 space-y-2">
            <label className="text-xs font-bold" htmlFor="concept-chat-input">
              返事を書く
            </label>
            <Textarea
              id="concept-chat-input"
              rows={2}
              maxLength={maxMessageLength}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例：近所の家族連れに来てほしい"
            />
            {/* 左パネルは狭く、横並びにすると「送信」が2行に割れる。縦に積んで文字を折らせない。 */}
            <Button className="w-full whitespace-nowrap" disabled={!input.trim() || chat.isPending}>
              <Send className="mr-2 size-4" />
              送信
            </Button>
            <Button type="button" variant="ghost" className="w-full whitespace-nowrap" onClick={startOver}>
              やり直す
            </Button>
          </form>

          {decided.length > 0 && (
            <dl className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3 text-xs" data-testid="concept-draft">
              {decided.map((item) => (
                <div key={item.label} className="flex gap-2">
                  <dt className="shrink-0 font-bold text-slate-500">{item.label}</dt>
                  <dd className="text-slate-800">{item.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {!ready && missing.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              あと「{missing.map((field) => requiredFieldLabels[field] ?? field).join("」「")}」が決まると生成できます。
            </p>
          )}

          {ready && (
            /* 返事の送信中は押させない。応答を待っている間に押すと、
               まだ反映されていない内容でたたき台ができてしまう。 */
            <Button
              className="mt-3 w-full"
              disabled={generating || chat.isPending}
              onClick={() => onGenerate(conceptDraft)}
              data-testid="generate-from-concept"
            >
              <Sparkles className="mr-2 size-4" />
              {generating ? "生成中…" : "このコンセプトで生成"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
