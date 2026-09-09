/**
 * Copyright (c) 2025 johngbl
 * QwenSofia - OpenAI-compatible proxy for Qwen
 */

import { config } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { summarizeMessages } from "../utils/context-summarizer.ts";
import type { Message } from "../utils/types.ts";
import { estimateThreadTextTokens } from "./thread-context-estimator.ts";
import {
  getLatestThreadContextSummary,
  getRecentThreadContextTurns,
  getThreadContextSession,
  getUnsummarizedThreadContextTurns,
  insertThreadContextSummary,
  setThreadContextStatus,
  type ThreadContextSummary,
  type ThreadContextTurn,
} from "./thread-context-store.ts";

const CONTINUATION_SUMMARY_PROMPT = `You are creating a continuation summary for a long-running coding assistant conversation.

The summary will be injected into a fresh Qwen chat so the assistant can continue without access to the previous Qwen thread.

Preserve all information needed to continue accurately. Be structured, technical, and detailed. Do not omit important details just to be brief.

Include:

1. User goals and preferences
2. Current project/repository context
3. Work completed so far
4. Important files, APIs, endpoints, payloads, data models, state machines
5. Decisions made and why
6. Bugs/errors encountered and fixes attempted
7. Tool calls/results that matter
8. Open risks, assumptions, and uncertainties
9. Recent conversation state
10. Exact next best step
11. Continuation instructions

Return only the continuation summary.`;

function roleLabel(role: string): string {
  return role === "assistant" ? "Assistant" : role === "user" ? "User" : role;
}

function turnToConversationLine(turn: ThreadContextTurn): string {
  return `${roleLabel(turn.role)}: ${turn.content}`;
}

function compactTurnToConversationLine(turn: ThreadContextTurn): string {
  const content = turn.content || "";
  return `${roleLabel(turn.role)}: ${content}`;
}

function dedupeTurns(turns: ThreadContextTurn[]): ThreadContextTurn[] {
  const seen = new Set<number>();
  const result: ThreadContextTurn[] = [];
  for (const turn of turns) {
    if (seen.has(turn.id)) continue;
    seen.add(turn.id);
    result.push(turn);
  }
  result.sort((a, b) => a.id - b.id);
  return result;
}

function buildSummaryInputMessages(params: {
  previousSummary: ThreadContextSummary | null;
  newTurns: ThreadContextTurn[];
  anchorTurns: ThreadContextTurn[];
}): Message[] {
  const parts: string[] = [];

  if (params.previousSummary) {
    parts.push(
      `<previous_cumulative_summary>\n${params.previousSummary.summary}\n</previous_cumulative_summary>`,
    );
  } else {
    parts.push(
      "<previous_cumulative_summary>\nNone yet.\n</previous_cumulative_summary>",
    );
  }

  const turns = dedupeTurns([...params.newTurns, ...params.anchorTurns]);

  parts.push(
    `<conversation_turns_to_fold>\n${turns
      .map((turn) => compactTurnToConversationLine(turn))
      .join("\n\n")}\n</conversation_turns_to_fold>`,
  );

  parts.push(
    "Create a new cumulative continuation summary that contains everything important from the previous summary plus the new turns. The result must be self-contained. If any turn was compacted, preserve the visible important facts and explicitly mention that raw detail was compacted.",
  );

  return [
    {
      role: "user",
      content: parts.join("\n\n"),
    },
  ];
}

function isUsableSummary(summary: string): boolean {
  const trimmed = summary.trim();
  return !!trimmed && !trimmed.startsWith("[Summary unavailable");
}

function clipLocalFallbackText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = "\n...[locally compacted]...\n";
  if (limit <= marker.length + 2) return value.slice(0, Math.max(0, limit));
  const available = limit - marker.length;
  const head = Math.ceil(available * 0.6);
  return value.slice(0, head) + marker + value.slice(-(available - head));
}

