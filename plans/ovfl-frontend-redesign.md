# OVFL Frontend: Complete Redesign & Implementation

## Overview

Build a production-ready, modern DeFi frontend for OVFL - a Pendle PT wrapper protocol that enables immediate liquidity for yield tokenization. The current frontend draft provides a solid foundation with React, wagmi, and RainbowKit, but requires substantial improvements in architecture, data integration, UX patterns, and visual design to meet 2025 DeFi standards.

## Problem Statement / Motivation

### Current State Analysis

**What Works**:
- ✅ Modern tech stack (Vite, React 18, wagmi v2, RainbowKit)
- ✅ Clean component structure with separation of concerns
- ✅ Basic transaction flows (deposit, claim)
- ✅ Framer Motion for smooth animations
- ✅ Dark glassmorphism aesthetic

**Critical Gaps**:
- ❌ **No real Pendle integration** - Uses placeholder market data instead of live Pendle API
- ❌ **Incomplete Sablier streams** - `useStreams` hook is stubbed, no actual stream fetching
- ❌ **Missing approval flows** - No token approval handling (PT + underlying for fees)
- ❌ **No error handling** - Transactions fail silently without user feedback
- ❌ **Static market data** - No TWAP rates, expiry checking, or market validation
- ❌ **No real-time updates** - Balances and rates don't update without page refresh
- ❌ **Generic UI** - Glassmorphism is overused in DeFi; lacks distinctive branding
- ❌ **Accessibility issues** - Missing ARIA labels, keyboard navigation
- ❌ **No loading states** - Skeleton loaders missing for async data
- ❌ **Mobile UX** - Not optimized for mobile wallet interactions

### Why This Matters

OVFL solves a real problem: **PT holders must wait until maturity to realize their discount**. OVFL unlocks that value immediately while streaming the yield. For this to work, users need:

1. **Confidence in the math** - Clear previews showing immediate vs. streamed amounts
2. **Trust in the protocol** - Transparent fee structure, real market data
3. **Seamless UX** - Multi-step approvals shouldn't feel complex
4. **Real-time feedback** - Know when streams are vesting, when to claim

The frontend is the primary way users interact with this innovation. A poor frontend means low adoption, regardless of smart contract quality.

## Proposed Solution

### High-Level Approach

**Phase 1: Data Integration & Core Functionality**
- Integrate Pendle API for live market data (rates, expiry, TVL)
- Implement Sablier stream fetching via GraphQL/Envio
- Build robust approval flows with state machines
- Add comprehensive error handling and transaction states

**Phase 2: UX & Visual Redesign**
- Move beyond glassmorphism to a distinctive OVFL brand
- Implement progressive disclosure for complex financial data
- Add real-time updates via WebSockets (balances, rates, stream progress)
- Build mobile-first responsive design

**Phase 3: Performance & Polish**
- Optimize with TanStack Query caching strategies
- Add skeleton loaders and optimistic updates
- Implement accessibility standards (WCAG 2.1 AA)
- Add analytics and monitoring (transaction success rates, user flows)

## Technical Approach

### Stack Decisions

**Keep**:
- ✅ Next.js 15 (migrate from Vite for better SSR, streaming, SEO)
- ✅ wagmi v2 + viem (industry standard)
- ✅ RainbowKit (best wallet UX)
- ✅ TanStack Query (add for caching)
- ✅ TypeScript (strict mode)

**Replace/Add**:
- 🔄 Tailwind CSS v4 (upgrade from v3 for better performance)
- ➕ shadcn/ui (replace custom components for better DX)
- ➕ Recharts (for stream progress visualization)
- ➕ WebSockets (Alchemy/Infura for real-time data)
- ➕ GraphQL client (for Sablier subgraph queries)

### Architecture

