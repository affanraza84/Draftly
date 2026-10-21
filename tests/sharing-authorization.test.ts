import { beforeEach, describe, expect, it } from "vitest";

// Types simulating database rows
type Document = {
  id: string;
  owner_id: string;
  title: string;
  content_json: Record<string, unknown>;
};

type DocumentShare = {
  id: string;
  document_id: string;
  shared_with_user_id: string;
  permission: "viewer" | "editor";
};

/**
 * Pure authorization evaluation engine that mirrors the PostgreSQL Row Level Security (RLS)
 * policies defined in supabase/migrations/20261021230000_document_sharing_and_access_control.sql
 */
class RLSAuthorizationEngine {
  private documents: Map<string, Document> = new Map();
  private shares: Map<string, DocumentShare> = new Map();

  // Helper function: public.is_document_owner(doc_id, user_id)
  isDocumentOwner(docId: string, userId: string): boolean {
    const doc = this.documents.get(docId);
    return doc !== undefined && doc.owner_id === userId;
  }

  // Helper function: public.has_document_access(doc_id, user_id)
  hasDocumentAccess(docId: string, userId: string): boolean {
    if (this.isDocumentOwner(docId, userId)) return true;
    for (const share of this.shares.values()) {
      if (share.document_id === docId && share.shared_with_user_id === userId) {
        return true;
      }
    }
    return false;
  }

  // Helper function: public.can_edit_document(doc_id, user_id)
  canEditDocument(docId: string, userId: string): boolean {
    if (this.isDocumentOwner(docId, userId)) return true;
    for (const share of this.shares.values()) {
      if (
        share.document_id === docId &&
        share.shared_with_user_id === userId &&
        share.permission === "editor"
      ) {
        return true;
      }
    }
    return false;
  }

  addDocument(doc: Document) {
    this.documents.set(doc.id, doc);
  }

  // Operation: SELECT on documents
  // RLS: owner_id = auth.uid() OR public.has_document_access(id, auth.uid())
  readDocument(actorId: string, docId: string): Document {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error("Document not found");
    }

    if (!this.hasDocumentAccess(docId, actorId)) {
      throw new Error("42501: Insufficient privileges (RLS violation)");
    }

