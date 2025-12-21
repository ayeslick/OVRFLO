import { useState, useEffect, useMemo } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { parseEther, formatUnits, erc20Abi } from 'viem'
import MarketSelect from './MarketSelect'
import AmountInput from './AmountInput'
import Preview from './Preview'
import ActionButton from './ActionButton'
import { TransactionSteps } from './TransactionSteps'
import { OverflowParticles } from './animations/OverflowParticles'
import { usePreview } from '../hooks/usePreview'
import { useDepositFlow } from '../hooks/useDepositFlow'
import { type Market } from '../lib/config/wagmi'
import { 
  validatePTAmount, 
  formatValidationError, 
  calculateMinToUser
} from '../lib/utils/validation'
import { formatDepositError } from '../lib/types/errors'

const SLIPPAGE_OPTIONS = [
  { value: 10, label: '0.1%' },
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 200, label: '2%' },
]

export default function DepositTab() {
  const { address } = useAccount()
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null)
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(50)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showOverflow, setShowOverflow] = useState(false)

  const depositFlow = useDepositFlow()

  // Trigger overflow particles on success
  useEffect(() => {
    if (depositFlow.step === 'success') {
      setShowOverflow(true)
    }
  }, [depositFlow.step])

  // Fetch PT token balance
  const { data: ptBalance = 0n } = useReadContract({
    address: selectedMarket?.ptToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { 
      enabled: !!address && !!selectedMarket,
      staleTime: 10_000,
    }
  })

  // Fetch deposit preview from contract
  const ptAmountBigInt = useMemo(() => {
    try {
      const trimmed = amount.trim()
      if (!trimmed || trimmed === '.' || !/^\d*\.?\d*$/.test(trimmed)) return 0n
      return parseEther(trimmed || '0')
    } catch {
      return 0n
    }
  }, [amount])

  const { preview, isLoading: previewLoading } = usePreview(
    selectedMarket?.address,
    ptAmountBigInt > 0n ? amount : ''
  )

  // Validate amount on change
  useEffect(() => {
    if (!amount || !selectedMarket) {
      setValidationError(null)
      return
    }

    const validation = validatePTAmount(amount, ptBalance)
    if (!validation.valid) {
      setValidationError(formatValidationError(validation.error))
    } else {
      setValidationError(null)
    }
  }, [amount, ptBalance, selectedMarket])

  // Reset form on success
  useEffect(() => {
    if (depositFlow.step === 'success') {
      setAmount('')
    }
  }, [depositFlow.step])

  const handleMax = () => {
    if (ptBalance > 0n) {
      setAmount(formatUnits(ptBalance, 18))
    }
  }

  const handleDeposit = () => {
    if (!selectedMarket || !preview || !amount) return

    const validation = validatePTAmount(amount, ptBalance)
    if (!validation.valid) {
      setValidationError(formatValidationError(validation.error))
      return
    }

    const toUserBigInt = parseEther(preview.toUser)
    const minToUser = calculateMinToUser(toUserBigInt, slippageBps)
    const feeAmountBigInt = parseEther(preview.fee)

    depositFlow.startDeposit({
      marketAddress: selectedMarket.address,
      ptToken: selectedMarket.ptToken,
      underlyingToken: selectedMarket.underlying,
      ptAmount: validation.amount,
      feeAmount: feeAmountBigInt,
      minToUser,
      marketExpiry: selectedMarket.expiry,
    })
  }

  const formatExpiry = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const isDisabled = 
    !address ||
    !selectedMarket || 
    !amount || 
    !!validationError ||
    depositFlow.isLoading ||
    previewLoading ||
    ptAmountBigInt === 0n

  const symbol = selectedMarket?.name.replace('PT-', '') || 'ETH'
  const hasFee = preview ? parseFloat(preview.fee) > 0 : false

  return (
    <div className="space-y-6">
      {/* Market Selection */}
      <MarketSelect
        selectedMarket={selectedMarket}
        onSelect={(market) => {
          setSelectedMarket(market)
          setAmount('')
          depositFlow.reset()
        }}
      />

      {/* Amount Input */}
      <div className="space-y-2">
        <AmountInput
          value={amount}
          onChange={(val) => {
            setAmount(val)
            if (depositFlow.step !== 'idle') {
              depositFlow.reset()
            }
          }}
          balance={formatUnits(ptBalance, 18)}
          symbol={selectedMarket?.name || 'PT'}
          onMax={handleMax}
          error={validationError}
          disabled={depositFlow.isLoading}
        />
      </div>

      {/* Preview */}
      {selectedMarket && ptAmountBigInt > 0n && !validationError && (
        <Preview
          toUser={preview?.toUser || '0'}
          toStream={preview?.toStream || '0'}
          fee={preview?.fee || '0'}
          rate={preview?.rate || '0'}
          symbol={`ovfl${symbol}`}
          expiry={formatExpiry(selectedMarket.expiry)}
          feeBps={selectedMarket.feeBps}
          isLoading={previewLoading}
        />
      )}

      {/* Slippage Settings */}
      {selectedMarket && ptAmountBigInt > 0n && !validationError && (
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-white/50">Slippage tolerance</span>
          <div className="flex gap-1">
            {SLIPPAGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSlippageBps(opt.value)}
                disabled={depositFlow.isLoading}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  slippageBps === opt.value
                    ? 'bg-gold/20 text-gold border border-gold/30'
                    : 'bg-white/5 text-white/50 border border-white/10 hover:border-gold/20 hover:text-white/70'
                } disabled:opacity-50`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transaction Steps */}
      {depositFlow.step !== 'idle' && (
        <TransactionSteps
          step={depositFlow.step}
          ptApprovalState={depositFlow.ptApproval.state}
          feeApprovalState={depositFlow.feeApproval.state}
          hasFee={hasFee}
          depositHash={depositFlow.depositHash}
        />
      )}

      {/* Error Display */}
      {depositFlow.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <div className="font-medium text-red-400">Transaction Failed</div>
              <div className="text-sm text-red-300/80 mt-1">
                {formatDepositError(depositFlow.error)}
              </div>
              <button
                onClick={depositFlow.retry}
                className="mt-3 text-sm text-red-400 hover:text-red-300 underline transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {depositFlow.step === 'success' && depositFlow.result && (
        <div className="relative bg-seafoam/10 border border-seafoam/20 rounded-xl p-4 overflow-hidden">
          {/* Overflow particles */}
          <OverflowParticles 
            active={showOverflow} 
            onComplete={() => setShowOverflow(false)} 
          />
          
          <div className="relative z-10 flex items-start gap-3">
            <svg className="w-5 h-5 text-seafoam flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <div className="font-medium text-seafoam">Deposit Successful!</div>
              <div className="text-sm text-seafoam/80 mt-1">
                Stream #{depositFlow.result.streamId.toString()} has been created
              </div>
              <div className="flex flex-wrap gap-3 mt-3">
                <a
                  href={`https://app.sablier.com/stream/LL2-${depositFlow.result.streamId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gold hover:text-gold-light underline transition-colors"
                >
                  View on Sablier →
                </a>
                <a
                  href={`https://etherscan.io/tx/${depositFlow.result.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gold hover:text-gold-light underline transition-colors"
                >
                  View on Etherscan →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Button */}
      <ActionButton
        label={
          depositFlow.isLoading
            ? depositFlow.step === 'approve-pt'
              ? 'Approving PT...'
              : depositFlow.step === 'approve-fee'
              ? 'Approving Fee...'
              : depositFlow.step === 'depositing'
              ? 'Depositing...'
              : 'Confirming...'
            : 'Deposit PT'
        }
        onClick={handleDeposit}
        disabled={isDisabled}
        isLoading={depositFlow.isLoading}
      />

      {!address && (
        <p className="text-center text-sm text-white/40">
          Connect your wallet to deposit PT tokens
        </p>
      )}
    </div>
  )
}
