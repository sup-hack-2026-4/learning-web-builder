import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import type { QualityCheck, SiteModel } from "../site-model/schema";

/** 検査用iframeから親へ結果を返すときのメッセージ種別。 */
export const AXE_MESSAGE_TYPE = "learning-builder:axe";

/** バックエンドのdetailは1000文字までのため、まとめ文もここで打ち切る。 */
const MAX_DETAIL_LENGTH = 1000;

/** axeの生の指摘のうち、この機能で使う部分だけを表した型。 */
export type RawAxeViolation = {
  id: string;
  impact?: string | null;
  help?: string;
  nodes?: { target?: (string | string[])[] }[];
};

export type AxeImpact = "critical" | "serious" | "moderate" | "minor";

/** 画面と提出物に出す1件分の指摘。 */
export type AxeFinding = {
  ruleId: string;
  impact: AxeImpact;
  /** 何が問題かの一文。 */
  summary: string;
  /** なぜ直すのかの一文。学習者が理由まで持ち帰れるようにする。 */
  why: string;
  /** 対象要素を指すCSSセレクタ。同じ指摘が並ぶと読みにくいので先頭の1件だけ出す。 */
  target: string;
  /** 同じルールで見つかった件数。 */
  count: number;
};

const impactOrder: Record<AxeImpact, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

export const impactLabels: Record<AxeImpact, string> = {
  critical: "重大",
  serious: "大きい",
  moderate: "中くらい",
  minor: "小さい",
};

// 監修済みの解説。axeの原文は開発者向けで学習者には硬いため、
// このツールで実際に出る可能性があるルールだけ日本語の説明と理由を用意する。
// ここに無いルールはaxeのhelp原文へ落とし、未知の指摘も画面から消えないようにする。
const ruleGuides: Record<string, { summary: string; why: string }> = {
  "image-alt": {
    summary: "画像に代替テキスト（alt）がありません。",
    why: "画面を見られない人には、altが画像の代わりに読み上げられるためです。",
  },
  "role-img-alt": {
    summary: "画像として扱っている要素に説明がありません。",
    why: "role=\"img\"の要素は、説明が無いと読み上げ時に何も伝わらないためです。",
  },
  "heading-order": {
    summary: "見出しの階層が飛んでいます。",
    why: "見出しの番号は文書の目次そのもので、飛ぶと構造を追えなくなるためです。",
  },
  "empty-heading": {
    summary: "中身が空の見出しがあります。",
    why: "空の見出しは目次に空欄が並ぶのと同じで、読み手を迷わせるためです。",
  },
  "page-has-heading-one": {
    summary: "ページの主題を示すh1がありません。",
    why: "h1はページ全体が何の話なのかを最初に伝える見出しだからです。",
  },
  "html-has-lang": {
    summary: "html要素に言語（lang）の指定がありません。",
    why: "読み上げソフトが日本語として発音するために必要だからです。",
  },
  "html-lang-valid": {
    summary: "html要素のlangの値が正しくありません。",
    why: "誤った言語コードだと、別の言語として読み上げられてしまうためです。",
  },
  "document-title": {
    summary: "ページにタイトル（title）がありません。",
    why: "タブや検索結果に出る名前で、どのページかを見分ける手がかりだからです。",
  },
  "landmark-one-main": {
    summary: "主要な内容を囲むmainがありません。",
    why: "mainがあると、読み上げ利用者が本文へ一足で移動できるためです。",
  },
  region: {
    summary: "ランドマーク（header/main/footerなど）の外に内容があります。",
    why: "どの領域にも属さない内容は、拾い読みのときに飛ばされやすいためです。",
  },
  "link-name": {
    summary: "リンクに読み上げられる文字がありません。",
    why: "リンク先が分からないまま「リンク」とだけ読み上げられてしまうためです。",
  },
  "color-contrast": {
    summary: "文字と背景の明るさの差が足りません。",
    why: "差が小さいと、明るい場所や見えにくい人には文字が読めなくなるためです。",
  },
  list: {
    summary: "リストの入れ子が正しくありません。",
    why: "ul/olの直下にli以外があると、項目数が正しく読み上げられないためです。",
  },
  "duplicate-id": {
    summary: "同じidが複数の要素で使われています。",
    why: "idは1ページに1つだけの名札で、重複すると参照先が定まらないためです。",
  },
};

