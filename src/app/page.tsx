
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type DocumentRow = {
  id: string;
  title: string;
  updated_at: string;
};

export default function HomePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [title, setTitle] = useState("Untitled document");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadDocuments = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setUserId(null);
      return;
    }

    setUserId(user.id);

    const { data, error } = await supabase
      .from("documents")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setDocuments(data ?? []);
  }, [supabase]);

  useEffect(() => {
    let ignore = false;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (ignore) return;
      if (!user) {
        setUserId(null);
        return;
      }
      setUserId(user.id);
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });

      if (ignore) return;
      if (error) {
        setMessage(error.message);
        return;
      }
      setDocuments(data ?? []);
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
      const result = mode === "login"
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
    setDocuments([]);
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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Draftly</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your documents, in one place.
          </p>
        </div>

        <button
          onClick={() => void logout()}
          className="rounded-lg border px-4 py-2"
        >
          Log out
        </button>
      </header>

      <section className="mt-8 rounded-xl border p-5">
        <h2 className="font-semibold">Create a document</h2>

        <div className="mt-3 flex flex-wrap gap-3">
          <input
            className="min-w-0 flex-1 rounded-lg border p-3"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            aria-label="Document title"
          />

          <button
            disabled={busy}
            onClick={() => void createDocument()}
            className="rounded-lg bg-black px-5 py-3 text-white disabled:opacity-50"
          >
            New document
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">My documents</h2>

        {documents.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No documents yet. Create your first document above.
          </p>
        ) : (
          <ul className="mt-4 divide-y rounded-xl border">
            {documents.map((doc) => (
              <li key={doc.id} className="p-4">
                <Link
                  href={`/documents/${doc.id}`}
                  className="font-medium hover:underline"
                >
                  {doc.title}
                </Link>
                <p className="mt-1 text-xs text-gray-500">
                  Updated {new Date(doc.updated_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message && (
        <p role="status" className="mt-4 text-sm text-red-600">
          {message}
        </p>
      )}
    </main>
  );
}
