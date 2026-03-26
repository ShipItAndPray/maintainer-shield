import { GitHub } from '@actions/github/lib/utils';
import { ReputationReport } from './types';
type Octokit = InstanceType<typeof GitHub>;
export declare function scoreReputation(octokit: Octokit, owner: string, repo: string, username: string): Promise<ReputationReport>;
export {};
