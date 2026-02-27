# Niത്യ

Niത്യ is a Solo Leveling-inspired self-discipline RPG app built with React + Vite + Supabase.

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

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Start dev server:

```bash
npm run dev
```

4. Build:

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Notes

- Browser notification reminders require notification permission.
- Some systems (daily quest/challenge seeding) auto-recover if records are missing.

