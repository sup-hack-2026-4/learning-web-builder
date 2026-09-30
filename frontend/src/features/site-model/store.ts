import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSampleSite } from "./sample";
import { createSection, maxSections, minSections, type SectionKind } from "./sections";
import type { AiUsage, LearningNote, LearningRecord, SectionImage, SiteModel } from "./schema";
import { conceptStateSchema, emptyDraft, trimHistory, type ChatMessage, type ConceptDraft } from "@/features/concept/schema";
import { restoreTracking, trackingFromSite, type TrackingState } from "@/features/change-tracking/tracking-state";

type BuilderState = {
  site: SiteModel;
  selectedElementId: string;
  notes: LearningNote[];
  aiUsage: AiUsage[];
  // purpose は AI をどう使ったかの記録。コンセプト相談を経た生成だけ文言が変わる。
  setSite: (site: SiteModel, provider: AiUsage["provider"], purpose?: string) => void;
  // 保存済みの作品を開く。学習の記録も作品と一緒に保存しているので、そのまま戻す。
  loadSite: (site: SiteModel, record: LearningRecord) => void;
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
  // 画像の差し替えと削除。上限の判定と理由の表示はApp側で行い、ここは最後の砦として置く。
  // 削除はキーごと消す。undefinedを値として残すと「未設定」ではなく「未設定という値」になり、
  // 保存時のスキーマ検証やHTML生成の分岐がぶれる。
  setSectionImage: (id: string, image: SectionImage) => void;
  removeSectionImage: (id: string) => void;
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
  // 変更と、その理由の記録の途中経過。更新はuseChangeTrackingを通して行う。
  // サイトが差し替わる操作（生成・読み込み・リセット）では、同じ更新の中で新しいサイトを基準にする。
  // 別々に更新すると、差し替え後のサイトと古い基準の組が保存されうるため。
  tracking: TrackingState;
  updateTracking: (update: (tracking: TrackingState) => Partial<TrackingState>) => void;
  // 記録されないまま残っている変更を捨て、いまのサイトを基準にする。
  discardTracking: () => void;
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
          selectedElementId: site.sections[0]?.id ?? "hero",
          notes: [],
          aiUsage: [{
            provider,
            purpose: purpose ?? "サイト構成と仮文章の生成",
            generatedAt: new Date().toISOString(),
          }],
          tracking: trackingFromSite(site),
        }),
      loadSite: (site, record) =>
        set((state) => ({
          site,
          selectedElementId: site.sections[0]?.id ?? "hero",
          notes: record.notes,
          aiUsage: record.aiUsage,
          tracking: trackingFromSite(site),
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
      setSectionImage: (id, image) =>
        set((state) => ({
          site: {
            ...state.site,
            sections: state.site.sections.map((section) =>
              // 基本情報のセクションは画像を出力しないため、持たせても提出物には現れない。
              // サーバー側の検証も弾くので、ここでも入れない。
              section.id === id && section.kind !== "contact" ? { ...section, image } : section,
            ),
          },
        })),
      removeSectionImage: (id) =>
        set((state) => ({
          site: {
            ...state.site,
            sections: state.site.sections.map((section) => {
              if (section.id !== id) return section;
              const next = { ...section };
              delete next.image;
              return next;
            }),
          },
        })),
      addNote: (target, reason, codeChanges) =>
        set((state) => ({
          notes: [...state.notes, { id: crypto.randomUUID(), target, reason, createdAt: new Date().toISOString(), codeChanges }],
        })),
      reset: () =>
        set((state) => {
          const site = createSampleSite();
          return {
            site,
            selectedElementId: "hero",
            notes: [],
            aiUsage: [],
            tracking: trackingFromSite(site),
            ...emptyConcept,
            conceptGeneration: state.conceptGeneration + 1,
          };
        }),
      ...emptyConcept,
      conceptGeneration: 0,
      appendChatMessage: (message) =>
        set((state) => ({ chatMessages: trimHistory([...state.chatMessages, message]) })),
      dropLastChatMessage: () =>
        set((state) => ({ chatMessages: state.chatMessages.slice(0, -1) })),
      setConceptReply: (conceptDraft, conceptChoices) => set({ conceptDraft, conceptChoices }),
      resetConcept: () =>
        set((state) => ({ ...emptyConcept, conceptGeneration: state.conceptGeneration + 1 })),
      tracking: trackingFromSite(initialSite),
      updateTracking: (update) => set((state) => ({ tracking: { ...state.tracking, ...update(state.tracking) } })),
      discardTracking: () => set((state) => ({ tracking: trackingFromSite(state.site) })),
    }),
    {
      name: "learning-web-builder-draft-v1",
      // v3で変更記録の途中経過を保存対象へ加えた。v2以前には無いため、読み込み時にサイトから作る。
      version: 3,
      // v1には相談の項目が無い。壊れた値や古い形式のまま読み込むと、
      // 描画中に例外になって画面ごと落ちるため、ここで形をそろえる。
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 2) {
          return { ...state, ...conceptStateSchema.parse(state) };
        }
        return { ...state, ...emptyConcept, conceptGeneration: 0 };
      },
      // 変更記録は、保存の版が同じでも壊れた値が入りうる。migrateは版が変わったときしか
      // 呼ばれないため、読み込みのたびにここで形を確かめる。
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<BuilderState>) };
        return { ...merged, tracking: restoreTracking(merged.tracking, merged.site) };
      },
      partialize: (state) => ({
        site: state.site,
        selectedElementId: state.selectedElementId,
        notes: state.notes,
        aiUsage: state.aiUsage,
        chatMessages: state.chatMessages,
        conceptDraft: state.conceptDraft,
        conceptChoices: state.conceptChoices,
        tracking: state.tracking,
      }),
    },
  ),
);
