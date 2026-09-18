import type { ResponsesResponse } from "./types.ts";
import { getDatabase } from "../../core/database.ts";

// ============ State management for previous_response_id ============
//
// The Responses API supports stateful conversations via `previous_response_id`.
// Completed responses are kept in an in-memory cache AND persisted to SQLite
// (write-through), so conversations survive service restarts: subsequent
// requests can reconstruct the message history from the database instead of
// losing context every time the process recycles.

export interface StoredResponse {
  response: ResponsesResponse;
  /** The full list of Chat Completions messages sent to the upstream for this response */
  chatMessages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  /** Timestamp of storage */
  storedAt: number;
}

// In-memory cache (responseId → StoredResponse), backed by SQLite
const store = new Map<string, StoredResponse>();

// Max entries to prevent memory bloat
const MAX_STORE_SIZE = 10000;
// Max age (ms) - 24 hours
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ---------- SQLite helpers (never let persistence break request flow) ----------

function persistEntry(responseId: string, entry: StoredResponse): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT OR REPLACE INTO responses_store (response_id, chat_messages, response, stored_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      responseId,
      JSON.stringify(entry.chatMessages),
      JSON.stringify(entry.response),
      entry.storedAt,
    );
  } catch (err) {
    console.warn(
      `⚠️  [Responses] Failed to persist response ${responseId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function loadEntryFromDb(responseId: string): StoredResponse | null {
  try {
    const db = getDatabase();
    const row = db
      .prepare(
        "SELECT chat_messages, response, stored_at FROM responses_store WHERE response_id = ?",
      )
      .get(responseId) as
      | { chat_messages: string; response: string; stored_at: number }
      | undefined;
    if (!row) return null;

    const entry: StoredResponse = {
      chatMessages: JSON.parse(row.chat_messages),
      response: JSON.parse(row.response),
      storedAt: row.stored_at,
    };

    if (Date.now() - entry.storedAt > MAX_AGE_MS) {
      deleteRow(responseId);
      return null;
    }
    return entry;
  } catch (err) {
    console.warn(
      `⚠️  [Responses] Failed to load response ${responseId} from SQLite:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function deleteRow(responseId: string): boolean {
  try {
    const db = getDatabase();
    const result = db
      .prepare("DELETE FROM responses_store WHERE response_id = ?")
      .run(responseId);
    return result.changes > 0;
  } catch {
    return false;
  }
}

function getEntry(responseId: string): StoredResponse | null {
  let entry = store.get(responseId);

  // Memory miss → hydrate from SQLite (survives restarts)
  if (!entry) {
    const loaded = loadEntryFromDb(responseId);
    if (!loaded) return null;
    store.set(responseId, loaded);
    entry = loaded;
  }

  // Check age
  if (Date.now() - entry.storedAt > MAX_AGE_MS) {
    store.delete(responseId);
    deleteRow(responseId);
    return null;
  }

  return entry;
}

// ---------- Public API ----------

/**
 * Store a completed response for future `previous_response_id` lookups.
 * Write-through: memory cache + SQLite persistence.
 */
export function storeResponse(
  responseId: string,
  response: ResponsesResponse,
  chatMessages: StoredResponse["chatMessages"],
  storedAt: number = Date.now(),
): void {
  // Evict old entries if at capacity
  if (store.size >= MAX_STORE_SIZE) {
    const oldest = [...store.entries()]
      .sort((a, b) => a[1].storedAt - b[1].storedAt)
      .slice(0, Math.floor(MAX_STORE_SIZE * 0.1));
    for (const [key] of oldest) {
      store.delete(key);
    }
  }

  const entry: StoredResponse = { response, chatMessages, storedAt };
  store.set(responseId, entry);
  persistEntry(responseId, entry);
}

/**
 * Retrieve stored history for a `previous_response_id`.
 * Returns null if not found.
 */
export function getResponseHistory(
  previousResponseId: string,
): StoredResponse["chatMessages"] | null {
  return getEntry(previousResponseId)?.chatMessages ?? null;
}

/**
 * Retrieve the full stored response (for GET /v1/responses/:id).
 * Returns null if not found.
 */
export function getStoredResponse(
  responseId: string,
): ResponsesResponse | null {
  return getEntry(responseId)?.response ?? null;
}

/**
 * Delete a stored response (memory + SQLite).
 */
export function deleteStoredResponse(responseId: string): boolean {
  const removedMemory = store.delete(responseId);
  const removedDb = deleteRow(responseId);
  return removedMemory || removedDb;
}

/**
 * Check if a `previous_response_id` exists in the store.
 */
export function hasResponse(previousResponseId: string): boolean {
  return getEntry(previousResponseId) !== null;
}

/**
 * Get store size (in-memory cache; for metrics/debugging).
 */
export function getStoreSize(): number {
  return store.size;
}

/**
 * Clear all stored responses (memory + SQLite).
 */
export function clearStore(): void {
  store.clear();
  try {
    const db = getDatabase();
    db.exec("DELETE FROM responses_store");
  } catch {
    // best-effort
  }
}

/**
 * Clear only the in-memory cache, keeping persisted rows intact.
 * Used to simulate a process restart in tests and useful for cache rebuilds.
 */
export function clearMemoryCache(): void {
  store.clear();
}

/**
 * Iterate all stored response IDs in the memory cache (for debugging).
 */
export function listStoredResponseIds(): string[] {
  return [...store.keys()];
}

// Periodic cleanup (every 10 minutes) — memory + expired SQLite rows
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(
    () => {
      const now = Date.now();
      for (const [key, value] of store) {
        if (now - value.storedAt > MAX_AGE_MS) {
          store.delete(key);
        }
      }
      try {
        const db = getDatabase();
        db.prepare("DELETE FROM responses_store WHERE stored_at < ?").run(
          now - MAX_AGE_MS,
        );
      } catch {
        // best-effort
      }
    },
    10 * 60 * 1000,
  );
  // Allow process to exit even if interval is active
  if (
    cleanupInterval &&
    typeof cleanupInterval === "object" &&
    "unref" in cleanupInterval
  ) {
    (cleanupInterval as NodeJS.Timeout).unref();
  }
}

export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
