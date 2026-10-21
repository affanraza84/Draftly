-- Migration: Document Version History (Phase Stretch Feature 3)
-- Created At: 2026-10-22

-- 1. Create document_versions table
CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_json JSONB NOT NULL,
  change_summary TEXT DEFAULT 'Manual save',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_doc_ver_unique UNIQUE (document_id, version_number)
);

-- Indexes for efficient ordering and lookup
CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON public.document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_created_by ON public.document_versions(created_by);

-- 2. Helper function to atomically record a new document version snapshot
CREATE OR REPLACE FUNCTION public.create_document_version_snapshot(
  p_document_id UUID,
  p_title TEXT,
  p_content_json JSONB,
  p_summary TEXT DEFAULT 'Manual save'
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  version_number INTEGER,
  title TEXT,
  change_summary TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_next_version INTEGER;
  v_last_content JSONB;
  v_last_title TEXT;
  v_new_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create a document version snapshot.';
  END IF;

  -- Verify update permissions on the document
  IF NOT public.can_edit_document(p_document_id, v_user_id) THEN
    RAISE EXCEPTION '42501: Insufficient privileges to create version snapshots for this document.';
  END IF;

  -- Check the latest version to prevent duplicate sequential snapshots with identical content & title
  SELECT dv.content_json, dv.title INTO v_last_content, v_last_title
  FROM public.document_versions dv
  WHERE dv.document_id = p_document_id
  ORDER BY dv.version_number DESC
  LIMIT 1;

  IF v_last_content IS NOT NULL AND v_last_title = p_title AND v_last_content = p_content_json THEN
    -- Identical to latest version snapshot; skip duplicate creation and return latest
    RETURN QUERY
    SELECT dv.id, dv.document_id, dv.version_number, dv.title, dv.change_summary, dv.created_by, dv.created_at
    FROM public.document_versions dv
    WHERE dv.document_id = p_document_id
    ORDER BY dv.version_number DESC
    LIMIT 1;
    RETURN;
  END IF;

  -- Compute next version number atomically
  SELECT COALESCE(MAX(dv.version_number), 0) + 1 INTO v_next_version
  FROM public.document_versions dv
  WHERE dv.document_id = p_document_id;

  INSERT INTO public.document_versions (
    document_id,
    version_number,
    title,
    content_json,
    change_summary,
    created_by,
    created_at
  )
  VALUES (
    p_document_id,
    v_next_version,
    p_title,
    p_content_json,
    COALESCE(p_summary, 'Manual save'),
    v_user_id,
    now()
  )
  RETURNING public.document_versions.id, public.document_versions.created_at
  INTO v_new_id, v_created_at;

  RETURN QUERY
  SELECT v_new_id, p_document_id, v_next_version, p_title, COALESCE(p_summary, 'Manual save'), v_user_id, v_created_at;
END;
$$;

-- 3. Helper function to atomically restore a historical version (Owner Only)
CREATE OR REPLACE FUNCTION public.restore_document_version(
  p_document_id UUID,
  p_version_number INTEGER
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  restored_version_number INTEGER,
  new_version_number INTEGER,
  title TEXT,
  content_json JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_target_title TEXT;
  v_target_content JSONB;
  v_next_version INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to restore a document version.';
  END IF;

  -- Only document owner can restore historical versions
  IF NOT public.is_document_owner(p_document_id, v_user_id) THEN
    RAISE EXCEPTION '42501: Only the document owner is authorized to restore historical versions.';
  END IF;

  -- Retrieve target version
  SELECT dv.title, dv.content_json
  INTO v_target_title, v_target_content
  FROM public.document_versions dv
  WHERE dv.document_id = p_document_id AND dv.version_number = p_version_number;

  IF v_target_title IS NULL THEN
    RAISE EXCEPTION 'Historical version % not found for this document.', p_version_number;
  END IF;

  -- 1. Apply target content & title to the live document
  UPDATE public.documents
  SET title = v_target_title,
      content_json = v_target_content,
      updated_at = now()
  WHERE public.documents.id = p_document_id;

  -- 2. Create a new audit trail snapshot representing the restoration
  SELECT COALESCE(MAX(dv.version_number), 0) + 1 INTO v_next_version
  FROM public.document_versions dv
  WHERE dv.document_id = p_document_id;

  INSERT INTO public.document_versions (
    document_id,
    version_number,
    title,
    content_json,
    change_summary,
    created_by,
    created_at
  )
  VALUES (
    p_document_id,
    v_next_version,
    v_target_title,
    v_target_content,
    'Restored from version ' || p_version_number,
    v_user_id,
    now()
  );

  RETURN QUERY
  SELECT p_document_id, p_document_id, p_version_number, v_next_version, v_target_title, v_target_content;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_document_version_snapshot(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_document_version(UUID, INTEGER) TO authenticated, service_role;

-- 4. Row Level Security: public.document_versions
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Versions select policy" ON public.document_versions;
DROP POLICY IF EXISTS "Versions insert policy" ON public.document_versions;
DROP POLICY IF EXISTS "Versions update policy" ON public.document_versions;
DROP POLICY IF EXISTS "Versions delete policy" ON public.document_versions;

-- SELECT: Any user with document access (owner, editor, or viewer) can view version history
CREATE POLICY "Versions select policy"
  ON public.document_versions
  FOR SELECT
  TO authenticated
  USING (
    public.has_document_access(document_id, (SELECT auth.uid()))
  );

-- INSERT: Only users with edit rights can insert snapshots, and created_by must match their auth.uid()
CREATE POLICY "Versions insert policy"
  ON public.document_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_edit_document(document_id, (SELECT auth.uid()))
    AND created_by = (SELECT auth.uid())
  );

-- UPDATE: Versions are immutable historical records; direct updates are disallowed
CREATE POLICY "Versions update policy"
  ON public.document_versions
  FOR UPDATE
  TO authenticated
  USING (false);

-- DELETE: Only document owner can delete version history (or cascaded upon document deletion)
CREATE POLICY "Versions delete policy"
  ON public.document_versions
  FOR DELETE
  TO authenticated
  USING (
    public.is_document_owner(document_id, (SELECT auth.uid()))
  );
