export function eventTypeLabel(type: string): string {
  switch (type) {
    case "request":
      return "Request";
    case "response":
      return "Response";
    case "webhook-sent":
      return "Webhook sent";
    case "webhook-delivered":
      return "Webhook delivered";
    case "webhook-failed":
      return "Webhook failed";
    case "failure-fired":
      return "Failure fired";
    case "rule-added":
      return "Failure switched on";
    case "rule-removed":
      return "Failure switched off";
    case "scenario-started":
      return "Scenario started";
    case "scenario-step":
      return "Scenario step";
    case "scenario-finished":
      return "Scenario finished";
    case "warning":
      return "Warning";
    case "state-reset":
      return "Records reset";
    default:
      return "Event";
  }
}
