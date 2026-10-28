import type { RecorderContext, ServiceMeta } from "./shared.mjs";

export const meta: ServiceMeta;
export const onlyActions: readonly string[];
export function record(ctx: RecorderContext): Promise<void>;
