import { ShieldReport, SlopReport, ReputationReport, IssueTriageReport, PRReviewTriggers } from './types'

export function formatPRComment(
  slop: SlopReport,
  reputation: ReputationReport,
  triggers: PRReviewTriggers,
  dryRun: boolean
): string {
  const flagged = triggers.slopTriggered || triggers.reputationTriggered
  const shield = flagged ? '🛡️' : '✅'
  const status = flagged ? 'Flagged for review' : 'Passed'
  const reasons: string[] = []

  if (triggers.slopTriggered) reasons.push('slop signals exceeded the configured threshold')
  if (triggers.reputationTriggered) reasons.push('contributor reputation is below the configured minimum')

  let comment = `## ${shield} Maintainer Shield — ${status}\n\n`

  if (dryRun) {
    comment += `> **DRY RUN** — No actions taken\n\n`
  }

  if (reasons.length > 0) {
    comment += `**Why this was flagged:** ${reasons.join('; ')}.\n\n`
  }

  // Slop Analysis
  comment += `### PR Quality Analysis\n\n`
  comment += `| Metric | Value |\n|--------|-------|\n`
  comment += `| Score | ${slop.score}/10 |\n`
  comment += `| Checks failed | ${slop.failedChecks}/${slop.checks.length} |\n`
  comment += `| Confidence | ${slop.confidence} |\n\n`

  if (slop.failedChecks > 0) {
    comment += `<details>\n<summary>Failed checks (${slop.failedChecks})</summary>\n\n`
    for (const check of slop.checks.filter(c => !c.passed)) {
      const icon = check.severity === 'critical' ? '🔴' : check.severity === 'high' ? '🟠' : check.severity === 'medium' ? '🟡' : '⚪'
      comment += `${icon} **${check.name}** (${check.severity}) — ${check.description}\n`
      if (check.details) comment += `  - ${check.details}\n`
    }
    comment += `\n</details>\n\n`
  }

  if (slop.checks.filter(c => c.passed).length > 0) {
    comment += `<details>\n<summary>Passed checks (${slop.checks.filter(c => c.passed).length})</summary>\n\n`
    for (const check of slop.checks.filter(c => c.passed)) {
      comment += `✅ **${check.name}** — ${check.description}\n`
    }
    comment += `\n</details>\n\n`
  }

  // Reputation
  comment += `### Contributor Reputation\n\n`
  const repIcon = reputation.level === 'trusted' ? '🟢' : reputation.level === 'high' ? '🔵' : reputation.level === 'medium' ? '🟡' : reputation.level === 'low' ? '🟠' : '🔴'
  comment += `${repIcon} **${reputation.level.toUpperCase()}** (${reputation.score}/100)\n\n`

  if (reputation.flags.length > 0) {
    comment += `Flags: ${reputation.flags.map(f => `\`${f}\``).join(', ')}\n\n`
  }

  comment += `<details>\n<summary>Reputation details</summary>\n\n`
  comment += `| Metric | Value |\n|--------|-------|\n`
  comment += `| Account age | ${reputation.accountAgeDays} days |\n`
  comment += `| Public repos | ${reputation.publicRepos} |\n`
  comment += `| Followers | ${reputation.followers} |\n`
  comment += `| Merged PRs in repo | ${reputation.mergedPRsInOrg} |\n`
  comment += `| Recent activity | ${reputation.totalContributions} events |\n`
  comment += `\n</details>\n\n`

  // What to do
  if (flagged) {
    comment += `---\n\n`
    comment += `> **To the PR author:** If this is a legitimate contribution, please ensure your PR follows the project's contribution guidelines. `
    comment += `Consider adding a detailed description explaining *why* this change is needed and *how* you tested it.\n\n`
    comment += `> **To maintainers:** This PR was flagged automatically. Please review manually if you believe this is a false positive. `
    comment += `Your feedback helps improve detection accuracy.\n`
  }

  comment += `\n---\n*[Maintainer Shield](https://github.com/ShipItAndPray/maintainer-shield) — Protecting open source from AI slop*`

  return comment
}

export function formatIssueComment(triage: IssueTriageReport): string {
  let comment = `## 🏷️ Maintainer Shield — Issue Triage\n\n`

  if (triage.suggestedLabels.length > 0) {
    comment += `**Suggested labels:** ${triage.suggestedLabels.map(l => `\`${l}\``).join(', ')}\n\n`
  }

  comment += `**Category:** ${triage.category} (confidence: ${triage.confidence})\n\n`

  if (triage.isDuplicate && triage.duplicateOf) {
    comment += `> ⚠️ **Possible duplicate** of #${triage.duplicateOf}. Please check if your issue has already been reported.\n\n`
  }

  comment += `---\n*[Maintainer Shield](https://github.com/ShipItAndPray/maintainer-shield) — Auto-triage for open source maintainers*`

  return comment
}

export function buildShieldReport(
  type: 'pull_request' | 'issue',
  actionTaken: ShieldReport['actionTaken'],
  slop?: SlopReport,
  reputation?: ReputationReport,
  triage?: IssueTriageReport
): ShieldReport {
  return {
    type,
    slop,
    reputation,
    triage,
    actionTaken,
    timestamp: new Date().toISOString(),
  }
}
