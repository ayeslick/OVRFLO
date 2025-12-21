import { useState, useEffect, useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useBlockNumber } from 'wagmi'
import { type Address, decodeEventLog } from 'viem'
import { useTokenApproval, type ApprovalState } from './useTokenApproval'
import { type DepositError, classifyError } from '../lib/types/errors'
import { OVFL_ADDRESS } from '../lib/config/wagmi'
import { OVFL_ABI } from '../abi/ovfl'
import { useToast } from '../components/Toast'
import { storeStreamId } from '../lib/storage/streams'

/**
 * Deposit flow steps
 */
export type DepositStep = 
  | 'idle' 
  | 'approve-pt' 
  | 'approve-fee' 
  | 'depositing' 
  | 'confirming'
  | 'success' 
  | 'error'

/**
 * Parameters for initiating a deposit
 */
export interface DepositParams {
  marketAddress: Address
  ptToken: Address
  underlyingToken: Address
  ptAmount: bigint
  feeAmount: bigint
  minToUser: bigint
  marketExpiry: number
}

/**
 * Deposit result after successful transaction
 */
export interface DepositResult {
  toUser: bigint
  toStream: bigint
  streamId: bigint
  txHash: `0x${string}`
}

interface UseDepositFlowReturn {
  step: DepositStep
  error: DepositError | null
  result: DepositResult | null
  startDeposit: (params: DepositParams) => void
  retry: () => void
  reset: () => void
  isLoading: boolean
  ptApproval: {
    state: ApprovalState
    needsApproval: boolean
    approve: () => void
  }
  feeApproval: {
    state: ApprovalState
    needsApproval: boolean
    approve: () => void
  }
  depositHash: `0x${string}` | undefined
}

/**
 * Multi-step deposit hook with approval handling and edge case protection
 * 
 * Flow: Check approvals → Approve PT (if needed) → Approve Fee (if needed) → Deposit → Success
 */
