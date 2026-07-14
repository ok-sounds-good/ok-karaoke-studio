import { useCallback, useEffect } from 'react'
import type { KaraokeProject } from '../lib/karaoke'
import type { useVideoStyleController } from './useVideoStyleController'
import { useWindowCloseCancellation } from './useWindowCloseCancellation'

type VideoStyleController = ReturnType<typeof useVideoStyleController>

export function useVideoStyleLifecycle({
  controller,
  newProject,
  openProject,
  saveProject,
  openExport,
  requestProjectClose,
  acknowledgeCloseCancellation,
  showWarning,
}: {
  controller: VideoStyleController
  newProject: () => unknown
  openProject: () => unknown
  saveProject: (saveAs: boolean, project: KaraokeProject) => unknown
  openExport: () => void
  requestProjectClose: () => void
  acknowledgeCloseCancellation: () => Promise<unknown>
  showWarning: (message: string) => void
}) {
  const command = controller.lifecycleCommand
  const resolved = controller.resolvedCommand
  const closeCancellation = useWindowCloseCancellation({
    active: controller.windowClosePending,
    acknowledge: acknowledgeCloseCancellation,
    onAcknowledged: controller.keepEditing,
  })

  useEffect(() => {
    if (!resolved) return
    controller.clearResolvedCommand()
    if (resolved.command === 'new') void newProject()
    else if (resolved.command === 'open') void openProject()
    else if (resolved.command === 'save') void saveProject(false, resolved.project)
    else if (resolved.command === 'save-as') void saveProject(true, resolved.project)
    else if (resolved.command === 'export') openExport()
    else requestProjectClose()
  }, [controller, newProject, openExport, openProject, requestProjectClose, resolved, saveProject])

  useEffect(() => window.studio?.onWindowCloseRequest?.(() => {
    controller.requestCommand('close')
  }), [controller])

  const apply = useCallback(() => {
    void controller.resolveCommand(true).then((didResolve) => {
      if (!didResolve) {
        showWarning('Correct invalid style values or background access before applying.')
      }
    })
  }, [controller, showWarning])

  const discard = useCallback(() => {
    void controller.resolveCommand(false).then((didResolve) => {
      if (!didResolve) {
        showWarning('The original linked background could not be restored. Try again.')
      }
    })
  }, [controller, showWarning])

  const keepEditing = useCallback(() => {
    if (controller.windowClosePending) void closeCancellation.cancelClose()
    else controller.keepEditing()
  }, [closeCancellation, command, controller])

  return {
    apply,
    busy: controller.settling || closeCancellation.busy,
    command,
    discard,
    error: closeCancellation.error ?? controller.lifecycleError,
    keepEditing,
  }
}
