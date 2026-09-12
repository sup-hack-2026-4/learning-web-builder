import { describe, expect, it } from "vitest";
import { currentStep, nextAction, stepViews, type FlowState } from "./steps";

const start: FlowState = { topicReady: false, generated: false, unexplainedCount: 0, explainedCount: 0, noteCount: 0 };

describe("currentStep", () => {
  it("生成前は題材から始まる", () => {
    expect(currentStep(start)).toBe("topic");
  });

  it("題材を入力したら生成へ進む", () => {
    expect(currentStep({ ...start, topicReady: true })).toBe("generate");
  });

  it("コンセプトメモだけでは調整と説明を済み扱いにしない", () => {
    expect(currentStep({ ...start, topicReady: true, generated: true, noteCount: 1 })).toBe("adjust");
  });

  it("生成しただけなら、次は調整", () => {
    expect(currentStep({ ...start, generated: true })).toBe("adjust");
  });

  it("説明していない変更があれば説明へ進む", () => {
    expect(currentStep({ topicReady: true, generated: true, unexplainedCount: 2, explainedCount: 0, noteCount: 0 })).toBe("explain");
  });

  it("記録が残っていても、説明していない変更があれば説明へ戻す", () => {
    // 書かないまま次の変更へ進んでしまうのを防ぐのが、この製品の狙い。
    expect(currentStep({ topicReady: true, generated: true, unexplainedCount: 1, explainedCount: 3, noteCount: 3 })).toBe("explain");
  });

  it("すべて説明済みなら提出へ", () => {
    expect(currentStep({ topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 1, noteCount: 1 })).toBe("submit");
  });

  it("生成前でも、変更したなら説明が先", () => {
    // 静的サンプルのままでも調整と記録はできる。
    // 未説明の変更を抱えたまま別のことへ進ませない。
    expect(currentStep({ topicReady: false, generated: false, unexplainedCount: 2, explainedCount: 0, noteCount: 0 })).toBe("explain");
  });

  it("生成前で変更もないなら題材から", () => {
    expect(currentStep({ topicReady: false, generated: false, unexplainedCount: 0, explainedCount: 1, noteCount: 1 })).toBe("topic");
  });
});

describe("stepViews", () => {
  it("工程は題材から提出までの5つ", () => {
    expect(stepViews(start).map((step) => step.key)).toEqual([
      "topic",
      "generate",
      "adjust",
      "explain",
      "submit",
    ]);
  });

  it("開始時は題材が現在地で、どれも済んでいない", () => {
    const views = stepViews(start);

    expect(views.find((step) => step.current)?.key).toBe("topic");
    expect(views.every((step) => !step.done)).toBe(true);
  });

  it("生成すると題材と生成が済みになる", () => {
    const views = stepViews({ ...start, generated: true });

    expect(views.find((step) => step.key === "topic")?.done).toBe(true);
    expect(views.find((step) => step.key === "generate")?.done).toBe(true);
    expect(views.find((step) => step.key === "adjust")?.done).toBe(false);
  });

  it("題材を入力すると生成が現在地になる", () => {
    const views = stepViews({ ...start, topicReady: true });

    expect(views.find((step) => step.key === "topic")?.done).toBe(true);
    expect(views.find((step) => step.key === "generate")?.current).toBe(true);
  });

  it("変更すると調整が済みになる", () => {
    const views = stepViews({ topicReady: true, generated: true, unexplainedCount: 1, explainedCount: 0, noteCount: 0 });
    expect(views.find((step) => step.key === "explain")?.current).toBe(true);

    expect(views.find((step) => step.key === "adjust")?.done).toBe(true);
    expect(views.find((step) => step.key === "explain")?.done).toBe(false);
  });

  it("記録すると説明が済みになる", () => {
    const views = stepViews({ topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 1, noteCount: 1 });

    expect(views.find((step) => step.key === "explain")?.done).toBe(true);
  });

  it("提出は最後の工程なので済み扱いにしない", () => {
    const views = stepViews({ topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 5, noteCount: 5 });

    expect(views.find((step) => step.key === "submit")?.done).toBe(false);
    expect(views.find((step) => step.key === "submit")?.current).toBe(true);
  });

  it("現在地はいつも1つだけ", () => {
    const states: FlowState[] = [
      start,
      { ...start, generated: true },
      { topicReady: true, generated: true, unexplainedCount: 1, explainedCount: 0, noteCount: 0 },
      { topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 2, noteCount: 2 },
      { topicReady: true, generated: true, unexplainedCount: 3, explainedCount: 2, noteCount: 2 },
    ];

    for (const state of states) {
      expect(stepViews(state).filter((step) => step.current)).toHaveLength(1);
    }
  });
});

describe("nextAction", () => {
  it("生成前はたたき台を作るよう促す", () => {
    expect(nextAction(start).title).toBe("たたき台を作る");
  });

  it("生成しただけなら、変えてみるよう促す", () => {
    expect(nextAction({ ...start, generated: true }).title).toBe("デザインや文章を変えてみる");
  });

  it("題材を入力したら、たたき台を作るよう促す", () => {
    expect(nextAction({ ...start, topicReady: true }).title).toBe("たたき台を作る");
  });

  it("未説明の件数を本文に出す", () => {
    // 件数が分からないと、あと何を書けば終わるのか見えない。
    const action = nextAction({ topicReady: true, generated: true, unexplainedCount: 3, explainedCount: 0, noteCount: 0 });

    expect(action.title).toBe("変えた理由を書く");
    expect(action.detail).toContain("3件");
  });

  it("提出時はメモの件数を伝える", () => {
    const action = nextAction({ topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 4, noteCount: 4 });

    expect(action.title).toBe("提出物をダウンロードする");
    expect(action.detail).toContain("4件");
  });

  it("どの状態でも文言が空にならない", () => {
    const states: FlowState[] = [
      start,
      { ...start, generated: true },
      { topicReady: true, generated: true, unexplainedCount: 1, explainedCount: 0, noteCount: 0 },
      { topicReady: true, generated: true, unexplainedCount: 0, explainedCount: 1, noteCount: 1 },
    ];

    for (const state of states) {
      const action = nextAction(state);
      expect(action.title.length).toBeGreaterThan(0);
      expect(action.detail.length).toBeGreaterThan(0);
    }
  });
});
