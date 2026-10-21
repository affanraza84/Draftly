import { describe, expect, it } from "vitest";
import {
  convertMarkdownToTiptap,
  convertTxtToTiptap,
  parseImportContent,
  validateImportFile,
  MAX_FILE_SIZE_BYTES,
} from "../src/lib/document-import";

describe("Document Import & Conversion Tests", () => {
  describe("File Validation", () => {
    it("accepts valid .txt files", () => {
      const res = validateImportFile({ name: "notes.txt", size: 1024 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.extension).toBe("txt");
        expect(res.title).toBe("notes");
      }
    });

    it("accepts valid .md files", () => {
      const res = validateImportFile({ name: "README.md", size: 2048 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.extension).toBe("md");
        expect(res.title).toBe("README");
      }
    });

    it("rejects unsupported extensions (e.g. .docx, .pdf, .png)", () => {
      const docx = validateImportFile({ name: "document.docx", size: 1024 });
      expect(docx.valid).toBe(false);
      if (!docx.valid) {
        expect(docx.error).toContain("Unsupported file format");
      }

      const pdf = validateImportFile({ name: "report.pdf", size: 1024 });
      expect(pdf.valid).toBe(false);

      const js = validateImportFile({ name: "malicious.js", size: 1024 });
      expect(js.valid).toBe(false);
    });

    it("rejects oversized files exceeding 1 MB", () => {
      const oversized = validateImportFile({
        name: "big.txt",
        size: MAX_FILE_SIZE_BYTES + 1,
      });
      expect(oversized.valid).toBe(false);
      if (!oversized.valid) {
        expect(oversized.error).toContain("File size exceeds");
      }
    });

    it("rejects empty files (0 bytes)", () => {
      const empty = validateImportFile({ name: "empty.txt", size: 0 });
      expect(empty.valid).toBe(false);
      if (!empty.valid) {
        expect(empty.error).toContain("empty");
      }
    });

    it("normalizes long document titles to 120 characters", () => {
      const longName = "a".repeat(150) + ".md";
      const res = validateImportFile({ name: longName, size: 50 });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.title.length).toBe(120);
      }
    });
  });

  describe("TXT Conversion", () => {
    it("converts plain text lines into paragraph nodes", () => {
      const text = "First line\nSecond line\n\nThird paragraph after blank";
      const tiptapDoc = convertTxtToTiptap(text);

      expect(tiptapDoc.type).toBe("doc");
      expect(tiptapDoc.content.length).toBe(4);
      expect(tiptapDoc.content[0].type).toBe("paragraph");
      expect(tiptapDoc.content[0].content?.[0].text).toBe("First line");
      expect(tiptapDoc.content[1].content?.[0].text).toBe("Second line");
      expect(tiptapDoc.content[2].type).toBe("paragraph"); // empty line
      expect(tiptapDoc.content[3].content?.[0].text).toBe("Third paragraph after blank");
    });

    it("preserves Unicode and international text", () => {
      const unicodeText = "Hello 世界 🌍\nCafé & naïve résumé\nالعربية";
      const tiptapDoc = convertTxtToTiptap(unicodeText);

      expect(tiptapDoc.content[0].content?.[0].text).toBe("Hello 世界 🌍");
      expect(tiptapDoc.content[1].content?.[0].text).toBe("Café & naïve résumé");
      expect(tiptapDoc.content[2].content?.[0].text).toBe("العربية");
    });

    it("handles Windows CRLF and classic Mac CR line endings", () => {
      const crlfText = "Line 1\r\nLine 2\rLine 3";
      const tiptapDoc = convertTxtToTiptap(crlfText);

      expect(tiptapDoc.content.length).toBe(3);
      expect(tiptapDoc.content[0].content?.[0].text).toBe("Line 1");
      expect(tiptapDoc.content[1].content?.[0].text).toBe("Line 2");
      expect(tiptapDoc.content[2].content?.[0].text).toBe("Line 3");
    });
  });

  describe("Markdown Conversion", () => {
    it("converts headings of various depths (H1 to H6)", () => {
      const md = "# Heading 1\n## Heading 2\n### Heading 3";
      const tiptapDoc = convertMarkdownToTiptap(md);

      expect(tiptapDoc.content[0]).toEqual({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Heading 1" }],
      });

      expect(tiptapDoc.content[1]).toEqual({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Heading 2" }],
      });

      expect(tiptapDoc.content[2]).toEqual({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Heading 3" }],
      });
    });

    it("converts bulleted and numbered lists into correct nodes", () => {
      const md = "- Item Alpha\n- Item Beta\n\n1. First ordered\n2. Second ordered";
      const tiptapDoc = convertMarkdownToTiptap(md);

      // Bullet List
      const bulletList = tiptapDoc.content[0];
      expect(bulletList.type).toBe("bulletList");
      expect(bulletList.content?.length).toBe(2);
      expect(bulletList.content?.[0].type).toBe("listItem");
      expect(bulletList.content?.[0].content?.[0].type).toBe("paragraph");
      expect(bulletList.content?.[0].content?.[0].content?.[0].text).toBe("Item Alpha");

      // Ordered List
      const orderedList = tiptapDoc.content[1];
      expect(orderedList.type).toBe("orderedList");
      expect(orderedList.content?.length).toBe(2);
      expect(orderedList.content?.[0].type).toBe("listItem");
      expect(orderedList.content?.[0].content?.[0].content?.[0].text).toBe("First ordered");
    });

    it("converts bold, italic, and inline code marks", () => {
      const md = "This has **bold text**, *italic text*, and `inline code`.";
      const tiptapDoc = convertMarkdownToTiptap(md);

      const paragraph = tiptapDoc.content[0];
      expect(paragraph.type).toBe("paragraph");

      const inlines = paragraph.content ?? [];
      const boldNode = inlines.find((n) => n.marks?.some((m) => m.type === "bold"));
      const italicNode = inlines.find((n) => n.marks?.some((m) => m.type === "italic"));
      const codeNode = inlines.find((n) => n.marks?.some((m) => m.type === "code"));

      expect(boldNode?.text).toBe("bold text");
      expect(italicNode?.text).toBe("italic text");
      expect(codeNode?.text).toBe("inline code");
    });

    it("converts blockquotes and code blocks", () => {
      const md = "> This is a quote\n\n```typescript\nconst x = 42;\n```";
      const tiptapDoc = convertMarkdownToTiptap(md);

      expect(tiptapDoc.content[0].type).toBe("blockquote");
      expect(tiptapDoc.content[0].content?.[0].content?.[0].text).toBe("This is a quote");

      expect(tiptapDoc.content[1].type).toBe("codeBlock");
      expect(tiptapDoc.content[1].attrs?.language).toBe("typescript");
      expect(tiptapDoc.content[1].content?.[0].text).toBe("const x = 42;");
    });
  });

  describe("End-to-End parseImportContent Validation", () => {
    it("successfully parses valid Markdown file", () => {
      const res = parseImportContent("spec.md", "# Product Spec\n\n- Feature 1\n- Feature 2");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.title).toBe("spec");
        expect(res.content_json.type).toBe("doc");
        expect(res.content_json.content.length).toBe(2);
      }
    });

    it("successfully parses valid TXT file", () => {
      const res = parseImportContent("journal.txt", "Today was productive.\nDid lots of work.");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.title).toBe("journal");
        expect(res.content_json.type).toBe("doc");
      }
    });

    it("rejects files with only whitespace", () => {
      const res = parseImportContent("empty.md", "   \n\n   \t  ");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("no readable content");
      }
    });

    it("rejects unsupported extensions", () => {
      const res = parseImportContent("script.sh", "echo 'hello'");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("Unsupported file format");
      }
    });
  });
});
