import type { Locator, Page } from "@playwright/test";

export function ui(page: Page, id: string): Locator {
  return page.locator(`[data-ui="${id}"]`);
}
