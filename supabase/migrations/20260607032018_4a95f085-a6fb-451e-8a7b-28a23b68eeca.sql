
ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS share_token uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

CREATE INDEX IF NOT EXISTS summaries_share_token_idx ON public.summaries(share_token) WHERE share_token IS NOT NULL;

-- Track shared summaries imported into another user's library (optional history of receivers).
CREATE TABLE IF NOT EXISTS public.shared_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_summary_id uuid NOT NULL REFERENCES public.summaries(id) ON DELETE CASCADE,
  imported_summary_id uuid REFERENCES public.summaries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_summary_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_imports TO authenticated;
GRANT ALL ON public.shared_imports TO service_role;

ALTER TABLE public.shared_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_imports_own ON public.shared_imports
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
