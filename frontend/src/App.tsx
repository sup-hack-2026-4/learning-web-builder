import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Tabs } from "@/components/ui/tabs";
import { StepNav } from "@/components/step-nav";
import { AuthControls } from "@/features/auth/auth-controls";
import { clerkConfig } from "@/features/auth/config";
import { useChangeTracking } from "@/features/change-tracking/use-change-tracking";
import { ConceptChatPanel } from "@/features/concept/chat-panel";
import { useExportZip } from "@/features/export/use-export-zip";
import { TopicForm } from "@/features/generation/topic-form";
import { useSiteGeneration } from "@/features/generation/use-site-generation";
import { nextAction, stepViews, type FlowState } from "@/features/learning-flow/steps";
import { captureFocusOrigin, type Notice, type NoticeTone } from "@/features/notice/notice";
import { NoticeBar } from "@/features/notice/notice-bar";
import { DesignPanel } from "@/features/panels/design-panel";
import { ExplanationPanel } from "@/features/panels/explanation-panel";
import { QualityPanel } from "@/features/panels/quality-panel";
import { SidePanel, type PanelKey } from "@/features/panels/side-panel";
import { PreviewArea } from "@/features/preview/preview-area";
import { ProjectControls } from "@/features/projects/project-controls";
import { useProjectLink } from "@/features/projects/use-project-link";
import { useQualityChecks } from "@/features/quality/use-quality-checks";
import { LearningNotes } from "@/features/sections/learning-notes";
import { SectionList } from "@/features/sections/section-list";
import type { LearningRecord } from "@/features/site-model/schema";
import { onPersistFailure, useBuilderStore } from "@/features/site-model/store";

// 狭い画面では3カラムを縦に積むと極端に見づらいため、
// プレビューを主役に据え、他はここで切り替える。
type MobileView = "preview" | "setup" | "panel";

const mobileViewLabels: Record<MobileView, string> = {
  preview: "プレビュー",
  setup: "題材・メモ",
  panel: "調整と学習",
};

