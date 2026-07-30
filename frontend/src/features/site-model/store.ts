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
  loadSite: (site: SiteModel) => void;
  selectElement: (id: string) => void;
  updateTheme: (key: keyof SiteModel["theme"], value: string | number, reason: string) => void;
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
      loadSite: (site) =>
        set({
          site,
          selectedElementId: "hero",
          notes: [],
          aiUsage: [],
        }),
      selectElement: (selectedElementId) => set({ selectedElementId }),
      updateTheme: (key, value, reason) =>
        set((state) => ({
          site: { ...state.site, theme: { ...state.site.theme, [key]: value } },
          notes: [
            ...state.notes,
            { id: crypto.randomUUID(), target: `デザイン: ${key}`, reason, createdAt: new Date().toISOString() },
          ],
        })),
      updateSection: (id, values, reason) =>
        set((state) => ({
          site: {
            ...state.site,
            sections: state.site.sections.map((section) =>
              section.id === id ? { ...section, ...values } : section,
            ),
          },
          notes: reason
            ? [...state.notes, { id: crypto.randomUUID(), target: `内容: ${id}`, reason, createdAt: new Date().toISOString() }]
            : state.notes,
        })),
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
