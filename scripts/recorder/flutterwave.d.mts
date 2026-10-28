import type { RecorderContext, ServiceMeta } from "./shared.mjs";

export const meta: ServiceMeta;
export function record(ctx: RecorderContext): Promise<void>;
