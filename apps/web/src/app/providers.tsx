import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { PropsWithChildren } from "react";
import { queryClient } from "./query-client";
import { ErrorBoundary } from "../components/ErrorBoundary";

export function Providers({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>{children}</ErrorBoundary>
      <Toaster position="top-right" theme="dark" richColors closeButton />
    </QueryClientProvider>
  );
}
