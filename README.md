# Niത്യ

Nിത്യ is a Solo Leveling-inspired self-discipline RPG app built with React + Vite + Supabase.

## Core Concept

- You level up by completing real-life habits and quests.
- Stats evolve like an RPG profile (Strength, Intelligence, Discipline, etc.).
- Missed habits can trigger punishments and XP penalties (especially in Hardcore mode).
- Daily challenge and warning systems keep pressure and momentum high.

## Main Features

- Auth with email/password and Google sign-in via Supabase
- Habit tracking with XP rewards
- Quest board with daily refresh behavior
- RPG avatar, XP bar, level progression, rank-like progression
- Stat panel with pentagon graph and expandable details
- Punishment system with timer and auto XP deduction on timeout
- Archive page for achievements and equipped titles

## Tech Stack

- React (Vite)
- Tailwind CSS
- Supabase (Auth + Database)
- Framer Motion

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and set values.

3. Validate env safety:

```bash
npm run security:env
```

4. Start dev server:

```bash
npm run dev
```

## Build

- Standard web build:

```bash
npm run build
```

- Secure build (env guard + build):

```bash
npm run build:secure
```

## Android Release Safety

- Ship signed `release` artifacts only.
- Never distribute debug APKs.
- Keep keystore/password private and backed up.
- Production network traffic is HTTPS-only.
- Re-generate checksum manifest:

```bash
npm run release:checksums
```

- Install local GitHub CLI wrapper (project-local):

```bash
npm run gh:install
```

- Publish GitHub release (works with `GH_TOKEN`/`GITHUB_TOKEN` or existing `gh auth login` session):

```bash
npm run release:github
```

## Official Distribution

- Official release channels:
  - GitHub Releases
  - Amazon Appstore
  - Samsung Galaxy Store
  - Huawei AppGallery
  - Aptoide
- Keep package ID `com.rohith.nithya` and same signing key across all stores/updates.
- Include versioned release notes and `release-apk-files/SHA256SUMS.txt` for every published build.
- Store listing pack: `store-assets/`

## Privacy and Data Handling

- Policy document: `PRIVACY_POLICY.md`
- Web policy page: `public/privacy-policy.html`
- Security/release policy: `SECURITY_RELEASE.md`

## Notes

- Browser and Android reminders require notification permission.
- Exact alarm permission is optional and used only for strict reminder timing.
- Some systems (daily quest/challenge seeding) auto-recover if records are missing.