    return { ...doc };
  }

  // Operation: UPDATE on documents
  // RLS: public.can_edit_document(id, auth.uid())
  updateDocument(actorId: string, docId: string, updates: Partial<Document>): Document {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error("Document not found");
    }

    if (!this.canEditDocument(docId, actorId)) {
      throw new Error("42501: Insufficient privileges to update document");
    }

    const updated = { ...doc, ...updates };
    this.documents.set(docId, updated);
    return updated;
  }

  // Operation: DELETE on documents
  // RLS: owner_id = auth.uid()
  deleteDocument(actorId: string, docId: string): void {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error("Document not found");
    }

    if (doc.owner_id !== actorId) {
      throw new Error("42501: Only the document owner can delete the document");
    }

    this.documents.delete(docId);
    // Cascade delete shares
    for (const [shareId, share] of Array.from(this.shares.entries())) {
      if (share.document_id === docId) {
        this.shares.delete(shareId);
      }
    }
  }

  // Operation: INSERT on document_shares
  // RLS: public.is_document_owner(document_id, auth.uid())
  // Trigger: check_share_not_owner (prevents owner adding self)
  createShare(
    actorId: string,
    docId: string,
    recipientId: string,
    permission: "viewer" | "editor"
  ): DocumentShare {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error("Document not found");
    }

    // Trigger check
    if (doc.owner_id === recipientId) {
      throw new Error("Document owner cannot be added as a share recipient.");
    }

    // RLS policy check
    if (!this.isDocumentOwner(docId, actorId)) {
      throw new Error("42501: Only document owner can create a share");
    }

    // Unique constraint (document_id, shared_with_user_id)
    for (const share of this.shares.values()) {
      if (share.document_id === docId && share.shared_with_user_id === recipientId) {
        throw new Error("23505: Duplicate share constraint violation");
      }
    }

    const newShare: DocumentShare = {
      id: `share-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      document_id: docId,
      shared_with_user_id: recipientId,
      permission,
    };

    this.shares.set(newShare.id, newShare);
    return newShare;
  }

  // Operation: UPDATE on document_shares
  // RLS: public.is_document_owner(document_id, auth.uid())
  updateSharePermission(
    actorId: string,
    shareId: string,
    newPermission: "viewer" | "editor"
  ): DocumentShare {
    const share = this.shares.get(shareId);
    if (!share) {
      throw new Error("Share not found");
    }

    if (!this.isDocumentOwner(share.document_id, actorId)) {
      throw new Error("42501: Only document owner can update share permissions");
    }

    const updated = { ...share, permission: newPermission };
    this.shares.set(shareId, updated);
    return updated;
  }

  // Operation: DELETE on document_shares
  // RLS: public.is_document_owner(document_id, auth.uid())
  revokeShare(actorId: string, shareId: string): void {
    const share = this.shares.get(shareId);
    if (!share) {
      throw new Error("Share not found");
    }

    if (!this.isDocumentOwner(share.document_id, actorId)) {
      throw new Error("42501: Only document owner can revoke a share");
    }

    this.shares.delete(shareId);
  }
}

describe("Document Sharing & Access Control Authorization Tests", () => {
  let db: RLSAuthorizationEngine;

  const userOwner = "user-owner-uuid-1111";
  const userRecipient = "user-recipient-uuid-2222";
  const userUnrelated = "user-unrelated-uuid-3333";

  const docA: Document = {
    id: "doc-uuid-aaaa",
    owner_id: userOwner,
    title: "Project Roadmap",
    content_json: { type: "doc", content: [{ type: "paragraph", text: "Phase 3 goals" }] },
  };

  beforeEach(() => {
    db = new RLSAuthorizationEngine();
    db.addDocument(docA);
  });

  // Test 1: An owner can share a document with another user
  it("1. An owner can share a document with another user", () => {
    const share = db.createShare(userOwner, docA.id, userRecipient, "viewer");
    expect(share).toBeDefined();
    expect(share.shared_with_user_id).toBe(userRecipient);
    expect(share.permission).toBe("viewer");
  });

  // Test 2: A recipient can read a shared document
  it("2. A recipient can read a shared document", () => {
    db.createShare(userOwner, docA.id, userRecipient, "viewer");
    const readResult = db.readDocument(userRecipient, docA.id);
    expect(readResult).toBeDefined();
    expect(readResult.title).toBe("Project Roadmap");
  });

  // Test 3: A viewer cannot update the shared document
  it("3. A viewer cannot update the shared document", () => {
    db.createShare(userOwner, docA.id, userRecipient, "viewer");

    expect(() =>
      db.updateDocument(userRecipient, docA.id, { title: "Hacked Title" })
    ).toThrow("42501: Insufficient privileges to update document");

    // Verify title remains unchanged
    const doc = db.readDocument(userOwner, docA.id);
    expect(doc.title).toBe("Project Roadmap");
  });

  // Test 4: An editor can update the shared document
  it("4. An editor can update the shared document", () => {
    const share = db.createShare(userOwner, docA.id, userRecipient, "viewer");

    // Owner promotes recipient to editor
    db.updateSharePermission(userOwner, share.id, "editor");

    // Recipient updates document
    const updated = db.updateDocument(userRecipient, docA.id, {
      title: "Updated by Editor",
    });

    expect(updated.title).toBe("Updated by Editor");
    expect(db.readDocument(userOwner, docA.id).title).toBe("Updated by Editor");
  });

  // Test 5: A recipient cannot share the document with a third user
  it("5. A recipient cannot share the document with a third user", () => {
    db.createShare(userOwner, docA.id, userRecipient, "editor");

    // Even with editor permission, recipient cannot grant access to third party
    expect(() =>
      db.createShare(userRecipient, docA.id, userUnrelated, "viewer")
    ).toThrow("42501: Only document owner can create a share");
  });

  // Test 6: A user without access cannot read a private document
  it("6. A user without access cannot read a private document", () => {
    expect(() => db.readDocument(userUnrelated, docA.id)).toThrow(
      "42501: Insufficient privileges (RLS violation)"
    );
  });

  // Test 7: Revoking a share removes the recipient's access
  it("7. Revoking a share removes the recipient's access", () => {
    const share = db.createShare(userOwner, docA.id, userRecipient, "editor");

    // Recipient can initially read
    expect(db.readDocument(userRecipient, docA.id).title).toBe("Project Roadmap");

    // Owner revokes access
    db.revokeShare(userOwner, share.id);

    // Recipient can no longer read
    expect(() => db.readDocument(userRecipient, docA.id)).toThrow(
      "42501: Insufficient privileges (RLS violation)"
    );

    // Recipient can no longer update
    expect(() =>
      db.updateDocument(userRecipient, docA.id, { title: "Late Edit" })
    ).toThrow();
  });

  // Test 8: Only the owner can delete a document
  it("8. Only the owner can delete a document", () => {
    db.createShare(userOwner, docA.id, userRecipient, "editor");

    // Recipient cannot delete document
    expect(() => db.deleteDocument(userRecipient, docA.id)).toThrow(
      "42501: Only the document owner can delete the document"
    );

    // Owner can delete document
    db.deleteDocument(userOwner, docA.id);
    expect(() => db.readDocument(userOwner, docA.id)).toThrow("Document not found");
  });

  // Test 9: Viewers and editors cannot delete documents
  it("9. Viewers cannot delete documents", () => {
    db.createShare(userOwner, docA.id, userRecipient, "viewer");
    expect(() => db.deleteDocument(userRecipient, docA.id)).toThrow(
      "42501: Only the document owner can delete the document"
    );
  });

  // Test 10: Editors cannot change recipient permissions
  it("10. Editors cannot change recipient permissions or administer sharing", () => {
    const share1 = db.createShare(userOwner, docA.id, userRecipient, "editor");
    const share2 = db.createShare(userOwner, docA.id, userUnrelated, "viewer");

    // Editor attempts to promote viewer to editor
    expect(() =>
      db.updateSharePermission(userRecipient, share2.id, "editor")
    ).toThrow("42501: Only document owner can update share permissions");

    // Editor attempts to revoke another share
    expect(() => db.revokeShare(userRecipient, share2.id)).toThrow(
      "42501: Only document owner can revoke a share"
    );

    // Editor attempts to revoke their own share via owner endpoint
    expect(() => db.revokeShare(userRecipient, share1.id)).toThrow(
      "42501: Only document owner can revoke a share"
    );
  });

  // Test 11: Viewers cannot change permissions or revoke shares
  it("11. Viewers cannot change permissions or revoke shares", () => {
    const share1 = db.createShare(userOwner, docA.id, userRecipient, "viewer");
    const share2 = db.createShare(userOwner, docA.id, userUnrelated, "editor");

    expect(() =>
      db.updateSharePermission(userRecipient, share2.id, "viewer")
    ).toThrow("42501: Only document owner can update share permissions");

    expect(() => db.revokeShare(userRecipient, share1.id)).toThrow(
      "42501: Only document owner can revoke a share"
    );
  });

  // Extra Test: Owner cannot add self as recipient (prevented by trigger)
  it("prevents owner from adding themselves as a share recipient", () => {
    expect(() =>
      db.createShare(userOwner, docA.id, userOwner, "editor")
    ).toThrow("Document owner cannot be added as a share recipient.");
  });
});