export function createLocalThreadContextSummary(
  sessionId: string,
): ThreadContextSummary | null {
  const session = getThreadContextSession(sessionId);
  if (!session) return null;

  const previousSummary = getLatestThreadContextSummary(sessionId);
  const unsummarizedTurns = getUnsummarizedThreadContextTurns(sessionId);
  if (unsummarizedTurns.length === 0) return previousSummary;

  const configuredMaxTokens = Math.max(
    128,
    config.context.threadNative.summaryMaxTokens,
  );
  const contextBoundTokens = Math.max(
    128,
    Math.floor(session.modelContextWindow * 0.2),
  );
  const maxTokens = Math.min(configuredMaxTokens, contextBoundTokens);
  const maxChars = Math.max(512, maxTokens * 4);
  const header =
    "Local extractive fallback generated because the configured summary provider was unavailable.";
  const sections: string[] = [header];
  let remainingChars = maxChars - header.length - 2;

  if (previousSummary && remainingChars > 160) {
    const previousBudget = Math.min(
      Math.floor(maxChars * 0.25),
      remainingChars - 80,
    );
    sections.push(
      "Previous cumulative summary:\n" +
        clipLocalFallbackText(previousSummary.summary, previousBudget),
    );
    remainingChars -= sections[sections.length - 1].length + 2;
  }

  const conversationHeader = "Conversation excerpts:";
  const availableTurnsChars = Math.max(
    32,
    remainingChars - conversationHeader.length - 2,
  );
  const maxTurnCount = Math.max(1, Math.floor(availableTurnsChars / 120));
  const selectedTurns = unsummarizedTurns.length <= maxTurnCount
    ? unsummarizedTurns
    : maxTurnCount === 1
    ? [unsummarizedTurns[unsummarizedTurns.length - 1]]
    : [unsummarizedTurns[0], ...unsummarizedTurns.slice(-(maxTurnCount - 1))];
  const omittedTurns = unsummarizedTurns.length - selectedTurns.length;
  const omissionNote = omittedTurns > 0
    ? "[" + omittedTurns + " older turn(s) omitted from the local fallback.]"
    : "";
  const turnBudget = Math.max(
    32,
    Math.floor(
      (availableTurnsChars - omissionNote.length - 2) / selectedTurns.length,
    ),
  );
  const turnLines = selectedTurns.map((turn) => {
    const prefix = roleLabel(turn.role) + ": ";
    return prefix +
      clipLocalFallbackText(turn.content, Math.max(1, turnBudget - prefix.length));
  });
  sections.push(
    [
      conversationHeader,
      ...turnLines,
      ...(omissionNote ? [omissionNote] : []),
    ].join("\n\n"),
  );

  const summaryText = sections.join("\n\n").slice(0, maxChars);
  const summaryTokens = estimateThreadTextTokens(summaryText);
  const originalTokens = unsummarizedTurns.reduce(
    (total, turn) => total + Math.max(0, turn.contentTokens),
    previousSummary?.summaryTokens ?? 0,
  );
  const summary = insertThreadContextSummary({
    sessionId,
    summary: summaryText,
    summaryTokens,
    sourceTurnStart: unsummarizedTurns[0]?.id ?? null,
    sourceTurnEnd: unsummarizedTurns[unsummarizedTurns.length - 1]?.id ?? null,
    model: "local-extractive-fallback",
    compressionRatio: originalTokens / Math.max(summaryTokens, 1),
  });

  console.warn(
    "[ThreadContext] Local fallback completed | " +
      summary.summaryTokens +
      " tokens",
  );
  logger.warn("[thread-context] local fallback summary completed", {
    sessionId,
    summaryId: summary.id,
    sourceTurnStart: summary.sourceTurnStart,
    sourceTurnEnd: summary.sourceTurnEnd,
    omittedTurns,
    summaryTokens: summary.summaryTokens,
  });
  return summary;
}

