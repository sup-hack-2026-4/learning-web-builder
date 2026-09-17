import { describe, expect, it } from "vitest";
import { countPassedAspects, evaluateReason, type ReasonAspect } from "./evaluate-reason";

function passedAspects(reason: string): ReasonAspect[] {
  return evaluateReason(reason).filter((check) => check.passed).map((check) => check.id);
}

describe("evaluateReason", () => {
  it("何を・なぜ・どう良くなるかがそろった理由は3つとも満たす", () => {
    const reason = "見出しの色を濃くした。背景とのコントラストが弱いと読みにくいから";
    expect(passedAspects(reason)).toEqual(["target", "cause", "effect"]);
  });

  it("変えた部分だけを書いた理由は「何を変えたか」しか満たさない", () => {
    expect(passedAspects("メインカラーを赤に変更")).toEqual(["target"]);
  });

  it("根拠のない感想だけの理由はどれも満たさない", () => {
    expect(passedAspects("なんとなく")).toEqual([]);
    expect(passedAspects("かっこいい")).toEqual([]);
  });

  it("空欄は何も満たさない", () => {
    expect(countPassedAspects(evaluateReason(""))).toBe(0);
    expect(countPassedAspects(evaluateReason("   "))).toBe(0);
  });

  it("読み手への効果を書いていれば「どう良くなるか」を満たす", () => {
    expect(passedAspects("文章が読みやすくなる")).toContain("effect");
    expect(passedAspects("大事な部分を目立たせる")).toContain("effect");
  });

  it("直す前の問題として書いた場合も「どう良くなるか」を満たす", () => {
    expect(passedAspects("背景との差が小さいと読みにくい")).toContain("effect");
    expect(passedAspects("文字が小さくて見にくかった")).toContain("effect");
  });

  it("根拠の言い回しが違っても「なぜ変えるか」を満たす", () => {
    for (const reason of ["余白が狭いため", "余白が狭いので", "余白を広げたい", "余白を広げるように"]) {
      expect(passedAspects(reason)).toContain("cause");
    }
  });

  it("満たしていない観点には書き足しかたの案内が付く", () => {
    const checks = evaluateReason("赤にした");
    const effect = checks.find((check) => check.id === "effect");
    expect(effect?.passed).toBe(false);
    expect(effect?.hint).not.toBe("");
  });

  it("観点の並び順は画面表示のために固定する", () => {
    expect(evaluateReason("").map((check) => check.id)).toEqual(["target", "cause", "effect"]);
  });
});