```
app/ (Next.js 15 App Router)
├── layout.tsx                  # Root layout with providers
├── page.tsx                    # Landing page with protocol overview
├── deposit/
│   └── page.tsx               # PT deposit flow
├── claim/
│   └── page.tsx               # Claim matured PT
├── streams/
│   └── page.tsx               # View all Sablier streams
└── api/                       # Server-side API routes
    └── pendle/
        └── markets/route.ts   # Fetch Pendle markets with caching

components/
├── ui/                        # shadcn/ui base components
│   ├── button.tsx
│   ├── card.tsx
│   ├── progress.tsx
│   └── ...
├── providers/                 # Context providers
│   ├── WagmiProvider.tsx
│   └── QueryProvider.tsx
├── deposit/                   # Deposit-specific components
│   ├── MarketSelector.tsx
│   ├── AmountInput.tsx
│   ├── DepositPreview.tsx
│   ├── ApprovalFlow.tsx
│   └── TransactionSteps.tsx
├── streams/                   # Stream components
│   ├── StreamCard.tsx
│   ├── StreamProgress.tsx
│   ├── WithdrawButton.tsx
│   └── StreamList.tsx
├── claim/                     # Claim components
│   ├── MaturedMarkets.tsx
│   └── ClaimForm.tsx
└── shared/                    # Shared components
    ├── Header.tsx
    ├── Footer.tsx
    ├── ConnectButton.tsx
    └── TransactionToast.tsx

hooks/
├── pendle/
│   ├── usePendleMarkets.ts    # Fetch live markets
│   ├── useMarketData.ts       # Market details (APY, liquidity, expiry)
│   └── usePtRate.ts           # TWAP rate from oracle
├── sablier/
│   ├── useUserStreams.ts      # Fetch user's streams via GraphQL
│   ├── useStreamProgress.ts   # Real-time stream progress
│   └── useWithdrawStream.ts   # Withdraw from stream
├── ovfl/
│   ├── useDeposit.ts          # Full deposit flow with approvals
│   ├── useClaim.ts            # Claim matured PT
│   ├── usePreviewDeposit.ts   # Preview deposit outcome
│   └── useBalances.ts         # PT + ovflETH balances
└── shared/
    ├── useApproval.ts         # Generic ERC20 approval hook
    └── useTransaction.ts      # Transaction state machine

lib/
├── pendle/
│   ├── api.ts                 # Pendle API client
│   └── types.ts               # Pendle type definitions
├── sablier/
│   ├── graphql.ts             # GraphQL queries for streams
│   └── client.ts              # GraphQL client setup
└── utils/
    ├── format.ts              # Number/date formatting
    ├── contracts.ts           # Contract ABIs and addresses
    └── constants.ts           # App constants
```

### Data Flow

**Deposit Flow**:
```
1. User connects wallet (RainbowKit)
2. Fetch live Pendle markets (Pendle API) → Cache 5min
3. User selects market
4. Fetch market details (rate, expiry, liquidity) → Cache 30sec
5. User inputs PT amount
6. Preview deposit (OVFL.previewDeposit) → Real-time
7. Check PT allowance → Approve if needed
8. Check underlying allowance → Approve if needed
9. Execute deposit → Create Sablier stream
10. Show success + stream ID → Redirect to streams page
```

**Stream Viewing Flow**:
```
1. Fetch user's streams (Sablier GraphQL) → Cache 1min, refetch on focus
2. Calculate real-time progress (client-side math)
3. Display withdrawable amounts
4. WebSocket updates for new blocks → Invalidate queries
5. Withdraw action → Update stream state optimistically
```

**Claim Flow**:
```
1. Fetch user's ovflETH balances per market
2. Filter for matured markets (block.timestamp >= expiry)
3. Show claimable PT amounts (1:1 with ovflETH)
4. Burn ovflETH → Receive PT
5. Option to redeem PT on Pendle (external link)
```

## Implementation Phases

### Phase 1: Foundation & Data Integration (Days 1-3)

**Goals**: Migrate to Next.js, set up data fetching, implement core contracts

#### Tasks

##### 1.1: Next.js Migration
```typescript
// app/layout.tsx
import { Providers } from '@/components/providers'
import '@/styles/globals.css'
import '@rainbow-me/rainbowkit/styles.css'

export const metadata = {
  title: 'OVFL - Unlock PT Yield Early',
  description: 'Access bond yield before maturity with Pendle PT wrapping',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

##### 1.2: Pendle Integration
```typescript
// lib/pendle/api.ts
export async function fetchActiveMarkets(chainId: number) {
  const response = await fetch(
    `https://api-v2.pendle.finance/core/v1/${chainId}/markets/active`,
    { next: { revalidate: 300 } } // Cache 5 minutes
  )
  if (!response.ok) throw new Error('Failed to fetch markets')
  return response.json()
}

export async function fetchMarketData(chainId: number, marketAddress: string) {
  const response = await fetch(
    `https://api-v2.pendle.finance/core/v2/${chainId}/markets/${marketAddress}/data`,
    { next: { revalidate: 30 } } // Cache 30 seconds
  )
  return response.json()
}

// hooks/pendle/usePendleMarkets.ts
import { useQuery } from '@tanstack/react-query'
import { fetchActiveMarkets } from '@/lib/pendle/api'
import { useChainId } from 'wagmi'

