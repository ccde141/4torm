<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData, useRoute } from 'vitepress'

const route = useRoute()
const { frontmatter } = useData()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const palette = '    ...:::---+++***◦◦••▢▣'
const cellSize = 18
const fontSize = 12
const frameInterval = 50
const homeThreshold = 0.22
const homeMaximumAlpha = 0.5
const pageThreshold = 0.22
const pageMaximumAlpha = 0.46

let context: CanvasRenderingContext2D | null = null
let viewportWidth = 0
let viewportHeight = 0
let animationFrame: number | null = null
let previousFrame = 0
let startedAt = 0
let currentPhase = 0
let motionQuery: MediaQueryList | null = null
let themeObserver: MutationObserver | null = null

function isHomePage(): boolean {
  return frontmatter.value.layout === 'home'
}

function fieldColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--ascii-field-color')
    .trim() || '#2c8bd6'
}

function gridValue(column: number, row: number): number {
  let value = Math.imul(column, 374761393) ^ Math.imul(row, 668265263) ^ 0x4F544F52
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function smoothCurve(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function valueNoise(x: number, y: number): number {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const horizontal = smoothCurve(x - left)
  const vertical = smoothCurve(y - top)
  const upper = interpolate(gridValue(left, top), gridValue(left + 1, top), horizontal)
  const lower = interpolate(gridValue(left, top + 1), gridValue(left + 1, top + 1), horizontal)
  return interpolate(upper, lower, vertical)
}

function warpedField(column: number, row: number, phase: number): number {
  const time = phase * 0.55
  const coarseX = column * 0.075
  const coarseY = row * 0.075
  const warpX = valueNoise(coarseX + time * 0.19, coarseY - time * 0.11)
  const warpY = valueNoise(coarseX - time * 0.13 + 29.4, coarseY + time * 0.17 + 17.2)
  const bendX = (warpX - 0.5) * 3.2
  const bendY = (warpY - 0.5) * 3.2
  const body = valueNoise(column * 0.09 + bendX + time * 0.08, row * 0.09 + bendY - time * 0.06)
  const detail = valueNoise(column * 0.19 - bendY * 0.35 - time * 0.11 + 43, row * 0.19 + bendX * 0.35 + time * 0.09 + 11)
  const pulse = valueNoise(column * 0.045 + time * 0.04 + 73, row * 0.045 - time * 0.03 + 37)
  const combined = body * 0.62 + detail * 0.23 + pulse * 0.15
  return Math.max(0, Math.min(1, combined * 1.08 + 0.02))
}

function draw(phase: number): void {
  if (!context) return
  context.clearRect(0, 0, viewportWidth, viewportHeight)
  context.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`
  context.textBaseline = 'top'
  context.fillStyle = fieldColor()

  const columns = Math.ceil(viewportWidth / cellSize)
  const rows = Math.ceil(viewportHeight / cellSize)
  const threshold = isHomePage() ? homeThreshold : pageThreshold
  const maximumAlpha = isHomePage() ? homeMaximumAlpha : pageMaximumAlpha

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = warpedField(column, row, phase)
      if (value < threshold) continue

      const paletteIndex = Math.min(
        palette.length - 1,
        Math.floor(value * palette.length),
      )
      const character = palette[paletteIndex]
      if (character === ' ') continue

      context.globalAlpha = 0.015 + (value - threshold) * maximumAlpha
      context.fillText(character, column * cellSize, row * cellSize)
    }
  }
  context.globalAlpha = 1
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas || !context) return
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  viewportWidth = window.innerWidth
  viewportHeight = window.innerHeight
  canvas.width = Math.floor(viewportWidth * pixelRatio)
  canvas.height = Math.floor(viewportHeight * pixelRatio)
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  draw(currentPhase)
}

function stopAnimation(): void {
  if (animationFrame === null) return
  cancelAnimationFrame(animationFrame)
  animationFrame = null
}

function animate(timestamp: number): void {
  animationFrame = requestAnimationFrame(animate)
  if (timestamp - previousFrame < frameInterval) return
  previousFrame = timestamp
  currentPhase = ((timestamp - startedAt) / 1000) * 0.24
  draw(currentPhase)
}

function startAnimation(): void {
  if (animationFrame !== null || document.hidden || motionQuery?.matches) return
  startedAt = performance.now() - (currentPhase / 0.24) * 1000
  animationFrame = requestAnimationFrame(animate)
}

function syncMotion(): void {
  if (document.hidden || motionQuery?.matches) {
    stopAnimation()
    draw(currentPhase)
    return
  }
  startAnimation()
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  context = canvas.getContext('2d')
  if (!context) return

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  themeObserver = new MutationObserver(() => draw(currentPhase))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', syncMotion)
  motionQuery.addEventListener('change', syncMotion)
  resize()
  syncMotion()
})

watch(() => route.path, () => draw(currentPhase))

onBeforeUnmount(() => {
  stopAnimation()
  window.removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', syncMotion)
  motionQuery?.removeEventListener('change', syncMotion)
  themeObserver?.disconnect()
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="ascii-breathing-field"
    :class="{ 'is-home': isHomePage() }"
    aria-hidden="true"
  />
</template>
