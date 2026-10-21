# Draftly - Full-Stack Document Editor

Draftly is a modern, lightweight, full-stack rich-text document editor built with Next.js App Router, Supabase PostgreSQL, Supabase Auth, Tailwind CSS, and Tiptap.

---

## 1. Project Overview

Draftly provides a secure, intuitive environment for drafting, editing, importing, and collaborating on rich-text documents. It was developed in phases:
1. **User Authentication & Document Creation**: Email/password authentication, user session persistence, and instant document generation.
2. **Rich-Text Editing & Persistence**: Tiptap editor integration supporting rich formatting (headings, lists, bold, italic, underline) with JSON persistence in PostgreSQL.
3. **Document Sharing & Access Control**: Multi-user collaboration with granular `owner`, `editor`, and `viewer` roles enforced at the database boundary via PostgreSQL Row Level Security (RLS).
4. **TXT & Markdown Import**: Client-side file ingestion using token-based AST parsing (`marked`) without raw HTML rendering.
5. **Hardening & Quality Assurance**: 44 automated tests across 4 test suites, strict type checking, zero-warning ESLint checks, race-condition mitigation, and navigation protection.
6. **Production Deployment & Reviewer Readiness**: Configured for seamless deployment on Vercel with production Supabase.

---

## 2. Features Implemented

- **Authentication & Sessions**: Email/password sign-in and sign-up with `@supabase/ssr`, cookie/token storage, and session termination on logout.
- **Document Management**: Create new documents, rename documents inline with 120-character normalization, save content to PostgreSQL JSONB, and restore formatting upon reopen.
- **Rich-Text Formatting**: Tiptap editor with Heading 1–3, Bullet List, Numbered List, Bold, Italic, and Underline.
- **File Upload & Import**:
  - Ingest `.txt` and `.md` (or `.markdown`) files up to 1 MB directly from the dashboard.
  - Generates document title from sanitized filename (clamped to 120 chars).
  - Safe token-based AST conversion (`marked`) preserving headings, lists, inline marks, code blocks, and blockquotes without executing HTML.
  - Rejection of binary/unsupported extensions, oversized files, and empty files with clear error states.
- **Granular Role-Based Sharing Permissions**:
  - Modal dialog to invite collaborators by email as **Editor** or **Viewer**.
  - Recipient email lookup powered by an authenticated Server Action against a synchronized `public.profiles` table (preventing account enumeration).
  - Instant role updates (promote/demote) and access revocation.
  - Live permission synchronization: if an open document's permission is downgraded or revoked, the editor is immediately updated/disabled via Supabase Realtime.
  - Anti-self-share trigger preventing owners from sharing documents with themselves.
- **Markdown Document Export**:
  - One-click export of current editor state to standard CommonMark (`.md`).
  - Preserves headings (H1–H6), paragraphs, bold, italic, strikethrough, lists, blockquotes, and links.
  - Safe underline serialization: standard Markdown has no native underline syntax; underlines are safely preserved using compliant HTML `<u>text</u>` tags.
  - Filename sanitization protecting against illegal filesystem characters.
- **Document Version History**:
  - Monotonically incrementing version snapshots recorded on document save.
  - Automatic suppression of duplicate sequential snapshots when content and title haven't changed.
  - Interactive version history modal showing version number, author, timestamp, change summary, and restore action.
  - Owner-only restoration: restores historical content while creating a new restoration snapshot, preserving the complete audit trail.
- **Real-Time Collaborator Presence**:
  - Lightweight presence indicator using Supabase Realtime Presence (`doc-presence-${id}`).
  - Live collaborator avatar stack with user initials, deterministic color hashing, and role tooltips.
  - Subtle online pulsing indicator and graceful offline fallback.
  - Strictly restricted to authenticated users with validated read access.
- **Anchored Document Comments**:
  - Highlights selected text ranges in the editor and anchors comments with quote snippets and offsets.
  - Real-time comment updates across open collaborator tabs via Supabase Realtime.
  - Resolution workflow: authors and document owners can resolve/reopen comments.
  - Deletion controls: strictly authorized to comment authors and document owners.