export function usePendleMarkets() {
  const chainId = useChainId()

  return useQuery({
    queryKey: ['pendle', 'markets', chainId],
    queryFn: () => fetchActiveMarkets(chainId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
  })
}
```

##### 1.3: Sablier GraphQL Integration
```typescript
// lib/sablier/graphql.ts
import { GraphQLClient } from 'graphql-request'

export const sablierClient = new GraphQLClient(
  'https://api.thegraph.com/subgraphs/name/sablier-labs/sablier-v2-mainnet'
)

export const USER_STREAMS_QUERY = `
  query GetUserStreams($recipient: String!, $first: Int!) {
    streams(
      where: {
        recipient: $recipient,
        status_in: [STREAMING, SETTLED]
      },
      first: $first,
      orderBy: startTime,
      orderDirection: desc
    ) {
      id
      tokenId
      asset { id symbol decimals }
      sender { id }
      recipient { id }
      depositAmount
      withdrawnAmount
      startTime
      endTime
      status
    }
  }
`

// hooks/sablier/useUserStreams.ts
import { useQuery } from '@tanstack/react-query'
import { sablierClient, USER_STREAMS_QUERY } from '@/lib/sablier/graphql'
import { useAccount } from 'wagmi'

export function useUserStreams() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['sablier', 'streams', address],
    queryFn: async () => {
      if (!address) return []
      const data = await sablierClient.request(USER_STREAMS_QUERY, {
        recipient: address.toLowerCase(),
        first: 50,
      })
      return data.streams
    },
    enabled: !!address,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
  })
}
```

##### 1.4: Approval Flow State Machine
```typescript
// hooks/shared/useApproval.ts
import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, parseEther } from 'viem'

type ApprovalState = 'idle' | 'checking' | 'approving' | 'approved' | 'error'

export function useApproval(
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  enabled = true
) {
  const [state, setState] = useState<ApprovalState>('idle')

  // Check current allowance
  const { data: allowance, refetch } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [userAddress, spender],
    query: { enabled },
  })

  const needsApproval = allowance !== undefined && allowance < amount

  // Approve transaction
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isSuccess) {
      setState('approved')
      refetch() // Update allowance
    }
  }, [isSuccess])

  const approve = () => {
    setState('approving')
    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
    })
  }

  return {
    needsApproval,
    state,
    approve,
    isApproving: isPending,
    allowance,
  }
}
```

**Acceptance Criteria**:
- [ ] Next.js 15 App Router setup with providers
- [ ] Pendle markets fetched from live API with caching
- [ ] Market data shows real APY, expiry, liquidity
- [ ] Sablier streams fetched via GraphQL
- [ ] Token approval flow handles PT + underlying
- [ ] All data fetching uses TanStack Query with appropriate cache times
- [ ] TypeScript strict mode with no `any` types

---

### Phase 2: Transaction Flows & UX (Days 4-6)

**Goals**: Build deposit/claim flows, error handling, transaction feedback

#### Tasks

##### 2.1: Multi-Step Deposit Component
```typescript
// components/deposit/TransactionSteps.tsx
import { motion, AnimatePresence } from 'framer-motion'

type Step = 'preview' | 'approve-pt' | 'approve-fee' | 'deposit' | 'success'

