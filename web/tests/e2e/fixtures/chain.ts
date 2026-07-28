// "Given" steps arrange on-chain state directly via viem (never through the
// UI) so preconditions are fast and deterministic; "When"/"Then" steps drive
// the real app. This is the standard BDD arrange/act split, not a shortcut —
// it also sidesteps a real limitation: the E2E mock connector only ever
// signs as one address (KTD6's dev wallet), so lender-side state (someone
// else's supplied liquidity) can never be arranged by clicking through the
// UI as the connected persona in the first place.
//
// Anvil unlocks and signs for its own default dev-mnemonic accounts
// internally (see lib/wagmi.ts's E2E_DEV_ACCOUNT comment), so a viem
// WalletClient constructed with a plain `account: Address` — no private key —
// works for both DEV_WALLET_ADDRESS and LENDER_WALLET_ADDRESS here, exactly
// like the app's own mock connector.
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi as viemErc20Abi,
  http,
  type Address,
  type Hash,
  type Log,
} from "viem";
import { erc20Abi, ovrfloAbi, ovrfloFactoryAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { formatMaturity } from "@/lib/format";
import { DEV_WALLET_ADDRESS, LENDER_WALLET_ADDRESS } from "./mock-wallet";
import { RPC_URL, rpcCall } from "./rpc";

// wstETH is a deliberately fixed choice for this project (not something to
// discover — see AGENTS.md), so it alone stays a plain constant here.
export const WSTETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

const localChain = {
  id: 1,
  name: "anvil-local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

export const publicClient = createPublicClient({ chain: localChain, transport: http(RPC_URL) });

export function walletFor(account: Address) {
  return createWalletClient({ account, chain: localChain, transport: http(RPC_URL) });
}

export const devClient = walletFor(DEV_WALLET_ADDRESS);
export const lenderClient = walletFor(LENDER_WALLET_ADDRESS);

// Anvil's default dev-mnemonic account #0 — script/seed-local.sh deploys the
// factory from this address (`OWNER_PK`'s well-known default), so it doubles
// as the local "multisig" for admin-gated arrange steps (e.g. deposit caps).
export const OWNER_ADDRESS: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const ownerClient = walletFor(OWNER_ADDRESS);

type Deployment = {
  factory: Address;
  ovrflo: Address;
  token: Address;
  lending: Address;
  primaryMarket: Address;
  primaryPt: Address;
  primaryExpiry: number;
  secondaryMarket: Address;
  secondaryPt: Address;
  secondaryExpiry: number;
};

let cachedDeployment: Deployment | null = null;

// deployments/local.json is written by script/seed-local.sh; test:e2e's
// pretest gate does not re-run it, so a missing file means bootstrap:local
// hasn't been run yet — surfaced here as a clear error instead of a cryptic
// "address is undefined" from whichever arrange helper reads it first.
//
// This is also where PRIMARY_MARKET/SECONDARY_MARKET (below) ultimately come
// from: seed-local.sh discovers a live wstETH Pendle market on every run
// (see script/lib/discover-pendle-market.sh) rather than hardcoding one that
// would eventually expire, so this file is the single place that knows
// which two markets got seeded — no separate TS constants to keep in
// lockstep with the shell script by hand.
export function readDeployment(): Deployment {
  if (cachedDeployment) return cachedDeployment;
  const jsonPath = process.env.E2E_DEPLOYMENT_JSON ?? path.resolve(process.cwd(), "..", "deployments", "local.json");
  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf8");
  } catch {
    throw new Error(
      `${jsonPath} not found — run 'BOOT_NO_UI=1 npm --prefix web run bootstrap:local' before the E2E suite (see tests/e2e/README.md)`,
    );
  }
  cachedDeployment = JSON.parse(raw) as Deployment;
  return cachedDeployment;
}

// Functions, not top-level constants: readDeployment() throws when
// deployments/local.json doesn't exist yet, and playwright-bdd's `bddgen`
// actually `require()`s every fixtures/steps file to statically discover
// their fixture usage — well before any test runs, and well before
// bootstrap:local has necessarily run. A top-level `const x = readDeployment()`
// would make codegen itself fail on a clean checkout instead of failing at
// the first real arrange call, which is where this project wants that error
// surfaced (see readDeployment's own comment).
export function readSecondaryMarket(): Address {
  return readDeployment().secondaryMarket;
}
export function readSecondaryPt(): Address {
  return readDeployment().secondaryPt;
}
export function readSecondaryExpiry(): bigint {
  return BigInt(readDeployment().secondaryExpiry);
}

// Reuses the app's own formatter (rather than reimplementing the Intl call)
// so step files can locate a market row by the exact maturity text it
// renders — the only text that reliably distinguishes the two rows, since
// both markets share one ovrfloToken/underlying (KTD1-adjacent: cross-market
// ovrfloToken fungibility is a design feature, so the symbol column is
// identical for every row).
export function readSecondaryMaturityLabel(): string {
  return formatMaturity(readSecondaryExpiry());
}

// Throws on a reverted tx rather than handing back a receipt with empty logs
// — otherwise a revert surfaces many steps downstream as a confusing "event
// not found" error instead of the actual on-chain failure.
async function mineAndGetReceipt(hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`tx ${hash} reverted (block ${receipt.blockNumber}) — see \`cast run ${hash}\` for the trace`);
  }
  return receipt;
}

