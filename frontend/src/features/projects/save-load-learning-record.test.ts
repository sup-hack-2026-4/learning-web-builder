import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLearningNotes } from "@/features/export/export-project";
import { createSampleSite } from "@/features/site-model/sample";
import { useBuilderStore } from "@/features/site-model/store";
import { getProject, saveProject } from "@/lib/api";

const projectId = "11111111-1111-4111-8111-111111111111";

// 保存APIを、受け取った本文をそのまま保存して返すサーバーに見立てる。
function stubProjectServer() {
  let stored: Record<string, unknown> | null = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      stored = {
        ...body,
        id: projectId,
        version: 1,
        createdAt: "2026-09-29T00:00:00Z",
        updatedAt: "2026-09-29T00:00:00Z",
      };
      return Response.json(stored, { status: 201 });
    }
    return Response.json(stored);
  }));
}

// 提出物ZIPの learning-notes.md と ai-usage.json に入る中身。
function exportedLearning() {
  const { notes, aiUsage } = useBuilderStore.getState();
  return { learningNotes: buildLearningNotes(notes), aiUsage: JSON.stringify(aiUsage, null, 2) };
}

beforeEach(() => {
  useBuilderStore.getState().reset();
  stubProjectServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("保存と読み込み", () => {
  it("保存→読み込みのあとも、提出物に入る学習メモとAI利用記録が変わらない", async () => {
    // #114: 以前は作品しか保存せず、読み込むと学習の記録が空になっていた。
    const store = useBuilderStore.getState();
    store.setSite(createSampleSite("学校の写真部"), "gemini", "コンセプト相談をもとにした生成");
    store.addNote("コンセプト", "新入生に活動の雰囲気を伝える");
    store.addNote("デザイン変更（メインカラーを #b91c1c に）", "作品の写真が映える落ち着いた赤にした", ["--primary: #b91c1c;"]);
    store.addNote("内容変更（活動紹介）", "撮影会の様子が伝わるよう説明を足した", ['<p class="body">毎週金曜に撮影会をしています &amp; 講評会も</p>']);
    // 変わったコードが無かった記録。空の一覧のまま往復し、省略に変わらないことも確かめる。
    store.addNote("表示切替（お問い合わせ）", "まだ連絡先が決まっていないので隠した", []);
    const before = exportedLearning();
    const { site, notes, aiUsage } = useBuilderStore.getState();
    const getToken = async () => "session-token";

    await saveProject(site, { notes, aiUsage }, getToken);
    // 保存後に別の作業を始めて、手元の記録が入れ替わった状態から読み込む。
    useBuilderStore.getState().reset();
    const project = await getProject(projectId, getToken);
    useBuilderStore.getState().loadSite(project.site, { notes: project.notes, aiUsage: project.aiUsage });

    expect(exportedLearning()).toEqual(before);
    expect(useBuilderStore.getState().notes).toEqual(notes);
    expect(useBuilderStore.getState().aiUsage).toEqual(aiUsage);
  });
});
