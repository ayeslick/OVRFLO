import { useMemo } from 'react'
import { useReadContracts, useAccount } from 'wagmi'
import { type Address } from 'viem'
import { SABLIER_ABI } from '../abi/ovfl'
import { SABLIER_ADDRESS } from '../lib/config/wagmi'
import { getUserStreamIds } from '../lib/storage/streams'
import { 
  type StreamData,
  isStreamActive
} from '../lib/utils/streamCalculations'

export type { StreamData }

interface UseUserStreamsReturn {
  streams: StreamData[]
  activeStreams: StreamData[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Hook to fetch and manage user's Sablier streams
 * Reads stream data directly from contract via multicall
 */
export function useUserStreams(): UseUserStreamsReturn {
  const { address } = useAccount()

  // Get stored stream IDs from localStorage
  const streamIds = useMemo(() => {
    if (!address) return []
    return getUserStreamIds(address)
  }, [address])

  // Build multicall contracts array for getStream
  const streamContracts = useMemo(() => {
    return streamIds.map(streamId => ({
      address: SABLIER_ADDRESS as Address,
      abi: SABLIER_ABI,
      functionName: 'getStream' as const,
      args: [streamId] as const,
    }))
  }, [streamIds])

  // Build multicall for withdrawnAmount (Sablier stores this separately)
  const withdrawnContracts = useMemo(() => {
    return streamIds.map(streamId => ({
      address: SABLIER_ADDRESS as Address,
      abi: [{
        inputs: [{ name: 'streamId', type: 'uint256' }],
        name: 'getWithdrawnAmount',
        outputs: [{ type: 'uint128' }],
        stateMutability: 'view',
        type: 'function',
      }] as const,
      functionName: 'getWithdrawnAmount' as const,
      args: [streamId] as const,
    }))
  }, [streamIds])

  // Fetch stream data
  const { 
    data: streamResults, 
    isLoading: isLoadingStreams,
    error: streamError,
    refetch: refetchStreams
  } = useReadContracts({
    contracts: streamContracts,
    query: {
      enabled: streamIds.length > 0,
      staleTime: 30_000,
      refetchInterval: 60_000,
    }
  })

  // Fetch withdrawn amounts
  const {
    data: withdrawnResults,
    isLoading: isLoadingWithdrawn,
    refetch: refetchWithdrawn
  } = useReadContracts({
    contracts: withdrawnContracts,
    query: {
      enabled: streamIds.length > 0,
      staleTime: 30_000,
      refetchInterval: 60_000,
    }
  })

  // Parse stream data
  const streams: StreamData[] = useMemo(() => {
    if (!streamResults) return []

    const parsed: StreamData[] = []
    
    for (let index = 0; index < streamResults.length; index++) {
      const result = streamResults[index]
      if (result.status !== 'success' || !result.result) continue

      const data = result.result as {
        sender: Address
        recipient: Address
        totalAmount: bigint
        asset: Address
        cancelable: boolean
        transferable: boolean
        startTime: number
        cliffTime: number
        endTime: number
        isCanceled: boolean
        isDepleted: boolean
        wasCanceled: boolean
      }

      // Get withdrawn amount from separate call
      const withdrawnAmount = withdrawnResults?.[index]?.status === 'success'
        ? (withdrawnResults[index].result as bigint)
        : 0n

      parsed.push({
        streamId: streamIds[index],
        sender: data.sender,
        recipient: data.recipient,
        totalAmount: data.totalAmount,
        asset: data.asset,
        cancelable: data.cancelable,
        transferable: data.transferable,
        startTime: Number(data.startTime),
        cliffTime: Number(data.cliffTime),
        endTime: Number(data.endTime),
        isCanceled: data.isCanceled,
        isDepleted: data.isDepleted,
        withdrawnAmount,
      })
    }

    return parsed
  }, [streamResults, withdrawnResults, streamIds])

  // Filter active streams
  const activeStreams = useMemo(() => {
    return streams.filter(s => isStreamActive(s))
  }, [streams])

  const refetch = () => {
    refetchStreams()
    refetchWithdrawn()
  }

  return {
    streams,
    activeStreams,
    isLoading: isLoadingStreams || isLoadingWithdrawn,
    error: streamError as Error | null,
    refetch,
  }
}

/**
 * Hook to fetch a single stream by ID
 */
export function useStream(streamId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: streamId ? [
      {
        address: SABLIER_ADDRESS as Address,
        abi: SABLIER_ABI,
        functionName: 'getStream',
        args: [streamId],
      },
      {
        address: SABLIER_ADDRESS as Address,
        abi: [{
          inputs: [{ name: 'streamId', type: 'uint256' }],
          name: 'getWithdrawnAmount',
          outputs: [{ type: 'uint128' }],
          stateMutability: 'view',
          type: 'function',
        }] as const,
        functionName: 'getWithdrawnAmount',
        args: [streamId],
      },
      {
        address: SABLIER_ADDRESS as Address,
        abi: SABLIER_ABI,
        functionName: 'withdrawableAmountOf',
        args: [streamId],
      },
    ] : [],
    query: {
      enabled: !!streamId,
      staleTime: 10_000,
    }
  })

  const stream: StreamData | null = useMemo(() => {
    if (!data || !streamId || data.length < 2) return null
    
    const streamResult = data[0]
    const withdrawnResult = data[1]
    
    if (!streamResult || streamResult.status !== 'success' || !streamResult.result) return null

    const streamData = streamResult.result as {
      sender: Address
      recipient: Address
      totalAmount: bigint
      asset: Address
      cancelable: boolean
      transferable: boolean
      startTime: number
      cliffTime: number
      endTime: number
      isCanceled: boolean
      isDepleted: boolean
      wasCanceled: boolean
    }

    const withdrawnAmount = withdrawnResult?.status === 'success'
      ? (withdrawnResult.result as bigint)
      : 0n

    return {
      streamId,
      sender: streamData.sender,
      recipient: streamData.recipient,
      totalAmount: streamData.totalAmount,
      asset: streamData.asset,
      cancelable: streamData.cancelable,
      transferable: streamData.transferable,
      startTime: Number(streamData.startTime),
      cliffTime: Number(streamData.cliffTime),
      endTime: Number(streamData.endTime),
      isCanceled: streamData.isCanceled,
      isDepleted: streamData.isDepleted,
      withdrawnAmount,
    }
  }, [data, streamId])

  const withdrawableAmount = useMemo(() => {
    if (!data || data.length < 3 || !data[2] || data[2].status !== 'success') return 0n
    return data[2].result as bigint
  }, [data])

  return {
    stream,
    withdrawableAmount,
    isLoading,
    error: error as Error | null,
    refetch,
  }
}
