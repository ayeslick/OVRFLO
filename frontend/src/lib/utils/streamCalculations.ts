/**
 * Client-side stream vesting calculations
 * No WebSockets needed - calculate progress from on-chain data
 */

export interface StreamData {
  streamId: bigint
  sender: string
  recipient: string
  totalAmount: bigint
  asset: string
  cancelable: boolean
  transferable: boolean
  startTime: number
  cliffTime: number
  endTime: number
  isCanceled: boolean
  isDepleted: boolean
  withdrawnAmount: bigint
}

/**
 * Calculate vested amount at a given timestamp
 * Uses linear vesting from startTime to endTime
 */
export function calculateVestedAmount(
  stream: StreamData,
  currentTime: number = Math.floor(Date.now() / 1000)
): bigint {
  const { startTime, endTime, totalAmount } = stream

  // Not started yet
  if (currentTime < startTime) {
    return 0n
  }

  // Fully vested
  if (currentTime >= endTime) {
    return totalAmount
  }

  // Linear vesting calculation
  const elapsed = BigInt(currentTime - startTime)
  const duration = BigInt(endTime - startTime)
  
  if (duration === 0n) return totalAmount
  
  const vested = (totalAmount * elapsed) / duration
  return vested
}

/**
 * Calculate withdrawable amount (vested - already withdrawn)
 */
export function calculateWithdrawableAmount(
  stream: StreamData,
  currentTime?: number
): bigint {
  const vested = calculateVestedAmount(stream, currentTime)
  const withdrawable = vested - stream.withdrawnAmount
  return withdrawable > 0n ? withdrawable : 0n
}

/**
 * Calculate progress percentage (0-100)
 */
export function calculateProgress(
  stream: StreamData,
  currentTime: number = Math.floor(Date.now() / 1000)
): number {
  const { startTime, endTime, totalAmount } = stream

  if (currentTime < startTime || totalAmount === 0n) {
    return 0
  }

  if (currentTime >= endTime) {
    return 100
  }

  const elapsed = currentTime - startTime
  const duration = endTime - startTime
  
  if (duration === 0) return 100
  
  return Math.min(100, (elapsed / duration) * 100)
}

/**
 * Calculate time remaining in human-readable format
 */
export function formatTimeRemaining(
  endTime: number,
  currentTime: number = Math.floor(Date.now() / 1000)
): string {
  const remaining = endTime - currentTime

  if (remaining <= 0) return 'Completed'

  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h remaining`
  if (hours > 0) return `${hours}h ${minutes}m remaining`
  return `${minutes}m remaining`
}

/**
 * Check if stream is active (not depleted, not canceled, has remaining balance)
 */
export function isStreamActive(stream: StreamData): boolean {
  if (stream.isCanceled || stream.isDepleted) return false
  if (stream.withdrawnAmount >= stream.totalAmount) return false
  return true
}

/**
 * Check if stream has withdrawable funds
 */
export function hasWithdrawableFunds(
  stream: StreamData,
  currentTime?: number
): boolean {
  return calculateWithdrawableAmount(stream, currentTime) > 0n
}
