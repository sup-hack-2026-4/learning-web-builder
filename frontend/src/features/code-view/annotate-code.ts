import { isHeroSection } from "../artifacts/build-site-artifacts";
import type { SiteModel, SiteSection } from "../site-model/schema";

// 生成コードを画面へ出すための行データ。
// 「いま選んでいる要素がコードのどこか」を示すため、行ごとに対応する要素IDを持たせる。
export type CodeLine = {
  /** 1始まりの行番号。画面の行番号表示と、選択行への移動に使う。 */
  number: number;
  text: string;
  tokens: CodeToken[];
  /** この行が書いている要素のbuilderId。どの要素にも属さない行は空。 */
  relatedIds: string[];
};

export type CodeToken = {
  text: string;
  kind: TokenKind;
};

// 色分けの種類。読みやすさのためだけに使うので、言語仕様の厳密な分類ではない。
export type TokenKind =
  | "plain"
  | "comment"
  | "tag"
  | "attribute"
  | "string"
  | "selector"
  | "property"
  | "value"
  | "keyword";

// 行を組み立てる補助。同じ種類が続く文字は1つのトークンへまとめ、改行で行を切る。
function createLineBuilder() {
  const lines: CodeToken[][] = [];
  let currentLine: CodeToken[] = [];
  let buffer = "";
  let currentKind: TokenKind = "plain";

  const flush = () => {
    if (!buffer) return;
    currentLine.push({ text: buffer, kind: currentKind });
    buffer = "";
  };

  return {
    push(character: string, kind: TokenKind) {
      if (character === "\n") {
        flush();
        lines.push(currentLine);
        currentLine = [];
        return;
      }
      if (kind !== currentKind) {
        flush();
        currentKind = kind;
      }
      buffer += character;
    },
    finish(): CodeToken[][] {
      flush();
      lines.push(currentLine);
      return lines;
    },
  };
}

export function tokenizeHtml(code: string): CodeToken[][] {
  const builder = createLineBuilder();
  // タグの外(text) / タグの中(tag) / コメント / 属性値 の4状態で読む。
  let state: "text" | "tag" | "comment" | "attributeValue" = "text";
  // タグに入った直後の識別子はタグ名、それ以降は属性名として色を分ける。
  let expectsTagName = false;
  let quote = "";

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];

    if (state === "comment") {
      builder.push(character, "comment");
      if (code.startsWith("-->", index - 2)) state = "text";
      continue;
    }

    if (state === "attributeValue") {
      builder.push(character, "string");
      if (character === quote) state = "tag";
      continue;
    }

    if (state === "text") {
      if (code.startsWith("<!--", index)) {
        state = "comment";
        builder.push(character, "comment");
        continue;
      }
      if (character === "<") {
        state = "tag";
        expectsTagName = true;
        builder.push(character, "tag");
        continue;
      }
      builder.push(character, "plain");
      continue;
    }

    // タグの中を読んでいる状態。
    if (character === ">") {
      state = "text";
      builder.push(character, "tag");
      continue;
    }
    if (character === '"' || character === "'") {
      state = "attributeValue";
      quote = character;
      builder.push(character, "string");
      continue;
    }
    if (/[\s=]/.test(character)) {
      // 空白を挟むと、次に現れる識別子は属性名になる。
      if (character !== "=") expectsTagName = false;
      builder.push(character, "tag");
      continue;
    }
    builder.push(character, expectsTagName ? "tag" : "attribute");
  }

  return builder.finish();
}

// 中身がまた「セレクタ { 宣言 }」になる@ルール。
// @font-faceや@propertyのように中身が宣言だけのものと区別する。
const nestedAtRules = ["@media", "@supports", "@container", "@layer", "@scope", "@document"];

function isNestedAtRule(prelude: string): boolean {
  const trimmed = prelude.trim().toLowerCase();
  return nestedAtRules.some((rule) => trimmed.startsWith(rule));
}

