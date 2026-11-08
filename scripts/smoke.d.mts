export const DEFAULT_TWIN_PORTS: Set<number>;

export function assertNoDefaultTwinPorts(
  ports: Readonly<Record<string, number>>,
  defaults?: ReadonlySet<number>,
): void;
