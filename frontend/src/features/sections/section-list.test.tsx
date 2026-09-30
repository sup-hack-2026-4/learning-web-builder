import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { useBuilderStore } from "@/features/site-model/store";
import { SectionList } from "./section-list";

function renderList(revision: number) {
  const tracking = { toggleSection: vi.fn(), addSection: vi.fn(), removeSection: vi.fn(() => true), revision };
  const props = { tracking, onEdit: vi.fn(), headingRef: createRef<HTMLHeadingElement>(), showNotice: vi.fn() };
  const view = render(<SectionList {...props} />);
  return { ...view, props };
}

beforeEach(() => {
  useBuilderStore.setState({ notes: [], aiUsage: [], site: createSampleSite(), selectedElementId: "hero" });
  // 前のテストの変更記録を持ち越さないよう、差し替えたサイトを基準にし直す。
  useBuilderStore.getState().discardTracking();
});

describe("SectionList", () => {
  it("削除ボタンを押すと、確認を開いて引き返す側のボタンへフォーカスを入れる", async () => {
    renderList(0);
    const [removeButton] = screen.getAllByRole("button", { name: /を削除$/ });

    await userEvent.click(removeButton);

    expect(screen.getByRole("button", { name: "やめる" })).toHaveFocus();
  });

  it("サイトが差し替わると（revisionが進むと）、開いていた削除の確認を閉じる", async () => {
    const { rerender, props } = renderList(0);
    const [removeButton] = screen.getAllByRole("button", { name: /を削除$/ });
    await userEvent.click(removeButton);
    expect(screen.getByText(/削除すると元に戻せません/)).toBeInTheDocument();

    rerender(<SectionList {...props} tracking={{ ...props.tracking, revision: 1 }} />);

    expect(screen.queryByText(/削除すると元に戻せません/)).not.toBeInTheDocument();
  });
});
