import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import Card from './Card'
import { StreamProgress } from './StreamProgress'
import { useUserStreams, type StreamData } from '../hooks/useUserStreams'
import { useWithdrawStream } from '../hooks/useWithdrawStream'
import { 
  calculateWithdrawableAmount,
  formatTimeRemaining
} from '../lib/utils/streamCalculations'
import { formatError } from '../lib/types/errors'

export default function StreamList() {
  const { isConnected } = useAccount()
  const { streams, isLoading, refetch } = useUserStreams()
  const withdraw = useWithdrawStream()
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))
  const [withdrawingStreamId, setWithdrawingStreamId] = useState<bigint | null>(null)

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Refetch after successful withdrawal
  useEffect(() => {
    if (withdraw.step === 'success') {
      refetch()
      setWithdrawingStreamId(null)
      withdraw.reset()
    }
  }, [withdraw.step, refetch, withdraw])

  // Reset withdrawing state on error
  useEffect(() => {
    if (withdraw.step === 'error') {
      setWithdrawingStreamId(null)
    }
  }, [withdraw.step])

  const handleWithdraw = (streamId: bigint) => {
    setWithdrawingStreamId(streamId)
    withdraw.withdrawMax(streamId)
  }

  if (!isConnected) return null

  // Show streams that have any balance remaining
  const displayStreams = useMemo(() => {
    return streams.filter(s => {
      // Show if not fully withdrawn
      return s.withdrawnAmount < s.totalAmount && !s.isDepleted
    })
  }, [streams])

  if (displayStreams.length === 0 && !isLoading) {
    return null
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">Your Streams</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={refetch}
            className="text-sm text-white/50 hover:text-gold transition-colors"
            title="Refresh streams"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <a
            href="https://app.sablier.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gold hover:text-gold-light transition-colors"
          >
            View All →
          </a>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {displayStreams.map((stream, index) => (
              <StreamCard
                key={stream.streamId.toString()}
                stream={stream}
                index={index}
                currentTime={currentTime}
                onWithdraw={handleWithdraw}
                isWithdrawing={withdrawingStreamId === stream.streamId && withdraw.isLoading}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Global withdraw error */}
      {withdraw.error && withdraw.step === 'error' && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{formatError(withdraw.error)}</p>
          <button
            onClick={withdraw.reset}
            className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </Card>
  )
}

interface StreamCardProps {
  stream: StreamData
  index: number
  currentTime: number
  onWithdraw: (streamId: bigint) => void
  isWithdrawing: boolean
}

function StreamCard({ 
  stream, 
  index, 
  currentTime, 
  onWithdraw, 
  isWithdrawing
}: StreamCardProps) {
  const withdrawable = useMemo(() => {
    return calculateWithdrawableAmount(stream, currentTime)
  }, [stream, currentTime])

  const isComplete = stream.endTime <= currentTime
  const hasWithdrawable = withdrawable > 0n

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.05 }}
      className="bg-ovfl-800/30 rounded-xl p-4 border border-white/5 hover:border-gold/10 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            isComplete ? 'bg-seafoam/20' : 'bg-gold/20'
          }`}>
            {isComplete ? (
              <svg className="w-4 h-4 text-seafoam" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            )}
          </div>
          <div>
            <div className="font-medium text-sm">Stream #{stream.streamId.toString()}</div>
            <div className="text-xs text-white/50">
              {formatTimeRemaining(stream.endTime, currentTime)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">
            <span className="text-white/60">
              {formatAmount(stream.withdrawnAmount)}
            </span>
            <span className="text-white/40"> / </span>
            <span className="text-gold">
              {formatAmount(stream.totalAmount)}
            </span>
          </div>
          <div className="text-xs text-white/50">ovflETH</div>
        </div>
      </div>

      {/* Progress */}
      <StreamProgress stream={stream} showWithdrawable={false} />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5">
        <div className="text-center">
          <div className="text-xs text-white/40">Total</div>
          <div className="text-sm font-medium">{formatAmount(stream.totalAmount)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-white/40">Withdrawn</div>
          <div className="text-sm font-medium">{formatAmount(stream.withdrawnAmount)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-white/40">Available</div>
          <div className={`text-sm font-medium ${hasWithdrawable ? 'text-gold' : ''}`}>
            {formatAmount(withdrawable)}
          </div>
        </div>
      </div>

      {hasWithdrawable && (
        <button
          onClick={() => onWithdraw(stream.streamId)}
          disabled={isWithdrawing}
          className="btn-gold-outline w-full mt-3 flex items-center justify-center gap-2"
        >
          {isWithdrawing ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Withdrawing...
            </>
          ) : (
            `Withdraw ${formatAmount(withdrawable)} ovflETH`
          )}
        </button>
      )}

      {/* Sablier Link */}
      <a
        href={`https://app.sablier.com/stream/LL2-${stream.streamId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-2 text-center text-xs text-white/40 hover:text-white/60 transition-colors"
      >
        View on Sablier →
      </a>
    </motion.div>
  )
}

function formatAmount(amount: bigint): string {
  const formatted = formatUnits(amount, 18)
  const num = parseFloat(formatted)
  
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  })
}
