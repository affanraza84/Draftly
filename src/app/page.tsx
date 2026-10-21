"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Edit3, Eye, FileText, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type DocumentRow = {
  id: string;
  title: string;
  updated_at: string;
};

type SharedDocumentRow = {
  shareId: string;
  documentId: string;
  title: string;
  updated_at: string;
  permission: "viewer" | "editor";
  ownerEmail: string;
};

type ShareQueryResult = {
  id: string;
  document_id: string;
  permission: "viewer" | "editor";
  created_at: string;
  documents: {
    id: string;
    title: string;
    updated_at: string;
    owner_id: string;
  } | null;
};

export default function HomePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [myDocuments, setMyDocuments] = useState<DocumentRow[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<SharedDocumentRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        return;
      }

      setUserId(user.id);

      // 1. Fetch user's own documents
      const { data: myDocs, error: myError } = await supabase
        .from("documents")
        .select("id, title, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });

      if (myError) {
        setMessage(myError.message);
        return;
      }

      setMyDocuments(myDocs ?? []);

      // 2. Fetch documents shared with the user
      const { data: sharesData, error: sharesError } = await supabase
        .from("document_shares")
        .select(
          "id, document_id, permission, created_at, documents(id, title, updated_at, owner_id)"
        )
        .eq("shared_with_user_id", user.id)
        .order("created_at", { ascending: false });

      if (sharesError) {
        setMessage(`Failed to load shared documents: ${sharesError.message}`);
        return;
      }

      const rawShares = (sharesData as unknown as ShareQueryResult[]) ?? [];
      const validShares = rawShares.filter((s) => s.documents !== null);

      const ownerIds = Array.from(
        new Set(validShares.map((s) => s.documents!.owner_id))
      );

      const emailMap = new Map<string, string>();
      if (ownerIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", ownerIds);

        if (profilesData) {
          for (const p of profilesData) {
            emailMap.set(p.id, p.email);
          }
        }
      }

      const formattedShared: SharedDocumentRow[] = validShares.map((s) => ({
        shareId: s.id,
        documentId: s.documents!.id,
        title: s.documents!.title,
        updated_at: s.documents!.updated_at,
        permission: s.permission,
        ownerEmail: emailMap.get(s.documents!.owner_id) || "Document owner",
      }));

      setSharedDocuments(formattedShared);
    } catch {
      setMessage("An unexpected error occurred while loading your dashboard.");
    } finally {
      setLoadingDocs(false);
    }
  }, [supabase]);

  useEffect(() => {
    let ignore = false;

    async function init() {
      setLoadingDocs(true);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (ignore) return;

        if (!user) {
          setUserId(null);
          return;
        }

        setUserId(user.id);

        // Fetch own documents
        const { data: myDocs, error: myError } = await supabase
          .from("documents")
          .select("id, title, updated_at")
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false });

        if (ignore) return;

        if (myError) {
          setMessage(myError.message);
          return;
        }

        setMyDocuments(myDocs ?? []);

        // Fetch shared documents
        const { data: sharesData, error: sharesError } = await supabase
          .from("document_shares")
          .select(
            "id, document_id, permission, created_at, documents(id, title, updated_at, owner_id)"
          )
          .eq("shared_with_user_id", user.id)
          .order("created_at", { ascending: false });

        if (ignore) return;

        if (sharesError) {
          setMessage(`Failed to load shared documents: ${sharesError.message}`);
          return;
        }

        const rawShares = (sharesData as unknown as ShareQueryResult[]) ?? [];
        const validShares = rawShares.filter((s) => s.documents !== null);

        const ownerIds = Array.from(
          new Set(validShares.map((s) => s.documents!.owner_id))
        );

        const emailMap = new Map<string, string>();
        if (ownerIds.length > 0) {
          const { data: profilesData } = await supabase
            .from("profiles")
            .select("id, email")
            .in("id", ownerIds);

          if (profilesData) {
            for (const p of profilesData) {
              emailMap.set(p.id, p.email);
            }
          }
        }

        if (ignore) return;

        const formattedShared: SharedDocumentRow[] = validShares.map((s) => ({
          shareId: s.id,
          documentId: s.documents!.id,
          title: s.documents!.title,
          updated_at: s.documents!.updated_at,
          permission: s.permission,
          ownerEmail: emailMap.get(s.documents!.owner_id) || "Document owner",
        }));

        setSharedDocuments(formattedShared);
      } catch {
        if (!ignore) {
          setMessage("An unexpected error occurred while loading documents.");
        }
      } finally {
        if (!ignore) {
          setLoadingDocs(false);
        }
      }
    }

    void init();

    return () => {
      ignore = true;
    };
  }, [supabase]);

  async function authenticate(mode: "login" | "signup") {
    setBusy(true);
    setMessage("");

    try {
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Account created. Check your email to confirm your account.");
        return;
      }

      await loadDocuments();
    } finally {
      setBusy(false);
    }
  }

  async function createDocument() {
    if (!userId) return;

    setBusy(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from("documents")
        .insert({
          owner_id: userId,
          title: title.trim() || "Untitled document",
          content_json: {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
        })
        .select("id")
        .single();

      if (error) {
        setMessage(error.message);
        return;
      }

      router.push(`/documents/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserId(null);
    setMyDocuments([]);
    setSharedDocuments([]);
  }

  if (!userId) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-3xl font-bold">Draftly</h1>
        <p className="mt-2 text-gray-600">
          Your simple document workspace.
        </p>

        <form
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate("login");
          }}
        >
          <input
            className="w-full rounded-lg border p-3"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <input
            className="w-full rounded-lg border p-3"
            type="password"
            placeholder="Password (at least 6 characters)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />

          <button
            disabled={busy}
            className="w-full rounded-lg bg-black p-3 text-white disabled:opacity-50"
          >
            {busy ? "Please wait..." : "Log in"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void authenticate("signup")}
            className="w-full rounded-lg border p-3 disabled:opacity-50"
          >
            Create account
          </button>
        </form>

        {message && (
          <p role="status" className="mt-4 text-sm text-red-600">
            {message}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Draftly</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your documents and shared workspaces in one place.
          </p>
        </div>

        <button
          onClick={() => void logout()}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50"
        >
          Log out
        </button>
      </header>

      {/* Create Document Section */}
      <section className="mt-8 rounded-xl border border-zinc-200 p-5">
        <h2 className="font-semibold text-zinc-900">Create a document</h2>

        <div className="mt-3 flex flex-wrap gap-3">
          <input
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 p-3 text-sm outline-none focus:border-black"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            aria-label="Document title"
            placeholder="Document title"
          />

          <button
            disabled={busy}
            onClick={() => void createDocument()}
            className="rounded-lg bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? "Creating..." : "New document"}
          </button>
        </div>
      </section>

      {/* My Documents Section */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-zinc-700" />
          <h2 className="text-xl font-semibold text-zinc-900">My documents</h2>
        </div>

        {loadingDocs ? (
          <div className="mt-4 rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500">
            Loading your documents...
          </div>
        ) : myDocuments.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
            No documents yet. Create your first document above.
          </div>
        ) : (
          <ul className="mt-4 divide-y rounded-xl border border-zinc-200">
            {myDocuments.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between p-4 transition hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {doc.title}
                  </Link>
                  <p className="mt-1 text-xs text-zinc-500">
                    Updated {new Date(doc.updated_at).toLocaleString()}
                  </p>
                </div>

                <Link
                  href={`/documents/${doc.id}`}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shared With Me Section */}
      <section className="mt-10">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-zinc-700" />
          <h2 className="text-xl font-semibold text-zinc-900">Shared with me</h2>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Documents shared with your account by other collaborators.
        </p>

        {loadingDocs ? (
          <div className="mt-4 rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500">
            Loading shared documents...
          </div>
        ) : sharedDocuments.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
            No documents have been shared with you yet.
          </div>
        ) : (
          <ul className="mt-4 divide-y rounded-xl border border-zinc-200">
            {sharedDocuments.map((doc) => (
              <li
                key={doc.shareId}
                className="flex items-center justify-between gap-4 p-4 transition hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/documents/${doc.documentId}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {doc.title}
                    </Link>

                    {/* Permission Badge */}
                    {doc.permission === "editor" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        <Edit3 className="h-3 w-3" />
                        Editor
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        <Eye className="h-3 w-3" />
                        Viewer
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-zinc-500">
                    Shared by {doc.ownerEmail} • Updated{" "}
                    {new Date(doc.updated_at).toLocaleString()}
                  </p>
                </div>

                <Link
                  href={`/documents/${doc.documentId}`}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && (
        <p role="status" className="mt-6 text-sm text-red-600">
          {message}
        </p>
      )}
    </main>
  );
}
