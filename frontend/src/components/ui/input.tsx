import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm", className)} {...props} />;
}

