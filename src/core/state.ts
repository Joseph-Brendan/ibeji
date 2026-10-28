import { IbejiError } from "./errors.js";

export type StateId = string | number;
export type StateRecord = Readonly<Record<string, unknown>>;

export type CollectionDefinition<T extends StateRecord = StateRecord> = {
  readonly name: string;
  readonly idField?: keyof T & string;
};

type StoredCollection = {
  readonly idField: string;
  readonly records: Map<string, StateRecord>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * One twin's view of its own state. It only knows the collections registered
 * for that twin, so it cannot reach another twin's records even when both use
 * the same collection name.
 */
export class TwinStateStore {
  readonly twinId: string;
  private readonly collections = new Map<string, StoredCollection>();

  constructor(twinId: string, definitions: readonly CollectionDefinition[]) {
    this.twinId = twinId;

    for (const definition of definitions) {
      if (this.collections.has(definition.name)) {
        throw new IbejiError("BAD_REQUEST", {
          what: `The collection "${definition.name}" is registered twice.`,
          why: `The ${twinId} twin registered the same collection name more than once.`,
          fix: "Give every collection in a twin a different name.",
        });
      }

      this.collections.set(definition.name, {
        idField: definition.idField ?? "id",
        records: new Map(),
      });
    }
  }

  get<T extends StateRecord = StateRecord>(collection: string, id: StateId): T | undefined {
    const stored = this.requireCollection(collection).records.get(String(id));
    return stored === undefined ? undefined : clone(stored as T);
  }

  list<T extends StateRecord = StateRecord>(collection: string): readonly T[] {
    return [...this.requireCollection(collection).records.values()].map((record) =>
      clone(record as T),
    );
  }

  insert<T extends StateRecord = StateRecord>(collection: string, record: T): void {
    const target = this.requireCollection(collection);
    const id = this.idOf(target, record);

    if (target.records.has(id)) {
      throw new IbejiError("BAD_REQUEST", {
        what: `A ${collection} record with id "${id}" already exists.`,
        why: `The ${this.twinId} twin's ${collection} collection uses ids that must be unique.`,
        fix: "Use a new id, or update the existing record instead.",
      });
    }

    target.records.set(id, clone(record));
  }

  update<T extends StateRecord = StateRecord>(
    collection: string,
    id: StateId,
    changes: Partial<T>,
  ): T {
    const target = this.requireCollection(collection);
    const key = String(id);
    const existing = target.records.get(key);

    if (existing === undefined) {
      throw new IbejiError("NOT_FOUND", {
        what: `No ${collection} record has id "${key}".`,
        why: `The ${this.twinId} twin does not have a record with that id.`,
        fix: "Check the id, or insert the record before updating it.",
      });
    }

    const updated: StateRecord = { ...existing, ...clone(changes) };
    if (this.idOf(target, updated) !== key) {
      throw new IbejiError("BAD_REQUEST", {
        what: `The id of a ${collection} record cannot be changed.`,
        why: `Every ${collection} record is stored under its id, so changing it would orphan the record.`,
        fix: "Keep the id unchanged, or insert a new record with the new id.",
      });
    }

    target.records.set(key, updated);
    return clone(updated as T);
  }

  reset(): void {
    for (const collection of this.collections.values()) {
      collection.records.clear();
    }
  }

  private requireCollection(name: string): StoredCollection {
    const collection = this.collections.get(name);
    if (collection === undefined) {
      throw new IbejiError("BAD_REQUEST", {
        what: `The ${this.twinId} twin does not have a "${name}" collection.`,
        why: "Only collections registered by this twin can be read or changed.",
        fix: "Register the collection in the twin definition, or use one that is registered.",
      });
    }
    return collection;
  }

  private idOf(collection: StoredCollection, record: StateRecord): string {
    const value = record[collection.idField];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    throw new IbejiError("BAD_REQUEST", {
      what: `The record has no usable "${collection.idField}" id.`,
      why: `The ${this.twinId} twin stores each record by its ${collection.idField}, which must be a non-empty string or a finite number.`,
      fix: `Give the record a ${collection.idField} before inserting it.`,
    });
  }
}

/**
 * All twin state for one session. Each registered twin gets its own scoped
 * store; reset can clear one twin or every twin.
 */
export class StateStore {
  private readonly twins = new Map<string, TwinStateStore>();

  registerTwin(twinId: string, definitions: readonly CollectionDefinition[]): TwinStateStore {
    if (this.twins.has(twinId)) {
      throw new IbejiError("BAD_REQUEST", {
        what: `The twin "${twinId}" is registered twice.`,
        why: "Every twin in a session has one state store.",
        fix: "Register each twin id only once.",
      });
    }

    const store = new TwinStateStore(twinId, definitions);
    this.twins.set(twinId, store);
    return store;
  }

  twin(twinId: string): TwinStateStore {
    const store = this.twins.get(twinId);
    if (store === undefined) {
      throw new IbejiError("UNKNOWN_TWIN", {
        what: `The twin "${twinId}" is not registered.`,
        why: "State can only be read through a twin that has registered its collections.",
        fix: "Register the twin before reading or changing its state.",
      });
    }
    return store;
  }

  reset(twinId?: string): void {
    if (twinId === undefined) {
      for (const store of this.twins.values()) {
        store.reset();
      }
      return;
    }

    this.twin(twinId).reset();
  }
}
