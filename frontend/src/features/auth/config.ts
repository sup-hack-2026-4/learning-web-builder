const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export const clerkConfig = {
  enabled: clerkPublishableKey.length > 0,
  publishableKey: clerkPublishableKey,
};
