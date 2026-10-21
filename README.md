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
- **Granular Document Sharing**:
  - Modal dialog to invite collaborators by email as **Editor** or **Viewer**.
  - Recipient email lookup powered by an authenticated Server Action against a synchronized `public.profiles` table (preventing account enumeration).
  - Instant role updates (promote/demote) and access revocation.
  - Anti-self-share trigger preventing owners from sharing documents with themselves.
- **Dual Dashboard**: Split view organizing documents into "My Documents" (with Delete & Share actions) and "Shared with me" (with role badge and owner email).
- **Navigation Safety**: `beforeunload` warning when closing or navigating away with unsaved edits.

---

## 3. Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict mode enabled)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Editor**: [Tiptap](https://tiptap.dev/) (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`)
- **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, Auth, Row Level Security)
- **Client Libraries**: `@supabase/supabase-js`, `@supabase/ssr`
- **Markdown AST Tokenizer**: [marked](https://marked.js.org/)
- **Testing Framework**: [Vitest](https://vitest.dev/) (4 test suites, 44 unit & integration tests)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 4. Architecture & Tradeoffs

- **PostgreSQL Row Level Security (RLS)**: Access control is enforced at the database layer rather than relying solely on UI button hiding. Custom `SECURITY DEFINER` helper functions (`is_document_owner`, `has_document_access`, `can_edit_document`) use a fixed `SET search_path = public` to avoid infinite recursion and prevent search-path hijacking.
- **Tiptap JSONB Persistence**: Rather than saving raw HTML (which exposes XSS vectors and requires sanitization), Draftly stores structured Tiptap JSON in PostgreSQL `jsonb` columns. This guarantees clean serializability, backward compatibility, and native client rehydration.
- **AST-Based File Import**: Markdown conversion tokenizes input with `marked.lexer()` into an Abstract Syntax Tree (AST) before constructing Tiptap schema objects. This bypasses the need for `dangerouslySetInnerHTML` and prevents script injection.
- **Concurrency Model (Last-Write-Wins)**: To keep the architecture robust without operational transformation (OT) or complex CRDT overhead, Draftly operates on a single-active-editor model. To safeguard against silent data loss, save operations chain `.select("id")` and assert affected rows; if an editor's permissions are revoked while their tab is open, they receive an immediate explicit error instead of a false success message.
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
The complete database migration is located in:
`supabase/migrations/20261021230000_document_sharing_and_access_control.sql`

#### Option A: Supabase Dashboard SQL Editor (Recommended)
1. Navigate to your project on [Supabase](https://supabase.com/dashboard).
2. Click **SQL Editor** in the left sidebar.
3. Open or paste `supabase/migrations/20261021230000_document_sharing_and_access_control.sql`.
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
| **Share Revocation Effect** | Immediate | Immediate | Immediate | N/A |

---

## 8. Supported File Import Formats & Limits

- **Supported Formats**: Plain text (`.txt`), Markdown (`.md`, `.markdown`).
- **File Size Limit**: 1 MB (strictly checked before file reading).
- **Title Sanitization**: Extracted from filename, stripped of extension, and truncated to 120 characters.
- **Conversion Capabilities**:
  - Headings 1 through 6
  - Paragraphs and blockquotes
  - Bulleted lists (`bulletList` > `listItem`)
  - Numbered lists (`orderedList` > `listItem`)
  - Inline formatting: **bold**, *italic*, and `inline code`
  - Code blocks
- **Error Handling**: Non-text, oversized, empty, or whitespace-only files produce descriptive UI error alerts without creating invalid records.

---

## 9. Automated Testing & Verification

Draftly maintains 44 automated tests executed with Vitest:

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

### Test Suites Overview:
1. **Document Import (`tests/document-import.test.ts`)** (17 tests): Tests file extension validation, size limits, whitespace rejection, AST parsing, and mark conversions.
2. **Sharing Authorization (`tests/sharing-authorization.test.ts`)** (9 tests): Validates RLS rule logic for owners, editors, viewers, and non-collaborators, verifying write and share prohibitions.
3. **Document Management & Validation (`tests/document-management.test.ts`)** (11 tests): Tests title normalization, clamping, empty fallbacks, PostgREST 0-row update detection on revoked permissions, and Tiptap schema mark compatibility.
4. **SQL Policy Verification (`tests/sql-policies.test.ts`)** (7 tests): Confirms security definer search path constraints, table schemas, triggers, and RLS enablement.

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
