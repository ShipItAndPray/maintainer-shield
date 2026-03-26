import * as core from '@actions/core'
import * as github from '@actions/github'
import { Config, ShieldReport } from './types'
import { detectSlop } from './slop-detector'
import { scoreReputation } from './reputation'
import { triageIssue } from './issue-triage'
import { formatPRComment, formatIssueComment, buildShieldReport } from './reporter'

function parseBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name)
  if (!raw) return defaultValue

  const normalized = raw.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false

  throw new Error(`Invalid boolean input for "${name}": ${raw}`)
}

function parseIntegerInput(name: string, defaultValue: number, min: number, max: number): number {
  const raw = core.getInput(name)
  if (!raw) return defaultValue

  const value = parseInt(raw, 10)
  if (Number.isNaN(value) || value < min || value > max) {
    throw new Error(`Invalid integer input for "${name}": ${raw}. Expected ${min}-${max}.`)
  }

  return value
}

function parseCsvInput(name: string, defaultValue: string[] = []): string[] {
  const raw = core.getInput(name)
  if (!raw) return [...defaultValue]

  return raw.split(',').map(value => value.trim()).filter(Boolean)
}

function parseSlopAction(): Config['slopAction'] {
  const raw = (core.getInput('slop-action') || 'comment').trim().toLowerCase()
  if (raw === 'comment' || raw === 'label' || raw === 'close') return raw
  throw new Error(`Invalid slop-action: ${raw}. Expected comment, label, or close.`)
}

function getConfig(): Config {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    slopDetection: parseBooleanInput('slop-detection', true),
    slopAction: parseSlopAction(),
    slopLabel: core.getInput('slop-label') || 'ai-slop',
    slopThreshold: parseIntegerInput('slop-threshold', 4, 1, 21),
    issueTriage: parseBooleanInput('issue-triage', true),
    issueLabels: parseCsvInput('issue-labels', ['bug', 'feature', 'question', 'documentation']),
    reputationCheck: parseBooleanInput('reputation-check', true),
    reputationMinScore: parseIntegerInput('reputation-min-score', 20, 0, 100),
    exemptUsers: parseCsvInput('exempt-users').map(u => u.toLowerCase()),
    exemptRoles: parseCsvInput('exempt-roles', ['OWNER', 'MEMBER', 'COLLABORATOR']).map(r => r.toUpperCase()),
    dryRun: parseBooleanInput('dry-run', false),
  }
}

async function ensureLabelExists(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  name: string,
  color: string,
  description?: string
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name })
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status !== 404) throw error

    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name,
      color,
      description,
    })
  }
}

async function handlePullRequest(config: Config): Promise<void> {
  const octokit = github.getOctokit(config.githubToken)
  const { owner, repo } = github.context.repo
  const pr = github.context.payload.pull_request

  if (!pr) {
    core.info('No pull request found in context')
    return
  }

  const prNumber = pr.number
  const authorLogin = pr.user?.login || ''
  const normalizedAuthorLogin = authorLogin.toLowerCase()
  const authorAssociation = pr.author_association || ''

  core.info(`🛡️ Maintainer Shield analyzing PR #${prNumber} by @${authorLogin}`)

  // Check exemptions
  if (config.exemptUsers.includes(normalizedAuthorLogin)) {
    core.info(`✅ @${authorLogin} is exempt — skipping`)
    return
  }

  if (config.exemptRoles.includes(authorAssociation.toUpperCase())) {
    core.info(`✅ @${authorLogin} is ${authorAssociation} — skipping`)
    return
  }

  // Run slop detection
  let slopReport = undefined
  if (config.slopDetection) {
    core.info('Running slop detection...')
    slopReport = await detectSlop(octokit, owner, repo, prNumber, config.slopThreshold)
    core.info(`Slop score: ${slopReport.score}/10, failed: ${slopReport.failedChecks}, isSlop: ${slopReport.isSlop}`)
    core.setOutput('slop-score', slopReport.score.toString())
    core.setOutput('checks-failed', slopReport.failedChecks.toString())
  }

  // Run reputation check
  let reputationReport = undefined
  if (config.reputationCheck) {
    core.info('Checking contributor reputation...')
    reputationReport = await scoreReputation(octokit, owner, repo, authorLogin)
    core.info(`Reputation: ${reputationReport.score}/100 (${reputationReport.level})`)
    core.setOutput('reputation-score', reputationReport.score.toString())
  }

  // Determine action — either check can trigger independently
  let actionTaken: ShieldReport['actionTaken'] = 'none'
  const slopTriggered = slopReport?.isSlop === true
  const reputationTriggered = reputationReport !== undefined && reputationReport.score < config.reputationMinScore
  const shouldAct = slopTriggered || reputationTriggered

  if (shouldAct) {
    if (config.dryRun) {
      core.info('DRY RUN — would have taken action')
      core.info(`  Slop triggered: ${slopTriggered}, Reputation triggered: ${reputationTriggered}`)
      actionTaken = 'none'
    } else {
      // Comment
      if (['comment', 'label', 'close'].includes(config.slopAction) || reputationTriggered) {
        const comment = formatPRComment(
          slopReport ?? { score: 0, maxScore: 10, checks: [], failedChecks: 0, isSlop: false, confidence: 'low' },
          reputationReport ?? { score: 50, level: 'medium', accountAgeDays: 0, publicRepos: 0, followers: 0, totalContributions: 0, mergedPRsInOrg: 0, hasAvatar: true, hasBio: false, flags: ['Reputation check disabled'] },
          { slopTriggered, reputationTriggered },
          config.dryRun
        )
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: comment,
        })
        actionTaken = 'commented'
        core.info('Posted analysis comment')
      }

      // Label
      if (slopTriggered && ['label', 'close'].includes(config.slopAction)) {
        try {
          await ensureLabelExists(
            octokit,
            owner,
            repo,
            config.slopLabel,
            'e11d48',
            'Flagged by Maintainer Shield as potential AI slop'
          )

          await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: prNumber,
            labels: [config.slopLabel],
          })
          actionTaken = 'labeled'
          core.info(`Applied label: ${config.slopLabel}`)
        } catch (err) {
          core.warning(`Failed to apply label: ${err}`)
        }
      }

      // Close
      if (slopTriggered && config.slopAction === 'close') {
        await octokit.rest.pulls.update({
          owner,
          repo,
          pull_number: prNumber,
          state: 'closed',
        })
        actionTaken = 'closed'
        core.info('Closed PR')
      }
    }
  } else {
    core.info('✅ PR passed all checks')
  }

  const report = buildShieldReport('pull_request', actionTaken, slopReport, reputationReport)
  core.setOutput('action-taken', actionTaken)
  core.setOutput('report', JSON.stringify(report))
}

