"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  MessageSquare,
  Quote,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";
import { createClient } from "../lib/supabase/client";
import { getAvatarColor, getInitials } from "./CollaboratorPresence";

export type CommentRecord = {
  id: string;
  document_id: string;
  author_id: string;
  body: string;
  anchor_data: {
    from: number;
    to: number;
    quote: string;
  };
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  author_email?: string;
};

interface DocumentCommentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  currentUserId: string;
  isOwner: boolean;
  selectedTextQuote?: string;
  selectionRange?: { from: number; to: number };
  onClearSelection?: () => void;
}

export function DocumentCommentsDrawer({
  isOpen,
  onClose,
  documentId,
  currentUserId,
  isOwner,
  selectedTextQuote = "",
  selectionRange = { from: 0, to: 0 },
  onClearSelection,
}: DocumentCommentsDrawerProps) {
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newCommentBody, setNewCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // Fetch comments and synchronize authors
  useEffect(() => {
    if (!isOpen || !documentId) return;

    let ignore = false;

    async function fetchComments() {
      await Promise.resolve();
      if (ignore) return;
      setLoading(true);
      setError("");

      try {
        const { data, error: fetchErr } = await supabase
          .from("document_comments")
          .select("id, document_id, author_id, body, anchor_data, resolved_at, resolved_by, created_at, updated_at")
          .eq("document_id", documentId)
          .order("created_at", { ascending: true });

        if (ignore) return;

        if (fetchErr) {
          if (
            fetchErr.code === "42P01" ||
            fetchErr.code === "PGRST205" ||
            fetchErr.message.toLowerCase().includes("schema cache") ||
            fetchErr.message.toLowerCase().includes("document_comments") ||
            fetchErr.message.includes("does not exist")
          ) {
            setError(
              "Database migration required: The 'document_comments' table is missing from your Supabase database. Please run supabase/migrations/20261022020000_document_comments.sql in your Supabase SQL Editor."
            );
          } else {
            setError(`Failed to load comments: ${fetchErr.message}`);
          }
          setComments([]);
          return;
        }

        const commentList = (data || []) as CommentRecord[];

        // Lookup profile emails
        const authorIds = Array.from(new Set(commentList.map((c) => c.author_id).filter(Boolean)));
        if (authorIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email")
            .in("id", authorIds);

          if (profiles && !ignore) {
            const profileMap = new Map(profiles.map((p) => [p.id, p.email]));
            commentList.forEach((c) => {
              c.author_email = profileMap.get(c.author_id) || "Collaborator";
            });
          }
        }

        if (!ignore) {
          setComments(commentList);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error loading comments");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void fetchComments();

    // Real-time synchronization for comments
    const channel = supabase
      .channel(`doc-comments-live-${documentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_comments",
          filter: `document_id=eq.${documentId}`,
        },
        () => {
          void fetchComments();
        }
      )
      .subscribe();

    return () => {
      ignore = true;
      void supabase.removeChannel(channel);
    };
  }, [isOpen, documentId, supabase]);

  // Handle new comment submission
  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newCommentBody.trim() || submitting || !currentUserId) return;

    setSubmitting(true);
    setError("");

    try {
      const anchor = {
        from: selectionRange.from,
        to: selectionRange.to,
        quote: selectedTextQuote.trim(),
      };

      const { data, error: insertErr } = await supabase
        .from("document_comments")
        .insert({
          document_id: documentId,
          author_id: currentUserId,
          body: newCommentBody.trim(),
          anchor_data: anchor,
        })
        .select("id, document_id, author_id, body, anchor_data, resolved_at, resolved_by, created_at, updated_at")
        .single();

      if (insertErr) {
        if (
          insertErr.code === "42P01" ||
          insertErr.code === "PGRST205" ||
          insertErr.message.toLowerCase().includes("schema cache") ||
          insertErr.message.toLowerCase().includes("document_comments") ||
          insertErr.message.includes("does not exist")
        ) {
          setError(
            "Database migration required: The 'document_comments' table is missing from your Supabase database. Please run supabase/migrations/20261022020000_document_comments.sql in your Supabase SQL Editor."
          );
        } else {
          setError(`Failed to post comment: ${insertErr.message}`);
        }
        return;
      }

      setNewCommentBody("");
      if (onClearSelection) onClearSelection();

      // Add to local state
      const created = data as CommentRecord;
      setComments((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }

  // Toggle resolve status
  async function handleToggleResolve(comment: CommentRecord) {
    const isResolved = Boolean(comment.resolved_at);
    const newResolvedAt = isResolved ? null : new Date().toISOString();
    const newResolvedBy = isResolved ? null : currentUserId;

    try {
      const { error: updateErr } = await supabase
        .from("document_comments")
        .update({
          resolved_at: newResolvedAt,
          resolved_by: newResolvedBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", comment.id);

      if (updateErr) {
        setError(`Failed to update comment: ${updateErr.message}`);
        return;
      }

      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, resolved_at: newResolvedAt, resolved_by: newResolvedBy }
            : c
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating comment");
    }
  }

  // Delete comment
  async function handleDeleteComment(commentId: string) {
    if (!window.confirm("Are you sure you want to delete this comment?")) return;

    try {
      const { error: delErr } = await supabase
        .from("document_comments")
        .delete()
        .eq("id", commentId);

      if (delErr) {
        setError(`Failed to delete comment: ${delErr.message}`);
        return;
      }

      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error deleting comment");
    }
  }

  if (!isOpen) return null;

  const filteredComments = comments.filter((c) => (showResolved ? true : !c.resolved_at));
  const activeCount = comments.filter((c) => !c.resolved_at).length;

  return (
    <aside
      role="complementary"
      aria-label="Document Comments"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[380px] bg-white border-l border-[#E5E5E5] shadow-xl flex flex-col transition"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#E5E5E5]">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#5754D6]" />
          <h2 className="text-sm font-semibold text-[#171717]">Comments</h2>
          <span className="rounded-full bg-[#FAFAF8] border border-[#E5E5E5] px-2 py-0.5 text-[11px] font-medium text-[#737373]">
            {activeCount}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className={`text-[11px] px-2 py-1 rounded-md transition cursor-pointer ${
              showResolved
                ? "bg-[#5754D6]/10 text-[#5754D6] font-medium"
                : "text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8]"
            }`}
          >
            {showResolved ? "All" : "Active only"}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments panel"
            className="p-1 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="m-4 rounded-lg border border-red-200 bg-[#FEF2F2] p-2.5 text-xs text-[#B91C1C] flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && comments.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#737373]">Loading comments...</div>
        ) : filteredComments.length === 0 ? (
          <div className="py-12 text-center text-[#737373] space-y-1">
            <MessageSquare className="mx-auto h-7 w-7 text-[#D4D4D4] mb-2" />
            <p className="text-xs font-medium text-[#171717]">No comments yet</p>
            <p className="text-[11px] text-[#737373]">
              Highlight text in the editor to leave an anchored comment.
            </p>
          </div>
        ) : (
          filteredComments.map((comment) => {
            const isResolved = Boolean(comment.resolved_at);
            const canDelete = isOwner || comment.author_id === currentUserId;
            const canResolve = isOwner || comment.author_id === currentUserId;
            const initials = getInitials(comment.author_email || comment.author_id);
            const avatarColor = getAvatarColor(comment.author_id);

            return (
              <div
                key={comment.id}
                className={`rounded-xl border p-3 transition space-y-2 ${
                  isResolved
                    ? "border-[#E5E5E5] bg-[#FAFAF8] opacity-75"
                    : "border-[#E5E5E5] bg-white shadow-2xs hover:border-[#D4D4D4]"
                }`}
              >
                {/* Author row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${avatarColor}`}
                    >
                      {initials}
                    </div>
                    <span className="text-xs font-medium text-[#171717] truncate">
                      {comment.author_email || "Collaborator"}
                    </span>
                  </div>

                  <span className="text-[10px] text-[#737373] shrink-0">
                    {new Date(comment.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Anchored Quote Pill if text was selected */}
                {comment.anchor_data?.quote && (
                  <div className="rounded-md bg-[#FAFAF8] border border-[#E5E5E5] px-2 py-1 text-[11px] text-[#525252] flex items-start gap-1.5 italic">
                    <Quote className="h-3 w-3 text-[#5754D6] shrink-0 mt-0.5" />
                    <span className="line-clamp-2">&ldquo;{comment.anchor_data.quote}&rdquo;</span>
                  </div>
                )}

                {/* Comment Body */}
                <p className="text-xs text-[#171717] whitespace-pre-wrap leading-relaxed">
                  {comment.body}
                </p>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-1 border-t border-[#F0F0EE] text-[11px]">
                  {canResolve && (
                    <button
                      type="button"
                      onClick={() => void handleToggleResolve(comment)}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition cursor-pointer ${
                        isResolved
                          ? "text-[#5754D6] hover:bg-[#5754D6]/10"
                          : "text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8]"
                      }`}
                      title={isResolved ? "Reopen comment" : "Resolve comment"}
                    >
                      {isResolved ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-[#5754D6]" />
                          <span>Resolved</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Resolve</span>
                        </>
                      )}
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteComment(comment.id)}
                      className="text-[#737373] hover:text-[#B91C1C] p-1 rounded hover:bg-[#FEF2F2] transition cursor-pointer ml-auto"
                      title="Delete comment"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Comment Input Box */}
      <form onSubmit={handleSubmitComment} className="p-4 border-t border-[#E5E5E5] bg-[#FAFAF8]">
        {/* Selected anchor banner */}
        {selectedTextQuote ? (
          <div className="mb-2 flex items-center justify-between gap-1 rounded-md bg-white border border-[#E5E5E5] p-2 text-[11px] text-[#171717]">
            <div className="flex items-center gap-1.5 min-w-0">
              <Quote className="h-3 w-3 text-[#5754D6] shrink-0" />
              <span className="truncate italic">&ldquo;{selectedTextQuote}&rdquo;</span>
            </div>
            {onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                className="text-[#737373] hover:text-[#171717] cursor-pointer"
                title="Remove anchor"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          <div className="mb-2 text-[11px] text-[#737373] flex items-center gap-1">
            <User className="h-3 w-3" />
            <span>Document-level comment (or select text to anchor)</span>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={newCommentBody}
            onChange={(e) => setNewCommentBody(e.target.value)}
            placeholder="Add a comment or feedback..."
            rows={2}
            className="flex-1 rounded-lg border border-[#E5E5E5] bg-white p-2 text-xs text-[#171717] placeholder-[#A3A3A3] focus:border-[#5754D6] focus:outline-none transition resize-none"
          />

          <button
            type="submit"
            disabled={!newCommentBody.trim() || submitting}
            className="self-end rounded-lg bg-[#5754D6] p-2 text-white hover:bg-[#4845C4] transition shadow-xs disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            title="Post comment"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
