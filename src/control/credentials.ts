import { randomBytes } from "node:crypto";
import { z } from "zod";

import { IbejiError } from "../core/errors.js";
import { fingerprint } from "../core/redact.js";
import type {
  CredentialSpec,
  CryptoRandom,
  TwinCredentials,
  TwinDefinition,
} from "../twins/framework/types.js";
import {
  credentialsPath,
  ensureIbejiHome,
  ensurePrivateFile,
  readJsonFile,
  writePrivateJson,
} from "./paths.js";
import type { ByteSource } from "./secrets.js";

const credentialValuesSchema = z.record(z.string(), z.string().min(1));

const credentialsFileSchema = z.strictObject({
  version: z.literal(1),
  twins: z.record(z.string(), credentialValuesSchema),
});

export type StoredCredentialsFile = z.infer<typeof credentialsFileSchema>;

export type CredentialView = {
  readonly id: string;
  readonly label: string;
  readonly role: CredentialSpec["role"];
  readonly secret: boolean;
  readonly value: string;
};

function invalidCredentialsFile(path: string, why: string): IbejiError {
  return new IbejiError("INTERNAL", {
    what: "The Ibeji credentials file is not valid.",
    why,
    fix: `Fix or remove ${path}; Ibeji will create new test credentials when it starts.`,
  });
}

function generateTwinCredentials(
  definition: TwinDefinition,
  bytes: ByteSource,
): Record<string, string> {
  const random: CryptoRandom = { bytes };
  const values: Record<string, string> = {};
  for (const spec of definition.credentials) {
    values[spec.id] = spec.generate(random);
  }
  return values;
}

function copyValues(values: Readonly<Record<string, string>>): Record<string, string> {
  return { ...values };
}

/**
 * The credentials storage for one user. Every registered twin gets its fake
 * credentials on first start; later starts keep the same values until a
 * rotation replaces them.
 */
export class CredentialsStore {
  readonly home: string;
  readonly definitions: readonly TwinDefinition[];
  private readonly bytes: ByteSource;
  private readonly path: string;
  private readonly retiredValues = new Set<string>();
  private values: Record<string, Record<string, string>>;

  private constructor(
    home: string,
    definitions: readonly TwinDefinition[],
    bytes: ByteSource,
    values: Record<string, Record<string, string>>,
    retiredValues: ReadonlySet<string>,
  ) {
    this.home = home;
    this.definitions = definitions;
    this.bytes = bytes;
    this.path = credentialsPath(home);
    this.values = values;
    for (const value of retiredValues) {
      this.retiredValues.add(value);
    }
  }

  static async load(
    home: string,
    definitions: readonly TwinDefinition[],
    bytes: ByteSource = randomBytes,
  ): Promise<CredentialsStore> {
    await ensureIbejiHome(home);
    const path = credentialsPath(home);
    const read = await readJsonFile(path);

    let values: Record<string, Record<string, string>>;
    let changed = false;
    const retiredValues = new Set<string>();

    if (read.kind === "missing") {
      values = {};
      changed = true;
    } else if (read.kind === "invalid") {
      throw invalidCredentialsFile(path, "The file does not contain valid JSON.");
    } else {
      const parsed = credentialsFileSchema.safeParse(read.value);
      if (!parsed.success) {
        throw invalidCredentialsFile(
          path,
          "The file does not have the expected version and twin credential fields.",
        );
      }
      values = {};
      for (const [twinId, twinValues] of Object.entries(parsed.data.twins)) {
        values[twinId] = copyValues(twinValues);
      }
    }

    for (const definition of definitions) {
      const existing = values[definition.id];
      const next: Record<string, string> = existing === undefined ? {} : copyValues(existing);
      for (const spec of definition.credentials) {
        const current = next[spec.id];
        if (current === undefined || !spec.isTestFormat(current) || !current.includes("ibeji")) {
          for (const value of Object.values(next)) {
            retiredValues.add(value);
          }
          const generated = generateTwinCredentials(definition, bytes);
          for (const [id, value] of Object.entries(generated)) {
            next[id] = value;
          }
          changed = true;
          break;
        }
      }
      values[definition.id] = next;
    }

    if (changed) {
      await writePrivateJson(path, { version: 1, twins: values });
    } else {
      await ensurePrivateFile(path);
    }

    return new CredentialsStore(home, definitions, bytes, values, retiredValues);
  }

  get(twinId: string): TwinCredentials {
    const values = this.values[twinId];
    if (values === undefined) {
      throw new IbejiError("UNKNOWN_TWIN", {
        why: "That twin has no stored Ibeji credentials.",
      });
    }
    return copyValues(values);
  }

  all(): Readonly<Record<string, TwinCredentials>> {
    const result: Record<string, TwinCredentials> = {};
    for (const [twinId, values] of Object.entries(this.values)) {
      result[twinId] = copyValues(values);
    }
    return result;
  }

  views(twinId: string): readonly CredentialView[] {
    const definition = this.definition(twinId);
    const values = this.values[twinId] ?? {};
    return definition.credentials.map((spec) => ({
      id: spec.id,
      label: spec.label,
      role: spec.role,
      secret: spec.secret,
      value: values[spec.id] ?? "",
    }));
  }

  async rotate(twinId?: string): Promise<readonly string[]> {
    const targets =
      twinId === undefined ? this.definitions.map((definition) => definition.id) : [twinId];

    for (const target of targets) {
      this.definition(target);
    }

    for (const target of targets) {
      const definition = this.definition(target);
      for (const value of Object.values(this.values[target] ?? {})) {
        this.retiredValues.add(value);
      }
      this.values[target] = generateTwinCredentials(definition, this.bytes);
    }

    await writePrivateJson(this.path, { version: 1, twins: this.values });
    return targets;
  }

  /** Every current or retired credential value, for redaction. */
  secretValues(): readonly string[] {
    return [
      ...Object.values(this.values).flatMap((values) => Object.values(values)),
      ...this.retiredValues,
    ];
  }

  fingerprints(): Readonly<Record<string, Readonly<Record<string, string>>>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [twinId, values] of Object.entries(this.values)) {
      result[twinId] = Object.fromEntries(
        Object.entries(values).map(([id, value]) => [id, fingerprint(value)]),
      );
    }
    return result;
  }

  private definition(twinId: string): TwinDefinition {
    const definition = this.definitions.find((item) => item.id === twinId);
    if (definition === undefined) {
      throw new IbejiError("UNKNOWN_TWIN", {
        why: "That twin id is not in the registry.",
      });
    }
    return definition;
  }
}
