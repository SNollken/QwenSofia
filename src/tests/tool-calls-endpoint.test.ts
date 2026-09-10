/**
 * Copyright (c) 2025 johngbl
 * QwenSofia - OpenAI-compatible proxy for Qwen
 */

import test from "node:test";
import assert from "node:assert";

process.env.TEST_MOCK_QWEN_AUTH = "true";

import { app } from "../api/server.js";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
];

const FLAT_TOOLS = [
  {
    name: "task",
    description: "Spawn a delegated task",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["description", "prompt"],
    },
  },
];

const TOOL_SEARCH_TOOLS = [
  {
    type: "function",
    function: {
      name: "tool_search",
      description: "Search deferred tools",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
          },
          limit: { type: "integer" },
        },
        required: ["queries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search local files",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          target: { type: "string" },
          path: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["pattern"],
      },
    },
  },
];

function setupFetchMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : "url" in input
          ? input.url
          : String(input);
    if (urlStr.includes("chat.qwen.ai")) {
      if (urlStr.includes("/api/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "qwen3.6-plus", owned_by: "qwen" }] }),
          { status: 200 },
        );
      }
      return handler(urlStr, init);
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function createSseResponse(events: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`${event}\n\n`));
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

async function collectStreamResult(res: Response) {
  const reader = res.body?.getReader();
  assert.ok(reader, "Response should have a readable body");

  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let finishReason: string | null = null;
  let toolCallDeltaCount = 0;
  const toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);

    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

      try {
        const data = JSON.parse(line.slice(6));
        for (const choice of data.choices || []) {
          if (
            choice.finish_reason !== null &&
            choice.finish_reason !== undefined
          ) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (typeof delta?.content === "string") {
            content += delta.content;
          }
          if (typeof delta?.reasoning_content === "string") {
            reasoning += delta.reasoning_content;
          }

          if (Array.isArray(delta?.tool_calls)) {
            toolCallDeltaCount += delta.tool_calls.length;
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id || "", name: "", arguments: "" };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments) {
                toolCalls[idx].arguments += tc.function.arguments;
              }
            }
          }
        }
      } catch {
        // Ignore heartbeat/comments and partial data
      }
    }
  }

  return {
    content,
    reasoning,
    finishReason,
    toolCallDeltaCount,
    toolCalls: toolCalls.filter(Boolean),
  };
}

for (const stream of [false, true]) {
  test(`${stream ? "stream" : "non-stream"}: named XML envelopes deliver complete arguments`, async () => {
    const output = '<tool_calls><tool><tool_name>read_file</tool_name><parameter name="path">handoff.md</parameter_name></invoke></tool_calls>';
    const restore = setupFetchMock(() => createSseResponse([...output].map((content) =>
      `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content } }] })}`,
    )));
    try {
      const response = await app.fetch(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "qwen3.6-plus", stream, tools: TOOLS, messages: [{ role: "user", content: "read the handoff" }] }),
      }));
      assert.strictEqual(response.status, 200);
      if (stream) {
        const result = await collectStreamResult(response);
        assert.strictEqual(result.finishReason, "tool_calls");
        assert.strictEqual(result.toolCallDeltaCount, 1);
        assert.strictEqual(result.content, "");
        assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), { path: "handoff.md" });
      } else {
        const result = await response.json();
        assert.strictEqual(result.choices[0].finish_reason, "tool_calls");
        assert.strictEqual(result.choices[0].message.tool_calls.length, 1);
        assert.deepStrictEqual(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments), { path: "handoff.md" });
      }
    } finally {
      restore();
    }
  });
}

test("non-stream: literal <tool_call> tags are preserved when tools are absent", async () => {
  const literal =
    'Literal <tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call> text';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: literal } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        messages: [{ role: "user", content: "show tags literally" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, literal);
    assert.strictEqual(message.tool_calls, undefined);
    assert.strictEqual(body.choices[0].finish_reason, "stop");
  } finally {
    restore();
  }
});

test("stream: literal <tool_call> tags are preserved when tools are absent", async () => {
  const literal =
    'Literal <tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call> text';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: "Literal <tool_" } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: literal } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        messages: [{ role: "user", content: "show tags literally" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, literal);
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.finishReason, "stop");
  } finally {
    restore();
  }
});

test("stream: literal <tool_call> inside inline code is preserved when tools are present", async () => {
  const literal =
    "Para usar uma ferramenta, eu gero um bloco JSON envolto exatamente nas tags `<tool_call>`. A estrutura é sempre esta:";
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                "Para usar uma ferramenta, eu gero um bloco JSON envolto exatamente nas tags `",
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: "<tool_call>`. A estrutura é sempre esta:",
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "explique tool calls" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, literal);
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.finishReason, "stop");
  } finally {
    restore();
  }
});

