import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { browserUiStreamFetch } from "../services/stream-bridge.ts";
import { StreamingToolParser } from "../tools/parser.ts";

const tools = [{
  type: "function" as const,
  function: {
    name: "read_file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
}];
const call = '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>';

async function runDom(prependProse: boolean) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.route("**/*", (route) => route.abort());
      await page.setContent('<textarea></textarea><button class="send-button">Send</button>');
      await page.evaluate(({ text, prependProse }) => {
        document.querySelector("button")!.addEventListener("click", () => {
          const message = document.createElement("div");
          message.className = "response-message-content";
          if (prependProse) {
            const prose = document.createElement("p");
            prose.textContent = "Exemplo de chamada:";
            message.append(prose);
          }
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          code.textContent = text;
          pre.append(code);
          message.append(pre);
          document.body.append(message);
        });
      }, { text: call, prependProse });
      const { stream } = await browserUiStreamFetch(page, "test", { timeoutMs: 8000 });
      const wire = await new Response(stream).text();
      const snapshots = wire.split("\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content)
        .filter((content): content is string => typeof content === "string");
      const parser = new StreamingToolParser(tools);
      const parts = [...(snapshots.at(-1) ?? "")].map((character) => parser.feed(character));
      parts.push(parser.flush());
      return {
        calls: parts.flatMap((part) => part.toolCalls),
        text: parts.map((part) => part.text).join(""),
      };
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

test("a fenced-only tool call rendered by the web UI still executes", { timeout: 30000 }, async () => {
  const result = await runDom(false);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].arguments, { path: "a.txt" });
  assert.equal(result.text, "");
});

test("a code example after prose stays visible text", { timeout: 30000 }, async () => {
  const result = await runDom(true);
  assert.equal(result.calls.length, 0);
  assert.match(result.text, /Exemplo de chamada/);
  assert.match(result.text, /a\.txt/);
});

test("DOM auto-closing makes truncated and complete custom tags indistinguishable", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.route("**/*", (route) => route.abort());
      const same = await page.evaluate(() => {
        const incomplete = document.createElement("div");
        const complete = document.createElement("div");
        incomplete.innerHTML = '<tool_call><parameter name="content">partial';
        complete.innerHTML = '<tool_call><parameter name="content">partial</parameter></tool_call>';
        return incomplete.innerHTML === complete.innerHTML;
      });
      assert.equal(same, true);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
