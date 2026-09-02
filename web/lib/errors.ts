import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, UserRejectedRequestError } from "viem";
import { ovrfloAbi, ovrfloFactoryAbi, ovrfloLendingAbi, ovrfloReserveAbi } from "./generated";
import { MIN_LIQUIDITY_AMOUNT, MIN_STREAM_AMOUNT } from "./lending-math";

type AbiErrorName<T extends readonly { type?: string; name?: string }[]> = Extract<
  T[number],
  { type: "error"; name: string }
>["name"];

export type ContractErrorName =
  | AbiErrorName<typeof ovrfloAbi>
  | AbiErrorName<typeof ovrfloFactoryAbi>
  | AbiErrorName<typeof ovrfloLendingAbi>
  | AbiErrorName<typeof ovrfloReserveAbi>;

export type RecoveryAction = {
  id:
    | "refresh"
    | "change-amount"
    | "change-tick"
    | "change-stream"
    | "wait-cover"
    | "withdraw"
    | "reclaim-stream"
    | "reconnect"
    | "none";
  label: string;
};

export type ErrorSpec = {
  copy: string;
  recovery: RecoveryAction;
};

export type BelowMinimumKind = "fill-floor" | "stream-face";

export type BelowMinimumContext = {
  remaining?: bigint;
  minStreamAmount?: bigint;
  actualBorrow?: bigint;
  minLiquidity?: bigint;
};

const refresh: RecoveryAction = { id: "refresh", label: "Refresh and try again" };
const changeAmount: RecoveryAction = { id: "change-amount", label: "Change the amount" };
const changeTick: RecoveryAction = { id: "change-tick", label: "Pick a different rate" };
const changeStream: RecoveryAction = { id: "change-stream", label: "Choose a different stream" };
export const waitCover: RecoveryAction = { id: "wait-cover", label: "Wait until the stream covers the loan" };
export const withdraw: RecoveryAction = { id: "withdraw", label: "Withdraw unmatched capital" };
export const reclaim: RecoveryAction = { id: "reclaim-stream", label: "Reclaim the stream" };
export const reconnect: RecoveryAction = { id: "reconnect", label: "Reconnect and retry" };
export const none: RecoveryAction = { id: "none", label: "No action available" };

