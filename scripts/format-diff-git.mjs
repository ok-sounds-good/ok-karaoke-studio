import { execFileSync } from 'node:child_process'
import path from 'node:path'

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const ZERO_SHA = /^0+$/

function runGit(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', root, '--literal-pathspecs', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'pipe'],
    })
  } catch (error) {
    if (allowFailure) return ''

    const detail = error.stderr?.toString().trim() || error.message
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}

function splitNullDelimited(value) {
  return value.split('\0').filter(Boolean)
}

export function parseNameStatus(value) {
  const fields = splitNullDelimited(value)
  const targets = []

  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (/^[RC]/.test(status)) {
      const previousPath = fields[index++]
      const file = fields[index++]
      targets.push({ file, diffPaths: [previousPath, file] })
    } else {
      const file = fields[index++]
      targets.push({ file, diffPaths: [file] })
    }
  }

  return targets
}

export function parseHunkRanges(diff) {
  const ranges = []

  for (const line of diff.split('\n')) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match) continue

    ranges.push({
      startLine: Number(match[1]),
      lineCount: match[2] === undefined ? 1 : Number(match[2]),
    })
  }

  return ranges
}

export function resolveRepositoryRoot(cwd) {
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']).trim()
  if (!root) throw new Error(`No Git repository found from ${cwd}`)
  return runGit(root, ['rev-parse', '--path-format=absolute', '--show-toplevel']).trim()
}

function resolveCommit(root, reference) {
  return runGit(root, ['rev-parse', '--verify', `${reference}^{commit}`], {
    allowFailure: true,
  }).trim()
}

export function resolveBase(root, base, head, defaultBranch, branch) {
  if (!base) return null
  if (!ZERO_SHA.test(base)) return base

  const headCommit = resolveCommit(root, head)
  const references = defaultBranch
    ? [`refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`]
    : []
  for (const reference of references) {
    const candidate = resolveCommit(root, reference)
    if (!candidate) continue
    const mergeBase = runGit(root, ['merge-base', candidate, headCommit], {
      allowFailure: true,
    }).trim()
    if (mergeBase && mergeBase !== headCommit) return mergeBase
    if (mergeBase === headCommit && branch && branch !== defaultBranch) return headCommit
  }

  return EMPTY_TREE_SHA
}

export function normalizeRequestedPaths(root, values) {
  return [
    ...new Set(
      values.map((value) => {
        const absolute = path.resolve(root, value)
        const relative = path.relative(root, absolute)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`Path is outside the repository: ${value}`)
        }
        return relative || '.'
      }),
    ),
  ]
}

function diffInvocation(base, head) {
  return base ? [base, head] : ['HEAD']
}

export function changedTargets(root, { base, head, paths }) {
  const pathspec = paths.length > 0 ? paths : ['.']
  const common = [
    '--find-renames',
    '-l0',
    '--name-status',
    '-z',
    '--diff-filter=ACMRT',
    ...diffInvocation(base, head),
    '--',
    ...pathspec,
  ]
  const targets = parseNameStatus(runGit(root, ['diff', ...common]))

  if (!base) {
    const untracked = splitNullDelimited(
      runGit(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec]),
    )
    targets.push(...untracked.map((file) => ({ file, diffPaths: [file] })))
  }

  return [...new Map(targets.map((target) => [target.file, target])).values()].sort((left, right) =>
    left.file.localeCompare(right.file),
  )
}

export function changedRanges(root, target, { base, head }) {
  const tracked = runGit(root, ['ls-files', '--error-unmatch', '--', target.file], {
    allowFailure: true,
  }).trim()

  if (!tracked) return [{ startLine: 1, lineCount: Number.MAX_SAFE_INTEGER }]

  const diff = runGit(root, [
    'diff',
    '--find-renames',
    '-l0',
    '--diff-algorithm=myers',
    '--no-indent-heuristic',
    '--unified=0',
    '--inter-hunk-context=0',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--text',
    ...diffInvocation(base, head),
    '--',
    ...target.diffPaths,
  ])
  return parseHunkRanges(diff)
}
