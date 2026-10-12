import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraft } from "@/features/concept/schema";
import { createSampleSite } from "./sample";
import { MAX_SITE_TITLE_LENGTH, MAX_TAGLINE_LENGTH, MAX_TOPIC_LENGTH, siteModelProblem, siteModelSchema } from "./schema";
import { useBuilderStore } from "./store";

// 下書きの復元はlocalStorageを使うため、ロジックのテストだがjsdomで動かす。

beforeEach(() => {
  useBuilderStore.setState({ notes: [], aiUsage: [], site: createSampleSite(), selectedElementId: "hero" });
  useBuilderStore.getState().discardTracking();
});

describe("以前の版の下書きの復元(#130)", () => {
  it("題材を切らずに作られた見本でも、見出しを直せば保存できる状態になる", async () => {
    // 以前の版の見本は、題材をそのまま題材・サイト名・最初の見出し・キャッチコピーに使っていた。
    const longTopic = "あ".repeat(140);
    const sample = createSampleSite();
    const oldDraft = {
      ...sample,
      topic: longTopic,
      siteTitle: longTopic,
      tagline: `${longTopic}の魅力を、初めての方にも分かりやすく紹介します。`,
      sections: sample.sections.map((section) => (section.id === "hero" ? { ...section, title: longTopic } : section)),
    };
    localStorage.setItem(
      useBuilderStore.persist.getOptions().name!,
      JSON.stringify({
        state: { site: oldDraft, selectedElementId: "hero", notes: [], aiUsage: [], chatMessages: [], conceptDraft: emptyDraft, conceptChoices: [] },
        version: 3,
      }),
    );

    await useBuilderStore.persist.rehydrate();

    // 作りかけの作品は失わない。画面に編集欄の無い項目だけを、上限に収める。
    const restored = useBuilderStore.getState().site;
    expect(restored.id).toBe(oldDraft.id);
    expect(restored.topic).toBe("あ".repeat(MAX_TOPIC_LENGTH));
    expect(restored.siteTitle).toBe("あ".repeat(MAX_SITE_TITLE_LENGTH));
    expect([...restored.tagline]).toHaveLength(MAX_TAGLINE_LENGTH);
    // 編集欄で直せる見出しは、切らずにそのまま残す。保存できない理由は、どの項目かと一緒に伝わる。
    expect(restored.sections[0].title).toBe(longTopic);
    expect(siteModelProblem(restored)).toBe(`「${longTopic}」のセクション: 見出しは80文字以内で入力してください（いま140文字）。`);

    useBuilderStore.getState().updateSection("hero", { title: "直した見出し" });

    expect(siteModelProblem(useBuilderStore.getState().site)).toBeNull();
    expect(() => siteModelSchema.parse(useBuilderStore.getState().site)).not.toThrow();
  });
});