export const errorCatalog = {
  AlreadyRegistered: { copy: "This vault or market is already registered.", recovery: none },
  AprTooHigh: { copy: "APR is above the protocol limit.", recovery: changeTick },
  AtCapacity: { copy: "This tick epoch is at capacity. Try again after the cursor advances.", recovery: refresh },
  BadAprBounds: { copy: "APR bounds are invalid.", recovery: none },
  BadLaunchApr: { copy: "Launch APR is outside the allowed range or not on a 25 bps step.", recovery: none },
  BelowMinAcceptable: {
    copy: "The fill came in below your minimum acceptable amount.",
    recovery: changeAmount,
  },
  BelowMinimum: {
    copy: "This amount is below the minimum.",
    recovery: changeAmount,
  },
  BelowMinPT: { copy: "This PT deposit is below the minimum.", recovery: changeAmount },
  CancelableStream: { copy: "Cancelable streams are not eligible.", recovery: changeStream },
  CliffPresent: { copy: "Streams with cliffs are not eligible.", recovery: changeStream },
  ComptrollerAdminMismatch: {
    copy: "The stream comptroller is not administered by the factory.",
    recovery: none,
  },
  DepositLimitExceeded: { copy: "This deposit would exceed the market's deposit limit.", recovery: changeAmount },
  DepositedExceedsBalance: {
    copy: "The PT delivered to the vault is less than the deposit recorded. Nothing was changed.",
    recovery: refresh,
  },
  EmptyTick: { copy: "This rate has no resting liquidity. Pick a live tick.", recovery: changeTick },
  EpochBacklog: { copy: "This tick has an epoch backlog. Refresh and try again.", recovery: refresh },
  EpochMismatch: { copy: "Tick state changed since your quote. Refreshing market depth.", recovery: refresh },
  FactoryMismatch: { copy: "This contract is not bound to the expected factory.", recovery: none },
  FeeTooHigh: { copy: "Fee is above the protocol limit.", recovery: none },
  FlashCallbackFailed: { copy: "The flash-mint receiver did not complete the callback.", recovery: refresh },
  FlashExceedsMax: { copy: "This flash mint exceeds the current cap.", recovery: changeAmount },
  FlashFeeTooHigh: { copy: "Flash-mint fee is above the protocol limit.", recovery: none },
  FlashMintMaxTooHigh: { copy: "Flash-mint cap is above the protocol ceiling.", recovery: none },
  FlashSupplyChanged: {
    copy: "Flash mint did not restore token supply. Nothing was changed.",
    recovery: refresh,
  },
  InsufficientDeposited: { copy: "Not enough PT has been deposited for this claim.", recovery: changeAmount },
  InsufficientReserve: { copy: "The wrap reserve cannot cover this unwrap.", recovery: changeAmount },
  InvalidTick: { copy: "This APR is outside the market bounds or not on a supported step.", recovery: changeTick },
  LeafMissing: { copy: "This position's tape leaf is missing.", recovery: refresh },
  LendingExists: { copy: "A lending market is already registered for this vault.", recovery: none },
  LoanClosed: { copy: "This loan is already settled.", recovery: none },
  LoanMissing: { copy: "This loan does not exist.", recovery: refresh },
  MarketExpired: { copy: "This market has expired.", recovery: none },
  MarketNotApproved: { copy: "This market is not approved for OVRFLO.", recovery: changeStream },
  Matured: { copy: "This series has already matured.", recovery: none },
  NoCode: { copy: "The target contract has no code.", recovery: none },
  NoExcess: { copy: "There is no excess to sweep.", recovery: none },
  NoOverlap: { copy: "This position does not overlap that loan.", recovery: refresh },
  NodeOverflow: { copy: "The tick tree cannot accept this supply.", recovery: changeAmount },
  NotAdmin: { copy: "Only the factory admin can run this call.", recovery: none },
  NotCovered: { copy: "The stream has not vested enough to close this loan.", recovery: waitCover },
  NotLender: { copy: "Only the lender can withdraw this position.", recovery: none },
  NotMatured: { copy: "PT claims open at maturity.", recovery: none },
  NotUnitAligned: { copy: "Amount must be an exact UNIT multiple.", recovery: changeAmount },
  NothingToClaim: { copy: "There is nothing claimable yet.", recovery: none },
  NothingToStream: { copy: "This deposit has nothing left to stream.", recovery: changeAmount },
  NothingToWithdraw: {
    copy: "Nothing unmatched remains — this position is fully matched.",
    recovery: none,
  },
  OracleCardinalityRequired: { copy: "The oracle needs more observations before this market can be used.", recovery: none },
  OracleMismatch: { copy: "This vault's oracle does not match the factory oracle.", recovery: none },
  OracleNotReady: { copy: "The oracle is not ready for this market.", recovery: refresh },
  OvrfloStreamAlreadySet: { copy: "The factory stream binding is already set.", recovery: none },
  OvrfloStreamUnset: { copy: "The factory stream binding is not set.", recovery: none },
  OwnerMismatch: { copy: "This lending market is not owned by the factory.", recovery: none },
  PositionMissing: { copy: "This position does not exist.", recovery: refresh },
  PtAlreadyMapped: { copy: "This PT is already mapped to a series.", recovery: none },
  RemainingZero: { copy: "This stream has nothing remaining.", recovery: changeStream },
  RepayExceedsOutstanding: { copy: "Repayment cannot exceed outstanding debt.", recovery: changeAmount },
  ReserveExceedsBalance: {
    copy: "The reserve holds less underlying than it tracks. Nothing was changed.",
    recovery: refresh,
  },
  ReserveMismatch: {
    copy: "The candidate reserve is missing or is not bound to this column.",
    recovery: none,
  },
  SablierMismatch: { copy: "This lending market is not bound to the expected Sablier.", recovery: none },
  SeriesAlreadyConfigured: { copy: "This series is already configured.", recovery: none },
  SeriesMatured: { copy: "This market has already matured.", recovery: none },
  SlippageExceeded: { copy: "Price moved outside your limit.", recovery: refresh },
  SpacingAlreadySet: { copy: "Tick spacing is already set for this market.", recovery: none },
  SpacingUnset: { copy: "Tick spacing is not set for this market.", recovery: none },
  StreamAdminMismatch: { copy: "The stream admin is not the factory.", recovery: none },
  StreamFactoryMismatch: { copy: "The stream factory binding does not match.", recovery: none },
  StreamNotCanonical: { copy: "This stream is not the factory's canonical OVRFLOStream.", recovery: none },
  TokenMinterMismatch: {
    copy: "The candidate token's vault or reserve does not match this column.",
    recovery: none,
  },
  TransferMismatch: { copy: "Token transfer amount did not match the request.", recovery: refresh },
  TwapTooLong: { copy: "TWAP duration is above the allowed maximum.", recovery: none },
  TwapTooShort: { copy: "TWAP duration is below the allowed minimum.", recovery: none },
  UnderlyingAlreadyDeployed: { copy: "A vault for this underlying is already registered.", recovery: none },
  UnderlyingMismatch: { copy: "This vault's underlying does not match the registration.", recovery: none },
  UnknownCore: { copy: "This vault is not registered with the factory.", recovery: none },
  UnknownLending: { copy: "This lending market is not registered.", recovery: none },
  UnknownOvrflo: { copy: "This vault is not registered.", recovery: none },
  UnknownPT: { copy: "This PT is not mapped to a series.", recovery: none },
  UnsupportedFlashToken: { copy: "This token cannot be flash minted.", recovery: none },
  WrongAsset: { copy: "This stream pays the wrong asset.", recovery: changeStream },
  WrongEndTime: { copy: "This stream does not end at the PT maturity.", recovery: changeStream },
  WrongSender: { copy: "This stream was not created by this OVRFLO vault.", recovery: changeStream },
  ZeroAddress: { copy: "A required address was zero.", recovery: none },
  ZeroAmount: { copy: "Enter an amount greater than zero.", recovery: changeAmount },
  ZeroSpacing: { copy: "Tick spacing cannot be zero.", recovery: none },
  ZeroSteps: { copy: "Cursor advance requires a positive step count.", recovery: none },
  ZeroTarget: { copy: "Borrow amount must be greater than zero.", recovery: changeAmount },
} as const satisfies Record<ContractErrorName, ErrorSpec>;

