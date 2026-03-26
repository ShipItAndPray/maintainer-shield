import { GitHub } from '@actions/github/lib/utils'
import { IssueTriageReport } from './types'

type Octokit = InstanceType<typeof GitHub>

// Keyword patterns for issue classification
const PATTERNS: Record<string, RegExp[]> = {
  bug: [
    /\b(bug|error|crash|fail|broken|doesn't work|not working|issue|problem|unexpected|wrong|incorrect)\b/i,
    /\b(exception|traceback|stack trace|segfault|panic|abort)\b/i,
    /\b(regression|broke|breaking)\b/i,
    /\b(TypeError|ReferenceError|SyntaxError|RuntimeError|ValueError|KeyError|IndexError)\b/i,
    /```[\s\S]*?(error|exception|traceback|fail|panic)[\s\S]*?```/i,
  ],
  feature: [
    /\b(feature|request|enhancement|proposal|RFC|suggestion|would be nice|wish|could we|can we|should we)\b/i,
    /\b(add support|implement|new feature|ability to|allow|enable)\b/i,
    /\b(use case|workflow|UX|improvement)\b/i,
  ],
  question: [
    /\b(how (do|can|to|does)|what (is|are|does)|why (does|is|are|do)|where (is|can|do)|when (should|does))\b/i,
    /\b(question|help|confused|clarification|documentation|explain|understand)\b/i,
    /\?\s*$/m,
  ],
  documentation: [
    /\b(docs?|documentation|readme|guide|tutorial|example|typo|spelling|grammar)\b/i,
    /\b(outdated|stale|missing docs?|wrong docs?|update docs?)\b/i,
    /\b(API reference|changelog|migration guide)\b/i,
  ],
}

const PRIORITY_KEYWORDS = {
  high: [/\b(critical|urgent|security|vulnerability|data loss|production|blocking)\b/i],
  medium: [/\b(important|regression|breaking|significant)\b/i],
  low: [/\b(minor|cosmetic|nice to have|low priority|trivial)\b/i],
}

export async function triageIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  allowedLabels: string[]
): Promise<IssueTriageReport> {
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  })

  const title = issue.title || ''
  const body = issue.body || ''
  const text = `${title}\n${body}`

  // Classify the issue
  const scores: Record<string, number> = {}
  for (const [category, patterns] of Object.entries(PATTERNS)) {
    scores[category] = patterns.reduce((score, pattern) => {
      const matches = text.match(new RegExp(pattern.source, 'gi'))
      return score + (matches ? matches.length : 0)
    }, 0)
  }

  // Find top category
  const sortedCategories = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const topCategory = sortedCategories[0][1] > 0 ? sortedCategories[0][0] : 'unknown'
  const topScore = sortedCategories[0][1]
  const secondScore = sortedCategories.length > 1 ? sortedCategories[1][1] : 0

  // Confidence based on score gap
  const confidence = topScore === 0 ? 'low' :
    topScore > secondScore * 2 ? 'high' : 'medium'

  // Build suggested labels
  const suggestedLabels: string[] = []
  if (topCategory !== 'unknown' && allowedLabels.includes(topCategory)) {
    suggestedLabels.push(topCategory)
  }

  // Check for good-first-issue potential
  if (allowedLabels.includes('good-first-issue')) {
    const isSimple = (body.length < 500) &&
      !PRIORITY_KEYWORDS.high.some(p => p.test(text)) &&
      (topCategory === 'documentation' || topCategory === 'bug')
    if (isSimple) {
      suggestedLabels.push('good-first-issue')
    }
  }

  // Check for duplicates
  const duplicate = await findDuplicate(octokit, owner, repo, title, issueNumber)
  if (duplicate !== null && allowedLabels.includes('duplicate')) {
    suggestedLabels.push('duplicate')
  }

  return {
    suggestedLabels,
    category: topCategory as IssueTriageReport['category'],
    isDuplicate: duplicate !== null,
    duplicateOf: duplicate ?? undefined,
    confidence,
  }
}

async function findDuplicate(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  currentIssueNumber: number
): Promise<number | null> {
  try {
    // Extract meaningful words from title
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)

    if (words.length < 2) return null

    const query = `repo:${owner}/${repo} is:issue is:open ${words.join(' ')}`
    const { data: results } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 5,
      sort: 'created',
      order: 'desc',
    })

    for (const issue of results.items) {
      if (issue.number === currentIssueNumber) continue
      if (!issue.pull_request) {
        // Simple similarity check
        const similarity = calculateSimilarity(title.toLowerCase(), issue.title.toLowerCase())
        if (similarity > 0.6) {
          return issue.number
        }
      }
    }

    return null
  } catch {
    return null
  }
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }

  return (2 * intersection) / (wordsA.size + wordsB.size)
}
