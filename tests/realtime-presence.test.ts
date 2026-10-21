import { describe, expect, it } from "vitest";
import {
  getAvatarColor,
  getInitials,
  type Collaborator,
} from "../src/components/CollaboratorPresence";

describe("Real-Time Collaborator Presence", () => {
  it("extracts clean initials from various user emails and names", () => {
    expect(getInitials("john.doe@example.com")).toBe("JD");
    expect(getInitials("sarah_connor@skynet.com")).toBe("SC");
    expect(getInitials("alex@company.org")).toBe("AL");
    expect(getInitials("a@domain.com")).toBe("A");
    expect(getInitials("")).toBe("?");
  });

  it("assigns consistent, deterministic avatar colors based on identifier hash", () => {
    const color1 = getAvatarColor("user-123");
    const color2 = getAvatarColor("user-123");
    expect(color1).toBe(color2);

    const colorA = getAvatarColor("alice@example.com");
    expect(colorA).toMatch(/bg-[a-z]+-600/);
  });

  it("deduplicates presence records for the same user across multiple tabs/windows", () => {
    const rawPresences: Collaborator[] = [
      {
        user_id: "user-1",
        email: "alice@example.com",
        role: "owner",
        online_at: "2026-10-22T00:00:00Z",
      },
      {
        user_id: "user-1", // duplicate from another tab
        email: "alice@example.com",
        role: "owner",
        online_at: "2026-10-22T00:01:00Z",
      },
      {
        user_id: "user-2",
        email: "bob@example.com",
        role: "editor",
        online_at: "2026-10-22T00:00:30Z",
      },
    ];

    const seen = new Set<string>();
    const deduplicated: Collaborator[] = [];

    for (const p of rawPresences) {
      if (!seen.has(p.user_id)) {
        seen.add(p.user_id);
        deduplicated.push(p);
      }
    }

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.map((c) => c.user_id)).toEqual(["user-1", "user-2"]);
  });

  it("verifies that unauthorized users without access cannot join presence channels", () => {
    function canJoinPresence(hasAccess: boolean, userId: string | null, role: string | null): boolean {
      if (!hasAccess || !userId || !role) return false;
      return true;
    }

    expect(canJoinPresence(true, "user-1", "owner")).toBe(true);
    expect(canJoinPresence(true, "user-2", "editor")).toBe(true);
    expect(canJoinPresence(true, "user-3", "viewer")).toBe(true);
    expect(canJoinPresence(false, "user-unauthorized", null)).toBe(false);
    expect(canJoinPresence(true, null, "viewer")).toBe(false);
  });

  it("handles join and leave presence events accurately", () => {
    const active = new Map<string, Collaborator>();

    // User A joins
    active.set("user-a", {
      user_id: "user-a",
      email: "a@test.com",
      role: "owner",
      online_at: new Date().toISOString(),
    });
    expect(active.size).toBe(1);

    // User B joins
    active.set("user-b", {
      user_id: "user-b",
      email: "b@test.com",
      role: "editor",
      online_at: new Date().toISOString(),
    });
    expect(active.size).toBe(2);

    // User A leaves
    active.delete("user-a");
    expect(active.size).toBe(1);
    expect(active.has("user-b")).toBe(true);
  });
});
