import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// WAI-ARIAのタブは、Tabキーでタブ列に入ったあと方向キーで移動する。
// 選択中だけをタブ順に含め(tabIndex=0)、方向キーでフォーカスと選択を循環させる。
export function handleTabKeyDown<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  keys: readonly T[],
  current: T,
  orientation: "vertical" | "horizontal",
  tabId: (key: T) => string,
  select: (key: T) => void,
) {
  const [previous, next] = orientation === "vertical"
    ? ["ArrowUp", "ArrowDown"]
    : ["ArrowLeft", "ArrowRight"];
  const step = event.key === next ? 1 : event.key === previous ? -1 : 0;
  let index = keys.indexOf(current);
  if (step !== 0) index = (index + step + keys.length) % keys.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = keys.length - 1;
  else return;

  event.preventDefault();
  select(keys[index]);
  // 選択と同時にフォーカスも移す（ARIAの自動アクティベーション）。
  // 子要素の並び順ではなくidで引く。タブ以外が同居しても壊れないようにするため。
  document.getElementById(tabId(keys[index]))?.focus();
}
