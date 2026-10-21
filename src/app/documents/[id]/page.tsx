
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { createClient } from "@/lib/supabase/client";

type DocumentRecord = {
  id: string;
  owner_id: string;
  title: string;
  content_json: Record<string, unknown>;
};

function DocumentEditorContent() {
  const params = useParams<{ id: string }>();
  const documentId = params.id;
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    immediatelyRender: false,
    content: "",
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

      const { data, error } = await supabase
        .from("documents")
        .select("id, owner_id, title, content_json")
        .eq("id", documentId)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setMessage("Unable to load this document. Check your access or return to the dashboard.");
        return;
      }

      const doc = data as DocumentRecord;

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
    if (!editor || !loaded || saving) return;

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
        setMessage(`Save failed: ${error.message}`);
        return;
      }

      setDirty(false);
      setMessage("All changes saved");
    } catch {
      setMessage("Save failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [documentId, editor, loaded, saving, supabase, title]);

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
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-gray-600 hover:underline">
          ← All documents
        </Link>

        <button
          onClick={() => void saveDocument()}
          disabled={saving || !dirty}
          className="rounded-lg bg-black px-5 py-2 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </header>

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
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
            setMessage("Unsaved changes");
          }}
          maxLength={120}
          className="w-full border-0 border-b bg-transparent py-3 text-3xl font-bold outline-none focus:border-black"
        />
      </section>

      <section className="mt-6 rounded-xl border">
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

        <EditorContent
          editor={editor}
          className="draftly-editor min-h-[400px] p-6"
        />
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-gray-500">
          {message}
        </p>

        {dirty && (
          <span className="text-xs text-amber-700">
            Unsaved changes
          </span>
        )}
      </div>
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
