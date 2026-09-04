/**
 * Copyright (c) 2025 johngbl
 * QwenSofia - OpenAI-compatible proxy for Qwen
 */

export interface ReasoningTagParseResult {
  text: string;
  reasoning: string;
  detectedThinkTag: boolean;
  hadMalformedTag: boolean;
  hadUnclosedTag: boolean;
}

const THINK_OPEN_RE = /<think\b[^>]*>/i;
const THINK_START_LITERAL = "<think>";
const THINK_CLOSE_LITERAL = "</think>";

function findPartialTagIndex(buffer: string, literal: string): number {
  const lower = buffer.toLowerCase();
  for (let i = 1; i < literal.length; i++) {
    if (lower.endsWith(literal.substring(0, i))) {
      return buffer.length - i;
    }
  }

  return -1;
}

function findPartialThinkOpenIndex(buffer: string): number {
  const lower = buffer.toLowerCase();
  const idx = lower.lastIndexOf("<think");
  if (idx !== -1 && lower.indexOf(">", idx) === -1) return idx;
  return findPartialTagIndex(buffer, THINK_START_LITERAL);
}

function findPartialThinkCloseIndex(buffer: string): number {
  return findPartialTagIndex(buffer, THINK_CLOSE_LITERAL);
}

export interface CumulativeReasoningContent {
  content: string;
  detectedOrphanClose: boolean;
}

export function normalizeCumulativeReasoningContent(
  content: string,
): CumulativeReasoningContent {
  const lower = content.toLowerCase();
  const closeIndex = lower.indexOf(THINK_CLOSE_LITERAL);
  const openMatch = content.match(THINK_OPEN_RE);
  const openIndex = openMatch?.index ?? -1;

  if (closeIndex !== -1 && (openIndex === -1 || closeIndex < openIndex)) {
    const before = content.substring(0, closeIndex).trimEnd();
    const after = content
      .substring(closeIndex + THINK_CLOSE_LITERAL.length)
      .trimStart();

    if (!after || after.trim() === before.trim()) {
      return { content: before, detectedOrphanClose: true };
    }

    return { content: after, detectedOrphanClose: true };
  }

  return { content, detectedOrphanClose: false };
}

export class StreamingReasoningTagSanitizer {
  private buffer = "";
  private insideThink = false;
  private currentOpenTag = "";

  discardPendingOrphanClose(): void {
    if (this.insideThink) return;
    const partialCloseIndex = findPartialThinkCloseIndex(this.buffer);
    if (partialCloseIndex !== -1) {
      this.buffer = this.buffer.substring(0, partialCloseIndex);
    }
  }

  feed(chunk: string): ReasoningTagParseResult {
    this.buffer += chunk;
    const result: ReasoningTagParseResult = {
      text: "",
      reasoning: "",
      detectedThinkTag: false,
      hadMalformedTag: false,
      hadUnclosedTag: false,
    };

    while (this.buffer.length > 0) {
      if (!this.insideThink) {
        const openMatch = this.buffer.match(THINK_OPEN_RE);
        const openIndex = openMatch?.index ?? -1;
        const closeIndex = this.buffer
          .toLowerCase()
          .indexOf(THINK_CLOSE_LITERAL);

        if (closeIndex !== -1 && (openIndex === -1 || closeIndex < openIndex)) {
          result.text += this.buffer.substring(0, closeIndex);
          this.buffer = this.buffer.substring(
            closeIndex + THINK_CLOSE_LITERAL.length,
          );
          result.detectedThinkTag = true;
          result.hadMalformedTag = true;
          continue;
        }

        if (openMatch && openIndex !== -1) {
          result.text += this.buffer.substring(0, openIndex);
          this.buffer = this.buffer.substring(openIndex + openMatch[0].length);
          this.currentOpenTag = openMatch[0];
          this.insideThink = true;
          continue;
        }

        const partialOpenIndex = findPartialThinkOpenIndex(this.buffer);
        const partialCloseIndex = findPartialThinkCloseIndex(this.buffer);
        const flushIndex =
          partialOpenIndex === -1
            ? partialCloseIndex === -1
              ? this.buffer.length
              : partialCloseIndex
            : partialCloseIndex === -1
              ? partialOpenIndex
              : Math.min(partialOpenIndex, partialCloseIndex);
        if (flushIndex > 0) {
          result.text += this.buffer.substring(0, flushIndex);
          this.buffer = this.buffer.substring(flushIndex);
        }
        break;
      }

      const closeIndex = this.buffer.toLowerCase().indexOf(THINK_CLOSE_LITERAL);
      if (closeIndex !== -1) {
        result.reasoning += this.buffer.substring(0, closeIndex);
        this.buffer = this.buffer.substring(
          closeIndex + THINK_CLOSE_LITERAL.length,
        );
        this.insideThink = false;
        this.currentOpenTag = "";
        result.detectedThinkTag = true;
        continue;
      }

      break;
    }

    return result;
  }

  flush(): ReasoningTagParseResult {
    const result: ReasoningTagParseResult = {
      text: "",
      reasoning: "",
      detectedThinkTag: false,
      hadMalformedTag: false,
      hadUnclosedTag: false,
    };

    if (!this.buffer) {
      return result;
    }

    if (this.insideThink) {
      result.text = `${this.currentOpenTag}${this.buffer}`;
      result.detectedThinkTag = true;
      result.hadMalformedTag = true;
      result.hadUnclosedTag = true;
    } else {
      const partialCloseIndex = findPartialThinkCloseIndex(this.buffer);
      const partialClose =
        partialCloseIndex === -1
          ? ""
          : this.buffer.substring(partialCloseIndex).toLowerCase();
      if (partialClose.startsWith("</")) {
        result.text = this.buffer.substring(0, partialCloseIndex);
        result.detectedThinkTag = true;
        result.hadMalformedTag = true;
      } else {
        result.text = this.buffer;
      }
    }

    this.buffer = "";
    this.insideThink = false;
    this.currentOpenTag = "";

    return result;
  }
}
