import { marked, type Token, type Tokens } from "marked";

export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB limit
export const MAX_TITLE_LENGTH = 120;

export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};

/**
 * Validates file metadata before reading the file body.
 */
export function validateImportFile(file: { name: string; size: number }): {
  valid: true;
  extension: "txt" | "md";
  title: string;
} | {
  valid: false;
  error: string;
} {
  if (!file || !file.name) {
    return { valid: false, error: "No file was selected." };
  }

  // File size check
  if (file.size === 0) {
    return { valid: false, error: "The selected file is empty." };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the 1 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  // Extension check
  const lowerName = file.name.toLowerCase();
  let extension: "txt" | "md" | null = null;

  if (lowerName.endsWith(".txt")) {
    extension = "txt";
  } else if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    extension = "md";
  }

  if (!extension) {
    return {
      valid: false,
      error: "Unsupported file format. Draftly supports .txt and .md files.",
    };
  }

  // Derive document title
  const rawTitle = file.name.substring(0, file.name.lastIndexOf(".")).trim();
  const normalizedTitle = (rawTitle || "Untitled document").substring(0, MAX_TITLE_LENGTH);

  return {
    valid: true,
    extension,
    title: normalizedTitle,
  };
}

/**
 * Converts raw text into a valid Tiptap document.
 * Splits on newlines and converts each chunk into paragraph nodes.
 */
export function convertTxtToTiptap(rawText: string): TiptapDocument {
  // Normalize Windows \r\n and old Mac \r into \n
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = normalized.split("\n");
  const paragraphs: TiptapNode[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      // Empty paragraph for blank lines
      paragraphs.push({ type: "paragraph" });
    } else {
      paragraphs.push({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      });
    }
  }

  // Ensure at least one paragraph exists
  if (paragraphs.length === 0) {
    paragraphs.push({ type: "paragraph" });
  }

  return {
    type: "doc",
    content: paragraphs,
  };
}

/**
 * Recursively parses marked inline tokens into Tiptap text nodes with marks.
 */
function parseInlineTokens(
  tokens?: Token[],
  activeMarks: TiptapMark[] = []
): TiptapNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: TiptapNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const textToken = token as Tokens.Text;
        if (textToken.tokens && textToken.tokens.length > 0) {
          nodes.push(...parseInlineTokens(textToken.tokens, activeMarks));
        } else if (textToken.text && textToken.text.length > 0) {
          nodes.push({
            type: "text",
            text: textToken.text,
            ...(activeMarks.length > 0 ? { marks: [...activeMarks] } : {}),
          });
        }
        break;
      }

      case "strong": {
        const strongToken = token as Tokens.Strong;
        const marksWithBold: TiptapMark[] = [...activeMarks, { type: "bold" }];
        if (strongToken.tokens && strongToken.tokens.length > 0) {
          nodes.push(...parseInlineTokens(strongToken.tokens, marksWithBold));
        } else if (strongToken.text) {
          nodes.push({
            type: "text",
            text: strongToken.text,
            marks: marksWithBold,
          });
        }
        break;
      }

      case "em": {
        const emToken = token as Tokens.Em;
        const marksWithItalic: TiptapMark[] = [...activeMarks, { type: "italic" }];
        if (emToken.tokens && emToken.tokens.length > 0) {
          nodes.push(...parseInlineTokens(emToken.tokens, marksWithItalic));
        } else if (emToken.text) {
          nodes.push({
            type: "text",
            text: emToken.text,
            marks: marksWithItalic,
          });
        }
        break;
      }

      case "codespan": {
        const codeToken = token as Tokens.Codespan;
        nodes.push({
          type: "text",
          text: codeToken.text,
          marks: [...activeMarks, { type: "code" }],
        });
        break;
      }

      case "link": {
        const linkToken = token as Tokens.Link;
        const linkMarks: TiptapMark[] = [
          ...activeMarks,
          { type: "link", attrs: { href: linkToken.href, target: "_blank" } },
        ];
        if (linkToken.tokens && linkToken.tokens.length > 0) {
          nodes.push(...parseInlineTokens(linkToken.tokens, linkMarks));
        } else if (linkToken.text) {
          nodes.push({
            type: "text",
            text: linkToken.text,
            marks: linkMarks,
          });
        }
        break;
      }

      case "escape": {
        const escToken = token as Tokens.Escape;
        nodes.push({
          type: "text",
          text: escToken.text,
          ...(activeMarks.length > 0 ? { marks: [...activeMarks] } : {}),
        });
        break;
      }

      default: {
        // Fallback to raw text if token has raw/text representation
        const rawText = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (rawText && rawText.length > 0) {
          nodes.push({
            type: "text",
            text: rawText,
            ...(activeMarks.length > 0 ? { marks: [...activeMarks] } : {}),
          });
        }
        break;
      }
    }
  }

  return nodes;
}

