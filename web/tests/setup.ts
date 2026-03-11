import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", "0x0000000000000000000000000000000000000001");
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1");
vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "test-project-id");
