import { useEffect, useState } from "react";

export const UI_BASE_PATH = "/_ibeji";

export function pagePath(pathname: string): string {
  if (pathname === UI_BASE_PATH || pathname === `${UI_BASE_PATH}/`) {
    return "/";
  }
  if (pathname.startsWith(`${UI_BASE_PATH}/`)) {
    return pathname.slice(UI_BASE_PATH.length);
  }
  return pathname;
}

export function hrefFor(path: string): string {
  if (path === UI_BASE_PATH || path.startsWith(`${UI_BASE_PATH}/`)) {
    return path;
  }
  if (path === "/") {
    return `${UI_BASE_PATH}/`;
  }
  return `${UI_BASE_PATH}${path}`;
}

function currentUrl(): string {
  return `${pagePath(window.location.pathname)}${window.location.search}`;
}

export function navigate(to: string): void {
  window.history.pushState(null, "", hrefFor(to));
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
