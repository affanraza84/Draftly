"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Compass,
  Edit3,
  Eye,
  FileCode,
  FileText,
  Filter,
  Grid,
  List,
  Loader2,
  LogOut,
  Menu,
  Plus,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseImportContent, validateImportFile } from "@/lib/document-import";

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

type NavTab = "all" | "mine" | "shared";

export default function HomePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Auth state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState("");

  // Document state
  const [myDocuments, setMyDocuments] = useState<DocumentRow[]>([]);
  const [sharedDocuments, setSharedDocuments] = useState<SharedDocumentRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Filter & Navigation state
  const [activeTab, setActiveTab] = useState<NavTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "title">("recent");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // File Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFilename, setImportFilename] = useState("");
  const [importError, setImportError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setUserEmail("");
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email ?? "");

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
        if (
          sharesError.code === "PGRST205" ||
          sharesError.message?.toLowerCase().includes("schema cache") ||
          sharesError.message?.toLowerCase().includes("document_shares")
        ) {
          setSharedDocuments([]);
        } else {
          setMessage(`Failed to load shared documents: ${sharesError.message}`);
        }
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
      setMessage("An unexpected error occurred while loading your documents.");
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
          setUserEmail("");
          return;
        }

        setUserId(user.id);
        setUserEmail(user.email ?? "");

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

        const { data: sharesData, error: sharesError } = await supabase
          .from("document_shares")
          .select(
            "id, document_id, permission, created_at, documents(id, title, updated_at, owner_id)"
          )
          .eq("shared_with_user_id", user.id)
          .order("created_at", { ascending: false });

        if (ignore) return;

        if (sharesError) {
          setSharedDocuments([]);
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
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setAuthError("Please enter both email and password.");
      return;
    }

    if (cleanPassword.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setAuthError("");

    try {
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password: cleanPassword,
            })
          : await supabase.auth.signUp({
              email: cleanEmail,
              password: cleanPassword,
            });

      if (result.error) {
        if (
          result.error.message.toLowerCase().includes("api key") ||
          result.error.status === 401
        ) {
          setAuthError(
            "Invalid Supabase API key (401). Please verify your NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local matches your project's 'anon public' key from Supabase Dashboard > Project Settings > API."
          );
        } else if (
          result.error.message.toLowerCase().includes("rate limit") ||
          result.error.status === 429
        ) {
          setAuthError(
            "Email rate limit exceeded. To resolve: go to Supabase Dashboard > Authentication > Providers > Email, toggle OFF 'Confirm email', and click Save. This disables email verification and allows instant signups without sending emails."
          );
        } else {
          setAuthError(result.error.message);
        }
        return;
      }

      if (mode === "signup") {
        if (!result.data.session) {
          if (
            result.data.user?.identities &&
            result.data.user.identities.length === 0
          ) {
            setAuthError(
              "An account with this email already exists. Please log in instead."
            );
            return;
          }

          setAuthError(
            "Account created! Check your email to confirm your account (or disable 'Confirm email' in Supabase Dashboard > Authentication > Providers > Email for instant testing)."
          );
          return;
        }
      }

      await loadDocuments();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Authentication failed. Check your connection."
      );
    } finally {
      setBusy(false);
    }
  }

  async function createDocument() {
    if (!userId) return;

    setBusy(true);
    setMessage("");

    const normalizedTitle =
      title.trim().slice(0, 120) || "Untitled document";

    try {
      const { data, error } = await supabase
        .from("documents")
        .insert({
          owner_id: userId,
          title: normalizedTitle,
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

  async function handleFileProcess(file: File) {
    if (!userId) return;

    setImportError("");
    setImportFilename(file.name);
    setImporting(true);

    try {
      const validation = validateImportFile({
        name: file.name,
        size: file.size,
      });

      if (!validation.valid) {
        setImportError(validation.error);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const rawContent = await file.text();
      const parsed = parseImportContent(file.name, rawContent);

      if (!parsed.success) {
        setImportError(parsed.error);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const { data, error } = await supabase
        .from("documents")
        .insert({
          owner_id: userId,
          title: parsed.title,
          content_json: parsed.content_json,
        })
        .select("id")
        .single();

      if (error) {
        setImportError(`Failed to save imported document: ${error.message}`);
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      router.push(`/documents/${data.id}`);
    } catch {
      setImportError("An error occurred while reading the file. Please try again.");
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserId(null);
    setUserEmail("");
    setMyDocuments([]);
    setSharedDocuments([]);
  }

  // Filtered and sorted documents
  const allDocumentsList = useMemo(() => {
    type UnifiedDoc = {
      id: string;
      title: string;
      updated_at: string;
      isOwner: boolean;
      permission?: "viewer" | "editor";
      ownerEmail?: string;
    };

    const mine: UnifiedDoc[] = myDocuments.map((d) => ({
      id: d.id,
      title: d.title,
      updated_at: d.updated_at,
      isOwner: true,
    }));

    const shared: UnifiedDoc[] = sharedDocuments.map((d) => ({
      id: d.documentId,
      title: d.title,
      updated_at: d.updated_at,
      isOwner: false,
      permission: d.permission,
      ownerEmail: d.ownerEmail,
    }));

    let combined: UnifiedDoc[] = [];
    if (activeTab === "all") {
      combined = [...mine, ...shared];
    } else if (activeTab === "mine") {
      combined = mine;
    } else {
      combined = shared;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      combined = combined.filter(
        (doc) =>
          doc.title.toLowerCase().includes(q) ||
          (doc.ownerEmail && doc.ownerEmail.toLowerCase().includes(q))
      );
    }

    combined.sort((a, b) => {
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return combined;
  }, [myDocuments, sharedDocuments, activeTab, searchQuery, sortBy]);

  // Auth Screen
  if (!userId) {
    return (
      <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[420px] bg-white rounded-2xl border border-[#E5E5E5] p-8 shadow-xs">
          {/* Brand header */}
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#5754D6] flex items-center justify-center text-white shadow-xs">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-[#171717]">Draftly</span>
              <span className="ml-2 text-[11px] font-medium uppercase tracking-wider text-[#737373] bg-[#F4F4F3] px-2 py-0.5 rounded-md">
                Workspace
              </span>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[#171717]">
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-[#737373]">
            {authMode === "login"
              ? "Sign in to access your distraction-free workspace."
              : "Start writing and collaborating with clean elegance."}
          </p>

          {/* Mode Switcher */}
          <div className="mt-6 flex rounded-lg bg-[#FAFAF8] p-1 border border-[#E5E5E5]">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
                authMode === "login"
                  ? "bg-white text-[#171717] shadow-xs"
                  : "text-[#737373] hover:text-[#171717]"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAuthError("");
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
                authMode === "signup"
                  ? "bg-white text-[#171717] shadow-xs"
                  : "text-[#737373] hover:text-[#171717]"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void authenticate(authMode);
            }}
          >
            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[#171717] mb-1.5"
              >
                Email address
              </label>
              <input
                id="auth-email"
                className="w-full rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2.5 text-sm text-[#171717] placeholder:text-[#A3A3A3] outline-none transition focus:border-[#5754D6] focus:ring-1 focus:ring-[#5754D6]"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-[#171717] mb-1.5"
              >
                Password
              </label>
              <input
                id="auth-password"
                className="w-full rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2.5 text-sm text-[#171717] placeholder:text-[#A3A3A3] outline-none transition focus:border-[#5754D6] focus:ring-1 focus:ring-[#5754D6]"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </div>

            <button
              disabled={busy}
              type="submit"
              className="w-full rounded-lg bg-[#5754D6] py-2.5 px-4 text-sm font-medium text-white shadow-xs transition hover:bg-[#4845C4] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : authMode === "login" ? (
                "Continue with Email"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {authError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-[#FEF2F2] p-3 text-xs leading-relaxed text-[#B91C1C]"
            >
              {authError}
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-[#E5E5E5] text-center">
            <p className="text-xs text-[#737373]">
              Draftly uses secure Supabase Auth and database-level RLS.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Main Dashboard View
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col md:flex-row text-[#171717]">
      {/* Mobile Header Bar */}
      <div className="md:hidden flex items-center justify-between border-b border-[#E5E5E5] bg-white px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-[#5754D6] flex items-center justify-center text-white">
            <FileText className="h-4 w-4" />
          </div>
          <span className="font-bold text-[#171717] text-base tracking-tight">Draftly</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded-lg border border-[#E5E5E5] text-[#737373] hover:text-[#171717] cursor-pointer"
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside
        className={`${
          mobileMenuOpen ? "block" : "hidden"
        } md:block md:w-64 border-r border-[#E5E5E5] bg-white flex flex-col shrink-0 z-30 transition-all duration-200`}
      >
        {/* Workspace Brand */}
        <div className="p-5 border-b border-[#E5E5E5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-[#5754D6] flex items-center justify-center text-white shadow-xs">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold text-[#171717] text-base tracking-tight">Draftly</span>
              <p className="text-[11px] font-medium text-[#737373]">Workspace</p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="p-4 space-y-2">
          <button
            type="button"
            onClick={() => setIsCreatingNew(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#5754D6] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-[#4845C4] cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Document</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setImportModalOpen(true);
              setImportError("");
            }}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#E5E5E5] bg-[#FAFAF8] px-3.5 py-2 text-xs font-medium text-[#171717] transition hover:bg-[#F0F0EE] cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-[#737373]" />
            <span>Import File</span>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab("all");
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
              activeTab === "all"
                ? "bg-[#F4F4F3] text-[#171717] font-semibold"
                : "text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Compass className="h-4 w-4 text-[#737373]" />
              <span>All Documents</span>
            </div>
            <span className="text-[11px] text-[#A3A3A3] font-normal">
              {myDocuments.length + sharedDocuments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("mine");
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
              activeTab === "mine"
                ? "bg-[#F4F4F3] text-[#171717] font-semibold"
                : "text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FileText className="h-4 w-4 text-[#737373]" />
              <span>My Documents</span>
            </div>
            <span className="text-[11px] text-[#A3A3A3] font-normal">
              {myDocuments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("shared");
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
              activeTab === "shared"
                ? "bg-[#F4F4F3] text-[#171717] font-semibold"
                : "text-[#737373] hover:text-[#171717] hover:bg-[#FAFAF8]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="h-4 w-4 text-[#737373]" />
              <span>Shared With Me</span>
            </div>
            <span className="text-[11px] text-[#A3A3A3] font-normal">
              {sharedDocuments.length}
            </span>
          </button>
        </nav>

        {/* User Account / Footer */}
        <div className="p-4 border-t border-[#E5E5E5] bg-[#FAFAF8]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-full bg-[#E5E5E5] flex items-center justify-center text-xs font-semibold text-[#171717] shrink-0">
                {userEmail ? userEmail[0].toUpperCase() : "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[#171717]">
                  {userEmail || "Authenticated User"}
                </p>
                <p className="text-[11px] text-[#737373]">Standard Tier</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              title="Log out"
              className="p-1.5 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#E5E5E5] transition cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 p-4 sm:p-8 lg:p-10 max-w-7xl mx-auto w-full">
        {/* Workspace Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E5E5E5]">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#171717]">
              {activeTab === "all"
                ? "All Documents"
                : activeTab === "mine"
                ? "My Documents"
                : "Shared With Me"}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-[#737373]">
              {activeTab === "all"
                ? "Overview of all your personal and shared workspace documents."
                : activeTab === "mine"
                ? "Documents created and owned exclusively by you."
                : "Documents shared with you by team members and collaborators."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCreatingNew(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#5754D6] px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-[#4845C4] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setImportModalOpen(true);
                setImportError("");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2 text-xs font-medium text-[#171717] shadow-xs transition hover:bg-[#FAFAF8] cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-[#737373]" />
              <span>Import</span>
            </button>
          </div>
        </div>

        {/* Inline Creator Bar (if opened) */}
        {isCreatingNew && (
          <div className="mt-6 rounded-xl border border-[#5754D6]/30 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#171717]">Document Title</span>
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="text-[#737373] hover:text-[#171717] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                className="flex-1 rounded-lg border border-[#E5E5E5] px-3.5 py-2 text-sm text-[#171717] outline-none focus:border-[#5754D6] focus:ring-1 focus:ring-[#5754D6]"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Enter title..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createDocument();
                  if (e.key === "Escape") setIsCreatingNew(false);
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void createDocument()}
                className="rounded-lg bg-[#5754D6] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#4845C4] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {busy ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Toolbar: Search, Sort, View Toggle */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#737373]" />
            <input
              type="text"
              placeholder="Search documents by title or owner..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#E5E5E5] bg-white pl-9 pr-8 py-2 text-xs text-[#171717] placeholder:text-[#A3A3A3] outline-none transition focus:border-[#5754D6] focus:ring-1 focus:ring-[#5754D6]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A3A3A3] hover:text-[#171717] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Controls: Sort and View Mode */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="flex items-center gap-1.5 border border-[#E5E5E5] bg-white rounded-lg px-2.5 py-1.5 cursor-pointer">
              <Filter className="h-3.5 w-3.5 text-[#737373]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "recent" | "title")}
                aria-label="Sort documents"
                className="text-xs text-[#171717] bg-transparent outline-none cursor-pointer"
              >
                <option value="recent">Recently Edited</option>
                <option value="title">Alphabetical (A-Z)</option>
              </select>
            </div>

            <div className="flex items-center rounded-lg border border-[#E5E5E5] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid View"
                className={`p-1.5 rounded-md transition cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-[#F4F4F3] text-[#171717]"
                    : "text-[#737373] hover:text-[#171717]"
                }`}
              >
                <Grid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="List View"
                className={`p-1.5 rounded-md transition cursor-pointer ${
                  viewMode === "list"
                    ? "bg-[#F4F4F3] text-[#171717]"
                    : "text-[#737373] hover:text-[#171717]"
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Document Grid / List Content */}
        <section className="mt-6 flex-1">
          {loadingDocs ? (
            <div className="rounded-xl border border-[#E5E5E5] bg-white p-12 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#5754D6]" />
              <p className="mt-3 text-xs text-[#737373]">Loading documents...</p>
            </div>
          ) : allDocumentsList.length === 0 ? (
            /* Empty State */
            <div className="rounded-2xl border border-dashed border-[#E5E5E5] bg-white p-12 text-center max-w-md mx-auto my-8">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-[#FAFAF8] border border-[#E5E5E5] flex items-center justify-center text-[#737373]">
                <FileText className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#171717]">
                {searchQuery ? "No matching documents" : "No documents yet"}
              </h3>
              <p className="mt-1 text-xs text-[#737373] max-w-xs mx-auto">
                {searchQuery
                  ? "Try searching for a different title or clearing your search filter."
                  : activeTab === "shared"
                  ? "When collaborators share documents with your email, they will appear here."
                  : "Create your first document or import an existing Markdown / text file."}
              </p>
              {!searchQuery && (
                <div className="mt-5 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreatingNew(true)}
                    className="rounded-lg bg-[#5754D6] px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-[#4845C4] cursor-pointer"
                  >
                    New Document
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportModalOpen(true);
                      setImportError("");
                    }}
                    className="rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer"
                  >
                    Import File
                  </button>
                </div>
              )}
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allDocumentsList.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="group relative flex flex-col justify-between rounded-xl border border-[#E5E5E5] bg-white p-5 transition hover:border-[#5754D6]/50 hover:shadow-xs cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="h-8 w-8 rounded-lg bg-[#FAFAF8] border border-[#E5E5E5] flex items-center justify-center text-[#5754D6] group-hover:bg-[#5754D6]/10 transition">
                        <FileText className="h-4 w-4" />
                      </div>

                      {doc.isOwner ? (
                        <span className="text-[11px] font-medium text-[#737373] bg-[#FAFAF8] border border-[#E5E5E5] px-2 py-0.5 rounded-md">
                          Owner
                        </span>
                      ) : doc.permission === "editor" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8]">
                          <Edit3 className="h-3 w-3" />
                          Editor
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[11px] font-medium text-[#B45309]">
                          <Eye className="h-3 w-3" />
                          Viewer
                        </span>
                      )}
                    </div>

                    <h3 className="font-semibold text-sm text-[#171717] group-hover:text-[#5754D6] transition line-clamp-2 leading-snug">
                      {doc.title}
                    </h3>
                  </div>

                  <div className="mt-6 pt-3 border-t border-[#F4F4F3] flex items-center justify-between text-[11px] text-[#737373]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(doc.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>

                    {!doc.isOwner && doc.ownerEmail && (
                      <span className="truncate max-w-[120px]" title={doc.ownerEmail}>
                        by {doc.ownerEmail.split("@")[0]}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="rounded-xl border border-[#E5E5E5] bg-white divide-y divide-[#E5E5E5] overflow-hidden">
              {allDocumentsList.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-4 transition hover:bg-[#FAFAF8]"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="h-8 w-8 rounded-lg bg-[#FAFAF8] border border-[#E5E5E5] flex items-center justify-center text-[#5754D6] shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1 pr-4">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="font-medium text-sm text-[#171717] hover:text-[#5754D6] transition block truncate"
                      >
                        {doc.title}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-[#737373] flex items-center gap-2">
                        <span>Updated {new Date(doc.updated_at).toLocaleString()}</span>
                        {!doc.isOwner && doc.ownerEmail && (
                          <span>• Shared by {doc.ownerEmail}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {doc.isOwner ? (
                      <span className="text-[11px] font-medium text-[#737373] bg-[#FAFAF8] border border-[#E5E5E5] px-2 py-0.5 rounded-md">
                        Owner
                      </span>
                    ) : doc.permission === "editor" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8]">
                        <Edit3 className="h-3 w-3" />
                        Editor
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[11px] font-medium text-[#B45309]">
                        <Eye className="h-3 w-3" />
                        Viewer
                      </span>
                    )}

                    <Link
                      href={`/documents/${doc.id}`}
                      className="rounded-lg border border-[#E5E5E5] bg-white px-3 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {message && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-red-200 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
          >
            {message}
          </div>
        )}
      </main>

      {/* Import Modal */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing) {
              setImportModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-[#E5E5E5]">
            <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-[#5754D6]/10 flex items-center justify-center text-[#5754D6]">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <h2 id="import-modal-title" className="text-base font-semibold text-[#171717]">
                    Import Document
                  </h2>
                  <p className="text-xs text-[#737373]">
                    Convert Markdown or text files into editable Draftly documents.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                disabled={importing}
                className="text-[#737373] hover:text-[#171717] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drag & Drop Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileProcess(file);
              }}
              onClick={() => {
                if (!importing) fileInputRef.current?.click();
              }}
              className={`mt-5 rounded-xl border-2 border-dashed p-8 text-center transition cursor-pointer ${
                dragActive
                  ? "border-[#5754D6] bg-[#5754D6]/5"
                  : "border-[#E5E5E5] bg-[#FAFAF8] hover:border-[#D4D4D4]"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                accept=".txt,.md,.markdown"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileProcess(file);
                }}
                className="hidden"
                id="modal-file-import"
              />

              <div className="mx-auto h-10 w-10 rounded-full bg-white border border-[#E5E5E5] flex items-center justify-center text-[#5754D6] shadow-xs mb-3">
                <FileCode className="h-5 w-5" />
              </div>

              {importing ? (
                <div className="space-y-2">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#5754D6]" />
                  <p className="text-xs font-medium text-[#171717]">
                    Parsing &ldquo;{importFilename}&rdquo;...
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    Converting AST tokens to Tiptap schema
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#171717]">
                    Click to select or drag and drop your file here
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    Supports plain text (.txt) and Markdown (.md, .markdown) up to 1 MB
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white border border-[#E5E5E5] px-3.5 py-1.5 text-xs font-medium text-[#171717] hover:bg-[#F4F4F3] transition shadow-xs cursor-pointer"
                  >
                    Browse Files
                  </button>
                </div>
              )}
            </div>

            {importError && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
              >
                {importError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-[#E5E5E5] pt-4">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                disabled={importing}
                className="rounded-lg border border-[#E5E5E5] px-4 py-2 text-xs font-medium text-[#171717] hover:bg-[#FAFAF8] transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
