import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'studio.workspace-stage-height'
const STEP = 0.02
const LARGE_STEP = 0.1

interface WorkspaceMetrics {
  availableHeight: number
  contentTop: number
  currentHeight: number
  maximumHeight: number
  minimumHeight: number
}

interface DragState {
  captureTarget: HTMLElement
  initialRatio: number
  metrics: WorkspaceMetrics
  pointerId: number
  ratio: number
}

interface ObservedSize {
  height: number
  width: number
}

function finiteRatio(value: string | null): number | null {
  if (value === null || !/^0(?:\.\d+)?|1(?:\.0+)?$/u.test(value)) return null
  const ratio = Number(value)
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 && String(ratio) === value
    ? ratio
    : null
}

function readSavedRatio(): number | null {
  try {
    return finiteRatio(window.localStorage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return null
  }
}

function writeSavedRatio(ratio: number) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, String(ratio))
  } catch {
    // Preferences are optional when browser storage is unavailable.
  }
}

function cssNumber(style: CSSStyleDeclaration, property: string) {
  const value = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function measureWorkspace(root: HTMLElement, stage: HTMLElement): WorkspaceMetrics {
  const style = getComputedStyle(root)
  const contentTop = cssNumber(style, 'padding-top')
  const contentHeight = root.clientHeight - contentTop - cssNumber(style, 'padding-bottom')
  const availableHeight = Math.max(0, contentHeight - cssNumber(style, '--workspace-divider-size'))
  const maximumHeight = Math.max(0, availableHeight - cssNumber(style, '--workspace-timing-min'))
  const minimumHeight = Math.min(cssNumber(style, '--workspace-top-min'), maximumHeight)
  return {
    availableHeight,
    contentTop,
    currentHeight: stage.getBoundingClientRect().height,
    maximumHeight,
    minimumHeight,
  }
}

function ratioForHeight(height: number, metrics: WorkspaceMetrics) {
  if (metrics.availableHeight <= 0) return 0
  return clamp(height / metrics.availableHeight, 0, 1)
}

function resolvedRatio(ratio: number, metrics: WorkspaceMetrics) {
  return ratioForHeight(
    clamp(ratio * metrics.availableHeight, metrics.minimumHeight, metrics.maximumHeight),
    metrics,
  )
}

function safeCapture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Capture is not present in every renderer test environment.
  }
}

function safeRelease(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // A released or unavailable capture must not interrupt cleanup.
  }
}