export function TransactionSteps({
  currentStep,
  onComplete
}: {
  currentStep: Step
  onComplete: () => void
}) {
  const steps = [
    { id: 'preview', label: 'Review', icon: '📋' },
    { id: 'approve-pt', label: 'Approve PT', icon: '✅' },
    { id: 'approve-fee', label: 'Approve Fee', icon: '✅' },
    { id: 'deposit', label: 'Deposit', icon: '🚀' },
    { id: 'success', label: 'Complete', icon: '🎉' },
  ]

  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const isActive = step.id === currentStep
        const isComplete = steps.findIndex(s => s.id === currentStep) > index

        return (
          <motion.div
            key={step.id}
            initial={false}
            animate={{
              opacity: isActive || isComplete ? 1 : 0.5,
              scale: isActive ? 1.02 : 1,
            }}
            className={`
              p-4 rounded-lg border-2 transition-colors
              ${isActive ? 'border-purple-500 bg-purple-500/10' : ''}
              ${isComplete ? 'border-green-500 bg-green-500/10' : ''}
              ${!isActive && !isComplete ? 'border-gray-700' : ''}
            `}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{step.icon}</span>
              <div className="flex-1">
                <div className="font-medium">{step.label}</div>
                {isActive && (
                  <div className="text-sm text-gray-400 mt-1">
                    {getStepDescription(step.id)}
                  </div>
                )}
              </div>
              {isComplete && <CheckIcon className="text-green-500" />}
              {isActive && <Spinner />}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
```

##### 2.2: Deposit Flow with Error Handling
```typescript
// hooks/ovfl/useDeposit.ts
import { useState } from 'react'
import { useApproval } from '@/hooks/shared/useApproval'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { type BaseError } from 'wagmi'
import { toast } from 'sonner'

type DepositStep = 'idle' | 'approve-pt' | 'approve-fee' | 'depositing' | 'success' | 'error'

export function useDeposit() {
  const [step, setStep] = useState<DepositStep>('idle')
  const [error, setError] = useState<string | null>(null)

  const ptApproval = useApproval(/* ... */)
  const feeApproval = useApproval(/* ... */)

  const { writeContract, data: depositHash } = useWriteContract({
    mutation: {
      onError: (err) => {
        const baseError = err as BaseError
        setError(baseError.shortMessage || err.message)
        setStep('error')
        toast.error(`Deposit failed: ${baseError.shortMessage}`)
      },
    },
  })

  const { isSuccess: isDeposited } = useWaitForTransactionReceipt({
    hash: depositHash,
    onReplaced: (replacement) => {
      if (replacement.reason === 'cancelled') {
        toast.error('Transaction was cancelled')
        setStep('error')
      }
    },
  })

  const executeDeposit = async (params: DepositParams) => {
    try {
      setError(null)

      // Step 1: PT Approval
      if (ptApproval.needsApproval) {
        setStep('approve-pt')
        await ptApproval.approve()
        // Wait for approval confirmation
        await waitForApproval(ptApproval)
      }

      // Step 2: Fee Approval
      if (feeApproval.needsApproval) {
        setStep('approve-fee')
        await feeApproval.approve()
        await waitForApproval(feeApproval)
      }

      // Step 3: Deposit
      setStep('depositing')
      writeContract({
        address: OVFL_ADDRESS,
        abi: ovflAbi,
        functionName: 'deposit',
        args: [params.market, params.ptAmount, params.minToUser],
      })

      // Success is handled by useWaitForTransactionReceipt
      if (isDeposited) {
        setStep('success')
        toast.success('Deposit successful! Stream created.')
      }

    } catch (err) {
      console.error('Deposit error:', err)
      setError((err as Error).message)
      setStep('error')
    }
  }

  return {
    executeDeposit,
    step,
    error,
    isLoading: step !== 'idle' && step !== 'success' && step !== 'error',
  }
}
```

##### 2.3: Transaction Toast Notifications
```typescript
// Use Sonner for beautiful toast notifications
import { Toaster, toast } from 'sonner'

// In layout.tsx
<Toaster
  position="bottom-right"
  toastOptions={{
    style: {
      background: '#1a1a2e',
      color: '#fff',
      border: '1px solid rgba(139, 92, 246, 0.3)',
    },
  }}
/>

// Transaction feedback
toast.promise(
  depositPromise,
  {
    loading: 'Depositing PT tokens...',
    success: (data) => `Deposited ${amount} PT. Stream ID: ${data.streamId}`,
    error: (err) => `Deposit failed: ${err.message}`,
  }
)
```

**Acceptance Criteria**:
- [ ] Multi-step approval flow with visual feedback
- [ ] Error messages use `BaseError.shortMessage` for clarity
- [ ] Toast notifications for all transaction states
- [ ] Transaction hash displayed with Etherscan link
- [ ] Handle edge cases (user rejection, insufficient balance, reverted txs)
- [ ] Optimistic UI updates for better perceived performance
- [ ] Loading states with spinners/skeletons

---

### Phase 3: Visual Redesign & Branding (Days 7-9)

**Goals**: Move beyond generic glassmorphism, create distinctive OVFL brand

#### Tasks

##### 3.1: Design System with shadcn/ui
```typescript
// Install shadcn/ui
npx shadcn@latest init

// tailwind.config.ts
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: '#8b5cf6', // Purple for OVFL brand
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: '#06b6d4', // Cyan for highlights
          foreground: '#ffffff',
        },
        success: '#10b981',
        warning: '#f59e0b',
        destructive: '#ef4444',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

// globals.css
@layer base {
  :root {
    --background: 220 20% 7%;
    --foreground: 220 10% 98%;
    --border: 220 20% 18%;
    --primary: 262 83% 58%;
    --accent: 189 94% 43%;
  }
}
```

##### 3.2: Distinctive Component Library
```typescript
// components/ui/glow-card.tsx - Signature OVFL component
export function GlowCard({ children, className }) {
  return (
    <div className={cn(
      "relative rounded-xl border border-white/10",
      "bg-gradient-to-br from-gray-900 to-gray-950",
      "before:absolute before:inset-0 before:-z-10",
      "before:bg-gradient-to-br before:from-purple-500/20 before:to-cyan-500/20",
      "before:blur-xl before:opacity-0 hover:before:opacity-100",
      "transition-all duration-300",
      className
    )}>
      {children}
    </div>
  )
}

// components/ui/stat-display.tsx - For displaying rates/amounts
export function StatDisplay({
  label,
  value,
  unit,
  trend,
  className
}: StatDisplayProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          {value}
        </span>
        {unit && <span className="text-lg text-muted-foreground">{unit}</span>}
      </div>
      {trend && (
        <div className={cn(
          "text-xs font-medium flex items-center gap-1",
          trend > 0 ? "text-green-400" : "text-red-400"
        )}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
        </div>
      )}
    </div>
  )
}
```

##### 3.3: Data Visualization
```typescript
// components/streams/StreamProgress.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export function StreamProgress({ stream }: { stream: Stream }) {
  const now = Date.now() / 1000
  const duration = stream.endTime - stream.startTime
  const elapsed = now - stream.startTime
  const progress = (elapsed / duration) * 100

  // Generate projected vesting curve
  const data = Array.from({ length: 10 }, (_, i) => {
    const timestamp = stream.startTime + (duration * i / 10)
    const vested = (stream.depositAmount * i) / 10
    return {
      timestamp: new Date(timestamp * 1000).toLocaleDateString(),
      vested
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Vesting Progress</span>
        <span className="text-sm font-medium">{progress.toFixed(1)}%</span>
      </div>

      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data}>
          <XAxis dataKey="timestamp" stroke="#888" fontSize={10} />
          <YAxis stroke="#888" fontSize={10} />
          <Tooltip
            contentStyle={{
              background: '#1a1a2e',
              border: '1px solid rgba(139, 92, 246, 0.3)'
            }}
          />
          <Line
            type="monotone"
            dataKey="vested"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] Custom color palette distinct from generic DeFi apps
- [ ] Glow effects on interactive elements (cards, buttons)
- [ ] Gradient text for important numbers (APY, amounts)
- [ ] Smooth animations using Framer Motion
- [ ] Charts for stream vesting progress
- [ ] Mobile-responsive with touch-friendly targets (min 44px)
- [ ] Dark mode optimized (primary interface)

---

### Phase 4: Real-Time Updates & Performance (Days 10-11)

**Goals**: WebSocket integration, optimistic updates, caching optimization

#### Tasks

##### 4.1: WebSocket Block Listener
```typescript
// hooks/shared/useBlockListener.ts
import { useWatchBlocks } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'

export function useBlockListener() {
  const queryClient = useQueryClient()

  useWatchBlocks({
    onBlock: (block) => {
      // Invalidate queries that should update on new blocks
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      queryClient.invalidateQueries({ queryKey: ['streams'] })
      queryClient.invalidateQueries({ queryKey: ['pendle', 'rates'] })
    },
    includeTransactions: false,
  })
}
```

##### 4.2: Optimistic Updates
```typescript
// hooks/sablier/useWithdrawStream.ts
export function useWithdrawStream() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: withdrawFromStream,
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['streams'] })

      // Snapshot previous value
      const previousStreams = queryClient.getQueryData(['streams'])

      // Optimistically update stream state
      queryClient.setQueryData(['streams'], (old: Stream[]) =>
        old.map(stream =>
          stream.id === variables.streamId
            ? { ...stream, withdrawnAmount: stream.depositAmount }
            : stream
        )
      )

      return { previousStreams }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      queryClient.setQueryData(['streams'], context.previousStreams)
      toast.error('Withdrawal failed')
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
  })
}
```

##### 4.3: Skeleton Loaders
```typescript
// components/ui/skeleton.tsx (from shadcn)
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

// components/deposit/MarketSkeleton.tsx
export function MarketSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] WebSocket connection for block updates
- [ ] Optimistic updates for withdrawals and claims
- [ ] Skeleton loaders for all async data
- [ ] Query caching with appropriate stale times
- [ ] Prefetch next likely actions (e.g., market data after selection)
- [ ] Performance metrics: Time to Interactive < 3s, First Contentful Paint < 1.5s

---

### Phase 5: Accessibility & Testing (Days 12-13)

**Goals**: WCAG 2.1 AA compliance, E2E testing, mobile optimization

#### Tasks

##### 5.1: Accessibility Improvements
```typescript
// components/deposit/MarketSelector.tsx
export function MarketSelector({ markets, onSelect }: MarketSelectorProps) {
  return (
    <div role="radiogroup" aria-label="Select Pendle market">
      {markets.map((market) => (
        <button
          key={market.address}
          role="radio"
          aria-checked={selectedMarket?.address === market.address}
          aria-label={`${market.name}, APY ${market.apy}%, expires ${formatDate(market.expiry)}`}
          onClick={() => onSelect(market)}
          className={cn(
            "market-card",
            "focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2",
            "focus-visible:ring-offset-gray-950"
          )}
        >
          {/* Market content */}
        </button>
      ))}
    </div>
  )
}

// Keyboard navigation
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      // Move to next market
      e.preventDefault()
      setSelectedIndex((i) => (i + 1) % markets.length)
    } else if (e.key === 'ArrowUp') {
      // Move to previous market
      e.preventDefault()
      setSelectedIndex((i) => (i - 1 + markets.length) % markets.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Select current market
      e.preventDefault()
      onSelect(markets[selectedIndex])
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [selectedIndex, markets])
```

##### 5.2: Mobile Optimization
```typescript
// Responsive design patterns
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Market cards */}
</div>

