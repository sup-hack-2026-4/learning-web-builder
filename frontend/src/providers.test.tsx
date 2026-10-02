import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { clerkLocalization } from "@/features/auth/localization";
import { useTokenProvider } from "@/features/auth/token-provider";
import type { TokenProvider } from "@/lib/api";
import { AppProviders } from "./providers";

// ClerkProviderに渡した設定を取り出す。本物は外部のClerkへ通信するため使わない。
const clerkProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
// Clerkが返すトークンの取得関数。配られたものがこれと同じかを確かめる。
const clerkGetToken = vi.hoisted(() => async () => "session-token");

vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    clerkProps.current = props;
    return children;
  },
  useAuth: () => ({ getToken: clerkGetToken }),
}));

vi.mock("@/features/auth/config", () => ({
  clerkConfig: { enabled: true, publishableKey: "pk_test_dummy" },
}));

describe("AppProviders", () => {
  it("Clerkのログイン画面やメニューを日本語で表示させる", () => {
    render(<AppProviders><p>中身</p></AppProviders>);

    expect(screen.getByText("中身")).toBeInTheDocument();
    expect(clerkProps.current?.localization).toBe(clerkLocalization);
  });

  it("Clerkのトークンの取得関数を、生成や相談からも使えるように配る(#120)", () => {
    let provided: TokenProvider | null = null;
    function Probe() {
      provided = useTokenProvider();
      return null;
    }

    render(<AppProviders><Probe /></AppProviders>);

    expect(provided).toBe(clerkGetToken);
  });
});
