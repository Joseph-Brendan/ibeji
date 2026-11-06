import { expect, test } from "./fixtures.js";

test("D44 the UI cookie keeps its /_ibeji path and another loopback port receives no cookie", async ({
  dashboard,
  ibejiSession,
  receiver,
}) => {
  const controlUrl = ibejiSession.session.addresses.control.url;
  expect(new URL(ibejiSession.session.launchLink).pathname).toBe("/_ibeji/");
  await dashboard.goto(controlUrl);
  await expect(dashboard).toHaveURL(`${controlUrl}/_ibeji/`);
  await expect(dashboard.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  const cookies = await dashboard.context().cookies();
  const uiCookie = cookies.find((cookie) => cookie.name === "ibeji_ui");
  expect(uiCookie).toBeDefined();
  expect(uiCookie?.path).toBe("/_ibeji");
  expect(uiCookie?.httpOnly).toBe(true);
  expect(uiCookie?.sameSite).toBe("Strict");

  await dashboard.evaluate(`(() => {
    const link = document.createElement("a");
    link.href = ${JSON.stringify(receiver.url)};
    link.id = "other-loopback-port";
    link.textContent = "Other local server";
    document.body.append(link);
    link.click();
  })()`);

  const request = await receiver.waitForRequest((item) => item.path === "/", 10_000);
  await expect(dashboard.getByText("Local test receiver")).toBeVisible();
  expect(request.headers.cookie).toBeUndefined();
});
