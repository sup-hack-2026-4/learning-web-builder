import { beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "./store";
import { createSampleSite } from "./sample";
import { emptyDraft } from "@/features/concept/schema";

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
  useBuilderStore.setState({ notes: [], aiUsage: [] });
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
