import { useEffect, useState } from "react";

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useUrl(): string {
  const [url, setUrl] = useState(currentUrl);

  useEffect(() => {
    const update = (): void => setUrl(currentUrl());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  return url;
}

export function withTwin(path: string, twinId: string | undefined): string {
  if (twinId === undefined) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}twin=${encodeURIComponent(twinId)}`;
}

export function twinFromUrl(url: string): string | undefined {
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  return params.get("twin") ?? undefined;
}
