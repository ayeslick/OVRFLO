import { ConnectButton } from '@rainbow-me/rainbowkit'

function LiquidDropletLogo() {
  return (
    <svg viewBox="0 0 40 40" className="w-10 h-10">
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFB800" />
          <stop offset="100%" stopColor="#FFA000" />
        </linearGradient>
        <linearGradient id="tealGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#006064" />
          <stop offset="100%" stopColor="#00838F" />
        </linearGradient>
        <filter id="goldGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Liquid droplet shape - represents overflow/abundance */}
      <path
        d="M20,4 Q12,16 12,24 Q12,34 20,36 Q28,34 28,24 Q28,16 20,4 Z"
        fill="url(#goldGradient)"
        filter="url(#goldGlow)"
      />

      {/* Inner teal pool - represents liquidity depth */}
      <ellipse 
        cx="20" 
        cy="26" 
        rx="6" 
        ry="4" 
        fill="url(#tealGradient)" 
        opacity="0.7"
      />

      {/* Highlight reflection */}
      <ellipse 
        cx="17" 
        cy="16" 
        rx="3" 
        ry="4" 
        fill="rgba(255,255,255,0.35)" 
      />
    </svg>
  )
}

export default function Header() {
  return (
    <header className="w-full px-4 py-4 md:px-8">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <LiquidDropletLogo />
            <div className="absolute inset-0 rounded-full bg-gold/20 blur-xl -z-10 animate-pulse-glow" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">OVFL</h1>
            <p className="text-xs text-gold/70 hidden sm:block">Unlock PT yield early</p>
          </div>
        </div>

        {/* Connect Button */}
        <ConnectButton 
          chainStatus="icon"
          showBalance={false}
          accountStatus={{
            smallScreen: 'avatar',
            largeScreen: 'full',
          }}
        />
      </div>
    </header>
  )
}