function toImpact(value: string | null | undefined): AxeImpact {
  if (value === "critical" || value === "serious" || value === "moderate" || value === "minor") return value;
  // axeがimpactを返さないケースの受け皿。消してしまうより、軽い指摘として残す。
  return "minor";
}

function toTarget(violation: RawAxeViolation): string {
  const target = violation.nodes?.[0]?.target?.[0];
  if (Array.isArray(target)) return target.join(" ");
  return target ?? "対象不明";
}

/** axeの生の結果を、画面に出せる形へ整える。重い指摘から順に並べる。 */
export function toAxeFindings(violations: RawAxeViolation[]): AxeFinding[] {
  return violations
    .map((violation) => {
      const guide = ruleGuides[violation.id];
      return {
        ruleId: violation.id,
        impact: toImpact(violation.impact),
        summary: guide?.summary ?? violation.help ?? "自動チェックで問題が見つかりました。",
        why: guide?.why ?? "axeの検査項目です。詳しくはルールID（英語）で調べられます。",
        target: toTarget(violation),
        count: violation.nodes?.length ?? 1,
      };
    })
    .sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact] || a.ruleId.localeCompare(b.ruleId));
}

/** 品質レポート・保存APIへ渡す1件のチェック結果にまとめる。 */
export function summarizeAxeFindings(findings: AxeFinding[]): QualityCheck {
  const label = "アクセシビリティ（axe）";
  if (findings.length === 0) {
    return {
      id: "axe",
      label,
      passed: true,
      detail: "axeの自動チェックで見つかる問題はありませんでした。",
    };
  }

  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  const lines = findings.map(
    (finding) => `${impactLabels[finding.impact]}：${finding.summary}（${finding.target}）`,
  );
  const detail = `${total}件の指摘があります。${lines.join(" / ")}`;

  return {
    id: "axe",
    label,
    passed: false,
    detail: detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` : detail,
  };
}

// 検査用iframeの中で動くスクリプト。結果は親へpostMessageで返す。
// プレビューと同じくsandbox="allow-scripts"で動かすため、
// 親から中のDOMへは触れず、メッセージだけをやり取りする。
function buildRunnerScript(): string {
  return `window.addEventListener('load', function () {
  var send = function (payload) { parent.postMessage(payload, '*'); };
  if (typeof axe === 'undefined') { send({ type: '${AXE_MESSAGE_TYPE}', ok: false }); return; }
  axe.run(document, { resultTypes: ['violations'] }).then(function (results) {
    send({
      type: '${AXE_MESSAGE_TYPE}',
      ok: true,
      violations: results.violations.map(function (violation) {
        return {
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map(function (node) { return { target: node.target }; })
        };
      })
    });
  }).catch(function () { send({ type: '${AXE_MESSAGE_TYPE}', ok: false }); });
});`;
}

/**
 * 検査用のHTMLを組み立てる。
 * プレビュー用のsrcdocではなく提出物と同じHTML/CSSを使い、
 * 実際に提出する成果物そのものを検査する（編集用の枠線などは混ぜない）。
 */
export function buildAuditDocument(site: SiteModel, axeScriptUrl: string): string {
  const artifacts = buildSiteArtifacts(site);
  return artifacts.html
    .replace('<link rel="stylesheet" href="style.css">', `<style>${artifacts.css}</style>`)
    .replace(
      '<script src="script.js"></script>',
      `<script src="${axeScriptUrl}"></script>\n  <script>${buildRunnerScript()}</script>`,
    );
}
