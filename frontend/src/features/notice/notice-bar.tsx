import { CircleAlert, Info, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Notice } from "@/features/notice/notice";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// display:none の祖先を持つ要素（モバイルで非表示の表示など）は矩形を持たない。
const isVisible = (element: HTMLElement) => element.getClientRects().length > 0;

const canReceiveFocus = (element: HTMLElement) => element.isConnected && isVisible(element) && element.matches(focusableSelector);

// 通知の直後にあって、見えている最初の操作要素。Tabで次に進む先と同じになる。
function nextFocusableAfter(container: HTMLElement): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(focusableSelector)) {
    if (container.contains(element)) continue;
    if (!(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (isVisible(element)) return element;
  }
  return null;
}

type NoticeBarProps = {
  notice: Notice | null;
  onDismiss: () => void;
};

// 操作結果の通知。モバイルの表示切替（タブ）の外に置き、どの表示を選んでいても見えるようにする。
// ライブリージョンは中身が変わる前からDOMにないと読み上げられないため、
// status と alert の2つを常に置いておき、通知の種類に応じて片方へ文言を入れる。
export function NoticeBar({ notice, onDismiss }: NoticeBarProps) {
  const isError = notice?.tone === "error";
  const containerRef = useRef<HTMLDivElement>(null);
  // 閉じるボタンは押すと消えるため、見えていて意味のある要素へフォーカスを移す。
  // 通知のきっかけになった操作へ戻せればそこへ。戻せない（最初の案内、別の表示へ切り替えた、
  // ボタンが押せなくなった）ときは、通知の直後にある最初の操作要素へ進める。
  const dismiss = () => {
    const origin = notice?.returnFocusTo;
    const container = containerRef.current;
    const target = origin && canReceiveFocus(origin) ? origin : container ? nextFocusableAfter(container) : null;
    target?.focus();
    onDismiss();
  };
  return (
    // 閉じている間は見た目を消すが、ライブリージョンは残すため sr-only にする。
    <div ref={containerRef} data-testid="notice-bar" className={notice ? "sticky top-0 z-20 px-3 pt-3 xl:px-4" : "sr-only"}>
      <div
        className={
          notice
            ? `flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${
                isError ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"
              }`
            : undefined
        }
      >
        {notice && (isError ? <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />)}
        <div className="min-w-0 flex-1 break-words">
          <p role="status">{notice?.tone === "status" && <span key={notice.id}>{notice.message}</span>}</p>
          <p role="alert">{notice?.tone === "error" && <span key={notice.id}>{notice.message}</span>}</p>
        </div>
        {notice && (
          <Button variant="ghost" aria-label="通知を閉じる" className="-my-2 -mr-2 min-h-10 min-w-10 shrink-0 px-2 py-2" onClick={dismiss}>
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
