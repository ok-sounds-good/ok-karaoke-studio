import { cloneVocalStyle, isValidSyncAid, type VocalStyle } from './video-style'

export type VocalStyleTimingField = 'previewMs' | 'minLeadMs' | 'maxLeadMs'

export interface VocalStyleTimingDraft {
  previewMs: string
  minLeadMs: string
  maxLeadMs: string
}

export interface VocalStyleTimingValidation {
  errors: Record<VocalStyleTimingField, string | null>
  values: Record<VocalStyleTimingField, number> | null
}

export const VOCAL_STYLE_TIMING_ERROR =
  'Fix singer Preview Time and Sync Aid timing errors before applying Style changes.'

export function vocalStyleTimingDraft(style: VocalStyle): VocalStyleTimingDraft {
  return {
    previewMs: String(style.previewMs),
    minLeadMs: String(style.syncAid.minLeadMs),
    maxLeadMs: String(style.syncAid.maxLeadMs),
  }
}

function parseWholeMilliseconds(value: string): number | null {
  if (!/^-?\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function validateVocalStyleTiming(draft: VocalStyleTimingDraft): VocalStyleTimingValidation {
  const parsed = {
    previewMs: parseWholeMilliseconds(draft.previewMs),
    minLeadMs: parseWholeMilliseconds(draft.minLeadMs),
    maxLeadMs: parseWholeMilliseconds(draft.maxLeadMs),
  }
  const errors: VocalStyleTimingValidation['errors'] = {
    previewMs:
      parsed.previewMs === null ? 'Enter Preview Time as a safe whole number of ms.' : null,
    minLeadMs:
      parsed.minLeadMs === null ? 'Enter Minimum lead as a safe whole number of ms.' : null,
    maxLeadMs:
      parsed.maxLeadMs === null ? 'Enter Maximum lead as a safe whole number of ms.' : null,
  }

  if (parsed.previewMs !== null && (parsed.previewMs < 0 || parsed.previewMs > 60_000)) {
    errors.previewMs = 'Preview Time must be between 0 and 60000 ms.'
  }
  if (parsed.minLeadMs !== null && (parsed.minLeadMs < 0 || parsed.minLeadMs > 60_000)) {
    errors.minLeadMs = 'Minimum lead must be between 0 and 60000 ms.'
  }
  if (parsed.maxLeadMs !== null && (parsed.maxLeadMs < 0 || parsed.maxLeadMs > 60_000)) {
    errors.maxLeadMs = 'Maximum lead must be between 0 and 60000 ms.'
  }
  if (!errors.minLeadMs && !errors.maxLeadMs && parsed.minLeadMs! > parsed.maxLeadMs!) {
    errors.minLeadMs = 'Minimum lead must be no more than Maximum lead.'
    errors.maxLeadMs = 'Maximum lead must be at least Minimum lead.'
  }
  if (!errors.maxLeadMs && !errors.previewMs && parsed.maxLeadMs! > parsed.previewMs!) {
    errors.maxLeadMs = 'Maximum lead must be no more than Preview Time.'
    errors.previewMs = 'Preview Time must be at least Maximum lead.'
  }

  if (Object.values(errors).some(Boolean)) return { errors, values: null }
  return {
    errors,
    values: {
      previewMs: parsed.previewMs!,
      minLeadMs: parsed.minLeadMs!,
      maxLeadMs: parsed.maxLeadMs!,
    },
  }
}

export function vocalStyleWithTiming(
  style: VocalStyle,
  draft: VocalStyleTimingDraft,
): VocalStyle | null {
  const validation = validateVocalStyleTiming(draft)
  if (!validation.values) return null
  const candidate = cloneVocalStyle(style)
  candidate.previewMs = validation.values.previewMs
  candidate.syncAid.minLeadMs = validation.values.minLeadMs
  candidate.syncAid.maxLeadMs = validation.values.maxLeadMs
  return isValidSyncAid(candidate) ? candidate : null
}
