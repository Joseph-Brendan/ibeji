import type { EventItem } from "../../src/shared/control.js";

export function eventTypeLabel(type: string): string {
  switch (type) {
    case "request":
      return "Request received";
    case "response":
      return "Reply sent";
    case "webhook-sent":
      return "Update sent";
    case "webhook-delivered":
      return "Update delivered";
    case "webhook-failed":
      return "Update failed";
    case "failure-fired":
      return "Test problem triggered";
    case "rule-added":
      return "Problem turned on";
    case "rule-removed":
      return "Problem turned off";
    case "scenario-started":
      return "Practice scenario started";
    case "scenario-step":
      return "Practice scenario step";
    case "scenario-finished":
      return "Practice scenario finished";
    case "warning":
      return "Warning";
    case "state-reset":
      return "Test data cleared";
    default:
      return "Activity";
  }
}

export function eventSummary(event: EventItem): string {
  switch (event.type) {
    case "rule-added":
      return "A test failure was turned on.";
    case "rule-removed":
      return "A test failure was turned off.";
    case "failure-fired":
      return "A test failure changed a response.";
    case "webhook-sent":
      return "Ibeji sent a webhook to your app.";
    case "webhook-delivered":
      return "Your app received a webhook.";
    case "webhook-failed":
      return "A webhook could not be delivered.";
    case "state-reset":
      return "Test records were cleared.";
    default:
      return event.summary;
  }
}
