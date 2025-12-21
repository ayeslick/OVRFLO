import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  glow?: boolean
  variant?: 'default' | 'gold'
}

export default function Card({ 
  children, 
  className = '', 
  glow = false,
  variant = 'default'
}: CardProps) {
  const variantClasses = variant === 'gold' 
    ? 'glass-card-gold' 
    : 'glass-card'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`
        ${variantClasses} p-6
        ${glow ? 'glow-border' : ''}
        ${className}
      `}
    >
      {children}
    </motion.div>
  )
}

