import { GitHub } from '@actions/github/lib/utils'
import { ReputationReport } from './types'

type Octokit = InstanceType<typeof GitHub>

export async function scoreReputation(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<ReputationReport> {
  const [userProfile, userActivity] = await Promise.all([
    fetchUserProfile(octokit, username),
    fetchUserActivity(octokit, owner, repo, username),
  ])

  const flags: string[] = []
  let score = 50 // Start neutral

  // Account age (0-15 points)
  const accountAgeDays = userProfile.accountAgeDays
  if (accountAgeDays < 7) {
    score -= 20
    flags.push('Account less than 7 days old')
  } else if (accountAgeDays < 30) {
    score -= 10
    flags.push('Account less than 30 days old')
  } else if (accountAgeDays < 90) {
    score += 5
  } else if (accountAgeDays > 365) {
    score += 15
  } else {
    score += 10
  }

  // Public repos (0-10 points)
  if (userProfile.publicRepos === 0) {
    score -= 10
    flags.push('No public repositories')
  } else if (userProfile.publicRepos < 3) {
    score += 0
  } else if (userProfile.publicRepos < 10) {
    score += 5
  } else {
    score += 10
  }

  // Followers (0-10 points)
  if (userProfile.followers === 0) {
    score -= 5
    flags.push('No followers')
  } else if (userProfile.followers < 5) {
    score += 3
  } else if (userProfile.followers < 50) {
    score += 7
  } else {
    score += 10
  }

  // Profile completeness (0-5 points)
  if (!userProfile.hasAvatar) {
    score -= 5
    flags.push('No avatar set')
  } else {
    score += 2
  }

  if (!userProfile.hasBio) {
    score -= 2
    flags.push('No bio')
  } else {
    score += 3
  }

  // Contributions to THIS repo/org (0-20 points)
  if (userActivity.mergedPRs > 0) {
    score += Math.min(20, userActivity.mergedPRs * 5)
  } else if (userActivity.totalPRs > 3 && userActivity.mergedPRs === 0) {
    score -= 10
    flags.push('Multiple PRs but none merged in this repo')
  }

  // Total contributions across GitHub (0-10 points)
  if (userActivity.totalContributions === 0) {
    score -= 5
    flags.push('No public contribution history')
  } else if (userActivity.totalContributions < 10) {
    score += 3
  } else if (userActivity.totalContributions < 100) {
    score += 7
  } else {
    score += 10
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score))

  // Determine level
  let level: ReputationReport['level']
  if (score >= 80) level = 'trusted'
  else if (score >= 60) level = 'high'
  else if (score >= 40) level = 'medium'
  else if (score >= 20) level = 'low'
  else level = 'unknown'

  return {
    score,
    level,
    accountAgeDays,
    publicRepos: userProfile.publicRepos,
    followers: userProfile.followers,
    totalContributions: userActivity.totalContributions,
    mergedPRsInOrg: userActivity.mergedPRs,
    hasAvatar: userProfile.hasAvatar,
    hasBio: userProfile.hasBio,
    flags,
  }
}

interface UserProfile {
  accountAgeDays: number
  publicRepos: number
  followers: number
  hasAvatar: boolean
  hasBio: boolean
}

async function fetchUserProfile(octokit: Octokit, username: string): Promise<UserProfile> {
  try {
    const { data: user } = await octokit.rest.users.getByUsername({ username })
    const createdAt = new Date(user.created_at)
    const accountAgeDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

    return {
      accountAgeDays,
      publicRepos: user.public_repos,
      followers: user.followers,
      hasAvatar: !!user.avatar_url && !user.avatar_url.includes('identicon'),
      hasBio: !!user.bio && user.bio.trim().length > 0,
    }
  } catch {
    return { accountAgeDays: 0, publicRepos: 0, followers: 0, hasAvatar: false, hasBio: false }
  }
}

interface UserActivity {
  totalContributions: number
  totalPRs: number
  mergedPRs: number
}

async function fetchUserActivity(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<UserActivity> {
  try {
    const [totalPRs, mergedPRs, recentEvents] = await Promise.all([
      octokit.rest.search.issuesAndPullRequests({
        q: `type:pr author:${username} repo:${owner}/${repo}`,
        per_page: 1,
      }),
      octokit.rest.search.issuesAndPullRequests({
        q: `type:pr author:${username} repo:${owner}/${repo} is:merged`,
        per_page: 1,
      }),
      octokit.rest.activity.listPublicEventsForUser({
        username,
        per_page: 100,
      }).catch(() => ({ data: [] })),
    ])

    return {
      totalContributions: recentEvents.data.length,
      totalPRs: totalPRs.data.total_count,
      mergedPRs: mergedPRs.data.total_count,
    }
  } catch {
    return { totalContributions: 0, totalPRs: 0, mergedPRs: 0 }
  }
}
