import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";

describe("Callout", () => {
  it("toneがnullの間も要素を残し、見た目だけを消す", () => {
    // 中のライブリージョンが読み上げられるには、文言が入る前から同じ要素がDOMにある必要がある。
    const { rerender } = render(<Callout tone={null} className="p-9" data-testid="callout"><p role="status" /></Callout>);
    const before = screen.getByTestId("callout");
    expect(before).not.toHaveAttribute("class");

    rerender(<Callout tone="danger" className="p-9" data-testid="callout"><p role="status">保存できませんでした</p></Callout>);
    const after = screen.getByTestId("callout");
    expect(after).toBe(before);
    expect(after).toHaveClass("bg-danger-subtle", "p-9");
  });
});
