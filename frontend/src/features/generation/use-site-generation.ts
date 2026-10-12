import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTokenProvider } from "@/features/auth/token-provider";
import { conceptSummary, type ConceptDraft } from "@/features/concept/schema";
import { captureFocusOrigin, type ShowNotice } from "@/features/notice/notice";
import { createSampleSite } from "@/features/site-model/sample";
import { topicProblem } from "@/features/site-model/schema";
import { captureSiteGeneration, useBuilderStore } from "@/features/site-model/store";
import { AiBusyError, GenerateInputError, generateSite } from "@/lib/api";

type UseSiteGenerationOptions = {
  showNotice: ShowNotice;
  // サイトが差し替わった直後に呼ぶ。記録前の変更や、読み込んだプロジェクトとの対応を捨てるため。
  onSiteReplaced: () => void;
};

// 題材またはコンセプトから、たたき台を生成する。
// AIを使えないときは見本のサイトで代わりにし、生成の成否にかかわらず作業を続けられるようにする。
export function useSiteGeneration({ showNotice, onSiteReplaced }: UseSiteGenerationOptions) {
  const { setSite, addNote } = useBuilderStore();
  const getToken = useTokenProvider();
  const [topic, setTopic] = useState("");

  const generation = useMutation({
    mutationFn: async ({ topic: nextTopic, concept }: {
      topic: string;
      concept?: ConceptDraft;
      returnFocusTo: HTMLElement | null;
      isCurrent: () => boolean;
    }) => {
      try {
        return { ...await generateSite(nextTopic, getToken, concept), concept };
      } catch (error) {
        // 入力の誤りは見本で隠さず、直してもらう。通信やサーバーの障害のときだけ見本で作業を続ける(#117)。
        if (error instanceof GenerateInputError) throw error;
        // 回数制限や混雑は、少し待てばAIで生成できる。見本に置き換えると、いまの作品を見本で上書きしてしまう(#133)。
        if (error instanceof AiBusyError) throw error;
        return { site: createSampleSite(nextTopic), provider: "static-sample" as const, concept };
      }
    },
    onSuccess: ({ site: generatedSite, provider, concept }, { returnFocusTo, isCurrent }) => {
      // 生成の間にプロジェクトの読み込みやリセットで作業が切り替わっていたら、いまの作品を上書きしない(#115)。
      if (!isCurrent()) {
        showNotice("生成中に作業を切り替えたため、生成したたたき台は反映しませんでした。", "status", returnFocusTo);
        return;
      }
      const viaConcept = concept !== undefined;
      setSite(generatedSite, provider, viaConcept ? "コンセプト相談と、サイト構成・仮文章の生成" : undefined);
      // サイトが差し替わると、記録前の変更内容は新しいサイトに対して意味を持たない。
      // 残したままだと、触れていない初期値を変更として誤記録してしまう。
      onSiteReplaced();
      // 相談で決めたことは、生成した本人の判断そのもの。学習メモに残して提出物へ含める。
      // setSite がメモを空にするため、必ずそのあとで記録する。
      if (concept) {
        addNote("コンセプト", conceptSummary(concept));
      }
      showNotice(
        provider === "gemini" ? "AIでたたき台を生成しました。事実情報を確認してください。" : "AIでの生成を利用できなかったため、見本のたたき台を用意しました。文章を題材に合わせて書き換えてください。",
        "status",
        returnFocusTo,
      );
    },
    onError: (error, { returnFocusTo, isCurrent }) => {
      if (!isCurrent()) return;
      showNotice(error.message, "error", returnFocusTo);
    },
  });

  // 題材の入力欄に出すエラー。送る前に同じ判定で止め、サーバーに断られてから知るのを避ける。
  const topicError = topicProblem(topic);

  const submitTopic = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim() || topicError) return;
    generation.mutate({ topic: topic.trim(), returnFocusTo: captureFocusOrigin(), isCurrent: captureSiteGeneration() });
  };

  // 相談で固めたコンセプトからたたき台を作る。
  // 題材欄にも反映して、あとから題材だけ変えて作り直せるようにする。
  const generateFromConcept = (draft: ConceptDraft) => {
    const nextTopic = draft.topic.trim();
    if (!nextTopic) return;
    const problem = topicProblem(nextTopic);
    if (problem) {
      showNotice(problem, "error");
      return;
    }
    setTopic(nextTopic);
    generation.mutate({ topic: nextTopic, concept: draft, returnFocusTo: captureFocusOrigin(), isCurrent: captureSiteGeneration() });
  };

  return { topic, setTopic, topicError, submitTopic, generateFromConcept, isPending: generation.isPending };
}

export type SiteGeneration = ReturnType<typeof useSiteGeneration>;
