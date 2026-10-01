import { describe, expect, it } from "vitest";
import { createSampleSite } from "./sample";
import {
  MAX_SECTION_TITLE_LENGTH,
  MAX_TOPIC_LENGTH,
  sectionFieldProblem,
  siteModelProblem,
  siteModelSchema,
  topicProblem,
} from "./schema";

describe("見本のサイトと文字数の上限(#117)", () => {
  it.each([
    ["見出しの上限をちょうど超える題材", "あ".repeat(MAX_SECTION_TITLE_LENGTH + 1)],
    ["題材の上限いっぱい", "あ".repeat(MAX_TOPIC_LENGTH)],
    ["題材の上限を超える題材", "あ".repeat(MAX_TOPIC_LENGTH + 20)],
    ["絵文字を含む長い題材", "🌸".repeat(MAX_TOPIC_LENGTH)],
  ])("%sでも、スキーマを満たす", (_label, topic) => {
    expect(() => siteModelSchema.parse(createSampleSite(topic))).not.toThrow();
  });

  it("サイト名と最初の見出しは、見出しの上限で切る", () => {
    const site = createSampleSite("あ".repeat(MAX_SECTION_TITLE_LENGTH + 1));

    expect(site.siteTitle).toBe("あ".repeat(MAX_SECTION_TITLE_LENGTH));
    expect(site.sections[0].title).toBe("あ".repeat(MAX_SECTION_TITLE_LENGTH));
  });

  it("絵文字は途中で割らずに切る", () => {
    const site = createSampleSite("🌸".repeat(MAX_SECTION_TITLE_LENGTH + 1));

    expect([...site.siteTitle]).toHaveLength(MAX_SECTION_TITLE_LENGTH);
    expect(site.siteTitle).toBe("🌸".repeat(MAX_SECTION_TITLE_LENGTH));
  });
});

describe("入力欄のエラー", () => {
  it("題材は上限までなら通し、超えたら文字数と一緒に伝える", () => {
    expect(topicProblem("あ".repeat(MAX_TOPIC_LENGTH))).toBeNull();
    expect(topicProblem(`  ${"あ".repeat(MAX_TOPIC_LENGTH)}  `)).toBeNull();
    expect(topicProblem("あ".repeat(MAX_TOPIC_LENGTH + 1))).toBe("題材は100文字以内で入力してください（いま101文字）。");
  });

  it("文字数はサーバーと同じく、絵文字も1文字として数える", () => {
    expect(topicProblem("🌸".repeat(MAX_TOPIC_LENGTH))).toBeNull();
  });

  it("見出しは空と上限超えを、本文と画像の説明は上限超えを伝える", () => {
    expect(sectionFieldProblem("title", "")).toBe("見出しを入力してください。");
    expect(sectionFieldProblem("title", "あ".repeat(81))).toBe("見出しは80文字以内で入力してください（いま81文字）。");
    expect(sectionFieldProblem("body", "")).toBeNull();
    expect(sectionFieldProblem("body", "あ".repeat(801))).toBe("本文は800文字以内で入力してください（いま801文字）。");
    expect(sectionFieldProblem("imageAlt", "あ".repeat(161))).toBe("画像の説明（alt）は160文字以内で入力してください（いま161文字）。");
  });

  // サーバーは空白を除いて空の見出しを断る。画面で通すと、保存のときに初めて汎用のエラーになる。
  it.each([
    ["半角の空白", "   "],
    ["全角の空白", "　　"],
    ["改行とタブ", "\n\t"],
  ])("%sだけの見出しは、空として伝える", (_label, title) => {
    expect(sectionFieldProblem("title", title)).toBe("見出しを入力してください。");
  });

  it("見出しの文字数は、前後の空白も含めて数える", () => {
    expect(sectionFieldProblem("title", ` ${"あ".repeat(MAX_SECTION_TITLE_LENGTH - 1)}`)).toBeNull();
    expect(sectionFieldProblem("title", ` ${"あ".repeat(MAX_SECTION_TITLE_LENGTH)}`)).toBe(
      "見出しは80文字以内で入力してください（いま81文字）。",
    );
  });
});

describe("保存前の検証", () => {
  it("問題が無ければnullを返す", () => {
    expect(siteModelProblem(createSampleSite())).toBeNull();
  });

  it("どのセクションのどの項目を直せばよいかを伝える", () => {
    const site = createSampleSite();
    site.sections = site.sections.map((section) =>
      section.id === "about" ? { ...section, body: "あ".repeat(801) } : section,
    );

    expect(siteModelProblem(site)).toBe("「私たちについて」のセクション: 本文は800文字以内で入力してください（いま801文字）。");
  });

  it("見出しが空のセクションは、idで示す", () => {
    const site = createSampleSite();
    site.sections = site.sections.map((section) => (section.id === "about" ? { ...section, title: "" } : section));

    expect(siteModelProblem(site)).toBe("「about」のセクション: 見出しを入力してください。");
  });

  it("見出しが空白だけのセクションも保存せず、idで示す", () => {
    const site = createSampleSite();
    site.sections = site.sections.map((section) => (section.id === "about" ? { ...section, title: "　 " } : section));

    expect(siteModelProblem(site)).toBe("「about」のセクション: 見出しを入力してください。");
  });

  it("画像の枚数のように全体で決まる問題は、スキーマの説明で伝える", () => {
    const site = createSampleSite();
    const image = { dataUri: "data:image/jpeg;base64,/9j/4AAQ", fileName: "a.jpg" };
    site.sections = site.sections.map((section, index) =>
      section.kind === "contact" ? section : { ...section, image: { ...image, fileName: `image-${index}.jpg` } },
    );
    site.sections.push({ id: "gallery", kind: "gallery", title: "写真", body: "", imageAlt: "", visible: true, image: { ...image, fileName: "g.jpg" } });
    site.sections.push({ id: "gallery-2", kind: "gallery", title: "写真2", body: "", imageAlt: "", visible: true, image: { ...image, fileName: "g2.jpg" } });

    expect(siteModelProblem(site)).toBe("画像は全体で4枚までです。");
  });
});
