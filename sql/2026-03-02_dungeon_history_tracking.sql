-- Dungeon History Tracking
-- Adds dungeon_runs table to track completed/failed dungeons

CREATE TABLE IF NOT EXISTS public.dungeon_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_title text NOT NULL,
  challenge_description text,
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'quit')),
  xp_bonus_multiplier numeric NOT NULL DEFAULT 1.5,
  xp_reward integer DEFAULT 0,
  xp_penalty integer DEFAULT 0,
  duration_days integer NOT NULL,
  completed_days integer DEFAULT 0,
  punishment_mode text,
  custom_punishment_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient user queries
CREATE INDEX IF NOT EXISTS dungeon_runs_user_idx ON public.dungeon_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dungeon_runs_status_idx ON public.dungeon_runs (user_id, status);

-- RLS Policies
ALTER TABLE public.dungeon_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dungeon_runs_select_own ON public.dungeon_runs;
CREATE POLICY dungeon_runs_select_own
ON public.dungeon_runs FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dungeon_runs_insert_own ON public.dungeon_runs;
CREATE POLICY dungeon_runs_insert_own
ON public.dungeon_runs FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS dungeon_runs_update_own ON public.dungeon_runs;
CREATE POLICY dungeon_runs_update_own
ON public.dungeon_runs FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
