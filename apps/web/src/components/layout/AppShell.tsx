import type { PropsWithChildren } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { OfflineBanner, Badge } from "../ui";
import { useOnline } from "../../lib/hooks";
import { useMockMode } from "../../api/cinema-api";

export function AppShell({ children }: PropsWithChildren) {
  const online = useOnline();
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><Header />
    {!online ? <OfflineBanner /> : null}
    {useMockMode ? <div className="mock-banner"><Badge tone="accent">Demo mode</Badge><span>Using deterministic cinema data while the API is offline.</span></div> : null}
    <main id="main-content">{children}</main><Footer /></div>;
}
