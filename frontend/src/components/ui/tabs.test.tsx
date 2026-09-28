import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "./tabs";

type Key = "a" | "b" | "c";

const items = [
  { key: "a", label: "一つ目" },
  { key: "b", label: "二つ目" },
  { key: "c", label: "三つ目" },
] as const;

function Harness() {
  const [value, setValue] = useState<Key>("a");
  return (
    <>
      <Tabs label="テスト" items={items} value={value} onValueChange={setValue} tabId={(key) => `tab-${key}`} panelId={() => "panel"} />
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${value}`}>{value}</div>
    </>
  );
}

describe("Tabs", () => {
  it("選択中のタブだけをTab順に含め、パネルと関連付ける", () => {
    render(<Harness />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-controls", "panel");
    expect(screen.getByRole("tabpanel", { name: "一つ目" })).toBeInTheDocument();
  });

  it("方向キーとHome/Endで、選択とフォーカスを一緒に動かす", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("tab", { name: "一つ目" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "二つ目" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "二つ目" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "三つ目" })).toHaveFocus();

    // 端から先へ進むと、先頭へ戻る。
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "一つ目" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "三つ目" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "一つ目" })).toHaveAttribute("aria-selected", "true");
  });
});
