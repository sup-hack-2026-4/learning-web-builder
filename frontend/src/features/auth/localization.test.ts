import { jaJP } from "@clerk/localizations";
import { describe, expect, it } from "vitest";
import { clerkLocalization } from "./localization";

describe("clerkLocalization", () => {
  it("Clerkの日本語辞書をもとにしている", () => {
    expect(clerkLocalization.locale).toBe(jaJP.locale);
    expect(clerkLocalization.signIn?.start?.title).toBe(jaJP.signIn?.start?.title);
  });

  it("ログインまわりのエラー文言に、訳の無いものを残さない", () => {
    // 訳が無いとサーバーの英語のエラー文がそのまま出る。組織機能はこのアプリで使っていない。
    // パスワードの強度のように、項目の中に文言がまとまっているものは奥までたどる。
    const findMissing = (entries: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(entries)
        .filter(([key]) => !key.startsWith("organization_"))
        .flatMap(([key, value]) => {
          if (value !== null && typeof value === "object") return findMissing(value as Record<string, unknown>, `${prefix}${key}.`);
          return typeof value === "string" && value.length > 0 ? [] : [`${prefix}${key}`];
        });

    expect(findMissing(clerkLocalization.unstable__errors ?? {})).toEqual([]);
  });

  it("補った文言は日本語で、Clerkの訳がある項目は上書きしない", () => {
    expect(clerkLocalization.unstable__errors?.form_password_incorrect).toContain("パスワード");
    expect(clerkLocalization.unstable__errors?.form_code_incorrect).toContain("確認コード");
    expect(clerkLocalization.unstable__errors?.form_password_pwned).toBe(jaJP.unstable__errors?.form_password_pwned);
  });
});
