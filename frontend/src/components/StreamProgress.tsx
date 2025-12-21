import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { formatUnits } from 'viem'
import { 
  type StreamData,
  calculateProgress,
  formatTimeRemaining,
  calculateWithdrawableAmount
} from '../lib/utils/streamCalculations'

interface StreamProgressProps {
  stream: StreamData
  showWithdrawable?: boolean
}

export function StreamProgress({ stream, showWithdrawable = true }: StreamProgressProps) {
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const progress = useMemo(() => {
    return calculateProgress(stream, currentTime)
  }, [stream, currentTime])

  const timeRemaining = useMemo(() => {
    return formatTimeRemaining(stream.endTime, currentTime)
  }, [stream.endTime, currentTime])

  const withdrawable = useMemo(() => {
    return calculateWithdrawableAmount(stream, currentTime)
  }, [stream, currentTime])

  const isComplete = progress >= 100

  // Dynamic gradient based on progress: teal -> gold as progress increases
  const progressStyle = useMemo(() => {
    if (isComplete) {
      return { background: '#4DB6AC' } // seafoam
    }
    // Blend from teal to gold based on progress
    return {
      background: `linear-gradient(90deg, #006064 0%, #FFB800 ${Math.min(progress + 20, 100)}%)`
    }
  }, [progress, isComplete])

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-white/50">Progress</span>
        <span className={`font-medium ${isComplete ? 'text-seafoam' : 'text-white'}`}>
          {progress.toFixed(1)}%
        </span>
      </div>

      <div className="h-2 bg-ovfl-900 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${isComplete ? 'shadow-[0_0_10px_rgba(77,182,172,0.4)]' : ''}`}
          style={progressStyle}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="flex justify-between items-center text-xs">
        <span className="text-white/40">
          {isComplete ? 'Stream completed' : timeRemaining}
        </span>
        {showWithdrawable && withdrawable > 0n && (
          <span className="text-gold">
            {formatUnits(withdrawable, 18)} available
          </span>
        )}
      </div>
    </div>
  )
}

export function StreamProgressCompact({ stream }: { stream: StreamData }) {
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const progress = useMemo(() => {
    return calculateProgress(stream, currentTime)
  }, [stream, currentTime])

  const isComplete = progress >= 100

  const progressStyle = useMemo(() => {
    if (isComplete) {
      return { background: '#4DB6AC' }
    }
    return {
      background: `linear-gradient(90deg, #006064 0%, #FFB800 ${Math.min(progress + 20, 100)}%)`
    }
  }, [progress, isComplete])

  return (
    <div className="h-1.5 bg-ovfl-900 rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ ...progressStyle, width: `${progress}%` }}
        transition={{ duration: 1, ease: 'linear' }}
      />
    </div>
  )
}
