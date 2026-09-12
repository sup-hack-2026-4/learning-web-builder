import { beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "./store";
import { createSampleSite } from "./sample";
import { emptyDraft } from "@/features/concept/schema";
import { maxSections, minSections } from "./sections";

const conversation = [
  { role: "model" as const, text: "どんなものを紹介しますか" },
  { role: "user" as const, text: "地域の小さな植物園" },
];

const filledDraft = {
  topic: "地域の小さな植物園",
  audience: "近所の家族連れ",
  goal: "週末に来てほしい",
  tone: "",
  mustInclude: [],
};

function seedConversation() {
  const store = useBuilderStore.getState();
  conversation.forEach(store.appendChatMessage);
  useBuilderStore.getState().setConceptReply(filledDraft, ["近所の家族連れ"]);
}

beforeEach(() => {
  useBuilderStore.getState().resetConcept();
  useBuilderStore.setState({ notes: [], aiUsage: [], site: createSampleSite(), selectedElementId: "hero" });
});

describe("相談の履歴", () => {
  it("送信した発言を積み上げる", () => {
    seedConversation();

    expect(useBuilderStore.getState().chatMessages).toHaveLength(2);
    expect(useBuilderStore.getState().conceptChoices).toEqual(["近所の家族連れ"]);
  });

  it("直前の発言だけを取り消せる", () => {
    // 送信が失敗したとき、楽観的に足した発言を残すと同じ文が積み上がる。
    seedConversation();

    useBuilderStore.getState().dropLastChatMessage();

    const messages = useBuilderStore.getState().chatMessages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("model");
  });
});

describe("やり直しと世代", () => {
  it("やり直すと会話と下書きが消える", () => {
    seedConversation();

    useBuilderStore.getState().resetConcept();

    const state = useBuilderStore.getState();
    expect(state.chatMessages).toEqual([]);
    expect(state.conceptDraft).toEqual(emptyDraft);
    expect(state.conceptChoices).toEqual([]);
  });

  it("やり直すたびに世代が進む", () => {
    // 応答が返るころにやり直されていたら、古い応答だと判別できる必要がある。
    const before = useBuilderStore.getState().conceptGeneration;

    useBuilderStore.getState().resetConcept();

    expect(useBuilderStore.getState().conceptGeneration).toBe(before + 1);
  });
});

describe("サイトの差し替えと相談の関係", () => {
  it("生成しても相談は残る", () => {
    // 何を決めて生成したのかを、あとから見返せるようにする。
    seedConversation();

    useBuilderStore.getState().setSite(createSampleSite("植物園"), "gemini");

    expect(useBuilderStore.getState().chatMessages).toHaveLength(2);
    expect(useBuilderStore.getState().conceptDraft.topic).toBe("地域の小さな植物園");
  });

  it("別のプロジェクトを読み込むと相談は消える", () => {
    // 前の題材の相談が残ったままだと、いま開いている案件の内容と食い違う。
    seedConversation();
    const before = useBuilderStore.getState().conceptGeneration;

    useBuilderStore.getState().loadSite(createSampleSite("別の題材"));

    const state = useBuilderStore.getState();
    expect(state.chatMessages).toEqual([]);
    expect(state.conceptDraft).toEqual(emptyDraft);
    expect(state.conceptGeneration).toBe(before + 1);
  });

  it("ヒーローがないプロジェクトを読み込むと、実在する先頭セクションを選ぶ", () => {
    const site = createSampleSite("別の題材");
    site.sections = site.sections.filter((section) => section.id !== "hero");

    useBuilderStore.getState().loadSite(site);

    expect(useBuilderStore.getState().selectedElementId).toBe(site.sections[0].id);
  });

  it("全体をリセットすると相談も消える", () => {
    seedConversation();

    useBuilderStore.getState().reset();

    expect(useBuilderStore.getState().chatMessages).toEqual([]);
    expect(useBuilderStore.getState().conceptDraft).toEqual(emptyDraft);
  });
});

describe("AI利用の記録", () => {
  it("相談を経た生成は用途を書き分ける", () => {
    useBuilderStore.getState().setSite(createSampleSite("植物園"), "gemini", "コンセプト相談と、サイト構成・仮文章の生成");

    expect(useBuilderStore.getState().aiUsage[0].purpose).toBe("コンセプト相談と、サイト構成・仮文章の生成");
  });

  it("相談を使わない生成はこれまでどおりの用途になる", () => {
    useBuilderStore.getState().setSite(createSampleSite("植物園"), "gemini");

    expect(useBuilderStore.getState().aiUsage[0].purpose).toBe("サイト構成と仮文章の生成");
  });
});

describe("セクションの追加と削除", () => {
  it("選んだ種類のセクションを末尾へ足す", () => {
    const before = useBuilderStore.getState().site.sections.length;

    useBuilderStore.getState().addSection("gallery");

    const sections = useBuilderStore.getState().site.sections;
    expect(sections).toHaveLength(before + 1);
    expect(sections.at(-1)?.kind).toBe("gallery");
    // 足した直後に中身を書き始められるよう、選択状態にする。
    expect(useBuilderStore.getState().selectedElementId).toBe(sections.at(-1)?.id);
  });

  it("同じ種類を足してもidが重複しない", () => {
    // サーバー側の site.Validate はid重複を弾くため、保存できなくなってしまう。
    useBuilderStore.getState().addSection("gallery");
    useBuilderStore.getState().addSection("gallery");

    const ids = useBuilderStore.getState().site.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("8件を超えては足せない", () => {
    // 画面側でもボタンを無効にするが、ここを最後の砦として残す。
    for (let index = 0; index < 10; index += 1) useBuilderStore.getState().addSection("gallery");

    expect(useBuilderStore.getState().site.sections).toHaveLength(maxSections);
  });

  it("指定したセクションだけを消す", () => {
    useBuilderStore.getState().removeSection("features");

    const ids = useBuilderStore.getState().site.sections.map((section) => section.id);
    expect(ids).not.toContain("features");
    expect(ids).toContain("about");
  });

  it("選択中のセクションを消したら、残っているセクションへ選択を移す", () => {
    // 消したidを選んだままだと、右パネルの編集欄が消えて何も選べなくなる。
    useBuilderStore.getState().selectElement("features");

    useBuilderStore.getState().removeSection("features");

    const state = useBuilderStore.getState();
    expect(state.selectedElementId).toBe(state.site.sections[0].id);
  });

  it("2件を下回っては消せない", () => {
    for (const id of ["hero", "about", "features", "contact"]) {
      useBuilderStore.getState().removeSection(id);
    }

    expect(useBuilderStore.getState().site.sections).toHaveLength(minSections);
  });

  it("存在しないidでは何も変わらない", () => {
    const before = useBuilderStore.getState().site.sections;

    useBuilderStore.getState().removeSection("no-such-section");

    expect(useBuilderStore.getState().site.sections).toBe(before);
  });
});