function errorNamesFromAbi(abi: readonly { type?: string; name?: string }[]): string[] {
  const names: string[] = [];
  for (const entry of abi) {
    if (entry.type === "error" && entry.name) names.push(entry.name);
  }
  return names;
}

export const generatedErrorNames: readonly ContractErrorName[] = Array.from(
  new Set([
    ...errorNamesFromAbi(ovrfloAbi),
    ...errorNamesFromAbi(ovrfloFactoryAbi),
    ...errorNamesFromAbi(ovrfloLendingAbi),
    ...errorNamesFromAbi(ovrfloReserveAbi),
  ]),
) as ContractErrorName[];

for (const name of generatedErrorNames) {
  if (!(name in errorCatalog)) {
    throw new Error(`errors.ts: missing copy+recovery for ABI error ${name}`);
  }
}

export const eligibilityErrorNames = [
  "MarketNotApproved",
  "WrongSender",
  "WrongAsset",
  "WrongEndTime",
  "SeriesMatured",
  "CliffPresent",
  "CancelableStream",
  "RemainingZero",
] as const satisfies readonly ContractErrorName[];

export const STALE_LIQUIDITY_REASONS = [
  "OVRFLOLending: liquidity inactive",
  "OVRFLOLending: insufficient availableLiquidity",
  "OVRFLOLending: duplicate or unsorted ids",
  "OVRFLOLending: slippage",
] as const;

