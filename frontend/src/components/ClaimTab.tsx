import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { motion } from 'framer-motion'
import ActionButton from './ActionButton'
import { useClaim } from '../hooks/useClaim'
import { EXAMPLE_MARKETS, type Market } from '../lib/config/wagmi'

export default function ClaimTab() {
  const { address } = useAccount()
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null)
  const [amount, setAmount] = useState('')

  // Mock balances - in production, fetch from chain
  const ovflBalance = '10.5'
  const symbol = selectedMarket?.name.replace('PT-', '') || 'ETH'

  const { claim, isLoading, isSuccess } = useClaim()

  // Check if market is matured
  const isMatured = selectedMarket 
    ? Date.now() / 1000 >= selectedMarket.expiry 
    : false

  // Reset on success
  useEffect(() => {
    if (isSuccess) {
      setAmount('')
    }
  }, [isSuccess])

  const handleMax = () => {
    setAmount(ovflBalance)
  }

  const handleClaim = () => {
    if (!selectedMarket || !amount) return
    claim({
      ptToken: selectedMarket.ptToken as `0x${string}`,
      amount,
    })
  }

  const formatExpiry = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const isDisabled = !selectedMarket || !amount || parseFloat(amount) <= 0 || !isMatured

  return (
    <div className="space-y-6">
      {/* Market Selection */}
      <div className="space-y-2">
        <label className="text-sm text-white/50">Select Market to Claim</label>
        <div className="grid gap-2">
          {EXAMPLE_MARKETS.map((market) => {
            const matured = Date.now() / 1000 >= market.expiry
            return (
              <button
                key={market.address}
                onClick={() => setSelectedMarket(market)}
                className={`w-full p-4 rounded-xl text-left transition-all ${
                  selectedMarket?.address === market.address
                    ? 'bg-accent/10 border border-accent/30'
                    : 'bg-ovfl-800/30 border border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                      <span className="text-accent font-semibold">PT</span>
                    </div>
                    <div>
                      <div className="font-medium">{market.name}</div>
                      <div className="text-xs text-white/50">
                        {matured ? 'Matured' : `Matures ${formatExpiry(market.expiry)}`}
                      </div>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-md text-xs font-medium ${
                    matured 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {matured ? 'Ready' : 'Pending'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Amount Input */}
      {selectedMarket && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between">
            <label className="text-sm text-white/50">Amount to Claim</label>
            <button
              onClick={handleMax}
              className="text-xs text-accent hover:text-accent-light transition-colors"
            >
              MAX
            </button>
          </div>
          
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="glass-input pr-28 text-xl font-medium"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <span className="text-white/60 text-sm font-medium">ovfl{symbol}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-white/40">Balance:</span>
            <span className="text-white/60">{ovflBalance} ovfl{symbol}</span>
          </div>
        </motion.div>
      )}

      {/* Info Box */}
      {selectedMarket && !isMatured && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <div className="font-medium text-yellow-400">Market Not Matured</div>
              <div className="text-sm text-yellow-400/70 mt-1">
                This market matures on {formatExpiry(selectedMarket.expiry)}. You can claim your PT tokens after maturity.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receive Preview */}
      {selectedMarket && amount && parseFloat(amount) > 0 && isMatured && (
        <div className="bg-ovfl-800/30 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-white/50">You Receive</span>
            <span className="text-accent font-medium">{amount} {selectedMarket.name}</span>
          </div>
          <p className="text-xs text-white/40 mt-2">
            Burn ovfl{symbol} 1:1 to receive PT tokens, then redeem on Pendle for underlying.
          </p>
        </div>
      )}

      <ActionButton
        label={isMatured ? 'Claim' : 'Not Yet Matured'}
        onClick={handleClaim}
        disabled={isDisabled}
        isLoading={isLoading}
        loadingText="Claiming..."
      />

      {!address && (
        <p className="text-center text-sm text-white/40">
          Connect your wallet to claim PT tokens
        </p>
      )}
    </div>
  )
}

