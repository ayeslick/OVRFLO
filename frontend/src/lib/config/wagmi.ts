import { http, fallback } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import type { PublicClient } from 'viem'

/**
 * Contract addresses (mainnet)
 */
export const OVFL_ADDRESS = '0x0000000000000000000000000000000000000000' as const // TODO: Update after deployment
export const ADMIN_ADDRESS = '0x0000000000000000000000000000000000000000' as const // TODO: Update after deployment
export const SABLIER_ADDRESS = '0x3962f6585946823440d274aD7C719B02b49DE51E' as const
export const PENDLE_ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2' as const

/**
 * RPC Configuration with fallback providers
 * Order: Alchemy (fastest) -> Infura -> Cloudflare (public)
 */
function createTransports() {
  const alchemyKey = import.meta.env.VITE_ALCHEMY_KEY
  const infuraKey = import.meta.env.VITE_INFURA_KEY

  const transports = []

  // Primary: Alchemy (if configured)
  if (alchemyKey) {
    transports.push(
      http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`, {
        timeout: 10_000,
        retryCount: 3,
        retryDelay: 1000,
      })
    )
  }

  // Secondary: Infura (if configured)
  if (infuraKey) {
    transports.push(
      http(`https://mainnet.infura.io/v3/${infuraKey}`, {
        timeout: 10_000,
        retryCount: 3,
        retryDelay: 1000,
      })
    )
  }

  // Tertiary: Cloudflare public RPC (always available)
  transports.push(
    http('https://cloudflare-eth.com', {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 2000,
    })
  )

  // Quaternary: LlamaNodes public RPC
  transports.push(
    http('https://eth.llamarpc.com', {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 2000,
    })
  )

  return transports
}

/**
 * Wagmi config with RPC fallback
 */
export const config = getDefaultConfig({
  appName: 'OVFL',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
  chains: [mainnet],
  transports: {
    [mainnet.id]: fallback(createTransports(), {
      rank: true, // Automatically rank providers by latency
      retryCount: 2,
    }),
  },
})

/**
 * Verify contracts are deployed on the network
 * Call on app initialization to catch configuration errors early
 */
export async function verifyContracts(publicClient: PublicClient): Promise<{
  valid: boolean
  errors: string[]
}> {
  const errors: string[] = []

  // Skip verification if using placeholder addresses
  if (OVFL_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.warn('OVFL_ADDRESS not configured - using placeholder')
    return { valid: true, errors: [] }
  }

  try {
    const [ovflCode, sablierCode] = await Promise.all([
      publicClient.getBytecode({ address: OVFL_ADDRESS }),
      publicClient.getBytecode({ address: SABLIER_ADDRESS }),
    ])

    if (!ovflCode || ovflCode === '0x') {
      errors.push('OVFL contract not found on this network')
    }

    if (!sablierCode || sablierCode === '0x') {
      errors.push('Sablier contract not found on this network')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  } catch (error) {
    console.error('Contract verification failed:', error)
    return {
      valid: false,
      errors: ['Failed to verify contracts: ' + (error as Error).message]
    }
  }
}

/**
 * Example markets for development/testing
 * In production, these would be fetched from the contract or an API
 */
export const EXAMPLE_MARKETS = [
  {
    address: '0x0000000000000000000000000000000000000001' as const,
    name: 'PT-stETH',
    underlying: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const, // WETH
    underlyingSymbol: 'ETH',
    expiry: Math.floor(new Date('2025-06-26').getTime() / 1000),
    ptToken: '0x0000000000000000000000000000000000000002' as const,
    ovflToken: '0x0000000000000000000000000000000000000003' as const,
    feeBps: 50, // 0.5%
  },
  {
    address: '0x0000000000000000000000000000000000000004' as const,
    name: 'PT-weETH',
    underlying: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const, // WETH
    underlyingSymbol: 'ETH',
    expiry: Math.floor(new Date('2025-06-26').getTime() / 1000),
    ptToken: '0x0000000000000000000000000000000000000005' as const,
    ovflToken: '0x0000000000000000000000000000000000000006' as const,
    feeBps: 50,
  },
] as const

export type Market = typeof EXAMPLE_MARKETS[number]
