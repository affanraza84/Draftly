import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Database Migration & RLS Policy Schema Verification", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../supabase/migrations/20261021230000_document_sharing_and_access_control.sql"
  );

  it("migration file exists and is populated", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content.length).toBeGreaterThan(500);
  });

  const sqlContent = fs.readFileSync(migrationPath, "utf-8");

  it("defines document_shares table with required fields and constraints", () => {
    expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS public.document_shares");
    expect(sqlContent).toContain("document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE");
    expect(sqlContent).toContain("shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sqlContent).toContain("permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor'))");
    expect(sqlContent).toContain("CONSTRAINT document_shares_doc_user_unique UNIQUE (document_id, shared_with_user_id)");
  });

  it("includes trigger preventing document owner from sharing with self", () => {
    expect(sqlContent).toContain("FUNCTION public.check_share_not_owner()");
    expect(sqlContent).toContain("Document owner cannot be added as a share recipient");
    expect(sqlContent).toContain("TRIGGER trg_check_share_not_owner");
  });

  it("defines security definer helpers to avoid RLS recursion", () => {
    expect(sqlContent).toContain("FUNCTION public.is_document_owner");
    expect(sqlContent).toContain("FUNCTION public.has_document_access");
    expect(sqlContent).toContain("FUNCTION public.can_edit_document");
    expect(sqlContent).toContain("SECURITY DEFINER");
    expect(sqlContent).toContain("SET search_path = public");
  });

  it("enforces RLS on document_shares table", () => {
    expect(sqlContent).toContain("ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;");
    expect(sqlContent).toContain('"Shares select policy"');
    expect(sqlContent).toContain('"Shares insert policy"');
    expect(sqlContent).toContain('"Shares update policy"');
    expect(sqlContent).toContain('"Shares delete policy"');
  });

  it("enforces RLS on documents table with viewer vs editor access", () => {
    expect(sqlContent).toContain("ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;");
    expect(sqlContent).toContain('"Documents select policy"');
    expect(sqlContent).toContain('"Documents insert policy"');
    expect(sqlContent).toContain('"Documents update policy"');
    expect(sqlContent).toContain('"Documents delete policy"');

    // Only can_edit_document can update
    expect(sqlContent).toContain("public.can_edit_document(id, (SELECT auth.uid()))");
  });

  it("defines public.profiles table and trigger for recipient discovery", () => {
    expect(sqlContent).toContain("CREATE TABLE IF NOT EXISTS public.profiles");
    expect(sqlContent).toContain("FUNCTION public.handle_new_user()");
    expect(sqlContent).toContain("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;");
  });
});
