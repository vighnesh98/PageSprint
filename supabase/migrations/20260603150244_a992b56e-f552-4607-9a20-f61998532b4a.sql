ALTER TABLE public.summaries
ADD COLUMN IF NOT EXISTS subject text;

CREATE INDEX IF NOT EXISTS summaries_user_created_idx
ON public.summaries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS summaries_user_subject_idx
ON public.summaries (user_id, subject);