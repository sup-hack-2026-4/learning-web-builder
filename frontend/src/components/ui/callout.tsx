import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones = {
  info: "bg-blue-50 text-blue-900",
  warning: "bg-warning-subtle text-warning-strong",
  danger: "bg-danger-subtle text-danger-strong",
} as const;

// 枠線付きの tone。画面の上に重なって出る通知など、周りから浮かせたいときに使う。
const elevatedTones = {
  info: "border border-blue-200 shadow-sm",
  warning: "border border-warning-border shadow-sm",
  danger: "border border-danger-border shadow-sm",
} as const;

type CalloutTone = keyof typeof tones;

type CalloutProps = HTMLAttributes<HTMLDivElement> & {
  // nullのときは見た目を付けない。ライブリージョンを含む枠は、
  // 中身が無い間も同じ要素のまま残す必要があるため、要素を差し替えずに見た目だけ消せるようにする。
  tone: CalloutTone | null;
  elevated?: boolean;
};

// 注意・確認・案内の枠。画面の中で読ませたい一文を、意味に応じた色で囲む。
export function Callout({ tone, elevated = false, className, ...props }: CalloutProps) {
  return (
    <div
      className={tone ? cn("rounded-xl p-3 text-xs leading-5", tones[tone], elevated && elevatedTones[tone], className) : undefined}
      {...props}
    />
  );
}
