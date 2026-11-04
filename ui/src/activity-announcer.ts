export const ANNOUNCEMENT_INTERVAL_MS = 5_000;

export type ActivityAnnouncementState = {
  readonly pending: number;
  readonly lastAt: number;
};

export type ActivityAnnouncement = {
  readonly state: ActivityAnnouncementState;
  readonly text: string | undefined;
};

export function createActivityAnnouncement(): ActivityAnnouncementState {
  return { pending: 0, lastAt: Number.NEGATIVE_INFINITY };
}

export function announceActivity(
  state: ActivityAnnouncementState,
  count: number,
  now: number,
  summary: string,
  paused: boolean,
): ActivityAnnouncement {
  const pending = state.pending + count;
  if (now - state.lastAt < ANNOUNCEMENT_INTERVAL_MS) {
    return { state: { pending, lastAt: state.lastAt }, text: undefined };
  }
  const noun = pending === 1 ? "event" : "events";
  const cleanSummary = summary.replace(/[.!?]+$/u, "");
  const text = paused
    ? `${pending} new ${noun} arrived while paused.`
    : `${pending} new ${noun}. Newest: ${cleanSummary}.`;
  return { state: { pending: 0, lastAt: now }, text };
}
