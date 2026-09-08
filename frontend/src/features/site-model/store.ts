import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSampleSite } from "./sample";
import { createSection, maxSections, minSections, type SectionKind } from "./sections";
import type { AiUsage, LearningNote, SiteModel } from "./schema";
import { conceptStateSchema, emptyDraft, trimHistory, type ChatMessage, type ConceptDraft } from "@/features/concept/schema";

type BuilderState = {
  site: SiteModel;
  selectedElementId: string;
  notes: LearningNote[];
  aiUsage: AiUsage[];
  // purpose は AI をどう使ったかの記録。コンセプト相談を経た生成だけ文言が変わる。
  setSite: (site: SiteModel, provider: AiUsage["provider"], purpose?: string) => void;
  loadSite: (site: SiteModel) => void;
  selectElement: (id: string) => void;
  // テーマの更新はプレビュー反映のみ。学習メモはApp側の明示的な記録操作でaddNoteする。
  // 見出しの色は「未指定（メインカラーを継承）」も正しい状態なので、undefinedも受け取る。
  previewTheme: (key: keyof SiteModel["theme"], value: string | number | undefined) => void;
  updateSection: (id: string, values: Partial<SiteModel["sections"][number]>, reason?: string, codeChanges?: string[]) => void;
  // 構成そのものを変える操作。理由の記録はApp側でまとめて行うため、ここでは受け取らない。
  // 「何を足すか・何を削るか」の判断は、色の調整より粒度が大きく、
  // まとめて1件の説明として残したほうが読み返せるため。
  addSection: (kind: SectionKind) => void;
  removeSection: (id: string) => void;
  addNote: (target: string, reason: string, codeChanges?: string[]) => void;
  reset: () => void;
  // 生成前のコンセプト相談。SiteModelとは独立に持つ。
  // 生成してもここは消さない。何を決めて生成したのかを後から見返せるようにするため。
  // ただしリセットや別プロジェクトの読み込みでは消す（別の題材の相談が残ると混乱する）。
  chatMessages: ChatMessage[];
  conceptDraft: ConceptDraft;
  // 直近の応答に付いてきた選択肢。会話と一緒に保存しないと、
  // 再読み込みしたときだけ選択肢が消えて、続きを進めにくくなる。
  conceptChoices: string[];
  // 相談をやり直した回数。応答が返るころに会話が作り直されていたら、
  // 古い応答だと分かるようにする。
  conceptGeneration: number;
  appendChatMessage: (message: ChatMessage) => void;
  // 楽観的に足した発言を取り消す。送信が失敗したときに使う。
  dropLastChatMessage: () => void;
  setConceptReply: (draft: ConceptDraft, choices: string[]) => void;
  resetConcept: () => void;
};

const emptyConcept = {
  chatMessages: [] as ChatMessage[],
  conceptDraft: emptyDraft,
  conceptChoices: [] as string[],
};

const initialSite = createSampleSite();

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set) => ({
      site: initialSite,
      selectedElementId: "hero",
      notes: [],
      aiUsage: [{ provider: "static-sample", purpose: "初期サンプル", generatedAt: new Date().toISOString() }],
      setSite: (site, provider, purpose) =>
        set({
          site,
          selectedElementId: "hero",
          notes: [],
          aiUsage: [{
            provider,
            purpose: purpose ?? "サイト構成と仮文章の生成",
            generatedAt: new Date().toISOString(),
          }],
        }),
      loadSite: (site) =>
        set((state) => ({
          site,
          selectedElementId: "hero",
          notes: [],
          aiUsage: [],
          // 別のプロジェクトを開いたら、前の題材の相談は残さない。
          ...emptyConcept,
          conceptGeneration: state.conceptGeneration + 1,
        })),
      selectElement: (selectedElementId) => set({ selectedElementId }),
      previewTheme: (key, value) =>
        set((state) => {
          const theme = { ...state.site.theme };
          // undefinedを値として持たせると「未指定」ではなく「未指定という値」になり、
          // 保存時のスキーマ検証やCSS生成の分岐がぶれるため、キーごと消す。
          if (value === undefined) delete theme[key];
          else Object.assign(theme, { [key]: value });
          return { site: { ...state.site, theme } };
        }),
      updateSection: (id, values, reason, codeChanges) =>
        set((state) => {
          const target = state.site.sections.find((section) => section.id === id);
          const targetLabel = target?.title ?? id;
          return {
            site: {
              ...state.site,
              sections: state.site.sections.map((section) =>
                section.id === id ? { ...section, ...values } : section,
              ),
            },
            notes: reason
              ? [...state.notes, { id: crypto.randomUUID(), target: `表示切替（${targetLabel}）`, reason, createdAt: new Date().toISOString(), codeChanges }]
              : state.notes,
          };
        }),
      addSection: (kind) =>
        set((state) => {
          // 上限はスキーマとサーバー側の検証と同じ。画面側でボタンを無効にしていても、
          // ここを最後の砦として残しておく。
          if (state.site.sections.length >= maxSections) return {};
          const section = createSection(kind, state.site.sections.map((existing) => existing.id));
          return {
            site: { ...state.site, sections: [...state.site.sections, section] },
            // 追加したセクションを選択状態にする。追加直後に中身を書き始められるようにするため。
            selectedElementId: section.id,
          };
        }),
      removeSection: (id) =>
        set((state) => {
          if (state.site.sections.length <= minSections) return {};
          const sections = state.site.sections.filter((section) => section.id !== id);
          // 存在しないidなら何もしない。件数だけ減ると、消えた理由が追えなくなる。
          if (sections.length === state.site.sections.length) return {};
          return {
            site: { ...state.site, sections },
            // 消したセクションを選んだままだと、右パネルの編集欄が消えて何も選べなくなる。
            selectedElementId:
              state.selectedElementId === id ? sections[0].id : state.selectedElementId,
          };
        }),
      addNote: (target, reason, codeChanges) =>
        set((state) => ({
          notes: [...state.notes, { id: crypto.randomUUID(), target, reason, createdAt: new Date().toISOString(), codeChanges }],
        })),
      reset: () =>
        set((state) => ({
          site: createSampleSite(),
          selectedElementId: "hero",
          notes: [],
          aiUsage: [],
          ...emptyConcept,
          conceptGeneration: state.conceptGeneration + 1,
        })),
      ...emptyConcept,
      conceptGeneration: 0,
      appendChatMessage: (message) =>
        set((state) => ({ chatMessages: trimHistory([...state.chatMessages, message]) })),
      dropLastChatMessage: () =>
        set((state) => ({ chatMessages: state.chatMessages.slice(0, -1) })),
      setConceptReply: (conceptDraft, conceptChoices) => set({ conceptDraft, conceptChoices }),
      resetConcept: () =>
        set((state) => ({ ...emptyConcept, conceptGeneration: state.conceptGeneration + 1 })),
    }),
    {
      name: "learning-web-builder-draft-v1",
      version: 2,
      // v1には相談の項目が無い。壊れた値や古い形式のまま読み込むと、
      // 描画中に例外になって画面ごと落ちるため、ここで形をそろえる。
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 2) {
          return { ...state, ...conceptStateSchema.parse(state) };
        }
        return { ...state, ...emptyConcept, conceptGeneration: 0 };
      },
      partialize: (state) => ({
        site: state.site,
        selectedElementId: state.selectedElementId,
        notes: state.notes,
        aiUsage: state.aiUsage,
        chatMessages: state.chatMessages,
        conceptDraft: state.conceptDraft,
        conceptChoices: state.conceptChoices,
      }),
    },
  ),
);
