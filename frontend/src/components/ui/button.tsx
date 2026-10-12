import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ホバーの色は押せるときだけ付ける。押せないボタンが反応して見えると、押せると誤解させるため。
const variants = {
  primary: "bg-blue-600 text-white enabled:hover:bg-blue-700",
  secondary: "border border-slate-300 bg-white text-slate-800 enabled:hover:bg-slate-50",
  ghost: "text-slate-600 enabled:hover:bg-slate-100",
  // 取り消せない操作。確認の中など、押す直前の場面で使う。
  danger: "text-danger enabled:hover:bg-danger-hover",
  // 一覧の行に並ぶアイコンなど、普段は目立たせず、触れたときに役割が分かればよいもの。
  // 目立たせないといっても、白・灰色・選択中の背景でアイコンを見分けられる濃さ（3:1以上）は保つ。
  quiet: "text-slate-500 enabled:hover:bg-slate-100 enabled:hover:text-slate-700",
  // quietの削除版。ゴミ箱アイコンのように、触れたときに危険な操作だと分かるようにする。
  "quiet-danger": "text-slate-500 enabled:hover:bg-danger-subtle enabled:hover:text-danger",
} as const;

// 高さはここでだけ決め、呼び出し側では上書きしない。
// iconも指で押せる40px四方を確保する。アイコン自体は小さいままでよい。
const sizes = {
  md: "min-h-10 gap-2 px-4 py-2 text-sm",
  sm: "min-h-9 gap-1 px-3 py-1.5 text-xs",
  icon: "size-10 shrink-0 p-0",
} as const;

// React 19ではrefも通常のpropsとして渡るため、refを含む型にしてbuttonへそのまま流す。
type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  // 先頭に置くアイコン。処理中はスピナーに差し替わる。
  icon?: ReactNode;
  // 処理中。押せなくし、支援技術にも処理中であることを伝える。
  loading?: boolean;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-bold transition disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" /> : icon}
      {children}
    </button>
  );
}
