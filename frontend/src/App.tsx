import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Circle, Code2, Download, Info, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodePanel } from "@/components/code-panel";
import { SitePreview } from "@/components/site-preview";
import { VerticalSplitter } from "@/components/vertical-splitter";
import { handleTabKeyDown } from "@/lib/tab-keyboard";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { collectChangedLineTexts } from "@/features/code-view/annotate-code";
import { countPassedAspects, evaluateReason } from "@/features/reasoning/evaluate-reason";
import { AuthControls } from "@/features/auth/auth-controls";
import { clerkConfig } from "@/features/auth/config";
import { explanationDictionary } from "@/features/explanations/dictionary";
import { exportProject } from "@/features/export/export-project";
import { ProjectControls } from "@/features/projects/project-controls";
import { evaluateQuality } from "@/features/quality/evaluate-quality";
import { impactLabels } from "@/features/quality/axe-audit";
import { useAxeAudit } from "@/features/quality/use-axe-audit";
import { createSampleSite } from "@/features/site-model/sample";
import {
  addSectionBlockReason,
  maxSections,
  removeSectionBlockReason,
  sectionKindLabels,
  sectionKinds,
  type SectionKind,
} from "@/features/site-model/sections";
import type { SiteModel, SiteSection } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";
import { generateSite } from "@/lib/api";
import { ConceptChatPanel } from "@/features/concept/chat-panel";
import { conceptSummary, type ConceptDraft } from "@/features/concept/schema";
import { StepNav } from "@/components/step-nav";
import { nextAction, stepViews, type FlowState } from "@/features/learning-flow/steps";

type ThemeKey = "primary" | "background" | "text" | "heading" | "fontFamily" | "spacing";

// 右カラムのパネル。縦積みだと画面に収まらないため、タブで1つずつ表示する。
type PanelKey = "design" | "explanation" | "quality";

const panelLabels: Record<PanelKey, string> = {
  design: "調整",
  explanation: "解説",
  quality: "品質",
};

// 狭い画面では3カラムを縦に積むと極端に見づらいため、
// プレビューを主役に据え、他はここで切り替える。
type MobileView = "preview" | "setup" | "panel";

const mobileViewLabels: Record<MobileView, string> = {
  preview: "プレビュー",
  setup: "題材・メモ",
  panel: "調整と学習",
};

// 学習メモ・ZIP出力に載る、テーマ項目の日本語ラベル。
const themeKeyLabels: Record<ThemeKey, string> = {
  primary: "メインカラー",
  background: "背景色",
  text: "テキストカラー",
  heading: "見出しの色",
  fontFamily: "フォント",
  spacing: "余白",
};

// フォントの内部値を、画面のセレクトと同じ日本語表記へ変換する。
const fontLabels: Record<string, string> = {
  sans: "ゴシック",
  serif: "明朝",
  rounded: "丸ゴシック",
};

// テーマ項目の現在値を「メインカラーを #e11d48 に」のような読める文へ整形する。
function describeThemeChange(key: ThemeKey, theme: SiteModel["theme"]): string {
  const label = themeKeyLabels[key];
  if (key === "fontFamily") return `${label}を ${fontLabels[theme.fontFamily] ?? theme.fontFamily} に`;
  if (key === "spacing") return `${label}を ${theme.spacing} に`;
  // 見出しの色は未指定ならメインカラーを引き継ぐため、その場合は実際に適用される色を書く。
  if (key === "heading") return `${label}を ${theme.heading ?? theme.primary} に`;
  return `${label}を ${theme[key]} に`;
}

// 実際にCSSへ出る値。見出しの色は未指定ならメインカラーを引き継ぐため、
// 単純に theme.heading と比べると「未指定」と「メインカラーと同じ色」を
// 別物と見なしてしまい、元の色へ戻したのに変更が残ってしまう。
function effectiveThemeValue(theme: SiteModel["theme"], key: ThemeKey): string | number {
  if (key === "heading") return theme.heading ?? theme.primary;
  return theme[key];
}

// まだ説明を書いていないデザイン変更の項目。
// 先に変えてから説明を書くため、理由は記録するときに1つだけ受け取る。

// まだ説明を書いていない構成の変更1件。
// 「セクション追加（〜）」のように同じ文言が並ぶことがあるため、
// 打ち消し（追加してすぐ削除）を扱えるようidを持たせる。
type StructureChange = { id: string; label: string };

// プレビューとコードの高さ配分。どちらも読めなくならない範囲に収める。
const minCodeHeight = 120;
const minPreviewHeight = 240;

