import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FAILURE_CATALOG } from "../../src/core/failures/catalog.js";
import { registry } from "../../src/twins/registry.js";

const DASHES = /[\u2013\u2014]/;
const ASSUMED_LABEL = "Assumed: not confirmed by the service's documentation.";

async function scenarioStories(): Promise<readonly string[]> {
  const files = (await readdir("scenarios")).filter((file) => file.endsWith(".json")).sort();
  const stories: string[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join("scenarios", file), "utf8")) as {
      story?: unknown;
    };
    if (typeof raw.story === "string") {
      stories.push(raw.story);
    }
  }
  return stories;
}

describe("C5 failure library content", () => {
  it("C5: every catalog entry has a name, a real-life paragraph and app checks", () => {
    for (const failure of FAILURE_CATALOG) {
      expect(failure.name.trim().length).toBeGreaterThan(0);
      expect(failure.description.realLife.trim().length).toBeGreaterThan(80);
      expect(failure.description.whatToCheck.trim().length).toBeGreaterThan(80);
      expect(failure.description.realLife.toLowerCase()).not.toContain("placeholder");
      expect(failure.description.whatToCheck.toLowerCase()).not.toContain("placeholder");
    }
  });

  it("C5: every failure supported by a twin has a source and a reference", () => {
    for (const definition of registry.list()) {
      for (const support of definition.failures.support) {
        expect(["docs", "real-story", "assumed"]).toContain(support.source);
        expect(support.sourceReference?.trim().length ?? 0).toBeGreaterThan(0);
        expect(FAILURE_CATALOG.some((failure) => failure.id === support.id)).toBe(true);
      }
    }
  });

  it("C5: every catalog failure that a twin supports names that twin's source", () => {
    for (const failure of FAILURE_CATALOG) {
      for (const definition of registry.list()) {
        const supportsFailure = definition.failures.support.some(
          (support) => support.id === failure.id,
        );
        if (!supportsFailure) {
          continue;
        }
        const support = definition.failures.support.find((item) => item.id === failure.id);
        expect(support?.source.trim().length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("C5: no real-story source is used without a cleared STORIES.md entry", async () => {
    const sources = registry
      .list()
      .flatMap((definition) =>
        definition.failures.support
          .filter((support) => support.source === "real-story")
          .map((support) => ({ twinId: definition.id, support })),
      );

    expect(sources).toEqual([]);
    await expect(readFile("STORIES.md", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C5: assumed failures carry the C5 label in the generated docs", async () => {
    const docs = await readFile("docs/failures.md", "utf8");
    const assumedSupport = registry
      .list()
      .flatMap((definition) => definition.failures.support)
      .filter((support) => support.source === "assumed");

    expect(assumedSupport.length).toBeGreaterThan(0);
    expect(docs).toContain(ASSUMED_LABEL);
  });

  it("C5: catalog text, scenario stories and the docs contain no em or en dash", async () => {
    const texts = [
      ...FAILURE_CATALOG.map(
        (failure) =>
          `${failure.name}\n${failure.description.realLife}\n${failure.description.whatToCheck}`,
      ),
      ...(await scenarioStories()),
      await readFile("docs/failures.md", "utf8"),
      await readFile("docs/scenarios.md", "utf8"),
    ];

    for (const text of texts) {
      expect(text).not.toMatch(DASHES);
    }
  });
});
