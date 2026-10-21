import { beforeEach, describe, expect, it } from "vitest";

type DocumentRecord = {
  id: string;
  owner_id: string;
  title: string;
  content_json: Record<string, unknown>;
};

type DocumentVersion = {
  id: string;
  document_id: string;
  version_number: number;
  title: string;
  content_json: Record<string, unknown>;
  change_summary: string;
  created_by: string;
  created_at: string;
};

type SharePermission = "viewer" | "editor";

class VersionHistoryEngine {
  public documents: Map<string, DocumentRecord> = new Map();
  public versions: Map<string, DocumentVersion> = new Map();
  public shares: Map<string, { document_id: string; shared_with_user_id: string; permission: SharePermission }> = new Map();

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

  createVersionSnapshot(
    actorId: string,
    docId: string,
    title: string,
    contentJson: Record<string, unknown>,
    summary = "Manual save"
  ): DocumentVersion {
    const doc = this.documents.get(docId);
    if (!doc) throw new Error("Document not found");

    if (!this.canEditDocument(docId, actorId)) {
      throw new Error("42501: Insufficient privileges to create version snapshot");
    }

    // Get latest version
    const docVersions = Array.from(this.versions.values())
      .filter((v) => v.document_id === docId)
      .sort((a, b) => b.version_number - a.version_number);

    const latest = docVersions[0];
    if (
      latest &&
      latest.title === title &&
      JSON.stringify(latest.content_json) === JSON.stringify(contentJson)
    ) {
      // Duplicate prevention: skip creating duplicate sequential version
      return latest;
    }

    const nextVer = (latest?.version_number ?? 0) + 1;
    const version: DocumentVersion = {
      id: `ver-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      document_id: docId,
      version_number: nextVer,
      title,
      content_json: contentJson,
      change_summary: summary,
      created_by: actorId,
      created_at: new Date().toISOString(),
    };

    this.versions.set(version.id, version);
    return version;
  }

  listVersions(actorId: string, docId: string): DocumentVersion[] {
    if (!this.hasDocumentAccess(docId, actorId)) {
      throw new Error("42501: Insufficient privileges to view document versions");
    }

    return Array.from(this.versions.values())
      .filter((v) => v.document_id === docId)
      .sort((a, b) => b.version_number - a.version_number);
  }

  restoreVersion(actorId: string, docId: string, versionNumber: number): DocumentRecord {
    const doc = this.documents.get(docId);
    if (!doc) throw new Error("Document not found");

    // Only owner can restore versions
    if (!this.isDocumentOwner(docId, actorId)) {
      throw new Error("42501: Only document owner can restore historical versions");
    }

    const targetVersion = Array.from(this.versions.values()).find(
      (v) => v.document_id === docId && v.version_number === versionNumber
    );

    if (!targetVersion) {
      throw new Error("Target version not found");
    }

    // Update document live record
    doc.title = targetVersion.title;
    doc.content_json = targetVersion.content_json;

    // Create a restoration snapshot preserving audit trail
    this.createVersionSnapshot(
      actorId,
      docId,
      targetVersion.title,
      targetVersion.content_json,
      `Restored from version ${versionNumber}`
    );

    return { ...doc };
  }
}

describe("Document Version History Tests", () => {
  let engine: VersionHistoryEngine;
  const owner = "user-owner-1";
  const editor = "user-editor-2";
  const viewer = "user-viewer-3";
  const outsider = "user-outsider-4";

  const docId = "doc-test-123";

  beforeEach(() => {
    engine = new VersionHistoryEngine();
    engine.documents.set(docId, {
      id: docId,
      owner_id: owner,
      title: "Initial Title",
      content_json: { type: "doc", content: [{ type: "paragraph", text: "V1" }] },
    });

    engine.shares.set("share-editor", {
      document_id: docId,
      shared_with_user_id: editor,
      permission: "editor",
    });

    engine.shares.set("share-viewer", {
      document_id: docId,
      shared_with_user_id: viewer,
      permission: "viewer",
    });
  });

  it("1. Owner can create version snapshots with incrementing version numbers", () => {
    const v1 = engine.createVersionSnapshot(owner, docId, "Title 1", { type: "doc" }, "Initial");
    expect(v1.version_number).toBe(1);

    const v2 = engine.createVersionSnapshot(owner, docId, "Title 2", { type: "doc" }, "Edited");
    expect(v2.version_number).toBe(2);
  });

  it("2. Prevents duplicate sequential snapshots with identical content and title", () => {
    const v1 = engine.createVersionSnapshot(owner, docId, "Same", { type: "doc" }, "Initial");
    const v2 = engine.createVersionSnapshot(owner, docId, "Same", { type: "doc" }, "Repeat");

    expect(v1.id).toBe(v2.id);
    expect(v2.version_number).toBe(1);
    expect(engine.listVersions(owner, docId)).toHaveLength(1);
  });

  it("3. Editors can create snapshots when saving changes", () => {
    const v1 = engine.createVersionSnapshot(editor, docId, "Editor Title", { type: "doc", text: "New" });
    expect(v1.version_number).toBe(1);
    expect(v1.created_by).toBe(editor);
  });

  it("4. Viewers cannot create version snapshots", () => {
    expect(() =>
      engine.createVersionSnapshot(viewer, docId, "Attempt", { type: "doc" })
    ).toThrow("42501: Insufficient privileges to create version snapshot");
  });

  it("5. Viewers, editors, and owners can read version history", () => {
    engine.createVersionSnapshot(owner, docId, "V1", { type: "doc" });
    engine.createVersionSnapshot(owner, docId, "V2", { type: "doc", text: "2" });

    expect(engine.listVersions(owner, docId)).toHaveLength(2);
    expect(engine.listVersions(editor, docId)).toHaveLength(2);
    expect(engine.listVersions(viewer, docId)).toHaveLength(2);
  });

  it("6. Outsiders cannot read version history", () => {
    expect(() => engine.listVersions(outsider, docId)).toThrow(
      "42501: Insufficient privileges to view document versions"
    );
  });

  it("7. Owner can restore a previous version and preserves full audit trail", () => {
    engine.createVersionSnapshot(owner, docId, "Original Title", { type: "doc", val: 1 });
    engine.createVersionSnapshot(owner, docId, "Changed Title", { type: "doc", val: 2 });

    expect(engine.listVersions(owner, docId)).toHaveLength(2);

    // Owner restores version 1
    const restoredDoc = engine.restoreVersion(owner, docId, 1);
    expect(restoredDoc.title).toBe("Original Title");
    expect(restoredDoc.content_json).toEqual({ type: "doc", val: 1 });

    // Verify audit trail has 3 versions now
    const history = engine.listVersions(owner, docId);
    expect(history).toHaveLength(3);
    expect(history[0].version_number).toBe(3);
    expect(history[0].change_summary).toBe("Restored from version 1");
  });

  it("8. Editors cannot restore historical versions", () => {
    engine.createVersionSnapshot(owner, docId, "V1", { type: "doc" });
    expect(() => engine.restoreVersion(editor, docId, 1)).toThrow(
      "42501: Only document owner can restore historical versions"
    );
  });

  it("9. Viewers cannot restore historical versions", () => {
    engine.createVersionSnapshot(owner, docId, "V1", { type: "doc" });
    expect(() => engine.restoreVersion(viewer, docId, 1)).toThrow(
      "42501: Only document owner can restore historical versions"
    );
  });
});
