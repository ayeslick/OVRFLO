/**
 * @deprecated Use useDepositFlow instead for production-ready deposit handling
 * This hook is kept for backward compatibility only
 */
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import { OVFL_ABI } from '../abi/ovfl'
import { OVFL_ADDRESS } from '../lib/config/wagmi'

interface DepositParams {
  market: `0x${string}`
  ptAmount: string
  minToUser: string
}

export function useDeposit() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const deposit = async ({ market, ptAmount, minToUser }: DepositParams) => {
    try {
      await writeContract({
        address: OVFL_ADDRESS,
        abi: OVFL_ABI,
        functionName: 'deposit',
        args: [market, parseEther(ptAmount), parseEther(minToUser)],
      })
    } catch (err) {
      console.error('Deposit failed:', err)
    }
  }

  return {
    deposit,
    isLoading: isWritePending || isConfirming,
    isSuccess,
    error: writeError,
    txHash: hash,
  }
}