export default function App() {
  const [topic, setTopic] = useState("");
  const [reason, setReason] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loadedProject, setLoadedProject] = useState(false);
  const [notice, setNotice] = useState("静的サンプルで開始しています。題材を入力して生成できます。");
  // 記録ボタンを押すまでに変更したテーマ項目。まだ説明を書いていない変更として持つ。
  const [touchedThemeKeys, setTouchedThemeKeys] = useState<ThemeKey[]>([]);
  // 右カラムは縦に積むと画面へ収まらないため、常に1パネルだけ表示する。
  const [activePanel, setActivePanel] = useState<PanelKey>("design");
  // 畳むとプレビューがPC幅まで広がり、出力時に近い見た目を確認できる。
  const [panelOpen, setPanelOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  // 狭い画面用。xl以上では使わず、3カラムを同時に表示する。
  const [mobileView, setMobileView] = useState<MobileView>("preview");
  // プレビューの下に生成コードを出す。理由を書くときに、対象のコードが目の前にある状態を作る。
  const [codeOpen, setCodeOpen] = useState(true);
  const [codeHeight, setCodeHeight] = useState(240);
  const previewAreaRef = useRef<HTMLDivElement>(null);

  // 上限は画面の広さで変わる。支援技術へ調整範囲を伝えるため、値としても持っておく。
  const [maxCodeHeight, setMaxCodeHeight] = useState(minCodeHeight);

  const measureMaxCodeHeight = useCallback(() => {
    const available = previewAreaRef.current?.clientHeight ?? 0;
    if (available === 0) return null;
    return Math.max(minCodeHeight, available - minPreviewHeight);
  }, []);

  // 高さの上限は画面の広さで変わるため、コードの高さはその都度この範囲へ収める。
  const limitCodeHeight = useCallback(
    (height: number) => {
      const maxHeight = measureMaxCodeHeight();
      if (maxHeight === null) return height;
      return Math.min(Math.max(height, minCodeHeight), maxHeight);
    },
    [measureMaxCodeHeight],
  );

  // 画面が狭いとプレビューが潰れてしまうため、表示時とウィンドウ変更時に収め直す。
  useEffect(() => {
    const fit = () => {
      setCodeHeight(limitCodeHeight);
      const maxHeight = measureMaxCodeHeight();
      if (maxHeight !== null) setMaxCodeHeight(maxHeight);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [codeOpen, limitCodeHeight, measureMaxCodeHeight]);
  const { site, selectedElementId, notes, aiUsage, setSite, loadSite, selectElement, previewTheme, updateSection, addSection, removeSection, addNote, reset } = useBuilderStore();

  // 「まだ理由を書いていない変更」をコード上で示すための基準。
  // デザインと内容は別々に記録するため、基準も分けて持つ。
  const [themeBaseline, setThemeBaseline] = useState(site.theme);
  // 内容の基準はセクションごとに持つ。ひとまとめにすると、あるセクションを
  // 未記録のまま別のセクションを記録したときに、変更コードが別の理由へ混ざってしまう。
  const [sectionBaselines, setSectionBaselines] = useState<Record<string, SiteSection>>(() =>
    Object.fromEntries(site.sections.map((section) => [section.id, section])),
  );
  // 構成（どのセクションが何番目にあるか）の基準。内容の基準とは別に持つ。
  // 内容の基準はid単位なので、セクションが増えた・減ったこと自体は表せない。
  const [structureBaseline, setStructureBaseline] = useState<SiteSection[]>(() => site.sections);
  // まだ説明を書いていない構成の変更。押した順に並べ、まとめて1件として記録する。
  const [pendingStructure, setPendingStructure] = useState<StructureChange[]>([]);
  // 削除の確認を出している行。取り消せない操作なので、押した行の中で一度確かめる。
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  // 追加するセクションの種類。生成結果には入りにくく、かつ足す判断をしやすい
  // 「写真・作品」を初期値にする。ヒーローを初期値にすると、h1が2つある構造を
  // 何気なく作ってしまいやすい（品質チェックには出るが、最初の一歩としては遠回り）。
  const [newSectionKind, setNewSectionKind] = useState<SectionKind>("gallery");

  // 内容の基準。顔ぶれと並びは「いまの構成」に合わせ、中身だけ基準値へ戻す。
  // 内容の差分を取るときに、構成の変更が混ざらないようにするため。
  // 生成やプロジェクト読み込みで増えたセクションは、その時点の内容を基準として扱う。
  const contentBaselineSections = useMemo(
    () => site.sections.map((section) => sectionBaselines[section.id] ?? section),
    [site.sections, sectionBaselines],
  );
  // 構成の基準。顔ぶれも中身も、最後に記録した時点のまま。
  const structureBaselineSections = useMemo(
    () => structureBaseline.map((section) => sectionBaselines[section.id] ?? section),
    [structureBaseline, sectionBaselines],
  );
  // コード上の「未記録の変更」には、内容の書き換えと構成の増減の両方を含める。
  const baselineSite = useMemo(
    () => ({ ...site, theme: themeBaseline, sections: structureBaselineSections }),
    [site, themeBaseline, structureBaselineSections],
  );

  // 学習の工程を、いまの画面の状態から導く。
  // 説明していない変更は、デザインと内容の両方を数える。
  const unexplainedSectionCount = useMemo(
    () =>
      site.sections.filter((section) => {
        const baseline = sectionBaselines[section.id];
        if (!baseline) return false;
        return (
          baseline.title !== section.title ||
          baseline.body !== section.body ||
          baseline.imageAlt !== section.imageAlt ||
          baseline.visible !== section.visible
        );
      }).length,
    [site.sections, sectionBaselines],
  );
  const flowState: FlowState = useMemo(
    () => ({
      topicReady: topic.trim().length > 0,
      // 生成したかどうかは、AIの利用記録が「初期サンプル」以外を含むかで見る。
      generated: loadedProject || aiUsage.some((usage) => usage.purpose !== "初期サンプル"),
      unexplainedCount: touchedThemeKeys.length + unexplainedSectionCount + pendingStructure.length,
      // コンセプトの記録だけでは、調整とその理由説明を終えたことにはならない。
      explainedCount: notes.filter((note) => note.target !== "コンセプト").length,
      noteCount: notes.length,
    }),
    [
      topic,
      loadedProject,
      aiUsage,
      touchedThemeKeys.length,
      unexplainedSectionCount,
      pendingStructure.length,
      notes,
    ],
  );
  const steps = useMemo(() => stepViews(flowState), [flowState]);
  const nextToDo = useMemo(() => nextAction(flowState), [flowState]);

  const quality = useMemo(() => evaluateQuality(site), [site]);
  // axeの自動チェックはiframeでの実測が要るため非同期。終わるまでは静的な3項目だけで判断する。
  const axeAudit = useAxeAudit(site);
  const allChecks = useMemo(
    () => (axeAudit.status === "ready" ? [...quality, axeAudit.check] : quality),
    [quality, axeAudit],
  );
  const hasQualityIssue = allChecks.some((item) => !item.passed);
  // 書いている途中の理由を、何を・なぜ・どう良くなるかの3点で見る。記録は止めず、書き足す観点を示す。
  const reasonChecks = useMemo(() => evaluateReason(reason), [reason]);
  const passedAspects = countPassedAspects(reasonChecks);

  // 記録するデザイン変更が、実際にCSSのどこを動かしたかを取り出す。
  // 対象の項目だけを基準値から動かして比べるため、まとめて変更しても項目ごとに分けて残せる。
  const cssChangesForThemeKeys = (keys: ThemeKey[]): string[] => {
    const changedTheme = { ...themeBaseline };
    for (const key of keys) Object.assign(changedTheme, { [key]: site.theme[key] });
    return collectChangedLineTexts(
      buildSiteArtifacts({ ...site, theme: changedTheme }).css,
      buildSiteArtifacts({ ...site, theme: themeBaseline }).css,
    );
  };

  // 内容の変更はHTMLに出る。表示切替も文章の書き換えも同じ見かたで取り出せる。
  // 対象のセクションだけを基準から動かして比べるため、他のセクションを未記録のまま
  // 触っていても、その分は今回のメモへ混ざらない。
  const htmlChangesForSection = (sectionId: string, nextSection: SiteSection): string[] => {
    const changedSections = contentBaselineSections.map((section) =>
      section.id === sectionId ? nextSection : section,
    );
    return collectChangedLineTexts(
      buildSiteArtifacts({ ...site, sections: changedSections }).html,
      buildSiteArtifacts({ ...site, sections: contentBaselineSections }).html,
    );
  };

  // 構成の変更はHTMLのsectionごと増減する。両側に内容の基準値を当てて比べることで、
  // まだ説明していない文章の書き換えが、構成の説明へ混ざらないようにする。
  const htmlChangesForStructure = (): string[] =>
    collectChangedLineTexts(
      buildSiteArtifacts({ ...site, sections: contentBaselineSections }).html,
      buildSiteArtifacts({ ...site, sections: structureBaselineSections }).html,
    );
  const selectedSection = site.sections.find((section) => section.id === selectedElementId);
  // 追加したセクションのidは「gallery-2」のように採番されるため、idだけでは引けない。
  // 種類ごとの解説へ落として、別のセクションの説明が出てしまうのを避ける。
  const explanation =
    explanationDictionary[selectedElementId] ??
    (selectedSection ? explanationDictionary[selectedSection.kind] : undefined) ??
    explanationDictionary.about;

  // 記録されないまま残っている「変更中の状態」を捨てる。
  // サイトが差し替わる操作（生成・リセット）のたびに呼ぶ。
  // 差し替え後のサイトが新しい基準になるため、コード上の変更表示もここで消える。
  const discardUnrecordedChanges = () => {
    setTouchedThemeKeys([]);
    setReason("");
    const current = useBuilderStore.getState().site;
    setThemeBaseline(current.theme);
    setSectionBaselines(Object.fromEntries(current.sections.map((section) => [section.id, section])));
    setStructureBaseline(current.sections);
    setPendingStructure([]);
    setRemovalTargetId(null);
  };

  // セクションの表示切替は、理由が入っていればその場で学習メモへ残る。
  // 記録できたときだけ、そのセクションの「未記録の変更」の基準を進める。
  const toggleSection = (id: string, visible: boolean) => {
    const trimmedReason = reason.trim();
    const current = site.sections.find((section) => section.id === id);
    const nextSection = current ? { ...current, visible } : undefined;
    updateSection(
      id,
      { visible },
      trimmedReason || undefined,
      trimmedReason && nextSection ? htmlChangesForSection(id, nextSection) : undefined,
    );
    if (trimmedReason && nextSection) {
      setSectionBaselines((baselines) => ({ ...baselines, [id]: nextSection }));
    }
  };

  // セクションの追加。末尾へ入る。どこへ入るか分からないと、押したあとで画面を探すことになる。
  const handleAddSection = (kind: SectionKind) => {
    if (addSectionBlockReason(site.sections.length)) return;
    addSection(kind);
    // 採番はstoreの中で行うため、追加後の状態から実際に入った1件を取り出す。
    const added = useBuilderStore.getState().site.sections.at(-1);
    if (!added) return;
    // 追加した時点の内容を、その節の内容の基準にする。
    // ここで基準を置かないと、追加後に書き換えた文章が未説明の内容変更として数えられない。
    setSectionBaselines((baselines) => ({ ...baselines, [added.id]: added }));
    setPendingStructure((changes) => [
      ...changes,
      { id: `add-${added.id}`, label: `セクション追加（${added.title}）` },
    ]);
    setNotice(`「${added.title}」を末尾に追加しました。なぜ足すのかを書いて記録してください。`);
  };

  // セクションの削除。確認を通ってから呼ぶ。
  const handleRemoveSection = (section: SiteSection) => {
    if (removeSectionBlockReason(site.sections.length)) return;
    removeSection(section.id);
    setRemovalTargetId(null);
    // 消したセクションの内容の基準は残さない。残すと、もう画面に無い変更を
    // 未説明として数え続けてしまう。
    setSectionBaselines((baselines) => {
      const rest = { ...baselines };
      delete rest[section.id];
      return rest;
    });
    setPendingStructure((changes) => {
      // 追加したばかりのものを消したなら、構成は元に戻っている。説明する変更も無い。
      const addedId = `add-${section.id}`;
      if (changes.some((change) => change.id === addedId)) {
        return changes.filter((change) => change.id !== addedId);
      }
      return [...changes, { id: `remove-${section.id}`, label: `セクション削除（${section.title}）` }];
    });
    setNotice(`「${section.title}」を削除しました。なぜ削るのかを書いて記録してください。`);
  };

  // 記録は止めないが、書けていない観点があれば次に何を書けばよいかを添える。
  // 理由が書けたこと自体を理解の証拠にせず、説明を組み立てる手がかりを返すため。
  const noticeForRecordedReason = (message: string): string => {
    const missing = reasonChecks.filter((check) => !check.passed);
    if (missing.length === 0) return `${message} 何を・なぜ・どう良くなるかがそろっています。`;
    return `${message} 次は「${missing.map((check) => check.label).join("」「")}」も書けると、変更を自分の言葉で説明できます。`;
  };

  const generation = useMutation({
    mutationFn: async ({ topic: nextTopic, concept }: { topic: string; concept?: ConceptDraft }) => {
      try {
        return { ...await generateSite(nextTopic, concept), concept };
      } catch {
        return { site: createSampleSite(nextTopic), provider: "static-sample" as const, concept };
      }
    },
    onSuccess: ({ site: generatedSite, provider, concept }) => {
      const viaConcept = concept !== undefined;
      setSite(generatedSite, provider, viaConcept ? "コンセプト相談と、サイト構成・仮文章の生成" : undefined);
      // サイトが差し替わると、記録前の変更内容は新しいサイトに対して意味を持たない。
      // 残したままだと、触れていない初期値を変更として誤記録してしまう。
      discardUnrecordedChanges();
      setLoadedProject(false);
      setCurrentProjectId(null);
      // 相談で決めたことは、生成した本人の判断そのもの。学習メモに残して提出物へ含める。
      // setSite がメモを空にするため、必ずそのあとで記録する。
      if (concept) {
        addNote("コンセプト", conceptSummary(concept));
      }
      setNotice(provider === "gemini" ? "AIでたたき台を生成しました。事実情報を確認してください。" : "APIを利用できないため、静的サンプルを生成しました。");
    },
  });

  const submitTopic = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) return;
    generation.mutate({ topic: topic.trim() });
  };

  // 相談で固めたコンセプトからたたき台を作る。
  // 題材欄にも反映して、あとから題材だけ変えて作り直せるようにする。
  const generateFromConcept = (draft: ConceptDraft) => {
    const nextTopic = draft.topic.trim();
    if (!nextTopic) return;
    setTopic(nextTopic);
    generation.mutate({ topic: nextTopic, concept: draft });
  };

  // 色・余白・フォントの変更はプレビューへ即時反映するだけで、メモは残さない。
  // カラーピッカー等は操作ごとに大量のイベントが発火するため、記録は明示ボタンで行う。
  //
  // 変更そのものは止めない。まず変えて、見た目の違いを確かめてから
  // 「何を・なぜ・どう良くなるか」を書く順序のほうが、言葉にしやすいため。
  // 変更した項目は覚えておき、記録時に「何をどの値に変えたか」をまとめてメモへ残す。
  const changeTheme = (key: ThemeKey, value: string | number) => {
    // 基準の値まで戻したなら、その項目は変更していないのと同じ。
    // このとき基準に保存されていた値そのものへ戻す。見出しの色を「未指定」から
    // 触って戻した場合、同じ色を明示値として残すとメインカラーへ追従しなくなり、
    // 見た目は同じでも基準と違う状態になってしまうため。
    const backToBaseline = effectiveThemeValue(themeBaseline, key) === value;
    previewTheme(key, backToBaseline ? themeBaseline[key] : value);

    setTouchedThemeKeys((keys) => {
      const others = keys.filter((touched) => touched !== key);
      // 差分が無いのに「デザイン変更」のメモを作れてしまわないよう、対象から外す。
      if (backToBaseline) return others;
      return [...others, key];
    });
  };

  // ユーザーが理由を書いて「記録」ボタンを押したときだけ、変更内容と理由をメモへ残す。
  // まだ説明していない変更をまとめて1件にし、そのとき書かれている理由を付ける。
  const recordThemeReason = () => {
    if (!reason.trim()) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    if (touchedThemeKeys.length === 0) {
      setNotice("先に色・余白・フォントを変更してください。");
      return;
    }
    const summary = touchedThemeKeys.map((key) => describeThemeChange(key, site.theme)).join(" / ");
    addNote(`デザイン変更（${summary}）`, reason.trim(), cssChangesForThemeKeys(touchedThemeKeys));
    setNotice(noticeForRecordedReason("デザイン変更の内容と理由を学習メモへ記録しました。"));
    setThemeBaseline(site.theme);
    setTouchedThemeKeys([]);
    setReason("");
  };

  const recordContentReason = () => {
    if (!reason.trim() || !selectedSection) return;
    addNote(
      `内容変更（${selectedSection.title}）`,
      reason.trim(),
      htmlChangesForSection(selectedSection.id, selectedSection),
    );
    setNotice(noticeForRecordedReason("内容変更の理由を学習メモへ記録しました。"));
    // 基準を進めるのは記録したセクションだけ。他のセクションの未記録の変更は残す。
    setSectionBaselines((baselines) => ({ ...baselines, [selectedSection.id]: selectedSection }));
    setReason("");
  };

  // 構成の変更は、まとめて1件のメモにする。「足して削った」のように
  // 複数の判断が続くことがあり、1つずつ理由を書かせると同じ説明が並んでしまう。
  const recordStructureReason = () => {
    if (!reason.trim()) {
      setNotice("先に『なぜ変えるか』を入力してください。");
      return;
    }
    if (pendingStructure.length === 0) {
      setNotice("先にセクションを追加または削除してください。");
      return;
    }
    addNote(
      pendingStructure.map((change) => change.label).join(" / "),
      reason.trim(),
      htmlChangesForStructure(),
    );
    setNotice(noticeForRecordedReason("セクション構成の変更と理由を学習メモへ記録しました。"));
    setStructureBaseline(site.sections);
    setPendingStructure([]);
    setReason("");
  };

  const resetBuilder = () => {
    reset();
    discardUnrecordedChanges();
    setLoadedProject(false);
    setCurrentProjectId(null);
    setNotice("初期サンプルへ戻しました。");
  };

  // 上限・下限に達したら押せなくする。押せない理由は文言でも示す。
  const addBlockReason = addSectionBlockReason(site.sections.length);
  const removeBlockReason = removeSectionBlockReason(site.sections.length);

  const loadProject = (loadedSite: typeof site) => {
    loadSite(loadedSite);
    discardUnrecordedChanges();
    setLoadedProject(true);
  };

  // ヘッダーはflex-wrapで高さが変わるため、縦flexで残り高さをグリッドへ渡し、
  // 高さの決め打ち(calc(100vh-73px))を避ける。
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 xl:h-screen">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <h1 className="text-2xl font-black tracking-tight text-blue-600">Whyve</h1>
          <StepNav steps={steps} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuthControls enabled={clerkConfig.enabled} />
          <ProjectControls
            enabled={clerkConfig.enabled}
            site={site}
            currentProjectId={currentProjectId}
            onProjectChange={setCurrentProjectId}
            onLoad={loadProject}
            onNotice={setNotice}
          />
          <Button variant="ghost" onClick={resetBuilder}><RotateCcw className="mr-2 size-4" />リセット</Button>
          {/* 提出の手前で、何件記録できていて何件未説明かが分かるようにする。
              「理由を書かずに提出してしまう」のを止めるための最後の目印。 */}
          <span className="text-xs text-slate-500">
            メモ<strong className="mx-0.5 text-slate-800">{notes.length}</strong>件
            {flowState.unexplainedCount > 0 && (
              <strong className="ml-2 text-amber-700">未説明{flowState.unexplainedCount}件</strong>
            )}
          </span>
          <Button onClick={() => void exportProject(site, notes, aiUsage, axeAudit.status === "ready" ? [axeAudit.check] : [])}><Download className="mr-2 size-4" />提出物ZIP</Button>
        </div>
      </header>

      {/* 左右のカラムを畳むとプレビューが広がり、PC幅での見た目を確認できる。畳んでもつまみは残す。 */}
      <div className={`grid grid-cols-1 xl:min-h-0 xl:flex-1 ${setupOpen ? "xl:grid-cols-[340px_minmax(0,1fr)_var(--panel-w)]" : "xl:grid-cols-[40px_minmax(0,1fr)_var(--panel-w)]"}`} style={{ "--panel-w": panelOpen ? "350px" : "60px" } as CSSProperties}>
        {/* 下部バーのタブから参照されるパネル。xl以上では3カラム同時表示になるが、
            タブ列自体がxl:hiddenで消えるため、関連付けが残っていても支障はない。 */}
        <aside
          id="view-setup"
          role="tabpanel"
          aria-labelledby="view-tab-setup"
          className={`min-h-0 overflow-hidden border-r border-slate-200 bg-slate-100 xl:flex ${mobileView === "setup" ? "flex" : "hidden"}`}
        >
          {/* 畳んだときに残るつまみ。xl未満では下部バーで切り替えるため出さない。 */}
          <div className="order-2 hidden w-10 shrink-0 flex-col items-center bg-slate-100 py-3 xl:flex">
            <button
              type="button"
              onClick={() => setSetupOpen((open) => !open)}
              aria-expanded={setupOpen}
              title={setupOpen ? "題材・メモを畳んでプレビューを広げる" : "題材・メモを開く"}
              className="w-10 rounded-r-lg py-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700"
            >
              {setupOpen ? <ChevronLeft className="mx-auto size-4" /> : <ChevronRight className="mx-auto size-4" />}
            </button>
          </div>

          <div className={`flex-1 overflow-y-auto bg-white p-4 pb-20 xl:pb-4 ${setupOpen ? "block" : "block xl:hidden"}`}>
          <ConceptChatPanel onGenerate={generateFromConcept} generating={generation.isPending} />

          {/* 直接入力は補助の導線。畳んでしまうと題材から始めたい人が迷うため表示は残し、
              見た目の重みだけを落として、相談が主であることを示す。 */}
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="mb-2 text-xs text-slate-500">題材が決まっているなら、直接入力しても始められます。</p>
            <form onSubmit={submitTopic} className="space-y-2">
              <label className="text-xs font-bold text-slate-600" htmlFor="topic">紹介サイトの題材</label>
              <Textarea id="topic" rows={2} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例：地域の小さな植物園" />
              <Button variant="secondary" className="w-full" disabled={!topic.trim() || generation.isPending}>
                <Sparkles className="mr-2 size-4" />{generation.isPending ? "生成中…" : "たたき台を生成"}
              </Button>
            </form>
          </div>

          <div className="my-5 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <strong>AI生成文は仮テキストです。</strong><br />事実情報は必ず自分で調べて入力してください。
          </div>

          <h2 className="mb-1 text-sm font-black">
            セクション <span className="font-normal text-slate-400">{site.sections.length} / {maxSections}</span>
          </h2>
          <p className="mb-2 text-[11px] leading-4 text-slate-500">
            チェックを外すと非表示になります。使わないと決めたものは削除できます。
          </p>
          <ul className="space-y-2">
            {site.sections.map((section) => (
              <li key={section.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2">
                    <span className="truncate">{section.title}</span>
                    <input type="checkbox" checked={section.visible} onChange={(event) => toggleSection(section.id, event.target.checked)} />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRemovalTargetId(section.id)}
                    disabled={removeBlockReason !== null}
                    aria-label={`${section.title}を削除`}
                    title={removeBlockReason ?? `${section.title}を削除`}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                {/* 削除は取り消せないため、押した行の中でもう一度確かめる。
                    ブラウザのconfirmだと操作が止まるうえ、「まず非表示にする」という
                    引き返し方を示せない。消す前に、消さずに済む道を出しておく。 */}
                {removalTargetId === section.id && (
                  <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-900">
                    <p className="leading-4">削除すると元に戻せません。迷うなら、まず非表示にして様子を見てください。</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-8 px-2 text-xs"
                        onClick={() => { toggleSection(section.id, false); setRemovalTargetId(null); }}
                      >
                        まず非表示にする
                      </Button>
                      <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setRemovalTargetId(null)}>やめる</Button>
                      <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-100" onClick={() => handleRemoveSection(section)}>削除する</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* 追加は末尾へ入る。種類によって出力されるHTML・CSSが変わるため、種類は自分で選ぶ。 */}
          <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3">
            <label className="block text-xs font-bold text-slate-600" htmlFor="new-section-kind">追加するセクション</label>
            <div className="mt-1 flex gap-2">
              <select
                id="new-section-kind"
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-2 text-sm"
                value={newSectionKind}
                onChange={(event) => setNewSectionKind(event.target.value as SectionKind)}
              >
                {sectionKinds.map((kind) => <option key={kind} value={kind}>{sectionKindLabels[kind]}</option>)}
              </select>
              <Button type="button" variant="secondary" className="shrink-0 px-3" disabled={addBlockReason !== null} onClick={() => handleAddSection(newSectionKind)}>
                <Plus className="mr-1 size-4" />追加
              </Button>
            </div>
            {addBlockReason && <p className="mt-2 text-[11px] leading-4 text-amber-700">{addBlockReason}</p>}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-black">学習メモ <span className="text-slate-400">{notes.length}</span></h2>
          {/* 内側でスクロールさせない。列のスクロールと二重になり、どちらを動かせばよいか分からなくなる。 */}
          <div className="space-y-2">
            {notes.length === 0 ? <p className="text-xs text-slate-500">変更理由はまだありません。</p> : notes.slice().reverse().map((note) => (
              <div key={note.id} data-testid="learning-note" className="rounded-xl bg-slate-50 p-3 text-xs">
                <strong>{note.target}</strong>
                <p className="mt-1 text-slate-600">{note.reason}</p>
                {/* 書いた理由と、そのとき実際に変わったコードを対で残す。 */}
                {note.codeChanges && note.codeChanges.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-slate-200 pt-2">
                    {/* 同じ内容の行が複数変わることがあるため、行本文ではなく並び順で見分ける。 */}
                    {note.codeChanges.map((line, index) => (
                      <li key={`${note.id}-${index}`} className="truncate font-mono text-[10px] text-slate-500" title={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          </div>
        </aside>

        <main
          id="view-preview"
          role="tabpanel"
          aria-labelledby="view-tab-preview"
          className={`min-h-[70vh] min-w-0 flex-col p-4 pb-20 xl:flex xl:min-h-0 xl:pb-4 ${mobileView === "preview" ? "flex" : "hidden"}`}
        >
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info className="size-4 shrink-0" />{notice}</div>
          <div className="flex flex-wrap items-end justify-between gap-2 pb-3">
            <div>
              <span className="text-xs font-bold text-slate-600">LIVE PREVIEW</span>
              <h2 className="font-black">{site.siteTitle}</h2>
            </div>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setCodeOpen((open) => !open)} aria-expanded={codeOpen} aria-controls="code-panel-content">
              <Code2 className="mr-2 size-4" />{codeOpen ? "コードを隠す" : "コードを見る"}
            </Button>
          </div>

          {/* プレビューと生成コードを同時に見せる。理由を書く場面で、対象のコードを探しに行かせないため。 */}
          <div ref={previewAreaRef} className="flex min-h-0 flex-1 flex-col">
            <SitePreview site={site} onElementSelect={selectElement} />
            {codeOpen && (
              <>
                <VerticalSplitter
                  label="プレビューとコードの高さを調整"
                  value={codeHeight}
                  min={minCodeHeight}
                  max={maxCodeHeight}
                  // 下へ動かすとコードが縮む。プレビュー側も読める高さを残す。
                  onResize={(deltaY) => setCodeHeight((height) => limitCodeHeight(height - deltaY))}
                />
                <div className="flex shrink-0 flex-col" style={{ height: codeHeight }}>
                  <CodePanel site={site} baselineSite={baselineSite} selectedElementId={selectedElementId} />
                </div>
              </>
            )}
          </div>
        </main>

        <aside
          id="view-panel"
          role="tabpanel"
          aria-labelledby="view-tab-panel"
          className={`min-h-0 overflow-hidden border-l border-slate-200 bg-slate-100 xl:flex ${mobileView === "panel" ? "flex" : "hidden"}`}
        >
          {/* 畳んだときのつまみ。デスクトップで畳んでいる間はここだけが残る。 */}
          <div className={`hidden w-10 shrink-0 flex-col items-center py-3 ${panelOpen ? "xl:hidden" : "xl:flex"}`}>
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-expanded={false}
              title="パネルを開く"
              className="w-10 rounded-l-lg py-2 text-slate-400 transition hover:bg-white/60 hover:text-slate-700"
            >
              <ChevronLeft className="mx-auto size-4" />
            </button>
          </div>

          {/* 畳みはxl以上だけの機能。狭い画面ではパネルが画面全体なので、畳むと何も見えなくなる。 */}
          <div className={`flex min-w-0 flex-1 flex-col bg-white ${panelOpen ? "flex" : "flex xl:hidden"}`}>
          {/* タブは横書き。縦書きだと1文字ずつ縦に並び、主要ナビゲーションとして読みにくい。
              role="tablist"の子はtabのみ。畳むボタンはタブではないのでこの外に置く。 */}
          <div className="flex shrink-0 items-center border-b border-slate-200 px-2 pt-2">
            <div className="flex items-center gap-1" role="tablist" aria-label="調整と学習" aria-orientation="horizontal">
            {(Object.keys(panelLabels) as PanelKey[]).map((key) => {
              // 選択状態は「どのパネルを選んでいるか」だけで決める。
              // 畳み(panelOpen)を混ぜると、中身が見えるモバイルで全タブ非選択になり矛盾する。
              // 畳んでいる間はタブ列しか見えないため、選択表示が残っていて差し支えない。
              const selected = activePanel === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`panel-tab-${key}`}
                  aria-selected={selected}
                  aria-controls="panel-content"
                  tabIndex={selected ? 0 : -1}
                  title={panelLabels[key]}
                  onKeyDown={(event) =>
                    handleTabKeyDown(event, Object.keys(panelLabels) as PanelKey[], activePanel, "horizontal", (k) => `panel-tab-${k}`, setActivePanel)
                  }
                  onClick={() => {
                    // タブはパネルの切り替えだけを担う。畳み/展開はデスクトップ専用ボタンの役割。
                    // モバイルではパネルが常時表示なので、ここでpanelOpenを触ると
                    // 画面に出ていない「デスクトップの畳み状態」を勝手に書き換えてしまう。
                    setActivePanel(key);
                  }}
                  className={`relative rounded-t-lg px-3 py-2 text-sm font-bold whitespace-nowrap transition ${selected ? "bg-white text-blue-700 shadow-[inset_0_-2px_0_0_currentColor]" : "text-slate-500 hover:bg-white/60 hover:text-slate-800"}`}
                >
                  <span>{panelLabels[key]}</span>
                  {key === "quality" && hasQualityIssue && (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-600" />
                  )}
                </button>
              );
            })}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-expanded={panelOpen}
              title="パネルを畳んでプレビューを広げる"
              className="ml-auto hidden rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 xl:block"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div
            id="panel-content"
            role="tabpanel"
            aria-labelledby={`panel-tab-${activePanel}`}
            className="flex-1 overflow-y-auto p-4 pb-20 xl:pb-4"
          >
          {/* いま一番やってほしいことを1つだけ出す。複数並べると、
              結局どれから手を付ければよいのか分からなくなる。 */}
          <section aria-labelledby="next-action-heading" className="mb-4 rounded-xl bg-blue-50 p-3">
            <h3 id="next-action-heading" className="text-xs font-bold text-blue-700">次にすること</h3>
            <p className="mt-1 text-sm font-black text-blue-950">{nextToDo.title}</p>
            <p className="mt-1 text-xs leading-5 text-blue-900">{nextToDo.detail}</p>
          </section>

          {activePanel === "design" && <>
          <label className="mt-4 block text-xs font-bold" htmlFor="reason">なぜこの変更をしますか？</label>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">何を・どう変えて・なぜかを具体的に書くと、あとで見返したときに理解が深まります。</p>
          <Textarea id="reason" rows={2} className={`mt-1 ${reason.trim() ? "" : "ring-2 ring-amber-400 focus-visible:ring-amber-400"}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例：見出しを赤にした。植物園の元気な雰囲気を伝えたいから" />

          {/* 書けている観点をその場で返す。記録は止めず、足りない観点の書き足しかたを示す。 */}
          <ul className="mt-2 space-y-1" aria-label="理由の書けている観点">
            {reasonChecks.map((check) => (
              <li key={check.id} className="flex gap-1.5 text-[11px] leading-4">
                {check.passed
                  ? <Check className="mt-px size-3.5 shrink-0 text-emerald-600" aria-hidden />
                  : <Circle className="mt-px size-3.5 shrink-0 text-slate-300" aria-hidden />}
                <span className={check.passed ? "text-emerald-700" : "text-slate-500"}>
                  <strong className="font-bold">{check.label}</strong>
                  {check.passed ? <span className="sr-only">：書けています</span> : `：${check.hint}`}
                </span>
              </li>
            ))}
          </ul>
          {passedAspects === reasonChecks.length && (
            <p className="mt-1 text-[11px] font-bold text-emerald-700">3つそろいました。記録すると、変わったコードも一緒に残ります。</p>
          )}

          <Card className="relative mt-4 space-y-4 p-4">
            <h3 className="text-sm font-black">デザイン</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold">メインカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.primary} onChange={(event) => changeTheme("primary", event.target.value)} /></label>
              <label className="block text-xs font-bold">背景色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.background} onChange={(event) => changeTheme("background", event.target.value)} /></label>
              <label className="block text-xs font-bold">テキストカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.text} onChange={(event) => changeTheme("text", event.target.value)} /></label>
              {/* 見出しの色は未指定ならメインカラーを引き継ぐ。ピッカーにはその実効値を表示する。 */}
              <label className="block text-xs font-bold">見出しの色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.heading ?? site.theme.primary} onChange={(event) => changeTheme("heading", event.target.value)} /></label>
            </div>
            <label className="block text-xs font-bold">余白: {site.theme.spacing}<input className="mt-2 w-full" type="range" min="2" max="10" value={site.theme.spacing} onChange={(event) => changeTheme("spacing", Number(event.target.value))} /></label>
            <label className="block text-xs font-bold">フォント<select className="mt-1 min-h-10 w-full rounded-xl border border-slate-300 px-3" value={site.theme.fontFamily} onChange={(event) => changeTheme("fontFamily", event.target.value)}><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="rounded">丸ゴシック</option></select></label>
            <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={recordThemeReason}>デザイン変更の理由を記録</Button>
          </Card>

          {/* 構成の変更は、色や文章の書き換えより判断の粒度が大きい。
              何を足して何を削ったのかを並べ、まとめて1件の説明として残す。 */}
          {pendingStructure.length > 0 && <Card className="mt-4 space-y-3 p-4">
            <h3 className="text-sm font-black">セクション構成の変更</h3>
            <ul className="space-y-1 text-xs text-slate-600">
              {pendingStructure.map((change) => <li key={change.id}>・{change.label}</li>)}
            </ul>
            <Button type="button" className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={recordStructureReason}>セクション構成の理由を記録</Button>
          </Card>}

          {selectedSection && <Card className="mt-4 space-y-3 p-4">
            <h3 className="text-sm font-black">選択中: {selectedSection.title}</h3>
            <label className="block text-xs font-bold">見出し<Input className="mt-1" value={selectedSection.title} onChange={(event) => updateSection(selectedSection.id, { title: event.target.value })} /></label>
            <label className="block text-xs font-bold">本文<Textarea className="mt-1" rows={4} value={selectedSection.body} onChange={(event) => updateSection(selectedSection.id, { body: event.target.value })} /></label>
            {selectedSection.kind !== "contact" && <label className="block text-xs font-bold">画像の説明（alt）<Input className="mt-1" value={selectedSection.imageAlt} onChange={(event) => updateSection(selectedSection.id, { imageAlt: event.target.value })} placeholder="画像が見えない人にも伝わる説明" /></label>}
            <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={recordContentReason}>内容変更の理由を記録</Button>
          </Card>}
          </>}

          {activePanel === "explanation" && <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">なぜこのコード？</h3>
            {/* プレビュー上に置くと画面を圧迫するため、操作案内はこのタブ内に置く。 */}
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
              プレビュー内の要素を<strong>クリック</strong>すると、その部分の解説に切り替わります。
            </p>
            <p className="mt-3 text-sm font-bold text-blue-700">{explanation.title}</p>
            <p className="mt-2 text-xs leading-5"><strong>HTML:</strong> {explanation.html}</p>
            <p className="mt-1 text-xs leading-5"><strong>CSS:</strong> {explanation.css}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{explanation.why}</p>
          </Card>}

          {activePanel === "quality" && <Card className="mt-4 p-4">
            <h3 className="text-sm font-black">品質チェック</h3>
            <div className="mt-3 space-y-3">{quality.map((item) => <div key={item.id} className="flex gap-2 text-xs">{item.passed ? <Check className="size-5 shrink-0 text-emerald-600" /> : <X className="size-5 shrink-0 text-red-600" />}<div><strong>{item.label}</strong><p className="mt-0.5 leading-5 text-slate-600">{item.detail}</p></div></div>)}</div>

            {/* axeの自動チェック。実測に時間がかかるため、実行中・結果・失敗を分けて出す。 */}
            <section aria-labelledby="axe-heading" className="mt-4 border-t border-slate-200 pt-3">
              <h4 id="axe-heading" className="text-xs font-black">アクセシビリティ（axe）</h4>

              {axeAudit.status === "loading" && (
                <p className="mt-2 text-xs text-slate-500" data-testid="axe-loading">自動チェックを実行しています…</p>
              )}

              {axeAudit.status === "error" && (
                <p className="mt-2 flex gap-2 text-xs text-red-700" data-testid="axe-error">
                  <X className="size-5 shrink-0" />
                  <span className="leading-5">{axeAudit.message}</span>
                </p>
              )}

              {axeAudit.status === "ready" && axeAudit.findings.length === 0 && (
                <p className="mt-2 flex gap-2 text-xs text-slate-600" data-testid="axe-empty">
                  <Check className="size-5 shrink-0 text-emerald-600" />
                  <span className="leading-5">自動チェックで見つかる問題はありませんでした。</span>
                </p>
              )}

              {axeAudit.status === "ready" && axeAudit.findings.length > 0 && (
                <ul className="mt-2 space-y-3" data-testid="axe-findings">
                  {axeAudit.findings.map((finding) => (
                    <li key={finding.ruleId} className="flex gap-2 text-xs">
                      <X className="size-5 shrink-0 text-red-600" />
                      <div className="min-w-0">
                        <strong className="leading-5">{finding.summary}</strong>
                        <p className="mt-0.5 leading-5 text-slate-600">{finding.why}</p>
                        <p className="mt-0.5 leading-5 text-slate-500">
                          影響: {impactLabels[finding.impact]} ／ 対象: <code className="break-all">{finding.target}</code>
                          {finding.count > 1 && ` ほか${finding.count - 1}件`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 自動チェックが万能だと思わせないための一文。
                  axeは機械的に判定できる範囲しか見ないため、通っても内容の分かりやすさは別途確認が要る。 */}
              <p className="mt-3 text-[11px] leading-4 text-slate-500">
                提出物と同じHTML・CSSを読み込んで自動判定しています。ここで問題が無くても、文章の分かりやすさは自分の目で確認してください。
              </p>
            </section>
          </Card>}
          </div>
          </div>
        </aside>
      </div>

      {/* 狭い画面用の切替バー。3カラムを縦積みすると見づらいため、1つずつ表示する。 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white/95 backdrop-blur xl:hidden" role="tablist" aria-label="表示の切り替え">
        {(Object.keys(mobileViewLabels) as MobileView[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`view-tab-${key}`}
            aria-selected={mobileView === key}
            aria-controls={`view-${key}`}
            tabIndex={mobileView === key ? 0 : -1}
            onKeyDown={(event) =>
              handleTabKeyDown(event, Object.keys(mobileViewLabels) as MobileView[], mobileView, "horizontal", (k) => `view-tab-${k}`, setMobileView)
            }
            onClick={() => setMobileView(key)}
            className={`relative flex-1 py-3 text-xs font-bold transition ${mobileView === key ? "text-blue-700" : "text-slate-600"}`}
          >
            {mobileViewLabels[key]}
            {key === "panel" && hasQualityIssue && (
              <span className="ml-1 inline-block size-1.5 rounded-full bg-red-600 align-middle" />
            )}
            {mobileView === key && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-blue-700" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