async function handleIssue(config: Config): Promise<void> {
  if (!config.issueTriage) {
    core.info('Issue triage disabled — skipping')
    return
  }

  const octokit = github.getOctokit(config.githubToken)
  const { owner, repo } = github.context.repo
  const issue = github.context.payload.issue

  if (!issue) {
    core.info('No issue found in context')
    return
  }

  const issueNumber = issue.number
  const authorLogin = issue.user?.login || ''
  const normalizedAuthorLogin = authorLogin.toLowerCase()
  const existingLabels = new Set(
    (issue.labels || [])
      .map((label: string | { name?: string | null }) => typeof label === 'string' ? label : label.name || '')
      .filter(Boolean)
  )

  core.info(`🏷️ Maintainer Shield triaging issue #${issueNumber} by @${authorLogin}`)

  // Check exemptions
  if (config.exemptUsers.includes(normalizedAuthorLogin)) {
    core.info(`✅ @${authorLogin} is exempt — skipping`)
    return
  }

  const triageReport = await triageIssue(octokit, owner, repo, issueNumber, config.issueLabels)
  const labelsToApply = triageReport.suggestedLabels.filter(label => !existingLabels.has(label))
  core.info(`Category: ${triageReport.category}, labels: ${labelsToApply.join(', ')}, duplicate: ${triageReport.isDuplicate}`)

  if (config.dryRun) {
    core.info('DRY RUN — would have applied labels and commented')
    return
  }

  let actionTaken: ShieldReport['actionTaken'] = 'none'

  // Apply labels
  if (labelsToApply.length > 0 && triageReport.confidence !== 'low') {
    try {
      const colors: Record<string, string> = {
        bug: 'd73a4a',
        feature: 'a2eeef',
        question: 'd876e3',
        documentation: '0075ca',
        'good-first-issue': '7057ff',
        duplicate: 'cfd3d7',
      }

      for (const label of labelsToApply) {
        await ensureLabelExists(octokit, owner, repo, label, colors[label] || 'ededed')
      }

      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: labelsToApply,
      })
      actionTaken = 'labeled'
      core.info(`Applied labels: ${labelsToApply.join(', ')}`)
    } catch (err) {
      core.warning(`Failed to apply labels: ${err}`)
    }
  }

  // Comment if duplicate detected
  if (triageReport.isDuplicate) {
    const comment = formatIssueComment(triageReport)
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: comment,
    })
    if (actionTaken === 'none') actionTaken = 'commented'
    core.info('Posted triage comment')
  }

  const report = buildShieldReport('issue', actionTaken, undefined, undefined, triageReport)
  core.setOutput('action-taken', actionTaken)
  core.setOutput('report', JSON.stringify(report))
}

async function run(): Promise<void> {
  try {
    const config = getConfig()
    const eventName = github.context.eventName

    core.info(`🛡️ Maintainer Shield v0.1.0`)
    core.info(`Event: ${eventName}, Action: ${github.context.payload.action}`)

    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
      await handlePullRequest(config)
    } else if (eventName === 'issues') {
      await handleIssue(config)
    } else {
      core.info(`Unsupported event: ${eventName} — skipping`)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
