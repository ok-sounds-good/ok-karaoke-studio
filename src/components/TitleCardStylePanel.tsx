import { useId, useState } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { StageStyleDraftChange } from '../hooks/useProjectStyleSession'
import type { OpeningTiming } from '../lib/model'
import type { OpeningTimingFacts } from '../lib/stage-frame-state'
import type { StageStyle, VisibleTextStyle } from '../lib/video-style'
import { OpeningTimingControl } from './OpeningTimingControl'
import { VisibleTextRoleEditor } from './VisibleTextRoleEditor'

const TITLE_CARD_ROLES = [
  { id: 'eyebrow', label: 'Eyebrow' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
] as const

export type TitleCardRole = (typeof TITLE_CARD_ROLES)[number]['id']

interface TitleCardStylePanelProps {
  active: boolean
  className?: string
  draft: StageStyle
  fonts: InstalledFontState
  id: string
  labelledBy: string
  onDraftChange: (change: StageStyleDraftChange) => void
  openingMaximumMs: number
  opening: OpeningTiming
  openingFacts: OpeningTimingFacts
  onOpeningChange: (opening: OpeningTiming) => void
  onRetryFonts: () => void
  onSelectedRoleChange: (role: TitleCardRole) => void
}

export function TitleCardStylePanel({
  active,
  className,
  draft,
  fonts,
  id,
  labelledBy,
  onDraftChange,
  openingMaximumMs,
  opening,
  openingFacts,
  onOpeningChange,
  onRetryFonts,
  onSelectedRoleChange,
}: TitleCardStylePanelProps) {
  const radioName = useId()
  const [selectedRole, setSelectedRole] = useState<TitleCardRole>('eyebrow')
  const selected = TITLE_CARD_ROLES.find(({ id }) => id === selectedRole)!
  const updateSelectedRole = (style: VisibleTextStyle) =>
    onDraftChange((current) => ({
      ...current,
      titleCard: {
        ...current.titleCard,
        [selectedRole]: style,
      },
    }))

  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
      className={className}
    >
      <h3 className="style-destination-heading">Title card</h3>
      <OpeningTimingControl
        maximumMs={openingMaximumMs}
        opening={opening}
        facts={openingFacts}
        onChange={onOpeningChange}
      />
      <fieldset className="title-card-role-selector">
        <legend>Title card role</legend>
        <div role="radiogroup" aria-label="Title card role">
          {TITLE_CARD_ROLES.map(({ id: role, label }) => (
            <label key={role}>
              <input
                type="radio"
                name={radioName}
                value={role}
                checked={selectedRole === role}
                onChange={() => {
                  setSelectedRole(role)
                  onSelectedRoleChange(role)
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <VisibleTextRoleEditor
        fonts={fonts}
        label={selected.label}
        style={draft.titleCard[selectedRole]}
        onChange={updateSelectedRole}
        onRetryFonts={onRetryFonts}
      />
    </section>
  )
}
