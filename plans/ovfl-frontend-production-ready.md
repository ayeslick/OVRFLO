# OVFL Frontend: Production-Ready Implementation (Revised)

## Executive Summary

This is a **revised, production-ready plan** that addresses critical feedback from code review. The original 13-day timeline was unrealistic for the scope. This plan breaks the work into **3 separate phases over 20-25 days**, with each phase fully tested, secure, and deployable.

**Key Changes from Original Plan**:
- ❌ **Removed Next.js migration** - Staying with Vite (DHH feedback: no SEO benefit for wallet-gated app)
- ✅ **Added comprehensive test examples** - Every feature includes unit, integration, and E2E tests
- ✅ **Fixed security issues** - Slippage protection, input validation, XSS prevention, contract verification
- ✅ **Proper error typing** - Discriminated unions instead of strings
- ✅ **Edge case handling** - Market expiry, partial approvals, network failures, wallet disconnects
- ✅ **Realistic timeline** - 20-25 days broken into 3 shippable phases

## Three-Phase Approach

### Phase 1: Bulletproof Deposit Flow (8-10 days)
**Goal**: Ship a production-ready deposit experience that handles all edge cases

**Deliverables**:
- Complete deposit flow with approval handling
- Comprehensive error handling with proper types
- Full test coverage (unit + integration + E2E)
- Security validations (slippage, input, contract verification)
- Deployment to testnet + mainnet

### Phase 2: Stream Management (6-8 days)
**Goal**: Add Sablier stream viewing and withdrawals

**Deliverables**:
- Stream fetching from Sablier (contract reads + optional GraphQL)
- Real-time progress calculation (client-side)
- Withdrawal functionality with error handling
- Full test coverage
- Integration with Phase 1

### Phase 3: Visual Polish & Optimization (6-7 days)
**Goal**: Improve UX, performance, and accessibility

**Deliverables**:
- Improved component design (staying with Tailwind, no shadcn/ui unless needed)
- Performance optimizations (caching, prefetching)
- Accessibility audit (WCAG 2.1 AA)
- Mobile optimization
- Analytics and monitoring

---

## Technology Stack (Revised)

### Keep (No Changes)
- ✅ **Vite** - Fast, simple, perfect for DeFi SPAs
- ✅ **React 18** - Current standard
- ✅ **TypeScript (strict mode)** - Type safety
- ✅ **wagmi v2 + viem** - Web3 standard
- ✅ **RainbowKit** - Wallet connection
- ✅ **Tailwind CSS v3** - Current setup works
- ✅ **Framer Motion** - Already integrated

### Add (Proven Value)
- ➕ **TanStack Query v5** - Essential for API caching
- ➕ **Sonner** - Toast notifications
- ➕ **Vitest** - Fast unit testing
- ➕ **Playwright** - E2E testing
- ➕ **Sentry** - Error tracking

### Remove (Unnecessary Complexity)
- ❌ Next.js 15 - No SSR benefit
- ❌ shadcn/ui - Premature, use if needed later
- ❌ Recharts - Progress bars sufficient for MVP
- ❌ WebSockets - Polling + refetch on action is enough

---

# Phase 1: Bulletproof Deposit Flow (8-10 days)

## Overview

Build a production-ready deposit experience that users can trust. Every error case handled, every edge case tested, every security concern addressed.

## Day 1-2: Error Type System & Core Infrastructure

### 1.1: Discriminated Union Error Types

**Problem (from Kieran review)**: Original plan used `string` errors, losing type information.

**Solution**:

```typescript
// lib/types/errors.ts
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
  | { type: 'min_amount_not_met'; minAmount: bigint; provided: bigint }
  | { type: 'deposit_limit_exceeded'; limit: bigint; requested: bigint; current: bigint }

// User-friendly error messages
export function formatError(error: Web3Error): string {
  switch (error.type) {
    case 'user_rejected':
      return 'Transaction was rejected in your wallet'
    case 'insufficient_balance':
      return `Insufficient ${error.token} balance. Need ${formatUnits(error.required, 18)} but have ${formatUnits(error.actual, 18)}`
    case 'contract_revert':
      return `Transaction failed: ${error.reason}`
    case 'network_error':
      return `Network error: ${error.message}. Please check your connection.`
    case 'market_expired':
      return `Market expired at ${new Date(error.expiry * 1000).toLocaleString()}. Please select a different market.`
    case 'slippage_exceeded':
      return `Price moved too much (${error.slippage}% slippage). Try again with higher slippage tolerance.`
    default:
      return 'An unexpected error occurred. Please try again.'
  }
}

// Error classification helper
export function classifyError(error: unknown): Web3Error {
  if (error && typeof error === 'object') {
    const baseError = error as BaseError

    // User rejection
    if (baseError.name === 'UserRejectedRequestError' ||
        (baseError as any).code === 4001) {
      return { type: 'user_rejected', code: 4001 }
    }

    // Contract revert
    if (baseError.name === 'ContractFunctionExecutionError') {
      return {
        type: 'contract_revert',
        reason: baseError.shortMessage || 'Transaction reverted',
        data: (baseError as any).data
      }
    }

    // Network issues
    if (baseError.message?.includes('network') || baseError.message?.includes('timeout')) {
      return {
        type: 'network_error',
        message: baseError.message,
        code: (baseError as any).code
      }
    }
  }

  return { type: 'unknown', error: error as Error }
}
```

**Tests**:

```typescript
// __tests__/lib/errors.test.ts
import { describe, it, expect } from 'vitest'
import { classifyError, formatError } from '@/lib/types/errors'

describe('Error Classification', () => {
  it('should classify user rejection', () => {
    const error = { name: 'UserRejectedRequestError', code: 4001 }
    const classified = classifyError(error)

    expect(classified.type).toBe('user_rejected')
    expect(formatError(classified)).toBe('Transaction was rejected in your wallet')
  })

  it('should classify insufficient balance with details', () => {
    const error: Web3Error = {
      type: 'insufficient_balance',
      token: 'PT-stETH',
      required: parseEther('10'),
      actual: parseEther('5')
    }

    expect(formatError(error)).toContain('Insufficient PT-stETH balance')
    expect(formatError(error)).toContain('Need 10.0')
    expect(formatError(error)).toContain('have 5.0')
  })

  it('should handle contract reverts', () => {
    const error = {
      name: 'ContractFunctionExecutionError',
      shortMessage: 'OVFL: market not approved'
    }
    const classified = classifyError(error)

    expect(classified.type).toBe('contract_revert')
    expect(formatError(classified)).toContain('market not approved')
  })
})
```

### 1.2: RPC Provider Fallback Configuration

**Problem (from Kieran review)**: Plan mentions fallback but doesn't show implementation.

**Solution**:

```typescript
// lib/config/wagmi.ts
import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

// Environment variables for RPC URLs
const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY
const INFURA_KEY = import.meta.env.VITE_INFURA_KEY

export const config = getDefaultConfig({
  appName: 'OVFL',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [mainnet],
  transports: {
    [mainnet.id]: fallback([
      http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, {
        timeout: 10_000,
        retryCount: 3,
      }),
      http(`https://mainnet.infura.io/v3/${INFURA_KEY}`, {
        timeout: 10_000,
        retryCount: 3,
      }),
      http('https://cloudflare-eth.com', {
        timeout: 15_000,
        retryCount: 2,
      }),
    ], {
      rank: true, // Automatically rank by latency
      retryCount: 2,
    }),
  },
})

// Contract addresses with verification
export const OVFL_ADDRESS = '0x...' as const // TODO: Update after deployment
export const SABLIER_ADDRESS = '0x3962f6585946823440d274aD7C719B02b49DE51E' as const

// Verify contracts are deployed
export async function verifyContracts(publicClient: PublicClient): Promise<boolean> {
  try {
    const [ovflCode, sablierCode] = await Promise.all([
      publicClient.getBytecode({ address: OVFL_ADDRESS }),
      publicClient.getBytecode({ address: SABLIER_ADDRESS }),
    ])

    if (!ovflCode || ovflCode === '0x') {
      throw new Error('OVFL contract not found on this network')
    }

    if (!sablierCode || sablierCode === '0x') {
      throw new Error('Sablier contract not found on this network')
    }

    return true
  } catch (error) {
    console.error('Contract verification failed:', error)
    return false
  }
}
```

**Tests**:

```typescript
// __tests__/lib/config.test.ts
import { describe, it, expect, vi } from 'vitest'
import { verifyContracts } from '@/lib/config/wagmi'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