export function useDepositFlow(): UseDepositFlowReturn {
  const { address } = useAccount()
  const { showToast } = useToast()
  const [step, setStep] = useState<DepositStep>('idle')
  const [error, setError] = useState<DepositError | null>(null)
  const [params, setParams] = useState<DepositParams | null>(null)
  const [result, setResult] = useState<DepositResult | null>(null)
  const [shouldExecuteDeposit, setShouldExecuteDeposit] = useState(false)

  // Track current block for expiry checking
  const { data: blockNumber } = useBlockNumber({ 
    watch: step !== 'idle' && step !== 'success' && step !== 'error',
  })

  // PT token approval
  const ptApproval = useTokenApproval({
    tokenAddress: params?.ptToken,
    spender: OVFL_ADDRESS,
    amount: params?.ptAmount ?? 0n,
    enabled: !!params && step !== 'idle'
  })

  // Fee token approval (only needed if fee > 0)
  const feeApproval = useTokenApproval({
    tokenAddress: params?.underlyingToken,
    spender: OVFL_ADDRESS,
    amount: params?.feeAmount ?? 0n,
    enabled: !!params && step !== 'idle' && (params?.feeAmount ?? 0n) > 0n
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

  // Check for market expiry during the flow
  useEffect(() => {
    if (!params || step === 'idle' || step === 'success' || step === 'error') return

    const now = Math.floor(Date.now() / 1000)
    if (now >= params.marketExpiry) {
      setError({ type: 'market_expired', expiry: params.marketExpiry })
      setStep('error')
      showToast('Market expired during transaction', 'error')
    }
  }, [blockNumber, params, step, showToast])

  // Manage approval flow progression
  useEffect(() => {
    if (!params || step === 'idle' || step === 'success' || step === 'error') return

    // Handle PT approval step
    if (step === 'approve-pt') {
      if (ptApproval.error) {
        setError(ptApproval.error)
        setStep('error')
        return
      }
      
      if (ptApproval.state === 'approved') {
        // PT approved, check if fee approval needed
        if (params.feeAmount > 0n && feeApproval.needsApproval) {
          setStep('approve-fee')
        } else {
          // Ready to deposit
          setStep('depositing')
          setShouldExecuteDeposit(true)
        }
      } else if (ptApproval.state === 'needed' && ptApproval.needsApproval) {
        // Auto-trigger approval
        ptApproval.approve()
      }
    }

    // Handle fee approval step
    if (step === 'approve-fee') {
      if (feeApproval.error) {
        setError(feeApproval.error)
        setStep('error')
        return
      }
      
      if (feeApproval.state === 'approved') {
        setStep('depositing')
        setShouldExecuteDeposit(true)
      } else if (feeApproval.state === 'needed' && feeApproval.needsApproval) {
        // Auto-trigger approval
        feeApproval.approve()
      }
    }
  }, [step, ptApproval, feeApproval, params])

  // Execute deposit when ready
  useEffect(() => {
    if (!shouldExecuteDeposit || !params || step !== 'depositing') return

    setShouldExecuteDeposit(false)

    // Double-check market hasn't expired
    const now = Math.floor(Date.now() / 1000)
    if (now >= params.marketExpiry) {
      setError({ type: 'market_expired', expiry: params.marketExpiry })
      setStep('error')
      return
    }

    executeDeposit({
      address: OVFL_ADDRESS,
      abi: OVFL_ABI,
      functionName: 'deposit',
      args: [params.marketAddress, params.ptAmount, params.minToUser],
    })
  }, [shouldExecuteDeposit, params, step, executeDeposit])

  // Handle deposit pending state
  useEffect(() => {
    if (isDepositPending && step === 'depositing') {
      // Stay in depositing
    }
  }, [isDepositPending, step])

  // Handle confirming state
  useEffect(() => {
    if (isConfirming && depositHash) {
      setStep('confirming')
    }
  }, [isConfirming, depositHash])

  // Handle deposit errors
  useEffect(() => {
    if (depositError) {
      const classified = classifyError(depositError)
      setError(classified as DepositError)
      setStep('error')
      showToast('Deposit failed', 'error')
    }
  }, [depositError, showToast])

  // Handle receipt errors
  useEffect(() => {
    if (receiptError) {
      const classified = classifyError(receiptError)
      setError(classified as DepositError)
      setStep('error')
    }
  }, [receiptError])

  // Handle successful deposit - extract data from logs
  useEffect(() => {
    if (!isDepositSuccess || !depositReceipt || !depositHash) return

    try {
      // Find Deposited event
      let streamId: bigint | null = null
      let toUser: bigint = 0n
      let toStream: bigint = 0n

      for (const log of depositReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: OVFL_ABI,
            data: log.data,
            topics: log.topics,
          })

          if (decoded.eventName === 'Deposited') {
            const args = decoded.args as {
              user: Address
              market: Address
              ptAmount: bigint
              toUser: bigint
              toStream: bigint
              streamId: bigint
            }
            streamId = args.streamId
            toUser = args.toUser
            toStream = args.toStream
            break
          }
        } catch {
          // Not our event, continue
        }
      }

      if (streamId !== null) {
        setResult({
          toUser,
          toStream,
          streamId,
          txHash: depositHash
        })

        // Store stream ID in localStorage for later retrieval
        if (address && params) {
          storeStreamId(
            address,
            streamId,
            params.marketAddress,
            params.ptAmount,
            depositHash
          )
        }
      }

      setStep('success')
      showToast('Deposit successful! Stream created.', 'success')
    } catch (err) {
      console.error('Failed to parse deposit receipt:', err)
      // Still mark as success even if we can't parse stream ID
      setStep('success')
      showToast('Deposit successful!', 'success')
    }
  }, [isDepositSuccess, depositReceipt, depositHash, showToast])

  const startDeposit = useCallback((depositParams: DepositParams) => {
    if (!address) {
      showToast('Please connect your wallet', 'error')
      return
    }

    // Reset state
    setParams(depositParams)
    setError(null)
    setResult(null)
    setShouldExecuteDeposit(false)
    resetDeposit()

    // Check expiry immediately
    const now = Math.floor(Date.now() / 1000)
    if (now >= depositParams.marketExpiry) {
      setError({ type: 'market_expired', expiry: depositParams.marketExpiry })
      setStep('error')
      showToast('Market has already expired', 'error')
      return
    }

    // Determine starting step based on approvals needed
    // We need to wait for approval checks, so start with PT approval step
    setStep('approve-pt')
  }, [address, resetDeposit, showToast])

  const retry = useCallback(() => {
    if (!params) return
    setError(null)
    setResult(null)
    setShouldExecuteDeposit(false)
    resetDeposit()
    
    // Restart from appropriate step
    if (ptApproval.state !== 'approved') {
      setStep('approve-pt')
    } else if (params.feeAmount > 0n && feeApproval.state !== 'approved') {
      setStep('approve-fee')
    } else {
      setStep('depositing')
      setShouldExecuteDeposit(true)
    }
  }, [params, ptApproval.state, feeApproval.state, resetDeposit])

  const reset = useCallback(() => {
    setStep('idle')
    setParams(null)
    setError(null)
    setResult(null)
    setShouldExecuteDeposit(false)
    resetDeposit()
  }, [resetDeposit])

  const isLoading = step !== 'idle' && step !== 'success' && step !== 'error'

  return {
    step,
    error,
    result,
    startDeposit,
    retry,
    reset,
    isLoading,
    ptApproval: {
      state: ptApproval.state,
      needsApproval: ptApproval.needsApproval,
      approve: ptApproval.approve,
    },
    feeApproval: {
      state: feeApproval.state,
      needsApproval: feeApproval.needsApproval,
      approve: feeApproval.approve,
    },
    depositHash,
  }
}
