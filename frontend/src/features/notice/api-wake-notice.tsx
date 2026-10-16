import { LoaderCircle } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { useApiWaking } from "@/lib/api-wake";

// APIの起動を待っていることを伝える(#147)。操作結果の通知とは別に置き、結果の通知を上書きしない。
// ライブリージョンは中身が変わる前からDOMにないと読み上げられないため、待っていない間も残す。
export function ApiWakeNotice() {
  const waking = useApiWaking();
  return (
    <div data-testid="api-wake-notice" className={waking ? "px-3 pt-3 xl:px-4" : "sr-only"}>
      <Callout tone={waking ? "info" : null} elevated className="flex items-start gap-2 px-3 py-2 text-sm leading-normal">
        {waking && <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />}
        <p role="status" className="min-w-0 flex-1 break-words">
          {waking && "サーバーの応答を待っています。しばらく使われていなかった場合は、起動に1分ほどかかることがあります。このままお待ちください。"}
        </p>
      </Callout>
    </div>
  );
}
