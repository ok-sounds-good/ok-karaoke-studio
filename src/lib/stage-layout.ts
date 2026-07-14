import stageLayout from '../../electron/stage-layout.json'

export const STAGE_LAYOUT = stageLayout

export function logicalStagePx(value: number): string {
  return `${value / (STAGE_LAYOUT.stage.widthPx / 100)}cqw`
}

export function lyricGapPx(actualLineCount: number): number {
  const lineCount = Math.max(1, Math.min(5, Math.trunc(actualLineCount) || 1))
  return STAGE_LAYOUT.lyric.gapsPx[lineCount]
}

export function previewStageLayoutVariables(actualLineCount: number): Record<string, string | number> {
  const { brand, clock, content, footer, frame, grain, lyric, sync, title } = STAGE_LAYOUT
  return {
    '--stage-frame-top': logicalStagePx(frame.topPx),
    '--stage-frame-right': logicalStagePx(frame.rightPx),
    '--stage-frame-bottom': logicalStagePx(frame.bottomPx),
    '--stage-frame-left': logicalStagePx(frame.leftPx),
    '--stage-frame-radius': logicalStagePx(frame.radiusPx),
    '--stage-brand-top': logicalStagePx(brand.topPx),
    '--stage-brand-left': logicalStagePx(brand.leftPx),
    '--stage-brand-spacing': `${brand.letterSpacingEm}em`,
    '--stage-clock-top': logicalStagePx(clock.topPx),
    '--stage-clock-right': logicalStagePx(clock.rightPx),
    '--stage-clock-spacing': `${clock.letterSpacingEm}em`,
    '--stage-footer-right': logicalStagePx(footer.rightPx),
    '--stage-footer-bottom': logicalStagePx(footer.bottomPx),
    '--stage-footer-left': logicalStagePx(footer.leftPx),
    '--stage-footer-spacing': `${footer.letterSpacingEm}em`,
    '--stage-content-top': logicalStagePx(content.topPx),
    '--stage-content-right': logicalStagePx(content.rightPx),
    '--stage-content-bottom': logicalStagePx(content.bottomPx),
    '--stage-content-left': logicalStagePx(content.leftPx),
    '--stage-title-eyebrow-spacing': `${title.eyebrowLetterSpacingEm}em`,
    '--stage-title-margin-top': logicalStagePx(title.marginTopPx),
    '--stage-title-margin-right': logicalStagePx(title.marginRightPx),
    '--stage-title-margin-bottom': logicalStagePx(title.marginBottomPx),
    '--stage-title-margin-left': logicalStagePx(title.marginLeftPx),
    '--stage-title-line-height': title.lineHeight,
    '--stage-title-spacing': `${title.letterSpacingEm}em`,
    '--stage-title-max-width': logicalStagePx(title.maxWidthPx),
    '--stage-title-shadow': title.shadow,
    '--stage-lyric-line-height': lyric.lineHeight,
    '--stage-lyric-line-box': `${lyric.lineBoxEm}em`,
    '--stage-lyric-spacing': `${lyric.letterSpacingEm}em`,
    '--stage-lyric-gap': logicalStagePx(lyricGapPx(actualLineCount)),
    '--stage-lyric-shadow': lyric.shadow,
    '--stage-grain-line': logicalStagePx(grain.gridLinePx),
    '--stage-grain-size': logicalStagePx(grain.gridSizePx),
    '--stage-grain-opacity': grain.opacity,
    '--stage-grain-color': grain.color,
    '--stage-sync-top': `${sync.topPercent}%`,
    '--stage-sync-height': logicalStagePx(sync.heightPx),
    '--stage-sync-shadow': sync.shadow,
  }
}

export function logicalStageLayoutAtWidth(actualLineCount: number, widthPx: number) {
  const scale = widthPx / STAGE_LAYOUT.stage.widthPx
  return {
    stage: {
      widthPx,
      heightPx: STAGE_LAYOUT.stage.heightPx * scale,
    },
    content: {
      topPx: STAGE_LAYOUT.content.topPx * scale,
      rightPx: STAGE_LAYOUT.content.rightPx * scale,
      bottomPx: STAGE_LAYOUT.content.bottomPx * scale,
      leftPx: STAGE_LAYOUT.content.leftPx * scale,
    },
    frame: {
      topPx: STAGE_LAYOUT.frame.topPx * scale,
      rightPx: STAGE_LAYOUT.frame.rightPx * scale,
      bottomPx: STAGE_LAYOUT.frame.bottomPx * scale,
      leftPx: STAGE_LAYOUT.frame.leftPx * scale,
      radiusPx: STAGE_LAYOUT.frame.radiusPx * scale,
    },
    lyricGapPx: lyricGapPx(actualLineCount) * scale,
    scale,
  }
}
