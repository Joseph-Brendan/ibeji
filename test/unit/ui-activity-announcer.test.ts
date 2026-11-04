import { describe, expect, it } from "vitest";

import { announceActivity, createActivityAnnouncement } from "../../ui/src/activity-announcer.js";

describe("T8 UI activity announcements", () => {
  it("T8: announces at most once every five seconds", () => {
    let state = createActivityAnnouncement();

    const first = announceActivity(state, 1, 1_000, "A payment arrived.", false);
    state = first.state;
    expect(first.text).toBe("1 new event. Newest: A payment arrived.");

    const quiet = announceActivity(state, 1, 5_999, "Another payment arrived.", false);
    state = quiet.state;
    expect(quiet.text).toBeUndefined();

    const second = announceActivity(state, 2, 6_000, "A refund arrived.", false);
    expect(second.text).toBe("3 new events. Newest: A refund arrived.");
  });

  it("T8: announces the waiting count while paused", () => {
    let state = createActivityAnnouncement();
    state = announceActivity(state, 1, 1_000, "One.", false).state;

    const paused = announceActivity(state, 4, 10_000, "Four.", true);
    expect(paused.text).toBe("4 new events arrived while paused.");
  });
});
