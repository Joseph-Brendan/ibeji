import { CREDENTIAL_MASK, maskCredentials } from "../../scripts/screenshots.mjs";
import { expect, test } from "./fixtures.js";

test("D50 screenshot masking leaves no credential value on the page", async ({
  dashboard,
  ibejiSession,
}) => {
  await expect(dashboard.locator("[data-credential-value]").first()).toBeVisible();

  const values = Object.values(ibejiSession.session.credentials).flatMap((twin) =>
    Object.values(twin),
  );
  expect(values.length).toBeGreaterThan(0);

  const before = (await dashboard.locator("body").textContent()) ?? "";
  for (const value of values) {
    expect(before, "the page must show the credential before masking").toContain(value);
  }

  await maskCredentials(dashboard);

  const after = (await dashboard.locator("body").textContent()) ?? "";
  for (const value of values) {
    expect(after, "the masked page must not contain a credential").not.toContain(value);
  }
  const masked = await dashboard.locator("[data-credential-value]").allTextContents();
  expect(masked.length).toBeGreaterThan(0);
  expect(new Set(masked)).toEqual(new Set([CREDENTIAL_MASK]));
});
