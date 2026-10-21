/**
 * Draftly Markdown Document Exporter
 *
 * Converts Tiptap JSON schema structure into standard Markdown text and triggers
 * safe client-side downloads with sanitized filenames.
 *
 * Formatting Representation:
 * - Headings: # (H1) through ###### (H6)
 * - Paragraphs: Standard text blocks separated by double newlines
 * - Bold: **text**
 * - Italic: *text*
 * - Underline: <u>text</u>
 *   *Note*: The CommonMark specification does not define a native delimiter for underline
 *   to avoid conflict with italics. Underlines are safely serialized using HTML `<u>` tags,
 *   which is fully compliant with CommonMark raw HTML passthrough.
 * - Strikethrough: ~~text~~
 * - Inline Code: `code`
 * - Code Blocks: ```language ... ```
 * - Blockquotes: > quote lines
 * - Bullet Lists: - item
 * - Ordered Lists: 1. item
 * - Links: [label](url)
 * - Horizontal Rule: ---
 */

import type { TiptapDocument, TiptapNode } from "./document-import";

/**
 * Sanitizes a document title for safe use as a file system download name.
 */
export function sanitizeMarkdownFilename(title: string): string {
  const cleanTitle = (title || "").trim();

  // Remove illegal characters: / \ : * ? " < > | and control characters
  const sanitized = cleanTitle
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const baseName = sanitized.slice(0, 80) || "untitled-document";
  return `${baseName}.md`;
}

/**
 * Serializes inline marks (bold, italic, underline, link, code, strike) around text.
 */
function serializeMarks(text: string, marks?: TiptapNode["marks"]): string {
  if (!marks || marks.length === 0 || !text) {
    return text;
  }

  let formatted = text;

  // 1. Inline code (code takes precedence and inner content shouldn't be markdown-escaped)
  const codeMark = marks.find((m) => m.type === "code");
  if (codeMark) {
    return `\`${formatted}\``;
  }

  // 2. Links
  const linkMark = marks.find((m) => m.type === "link");
  if (linkMark && linkMark.attrs?.href) {
    formatted = `[${formatted}](${linkMark.attrs.href})`;
  }

  // 3. Strikethrough
  if (marks.some((m) => m.type === "strike")) {
    formatted = `~~${formatted}~~`;
  }

  // 4. Underline (Standard HTML <u> since CommonMark has no native underline syntax)
  if (marks.some((m) => m.type === "underline")) {
    formatted = `<u>${formatted}</u>`;
  }

  // 5. Italic
  if (marks.some((m) => m.type === "italic")) {
    formatted = `*${formatted}*`;
  }

  // 6. Bold
  if (marks.some((m) => m.type === "bold")) {
    formatted = `**${formatted}**`;
  }

  return formatted;
}

/**
 * Serializes inline children of a block node.
 */
function serializeInlineNodes(nodes?: TiptapNode[]): string {
  if (!nodes || nodes.length === 0) return "";
  return nodes
    .map((child) => {
      if (child.type === "text") {
        return serializeMarks(child.text || "", child.marks);
      }
      if (child.type === "hardBreak") {
        return "  \n";
      }
      return "";
    })
    .join("");
}

/**
 * Serializes list item nodes recursively with proper indentation.
 */
function serializeListItems(
  items: TiptapNode[],
  isOrdered: boolean,
  indent = 0
): string {
  const indentStr = "  ".repeat(indent);
  let result = "";

  items.forEach((item, index) => {
    const prefix = isOrdered ? `${index + 1}. ` : "- ";
    if (!item.content || item.content.length === 0) {
      result += `${indentStr}${prefix}\n`;
      return;
    }

    item.content.forEach((block, blockIndex) => {
      if (block.type === "paragraph") {
        const text = serializeInlineNodes(block.content);
        if (blockIndex === 0) {
          result += `${indentStr}${prefix}${text}\n`;
        } else {
          result += `${indentStr}  ${text}\n`;
        }
      } else if (block.type === "bulletList") {
        result += serializeListItems(block.content || [], false, indent + 1);
      } else if (block.type === "orderedList") {
        result += serializeListItems(block.content || [], true, indent + 1);
      }
    });
  });

  return result;
}

/**
 * Converts a Tiptap JSON document into standard CommonMark text.
 */
export function convertTiptapToMarkdown(doc: TiptapDocument | Record<string, unknown>): string {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) {
    return "";
  }

  const nodes = doc.content as TiptapNode[];
  const chunks: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = typeof node.attrs?.level === "number" ? Math.min(Math.max(node.attrs.level, 1), 6) : 1;
        const text = serializeInlineNodes(node.content);
        chunks.push(`${"#".repeat(level)} ${text}`);
        break;
      }

      case "paragraph": {
        const text = serializeInlineNodes(node.content);
        chunks.push(text);
        break;
      }

      case "bulletList": {
        const listText = serializeListItems(node.content || [], false).trimEnd();
        if (listText) chunks.push(listText);
        break;
      }

      case "orderedList": {
        const listText = serializeListItems(node.content || [], true).trimEnd();
        if (listText) chunks.push(listText);
        break;
      }

      case "blockquote": {
        const quoteContent = (node.content || [])
          .map((child) => {
            if (child.type === "paragraph") {
              return `> ${serializeInlineNodes(child.content)}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n>\n");
        if (quoteContent) chunks.push(quoteContent);
        break;
      }

      case "codeBlock": {
        const language = (typeof node.attrs?.language === "string" ? node.attrs.language : "") || "";
        const codeText = (node.content || [])
          .map((child) => child.text || "")
          .join("");
        chunks.push(`\`\`\`${language}\n${codeText}\n\`\`\``);
        break;
      }

      case "horizontalRule": {
        chunks.push("---");
        break;
      }

      default: {
        // Fallback for unknown block nodes: attempt inline serialization if content exists
        if (node.content) {
          const text = serializeInlineNodes(node.content);
          if (text) chunks.push(text);
        }
        break;
      }
    }
  }

  // Join block chunks with blank lines, ensuring clean trailing newline
  return chunks.join("\n\n").trimEnd() + "\n";
}

/**
 * Triggers a browser file download of the Markdown content.
 */
export function triggerMarkdownDownload(content: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Markdown download can only be triggered in a browser environment.");
  }

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
