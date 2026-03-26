export interface Config {
  githubToken: string
  slopDetection: boolean
  slopAction: 'comment' | 'label' | 'close'
  slopLabel: string
  slopThreshold: number
  issueTriage: boolean
  issueLabels: string[]
  reputationCheck: boolean
  reputationMinScore: number
  exemptUsers: string[]
  exemptRoles: string[]
  dryRun: boolean
}

export interface SlopCheck {
  name: string
  description: string
  passed: boolean
  severity: 'low' | 'medium' | 'high' | 'critical'
  details?: string
}

export interface SlopReport {
  score: number
  maxScore: number
  checks: SlopCheck[]
  failedChecks: number
  isSlop: boolean
  confidence: 'low' | 'medium' | 'high'
}

export interface ReputationReport {
  score: number
  level: 'unknown' | 'low' | 'medium' | 'high' | 'trusted'
  accountAgeDays: number
  publicRepos: number
  followers: number
  totalContributions: number
  mergedPRsInOrg: number
  hasAvatar: boolean
  hasBio: boolean
  flags: string[]
}

export interface IssueTriageReport {
  suggestedLabels: string[]
  category: 'bug' | 'feature' | 'question' | 'documentation' | 'support' | 'unknown'
  isDuplicate: boolean
  duplicateOf?: number
  confidence: 'low' | 'medium' | 'high'
}

export interface ShieldReport {
  type: 'pull_request' | 'issue'
  slop?: SlopReport
  reputation?: ReputationReport
  triage?: IssueTriageReport
  actionTaken: 'none' | 'commented' | 'labeled' | 'closed'
  timestamp: string
}

export interface PRReviewTriggers {
  slopTriggered: boolean
  reputationTriggered: boolean
}
