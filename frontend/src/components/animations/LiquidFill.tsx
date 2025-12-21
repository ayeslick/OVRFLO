import { motion, useReducedMotion } from 'framer-motion'

interface LiquidFillProps {
  targetLevel?: number
  duration?: number
  className?: string
}

export function LiquidFill({
  targetLevel = 0.35,
  duration = 0.8,
  className = ''
}: LiquidFillProps) {
  const prefersReducedMotion = useReducedMotion()

  const fillHeight = targetLevel * 100
  const waveOffset = 3

  if (prefersReducedMotion) {
    return (
      <div 
        className={`absolute inset-0 pointer-events-none ${className}`}
        style={{
          background: `linear-gradient(to top, rgba(0,96,100,0.15) 0%, rgba(0,96,100,0.15) ${fillHeight}%, transparent ${fillHeight}%)`
        }}
      />
    )
  }

  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <defs>
        <linearGradient id="liquidFillGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#006064" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#00838F" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* Main liquid fill */}
      <motion.path
        fill="url(#liquidFillGradient)"
        initial={{ 
          d: `M 0 100 L 0 100 Q 25 100 50 100 T 100 100 L 100 100 Z` 
        }}
        animate={{ 
          d: `M 0 100 L 0 ${100 - fillHeight} Q 25 ${100 - fillHeight - waveOffset} 50 ${100 - fillHeight} T 100 ${100 - fillHeight} L 100 100 Z`
        }}
        transition={{ 
          duration,
          ease: [0.4, 0.0, 0.2, 1]
        }}
      />

      {/* Animated wave surface */}
      <motion.path
        fill="none"
        stroke="rgba(77, 182, 172, 0.3)"
        strokeWidth="0.5"
        initial={{
          d: `M 0 ${100 - fillHeight} Q 25 ${100 - fillHeight - waveOffset} 50 ${100 - fillHeight} T 100 ${100 - fillHeight}`
        }}
        animate={{
          d: [
            `M 0 ${100 - fillHeight} Q 25 ${100 - fillHeight - waveOffset} 50 ${100 - fillHeight} T 100 ${100 - fillHeight}`,
            `M 0 ${100 - fillHeight} Q 25 ${100 - fillHeight + waveOffset} 50 ${100 - fillHeight} T 100 ${100 - fillHeight}`,
            `M 0 ${100 - fillHeight} Q 25 ${100 - fillHeight - waveOffset} 50 ${100 - fillHeight} T 100 ${100 - fillHeight}`,
          ]
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
          delay: duration
        }}
      />

      {/* Shimmer highlight */}
      <motion.rect
        x="0"
        y={100 - fillHeight - 2}
        width="100"
        height="4"
        fill="rgba(255,255,255,0.05)"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.5, 0] }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
          delay: duration
        }}
      />
    </svg>
  )
}
