import axeScriptUrl from "axe-core/axe.min.js?url";
import { AXE_MESSAGE_TYPE, buildAuditDocument, toAxeFindings, type AxeFinding, type RawAxeViolation } from "./axe-audit";
import type { SiteModel } from "../site-model/schema";

/** 検査が終わらないまま画面が待ち続けないよう、上限を設ける。 */
const AUDIT_TIMEOUT_MS = 15000;

// 画面外に置く。display:noneやvisibility:hiddenだと中身が組版されず、
// axeが要素の見え方を判定できなくなるため、大きさを持たせたまま外へ逃がす。
const FRAME_STYLE = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0";

type AxeMessage = { type?: unknown; ok?: unknown; violations?: unknown };

/**
 * 生成した成果物をiframeで読み込み、その中でaxe-coreを実行して指摘を集める。
 *
 * axeは別ウィンドウの要素を検査対象にできない（realmが違うとNode判定に失敗する）ため、
 * 親から中のDOMへ触れるのではなく、iframeの中でaxeを動かして結果だけをpostMessageで受け取る。
 * プレビューと同じくsandbox="allow-scripts"のままなので、生成物のスクリプトは動かない。
 */
export async function runAxeAudit(site: SiteModel): Promise<AxeFinding[]> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "アクセシビリティ自動チェック用";
  frame.style.cssText = FRAME_STYLE;
  frame.srcdoc = buildAuditDocument(site, axeScriptUrl);

  try {
    const violations = await new Promise<RawAxeViolation[]>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("message", receive);
      };

      function receive(event: MessageEvent) {
        // 送信元を検査用iframeに限定する。他のiframeや拡張機能のメッセージは受け取らない。
        if (event.source !== frame.contentWindow) return;
        const data = event.data as AxeMessage | null;
        if (!data || data.type !== AXE_MESSAGE_TYPE) return;
        cleanup();
        if (data.ok !== true) {
          reject(new Error("axe-core failed to run"));
          return;
        }
        resolve(Array.isArray(data.violations) ? (data.violations as RawAxeViolation[]) : []);
      }

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("axe-core timed out"));
      }, AUDIT_TIMEOUT_MS);

      window.addEventListener("message", receive);
      document.body.append(frame);
    });

    return toAxeFindings(violations);
  } finally {
    frame.remove();
  }
}
