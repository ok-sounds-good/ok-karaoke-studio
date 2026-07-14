import { Button, Modal } from './ui'

export function ProjectCloseDialog({
  busy,
  saving,
  onSave,
  onDiscard,
  onKeep,
}: {
  busy: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onKeep: () => void
}) {
  return (
    <Modal
      title="Save changes before closing?"
      eyebrow="Unsaved project"
      onClose={onKeep}
      closeDisabled={busy}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onKeep}>Keep editing</Button>
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>Don't save</Button>
          <Button variant="primary" disabled={busy} onClick={onSave}>
            {saving ? 'Saving…' : 'Save & close'}
          </Button>
        </>
      )}
    >
      <p>Your latest project changes have not been saved.</p>
    </Modal>
  )
}
