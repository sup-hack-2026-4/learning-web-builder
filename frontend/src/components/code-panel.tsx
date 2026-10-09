import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import {
  annotateCss,
  annotateHtml,
  annotateJavaScript,
  diffLines,
  type CodeLine,
  type RemovedLine,
  type TokenKind,
} from "@/features/code-view/annotate-code";
import type { SiteModel } from "@/features/site-model/schema";
import { Tabs } from "@/components/ui/tabs";

// タブの見出しは、提出物ZIPに入るファイル名と同じにする。
// 画面で読んでいるコードが、そのまま手元に届くファイルだと分かるようにするため。
type FileKey = "html" | "css" | "javascript";

const fileLabels: Record<FileKey, string> = {
  html: "index.html",
  css: "style.css",
  javascript: "script.js",
};

const fileTabs = (Object.keys(fileLabels) as FileKey[]).map((key) => ({ key, label: fileLabels[key] }));

// 読みやすさのための色分け。役割ごとに色を割り当てる。
const tokenClasses: Record<TokenKind, string> = {
  plain: "text-slate-800",
  // 選んだ要素や未記録の変更の行は背景に色が付く。その上でも読める濃さにする。
  comment: "text-slate-600 italic",
  tag: "text-sky-800",
  attribute: "text-violet-800",
  string: "text-emerald-800",
  selector: "text-sky-800",
  property: "text-violet-800",
  value: "text-emerald-800",
  keyword: "text-rose-800",
};

// 行の状態を示す記号。背景と左の線の色だけでは、色を見分けにくい人に伝わらないため添える。
// 上部の凡例にも同じ記号を出し、意味をその場で確かめられるようにする。
const stateMarkers = {
  selected: ">",
  changed: "+",
  removed: "-",
} as const;

// 行番号の右に置く記号の列。コードを範囲コピーしたときに混ざらないよう、選択の対象から外す。
const markerColumnClass = "w-6 shrink-0 select-none font-bold";

// プレビューで選べる要素のうち、セクション以外のものの表示名。
const fixedElementLabels: Record<string, string> = {
  "site-header": "サイト上部（header）",
  "site-footer": "サイト下部（footer）",
};

type Props = {
  site: SiteModel;
  /** 前回理由を記録した時点のサイト。ここからの差分を「未記録の変更」として示す。 */
  baselineSite: SiteModel;
  selectedElementId: string;
};

