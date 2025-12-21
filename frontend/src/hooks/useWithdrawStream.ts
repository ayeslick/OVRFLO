import { useState, useEffect, useCallback } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { type Address } from 'viem'
import { SABLIER_ABI } from '../abi/ovfl'
import { SABLIER_ADDRESS } from '../lib/config/wagmi'
import { type Web3Error, classifyError } from '../lib/types/errors'
import { useToast } from '../components/Toast'

type WithdrawStep = 'idle' | 'withdrawing' | 'confirming' | 'success' | 'error'

interface UseWithdrawStreamReturn {
  step: WithdrawStep
  error: Web3Error | null
  withdrawMax: (streamId: bigint) => void
  withdrawAmount: (streamId: bigint, amount: bigint) => void
  reset: () => void
  isLoading: boolean
  hash: `0x${string}` | undefined
}

/**
 * Hook for withdrawing from Sablier streams
 */
export function useWithdrawStream(): UseWithdrawStreamReturn {
  const { address } = useAccount()
  const { showToast } = useToast()
  const [step, setStep] = useState<WithdrawStep>('idle')
  const [error, setError] = useState<Web3Error | null>(null)

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset: resetWrite
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash,
    confirmations: 1,
  })

  // Handle write pending
  useEffect(() => {
    if (isPending) {
      setStep('withdrawing')
    }
  }, [isPending])

  // Handle confirming
  useEffect(() => {
    if (isConfirming && hash) {
      setStep('confirming')
    }
  }, [isConfirming, hash])

  // Handle write errors
  useEffect(() => {
    if (writeError) {
      setError(classifyError(writeError))
      setStep('error')
      showToast('Withdrawal failed', 'error')
    }
  }, [writeError, showToast])

  // Handle receipt errors
  useEffect(() => {
    if (receiptError) {
      setError(classifyError(receiptError))
      setStep('error')
    }
  }, [receiptError])

  // Handle success
  useEffect(() => {
    if (isSuccess) {
      setStep('success')
      showToast('Withdrawal successful!', 'success')
    }
  }, [isSuccess, showToast])

  const withdrawMax = useCallback((streamId: bigint) => {
    if (!address) {
      showToast('Please connect your wallet', 'error')
      return
    }

    setError(null)
    setStep('withdrawing')

    writeContract({
      address: SABLIER_ADDRESS as Address,
      abi: [...SABLIER_ABI, {
        inputs: [
          { name: 'streamId', type: 'uint256' },
          { name: 'to', type: 'address' },
        ],
        name: 'withdrawMax',
        outputs: [{ type: 'uint128' }],
        stateMutability: 'nonpayable',
        type: 'function',
      }] as const,
      functionName: 'withdrawMax',
      args: [streamId, address],
    })
  }, [address, writeContract, showToast])

  const withdrawAmount = useCallback((streamId: bigint, amount: bigint) => {
    if (!address) {
      showToast('Please connect your wallet', 'error')
      return
    }

    if (amount === 0n) {
      showToast('Amount must be greater than 0', 'error')
      return
    }

    setError(null)
    setStep('withdrawing')

    writeContract({
      address: SABLIER_ADDRESS as Address,
      abi: SABLIER_ABI,
      functionName: 'withdraw',
      args: [streamId, address, amount],
    })
  }, [address, writeContract, showToast])

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    resetWrite()
  }, [resetWrite])

  return {
    step,
    error,
    withdrawMax,
    withdrawAmount,
    reset,
    isLoading: isPending || isConfirming,
    hash,
  }
}
