import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { CodePanel } from "./code-panel";

// jsdomは要素のscrollToを持たない。選んだ行への自動スクロールはこのテストの対象ではない。
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

// 読み上げに渡る文字。行番号と記号はaria-hiddenなので除く。
function spokenText(row: HTMLElement) {
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[aria-hidden]").forEach((node) => node.remove());
  return clone.textContent ?? "";
}

// 目には見えるが読み上げない文字。行番号と記号をつなげたもの。
function shownOnlyText(row: HTMLElement) {
  return [...row.querySelectorAll("[aria-hidden]")].map((node) => node.textContent ?? "").join("");
}

// 読み上げ専用の文字。画面には出さない。
function screenReaderOnlyText(row: HTMLElement) {
  return row.querySelector(".sr-only")?.textContent ?? "";
}

function renderWithChangedColor() {
  const baselineSite = createSampleSite();
  const site = { ...baselineSite, theme: { ...baselineSite.theme, primary: "#e11d48" } };
  render(<CodePanel site={site} baselineSite={baselineSite} selectedElementId="hero" />);
}

function codeRows() {
  return within(screen.getByRole("tabpanel")).getAllByRole("listitem");
}

describe("CodePanel", () => {
  it("未記録の変更と選んだ要素の行を、色だけでなく読み上げ用の文字でも示す", async () => {
    renderWithChangedColor();
    await userEvent.click(screen.getByRole("tab", { name: "style.css" }));

    const rows = codeRows();
    const changedRow = rows.find((row) => row.dataset.changed === "true" && row.dataset.selected === "false")!;
    const selectedRow = rows.find((row) => row.dataset.selected === "true" && row.dataset.changed === "false")!;
    const plainRow = rows.find((row) => row.dataset.selected === "false" && row.dataset.changed === "false")!;
    const removedRow = rows.find((row) => row.textContent?.includes("削除された行: "))!;

    expect(spokenText(changedRow)).toMatch(/^未記録の変更の行: /);
    expect(spokenText(selectedRow)).toMatch(/^選んだ要素の行: /);
    expect(spokenText(plainRow)).not.toMatch(/未記録の変更|選んだ要素|削除された行/);
    expect(spokenText(removedRow)).toMatch(/^削除された行: /);

    // 状態を伝える文字は読み上げ専用で、画面には出さない。
    expect(screenReaderOnlyText(changedRow)).toBe("未記録の変更の行: ");
    expect(screenReaderOnlyText(selectedRow)).toBe("選んだ要素の行: ");
    expect(screenReaderOnlyText(removedRow)).toBe("削除された行: ");
    expect(screenReaderOnlyText(plainRow)).toBe("");
  });

  it("行の状態を、色だけでなく行番号の横の記号でも示し、記号は読み上げない", async () => {
    renderWithChangedColor();
    await userEvent.click(screen.getByRole("tab", { name: "style.css" }));

    const rows = codeRows();
    const changedRow = rows.find((row) => row.dataset.changed === "true" && row.dataset.selected === "false")!;
    const selectedRow = rows.find((row) => row.dataset.selected === "true" && row.dataset.changed === "false")!;
    const plainRow = rows.find((row) => row.dataset.selected === "false" && row.dataset.changed === "false")!;
    const removedRow = rows.find((row) => row.textContent?.includes("削除された行: "))!;

    expect(shownOnlyText(changedRow)).toMatch(/^\d+\+$/);
    expect(shownOnlyText(selectedRow)).toMatch(/^\d+>$/);
    expect(shownOnlyText(plainRow)).toMatch(/^\d+$/);
    // 消えた行には行番号が無い。
    expect(shownOnlyText(removedRow)).toBe("-");
  });

  it("凡例に、行と同じ記号を出す", async () => {
    renderWithChangedColor();
    await userEvent.click(screen.getByRole("tab", { name: "style.css" }));

    const panel = screen.getByRole("region", { name: "生成されたコード" });
    expect(panel).toHaveTextContent(/>\s*選んだ要素: /);
    expect(panel).toHaveTextContent(/\+\s*未記録の変更/);
    expect(panel).toHaveTextContent(/-\s*うち削除/);
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

    const bothRow = codeRows().find((row) => row.textContent?.includes("書き換えた見出し"))!;

    expect(bothRow).toHaveAttribute("data-changed", "true");
    expect(bothRow).toHaveAttribute("data-selected", "true");
    expect(spokenText(bothRow)).toMatch(/^未記録の変更・選んだ要素の行: /);
    expect(shownOnlyText(bothRow)).toMatch(/^\d+\+>$/);
  });
});