describe('Contract Verification', () => {
  it('should verify deployed contracts', async () => {
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http('https://cloudflare-eth.com')
    })

    // This will fail until contracts are deployed
    // Replace with mock for unit testing
    const mockClient = {
      getBytecode: vi.fn()
        .mockResolvedValueOnce('0x608060...') // OVFL bytecode
        .mockResolvedValueOnce('0x608060...') // Sablier bytecode
    }

    const result = await verifyContracts(mockClient as any)
    expect(result).toBe(true)
  })

  it('should fail if OVFL contract not deployed', async () => {
    const mockClient = {
      getBytecode: vi.fn()
        .mockResolvedValueOnce('0x') // No bytecode
        .mockResolvedValueOnce('0x608060...')
    }

    const result = await verifyContracts(mockClient as any)
    expect(result).toBe(false)
  })
})
```

### 1.3: Input Validation & Security

**Problem (from Kieran review)**: No input validation for PT amounts, decimal precision, etc.

**Solution**:

```typescript
// lib/utils/validation.ts
import { parseEther, formatUnits } from 'viem'

export const MIN_PT_AMOUNT = parseEther('0.1') // From OVFL.sol
export const MAX_DECIMALS = 18

export type ValidationError =
  | { type: 'below_minimum'; min: bigint; provided: bigint }
  | { type: 'above_balance'; balance: bigint; provided: bigint }
  | { type: 'invalid_number'; input: string }
  | { type: 'too_many_decimals'; max: number; provided: number }
  | { type: 'zero_amount' }

export function validatePTAmount(
  input: string,
  balance: bigint
): { valid: true; amount: bigint } | { valid: false; error: ValidationError } {
  // Empty input
  if (!input || input.trim() === '') {
    return { valid: false, error: { type: 'zero_amount' } }
  }

  // Check for valid number format
  if (!/^\d+\.?\d*$/.test(input)) {
    return { valid: false, error: { type: 'invalid_number', input } }
  }

  // Check decimal precision
  const decimalPart = input.split('.')[1]
  if (decimalPart && decimalPart.length > MAX_DECIMALS) {
    return {
      valid: false,
      error: { type: 'too_many_decimals', max: MAX_DECIMALS, provided: decimalPart.length }
    }
  }

  let amount: bigint
  try {
    amount = parseEther(input)
  } catch {
    return { valid: false, error: { type: 'invalid_number', input } }
  }

  // Zero amount
  if (amount === 0n) {
    return { valid: false, error: { type: 'zero_amount' } }
  }

  // Below minimum
  if (amount < MIN_PT_AMOUNT) {
    return {
      valid: false,
      error: { type: 'below_minimum', min: MIN_PT_AMOUNT, provided: amount }
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

export function formatValidationError(error: ValidationError): string {
  switch (error.type) {
    case 'zero_amount':
      return 'Please enter an amount'
    case 'below_minimum':
      return `Minimum deposit is ${formatUnits(error.min, 18)} PT`
    case 'above_balance':
      return `Insufficient balance. You have ${formatUnits(error.balance, 18)} PT`
    case 'invalid_number':
      return `Invalid number: ${error.input}`
    case 'too_many_decimals':
      return `Maximum ${error.max} decimal places`
  }
}

// Slippage protection (addresses Kieran security concern)
export function calculateMinToUser(
  expectedToUser: bigint,
  slippageBps: number = 50 // 0.5% default
): bigint {
  const slippageMultiplier = BigInt(10000 - slippageBps)
  return (expectedToUser * slippageMultiplier) / 10000n
}
```

**Tests**:

```typescript
// __tests__/lib/validation.test.ts
import { describe, it, expect } from 'vitest'
import { validatePTAmount, calculateMinToUser, MIN_PT_AMOUNT } from '@/lib/utils/validation'
import { parseEther } from 'viem'

describe('PT Amount Validation', () => {
  const balance = parseEther('100')

  it('should validate correct amount', () => {
    const result = validatePTAmount('10', balance)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.amount).toBe(parseEther('10'))
    }
  })

  it('should reject zero amount', () => {
    const result = validatePTAmount('0', balance)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.type).toBe('zero_amount')
    }
  })

  it('should reject below minimum', () => {
    const result = validatePTAmount('0.05', balance)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.type).toBe('below_minimum')
    }
  })

  it('should reject above balance', () => {
    const result = validatePTAmount('150', balance)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.type).toBe('above_balance')
    }
  })

  it('should reject too many decimals', () => {
    const result = validatePTAmount('1.1234567890123456789', balance)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error.type).toBe('too_many_decimals')
    }
  })

  it('should reject invalid numbers', () => {
    expect(validatePTAmount('abc', balance).valid).toBe(false)
    expect(validatePTAmount('1.2.3', balance).valid).toBe(false)
    expect(validatePTAmount('1e18', balance).valid).toBe(false)
  })
})

describe('Slippage Protection', () => {
  it('should calculate minToUser with default slippage', () => {
    const expected = parseEther('10')
    const min = calculateMinToUser(expected) // 0.5% slippage

    expect(min).toBe(parseEther('9.95'))
  })

  it('should calculate minToUser with custom slippage', () => {
    const expected = parseEther('10')
    const min = calculateMinToUser(expected, 100) // 1% slippage

    expect(min).toBe(parseEther('9.9'))
  })
})
```

**Acceptance Criteria Day 1-2**:
- [ ] Error types defined with discriminated unions
- [ ] Error classification and formatting functions
- [ ] RPC fallback configuration with 3 providers
- [ ] Contract verification on app load
- [ ] Input validation for PT amounts (min, max, decimals)
- [ ] Slippage protection calculation
- [ ] Unit tests for all validation logic (>90% coverage)

---

## Day 3-5: Approval Flow with Edge Case Handling

### 2.1: Robust Approval Hook

**Problem (from reviews)**: Original plan had pseudocode `waitForApproval`. Need real implementation.

**Solution**:

```typescript
// hooks/shared/useTokenApproval.ts
import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { type Web3Error, classifyError } from '@/lib/types/errors'

interface UseTokenApprovalParams {
  tokenAddress: Address
  spender: Address
  amount: bigint
  enabled?: boolean
}

type ApprovalState = 'idle' | 'checking' | 'needed' | 'approving' | 'approved' | 'error'

export function useTokenApproval({
  tokenAddress,
  spender,
  amount,
  enabled = true
}: UseTokenApprovalParams) {
  const { address } = useAccount()
  const [state, setState] = useState<ApprovalState>('idle')
  const [error, setError] = useState<Web3Error | null>(null)

  // Check current allowance
  const {
    data: allowance,
    isLoading: isCheckingAllowance,
    refetch: refetchAllowance,
    error: allowanceError
  } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: {
      enabled: enabled && !!address,
      staleTime: 5_000, // Recheck every 5 seconds
    }
  })

  // Approve transaction
  const {
    writeContract,
    data: hash,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite
  } = useWriteContract()

  // Wait for approval confirmation
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 2, // Wait for 2 blocks for safety
  })

  // Determine if approval is needed
  const needsApproval = allowance !== undefined && allowance < amount

  // Update state based on approval status
  useEffect(() => {
    if (isCheckingAllowance) {
      setState('checking')
    } else if (allowanceError) {
      setState('error')
      setError(classifyError(allowanceError))
    } else if (needsApproval && state === 'idle') {
      setState('needed')
    } else if (!needsApproval && allowance !== undefined) {
      setState('approved')
    }
  }, [isCheckingAllowance, allowanceError, needsApproval, allowance])

  // Handle write errors
  useEffect(() => {
    if (writeError) {
      setState('error')
      setError(classifyError(writeError))
    }
  }, [writeError])

  // Handle receipt errors
  useEffect(() => {
    if (receiptError) {
      setState('error')
      setError(classifyError(receiptError))
    }
  }, [receiptError])

  // Handle successful approval
  useEffect(() => {
    if (isSuccess) {
      setState('approved')
      refetchAllowance() // Update allowance after approval
    }
  }, [isSuccess])

  const approve = () => {
    if (!address) return

    setError(null)
    setState('approving')

    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount], // Exact amount, not infinite (security best practice)
    })
  }

  const retry = () => {
    setError(null)
    resetWrite()
    refetchAllowance()
    setState('idle')
  }

  return {
    state,
    needsApproval,
    approve,
    retry,
    isApproving: isWritePending || isConfirming,
    error,
    hash,
    allowance,
  }
}
```

**Tests**:

```typescript
// __tests__/hooks/useTokenApproval.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTokenApproval } from '@/hooks/shared/useTokenApproval'
import { parseEther } from 'viem'

