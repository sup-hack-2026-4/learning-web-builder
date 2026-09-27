import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { clerkLocalization } from "@/features/auth/localization";
import { AppProviders } from "./providers";

// ClerkProviderに渡した設定を取り出す。本物は外部のClerkへ通信するため使わない。
const clerkProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    clerkProps.current = props;
    return children;
  },
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
});
