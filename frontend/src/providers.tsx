import { type ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clerkConfig } from "@/features/auth/config";
import { clerkLocalization } from "@/features/auth/localization";
import { TokenProviderContext } from "@/features/auth/token-provider";

const queryClient = new QueryClient();

// ログイン中のユーザーのトークンを、保存以外のAPI（生成・相談）からも使えるようにする。
// 付けないと、ログインしていても回数制限がIP単位になり、同じ回線の全員で分け合うことになる(#120)。
function ClerkTokenProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  return <TokenProviderContext.Provider value={getToken}>{children}</TokenProviderContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return clerkConfig.enabled
    // ログイン画面やアカウントメニューはClerkが描画するため、ほかの画面と同じく日本語で表示させる。
    ? (
      <ClerkProvider publishableKey={clerkConfig.publishableKey} localization={clerkLocalization}>
        <ClerkTokenProvider>{content}</ClerkTokenProvider>
      </ClerkProvider>
    )
    : content;
}
