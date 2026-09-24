import { CircleAlert, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// status は成功・進行中の知らせ、error は操作が失敗した・止めたことの知らせ。
export type NoticeTone = "status" | "error";

export type Notice = {
  // 同じ文言が続いても、読み上げと表示の更新が起きるように毎回変える。
  id: number;
  message: string;
  tone: NoticeTone;
};

type NoticeBarProps = {
  notice: Notice | null;
  onDismiss: () => void;
};

// 操作結果の通知。モバイルの表示切替（タブ）の外に置き、どの表示を選んでいても見えるようにする。
// ライブリージョンは中身が変わる前からDOMにないと読み上げられないため、
// status と alert の2つを常に置いておき、通知の種類に応じて片方へ文言を入れる。
export function NoticeBar({ notice, onDismiss }: NoticeBarProps) {
  const isError = notice?.tone === "error";
  return (
    // 閉じている間は見た目を消すが、ライブリージョンは残すため sr-only にする。
    <div className={notice ? "sticky top-0 z-20 px-3 pt-3 xl:px-4" : "sr-only"}>
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
          <Button variant="ghost" aria-label="通知を閉じる" className="-my-2 -mr-2 min-h-10 min-w-10 shrink-0 px-2 py-2" onClick={onDismiss}>
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
