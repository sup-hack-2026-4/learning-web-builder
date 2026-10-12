import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { nextAction } from "@/features/learning-flow/steps";

// 右カラムのパネル。縦積みだと画面に収まらないため、タブで1つずつ表示する。
export type PanelKey = "design" | "explanation" | "quality";

const panelLabels: Record<PanelKey, string> = {
  design: "調整",
  explanation: "解説",
  quality: "品質",
};

type SidePanelProps = {
  activePanel: PanelKey;
  onActivePanelChange: (key: PanelKey) => void;
  // 畳むとプレビューがPC幅まで広がり、出力時に近い見た目を確認できる。
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  hasQualityIssue: boolean;
  nextToDo: ReturnType<typeof nextAction>;
  // 選んでいるパネルの中身。
  children: ReactNode;
};

// 右カラム（調整と学習）の枠。タブ、畳み／展開、「次にすること」を受け持つ。
export function SidePanel({ activePanel, onActivePanelChange, panelOpen, onPanelOpenChange, hasQualityIssue, nextToDo, children }: SidePanelProps) {
  // 畳む・開くボタンは押すと自身が隠れるため、もう一方のボタンへフォーカスを渡す。
  const panelOpenButtonRef = useRef<HTMLButtonElement>(null);
  const panelCollapseButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {/* 畳んだときのつまみ。デスクトップで畳んでいる間はここだけが残る。 */}
      <div className={`hidden w-10 shrink-0 flex-col items-center py-3 ${panelOpen ? "xl:hidden" : "xl:flex"}`}>
        <Button
          ref={panelOpenButtonRef}
          type="button"
          variant="quiet"
          size="icon"
          onClick={() => {
            // このボタンは開くと隠れる。描画を済ませてから、畳むボタンへフォーカスを渡す。
            flushSync(() => onPanelOpenChange(true));
            panelCollapseButtonRef.current?.focus();
          }}
          aria-expanded={false}
          aria-label="パネルを開く"
          title="パネルを開く"
          className="rounded-l-lg rounded-r-none"
          icon={<ChevronLeft className="size-4" />}
        />
      </div>

      {/* 畳みはxl以上だけの機能。狭い画面ではパネルが画面全体なので、畳むと何も見えなくなる。 */}
      <div className={`flex min-w-0 flex-1 flex-col bg-white ${panelOpen ? "flex" : "flex xl:hidden"}`}>
        {/* 中の見出しはh3から始まるため、領域の見出しとしてh2を置く。無いとモバイルでこの領域だけを
            表示したときにh1からh3へ飛び、デスクトップではプレビューのh2の下に入ってしまう。
            見た目ではタブと下部バーが同じ役割を担うので、読み上げ用だけにする。 */}
        <h2 className="sr-only">調整と学習</h2>
        {/* タブは横書き。縦書きだと1文字ずつ縦に並び、主要ナビゲーションとして読みにくい。
            role="tablist"の子はtabのみ。畳むボタンはタブではないのでこの外に置く。 */}
        <div className="flex shrink-0 items-center border-b border-slate-200 px-2 pt-2">
          {/* 選択状態は「どのパネルを選んでいるか」だけで決める。
              畳み(panelOpen)を混ぜると、中身が見えるモバイルで全タブ非選択になり矛盾する。
              畳んでいる間はタブ列しか見えないため、選択表示が残っていて差し支えない。
              タブはパネルの切り替えだけを担う。畳み/展開はデスクトップ専用ボタンの役割。
              モバイルではパネルが常時表示なので、ここでpanelOpenを触ると
              画面に出ていない「デスクトップの畳み状態」を勝手に書き換えてしまう。 */}
          <Tabs
            label="調整と学習"
            items={(Object.keys(panelLabels) as PanelKey[]).map((key) => ({
              key,
              title: panelLabels[key],
              label: <>
                <span>{panelLabels[key]}</span>
                {/* 赤い点は色だけで意味を持つため、読み上げには文字で伝える。 */}
                {key === "quality" && hasQualityIssue && (
                  <>
                    <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-danger-vivid" />
                    <span className="sr-only">（問題あり）</span>
                  </>
                )}
              </>,
            }))}
            value={activePanel}
            onValueChange={onActivePanelChange}
            tabId={(key) => `panel-tab-${key}`}
            panelId={() => "panel-content"}
            className="items-center gap-1"
          />
          <Button
            ref={panelCollapseButtonRef}
            type="button"
            variant="quiet"
            size="icon"
            onClick={() => {
              // このボタンは畳むとタブ列ごと隠れる。描画を済ませてから、開くボタンへフォーカスを渡す。
              flushSync(() => onPanelOpenChange(false));
              panelOpenButtonRef.current?.focus();
            }}
            aria-expanded={panelOpen}
            aria-label="パネルを畳んでプレビューを広げる"
            title="パネルを畳んでプレビューを広げる"
            className="ml-auto hidden rounded-lg xl:inline-flex"
            icon={<ChevronRight className="size-4" />}
          />
        </div>

        <div
          id="panel-content"
          role="tabpanel"
          aria-labelledby={`panel-tab-${activePanel}`}
          className="flex-1 overflow-y-auto p-4 pb-20 xl:pb-4"
        >
          {/* いま一番やってほしいことを1つだけ出す。複数並べると、
              結局どれから手を付ければよいのか分からなくなる。 */}
          <section aria-labelledby="next-action-heading" className="mb-4 rounded-xl bg-blue-50 p-3">
            <h3 id="next-action-heading" className="text-xs font-bold text-blue-700">次にすること</h3>
            <p className="mt-1 text-sm font-black text-blue-950">{nextToDo.title}</p>
            <p className="mt-1 text-xs leading-5 text-blue-900">{nextToDo.detail}</p>
          </section>

          {children}
        </div>
      </div>
    </>
  );
}
