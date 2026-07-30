import { type ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clerkConfig } from "@/features/auth/config";

const queryClient = new QueryClient();

export function AppProviders({ children }: { children: ReactNode }) {
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return clerkConfig.enabled
    ? <ClerkProvider publishableKey={clerkConfig.publishableKey}>{content}</ClerkProvider>
    : content;
}
