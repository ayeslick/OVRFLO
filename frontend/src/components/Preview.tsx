import { motion } from 'framer-motion'
import { LiquidFill } from './animations/LiquidFill'

function formatNumber(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  })
}

interface PreviewProps {
  toUser: string
  toStream: string
  fee: string
  rate: string
  symbol: string
  expiry: string
  feeBps?: number
  isLoading?: boolean
}

export default function Preview({ 
  toUser, 
  toStream, 
  fee, 
  rate, 
  symbol, 
  expiry,
  feeBps,
  isLoading 
}: PreviewProps) {
  const feeLabel = feeBps ? `Fee (${(feeBps / 100).toFixed(1)}%)` : 'Fee'
  const hasValidAmount = parseFloat(toUser) > 0 || parseFloat(toStream) > 0
  
  const rows = [
    { label: 'Immediate', value: `${formatNumber(toUser)} ${symbol}`, highlight: true },
    { label: 'Streamed', value: `${formatNumber(toStream)} ${symbol}`, subtext: `until ${expiry}`, isTeal: true },
    { label: feeLabel, value: fee === '0' || parseFloat(fee) === 0 ? 'No fee' : `${formatNumber(fee)} ETH` },
    { label: 'PT Rate', value: `${rate}%`, subtext: 'of face value' },
  ]

  return (
    <div className="space-y-2">
      <label className="text-sm text-white/50">You Receive</label>
      
      <div className="relative bg-ovfl-800/30 rounded-xl p-4 space-y-3 overflow-hidden">
        {/* Liquid fill animation - shows when there's a valid amount */}
        {hasValidAmount && !isLoading && (
          <LiquidFill targetLevel={0.35} duration={0.8} />
        )}

        {/* Content layer */}
        <div className="relative z-10 space-y-3">
          {rows.map((row, i) => (
            <motion.div
              key={row.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: isLoading ? 0.5 : 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className="flex items-center justify-between"
            >
              <span className="text-white/50 text-sm">{row.label}</span>
              <div className="text-right">
                <span className={`font-medium ${
                  row.highlight ? 'text-gold' : 
                  row.isTeal ? 'text-teal-light' : 
                  'text-white'
                }`}>
                  {isLoading ? '...' : row.value}
                </span>
                {row.subtext && (
                  <div className="text-xs text-white/40">{row.subtext}</div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

