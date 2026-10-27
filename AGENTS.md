# Rules for the coding agent

You are building Ibeji: local twins of Paystack, Flutterwave, and Stripe. SPEC.md in this folder is the single source of truth. These rules apply to every task, in every chat.

## Before you start any task

1. Read this file in full.
2. Read every SPEC.md section the task names. If the task names none, read SPEC.md in full.
3. Read BUILD-LOG.md to see what earlier tasks decided.
4. If the task concerns a twin, read that twin's file in research/ and look at its fixtures in fixtures/<twin>/. If the task concerns the twin framework, read TWIN-DESIGN.md.
5. Start your first reply with one line: "Read AGENTS.md, BUILD-LOG.md, and: [list every file and SPEC.md section you read]."

## Rules while working

1. If anything in the task or SPEC.md is unclear, contradicts itself, or seems wrong, stop and ask before writing code. Never guess, especially about any payment service's behaviour, money, keys, or security.
2. Read the installed version of every library before using it: its README and its type definitions in node_modules. Never write library code from memory. Library APIs change between versions.
3. Facts about Paystack, Flutterwave, or Stripe come only from that service's file in research/ and its files in fixtures/. If a fact you need is missing, stop and say which fact is missing.
4. Never apply a fact about one service to another. Paystack, Flutterwave, and Stripe differ in paths, field names, request formats, error shapes, key formats, webhook signing, and money rules. If two services seem to work the same way, check both research files before reusing code, and say which lines in each file prove it.
5. Twin-specific code lives only in that twin's folder under src/twins/. The core, the control API, the CLI, the UI, and the MCP server never contain code for a specific service, and never list twin ids. The only list of twins is src/twins/registry.ts (SPEC.md C3 rule 8).
6. Write tests first or alongside the code, never after. Name each test after its spec reference, for example "T4 flutterwave webhook-delayed: delays delivery by the set seconds".
7. Never weaken, skip, delete, or comment out a test to make it pass. Never lower a coverage threshold. Never add retries to hide a flaky test. Never use `.skip`, `.only`, or `.todo`.
8. Never use the `any` type. Never use `@ts-ignore` or `@ts-expect-error`. Never use non-null assertions (`!`) to silence the type checker. Fix the real type.
9. No empty catch blocks. Every caught error is handled, rethrown with context, or converted to an Ibeji error with what, why, and fix (SPEC.md C12).
10. Follow the safety rules in SPEC.md C13 at all times.
11. Never put a real key from any service in code, tests, fixtures, logs, or commit messages. Never print a session token, UI token, launch code, or any part of a live key (SPEC.md C12 rule 5).
12. Every server you start passes hostname '127.0.0.1' explicitly. Tests use port 0 and a temporary home folder, never the real ~/.ibeji.
13. Follow the dependency rules in SPEC.md C1: nothing native in the runtime dependencies, and nothing that compiles from source anywhere. Never add the official Paystack, Flutterwave, or Stripe libraries as dependencies of Ibeji itself; they may only be dev dependencies for compatibility tests (SPEC.md T15) and the example app. Ask before adding any new dependency, and say why it is needed and what it weighs.
14. Stay within the current task. Write ideas for later in BUILD-LOG.md under "Later".
15. Explain decisions in plain English.

## Definition of Done

A task is done only when all of these are true:

1. Every quality gate from SPEC.md C18 that exists at this point has been run, in order, and passes. Show the real terminal output of each, not a summary of it.
2. `pnpm typecheck` shows zero errors.
3. `pnpm lint` shows zero errors and zero warnings.
4. Every test passes. Run `pnpm test` twice in a row. Both runs must pass.
5. Coverage meets SPEC.md C17 for the files this task touched.
6. No test was skipped, weakened, or deleted. Say so explicitly.
7. BUILD-LOG.md has a short entry for this task: what was built, decisions made, and anything left for later.
8. Any change to the meaning of SPEC.md is proposed as a C21 decision entry and shown to the user for approval. Do not edit other SPEC.md sections without approval.
9. The task's checklist is reported, each item marked done or not done, with a reason for anything not done.
10. The work is committed with the message the task gives.

If any of these cannot be met, say so clearly at the top of your final reply. Never report a task as done when it is not.