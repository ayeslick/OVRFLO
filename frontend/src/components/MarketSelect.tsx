import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EXAMPLE_MARKETS, type Market } from '../lib/config/wagmi'

interface MarketSelectProps {
  selectedMarket: Market | null
  onSelect: (market: Market) => void
}

export default function MarketSelect({ selectedMarket, onSelect }: MarketSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const formatExpiry = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-white/50">Select Market</label>
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full glass-input flex items-center justify-between text-left"
        >
          {selectedMarket ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <span className="text-accent text-sm font-semibold">PT</span>
              </div>
              <div>
                <div className="font-medium">{selectedMarket.name}</div>
                <div className="text-xs text-white/50">
                  Expires {formatExpiry(selectedMarket.expiry)}
                </div>
              </div>
            </div>
          ) : (
            <span className="text-white/40">Select a market...</span>
          )}
          <svg
            className={`w-5 h-5 text-white/50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 w-full mt-2 py-2 glass-card"
            >
              {EXAMPLE_MARKETS.map((market) => (
                <button
                  key={market.address}
                  onClick={() => {
                    onSelect(market)
                    setIsOpen(false)
                  }}
                  className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors ${
                    selectedMarket?.address === market.address ? 'bg-accent/10' : ''
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                    <span className="text-accent text-sm font-semibold">PT</span>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{market.name}</div>
                    <div className="text-xs text-white/50">
                      Expires {formatExpiry(market.expiry)}
                    </div>
                  </div>
                  {selectedMarket?.address === market.address && (
                    <svg className="w-5 h-5 text-accent ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

