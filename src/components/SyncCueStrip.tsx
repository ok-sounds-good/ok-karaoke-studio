import { Edit3, Radio, Zap } from 'lucide-react'
import { Fragment, useRef, useSyncExternalStore } from 'react'
import type { SyncSession } from '../lib/sync-session'
import { Button, KeyboardKey } from './ui'

interface SyncCueStripProps {
  session: SyncSession
  onEditLyrics: () => void
}

export function SyncCueStrip({ session, onEditLyrics }: SyncCueStripProps) {
  const presentation = useSyncExternalStore(session.subscribe.bind(session), session.getSnapshot)
  const targetElementRef = useRef<HTMLSpanElement | null>(null)
  const visibleLines = [
    presentation.activeLine && {
      label: 'Active',
      line: presentation.activeLine,
      timedWordIds: presentation.activeTimedWordIds,
      state: 'is-active-line',
    },
    presentation.currentLine && {
      label: 'Target',
      line: presentation.currentLine,
      timedWordIds: presentation.currentTimedWordIds,
      state: 'is-current is-target-line',
    },
    presentation.nextLine && {
      label: 'Next line',
      line: presentation.nextLine,
      timedWordIds: presentation.nextTimedWordIds,
      state: 'is-next is-next-line',
    },
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  return (
    <section className="sync-cue panel" aria-label="Synchronization focus">
      <header className="panel-header sync-cue__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <Radio size={16} />
          </span>
          <div>
            <span className="eyebrow">Low-latency timing view</span>
            <h2>Sync focus</h2>
          </div>
        </div>
        <div className="sync-cue__actions">
          <span>
            <Zap size={12} /> Target {Math.min(presentation.cursor + 1, presentation.total)} of{' '}
            {presentation.total}
          </span>
          <Button
            size="sm"
            variant="ghost"
            title="Open the lyric text editor"
            onClick={onEditLyrics}
          >
            <Edit3 size={13} /> Edit text
          </Button>
        </div>
      </header>

      <div className="sync-cue__lines">
        {visibleLines.map(({ label, line, timedWordIds, state }) => {
          const isActiveLine = state === 'is-active-line'
          const isTargetLine = state.includes('is-target-line')
          return (
            <div key={`${state}-${line.id}`} className={`sync-cue__line ${state}`}>
              <span>{label}</span>
              <p>
                {line.beforeCount > 0 && (
                  <span
                    className="sync-cue__ellipsis"
                    aria-label={`${line.beforeCount} earlier words`}
                  >
                    …
                  </span>
                )}
                {line.tokens.map((token, tokenIndex) => {
                  const isActiveWord = isActiveLine && token.id === presentation.activeWordId
                  const isTargetWord = isTargetLine && token.id === presentation.targetWordId
                  return (
                    <Fragment key={token.id}>
                      <span
                        ref={isTargetWord ? targetElementRef : undefined}
                        data-sync-word-id={token.id}
                        aria-current={isTargetWord ? 'step' : undefined}
                        aria-label={
                          isActiveWord
                            ? `Active word: ${token.text}`
                            : isTargetWord
                              ? `Next target: ${token.text}`
                              : undefined
                        }
                        className={[
                          'sync-cue__token',
                          timedWordIds.includes(token.id) ? 'is-timed' : 'is-untimed',
                          isTargetWord ? 'is-target is-live' : '',
                          isActiveWord ? 'is-active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {token.text}
                      </span>
                      {tokenIndex < line.tokens.length - 1 ? ' ' : null}
                    </Fragment>
                  )
                })}
                {line.afterCount > 0 && (
                  <span
                    className="sync-cue__ellipsis"
                    aria-label={`${line.afterCount} later words`}
                  >
                    {' '}
                    …
                  </span>
                )}
              </p>
            </div>
          )
        })}
      </div>

      <p className="sync-cue__status" aria-live="polite" aria-atomic="true">
        {presentation.feedback ||
          (presentation.targetText
            ? `Next target: ${presentation.targetText}. Press Right to start it.`
            : 'No target remains.')}
      </p>

      <footer className="sync-cue__help">
        <KeyboardKey>Space</KeyboardKey>
        <span>Tap or hold to time naturally.</span>
        <KeyboardKey>→</KeyboardKey>
        <span>Start the displayed target.</span>
        <KeyboardKey>↓</KeyboardKey>
        <span>Explicitly end the active word.</span>
      </footer>
    </section>
  )
}