// Mobile-first breakpoints
const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
}

// Touch-friendly buttons (min 44px tap target)
<Button className="min-h-[44px] min-w-[44px]">
  Connect
</Button>

// Bottom sheet for mobile modals
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

<Sheet>
  <SheetTrigger>Select Market</SheetTrigger>
  <SheetContent side="bottom" className="h-[80vh]">
    <MarketList markets={markets} />
  </SheetContent>
</Sheet>
```

**Acceptance Criteria**:
- [ ] All interactive elements keyboard accessible
- [ ] ARIA labels on all form inputs and buttons
- [ ] Focus indicators visible and distinct
- [ ] Color contrast ratio ≥ 4.5:1 for normal text
- [ ] Responsive breakpoints for mobile, tablet, desktop
- [ ] Touch targets ≥ 44x44px on mobile
- [ ] Tested with VoiceOver/NVDA screen readers

---

## Success Metrics

### User Experience Metrics
- **Time to First Deposit**: < 2 minutes from wallet connection
- **Transaction Success Rate**: > 95% (excluding user cancellations)
- **Mobile Completion Rate**: > 80% match desktop
- **Page Load Speed**: LCP < 2.5s, FID < 100ms, CLS < 0.1

### Technical Metrics
- **Bundle Size**: < 300KB gzipped for initial load
- **Test Coverage**: > 80% for critical paths (deposit, claim, approvals)
- **Accessibility Score**: Lighthouse Accessibility score ≥ 95
- **TypeScript Coverage**: 100% (strict mode, no `any`)

### Business Metrics
- **Unique Depositors**: Track via analytics
- **Total Value Locked**: Sum of all PT deposited
- **Average Deposit Size**: Median PT amount per transaction
- **Stream Completion Rate**: % of streams fully withdrawn

## Dependencies & Risks

### External Dependencies
| Dependency | Purpose | Risk Level | Mitigation |
|------------|---------|------------|------------|
| Pendle API | Market data | **Medium** | Cache responses, fallback to direct contract reads |
| Sablier Subgraph | Stream data | **Medium** | GraphQL query timeout handling, retry logic |
| RPC Provider (Alchemy) | Blockchain access | **High** | Multiple provider fallbacks, rate limit handling |
| WalletConnect | Wallet connections | **Low** | Well-established, minimal downtime |

### Technical Risks
1. **Pendle market data latency** → Could show stale rates
   - *Mitigation*: Display "last updated" timestamp, manual refresh button

2. **Sablier subgraph indexing delays** → Streams might not appear immediately
   - *Mitigation*: Show optimistic stream data from transaction logs, poll for confirmation

3. **Complex approval flows confuse users** → High abandonment rate
   - *Mitigation*: Clear step indicators, "why this is needed" tooltips, one-click approve-all

4. **Mobile wallet UX friction** → Lower mobile conversion
   - *Mitigation*: Deep linking, WalletConnect v2, native wallet detection

### Market Risks
1. **Low Pendle PT liquidity** → Poor deposit experience
   - *Mitigation*: Show liquidity depth, warn if deposit exceeds 10% of market liquidity

2. **Near-expiry markets** → Users deposit PT with low streaming value
   - *Mitigation*: Visual warnings for markets <7 days to expiry, hide markets <24h to expiry

## Alternative Approaches Considered

### Option 1: Keep Vite Instead of Next.js
**Pros**: Faster dev server, simpler setup, current codebase already uses it
**Cons**: No SSR for better SEO, no built-in API routes, less optimized production builds
**Decision**: Migrate to Next.js for better performance and DX

### Option 2: Use The Graph for Pendle Data
**Pros**: Decentralized, on-chain data only
**Cons**: Higher latency than Pendle API, missing computed fields (APY, volume)
**Decision**: Use Pendle hosted API for better UX, fallback to The Graph if needed

### Option 3: Custom Glassmorphism vs shadcn/ui
**Pros**: Unique aesthetic, matches current draft
**Cons**: Glassmorphism is overused in DeFi, harder to maintain custom components
**Decision**: Use shadcn/ui with custom theming for better DX and distinctiveness

### Option 4: Permit2 for Gasless Approvals
**Pros**: Single signature for approvals, better UX
**Cons**: Requires Permit2 integration in OVFL contract, not all tokens support it
**Decision**: Keep traditional approvals for now, add Permit2 in v2 if contract updated

## Future Considerations

### Post-V1 Enhancements
1. **Multi-chain support** - Deploy to Arbitrum, Optimism (requires contract deployments)
2. **Batch deposits** - Deposit to multiple markets in one transaction
3. **Portfolio dashboard** - Aggregate view of all positions across markets
4. **Notification system** - Alerts for stream milestones, market expiry
5. **Advanced analytics** - Historical APY charts, market comparisons
6. **Referral system** - Track user referrals for protocol growth
7. **Gasless transactions** - Account abstraction for sponsored gas

### Extensibility
- **Plugin system** for custom market strategies
- **White-label frontend** for partners (configurable branding)
- **API for third-party integrations** (aggregators, dashboards)

## Documentation Plan

### User Documentation
- **Getting Started Guide** - How to deposit PT, view streams, claim
- **FAQ** - Common questions about fees, risks, expiry
- **Video Tutorials** - Walkthrough of deposit flow
- **Troubleshooting** - Common errors and solutions

### Developer Documentation
- **Architecture Overview** - System design, data flow
- **API Reference** - All hooks, components, utilities
- **Contract Integration** - How frontend interacts with OVFL.sol
- **Deployment Guide** - Environment setup, deployment process

### Technical Writing Tasks
```markdown
## docs/user/getting-started.md
# Getting Started with OVFL