async function approveIfNeeded(
  client: ReturnType<typeof walletFor>,
  token: Address,
  spender: Address,
  amount: bigint,
) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [client.account.address, spender],
  });
  if (allowance >= amount) return;
  const hash = await client.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await mineAndGetReceipt(hash);
}

// --- Time travel -----------------------------------------------------------

export async function advancePastExpiry(expiry: bigint) {
  const latest = await publicClient.getBlock();
  const delta = expiry - latest.timestamp + 1n;
  if (delta <= 0n) return;
  await rpcCall("evm_increaseTime", [Number(delta)]);
  await rpcCall("evm_mine");
}

// Partial advance (well short of any market's expiry) so a freshly created
// Sablier stream has a small, genuinely nonzero withdrawable amount — right
// after creation, elapsed == 0 (the stream's startTime is that same block's
// timestamp), so withdrawable is exactly zero until real time (chain time)
// passes.
export async function advanceSeconds(seconds: number) {
  await rpcCall("evm_increaseTime", [seconds]);
  await rpcCall("evm_mine");
}

// --- Balance / allowance arrangement -----------------------------------------

// The step calling this (e.g. supply.feature's "transaction reverts") always
// runs right after a UI click (APPROVE) that fires-and-forgets a write from
// this same `account` via the browser's own mock-connector client — Playwright
// resolves that click as soon as the DOM interaction completes, not once the
// tx is actually mined. Without this wait, this function's own transfer can
// grab the same pending nonce and collide with it, leaving the browser's
// write permanently unmined (no receipt ever arrives, no error surfaces — the
// form just hangs "busy" forever). Waiting for `pending` to catch up to
// `latest` confirms the mempool for `account` is clear before we submit ours.
async function waitForNoncesToSettle(account: Address) {
  for (let i = 0; i < 50; i++) {
    const [latest, pending] = await Promise.all([
      rpcCall<string>("eth_getTransactionCount", [account, "latest"]),
      rpcCall<string>("eth_getTransactionCount", [account, "pending"]),
    ]);
    if (latest === pending) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitForNoncesToSettle(${account}): pending nonce never caught up to latest`);
}

// Forces a genuine on-chain revert for a subsequent write from `account` by
// draining the token balance a signed-but-not-yet-submitted form action
// depends on. Used for supply.feature's "transaction reverts" scenario
// (AE4): the contract's actual revert strings for supplyLiquidity itself are
// all pre-validated client-side (zero amount, bad APR step) and unreachable
// through real UI clicks, so this is the one realistically reachable revert
// path — plain ERC20 "transfer amount exceeds balance" — that still proves
// out AE4's real property (a revert maps to friendly copy, the modal stays
// open, and the button re-enables), even though it isn't literally the
// "OVRFLOLending: liquidity inactive" string the plan uses as its example
// (that string is only reachable from withdraw/sell/borrow-side paths, never
// from supplyLiquidity — see src/OVRFLOLending.sol).
export async function drainTokenBalance(token: Address, account: Address) {
  await waitForNoncesToSettle(account);
  const balance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance === 0n) return;
  const client = walletFor(account);
  const hash = await client.writeContract({
    address: token,
    abi: viemErc20Abi,
    functionName: "transfer",
    args: [LENDER_WALLET_ADDRESS === account ? DEV_WALLET_ADDRESS : LENDER_WALLET_ADDRESS, balance],
  });
  await mineAndGetReceipt(hash);
}

export async function drainUnderlyingBalance(account: Address) {
  return drainTokenBalance(WSTETH, account);
}

// Admin flow is multisig -> factory -> vault (never the vault directly) —
// see AGENTS.md. Pins the limit to the market's *current* total deposited, so
// remaining capacity is exactly zero and "DEPOSIT CAP REACHED" renders
// immediately, independent of whatever amount the scenario later types in.
// A limit of exactly 0 means "unlimited" (project convention), so callers
// must ensure marketTotalDeposited is already nonzero — e.g. by arranging
// one small deposit first — or this call is a no-op that leaves the market
// uncapped instead of exhausted.
export async function exhaustDepositCap(params: { factory: Address; ovrflo: Address; market: Address }) {
  const totalDeposited = await publicClient.readContract({
    address: params.ovrflo,
    abi: ovrfloAbi,
    functionName: "marketTotalDeposited",
    args: [params.market],
  });
  if (totalDeposited === 0n) {
    throw new Error("exhaustDepositCap: marketTotalDeposited is 0 — arrange a deposit first, or the cap ends up unlimited");
  }
  const hash = await ownerClient.writeContract({
    address: params.factory,
    abi: ovrfloFactoryAbi,
    functionName: "setMarketDepositLimit",
    args: [params.ovrflo, params.market, totalDeposited],
  });
  await mineAndGetReceipt(hash);
}

export async function readAprBounds(lending: Address) {
  const [aprMinBps, aprMaxBps] = await Promise.all([
    publicClient.readContract({ address: lending, abi: ovrfloLendingAbi, functionName: "aprMinBps" }),
    publicClient.readContract({ address: lending, abi: ovrfloLendingAbi, functionName: "aprMaxBps" }),
  ]);
  return { aprMinBps, aprMaxBps };
}

// OVRFLOLending's constructor sets aprMinBps == aprMaxBps == LAUNCH_APR_BPS
// (src/OVRFLOLending.sol) — a deliberate single-tick launch default, widened
// later by governance via setAprBounds. seed-local.sh never widens it, so
// every freshly-seeded local market starts with exactly one rate tick.
// adjust-rate.feature's scenarios need a second, distinct tick to move
// liquidity *to* — arrange one via the same factory-forwarded admin path
// real governance would use (AGENTS.md: multisig -> factory -> lending,
// never the lending market directly).
export async function widenAprBounds(params: { factory: Address; lending: Address; aprMinBps: number; aprMaxBps: number }) {
  const hash = await ownerClient.writeContract({
    address: params.factory,
    abi: ovrfloFactoryAbi,
    functionName: "setLendingAprBounds",
    args: [params.lending, params.aprMinBps, params.aprMaxBps],
  });
  await mineAndGetReceipt(hash);
}

// --- Lending arrangement -----------------------------------------------------

export async function supplyLiquidityAs(params: {
  account: Address;
  lending: Address;
  market: Address;
  aprBps: number;
  amount: bigint;
}) {
  const client = walletFor(params.account);
  await approveIfNeeded(client, WSTETH, params.lending, params.amount);
  const hash = await client.writeContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "supplyLiquidity",
    args: [params.market, params.aprBps, params.amount],
  });
  const receipt = await mineAndGetReceipt(hash);
  return decodeLiquidityId(receipt.logs);
}

// Convenience wrapper for the common case (borrow.feature's counterparty
// liquidity) — kept alongside supplyLiquidityAs so call sites that genuinely
// need "as the lender persona" read that intent directly.
export async function lenderSupplyLiquidity(params: { lending: Address; market: Address; aprBps: number; amount: bigint }) {
  return supplyLiquidityAs({ account: LENDER_WALLET_ADDRESS, ...params });
}

// Withdraws a stream's full current balance directly (bypassing the app UI
// entirely) as the recipient — simulates "already claimed through another
// channel" for claim-all.feature's mid-queue-revert scenario: the review
// modal's queue is planned from an on-open snapshot, so this can race it.
export async function claimStreamMax(streamId: bigint) {
  const hash = await devClient.writeContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "withdrawMax",
    args: [streamId, DEV_WALLET_ADDRESS],
  });
  await mineAndGetReceipt(hash);
}

// Withdraws a lender's liquidity position out from under an in-flight borrow
// quote — the arrange half of borrow.feature's AE5 scenario (a stale-liquidity
// revert reason auto-re-quotes the BORROW form instead of dead-ending it).
export async function withdrawLiquidity(params: { lending: Address; liquidityId: bigint }) {
  const hash = await lenderClient.writeContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "withdrawLiquidity",
    args: [params.liquidityId],
  });
  await mineAndGetReceipt(hash);
}

function decodeLiquidityId(logs: readonly Log[]) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: ovrfloLendingAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "LiquiditySupplied") {
        return (decoded.args as { liquidityId: bigint }).liquidityId;
      }
    } catch {
      // Not every log in the receipt matches this ABI — expected, keep scanning.
    }
  }
  throw new Error("supplyLiquidity receipt did not contain a LiquiditySupplied event");
}

// Deposits PT as `account` to mint a fresh eligible Sablier stream — the
// precondition every borrow/repay/close scenario needs. `deposit.feature`
// (deposit-wrap-unwrap.feature) exercises this same call through the real UI
// as its own journey; here it's pure arrangement for a *different* journey.
// Arranges a wrapped ovrfloToken balance directly — used by unwrap.feature's
// happy path so it doesn't depend on wrap.feature having run first (every
// scenario gets its own fresh snapshot).
export async function wrapUnderlying(params: { account: Address; ovrflo: Address; amount: bigint }) {
  const client = walletFor(params.account);
  await approveIfNeeded(client, WSTETH, params.ovrflo, params.amount);
  const hash = await client.writeContract({
    address: params.ovrflo,
    abi: ovrfloAbi,
    functionName: "wrap",
    args: [params.amount],
  });
  await mineAndGetReceipt(hash);
}

export async function depositPtForStream(params: { account: Address; ovrflo: Address; market: Address; ptToken: Address; ptAmount: bigint }) {
  const client = walletFor(params.account);
  await approveIfNeeded(client, params.ptToken, params.ovrflo, params.ptAmount);
  // Deposit pulls an underlying fee via safeTransferFrom (see OVRFLO.deposit
  // NatSpec: "User must approve both PT token and underlying (for fee)").
  // Over-approve by the full ptAmount — fee is feeBps of the immediate
  // portion only, so this is always enough and avoids a separate quote.
  await approveIfNeeded(client, WSTETH, params.ovrflo, params.ptAmount);
  const hash = await client.writeContract({
    address: params.ovrflo,
    abi: ovrfloAbi,
    functionName: "deposit",
    args: [params.market, params.ptAmount, 0n],
  });
  const receipt = await mineAndGetReceipt(hash);
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: ovrfloAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Deposited") {
        return (decoded.args as { streamId: bigint }).streamId;
      }
    } catch {
      // Expected for logs from other contracts (ERC20 Transfer, Sablier CreateLockupLinearStream).
    }
  }
  throw new Error("deposit receipt did not contain a Deposited event");
}

// Sablier streams are Ponder-indexed (see CONCEPTS.md's `Ponder` entry), not
// a direct on-chain read — a stream just deposited above genuinely does not
// exist yet from the frontend's point of view until Ponder's own poll cycle
// (ponder.config.ts's `pollingInterval: 2_000`) notices the new block,
// processes the event, and commits it. Reloading the page immediately after
// deposit only forces a *fresh* fetch; it does nothing if that fetch still
// lands before Ponder has caught up. Callers that arrange a stream a
// scenario later depends on must await this before triggering "the frontend
// re-syncs with chain state", or the reload races the indexer and still
// finds nothing.
// Queries Ponder's SQL-over-HTTP endpoint directly with a plain `fetch`
// rather than importing the app's own `@/lib/ponder` (which pulls in
// `@ponder/client`) — that package's package.json has no `exports` entry
// resolvable outside Next.js's bundler, so importing it from Playwright's
// plain Node runtime throws `No "exports" main defined`. This replicates
// `fetchHeldStreamIds`'s query (same table/columns) independently.
async function ponderHasStream(recipient: Address, streamId: bigint): Promise<boolean> {
  const payload = {
    json: {
      sql: "select stream_id from sablier_streams where recipient = $1 and stream_id = $2 and canceled = false and depleted = false limit $3",
      params: [recipient.toLowerCase(), streamId.toString(), 1],
      typings: ["none", "none", "none"],
    },
  };
  const ponderUrl = process.env.E2E_PONDER_URL ?? "http://localhost:42069/sql";
  const url = `${ponderUrl}/db?sql=${encodeURIComponent(JSON.stringify(payload))}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const body = (await res.json()) as { rows?: unknown[] };
  return Boolean(body.rows?.length);
}

export async function waitForHeldStream(recipient: Address, streamId: bigint, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ponderHasStream(recipient, streamId)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`waitForHeldStream: Ponder never indexed stream ${streamId} for ${recipient} within ${timeoutMs}ms`);
}

