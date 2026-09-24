// status は成功・進行中の知らせ、error は操作が失敗した・止めたことの知らせ。
export type NoticeTone = "status" | "error";

export type Notice = {
  // 同じ文言が続いても、表示と読み上げ用の要素が差し替わるように毎回変える。
  id: number;
  message: string;
  tone: NoticeTone;
  // 通知を出したときにフォーカスがあった要素。閉じたらここへ戻す。
  returnFocusTo: HTMLElement | null;
};

// 通知を出す直前に呼び、そのときフォーカスがあった要素を返す。
export function captureFocusOrigin(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}