// Mock wagmi hooks
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ address: '0x123...' })),
  useReadContract: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}))

describe('useTokenApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect when approval is needed', async () => {
    const { useReadContract } = await import('wagmi')
    vi.mocked(useReadContract).mockReturnValue({
      data: parseEther('5'), // Current allowance
      isLoading: false,
      refetch: vi.fn(),
    } as any)

    const { result } = renderHook(() =>
      useTokenApproval({
        tokenAddress: '0xPT...',
        spender: '0xOVFL...',
        amount: parseEther('10'), // Need 10, have 5
      })
    )

    await waitFor(() => {
      expect(result.current.needsApproval).toBe(true)
      expect(result.current.state).toBe('needed')
    })
  })

  it('should detect when approval is sufficient', async () => {
    const { useReadContract } = await import('wagmi')
    vi.mocked(useReadContract).mockReturnValue({
      data: parseEther('20'), // Current allowance
      isLoading: false,
      refetch: vi.fn(),
    } as any)

    const { result } = renderHook(() =>
      useTokenApproval({
        tokenAddress: '0xPT...',
        spender: '0xOVFL...',
        amount: parseEther('10'), // Need 10, have 20
      })
    )

    await waitFor(() => {
      expect(result.current.needsApproval).toBe(false)
      expect(result.current.state).toBe('approved')
    })
  })

  it('should handle user rejection', async () => {
    const { useWriteContract } = await import('wagmi')
    vi.mocked(useWriteContract).mockReturnValue({
      writeContract: vi.fn(),
      isPending: false,
      error: { name: 'UserRejectedRequestError', code: 4001 },
      reset: vi.fn(),
    } as any)

    const { result } = renderHook(() =>
      useTokenApproval({
        tokenAddress: '0xPT...',
        spender: '0xOVFL...',
        amount: parseEther('10'),
      })
    )

    await waitFor(() => {
      expect(result.current.state).toBe('error')
      expect(result.current.error?.type).toBe('user_rejected')
    })
  })

  it('should refetch allowance after successful approval', async () => {
    const refetchMock = vi.fn()
    const { useReadContract, useWaitForTransactionReceipt } = await import('wagmi')

    vi.mocked(useReadContract).mockReturnValue({
      data: parseEther('0'),
      isLoading: false,
      refetch: refetchMock,
    } as any)

    vi.mocked(useWaitForTransactionReceipt).mockReturnValue({
      isLoading: false,
      isSuccess: true,
    } as any)

    const { result } = renderHook(() =>
      useTokenApproval({
        tokenAddress: '0xPT...',
        spender: '0xOVFL...',
        amount: parseEther('10'),
      })
    )

    await waitFor(() => {
      expect(result.current.state).toBe('approved')
      expect(refetchMock).toHaveBeenCalled()
    })
  })
})
```

### 2.2: Multi-Step Deposit Hook with Edge Cases

**Problem (from Kieran review)**: Missing edge cases like market expiry during deposit, partial approval failures.

**Solution**:

```typescript
// hooks/ovfl/useDeposit.ts
import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useBlockNumber } from 'wagmi'
import { type Address, decodeEventLog, parseEther } from 'viem'
import { useTokenApproval } from '@/hooks/shared/useTokenApproval'
import { type DepositError, classifyError } from '@/lib/types/errors'
import { OVFL_ADDRESS } from '@/lib/config/wagmi'
import { ovflAbi } from '@/lib/abi/ovfl'
import { toast } from 'sonner'

type DepositStep = 'idle' | 'validating' | 'approve-pt' | 'approve-fee' | 'depositing' | 'success' | 'error'

interface DepositParams {
  marketAddress: Address
  ptToken: Address
  underlyingToken: Address
  ptAmount: bigint
  feeAmount: bigint
  minToUser: bigint
  marketExpiry: number
}

export function useDeposit() {
  const { address } = useAccount()
  const [step, setStep] = useState<DepositStep>('idle')
  const [error, setError] = useState<DepositError | null>(null)
  const [params, setParams] = useState<DepositParams | null>(null)
  const [streamId, setStreamId] = useState<bigint | null>(null)

  // Track current block for expiry checking
  const { data: blockNumber } = useBlockNumber({ watch: true })

  // PT token approval
  const ptApproval = useTokenApproval({
    tokenAddress: params?.ptToken ?? '0x0',
    spender: OVFL_ADDRESS,
    amount: params?.ptAmount ?? 0n,
    enabled: !!params && step !== 'idle'
  })

  // Fee token approval
  const feeApproval = useTokenApproval({
    tokenAddress: params?.underlyingToken ?? '0x0',
    spender: OVFL_ADDRESS,
    amount: params?.feeAmount ?? 0n,
    enabled: !!params && step !== 'idle' && params.feeAmount > 0n
  })

  // Deposit transaction
  const {
    writeContract: executeDeposit,
    data: depositHash,
    isPending: isDepositPending,
    error: depositError,
    reset: resetDeposit
  } = useWriteContract()

  // Wait for deposit confirmation
  const {
    isLoading: isConfirming,
    isSuccess: isDepositSuccess,
    data: depositReceipt,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash: depositHash,
    confirmations: 1,
  })

  // Check for market expiry on every block
  useEffect(() => {
    if (!params || !blockNumber) return

    const now = Math.floor(Date.now() / 1000)
    if (now >= params.marketExpiry) {
      setError({
        type: 'market_expired',
        expiry: params.marketExpiry
      })
      setStep('error')
      toast.error('Market expired during transaction. Please select a different market.')
    }
  }, [blockNumber, params])

  // Handle PT approval state
  useEffect(() => {
    if (step !== 'approve-pt') return

    if (ptApproval.error) {
      setError(ptApproval.error)
      setStep('error')
    } else if (ptApproval.state === 'approved') {
      // PT approved, move to fee approval (or skip if no fee)
      if (params && params.feeAmount > 0n) {
        setStep('approve-fee')
      } else {
        setStep('depositing')
      }
    }
  }, [ptApproval.state, ptApproval.error, step, params])

  // Handle fee approval state
  useEffect(() => {
    if (step !== 'approve-fee') return

    if (feeApproval.error) {
      setError(feeApproval.error)
      setStep('error')
    } else if (feeApproval.state === 'approved') {
      setStep('depositing')
    }
  }, [feeApproval.state, feeApproval.error, step])

  // Auto-execute deposit when approvals complete
  useEffect(() => {
    if (step !== 'depositing' || !params) return

    // Double-check market hasn't expired
    const now = Math.floor(Date.now() / 1000)
    if (now >= params.marketExpiry) {
      setError({ type: 'market_expired', expiry: params.marketExpiry })
      setStep('error')
      return
    }

    executeDeposit({
      address: OVFL_ADDRESS,
      abi: ovflAbi,
      functionName: 'deposit',
      args: [params.marketAddress, params.ptAmount, params.minToUser],
    })
  }, [step, params])

  // Handle deposit errors
  useEffect(() => {
    if (depositError) {
      setError(classifyError(depositError) as DepositError)
      setStep('error')
      toast.error('Deposit failed')
    }
  }, [depositError])

  useEffect(() => {
    if (receiptError) {
      setError(classifyError(receiptError) as DepositError)
      setStep('error')
    }
  }, [receiptError])

  // Handle successful deposit - extract stream ID from logs
  useEffect(() => {
    if (!isDepositSuccess || !depositReceipt) return

    try {
      // Find Deposited event
      const depositedLog = depositReceipt.logs.find(log => {
        try {
          const decoded = decodeEventLog({
            abi: ovflAbi,
            data: log.data,
            topics: log.topics,
          })
          return decoded.eventName === 'Deposited'
        } catch {
          return false
        }
      })

      if (depositedLog) {
        const decoded = decodeEventLog({
          abi: ovflAbi,
          data: depositedLog.data,
          topics: depositedLog.topics,
        })

        // Extract streamId from event args
        const extractedStreamId = (decoded.args as any).streamId as bigint
        setStreamId(extractedStreamId)
      }

      setStep('success')
      toast.success('Deposit successful! Stream created.')
    } catch (err) {
      console.error('Failed to parse deposit receipt:', err)
      // Still mark as success even if we can't parse stream ID
      setStep('success')
      toast.success('Deposit successful!')
    }
  }, [isDepositSuccess, depositReceipt])

  const startDeposit = (depositParams: DepositParams) => {
    setParams(depositParams)
    setError(null)
    setStreamId(null)
    resetDeposit()
    setStep('validating')

    // Start approval flow
    if (ptApproval.needsApproval) {
      setStep('approve-pt')
    } else if (feeApproval.needsApproval) {
      setStep('approve-fee')
    } else {
      setStep('depositing')
    }
  }

  const retry = () => {
    if (!params) return
    startDeposit(params)
  }

  const reset = () => {
    setStep('idle')
    setParams(null)
    setError(null)
    setStreamId(null)
    resetDeposit()
  }

  return {
    step,
    error,
    streamId,
    startDeposit,
    retry,
    reset,
    isLoading: step !== 'idle' && step !== 'success' && step !== 'error',
    ptApproval,
    feeApproval,
    depositHash,
  }
}
```

**Integration Tests**:

```typescript
// __tests__/hooks/useDeposit.integration.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useDeposit } from '@/hooks/ovfl/useDeposit'
import { parseEther } from 'viem'

