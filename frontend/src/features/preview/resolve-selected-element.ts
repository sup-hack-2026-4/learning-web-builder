const SELECT_MESSAGE_TYPE = "learning-builder:select";

// iframeからのpostMessageは、送信元ウィンドウとメッセージ型を必ず確認してから信用する。
// なりすまし(他のwindow/iframeからの偽メッセージ)や想定外の型を弾くための検証ロジック。
export function resolveSelectedElementId(
  event: { source: MessageEventSource | null; data: unknown },
  expectedSource: Window | null,
): string | null {
  if (!expectedSource || event.source !== expectedSource) return null;

  const data = event.data as { type?: unknown; elementId?: unknown } | null;
  if (data?.type === SELECT_MESSAGE_TYPE && typeof data.elementId === "string") {
    return data.elementId;
  }
  return null;
}