/**
 * Converts Markdown string into a structured Tiptap JSON document.
 * Supports headings, paragraphs, bold, italic, bullet lists, ordered lists, blockquotes, and code blocks.
 */
export function convertMarkdownToTiptap(markdown: string): TiptapDocument {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tokens = marked.lexer(normalized);

  const blockNodes: TiptapNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const headingToken = token as Tokens.Heading;
        const inlines = parseInlineTokens(headingToken.tokens);
        blockNodes.push({
          type: "heading",
          attrs: { level: Math.min(Math.max(headingToken.depth, 1), 6) },
          ...(inlines.length > 0 ? { content: inlines } : {}),
        });
        break;
      }

      case "paragraph": {
        const paragraphToken = token as Tokens.Paragraph;
        const inlines = parseInlineTokens(paragraphToken.tokens);
        blockNodes.push({
          type: "paragraph",
          ...(inlines.length > 0 ? { content: inlines } : {}),
        });
        break;
      }

      case "list": {
        const listToken = token as Tokens.List;
        const listType = listToken.ordered ? "orderedList" : "bulletList";
        const items: TiptapNode[] = [];

        for (const item of listToken.items) {
          const itemInlines = parseInlineTokens(item.tokens);
          // In Tiptap schema, listItem content must be block nodes (usually paragraph)
          const itemContent: TiptapNode[] = [];

          if (itemInlines.length > 0) {
            itemContent.push({
              type: "paragraph",
              content: itemInlines,
            });
          } else {
            itemContent.push({ type: "paragraph" });
          }

          items.push({
            type: "listItem",
            content: itemContent,
          });
        }

        blockNodes.push({
          type: listType,
          content: items,
        });
        break;
      }

      case "blockquote": {
        const blockquoteToken = token as Tokens.Blockquote;
        const inlines = parseInlineTokens(blockquoteToken.tokens);
        blockNodes.push({
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              ...(inlines.length > 0 ? { content: inlines } : {}),
            },
          ],
        });
        break;
      }

      case "code": {
        const codeToken = token as Tokens.Code;
        blockNodes.push({
          type: "codeBlock",
          ...(codeToken.lang ? { attrs: { language: codeToken.lang } } : {}),
          content: [{ type: "text", text: codeToken.text }],
        });
        break;
      }

      case "hr": {
        blockNodes.push({ type: "horizontalRule" });
        break;
      }

      case "space": {
        // Ignore whitespace separator tokens
        break;
      }

      default: {
        const rawText = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (rawText && rawText.trim().length > 0) {
          blockNodes.push({
            type: "paragraph",
            content: [{ type: "text", text: rawText.trim() }],
          });
        }
        break;
      }
    }
  }

  // Fallback to empty paragraph if document has no blocks
  if (blockNodes.length === 0) {
    blockNodes.push({ type: "paragraph" });
  }

  return {
    type: "doc",
    content: blockNodes,
  };
}

/**
 * Validates, parses, and converts an uploaded file's content into a new document payload.
 */
export function parseImportContent(
  filename: string,
  rawContent: string
): {
  success: true;
  title: string;
  content_json: TiptapDocument;
} | {
  success: false;
  error: string;
} {
  if (!rawContent || rawContent.trim().length === 0) {
    return {
      success: false,
      error: "The file contains no readable content.",
    };
  }

  const validation = validateImportFile({
    name: filename,
    size: Buffer.byteLength(rawContent, "utf-8"),
  });

  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    let content_json: TiptapDocument;

    if (validation.extension === "txt") {
      content_json = convertTxtToTiptap(rawContent);
    } else {
      content_json = convertMarkdownToTiptap(rawContent);
    }

    return {
      success: true,
      title: validation.title,
      content_json,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse document: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