// The discounted price of a stream's full remaining face value (see
// StreamPricing.grossPrice) — a function of the live-discovered market's PT
// rate and time-to-maturity, NOT the PT amount deposited (OVRFLO.deposit
// streams only the discount fraction, `_computeSplit`'s `toStream`). Callers
// that need to borrow a genuinely *partial* amount against a fresh stream
// (so `createBorrowerLoanPool`'s obligation stays proportional to the
// borrow rather than jumping to the full-borrow branch, which sets
// obligation = the entire remaining stream) must size their target against
// this, not a hardcoded absolute.
export async function readStreamGrossPrice(params: {
  lending: Address;
  market: Address;
  streamId: bigint;
  aprBps: number;
}) {
  const [grossPrice] = await publicClient.readContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: [params.market, params.streamId, params.aprBps, 0n],
  });
  return grossPrice;
}

// Full borrow flow (approve stream, quote, gather, createBorrowerLoanPool) as
// `account` — arrangement for repay-close.feature, which needs an existing
// open loan before REPAY/CLOSE are meaningful actions.
export async function borrowAgainstStream(params: {
  account: Address;
  lending: Address;
  market: Address;
  streamId: bigint;
  aprBps: number;
  targetBorrow: bigint;
}) {
  const client = walletFor(params.account);
  const alreadyApproved = await publicClient.readContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getApproved",
    args: [params.streamId],
  });
  if (alreadyApproved.toLowerCase() !== params.lending.toLowerCase()) {
    const approveHash = await client.writeContract({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "approve",
      args: [params.lending, params.streamId],
    });
    await mineAndGetReceipt(approveHash);
  }

  const [grossPrice] = await publicClient.readContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: [params.market, params.streamId, params.aprBps, 0n],
  });
  const fill = grossPrice < params.targetBorrow ? grossPrice : params.targetBorrow;

  const [, , , netToBorrower] = await publicClient.readContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: [params.market, params.streamId, params.aprBps, fill],
  });
  const [ids, sufficient] = await publicClient.readContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "gatherLiquidity",
    args: [params.market, params.aprBps, fill, 1n, params.account],
  });
  if (!sufficient || ids.length === 0) {
    throw new Error("borrowAgainstStream: gatherLiquidity found insufficient posted liquidity — supply more first");
  }
  const minAcceptable = (netToBorrower * 99n) / 100n; // 1% slippage, arrangement only

  // `eth_estimateGas`'s result here sits close enough to the true minimum
  // that it occasionally under-shoots by the time the tx actually mines a
  // moment later (fill/minAcceptable drift by a few wei as real time passes,
  // which is enough to flip an SSTORE between its cheap and expensive gas
  // cost) — the shortfall then surfaces as an out-of-gas revert right at the
  // nonReentrant guard's exit, immediately after all of the function's real
  // work (including the BorrowerLoanPoolCreated emit) has already run. Padding
  // the estimate is the standard wallet-side mitigation for this class of
  // gas-estimation flakiness.
  const estimatedGas = await publicClient.estimateContractGas({
    account: params.account,
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "createBorrowerLoanPool",
    args: [ids, params.streamId, fill, minAcceptable],
  });
  const hash = await client.writeContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "createBorrowerLoanPool",
    args: [ids, params.streamId, fill, minAcceptable],
    gas: (estimatedGas * 130n) / 100n,
  });
  const receipt = await mineAndGetReceipt(hash);
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: ovrfloLendingAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "BorrowerLoanPoolCreated") {
        return (decoded.args as { loanId: bigint }).loanId;
      }
    } catch {
      // Expected for logs from other contracts.
    }
  }
  throw new Error("createBorrowerLoanPool receipt did not contain a BorrowerLoanPoolCreated event");
}

