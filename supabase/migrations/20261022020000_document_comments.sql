-- Migration: Document Anchored Comments (Phase Stretch Feature 5)
-- Created At: 2026-10-22

-- 1. Create document_comments table
CREATE TABLE IF NOT EXISTS public.document_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  anchor_data JSONB NOT NULL DEFAULT '{"from":0,"to":0,"quote":""}',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient document comments queries
CREATE INDEX IF NOT EXISTS idx_document_comments_document_id ON public.document_comments(document_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_document_comments_author_id ON public.document_comments(author_id);

-- 2. Row Level Security: public.document_comments
ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments select policy" ON public.document_comments;
DROP POLICY IF EXISTS "Comments insert policy" ON public.document_comments;
DROP POLICY IF EXISTS "Comments update policy" ON public.document_comments;
DROP POLICY IF EXISTS "Comments delete policy" ON public.document_comments;

-- SELECT: Any user with document access (owner, editor, viewer) can read document comments
CREATE POLICY "Comments select policy"
  ON public.document_comments
  FOR SELECT
  TO authenticated
  USING (
    public.has_document_access(document_id, (SELECT auth.uid()))
  );

-- INSERT: Permitted collaborators with access to the document can comment
CREATE POLICY "Comments insert policy"
  ON public.document_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_document_access(document_id, (SELECT auth.uid()))
    AND author_id = (SELECT auth.uid())
  );

-- UPDATE: Comment author or document owner can update or resolve comments
CREATE POLICY "Comments update policy"
  ON public.document_comments
  FOR UPDATE
  TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    OR public.is_document_owner(document_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    OR public.is_document_owner(document_id, (SELECT auth.uid()))
  );

-- DELETE: Comment author or document owner can delete comments
CREATE POLICY "Comments delete policy"
  ON public.document_comments
  FOR DELETE
  TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    OR public.is_document_owner(document_id, (SELECT auth.uid()))
  );