export function WorkspaceDivider({
  isSyncing = false,
  stage,
  timing,
}: {
  isSyncing?: boolean
  stage: ReactNode
  timing: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const observedSizeRef = useRef<ObservedSize | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [savedRatio, setSavedRatio] = useState<number | null>(readSavedRatio)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<WorkspaceMetrics | null>(null)
  const activeRatio = dragRatio ?? savedRatio

  const refreshMetrics = useCallback((force = false) => {
    const root = rootRef.current
    const stageElement = stageRef.current
    if (!root || !stageElement) return null
    const observedSize = { height: root.clientHeight, width: root.clientWidth }
    if (
      !force &&
      observedSizeRef.current?.height === observedSize.height &&
      observedSizeRef.current.width === observedSize.width
    )
      return null
    observedSizeRef.current = observedSize
    const next = measureWorkspace(root, stageElement)
    setMetrics((current) =>
      current &&
      current.availableHeight === next.availableHeight &&
      current.contentTop === next.contentTop &&
      current.currentHeight === next.currentHeight &&
      current.maximumHeight === next.maximumHeight &&
      current.minimumHeight === next.minimumHeight
        ? current
        : next,
    )
    return next
  }, [])

  useLayoutEffect(() => {
    refreshMetrics(true)
  }, [isSyncing, refreshMetrics])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => refreshMetrics())
    observer.observe(root)
    return () => observer.disconnect()
  }, [refreshMetrics])

  useEffect(
    () => () => {
      const active = dragRef.current
      if (active) safeRelease(active.captureTarget, active.pointerId)
      dragRef.current = null
    },
    [],
  )

  const effectiveRatio =
    activeRatio !== null && metrics ? resolvedRatio(activeRatio, metrics) : null
  const displayedRatio =
    effectiveRatio ?? (metrics ? ratioForHeight(metrics.currentHeight, metrics) : 0)
  const minimumValue = metrics
    ? Math.round(ratioForHeight(metrics.minimumHeight, metrics) * 100)
    : 0
  const maximumValue = metrics
    ? Math.round(ratioForHeight(metrics.maximumHeight, metrics) * 100)
    : 100
  const currentValue = Math.round(displayedRatio * 100)
  const workspaceStyle =
    effectiveRatio === null || !metrics
      ? undefined
      : ({
          '--workspace-top-height': `${effectiveRatio * metrics.availableHeight}px`,
        } as CSSProperties)

  const persistRatio = (next: number, previous: number) => {
    if (Math.abs(next - previous) < 0.0001) return false
    setSavedRatio(next)
    writeSavedRatio(next)
    return true
  }

  const finishDrag = (event: PointerEvent<HTMLDivElement>, persist: boolean) => {
    const active = dragRef.current
    if (!active || event.pointerId !== active.pointerId) return
    dragRef.current = null
    if (persist) persistRatio(active.ratio, active.initialRatio)
    setDragRatio(null)
    safeRelease(active.captureTarget, event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isSyncing) return
    const nextMetrics = refreshMetrics(true)
    if (!nextMetrics) return
    const current =
      savedRatio === null
        ? ratioForHeight(nextMetrics.currentHeight, nextMetrics)
        : resolvedRatio(savedRatio, nextMetrics)
    const step = event.shiftKey ? LARGE_STEP : STEP
    let next: number | null = null
    if (event.key === 'ArrowUp') next = current - step
    if (event.key === 'ArrowDown') next = current + step
    if (event.key === 'Home') next = ratioForHeight(nextMetrics.minimumHeight, nextMetrics)
    if (event.key === 'End') next = ratioForHeight(nextMetrics.maximumHeight, nextMetrics)
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    persistRatio(resolvedRatio(next, nextMetrics), current)
  }

  return (
    <div
      className={`unified-workspace${isSyncing ? ' is-syncing' : ''}`}
      ref={rootRef}
      style={workspaceStyle}
    >
      <div className="workspace-top" id="workspace-stage-region" ref={stageRef}>
        {stage}
      </div>
      <div
        aria-controls="workspace-stage-region workspace-timing-region"
        aria-disabled={isSyncing || undefined}
        aria-label="Stage Monitor and Lyric Timing height"
        aria-orientation="horizontal"
        aria-valuemax={maximumValue}
        aria-valuemin={minimumValue}
        aria-valuenow={currentValue}
        aria-valuetext={`${currentValue}% Stage Monitor height; ${100 - currentValue}% Lyric Timing height`}
        className="workspace-divider"
        onKeyDown={onKeyDown}
        onLostPointerCapture={(event) => finishDrag(event, false)}
        onPointerCancel={(event) => finishDrag(event, false)}
        onPointerDown={(event) => {
          if (isSyncing || event.button !== 0 || dragRef.current) return
          const nextMetrics = refreshMetrics(true)
          const root = rootRef.current
          if (!nextMetrics || !root) return
          event.preventDefault()
          const initialRatio = ratioForHeight(nextMetrics.currentHeight, nextMetrics)
          const ratio = resolvedRatio(
            ratioForHeight(
              event.clientY - root.getBoundingClientRect().top - nextMetrics.contentTop,
              nextMetrics,
            ),
            nextMetrics,
          )
          dragRef.current = {
            captureTarget: event.currentTarget,
            initialRatio,
            metrics: nextMetrics,
            pointerId: event.pointerId,
            ratio,
          }
          setDragRatio(ratio)
          safeCapture(event.currentTarget, event.pointerId)
        }}
        onPointerMove={(event) => {
          const active = dragRef.current
          const root = rootRef.current
          if (!active || active.pointerId !== event.pointerId || !root) return
          event.preventDefault()
          active.ratio = resolvedRatio(
            ratioForHeight(
              event.clientY - root.getBoundingClientRect().top - active.metrics.contentTop,
              active.metrics,
            ),
            active.metrics,
          )
          setDragRatio(active.ratio)
        }}
        onPointerUp={(event) => finishDrag(event, true)}
        role="separator"
        tabIndex={isSyncing ? -1 : 0}
      />
      <div className="workspace-timing" id="workspace-timing-region">
        {timing}
      </div>
    </div>
  )
}
