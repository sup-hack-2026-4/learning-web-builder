import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// ラベルの中に置いても太字や小さい文字を引き継がないよう、文字の太さと大きさをここで決める。
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
