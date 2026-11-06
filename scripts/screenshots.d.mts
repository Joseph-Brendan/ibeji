import type { Page, ScreenshotOptions } from "@playwright/test";

export const CREDENTIAL_MASK: "[credential masked]";

export function maskCredentials(page: Page): Promise<void>;

export function captureScreenshot(
  page: Page,
  path: string,
  options?: Omit<ScreenshotOptions, "path">,
): Promise<void>;
