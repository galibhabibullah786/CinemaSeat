import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(300 * 2 ** attempt, 1_200),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
