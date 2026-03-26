-- Ensure kyc_documents has required columns for seeding (idempotent)
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type text,
  status text DEFAULT 'pending',
  file_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