test("non-stream: valid tool_call becomes structured tool_calls", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                'Before <tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call> after',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, null);
    assert.strictEqual(message.tool_calls.length, 1);
    assert.strictEqual(message.tool_calls[0].function.name, "read_file");
    assert.deepStrictEqual(
      JSON.parse(message.tool_calls[0].function.arguments),
      { path: "a.txt" },
    );
    assert.strictEqual(body.choices[0].finish_reason, "tool_calls");
  } finally {
    restore();
  }
});

test("non-stream: explained undeclared tool example is preserved as text", async () => {
  const literal =
    'Exemplo: <tool_call>{"name":"nome_da_ferramenta","arguments":{"parametro":"valor"}}</tool_call>';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: literal } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "explique tool calls" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, literal);
    assert.strictEqual(message.tool_calls, undefined);
    assert.strictEqual(body.choices[0].finish_reason, "stop");
  } finally {
    restore();
  }
});

test("non-stream: bare undeclared vision call is suppressed without retries", async () => {
  const raw = String.raw`<tool_call> {"name": "vision_analyze", "arguments": {"image_url": "C:\Users\sofia\AppData\Roaming\Hermes\composer-images\image.png", "query": "Descreva a imagem"}} </tool_call>`;
  let requestCount = 0;
  const restore = setupFetchMock(() => {
    requestCount++;
    return createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: raw } }],
      })}`,
    ]);
  });

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "descreva a imagem" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(requestCount, 1);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, "");
    assert.strictEqual(message.tool_calls, undefined);
    assert.strictEqual(body.choices[0].finish_reason, "stop");
  } finally {
    restore();
  }
});

test("non-stream: flat tool definitions are treated as declared tools", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call>{"name":"task","arguments":{"description":"Resume backend analysis","prompt":"Analyze all files"}}</tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: FLAT_TOOLS,
        messages: [{ role: "user", content: "delegate the task" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, null);
    assert.strictEqual(message.tool_calls.length, 1);
    assert.strictEqual(message.tool_calls[0].function.name, "task");
    assert.deepStrictEqual(
      JSON.parse(message.tool_calls[0].function.arguments),
      {
        description: "Resume backend analysis",
        prompt: "Analyze all files",
      },
    );
    assert.strictEqual(body.choices[0].finish_reason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: fragmented tool_call becomes structured tool_calls", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: "<tool_" } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: '<tool_call>{"name":"read_file"',
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: fragmented named wrapper with direct arguments becomes tool_search", async () => {
  const complete =
    '<tool_call_search>{"queries":["handoff file"]}</tool_call_search>';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          { delta: { phase: "answer", content: "<tool_call_" } },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: complete } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOL_SEARCH_TOOLS,
        messages: [{ role: "user", content: "find the handoff tool" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "tool_search");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      queries: ["handoff file"],
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

for (const stream of [false, true]) {
  test(`${stream ? "stream" : "non-stream"}: nested search arguments become search_files`, async () => {
    const output =
      '<tool_call_search><arguments>{"pattern":"*handoff*","target":"files","limit":20}}</tool_call_search>';
    const restore = setupFetchMock(() => createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content: output } }] })}`,
    ]));

    try {
      const response = await app.fetch(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.6-plus",
          stream,
          tools: TOOL_SEARCH_TOOLS,
          messages: [{ role: "user", content: "find the handoff file" }],
        }),
      }));
      assert.strictEqual(response.status, 200);

      if (stream) {
        const result = await collectStreamResult(response);
        assert.strictEqual(result.finishReason, "tool_calls");
        assert.strictEqual(result.content, "");
        assert.strictEqual(result.toolCalls[0].name, "search_files");
        assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
          pattern: "*handoff*",
          target: "files",
          limit: 20,
        });
      } else {
        const result = await response.json();
        assert.strictEqual(result.choices[0].finish_reason, "tool_calls");
        assert.strictEqual(result.choices[0].message.content, null);
        assert.strictEqual(
          result.choices[0].message.tool_calls[0].function.name,
          "search_files",
        );
        assert.deepStrictEqual(
          JSON.parse(result.choices[0].message.tool_calls[0].function.arguments),
          { pattern: "*handoff*", target: "files", limit: 20 },
        );
      }
    } finally {
      restore();
    }
  });
}

test("stream: quoted malformed opener becomes search_files", async () => {
  const output =
    '<tool_call"\n{"name":"search_files","arguments":{"pattern":"package.json","target":"files"}}';
  const restore = setupFetchMock(() => createSseResponse([...output].map((content) =>
    `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content } }] })}`,
  )));

  try {
    const response = await app.fetch(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOL_SEARCH_TOOLS,
        messages: [{ role: "user", content: "find package.json" }],
      }),
    }));
    assert.strictEqual(response.status, 200);

    const result = await collectStreamResult(response);
    assert.strictEqual(result.finishReason, "tool_calls");
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls[0].name, "search_files");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      pattern: "package.json",
      target: "files",
    });
  } finally {
    restore();
  }
});

