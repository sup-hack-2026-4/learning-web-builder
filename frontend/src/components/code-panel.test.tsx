import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { CodePanel } from "./code-panel";

// jsdomは要素のscrollToを持たない。選んだ行への自動スクロールはこのテストの対象ではない。
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

describe("CodePanel", () => {
  it("未記録の変更と選んだ要素の行を、色だけでなく読み上げ用の文字でも示す", async () => {
    const baselineSite = createSampleSite();
    const site = { ...baselineSite, theme: { ...baselineSite.theme, primary: "#e11d48" } };
    render(<CodePanel site={site} baselineSite={baselineSite} selectedElementId="hero" />);
    await userEvent.click(screen.getByRole("tab", { name: "style.css" }));

    const rows = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    const changedRow = rows.find((row) => row.dataset.changed === "true" && row.textContent?.includes("--primary:"));
    const selectedRow = rows.find((row) => row.dataset.selected === "true" && row.dataset.changed === "false");
    const plainRow = rows.find((row) => row.dataset.selected === "false" && row.dataset.changed === "false");

    expect(changedRow).toHaveTextContent(/^\d+\+>?未記録の変更(・選んだ要素)?の行: /);
    expect(selectedRow).toHaveTextContent(/^\d+>選んだ要素の行: /);
    expect(plainRow?.textContent).not.toMatch(/未記録の変更|選んだ要素/);
  });

  it("行の状態を、色だけでなく行番号の横の記号でも示し、凡例に同じ記号を出す", async () => {
    const baselineSite = createSampleSite();
    const site = { ...baselineSite, theme: { ...baselineSite.theme, primary: "#e11d48" } };
    render(<CodePanel site={site} baselineSite={baselineSite} selectedElementId="hero" />);
    await userEvent.click(screen.getByRole("tab", { name: "style.css" }));

    const rows = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    const changedRow = rows.find((row) => row.dataset.changed === "true" && row.dataset.selected === "false");
    const selectedRow = rows.find((row) => row.dataset.selected === "true" && row.dataset.changed === "false");
    const plainRow = rows.find((row) => row.dataset.selected === "false" && row.dataset.changed === "false");
    const removedRow = rows.find((row) => row.textContent?.includes("削除された行: "));

    expect(changedRow?.textContent).toMatch(/^\d+\+未記録の変更/);
    expect(selectedRow?.textContent).toMatch(/^\d+>選んだ要素/);
    expect(plainRow?.textContent).not.toMatch(/^\d+[+>-]/);
    expect(removedRow?.textContent).toMatch(/^-削除された行: /);

    const legend = screen.getByRole("region", { name: "生成されたコード" });
    expect(legend).toHaveTextContent(/>\s*選んだ要素: /);
    expect(legend).toHaveTextContent(/\+\s*未記録の変更/);
    expect(legend).toHaveTextContent(/-\s*うち削除/);
  });

  it("変更した行が選んだ要素の行でもあるときは、両方の状態を伝える", () => {
    const baselineSite = createSampleSite();
    const site = {
      ...baselineSite,
      sections: baselineSite.sections.map((section) =>
        section.id === "hero" ? { ...section, title: "書き換えた見出し" } : section,
      ),
    };
    render(<CodePanel site={site} baselineSite={baselineSite} selectedElementId="hero" />);

    const rows = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    const bothRow = rows.find((row) => row.textContent?.includes("書き換えた見出し"));

    expect(bothRow).toHaveAttribute("data-changed", "true");
    expect(bothRow).toHaveAttribute("data-selected", "true");
    expect(bothRow).toHaveTextContent(/^\d+\+>未記録の変更・選んだ要素の行: /);
  });
});
