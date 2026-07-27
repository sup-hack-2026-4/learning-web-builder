import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSampleSite } from "./sample";
import type { AiUsage, LearningNote, SiteModel } from "./schema";

type BuilderState = {
  site: SiteModel;
  selectedElementId: string;
  notes: LearningNote[];
  aiUsage: AiUsage[];
  setSite: (site: SiteModel, provider: AiUsage["provider"]) => void;
  selectElement: (id: string) => void;
  // テーマの更新はプレビュー反映のみ。学習メモはApp側の明示的な記録操作でaddNoteする。
  previewTheme: (key: keyof SiteModel["theme"], value: string | number) => void;
  updateSection: (id: string, values: Partial<SiteModel["sections"][number]>, reason?: string) => void;
  addNote: (target: string, reason: string) => void;
  reset: () => void;
};

const initialSite = createSampleSite();

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set) => ({
      site: initialSite,
      selectedElementId: "hero",
      notes: [],
      aiUsage: [{ provider: "static-sample", purpose: "初期サンプル", generatedAt: new Date().toISOString() }],
      setSite: (site, provider) =>
        set({
          site,
          selectedElementId: "hero",
          notes: [],
          aiUsage: [{ provider, purpose: "サイト構成と仮文章の生成", generatedAt: new Date().toISOString() }],
        }),
      selectElement: (selectedElementId) => set({ selectedElementId }),
      previewTheme: (key, value) =>
        set((state) => ({
          site: { ...state.site, theme: { ...state.site.theme, [key]: value } },
        })),
      updateSection: (id, values, reason) =>
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
              ? [...state.notes, { id: crypto.randomUUID(), target: `表示切替（${targetLabel}）`, reason, createdAt: new Date().toISOString() }]
              : state.notes,
          };
        }),
      addNote: (target, reason) =>
        set((state) => ({
          notes: [...state.notes, { id: crypto.randomUUID(), target, reason, createdAt: new Date().toISOString() }],
        })),
      reset: () => set({ site: createSampleSite(), selectedElementId: "hero", notes: [], aiUsage: [] }),
    }),
    {
      name: "learning-web-builder-draft-v1",
      partialize: (state) => ({ site: state.site, selectedElementId: state.selectedElementId, notes: state.notes, aiUsage: state.aiUsage }),
    },
  ),
);
