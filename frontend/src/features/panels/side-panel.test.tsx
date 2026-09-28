import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidePanel } from "./side-panel";

function renderPanel(hasQualityIssue: boolean) {
  return render(
    <SidePanel
      activePanel="design"
      onActivePanelChange={vi.fn()}
      panelOpen
      onPanelOpenChange={vi.fn()}
      hasQualityIssue={hasQualityIssue}
      nextToDo={{ title: "たたき台を作る", detail: "" }}
    >
      <p>中身</p>
    </SidePanel>,
  );
}

describe("SidePanel", () => {
  it("品質に問題があると、赤い点に加えてタブ名で「問題あり」を伝える", () => {
    renderPanel(true);
    expect(screen.getByRole("tab", { name: "品質（問題あり）" })).toBeInTheDocument();
  });

  it("問題が無ければ、タブ名は「品質」のまま", () => {
    renderPanel(false);
    expect(screen.getByRole("tab", { name: "品質" })).toBeInTheDocument();
  });
});
