import { useReadContract } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { OVFL_ABI } from '../abi/ovfl'
import { OVFL_ADDRESS } from '../lib/config/wagmi'

interface Preview {
  toUser: string
  toStream: string
  fee: string
  rate: string
}

export function usePreview(marketAddress: string | undefined, amount: string) {
  const ptAmount = amount ? parseEther(amount) : BigInt(0)

  const { data, isLoading, error } = useReadContract({
    address: OVFL_ADDRESS,
    abi: OVFL_ABI,
    functionName: 'previewDeposit',
    args: marketAddress ? [marketAddress as `0x${string}`, ptAmount] : undefined,
    query: {
      enabled: !!marketAddress && ptAmount > BigInt(0),
    },
  })

  const preview: Preview | null = data
    ? {
        toUser: formatEther(data[0]),
        toStream: formatEther(data[1]),
        fee: formatEther(data[2]),
        rate: ((Number(data[3]) / 1e18) * 100).toFixed(2),
      }
    : null

  return {
    preview,
    isLoading,
    error,
  }
}

