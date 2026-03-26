import { GitHub } from '@actions/github/lib/utils'
import { SlopCheck, SlopReport } from './types'

type Octokit = InstanceType<typeof GitHub>

// AI slop patterns derived from analyzing 100+ real slop PRs across major OSS projects
const AI_DESCRIPTION_PATTERNS = [
  /\bdelve\b/i,
  /\beverchanging\b/i,
  /\bfostering\b/i,
  /\bholistic\b/i,
  /\binnovative approach\b/i,
  /\bleverage\b/i,
  /\bparadigm\b/i,
  /\brobust\b/i,
  /\bseamless\b/i,
  /\bsynerg/i,
  /\btapestry\b/i,
  /\btransformative\b/i,
  /\bunlock the power\b/i,
  /\bworld-class\b/i,
  /\bcutting-edge\b/i,
  /\bnuanced\b/i,
  /\bpivotal\b/i,
  /\bcomprehensive solution\b/i,
  /\bstreamline\b/i,
  /\benhance the overall\b/i,
  /\bfacilitat/i,
  /\bin today's fast-paced\b/i,
  /\bIt's worth noting\b/i,
  /\bI'd be happy to\b/i,
  /\bLet me know if you'd like\b/i,
  /\bI hope this helps!\b/i,
]

const AI_COMMIT_PATTERNS = [
  /^(fix|feat|chore|refactor|docs|style|test|perf|ci|build|revert)(\(.+\))?: .{10,100}$/,
  /\b(improve|enhance|optimize|refactor|update|fix|add|implement)\b.*\b(code|logic|performance|readability|maintainability)\b/i,
]

const SPAM_BRANCH_PATTERNS = [
  /^patch-\d+$/,
  /^[a-z]+-patch-\d+$/,
  /^main$/,
  /^master$/,
]

interface PRData {
  title: string
  body: string | null
  headRef: string
  authorLogin: string
  authorAssociation: string
  commits: Array<{ message: string; authorDate: string }>
  files: Array<{ filename: string; additions: number; deletions: number; patch?: string }>
  createdAt: string
  additions: number
  deletions: number
  changedFiles: number
}