test("stream: Qwen native control tokens become a structured tool call", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: "<tool_call_calls_section_",
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                'begin|><tool_call_begin|>read_file<|tool_call_argument_begin|>{"path":"handoff.md"}\n</tool_call_end|>\n</tool_calls_section_end|>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read the handoff" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "handoff.md",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: write_file arguments are emitted once after tool close", async () => {
  const content1 =
    '<tool_call>{"name":"write_file","arguments":{"path":"index.html","content":"<h1';
  const content2 =
    '<tool_call>{"name":"write_file","arguments":{"path":"index.html","content":"<h1>Hello';
  const content3 =
    '<tool_call>{"name":"write_file","arguments":{"path":"index.html","content":"<h1>Hello</h1>\\n<p>Wor';
  const content4 =
    '<tool_call>{"name":"write_file","arguments":{"path":"index.html","content":"<h1>Hello</h1>\\n<p>World</p>"}}</tool_call>';

  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: content1 } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: content2 } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: content3 } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: content4 } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "write a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "write_file");
    assert.strictEqual(result.toolCallDeltaCount, 1);
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "index.html",
      content: "<h1>Hello</h1>\n<p>World</p>",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: repeated tool_calling wrappers emit one structured call", async () => {
  const block =
    '<tool_calling>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_calling>';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: `${block}\nI should call it now.\n${block}`,
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: tool_caller wrapper emits a structured call", async () => {
  const block =
    '<tool_caller>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_caller>';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: block } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: ellipsis placeholder stays text and does not force length", async () => {
  const content = "<tool_call...>\nCODEX_FINAL_TOOL_OK";
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, content);
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.finishReason, "stop");
  } finally {
    restore();
  }
});

test("non-stream: missing opening tag is recovered when closing tag is present", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '{"name":"read_file","arguments":{"arguments":{"path":"a.txt"}}}</tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, null);
    assert.strictEqual(message.tool_calls.length, 1);
    assert.strictEqual(message.tool_calls[0].function.name, "read_file");
    assert.deepStrictEqual(
      JSON.parse(message.tool_calls[0].function.arguments),
      { path: "a.txt" },
    );
    assert.strictEqual(body.choices[0].finish_reason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: missing opening tag is recovered when closing tag is present", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: '{"name":"read_file"',
            },
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '{"name":"read_file","arguments":{"arguments":{"path":"a.txt"}}}</tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("non-stream: unclosed tool_call is recovered on flush", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, null);
    assert.strictEqual(message.tool_calls.length, 1);
    assert.strictEqual(message.tool_calls[0].function.name, "read_file");
    assert.deepStrictEqual(
      JSON.parse(message.tool_calls[0].function.arguments),
      { path: "a.txt" },
    );
    assert.strictEqual(body.choices[0].finish_reason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: unclosed tool_call is recovered on flush", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: buffers tool output and suppresses malformed text before a valid call", async () => {
  const malformedPrefix = "<tool_call}";
  const validCall =
    '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>';
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          { delta: { phase: "answer", content: malformedPrefix } },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content: `${malformedPrefix}${validCall}`,
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const payload = await res.clone().text();
    const result = await collectStreamResult(res);
    assert.doesNotMatch(payload, /<tool_call/);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(JSON.parse(result.toolCalls[0].arguments), {
      path: "a.txt",
    });
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("stream: retries an incomplete tool call before releasing a response", async () => {
  let attempts = 0;
  const restore = setupFetchMock(() => {
    attempts++;
    if (attempts === 1) {
      return createSseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { phase: "answer", content: "<tool_call" } }],
        })}`,
      ]);
    }
    return createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>',
            },
          },
        ],
      })}`,
    ]);
  });

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const payload = await res.clone().text();
    const result = await collectStreamResult(res);
    assert.strictEqual(attempts, 2);
    assert.doesNotMatch(payload, /<tool_call|upstream_error/);
    assert.strictEqual(result.content, "");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.strictEqual(result.finishReason, "tool_calls");
  } finally {
    restore();
  }
});

test("non-stream: bare tool_call marker returns a retryable upstream error", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: "<tool_call" } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 502);

    const body = await res.json();
    assert.strictEqual(body.error.type, "upstream_error");
    assert.strictEqual(body.error.code, "upstream_unavailable");
    assert.match(body.error.message, /could not recover an incomplete tool call/i);
  } finally {
    restore();
  }
});

test("stream: bare tool_call marker retries before returning an upstream error", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: "<tool_call" } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 502);

    const body = await res.json();
    assert.strictEqual(body.error.type, "upstream_error");
    assert.strictEqual(body.error.code, "upstream_unavailable");
    assert.match(body.error.message, /could not recover an incomplete tool call/i);
  } finally {
    restore();
  }
});

