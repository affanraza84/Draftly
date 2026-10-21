import { beforeEach, describe, expect, it } from "vitest";

type CommentAnchor = {
  from: number;
  to: number;
  quote: string;
};

type DocumentComment = {
  id: string;
  document_id: string;
  author_id: string;
  body: string;
  anchor_data: CommentAnchor;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

class DocumentCommentsEngine {
  public documents = new Map<string, { id: string; owner_id: string; title: string }>();
  public shares = new Map<string, { document_id: string; shared_with_user_id: string; permission: string }>();
  public comments = new Map<string, DocumentComment>();

  isDocumentOwner(docId: string, userId: string): boolean {
    const doc = this.documents.get(docId);
    return doc !== undefined && doc.owner_id === userId;
  }

  hasDocumentAccess(docId: string, userId: string): boolean {
    if (this.isDocumentOwner(docId, userId)) return true;
    for (const share of this.shares.values()) {
      if (share.document_id === docId && share.shared_with_user_id === userId) {
        return true;
      }
    }
    return false;
  }

  createComment(
    actorId: string,
    docId: string,
    body: string,
    anchor: CommentAnchor
  ): DocumentComment {
    if (!this.hasDocumentAccess(docId, actorId)) {
      throw new Error("42501: Insufficient privileges to comment on this document");
    }

    if (!body.trim()) {
      throw new Error("Comment body cannot be empty");
    }

    const comment: DocumentComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      document_id: docId,
      author_id: actorId,
      body: body.trim(),
      anchor_data: anchor,
      resolved_at: null,
      resolved_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.comments.set(comment.id, comment);
    return comment;
  }

  listComments(actorId: string, docId: string): DocumentComment[] {
    if (!this.hasDocumentAccess(docId, actorId)) {
      throw new Error("42501: Insufficient privileges to view comments on this document");
    }

    return Array.from(this.comments.values())
      .filter((c) => c.document_id === docId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  resolveComment(actorId: string, commentId: string): DocumentComment {
    const comment = this.comments.get(commentId);
    if (!comment) throw new Error("Comment not found");

    const isOwner = this.isDocumentOwner(comment.document_id, actorId);
    const isAuthor = comment.author_id === actorId;

    if (!isOwner && !isAuthor) {
      throw new Error("42501: Only author or document owner can resolve this comment");
    }

    comment.resolved_at = new Date().toISOString();
    comment.resolved_by = actorId;
    comment.updated_at = new Date().toISOString();
    return comment;
  }

  deleteComment(actorId: string, commentId: string): void {
    const comment = this.comments.get(commentId);
    if (!comment) throw new Error("Comment not found");

    const isOwner = this.isDocumentOwner(comment.document_id, actorId);
    const isAuthor = comment.author_id === actorId;

    if (!isOwner && !isAuthor) {
      throw new Error("42501: Only author or document owner can delete this comment");
    }

    this.comments.delete(commentId);
  }
}

describe("Document Comments Authorization and Anchor Tests", () => {
  let engine: DocumentCommentsEngine;
  const owner = "user-owner-1";
  const editor = "user-editor-2";
  const viewer = "user-viewer-3";
  const outsider = "user-outsider-4";
  const docId = "doc-alpha-1";

  beforeEach(() => {
    engine = new DocumentCommentsEngine();
    engine.documents.set(docId, { id: docId, owner_id: owner, title: "Design Spec" });
    engine.shares.set("share-ed", { document_id: docId, shared_with_user_id: editor, permission: "editor" });
    engine.shares.set("share-vw", { document_id: docId, shared_with_user_id: viewer, permission: "viewer" });
  });

  it("1. Authorized collaborator can create an anchored comment with text selection", () => {
    const anchor = { from: 10, to: 25, quote: "lightweight editor" };
    const comment = engine.createComment(editor, docId, "Should we support plugin extensions?", anchor);

    expect(comment.id).toBeDefined();
    expect(comment.author_id).toBe(editor);
    expect(comment.anchor_data.quote).toBe("lightweight editor");
    expect(comment.resolved_at).toBeNull();
  });

  it("2. Owner, editor, and viewer can read comments on the document", () => {
    const anchor = { from: 0, to: 5, quote: "Title" };
    engine.createComment(editor, docId, "Nice title", anchor);

    expect(engine.listComments(owner, docId)).toHaveLength(1);
    expect(engine.listComments(editor, docId)).toHaveLength(1);
    expect(engine.listComments(viewer, docId)).toHaveLength(1);
  });

  it("3. Unauthorized users cannot read or create comments on private documents", () => {
    expect(() =>
      engine.createComment(outsider, docId, "Spam", { from: 0, to: 1, quote: "x" })
    ).toThrow("42501: Insufficient privileges to comment on this document");

    expect(() => engine.listComments(outsider, docId)).toThrow(
      "42501: Insufficient privileges to view comments on this document"
    );
  });

  it("4. Comment author can resolve their own comment", () => {
    const comment = engine.createComment(editor, docId, "Fix typo", { from: 5, to: 10, quote: "typo" });
    const resolved = engine.resolveComment(editor, comment.id);

    expect(resolved.resolved_at).not.toBeNull();
    expect(resolved.resolved_by).toBe(editor);
  });

  it("5. Document owner can resolve or delete any comment on their document", () => {
    const comment = engine.createComment(editor, docId, "Please review", { from: 0, to: 4, quote: "Test" });
    const resolved = engine.resolveComment(owner, comment.id);
    expect(resolved.resolved_by).toBe(owner);

    engine.deleteComment(owner, comment.id);
    expect(engine.listComments(owner, docId)).toHaveLength(0);
  });

  it("6. Non-owner collaborator cannot delete someone else's comment", () => {
    const comment = engine.createComment(editor, docId, "Editor thought", { from: 1, to: 2, quote: "a" });
    expect(() => engine.deleteComment(viewer, comment.id)).toThrow(
      "42501: Only author or document owner can delete this comment"
    );
  });

  it("7. Rejects empty comments", () => {
    expect(() =>
      engine.createComment(editor, docId, "   ", { from: 0, to: 0, quote: "" })
    ).toThrow("Comment body cannot be empty");
  });
});
