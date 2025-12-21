import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import { OVFL_ABI } from '../abi/ovfl'
import { OVFL_ADDRESS } from '../lib/config/wagmi'

interface ClaimParams {
  ptToken: `0x${string}`
  amount: string
}

export function useClaim() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const claim = async ({ ptToken, amount }: ClaimParams) => {
    try {
      await writeContract({
        address: OVFL_ADDRESS,
        abi: OVFL_ABI,
        functionName: 'claim',
        args: [ptToken, parseEther(amount)],
      })
    } catch (err) {
      console.error('Claim failed:', err)
    }
  }

  return {
    claim,
    isLoading: isWritePending || isConfirming,
    isSuccess,
    error: writeError,
    txHash: hash,
  }
}