describe('useDeposit Integration', () => {
  it('should complete full deposit flow: PT approval → fee approval → deposit', async () => {
    const { result } = renderHook(() => useDeposit())

    // Start deposit
    act(() => {
      result.current.startDeposit({
        marketAddress: '0xMarket...',
        ptToken: '0xPT...',
        underlyingToken: '0xWETH...',
        ptAmount: parseEther('10'),
        feeAmount: parseEther('0.05'),
        minToUser: parseEther('9.5'),
        marketExpiry: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
      })
    })

    // Should start with PT approval
    await waitFor(() => {
      expect(result.current.step).toBe('approve-pt')
    })

    // Simulate PT approval success
    // (In real test, mock wagmi hooks to return success states)

    // Should move to fee approval
    await waitFor(() => {
      expect(result.current.step).toBe('approve-fee')
    })

    // Simulate fee approval success

    // Should move to deposit
    await waitFor(() => {
      expect(result.current.step).toBe('depositing')
    })

    // Simulate deposit success

    // Should complete
    await waitFor(() => {
      expect(result.current.step).toBe('success')
      expect(result.current.streamId).toBeDefined()
    })
  })

  it('should handle market expiry during approval', async () => {
    const { result } = renderHook(() => useDeposit())

    // Start with market expiring in 1 second
    act(() => {
      result.current.startDeposit({
        marketAddress: '0xMarket...',
        ptToken: '0xPT...',
        underlyingToken: '0xWETH...',
        ptAmount: parseEther('10'),
        feeAmount: parseEther('0.05'),
        minToUser: parseEther('9.5'),
        marketExpiry: Math.floor(Date.now() / 1000) + 1,
      })
    })

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Should detect expiry and error
    await waitFor(() => {
      expect(result.current.step).toBe('error')
      expect(result.current.error?.type).toBe('market_expired')
    })
  })

  it('should handle partial approval failure (PT succeeds, fee fails)', async () => {
    // This tests the edge case identified by Kieran
    const { result } = renderHook(() => useDeposit())

    // Start deposit
    act(() => {
      result.current.startDeposit({
        marketAddress: '0xMarket...',
        ptToken: '0xPT...',
        underlyingToken: '0xWETH...',
        ptAmount: parseEther('10'),
        feeAmount: parseEther('0.05'),
        minToUser: parseEther('9.5'),
        marketExpiry: Math.floor(Date.now() / 1000) + 86400,
      })
    })

    // PT approval succeeds (mocked)
    await waitFor(() => {
      expect(result.current.step).toBe('approve-fee')
    })

    // Fee approval fails (user rejects)
    // Mock fee approval error

    await waitFor(() => {
      expect(result.current.step).toBe('error')
      expect(result.current.error?.type).toBe('user_rejected')
    })

    // Retry should work without re-approving PT
    act(() => {
      result.current.retry()
    })

    // Should skip PT approval and go straight to fee approval
    await waitFor(() => {
      expect(result.current.step).toBe('approve-fee')
    })
  })
})
```

**Acceptance Criteria Day 3-5**:
- [ ] Token approval hook with 2-block confirmation
- [ ] Deposit hook handling all edge cases:
  - [ ] Market expiry during approval flow
  - [ ] Partial approval failures
  - [ ] User rejection at any step
  - [ ] Network errors with retry logic
- [ ] Stream ID extraction from transaction logs
- [ ] Unit tests for approval hook (>85% coverage)
- [ ] Integration tests for full deposit flow
- [ ] E2E test on local fork (deposit PT → verify stream created)

---

## Day 6-8: UI Components & E2E Testing

### 3.1: Deposit Form Component

```typescript
// components/deposit/DepositForm.tsx
import { useState, useEffect } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { parseEther, formatUnits, type Address } from 'viem'
import { useDeposit } from '@/hooks/ovfl/useDeposit'
import { validatePTAmount, calculateMinToUser, formatValidationError } from '@/lib/utils/validation'
import { formatError } from '@/lib/types/errors'
import { TransactionSteps } from './TransactionSteps'
import { erc20Abi } from 'viem'

interface Market {
  address: Address
  name: string
  ptToken: Address
  underlying: Address
  expiry: number
  feeBps: number
}

interface DepositFormProps {
  market: Market
}

