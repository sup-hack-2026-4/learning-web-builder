import { describe, expect, it } from "vitest";
import { resolveSelectedElementId } from "./resolve-selected-element";

describe("resolveSelectedElementId", () => {
  const iframeWindow = {} as Window;
  const otherWindow = {} as Window;

  it("正しい送信元・正しいメッセージ型からelementIdを取り出す", () => {
    const event = { source: iframeWindow, data: { type: "learning-builder:select", elementId: "hero" } };
    expect(resolveSelectedElementId(event, iframeWindow)).toBe("hero");
  });

  it("送信元が異なる場合はnullを返す(なりすまし対策)", () => {
    const event = { source: otherWindow, data: { type: "learning-builder:select", elementId: "hero" } };
    expect(resolveSelectedElementId(event, iframeWindow)).toBeNull();
  });

  it("メッセージ型が異なる場合はnullを返す", () => {
    const event = { source: iframeWindow, data: { type: "other", elementId: "hero" } };
    expect(resolveSelectedElementId(event, iframeWindow)).toBeNull();
  });

  it("elementIdが文字列でない場合はnullを返す", () => {
    const event = { source: iframeWindow, data: { type: "learning-builder:select", elementId: 123 } };
    expect(resolveSelectedElementId(event, iframeWindow)).toBeNull();
  });

  it("iframeがまだマウントされていない(expectedSourceがnull)場合はnullを返す", () => {
    const event = { source: iframeWindow, data: { type: "learning-builder:select", elementId: "hero" } };
    expect(resolveSelectedElementId(event, null)).toBeNull();
  });

  it("dataが不正な形でも例外を投げずnullを返す", () => {
    const event = { source: iframeWindow, data: null };
    expect(resolveSelectedElementId(event, iframeWindow)).toBeNull();
  });
});
