-- Ensure tip_goals has expected columns for dashboard usage
ALTER TABLE public.tip_goals
  ADD COLUMN IF NOT EXISTS target_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_amount numeric(10,2) NOT NULL DEFAULT 0;
