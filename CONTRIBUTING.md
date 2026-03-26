# Contributing to Maintainer Shield

## Quick Setup

```bash
git clone https://github.com/ShipItAndPray/maintainer-shield.git
cd maintainer-shield
npm install
npm run build
```

## Development

```bash
# Edit source in src/
# Rebuild after changes
npm run build

# Type check
npm run typecheck
```

## Adding a New Slop Check

1. Add your check function in `src/slop-detector.ts`
2. Follow the `SlopCheck` interface: name, description, passed, severity, details
3. Add it to the checks array in `detectSlop()`
4. Update the README checks table
5. Rebuild with `npm run build`

## Reporting False Positives

Found a false positive? Open an issue with:
- Link to the PR/issue that was incorrectly flagged
- Which check(s) triggered
- Why it's a false positive

This is the most valuable contribution you can make.

## Code Style

- TypeScript strict mode
- No unnecessary abstractions
- Every check must be documented in README
- Every threshold should be configurable

## Pull Requests

- One feature per PR
- Update README if adding/changing checks
- Include rebuilt `dist/` in your PR
- Describe what you changed and why