export const REBUILD_STALE_REASONS = [
  "routing-insufficient",
  "Reviewed route is no longer available",
  "snapshot-not-ready",
  "snapshot-block-mismatch",
  "snapshot-resource-mismatch",
] as const;

export const ABI_STALE_ERRORS = ["EmptyTick", "EpochMismatch", "SlippageExceeded", "BelowMinAcceptable"] as const;

const FILL_FLOOR_COPY = "This tick does not have enough resting liquidity to fill.";
const STREAM_FACE_COPY = "This stream's remaining value is below the minimum to borrow against.";

export function disambiguateBelowMinimum(context: BelowMinimumContext): BelowMinimumKind {
  const minStream = context.minStreamAmount ?? MIN_STREAM_AMOUNT;
  const minLiq = context.minLiquidity ?? MIN_LIQUIDITY_AMOUNT;
  if (context.remaining !== undefined && context.remaining < minStream) return "stream-face";
  if (context.actualBorrow !== undefined && context.actualBorrow < minLiq) return "fill-floor";
  if (context.remaining !== undefined) return "fill-floor";
  return "fill-floor";
}

export function belowMinimumCopy(kind: BelowMinimumKind): string {
  return kind === "stream-face" ? STREAM_FACE_COPY : FILL_FLOOR_COPY;
}

export type DecodedContractError = {
  name: ContractErrorName | null;
  copy: string;
  recovery: RecoveryAction;
};

export function specFor(name: ContractErrorName): ErrorSpec {
  return errorCatalog[name];
}

export function decodeContractError(error: unknown, context?: BelowMinimumContext): DecodedContractError {
  const reverted = findRevert(error);
  const errorName = reverted?.data?.errorName;
  if (errorName && errorName in errorCatalog) {
    const name = errorName as ContractErrorName;
    if (name === "BelowMinimum") {
      const kind = disambiguateBelowMinimum(context ?? {});
      return {
        name,
        copy: belowMinimumCopy(kind),
        recovery: kind === "stream-face" ? changeStream : changeTick,
      };
    }
    const spec = errorCatalog[name];
    return { name, copy: spec.copy, recovery: spec.recovery };
  }

  const message = error instanceof Error ? error.message : String(error);
  for (const [needle, copy] of Object.entries(legacyRevertCopy)) {
    if (message.includes(needle)) {
      return { name: null, copy, recovery: refresh };
    }
  }
  return {
    name: null,
    copy: "The transaction failed. Check the entered values and try again.",
    recovery: reconnect,
  };
}

const legacyRevertCopy: Record<string, string> = {
  "OVRFLOLending: liquidity inactive": "Liquidity changed since your quote. Refreshing market depth.",
  "OVRFLOLending: insufficient availableLiquidity": "This liquidity position cannot fill the quote.",
  "OVRFLOLending: duplicate or unsorted ids": "Liquidity IDs must be strictly increasing.",
  "OVRFLOLending: slippage": "Price moved outside your limit.",
  "OVRFLOLending: self-match": "You cannot borrow from your own liquidity.",
};

export function userFacingError(error: unknown, context?: BelowMinimumContext) {
  return decodeContractError(error, context).copy;
}

function findRevert(error: unknown): ContractFunctionRevertedError | undefined {
  if (error instanceof ContractFunctionRevertedError) return error;
  if (error instanceof BaseError) {
    return error.walk((cause) => cause instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | undefined;
  }
  return undefined;
}

export function isUserRejection(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof UserRejectedRequestError) return true;
  if (error instanceof BaseError && error.walk((cause) => cause instanceof UserRejectedRequestError)) return true;
  return (error as { code?: unknown }).code === 4001;
}

export function isRevertFailure(error: unknown, revertedOnChain = false): boolean {
  if (revertedOnChain) return true;
  if (!error || isUserRejection(error)) return false;
  if (findRevert(error)) return true;
  if (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /revert/i.test(message);
}