OVFL enables you to unlock PT yield before maturity. Here's how it works...

## docs/developer/architecture.md
# Frontend Architecture

OVFL uses Next.js 15 with the App Router for optimal performance...

## docs/api/hooks.md
# Hooks API Reference

### `usePendleMarkets()`
Fetches active Pendle markets from the API...
```

## References & Research

### Internal References
- Protocol README: `/Users/jay/OVFL/README.md`
- OVFL Contract: `/Users/jay/OVFL/src/OVFL.sol:1-398`
- OVFLETH Token: `/Users/jay/OVFL/src/OVFLETH.sol:1-30`
- Current Frontend: `/Users/jay/OVFL/frontend/`

### External References

**Pendle Integration**:
- [Pendle API Documentation](https://api-v2.pendle.finance/core/docs)
- [Pendle Oracle Integration](https://github.com/pendle-finance/pendle-examples-public/blob/main/test/ChainlinkOracleSample.sol)

**Sablier Integration**:
- [Sablier V2 Documentation](https://docs.sablier.com)
- [Sablier GraphQL Indexers](https://docs.sablier.com/api/indexers/overview)
- [Sablier React Sandbox](https://github.com/sablier-labs/v2-sandbox-react)

**Web3 Stack**:
- [wagmi v2 Documentation](https://wagmi.sh)
- [RainbowKit Theming Guide](https://www.rainbowkit.com/docs/theming)
- [TanStack Query Caching Guide](https://tanstack.com/query/latest/docs/framework/react/guides/caching)

**Best Practices**:
- [DeFi UX Design Trends 2025](https://lollypop.design/blog/2025/september/web3-ui-ux-design-trends-challenges-ai-role/)
- [Web3 Transaction Flows](https://web3ux.design/transaction-flows)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

---

## Implementation Timeline

**Total Estimated Duration**: 13 days (2 weeks sprint)

- **Phase 1** (Days 1-3): Foundation & Data Integration
- **Phase 2** (Days 4-6): Transaction Flows & UX
- **Phase 3** (Days 7-9): Visual Redesign & Branding
- **Phase 4** (Days 10-11): Real-Time Updates & Performance
- **Phase 5** (Days 12-13): Accessibility & Testing

**Daily Breakdown**:
- Day 1: Next.js migration, provider setup
- Day 2: Pendle API integration, market fetching
- Day 3: Sablier GraphQL, stream display
- Day 4: Approval flow state machines
- Day 5: Deposit flow with error handling
- Day 6: Claim flow, transaction feedback
- Day 7: Design system setup (shadcn/ui, Tailwind v4)
- Day 8: Custom components (GlowCard, StatDisplay)
- Day 9: Data visualization (stream progress charts)
- Day 10: WebSocket block listener, optimistic updates
- Day 11: Performance optimization, caching strategies
- Day 12: Accessibility audit, keyboard navigation
- Day 13: Mobile optimization, final testing

**Checkpoints**:
- End of Day 3: Demo of live Pendle markets loading
- End of Day 6: Full deposit flow working (approval → deposit → stream)
- End of Day 9: Visual redesign complete with new branding
- End of Day 13: Production-ready build deployed to staging

---

## File Structure Summary

```
/Users/jay/OVFL/frontend/

