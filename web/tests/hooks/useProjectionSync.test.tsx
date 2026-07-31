import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectionSync } from "@/hooks/useProjectionSync";
const queryState = vi.hoisted(() => ({
  data: {
    status: "ready" as const,
    complete: true as const,
    freshness: "fresh" as const,
    data: "cached",
    failures: [],
    metadata: {},
  },
  error: null as unknown,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState,
}));

describe("useProjectionSync", () => {
  beforeEach(() => {
    queryState.error = null;
    queryState.isFetching = false;
    queryState.refetch.mockReset();
  });

  it("marks cached data loading while a refetch is in flight", () => {
    queryState.isFetching = true;

    const hook = renderHook(() =>
      useProjectionSync({
        scope: { kind: "claim-verifier" },
        enabled: true,
        queryFn: vi.fn(),
      }),
    );

    expect(hook.result.current.outcome).toBe(queryState.data);
    expect(hook.result.current.isFetching).toBe(true);
    expect(hook.result.current.isLoading).toBe(true);
  });
});
