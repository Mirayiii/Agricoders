import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/features/auth";
import { OfflineProvider } from "@/services/offline/OfflineProvider";
import { queryClient } from "./queryClient";

// Refetch stale queries when the app comes back to the foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));
}

/** Cached data belongs to one account: clear it whenever the signed-in user changes. */
function ClearOnAccountChange() {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const previous = useRef(userId);
  useEffect(() => {
    if (previous.current !== userId) queryClient.clear();
    previous.current = userId;
  }, [userId]);
  return null;
}

export function DataProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ClearOnAccountChange />
      <OfflineProvider>{children}</OfflineProvider>
    </QueryClientProvider>
  );
}
