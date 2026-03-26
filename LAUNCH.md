# Launch Playbook

## Show HN Post

**Title:** Show HN: Maintainer Shield – One GitHub Action to kill AI slop PRs, triage issues, and score contributors

**Text:**
Hi HN,

I built Maintainer Shield because I watched the AI slop crisis crush maintainers I respect. Coolify gets 120+ slop PRs/month. cURL shut down its bug bounty. Godot's maintainers called it "draining and demoralizing." Only 1 in 10 AI-generated PRs is legitimate.

The existing tools are fragmented — one tool for slop detection (regex-only), another for issue triage, another for author scoring. Maintainers shouldn't need 3 tools for one problem.

Maintainer Shield is a single GitHub Action that:

- Runs 15 checks on every PR (AI language patterns, commit timing, submission speed, author volume, file analysis)
- Scores contributor reputation 0-100 (account age, merge history, profile completeness)
- Auto-triages issues (bug/feature/question/docs, duplicate detection)
- Configurable: comment, label, or auto-close. Your rules.
- Collaborators auto-exempt. Zero false positives on your team.

It's free, MIT licensed, and runs on itself (dogfooding).

https://github.com/ShipItAndPray/maintainer-shield

I'd love feedback from other maintainers. What checks would you add? What would make you install this today?

---

## Twitter/X Post

Open source maintainers are drowning in AI slop.

120+ slop PRs/month on popular repos. cURL shut down bug bounty. Godot says "demoralizing."

I built Maintainer Shield — one GitHub Action that:
- Kills slop PRs (15 checks)
- Auto-triages issues
- Scores contributor reputation

Free. MIT. 5 lines to install.

github.com/ShipItAndPray/maintainer-shield

---

## Reddit Posts

### r/programming
**Title:** I built a GitHub Action that fights AI slop PRs for open source maintainers

### r/opensource
**Title:** After watching AI slop crush maintainers I respect, I built Maintainer Shield — slop detection + issue triage + reputation scoring in one action

### r/github
**Title:** GitHub Action: Detect AI slop PRs, auto-triage issues, score contributor reputation — all in one workflow

---

## Dev.to Post Title
"I Built Maintainer Shield Because Open Source Maintainers Deserve Better Than AI Slop"

---

## Key Distribution Channels (in order)

1. **Show HN** — Post Tuesday-Thursday, 9-11am PT
2. **Twitter/X** — Tag @gaborcselle (GitHub product), @gaborjkl, @jeffgeerling, @bagaborian
3. **Reddit** — r/programming, r/opensource, r/github, r/devops
4. **Dev.to** — Full tutorial post
5. **GitHub Discussions** — Comment on github/community Discussion #185387
6. **Awesome Lists** — Submit to awesome-github-actions, awesome-oss, awesome-maintainers
7. **Discord** — Post in major OSS project Discords (Godot, Coolify, etc.)

## Timing

Best days: Tuesday, Wednesday, Thursday
Best time: 9-11am Pacific (when HN/Reddit peak)
Avoid: Fridays, weekends, holidays

## After Launch

- Star the repo yourself (bootstrap first star)
- Respond to EVERY comment within 1 hour
- Ship fixes for any feedback within 24 hours
- Create a v0.1.0 release tag after initial feedback
