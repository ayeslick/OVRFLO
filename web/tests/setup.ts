import "@testing-library/jest-dom/vitest";

// Unit tests import `@/lib/config` at module load. A missing factory address
// must fail the real boot; tests that are not exercising that gate get a
// non-zero placeholder so collection does not collapse. config.test.ts unstubs
// this key and asserts the loud fail itself.
if (!process.env.NEXT_PUBLIC_OVRFLO_FACTORY) {
  process.env.NEXT_PUBLIC_OVRFLO_FACTORY =
    "0x1111111111111111111111111111111111111111";
}
