// Minimal ABIs for demand indexing (ticket 09): the factory's lending
// deployment event (used as a Ponder factory source) and the lending
// market's borrow-pool creation event.

export const OVRFLOFactoryAbi = [
  {
    type: "event",
    name: "LendingDeployed",
    inputs: [
      { name: "ovrflo", type: "address", indexed: true },
      { name: "lending", type: "address", indexed: true },
    ],
  },
] as const;

export const OVRFLOLendingAbi = [
  {
    type: "event",
    name: "BorrowerLoanPoolCreated",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "borrower", type: "address", indexed: true },
      { name: "market", type: "address", indexed: true },
      { name: "aprBps", type: "uint16", indexed: false },
      { name: "totalContributed", type: "uint128", indexed: false },
    ],
  },
] as const;