// 画面の配置と、各機能のつなぎ込みだけを受け持つ。
// 変更と理由の記録、生成、品質チェックなどの中身は、それぞれのフックと部品に置く。
export default function App() {
  const { site, notes, aiUsage, siteOrigin, loadSite, selectElement, reset } = useBuilderStore();
  // 作業が切り替わると、保存先のプロジェクトとの対応は自動的に外れる。
  const { currentProjectId, setCurrentProjectId } = useProjectLink();
  // 最初の案内は操作の結果ではなく、画面の説明として最初から置いておく。
  // 初回の描画から文言が入っているため、ライブ通知としては読み上げられない（通常の内容として読める）。
  const [notice, setNotice] = useState<Notice | null>({
    id: 0,
    message: "見本のサイトで開始しています。題材を入力すると、たたき台を生成できます。",
    tone: "status",
    returnFocusTo: null,
  });
  // 閉じたときの戻り先は、同期の操作ならいまのフォーカス元でよい。
  // 生成や保存のように結果が遅れて届く操作は、完了時にはフォーカスが別の場所
  // （通知の閉じるボタンなど）へ移っていることがあるため、開始時に取った要素を渡す。
  const showNotice = useCallback(
    (message: string, tone: NoticeTone = "status", returnFocusTo: HTMLElement | null = captureFocusOrigin()) => {
      setNotice((current) => ({ id: (current?.id ?? 0) + 1, message, tone, returnFocusTo }));
    },
    [],
  );
  // 右カラムは縦に積むと画面へ収まらないため、常に1パネルだけ表示する。
  const [activePanel, setActivePanel] = useState<PanelKey>("design");
  // 畳むとプレビューがPC幅まで広がり、出力時に近い見た目を確認できる。
  const [panelOpen, setPanelOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  // 狭い画面用。xl以上では使わず、3カラムを同時に表示する。
  const [mobileView, setMobileView] = useState<MobileView>("preview");
  // 領域をまたいでフォーカスを移す先。一覧の見出しと、編集欄の見出し。
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedSectionHeadingRef = useRef<HTMLHeadingElement>(null);

  // 下書きはブラウザへ保存している。書けなかったときは、再読み込みで変更と記録が失われうるため知らせる。
  useEffect(
    () =>
      onPersistFailure(() =>
        showNotice(
          "ブラウザへの下書きの保存に失敗しました。容量が足りない可能性があります。画像を減らすか、提出物ZIPやアカウントへの保存で作品を残してください。",
          "error",
        ),
      ),
    [showNotice],
  );

  const tracking = useChangeTracking(showNotice);
  // サイトが差し替わる操作（生成・リセット・読み込み）のあとに共通して行う後始末。
  // 作品の出どころ（読み込んだプロジェクトかどうか）はstoreが差し替えと同時に持つ。
  const afterSiteReplaced = () => {
    tracking.discard();
  };
  const generation = useSiteGeneration({ showNotice, onSiteReplaced: afterSiteReplaced });
  const exportZip = useExportZip(showNotice);
  const qualityChecks = useQualityChecks(site, showNotice);
  const { axeAudit, hasQualityIssue } = qualityChecks;

  // 学習の工程を、いまの画面の状態から導く。
  const flowState: FlowState = useMemo(
    () => ({
      topicReady: generation.topic.trim().length > 0,
      // 生成したかどうかは、AIの利用記録が「初期サンプル」以外を含むかで見る。
      generated: siteOrigin === "project" || aiUsage.some((usage) => usage.purpose !== "初期サンプル"),
      unexplainedCount: tracking.unexplainedCount,
      // コンセプトの記録だけでは、調整とその理由説明を終えたことにはならない。
      explainedCount: notes.filter((note) => note.target !== "コンセプト").length,
      noteCount: notes.length,
    }),
    [generation.topic, siteOrigin, aiUsage, tracking.unexplainedCount, notes],
  );
  const steps = useMemo(() => stepViews(flowState), [flowState]);
  const nextToDo = useMemo(() => nextAction(flowState), [flowState]);
  const learningRecord: LearningRecord = useMemo(() => ({ notes, aiUsage }), [notes, aiUsage]);

  // 一覧は左カラム（モバイルでは「題材・メモ」の表示）にある。畳んでいれば開き、
  // 描画を済ませてから一覧の見出しへフォーカスを移す。次のTabで最初のチェックボックスへ進める。
  const showSectionList = () => {
    flushSync(() => {
      setSetupOpen(true);
      setMobileView("setup");
    });
    sectionHeadingRef.current?.focus();
  };

  // 一覧からセクションを選んで編集を始める。プレビュー内のセクションはクリックでしか選べないため、
  // キーボードや読み上げで使う人の選び方はこちらになる。
  // 選んでも編集欄が見えていなければ意味がないので、右パネルのデザインタブを開き、
  // 描画を済ませてから編集欄の見出しへフォーカスを移す。
  const editSection = (sectionId: string) => {
    flushSync(() => {
      selectElement(sectionId);
      setActivePanel("design");
      setPanelOpen(true);
      setMobileView("panel");
    });
    selectedSectionHeadingRef.current?.focus();
  };

  const resetBuilder = () => {
    reset();
    afterSiteReplaced();
    showNotice("初期サンプルへ戻しました。");
  };

  const loadProject = (loadedSite: typeof site, record: LearningRecord) => {
    loadSite(loadedSite, record);
    afterSiteReplaced();
  };

  // ヘッダーはflex-wrapで高さが変わるため、縦flexで残り高さをグリッドへ渡し、
  // 高さの決め打ち(calc(100vh-73px))を避ける。
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 xl:h-screen">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <h1 className="text-2xl font-black tracking-tight text-blue-600">Whyve</h1>
          <StepNav steps={steps} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuthControls enabled={clerkConfig.enabled} />
          <ProjectControls
            enabled={clerkConfig.enabled}
            site={site}
            record={learningRecord}
            currentProjectId={currentProjectId}
            onProjectChange={setCurrentProjectId}
            onLoad={loadProject}
            onNotice={showNotice}
          />
          <Button variant="ghost" onClick={resetBuilder} icon={<RotateCcw className="size-4" />}>リセット</Button>
          {/* 提出の手前で、何件記録できていて何件未説明かが分かるようにする。
              「理由を書かずに提出してしまう」のを止めるための最後の目印。 */}
          <span className="text-xs text-slate-500">
            メモ<strong className="mx-0.5 text-slate-800">{notes.length}</strong>件
            {flowState.unexplainedCount > 0 && (
              <strong className="ml-2 text-warning">未説明{flowState.unexplainedCount}件</strong>
            )}
          </span>
          <Button
            loading={exportZip.isPending}
            icon={<Download className="size-4" />}
            onClick={() =>
              exportZip.mutate({
                site,
                notes,
                aiUsage,
                extraChecks: axeAudit.status === "ready" ? [axeAudit.check] : [],
                returnFocusTo: captureFocusOrigin(),
              })
            }
          >
            {exportZip.isPending ? "ZIP作成中…" : "提出物ZIP"}
          </Button>
        </div>
      </header>

      <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />

      {/* 左右のカラムを畳むとプレビューが広がり、PC幅での見た目を確認できる。畳んでもつまみは残す。 */}
      <div className={`grid grid-cols-1 xl:min-h-0 xl:flex-1 ${setupOpen ? "xl:grid-cols-[340px_minmax(0,1fr)_var(--panel-w)]" : "xl:grid-cols-[40px_minmax(0,1fr)_var(--panel-w)]"}`} style={{ "--panel-w": panelOpen ? "350px" : "60px" } as CSSProperties}>
        {/* 3つの領域は、それぞれランドマーク（aside・main）の内側に、下部バーのタブから参照される
            tabpanelを置く。要素へ直接role="tabpanel"を付けると、ランドマークの意味が上書きされて
            支援技術から領域へ移動できなくなる。xl以上では3カラム同時表示になるが、
            タブ列自体がxl:hiddenで消えるため、関連付けが残っていても支障はない。 */}
        <aside
          aria-label="題材・メモ"
          className={`min-h-0 overflow-hidden border-r border-slate-200 bg-slate-100 xl:flex ${mobileView === "setup" ? "flex" : "hidden"}`}
        >
          <div id="view-setup" role="tabpanel" aria-labelledby="view-tab-setup" className="flex min-h-0 min-w-0 flex-1">
          {/* 畳んだときに残るつまみ。xl未満では下部バーで切り替えるため出さない。 */}
          <div className="order-2 hidden w-10 shrink-0 flex-col items-center bg-slate-100 py-3 xl:flex">
            <Button
              type="button"
              variant="quiet"
              size="icon"
              onClick={() => setSetupOpen((open) => !open)}
              aria-expanded={setupOpen}
              aria-label={setupOpen ? "題材・メモを畳んでプレビューを広げる" : "題材・メモを開く"}
              title={setupOpen ? "題材・メモを畳んでプレビューを広げる" : "題材・メモを開く"}
              className="rounded-l-none rounded-r-lg"
              icon={setupOpen ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            />
          </div>

          <div className={`flex-1 overflow-y-auto bg-white p-4 pb-20 xl:pb-4 ${setupOpen ? "block" : "block xl:hidden"}`}>
          <ConceptChatPanel onGenerate={generation.generateFromConcept} generating={generation.isPending} />
          <TopicForm generation={generation} />

          <Callout tone="warning" className="my-5">
            <strong>AI生成文は仮テキストです。</strong><br />事実情報は必ず自分で調べて入力してください。
          </Callout>

          <SectionList tracking={tracking} onEdit={editSection} headingRef={sectionHeadingRef} showNotice={showNotice} />
          <LearningNotes />
          </div>
          </div>
        </aside>

        <main
          className={`min-h-[70vh] min-w-0 flex-col p-4 pb-20 xl:flex xl:min-h-0 xl:pb-4 ${mobileView === "preview" ? "flex" : "hidden"}`}
        >
          <div id="view-preview" role="tabpanel" aria-labelledby="view-tab-preview" className="flex min-h-0 flex-1 flex-col">
            <PreviewArea baselineSite={tracking.baselineSite} onShowSectionList={showSectionList} />
          </div>
        </main>

        <aside
          aria-label="調整と学習"
          className={`min-h-0 overflow-hidden border-l border-slate-200 bg-slate-100 xl:flex ${mobileView === "panel" ? "flex" : "hidden"}`}
        >
          <div id="view-panel" role="tabpanel" aria-labelledby="view-tab-panel" className="flex min-h-0 min-w-0 flex-1">
            <SidePanel
              activePanel={activePanel}
              onActivePanelChange={setActivePanel}
              panelOpen={panelOpen}
              onPanelOpenChange={setPanelOpen}
              hasQualityIssue={hasQualityIssue}
              nextToDo={nextToDo}
            >
              {activePanel === "design" && <DesignPanel tracking={tracking} selectedSectionHeadingRef={selectedSectionHeadingRef} />}
              {activePanel === "explanation" && <ExplanationPanel />}
              {activePanel === "quality" && <QualityPanel checks={qualityChecks} />}
            </SidePanel>
          </div>
        </aside>
      </div>

      {/* 狭い画面用の切替バー。3カラムを縦積みすると見づらいため、1つずつ表示する。 */}
      {/* navへ直接role="tablist"を付けるとナビゲーションのランドマークが上書きされるため、内側に置く。 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur xl:hidden" aria-label="表示の切り替え">
        <Tabs
          label="表示の切り替え"
          items={(Object.keys(mobileViewLabels) as MobileView[]).map((key) => ({
            key,
            label: <>
              {mobileViewLabels[key]}
              {/* 赤い点は色だけで意味を持つため、読み上げには文字で伝える。 */}
              {key === "panel" && hasQualityIssue && (
                <>
                  <span aria-hidden className="ml-1 inline-block size-1.5 rounded-full bg-danger-vivid align-middle" />
                  <span className="sr-only">（問題あり）</span>
                </>
              )}
            </>,
          }))}
          value={mobileView}
          onValueChange={setMobileView}
          tabId={(key) => `view-tab-${key}`}
          panelId={(key) => `view-${key}`}
          variant="bar"
        />
      </nav>
    </div>
  );
}
