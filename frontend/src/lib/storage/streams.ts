/**
 * LocalStorage persistence for user stream IDs
 * Stores stream IDs indexed by wallet address for quick retrieval
 */

const STREAMS_KEY = 'ovfl_user_streams'

export interface StoredStream {
  streamId: string // Stored as string for JSON compatibility
  marketAddress: string
  ptAmount: string
  createdAt: number
  txHash: string
}

interface StreamStorage {
  [userAddress: string]: StoredStream[]
}

/**
 * Store a new stream ID for a user
 */
export function storeStreamId(
  userAddress: string,
  streamId: bigint,
  marketAddress: string,
  ptAmount: bigint,
  txHash: string
): void {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()

  if (!stored[userKey]) {
    stored[userKey] = []
  }

  // Check if stream already exists (avoid duplicates)
  const exists = stored[userKey].some(s => s.streamId === streamId.toString())
  if (exists) return

  stored[userKey].push({
    streamId: streamId.toString(),
    marketAddress,
    ptAmount: ptAmount.toString(),
    createdAt: Date.now(),
    txHash,
  })

  // Keep only last 100 streams per user
  if (stored[userKey].length > 100) {
    stored[userKey] = stored[userKey].slice(-100)
  }

  try {
    localStorage.setItem(STREAMS_KEY, JSON.stringify(stored))
  } catch (e) {
    console.warn('Failed to store stream ID:', e)
  }
}

/**
 * Get all stream IDs for a user
 */
export function getUserStreamIds(userAddress: string): bigint[] {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()
  const userStreams = stored[userKey] || []

  return userStreams.map(s => BigInt(s.streamId))
}

/**
 * Get full stream data for a user
 */
export function getUserStoredStreams(userAddress: string): StoredStream[] {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()
  return stored[userKey] || []
}

/**
 * Remove a stream from storage (e.g., when fully withdrawn)
 */
export function removeStreamId(userAddress: string, streamId: bigint): void {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()

  if (!stored[userKey]) return

  stored[userKey] = stored[userKey].filter(
    s => s.streamId !== streamId.toString()
  )

  try {
    localStorage.setItem(STREAMS_KEY, JSON.stringify(stored))
  } catch (e) {
    console.warn('Failed to remove stream ID:', e)
  }
}

/**
 * Clear all streams for a user
 */
export function clearUserStreams(userAddress: string): void {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()
  delete stored[userKey]

  try {
    localStorage.setItem(STREAMS_KEY, JSON.stringify(stored))
  } catch (e) {
    console.warn('Failed to clear user streams:', e)
  }
}

/**
 * Get all stored streams from localStorage
 */
function getStoredStreams(): StreamStorage {
  try {
    const stored = localStorage.getItem(STREAMS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}
