export function twinLabelClass(token: string): string {
  switch (token) {
    case "twin-label-1":
      return "twin-label-one";
    case "twin-label-2":
      return "twin-label-two";
    case "twin-label-3":
      return "twin-label-three";
    default:
      return "twin-label-fallback";
  }
}