- **Dual Dashboard**: Split view organizing documents into "My Documents" (with Delete & Share actions) and "Shared with me" (with role badge and owner email).
- **Navigation Safety**: `beforeunload` warning when closing or navigating away with unsaved edits.

---

## 3. Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict mode enabled)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Editor**: [Tiptap](https://tiptap.dev/) (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`)
- **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, Auth, Row Level Security, Realtime Presence)
- **Client Libraries**: `@supabase/supabase-js`, `@supabase/ssr`
- **Markdown AST Tokenizer**: [marked](https://marked.js.org/)
- **Testing Framework**: [Vitest](https://vitest.dev/) (8 test suites, 78 unit & integration tests)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 4. Architecture & Tradeoffs

- **PostgreSQL Row Level Security (RLS)**: Access control is enforced at the database layer rather than relying solely on UI button hiding. Custom `SECURITY DEFINER` helper functions (`is_document_owner`, `has_document_access`, `can_edit_document`) use a fixed `SET search_path = public` to avoid infinite recursion and prevent search-path hijacking.
- **Tiptap JSONB Persistence**: Rather than saving raw HTML (which exposes XSS vectors and requires sanitization), Draftly stores structured Tiptap JSON in PostgreSQL `jsonb` columns. This guarantees clean serializability, backward compatibility, and native client rehydration.
- **AST-Based File Import**: Markdown conversion tokenizes input with `marked.lexer()` into an Abstract Syntax Tree (AST) before constructing Tiptap schema objects. This bypasses the need for `dangerouslySetInnerHTML` and prevents script injection.
- **Audit-Preserving Version Restoration**: When an owner restores a previous version, the history is not rewritten or truncated. Instead, the historical content is applied to the live document and a new audit record ("Restored from version X") is created.
- **Real-Time Presence vs. Full Collaborative Editing**: Presence indicators use Supabase Realtime Presence to show who is viewing a document. To prevent brittle synchronization without heavy CRDT infrastructure (Yjs), document saves continue to assert row-level permissions with last-write-wins persistence.
- **Server Action for Email Discovery**: Rather than granting public read permissions on `auth.users`, a database trigger populates `public.profiles(id, email)`. The Server Action `lookupRecipientByEmail` strictly searches for matching IDs using standard equality queries without exposing user directories.

---

## 5. Local Installation & Setup

### Prerequisites
- **Node.js**: v18.18+ or v20+
- **npm**: v9+
- **Supabase Account**: Free or Pro tier project (or local Supabase CLI)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/affanraza84/Draftly.git
cd Draftly/draftly
npm install
```

### 2. Environment Variables
Create `.env.local` in `draftly/`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# Either ANON_KEY or PUBLISHABLE_KEY is supported:
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-or-publishable-key
```

> **Security Note**: Never commit `.env.local` or sensitive service role keys to Git.

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## 6. Supabase Setup & Database Migrations

### Applying Migrations
The database migrations are located in `supabase/migrations/`:
1. `20261021230000_document_sharing_and_access_control.sql` (Core documents, sharing, RLS)
2. `20261022010000_document_version_history.sql` (Version history, snapshotting, and restoration)
3. `20261022020000_document_comments.sql` (Anchored comments, resolution, and authorization)

#### Option A: Supabase Dashboard SQL Editor (Recommended)
1. Navigate to your project on [Supabase](https://supabase.com/dashboard).
2. Click **SQL Editor** in the left sidebar.
3. Open or paste the migration files in chronological order.
4. Click **Run**.

#### Option B: Supabase CLI
```bash
supabase db push
# or
supabase migration up
```

### Authentication Configuration
1. In the Supabase Dashboard, go to **Authentication > Providers > Email**.
2. **Development / Smoke Testing Recommendation**: Turn **Confirm email** **OFF**. Supabase free tier rate limits email confirmations to 3–4 per hour; turning off email confirmation allows instant account creation for testing.
3. If email confirmations are enabled for production, configure a custom SMTP provider (e.g., Resend, SendGrid) under **Project Settings > Authentication**.
4. In **Authentication > URL Configuration > Redirect URLs**, add your local URL (`http://localhost:3000/**`) and your production Vercel URL (`https://your-project.vercel.app/**`).

---

## 7. Document Workflows & Sharing Permissions

### Permission Matrix

| Capability | Document Owner | Shared Editor | Shared Viewer | Non-Collaborator / Unauthenticated |
| :--- | :---: | :---: | :---: | :---: |
| **Read Document** | Yes | Yes | Yes | Blocked by RLS |
| **Edit Content & Title** | Yes | Yes | Blocked by UI & RLS | Blocked by RLS |
| **Delete Document** | Yes | Blocked by UI & RLS | Blocked by UI & RLS | Blocked by RLS |
| **Administer Shares (Add / Revoke)** | Yes | Blocked by UI & RLS | Blocked by UI & RLS | Blocked by RLS |
| **Export to Markdown** | Yes | Yes | Yes | Blocked by RLS |
| **View Version History** | Yes | Yes | Yes | Blocked by RLS |
| **Restore Previous Versions** | Yes | Blocked by UI & RLS | Blocked by UI & RLS | Blocked by RLS |
| **View Real-Time Presence** | Yes | Yes | Yes | Blocked by Channel Check |
| **Create & View Comments** | Yes | Yes | Yes | Blocked by RLS |
| **Resolve & Delete Comments** | Yes (All) | Author Only | Author Only | Blocked by RLS |
| **Share Revocation Effect** | Immediate | Immediate | Immediate | N/A |

---

## 8. Automated Testing & Verification

Draftly maintains 78 automated tests executed with Vitest:

```bash
# Run unit and integration tests
npm test

# Run ESLint check
npm run lint

# Run TypeScript type verification
npx tsc --noEmit

# Run Next.js production build
npm run build
```

### Test Suites Overview (78 Tests Across 8 Suites):
1. **Document Import (`tests/document-import.test.ts`)** (17 tests): Tests file extension validation, size limits, whitespace rejection, AST parsing, and mark conversions.
2. **Document Markdown Export (`tests/document-export.test.ts`)** (10 tests): Validates Markdown serialization for headings, marks, underline `<u>` representation, lists, links, blockquotes, code blocks, filename sanitization, and roundtrip import/export fidelity.
3. **Sharing Authorization (`tests/sharing-authorization.test.ts`)** (12 tests): Validates complete role matrix for owners, editors, and viewers, verifying deletion, share administration, and revocation boundaries.
4. **Document Version History (`tests/document-version-history.test.ts`)** (9 tests): Validates monotonic version numbers, duplicate snapshot prevention, owner-only restoration, and audit trail preservation.
5. **Real-Time Presence (`tests/realtime-presence.test.ts`)** (5 tests): Tests avatar initials extraction, color hashing, multi-tab deduplication, and unauthorized access rejection.
6. **Document Comments (`tests/document-comments.test.ts`)** (7 tests): Tests anchored selections, author and owner resolution permissions, deletion restrictions, and empty comment rejections.
7. **Document Management & Validation (`tests/document-management.test.ts`)** (11 tests): Tests title normalization, clamping, empty fallbacks, PostgREST 0-row update detection on revoked permissions, and Tiptap schema mark compatibility.
8. **SQL Policy Verification (`tests/sql-policies.test.ts`)** (7 tests): Confirms security definer search path constraints, table schemas, triggers, and RLS enablement.

---

## 10. Deployment to Vercel

### Step-by-Step Deployment Instructions:
1. Push the code to GitHub:
   ```bash
   git push origin main
   ```
2. Go to [Vercel Dashboard](https://vercel.com/new).
3. Import the `Draftly` repository (`https://github.com/affanraza84/Draftly`).
4. **Project Settings**:
   - **Framework Preset**: Next.js (automatically detected)
   - **Root Directory**: `./` (leave default, or select root containing `package.json`)
   - **Build Command**: `next build`
   - **Output Directory**: `.next`
5. **Environment Variables**:
   Add the following under **Project Settings > Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-project.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: `your-supabase-publishable-key` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
6. Click **Deploy**.
7. Once deployed, copy your production domain (e.g. `https://draftly-demo.vercel.app`) and add it to **Supabase > Authentication > URL Configuration > Redirect URLs**.

### Production URL
- **Deployment Status**: Configured and deployment-ready.
- **Production URL**: `https://draftly-editor.vercel.app` *(or custom Vercel deployment link upon import)*

---

## 11. Reviewer Demo Access Instructions

To test full multi-user authorization and sharing workflows:

1. **Create Three Distinct Accounts**:
   - **Owner Account**: `owner@example.com` / `Password123!`
   - **Editor Account**: `editor@example.com` / `Password123!`
   - **Viewer Account**: `viewer@example.com` / `Password123!`
   *(Note: Ensure email confirmations are disabled in Supabase or confirm email links if enabled).*

2. **Test Steps**:
   - Log in as `owner@example.com`. Create a document or import a `.md` file. Format some text with bold and headers.
   - Click **Share**. Add `editor@example.com` as **Editor**. Add `viewer@example.com` as **Viewer**.
   - Log out. Log in as `editor@example.com`: Verify the document appears in **"Shared with me"** with an `Editor` badge. Edit and save changes. Notice that the "Share" and "Delete" buttons are absent.
   - Log out. Log in as `viewer@example.com`: Open the document. Verify it opens in **View-Only Mode** with the editor and formatting toolbar disabled.
   - Log back in as `owner@example.com`. Click **Share** and revoke access for `editor@example.com`.
   - Switch to `editor@example.com`: Try saving or opening the document. Verify access is blocked at the database boundary.

---

## 12. Known Limitations

1. **Concurrent Real-Time Collaboration**: Draftly is designed as a single-editor document system with last-write-wins persistence. It does not use CRDTs (Yjs) or operational transformation. Simultaneous edits from multiple active tabs will overwrite the earlier save.
2. **Supabase Free Tier Rate Limits**: Supabase's default email service restricts email sending to 3–4 confirmation emails per hour. Disabling email confirmation in Supabase is recommended for testing.
3. **Session Cookies**: Session cookies are scoped to the application origin. Opening multiple browser profiles or incognito windows is recommended when simulating multi-user collaboration simultaneously.
4. **Suggestion Mode Deferred**: Full suggestion mode (tracking inline proposed additions and deletions as reviewable diff overlays) is deferred to protect document structure reliability. Anchored discussions and comments with text selection quoting, author attribution, resolution workflows, and deletion controls are fully implemented and verified.

---

## 13. AI-Native Workflow Note

Draftly was developed and hardened using an AI-native engineering workflow paired with human architectural supervision:

- **Where AI Accelerated Work**:
  - **AST Lexer Mapping**: Rapid generation and refinement of `marked` token AST mapping into Tiptap's strict node/mark schema (`src/lib/document-import.ts`).
  - **PostgreSQL RLS Strategy**: Formulating non-recursive `SECURITY DEFINER` helper functions to avoid Supabase infinite RLS recursion pitfalls.
  - **Automated Test Coverage**: Writing comprehensive Vitest suites covering edge cases (CRLF endings, Unicode characters, oversized files, 0-row update race conditions).
- **What Was Changed or Rejected**:
  - *Rejected Raw HTML Ingestion*: Initial proposals suggested using Tiptap's HTML parser for file imports; this was rejected in favor of AST tokenization to eliminate XSS risks and HTML sanitization overhead.
  - *PostgREST Update Gotcha*: Standard Supabase client updates do not return an error when 0 rows match RLS filter policies; agentic testing caught this false-success behavior and added `.select("id")` verification.
  - *ESLint 9 Flat Config Compatibility*: Next.js 16 flat config requirements required updating `eslint-config-next` to `^16.4.2` to resolve lint module deprecations.
- **Verification Methodology**:
  Every phase was verified using terminal executions (`npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`), guaranteeing that no claimed functionality relies on unverified assertions.
