import { ShieldReport, SlopReport, ReputationReport, IssueTriageReport, PRReviewTriggers } from './types';
export declare function formatPRComment(slop: SlopReport, reputation: ReputationReport, triggers: PRReviewTriggers, dryRun: boolean): string;
export declare function formatIssueComment(triage: IssueTriageReport): string;
export declare function buildShieldReport(type: 'pull_request' | 'issue', actionTaken: ShieldReport['actionTaken'], slop?: SlopReport, reputation?: ReputationReport, triage?: IssueTriageReport): ShieldReport;
