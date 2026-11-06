# CLI

The Ibeji command is `ibeji`. In a source checkout before the package is installed, run `pnpm build` and use `node dist/cli.js` in place of `ibeji`.

Every command has `--help` with a real example. Every command that prints data supports `--json`. Exit codes are:

- `0`: success.
- `1`: an error.
- `2`: bad usage, such as an unknown option.

Commands other than `start`, `keys`, `mcp` and `doctor` need a running session. If none is running, the command says so and tells you to run `ibeji start`.

The examples below were run against a real local session with the packed package installed. The keys and ports are shortened or examples; your values will differ.

## `ibeji start`

Starts the twins, the control API and the dashboard. It prints each twin's base URL, test keys, webhook URL, the seed and the dashboard link.

```bash
ibeji start
```

Run only one twin and do not open a browser:

```bash
ibeji start --twins paystack --no-open
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--twins <ids>` | Comma-separated twin ids. Default: all registered twins. |
| `--port <n>` | Control API port. Default: 4400. |
| `--twin-port <twin>=<n>` | Twin port. Repeat for more than one twin. |
| `--seed <n>` | Whole number from 0 to 4294967295. The seed makes random choices repeatable. |
| `--scenario <id>` | Run a scenario after the session starts. |
| `--no-open` | Do not open the dashboard in a browser. |
| `--allow-private-webhooks` | Allow private network webhook addresses. |
| `--allow-public-webhooks` | Allow public webhook addresses, with a warning. |
| `--config <file>` | Use this config file instead of `ibeji.config.json`. |
| `--json` | Print one JSON object. |

Example output, shortened:

```text
Ibeji is running.

Paystack
  Base URL: http://127.0.0.1:4401
  Public key: pk_test_ibeji_...
  Secret key: sk_test_ibeji_...
  Webhook URL: not set

Flutterwave
  Base URL: http://127.0.0.1:4402
  Public key: FLWPUBK_TEST-ibeji-...
  Secret key: FLWSECK_TEST-ibeji-...
  Webhook secret hash: ibeji_...
  Webhook URL: not set

Seed: 1651293942
Dashboard link:
  http://127.0.0.1:4400/_ibeji/?launch=...

Open a new dashboard link with: ibeji open
Stop with: Control and C
```

## `ibeji open`

Prints a fresh dashboard link and opens it. A launch link works once. Use this if the first link expired or you closed the tab.

```bash
ibeji open --no-open
```

`--no-open` prints the link without opening a browser. The output is the dashboard link.

## `ibeji status`

Shows what is running, the seed and every active failure rule.

```bash
ibeji status
```

Example output:

```text
Ibeji is running.
Version: 0.0.0
Seed: 1549984721
Started: 2026-11-05T20:14:46.443Z
Scenario: none

Twins:
Paystack: http://127.0.0.1:52588
Flutterwave: not running

Active rules: 0
```

Add `--json` for a machine-readable object.

## `ibeji fail`

Switches on a failure. Settings are flags named after the failure's settings.

```bash
ibeji fail slow-response --seconds 8 --twin paystack
```

Example output:

```text
Added the Slow response failure.
Rule rule-1: slow-response
  Twins: paystack. Actions: all supported. Settings: seconds=8.
```

Use `--on` to choose a resource or action. This example delays only refund webhooks:

```bash
ibeji fail webhook-delayed --seconds 90 --twin flutterwave --on refund
```

The failure list and every setting are in [the failure library](failures.md). Run `ibeji fail --help` to see the failure names. An unsupported failure for a twin is refused with a clear error.

## `ibeji clear`

Removes one failure's rules, or every rule. It also stops a running scenario.

```bash
ibeji clear webhook-delayed --twin paystack
```

Remove every rule:

```bash
ibeji clear
```

Use `--twin` to clear only one twin. The output says how many rules were removed.

## `ibeji scenario list`

Lists every built-in scenario, its story, its twins and whether it is running.

```bash
ibeji scenario list
```

Example output, shortened:

```text
Slow Friday (slow-friday)
  Twins: paystack, flutterwave. Running: no.
  Amina runs Amina Fashion, a clothing shop in Abuja. Her Friday sale brings a
  rush of orders. The payment service answers slowly and webhooks arrive one
  to three minutes late. Her app must keep every order correct while customers
  wait.
```

## `ibeji scenario run`

Runs one scenario. The default is every supported twin that is running.

```bash
ibeji scenario run slow-friday --twin paystack
```

Example output:

```text
Started Slow Friday.
Twins: paystack.
```

A scenario switches on its failures. Open **Failures** to see the exact rules, or **Scenarios** to see progress and a Stop button.

## `ibeji scenario stop`

Stops the running scenario and removes its rules.

```bash
ibeji scenario stop
```

Example output:

```text
Scenario stopped.
```

## `ibeji webhook-url`

Shows or sets where one twin sends webhooks.

Show the current URL:

```bash
ibeji webhook-url paystack
```

Set a URL:

