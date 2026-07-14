import { Button, Modal } from './ui'

export type StyleLifecycleCommand = 'save' | 'save-as' | 'export' | 'new' | 'open' | 'close'

const LABELS: Record<StyleLifecycleCommand, {
  action: string
  apply: string
  discard: string
}> = {
  save: { action: 'save', apply: 'Apply & Save', discard: 'Discard & Save' },
  'save-as': { action: 'save', apply: 'Apply & Save', discard: 'Discard & Save' },
  export: { action: 'export', apply: 'Apply & Export', discard: 'Discard & Export' },
  new: { action: 'start a new project', apply: 'Apply & continue', discard: 'Discard & continue' },
  open: { action: 'open another project', apply: 'Apply & continue', discard: 'Discard & continue' },
  close: { action: 'close the app', apply: 'Apply & continue', discard: 'Discard & continue' },
}

export function StyleDiscardDialog({
  busy = false,
  error,
  onDiscard,
  onKeep,
}: {
  busy?: boolean
  error?: string | null
  onDiscard: () => void
  onKeep: () => void
}) {
  return (
    <Modal
      title="Discard video style changes?"
      eyebrow="Video style"
      onClose={onKeep}
      closeDisabled={busy}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onKeep}>Keep editing</Button>
          <Button variant="primary" disabled={busy} onClick={onDiscard}>
            {busy ? 'Restoring…' : 'Discard changes'}
          </Button>
        </>
      )}
    >
      <p>Your unapplied video style changes will be lost.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  )
}

export function StyleLifecycleDialog({
  command,
  onApply,
  onDiscard,
  onKeep,
  applyDisabled = false,
  busy = false,
  error,
}: {
  command: StyleLifecycleCommand
  onApply: () => void
  onDiscard: () => void
  onKeep: () => void
  applyDisabled?: boolean
  busy?: boolean
  error?: string | null
}) {
  const labels = LABELS[command]
  return (
    <Modal
      title="Resolve video style changes"
      eyebrow="Video style"
      onClose={onKeep}
      closeDisabled={busy}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onKeep}>Keep editing</Button>
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>{labels.discard}</Button>
          <Button variant="primary" disabled={applyDisabled || busy} onClick={onApply}>
            {labels.apply}
          </Button>
        </>
      )}
    >
      <p>
        Apply the draft to the project or discard it before you {labels.action}.
        The command will not continue while you keep editing.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  )
}
