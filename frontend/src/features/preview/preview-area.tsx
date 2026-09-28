import { Code2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CodePanel } from "@/components/code-panel";
import { SitePreview } from "@/components/site-preview";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { VerticalSplitter } from "@/components/vertical-splitter";
import type { SiteModel } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";

// プレビューとコードの高さ配分。どちらも読めなくならない範囲に収める。
const minCodeHeight = 120;
const minPreviewHeight = 240;

type PreviewAreaProps = {
  // コード上に「未記録の変更」を示すための比較元。
  baselineSite: SiteModel;
  // 全セクションが非表示のときの案内から、一覧へ移る。一覧は別の領域にあるため呼び出し側で行う。
  onShowSectionList: () => void;
};

// プレビューと生成コードを同時に見せる。理由を書く場面で、対象のコードを探しに行かせないため。
export function PreviewArea({ baselineSite, onShowSectionList }: PreviewAreaProps) {
  const { site, selectedElementId, selectElement } = useBuilderStore();
  // プレビューの下に生成コードを出す。理由を書くときに、対象のコードが目の前にある状態を作る。
  const [codeOpen, setCodeOpen] = useState(true);
  const [codeHeight, setCodeHeight] = useState(240);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  // 上限は画面の広さで変わる。支援技術へ調整範囲を伝えるため、値としても持っておく。
  const [maxCodeHeight, setMaxCodeHeight] = useState(minCodeHeight);
  const hasVisibleSection = site.sections.some((section) => section.visible);

  const measureMaxCodeHeight = useCallback(() => {
    const area = previewAreaRef.current;
    const available = area?.clientHeight ?? 0;
    if (!area || available === 0) return null;
    // 同じ領域には、プレビューとコードのほかに分割バーと（出ていれば）全非表示の案内も並ぶ。
    // その分を差し引かないと、コードを最大にしたときプレビューが最小の高さを割り込む。
    const others = [area.querySelector<HTMLElement>("[role='separator']"), area.querySelector<HTMLElement>("[data-testid='preview-all-hidden']")];
    const reserved = others.reduce((sum, element) => {
      if (!element) return sum;
      const style = window.getComputedStyle(element);
      return sum + element.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }, 0);
    return Math.max(minCodeHeight, available - reserved - minPreviewHeight);
  }, []);

  // 高さの上限は画面の広さで変わるため、コードの高さはその都度この範囲へ収める。
  const limitCodeHeight = useCallback(
    (height: number) => {
      const maxHeight = measureMaxCodeHeight();
      if (maxHeight === null) return height;
      return Math.min(Math.max(height, minCodeHeight), maxHeight);
    },
    [measureMaxCodeHeight],
  );

  // 画面が狭いとプレビューが潰れてしまうため、表示時とウィンドウ変更時に収め直す。
  useEffect(() => {
    const fit = () => {
      setCodeHeight(limitCodeHeight);
      const maxHeight = measureMaxCodeHeight();
      if (maxHeight !== null) setMaxCodeHeight(maxHeight);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [codeOpen, limitCodeHeight, measureMaxCodeHeight]);

  // 全非表示の案内が出たり消えたりすると、プレビューとコードに使える高さが変わるため収め直す。
  useEffect(() => {
    const fit = () => {
      const maxHeight = measureMaxCodeHeight();
      if (maxHeight === null) return;
      setMaxCodeHeight(maxHeight);
      setCodeHeight(limitCodeHeight);
    };
    fit();
  }, [hasVisibleSection, limitCodeHeight, measureMaxCodeHeight]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2 pb-3">
        {/* サイト名は自由入力。空白のない長い文字列でも、隣のボタンを押し出さずに折り返す。 */}
        <div className="min-w-0 flex-1 wrap-anywhere">
          <span className="text-xs font-bold text-slate-600">プレビュー</span>
          <h2 className="font-black">{site.siteTitle}</h2>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCodeOpen((open) => !open)} aria-expanded={codeOpen} aria-controls="code-panel-content" icon={<Code2 className="size-4" />}>
          {codeOpen ? "コードを隠す" : "コードを見る"}
        </Button>
      </div>

      <div ref={previewAreaRef} className="flex min-h-0 flex-1 flex-col">
        {/* 表示中のセクションが無いと、プレビューにはヘッダーとフッターしか残らない。
            何が起きたかと戻し方を、プレビューの手前（編集画面の側）で伝える。
            生成するHTMLには入れない。提出物に編集ツールの案内が混ざるため。 */}
        {!hasVisibleSection && (
          <Callout tone="warning" className="mb-3" data-testid="preview-all-hidden">
            <p>
              <strong>すべてのセクションが非表示です。</strong><br />
              左の「セクション」一覧でチェックを入れると、プレビューに戻ります。
            </p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onShowSectionList}>
              セクション一覧へ
            </Button>
          </Callout>
        )}
        <SitePreview site={site} onElementSelect={selectElement} />
        {codeOpen && (
          <>
            <VerticalSplitter
              label="プレビューとコードの高さを調整"
              value={codeHeight}
              min={minCodeHeight}
              max={maxCodeHeight}
              // 下へ動かすとコードが縮む。プレビュー側も読める高さを残す。
              onResize={(deltaY) => setCodeHeight((height) => limitCodeHeight(height - deltaY))}
            />
            <div className="flex shrink-0 flex-col" style={{ height: codeHeight }}>
              <CodePanel site={site} baselineSite={baselineSite} selectedElementId={selectedElementId} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
