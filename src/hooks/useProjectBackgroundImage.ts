import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundStyle } from '../lib/video-style'

export type BackgroundImageResolutionStatus = 'none' | 'loading' | 'available' | 'missing' | 'error'

export interface BackgroundImagePreviewSource {
  readonly url: string | null
  readonly resolutionStatus: BackgroundImageResolutionStatus
  readonly onRetryResolution?: () => void
}

interface RetainedBackgroundSnapshot {
  readonly path: string
  readonly url: string
}

interface ProjectBackgroundResource {
  readonly capability: StudioBackgroundCapabilityState | null
  readonly failedIntent?: string
  readonly lifecycle: number
  readonly linkedPath: string | null
  readonly ready: boolean
  readonly resolutionStatus: BackgroundImageResolutionStatus
  readonly retained: RetainedBackgroundSnapshot | null
}

export interface ProjectBackgroundImagePreview {
  readonly preview: BackgroundImagePreviewSource
  readonly ready: boolean
}

function previewStatus(
  background: BackgroundStyle,
  url: string | null,
  fallback: BackgroundImageResolutionStatus,
): BackgroundImageResolutionStatus {
  if (background.mode !== 'image') return 'none'
  if (!background.imagePath) return 'missing'
  if (url) return 'available'
  return fallback === 'loading' || fallback === 'error' ? fallback : 'missing'
}

function backgroundIntent(background: BackgroundStyle): string {
  return background.mode === 'image' ? `image:${background.imagePath ?? ''}` : 'no-image'
}