export function tokenizeCss(code: string): CodeToken[][] {
  const builder = createLineBuilder();
  // セレクタ部 / 宣言部 / コメント の3状態。宣言部ではコロンの前後でプロパティと値を分ける。
  let state: "selector" | "declaration" | "comment" = "selector";
  let inValue = false;
  // @mediaのように入れ子になるブロックがあるため、閉じ括弧でどちらへ戻るかを積んで覚える。
  const blockStack: ("selector" | "declaration")[] = [];
  let stateBeforeComment: "selector" | "declaration" = "selector";
  // 直前の「{」までに読んだセレクタ（または@ルールの前置き）。
  // @mediaのように中身がまたセレクタから始まるブロックを見分けるために覚えておく。
  let prelude = "";

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];

    if (state === "comment") {
      builder.push(character, "comment");
      if (code.startsWith("*/", index - 1)) state = stateBeforeComment;
      continue;
    }

    if (code.startsWith("/*", index)) {
      stateBeforeComment = state;
      state = "comment";
      builder.push(character, "comment");
      continue;
    }

    if (character === "{") {
      // @mediaの中身はまたセレクタから始まる。閉じたときに戻る先をここで覚えておく。
      blockStack.push(state);
      state = isNestedAtRule(prelude) ? "selector" : "declaration";
      prelude = "";
      inValue = false;
      builder.push(character, "plain");
      continue;
    }

    if (character === "}") {
      state = blockStack.pop() ?? "selector";
      prelude = "";
      inValue = false;
      builder.push(character, "plain");
      continue;
    }

    if (state === "selector") {
      prelude += character;
      builder.push(character, "selector");
      continue;
    }

    if (character === ":") {
      inValue = true;
      builder.push(character, "plain");
      continue;
    }
    if (character === ";") {
      inValue = false;
      builder.push(character, "plain");
      continue;
    }
    builder.push(character, inValue ? "value" : "property");
  }

  return builder.finish();
}

// 生成しているJavaScriptで実際に使う語だけを色付けする。
const javaScriptKeywords = new Set(["var", "const", "let", "function", "if", "else", "return", "new", "typeof"]);

export function tokenizeJavaScript(code: string): CodeToken[][] {
  const builder = createLineBuilder();
  let state: "code" | "lineComment" | "blockComment" | "string" = "code";
  let quote = "";
  let word = "";

  // 識別子は語がそろってから種類が決まるため、区切り文字に着くまで溜めてから流す。
  const flushWord = () => {
    if (!word) return;
    const kind: TokenKind = javaScriptKeywords.has(word) ? "keyword" : "plain";
    for (const character of word) builder.push(character, kind);
    word = "";
  };

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];

    if (state === "lineComment") {
      if (character === "\n") state = "code";
      builder.push(character, character === "\n" ? "plain" : "comment");
      continue;
    }

    if (state === "blockComment") {
      builder.push(character, "comment");
      if (code.startsWith("*/", index - 1)) state = "code";
      continue;
    }

    if (state === "string") {
      builder.push(character, "string");
      if (character === quote) state = "code";
      continue;
    }

    if (code.startsWith("//", index)) {
      flushWord();
      state = "lineComment";
      builder.push(character, "comment");
      continue;
    }
    if (code.startsWith("/*", index)) {
      flushWord();
      state = "blockComment";
      builder.push(character, "comment");
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      flushWord();
      state = "string";
      quote = character;
      builder.push(character, "string");
      continue;
    }
    if (/[A-Za-z_$]/.test(character) || (word !== "" && /[0-9]/.test(character))) {
      word += character;
      continue;
    }
    flushWord();
    builder.push(character, "plain");
  }

  flushWord();
  return builder.finish();
}

// data-builder-idを持つ開始タグから、その要素の閉じタグまでを同じ要素の範囲として扱う。
export function annotateHtml(html: string): CodeLine[] {
  const tokenLines = tokenizeHtml(html);
  const textLines = html.split("\n");
  let openId = "";
  let openTag = "";
  let depth = 0;

  return textLines.map((text, index) => {
    if (!openId) {
      const opening = text.match(/<([a-zA-Z][\w-]*)\b[^>]*\sdata-builder-id="([^"]+)"/);
      if (opening) {
        openTag = opening[1];
        openId = opening[2];
        depth = 0;
      }
    }

    const relatedIds = openId ? [openId] : [];
    if (openId) {
      // 同じ種類のタグが入れ子になっても、対応する閉じタグまでを範囲にできるよう数を数える。
      depth += countMatches(text, `<${openTag}`) - countMatches(text, `</${openTag}`);
      if (depth <= 0) openId = "";
    }

    return { number: index + 1, text, tokens: tokenLines[index] ?? [], relatedIds };
  });
}

