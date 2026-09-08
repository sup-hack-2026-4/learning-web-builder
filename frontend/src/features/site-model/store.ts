import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSampleSite } from "./sample";
import type { AiUsage, LearningNote, SiteModel } from "./schema";
import { emptyDraft, trimHistory, type ChatMessage, type ConceptDraft } from "@/features/concept/schema";

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
  addNote: (target: string, reason: string, codeChanges?: string[]) => void;
  reset: () => void;
  // 生成前のコンセプト相談。SiteModelとは独立に持つ。
  // 生成してもここは消さない。何を決めて生成したのかを後から見返せるようにするため。
  chatMessages: ChatMessage[];
  conceptDraft: ConceptDraft;
  appendChatMessage: (message: ChatMessage) => void;
  setConceptDraft: (draft: ConceptDraft) => void;
  resetConcept: () => void;
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
        set({
          site,
          selectedElementId: "hero",
          notes: [],
          aiUsage: [],
        }),
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
      addNote: (target, reason, codeChanges) =>
        set((state) => ({
          notes: [...state.notes, { id: crypto.randomUUID(), target, reason, createdAt: new Date().toISOString(), codeChanges }],
        })),
      reset: () => set({ site: createSampleSite(), selectedElementId: "hero", notes: [], aiUsage: [] }),
      chatMessages: [],
      conceptDraft: emptyDraft,
      appendChatMessage: (message) =>
        set((state) => ({ chatMessages: trimHistory([...state.chatMessages, message]) })),
      setConceptDraft: (conceptDraft) => set({ conceptDraft }),
      resetConcept: () => set({ chatMessages: [], conceptDraft: emptyDraft }),
    }),
    {
      name: "learning-web-builder-draft-v1",
      partialize: (state) => ({
        site: state.site,
        selectedElementId: state.selectedElementId,
        notes: state.notes,
        aiUsage: state.aiUsage,
        chatMessages: state.chatMessages,
        conceptDraft: state.conceptDraft,
      }),
    },
  ),
);
