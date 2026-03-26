import { GitHub } from '@actions/github/lib/utils';
import { SlopReport } from './types';
type Octokit = InstanceType<typeof GitHub>;
export declare function detectSlop(octokit: Octokit, owner: string, repo: string, prNumber: number, threshold?: number): Promise<SlopReport>;
export {};