function countMatches(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const found = text.indexOf(needle, from);
    if (found === -1) return count;
    count += 1;
    from = found + needle.length;
  }
}

type CssRule = { selector: string; startLine: number; endLine: number };

// CSSは「どのセレクタがどの要素に効くか」で対応付ける。
// そのためにまず、ルールごとの範囲（開始行と終了行）を集める。
function collectCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const openRules: { selector: string; startLine: number }[] = [];
  let selectorBuffer = "";
  let line = 1;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];

    if (css.startsWith("/*", index)) {
      // コメント内の記号をルールの区切りと誤読しないよう、まとめて読み飛ばす。
      const end = css.indexOf("*/", index + 2);
      const stop = end === -1 ? css.length : end + 2;
      line += countMatches(css.slice(index, stop), "\n");
      index = stop - 1;
      continue;
    }
    if (character === "\n") {
      line += 1;
      // セレクタが複数行にまたがっても、改行を空白に置き換えて1つの文字列にまとめる。
      selectorBuffer += " ";
      continue;
    }
    if (character === "{") {
      openRules.push({ selector: selectorBuffer.trim(), startLine: line });
      selectorBuffer = "";
      continue;
    }
    if (character === "}") {
      const opened = openRules.pop();
      if (opened) rules.push({ ...opened, endLine: line });
      selectorBuffer = "";
      continue;
    }
    if (character === ";") {
      selectorBuffer = "";
      continue;
    }
    selectorBuffer += character;
  }

  return rules;
}

// kindが増えたらここがコンパイルエラーになり、対応漏れに気付ける。
const sectionKindFlags: Record<SiteSection["kind"], true> = {
  hero: true,
  about: true,
  features: true,
  gallery: true,
  contact: true,
};

function isSectionKind(value: string): value is SiteSection["kind"] {
  return Object.hasOwn(sectionKindFlags, value);
}

// セレクタから、それが装飾している要素のbuilderIdを求める。
// 生成CSSはbuildSiteArtifactsが書いているため、そこに出てくるセレクタだけを対象にする。
export function idsForSelector(selector: string, site: SiteModel): string[] {
  const visibleSections = site.sections.filter((section) => section.visible);
  const ids = new Set<string>();
  const addSections = (matches: (section: SiteSection, index: number) => boolean) => {
    visibleSections.forEach((section, index) => {
      if (matches(section, index)) ids.add(section.id);
    });
  };

  for (const rawPart of selector.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes(".site-header") || part.includes(".logo")) ids.add("site-header");
    if (/(^|[\s>+~])footer\b/.test(part)) ids.add("site-footer");

    // .section-heroのような種類つきのクラスは、その種類のセクションだけに効く。
    const kind = part.match(/\.section-([a-z]+)\b/)?.[1];
    if (kind && isSectionKind(kind)) {
      addSections((section) => section.kind === kind);
      continue;
    }

    // .sectionと.section-innerは、表示中のすべてのセクションに効く。
    if (/\.section\b/.test(part)) {
      addSections(() => true);
      continue;
    }
    if (/(^|[\s>+~])h1\b/.test(part)) {
      addSections(isHeroSection);
      continue;
    }
    if (/(^|[\s>+~])h2\b/.test(part)) {
      addSections((section, index) => !isHeroSection(section, index));
      continue;
    }
    if (/(^|[\s>+~])p\b/.test(part)) {
      addSections(() => true);
      continue;
    }
    if (part.includes(".image-placeholder")) {
      // 連絡先セクションだけは画像を出力していない。
      addSections((section) => section.kind !== "contact");
    }
  }

  return [...ids];
}

