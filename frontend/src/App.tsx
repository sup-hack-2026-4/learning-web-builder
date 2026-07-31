import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Download, Info, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SitePreview } from "@/components/site-preview";
import { AuthControls } from "@/features/auth/auth-controls";
import { clerkConfig } from "@/features/auth/config";
import { explanationDictionary } from "@/features/explanations/dictionary";
import { exportProject } from "@/features/export/export-project";
import { ProjectControls } from "@/features/projects/project-controls";
import { evaluateQuality } from "@/features/quality/evaluate-quality";
import { createSampleSite } from "@/features/site-model/sample";
import type { SiteModel } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";
import { generateSite } from "@/lib/api";

type ThemeKey = "primary" | "background" | "text" | "heading" | "fontFamily" | "spacing";

// 右カラムのパネル。縦積みだと画面に収まらないため、タブで1つずつ表示する。
type PanelKey = "design" | "explanation" | "quality";

const panelLabels: Record<PanelKey, string> = {
  design: "調整",
  explanation: "解説",
  quality: "品質",
};

// 狭い画面では3カラムを縦に積むと極端に見づらいため、
// プレビューを主役に据え、他はここで切り替える。
type MobileView = "preview" | "setup" | "panel";

const mobileViewLabels: Record<MobileView, string> = {
  preview: "プレビュー",
  setup: "題材・メモ",
  panel: "調整と学習",
};

// 学習メモ・ZIP出力に載る、テーマ項目の日本語ラベル。
const themeKeyLabels: Record<ThemeKey, string> = {
  primary: "メインカラー",
  background: "背景色",
  text: "テキストカラー",
  heading: "見出しの色",
  fontFamily: "フォント",
  spacing: "余白",
};

// フォントの内部値を、画面のセレクトと同じ日本語表記へ変換する。
const fontLabels: Record<string, string> = {
  sans: "ゴシック",
  serif: "明朝",
  rounded: "丸ゴシック",
};

// テーマ項目の現在値を「メインカラーを #e11d48 に」のような読める文へ整形する。
function describeThemeChange(key: ThemeKey, theme: SiteModel["theme"]): string {
  const label = themeKeyLabels[key];
  if (key === "fontFamily") return `${label}を ${fontLabels[theme.fontFamily] ?? theme.fontFamily} に`;
  if (key === "spacing") return `${label}を ${theme.spacing} に`;
  // 見出しの色は未指定ならメインカラーを引き継ぐため、その場合は実際に適用される色を書く。
  if (key === "heading") return `${label}を ${theme.heading ?? theme.primary} に`;
  return `${label}を ${theme[key]} に`;
}

// 未記録のデザイン変更。変更した瞬間の理由を一緒に持たせ、
// あとで理由欄が書き換わっても過去の変更には影響しないようにする。
type TouchedThemeChange = { key: ThemeKey; reason: string };

