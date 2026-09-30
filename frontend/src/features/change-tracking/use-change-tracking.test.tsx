import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { createSampleSite } from "@/features/site-model/sample";
import { useBuilderStore } from "@/features/site-model/store";
import { useChangeTracking } from "./use-change-tracking";

function setup() {
  const showNotice = vi.fn();
  const hook = renderHook(() => useChangeTracking(showNotice));
  return { ...hook, showNotice };
}

const sectionOf = (id: string) => useBuilderStore.getState().site.sections.find((section) => section.id === id)!;

beforeEach(() => {
  useBuilderStore.setState({ notes: [], aiUsage: [], site: createSampleSite(), selectedElementId: "hero" });
  // 前のテストの変更記録を持ち越さないよう、差し替えたサイトを基準にし直す。
  useBuilderStore.getState().discardTracking();
});

describe("useChangeTracking", () => {
  it("デザインを変えると未説明として数え、基準の値へ戻すと数えない", () => {
    const { result } = setup();
    const original = useBuilderStore.getState().site.theme.primary;

    act(() => result.current.changeTheme("primary", "#e11d48"));
    expect(result.current.unexplainedCount).toBe(1);

    act(() => result.current.changeTheme("primary", original));
    expect(result.current.unexplainedCount).toBe(0);
  });

  it("理由を書いて記録すると、変わったCSSと一緒にメモへ残し、基準を進める", () => {
    const { result } = setup();

    act(() => result.current.changeTheme("primary", "#e11d48"));
    act(() => result.current.setReason("見出しを赤にした。元気な雰囲気を伝えたいから"));
    act(() => result.current.recordThemeReason());

    const [note] = useBuilderStore.getState().notes;
    expect(note.target).toBe("デザイン変更（メインカラーを #e11d48 に）");
    expect(note.codeChanges?.some((line) => line.includes("#e11d48"))).toBe(true);
    expect(result.current.unexplainedCount).toBe(0);
    expect(result.current.reason).toBe("");
  });

  it("理由が空のまま記録しようとすると、メモを残さずに知らせる", () => {
    const { result, showNotice } = setup();

    act(() => result.current.changeTheme("primary", "#e11d48"));
    act(() => result.current.recordThemeReason());

    expect(useBuilderStore.getState().notes).toHaveLength(0);
    expect(showNotice).toHaveBeenCalledWith("先に『なぜ変えるか』を入力してください。", "error");
  });

  it("内容の記録は、記録したセクションの基準だけを進める", () => {
    const { result } = setup();

    act(() => useBuilderStore.getState().updateSection("hero", { title: "新しい見出し" }));
    act(() => useBuilderStore.getState().updateSection("about", { body: "書き換えた本文" }));
    expect(result.current.unexplainedCount).toBe(2);

    act(() => result.current.setReason("見出しを短くした。一目で伝わるようにしたいから"));
    act(() => result.current.recordContentReason(sectionOf("hero")));

    expect(result.current.unexplainedCount).toBe(1);
  });

  it("追加してすぐ削除したセクションは、説明すべき構成の変更として残らない", () => {
    const { result } = setup();

    act(() => result.current.addSection("gallery"));
    expect(result.current.pendingStructure).toHaveLength(1);

    const added = useBuilderStore.getState().site.sections.at(-1)!;
    act(() => {
      result.current.removeSection(added);
    });

    expect(result.current.pendingStructure).toHaveLength(0);
    expect(result.current.unexplainedCount).toBe(0);
  });

  it("理由を書いてから表示を切り替えると、その場でメモへ残り未説明にならない", () => {
    const { result } = setup();

    act(() => result.current.setReason("会社概要を隠した。まだ内容が決まっていないから"));
    act(() => result.current.toggleSection("about", false));

    expect(useBuilderStore.getState().notes).toHaveLength(1);
    expect(result.current.unexplainedCount).toBe(0);
  });

  it("捨てると、いまのサイトを新しい基準にして、画面側へ知らせる回数を進める", () => {
    const { result } = setup();

    act(() => result.current.changeTheme("primary", "#e11d48"));
    act(() => result.current.addSection("gallery"));
    act(() => result.current.setReason("書きかけ"));
    const revision = result.current.revision;

    act(() => result.current.discard());

    expect(result.current.unexplainedCount).toBe(0);
    expect(result.current.pendingStructure).toHaveLength(0);
    expect(result.current.reason).toBe("");
    expect(result.current.revision).toBe(revision + 1);
  });
});

