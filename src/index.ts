import * as core from '@actions/core'
import * as github from '@actions/github'
import { Config, ShieldReport } from './types'
import { detectSlop } from './slop-detector'
import { scoreReputation } from './reputation'
import { triageIssue } from './issue-triage'
import { formatPRComment, formatIssueComment, buildShieldReport } from './reporter'

function getConfig(): Config {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    slopDetection: core.getInput('slop-detection') !== 'false',
    slopAction: core.getInput('slop-action') as Config['slopAction'],
    slopLabel: core.getInput('slop-label') || 'ai-slop',
    slopThreshold: parseInt(core.getInput('slop-threshold') || '4', 10),
    issueTriage: core.getInput('issue-triage') !== 'false',
    issueLabels: (core.getInput('issue-labels') || 'bug,feature,question,documentation').split(',').map(l => l.trim()),
    reputationCheck: core.getInput('reputation-check') !== 'false',
    reputationMinScore: parseInt(core.getInput('reputation-min-score') || '20', 10),
    exemptUsers: (core.getInput('exempt-users') || '').split(',').map(u => u.trim()).filter(Boolean),
    exemptRoles: (core.getInput('exempt-roles') || 'OWNER,MEMBER,COLLABORATOR').split(',').map(r => r.trim()),
    dryRun: core.getInput('dry-run') === 'true',
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
  const authorAssociation = pr.author_association || ''

  core.info(`🛡️ Maintainer Shield analyzing PR #${prNumber} by @${authorLogin}`)

  // Check exemptions
  if (config.exemptUsers.includes(authorLogin)) {
    core.info(`✅ @${authorLogin} is exempt — skipping`)
    return
  }

  if (config.exemptRoles.includes(authorAssociation)) {
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
      if (['comment', 'label', 'close'].includes(config.slopAction)) {
        const comment = formatPRComment(
          slopReport ?? { score: 0, maxScore: 10, checks: [], failedChecks: 0, isSlop: false, confidence: 'low' },
          reputationReport ?? { score: 50, level: 'medium', accountAgeDays: 0, publicRepos: 0, followers: 0, totalContributions: 0, mergedPRsInOrg: 0, hasAvatar: true, hasBio: false, flags: ['Reputation check disabled'] },
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
      if (['label', 'close'].includes(config.slopAction)) {
        try {
          // Ensure label exists
          await octokit.rest.issues.getLabel({ owner, repo, name: config.slopLabel }).catch(async () => {
            await octokit.rest.issues.createLabel({
              owner,
              repo,
              name: config.slopLabel,
              color: 'e11d48',
              description: 'Flagged by Maintainer Shield as potential AI slop',
            })
          })

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
      if (config.slopAction === 'close') {
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

  // Skip if already labeled
  if (issue.labels && issue.labels.length > 0) {
    core.info('Issue already has labels — skipping triage')
    return
  }

  const issueNumber = issue.number
  const authorLogin = issue.user?.login || ''

  core.info(`🏷️ Maintainer Shield triaging issue #${issueNumber} by @${authorLogin}`)

  // Check exemptions
  if (config.exemptUsers.includes(authorLogin)) {
    core.info(`✅ @${authorLogin} is exempt — skipping`)
    return
  }

  const triageReport = await triageIssue(octokit, owner, repo, issueNumber, config.issueLabels)
  core.info(`Category: ${triageReport.category}, labels: ${triageReport.suggestedLabels.join(', ')}, duplicate: ${triageReport.isDuplicate}`)

  if (config.dryRun) {
    core.info('DRY RUN — would have applied labels and commented')
    return
  }

  let actionTaken: ShieldReport['actionTaken'] = 'none'

  // Apply labels
  if (triageReport.suggestedLabels.length > 0 && triageReport.confidence !== 'low') {
    try {
      // Ensure labels exist
      for (const label of triageReport.suggestedLabels) {
        await octokit.rest.issues.getLabel({ owner, repo, name: label }).catch(async () => {
          const colors: Record<string, string> = {
            bug: 'd73a4a',
            feature: 'a2eeef',
            question: 'd876e3',
            documentation: '0075ca',
            'good-first-issue': '7057ff',
            duplicate: 'cfd3d7',
          }
          await octokit.rest.issues.createLabel({
            owner,
            repo,
            name: label,
            color: colors[label] || 'ededed',
          })
        })
      }

      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: triageReport.suggestedLabels,
      })
      actionTaken = 'labeled'
      core.info(`Applied labels: ${triageReport.suggestedLabels.join(', ')}`)
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
