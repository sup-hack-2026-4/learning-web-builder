import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/api";

function BackendSessionStatus() {
  const { getToken, userId } = useAuth();
  const session = useQuery({
    queryKey: ["backend-session", userId],
    queryFn: () => getSession(getToken),
    retry: false,
  });

  if (session.isPending) {
    return <span className="text-xs text-slate-500">認証確認中…</span>;
  }
  if (session.isError || !session.data?.authenticated) {
    return <span className="text-xs font-bold text-red-600">API認証エラー</span>;
  }
  return <span className="text-xs font-bold text-emerald-700">ログイン中</span>;
}

export function AuthControls({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
        ゲストモード
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <SignedOut>
        <SignInButton mode="modal">
          <Button variant="secondary">ログイン</Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button variant="ghost">新規登録</Button>
        </SignUpButton>
      </SignedOut>
      <SignedIn>
        <BackendSessionStatus />
        <UserButton />
      </SignedIn>
    </div>
  );
}