for (const stream of [false, true]) {
  for (const malformed of [
    "<tool_call_terminal>\n</tool>\n\n<tool_call_terminal>\n</tool>\n\n<tool_call_terminal>\n</tool>",
    "<tool_call_terminal>\n>\n</tool>",
    "<tool_call>{invalid",
  ]) {
  test(`${stream ? "stream" : "non-stream"}: malformed tool wrappers are not a token limit (${malformed.length} chars)`, async () => {
    const restore = setupFetchMock(() =>
      createSseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { phase: "answer", content:
            malformed,
          } }],
        })}`,
      ]),
    );
    try {
      const res = await app.fetch(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.6-plus", stream, tools: TOOLS,
          messages: [{ role: "user", content: "read a file" }],
        }),
      }));
      const payload = await res.text();
      const body = JSON.parse(payload);
      assert.strictEqual(res.status, 502);
      assert.strictEqual(body.error.type, "upstream_error");
      assert.match(body.error.message, /could not recover an incomplete tool call/i);
      assert.doesNotMatch(payload, /<\/?tool/);
    } finally {
      restore();
    }
  });
  }

  test(`${stream ? "stream" : "non-stream"}: preserves an actual upstream token limit`, async () => {
    const restore = setupFetchMock(() =>
      createSseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content: "Partial answer" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ finish_reason: "length" }] })}`,
      ]),
    );
    try {
      const res = await app.fetch(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.6-plus", stream, tools: TOOLS,
          messages: [{ role: "user", content: "read a file" }],
        }),
      }));
      assert.strictEqual(res.status, 200);
      const result = stream ? await collectStreamResult(res) : null;
      const body = stream ? null : await res.json();
      assert.strictEqual(result?.finishReason ?? body.choices[0].finish_reason, "length");
      assert.strictEqual(result?.content ?? body.choices[0].message.content, "Partial answer");
    } finally {
      restore();
    }
  });
}

test("stream: recovered tools, finish reason and usage precede the only DONE", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { phase: "answer", content:
        '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}',
      } }] })}`,
    ]),
  );
  try {
    const res = await app.fetch(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus", stream: true, tools: TOOLS,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "read a file" }],
      }),
    }));
    assert.strictEqual(res.status, 200);
    const events = (await res.text()).split("\n").filter((line) => line.startsWith("data: "));
    const doneIndex = events.indexOf("data: [DONE]");
    assert.strictEqual(doneIndex, events.length - 1, "DONE must not precede parser flush");
    assert.strictEqual(events.filter((line) => line === "data: [DONE]").length, 1);
    const payloads = events.slice(0, doneIndex).map((line) => JSON.parse(line.slice(6)));
    assert.ok(payloads.some((event) => event.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name === "read_file"));
    assert.ok(payloads.some((event) => event.choices?.[0]?.finish_reason === "tool_calls"));
    assert.ok(payloads.some((event) => event.usage && event.choices.length === 0));
  } finally {
    restore();
  }
});

test("stream: repeated corrupt nested tool markers never leak to clients", async () => {
  const corrupt =
    'Beleza, testando as tools:\n\n<tool_call<tool_call{}>> "terminal", "parameters": {}}\n' +
    '</tool_call<tool_call{}>> "terminal", "parameters": {}}\n'.repeat(4);
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { phase: "answer", content: corrupt } }],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "test tool calls" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "Beleza, testando as tools:\n\n");
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.finishReason, "stop");
  } finally {
    restore();
  }
});

test("stream: malformed nameless tool_call restores lead-in text", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                'Need tool result: <tool_call>{"arguments":{"path":"a.txt"}}</tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: true,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const result = await collectStreamResult(res);
    assert.strictEqual(result.content, "Need tool result: ");
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.finishReason, "stop");
  } finally {
    restore();
  }
});

test("non-stream: XML parameter tool_call is supported", async () => {
  const restore = setupFetchMock(() =>
    createSseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              phase: "answer",
              content:
                '<tool_call name="read_file"><parameter name="path">a.txt</parameter></tool_call>',
            },
          },
        ],
      })}`,
    ]),
  );

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.6-plus",
        stream: false,
        tools: TOOLS,
        messages: [{ role: "user", content: "read a file" }],
      }),
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const message = body.choices[0].message;
    assert.strictEqual(message.content, null);
    assert.strictEqual(message.tool_calls.length, 1);
    assert.strictEqual(message.tool_calls[0].function.name, "read_file");
    assert.deepStrictEqual(
      JSON.parse(message.tool_calls[0].function.arguments),
      { path: "a.txt" },
    );
    assert.strictEqual(body.choices[0].finish_reason, "tool_calls");
  } finally {
    restore();
  }
});
