import { useRef } from "react";

type Props = {
  /** 下方向へ動かした量(px)を渡す。高さの上下限は呼び出し側で決める。 */
  onResize: (deltaY: number) => void;
  label: string;
};

// プレビューとコードの境目。どちらを大きく見たいかは場面で変わるため、その場で変えられるようにする。
export function VerticalSplitter({ onResize, label }: Props) {
  const lastY = useRef(0);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        lastY.current = event.clientY;
        // ポインタを捕まえておくと、素早く動かして境目から外れても操作が続く。
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = event.clientY - lastY.current;
        lastY.current = event.clientY;
        onResize(delta);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        const step = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(step);
      }}
      className="group flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center"
    >
      <span className="h-1 w-16 rounded-full bg-slate-300 transition group-hover:bg-slate-400" />
    </div>
  );
}
