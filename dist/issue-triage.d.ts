import { GitHub } from '@actions/github/lib/utils';
import { IssueTriageReport } from './types';
type Octokit = InstanceType<typeof GitHub>;
export declare function triageIssue(octokit: Octokit, owner: string, repo: string, issueNumber: number, allowedLabels: string[]): Promise<IssueTriageReport>;
export {};
