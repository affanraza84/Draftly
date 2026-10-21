# Draftly - Full-Stack Document Editor

Draftly is a lightweight full-stack document editor built with Next.js App Router, Supabase PostgreSQL, Supabase Auth, Tailwind CSS, and Tiptap.

---

## Prerequisites

- **Node.js**: v18.18+ or v20+ recommended
- **Package Manager**: npm 9+
- **Supabase Account / Project**: Free or Pro Supabase project (or local Supabase CLI)

---

## Installation & Setup

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/affanraza84/Draftly.git
cd Draftly/draftly
npm install
```

### 2. Environment Variables

Create `.env.local` in the `draftly` directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# Either ANON_KEY or PUBLISHABLE_KEY is supported:
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-or-publishable-key
```

> **Security Note**: Never commit `.env.local` or service role keys to source control.

---

## Supabase & Database Setup

### 1. Database Migrations

Apply the migration to initialize `profiles`, `document_shares`, security definer functions, triggers, and Row Level Security (RLS) policies:

- **Migration File**: `supabase/migrations/20261021230000_document_sharing_and_access_control.sql`

#### How to Apply:
1. Open your project on the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** in the left sidebar.
3. Paste the contents of `supabase/migrations/20261021230000_document_sharing_and_access_control.sql`.
4. Click **Run**.

Alternatively, with Supabase CLI:
```bash
supabase db push
# or
supabase migration up
```

### 2. Authentication Configuration

For development and testing environments:
1. Go to **Authentication > Providers > Email** in the Supabase Dashboard.
2. We recommend turning **Confirm email** **OFF** during development to avoid hitting Supabase's built-in email rate limit (3–4 confirmation emails per hour on the free tier).
3. If email confirmation is enabled, configure a custom SMTP provider (e.g. Resend, SendGrid) under **Project Settings > Authentication**.

---

## Document Workflows & Permissions

### Document Sharing & Access Control Matrix

| Capability | Document Owner | Shared Editor | Shared Viewer | Non-Collaborator / Unauthenticated |
| :--- | :---: | :---: | :---: | :---: |
| **Read Document** | Yes | Yes | Yes | Blocked by RLS |
| **Edit Content & Title** | Yes | Yes | Blocked by UI & RLS | Blocked by RLS |
| **Delete Document** | Yes | Blocked by UI & RLS | Blocked by UI & RLS | Blocked by RLS |
| **Administer Shares** | Yes | Blocked by UI & RLS | Blocked by UI & RLS | Blocked by RLS |
| **Share Revocation** | Immediate | Immediate | Immediate | N/A |

### RLS Implementation Details
- Row Level Security is enabled on `public.documents`, `public.document_shares`, and `public.profiles`.
- Helper functions (`is_document_owner`, `has_document_access`, `can_edit_document`) use `SECURITY DEFINER` and a strict `SET search_path = public` to avoid infinite RLS recursion and search path spoofing.
- A database trigger `check_share_not_owner` prevents document owners from adding themselves as share recipients.
- Client save operations verify that affected database rows are returned; permission revocations produce actionable errors rather than false success messages.

---

## File Import Specifications

Draftly supports importing files directly into editable documents from the dashboard:

- **Supported Formats**: Plain text (`.txt`), Markdown (`.md`, `.markdown`).
- **File Size Limit**: 1 MB (enforced before reading or transmitting file content).
- **Title Derivation**: Derived from the sanitized file basename and clamped to 120 characters.
- **Conversion Safety**: Uses token-based AST parsing (via `marked`) rather than raw HTML rendering to protect against XSS:
  - Preserves H1–H6 headings, paragraphs, blockquotes, and code blocks.
  - Converts bulleted (`bulletList`) and numbered (`orderedList`) lists.
  - Preserves inline marks: **bold**, *italic*, and `inline code`.
- **Validation**: Empty and whitespace-only files are rejected with user-visible errors.

---

## Testing & Quality Assurance

Draftly includes automated test suites covering authorization, import AST parsing, title validation, and schema definitions.

### Running Automated Tests

```bash
npm test
```

### Test Suites:
1. **Document Import (`tests/document-import.test.ts`)**:
   - Validates `.txt` and `.md` file imports.
   - Tests file extension rejection (`.docx`, `.pdf`, `.js`).
   - Verifies 1 MB size limit enforcement.
   - Validates Markdown AST conversion to Tiptap nodes and inline marks.
2. **Sharing Authorization (`tests/sharing-authorization.test.ts`)**:
   - Verifies permission enforcement for Owner, Editor, Viewer, and Non-collaborator.
   - Verifies that viewers cannot write or save.
   - Verifies that editors cannot administer shares.
   - Validates immediate effect of share revocation.
3. **Document Management & Validation (`tests/document-management.test.ts`)**:
   - Title normalization and 120-character clamping.
   - Handling of empty titles with safe fallbacks (`"Untitled Document"`).
   - Database update failure detection (detecting 0-row updates on revoked access).
   - Tiptap JSON schema structure validation for bold, italic, underline, headings, and lists.
4. **SQL Policy Verification (`tests/sql-policies.test.ts`)**:
   - Asserts non-recursive security definer function definitions.
   - Asserts strict `search_path` configuration on database functions.
   - Asserts RLS policies for `documents` and `document_shares`.

### Linting & Type Checking

```bash
# ESLint check
npm run lint

# TypeScript verification
npx tsc --noEmit

# Production build verification
npm run build
```

---

## Known Limitations & Architecture Notes

1. **Concurrent Editing**: Draftly operates on a single-editor document model with last-write-wins persistence. It does not implement real-time collaborative editing (CRDT / Yjs) or revision trees.
2. **Supabase Free Tier Rate Limits**: The default Supabase auth email provider has a rate limit of ~3 signups per hour. To avoid errors during local testing, disable email confirmations or configure custom SMTP.
3. **Session Persistence**: Sessions are maintained in browser cookies and local storage via `@supabase/ssr`. Logging out terminates access and redirects to the login screen.

---

## Deployment Prerequisites

Before deploying to Vercel or any hosting provider:
1. Ensure the PostgreSQL migration has been executed on your Supabase production database.
2. Set the environment variables in the hosting provider dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
3. Set your production domain in Supabase **Authentication > URL Configuration > Redirect URLs**.
