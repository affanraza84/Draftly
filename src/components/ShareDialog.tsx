"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Share2,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { lookupRecipientByEmail } from "@/app/actions/share";

type ShareDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  currentUserId: string;
};

type DocumentShareItem = {
  id: string;
  document_id: string;
  shared_with_user_id: string;
  permission: "viewer" | "editor";
  created_at: string;
  recipient_email?: string;
};

export function ShareDialog({
  isOpen,
  onClose,
  documentId,
  documentTitle,
  currentUserId,
}: ShareDialogProps) {
  const supabase = createClient();

  const [emailInput, setEmailInput] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<"viewer" | "editor">("viewer");
  const [shares, setShares] = useState<DocumentShareItem[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
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
        if (
          sharesError.code === "PGRST205" ||
          sharesError.message.toLowerCase().includes("schema cache") ||
          sharesError.message.toLowerCase().includes("document_shares")
        ) {
          setErrorMessage(
            "Database migration required: The 'document_shares' table is missing from your Supabase database. Please run the SQL migration (supabase/migrations/20261021230000_document_sharing_and_access_control.sql) in your Supabase SQL Editor."
          );
        } else {
          setErrorMessage(`Failed to load shares: ${sharesError.message}`);
        }
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
          if (
            sharesError.code === "PGRST205" ||
            sharesError.message.toLowerCase().includes("schema cache") ||
            sharesError.message.toLowerCase().includes("document_shares")
          ) {
            setErrorMessage(
              "Database migration required: The 'document_shares' table is missing from your Supabase database. Please run the SQL migration (supabase/migrations/20261021230000_document_sharing_and_access_control.sql) in your Supabase SQL Editor."
            );
          } else {
            setErrorMessage(`Failed to load shares: ${sharesError.message}`);
          }
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
      setErrorMessage("Please enter an email address.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const lookupResult = await lookupRecipientByEmail(cleanEmail);

      if (!lookupResult.success) {
        setErrorMessage(lookupResult.error);
        setSubmitting(false);
        return;
      }

      const recipient = lookupResult.user;

      if (recipient.id === currentUserId) {
        setErrorMessage("You are the owner of this document. You cannot share it with yourself.");
        setSubmitting(false);
        return;
      }

      const alreadyShared = shares.some(
        (s) => s.shared_with_user_id === recipient.id
      );

      if (alreadyShared) {
        setErrorMessage(`"${recipient.email}" already has access to this document.`);
        setSubmitting(false);
        return;
      }

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting && !mutatingShareId) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-[#E5E5E5] text-[#171717]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E5E5] pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#5754D6]/10 flex items-center justify-center text-[#5754D6] shrink-0">
                <Share2 className="h-4 w-4" />
              </div>
              <h2
                id="share-dialog-title"
                className="truncate text-base font-semibold text-[#171717]"
              >
                Share &ldquo;{documentTitle || "Untitled document"}&rdquo;
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#737373]">
              Manage collaborator permissions or invite new team members.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting || mutatingShareId !== null}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-[#737373] hover:bg-[#FAFAF8] hover:text-[#171717] disabled:opacity-50 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Add Share Form */}
        <form onSubmit={handleAddShare} className="mt-5 space-y-2">
          <label
            htmlFor="recipient-email"
            className="block text-xs font-semibold text-[#171717]"
          >
            Invite collaborator
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="recipient-email"
              type="email"
              placeholder="colleague@company.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              disabled={submitting || mutatingShareId !== null}
              required
              className="flex-1 rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2 text-xs text-[#171717] placeholder:text-[#A3A3A3] outline-none transition focus:border-[#5754D6] focus:ring-1 focus:ring-[#5754D6] disabled:opacity-60"
            />

            <div className="flex gap-2">
              <select
                value={selectedPermission}
                onChange={(e) =>
                  setSelectedPermission(e.target.value as "viewer" | "editor")
                }
                disabled={submitting || mutatingShareId !== null}
                aria-label="Permission level"
                className="rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-xs text-[#171717] outline-none transition focus:border-[#5754D6] disabled:opacity-60 cursor-pointer"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>

              <button
                type="submit"
                disabled={submitting || mutatingShareId !== null}
                className="flex items-center gap-1.5 rounded-lg bg-[#5754D6] px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-[#4845C4] disabled:opacity-50 shrink-0"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Adding...</span>
                  </>
                ) : (
                  <span>Invite</span>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Status Messages */}
        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-[#FEF2F2] p-2.5 text-xs text-[#B91C1C]"
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-[#F0FDF4] p-2.5 text-xs text-[#15803D]"
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Existing Shares List */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold text-[#171717] mb-2">
            People with access
          </h3>

          <div className="max-h-60 overflow-y-auto rounded-xl border border-[#E5E5E5] divide-y divide-[#E5E5E5]">
            {/* Owner Row */}
            <div className="flex items-center justify-between p-3 text-xs bg-[#FAFAF8]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E5E5E5] text-xs font-semibold text-[#171717]">
                  You
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[#171717]">
                    Owner (You)
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    Full administrative control
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md bg-white border border-[#E5E5E5] px-2 py-0.5 text-[11px] font-medium text-[#737373]">
                <Shield className="h-3 w-3 text-[#5754D6]" />
                Owner
              </span>
            </div>

            {/* Recipient Rows */}
            {loadingShares ? (
              <div className="flex items-center justify-center p-6 text-xs text-[#737373]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#5754D6]" />
                Loading collaborators...
              </div>
            ) : shares.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#737373]">
                No external collaborators. Invite team members above to start sharing.
              </div>
            ) : (
              shares.map((share) => {
                const isMutating = mutatingShareId === share.id;
                const recipientDisplay = share.recipient_email || share.shared_with_user_id;

                return (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-3 p-3 text-xs bg-white hover:bg-[#FAFAF8] transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5754D6]/10 text-xs font-semibold text-[#5754D6]">
                        {recipientDisplay[0]?.toUpperCase() || "U"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[#171717]">
                          {recipientDisplay}
                        </p>
                        <p className="text-[11px] text-[#737373]">
                          Added {new Date(share.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
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
                        className="rounded-lg border border-[#E5E5E5] bg-white px-2 py-1 text-xs text-[#171717] outline-none transition hover:border-[#D4D4D4] focus:border-[#5754D6] disabled:opacity-50 cursor-pointer"
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
                        className="rounded-lg p-1.5 text-[#737373] transition hover:bg-[#FEF2F2] hover:text-[#B91C1C] disabled:opacity-50"
                      >
                        {isMutating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#737373]" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
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
        <div className="mt-6 flex justify-end border-t border-[#E5E5E5] pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || mutatingShareId !== null}
            className="rounded-lg border border-[#E5E5E5] bg-white px-4 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] transition disabled:opacity-50 shadow-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
