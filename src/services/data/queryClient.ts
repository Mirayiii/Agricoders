import { QueryClient } from "@tanstack/react-query";

/**
 * The one cache for server data (plan task 0.5). Screens read through
 * useQuery and write through useAppMutation, so later phases can add the
 * offline cache and outbox here without touching every screen.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Counts and lists change often; refetch when a screen regains focus, but
      // not on every render.
      staleTime: 30_000,
      retry: 1,
      // Keep loaded data for a month, so it can be shown offline (Phase 10).
      gcTime: 30 * 24 * 60 * 60 * 1000,
      // Offline, a refresh fails straight away instead of waiting: screens then
      // show the saved data with "Showing data saved at…", or say it couldn't
      // be loaded, rather than a spinner that never ends. They refresh again
      // when the connection returns.
      networkMode: "always",
    },
    // Changes never wait in React Query's own pause-while-offline queue: that
    // would send them later with no version checks. The four offline-safe
    // changes go through the outbox instead (Phase 10); everything else fails
    // straight away offline and says it needs a connection.
    mutations: { retry: 0, networkMode: "always" },
  },
});
