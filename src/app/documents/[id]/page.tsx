"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  Check,
  ChevronLeft,
  Download,
  Edit3,
  Eye,
  History,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MessageSquare,
  Redo,
  Save,
  Share2,
  Shield,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ShareDialog } from "@/components/ShareDialog";
import { VersionHistoryModal } from "@/components/VersionHistoryModal";
import { CollaboratorPresence } from "@/components/CollaboratorPresence";
import { DocumentCommentsDrawer } from "@/components/DocumentCommentsDrawer";
import {
  convertTiptapToMarkdown,
  sanitizeMarkdownFilename,
  triggerMarkdownDownload,
} from "@/lib/document-export";

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
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");
  const [role, setRole] = useState<DocumentRole | null>(null);
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selectedTextQuote, setSelectedTextQuote] = useState("");
  const [selectionRange, setSelectionRange] = useState({ from: 0, to: 0 });

  const canEdit = role === "owner" || role === "editor";

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    immediatelyRender: false,
    content: "",
    editable: true,
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to, " ");
        if (text.trim()) {
          setSelectedTextQuote(text.slice(0, 150));
          setSelectionRange({ from, to });
        }
      }
    },
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
      setCurrentUserEmail(user.email || "");

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

      if (doc.owner_id === user.id) {
        setRole("owner");
        editor?.setEditable(true);
      } else {
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

  // Real-time permission sync: handles live permission changes or revocation while document is open
  useEffect(() => {
    if (!documentId || !currentUserId || role === "owner") return;

    const channel = supabase
      .channel(`doc-shares-live-${documentId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_shares",
          filter: `document_id=eq.${documentId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { shared_with_user_id?: string; id?: string };
            if (!oldRow.shared_with_user_id || oldRow.shared_with_user_id === currentUserId) {
              setRole(null);
              editor?.setEditable(false);
              setMessage("Your access to this document has been revoked by the owner.");
            }
          } else if (payload.eventType === "UPDATE") {
            const newRow = payload.new as {
              shared_with_user_id: string;
              permission: "viewer" | "editor";
            };
            if (newRow.shared_with_user_id === currentUserId) {
              if (newRow.permission === "editor") {
                setRole("editor");
                editor?.setEditable(true);
                setMessage("Your permissions have been upgraded to Editor.");
              } else if (newRow.permission === "viewer") {
                setRole("viewer");
                editor?.setEditable(false);
                setMessage("Your permissions have been changed to View Only.");
              }
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "documents",
          filter: `id=eq.${documentId}`,
        },
        () => {
          setRole(null);
          editor?.setEditable(false);
          setMessage("This document was deleted by the owner.");
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, documentId, editor, role, supabase]);

  const saveDocument = useCallback(async () => {
    if (!editor || !loaded || saving || !canEdit) return;

    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setMessage("Document title cannot be empty.");
      return;
    }

    const normalizedTitle = cleanTitle.slice(0, 120);

    setSaving(true);
    setMessage("Saving...");

    try {
      const { data: updatedRows, error } = await supabase
        .from("documents")
        .update({
          title: normalizedTitle,
          content_json: editor.getJSON(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .select("id");

      if (error) {
        if (
          error.code === "42501" ||
          error.message.toLowerCase().includes("permission")
        ) {
          setMessage("Save failed: You no longer have permission to edit this document.");
        } else {
          setMessage(`Save failed: ${error.message}`);
        }
        return;
      }

      if (!updatedRows || updatedRows.length === 0) {
        setMessage(
          "Save failed: You no longer have permission to edit this document or it was deleted."
        );
        return;
      }

      setDirty(false);
      setMessage("All changes saved");

      // Record a document version snapshot (non-blocking)
      try {
        const { error: rpcError } = await supabase.rpc(
          "create_document_version_snapshot",
          {
            p_document_id: documentId,
            p_title: normalizedTitle,
            p_content_json: editor.getJSON(),
            p_summary: "Manual save",
          }
        );

        if (rpcError) {
          const { count } = await supabase
            .from("document_versions")
            .select("id", { count: "exact", head: true })
            .eq("document_id", documentId);

          const nextVer = (count ?? 0) + 1;
          await supabase.from("document_versions").insert({
            document_id: documentId,
            version_number: nextVer,
            title: normalizedTitle,
            content_json: editor.getJSON(),
            change_summary: "Manual save",
            created_by: currentUserId,
          });
        }
      } catch {
        // Non-blocking: document update already succeeded
      }
    } catch {
      setMessage("Save failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [canEdit, currentUserId, documentId, editor, loaded, saving, supabase, title]);

  const handleRestoreVersion = useCallback(
    async (
      versionNumber: number,
      targetTitle: string,
      targetContent: Record<string, unknown>
    ): Promise<boolean> => {
      if (role !== "owner" || !editor) return false;

      try {
        // 1. Try atomic database restore RPC
        const { error: rpcError } = await supabase.rpc("restore_document_version", {
          p_document_id: documentId,
          p_version_number: versionNumber,
        });

        if (rpcError) {
          // Fallback to direct update & snapshot insert
          const { error: updateError } = await supabase
            .from("documents")
            .update({
              title: targetTitle,
              content_json: targetContent,
              updated_at: new Date().toISOString(),
            })
            .eq("id", documentId);

          if (updateError) return false;

          const { count } = await supabase
            .from("document_versions")
            .select("id", { count: "exact", head: true })
            .eq("document_id", documentId);

          await supabase.from("document_versions").insert({
            document_id: documentId,
            version_number: (count ?? 0) + 1,
            title: targetTitle,
            content_json: targetContent,
            change_summary: `Restored from version ${versionNumber}`,
            created_by: currentUserId,
          });
        }

        // 2. Synchronize local editor state
        setTitle(targetTitle);
        editor.commands.setContent(targetContent);
        setDirty(false);
        setMessage(`Restored from version ${versionNumber}`);
        return true;
      } catch {
        return false;
      }
    },
    [currentUserId, documentId, editor, role, supabase]
  );

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

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

  const handleExportMarkdown = useCallback(() => {
    if (!editor || !loaded) return;

    try {
      // Export current editor state so unsaved changes are preserved
      const currentJson = editor.getJSON();
      const markdown = convertTiptapToMarkdown(currentJson);
      const filename = sanitizeMarkdownFilename(title);
      triggerMarkdownDownload(markdown, filename);
      setMessage("Document exported as Markdown (.md)");
    } catch (err) {
      setMessage(
        `Export failed: ${err instanceof Error ? err.message : "Unable to generate file"}`
      );
    }
  }, [editor, loaded, title]);

  if (!editor || !loaded) {
    return (
      <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl bg-white border border-[#E5E5E5] p-8 text-center shadow-xs">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#5754D6]" />
          <h2 className="mt-4 text-base font-semibold text-[#171717]">Opening Document</h2>
          <p role="status" className="mt-1 text-xs text-[#737373]">
            {message || "Retrieving content and permissions..."}
          </p>
          <div className="mt-6 pt-4 border-t border-[#E5E5E5]">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#737373] hover:text-[#171717]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Documents</span>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col text-[#171717]">
      {/* Sticky Header Navigation */}
      <header className="sticky top-0 z-30 border-b border-[#E5E5E5] bg-white/95 backdrop-blur-xs px-4 sm:px-6 py-2.5 transition">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Back Link & Role */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-1 text-xs font-medium text-[#737373] hover:text-[#171717] px-2 py-1 rounded-md hover:bg-[#FAFAF8] transition shrink-0 cursor-pointer"
              title="Return to Workspace"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Workspace</span>
            </Link>

            <span className="h-3.5 w-[1px] bg-[#E5E5E5] hidden sm:block shrink-0" />

            {/* Role Badge */}
            {role === "owner" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FAFAF8] border border-[#E5E5E5] px-2 py-0.5 text-[11px] font-medium text-[#171717] shrink-0">
                <Shield className="h-3 w-3 text-[#5754D6]" />
                Owner
              </span>
            )}
            {role === "editor" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8] shrink-0">
                <Edit3 className="h-3 w-3" />
                Editor
              </span>
            )}
            {role === "viewer" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[11px] font-medium text-[#B45309] shrink-0">
                <Eye className="h-3 w-3" />
                View Only
              </span>
            )}

            {/* Save Status Badge */}
            <div className="flex items-center gap-1.5 text-xs text-[#737373] shrink-0 pl-1">
              {saving ? (
                <span className="flex items-center gap-1 text-xs text-[#5754D6]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="hidden sm:inline">Saving...</span>
                </span>
              ) : dirty && canEdit ? (
                <span className="flex items-center gap-1 text-xs text-[#B45309]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#D97706]" />
                  <span className="hidden sm:inline">Unsaved changes</span>
                </span>
              ) : message.includes("failed") ? (
                <span className="flex items-center gap-1 text-xs text-[#B91C1C]">
                  <AlertCircle className="h-3 w-3" />
                  <span className="hidden sm:inline">Save failed</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[#15803d]">
                  <Check className="h-3 w-3" />
                  <span className="hidden sm:inline">Saved</span>
                </span>
              )}
            </div>

            {/* Real-Time Collaborator Presence */}
            <CollaboratorPresence
              documentId={documentId}
              currentUserId={currentUserId}
              currentUserEmail={currentUserEmail}
              userRole={role}
              hasAccess={loaded && role !== null}
            />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="flex items-center gap-1.5 rounded-lg border border-[#E5E5E5] bg-white px-3 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] shadow-xs transition cursor-pointer"
              title="Export current document content to Markdown (.md)"
            >
              <Download className="h-3.5 w-3.5 text-[#5754D6]" />
              <span className="hidden sm:inline">Export</span>
            </button>

            <button
              type="button"
              onClick={() => setVersionHistoryOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[#E5E5E5] bg-white px-3 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] shadow-xs transition cursor-pointer"
              title="Inspect past snapshots and version history"
            >
              <History className="h-3.5 w-3.5 text-[#5754D6]" />
              <span className="hidden sm:inline">History</span>
            </button>

            <button
              type="button"
              onClick={() => setCommentsOpen(!commentsOpen)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer shadow-xs ${
                commentsOpen
                  ? "border-[#5754D6] bg-[#5754D6]/10 text-[#5754D6]"
                  : "border-[#E5E5E5] bg-white text-[#171717] hover:bg-[#FAFAF8]"
              }`}
              title="Open document comments"
            >
              <MessageSquare className="h-3.5 w-3.5 text-[#5754D6]" />
              <span className="hidden sm:inline">Comments</span>
            </button>

            {role === "owner" && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#E5E5E5] bg-white px-3 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] shadow-xs transition cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5 text-[#5754D6]" />
                <span>Share</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => void saveDocument()}
                disabled={saving || !dirty}
                className="flex items-center gap-1.5 rounded-lg bg-[#5754D6] px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-[#4845C4] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Saving..." : "Save"}</span>
              </button>
            )}

            {role === "owner" && (
              <button
                type="button"
                onClick={() => void deleteDocument()}
                disabled={deleting}
                className="p-1.5 rounded-lg border border-[#E5E5E5] text-[#737373] hover:text-[#B91C1C] hover:bg-[#FEF2F2] hover:border-red-200 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                title="Delete document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Formatting Toolbar */}
      {canEdit && (
        <div className="sticky top-[49px] z-20 border-b border-[#E5E5E5] bg-[#FAFAF8] px-4 py-1.5">
          <div
            role="toolbar"
            aria-label="Text formatting"
            className="max-w-4xl mx-auto flex items-center justify-center gap-1 flex-wrap text-xs text-[#171717]"
          >
            {/* Inline Formatting */}
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                editor.isActive("bold")
                  ? "bg-[#5754D6]/10 text-[#5754D6] font-bold"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Bold (Ctrl+B)"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                editor.isActive("italic")
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Italic (Ctrl+I)"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              aria-label="Underline"
              aria-pressed={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                editor.isActive("underline")
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Underline (Ctrl+U)"
            >
              <UnderlineIcon className="h-3.5 w-3.5" />
            </button>

            <span className="h-4 w-[1px] bg-[#E5E5E5] mx-1" />

            {/* Headings */}
            <button
              type="button"
              aria-label="Heading 1"
              aria-pressed={editor.isActive("heading", { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                editor.isActive("heading", { level: 1 })
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Heading 1"
            >
              H1
            </button>

            <button
              type="button"
              aria-label="Heading 2"
              aria-pressed={editor.isActive("heading", { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                editor.isActive("heading", { level: 2 })
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Heading 2"
            >
              H2
            </button>

            <button
              type="button"
              aria-label="Heading 3"
              aria-pressed={editor.isActive("heading", { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                editor.isActive("heading", { level: 3 })
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Heading 3"
            >
              H3
            </button>

            <span className="h-4 w-[1px] bg-[#E5E5E5] mx-1" />

            {/* Lists */}
            <button
              type="button"
              aria-label="Bullet list"
              aria-pressed={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                editor.isActive("bulletList")
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Bulleted List"
            >
              <List className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              aria-label="Ordered list"
              aria-pressed={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-1.5 rounded-md transition cursor-pointer ${
                editor.isActive("orderedList")
                  ? "bg-[#5754D6]/10 text-[#5754D6]"
                  : "hover:bg-white text-[#737373] hover:text-[#171717]"
              }`}
              title="Numbered List"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </button>

            <span className="h-4 w-[1px] bg-[#E5E5E5] mx-1" />

            {/* Undo / Redo */}
            <button
              type="button"
              aria-label="Undo"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
              className="p-1.5 rounded-md text-[#737373] hover:text-[#171717] hover:bg-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              title="Undo"
            >
              <Undo className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              aria-label="Redo"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
              className="p-1.5 rounded-md text-[#737373] hover:text-[#171717] hover:bg-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              title="Redo"
            >
              <Redo className="h-3.5 w-3.5" />
            </button>

            <span className="h-4 w-[1px] bg-[#E5E5E5] mx-1" />

            <button
              type="button"
              aria-label="Comment on selection"
              onClick={() => setCommentsOpen(true)}
              className="p-1.5 rounded-md text-[#737373] hover:text-[#5754D6] hover:bg-white transition cursor-pointer"
              title="Add comment on selected text"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Centered Writing Surface */}
      <main className="flex-1 max-w-[840px] w-full mx-auto px-4 py-8 sm:py-12">
        <div className="bg-white rounded-2xl border border-[#E5E5E5] p-6 sm:p-14 lg:p-16 shadow-xs min-h-[750px]">
          {/* Read-Only or Revoked Banner */}
          {role === "viewer" && (
            <div className="mb-6 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] p-3 text-xs text-[#B45309] flex items-center gap-2">
              <Eye className="h-4 w-4 shrink-0" />
              <span>You have view-only access to this document. Editing is disabled.</span>
            </div>
          )}
          {role === null && loaded && (
            <div className="mb-6 rounded-lg bg-[#FEF2F2] border border-red-200 p-3 text-xs text-[#B91C1C] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Your access to this document has been revoked. Editing is disabled.</span>
            </div>
          )}

          {/* Document Title Input */}
          <div className="mb-6">
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
              placeholder="Untitled Document"
              aria-label="Document Title"
              className={`w-full text-2xl sm:text-4xl font-bold tracking-tight text-[#171717] bg-transparent outline-none border-b transition pb-2 ${
                canEdit
                  ? "border-transparent focus:border-[#E5E5E5] hover:border-[#F0F0EE]"
                  : "border-transparent cursor-not-allowed opacity-90"
              }`}
            />
          </div>

          {/* Tiptap Editor Canvas */}
          <EditorContent
            editor={editor}
            className="draftly-editor focus:outline-none"
          />
        </div>

        {/* Bottom Error / Message Banner */}
        {message && message !== "All changes saved" && message !== "Unsaved changes" && (
          <div
            role="status"
            className="mt-4 rounded-lg border border-red-200 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
          >
            {message}
          </div>
        )}
      </main>

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

      {/* Version History Dialog */}
      <VersionHistoryModal
        isOpen={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        documentId={documentId}
        isOwner={role === "owner"}
        onRestore={handleRestoreVersion}
      />

      {/* Document Comments Drawer */}
      <DocumentCommentsDrawer
        isOpen={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        documentId={documentId}
        currentUserId={currentUserId}
        isOwner={role === "owner"}
        selectedTextQuote={selectedTextQuote}
        selectionRange={selectionRange}
        onClearSelection={() => {
          setSelectedTextQuote("");
          setSelectionRange({ from: 0, to: 0 });
        }}
      />
    </div>
  );
}

export default function DocumentEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-8">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E5E5E5] p-8 text-center shadow-xs">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#5754D6]" />
            <p role="status" className="mt-3 text-xs text-[#737373]">
              Loading document...
            </p>
          </div>
        </main>
      }
    >
      <DocumentEditorContent />
    </Suspense>
  );
}