📁 app/                          # Next.js 15 App Router
  ├── layout.tsx                 # Root layout with providers
  ├── page.tsx                   # Landing page
  ├── deposit/page.tsx           # Deposit flow
  ├── claim/page.tsx             # Claim flow
  ├── streams/page.tsx           # Stream viewer
  └── api/pendle/markets/route.ts # Server-side API

📁 components/
  ├── ui/                        # shadcn/ui components
  │   ├── button.tsx
  │   ├── card.tsx
  │   ├── glow-card.tsx          # Custom OVFL component
  │   ├── stat-display.tsx       # For APY/rate display
  │   ├── skeleton.tsx
  │   └── ...
  ├── providers/
  │   ├── WagmiProvider.tsx
  │   └── QueryProvider.tsx
  ├── deposit/
  │   ├── MarketSelector.tsx
  │   ├── AmountInput.tsx
  │   ├── DepositPreview.tsx
  │   ├── ApprovalFlow.tsx
  │   └── TransactionSteps.tsx
  ├── streams/
  │   ├── StreamCard.tsx
  │   ├── StreamProgress.tsx     # With Recharts visualization
  │   ├── WithdrawButton.tsx
  │   └── StreamList.tsx
  ├── claim/
  │   ├── MaturedMarkets.tsx
  │   └── ClaimForm.tsx
  └── shared/
      ├── Header.tsx
      ├── Footer.tsx
      ├── ConnectButton.tsx
      └── TransactionToast.tsx

