import type { ReactNode } from "react";
import { handleTabKeyDown } from "@/lib/tab-keyboard";
import { cn } from "@/lib/utils";

// 見た目は置き場所ごとに違うが、役割（role・選択状態・キー操作）はそろえる。
const variants = {
  // パネル上部のタブ。選んだタブを下線で示す。
  underline: {
    tab: "rounded-t-lg px-3 py-2 text-sm whitespace-nowrap",
    selected: "bg-white text-blue-700 shadow-[inset_0_-2px_0_0_currentColor]",
    idle: "text-slate-500 hover:bg-white/60 hover:text-slate-800",
  },
  // 小さな切り替え。選んだタブを塗りで示す。
  pill: {
    tab: "rounded-lg px-2.5 py-1 text-xs",
    selected: "bg-slate-900 text-white",
    idle: "text-slate-600 hover:bg-slate-100",
  },
  // 狭い画面の下部バー。横幅を等分し、選んだタブを上端の線で示す。
  bar: {
    tab: "flex-1 py-3 text-xs",
    selected: "text-blue-700",
    idle: "text-slate-600",
  },
} as const;

export type TabItem<T extends string> = {
  key: T;
  label: ReactNode;
  title?: string;
};

type TabsProps<T extends string> = {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (key: T) => void;
  // idはタブパネル側のaria-labelledbyからも参照されるため、呼び出し側で決める。
  tabId: (key: T) => string;
  panelId: (key: T) => string;
  variant?: keyof typeof variants;
  className?: string;
  tabClassName?: string;
};

// WAI-ARIAのタブ列。Tabキーで選択中のタブへ入り、方向キーとHome/Endで移動する。
// role="tablist"の子はtabだけにする。タブ以外のボタンは、この外に置くこと。
export function Tabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  tabId,
  panelId,
  variant = "underline",
  className,
  tabClassName,
}: TabsProps<T>) {
  const keys = items.map((item) => item.key);
  const style = variants[variant];
  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cn("flex", className)}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={tabId(item.key)}
            aria-selected={selected}
            aria-controls={panelId(item.key)}
            tabIndex={selected ? 0 : -1}
            title={item.title}
            onKeyDown={(event) => handleTabKeyDown(event, keys, value, "horizontal", tabId, onValueChange)}
            onClick={() => onValueChange(item.key)}
            className={cn("relative font-bold transition", style.tab, selected ? style.selected : style.idle, tabClassName)}
          >
            {item.label}
            {variant === "bar" && selected && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-current" />}
          </button>
        );
      })}
    </div>
  );
}
