// Shared fail-closed discovery limits. Keeping these separate from the
// temporary shadow adapters prevents live consumers from depending on parity
// instrumentation that U10/U11 will remove.
export const MAX_VAULT_REGISTRY_ENTRIES = 2_048;
