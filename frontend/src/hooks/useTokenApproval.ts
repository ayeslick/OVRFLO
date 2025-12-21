import { useState, useEffect, useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { type Web3Error, classifyError } from '../lib/types/errors'

export type ApprovalState = 
  | 'idle' 
  | 'checking' 
  | 'needed' 
  | 'approving' 
  | 'confirming'
  | 'approved' 
  | 'error'

interface UseTokenApprovalParams {
  tokenAddress: Address | undefined
  spender: Address
  amount: bigint
  enabled?: boolean
}

interface UseTokenApprovalReturn {
  state: ApprovalState
  needsApproval: boolean
  approve: () => void
  retry: () => void
  isApproving: boolean
  error: Web3Error | null
  hash: `0x${string}` | undefined
  allowance: bigint | undefined
}

/**
 * Hook for managing ERC20 token approvals
 * Handles checking allowance, requesting approval, and waiting for confirmation
 */
export function useTokenApproval({
  tokenAddress,
  spender,
  amount,
  enabled = true
}: UseTokenApprovalParams): UseTokenApprovalReturn {
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
      enabled: enabled && !!address && !!tokenAddress && amount > 0n,
      staleTime: 10_000,
      refetchInterval: 30_000, // Recheck every 30 seconds
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

  // Wait for approval confirmation (2 blocks for safety)
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 2,
  })

  // Determine if approval is needed
  const needsApproval = allowance !== undefined && allowance < amount

  // Update state based on allowance check
  useEffect(() => {
    if (!enabled || !tokenAddress || amount === 0n) {
      setState('idle')
      return
    }

    if (isCheckingAllowance) {
      setState('checking')
    } else if (allowanceError) {
      setState('error')
      setError(classifyError(allowanceError))
    } else if (allowance !== undefined) {
      if (allowance >= amount) {
        setState('approved')
        setError(null)
      } else if (state === 'idle' || state === 'checking') {
        setState('needed')
      }
    }
  }, [isCheckingAllowance, allowanceError, allowance, amount, enabled, tokenAddress, state])

  // Handle write pending state
  useEffect(() => {
    if (isWritePending) {
      setState('approving')
    }
  }, [isWritePending])

  // Handle confirming state
  useEffect(() => {
    if (isConfirming && hash) {
      setState('confirming')
    }
  }, [isConfirming, hash])

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
      setError(null)
      // Refetch allowance to confirm on-chain state
      refetchAllowance()
    }
  }, [isSuccess, refetchAllowance])

  const approve = useCallback(() => {
    if (!address || !tokenAddress) return

    setError(null)
    setState('approving')

    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount], // Exact amount, not infinite (security best practice)
    })
  }, [address, tokenAddress, spender, amount, writeContract])

  const retry = useCallback(() => {
    setError(null)
    resetWrite()
    refetchAllowance()
    setState('idle')
  }, [resetWrite, refetchAllowance])

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
