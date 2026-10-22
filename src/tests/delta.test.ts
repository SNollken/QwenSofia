import { test } from "node:test";
import assert from "node:assert";
import {
  formatThinkingSummaryContent,
  getIncrementalDelta,
  isAbortError,
  shouldSuppressStreamAbort,
} from "../routes/chat/helpers.ts";

test("getIncrementalDelta: handles strictly cumulative stream correctly", () => {
  let accumulated = "";

  // Step 1
  let chunk1 = "const x = 1;";
  let res1 = getIncrementalDelta(accumulated, chunk1);
  assert.strictEqual(res1.delta, "const x = 1;");
  accumulated = res1.matchedContent;

  // Step 2
  let chunk2 = "const x = 1;\nconst y = 2;";
  let res2 = getIncrementalDelta(accumulated, chunk2);
  assert.strictEqual(res2.delta, "\nconst y = 2;");
  accumulated = res2.matchedContent;

  // Step 3
  let chunk3 = "const x = 1;\nconst y = 2;\nconst z = 3;";
  let res3 = getIncrementalDelta(accumulated, chunk3);
  assert.strictEqual(res3.delta, "\nconst z = 3;");
  accumulated = res3.matchedContent;

  assert.strictEqual(accumulated, "const x = 1;\nconst y = 2;\nconst z = 3;");
});

test("getIncrementalDelta: handles strictly incremental stream correctly", () => {
  let accumulated = "";

  // Step 1
  let chunk1 = "const x = 1;";
  let res1 = getIncrementalDelta(accumulated, chunk1);
  assert.strictEqual(res1.delta, "const x = 1;");
  accumulated = res1.matchedContent;

  // Step 2
  let chunk2 = "\nconst y = 2;";
  let res2 = getIncrementalDelta(accumulated, chunk2);
  assert.strictEqual(res2.delta, "\nconst y = 2;");
  accumulated = res2.matchedContent;

  // Step 3
  let chunk3 = "\nconst z = 3;";
  let res3 = getIncrementalDelta(accumulated, chunk3);
  assert.strictEqual(res3.delta, "\nconst z = 3;");
  accumulated = res3.matchedContent;

  assert.strictEqual(accumulated, "const x = 1;\nconst y = 2;\nconst z = 3;");
});

test("getIncrementalDelta: does not suffer from false-positive repetitive word overlap bugs", () => {
  // Previously, if oldStr ended in a common keyword and newStr started/contained the same keyword,
  // it would incorrectly match them and strip them. Let's verify this is fixed.
  let accumulated = "import { useState } from 'react';\nimport {";
  let nextChunk = " Button } from '@/components/ui/button';";

  let res = getIncrementalDelta(accumulated, nextChunk);
  // It should treat the next chunk as strictly incremental and return it unchanged.
  assert.strictEqual(res.delta, " Button } from '@/components/ui/button';");
  assert.strictEqual(
    res.matchedContent,
    "import { useState } from 'react';\nimport { Button } from '@/components/ui/button';",
  );
});

test("getIncrementalDelta: handles long cumulative streams without duplicating prior content", () => {
  const prefix = "a".repeat(2500);
  const accumulated = `${prefix}END`;
  const nextChunk = `${prefix}END-more-content`;

  const res = getIncrementalDelta(accumulated, nextChunk);

  assert.strictEqual(res.delta, "-more-content");
  assert.strictEqual(res.matchedContent, nextChunk);
});

test("getIncrementalDelta: never duplicates text when cumulative stream has internal markdown or whitespace shifts", () => {
  const step1 = "Diagnóstico do painel atual: **O que daria pra fazer";
  const res1 = getIncrementalDelta("", step1);
  assert.strictEqual(res1.delta, step1);

  // In step 2, markdown renders: ** was converted and text shifted slightly at index 30
  const step2 = "Diagnóstico do painel atual:\nO que daria pra fazer, em ordem de impacto:";
  const res2 = getIncrementalDelta(res1.matchedContent, step2);

  // Must NEVER re-emit "O que daria pra fazer" which was already sent in step 1!
  assert.ok(
    !res2.delta.includes("O que daria pra fazer"),
    `Must not duplicate already sent prefix, got delta: ${JSON.stringify(res2.delta)}`,
  );
  assert.strictEqual(res2.delta, "em ordem de impacto:");
});

test("formatThinkingSummaryContent: handles string content directly", () => {
  const formatted = formatThinkingSummaryContent({
    content: "Pensando na resposta...",
  });
  assert.strictEqual(formatted, "Pensando na resposta...");
});

test("formatThinkingSummaryContent: combines titles and thoughts by section", () => {
  const formatted = formatThinkingSummaryContent({
    extra: {
      summary_title: { content: ["Title 1", "Title 2"] },
      summary_thought: { content: ["Thought 1", "Thought 2"] },
    },
  });

  assert.strictEqual(
    formatted,
    "**Title 1**\n\nThought 1\n\n**Title 2**\n\nThought 2",
  );
});

test("isAbortError: recognizes DOMException AbortError", () => {
  assert.ok(
    isAbortError(new DOMException("This operation was aborted", "AbortError")),
  );
  assert.ok(!isAbortError(new Error("ordinary failure")));
});

test("shouldSuppressStreamAbort: suppresses expected disconnect aborts", () => {
  const abortError = new DOMException(
    "This operation was aborted",
    "AbortError",
  );

  assert.ok(shouldSuppressStreamAbort(abortError, true, false, true));
  assert.ok(shouldSuppressStreamAbort(abortError, false, true, true));
  assert.ok(shouldSuppressStreamAbort(abortError, false, false, false));
  assert.ok(!shouldSuppressStreamAbort(abortError, false, false, true));
  assert.ok(!shouldSuppressStreamAbort(new Error("boom"), true, true, false));
});
