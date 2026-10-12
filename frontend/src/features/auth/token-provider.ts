import { createContext, useContext } from "react";
import type { TokenProvider } from "@/lib/api";

// ログイン機能のない環境（ゲストモード）ではトークンを付けない。
const guestTokenProvider: TokenProvider = async () => null;

/**
 * APIへ付けるトークンの取得関数を配る。
 *
 * ClerkのuseAuthはClerkProviderの中でしか呼べない。生成や相談はゲストモードでも動くため、
 * 直接useAuthを呼ばず、ここから受け取る。Clerkが有効なときだけAppProvidersが差し替える。
 */
export const TokenProviderContext = createContext<TokenProvider>(guestTokenProvider);

export function useTokenProvider(): TokenProvider {
  return useContext(TokenProviderContext);
}
