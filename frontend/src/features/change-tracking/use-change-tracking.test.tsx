import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
