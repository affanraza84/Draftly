"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Edit3, Eye, Share2, Shield, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ShareDialog } from "@/components/ShareDialog";

type DocumentRecord = {
  id: string;
  owner_id: string;
  title: string;
  content_json: Record<string, unknown>;
};

type DocumentRole = "owner" | "editor" | "viewer";

function DocumentEditorContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const documentId = params.id;
  const supabase = useMemo(() => createClient(), []);

  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [role, setRole] = useState<DocumentRole | null>(null);
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  const canEdit = role === "owner" || role === "editor";

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    immediatelyRender: false,
    content: "",
    editable: true,
    onUpdate: () => {
      setDirty(true);
      setMessage("Unsaved changes");
    },
  });

  useEffect(() => {
    if (!editor || !documentId) return;

    let cancelled = false;

    async function loadDocument() {
      setMessage("Loading document...");

      // 1. Get current authenticated user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (userError || !user) {
        setMessage("You must be logged in to view this document.");
        return;
      }

      setCurrentUserId(user.id);

      // 2. Fetch the document (protected by RLS)
      const { data, error } = await supabase
        .from("documents")
        .select("id, owner_id, title, content_json")
        .eq("id", documentId)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setMessage(
          "Unable to load this document. You do not have permission or it does not exist."
        );
        return;
      }

      const doc = data as DocumentRecord;

      // 3. Determine user role
      if (doc.owner_id === user.id) {
        setRole("owner");
        editor?.setEditable(true);
      } else {
        // Query user's share permission
        const { data: shareData } = await supabase
          .from("document_shares")
          .select("permission")
          .eq("document_id", documentId)
          .eq("shared_with_user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (shareData?.permission === "editor") {
          setRole("editor");
          editor?.setEditable(true);
        } else if (shareData?.permission === "viewer") {
          setRole("viewer");
          editor?.setEditable(false);
        } else {
          setMessage("You do not have permission to view this document.");
          return;
        }
      }

      setTitle(doc.title);
      editor?.commands.setContent(doc.content_json);
      setDirty(false);
      setLoaded(true);
      setMessage("All changes saved");
    }

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [editor, documentId, supabase]);

  const saveDocument = useCallback(async () => {
    if (!editor || !loaded || saving || !canEdit) return;

    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setMessage("Document title cannot be empty.");
      return;
    }

    setSaving(true);
    setMessage("Saving...");

    try {
      const { error } = await supabase
        .from("documents")
        .update({
          title: cleanTitle,
          content_json: editor.getJSON(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (error) {
        // If RLS rejects or access was revoked
        if (error.code === "42501" || error.message.toLowerCase().includes("permission")) {
          setMessage("Save failed: You no longer have permission to edit this document.");
        } else {
          setMessage(`Save failed: ${error.message}`);
        }
        return;
      }

      setDirty(false);
      setMessage("All changes saved");
    } catch {
      setMessage("Save failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [canEdit, documentId, editor, loaded, saving, supabase, title]);

  const deleteDocument = useCallback(async () => {
    if (role !== "owner" || deleting) return;

    if (
      !window.confirm(
        "Are you sure you want to delete this document? This action cannot be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", documentId);

      if (error) {
        setMessage(`Delete failed: ${error.message}`);
        setDeleting(false);
        return;
      }

      router.push("/");
    } catch {
      setMessage("Delete failed. Check your connection and try again.");
      setDeleting(false);
    }
  }, [deleting, documentId, role, router, supabase]);

  if (!editor || !loaded) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <Link href="/" className="text-sm underline">
          ← Back to documents
        </Link>
        <p role="status" className="mt-6 text-sm text-gray-600">
          {message || "Initializing editor..."}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-600 hover:underline">
            ← All documents
          </Link>

          {/* Role Badge */}
          {role === "owner" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-800">
              <Shield className="h-3 w-3" />
              Owner
            </span>
          )}
          {role === "editor" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              <Edit3 className="h-3 w-3" />
              Editor
            </span>
          )}
          {role === "viewer" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              <Eye className="h-3 w-3" />
              Viewer (Read Only)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Share Button (Owner Only) */}
          {role === "owner" && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <Share2 className="h-4 w-4" />
              <span>Share</span>
            </button>
          )}

          {/* Delete Button (Owner Only) */}
          {role === "owner" && (
            <button
              type="button"
              onClick={() => void deleteDocument()}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              title="Delete document"
            >
              <Trash2 className="h-4 w-4" />
              <span>{deleting ? "Deleting..." : "Delete"}</span>
            </button>
          )}

          {/* Save Button (Owner or Editor) */}
          {canEdit ? (
            <button
              type="button"
              onClick={() => void saveDocument()}
              disabled={saving || !dirty}
              className="rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          ) : (
            <span className="text-xs text-zinc-400">
              Read-only mode
            </span>
          )}
        </div>
      </header>

      {/* Title Input */}
      <section className="mt-6">
        <label
          htmlFor="document-title"
          className="mb-2 block text-sm font-medium"
        >
          Document title
        </label>

        <input
          id="document-title"
          value={title}
          readOnly={!canEdit}
          disabled={!canEdit}
          onChange={(event) => {
            if (!canEdit) return;
            setTitle(event.target.value);
            setDirty(true);
            setMessage("Unsaved changes");
          }}
          maxLength={120}
          className={`w-full border-0 border-b bg-transparent py-3 text-3xl font-bold outline-none transition ${
            canEdit
              ? "focus:border-black"
              : "cursor-not-allowed text-zinc-600 border-zinc-200"
          }`}
        />
      </section>

      {/* Editor & Formatting */}
      <section className="mt-6 rounded-xl border">
        {canEdit && (
          <div
            role="toolbar"
            aria-label="Text formatting"
            className="flex flex-wrap gap-2 border-b p-3"
          >
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className="rounded border px-3 py-2 font-bold"
            >
              B
            </button>

            <button
              type="button"
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className="rounded border px-3 py-2 italic"
            >
              I
            </button>

            <button
              type="button"
              aria-label="Underline"
              aria-pressed={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className="rounded border px-3 py-2 underline"
            >
              U
            </button>

            <button
              type="button"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              className="rounded border px-3 py-2"
            >
              H1
            </button>

            <button
              type="button"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className="rounded border px-3 py-2"
            >
              H2
            </button>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className="rounded border px-3 py-2"
            >
              • List
            </button>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className="rounded border px-3 py-2"
            >
              1. List
            </button>
          </div>
        )}

        <EditorContent
          editor={editor}
          className="draftly-editor min-h-[400px] p-6"
        />
      </section>

      {/* Status Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-gray-500">
          {message}
        </p>

        {dirty && canEdit && (
          <span className="text-xs text-amber-700">
            Unsaved changes
          </span>
        )}
      </div>

      {/* Share Dialog */}
      {role === "owner" && (
        <ShareDialog
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          documentId={documentId}
          documentTitle={title}
          currentUserId={currentUserId}
        />
      )}
    </main>
  );
}

export default function DocumentEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl p-8">
          <p role="status" className="text-sm text-gray-600">
            Loading document...
          </p>
        </main>
      }
    >
      <DocumentEditorContent />
    </Suspense>
  );
}
