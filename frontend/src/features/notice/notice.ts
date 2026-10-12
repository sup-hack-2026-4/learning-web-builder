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

// 通知を出す関数。戻り先を省くと、呼んだ時点のフォーカス元へ戻す。
// 結果が遅れて届く操作は、完了時にはフォーカスが別の場所へ移っていることがあるため、開始時に取った要素を渡す。
export type ShowNotice = (message: string, tone?: NoticeTone, returnFocusTo?: HTMLElement | null) => void;
