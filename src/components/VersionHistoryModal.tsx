"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  History,
  Loader2,
  RotateCcw,
  User,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type VersionRecord = {
  id: string;
  document_id: string;
  version_number: number;
  title: string;
  content_json: Record<string, unknown>;
  change_summary: string;
  created_by: string;
  created_at: string;
  author_email?: string;
};

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  isOwner: boolean;
  onRestore: (
    versionNumber: number,
    title: string,
    contentJson: Record<string, unknown>
  ) => Promise<boolean>;
}

export function VersionHistoryModal({
  isOpen,
  onClose,
  documentId,
  isOwner,
  onRestore,
}: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<VersionRecord | null>(null);

  const supabase = createClient();

  useEffect(() => {
    if (!isOpen || !documentId) return;

    let ignore = false;

    async function fetchHistory() {
      await Promise.resolve();
      if (ignore) return;

      setLoading(true);
      setError("");

      try {
        const { data, error: fetchError } = await supabase
          .from("document_versions")
          .select("id, document_id, version_number, title, content_json, change_summary, created_by, created_at")
          .eq("document_id", documentId)
          .order("version_number", { ascending: false });

        if (ignore) return;

        if (fetchError) {
          if (
            fetchError.code === "42P01" ||
            fetchError.message.includes("does not exist")
          ) {
            setError(
              "Version history table is pending schema sync. Please run supabase/migrations/20261022010000_document_version_history.sql in Supabase SQL Editor."
            );
          } else {
            setError(`Failed to load version history: ${fetchError.message}`);
          }
          setVersions([]);
          return;
        }

        const versionList = (data || []) as VersionRecord[];

        const authorIds = Array.from(new Set(versionList.map((v) => v.created_by).filter(Boolean)));
        if (authorIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email")
            .in("id", authorIds);

          if (profiles && !ignore) {
            const profileMap = new Map(profiles.map((p) => [p.id, p.email]));
            versionList.forEach((v) => {
              v.author_email = profileMap.get(v.created_by) || "Collaborator";
            });
          }
        }

        if (!ignore) {
          setVersions(versionList);
          if (versionList.length > 0) {
            setSelectedVersion(versionList[0]);
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Error retrieving history");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void fetchHistory();

    return () => {
      ignore = true;
    };
  }, [isOpen, documentId, supabase]);

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !restoringVersion) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, restoringVersion]);

  async function handleRestoreClick(v: VersionRecord) {
    if (!isOwner) return;

    const confirmed = window.confirm(
      `Are you sure you want to restore Version ${v.version_number} ("${v.title}")? This will update the active document and create a new audit snapshot.`
    );
    if (!confirmed) return;

    setRestoringVersion(v.version_number);
    setError("");

    try {
      const success = await onRestore(v.version_number, v.title, v.content_json);
      if (success) {
        onClose();
      } else {
        setError("Failed to restore version. Check your network or permissions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore version.");
    } finally {
      setRestoringVersion(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !restoringVersion) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white border border-[#E5E5E5] p-6 shadow-xl transition max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#5754D6]/10 flex items-center justify-center text-[#5754D6]">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 id="version-history-title" className="text-base font-semibold text-[#171717]">
                Document Version History
              </h2>
              <p className="text-xs text-[#737373]">
                Inspect past snapshots and restore previous content
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!!restoringVersion}
            aria-label="Close version history"
            className="rounded-lg p-1 text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C] flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 min-h-[260px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#737373]">
              <Loader2 className="h-6 w-6 animate-spin text-[#5754D6] mb-2" />
              <p className="text-xs">Loading version history...</p>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-[#737373]">
              <Clock className="h-8 w-8 text-[#D4D4D4] mb-2" />
              <p className="text-xs font-medium text-[#171717]">No version snapshots yet</p>
              <p className="text-[11px] text-[#737373] mt-1 max-w-xs">
                Snapshots are automatically created whenever you save document changes.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((ver, idx) => {
                const isSelected = selectedVersion?.id === ver.id;
                const isRestoring = restoringVersion === ver.version_number;
                const isLatest = idx === 0;

                const formattedDate = new Date(ver.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                });

                return (
                  <div
                    key={ver.id}
                    onClick={() => setSelectedVersion(ver)}
                    className={`rounded-xl border p-3.5 transition cursor-pointer flex items-center justify-between gap-4 ${
                      isSelected
                        ? "border-[#5754D6] bg-[#5754D6]/5"
                        : "border-[#E5E5E5] bg-white hover:border-[#D4D4D4] hover:bg-[#FAFAF8]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#171717]">
                          Version {ver.version_number}
                        </span>
                        {isLatest && (
                          <span className="rounded-full bg-[#E0E7FF] text-[#4338CA] px-2 py-0.5 text-[10px] font-medium">
                            Current Active
                          </span>
                        )}
                        {ver.change_summary && ver.change_summary !== "Manual save" && (
                          <span className="rounded-md bg-[#F4F4F3] border border-[#E5E5E5] text-[#525252] px-1.5 py-0.2 text-[10px]">
                            {ver.change_summary}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-[11px] text-[#737373]">
                        <span className="truncate max-w-[200px] font-medium text-[#171717]">
                          &ldquo;{ver.title}&rdquo;
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {ver.author_email || "Collaborator"}
                        </span>
                        <span>•</span>
                        <span>{formattedDate}</span>
                      </div>
                    </div>

                    {/* Restore Action (Owner only & not already current) */}
                    {isOwner && !isLatest && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRestoreClick(ver);
                        }}
                        disabled={isRestoring || !!restoringVersion}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E5E5] bg-white px-2.5 py-1 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] shadow-xs transition cursor-pointer disabled:opacity-50"
                        title="Restore this version"
                      >
                        {isRestoring ? (
                          <Loader2 className="h-3 w-3 animate-spin text-[#5754D6]" />
                        ) : (
                          <RotateCcw className="h-3 w-3 text-[#5754D6]" />
                        )}
                        <span>{isRestoring ? "Restoring..." : "Restore"}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#E5E5E5] pt-4 mt-2 text-xs text-[#737373]">
          <div>
            {!isOwner && (
              <span className="text-[11px] text-[#B45309]">
                View-only history mode. Only the document owner can restore past versions.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#E5E5E5] px-4 py-2 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