export function DepositForm({ market }: DepositFormProps) {
  const { address } = useAccount()
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(50) // 0.5% default
  const [validationError, setValidationError] = useState<string | null>(null)

  const deposit = useDeposit()

  // Fetch PT balance
  const { data: ptBalance = 0n } = useReadContract({
    address: market.ptToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  })

  // Fetch deposit preview from contract
  const { data: preview, isLoading: isLoadingPreview } = useReadContract({
    address: OVFL_ADDRESS,
    abi: ovflAbi,
    functionName: 'previewDeposit',
    args: amount && amount !== '0' ? [market.address, parseEther(amount)] : undefined,
    query: { enabled: !!amount && parseFloat(amount) > 0 }
  })

  // Validate amount on change
  useEffect(() => {
    if (!amount) {
      setValidationError(null)
      return
    }

    const validation = validatePTAmount(amount, ptBalance)
    if (!validation.valid) {
      setValidationError(formatValidationError(validation.error))
    } else {
      setValidationError(null)
    }
  }, [amount, ptBalance])

  const handleDeposit = () => {
    if (!preview || !amount) return

    const validation = validatePTAmount(amount, ptBalance)
    if (!validation.valid) {
      setValidationError(formatValidationError(validation.error))
      return
    }

    const [toUser, toStream, feeAmount] = preview
    const minToUser = calculateMinToUser(toUser, slippageBps)

    deposit.startDeposit({
      marketAddress: market.address,
      ptToken: market.ptToken,
      underlyingToken: market.underlying,
      ptAmount: validation.amount,
      feeAmount,
      minToUser,
      marketExpiry: market.expiry,
    })
  }

  const isDisabled =
    !address ||
    !amount ||
    !!validationError ||
    deposit.isLoading ||
    isLoadingPreview

  return (
    <div className="space-y-6">
      {/* Market Info */}
      <div className="bg-gray-800/50 rounded-lg p-4">
        <h3 className="text-lg font-semibold">{market.name}</h3>
        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Expires</span>
            <div className="font-medium">{new Date(market.expiry * 1000).toLocaleDateString()}</div>
          </div>
          <div>
            <span className="text-gray-400">Fee</span>
            <div className="font-medium">{market.feeBps / 100}%</div>
          </div>
        </div>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium">Amount</label>
          <button
            onClick={() => setAmount(formatUnits(ptBalance, 18))}
            className="text-xs text-purple-400 hover:text-purple-300"
          >
            MAX: {formatUnits(ptBalance, 18)}
          </button>
        </div>

        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          className={`w-full px-4 py-3 bg-gray-900 border rounded-lg text-lg font-medium focus:outline-none focus:ring-2 ${
            validationError
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-700 focus:ring-purple-500'
          }`}
          disabled={deposit.isLoading}
        />

        {validationError && (
          <p className="text-sm text-red-400">{validationError}</p>
        )}
      </div>

      {/* Preview */}
      {preview && !validationError && amount && (
        <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-gray-400">You will receive:</div>

          <div className="flex justify-between">
            <span className="text-gray-300">Immediate</span>
            <span className="font-medium">{formatUnits(preview[0], 18)} ovflETH</span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-300">Streamed until maturity</span>
            <span className="font-medium">{formatUnits(preview[1], 18)} ovflETH</span>
          </div>

          <div className="border-t border-gray-700 pt-3 flex justify-between text-sm">
            <span className="text-gray-400">Fee ({market.feeBps / 100}%)</span>
            <span className="text-gray-400">{formatUnits(preview[2], 18)} {market.underlying === WETH ? 'WETH' : 'ETH'}</span>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Slippage tolerance</span>
              <select
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm"
              >
                <option value={10}>0.1%</option>
                <option value={50}>0.5%</option>
                <option value={100}>1%</option>
                <option value={200}>2%</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Steps */}
      {deposit.step !== 'idle' && (
        <TransactionSteps
          step={deposit.step}
          ptApproval={deposit.ptApproval}
          feeApproval={deposit.feeApproval}
          depositHash={deposit.depositHash}
        />
      )}

      {/* Error Display */}
      {deposit.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <div className="font-medium text-red-400">Transaction Failed</div>
              <div className="text-sm text-red-300 mt-1">{formatError(deposit.error)}</div>
              <button
                onClick={deposit.retry}
                className="mt-3 text-sm text-red-400 hover:text-red-300 underline"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {deposit.step === 'success' && deposit.streamId && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <div className="font-medium text-green-400">Deposit Successful!</div>
              <div className="text-sm text-green-300 mt-1">
                Stream #{deposit.streamId.toString()} has been created
              </div>
              <a
                href={`https://app.sablier.com/stream/${deposit.streamId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-green-400 hover:text-green-300 underline"
              >
                View on Sablier →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Button */}
      <button
        onClick={handleDeposit}
        disabled={isDisabled}
        className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-950"
        aria-label={deposit.isLoading ? deposit.step : 'Deposit PT tokens'}
      >
        {deposit.isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {deposit.step === 'approve-pt' && 'Approving PT...'}
            {deposit.step === 'approve-fee' && 'Approving Fee...'}
            {deposit.step === 'depositing' && 'Depositing...'}
          </span>
        ) : (
          'Deposit PT'
        )}
      </button>

      {!address && (
        <p className="text-center text-sm text-gray-400">
          Connect your wallet to deposit PT tokens
        </p>
      )}
    </div>
  )
}
```

### 3.2: E2E Testing with Playwright

```typescript
// e2e/deposit.spec.ts
import { test, expect } from '@playwright/test'
import { setupAnvil, deployContracts } from './helpers/blockchain'

test.describe('Deposit Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Start local Anvil fork
    await setupAnvil()

    // Deploy contracts to fork
    await deployContracts()

    // Navigate to app
    await page.goto('http://localhost:5173')
  })

  test('should complete full deposit: connect → select market → approve → deposit → success', async ({ page }) => {
    // Step 1: Connect wallet
    await page.getByRole('button', { name: /connect wallet/i }).click()
    await page.getByText('MetaMask').click()
    // (Mock wallet connection in test environment)

    await expect(page.getByText(/0x.{4}…/)).toBeVisible()

    // Step 2: Navigate to deposit page
    await page.getByRole('link', { name: /deposit/i }).click()

    // Step 3: Select market
    await page.getByRole('button', { name: /PT-stETH/i }).click()

    // Step 4: Enter amount
    await page.getByPlaceholder('0.0').fill('1.0')

    // Step 5: Verify preview appears
    await expect(page.getByText(/You will receive/i)).toBeVisible()
    await expect(page.getByText(/Immediate/i)).toBeVisible()
    await expect(page.getByText(/Streamed/i)).toBeVisible()

    // Step 6: Click deposit (triggers approval flow)
    await page.getByRole('button', { name: /Deposit PT/i }).click()

    // Step 7: Verify PT approval step
    await expect(page.getByText(/Approving PT/i)).toBeVisible()
    // (Simulate approval confirmation in test)

    // Step 8: Verify fee approval step
    await expect(page.getByText(/Approving Fee/i)).toBeVisible()

    // Step 9: Verify deposit step
    await expect(page.getByText(/Depositing/i)).toBeVisible()

    // Step 10: Verify success message
    await expect(page.getByText(/Deposit Successful/i)).toBeVisible({ timeout: 30000 })
    await expect(page.getByText(/Stream #\d+ has been created/i)).toBeVisible()

    // Step 11: Verify Sablier link
    await expect(page.getByRole('link', { name: /View on Sablier/i })).toBeVisible()
  })

  test('should handle user rejection gracefully', async ({ page }) => {
    // Setup
    await page.goto('http://localhost:5173/deposit')
    // ... connect wallet, select market, enter amount

    // Click deposit
    await page.getByRole('button', { name: /Deposit PT/i }).click()

    // Simulate user rejecting in MetaMask
    // (Mock rejection in test environment)

    // Verify error message
    await expect(page.getByText(/Transaction was rejected/i)).toBeVisible()

    // Verify retry button appears
    await expect(page.getByRole('button', { name: /Try Again/i })).toBeVisible()
  })

  test('should prevent deposit when market expires', async ({ page }) => {
    // Use a market that's about to expire
    await page.goto('http://localhost:5173/deposit')

    // Select expiring market
    await page.getByRole('button', { name: /PT-weETH/i }).click()

    // Enter amount
    await page.getByPlaceholder('0.0').fill('1.0')

    // Wait for market to expire (in test, manipulate block timestamp)
    // ...

    // Try to deposit
    await page.getByRole('button', { name: /Deposit PT/i }).click()

    // Should show expiry error
    await expect(page.getByText(/Market expired/i)).toBeVisible()
  })

  test('should validate input correctly', async ({ page }) => {
    await page.goto('http://localhost:5173/deposit')
    // ... connect wallet, select market

    // Test below minimum
    await page.getByPlaceholder('0.0').fill('0.05')
    await expect(page.getByText(/Minimum deposit is 0.1 PT/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Deposit PT/i })).toBeDisabled()

    // Test above balance
    await page.getByPlaceholder('0.0').fill('999999')
    await expect(page.getByText(/Insufficient balance/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Deposit PT/i })).toBeDisabled()

    // Test invalid input
    await page.getByPlaceholder('0.0').fill('abc')
    await expect(page.getByText(/Invalid number/i)).toBeVisible()

    // Test valid input
    await page.getByPlaceholder('0.0').fill('1.0')
    await expect(page.getByRole('button', { name: /Deposit PT/i })).toBeEnabled()
  })
})
```

**Acceptance Criteria Day 6-8**:
- [ ] DepositForm component with all states (loading, error, success)
- [ ] Real-time preview from contract
- [ ] Slippage tolerance selector
- [ ] Transaction step visualization
- [ ] Accessibility: keyboard navigation, ARIA labels, focus management
- [ ] E2E test: Full deposit flow on local fork
- [ ] E2E test: User rejection handling
- [ ] E2E test: Market expiry prevention
- [ ] E2E test: Input validation

---

## Phase 1 Deliverables

**Shippable Artifact**: A production-ready deposit flow that:
- ✅ Handles all token approvals correctly
- ✅ Validates all inputs with clear error messages
- ✅ Prevents edge cases (market expiry, partial failures)
- ✅ Extracts stream ID from transaction receipt
- ✅ Has >80% test coverage (unit + integration + E2E)
- ✅ Meets WCAG 2.1 AA accessibility standards
- ✅ Works reliably on mainnet with RPC fallbacks

**Testing Coverage**:
- Unit tests: Error types, validation, calculations
- Integration tests: Full deposit flow state machine
- E2E tests: User journey on forked mainnet

**Documentation**:
- API reference for all hooks
- Component usage examples
- Testing guide

**Timeline**: 8-10 days
**Estimated LOC**: ~1,500-2,000

---

# Phase 2: Stream Management (6-8 days)

## Day 9-10: Stream Data Fetching

### 4.1: Contract-Based Stream Reading (Simpler Alternative)

**Decision**: Start with direct contract reads instead of GraphQL for simplicity. Add GraphQL later if needed.

```typescript
// hooks/sablier/useUserStreams.ts
import { useReadContracts, useAccount } from 'wagmi'
import { sablierLockupLinearAbi } from '@/lib/abi/sablier'
import { SABLIER_ADDRESS } from '@/lib/config/wagmi'
import { type Address } from 'viem'

interface Stream {
  streamId: bigint
  sender: Address
  recipient: Address
  totalAmount: bigint
  startTime: bigint
  endTime: bigint
  asset: Address
  withdrawnAmount: bigint
  cancelable: boolean
}

export function useUserStreams(streamIds: bigint[]) {
  const { address } = useAccount()

  // Fetch all stream data in one multicall
  const { data: streamDataResults, isLoading } = useReadContracts({
    contracts: streamIds.map(streamId => ({
      address: SABLIER_ADDRESS,
      abi: sablierLockupLinearAbi,
      functionName: 'getStream',
      args: [streamId],
    })),
    query: {
      enabled: streamIds.length > 0,
      staleTime: 30_000, // Cache for 30 seconds
    }
  })

  const streams: Stream[] = streamDataResults
    ?.filter(result => result.status === 'success')
    .map((result, index) => {
      const streamData = result.result as any
      return {
        streamId: streamIds[index],
        sender: streamData.sender,
        recipient: streamData.recipient,
        totalAmount: streamData.depositAmount,
        startTime: streamData.startTime,
        endTime: streamData.endTime,
        asset: streamData.asset,
        withdrawnAmount: streamData.withdrawnAmount,
        cancelable: streamData.cancelable,
      }
    }) ?? []

  return {
    streams,
    isLoading,
  }
}

// Calculate vested amount client-side (no need for WebSockets)
export function calculateVestedAmount(stream: Stream, currentTime: number = Date.now() / 1000): bigint {
  const { startTime, endTime, totalAmount, withdrawnAmount } = stream

  // Not started yet
  if (currentTime < Number(startTime)) {
    return 0n
  }

  // Fully vested
  if (currentTime >= Number(endTime)) {
    return totalAmount
  }

  // Linear vesting
  const elapsed = BigInt(Math.floor(currentTime)) - startTime
  const duration = endTime - startTime
  const vested = (totalAmount * elapsed) / duration

  return vested
}

export function calculateWithdrawableAmount(stream: Stream, currentTime?: number): bigint {
  const vested = calculateVestedAmount(stream, currentTime)
  const withdrawable = vested - stream.withdrawnAmount
  return withdrawable > 0n ? withdrawable : 0n
}
```

**Tests**:

```typescript
// __tests__/hooks/useUserStreams.test.ts
import { describe, it, expect } from 'vitest'
import { calculateVestedAmount, calculateWithdrawableAmount } from '@/hooks/sablier/useUserStreams'
import { parseEther } from 'viem'

describe('Stream Calculations', () => {
  const mockStream = {
    streamId: 1n,
    sender: '0xSender',
    recipient: '0xRecipient',
    totalAmount: parseEther('10'),
    startTime: 1000n,
    endTime: 2000n, // 1000 second duration
    asset: '0xAsset',
    withdrawnAmount: parseEther('0'),
    cancelable: false,
  }

  it('should calculate vested amount at 50% completion', () => {
    const currentTime = 1500 // 50% through
    const vested = calculateVestedAmount(mockStream, currentTime)

    expect(vested).toBe(parseEther('5')) // 50% of 10
  })

  it('should return 0 if stream hasnt started', () => {
    const currentTime = 500 // Before start
    const vested = calculateVestedAmount(mockStream, currentTime)

    expect(vested).toBe(0n)
  })

  it('should return full amount if stream ended', () => {
    const currentTime = 3000 // After end
    const vested = calculateVestedAmount(mockStream, currentTime)

    expect(vested).toBe(parseEther('10'))
  })

  it('should calculate withdrawable amount correctly', () => {
    const streamWithWithdrawals = {
      ...mockStream,
      withdrawnAmount: parseEther('3'),
    }

    const currentTime = 1500 // 50% through, 5 vested
    const withdrawable = calculateWithdrawableAmount(streamWithWithdrawals, currentTime)

    expect(withdrawable).toBe(parseEther('2')) // 5 vested - 3 withdrawn
  })

  it('should return 0 if nothing new to withdraw', () => {
    const streamWithWithdrawals = {
      ...mockStream,
      withdrawnAmount: parseEther('10'),
    }

    const withdrawable = calculateWithdrawableAmount(streamWithWithdrawals)

    expect(withdrawable).toBe(0n)
  })
})
```

### 4.2: Stream ID Persistence

**Problem**: How do users know their stream IDs?

**Solution**: Store stream IDs locally when deposits succeed, indexed by wallet address.

```typescript
// lib/storage/streams.ts
const STREAMS_KEY = 'ovfl_user_streams'

interface StoredStream {
  streamId: bigint
  marketAddress: string
  ptAmount: bigint
  createdAt: number
  txHash: string
}

export function storeStreamId(
  userAddress: string,
  streamId: bigint,
  marketAddress: string,
  ptAmount: bigint,
  txHash: string
) {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()

  if (!stored[userKey]) {
    stored[userKey] = []
  }

  stored[userKey].push({
    streamId: streamId.toString(), // Store as string
    marketAddress,
    ptAmount: ptAmount.toString(),
    createdAt: Date.now(),
    txHash,
  })

  localStorage.setItem(STREAMS_KEY, JSON.stringify(stored))
}

export function getUserStreamIds(userAddress: string): bigint[] {
  const stored = getStoredStreams()
  const userKey = userAddress.toLowerCase()
  const userStreams = stored[userKey] || []

  return userStreams.map(s => BigInt(s.streamId))
}

function getStoredStreams(): Record<string, any[]> {
  try {
    const stored = localStorage.getItem(STREAMS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}
```

**Integration with Deposit Hook**:

```typescript
// In useDeposit.ts, after successful deposit:
useEffect(() => {
  if (!isDepositSuccess || !depositReceipt || !address) return

  // ... extract streamId ...

  if (streamId) {
    storeStreamId(
      address,
      streamId,
      params!.marketAddress,
      params!.ptAmount,
      depositReceipt.transactionHash
    )
  }
}, [isDepositSuccess, depositReceipt, address])
```

**Acceptance Criteria Day 9-10**:
- [ ] Stream reading from Sablier contract (multicall)
- [ ] Client-side vesting calculation (no polling needed)
- [ ] Withdrawable amount calculation
- [ ] LocalStorage persistence for user streams
- [ ] Unit tests for all calculations
- [ ] Integration test: Deposit → stream ID stored → stream retrieved

---

## Day 11-13: Withdrawal & UI

### 5.1: Withdrawal Hook

```typescript
// hooks/sablier/useWithdrawStream.ts
import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { sablierLockupLinearAbi } from '@/lib/abi/sablier'
import { SABLIER_ADDRESS } from '@/lib/config/wagmi'
import { type Address } from 'viem'
import { type Web3Error, classifyError } from '@/lib/types/errors'
import { toast } from 'sonner'

export function useWithdrawStream() {
  const [error, setError] = useState<Web3Error | null>(null)

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
  })

  const withdrawMax = (streamId: bigint, recipient: Address) => {
    setError(null)

    writeContract({
      address: SABLIER_ADDRESS,
      abi: sablierLockupLinearAbi,
      functionName: 'withdrawMax',
      args: [streamId, recipient],
    })
  }

  const withdrawAmount = (streamId: bigint, recipient: Address, amount: bigint) => {
    setError(null)

    writeContract({
      address: SABLIER_ADDRESS,
      abi: sablierLockupLinearAbi,
      functionName: 'withdraw',
      args: [streamId, recipient, amount],
    })
  }

  // Handle errors
  useState(() => {
    if (writeError) {
      setError(classifyError(writeError))
      toast.error('Withdrawal failed')
    }
    if (receiptError) {
      setError(classifyError(receiptError))
    }
  }, [writeError, receiptError])

  // Handle success
  useState(() => {
    if (isSuccess) {
      toast.success('Withdrawal successful!')
    }
  }, [isSuccess])

  return {
    withdrawMax,
    withdrawAmount,
    isLoading: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  }
}
```

### 5.2: Stream List Component

```typescript
// components/streams/StreamList.tsx
import { useMemo, useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { useUserStreams, calculateWithdrawableAmount } from '@/hooks/sablier/useUserStreams'
import { useWithdrawStream } from '@/hooks/sablier/useWithdrawStream'
import { getUserStreamIds } from '@/lib/storage/streams'
import { StreamProgress } from './StreamProgress'

export function StreamList() {
  const { address } = useAccount()
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000)

  // Get user's stream IDs from localStorage
  const streamIds = useMemo(() => {
    return address ? getUserStreamIds(address) : []
  }, [address])

  const { streams, isLoading } = useUserStreams(streamIds)
  const withdraw = useWithdrawStream()

  // Update time every second for real-time progress
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now() / 1000)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  if (!address) {
    return (
      <div className="text-center py-12 text-gray-400">
        Connect your wallet to view streams
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse bg-gray-800/50 rounded-lg h-32" />
        ))}
      </div>
    )
  }

  if (streams.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-400">No active streams</div>
        <div className="text-sm text-gray-500 mt-2">
          Deposit PT tokens to create a stream
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {streams.map(stream => {
        const withdrawable = calculateWithdrawableAmount(stream, currentTime)
        const isFullyWithdrawn = stream.withdrawnAmount >= stream.totalAmount

        return (
          <div key={stream.streamId.toString()} className="bg-gray-800/50 rounded-lg p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-semibold">Stream #{stream.streamId.toString()}</div>
                <div className="text-sm text-gray-400 mt-1">
                  {new Date(Number(stream.startTime) * 1000).toLocaleDateString()} →{' '}
                  {new Date(Number(stream.endTime) * 1000).toLocaleDateString()}
                </div>
              </div>

              {!isFullyWithdrawn && (
                <div className="text-right">
                  <div className="text-sm text-gray-400">Withdrawable</div>
                  <div className="text-lg font-semibold text-purple-400">
                    {formatUnits(withdrawable, 18)} ovflETH
                  </div>
                </div>
              )}
            </div>

            {/* Progress Visualization */}
            <StreamProgress stream={stream} currentTime={currentTime} />

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-700">
              <div>
                <div className="text-xs text-gray-400">Total</div>
                <div className="font-medium">{formatUnits(stream.totalAmount, 18)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Withdrawn</div>
                <div className="font-medium">{formatUnits(stream.withdrawnAmount, 18)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Remaining</div>
                <div className="font-medium">
                  {formatUnits(stream.totalAmount - stream.withdrawnAmount, 18)}
                </div>
              </div>
            </div>

            {/* Withdraw Button */}
            {withdrawable > 0n && (
              <button
                onClick={() => withdraw.withdrawMax(stream.streamId, address)}
                disabled={withdraw.isLoading}
                className="mt-4 w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded-lg font-medium transition-colors"
              >
                {withdraw.isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Withdrawing...
                  </span>
                ) : (
                  `Withdraw ${formatUnits(withdrawable, 18)} ovflETH`
                )}
              </button>
            )}

            {isFullyWithdrawn && (
              <div className="mt-4 text-center text-sm text-gray-400">
                ✓ Fully withdrawn
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

### 5.3: Stream Progress Component (Simple Version)

```typescript
// components/streams/StreamProgress.tsx
import { useMemo } from 'react'
import { calculateVestedAmount } from '@/hooks/sablier/useUserStreams'
import type { Stream } from '@/hooks/sablier/useUserStreams'

interface StreamProgressProps {
  stream: Stream
  currentTime: number
}

export function StreamProgress({ stream, currentTime }: StreamProgressProps) {
  const progress = useMemo(() => {
    const vested = calculateVestedAmount(stream, currentTime)
    return Number((vested * 10000n) / stream.totalAmount) / 100 // Percentage with 2 decimals
  }, [stream, currentTime])

  const timeRemaining = useMemo(() => {
    const remaining = Number(stream.endTime) - currentTime
    if (remaining <= 0) return 'Completed'

    const days = Math.floor(remaining / 86400)
    const hours = Math.floor((remaining % 86400) / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h remaining`
    if (hours > 0) return `${hours}h ${minutes}m remaining`
    return `${minutes}m remaining`
  }, [stream, currentTime])

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">Progress</span>
        <span className="font-medium">{progress.toFixed(2)}%</span>
      </div>

      {/* Progress Bar */}
      <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="text-xs text-gray-400 text-right">
        {timeRemaining}
      </div>
    </div>
  )
}
```

**Acceptance Criteria Day 11-13**:
- [ ] Withdrawal hook with error handling
- [ ] StreamList component with real-time progress updates
- [ ] StreamProgress component with smooth animations
- [ ] LocalStorage integration for stream tracking
- [ ] Unit tests for withdrawal logic
- [ ] E2E test: Create stream → view in list → withdraw
- [ ] Mobile responsive design

---

## Phase 2 Deliverables

**Shippable Artifact**: Complete stream management system that:
- ✅ Reads stream data from Sablier contract
- ✅ Calculates vesting progress client-side (no WebSockets needed)
- ✅ Stores stream IDs locally per user
- ✅ Displays real-time progress with second-by-second updates
- ✅ Handles withdrawals with full error handling
- ✅ Has >75% test coverage

**Testing Coverage**:
- Unit tests: Vesting calculations, withdrawable amounts
- Integration tests: Stream creation → retrieval → withdrawal
- E2E tests: Full stream lifecycle

**Documentation**:
- Hook API reference
- Component usage guide
- Stream calculation examples

**Timeline**: 6-8 days
**Estimated LOC**: ~1,000-1,500

---

# Phase 3: Polish & Production (6-7 days)

## Day 14-16: Performance & Monitoring

### 6.1: TanStack Query Optimization

```typescript
// lib/query/config.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      gcTime: 5 * 60_000, // 5 minutes
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 0, // Don't retry mutations
    },
  },
})

// Prefetch likely next actions
export function prefetchMarketData(marketAddress: string) {
  queryClient.prefetchQuery({
    queryKey: ['pendle', 'market', marketAddress],
    queryFn: () => fetchMarketData(1, marketAddress),
    staleTime: 60_000,
  })
}
```

### 6.2: Sentry Error Tracking

```typescript
// lib/monitoring/sentry.ts
import * as Sentry from '@sentry/react'
import { BrowserTracing } from '@sentry/tracing'

export function initSentry() {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [new BrowserTracing()],
    tracesSampleRate: 0.1, // 10% of transactions
    environment: import.meta.env.MODE,
    beforeSend(event, hint) {
      // Filter out user rejections (not real errors)
      const error = hint.originalException as any
      if (error?.code === 4001 || error?.name === 'UserRejectedRequestError') {
        return null
      }
      return event
    },
  })
}

// Custom error boundary
export function logError(error: Error, errorInfo: any) {
  Sentry.captureException(error, {
    contexts: {
      react: errorInfo,
    },
  })
}
```

### 6.3: Analytics Events

```typescript
// lib/analytics/events.ts
import posthog from 'posthog-js'

export function initAnalytics() {
  if (import.meta.env.VITE_POSTHOG_KEY) {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
      api_host: 'https://app.posthog.com',
    })
  }
}

// Track deposit flow
export function trackDepositStarted(market: string, amount: string) {
  posthog.capture('deposit_started', { market, amount })
}

export function trackApprovalCompleted(token: string, step: 'pt' | 'fee') {
  posthog.capture('approval_completed', { token, step })
}

export function trackDepositSuccess(market: string, amount: string, streamId: string) {
  posthog.capture('deposit_success', { market, amount, streamId })
}

export function trackDepositError(error: string, step: string) {
  posthog.capture('deposit_error', { error, step })
}

// Track withdrawals
export function trackWithdrawalSuccess(streamId: string, amount: string) {
  posthog.capture('withdrawal_success', { streamId, amount })
}
```

**Acceptance Criteria Day 14-16**:
- [ ] TanStack Query configured with optimal cache times
- [ ] Prefetching for likely user actions
- [ ] Sentry integrated for error tracking
- [ ] PostHog/Mixpanel for user analytics
- [ ] Performance monitoring (Web Vitals)
- [ ] Error filtering (exclude user rejections)

---

## Day 17-19: Accessibility & Mobile

### 7.1: WCAG 2.1 AA Compliance

```typescript
// Accessibility checklist implementation

// 1. Keyboard Navigation
// All interactive elements must be keyboard accessible
<button
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }}
  tabIndex={0}
  aria-label="Deposit PT tokens"
>
  Deposit
</button>

// 2. Focus Management
import { useRef, useEffect } from 'react'

function Modal({ isOpen, onClose }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus()
    }
  }, [isOpen])

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">Confirm Deposit</h2>
      <button ref={closeButtonRef} onClick={onClose}>
        Close
      </button>
    </div>
  )
}

// 3. Color Contrast
// Ensure all text meets 4.5:1 contrast ratio
// Use tools like https://webaim.org/resources/contrastchecker/

// 4. ARIA Labels
<input
  type="number"
  aria-label="PT amount to deposit"
  aria-describedby="amount-help"
  aria-invalid={!!error}
  aria-errormessage={error ? "amount-error" : undefined}
/>
<div id="amount-help" className="text-sm text-gray-400">
  Minimum 0.1 PT
</div>
{error && (
  <div id="amount-error" role="alert" className="text-sm text-red-400">
    {error}
  </div>
)}

// 5. Screen Reader Announcements
import { useEffect } from 'react'

function LiveRegion({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  )
}

// Usage in deposit flow
{step === 'approve-pt' && (
  <LiveRegion message="Approving PT tokens. Please confirm in your wallet." />
)}
```

### 7.2: Mobile Optimization

```typescript
// components/shared/MobileDrawer.tsx
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'

export function MobileDrawer({ isOpen, onClose, title, children }) {
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/75" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 bottom-0 flex max-w-full">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-y-full"
                enterTo="translate-y-0"
                leave="transform transition ease-in-out duration-200"
                leaveFrom="translate-y-0"
                leaveTo="translate-y-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen">
                  <div className="flex h-[80vh] flex-col overflow-y-scroll bg-gray-950 rounded-t-2xl">
                    {/* Handle */}
                    <div className="flex justify-center pt-3 pb-2">
                      <div className="w-12 h-1 bg-gray-700 rounded-full" />
                    </div>

                    {/* Content */}
                    <div className="p-6">
                      <Dialog.Title className="text-xl font-semibold mb-4">
                        {title}
                      </Dialog.Title>
                      {children}
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

// Usage for market selection on mobile
<MobileDrawer
  isOpen={showMarketPicker}
  onClose={() => setShowMarketPicker(false)}
  title="Select Market"
>
  <MarketList markets={markets} onSelect={handleSelect} />
</MobileDrawer>
```

**Acceptance Criteria Day 17-19**:
- [ ] All interactive elements keyboard accessible (Tab, Enter, Space, Esc)
- [ ] Focus indicators visible (2px purple ring)
- [ ] ARIA labels on all form inputs and buttons
- [ ] Color contrast ≥ 4.5:1 for all text
- [ ] Screen reader announcements for state changes
- [ ] Mobile bottom sheets for modals
- [ ] Touch targets ≥ 44x44px
- [ ] Tested with VoiceOver (iOS) and TalkBack (Android)
- [ ] Lighthouse Accessibility score ≥ 95

---

## Day 20: Final Testing & Deployment

### 8.1: Security Audit Checklist

```markdown
## Security Audit Checklist

### Input Validation
- [ ] All user inputs validated (amount, addresses)
- [ ] Decimal precision limited to 18
- [ ] Min/max amounts enforced
- [ ] No scientific notation accepted

### Contract Interactions
- [ ] Contract addresses hardcoded and verified
- [ ] Slippage protection on deposits
- [ ] No unlimited token approvals
- [ ] 2-block confirmations for approvals

### XSS Prevention
- [ ] All external data sanitized (market names from Pendle API)
- [ ] No dangerouslySetInnerHTML usage
- [ ] User addresses displayed with ellipsis (not full)

### Error Handling
- [ ] No sensitive data in error messages
- [ ] User rejections handled gracefully
- [ ] Network errors caught and retried
- [ ] Timeouts configured on all RPC calls

### RPC Security
- [ ] API keys in environment variables
- [ ] Multiple RPC fallbacks configured
- [ ] No API keys in client-side code
- [ ] Rate limiting awareness

### Data Privacy
- [ ] No PII stored in localStorage
- [ ] Stream IDs stored locally only
- [ ] Analytics events don't include addresses
- [ ] Sentry filters out sensitive data
```

### 8.2: Deployment Checklist

```markdown
## Deployment Checklist

### Environment Variables
- [ ] VITE_ALCHEMY_KEY configured
- [ ] VITE_INFURA_KEY configured
- [ ] VITE_WALLETCONNECT_PROJECT_ID configured
- [ ] VITE_SENTRY_DSN configured
- [ ] VITE_POSTHOG_KEY configured

### Contract Addresses
- [ ] OVFL_ADDRESS updated (mainnet)
- [ ] ADMIN_ADDRESS updated (mainnet)
- [ ] Contracts verified on Etherscan

### Build
- [ ] `npm run build` succeeds
- [ ] Bundle size < 500KB gzipped
- [ ] No console.log in production
- [ ] Source maps generated for Sentry

### Testing
- [ ] All unit tests pass (`npm test`)
- [ ] All integration tests pass
- [ ] E2E tests pass on mainnet fork
- [ ] Manual testing on testnet
- [ ] Mobile testing (iOS + Android)
- [ ] Accessibility audit passed

### Monitoring
- [ ] Sentry receiving error events
- [ ] PostHog tracking page views
- [ ] Analytics dashboard configured
- [ ] Alert rules configured (error rate > 5%)

### DNS & Hosting
- [ ] Domain configured (ovfl.xyz)
- [ ] SSL certificate active
- [ ] CDN configured (Cloudflare)
- [ ] Deploy to Vercel/Netlify
```

**Acceptance Criteria Day 20**:
- [ ] All security checklist items addressed
- [ ] Production build deployed to mainnet
- [ ] Monitoring active and alerts configured
- [ ] Documentation published
- [ ] Launch announcement ready

---

## Phase 3 Deliverables

**Shippable Artifact**: Production-ready OVFL frontend with:
- ✅ Optimized performance (LCP < 2.5s, FID < 100ms)
- ✅ Error tracking and monitoring
- ✅ WCAG 2.1 AA accessibility
- ✅ Mobile-optimized experience
- ✅ Security hardened
- ✅ Deployed to production

**Timeline**: 6-7 days
**Estimated LOC**: ~800-1,200

---

# Final Summary

## Total Timeline: 20-25 Days (3 Phases)

| Phase | Duration | Focus | Deliverable |
|-------|----------|-------|-------------|
| 1 | 8-10 days | Deposit Flow | Bulletproof deposit with full testing |
| 2 | 6-8 days | Stream Management | Complete stream viewing and withdrawals |
| 3 | 6-7 days | Polish & Production | Performance, accessibility, deployment |

## Total Estimated LOC: 3,300-4,700

- Phase 1: ~1,500-2,000 LOC
- Phase 2: ~1,000-1,500 LOC
- Phase 3: ~800-1,200 LOC

## Key Improvements Over Original Plan

1. ✅ **Realistic timeline** - 20-25 days vs. 13 days
2. ✅ **No Next.js migration** - Stay with Vite (simpler)
3. ✅ **Comprehensive tests** - Every feature has unit + integration + E2E
4. ✅ **Security fixes** - Slippage protection, input validation, XSS prevention
5. ✅ **Edge case handling** - Market expiry, partial approvals, network failures
6. ✅ **Proper error types** - Discriminated unions, not strings
7. ✅ **Production monitoring** - Sentry + analytics from day 1
8. ✅ **Shippable milestones** - Each phase can be deployed independently

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Pendle API downtime | Fallback to direct contract reads |
| Sablier subgraph lag | Client-side stream calculations |
| RPC provider failures | 3-provider fallback configuration |
| Market expiry during deposit | Block-level expiry checking |
| Complex approval flows confusing users | Clear step-by-step UI with retry |
| Browser compatibility | Test on Chrome, Safari, Firefox |

## Success Metrics

- **Transaction success rate** > 95%
- **Average deposit time** < 2 minutes
- **Test coverage** > 80%
- **Lighthouse scores** > 90 (performance, accessibility, best practices)
- **Error rate** < 2%
- **Mobile completion rate** > 80% match desktop

---

## Next Steps

1. **Review this plan** - Confirm approach and timeline
2. **Set up project** - Initialize repo, install dependencies
3. **Start Phase 1 Day 1** - Error type system & infrastructure
4. **Daily standups** - Track progress, identify blockers
5. **Code reviews** - Every PR reviewed before merge
6. **Weekly demos** - Show progress to stakeholders

**This plan is production-ready and addresses all critical feedback from the review process.**
