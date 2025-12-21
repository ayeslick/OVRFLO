interface AmountInputProps {
  value: string
  onChange: (value: string) => void
  balance: string
  symbol: string
  onMax: () => void
  error?: string | null
  disabled?: boolean
}

export default function AmountInput({ 
  value, 
  onChange, 
  balance, 
  symbol, 
  onMax,
  error,
  disabled 
}: AmountInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-white/50">Amount</label>
        <button
          onClick={onMax}
          disabled={disabled}
          className="text-xs text-gold hover:text-gold-light font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          MAX
        </button>
      </div>
      
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const val = e.target.value
            if (val === '' || /^\d*\.?\d*$/.test(val)) {
              onChange(val)
            }
          }}
          placeholder="0.0"
          disabled={disabled}
          className={`glass-input pr-24 text-xl font-medium ${
            error ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20' : ''
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          aria-invalid={!!error}
          aria-describedby={error ? 'amount-error' : undefined}
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md pt-badge flex items-center justify-center">
            <span className="text-xs font-bold">PT</span>
          </div>
          <span className="text-white/60 text-sm font-medium">{symbol}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-white/40">Balance:</span>
        <button 
          onClick={onMax}
          disabled={disabled}
          className="text-white/60 hover:text-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {balance} {symbol}
        </button>
      </div>

      {error && (
        <p id="amount-error" className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

