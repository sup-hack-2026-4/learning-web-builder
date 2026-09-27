import { type ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clerkConfig } from "@/features/auth/config";
import { clerkLocalization } from "@/features/auth/localization";

const queryClient = new QueryClient();

export function AppProviders({ children }: { children: ReactNode }) {
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return clerkConfig.enabled
    // ログイン画面やアカウントメニューはClerkが描画するため、ほかの画面と同じく日本語で表示させる。
    ? <ClerkProvider publishableKey={clerkConfig.publishableKey} localization={clerkLocalization}>{content}</ClerkProvider>
    : content;
}