📁 hooks/
  ├── pendle/
  │   ├── usePendleMarkets.ts    # Fetch markets from API
  │   ├── useMarketData.ts       # Market details (APY, expiry)
  │   └── usePtRate.ts           # TWAP rate
  ├── sablier/
  │   ├── useUserStreams.ts      # GraphQL stream fetching
  │   ├── useStreamProgress.ts   # Real-time progress calc
  │   └── useWithdrawStream.ts   # Withdraw with optimistic update
  ├── ovfl/
  │   ├── useDeposit.ts          # Full deposit flow
  │   ├── useClaim.ts            # Claim flow
  │   ├── usePreviewDeposit.ts   # Preview calculation
  │   └── useBalances.ts         # PT + ovflETH balances
  └── shared/
      ├── useApproval.ts         # Generic ERC20 approval
      ├── useTransaction.ts      # Transaction state machine
      └── useBlockListener.ts    # WebSocket block updates

📁 lib/
  ├── pendle/
  │   ├── api.ts                 # Pendle API client
  │   └── types.ts               # Type definitions
  ├── sablier/
  │   ├── graphql.ts             # GraphQL queries
  │   └── client.ts              # GraphQL client
  └── utils/
      ├── format.ts              # Number/date formatting
      ├── contracts.ts           # ABIs and addresses
      └── constants.ts           # App constants

📁 styles/
  └── globals.css                # Tailwind + custom styles

📄 tailwind.config.ts            # Tailwind v4 config
📄 tsconfig.json                 # Strict TypeScript config
📄 next.config.js                # Next.js config
📄 package.json                  # Dependencies
```

---

**This plan represents a complete overhaul of the OVFL frontend to production standards, incorporating industry best practices from successful DeFi protocols while maintaining the core functionality of the existing draft.**
