<<<<<<< HEAD
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useAccountMock = vi.fn();
const useUserStreamsMock = vi.fn();
const useReadContractsMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useReadContracts: (...args: unknown[]) => useReadContractsMock(...args),
=======
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAccountMock = vi.fn();
const useUserStreamsMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)
}));

vi.mock("@/hooks/useStreams", () => ({
  useUserStreams: (...args: unknown[]) => useUserStreamsMock(...args),
}));

<<<<<<< HEAD
const { StreamList } = await import("@/components/StreamList");

describe("StreamList", () => {
  it("renders indexer error state distinctly from empty state", () => {
    useAccountMock.mockReturnValue({
      address: "0x0000000000000000000000000000000000000001",
    });
=======
vi.mock("@/components/StreamCard", () => ({
  StreamCard: () => <div>stream-card</div>,
}));

const { StreamList } = await import("@/components/StreamList");

const ovrflo = {
  address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  treasury: "0x0000000000000000000000000000000000000002" as `0x${string}`,
  underlying: "0x0000000000000000000000000000000000000003" as `0x${string}`,
  ovrfloToken: "0x0000000000000000000000000000000000000004" as `0x${string}`,
};

beforeEach(() => {
  useAccountMock.mockReturnValue({
    address: "0x0000000000000000000000000000000000000005",
  });
  useUserStreamsMock.mockReturnValue({
    data: [],
    isLoading: false,
    error: undefined,
  });
});

describe("StreamList", () => {
  it("renders an actionable indexer error instead of an empty state", () => {
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)
    useUserStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Sablier indexer returned 502"),
<<<<<<< HEAD
      refetch: vi.fn(),
    });
    useReadContractsMock.mockReturnValue({ data: undefined });

    render(<StreamList ovrflos={[]} allMarkets={[]} />);

    expect(screen.getByText(/unable to load stream data/i)).toBeInTheDocument();
    expect(screen.queryByText(/no active streams yet/i)).not.toBeInTheDocument();
  });
});
=======
    });

    render(<StreamList ovrflos={[ovrflo]} allMarkets={[]} />);

    expect(screen.getByText("Unable to load your streams")).toBeInTheDocument();
    expect(screen.getByText(/Sablier indexer returned 502/i)).toBeInTheDocument();
  });

  it("distinguishes an empty factory from an empty wallet stream list", () => {
    render(<StreamList ovrflos={[]} allMarkets={[]} />);

    expect(
      screen.getByText(/No OVRFLO markets are currently available from the configured factory/i)
    ).toBeInTheDocument();
  });
});
>>>>>>> c3c87ba (web pass 2: add error handling, status panel, and launch config)
