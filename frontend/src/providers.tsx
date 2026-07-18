import { type ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function AppProviders({ children }: { children: ReactNode }) {
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return clerkKey ? <ClerkProvider publishableKey={clerkKey}>{content}</ClerkProvider> : content;
}
