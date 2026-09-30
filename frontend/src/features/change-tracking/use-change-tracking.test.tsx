import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { createSampleSite } from "@/features/site-model/sample";
import { maxSections, minSections } from "@/features/site-model/sections";
import { captureSiteGeneration, onPersistFailure, useBuilderStore, withSectionValues } from "@/features/site-model/store";
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
    // 起動時の初期サンプルが基準に残ると、保存されていたテーマや本文の違いが未説明の変更として現れる。
    const storageKey = useBuilderStore.persist.getOptions().name!;
    const sample = createSampleSite();
    const savedSite = {
      ...sample,
      theme: { ...sample.theme, primary: "#123456" },
      sections: sample.sections.map((section) => (section.id === "about" ? { ...section, body: "以前に書いた本文" } : section)),
    };
    localStorage.setItem(storageKey, JSON.stringify({
      state: { site: savedSite, selectedElementId: "hero", notes: [], aiUsage: [], chatMessages: [], conceptDraft: {}, conceptChoices: [] },
      version: 2,
    }));

    await useBuilderStore.persist.rehydrate();
    const { result } = setup();

    expect(useBuilderStore.getState().site).toEqual(savedSite);
    expect(result.current.baselineSite).toEqual(savedSite);
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

describe("サイトの変更と記録の一致", () => {
  it("同じ描画の中で追加を続けても、実際に追加できた分だけを構成の変更として数える", () => {
    const { result } = setup();
    const before = useBuilderStore.getState().site.sections.length;

    act(() => {
      for (let index = 0; index < 5; index += 1) result.current.addSection("gallery");
    });

    const sections = useBuilderStore.getState().site.sections;
    expect(sections).toHaveLength(maxSections);
    expect(result.current.pendingStructure).toHaveLength(maxSections - before);
  });

  it("同じ描画の中で削除を続けても、下限で消せなかったセクションは削除済みとして扱わない", () => {
    const { result } = setup();
    const targets = useBuilderStore.getState().site.sections.slice(0, 3);

    const removed: boolean[] = [];
    act(() => {
      for (const section of targets) removed.push(result.current.removeSection(section));
    });

    const remainingIds = useBuilderStore.getState().site.sections.map((section) => section.id);
    expect(remainingIds).toHaveLength(minSections);
    expect(removed.filter(Boolean)).toHaveLength(targets.length - 1);
    expect(result.current.pendingStructure).toHaveLength(targets.length - 1);
    // 残ったセクションの内容の基準は消えていない。
    for (const id of remainingIds) {
      expect(useBuilderStore.getState().tracking.sectionBaselines[id]).toBeDefined();
    }
  });

  it("ブラウザへの保存に失敗しても、サイトと記録はそろったまま進み、失敗は1回だけ知らせる", () => {
    const { result } = setup();
    const onFailure = vi.fn();
    const unsubscribe = onPersistFailure(onFailure);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量を超えました", "QuotaExceededError");
    });
    const before = useBuilderStore.getState().site.sections.length;

    try {
      act(() => result.current.addSection("gallery"));
      act(() => result.current.setReason("写真で雰囲気を伝えたい"));

      expect(useBuilderStore.getState().site.sections).toHaveLength(before + 1);
      expect(result.current.pendingStructure).toHaveLength(1);
      expect(result.current.unexplainedCount).toBe(1);
      expect(result.current.reason).toBe("写真で雰囲気を伝えたい");
      expect(onFailure).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
      unsubscribe();
    }
    // 書けるようになれば、次の変更で改めて保存される。
    act(() => result.current.setReason("写真で雰囲気を伝えたいから"));
    expect(localStorage.getItem(useBuilderStore.persist.getOptions().name!)).toContain("写真で雰囲気を伝えたいから");
  });
});

describe("別のタブとの同期", () => {
  it("別のタブが下書きを書き換えたら、その内容を読み込み直す", async () => {
    const { result } = setup();
    const storageKey = useBuilderStore.persist.getOptions().name!;
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? {
      state: useBuilderStore.persist.getOptions().partialize!(useBuilderStore.getState()),
      version: 3,
    };
    // 別のタブで本文を書き換えた状態を、保存先へ直接書き込む。
    const otherSite = withSectionValues(useBuilderStore.getState().site, "about", { body: "別のタブで書いた本文" });
    const newValue = JSON.stringify({ ...saved, state: { ...saved.state, site: otherSite } });
    localStorage.setItem(storageKey, newValue);

    const generation = useBuilderStore.getState().siteGeneration;

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue, storageArea: localStorage }));
    });

    await vi.waitFor(() => expect(sectionOf("about").body).toBe("別のタブで書いた本文"));
    // 同じ作品の編集なので、作業は切り替わっていない。
    expect(useBuilderStore.getState().siteGeneration).toBe(generation);
    // このタブで理由を書いても、別のタブの本文を古い内容で上書きしない。
    act(() => result.current.setReason("会社概要を書き直した"));
    expect(localStorage.getItem(storageKey)).toContain("別のタブで書いた本文");
  });

  // 別のタブが書き込んだ保存内容を、このタブへ届ける。
  function receiveFromOtherTab(changes: Record<string, unknown>) {
    const storageKey = useBuilderStore.persist.getOptions().name!;
    const state = useBuilderStore.persist.getOptions().partialize!(useBuilderStore.getState()) as Record<string, unknown>;
    const newValue = JSON.stringify({ state: { ...state, tracking: undefined, ...changes }, version: 3 });
    localStorage.setItem(storageKey, newValue);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue, storageArea: localStorage }));
    });
  }

  it("別のタブで別の作品に差し替わったら、このタブでも作業が切り替わったものとして扱う", async () => {
    // 世代を進めないと、このタブの保存先のプロジェクトが前の作品のまま残り、
    // 別のタブの作品で前のプロジェクトを上書きしてしまう(#115)。
    setup();
    const otherSite = createSampleSite("別のタブで生成した題材");
    const isCurrent = captureSiteGeneration();

    receiveFromOtherTab({ site: otherSite, workspaceId: crypto.randomUUID(), siteOrigin: "generated" });

    await vi.waitFor(() => expect(useBuilderStore.getState().site.id).toBe(otherSite.id));
    expect(isCurrent()).toBe(false);
    expect(useBuilderStore.getState().siteOrigin).toBe("generated");
  });

  it("サイトのidが同じ別のプロジェクトを別のタブで読み込んでも、作業が切り替わったと分かる", async () => {
    // 「新しいプロジェクト」として保存し直すとサイトのidは変わらないため、別々のプロジェクトが同じidを持ちうる。
    setup();
    const sameIdSite = { ...useBuilderStore.getState().site, siteTitle: "別のプロジェクト" };
    const isCurrent = captureSiteGeneration();

    receiveFromOtherTab({ site: sameIdSite, workspaceId: crypto.randomUUID(), siteOrigin: "project" });

    await vi.waitFor(() => expect(useBuilderStore.getState().site.siteTitle).toBe("別のプロジェクト"));
    expect(isCurrent()).toBe(false);
  });

  it("別のタブでリセットしたら、読み込み済みの作品として扱わない", async () => {
    setup();
    act(() => useBuilderStore.getState().loadSite(createSampleSite("読み込んだ作品"), { notes: [], aiUsage: [] }));
    expect(useBuilderStore.getState().siteOrigin).toBe("project");

    receiveFromOtherTab({ site: createSampleSite(), workspaceId: crypto.randomUUID(), siteOrigin: "sample", aiUsage: [] });

    await vi.waitFor(() => expect(useBuilderStore.getState().siteOrigin).toBe("sample"));
  });
});