export async function runThreadContextSummary(
  sessionId: string,
): Promise<ThreadContextSummary | null> {
  if (!config.context.threadNative.persistenceEnabled) return null;
  if (!config.context.summarization.enabled) return null;

  const session = getThreadContextSession(sessionId);
  if (!session) return null;

  const latestSummary = getLatestThreadContextSummary(sessionId);
  const unsummarizedTurns = getUnsummarizedThreadContextTurns(sessionId);
  if (unsummarizedTurns.length === 0) {
    return latestSummary;
  }

  setThreadContextStatus(sessionId, "summary_pending");

  const sourceTurnStart = unsummarizedTurns[0]?.id ?? null;
  const sourceTurnEnd =
    unsummarizedTurns[unsummarizedTurns.length - 1]?.id ?? null;
  const anchorTurns = getRecentThreadContextTurns(
    sessionId,
    config.context.threadNative.recentTurnsToKeep,
  );
  const maxInputTokens = Math.floor(session.modelContextWindow * 0.45);
  const messages = buildSummaryInputMessages({
    previousSummary: latestSummary,
    newTurns: unsummarizedTurns,
    anchorTurns,
  });

  try {
    const summarizeWithModel = (model: string) =>
      summarizeMessages(messages, {
        model,
        maxSummaryTokens: config.context.threadNative.summaryMaxTokens,
        timeout: config.context.threadNative.summaryTimeout,
        systemPromptOverride: CONTINUATION_SUMMARY_PROMPT,
        purpose: "rollover",
      });

    const primaryModel = config.context.summarization.model;
    let result = await summarizeWithModel(primaryModel);

    if (
      !isUsableSummary(result.summary) &&
      primaryModel !== session.model &&
      session.status !== "hard_limit"
    ) {
      console.warn(
        `[ThreadContext] Summary retry | ${primaryModel} -> ${session.model}`,
      );
      logger.debug("[thread-context] summary unusable, retrying", {
        sessionId,
        primaryModel,
        fallbackModel: session.model,
        originalTokens: result.originalTokens,
        latencyMs: result.latencyMs,
        error: result.error ?? null,
      });
      result = await summarizeWithModel(session.model);
    }

    if (!isUsableSummary(result.summary)) {
      const errorMessage =
        result.error ?? "Summary API returned an unusable summary";
      setThreadContextStatus(
        sessionId,
        session.status === "rollover_required" ||
          session.status === "hard_limit"
          ? session.status
          : "summary_stale",
        errorMessage,
      );
      console.warn(`[ThreadContext] Summary unavailable | ${errorMessage}`);
      logger.debug("[thread-context] summary unavailable", {
        sessionId,
        model: primaryModel,
        fallbackModelTried: primaryModel !== session.model,
        originalTokens: result.originalTokens,
        summaryTokens: result.summaryTokens,
        latencyMs: result.latencyMs,
        maxInputTokens,
        error: errorMessage,
      });
      return null;
    }

    const summary = insertThreadContextSummary({
      sessionId,
      summary: result.summary.trim(),
      summaryTokens: result.summaryTokens,
      sourceTurnStart,
      sourceTurnEnd,
      model: config.context.summarization.model,
      compressionRatio: result.compressionRatio,
    });

    console.log(
      `[ThreadContext] Summary completed | ${summary.summaryTokens} tokens`,
    );
    logger.debug("[thread-context] summary completed", {
      sessionId,
      summaryId: summary.id,
      sequence: summary.sequence,
      sourceTurnStart,
      sourceTurnEnd,
      summaryTokens: summary.summaryTokens,
      originalTokens: result.originalTokens,
      compressionRatio: result.compressionRatio,
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setThreadContextStatus(sessionId, "summary_stale", message);
    console.warn(`[ThreadContext] Summary failed | ${message}`);
    logger.debug("[thread-context] summary failed", {
      sessionId,
      error: message,
    });
    return null;
  }
}

export async function ensureThreadContextSummary(
  sessionId: string,
): Promise<ThreadContextSummary | null> {
  const existing = getLatestThreadContextSummary(sessionId);
  const unsummarizedTurns = getUnsummarizedThreadContextTurns(sessionId);
  if (existing && unsummarizedTurns.length === 0) return existing;
  return runThreadContextSummary(sessionId);
}

export function formatThreadContextRecentTurns(
  turns: ThreadContextTurn[],
): string {
  return turns.map(turnToConversationLine).join("\n\n");
}
