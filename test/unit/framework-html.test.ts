import { describe, expect, it } from "vitest";

import { renderCheckoutPage } from "../../src/twins/framework/html.js";
import { fakeTwinDefinition } from "../fixtures/fake-twin/definition.js";

describe("T14 shared checkout renderer", () => {
  it("T14 renders an authentication outcome and no optional email", () => {
    const html = renderCheckoutPage(
      {
        twinDisplayName: "Fake <Twin>",
        amountMinor: 1_000,
        currency: "USD",
        reference: "ref-1",
        outcomes: [
          {
            id: "check",
            label: "Check",
            description: "Needs a check",
            authentication: { approveLabel: "Approve", failLabel: "Fail" },
          },
        ],
        failureNotice: "A rule changed this.",
      },
      fakeTwinDefinition.money,
    );

    expect(html).toContain("Fake &lt;Twin&gt;");
    expect(html).toContain("Approve");
    expect(html).toContain("Fail");
    expect(html).toContain("check|approve");
    expect(html).toContain("A rule changed this.");
    expect(html).not.toContain("Customer");
  });
});