export function CodePanel({ site, baselineSite, selectedElementId }: Props) {
  const [activeFile, setActiveFile] = useState<FileKey>("html");
  const scrollRef = useRef<HTMLDivElement>(null);

  const artifacts = useMemo(() => buildSiteArtifacts(site), [site]);
  const baselineArtifacts = useMemo(() => buildSiteArtifacts(baselineSite), [baselineSite]);

  const lines = useMemo<CodeLine[]>(() => {
    if (activeFile === "html") return annotateHtml(artifacts.html);
    if (activeFile === "css") return annotateCss(artifacts.css, site);
    return annotateJavaScript(artifacts.javascript);
  }, [activeFile, artifacts, site]);

  const diff = useMemo(
    () => diffLines(artifacts[activeFile], baselineArtifacts[activeFile]),
    [artifacts, baselineArtifacts, activeFile],
  );
  const changedLines = diff.added;

  // 消えた行は今のコードに無いため、消える前にあった位置へ差し込んで見せる。
  // これが無いと、セクションを非表示にしたときのように削除しか起きない変更が
  // コード上に一切現れず、「自分が何を変えたか」を確かめられない。
  const removedByLine = useMemo(() => {
    const grouped = new Map<number, RemovedLine[]>();
    for (const line of diff.removed) {
      const list = grouped.get(line.afterLine);
      if (list) list.push(line);
      else grouped.set(line.afterLine, [line]);
    }
    return grouped;
  }, [diff]);

  const changedCount = diff.added.size + diff.removed.length;

  // 消えた行のまとまりを描く。行番号は無いので空け、記号の列に「-」を置く。
  const renderRemoved = (afterLine: number) =>
    (removedByLine.get(afterLine) ?? []).map((removed, index) => (
      <li key={`removed-${afterLine}-${index}`} className="flex border-l-[3px] border-rose-400 bg-rose-50">
        <span aria-hidden className="w-10 shrink-0" />
        <span aria-hidden className={`${markerColumnClass} text-rose-700`}>{stateMarkers.removed}</span>
        <code className="whitespace-pre pr-4 text-rose-700 line-through decoration-rose-300">
          <span className="sr-only select-none">削除された行: </span>
          {removed.text.trim() || " "}
        </code>
      </li>
    ));

  const selectedLabel = site.sections.find((section) => section.id === selectedElementId)?.title
    ?? fixedElementLabels[selectedElementId]
    ?? "";
  const selectedLineCount = lines.filter((line) => line.relatedIds.includes(selectedElementId)).length;

  // 選択中の要素が変わったら、その要素を書いている行まで自動で送る。
  // 理由を書くときに、対象のコードを探しに行かなくて済むようにするため。
  // 色や文章を編集しただけでは動かさない。読んでいる位置が操作のたびに飛ぶのを避けるため。
  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>("[data-selected='true']");
    if (!container || !target) return;
    container.scrollTo({
      top: target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2,
      behavior: "smooth",
    });
  }, [selectedElementId, activeFile]);

  return (
    <section aria-label="生成されたコード" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-2 py-1.5">
        <Tabs
          label="生成されたコード"
          items={fileTabs}
          value={activeFile}
          onValueChange={setActiveFile}
          tabId={(key) => `code-tab-${key}`}
          panelId={() => "code-panel-content"}
          variant="pill"
          className="gap-1"
          tabClassName="font-mono"
        />

        {/* いまコードのどこを見ればよいかを、行に付く記号と色の意味とあわせて示す。 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {selectedLabel && (
            // セクション名は自由入力。長い文字列でも欠けずに読めるよう、枠の中で折り返す。
            <span className="flex min-w-0 max-w-full items-center gap-1 wrap-anywhere">
              <span aria-hidden className="shrink-0 font-mono font-bold text-blue-700">{stateMarkers.selected}</span>
              選んだ要素: <strong className="min-w-0 font-bold text-slate-800">{selectedLabel}</strong>
              {selectedLineCount === 0 && <span className="text-slate-500">（このファイルには出てきません）</span>}
            </span>
          )}
          {changedCount > 0 && (
            <span className="flex items-center gap-1">
              <span aria-hidden className="font-mono font-bold text-amber-700">{stateMarkers.changed}</span>
              未記録の変更 <strong className="font-bold text-slate-800">{changedCount}行</strong>
              {diff.removed.length > 0 && (
                <>
                  <span aria-hidden className="ml-1 font-mono font-bold text-rose-700">{stateMarkers.removed}</span>
                  <span>うち削除 {diff.removed.length}行</span>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* 行の位置を測って自動スクロールするため、この要素を位置の基準にする。 */}
      <div
        ref={scrollRef}
        id="code-panel-content"
        role="tabpanel"
        aria-labelledby={`code-tab-${activeFile}`}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto bg-slate-50 font-mono text-xs leading-5"
      >
        <ol className="w-max min-w-full py-1">
          {/* 先頭より前で消えた行。 */}
          {renderRemoved(0)}
          {lines.map((line) => {
            const selected = line.relatedIds.includes(selectedElementId);
            const changed = changedLines.has(line.number);
            // 直前に自分が動かした行を最優先で目立たせ、次に選択中の要素を示す。
            const highlight = changed
              ? "border-amber-500 bg-amber-100/70"
              : selected
                ? "border-blue-500 bg-blue-50"
                : "border-transparent";
            // 色と境界線、記号だけでは読み上げに伝わらないため、削除行と同じく状態を文字で添える。
            // 見た目は変更を優先するが、読み上げでは両方の状態を伝える。
            // 上部の「選んだ要素:」の表示と同じ文字列にならないよう、「〜の行」と書く。
            const stateLabel = [changed && "未記録の変更", selected && "選んだ要素"].filter(Boolean).join("・");
            return (
              <Fragment key={line.number}>
                <li
                  data-selected={selected}
                  data-changed={changed}
                  className={`flex border-l-[3px] ${highlight}`}
                >
                  <span aria-hidden className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">{line.number}</span>
                  {/* 背景は変更を優先して1色だが、記号は両方出す。変更した行が選んだ要素の行でもあると分かるようにするため。 */}
                  <span aria-hidden className={markerColumnClass}>
                    {changed && <span className="text-amber-700">{stateMarkers.changed}</span>}
                    {selected && <span className="text-blue-700">{stateMarkers.selected}</span>}
                  </span>
                  <code className="whitespace-pre pr-4">
                    {/* コードを範囲コピーしたときに混ざらないよう、行番号と同じく選択の対象から外す。 */}
                    {stateLabel && <span className="sr-only select-none">{stateLabel}の行: </span>}
                    {line.tokens.length === 0
                      ? " "
                      : line.tokens.map((token, index) => (
                          <span key={index} className={tokenClasses[token.kind]}>{token.text}</span>
                        ))}
                  </code>
                </li>
                {/* この行の直後で消えた行を続けて出す。 */}
                {renderRemoved(line.number)}
              </Fragment>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
