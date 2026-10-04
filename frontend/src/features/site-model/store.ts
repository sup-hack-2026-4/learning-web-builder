import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSampleSite, fitSiteTextLimits } from "./sample";
import { createSection, maxSections, minSections, type SectionKind } from "./sections";
import type { AiUsage, LearningNote, LearningRecord, SectionImage, SiteModel, SiteSection } from "./schema";
import { conceptStateSchema, emptyDraft, trimHistory, type ChatMessage, type ConceptDraft } from "@/features/concept/schema";
import { packTracking, restoreTracking, trackingFromSite, type TrackingState } from "@/features/change-tracking/tracking-state";

export type BuilderState = {
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
  // いまの状態から次の状態を作り、1回の更新で確定する。
  // サイトの変更と変更記録の更新を分けると、間で保存が失敗したときや、
  // 同じ描画の中で操作が続いたときに、両者が食い違ったまま残るため。
  commit: (recipe: (state: BuilderState) => Partial<BuilderState>) => void;
  // 記録されないまま残っている変更を捨て、いまのサイトを基準にする。
  discardTracking: () => void;
  // 作業の世代。サイトが丸ごと差し替わるたび（生成・読み込み・リセット・別タブでの差し替え）に進む。
  // 保存・生成・読み込み・画像処理のように結果が遅れて届く処理は、始めた時点の世代を覚えておき、
  // 届いたときに世代が変わっていれば、いまの作業へ反映しない(#115)。
  // タブごとの値なので保存しない。
  siteGeneration: number;
  // 作品を丸ごと差し替えるたびに新しくなるid。こちらは保存し、別のタブでの差し替えを見分けるのに使う。
  // サイトのidでは見分けられない。「新しいプロジェクト」として保存し直しても、サイトのidは変わらないため、
  // 別々のプロジェクトが同じサイトのidを持ちうる。
  workspaceId: string;
  // いまの作品の出どころ。工程の表示（生成を済ませたか）に使う。
  // 保存して別のタブとも同期し、別のタブでリセットしたのに「読み込み済み」のまま残らないようにする。
  siteOrigin: SiteOrigin;
  // セクションを削除した回数。削除したidは次の追加で使い回されるため、idだけでは
  // 「処理を始めたときと同じセクションか」を見分けられない。画像の処理で、途中の削除を検出するのに使う。
  sectionRemovals: number;
};

export type SiteOrigin = "sample" | "generated" | "project";
const siteOrigins: readonly SiteOrigin[] = ["sample", "generated", "project"];

// 以下は、状態から次の状態を作る関数。storeの操作と変更記録（useChangeTracking）の両方から使う。

export function withThemeValue(site: SiteModel, key: keyof SiteModel["theme"], value: string | number | undefined): SiteModel {
  const theme = { ...site.theme };
  // undefinedを値として持たせると「未指定」ではなく「未指定という値」になり、
  // 保存時のスキーマ検証やCSS生成の分岐がぶれるため、キーごと消す。
  if (value === undefined) delete theme[key];
  else Object.assign(theme, { [key]: value });
  return { ...site, theme };
}

export function withSectionValues(site: SiteModel, id: string, values: Partial<SiteSection>): SiteModel {
  return {
    ...site,
    sections: site.sections.map((section) => (section.id === id ? { ...section, ...values } : section)),
  };
}

export function appendNote(notes: LearningNote[], target: string, reason: string, codeChanges?: string[]): LearningNote[] {
  return [...notes, { id: crypto.randomUUID(), target, reason, createdAt: new Date().toISOString(), codeChanges }];
}

