export function canStartBrowserDiscovery(
  scope: Pick<typeof globalThis, "window" | "document"> | Record<string, never> = globalThis,
) {
  return "window" in scope && "document" in scope && Boolean(scope.window && scope.document);
}
