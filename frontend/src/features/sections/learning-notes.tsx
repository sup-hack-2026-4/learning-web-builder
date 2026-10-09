import { useBuilderStore } from "@/features/site-model/store";

// 記録した変更理由の一覧。新しいものを上に出す。
export function LearningNotes() {
  const notes = useBuilderStore((state) => state.notes);
  return (
    <>
      <h2 className="mb-2 mt-6 text-sm font-black">学習メモ <span className="text-slate-600">{notes.length}</span></h2>
      {/* 内側でスクロールさせない。列のスクロールと二重になり、どちらを動かせばよいか分からなくなる。 */}
      <div className="space-y-2">
        {notes.length === 0 ? <p className="text-xs text-slate-500">変更理由はまだありません。</p> : notes.slice().reverse().map((note) => (
          <div key={note.id} data-testid="learning-note" className="rounded-xl bg-slate-50 p-3 text-xs wrap-anywhere">
            <strong>{note.target}</strong>
            <p className="mt-1 text-slate-600">{note.reason}</p>
            {/* 書いた理由と、そのとき実際に変わったコードを対で残す。 */}
            {note.codeChanges && note.codeChanges.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-slate-200 pt-2">
                {/* 同じ内容の行が複数変わることがあるため、行本文ではなく並び順で見分ける。 */}
                {note.codeChanges.map((line, index) => (
                  <li key={`${note.id}-${index}`} className="truncate font-mono text-[10px] text-slate-500" title={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
