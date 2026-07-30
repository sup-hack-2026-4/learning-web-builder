import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Download, Info, RotateCcw, Sparkles, X } from "lucide-react";
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
import { useBuilderStore } from "@/features/site-model/store";
import { generateSite } from "@/lib/api";

type ThemeKey = "primary" | "background" | "fontFamily" | "spacing";

// 学習メモ・ZIP出力に載る、テーマ項目の日本語ラベル。
const themeKeyLabels: Record<ThemeKey, string> = {
  primary: "メインカラー",
  background: "背景色",
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
function describeThemeChange(key: ThemeKey, theme: { primary: string; background: string; fontFamily: string; spacing: number }): string {
  const label = themeKeyLabels[key];
  if (key === "fontFamily") return `${label}を ${fontLabels[theme.fontFamily] ?? theme.fontFamily} に`;
  if (key === "spacing") return `${label}を ${theme.spacing} に`;
  if (key === "primary") return `${label}を ${theme.primary} に`;
  return `${label}を ${theme.background} に`;
}

export default function App() {
  const [topic, setTopic] = useState("");
  const [reason, setReason] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [notice, setNotice] = useState("静的サンプルで開始しています。題材を入力して生成できます。");
  // 記録ボタンを押すまでに変更したテーマ項目を覚えておき、記録時にまとめて1件のメモにする。
  const [touchedThemeKeys, setTouchedThemeKeys] = useState<ThemeKey[]>([]);
  const { site, selectedElementId, notes, aiUsage, setSite, loadSite, selectElement, previewTheme, updateSection, addNote, reset } = useBuilderStore();

  const quality = useMemo(() => evaluateQuality(site), [site]);
  const selectedSection = site.sections.find((section) => section.id === selectedElementId);
  const explanation = explanationDictionary[selectedElementId] ?? explanationDictionary.about;

  // 記録されないまま残っている「変更中の状態」を捨てる。
  // サイトが差し替わる操作（生成・リセット）のたびに呼ぶ。
  const discardUnrecordedChanges = () => {
    setTouchedThemeKeys([]);
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
    if (!reason.trim()) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    previewTheme(key, value);
    setTouchedThemeKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
  };

  // ユーザーが理由を書いて「記録」ボタンを押したときだけ、変更内容と理由を1件のメモへ残す。
  const recordThemeReason = () => {
    if (!reason.trim()) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    if (touchedThemeKeys.length === 0) {
      setNotice("先に色・余白・フォントを変更してください。");
      return;
    }
    const summary = touchedThemeKeys.map((key) => describeThemeChange(key, site.theme)).join(" / ");
    addNote(`デザイン変更（${summary}）`, reason.trim());
    setNotice("デザイン変更の内容と理由を学習メモへ記録しました。");
    setTouchedThemeKeys([]);
    setReason("");
  };

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

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <p className="text-xs font-bold tracking-[0.2em] text-blue-600">LEARNING WEB BUILDER</p>
          <h1 className="text-lg font-black text-slate-900">答えではなく、考え方を持ち帰る。</h1>
        </div>
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

      <div className="grid min-h-[calc(100vh-73px)] grid-cols-1 xl:grid-cols-[290px_minmax(480px,1fr)_350px]">
        <aside className="border-r border-slate-200 bg-white p-4">
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
        </aside>

        <main className="flex min-h-[70vh] flex-col p-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info className="size-4 shrink-0" />{notice}</div>
          <div className="flex items-center justify-between pb-3">
            <div><span className="text-xs font-bold text-slate-500">LIVE PREVIEW</span><h2 className="font-black">{site.siteTitle}</h2></div>
            <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">クリックしてコードを解説</span>
          </div>
          <SitePreview site={site} onElementSelect={selectElement} />
        </main>

        <aside className="border-l border-slate-200 bg-white p-4">
          <h2 className="text-base font-black">調整と学習</h2>
          <label className="mt-3 block text-xs font-bold" htmlFor="reason">なぜこの変更をしますか？</label>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">何を・どう変えて・なぜかを具体的に書くと、あとで見返したときに理解が深まります。</p>
          <Textarea id="reason" rows={2} className={`mt-1 ${reason.trim() ? "" : "ring-2 ring-amber-400 focus-visible:ring-amber-400"}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例：見出しを赤にした。植物園の元気な雰囲気を伝えたいから" />

          <Card className="relative mt-4 space-y-4 p-4">
            <h3 className="text-sm font-black">デザイン</h3>
            <label className="block text-xs font-bold">メインカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.primary} onChange={(event) => changeTheme("primary", event.target.value)} /></label>
            <label className="block text-xs font-bold">背景色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.background} onChange={(event) => changeTheme("background", event.target.value)} /></label>
            <label className="block text-xs font-bold">余白: {site.theme.spacing}<input className="mt-2 w-full" type="range" min="2" max="10" value={site.theme.spacing} onChange={(event) => changeTheme("spacing", Number(event.target.value))} /></label>
            <label className="block text-xs font-bold">フォント<select className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3" value={site.theme.fontFamily} onChange={(event) => changeTheme("fontFamily", event.target.value)}><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="rounded">丸ゴシック</option></select></label>
            <Button className="w-full" variant="secondary" disabled={!reason.trim()} onClick={recordThemeReason}>デザイン変更の理由を記録</Button>
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
            <Button className="w-full" variant="secondary" disabled={!reason.trim()} onClick={recordContentReason}>内容変更の理由を記録</Button>
          </Card>}

          <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">なぜこのコード？</h3>
            <p className="mt-2 text-sm font-bold text-blue-700">{explanation.title}</p>
            <p className="mt-2 text-xs leading-5"><strong>HTML:</strong> {explanation.html}</p>
            <p className="mt-1 text-xs leading-5"><strong>CSS:</strong> {explanation.css}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{explanation.why}</p>
          </Card>

          <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">品質チェック</h3>
            <div className="mt-3 space-y-3">{quality.map((item) => <div key={item.id} className="flex gap-2 text-xs">{item.passed ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-red-600" />}<div><strong>{item.label}</strong><p className="mt-0.5 leading-5 text-slate-600">{item.detail}</p></div></div>)}</div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

