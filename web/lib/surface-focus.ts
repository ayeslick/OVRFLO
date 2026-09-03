export function restoreOpenerOrHeading(
  opener: HTMLElement | null,
  heading: HTMLElement | null,
  key: string | null = null,
): void {
  if (opener && document.contains(opener)) {
    opener.focus();
    return;
  }
  if (key) {
    const remounted = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (remounted) {
      remounted.focus();
      return;
    }
  }
  heading?.focus();
}

export function currentSurfaceHeading(root?: ParentNode | null): HTMLElement | null {
  const scope = root ?? document;
  const detail = scope.querySelector<HTMLElement>(
    [
      "[data-region='borrowed-detail']",
      "[data-region='supplied-detail']",
      "[data-region='stream-detail']",
      "[data-region='settled-detail']",
      "[data-region='waiting-request']",
    ].join(", "),
  );
  return (detail ?? scope).querySelector<HTMLElement>("[data-surface-heading]");
}

export function rememberOpener(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function openerFocusKey(node: HTMLElement | null): string | null {
  return node?.getAttribute("data-focus-key") ?? null;
}
