# Draftly - Document Sharing & Access Control (Phase 3)

Draftly is a lightweight full-stack document editor built with Next.js App Router, Supabase PostgreSQL, Supabase Auth, Tailwind CSS, and Tiptap.

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

Automated tests are powered by Vitest and cover all highest-risk authorization scenarios and schema requirements:

```bash
npm test
```

### Covered Test Cases:
1. An owner can share a document with another user.
2. A recipient can read a shared document.
3. A viewer cannot update a shared document (RLS rejection).
4. An editor can update a shared document.
5. A recipient cannot share a document with a third user.
6. A user without access cannot read a private document.
7. Revoking a share removes the recipient's access immediately.
8. Only the owner can delete a document.
9. Preventing document owners from sharing with themselves.
10. SQL migration schema, constraints, indexes, triggers, and RLS policy verification.

### Type & Lint Verification:
```bash
npm run lint
npx tsc --noEmit
npm run build
```

---

## Manual Smoke Testing Procedure

To manually test the end-to-end sharing workflow with two distinct user accounts:

1. **User A (Owner) Setup**:
   - Open [http://localhost:3000](http://localhost:3000) in Browser 1.
   - Create an account: `alice@example.com` / `password123`.
   - Create a new document: "Quarterly Strategy".
   - Add rich-text content in the editor and click **Save**.

2. **User B (Collaborator) Setup**:
   - Open an Incognito/Private window (Browser 2).
   - Create an account: `bob@example.com` / `password123`.
   - Verify `bob@example.com` has an empty dashboard.

3. **Share as Viewer**:
   - In Alice's browser, open "Quarterly Strategy" and click **Share**.
   - Enter `bob@example.com`, select **Viewer**, and click **Share**.
   - In Bob's browser, refresh the dashboard.
   - Verify "Quarterly Strategy" appears under **Shared with me** with a **Viewer** badge and Alice's email.
   - Open the document as Bob: verify content is visible, but the title and editor are read-only, formatting toolbar is hidden, and no Save/Share buttons are present.

4. **Promote to Editor**:
   - In Alice's Share Dialog, change Bob's permission from **Viewer** to **Editor**.
   - In Bob's browser, refresh: verify the role badge updates to **Editor**, editing is enabled, and the **Save** button is active.
   - Bob modifies content and clicks **Save**: verify changes persist.

5. **Revoke Access**:
   - In Alice's Share Dialog, click the trash icon next to Bob's name to revoke access.
   - In Bob's browser, refresh: verify the document is no longer listed under **Shared with me**, and direct navigation displays an unauthorized access message.
