"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Share2, Trash2, X, Shield, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { lookupRecipientByEmail } from "@/app/actions/share";

export type DocumentShareItem = {
  id: string;
  document_id: string;
  shared_with_user_id: string;
  permission: "viewer" | "editor";
  created_at: string;
  recipient_email?: string;
};

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  currentUserId: string;
}

export function ShareDialog({
  isOpen,
  onClose,
  documentId,
  documentTitle,
  currentUserId,
}: ShareDialogProps) {
  const supabase = useMemo(() => createClient(), []);

  const [shares, setShares] = useState<DocumentShareItem[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<"viewer" | "editor">("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [mutatingShareId, setMutatingShareId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const reloadShares = useCallback(async () => {
    try {
      const { data: sharesData, error: sharesError } = await supabase
        .from("document_shares")
        .select("id, document_id, shared_with_user_id, permission, created_at")
        .eq("document_id", documentId)
        .order("created_at", { ascending: true });

      if (sharesError) {
        setErrorMessage(`Failed to load shares: ${sharesError.message}`);
        return;
      }

      const rawShares = (sharesData ?? []) as DocumentShareItem[];
      if (rawShares.length === 0) {
        setShares([]);
        return;
      }

      const userIds = rawShares.map((s) => s.shared_with_user_id);
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);

      const emailMap = new Map<string, string>();
      if (profilesData) {
        for (const p of profilesData) {
          emailMap.set(p.id, p.email);
        }
      }

      const populatedShares = rawShares.map((share) => ({
        ...share,
        recipient_email: emailMap.get(share.shared_with_user_id) || "Shared user",
      }));

      setShares(populatedShares);
    } catch {
      setErrorMessage("An unexpected error occurred while reloading shares.");
    }
  }, [documentId, supabase]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function fetchShares() {
      setLoadingShares(true);
      setErrorMessage("");

      try {
        const { data: sharesData, error: sharesError } = await supabase
          .from("document_shares")
          .select("id, document_id, shared_with_user_id, permission, created_at")
          .eq("document_id", documentId)
          .order("created_at", { ascending: true });

        if (cancelled) return;

        if (sharesError) {
          setErrorMessage(`Failed to load shares: ${sharesError.message}`);
          setLoadingShares(false);
          return;
        }

        const rawShares = (sharesData ?? []) as DocumentShareItem[];

        if (rawShares.length === 0) {
          setShares([]);
          setLoadingShares(false);
          return;
        }

        const userIds = rawShares.map((s) => s.shared_with_user_id);
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);

        if (cancelled) return;

        const emailMap = new Map<string, string>();
        if (profilesData) {
          for (const p of profilesData) {
            emailMap.set(p.id, p.email);
          }
        }

        const populatedShares = rawShares.map((share) => ({
          ...share,
          recipient_email: emailMap.get(share.shared_with_user_id) || "Shared user",
        }));

        setShares(populatedShares);
      } catch {
        if (!cancelled) {
          setErrorMessage("An unexpected error occurred while loading shares.");
        }
      } finally {
        if (!cancelled) {
          setLoadingShares(false);
        }
      }
    }

    void fetchShares();

    return () => {
      cancelled = true;
    };
  }, [isOpen, documentId, supabase]);

  // Handle ESC key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleAddShare(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();

    if (!cleanEmail) {
      setErrorMessage("Please enter an email address to share with.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // 1. Look up recipient safely
      const lookupResult = await lookupRecipientByEmail(cleanEmail);

      if (!lookupResult.success) {
        setErrorMessage(lookupResult.error);
        setSubmitting(false);
        return;
      }

      const recipient = lookupResult.user;

      if (recipient.id === currentUserId) {
        setErrorMessage("You cannot share a document with yourself.");
        setSubmitting(false);
        return;
      }

      // 2. Check for duplicate share locally before hitting database
      const alreadyShared = shares.some(
        (s) => s.shared_with_user_id === recipient.id
      );

      if (alreadyShared) {
        setErrorMessage(`"${recipient.email}" already has access to this document.`);
        setSubmitting(false);
        return;
      }

      // 3. Insert into document_shares
      const { error: insertError } = await supabase
        .from("document_shares")
        .insert({
          document_id: documentId,
          shared_with_user_id: recipient.id,
          permission: selectedPermission,
        });

      if (insertError) {
        if (insertError.code === "23505") {
          setErrorMessage(`"${recipient.email}" already has access to this document.`);
        } else {
          setErrorMessage(`Share failed: ${insertError.message}`);
        }
        return;
      }

      setSuccessMessage(`Document shared with ${recipient.email} as ${selectedPermission}.`);
      setEmailInput("");
      await reloadShares();
    } catch {
      setErrorMessage("Failed to share document. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdatePermission(shareId: string, newPermission: "viewer" | "editor") {
    setMutatingShareId(shareId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { error } = await supabase
        .from("document_shares")
        .update({ permission: newPermission })
        .eq("id", shareId);

      if (error) {
        setErrorMessage(`Failed to update permission: ${error.message}`);
        return;
      }

      setShares((prev) =>
        prev.map((s) => (s.id === shareId ? { ...s, permission: newPermission } : s))
      );
      setSuccessMessage("Permission updated successfully.");
    } catch {
      setErrorMessage("Failed to update permission.");
    } finally {
      setMutatingShareId(null);
    }
  }

  async function handleRevokeAccess(shareId: string, recipientName: string) {
    if (!window.confirm(`Revoke access for ${recipientName}?`)) {
      return;
    }

    setMutatingShareId(shareId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { error } = await supabase
        .from("document_shares")
        .delete()
        .eq("id", shareId);

      if (error) {
        setErrorMessage(`Failed to revoke access: ${error.message}`);
        return;
      }

      setShares((prev) => prev.filter((s) => s.id !== shareId));
      setSuccessMessage(`Access revoked for ${recipientName}.`);
    } catch {
      setErrorMessage("Failed to revoke access.");
    } finally {
      setMutatingShareId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting && !mutatingShareId) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:border dark:border-zinc-800">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b pb-4 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <Share2 className="h-5 w-5 shrink-0 text-zinc-700 dark:text-zinc-300" />
              <h2
                id="share-dialog-title"
                className="truncate text-lg font-semibold"
              >
                Share &ldquo;{documentTitle || "Untitled document"}&rdquo;
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Manage who has access to view or edit this document.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting || mutatingShareId !== null}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Add Share Form */}
        <form onSubmit={handleAddShare} className="mt-5 space-y-3">
          <label
            htmlFor="recipient-email"
            className="block text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400"
          >
            Add collaborator by email
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="recipient-email"
              type="email"
              placeholder="user@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              disabled={submitting || mutatingShareId !== null}
              required
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />

            <div className="flex gap-2">
              <select
                value={selectedPermission}
                onChange={(e) =>
                  setSelectedPermission(e.target.value as "viewer" | "editor")
                }
                disabled={submitting || mutatingShareId !== null}
                aria-label="Permission level"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>

              <button
                type="submit"
                disabled={submitting || mutatingShareId !== null}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Sharing...</span>
                  </>
                ) : (
                  <span>Share</span>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Status Messages */}
        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
          >
            <UserCheck className="h-3.5 w-3.5 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Existing Shares List */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
            People with access
          </h3>

          <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-zinc-200 divide-y divide-zinc-200 dark:border-zinc-800 dark:divide-zinc-800">
            {/* Owner Row */}
            <div className="flex items-center justify-between p-3 text-sm">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  You
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    Owner
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Full control
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <Shield className="h-3 w-3" />
                Owner
              </span>
            </div>

            {/* Recipient Rows */}
            {loadingShares ? (
              <div className="flex items-center justify-center p-6 text-xs text-zinc-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading collaborators...
              </div>
            ) : shares.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                No users have access to this document yet. Add collaborators above to share.
              </div>
            ) : (
              shares.map((share) => {
                const isMutating = mutatingShareId === share.id;
                const recipientDisplay = share.recipient_email || share.shared_with_user_id;

                return (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        {recipientDisplay[0]?.toUpperCase() || "U"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {recipientDisplay}
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Shared {new Date(share.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={share.permission}
                        disabled={isMutating || submitting}
                        onChange={(e) =>
                          void handleUpdatePermission(
                            share.id,
                            e.target.value as "viewer" | "editor"
                          )
                        }
                        aria-label={`Permission for ${recipientDisplay}`}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>

                      <button
                        type="button"
                        disabled={isMutating || submitting}
                        onClick={() =>
                          void handleRevokeAccess(share.id, recipientDisplay)
                        }
                        title="Revoke access"
                        aria-label={`Revoke access for ${recipientDisplay}`}
                        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      >
                        {isMutating ? (
                          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || mutatingShareId !== null}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
