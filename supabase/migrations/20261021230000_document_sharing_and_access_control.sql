-- Migration: Document Sharing and Access Control (Phase 3)
-- Created At: 2026-10-21

-- 1. Ensure public.profiles exists to allow secure recipient discovery
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to sync new auth.users into public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing users into public.profiles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    INSERT INTO public.profiles (id, email)
    SELECT id, email FROM auth.users
    WHERE email IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  END IF;
END $$;

-- 2. Ensure public.documents exists with baseline schema
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled document',
  content_json JSONB NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create document_shares table
CREATE TABLE IF NOT EXISTS public.document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_shares_doc_user_unique UNIQUE (document_id, shared_with_user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON public.documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_document_id ON public.document_shares(document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_shared_with_user_id ON public.document_shares(shared_with_user_id);

-- Constraint preventing owner from being added as a share recipient
CREATE OR REPLACE FUNCTION public.check_share_not_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.documents WHERE id = NEW.document_id;
  IF v_owner_id = NEW.shared_with_user_id THEN
    RAISE EXCEPTION 'Document owner cannot be added as a share recipient.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_share_not_owner ON public.document_shares;
CREATE TRIGGER trg_check_share_not_owner
  BEFORE INSERT OR UPDATE ON public.document_shares
  FOR EACH ROW EXECUTE FUNCTION public.check_share_not_owner();

-- 4. Helper Security Definer Functions (prevents recursive RLS between documents & document_shares)
CREATE OR REPLACE FUNCTION public.is_document_owner(doc_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents
    WHERE id = doc_id AND owner_id = user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_document_access(doc_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.documents
      WHERE id = doc_id AND owner_id = user_id
    )
    OR
    EXISTS (
      SELECT 1 FROM public.document_shares
      WHERE document_id = doc_id AND shared_with_user_id = user_id
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_document(doc_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.documents
      WHERE id = doc_id AND owner_id = user_id
    )
    OR
    EXISTS (
      SELECT 1 FROM public.document_shares
      WHERE document_id = doc_id AND shared_with_user_id = user_id AND permission = 'editor'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_document_owner(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_document_access(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_document(UUID, UUID) TO authenticated, service_role;

-- 5. Row Level Security: public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles select policy" ON public.profiles;
CREATE POLICY "Profiles select policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles update policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- 6. Row Level Security: public.documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Drop legacy or previous policies if existing
DROP POLICY IF EXISTS "Users can read own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
DROP POLICY IF EXISTS "Documents select policy" ON public.documents;
DROP POLICY IF EXISTS "Documents insert policy" ON public.documents;
DROP POLICY IF EXISTS "Documents update policy" ON public.documents;
DROP POLICY IF EXISTS "Documents delete policy" ON public.documents;

-- SELECT: Owner can read; recipient can read if valid share exists
CREATE POLICY "Documents select policy"
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.has_document_access(id, (SELECT auth.uid()))
  );

-- INSERT: Authenticated user can only insert documents where owner_id matches their own auth.uid()
CREATE POLICY "Documents insert policy"
  ON public.documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
  );

-- UPDATE: Owner can update; editor recipient can update; viewer cannot update
CREATE POLICY "Documents update policy"
  ON public.documents
  FOR UPDATE
  TO authenticated
  USING (
    public.can_edit_document(id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.can_edit_document(id, (SELECT auth.uid()))
  );

-- DELETE: Only the owner can delete the document
CREATE POLICY "Documents delete policy"
  ON public.documents
  FOR DELETE
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
  );

-- 7. Row Level Security: public.document_shares
ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shares select policy" ON public.document_shares;
DROP POLICY IF EXISTS "Shares insert policy" ON public.document_shares;
DROP POLICY IF EXISTS "Shares update policy" ON public.document_shares;
DROP POLICY IF EXISTS "Shares delete policy" ON public.document_shares;

-- SELECT: Document owner can view shares; recipient can view their own share
CREATE POLICY "Shares select policy"
  ON public.document_shares
  FOR SELECT
  TO authenticated
  USING (
    shared_with_user_id = (SELECT auth.uid())
    OR public.is_document_owner(document_id, (SELECT auth.uid()))
  );

-- INSERT: Only document owner can create a share
CREATE POLICY "Shares insert policy"
  ON public.document_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_document_owner(document_id, (SELECT auth.uid()))
  );

-- UPDATE: Only document owner can update a share permission
CREATE POLICY "Shares update policy"
  ON public.document_shares
  FOR UPDATE
  TO authenticated
  USING (
    public.is_document_owner(document_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    public.is_document_owner(document_id, (SELECT auth.uid()))
  );

-- DELETE: Only document owner can revoke/delete a share
CREATE POLICY "Shares delete policy"
  ON public.document_shares
  FOR DELETE
  TO authenticated
  USING (
    public.is_document_owner(document_id, (SELECT auth.uid()))
  );
