import { motion } from 'framer-motion'

interface TabToggleProps {
  activeTab: 'deposit' | 'claim'
  onTabChange: (tab: 'deposit' | 'claim') => void
}

export default function TabToggle({ activeTab, onTabChange }: TabToggleProps) {
  return (
    <div className="flex justify-center mb-6">
      <div className="inline-flex bg-ovfl-800/50 rounded-xl p-1 gap-1 border border-white/5">
        {(['deposit', 'claim'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`relative px-6 py-2 rounded-lg font-medium capitalize transition-colors duration-200 ${
              activeTab === tab ? 'text-gold' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {activeTab === tab && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-gold/15 border border-gold/30 rounded-lg"
                transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

