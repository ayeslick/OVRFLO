import { useEffect, useRef, useCallback } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  opacity: number
}

interface OverflowParticlesProps {
  active: boolean
  onComplete?: () => void
}

const COLORS = ['#FFB800', '#FFA000', '#FF6B35'] // gold, amber, orange

export function OverflowParticles({ active, onComplete }: OverflowParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationFrameRef = useRef<number>()
  const prefersReducedMotion = useReducedMotion()

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const particleCount = isMobile ? 15 : 40
  const duration = 2500

  const initParticles = useCallback((canvas: HTMLCanvasElement) => {
    const centerX = canvas.width / 2
    const spawnY = canvas.height * 0.3

    return Array.from({ length: particleCount }, () => {
      const angle = (Math.random() - 0.5) * Math.PI * 0.6
      const speed = 2 + Math.random() * 4

      return {
        x: centerX + (Math.random() - 0.5) * 100,
        y: spawnY,
        vx: Math.sin(angle) * speed,
        vy: Math.cos(angle) * speed * 0.5,
        radius: 3 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        opacity: 1,
      }
    })
  }, [particleCount])

  useEffect(() => {
    if (!active || prefersReducedMotion) {
      if (prefersReducedMotion && active) {
        setTimeout(() => onComplete?.(), 100)
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    particlesRef.current = initParticles(canvas)

    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      ctx.clearRect(0, 0, rect.width, rect.height)

      particlesRef.current.forEach(particle => {
        // Physics
        particle.vy += 0.15 // gravity
        particle.vx *= 0.99 // drag
        particle.vy *= 0.99

        particle.x += particle.vx
        particle.y += particle.vy

        // Fade based on progress
        particle.opacity = 1 - progress

        // Draw particle with glow
        ctx.save()
        ctx.globalAlpha = particle.opacity

        // Glow effect
        ctx.shadowColor = particle.color
        ctx.shadowBlur = 8

        ctx.beginPath()
        ctx.arc(
          particle.x / window.devicePixelRatio,
          particle.y / window.devicePixelRatio,
          particle.radius,
          0,
          Math.PI * 2
        )
        ctx.fillStyle = particle.color
        ctx.fill()

        ctx.restore()
      })

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        onComplete?.()
      }
    }

    animate()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [active, prefersReducedMotion, initParticles, onComplete])

  if (prefersReducedMotion || !active) {
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
