import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

type LayoutReport = {
  readonly viewportWidth: number;
  readonly scrollWidth: number;
  readonly problems: readonly string[];
};

export async function expectNoSeriousAxe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const details = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
          .join("\n")}`,
    )
    .join("\n\n");
  expect(violations, `${label}: serious or critical axe problems\n${details}`).toEqual([]);
}

export async function expectLayoutFits(page: Page, label: string): Promise<void> {
  const report = (await page.evaluate(`
    (() => {
      const viewportWidth = document.documentElement.clientWidth;
      const problems = [];
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const inScroller = (element) => {
        let parent = element.parentElement;
        while (parent !== null) {
          const style = getComputedStyle(parent);
          if ((style.overflowX === "auto" || style.overflowX === "scroll") && parent.getBoundingClientRect().right <= viewportWidth + 1) {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };
      const candidates = document.querySelectorAll(
        "main h1, main h2, main h3, main p, main button, main a, main label, main input, main select, main textarea, main .twin-badge, main .status-pill, main .delivery-card, main .failure-card, main .scenario-card, main .twin-card"
      );
      for (const element of candidates) {
        if (!visible(element) || inScroller(element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.left < -1 || rect.right > viewportWidth + 1) {
          problems.push(element.tagName + " outside viewport: " + (element.textContent || "").trim().slice(0, 60));
        }
      }
      const main = document.querySelector("main");
      if (main !== null) {
        const mainRect = main.getBoundingClientRect();
        if (mainRect.left < -1 || mainRect.right > viewportWidth + 1) {
          problems.push("main outside viewport");
        }
        const children = [...main.children].filter(visible);
        for (let left = 0; left < children.length; left += 1) {
          for (let right = left + 1; right < children.length; right += 1) {
            const a = children[left].getBoundingClientRect();
            const b = children[right].getBoundingClientRect();
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 2 && overlapY > 2) {
              problems.push(
                "sections overlap: " +
                  (children[left].textContent || "").trim().slice(0, 30) +
                  " / " +
                  (children[right].textContent || "").trim().slice(0, 30)
              );
            }
          }
        }
      }
      return {
        viewportWidth,
        scrollWidth: document.documentElement.scrollWidth,
        problems,
      };
    })()
  `)) as LayoutReport;

  expect(report.scrollWidth, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(
    report.viewportWidth + 1,
  );
  expect(report.problems, `${label}: layout problems`).toEqual([]);
}

export async function expectFontsLoaded(page: Page, label: string): Promise<void> {
  const result = (await page.evaluate(`
    (async () => {
      await document.fonts.ready;
      return {
        sans: document.fonts.check('16px "IBM Plex Sans"'),
        mono: document.fonts.check('16px "IBM Plex Mono"'),
        bodyFamily: getComputedStyle(document.body).fontFamily,
      };
    })()
  `)) as { readonly sans: boolean; readonly mono: boolean; readonly bodyFamily: string };

  expect(result.sans, `${label}: IBM Plex Sans did not load`).toBe(true);
  expect(result.mono, `${label}: IBM Plex Mono did not load`).toBe(true);
  expect(result.bodyFamily, `${label}: body font`).toContain("IBM Plex Sans");
}
