import { parseEther, formatUnits } from 'viem'

/**
 * Minimum PT amount required for deposits (from OVFL.sol)
 * Contract default: 0.01 ether
 */
export const MIN_PT_AMOUNT = parseEther('0.01')

/**
 * Maximum decimal places for PT tokens
 */
export const MAX_DECIMALS = 18

/**
 * Validation error types
 */
export type ValidationError =
  | { type: 'below_minimum'; min: bigint; provided: bigint }
  | { type: 'above_balance'; balance: bigint; provided: bigint }
  | { type: 'invalid_number'; input: string }
  | { type: 'too_many_decimals'; max: number; provided: number }
  | { type: 'zero_amount' }
  | { type: 'empty_input' }
  | { type: 'negative_amount' }

export type ValidationResult =
  | { valid: true; amount: bigint }
  | { valid: false; error: ValidationError }

/**
 * Validate PT amount for deposits
 */
export function validatePTAmount(
  input: string,
  balance: bigint,
  minAmount: bigint = MIN_PT_AMOUNT
): ValidationResult {
  // Empty input
  if (!input || input.trim() === '') {
    return { valid: false, error: { type: 'empty_input' } }
  }

  const trimmed = input.trim()

  // Check for valid number format (allow leading/trailing zeros, single decimal)
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') {
    return { valid: false, error: { type: 'invalid_number', input: trimmed } }
  }

  // Check for negative (shouldn't happen with regex but be safe)
  if (trimmed.startsWith('-')) {
    return { valid: false, error: { type: 'negative_amount' } }
  }

  // Check decimal precision
  const decimalPart = trimmed.split('.')[1]
  if (decimalPart && decimalPart.length > MAX_DECIMALS) {
    return {
      valid: false,
      error: { type: 'too_many_decimals', max: MAX_DECIMALS, provided: decimalPart.length }
    }
  }

  // Parse amount
  let amount: bigint
  try {
    // Handle edge cases like "." or empty after decimal
    const normalized = trimmed === '' || trimmed === '.' ? '0' : trimmed
    amount = parseEther(normalized)
  } catch {
    return { valid: false, error: { type: 'invalid_number', input: trimmed } }
  }

  // Zero amount
  if (amount === 0n) {
    return { valid: false, error: { type: 'zero_amount' } }
  }

  // Below minimum
  if (amount < minAmount) {
    return {
      valid: false,
      error: { type: 'below_minimum', min: minAmount, provided: amount }
    }
  }

  // Above balance
  if (amount > balance) {
    return {
      valid: false,
      error: { type: 'above_balance', balance, provided: amount }
    }
  }

  return { valid: true, amount }
}

/**
 * Format validation error into user-friendly message
 */
export function formatValidationError(error: ValidationError): string {
  switch (error.type) {
    case 'empty_input':
      return 'Please enter an amount'
    case 'zero_amount':
      return 'Amount must be greater than 0'
    case 'below_minimum':
      return `Minimum deposit is ${formatUnits(error.min, 18)} PT`
    case 'above_balance':
      return `Insufficient balance. You have ${formatUnits(error.balance, 18)} PT`
    case 'invalid_number':
      return `Invalid number: "${error.input}"`
    case 'too_many_decimals':
      return `Maximum ${error.max} decimal places allowed`
    case 'negative_amount':
      return 'Amount cannot be negative'
  }
}

/**
 * Calculate minimum toUser with slippage protection
 * @param expectedToUser - Expected amount from previewDeposit
 * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
 */
export function calculateMinToUser(
  expectedToUser: bigint,
  slippageBps: number = 50
): bigint {
  if (expectedToUser === 0n) return 0n
  const slippageMultiplier = BigInt(10000 - slippageBps)
  return (expectedToUser * slippageMultiplier) / 10000n
}

/**
 * Format number for display with proper decimals
 */
export function formatAmount(amount: bigint, decimals: number = 18, displayDecimals: number = 4): string {
  const formatted = formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals
  })
}

/**
 * Parse user input safely, handling edge cases
 */
export function safeParseAmount(input: string): bigint | null {
  try {
    const trimmed = input.trim()
    if (!trimmed || trimmed === '.' || !/^\d*\.?\d*$/.test(trimmed)) {
      return null
    }
    return parseEther(trimmed || '0')
  } catch {
    return null
  }
}
