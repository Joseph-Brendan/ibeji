import type { ZodType } from "zod";

import { TwinStateStore as CoreTwinStateStore } from "../../core/state.js";
import type {
  CollectionDefinition,
  IdempotencyStore,
  StoredIdempotency,
  TwinId,
  TwinStateStore,
} from "./types.js";

type StateRecord = Readonly<Record<string, unknown>>;

/**
 * Adapts the core's JSON state store to the interface a twin definition sees.
 * The core owns storage and reset scope; the twin owns record shapes.
 */
export class FrameworkStateStore implements TwinStateStore {
  private readonly store: CoreTwinStateStore;

  constructor(twinId: string, collections: readonly CollectionDefinition[]) {
    this.store = new CoreTwinStateStore(
      twinId,
      collections.map((collection) => ({ name: collection.id })),
    );
  }

  read<T>(collection: string, id: string, schema: ZodType<T>): T | undefined {
    const record = this.store.get(collection, id);
    return record === undefined ? undefined : schema.parse(record);
  }

  list<T>(collection: string, schema: ZodType<T>): readonly T[] {
    return this.store.list(collection).map((record) => schema.parse(record));
  }

  insert<T>(collection: string, record: T): void {
    this.store.insert(collection, record as StateRecord);
  }

  update<T>(collection: string, id: string, record: T): void {
    this.store.update(collection, id, record as StateRecord);
  }

  remove(collection: string, id: string): void {
    this.store.remove(collection, id);
  }

  reset(): void {
    this.store.reset();
  }
}

/** The in-memory idempotency store for one session. The adapter owns expiry. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, StoredIdempotency>();

  lookup(twinId: TwinId, key: string): StoredIdempotency | undefined {
    return this.records.get(`${twinId}\u0000${key}`);
  }

  save(twinId: TwinId, record: StoredIdempotency): void {
    this.records.set(`${twinId}\u0000${record.key}`, record);
  }
}
