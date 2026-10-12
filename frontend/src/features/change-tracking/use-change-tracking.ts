import { useMemo, useState } from "react";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { collectChangedLineTexts } from "@/features/code-view/annotate-code";
import type { ShowNotice } from "@/features/notice/notice";
import { countPassedAspects, evaluateReason } from "@/features/reasoning/evaluate-reason";
import type { SiteModel, SiteSection } from "@/features/site-model/schema";
import type { SectionKind } from "@/features/site-model/sections";
import {
  appendNote,
  sectionAdded,
  sectionRemoved,
  useBuilderStore,
  withSectionValues,
  withThemeValue,
} from "@/features/site-model/store";
import { describeThemeChange, effectiveThemeValue, type ThemeKey } from "./theme-change";
import type { TrackingState } from "./tracking-state";

export type { StructureChange } from "./tracking-state";

// 以下の差分の取り出しは、サイトと記録を引数で受け取る。
// 操作のたびにstoreの最新の状態から計算し、同じ描画の中で操作が続いても古い値を使わないようにするため。

// 内容の基準。顔ぶれと並びは「いまの構成」に合わせ、中身だけ基準値へ戻す。
// 内容の差分を取るときに、構成の変更が混ざらないようにするため。
// 生成やプロジェクト読み込みで増えたセクションは、その時点の内容を基準として扱う。
function contentBaselineSections(site: SiteModel, tracking: TrackingState): SiteSection[] {
  return site.sections.map((section) => tracking.sectionBaselines[section.id] ?? section);
}

// 構成の基準。顔ぶれも中身も、最後に記録した時点のまま。
function structureBaselineSections(tracking: TrackingState): SiteSection[] {
  return tracking.structureBaseline.map((section) => tracking.sectionBaselines[section.id] ?? section);
}

// 記録するデザイン変更が、実際にCSSのどこを動かしたかを取り出す。
// 対象の項目だけを基準値から動かして比べるため、まとめて変更しても項目ごとに分けて残せる。
function cssChangesForThemeKeys(site: SiteModel, tracking: TrackingState, keys: ThemeKey[]): string[] {
  const changedTheme = { ...tracking.themeBaseline };
  for (const key of keys) Object.assign(changedTheme, { [key]: site.theme[key] });
  return collectChangedLineTexts(
    buildSiteArtifacts({ ...site, theme: changedTheme }).css,
    buildSiteArtifacts({ ...site, theme: tracking.themeBaseline }).css,
  );
}

// 内容の変更はHTMLに出る。表示切替も文章の書き換えも同じ見かたで取り出せる。
// 対象のセクションだけを基準から動かして比べるため、他のセクションを未記録のまま
// 触っていても、その分は今回のメモへ混ざらない。
function htmlChangesForSection(site: SiteModel, tracking: TrackingState, sectionId: string, nextSection: SiteSection): string[] {
  const baseline = contentBaselineSections(site, tracking);
  const changedSections = baseline.map((section) => (section.id === sectionId ? nextSection : section));
  return collectChangedLineTexts(
    buildSiteArtifacts({ ...site, sections: changedSections }).html,
    buildSiteArtifacts({ ...site, sections: baseline }).html,
  );
}

// 構成の変更はHTMLのsectionごと増減する。両側に内容の基準値を当てて比べることで、
// まだ説明していない文章の書き換えが、構成の説明へ混ざらないようにする。
function htmlChangesForStructure(site: SiteModel, tracking: TrackingState): string[] {
  return collectChangedLineTexts(
    buildSiteArtifacts({ ...site, sections: contentBaselineSections(site, tracking) }).html,
    buildSiteArtifacts({ ...site, sections: structureBaselineSections(tracking) }).html,
  );
}

// 記録は止めないが、書けていない観点があれば次に何を書けばよいかを添える。
// 理由が書けたこと自体を理解の証拠にせず、説明を組み立てる手がかりを返すため。
function noticeForRecordedReason(message: string, reason: string): string {
  const missing = evaluateReason(reason).filter((check) => !check.passed);
  if (missing.length === 0) return `${message} 何を・なぜ・どう良くなるかがそろっています。`;
  return `${message} 次は「${missing.map((check) => check.label).join("」「")}」も書けると、変更を自分の言葉で説明できます。`;
}

const missingReasonMessage = "先に『なぜ変えるか』を入力してください。";

// 記録操作の結果。storeの更新の中で決まり、更新のあとで通知に使う。
type RecordOutcome = { error?: string; recordedReason?: string };