export function annotateCss(css: string, site: SiteModel): CodeLine[] {
  const tokenLines = tokenizeCss(css);
  const textLines = css.split("\n");
  const rules = collectCssRules(css);

  // @mediaの中のルールのように範囲が重なる場合は、狭いほうがその行の内容を表している。
  const owners: (CssRule | undefined)[] = [];
  for (const rule of rules) {
    for (let line = rule.startLine; line <= rule.endLine; line += 1) {
      const current = owners[line];
      const isNarrower = !current || rule.endLine - rule.startLine < current.endLine - current.startLine;
      if (isNarrower) owners[line] = rule;
    }
  }

  return textLines.map((text, index) => {
    const owner = owners[index + 1];
    return {
      number: index + 1,
      text,
      tokens: tokenLines[index] ?? [],
      relatedIds: owner ? idsForSelector(owner.selector, site) : [],
    };
  });
}

export function annotateJavaScript(javascript: string): CodeLine[] {
  const tokenLines = tokenizeJavaScript(javascript);
  return javascript.split("\n").map((text, index) => ({
    number: index + 1,
    text,
    tokens: tokenLines[index] ?? [],
    relatedIds: [],
  }));
}

/** 消えた行と、消える前にあった位置（current側の直前の行番号。0は先頭）。 */
export type RemovedLine = { text: string; afterLine: number };

export type CodeDiff = {
  /** current側で増えた・書き換わった行の行番号。 */
  added: Set<number>;
  /** baseline側にあり、currentから消えた行。 */
  removed: RemovedLine[];
};

// 行の対応付けはLCS（最長共通部分列）で取る。
// 「baselineに無い行だけを変更とする」集合比較では、行の削除・並べ替え・
// 同じ文字列の行の増減を検出できない。セクションを非表示にするとHTMLの
// まとまりが丸ごと消えるため、削除を拾えないと「何を変えたか」が
// コード表示にも学習メモにも残らなくなる。
export function diffLines(currentCode: string, baselineCode: string): CodeDiff {
  const current = currentCode.split("\n");
  const baseline = baselineCode.split("\n");

  // lcs[i][j] = current[i以降] と baseline[j以降] の最長共通部分列の長さ。
  const lcs: number[][] = Array.from({ length: current.length + 1 }, () =>
    new Array<number>(baseline.length + 1).fill(0),
  );
  for (let i = current.length - 1; i >= 0; i -= 1) {
    for (let j = baseline.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        current[i] === baseline[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const added = new Set<number>();
  const removed: RemovedLine[] = [];
  // 空行の増減は、行がずれただけに見えて学習の手がかりにならないため数えない。
  const isMeaningful = (line: string) => line.trim().length > 0;

  let i = 0;
  let j = 0;
  while (i < current.length && j < baseline.length) {
    if (current[i] === baseline[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      if (isMeaningful(current[i])) added.add(i + 1);
      i += 1;
    } else {
      if (isMeaningful(baseline[j])) removed.push({ text: baseline[j], afterLine: i });
      j += 1;
    }
  }
  while (i < current.length) {
    if (isMeaningful(current[i])) added.add(i + 1);
    i += 1;
  }
  while (j < baseline.length) {
    if (isMeaningful(baseline[j])) removed.push({ text: baseline[j], afterLine: i });
    j += 1;
  }

  return { added, removed };
}

// 前回の記録時点からコードのどこが変わったかを行番号で返す。
// 「なぜ変えたか」を書く場面で、自分の操作がコードのどこを動かしたかを見せるために使う。
export function findChangedLines(currentCode: string, baselineCode: string): Set<number> {
  return diffLines(currentCode, baselineCode).added;
}

// 変わった行そのものを取り出す。学習メモへ「理由」と一緒に残し、
// あとから理由と実際のコード変更を突き合わせられるようにするために使う。
// 増えた行と消えた行を読み分けられるよう、diffと同じ「+」「-」を先頭に付ける。
export function collectChangedLineTexts(currentCode: string, baselineCode: string): string[] {
  const { added, removed } = diffLines(currentCode, baselineCode);
  const currentLines = currentCode.split("\n");
  // 消えた行は、消える前にあった位置の直後へ差し込みたいので0.5をずらして並べる。
  const changes = [
    ...[...added].map((lineNumber) => ({
      order: lineNumber,
      text: `+ ${currentLines[lineNumber - 1].trim()}`,
    })),
    ...removed.map((line) => ({ order: line.afterLine + 0.5, text: `- ${line.text.trim()}` })),
  ];

  return changes.sort((a, b) => a.order - b.order).map((change) => change.text);
}
