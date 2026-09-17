/**
 * 学習の工程を、画面の状態から導く。
 *
 * この製品の価値は「生成して終わりにせず、変更理由を自分の言葉で書く」ことにある。
 * ところが機能が3カラムへ平坦に並んでいると、理由を書く工程が
 * 「右側にある追加機能」に見えてしまう。どこまで進んでいて次に何をするのかを
 * 画面から読み取れるようにするため、状態から工程を導出する。
 *
 * 判定は画面の状態だけで決まるので、ここは純粋な関数に閉じてテストできるようにする。
 */

export type LearningStepKey = "topic" | "generate" | "adjust" | "explain" | "submit";

export type FlowState = {
  /** 生成に使う題材が入力されているか。 */
  topicReady: boolean;
  /** たたき台を作ったか。静的サンプルのままなら false。 */
  generated: boolean;
  /** まだ理由を書いていない変更の数。 */
  unexplainedCount: number;
  /** 変更理由を記録したメモの数。コンセプトメモは含めない。 */
  explainedCount: number;
  /** 記録済みの学習メモの数。 */
  noteCount: number;
};

export type StepView = {
  key: LearningStepKey;
  label: string;
  /** 済んだ工程か。 */
  done: boolean;
  /** いま取り組んでいる工程か。 */
  current: boolean;
};

const stepLabels: Record<LearningStepKey, string> = {
  topic: "題材",
  generate: "生成",
  adjust: "調整",
  explain: "説明",
  submit: "提出",
};

const stepOrder: LearningStepKey[] = ["topic", "generate", "adjust", "explain", "submit"];

/** 各工程が済んでいるか。 */
function isDone(key: LearningStepKey, state: FlowState): boolean {
  switch (key) {
    // 題材と生成は、たたき台ができた時点でどちらも済んだことになる。
    case "topic":
      return state.topicReady || state.generated;
    case "generate":
      return state.generated;
    // 何かを変えたか、すでに記録が残っていれば「調整」は通っている。
    // 静的サンプルのまま調整することもあるため、生成の有無は問わない。
    case "adjust":
      return state.unexplainedCount > 0 || state.explainedCount > 0;
    // 説明は、記録が1件でも残っていれば通っている。
    case "explain":
      return state.explainedCount > 0;
    // 提出は最後の工程なので、ここでは済み扱いにしない。
    case "submit":
      return false;
  }
}

/**
 * いま取り組んでいる工程。
 *
 * 説明していない変更があるときは、他に何が残っていても「説明」を最優先にする。
 * 書かないまま次へ進んでしまうのを防ぐのが、この製品の狙いのため。
 * 静的サンプルのままでも調整と記録はできるので、生成の有無より説明を優先する。
 */
export function currentStep(state: FlowState): LearningStepKey {
  if (state.unexplainedCount > 0) return "explain";
  if (!state.generated) return state.topicReady ? "generate" : "topic";
  if (state.explainedCount === 0) return "adjust";
  return "submit";
}

/** 工程の一覧を、済み・現在地つきで返す。 */
export function stepViews(state: FlowState): StepView[] {
  const current = currentStep(state);
  return stepOrder.map((key) => ({
    key,
    label: stepLabels[key],
    done: isDone(key, state),
    current: key === current,
  }));
}

export type NextAction = {
  title: string;
  detail: string;
};

/**
 * 次にやることを1つだけ返す。
 *
 * 複数を並べると、結局どれから手を付ければよいのか分からなくなる。
 * 迷いを減らすために、その時点で一番やってほしいことだけを出す。
 */
export function nextAction(state: FlowState): NextAction {
  switch (currentStep(state)) {
    case "topic":
      return {
        title: "たたき台を作る",
        detail: "AIと相談してコンセプトを決めるか、題材を入力して生成しましょう。",
      };
    case "explain":
      return {
        title: "変えた理由を書く",
        detail: `まだ説明していない変更が${state.unexplainedCount}件あります。何を・なぜ・どう良くなるかを書いて記録しましょう。`,
      };
    case "adjust":
      return {
        title: "デザインや文章を変えてみる",
        detail: "色や見出しを変えて、見た目がどう変わるか確かめましょう。",
      };
    case "submit":
      return {
        title: "提出物をダウンロードする",
        detail: `学習メモ${state.noteCount}件と一緒に、ZIPで出力できます。まだ直したいところがあれば続けても構いません。`,
      };
    // currentStep は generate を返さないが、型の網羅性のために残す。
    case "generate":
      return {
        title: "たたき台を作る",
        detail: "AIと相談してコンセプトを決めるか、題材を入力して生成しましょう。",
      };
  }
}