export async function detectSlop(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<SlopReport> {
  const pr = await fetchPRData(octokit, owner, repo, prNumber)
  const checks: SlopCheck[] = []

  // === BRANCH CHECKS ===
  checks.push(checkBranchName(pr))

  // === TITLE CHECKS ===
  checks.push(checkTitleQuality(pr))

  // === DESCRIPTION CHECKS ===
  checks.push(checkDescriptionExists(pr))
  checks.push(checkDescriptionAIPatterns(pr))
  checks.push(checkDescriptionLength(pr))

  // === COMMIT CHECKS ===
  checks.push(checkCommitMessages(pr))
  checks.push(checkCommitTiming(pr))
  checks.push(checkCommitCount(pr))

  // === FILE CHANGE CHECKS ===
  checks.push(checkFileCount(pr))
  checks.push(checkChangeSizeRatio(pr))
  checks.push(checkUnrelatedFiles(pr))
  checks.push(checkWhitespaceOnlyChanges(pr))

  // === BEHAVIORAL CHECKS ===
  checks.push(checkSubmissionSpeed(pr))
  checks.push(await checkAuthorPRVolume(octokit, owner, repo, pr))
  checks.push(checkAuthorAssociation(pr))

  const failedChecks = checks.filter(c => !c.passed)
  const score = failedChecks.reduce((sum, c) => {
    const weights = { low: 0.5, medium: 1, high: 1.5, critical: 2 }
    return sum + weights[c.severity]
  }, 0)

  const maxScore = checks.reduce((sum, c) => {
    const weights = { low: 0.5, medium: 1, high: 1.5, critical: 2 }
    return sum + weights[c.severity]
  }, 0)

  const normalizedScore = Math.min(10, Math.round((score / maxScore) * 10))

  return {
    score: normalizedScore,
    maxScore: 10,
    checks,
    failedChecks: failedChecks.length,
    isSlop: failedChecks.length >= 4,
    confidence: normalizedScore >= 7 ? 'high' : normalizedScore >= 4 ? 'medium' : 'low',
  }
}

async function fetchPRData(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRData> {
  const [prResponse, commitsResponse, filesResponse] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
    octokit.rest.pulls.listCommits({ owner, repo, pull_number: prNumber, per_page: 100 }),
    octokit.rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ])

  return {
    title: prResponse.data.title,
    body: prResponse.data.body,
    headRef: prResponse.data.head.ref,
    authorLogin: prResponse.data.user?.login || '',
    authorAssociation: prResponse.data.author_association,
    commits: commitsResponse.data.map(c => ({
      message: c.commit.message,
      authorDate: c.commit.author?.date || '',
    })),
    files: filesResponse.data.map(f => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
    createdAt: prResponse.data.created_at,
    additions: prResponse.data.additions,
    deletions: prResponse.data.deletions,
    changedFiles: prResponse.data.changed_files,
  }
}

function checkBranchName(pr: PRData): SlopCheck {
  const isDefault = SPAM_BRANCH_PATTERNS.some(p => p.test(pr.headRef))
  return {
    name: 'branch-name',
    description: 'PR uses a meaningful branch name',
    passed: !isDefault,
    severity: 'medium',
    details: isDefault ? `Branch "${pr.headRef}" matches default/spam pattern` : undefined,
  }
}

function checkTitleQuality(pr: PRData): SlopCheck {
  const title = pr.title.trim()
  const isTooShort = title.length < 10
  const isTooGeneric = /^(fix|update|change|improve|refactor|patch)\s/i.test(title) && title.length < 30
  const hasAIMarkers = AI_DESCRIPTION_PATTERNS.some(p => p.test(title))

  return {
    name: 'title-quality',
    description: 'PR title is specific and descriptive',
    passed: !isTooShort && !isTooGeneric && !hasAIMarkers,
    severity: 'medium',
    details: isTooShort ? 'Title too short' : isTooGeneric ? 'Title too generic' : hasAIMarkers ? 'Title contains AI-typical language' : undefined,
  }
}

function checkDescriptionExists(pr: PRData): SlopCheck {
  const body = (pr.body || '').trim()
  return {
    name: 'description-exists',
    description: 'PR has a description',
    passed: body.length > 20,
    severity: 'high',
    details: body.length === 0 ? 'No description provided' : body.length <= 20 ? 'Description too short' : undefined,
  }
}

function checkDescriptionAIPatterns(pr: PRData): SlopCheck {
  const body = (pr.body || '').trim()
  if (!body) return { name: 'description-ai-patterns', description: 'Description does not contain AI-typical language', passed: true, severity: 'high' }

  const matches = AI_DESCRIPTION_PATTERNS.filter(p => p.test(body))
  const ratio = matches.length / Math.max(1, body.split(/\s+/).length / 50)

  return {
    name: 'description-ai-patterns',
    description: 'Description does not contain AI-typical language',
    passed: matches.length < 3 && ratio < 0.5,
    severity: 'high',
    details: matches.length >= 3 ? `Found ${matches.length} AI-typical phrases` : undefined,
  }
}

function checkDescriptionLength(pr: PRData): SlopCheck {
  const body = (pr.body || '').trim()
  const wordCount = body.split(/\s+/).length
  const changedFiles = pr.changedFiles

  // Extremely verbose descriptions relative to change size = suspicious
  const isOverlyVerbose = wordCount > 500 && changedFiles <= 3

  return {
    name: 'description-length',
    description: 'Description length is proportional to changes',
    passed: !isOverlyVerbose,
    severity: 'low',
    details: isOverlyVerbose ? `${wordCount} words for ${changedFiles} files changed` : undefined,
  }
}

function checkCommitMessages(pr: PRData): SlopCheck {
  if (pr.commits.length === 0) return { name: 'commit-messages', description: 'Commit messages are meaningful', passed: true, severity: 'medium' }

  const genericCount = pr.commits.filter(c => {
    const msg = c.message.split('\n')[0]
    return msg.length < 10 || /^(update|fix|change|wip|test|commit)\s*$/i.test(msg)
  }).length

  const allConventional = pr.commits.every(c => AI_COMMIT_PATTERNS[0].test(c.message.split('\n')[0]))

  return {
    name: 'commit-messages',
    description: 'Commit messages are meaningful',
    passed: genericCount < pr.commits.length * 0.5 && !(allConventional && pr.commits.length > 3),
    severity: 'medium',
    details: genericCount > 0 ? `${genericCount}/${pr.commits.length} generic commit messages` : allConventional ? 'All commits follow identical conventional format (AI pattern)' : undefined,
  }
}

function checkCommitTiming(pr: PRData): SlopCheck {
  if (pr.commits.length < 2) return { name: 'commit-timing', description: 'Commits have natural timing', passed: true, severity: 'low' }

  const dates = pr.commits.map(c => new Date(c.authorDate).getTime()).filter(d => !isNaN(d)).sort()
  if (dates.length < 2) return { name: 'commit-timing', description: 'Commits have natural timing', passed: true, severity: 'low' }

  const intervals = []
  for (let i = 1; i < dates.length; i++) {
    intervals.push(dates[i] - dates[i - 1])
  }

  // All commits within 60 seconds = machine-generated
  const allInstant = intervals.every(i => i < 60000)
  // Suspiciously uniform intervals
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
  const cv = Math.sqrt(variance) / Math.max(1, avgInterval)
  const tooUniform = cv < 0.1 && intervals.length > 3

  return {
    name: 'commit-timing',
    description: 'Commits have natural timing',
    passed: !allInstant && !tooUniform,
    severity: 'medium',
    details: allInstant ? 'All commits within 60 seconds' : tooUniform ? 'Suspiciously uniform commit intervals' : undefined,
  }
}

function checkCommitCount(pr: PRData): SlopCheck {
  // Single commit with massive changes = likely AI dump
  const singleCommitBigChange = pr.commits.length === 1 && (pr.additions + pr.deletions) > 500

  return {
    name: 'commit-count',
    description: 'Commit count is proportional to changes',
    passed: !singleCommitBigChange,
    severity: 'low',
    details: singleCommitBigChange ? `Single commit with ${pr.additions + pr.deletions} lines changed` : undefined,
  }
}

function checkFileCount(pr: PRData): SlopCheck {
  // Touching too many unrelated files in one PR
  const tooMany = pr.changedFiles > 30

  return {
    name: 'file-count',
    description: 'PR changes a reasonable number of files',
    passed: !tooMany,
    severity: 'medium',
    details: tooMany ? `${pr.changedFiles} files changed` : undefined,
  }
}

function checkChangeSizeRatio(pr: PRData): SlopCheck {
  // Almost all additions with near-zero deletions on existing files = likely AI generated code dump
  const totalChanges = pr.additions + pr.deletions
  if (totalChanges === 0) return { name: 'change-ratio', description: 'Change ratio is reasonable', passed: true, severity: 'low' }

  const additionRatio = pr.additions / totalChanges
  const suspiciousRatio = additionRatio > 0.95 && totalChanges > 200 && pr.changedFiles > 5

  return {
    name: 'change-ratio',
    description: 'Change ratio is reasonable',
    passed: !suspiciousRatio,
    severity: 'low',
    details: suspiciousRatio ? `${Math.round(additionRatio * 100)}% additions across ${pr.changedFiles} files` : undefined,
  }
}

function checkUnrelatedFiles(pr: PRData): SlopCheck {
  if (pr.files.length <= 3) return { name: 'unrelated-files', description: 'Changed files are related', passed: true, severity: 'medium' }

  // Check if files span many different directories
  const dirs = new Set(pr.files.map(f => f.filename.split('/').slice(0, -1).join('/')))
  const dirSpread = dirs.size / pr.files.length

  return {
    name: 'unrelated-files',
    description: 'Changed files are related',
    passed: dirSpread < 0.8 || pr.files.length < 5,
    severity: 'medium',
    details: dirSpread >= 0.8 ? `Files spread across ${dirs.size} directories (${Math.round(dirSpread * 100)}% unique dirs)` : undefined,
  }
}

function checkWhitespaceOnlyChanges(pr: PRData): SlopCheck {
  const whitespaceOnly = pr.files.filter(f => {
    if (!f.patch) return false
    const lines = f.patch.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'))
    return lines.every(l => {
      const content = l.slice(1)
      return content.trim() === '' || content === content.trimEnd()
    })
  })

  const ratio = whitespaceOnly.length / Math.max(1, pr.files.length)

  return {
    name: 'whitespace-changes',
    description: 'PR contains substantive changes',
    passed: ratio < 0.7 || pr.files.length <= 2,
    severity: 'medium',
    details: ratio >= 0.7 ? `${Math.round(ratio * 100)}% of files have whitespace-only changes` : undefined,
  }
}

function checkSubmissionSpeed(pr: PRData): SlopCheck {
  if (pr.commits.length === 0) return { name: 'submission-speed', description: 'Time between fork and PR is reasonable', passed: true, severity: 'high' }

  const firstCommit = new Date(pr.commits[0].authorDate).getTime()
  const prCreated = new Date(pr.createdAt).getTime()

  if (isNaN(firstCommit) || isNaN(prCreated)) return { name: 'submission-speed', description: 'Time between fork and PR is reasonable', passed: true, severity: 'high' }

  const minutesBetween = (prCreated - firstCommit) / 60000
  // PR submitted within 5 minutes of first commit on a substantial change
  const tooFast = minutesBetween < 5 && (pr.additions + pr.deletions) > 100

  return {
    name: 'submission-speed',
    description: 'Time between fork and PR is reasonable',
    passed: !tooFast,
    severity: 'high',
    details: tooFast ? `PR submitted ${Math.round(minutesBetween)} minutes after first commit with ${pr.additions + pr.deletions} lines changed` : undefined,
  }
}

async function checkAuthorPRVolume(octokit: Octokit, owner: string, repo: string, pr: PRData): Promise<SlopCheck> {
  try {
    const { data: userPRs } = await octokit.rest.search.issuesAndPullRequests({
      q: `type:pr author:${pr.authorLogin} created:>${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`,
      per_page: 1,
    })

    const highVolume = userPRs.total_count > 10

    return {
      name: 'author-pr-volume',
      description: 'Author is not shotgunning PRs across repos',
      passed: !highVolume,
      severity: 'critical',
      details: highVolume ? `Author submitted ${userPRs.total_count} PRs in the last 24 hours` : undefined,
    }
  } catch {
    return { name: 'author-pr-volume', description: 'Author is not shotgunning PRs across repos', passed: true, severity: 'critical' }
  }
}

function checkAuthorAssociation(pr: PRData): SlopCheck {
  const trusted = ['OWNER', 'MEMBER', 'COLLABORATOR']
  return {
    name: 'author-association',
    description: 'Author has a relationship with the repo',
    passed: trusted.includes(pr.authorAssociation),
    severity: 'low',
    details: !trusted.includes(pr.authorAssociation) ? `Author association: ${pr.authorAssociation}` : undefined,
  }
}
