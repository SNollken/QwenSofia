import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capPromptForUpstream,
  rebuildPromptWithSummary,
  truncateMessages,
  buildBoundedPrompt,
  UPSTREAM_PROMPT_CHAR_LIMIT,
  withSummarizationTimeout,
} from "../services/payload-summarizer.ts";

const LARGE_TEXT = "x".repeat(45_000);
const LARGE_TOOL_RESULT = "tool-result ".repeat(5_000);

test("payload-summarizer: preserves earlier tool memory when truncating oversized tool messages", () => {
  const messages = [
    {
      role: "assistant",
      content: LARGE_TEXT,
      tool_calls: [
        {
          id: "call_1",
          function: {
            name: "search_docs",
            arguments: JSON.stringify({ query: "captcha fix upstream" }),
          },
        },
      ],
    },
    {
      role: "tool",
      name: "search_docs",
      tool_call_id: "call_1",
      content: LARGE_TOOL_RESULT,
    },
  ];

  const truncated = truncateMessages(messages);

  assert.equal(truncated[0].role, "user");
  assert.match(truncated[0].content, /Earlier tool memory/);
  assert.match(truncated[0].content, /search_docs/);
  assert.match(truncated[0].content, /captcha fix upstream/);
  assert.match(truncated[0].content, /response:/);

  assert.equal(truncated.length, 3);
  assert.match(String(truncated[1].content), /truncated/);
  assert.match(String(truncated[2].content), /truncated/);
});

test("payload-summarizer: injects earlier tool memory into rebuilt prompt summary", () => {
  const prompt = rebuildPromptWithSummary(
    "System prompt",
    [
      {
        role: "assistant",
        content: LARGE_TEXT,
        tool_calls: [
          {
            id: "call_2",
            function: {
              name: "send_tools",
              arguments: JSON.stringify({ tool: "browser", mode: "native" }),
            },
          },
        ],
      } as any,
    ],
    "Conversation summary",
  );

  assert.match(prompt, /\[Previous conversation summary\]/);
  assert.match(prompt, /\[Earlier tool memory\]/);
  assert.match(prompt, /send_tools/);
  assert.match(prompt, /browser/);
});

test("payload-summarizer: caps oversized prompts while preserving instructions and recent context", () => {
  const instructions = "SYSTEM-INSTRUCTIONS:" + "a".repeat(40_000);
  const recentContext = "RECENT-CONTEXT:" + "z".repeat(100_000);
  const prompt = `${instructions}\n${"middle".repeat(20_000)}\n${recentContext}`;

  const capped = capPromptForUpstream(prompt);

  assert.equal(capped.length, UPSTREAM_PROMPT_CHAR_LIMIT);
  assert.ok(capped.startsWith("SYSTEM-INSTRUCTIONS:"));
  assert.ok(capped.endsWith(recentContext.slice(-60_000)));
  assert.match(capped, /older context compacted locally/);
});

test("payload-summarizer: leaves prompts within the upstream limit unchanged", () => {
  const prompt = "small prompt";
  assert.equal(capPromptForUpstream(prompt), prompt);
});

test("payload-summarizer: bounds a stalled summarization chunk", async () => {
  const stalled = new Promise<string>(() => {});

  await assert.rejects(
    withSummarizationTimeout(stalled, 10),
    /Summarization chunk timed out after 10ms/,
  );
});

test("payload-summarizer: buildBoundedPrompt preserves tool instructions and schemas with huge message history", () => {
  const systemPrompt =
    "HERMES PERSONA RULES ".repeat(2000) +
    "\n\n# TOOLS AVAILABLE\n" +
    JSON.stringify([{ name: "read_file" }]) +
    "\n\n# TOOL CALLING FORMAT (MANDATORY)\n" +
    "<tool_call>\n" +
    '{"name": "read_file", "arguments": {"path": "foo"}}\n' +
    "</tool_call>";

  const messages: Array<{ role: string; content: string }> = [];
  for (let i = 0; i < 500; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}: Some chat turn text. `.repeat(10),
    });
  }
  messages.push({
    role: "user",
    content: "veja se tem mais algum problema?",
  });

  const bounded = buildBoundedPrompt(messages, systemPrompt);

  assert.ok(bounded.length <= UPSTREAM_PROMPT_CHAR_LIMIT);
  assert.ok(
    bounded.includes("# TOOLS AVAILABLE"),
    "Must preserve # TOOLS AVAILABLE",
  );
  assert.ok(
    bounded.includes("# TOOL CALLING FORMAT"),
    "Must preserve # TOOL CALLING FORMAT",
  );
  assert.ok(
    bounded.includes("veja se tem mais algum problema?"),
    "Must include latest user message",
  );
  assert.ok(
    bounded.includes("older conversation turn(s) omitted"),
    "Must include omission marker",
  );
  assert.ok(
    bounded.startsWith("HERMES PERSONA RULES"),
    "Must preserve system instructions start",
  );
  assert.ok(
    bounded.includes("user: Message 0:") ||
      bounded.includes("user: veja se tem mais algum problema?"),
    "Must preserve user message",
  );
});

test("payload-summarizer: buildBoundedPrompt anchors first user request and latest turns when omitting history", () => {
  const systemPrompt = "# TOOLS AVAILABLE\n[]\n\n# TOOL CALLING FORMAT\n<tool_call>";
  const messages: Array<{ role: string; content: string }> = [
    { role: "user", content: "ORIGINAL_TASK: Resumo da conclusão dessas 26 tarefas ?" },
  ];
  for (let i = 0; i < 100; i++) {
    messages.push({
      role: i % 2 === 0 ? "assistant" : "tool",
      content: `Intermediate turn ${i} with long logs: `.repeat(50),
    });
  }
  messages.push({
    role: "tool",
    content: "LATEST_TOOL_OUTPUT: Error reading application.properties",
  });

  const bounded = buildBoundedPrompt(messages, systemPrompt, 10_000);

  assert.ok(
    bounded.includes("ORIGINAL_TASK: Resumo da conclusão dessas 26 tarefas ?"),
    "Root user task must be anchored at the start",
  );
  assert.ok(
    bounded.includes("LATEST_TOOL_OUTPUT: Error reading application.properties"),
    "Latest tool output must be preserved at the end",
  );
  assert.ok(
    bounded.includes("older conversation turn(s) omitted"),
    "Must note intermediate omission",
  );
});
