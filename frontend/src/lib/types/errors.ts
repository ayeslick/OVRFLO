import { formatUnits } from 'viem'

/**
 * Discriminated union error types for Web3 operations
 * Provides type-safe error handling with user-friendly messages
 */
export type Web3Error =
  | { type: 'user_rejected'; code: 4001 }
  | { type: 'insufficient_balance'; token: string; required: bigint; actual: bigint }
  | { type: 'insufficient_allowance'; token: string; spender: string; required: bigint; actual: bigint }
  | { type: 'contract_revert'; reason: string; data?: string }
  | { type: 'network_error'; message: string; code?: number }
  | { type: 'timeout'; operation: string }
  | { type: 'market_expired'; expiry: number }
  | { type: 'market_not_approved'; market: string }
  | { type: 'slippage_exceeded'; expected: bigint; actual: bigint; slippage: number }
  | { type: 'unknown'; error: Error }

export type DepositError = Web3Error |
  { type: 'min_amount_not_met'; minAmount: bigint; provided: bigint } |
  { type: 'deposit_limit_exceeded'; limit: bigint; requested: bigint; current: bigint } |
  { type: 'nothing_to_stream' }

export type ClaimError = Web3Error |
  { type: 'not_matured'; expiry: number; currentTime: number } |
  { type: 'insufficient_ovfl_balance'; required: bigint; actual: bigint } |
  { type: 'insufficient_pt_reserves'; required: bigint; available: bigint } |
  { type: 'zero_amount' }

/**
 * Format Web3Error into user-friendly message
 */
export function formatError(error: Web3Error): string {
  switch (error.type) {
    case 'user_rejected':
      return 'Transaction was rejected in your wallet'
    case 'insufficient_balance':
      return `Insufficient ${error.token} balance. Need ${formatUnits(error.required, 18)} but have ${formatUnits(error.actual, 18)}`
    case 'insufficient_allowance':
      return `Approval needed for ${error.token}`
    case 'contract_revert':
      return `Transaction failed: ${error.reason}`
    case 'network_error':
      return `Network error: ${error.message}. Please check your connection.`
    case 'timeout':
      return `Operation timed out: ${error.operation}. Please try again.`
    case 'market_expired':
      return `Market expired at ${new Date(error.expiry * 1000).toLocaleString()}. Please select a different market.`
    case 'market_not_approved':
      return `Market ${error.market} is not approved for deposits.`
    case 'slippage_exceeded':
      return `Price moved too much (${error.slippage}% slippage). Try again with higher slippage tolerance.`
    case 'unknown':
      return error.error?.message || 'An unexpected error occurred. Please try again.'
  }
}

/**
 * Format DepositError into user-friendly message
 */
export function formatDepositError(error: DepositError): string {
  switch (error.type) {
    case 'min_amount_not_met':
      return `Minimum deposit is ${formatUnits(error.minAmount, 18)} PT`
    case 'deposit_limit_exceeded':
      return `Deposit limit exceeded. Limit: ${formatUnits(error.limit, 18)}, Current: ${formatUnits(error.current, 18)}, Requested: ${formatUnits(error.requested, 18)}`
    case 'nothing_to_stream':
      return 'Amount too small - nothing would be streamed. Try a larger amount.'
    default:
      return formatError(error as Web3Error)
  }
}

/**
 * Format ClaimError into user-friendly message
 */
export function formatClaimError(error: ClaimError): string {
  switch (error.type) {
    case 'not_matured':
      const timeRemaining = error.expiry - error.currentTime
      const days = Math.floor(timeRemaining / 86400)
      const hours = Math.floor((timeRemaining % 86400) / 3600)
      return `Market matures in ${days}d ${hours}h. Claims available after ${new Date(error.expiry * 1000).toLocaleDateString()}.`
    case 'insufficient_ovfl_balance':
      return `Insufficient ovflETH balance. You have ${formatUnits(error.actual, 18)} but need ${formatUnits(error.required, 18)}.`
    case 'insufficient_pt_reserves':
      return `Insufficient PT reserves in vault. Available: ${formatUnits(error.available, 18)}, requested: ${formatUnits(error.required, 18)}.`
    case 'zero_amount':
      return 'Please enter an amount to claim.'
    default:
      return formatError(error as Web3Error)
  }
}

/**
 * Classify unknown errors into typed Web3Error
 */
export function classifyError(error: unknown): Web3Error {
  if (!error || typeof error !== 'object') {
    return { type: 'unknown', error: new Error(String(error)) }
  }

  const err = error as Record<string, unknown>

  // User rejection (MetaMask, WalletConnect, etc.)
  if (
    err.name === 'UserRejectedRequestError' ||
    err.code === 4001 ||
    (err.cause as Record<string, unknown>)?.code === 4001 ||
    String(err.message).includes('User rejected') ||
    String(err.message).includes('user rejected')
  ) {
    return { type: 'user_rejected', code: 4001 }
  }

  // Contract revert
  if (
    err.name === 'ContractFunctionExecutionError' ||
    err.name === 'ContractFunctionRevertedError' ||
    String(err.message).includes('reverted')
  ) {
    const reason = extractRevertReason(err)
    return {
      type: 'contract_revert',
      reason: reason || 'Transaction reverted',
      data: err.data as string | undefined
    }
  }

  // Network errors
  if (
    String(err.message).toLowerCase().includes('network') ||
    String(err.message).toLowerCase().includes('timeout') ||
    String(err.message).toLowerCase().includes('connection') ||
    String(err.message).toLowerCase().includes('fetch')
  ) {
    return {
      type: 'network_error',
      message: extractMessage(err),
      code: err.code as number | undefined
    }
  }

  // Insufficient funds (from wallet)
  if (String(err.message).toLowerCase().includes('insufficient funds')) {
    return {
      type: 'insufficient_balance',
      token: 'ETH',
      required: 0n,
      actual: 0n
    }
  }

  return { type: 'unknown', error: err as unknown as Error }
}

/**
 * Extract revert reason from error
 */
function extractRevertReason(err: Record<string, unknown>): string | null {
  // Try shortMessage first (viem)
  if (typeof err.shortMessage === 'string') {
    return err.shortMessage
  }

  // Try to parse from message
  const message = String(err.message)
  
  // Match OVFL-specific revert reasons
  const ovflReasons = [
    'OVFL: market not approved',
    'OVFL: amount < min PT',
    'OVFL: matured',
    'OVFL: deposit limit exceeded',
    'OVFL: nothing to stream',
    'OVFL: slippage',
    'OVFL: unknown PT',
    'OVFL: not matured',
    'OVFL: amount is zero',
    'OVFL: insufficient PT reserves',
    'OVFL: deposit accounting'
  ]

  for (const reason of ovflReasons) {
    if (message.includes(reason)) {
      return reason
    }
  }

  // Generic revert reason extraction
  const match = message.match(/reason="([^"]+)"/) ||
                message.match(/reverted with reason string '([^']+)'/) ||
                message.match(/Error: ([^(]+)/)

  return match?.[1] || null
}

/**
 * Extract message from error object
 */
function extractMessage(err: Record<string, unknown>): string {
  if (typeof err.shortMessage === 'string') return err.shortMessage
  if (typeof err.message === 'string') return err.message
  return 'Unknown error'
}
