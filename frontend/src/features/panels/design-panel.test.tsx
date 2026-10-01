import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChangeTracking } from "@/features/change-tracking/use-change-tracking";
import { createSampleSite } from "@/features/site-model/sample";
import { useBuilderStore } from "@/features/site-model/store";
import { DesignPanel } from "./design-panel";

function Harness() {
  const tracking = useChangeTracking(vi.fn());
  return <DesignPanel tracking={tracking} selectedSectionHeadingRef={createRef()} />;
}

beforeEach(() => {
  useBuilderStore.setState({ site: createSampleSite(), selectedElementId: "about", notes: [], aiUsage: [] });
  useBuilderStore.getState().discardTracking();
});

describe("DesignPanel の入力欄(#117)", () => {
  it("見出しが上限を超えたら、欄の下に理由を出し、入力は止めない", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByRole("textbox", { name: "見出し" });

    await user.clear(title);
    await user.click(title);
    await user.paste("あ".repeat(81));

    // 入力そのものは反映する。見ながら削って直せるようにするため。
    expect(title).toHaveValue("あ".repeat(81));
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("見出しは80文字以内で入力してください（いま81文字）。");
    // エラー文は欄の名前には含めない。
    expect(title).toHaveAccessibleName("見出し");
  });

  it("見出しを空にしたら、入力するよう伝える", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByRole("textbox", { name: "見出し" });

    await user.clear(title);

    expect(title).toHaveAccessibleDescription("見出しを入力してください。");
  });

  it("見出しを空白だけにしても、入力するよう伝える", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByRole("textbox", { name: "見出し" });

    await user.clear(title);
    await user.type(title, " 　");

    expect(title).toHaveValue(" 　");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("見出しを入力してください。");
  });

  it("本文と画像の説明も、上限を超えたら理由を出す", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const body = screen.getByRole("textbox", { name: "本文" });
    const alt = screen.getByRole("textbox", { name: "画像の説明（alt）" });

    await user.clear(body);
    await user.click(body);
    await user.paste("あ".repeat(801));
    await user.clear(alt);
    await user.click(alt);
    await user.paste("あ".repeat(161));

    expect(body).toHaveAccessibleDescription("本文は800文字以内で入力してください（いま801文字）。");
    expect(alt).toHaveAccessibleDescription("画像の説明（alt）は160文字以内で入力してください（いま161文字）。");
  });

  it("上限内に直したら、エラーは消える", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const title = screen.getByRole("textbox", { name: "見出し" });

    await user.clear(title);
    await user.type(title, "活動紹介");

    expect(title).not.toHaveAttribute("aria-invalid");
    expect(title).not.toHaveAccessibleDescription();
  });
});
