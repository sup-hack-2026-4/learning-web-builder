// 「理由を書いた」ことと「理解できている」ことは同じではない、というレビュー指摘への対応。
// 何を・なぜ・どう良くなるかの3点がそろって初めて、変更を自分の言葉で説明できている状態とみなす。
// 判定は書き手を止めるためではなく、書き足す観点をその場で示すために使う。
export type ReasonAspect = "target" | "cause" | "effect";

export type ReasonCheck = {
  id: ReasonAspect;
  label: string;
  passed: boolean;
  /** 満たしていないときに示す、書き足しかたの案内。 */
  hint: string;
};

// 変更した部分を指す言葉。画面の操作項目と、生徒が使いそうな言い換えを並べる。
const targetWords = [
  "色", "カラー", "背景", "文字", "テキスト", "余白", "スペース", "間隔",
  "フォント", "書体", "ゴシック", "明朝", "丸ゴ",
  "見出し", "タイトル", "本文", "文章", "説明", "画像", "写真",
  "レイアウト", "配置", "ヘッダー", "フッター", "セクション",
  "サイズ", "大きさ", "太さ", "行間", "全体",
];

// 根拠を述べている表現。日本語では文末に出るため、含まれるかどうかで見る。
const causeWords = ["から", "ため", "ので", "ように", "たい", "必要", "べき", "目的", "理由"];

// 変更後にどう良くなるかを述べている言葉。読み手への影響を意識できているかを見る。
// 「読みにくいから直した」のように、直す前の問題を書く形も効果の説明とみなす。
const effectWords = [
  "読みやす", "見やす", "分かりやす", "わかりやす", "使いやす", "見つけやす",
  "読みにく", "見にく", "分かりにく", "わかりにく", "使いにく",
  "伝わ", "伝え", "目立", "強調", "印象", "雰囲気", "統一", "バランス",
  "整理", "区別", "メリハリ", "めりはり", "落ち着", "コントラスト", "優先",
];

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function evaluateReason(reason: string): ReasonCheck[] {
  const text = reason.trim();

  return [
    {
      id: "target",
      label: "何を変えたか",
      passed: includesAny(text, targetWords),
      hint: "色・余白・見出しなど、変えた部分の名前を入れましょう。",
    },
    {
      id: "cause",
      label: "なぜ変えるか",
      passed: includesAny(text, causeWords),
      hint: "「〜だから」「〜のため」と、根拠まで書きましょう。",
    },
    {
      id: "effect",
      label: "どう良くなるか",
      passed: includesAny(text, effectWords),
      hint: "読みやすさや伝わりやすさなど、読む人にとっての変化を書きましょう。",
    },
  ];
}

export function countPassedAspects(checks: ReasonCheck[]): number {
  return checks.filter((check) => check.passed).length;
}
