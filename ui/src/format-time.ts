const dateParts = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeParts = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const momentFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function asDate(value: string | number | Date): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatStarted(value: string | number | Date): string {
  const date = asDate(value);
  if (date === undefined) {
    return String(value);
  }
  return `${dateParts.format(date)} at ${timeParts.format(date)}`;
}

export function formatTimestamp(value: string | number | Date): string {
  const date = asDate(value);
  if (date === undefined) {
    return String(value);
  }
  return momentFormatter.format(date);
}

export function formatLastUpdated(value: Date): string {
  return timeParts.format(value);
}
