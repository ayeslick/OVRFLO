import { motion } from 'framer-motion'
import type { DepositStep } from '../hooks/useDepositFlow'
import type { ApprovalState } from '../hooks/useTokenApproval'

interface TransactionStepsProps {
  step: DepositStep
  ptApprovalState: ApprovalState
  feeApprovalState: ApprovalState
  hasFee: boolean
  depositHash?: `0x${string}`
}

type StepStatus = 'pending' | 'active' | 'complete' | 'error'

interface StepInfo {
  label: string
  status: StepStatus
  hash?: string
}

export function TransactionSteps({
  step,
  ptApprovalState,
  feeApprovalState,
  hasFee,
  depositHash
}: TransactionStepsProps) {
  const steps: StepInfo[] = []

  const ptStatus: StepStatus = 
    ptApprovalState === 'approved' ? 'complete' :
    ptApprovalState === 'error' ? 'error' :
    step === 'approve-pt' ? 'active' : 'pending'
  
  steps.push({
    label: 'Approve PT',
    status: ptStatus,
  })

  if (hasFee) {
    const feeStatus: StepStatus = 
      feeApprovalState === 'approved' ? 'complete' :
      feeApprovalState === 'error' ? 'error' :
      step === 'approve-fee' ? 'active' : 'pending'
    
    steps.push({
      label: 'Approve Fee',
      status: feeStatus,
    })
  }

  const depositStatus: StepStatus = 
    step === 'success' ? 'complete' :
    step === 'error' && ptApprovalState === 'approved' && (!hasFee || feeApprovalState === 'approved') ? 'error' :
    step === 'depositing' || step === 'confirming' ? 'active' : 'pending'
  
  steps.push({
    label: 'Deposit',
    status: depositStatus,
    hash: depositHash,
  })

  return (
    <div className="bg-ovfl-800/30 rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-white/50">Transaction Progress</span>
        {step === 'confirming' && (
          <span className="text-xs text-gold animate-pulse">Confirming...</span>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <motion.div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  s.status === 'complete' ? 'bg-seafoam/20 text-seafoam border border-seafoam/30' :
                  s.status === 'active' ? 'bg-gold/20 text-gold border border-gold/30 shadow-glow-sm' :
                  s.status === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                  'bg-white/5 text-white/30 border border-white/10'
                }`}
                animate={s.status === 'active' ? { scale: [1, 1.05, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                {s.status === 'complete' ? (
                  <CheckIcon />
                ) : s.status === 'error' ? (
                  <XIcon />
                ) : s.status === 'active' ? (
                  <LoadingSpinner />
                ) : (
                  i + 1
                )}
              </motion.div>
              <span className={`mt-1.5 text-xs font-medium ${
                s.status === 'complete' ? 'text-seafoam' :
                s.status === 'active' ? 'text-gold' :
                s.status === 'error' ? 'text-red-400' :
                'text-white/30'
              }`}>
                {s.label}
              </span>
            </div>

            {/* Connector line with gradient when progressing */}
            {i < steps.length - 1 && (
              <div 
                className={`h-0.5 flex-1 mx-2 transition-all duration-500 rounded-full ${
                  steps[i + 1].status !== 'pending' 
                    ? 'bg-gradient-to-r from-seafoam to-gold' 
                    : s.status === 'complete' 
                      ? 'bg-gradient-to-r from-seafoam to-white/20'
                      : 'bg-white/10'
                }`} 
              />
            )}
          </div>
        ))}
      </div>

      {depositHash && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <a
            href={`https://etherscan.io/tx/${depositHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gold/70 hover:text-gold transition-colors flex items-center gap-1"
          >
            View on Etherscan
            <ExternalLinkIcon />
          </a>
        </div>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}
