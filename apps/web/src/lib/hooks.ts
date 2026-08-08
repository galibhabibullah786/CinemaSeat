import { useEffect, useMemo, useState } from "react";
import { formatCountdown } from "./format";

export interface CountdownState {
  seconds: number;
  expired: boolean;
  formatted: string;
  progress: number;
}

export function secondsUntil(expiresAt: string, now = Date.now()): number {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1_000));
}

/** Countdown derives from an absolute server timestamp on every tick. */
export function useCountdown(expiresAt?: string, totalSeconds = 300): CountdownState {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return useMemo(() => {
    if (!expiresAt) return { seconds: 0, expired: false, formatted: "—", progress: 1 };
    const end = Date.parse(expiresAt);
    if (!Number.isFinite(end)) return { seconds: 0, expired: false, formatted: "—", progress: 1 };
    const seconds = secondsUntil(expiresAt, now);
    return {
      seconds,
      expired: seconds <= 0,
      formatted: formatCountdown(seconds),
      progress: Math.min(1, Math.max(0, seconds / totalSeconds)),
    };
  }, [expiresAt, now, totalSeconds]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);
  return online;
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const handle = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);
  return visible;
}