export function useProjectBackgroundImage({
  acceptedProjectPath,
  background,
  lifecycle,
}: {
  acceptedProjectPath: string | null
  background: BackgroundStyle
  lifecycle: number
}): ProjectBackgroundImagePreview {
  const studio = window.studio
  const initialReady = !studio?.getBackgroundState
  const [resource, setStoredResource] = useState<ProjectBackgroundResource>({
    capability: null,
    lifecycle,
    linkedPath: acceptedProjectPath && background.mode === 'image' ? background.imagePath : null,
    ready: initialReady,
    resolutionStatus:
      initialReady && background.mode === 'image' ? 'missing' : initialReady ? 'none' : 'loading',
    retained: null,
  })
  const resourceRef = useRef(resource)
  const requestGenerationRef = useRef(0)
  const reconciliationGenerationRef = useRef(0)
  const reconciliationInFlightRef = useRef<number | null>(null)
  const currentRef = useRef({ acceptedProjectPath, background, lifecycle })
  currentRef.current = { acceptedProjectPath, background, lifecycle }

  const publish = useCallback((next: ProjectBackgroundResource) => {
    resourceRef.current = next
    setStoredResource(next)
  }, [])

  const resolveCurrentProjectBackground = useCallback(
    async (resetRetained: boolean) => {
      const request = currentRef.current
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      reconciliationGenerationRef.current += 1
      reconciliationInFlightRef.current = null
      const retained = resetRetained ? null : resourceRef.current.retained
      const linkedPath = resetRetained
        ? request.acceptedProjectPath && request.background.mode === 'image'
          ? request.background.imagePath
          : null
        : resourceRef.current.linkedPath
      const isCurrent = () =>
        generation === requestGenerationRef.current &&
        request.lifecycle === currentRef.current.lifecycle
      const finish = (
        capability: StudioBackgroundCapabilityState | null,
        resolutionStatus: BackgroundImageResolutionStatus,
        nextRetained = retained,
      ) => {
        if (!isCurrent()) return false
        publish({
          capability,
          lifecycle: request.lifecycle,
          linkedPath,
          ready: true,
          resolutionStatus,
          retained: nextRetained,
        })
        return true
      }
      publish({
        capability: resetRetained ? null : resourceRef.current.capability,
        lifecycle: request.lifecycle,
        linkedPath,
        ready: false,
        resolutionStatus: request.background.mode === 'image' ? 'loading' : 'none',
        retained,
      })

      if (!studio?.getBackgroundState) {
        finish(null, request.background.mode === 'image' ? 'missing' : 'none')
        return
      }

      try {
        if (
          request.background.mode === 'image' &&
          request.background.imagePath &&
          request.acceptedProjectPath &&
          studio.resolveProjectBackground
        ) {
          const restored = await studio.resolveProjectBackground(request.acceptedProjectPath)
          if (!isCurrent()) return
          if (restored.status === 'success') {
            if (restored.media.path !== request.background.imagePath) {
              finish(restored.state, 'error', null)
              return
            }
            finish(restored.state, 'available', {
              path: restored.media.path,
              url: restored.media.url,
            })
            return
          }
          if (restored.status === 'missing') {
            finish(restored.state, 'missing')
            return
          }
        }

        const capability = await studio.getBackgroundState()
        finish(capability, request.background.mode === 'image' ? 'missing' : 'none')
      } catch {
        if (!isCurrent()) return
        try {
          const capability = await studio.getBackgroundState()
          finish(capability, 'error')
        } catch {
          finish(null, 'error')
        }
      }
    },
    [publish, studio],
  )

  useEffect(() => {
    void resolveCurrentProjectBackground(true)
    return () => {
      requestGenerationRef.current += 1
      reconciliationGenerationRef.current += 1
      reconciliationInFlightRef.current = null
    }
  }, [acceptedProjectPath, lifecycle, resolveCurrentProjectBackground])

  const retryResolution = useCallback(() => {
    void resolveCurrentProjectBackground(false)
  }, [resolveCurrentProjectBackground])

  const reconciliationIsCurrent = useCallback(
    (generation: number) =>
      generation === reconciliationGenerationRef.current &&
      currentRef.current.lifecycle === lifecycle,
    [lifecycle],
  )

  const refreshCapability = useCallback(
    async (generation: number, pauseAfterRefresh: boolean, attemptedIntent: string) => {
      if (!studio?.getBackgroundState) return
      try {
        const capability = await studio.getBackgroundState()
        if (!reconciliationIsCurrent(generation)) return
        reconciliationInFlightRef.current = null
        const current = resourceRef.current
        const currentBackground = currentRef.current.background
        const url =
          current.retained?.path === currentBackground.imagePath ? current.retained.url : null
        publish({
          ...current,
          capability,
          failedIntent: pauseAfterRefresh ? attemptedIntent : undefined,
          lifecycle,
          ready: true,
          resolutionStatus:
            pauseAfterRefresh && currentBackground.mode === 'image'
              ? 'error'
              : previewStatus(
                  currentBackground,
                  url,
                  current.linkedPath === currentBackground.imagePath
                    ? current.resolutionStatus
                    : 'missing',
                ),
        })
      } catch {
        if (!reconciliationIsCurrent(generation)) return
        reconciliationInFlightRef.current = null
        const current = resourceRef.current
        publish({
          ...current,
          failedIntent: attemptedIntent,
          lifecycle,
          ready: true,
          resolutionStatus: currentRef.current.background.mode === 'image' ? 'error' : 'none',
        })
      }
    },
    [lifecycle, publish, reconciliationIsCurrent, studio],
  )

  const refreshForIntent = useCallback(
    (retriedIntent: string) => {
      const generation = reconciliationGenerationRef.current + 1
      reconciliationGenerationRef.current = generation
      reconciliationInFlightRef.current = generation
      const current = resourceRef.current
      publish({
        ...current,
        failedIntent: undefined,
        lifecycle,
        ready: false,
        resolutionStatus: currentRef.current.background.mode === 'image' ? 'loading' : 'none',
      })
      void refreshCapability(generation, false, retriedIntent)
    },
    [lifecycle, publish, refreshCapability],
  )

  const retryCapability = useCallback(() => {
    refreshForIntent(backgroundIntent(currentRef.current.background))
  }, [refreshForIntent])

  useEffect(() => {
    const desiredIntent = backgroundIntent(background)
    if (
      !resource.ready ||
      resource.lifecycle !== lifecycle ||
      !resource.capability ||
      reconciliationInFlightRef.current !== null ||
      !studio?.retainBackground
    )
      return

    if (resource.failedIntent) {
      if (resource.failedIntent === desiredIntent) return
      refreshForIntent(desiredIntent)
      return
    }

    const targetUrl =
      background.mode === 'image' && resource.retained?.path === background.imagePath
        ? resource.retained.url
        : null
    const status = previewStatus(
      background,
      targetUrl,
      resource.linkedPath === background.imagePath ? resource.resolutionStatus : 'missing',
    )
    if (resource.capability.activeUrl === targetUrl) {
      return
    }
    const generation = reconciliationGenerationRef.current + 1
    reconciliationGenerationRef.current = generation
    reconciliationInFlightRef.current = generation
    const expected = resource.capability
    publish({
      ...resource,
      failedIntent: undefined,
      resolutionStatus: background.mode === 'image' ? 'loading' : status,
    })

    const pauseForRetry = () => {
      if (!reconciliationIsCurrent(generation)) return
      void refreshCapability(generation, true, desiredIntent)
    }

    void studio.retainBackground(expected, targetUrl).then((next) => {
      if (!reconciliationIsCurrent(generation)) return
      if (next) {
        reconciliationInFlightRef.current = null
        publish({
          ...resourceRef.current,
          capability: next,
          lifecycle,
          ready: true,
          resolutionStatus: status,
        })
      } else {
        pauseForRetry()
      }
    }, pauseForRetry)
  }, [
    background.imagePath,
    background.mode,
    lifecycle,
    publish,
    reconciliationIsCurrent,
    refreshCapability,
    refreshForIntent,
    resource,
    studio,
  ])

  const resourceIsCurrent = resource.ready && resource.lifecycle === lifecycle
  const retained =
    resourceIsCurrent &&
    background.mode === 'image' &&
    resource.retained?.path === background.imagePath
      ? resource.retained
      : null
  const capabilityPaused = resource.failedIntent === backgroundIntent(background)
  const retainedIsActive = Boolean(retained && resource.capability?.activeUrl === retained.url)
  const url = !resource.failedIntent && retainedIsActive ? (retained?.url ?? null) : null
  const resolutionStatus = !resourceIsCurrent
    ? background.mode === 'image'
      ? 'loading'
      : 'none'
    : resource.failedIntent && !capabilityPaused
      ? background.mode === 'image'
        ? 'loading'
        : 'none'
      : !capabilityPaused && background.mode === 'image' && retained && !retainedIsActive
        ? 'loading'
        : previewStatus(background, url, resource.resolutionStatus)
  const canRetry =
    (resolutionStatus === 'missing' || resolutionStatus === 'error') &&
    Boolean(
      studio?.resolveProjectBackground &&
      acceptedProjectPath &&
      background.mode === 'image' &&
      background.imagePath &&
      resource.linkedPath === background.imagePath,
    )

  return {
    preview: {
      url,
      resolutionStatus,
      ...(capabilityPaused
        ? { onRetryResolution: retryCapability }
        : canRetry
          ? { onRetryResolution: retryResolution }
          : {}),
    },
    ready: resource.ready && resource.lifecycle === lifecycle,
  }
}