// 追加できなければnullを返す。呼び出し側が、実際に追加できたときだけ記録を進められるようにするため。
export function sectionAdded(
  state: Pick<BuilderState, "site">,
  kind: SectionKind,
): { patch: Pick<BuilderState, "site" | "selectedElementId">; added: SiteSection } | null {
  // 上限はスキーマとサーバー側の検証と同じ。画面側でボタンを無効にしていても、
  // ここを最後の砦として残しておく。
  if (state.site.sections.length >= maxSections) return null;
  const added = createSection(kind, state.site.sections.map((existing) => existing.id));
  return {
    patch: {
      site: { ...state.site, sections: [...state.site.sections, added] },
      // 追加したセクションを選択状態にする。追加直後に中身を書き始められるようにするため。
      selectedElementId: added.id,
    },
    added,
  };
}

// 削除できなければnullを返す。
export function sectionRemoved(
  state: Pick<BuilderState, "site" | "selectedElementId" | "sectionRemovals">,
  id: string,
): Pick<BuilderState, "site" | "selectedElementId" | "sectionRemovals"> | null {
  if (state.site.sections.length <= minSections) return null;
  const sections = state.site.sections.filter((section) => section.id !== id);
  // 存在しないidなら何もしない。件数だけ減ると、消えた理由が追えなくなる。
  if (sections.length === state.site.sections.length) return null;
  return {
    site: { ...state.site, sections },
    // 消したセクションを選んだままだと、右パネルの編集欄が消えて何も選べなくなる。
    selectedElementId: state.selectedElementId === id ? sections[0].id : state.selectedElementId,
    sectionRemovals: state.sectionRemovals + 1,
  };
}

// ブラウザへの保存に失敗したことを画面へ伝える。
// 失敗しても操作そのものは止めない。止めると、画面の状態と記録が食い違ったまま残るため。
const persistFailureListeners = new Set<() => void>();
// 失敗が続いている間は知らせ直さない。理由の入力のように1文字ごとに保存する操作で、通知が繰り返されないようにするため。
let persistFailing = false;

export function onPersistFailure(listener: () => void): () => void {
  persistFailureListeners.add(listener);
  return () => {
    persistFailureListeners.delete(listener);
  };
}

