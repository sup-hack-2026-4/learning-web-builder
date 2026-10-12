import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("処理中は押せず、処理中であることを支援技術にも伝える", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>保存</Button>);

    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("処理中は、先頭のアイコンをスピナーに差し替える", () => {
    const { rerender } = render(<Button icon={<svg data-testid="icon" />}>保存</Button>);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");

    rerender(<Button icon={<svg data-testid="icon" />} loading>保存</Button>);
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });

  it("処理中でなければ、disabledの指定どおりに押せなくなる", () => {
    render(<Button disabled>保存</Button>);

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
