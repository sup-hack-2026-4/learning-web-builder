import { useMemo, useState } from "react";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { collectChangedLineTexts } from "@/features/code-view/annotate-code";
import type { ShowNotice } from "@/features/notice/notice";
import { countPassedAspects, evaluateReason } from "@/features/reasoning/evaluate-reason";
import type { SiteSection } from "@/features/site-model/schema";
import { addSectionBlockReason, removeSectionBlockReason, type SectionKind } from "@/features/site-model/sections";
import { useBuilderStore } from "@/features/site-model/store";
import { describeThemeChange, effectiveThemeValue, type ThemeKey } from "./theme-change";

// まだ説明を書いていない構成の変更1件。
// 「セクション追加（〜）」のように同じ文言が並ぶことがあるため、
// 打ち消し（追加してすぐ削除）を扱えるようidを持たせる。
export type StructureChange = { id: string; label: string };

// 変更と、その理由の記録を受け持つ。
// 「まだ理由を書いていない変更」をコード上で示すための基準値と、未記録の変更をここにまとめる。
// 基準値と未記録の変更は互いに依存するため、分けずに1か所で更新する。
export function useChangeTracking(showNotice: ShowNotice) {
  const { site, previewTheme, updateSection, addSection, removeSection, addNote } = useBuilderStore();
  const [reason, setReason] = useState("");
  // 記録ボタンを押すまでに変更したテーマ項目。まだ説明を書いていない変更として持つ。
  const [touchedThemeKeys, setTouchedThemeKeys] = useState<ThemeKey[]>([]);
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
  // 基準を捨てた回数。画面側で、記録前の操作途中の状態（削除の確認など）を閉じる合図に使う。
  const [revision, setRevision] = useState(0);

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

  // 説明していない変更は、デザインと内容と構成をすべて数える。
  const unexplainedSectionCount = useMemo(
    () =>
      site.sections.filter((section) => {
        const baseline = sectionBaselines[section.id];
        if (!baseline) return false;
        return (
          baseline.title !== section.title ||
          baseline.body !== section.body ||
          baseline.imageAlt !== section.imageAlt ||
          // 画像の差し替えと削除も、理由を書く対象の変更として数える。
          baseline.image?.dataUri !== section.image?.dataUri ||
          baseline.visible !== section.visible
        );
      }).length,
    [site.sections, sectionBaselines],
  );
  const unexplainedCount = touchedThemeKeys.length + unexplainedSectionCount + pendingStructure.length;

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

  // 記録されないまま残っている「変更中の状態」を捨てる。
  // サイトが差し替わる操作（生成・リセット・読み込み）のたびに呼ぶ。
  // 差し替え後のサイトが新しい基準になるため、コード上の変更表示もここで消える。
  const discard = () => {
    setTouchedThemeKeys([]);
    setReason("");
    const current = useBuilderStore.getState().site;
    setThemeBaseline(current.theme);
    setSectionBaselines(Object.fromEntries(current.sections.map((section) => [section.id, section])));
    setStructureBaseline(current.sections);
    setPendingStructure([]);
    setRevision((value) => value + 1);
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
    // 最後の1つを隠すと、プレビューにはヘッダーとフッターしか残らない。案内はプレビュー側に出るが、
    // チェックボックスを操作している位置からは見えない（モバイルでは別の表示）ため、通知でも伝える。
    if (!visible && site.sections.every((section) => section.id === id || !section.visible)) {
      showNotice("すべてのセクションが非表示になりました。「セクション」一覧でチェックを入れると、プレビューに戻ります。");
    }
  };

  // セクションの追加。末尾へ入る。どこへ入るか分からないと、押したあとで画面を探すことになる。
  const addSectionOfKind = (kind: SectionKind) => {
    if (addSectionBlockReason(site.sections.length)) return;
    addSection(kind);
    // 採番はstoreの中で行うため、追加後の状態から実際に入った1件を取り出す。
    const added = useBuilderStore.getState().site.sections.at(-1);
    if (!added) return;
    const restoredBaseline = structureBaseline.find((section) => section.id === added.id);
    const removedId = `remove-${added.id}`;
    // 追加した時点の内容を、その節の内容の基準にする。
    // ここで基準を置かないと、追加後に書き換えた文章が未説明の内容変更として数えられない。
    // ただし、記録前に削除したidを再利用した場合は元の内容を基準へ戻す。
    // 構成の削除と再追加は相殺し、プリセットとの差だけを内容変更として扱う。
    setSectionBaselines((baselines) => ({
      ...baselines,
      [added.id]: restoredBaseline ?? added,
    }));
    setPendingStructure((changes) => {
      if (restoredBaseline && changes.some((change) => change.id === removedId)) {
        return changes.filter((change) => change.id !== removedId);
      }
      return [
        ...changes,
        { id: `add-${added.id}`, label: `セクション追加（${added.title}）` },
      ];
    });
    showNotice(`「${added.title}」を末尾に追加しました。なぜ足すのかを書いて記録してください。`);
  };

  // セクションの削除。確認を通ってから呼ぶ。削除できたかを返す。
  // フォーカスの移動は画面側で行うため、呼び出し側でflushSyncに包めるよう、ここでは状態の更新だけを行う。
  const removeSectionTracked = (section: SiteSection): boolean => {
    if (removeSectionBlockReason(site.sections.length)) return false;
    removeSection(section.id);
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
      if (changes.some((change) => change.id === `remove-${section.id}`)) return changes;
      return [...changes, { id: `remove-${section.id}`, label: `セクション削除（${section.title}）` }];
    });
    return true;
  };

  // 記録は止めないが、書けていない観点があれば次に何を書けばよいかを添える。
  // 理由が書けたこと自体を理解の証拠にせず、説明を組み立てる手がかりを返すため。
  const noticeForRecordedReason = (message: string): string => {
    const missing = reasonChecks.filter((check) => !check.passed);
    if (missing.length === 0) return `${message} 何を・なぜ・どう良くなるかがそろっています。`;
    return `${message} 次は「${missing.map((check) => check.label).join("」「")}」も書けると、変更を自分の言葉で説明できます。`;
  };

  // ユーザーが理由を書いて「記録」ボタンを押したときだけ、変更内容と理由をメモへ残す。
  // まだ説明していない変更をまとめて1件にし、そのとき書かれている理由を付ける。
  const recordThemeReason = () => {
    if (!reason.trim()) {
      showNotice("先に『なぜ変えるか』を入力してください。", "error");
      return;
    }
    if (touchedThemeKeys.length === 0) {
      showNotice("先に色・余白・フォントを変更してください。", "error");
      return;
    }
    const summary = touchedThemeKeys.map((key) => describeThemeChange(key, site.theme)).join(" / ");
    addNote(`デザイン変更（${summary}）`, reason.trim(), cssChangesForThemeKeys(touchedThemeKeys));
    showNotice(noticeForRecordedReason("デザイン変更の内容と理由を学習メモへ記録しました。"));
    setThemeBaseline(site.theme);
    setTouchedThemeKeys([]);
    setReason("");
  };

  const recordContentReason = (section: SiteSection) => {
    if (!reason.trim()) return;
    addNote(
      `内容変更（${section.title}）`,
      reason.trim(),
      htmlChangesForSection(section.id, section),
    );
    showNotice(noticeForRecordedReason("内容変更の理由を学習メモへ記録しました。"));
    // 基準を進めるのは記録したセクションだけ。他のセクションの未記録の変更は残す。
    setSectionBaselines((baselines) => ({ ...baselines, [section.id]: section }));
    setReason("");
  };

  // 構成の変更は、まとめて1件のメモにする。「足して削った」のように
  // 複数の判断が続くことがあり、1つずつ理由を書かせると同じ説明が並んでしまう。
  const recordStructureReason = () => {
    if (!reason.trim()) {
      showNotice("先に『なぜ変えるか』を入力してください。", "error");
      return;
    }
    if (pendingStructure.length === 0) {
      showNotice("先にセクションを追加または削除してください。", "error");
      return;
    }
    addNote(
      pendingStructure.map((change) => change.label).join(" / "),
      reason.trim(),
      htmlChangesForStructure(),
    );
    showNotice(noticeForRecordedReason("セクション構成の変更と理由を学習メモへ記録しました。"));
    setStructureBaseline(site.sections);
    setPendingStructure([]);
    setReason("");
  };

  return {
    reason,
    setReason,
    reasonChecks,
    passedAspects,
    baselineSite,
    pendingStructure,
    unexplainedCount,
    revision,
    discard,
    changeTheme,
    toggleSection,
    addSection: addSectionOfKind,
    removeSection: removeSectionTracked,
    recordThemeReason,
    recordContentReason,
    recordStructureReason,
  };
}

export type ChangeTracking = ReturnType<typeof useChangeTracking>;
