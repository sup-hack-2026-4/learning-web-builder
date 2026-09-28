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

    expect(changedRow).toHaveTextContent(/^\d*未記録の変更(・選んだ要素)?の行: /);
    expect(selectedRow).toHaveTextContent(/^\d*選んだ要素の行: /);
    expect(plainRow?.textContent).not.toMatch(/未記録の変更|選んだ要素/);
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
    expect(bothRow).toHaveTextContent(/^\d*未記録の変更・選んだ要素の行: /);
  });
});
