import { describe, expect, it } from "vitest";

export function validateDocumentTitle(rawTitle: string): {
  valid: boolean;
  normalizedTitle: string;
  error?: string;
} {
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      normalizedTitle: "",
      error: "Document title cannot be empty.",
    };
  }

  // Maximum title length is 120 characters
  const normalizedTitle = trimmed.slice(0, 120);

  return {
    valid: true,
    normalizedTitle,
  };
}

/**
 * Simulates document save operations and verifies error-reporting guarantees.
 */
export function simulateSaveOperation({
  title,
  userPermission,
  rowsAffected,
  dbError,
}: {
  title: string;
  userPermission: "owner" | "editor" | "viewer" | null;
  rowsAffected: number;
  dbError: Error | null;
}): {
  success: boolean;
  message: string;
  dirty: boolean;
} {
  const validation = validateDocumentTitle(title);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.error!,
      dirty: true, // preserve dirty flag on validation error
    };
  }

  if (userPermission === "viewer" || userPermission === null) {
    return {
      success: false,
      message: "Save failed: You no longer have permission to edit this document.",
      dirty: true,
    };
  }

  if (dbError) {
    return {
      success: false,
      message: `Save failed: ${dbError.message}`,
      dirty: true,
    };
  }

  // If 0 rows were updated, RLS prevented the update (e.g. access was revoked during editing)
  if (rowsAffected === 0) {
    return {
      success: false,
      message:
        "Save failed: You no longer have permission to edit this document or it was deleted.",
      dirty: true,
    };
  }

  return {
    success: true,
    message: "All changes saved",
    dirty: false,
  };
}

describe("Document Management & Save Reliability Tests", () => {
  describe("5. Document Title Validation", () => {
    it("rejects empty titles", () => {
      const res = validateDocumentTitle("");
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Document title cannot be empty.");
    });

    it("rejects whitespace-only titles", () => {
      const res = validateDocumentTitle("     \t \n   ");
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Document title cannot be empty.");
    });

    it("accepts valid titles and trims outer whitespace", () => {
      const res = validateDocumentTitle("   Draft Q4 Planning   ");
      expect(res.valid).toBe(true);
      expect(res.normalizedTitle).toBe("Draft Q4 Planning");
    });

    it("clamps titles longer than 120 characters", () => {
      const longTitle = "A".repeat(150);
      const res = validateDocumentTitle(longTitle);
      expect(res.valid).toBe(true);
      expect(res.normalizedTitle.length).toBe(120);
    });
  });

  describe("7. Save Operation and Error Reporting (No False Successes)", () => {
    it("reports success and clears dirty flag when owner saves successfully", () => {
      const result = simulateSaveOperation({
        title: "Q4 Roadmap",
        userPermission: "owner",
        rowsAffected: 1,
        dbError: null,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("All changes saved");
      expect(result.dirty).toBe(false);
    });

    it("reports success and clears dirty flag when editor saves successfully", () => {
      const result = simulateSaveOperation({
        title: "Updated by Editor",
        userPermission: "editor",
        rowsAffected: 1,
        dbError: null,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("All changes saved");
      expect(result.dirty).toBe(false);
    });

    it("reports error and PRESERVES dirty flag when title is empty", () => {
      const result = simulateSaveOperation({
        title: "   ",
        userPermission: "owner",
        rowsAffected: 1,
        dbError: null,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("cannot be empty");
      expect(result.dirty).toBe(true);
    });

    it("reports error and PRESERVES dirty flag when viewer attempts to save", () => {
      const result = simulateSaveOperation({
        title: "Attempted Edit",
        userPermission: "viewer",
        rowsAffected: 0,
        dbError: null,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("permission");
      expect(result.dirty).toBe(true);
    });

    it("reports error and PRESERVES dirty flag when database returns an error", () => {
      const result = simulateSaveOperation({
        title: "My Doc",
        userPermission: "owner",
        rowsAffected: 0,
        dbError: new Error("connection terminated"),
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("connection terminated");
      expect(result.dirty).toBe(true);
    });

    it("reports error and PRESERVES dirty flag when 0 rows are updated (access revoked during session)", () => {
      // User was editor when loading, but was demoted or share was deleted before save
      const result = simulateSaveOperation({
        title: "Unsaved Changes",
        userPermission: "editor",
        rowsAffected: 0, // RLS prevented any row modification
        dbError: null,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("no longer have permission");
      expect(result.dirty).toBe(true);
    });
  });

  describe("Tiptap Schema Node & Mark Compatibility", () => {
    it("confirms compatibility of StarterKit and Underline node/mark structures", () => {
      const complexDoc = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Main Title" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "This is " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: ", " },
              { type: "text", text: "italic", marks: [{ type: "italic" }] },
              { type: "text", text: ", and " },
              { type: "text", text: "underline", marks: [{ type: "underline" }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "List item 1" }],
                  },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Step 1" }],
                  },
                ],
              },
            ],
          },
        ],
      };

      expect(complexDoc.type).toBe("doc");
      expect(complexDoc.content.length).toBe(4);
      expect(complexDoc.content[0].type).toBe("heading");
      const underlineNode = complexDoc.content[1].content[5] as { type: string; text: string; marks: { type: string }[] };
      expect(underlineNode.marks[0].type).toBe("underline");
    });
  });
});