// 変更と、その理由の記録を受け持つ。
// 「まだ理由を書いていない変更」をコード上で示すための基準値と、未記録の変更をここにまとめる。
// 基準値と未記録の変更は互いに依存するため、分けずに1か所で更新する。
// 値そのものは再読み込みで消えないよう、サイトと一緒にstoreへ保存している（中身はtracking-state.tsを参照）。
// 更新はサイトの変更と同じcommitの中で行い、両者が食い違ったまま保存されないようにする。
export function useChangeTracking(showNotice: ShowNotice) {
  const { site, tracking, commit, discardTracking } = useBuilderStore();
  const { reason, touchedThemeKeys, sectionBaselines, pendingStructure } = tracking;
  // 基準を捨てた回数。画面側で、記録前の操作途中の状態（削除の確認など）を閉じる合図に使う。
  const [revision, setRevision] = useState(0);

  // コード上の「未記録の変更」には、内容の書き換えと構成の増減の両方を含める。
  const baselineSite = useMemo(
    () => ({ ...site, theme: tracking.themeBaseline, sections: structureBaselineSections(tracking) }),
    [site, tracking],
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

  const setReason = (value: string) => commit((state) => ({ tracking: { ...state.tracking, reason: value } }));

  // 記録されないまま残っている「変更中の状態」を捨てる。
  // サイトが差し替わる操作（生成・リセット・読み込み）のたびに呼ぶ。
  // 差し替え後のサイトが新しい基準になるため、コード上の変更表示もここで消える。
  const discard = () => {
    discardTracking();
    setRevision((value) => value + 1);
  };

  // 色・余白・フォントの変更はプレビューへ即時反映するだけで、メモは残さない。
  // カラーピッカー等は操作ごとに大量のイベントが発火するため、記録は明示ボタンで行う。
  //
  // 変更そのものは止めない。まず変えて、見た目の違いを確かめてから
  // 「何を・なぜ・どう良くなるか」を書く順序のほうが、言葉にしやすいため。
  // 変更した項目は覚えておき、記録時に「何をどの値に変えたか」をまとめてメモへ残す。
  const changeTheme = (key: ThemeKey, value: string | number) =>
    commit((state) => {
      const current = state.tracking;
      // 基準の値まで戻したなら、その項目は変更していないのと同じ。
      // このとき基準に保存されていた値そのものへ戻す。見出しの色を「未指定」から
      // 触って戻した場合、同じ色を明示値として残すとメインカラーへ追従しなくなり、
      // 見た目は同じでも基準と違う状態になってしまうため。
      const backToBaseline = effectiveThemeValue(current.themeBaseline, key) === value;
      const others = current.touchedThemeKeys.filter((touched) => touched !== key);
      return {
        site: withThemeValue(state.site, key, backToBaseline ? current.themeBaseline[key] : value),
        // 差分が無いのに「デザイン変更」のメモを作れてしまわないよう、対象から外す。
        tracking: { ...current, touchedThemeKeys: backToBaseline ? others : [...others, key] },
      };
    });

  // セクションの表示切替は、理由が入っていればその場で学習メモへ残る。
  // 記録できたときだけ、そのセクションの「未記録の変更」の基準を進める。
  const toggleSection = (id: string, visible: boolean) => {
    const outcome = { hidAll: false };
    commit((state) => {
      const current = state.site.sections.find((section) => section.id === id);
      if (!current) return {};
      const nextSection = { ...current, visible };
      const nextSite = withSectionValues(state.site, id, { visible });
      outcome.hidAll = !visible && nextSite.sections.every((section) => !section.visible);
      const trimmedReason = state.tracking.reason.trim();
      if (!trimmedReason) return { site: nextSite };
      return {
        site: nextSite,
        notes: appendNote(
          state.notes,
          `表示切替（${current.title}）`,
          trimmedReason,
          htmlChangesForSection(state.site, state.tracking, id, nextSection),
        ),
        tracking: { ...state.tracking, sectionBaselines: { ...state.tracking.sectionBaselines, [id]: nextSection } },
      };
    });
    // 最後の1つを隠すと、プレビューにはヘッダーとフッターしか残らない。案内はプレビュー側に出るが、
    // チェックボックスを操作している位置からは見えない（モバイルでは別の表示）ため、通知でも伝える。
    if (outcome.hidAll) {
      showNotice("すべてのセクションが非表示になりました。「セクション」一覧でチェックを入れると、プレビューに戻ります。");
    }
  };

  // セクションの追加。末尾へ入る。どこへ入るか分からないと、押したあとで画面を探すことになる。
  // 上限で追加できなかったときは、記録も進めない。
  const addSectionOfKind = (kind: SectionKind) => {
    const outcome: { added?: SiteSection } = {};
    commit((state) => {
      const result = sectionAdded(state, kind);
      if (!result) return {};
      const { added } = result;
      outcome.added = added;
      const current = state.tracking;
      const restoredBaseline = current.structureBaseline.find((section) => section.id === added.id);
      const removedId = `remove-${added.id}`;
      // 構成の削除と再追加は相殺し、プリセットとの差だけを内容変更として扱う。
      const pending =
        restoredBaseline && current.pendingStructure.some((change) => change.id === removedId)
          ? current.pendingStructure.filter((change) => change.id !== removedId)
          : [...current.pendingStructure, { id: `add-${added.id}`, label: `セクション追加（${added.title}）` }];
      return {
        ...result.patch,
        tracking: {
          ...current,
          // 追加した時点の内容を、その節の内容の基準にする。
          // ここで基準を置かないと、追加後に書き換えた文章が未説明の内容変更として数えられない。
          // ただし、記録前に削除したidを再利用した場合は元の内容を基準へ戻す。
          sectionBaselines: { ...current.sectionBaselines, [added.id]: restoredBaseline ?? added },
          pendingStructure: pending,
        },
      };
    });
    if (outcome.added) {
      showNotice(`「${outcome.added.title}」を末尾に追加しました。なぜ足すのかを書いて記録してください。`);
    }
  };

  // セクションの削除。確認を通ってから呼ぶ。削除できたかを返す。
  // フォーカスの移動は画面側で行うため、呼び出し側でflushSyncに包めるよう、ここでは状態の更新だけを行う。
  const removeSectionTracked = (section: SiteSection): boolean => {
    const outcome = { removed: false };
    commit((state) => {
      const target = state.site.sections.find((existing) => existing.id === section.id);
      const patch = target ? sectionRemoved(state, target.id) : null;
      if (!target || !patch) return {};
      outcome.removed = true;
      const current = state.tracking;
      // 消したセクションの内容の基準は残さない。残すと、もう画面に無い変更を
      // 未説明として数え続けてしまう。
      const sectionBaselines = { ...current.sectionBaselines };
      delete sectionBaselines[target.id];
      // 追加したばかりのものを消したなら、構成は元に戻っている。説明する変更も無い。
      const addedId = `add-${target.id}`;
      const pending = current.pendingStructure.some((change) => change.id === addedId)
        ? current.pendingStructure.filter((change) => change.id !== addedId)
        : [...current.pendingStructure, { id: `remove-${target.id}`, label: `セクション削除（${target.title}）` }];
      return { ...patch, tracking: { ...current, sectionBaselines, pendingStructure: pending } };
    });
    return outcome.removed;
  };

  const notifyRecorded = (outcome: RecordOutcome, message: string) => {
    if (outcome.error) showNotice(outcome.error, "error");
    else if (outcome.recordedReason) showNotice(noticeForRecordedReason(message, outcome.recordedReason));
  };

  // ユーザーが理由を書いて「記録」ボタンを押したときだけ、変更内容と理由をメモへ残す。
  // まだ説明していない変更をまとめて1件にし、そのとき書かれている理由を付ける。
  const recordThemeReason = () => {
    const outcome: RecordOutcome = {};
    commit((state) => {
      const current = state.tracking;
      const trimmedReason = current.reason.trim();
      if (!trimmedReason) {
        outcome.error = missingReasonMessage;
        return {};
      }
      if (current.touchedThemeKeys.length === 0) {
        outcome.error = "先に色・余白・フォントを変更してください。";
        return {};
      }
      outcome.recordedReason = trimmedReason;
      const summary = current.touchedThemeKeys.map((key) => describeThemeChange(key, state.site.theme)).join(" / ");
      return {
        notes: appendNote(
          state.notes,
          `デザイン変更（${summary}）`,
          trimmedReason,
          cssChangesForThemeKeys(state.site, current, current.touchedThemeKeys),
        ),
        tracking: { ...current, themeBaseline: state.site.theme, touchedThemeKeys: [], reason: "" },
      };
    });
    notifyRecorded(outcome, "デザイン変更の内容と理由を学習メモへ記録しました。");
  };

  const recordContentReason = (section: SiteSection) => {
    const outcome: RecordOutcome = {};
    commit((state) => {
      const current = state.tracking;
      const trimmedReason = current.reason.trim();
      // 記録するのは、いまstoreにある内容。画面から受け取った値が古くても、実際の状態とずれないようにする。
      const latest = state.site.sections.find((existing) => existing.id === section.id);
      if (!trimmedReason || !latest) return {};
      outcome.recordedReason = trimmedReason;
      return {
        notes: appendNote(
          state.notes,
          `内容変更（${latest.title}）`,
          trimmedReason,
          htmlChangesForSection(state.site, current, latest.id, latest),
        ),
        // 基準を進めるのは記録したセクションだけ。他のセクションの未記録の変更は残す。
        tracking: { ...current, sectionBaselines: { ...current.sectionBaselines, [latest.id]: latest }, reason: "" },
      };
    });
    notifyRecorded(outcome, "内容変更の理由を学習メモへ記録しました。");
  };

  // 構成の変更は、まとめて1件のメモにする。「足して削った」のように
  // 複数の判断が続くことがあり、1つずつ理由を書かせると同じ説明が並んでしまう。
  const recordStructureReason = () => {
    const outcome: RecordOutcome = {};
    commit((state) => {
      const current = state.tracking;
      const trimmedReason = current.reason.trim();
      if (!trimmedReason) {
        outcome.error = missingReasonMessage;
        return {};
      }
      if (current.pendingStructure.length === 0) {
        outcome.error = "先にセクションを追加または削除してください。";
        return {};
      }
      outcome.recordedReason = trimmedReason;
      return {
        notes: appendNote(
          state.notes,
          current.pendingStructure.map((change) => change.label).join(" / "),
          trimmedReason,
          htmlChangesForStructure(state.site, current),
        ),
        tracking: { ...current, structureBaseline: state.site.sections, pendingStructure: [], reason: "" },
      };
    });
    notifyRecorded(outcome, "セクション構成の変更と理由を学習メモへ記録しました。");
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