export async function readLoan(lending: Address, loanId: bigint) {
  const [borrower, streamId, obligation, drawn, repaid, closed] = await publicClient.readContract({
    address: lending,
    abi: ovrfloLendingAbi,
    functionName: "loans",
    args: [loanId],
  });
  return { borrower, streamId, obligation, drawn, repaid, closed };
}

// Fully repays a loan directly (bypassing the UI) — used to race an
// already-open REPAY modal so it discovers "LOAN NOT FOUND" once the
// borrower-loan list refetches, mirroring the claim-all "claimed elsewhere"
// pattern for the repay/close journey.
export async function repayLoanFully(params: { account: Address; lending: Address; loanId: bigint; ovrfloToken: Address }) {
  const loan = await readLoan(params.lending, params.loanId);
  const satisfied = loan.drawn + loan.repaid;
  const outstanding = satisfied >= loan.obligation ? 0n : loan.obligation - satisfied;
  if (outstanding === 0n) return;
  const client = walletFor(params.account);
  // repayLoan pulls ovrfloToken via safeTransferFrom (src/OVRFLOLending.sol's
  // `_pullExact`), same as the UI's own "APPROVE REPAY" step — this direct
  // fixture call bypasses the UI entirely, so it must approve itself first.
  await approveIfNeeded(client, params.ovrfloToken, params.lending, outstanding);
  const hash = await client.writeContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "repayLoan",
    args: [params.loanId, outstanding],
  });
  await mineAndGetReceipt(hash);
}
