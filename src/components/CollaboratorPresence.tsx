"use client";

import { useEffect, useMemo, useState } from "react";
import { WifiOff } from "lucide-react";
import { createClient } from "../lib/supabase/client";

export type Collaborator = {
  user_id: string;
  email: string;
  role: string;
  online_at: string;
};

interface CollaboratorPresenceProps {
  documentId: string;
  currentUserId: string;
  currentUserEmail: string;
  userRole: "owner" | "editor" | "viewer" | null;
  hasAccess: boolean;
}

export function getInitials(emailOrName: string): string {
  if (!emailOrName) return "?";
  const namePart = emailOrName.split("@")[0].replace(/[._-]/g, " ");
  const parts = namePart.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return namePart.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-600 text-white",
  "bg-blue-600 text-white",
  "bg-emerald-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
  "bg-indigo-600 text-white",
  "bg-teal-600 text-white",
];

export function getAvatarColor(idOrEmail: string): string {
  let hash = 0;
  for (let i = 0; i < idOrEmail.length; i++) {
    hash = (hash << 5) - hash + idOrEmail.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function CollaboratorPresence({
  documentId,
  currentUserId,
  currentUserEmail,
  userRole,
  hasAccess,
}: CollaboratorPresenceProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isError, setIsError] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Only authorized users with access join the document presence channel
    if (!hasAccess || !documentId || !currentUserId || !userRole) {
      return;
    }

    const activeRole = userRole;
    let isMounted = true;
    const channelName = `doc-presence-${documentId}`;

    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: currentUserId,
        },
      },
    });

    function updateFromPresenceState() {
      if (!isMounted) return;
      const state = channel.presenceState();
      const uniqueCollaborators: Collaborator[] = [];
      const seen = new Set<string>();

      Object.values(state).forEach((presences) => {
        (presences as unknown as Collaborator[]).forEach((p) => {
          if (p.user_id && !seen.has(p.user_id)) {
            seen.add(p.user_id);
            uniqueCollaborators.push(p);
          }
        });
      });

      // If current user isn't in state yet, add current user representation
      if (!seen.has(currentUserId)) {
        uniqueCollaborators.unshift({
          user_id: currentUserId,
          email: currentUserEmail,
          role: activeRole,
          online_at: new Date().toISOString(),
        });
      }

      setCollaborators(uniqueCollaborators);
    }

    channel
      .on("presence", { event: "sync" }, () => {
        updateFromPresenceState();
      })
      .on("presence", { event: "join" }, () => {
        updateFromPresenceState();
      })
      .on("presence", { event: "leave" }, () => {
        updateFromPresenceState();
      })
      .subscribe(async (status) => {
        if (!isMounted) return;

        if (status === "SUBSCRIBED") {
          setIsConnected(true);
          setIsError(false);

          await channel.track({
            user_id: currentUserId,
            email: currentUserEmail || "Collaborator",
            role: activeRole,
            online_at: new Date().toISOString(),
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setIsConnected(false);
          setIsError(true);
        } else if (status === "CLOSED") {
          setIsConnected(false);
        }
      });

    return () => {
      isMounted = false;
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, currentUserEmail, documentId, hasAccess, supabase, userRole]);

  if (!hasAccess) return null;

  const count = collaborators.length || 1;

  return (
    <div
      className="flex items-center gap-2 pl-2 border-l border-[#E5E5E5]"
      title={
        isError
          ? "Realtime connection degraded. Offline fallback active."
          : `${count} active collaborator${count > 1 ? "s" : ""} viewing this document`
      }
    >
      {/* Online indicator dot / icon */}
      <div className="flex items-center gap-1.5">
        {isError ? (
          <WifiOff className="h-3 w-3 text-[#A3A3A3]" />
        ) : (
          <span className="relative flex h-2 w-2">
            {isConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isConnected ? "bg-emerald-500" : "bg-[#D4D4D4]"
              }`}
            />
          </span>
        )}
      </div>

      {/* Stacked collaborator avatar pills */}
      <div className="flex items-center -space-x-1.5 overflow-hidden">
        {collaborators.slice(0, 3).map((collab) => {
          const isMe = collab.user_id === currentUserId;
          const initials = getInitials(collab.email);
          const colorClass = getAvatarColor(collab.user_id || collab.email);

          return (
            <div
              key={collab.user_id}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white shadow-2xs ${colorClass}`}
              title={`${collab.email}${isMe ? " (You)" : ""} • ${collab.role}`}
            >
              {initials}
            </div>
          );
        })}

        {collaborators.length > 3 && (
          <div
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#F4F4F3] border border-[#E5E5E5] text-[10px] font-medium text-[#737373] ring-2 ring-white"
            title={`${collaborators.length - 3} more collaborators`}
          >
            +{collaborators.length - 3}
          </div>
        )}
      </div>

      <span className="text-[11px] font-medium text-[#737373] hidden md:inline">
        {count} {count === 1 ? "viewer" : "viewers"}
      </span>
    </div>
  );
}
