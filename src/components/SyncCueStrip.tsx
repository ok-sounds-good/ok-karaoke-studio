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
  const visibleLines = [presentation.currentLine, presentation.nextLine].filter(
    (line): line is NonNullable<typeof line> => line !== null,
  )

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
            <Zap size={12} /> Word {Math.min(presentation.cursor + 1, presentation.total)} of{' '}
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
        {visibleLines.map((line, lineOffset) => (
          <div
            key={line.id}
            className={`sync-cue__line ${lineOffset === 0 ? 'is-current' : 'is-next'}`}
          >
            <span>{lineOffset === 0 ? 'Now' : 'Next'}</span>
            <p>
              {line.beforeCount > 0 && (
                <span
                  className="sync-cue__ellipsis"
                  aria-label={`${line.beforeCount} earlier words`}
                >
                  …
                </span>
              )}
              {line.tokens.map((token, tokenIndex) => (
                <Fragment key={token.id}>
                  <span
                    ref={token.id === presentation.targetWordId ? targetElementRef : undefined}
                    data-sync-word-id={token.id}
                    className={[
                      'sync-cue__token',
                      (lineOffset === 0
                        ? presentation.currentTimedWordIds
                        : presentation.nextTimedWordIds
                      ).includes(token.id)
                        ? 'is-timed'
                        : 'is-untimed',
                      token.id === presentation.targetWordId ? 'is-target is-live' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {token.text}
                  </span>
                  {tokenIndex < line.tokens.length - 1 ? ' ' : null}
                </Fragment>
              ))}
              {line.afterCount > 0 && (
                <span className="sync-cue__ellipsis" aria-label={`${line.afterCount} later words`}>
                  {' '}
                  …
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      <footer className="sync-cue__help">
        <KeyboardKey>Space</KeyboardKey>
        <span>Tap or hold to time naturally.</span>
        <KeyboardKey>→</KeyboardKey>
        <span>Start the target word.</span>
        <KeyboardKey>↓</KeyboardKey>
        <span>End the active word.</span>
      </footer>
    </section>
  )
}