// 再読み込みを再現する。メモリ上の状態を起動直後の値へ戻してから、保存先から読み戻す。
// 状態を戻す操作も保存先へ書き込まれるため、戻す前の保存内容を取っておいて書き直す。
async function reload() {
  const storageKey = useBuilderStore.persist.getOptions().name!;
  const saved = localStorage.getItem(storageKey);
  const fresh = createSampleSite();
  useBuilderStore.setState({ site: fresh, notes: [], aiUsage: [] });
  useBuilderStore.getState().discardTracking();
  if (saved !== null) localStorage.setItem(storageKey, saved);
  await useBuilderStore.persist.rehydrate();
}

describe("再読み込みの前後(#116)", () => {
  it("未説明の変更・コード上の差分・入力中の理由が残り、そのまま記録できる", async () => {
    const first = setup();
    act(() => first.result.current.changeTheme("primary", "#e11d48"));
    act(() => useBuilderStore.getState().updateSection("about", { body: "書き換えた本文" }));
    act(() => first.result.current.addSection("gallery"));
    act(() => first.result.current.setReason("メインカラーを赤にした。元気な雰囲気を伝えたいから"));
    const before = {
      unexplainedCount: first.result.current.unexplainedCount,
      pendingStructure: first.result.current.pendingStructure,
      baselineHtml: buildSiteArtifacts(first.result.current.baselineSite).html,
      baselineCss: buildSiteArtifacts(first.result.current.baselineSite).css,
    };
    expect(before.unexplainedCount).toBe(3);
    first.unmount();

    await reload();
    const { result } = setup();

    expect(result.current.unexplainedCount).toBe(before.unexplainedCount);
    expect(result.current.pendingStructure).toEqual(before.pendingStructure);
    expect(result.current.reason).toBe("メインカラーを赤にした。元気な雰囲気を伝えたいから");
    // コード上の差分は基準のサイトと今のサイトの比較で出す。基準が編集後のサイトに
    // 置き換わっていないことを、出力されるコードで確かめる。
    expect(buildSiteArtifacts(result.current.baselineSite).html).toBe(before.baselineHtml);
    expect(buildSiteArtifacts(result.current.baselineSite).css).toBe(before.baselineCss);

    act(() => result.current.recordThemeReason());

    const [note] = useBuilderStore.getState().notes;
    expect(note.target).toBe("デザイン変更（メインカラーを #e11d48 に）");
    expect(note.codeChanges?.some((line) => line.includes("#e11d48"))).toBe(true);
    expect(result.current.unexplainedCount).toBe(2);
  });

  it("変更記録を持たない以前の保存内容は、保存されていたサイトを基準にして読み込む", async () => {
    const storageKey = useBuilderStore.persist.getOptions().name!;
    const savedSite = { ...createSampleSite(), siteTitle: "以前に保存したサイト" };
    localStorage.setItem(storageKey, JSON.stringify({
      state: { site: savedSite, selectedElementId: "hero", notes: [], aiUsage: [], chatMessages: [], conceptDraft: {}, conceptChoices: [] },
      version: 2,
    }));

    await useBuilderStore.persist.rehydrate();
    const { result } = setup();

    expect(useBuilderStore.getState().site.siteTitle).toBe("以前に保存したサイト");
    expect(result.current.unexplainedCount).toBe(0);
    expect(result.current.reason).toBe("");
  });

  it("保存されていた変更記録が壊れていても、画面を落とさずサイトを基準にして始め直す", async () => {
    const storageKey = useBuilderStore.persist.getOptions().name!;
    const savedSite = { ...createSampleSite(), siteTitle: "壊れた記録のサイト" };
    localStorage.setItem(storageKey, JSON.stringify({
      state: {
        site: savedSite,
        selectedElementId: "hero",
        notes: [],
        aiUsage: [],
        chatMessages: [],
        conceptDraft: {},
        conceptChoices: [],
        tracking: { reason: "書きかけ", touchedThemeKeys: ["no-such-key"], sectionBaselines: null },
      },
      version: 3,
    }));

    await useBuilderStore.persist.rehydrate();
    const { result } = setup();

    expect(useBuilderStore.getState().site.siteTitle).toBe("壊れた記録のサイト");
    expect(result.current.unexplainedCount).toBe(0);
    expect(result.current.reason).toBe("");
  });
});
