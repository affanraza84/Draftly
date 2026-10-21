import { describe, expect, it } from "vitest";
import {
  convertTiptapToMarkdown,
  sanitizeMarkdownFilename,
} from "../src/lib/document-export";
import { parseImportContent } from "../src/lib/document-import";

describe("Document Markdown Export", () => {
  it("sanitizes filenames correctly for download", () => {
    expect(sanitizeMarkdownFilename("My Great Document")).toBe("My-Great-Document.md");
    expect(sanitizeMarkdownFilename("Illegal: / \\ ? * < > | Chars")).toBe("Illegal-Chars.md");
    expect(sanitizeMarkdownFilename("   ")).toBe("untitled-document.md");
    expect(sanitizeMarkdownFilename("///???***")).toBe("untitled-document.md");
    expect(sanitizeMarkdownFilename("Notes 2026---Draft")).toBe("Notes-2026-Draft.md");
  });

  it("converts headings correctly", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Main Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subtitle" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Section" }],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("# Main Title");
    expect(markdown).toContain("## Subtitle");
    expect(markdown).toContain("### Section");
  });

  it("converts paragraphs and formatted inline text (bold, italic, strike, code)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Here is " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: " and " },
            { type: "text", text: "inline code", marks: [{ type: "code" }] },
            { type: "text", text: " and " },
            { type: "text", text: "struck", marks: [{ type: "strike" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("Here is **bold** and *italic* and `inline code` and ~~struck~~.\n");
  });

  it("safely serializes underline formatting using standard HTML <u> tag", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This text is " },
            { type: "text", text: "underlined", marks: [{ type: "underline" }] },
            { type: "text", text: " for emphasis." },
          ],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("This text is <u>underlined</u> for emphasis.\n");
  });

  it("combines multiple marks on the same text range", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Bold Underline",
              marks: [{ type: "bold" }, { type: "underline" }],
            },
          ],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("**<u>Bold Underline</u>**");
  });

  it("converts links properly", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Visit " },
            {
              type: "text",
              text: "Draftly",
              marks: [{ type: "link", attrs: { href: "https://draftly.app" } }],
            },
          ],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("Visit [Draftly](https://draftly.app)");
  });

  it("converts bullet lists and ordered lists", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item A" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item B" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
            },
          ],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("- Item A\n- Item B");
    expect(markdown).toContain("1. First\n2. Second");
  });

  it("converts blockquotes and code blocks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Simplicity is prerequisite for reliability." }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const status = 'active';" }],
        },
      ],
    };

    const markdown = convertTiptapToMarkdown(doc);
    expect(markdown).toContain("> Simplicity is prerequisite for reliability.");
    expect(markdown).toContain("```typescript\nconst status = 'active';\n```");
  });

  it("handles empty or invalid documents gracefully", () => {
    expect(convertTiptapToMarkdown({} as never)).toBe("");
    expect(convertTiptapToMarkdown({ type: "doc", content: [] })).toBe("\n");
  });

  it("verifies roundtrip import and export consistency", () => {
    const inputMarkdown = `# Project Overview

This is an **important** document for our team.

- Task 1
- Task 2

> Note: Keep it lightweight!
`;

    const parsed = parseImportContent("overview.md", inputMarkdown);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const exportedMarkdown = convertTiptapToMarkdown(parsed.content_json);
    expect(exportedMarkdown).toContain("# Project Overview");
    expect(exportedMarkdown).toContain("This is an **important** document for our team.");
    expect(exportedMarkdown).toContain("- Task 1\n- Task 2");
    expect(exportedMarkdown).toContain("> Note: Keep it lightweight!");
  });
});
