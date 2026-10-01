import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopicForm } from "./topic-form";
import type { SiteGeneration } from "./use-site-generation";

function generationWith(topic: string, topicError: string | null): SiteGeneration {
  return { topic, setTopic: vi.fn(), topicError, submitTopic: vi.fn(), generateFromConcept: vi.fn(), isPending: false };
}

describe("TopicForm(#117)", () => {
  it("題材が上限を超えていたら、欄の下に理由を出し、生成ボタンを押せなくする", () => {
    const message = "題材は100文字以内で入力してください（いま101文字）。";
    render(<TopicForm generation={generationWith("あ".repeat(101), message)} />);

    const topic = screen.getByRole("textbox", { name: "紹介サイトの題材" });
    expect(topic).toHaveAttribute("aria-invalid", "true");
    expect(topic).toHaveAccessibleDescription(message);
    expect(screen.getByRole("button", { name: "たたき台を生成" })).toBeDisabled();
  });

  it("上限内なら、エラーを出さずに生成できる", () => {
    render(<TopicForm generation={generationWith("地域の小さな植物園", null)} />);

    const topic = screen.getByRole("textbox", { name: "紹介サイトの題材" });
    expect(topic).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "たたき台を生成" })).toBeEnabled();
  });
});
