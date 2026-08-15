import "@testing-library/jest-dom/vitest";

// Unit tests import `@/lib/config` at module load. A missing stream address
// must fail the real boot; tests that are not exercising that gate get a
// non-zero placeholder so collection does not collapse. config.test.ts unstubs
// this key and asserts the loud fail itself.
if (!process.env.NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS) {
  process.env.NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS =
    "0x4444444444444444444444444444444444444444";
}