```bash
ibeji webhook-url paystack http://127.0.0.1:3000/webhook
```

Clear it:

```bash
ibeji webhook-url paystack --clear
```

Example output:

```text
Paystack webhook URL: http://127.0.0.1:3000/webhook
```

The address rules are in [Safety](safety.md). By default Ibeji sends only to this computer.

## `ibeji keys`

Prints the stored test credentials. This command works without a running session.

```bash
ibeji keys paystack
```

Example output:

```text
Paystack credentials
  Public key: pk_test_ibeji_...
  Secret key: sk_test_ibeji_...
```

Rotate one twin's keys:

```bash
ibeji keys paystack --rotate
```

The old keys stop working. Update your app with the new keys. Rotate all twins by leaving out the twin id. Add `--json` for all credentials in one object.

These are fake test keys. Never put a live key in test settings.

## `ibeji events`

Prints the newest events. Add `--twin` to show one twin and `--json` for one JSON object.

```bash
ibeji events --twin paystack --json
```

Example output, shortened:

```json
{"events":[{"id":1,"type":"rule-added","scope":"paystack","summary":"Added the slow-response failure rule."}]}
```

Follow new events until you press Control and C:

```bash
ibeji events --follow --twin paystack
```

Example output while following:

```text
#8 2026-11-05T20:15:45.126Z [paystack] rule-added
  Added the slow-response failure rule.
```

With `--follow --json`, each event is printed as one JSON object on its own line.

## `ibeji resend`

Resends one webhook delivery to the twin's current webhook URL.

```bash
ibeji resend delivery-1 --json
```

Example output, shortened:

```json
{"delivery":{"id":"delivery-2","resendOf":"delivery-1","status":"queued"}}
```

The command creates a new delivery. The original delivery stays in the list. The Webhooks page has a Resend button that does the same thing. The delivery id comes from the Webhooks page or the control API.

## `ibeji reset`

Deletes one twin's records, or every twin's records. It keeps failure rules, scenarios, webhook URLs, test keys and events. It cancels queued and scheduled webhooks and marks them abandoned.

Reset Paystack:

```bash
ibeji reset --twin paystack --yes --json
```

Reset every running twin:

```bash
ibeji reset --yes --json
```

Example output:

```json
{"ok":true,"twin":"paystack","abandonedWebhooks":1}
```

Without `--yes` and without `--json`, the command asks for confirmation. A JSON command needs `--yes` because it cannot ask a question.

## `ibeji export`

Saves the session to a JSON file with mode `600` on macOS and Linux. The export removes the token, UI token, launch codes, full credentials, live keys and authorization headers.

```bash
ibeji export ibeji-session.json --json
```

Example output:

```json
{"ok":true,"file":"/your/folder/ibeji-session.json"}
```

The export includes the version, seed, start time, twins and ports, rules, scenario, webhook URLs, twin records, deliveries and up to the last 5,000 events.

## `ibeji mcp`

Runs the MCP server over stdio for an AI coding agent. Start Ibeji first.

```bash
ibeji mcp
```

Only MCP messages go to standard output. Logs go to standard error. The server reads the session file again on every tool call, so it keeps working after Ibeji restarts. It listed 13 tools in the protocol check for version 0.1.0.

The MCP client configuration is in the [README](../README.md). The keys returned by the credential tools are fake local test keys. MCP clients may log tool results. Never use a live key with Ibeji.

## `ibeji doctor`

Checks Node, ports, the config file, the session file, the session and credentials file permissions, the dashboard build and each webhook URL. It uses the running session's webhook address policy from `GET /status`, or the config file's when no session runs, and says which it used. It sends a `HEAD` request only to a webhook URL that resolves to this computer. A private or public webhook URL is reported as "not contacted". Every problem prints what happened, why, and what to do.

```bash
ibeji doctor --json
```

Example output when everything passes:

```json
{"ok":true,"checks":[{"name":"Node version","problems":[]},{"name":"Configuration","problems":[]},{"name":"Session file","problems":[]},{"name":"Session file permissions","problems":[]},{"name":"Ports","problems":[]},{"name":"Credentials file permissions","problems":[]},{"name":"Dashboard build","problems":[]},{"name":"Webhook URLs","problems":[],"notes":["Using the running session's address policy."]}]}
```

Exit code `0` means every check passed. Exit code `1` means at least one check failed.

## Global options

- `--help` works on every command and prints a real example.
- `--json` prints one JSON object for commands that print data. Errors use the same JSON shape as the control API.
- Human errors print what happened, why, and the fix on separate lines to standard error.
- A command checks all of its input before changing anything. If one part is invalid, nothing changes.
- `ibeji start` prints a `Control and C` hint. Press Control and C in that terminal for a clean shutdown.
- The dashboard link is single use. The session token and launch code are never printed by other commands.

## Related pages

- [Connect your app](connect-your-app.md)
- [Safety](safety.md)
- [Limits](limits.md)
- [Failure library](failures.md)
- [Scenarios](scenarios.md)