const draftStorage = createJSONStorage(() => {
  const storage = localStorage;
  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => {
      try {
        storage.setItem(name, value);
        persistFailing = false;
      } catch {
        // 容量超過などで書けなかった。次の変更で改めて全体を書き込むため、ここでは知らせるだけにする。
        if (persistFailing) return;
        persistFailing = true;
        persistFailureListeners.forEach((listener) => listener());
      }
    },
    removeItem: (name: string) => storage.removeItem(name),
  };
});

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
        set((state) => ({
          site,
          selectedElementId: site.sections[0]?.id ?? "hero",
          notes: [],
          aiUsage: [{
            provider,
            purpose: purpose ?? "サイト構成と仮文章の生成",
            generatedAt: new Date().toISOString(),
          }],
          tracking: trackingFromSite(site),
          siteGeneration: state.siteGeneration + 1,
          workspaceId: crypto.randomUUID(),
          siteOrigin: "generated",
        })),
      loadSite: (site, record) =>
        set((state) => ({
          site,
          selectedElementId: site.sections[0]?.id ?? "hero",
          notes: record.notes,
          aiUsage: record.aiUsage,
          tracking: trackingFromSite(site),
          siteGeneration: state.siteGeneration + 1,
          workspaceId: crypto.randomUUID(),
          siteOrigin: "project",
          // 別のプロジェクトを開いたら、前の題材の相談は残さない。
          ...emptyConcept,
          conceptGeneration: state.conceptGeneration + 1,
        })),
      selectElement: (selectedElementId) => set({ selectedElementId }),
      previewTheme: (key, value) => set((state) => ({ site: withThemeValue(state.site, key, value) })),
      updateSection: (id, values, reason, codeChanges) =>
        set((state) => {
          const target = state.site.sections.find((section) => section.id === id);
          const targetLabel = target?.title ?? id;
          return {
            site: withSectionValues(state.site, id, values),
            notes: reason ? appendNote(state.notes, `表示切替（${targetLabel}）`, reason, codeChanges) : state.notes,
          };
        }),
      addSection: (kind) => set((state) => sectionAdded(state, kind)?.patch ?? {}),
      removeSection: (id) => set((state) => sectionRemoved(state, id) ?? {}),
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
        set((state) => ({ notes: appendNote(state.notes, target, reason, codeChanges) })),
      reset: () =>
        set((state) => {
          const site = createSampleSite();
          return {
            site,
            selectedElementId: "hero",
            notes: [],
            aiUsage: [],
            tracking: trackingFromSite(site),
            siteGeneration: state.siteGeneration + 1,
            workspaceId: crypto.randomUUID(),
            siteOrigin: "sample",
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
      commit: (recipe) => set((state) => recipe(state)),
      discardTracking: () => set((state) => ({ tracking: trackingFromSite(state.site) })),
      siteGeneration: 0,
      workspaceId: crypto.randomUUID(),
      siteOrigin: "sample",
      sectionRemovals: 0,
    }),
    {
      name: "learning-web-builder-draft-v1",
      storage: draftStorage,
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
      // 確かめるのは保存されていた記録そのもの。起動時の初期値と混ぜると、記録を持たない
      // 以前の保存内容で、初期サンプルが基準として残ってしまう。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BuilderState> & { tracking?: unknown };
        const restored = { ...current, ...saved };
        // 以前の版の下書きには、編集欄の無い項目が上限を超えたまま残っていることがある(#130)。
        const merged = { ...restored, site: restored.site ? fitSiteTextLimits(restored.site) : restored.site };
        // 別のタブで作品が差し替わっていたら、このタブでも作業が切り替わったものとして世代を進める。
        // 差し替えのidを持たない以前の保存内容は、サイトのidで代わりに見分ける。
        const workspaceId = typeof saved.workspaceId === "string" ? saved.workspaceId : crypto.randomUUID();
        const siteReplaced =
          typeof saved.workspaceId === "string"
            ? saved.workspaceId !== current.workspaceId
            : merged.site.id !== current.site.id;
        return {
          ...merged,
          tracking: restoreTracking(saved.tracking, merged.site),
          siteGeneration: siteReplaced ? current.siteGeneration + 1 : current.siteGeneration,
          workspaceId,
          // 出どころを持たない以前の保存内容は、見本として扱う（これまでも再読み込みで見本扱いに戻っていた）。
          siteOrigin: siteOrigins.includes(saved.siteOrigin as SiteOrigin) ? (saved.siteOrigin as SiteOrigin) : "sample",
        };
      },
      partialize: (state) => ({
        site: state.site,
        selectedElementId: state.selectedElementId,
        notes: state.notes,
        aiUsage: state.aiUsage,
        chatMessages: state.chatMessages,
        conceptDraft: state.conceptDraft,
        conceptChoices: state.conceptChoices,
        tracking: packTracking(state.tracking, state.site),
        workspaceId: state.workspaceId,
        siteOrigin: state.siteOrigin,
      }),
    },
  ),
);

// 同じ下書きを別のタブでも開いていると、あとから書いたタブが相手の変更を古い内容で上書きしてしまう。
// 別のタブが書き込んだら、その内容を読み込み直してそろえる。どのタブも操作のたびに全体を保存しているため、
// 読み込み直した時点の保存内容には、このタブのそれまでの変更も含まれている。
// 保存内容が消されたとき（newValueがnull）は、読み込む記録が無いので、いまの状態を残す。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage || event.key !== useBuilderStore.persist.getOptions().name) return;
    if (event.newValue === null) return;
    void useBuilderStore.persist.rehydrate();
  });
}

// 処理を始める時点で呼び、あとで「その作業がまだ続いているか」を確かめる関数を受け取る。
export function captureSiteGeneration(): () => boolean {
  const generation = useBuilderStore.getState().siteGeneration;
  return () => useBuilderStore.getState().siteGeneration === generation;
}
