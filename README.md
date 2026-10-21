# Draftly - Full-Stack Document Editor

Draftly is a lightweight full-stack document editor built with Next.js App Router, Supabase PostgreSQL, Supabase Auth, Tailwind CSS, and Tiptap.

---

## Phase 4: TXT and Markdown Document Import

Phase 4 adds client-side file upload and AST-based conversion for `.txt` and `.md` files directly into Draftly's Tiptap document format.

### Features
1. **Import File Action**:
   - Located on the main dashboard within the "Create a document" section.
   - Allows users to select `.txt` and `.md` (or `.markdown`) files.
   - Enforces a maximum file size of 1 MB before reading content.
   - Derives document title from the filename without extension (clamped to 120 characters).
2. **Safe Conversion to Tiptap JSON**:
   - **TXT**: Splits lines into native Tiptap paragraph blocks while preserving Unicode, blank lines, and whitespace without executing HTML.
   - **Markdown**: Uses `marked` token AST (without rendering raw HTML) to generate typed Tiptap nodes:
     - Headings (H1 to H6)
     - Paragraphs
     - Bulleted lists (`bulletList` > `listItem`)
     - Numbered lists (`orderedList` > `listItem`)
     - Bold (`strong`), Italic (`em`), and inline code (`code`) marks
     - Blockquotes and code blocks
3. **Reliability & Validation**:
   - Validates file extension, size, and readable content.
   - Rejects empty, whitespace-only, or oversized files with accessible error alerts.
   - Does not silently create empty documents on failure.
   - Resets the file picker on error so users can immediately retry or choose another file.
   - On successful database insertion, navigates directly to `/documents/[id]`.

---

## Phase 3: Document Sharing & Access Control

Phase 3 introduces granular document sharing and robust, database-enforced Row Level Security (RLS) policies.

### Core Features

1. **Owner-Only Sharing Administration**:
   - Owners can open the **Share Dialog** directly from the document editor.
   - Collaborators can be added by email with either **Viewer** or **Editor** permission.
   - Owners can dynamically promote/demote collaborator permissions or revoke access instantly.
   - Owners cannot add themselves as recipients (enforced by a database trigger).

2. **Database-Enforced Access Control (RLS)**:
   - **Viewers**: Can read documents; all editing, title changes, saving, and sharing administration are disabled and blocked by database RLS.
   - **Editors**: Can read, edit, and save document content and titles; cannot administer shares or delete documents.
   - **Owners**: Full administrative control (view, edit, rename, share, delete).
   - **Non-Collaborators**: Cannot read or modify private documents even with a direct ID.
   - **No Circular RLS Recursion**: Security definer helper functions (`is_document_owner`, `has_document_access`, `can_edit_document`) with `SET search_path = public` prevent infinite RLS recursion.

3. **Secure Recipient Discovery**:
   - Authenticated Server Action (`lookupRecipientByEmail`) validates email against a synchronized `public.profiles` table.
   - No direct client access to `auth.users`, protecting personal data and preventing enumeration of accounts.

4. **Split Dashboard**:
   - **My Documents**: Lists documents owned by the current user.
   - **Shared With Me**: Displays documents shared with the current user, along with the owner's email, updated timestamp, and role badge (`Viewer` / `Editor`).

---

## Database Migration

The database schema and policies are defined in:
`supabase/migrations/20261021230000_document_sharing_and_access_control.sql`

### How to Apply the Migration

#### Option A: Supabase Dashboard SQL Editor
1. Open your project on [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Open or copy the contents of `supabase/migrations/20261021230000_document_sharing_and_access_control.sql`.
4. Click **Run**.

#### Option B: Supabase CLI
```bash
supabase db push
# or
supabase migration up
```

---

## Running the Application

### 1. Environment Setup
Create a `.env.local` file with your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Automated Testing

Automated tests are powered by Vitest and cover all highest-risk authorization scenarios, file import parsers, and schema requirements:

```bash
npm test
```

### Covered Test Suites:
1. **Document Import & Conversion (`tests/document-import.test.ts`)**:
   - Valid `.txt` and `.md` file acceptance.
   - Rejection of unsupported extensions (`.docx`, `.pdf`, `.js`).
   - Rejection of oversized files (> 1 MB) and empty files.
   - Title derivation and 120-character truncation.
   - TXT paragraph conversion with Unicode and CRLF line ending normalization.
   - Markdown headings (H1–H6), bullet lists, ordered lists, bold, italic, code, blockquotes, and code blocks.
   - Rejection of whitespace-only files.
2. **Sharing Authorization (`tests/sharing-authorization.test.ts`)**:
   - Owner sharing, recipient reading, viewer update prevention, editor updates, recipient sharing rejection, non-collaborator denial, revocation, and owner-only deletion.
3. **Database Schema & Policies (`tests/sql-policies.test.ts`)**:
   - Migration tables, indexes, constraints, triggers, and RLS policies.

### Type & Lint Verification:
```bash
npm run lint
npx tsc --noEmit
npm run build
```
