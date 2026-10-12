import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Textarea } from "@/components/ui/textarea";
import type { SiteGeneration } from "./use-site-generation";

// 題材を直接入力して生成する欄。相談をしない人のための補助の導線。
export function TopicForm({ generation }: { generation: SiteGeneration }) {
  const { topic, setTopic, topicError, submitTopic, isPending } = generation;
  return (
    // 畳んでしまうと題材から始めたい人が迷うため表示は残し、
    // 見た目の重みだけを落として、相談が主であることを示す。
    <div className="mt-5 border-t border-slate-200 pt-4">
      <p className="mb-2 text-xs text-slate-500">題材が決まっているなら、直接入力しても始められます。</p>
      <form onSubmit={submitTopic} className="space-y-2">
        <label className="text-xs font-bold text-slate-600" htmlFor="topic">紹介サイトの題材</label>
        <Textarea
          id="topic"
          rows={2}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="例：地域の小さな植物園"
          aria-invalid={topicError ? true : undefined}
          aria-describedby={topicError ? "topic-error" : undefined}
        />
        <FieldError id="topic-error" message={topicError} />
        <Button variant="secondary" className="w-full" disabled={!topic.trim() || topicError !== null} loading={isPending} icon={<Sparkles className="size-4" />}>
          {isPending ? "生成中…" : "たたき台を生成"}
        </Button>
      </form>
    </div>
  );
}