export default function App() {
  const [topic, setTopic] = useState("");
  const [reason, setReason] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [notice, setNotice] = useState("静的サンプルで開始しています。題材を入力して生成できます。");
  // 記録ボタンを押すまでに変更したテーマ項目を、そのとき入力されていた理由と対にして覚えておく。
  // 記録時はこの理由を使うため、途中で理由欄を書き換えても過去の変更には紐づかない。
  const [touchedThemeChanges, setTouchedThemeChanges] = useState<TouchedThemeChange[]>([]);
  // 右カラムは縦に積むと画面へ収まらないため、常に1パネルだけ表示する。
  const [activePanel, setActivePanel] = useState<PanelKey>("design");
  // 畳むとプレビューがPC幅まで広がり、出力時に近い見た目を確認できる。
  const [panelOpen, setPanelOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  // 狭い画面用。xl以上では使わず、3カラムを同時に表示する。
  const [mobileView, setMobileView] = useState<MobileView>("preview");
  const { site, selectedElementId, notes, aiUsage, setSite, loadSite, selectElement, previewTheme, updateSection, addNote, reset } = useBuilderStore();

  const quality = useMemo(() => evaluateQuality(site), [site]);
  const selectedSection = site.sections.find((section) => section.id === selectedElementId);
  const explanation = explanationDictionary[selectedElementId] ?? explanationDictionary.about;

  // 記録されないまま残っている「変更中の状態」を捨てる。
  // サイトが差し替わる操作（生成・リセット）のたびに呼ぶ。
  const discardUnrecordedChanges = () => {
    setTouchedThemeChanges([]);
    setReason("");
  };

  const generation = useMutation({
    mutationFn: async (nextTopic: string) => {
      try {
        return await generateSite(nextTopic);
      } catch {
        return { site: createSampleSite(nextTopic), provider: "static-sample" as const };
      }
    },
    onSuccess: ({ site: generatedSite, provider }) => {
      setSite(generatedSite, provider);
      // サイトが差し替わると、記録前の変更内容は新しいサイトに対して意味を持たない。
      // 残したままだと、触れていない初期値を変更として誤記録してしまう。
      discardUnrecordedChanges();
      setCurrentProjectId(null);
      setNotice(provider === "gemini" ? "AIでたたき台を生成しました。事実情報を確認してください。" : "APIを利用できないため、静的サンプルを生成しました。");
    },
  });

  const submitTopic = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) return;
    generation.mutate(topic.trim());
  };

  // 色・余白・フォントの変更はプレビューへ即時反映するだけで、メモは残さない。
  // カラーピッカー等は操作ごとに大量のイベントが発火するため、記録は明示ボタンで行う。
  // 理由未入力のうちは変更させず、先に「なぜ変えるか」を言語化させる（理解確認）。
  // 変更した項目は覚えておき、記録時に「何をどの値に変えたか」をまとめてメモへ残す。
  const changeTheme = (key: ThemeKey, value: string | number) => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    previewTheme(key, value);
    // 同じ項目を触り直したときは、そのときの理由で上書きする。
    setTouchedThemeChanges((changes) => [
      ...changes.filter((change) => change.key !== key),
      { key, reason: trimmedReason },
    ]);
  };

  // ユーザーが理由を書いて「記録」ボタンを押したときだけ、変更内容と理由をメモへ残す。
  // 理由は入力欄の現在値ではなく、変更時に記録しておいた理由を使う。
  // 異なる理由で変更した項目が混在している場合は、理由ごとに分けて1件ずつ残す。
  const recordThemeReason = () => {
    if (!reason.trim()) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    if (touchedThemeChanges.length === 0) {
      setNotice("先に色・余白・フォントを変更してください。");
      return;
    }
    const groupedByReason = touchedThemeChanges.reduce<{ reason: string; keys: ThemeKey[] }[]>((groups, change) => {
      const group = groups.find((candidate) => candidate.reason === change.reason);
      if (group) group.keys.push(change.key);
      else groups.push({ reason: change.reason, keys: [change.key] });
      return groups;
    }, []);
    for (const group of groupedByReason) {
      const summary = group.keys.map((key) => describeThemeChange(key, site.theme)).join(" / ");
      addNote(`デザイン変更（${summary}）`, group.reason);
    }
    setNotice("デザイン変更の内容と理由を学習メモへ記録しました。");
    setTouchedThemeChanges([]);
    setReason("");
  };

  // 理由欄をクリアしても、未記録のデザイン変更は変更時の理由を保持しているため影響を受けない。
  const recordContentReason = () => {
    if (!reason.trim() || !selectedSection) return;
    addNote(`内容変更（${selectedSection.title}）`, reason.trim());
    setNotice("内容変更の理由を学習メモへ記録しました。");
    setReason("");
  };

  const resetBuilder = () => {
    reset();
    discardUnrecordedChanges();
    setCurrentProjectId(null);
    setNotice("初期サンプルへ戻しました。");
  };

  const loadProject = (loadedSite: typeof site) => {
    loadSite(loadedSite);
    discardUnrecordedChanges();
  };

  // ヘッダーはflex-wrapで高さが変わるため、縦flexで残り高さをグリッドへ渡し、
  // 高さの決め打ち(calc(100vh-73px))を避ける。
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 xl:h-screen">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-2xl font-black tracking-tight text-blue-600">Whyve</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AuthControls enabled={clerkConfig.enabled} />
          <ProjectControls
            enabled={clerkConfig.enabled}
            site={site}
            currentProjectId={currentProjectId}
            onProjectChange={setCurrentProjectId}
            onLoad={loadProject}
            onNotice={setNotice}
          />
          <Button variant="ghost" onClick={resetBuilder}><RotateCcw className="mr-2 size-4" />リセット</Button>
          <Button onClick={() => void exportProject(site, notes, aiUsage)}><Download className="mr-2 size-4" />提出物ZIP</Button>
        </div>
      </header>

      {/* 左右のカラムを畳むとプレビューが広がり、PC幅での見た目を確認できる。畳んでもつまみは残す。 */}
      <div className={`grid grid-cols-1 xl:min-h-0 xl:flex-1 ${setupOpen ? "xl:grid-cols-[290px_minmax(0,1fr)_var(--panel-w)]" : "xl:grid-cols-[40px_minmax(0,1fr)_var(--panel-w)]"}`} style={{ "--panel-w": panelOpen ? "350px" : "60px" } as CSSProperties}>
        <aside id="view-setup" className={`min-h-0 overflow-hidden border-r border-slate-200 bg-slate-100 xl:flex ${mobileView === "setup" ? "flex" : "hidden"}`}>
          {/* 畳んだときに残るつまみ。xl未満では下部バーで切り替えるため出さない。 */}
          <div className="order-2 hidden w-10 shrink-0 flex-col items-center bg-slate-100 py-3 xl:flex">
            <button
              type="button"
              onClick={() => setSetupOpen((open) => !open)}
              aria-expanded={setupOpen}
              title={setupOpen ? "題材・メモを畳んでプレビューを広げる" : "題材・メモを開く"}
              className="w-10 rounded-r-lg py-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700"
            >
              {setupOpen ? <ChevronLeft className="mx-auto size-4" /> : <ChevronRight className="mx-auto size-4" />}
            </button>
          </div>

          <div className={`flex-1 overflow-y-auto bg-white p-4 pb-20 xl:pb-4 ${setupOpen ? "block" : "block xl:hidden"}`}>
          <form onSubmit={submitTopic} className="space-y-3">
            <label className="text-sm font-bold" htmlFor="topic">紹介サイトの題材</label>
            <Textarea id="topic" rows={3} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例：地域の小さな植物園" />
            <Button className="w-full" disabled={!topic.trim() || generation.isPending}>
              <Sparkles className="mr-2 size-4" />{generation.isPending ? "生成中…" : "たたき台を生成"}
            </Button>
          </form>

          <div className="my-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <strong>AI生成文は仮テキストです。</strong><br />事実情報は必ず自分で調べて入力してください。
          </div>

          <h2 className="mb-2 text-sm font-black">セクション</h2>
          <div className="space-y-2">
            {site.sections.map((section) => (
              <label key={section.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <span>{section.title}</span>
                <input type="checkbox" checked={section.visible} onChange={(event) => updateSection(section.id, { visible: event.target.checked }, reason.trim() || undefined)} />
              </label>
            ))}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-black">学習メモ <span className="text-slate-400">{notes.length}</span></h2>
          <div className="max-h-52 space-y-2 overflow-auto">
            {notes.length === 0 ? <p className="text-xs text-slate-500">変更理由はまだありません。</p> : notes.slice().reverse().map((note) => (
              <div key={note.id} className="rounded-xl bg-slate-50 p-3 text-xs"><strong>{note.target}</strong><p className="mt-1 text-slate-600">{note.reason}</p></div>
            ))}
          </div>
          </div>
        </aside>

        <main id="view-preview" className={`min-h-[70vh] min-w-0 flex-col p-4 pb-20 xl:flex xl:min-h-0 xl:pb-4 ${mobileView === "preview" ? "flex" : "hidden"}`}>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info className="size-4 shrink-0" />{notice}</div>
          <div className="pb-3">
            <span className="text-xs font-bold text-slate-600">LIVE PREVIEW</span>
            <h2 className="font-black">{site.siteTitle}</h2>
          </div>
          <SitePreview site={site} onElementSelect={selectElement} />
        </main>

        <aside id="view-panel" className={`min-h-0 overflow-hidden border-l border-slate-200 bg-slate-100 xl:flex ${mobileView === "panel" ? "flex" : "hidden"}`}>
          {/* フォルダのつまみのような縦タブ。畳んでいる間もここだけは残る。 */}
          <div className="flex w-14 shrink-0 flex-col items-end py-3">
          {/* role="tablist"の子はtabのみ。畳むボタンはタブではないのでこの外に置く。 */}
          <div className="flex flex-col items-end gap-1" role="tablist" aria-label="調整と学習">
            {(Object.keys(panelLabels) as PanelKey[]).map((key) => {
              const selected = panelOpen && activePanel === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`panel-tab-${key}`}
                  aria-selected={selected}
                  aria-controls="panel-content"
                  title={panelLabels[key]}
                  onClick={() => {
                    // 畳んだ状態でタブを押したら開く。開いている同じタブを押したら畳む。
                    if (!panelOpen) { setActivePanel(key); setPanelOpen(true); return; }
                    if (activePanel === key) { setPanelOpen(false); return; }
                    setActivePanel(key);
                  }}
                  className={`relative flex w-12 justify-center rounded-l-lg py-4 text-xs font-bold transition ${selected ? "bg-white text-slate-900" : "text-slate-600 hover:bg-white/60 hover:text-slate-800"}`}
                >
                  {/* 縦書き。折り返すと1文字ずつ横に割れるため、折り返しを禁止する。 */}
                  <span className="whitespace-nowrap [writing-mode:vertical-rl]">{panelLabels[key]}</span>
                  {key === "quality" && quality.some((item) => !item.passed) && (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-600" />
                  )}
                </button>
              );
            })}
          </div>
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
              title={panelOpen ? "パネルを畳んでプレビューを広げる" : "パネルを開く"}
              className="mt-1 hidden w-12 rounded-l-lg py-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700 xl:block"
            >
              {panelOpen ? <ChevronRight className="mx-auto size-4" /> : <ChevronLeft className="mx-auto size-4" />}
            </button>
          </div>

          {/* 畳みはxl以上だけの機能。狭い画面ではパネルが画面全体なので、畳むと何も見えなくなる。 */}
          <div
            id="panel-content"
            role="tabpanel"
            aria-labelledby={`panel-tab-${activePanel}`}
            className={`flex-1 overflow-y-auto bg-white p-4 pb-20 xl:pb-4 ${panelOpen ? "block" : "block xl:hidden"}`}
          >
          <h2 className="text-base font-black">調整と学習</h2>

          {activePanel === "design" && <>
          <label className="mt-4 block text-xs font-bold" htmlFor="reason">なぜこの変更をしますか？</label>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">何を・どう変えて・なぜかを具体的に書くと、あとで見返したときに理解が深まります。</p>
          <Textarea id="reason" rows={2} className={`mt-1 ${reason.trim() ? "" : "ring-2 ring-amber-400 focus-visible:ring-amber-400"}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例：見出しを赤にした。植物園の元気な雰囲気を伝えたいから" />

          <Card className="relative mt-4 space-y-4 p-4">
            <h3 className="text-sm font-black">デザイン</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold">メインカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.primary} onChange={(event) => changeTheme("primary", event.target.value)} /></label>
              <label className="block text-xs font-bold">背景色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.background} onChange={(event) => changeTheme("background", event.target.value)} /></label>
              <label className="block text-xs font-bold">テキストカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.text} onChange={(event) => changeTheme("text", event.target.value)} /></label>
              {/* 見出しの色は未指定ならメインカラーを引き継ぐ。ピッカーにはその実効値を表示する。 */}
              <label className="block text-xs font-bold">見出しの色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.heading ?? site.theme.primary} onChange={(event) => changeTheme("heading", event.target.value)} /></label>
            </div>
            <label className="block text-xs font-bold">余白: {site.theme.spacing}<input className="mt-2 w-full" type="range" min="2" max="10" value={site.theme.spacing} onChange={(event) => changeTheme("spacing", Number(event.target.value))} /></label>
            <label className="block text-xs font-bold">フォント<select className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3" value={site.theme.fontFamily} onChange={(event) => changeTheme("fontFamily", event.target.value)}><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="rounded">丸ゴシック</option></select></label>
            <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={recordThemeReason}>デザイン変更の理由を記録</Button>
            {!reason.trim() && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-white/75 px-4 text-center backdrop-blur-[1px]">
                <span className="text-sm font-black text-slate-700">まず変更の理由を入力</span>
                <span className="text-xs text-slate-500">上の欄に理由を書くと調整できます。</span>
              </div>
            )}
          </Card>

          {selectedSection && <Card className="mt-4 space-y-3 p-4">
            <h3 className="text-sm font-black">選択中: {selectedSection.title}</h3>
            <label className="block text-xs font-bold">見出し<Input className="mt-1" value={selectedSection.title} onChange={(event) => updateSection(selectedSection.id, { title: event.target.value })} /></label>
            <label className="block text-xs font-bold">本文<Textarea className="mt-1" rows={4} value={selectedSection.body} onChange={(event) => updateSection(selectedSection.id, { body: event.target.value })} /></label>
            {selectedSection.kind !== "contact" && <label className="block text-xs font-bold">画像の説明（alt）<Input className="mt-1" value={selectedSection.imageAlt} onChange={(event) => updateSection(selectedSection.id, { imageAlt: event.target.value })} placeholder="画像が見えない人にも伝わる説明" /></label>}
            <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={recordContentReason}>内容変更の理由を記録</Button>
          </Card>}
          </>}

          {activePanel === "explanation" && <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">なぜこのコード？</h3>
            {/* プレビュー上に置くと画面を圧迫するため、操作案内はこのタブ内に置く。 */}
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
              プレビュー内の要素を<strong>クリック</strong>すると、その部分の解説に切り替わります。
            </p>
            <p className="mt-3 text-sm font-bold text-blue-700">{explanation.title}</p>
            <p className="mt-2 text-xs leading-5"><strong>HTML:</strong> {explanation.html}</p>
            <p className="mt-1 text-xs leading-5"><strong>CSS:</strong> {explanation.css}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{explanation.why}</p>
          </Card>}

          {activePanel === "quality" && <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">品質チェック</h3>
            <div className="mt-3 space-y-3">{quality.map((item) => <div key={item.id} className="flex gap-2 text-xs">{item.passed ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-red-600" />}<div><strong>{item.label}</strong><p className="mt-0.5 leading-5 text-slate-600">{item.detail}</p></div></div>)}</div>
          </Card>}
          </div>
        </aside>
      </div>

      {/* 狭い画面用の切替バー。3カラムを縦積みすると見づらいため、1つずつ表示する。 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white/95 backdrop-blur xl:hidden" role="tablist" aria-label="表示の切り替え">
        {(Object.keys(mobileViewLabels) as MobileView[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mobileView === key}
            aria-controls={`view-${key}`}
            onClick={() => setMobileView(key)}
            className={`relative flex-1 py-3 text-xs font-bold transition ${mobileView === key ? "text-blue-700" : "text-slate-600"}`}
          >
            {mobileViewLabels[key]}
            {key === "panel" && quality.some((item) => !item.passed) && (
              <span className="ml-1 inline-block size-1.5 rounded-full bg-red-600 align-middle" />
            )}
            {mobileView === key && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-blue-700" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

