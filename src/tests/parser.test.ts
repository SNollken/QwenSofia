import { test } from "node:test";
import assert from "node:assert";
import { StreamingToolParser } from "../tools/parser.ts";

const TOOLS = [
  {
    type: "function" as const,
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
];

const FLAT_TOOLS = [
  {
    name: "task",
    description: "Spawn a task",
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

const TERMINAL_TOOLS = [{
  type: "function" as const,
  function: {
    name: "terminal",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeout: { type: "number" } },
      required: ["command"],
    },
  },
}];

test("named XML tool envelopes recover complete parameters across every split", () => {
  const body = '<tool_name>terminal</tool_name><parameter name="command">echo "</tool>"</parameter_name><parameter name="timeout">5</parameter>';
  for (const output of [
    `<tool>${body}</invoke>`,
    `<tool_calls>${body}</tool_calls>`,
    `<tool_calls><tool>${body}</invoke></tool_calls>`,
    `<tool_call_calls><tool>${body}</invoke></tool_calls>`,
  ]) {
    for (let split = 0; split <= output.length; split++) {
      const parser = new StreamingToolParser(TERMINAL_TOOLS);
      const first = parser.feed(output.slice(0, split));
      if (split < output.length) assert.strictEqual(first.toolCalls.length, 0);
      const last = parser.feed(output.slice(split));
      const tail = parser.flush();
      const calls = [...first.toolCalls, ...last.toolCalls, ...tail.toolCalls];
      assert.strictEqual(calls.length, 1, `${output} split ${split}`);
      assert.strictEqual(calls[0].name, "terminal");
      assert.deepStrictEqual(calls[0].arguments, { command: 'echo "</tool>"', timeout: 5 });
      assert.strictEqual(first.text + last.text + tail.text, "");
    }
  }
});

test("named XML groups preserve separate calls instead of merging parameters", () => {
  const output = '<tool_calls><tool><tool_name>terminal</tool_name><parameter name="command">echo ONE</parameter_name></invoke><tool><tool_name>terminal</tool_name><parameter name="command">echo TWO</parameter_name></tool></tool_calls>';
  const parser = new StreamingToolParser(TERMINAL_TOOLS);
  const calls = [...output].flatMap((character) => parser.feed(character).toolCalls);
  assert.deepStrictEqual(calls.map((call) => call.arguments), [{ command: "echo ONE" }, { command: "echo TWO" }]);
  assert.strictEqual(parser.flush().text, "");
});

test("StreamingToolParser: recovers invoke name envelopes across chunks", () => {
  const output = '<invoke name="terminal">{"command":"echo invoke"}</invoke>';
  for (let split = 0; split <= output.length; split++) {
    const parser = new StreamingToolParser(TERMINAL_TOOLS);
    const first = parser.feed(output.slice(0, split));
    const second = parser.feed(output.slice(split));
    const tail = parser.flush();
    const calls = [...first.toolCalls, ...second.toolCalls, ...tail.toolCalls];
    assert.strictEqual(calls.length, 1, "split " + split);
    assert.strictEqual(calls[0].name, "terminal");
    assert.deepStrictEqual(calls[0].arguments, { command: "echo invoke" });
    assert.strictEqual(first.text + second.text + tail.text, "");
  }
});

test("StreamingToolParser: marks an incomplete invoke opener as truncated", () => {
  const parser = new StreamingToolParser(TERMINAL_TOOLS);
  const result = parser.feed('<invoke name="terminal">');
  const flushed = parser.flush();
  assert.strictEqual(result.text + flushed.text, "");
  assert.strictEqual(result.toolCalls.length + flushed.toolCalls.length, 0);
  assert.strictEqual(flushed.truncatedToolCall, true);
});

test("named XML rejects incomplete, duplicate, unknown and unlabeled parameters", () => {
  for (const body of [
    'echo TEST</parameter_name>',
    '<parameter name="command">echo INCOMPLETE',
    '<parameter name="timeout">5</parameter_name>',
    '<parameter name="command">echo ONE</parameter_name><parameter name="command">echo TWO</parameter_name>',
    '<parameter name="command">echo ONE</parameter_name><parameter name="unknown">5</parameter_name>',
  ]) {
    const parser = new StreamingToolParser(TERMINAL_TOOLS);
    const first = parser.feed(`<tool_calls><tool_name>terminal</tool_name>${body}</tool_calls>`);
    const tail = parser.flush();
    assert.strictEqual(first.toolCalls.length + tail.toolCalls.length, 0);
    assert.strictEqual(first.text + tail.text, "");
    assert.ok(first.malformedToolCall || tail.truncatedToolCall);
  }
});

test("named XML preserves literal code and never invokes undeclared tools", () => {
  const literal = '<tool_calls><tool_name>unknown</tool_name><parameter name="command">echo TEST</parameter_name></tool_calls>';
  for (const output of [literal, `\`${literal}\``, `\`\`\`xml\n${literal}\n\`\`\``]) {
    const parser = new StreamingToolParser(TERMINAL_TOOLS);
    const results = [...output].map((character) => parser.feed(character));
    results.push(parser.flush());
    assert.strictEqual(results.flatMap((result) => result.toolCalls).length, 0);
    assert.strictEqual(results.map((result) => result.text).join(""), output);
  }
});

test("nested named parameters wait for the tool boundary across every split", () => {
  const output = '<tool_call_terminal><tool_call_command>echo QWEN_LOAD_08_b6592c9</tool_call_command><tool_call_timeout>5</tool_call_timeout></tool_call_terminal>';
  for (let split = 0; split <= output.length; split++) {
    const parser = new StreamingToolParser(TERMINAL_TOOLS);
    const first = parser.feed(output.slice(0, split));
    if (split < output.length) assert.strictEqual(first.toolCalls.length, 0);
    const last = parser.feed(output.slice(split));
    const tail = parser.flush();
    const calls = [...first.toolCalls, ...last.toolCalls, ...tail.toolCalls];
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, "terminal");
    assert.deepStrictEqual(calls[0].arguments, { command: "echo QWEN_LOAD_08_b6592c9", timeout: 5 });
    assert.strictEqual(first.text + last.text + tail.text, "");
  }
});

test("nested named parameters reject unknown, missing and unclosed arguments", () => {
  for (const content of [
    "<tool_call_unknown>echo nope</tool_call_unknown>",
    "<tool_call_timeout>5</tool_call_timeout>",
    "<tool_call_command>echo incomplete",
    "<tool_call_command>echo ok</tool_call_command><tool_call_timeout>incomplete",
  ]) {
    const parser = new StreamingToolParser(TERMINAL_TOOLS);
    const first = parser.feed(`<tool_call_terminal>${content}</tool_call_terminal>`);
    assert.strictEqual(first.toolCalls.length, 0);
    assert.strictEqual(parser.flush().toolCalls.length, 0);
  }
});

test("generic tool closer recovers named arguments without consuming a quoted closer", () => {
  const output = '<tool_call_read_file>{"path":"literal</tool>.txt"}</tool>';
  for (let split = 0; split <= output.length; split++) {
    const parser = new StreamingToolParser(TOOLS);
    const calls = [
      ...parser.feed(output.slice(0, split)).toolCalls,
      ...parser.feed(output.slice(split)).toolCalls,
    ];
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, "read_file");
    assert.deepStrictEqual(calls[0].arguments, { path: "literal</tool>.txt" });
    assert.strictEqual(parser.flush().truncatedToolCall, false);
  }
});

test("empty generic wrappers do not swallow the following valid tool", () => {
  const parser = new StreamingToolParser(TOOLS);
  const result = parser.feed('<tool_call_read_file></tool><tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>');
  assert.strictEqual(result.toolCalls.length, 1);
  assert.deepStrictEqual(result.toolCalls[0].arguments, { path: "a.txt" });
  assert.strictEqual(parser.flush().truncatedToolCall, false);
});

const EDIT_FILE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Edit a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                old_text: { type: "string" },
                new_text: { type: "string" },
              },
              required: ["old_text", "new_text"],
            },
          },
        },
        required: ["path", "edits"],
      },
    },
  },
];

const TOOL_SEARCH_TOOLS = [
  {
    type: "function" as const,
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
    type: "function" as const,
    function: {
      name: "search_files",
      description: "Search local files",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          target: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["pattern"],
      },
    },
  },
];

test("StreamingToolParser: basic tool call", () => {
  const parser = new StreamingToolParser();

  const result = parser.feed(
    'Hello! <tool_call>{"name": "t1", "arguments": {"a": 1}}</tool_call>',
  );
  // Text before tool call is held in pendingLeadIn when tools are present
  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "t1");
});

test("StreamingToolParser: parses tool-specific wrapper tags", () => {
  const parser = new StreamingToolParser();
  const result = parser.feed(
    '<tool_call_terminal>{"name":"terminal","arguments":{"command":"printf ok"}}</tool_call_terminal>',
  );

  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "terminal");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    command: "printf ok",
  });
});

test("StreamingToolParser: gets bridge name from a named wrapper with direct arguments", () => {
  const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
  const result = parser.feed(
    '<tool_call_search>{"queries":["handoff file"]}</tool_call_search>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "tool_search");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    queries: ["handoff file"],
  });
});

test("StreamingToolParser: maps nested search arguments to the uniquely compatible declared tool", () => {
  for (const output of [
    '<tool_call_search><arguments>{"pattern":"*handoff*","target":"files","limit":20}</arguments></tool_call_search>',
    '<tool_call_search><arguments>{"pattern":"*handoff*","target":"files","limit":20}}</tool_call_search>',
  ]) {
    for (let split = 0; split <= output.length; split++) {
      const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
      const first = parser.feed(output.slice(0, split));
      const second = parser.feed(output.slice(split));
      const tail = parser.flush();
      const calls = [...first.toolCalls, ...second.toolCalls, ...tail.toolCalls];

      assert.strictEqual(calls.length, 1, `split ${split}: ${output}`);
      assert.strictEqual(calls[0].name, "search_files");
      assert.deepStrictEqual(calls[0].arguments, {
        pattern: "*handoff*",
        target: "files",
        limit: 20,
      });
      assert.strictEqual(first.text + second.text + tail.text, "");
      assert.strictEqual(tail.truncatedToolCall, false);
    }
  }
});

test("StreamingToolParser: rejects nested search arguments that match no declared schema", () => {
  const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
  const result = parser.feed(
    '<tool_call_search><arguments>{"command":"rm -rf /"}</arguments></tool_call_search>',
  );

  assert.strictEqual(result.toolCalls.length, 0);
  assert.strictEqual(result.text, "");
  assert.strictEqual(result.malformedToolCall, true);
});

test("StreamingToolParser: holds a fragmented named wrapper until it is complete", () => {
  const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
  const first = parser.feed("<tool_call_");
  const second = parser.feed(
    'search>{"queries":["handoff"]}</tool_call_search>',
  );

  assert.strictEqual(first.text, "");
  assert.strictEqual(first.toolCalls.length, 0);
  assert.strictEqual(second.text, "");
  assert.strictEqual(second.toolCalls.length, 1);
  assert.strictEqual(second.toolCalls[0].name, "tool_search");
  assert.deepStrictEqual(second.toolCalls[0].arguments, {
    queries: ["handoff"],
  });
});

test("StreamingToolParser: recovers a quoted malformed opener followed by complete JSON", () => {
  const output =
    '<tool_call"\n{"name":"search_files","arguments":{"pattern":"package.json","target":"files"}}';

  for (let split = 0; split <= output.length; split++) {
    const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
    const first = parser.feed(output.slice(0, split));
    const second = parser.feed(output.slice(split));
    const tail = parser.flush();
    const calls = [...first.toolCalls, ...second.toolCalls, ...tail.toolCalls];

    assert.strictEqual(calls.length, 1, `split ${split}`);
    assert.strictEqual(calls[0].name, "search_files");
    assert.deepStrictEqual(calls[0].arguments, {
      pattern: "package.json",
      target: "files",
    });
    assert.strictEqual(first.text + second.text + tail.text, "");
  }
});

test("StreamingToolParser: parses Qwen native tool control tokens", () => {
  const parser = new StreamingToolParser(TOOLS);
  const result = parser.feed(
    '<tool_call_calls_section_begin|><tool_call_begin|>read_file<|tool_call_argument_begin|>{"path":"handoff.md"}\n</tool_call_end|>\n</tool_calls_section_end|>',
  );
  const flushed = parser.flush();

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "read_file");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    path: "handoff.md",
  });
  assert.strictEqual(flushed.text, "");
  assert.strictEqual(flushed.toolCalls.length, 0);
  assert.strictEqual(flushed.truncatedToolCall, false);
});

test("StreamingToolParser: parses fragmented Qwen native tool control tokens", () => {
  const parser = new StreamingToolParser(TOOLS);
  const chunks = [
    "<tool_call_calls_section_",
    "begin|><tool_call_begin|>read_",
    'file<|tool_call_argument_begin|>{"path":"handoff.md"}',
    "\n</tool_call_",
    "end|>\n</tool_calls_section_",
    "end|>",
  ];

  const results = chunks.map((chunk) => parser.feed(chunk));
  const flushed = parser.flush();
  const text = results.map((result) => result.text).join("") + flushed.text;
  const toolCalls = results.flatMap((result) => result.toolCalls);

  assert.strictEqual(text, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].name, "read_file");
  assert.deepStrictEqual(toolCalls[0].arguments, { path: "handoff.md" });
  assert.strictEqual(flushed.truncatedToolCall, false);
});

test("StreamingToolParser: recovers a pipe opener and slash closer before simulated results", () => {
  const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
  const chunks = [
    "<tool_call|",
    '\n{"name":"tool_search","arguments":{"queries":["read file"]}}',
    "\n</tool_call/>",
    '<tool_call_result>{"result":"invented result"}</tool_call_result>',
    "I read a file without waiting for the tool.",
  ];
  const results = [...chunks.map((chunk) => parser.feed(chunk)), parser.flush()];

  assert.strictEqual(results.map((result) => result.text).join(""), "");
  const calls = results.flatMap((result) => result.toolCalls);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, "tool_search");
  assert.deepStrictEqual(calls[0].arguments, { queries: ["read file"] });
  assert.ok(results.every((result) => !result.truncatedToolCall));
});

test("StreamingToolParser: handles multiple native calls and the unslashed section end", () => {
  const parser = new StreamingToolParser(TOOLS);
  const result = parser.feed(
    '<tool_call_calls_section_begin|><tool_call_begin|>read_file<|tool_call_argument_begin|>{"path":"first.md"}</tool_call_end|>' +
      '<tool_call_begin|>read_file<|tool_call_argument_begin|>{"path":"second.md"}</tool_call_end|><tool_calls_section_end|>',
  );

  assert.strictEqual(result.text, "");
  assert.deepStrictEqual(
    result.toolCalls.map((call) => [call.name, call.arguments]),
    [
      ["read_file", { path: "first.md" }],
      ["read_file", { path: "second.md" }],
    ],
  );
  assert.strictEqual(parser.flush().truncatedToolCall, false);
});

test("StreamingToolParser: parses native JSON envelopes observed from Qwen", () => {
  const parser = new StreamingToolParser([...TOOLS, ...TERMINAL_TOOLS]);
  const result = parser.feed(
    '<tool_call_begin|>{"arguments":{"path":"package.json"},"tool_name":"read_file"}<tool_call_end|>' +
      '<tool_call_begin|>{"arguments":{"command":"echo QWEN_BUFFER"},"tool_name":"terminal"}<tool_call_end|>' +
      '<tool_calls_section_end|>',
  );
  const flushed = parser.flush();

  assert.strictEqual(result.text + flushed.text, "");
  assert.deepStrictEqual(
    [...result.toolCalls, ...flushed.toolCalls].map((call) => [
      call.name,
      call.arguments,
    ]),
    [
      ["read_file", { path: "package.json" }],
      ["terminal", { command: "echo QWEN_BUFFER" }],
    ],
  );
});

test("StreamingToolParser: never invokes undeclared Qwen native tools", () => {
  const parser = new StreamingToolParser(TOOLS);
  const result = parser.feed(
    '<tool_call_calls_section_begin|><tool_call_begin|>delete_everything<|tool_call_argument_begin|>{"path":"/"}\n</tool_call_end|>\n</tool_calls_section_end|>',
  );
  const flushed = parser.flush();

  assert.strictEqual(result.text + flushed.text, "");
  assert.strictEqual(result.toolCalls.length + flushed.toolCalls.length, 0);
});

test("StreamingToolParser: never reinterprets undeclared native arguments as a call", () => {
  const parser = new StreamingToolParser(TOOLS);
  const result = parser.feed(
    '<tool_call_begin|>unknown<|tool_call_argument_begin|>{"name":"read_file","arguments":{"path":"private.md"}}</tool_call_end|>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: preserves native control tokens inside Markdown code", () => {
  const parser = new StreamingToolParser(TOOLS);
  const literal = "`</tool_calls_section_end|>`";

  const result = parser.feed(literal);

  assert.strictEqual(result.text, literal);
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: recovers direct arguments from a named closing wrapper", () => {
  const parser = new StreamingToolParser(TOOL_SEARCH_TOOLS);
  const result = parser.feed(
    '>\n{"queries":["handoff document"]}\n</tool_call_search>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "tool_search");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    queries: ["handoff document"],
  });
});

test("StreamingToolParser: suppresses repeated corrupt nested tool markers", () => {
  const parser = new StreamingToolParser(TOOLS);
  const corrupt =
    'Beleza, testando as tools:\n\n<tool_call<tool_call{}>> "terminal", "parameters": {}}\n' +
    '</tool_call<tool_call{}>> "terminal", "parameters": {}}\n'.repeat(4);

  const streamed = parser.feed(corrupt);
  const flushed = parser.flush();

  assert.strictEqual(streamed.text, "Beleza, testando as tools:\n\n");
  assert.strictEqual(streamed.toolCalls.length, 0);
  assert.strictEqual(flushed.text, "");
  assert.strictEqual(flushed.toolCalls.length, 0);
  assert.strictEqual(flushed.truncatedToolCall, false);
});

test("StreamingToolParser: holds a fragmented corrupt nested marker", () => {
  const parser = new StreamingToolParser(TOOLS);

  const first = parser.feed("Antes\n<tool_call<tool_");
  const second = parser.feed(
    'call{}>> "terminal", "parameters": {}}\n</tool_call<tool_call{}>>',
  );

  assert.strictEqual(first.text, "Antes\n");
  assert.strictEqual(second.text, "");
  assert.strictEqual(second.toolCalls.length, 0);
  assert.strictEqual(parser.flush().truncatedToolCall, false);
});

test("StreamingToolParser: preserves corrupt-looking markers inside code", () => {
  const parser = new StreamingToolParser(TOOLS);
  const literal = "`<tool_call<tool_call{}>>`";

  const result = parser.feed(literal);

  assert.strictEqual(result.text, literal);
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: recovers punctuated wrapper tags", () => {
  const parser = new StreamingToolParser();
  const result = parser.feed(
    '<tool_call>{"name":"terminal","arguments":{"command":"echo ok"}}</tool_call~>' +
      '<tool_call~!>{"name":"read_file","arguments":{"path":"/tmp/a"}}</tool_call~>',
  );

  assert.strictEqual(result.toolCalls.length, 2);
  assert.deepStrictEqual(
    result.toolCalls.map((call) => [call.name, call.arguments]),
    [
      ["terminal", { command: "echo ok" }],
      ["read_file", { path: "/tmp/a" }],
    ],
  );
});

test("StreamingToolParser: recovers newline-terminated wrapper tags", () => {
  const parser = new StreamingToolParser();
  const result = parser.feed(
    '<tool_call\r\n\r\n{"name":"terminal","arguments":{"command":"printf ok"}}\r\n</tool_call\r\n',
  );

  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "terminal");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    command: "printf ok",
  });
});

test("StreamingToolParser: multiple tool calls", () => {
  const parser = new StreamingToolParser();

  const result = parser.feed(
    '<tool_call>{"name": "t2", "arguments": {}}</tool_call><tool_call>{"name": "t3", "arguments": {}}</tool_call>',
  );
  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 2);
  assert.strictEqual(result.toolCalls[0].name, "t2");
  assert.strictEqual(result.toolCalls[1].name, "t3");
});

test("StreamingToolParser: recovers tool_calling and deduplicates identical calls", () => {
  const parser = new StreamingToolParser(TOOLS);
  const block =
    '<tool_calling>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_calling>';
  const result = parser.feed(`${block}\nI should call it now.\n${block}`);

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "read_file");
  assert.deepStrictEqual(result.toolCalls[0].arguments, { path: "a.txt" });
});

test("StreamingToolParser: recovers the tool_caller wrapper", () => {
  const parser = new StreamingToolParser();
  const first = parser.feed(
    '<tool_caller>{"name":"terminal","arguments":{"command":"sha256sum package-lock.json"}}',
  );
  const second = parser.feed("</tool_caller>");

  assert.strictEqual(first.toolCalls.length, 0);
  assert.strictEqual(second.text, "");
  assert.strictEqual(second.toolCalls.length, 1);
  assert.strictEqual(second.toolCalls[0].name, "terminal");
  assert.deepStrictEqual(second.toolCalls[0].arguments, {
    command: "sha256sum package-lock.json",
  });
});

test("StreamingToolParser: preserves ellipsis placeholders as ordinary text", () => {
  const parser = new StreamingToolParser(TOOLS);
  const first = parser.feed("<tool_call");
  const second = parser.feed("...>\nCODEX_");
  const third = parser.feed("FINAL_TOOL_OK");
  const flushed = parser.flush();

  assert.strictEqual(
    first.text + second.text + third.text + flushed.text,
    "<tool_call...>\nCODEX_FINAL_TOOL_OK",
  );
  assert.strictEqual(flushed.toolCalls.length, 0);
  assert.strictEqual(flushed.truncatedToolCall, false);
});

test("StreamingToolParser: fragmented tool call", () => {
  const parser = new StreamingToolParser();

  // Text before partial tag is emitted immediately (no complete tag yet)
  assert.strictEqual(parser.feed("Text <tool_").text, "Text ");
  assert.strictEqual(parser.feed("call>").text, "");
  const final = parser.feed(
    '{"name": "frag", "arguments": {}}</tool_call> trailing',
  );

  assert.strictEqual(final.toolCalls.length, 1);
  assert.strictEqual(final.toolCalls[0].name, "frag");
  assert.strictEqual(final.text, "");
});

test("StreamingToolParser: flush partial content", () => {
  const parser = new StreamingToolParser();

  assert.strictEqual(parser.feed("Unfinished tag <tool_").text, "Unfinished tag ");
  const partialTag = parser.flush();
  assert.strictEqual(partialTag.text, "");
  assert.strictEqual(partialTag.truncatedToolCall, true);

  const bareMarkerParser = new StreamingToolParser(TOOLS);
  assert.strictEqual(bareMarkerParser.feed("<tool_call").text, "");
  const bareMarker = bareMarkerParser.flush();
  assert.strictEqual(bareMarker.text, "");
  assert.strictEqual(bareMarker.toolCalls.length, 0);
  assert.strictEqual(bareMarker.truncatedToolCall, true);

  const emptyBlockParser = new StreamingToolParser(TOOLS);
  assert.strictEqual(emptyBlockParser.feed("<tool_call>").text, "");
  const emptyBlock = emptyBlockParser.flush();
  assert.strictEqual(emptyBlock.text, "");
  assert.strictEqual(emptyBlock.toolCalls.length, 0);
  assert.strictEqual(emptyBlock.truncatedToolCall, true);

  for (const literal of ["<tool_calls", "<tool_calligraphy"]) {
    const literalParser = new StreamingToolParser(TOOLS);
    const fed = literalParser.feed(`Literal ${literal}`);
    const visibleText = fed.text + literalParser.flush().text;
    assert.strictEqual(visibleText, `Literal ${literal}`);
  }

  // Incomplete JSON in tool call - flush should recover it
  const parser2 = new StreamingToolParser();
  parser2.feed('Broken tool <tool_call>{"name": "healable"');
  const flushed = parser2.flush();
  assert.strictEqual(flushed.toolCalls.length, 1);
  assert.strictEqual(flushed.toolCalls[0].name, "healable");
  assert.strictEqual(flushed.truncatedToolCall, false);

  const parser3 = new StreamingToolParser();
  parser3.feed("Invalid <tool_call>NOT_JSON");
  const flushed2 = parser3.flush();
  assert.strictEqual(flushed2.text, "");
  assert.strictEqual(flushed2.toolCalls.length, 0);
  assert.strictEqual(flushed2.truncatedToolCall, true);
});

test("StreamingToolParser: suppresses Qwen malformed attribute opener", () => {
  const parser = new StreamingToolParser(TOOLS);
  const first = parser.feed("The handoff is pending.\n\n<tool_call=");
  const second = parser.feed('"tool_call">');
  const flushed = parser.flush();

  assert.strictEqual(first.text + second.text + flushed.text, "The handoff is pending.\n\n");
  assert.strictEqual(flushed.toolCalls.length, 0);
  assert.strictEqual(flushed.truncatedToolCall, true);
});

test("StreamingToolParser: suppresses orphan invocation closers across chunks", () => {
  const parser = new StreamingToolParser(TOOLS);
  const first = parser.feed("</tool_call_");
  const second = parser.feed("invocation>");
  const third = parser.feed("</tool_call_invocation>");
  const flushed = parser.flush();
  const text = first.text + second.text + third.text + flushed.text;

  assert.strictEqual(text, "");
  assert.strictEqual(text.includes("tool_call_invocation"), false);
  assert.strictEqual(second.malformedToolCall, true);
  assert.strictEqual(third.malformedToolCall, true);
});

test("StreamingToolParser: preserves orphan-looking closers inside Markdown code", () => {
  const parser = new StreamingToolParser(TOOLS);
  const literal = "\`</tool_call_invocation>\`";
  const result = parser.feed(literal);

  assert.strictEqual(result.text + parser.flush().text, literal);
  assert.strictEqual(result.malformedToolCall, undefined);
});

test("StreamingToolParser: robust parsing of malformed JSON", () => {
  const parser = new StreamingToolParser();

  const res = parser.feed(
    '<tool_call>{"name": "broken", "arguments": {"a": 1</tool_call>',
  );
  assert.strictEqual(res.toolCalls.length, 1);
  assert.strictEqual(res.toolCalls[0].name, "broken");
  assert.deepStrictEqual(res.toolCalls[0].arguments, { a: 1 });
});

test("StreamingToolParser: recovers missing opening tag and flattens nested arguments", () => {
  const parser = new StreamingToolParser([
    {
      type: "function",
      function: {
        name: "recovered",
        description: "",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    },
  ]);

  const res = parser.feed(
    '{"name": "recovered", "arguments": {"arguments": {"path": "a.txt"}}}</tool_call>',
  );
  assert.strictEqual(res.toolCalls.length, 1);
  assert.strictEqual(res.toolCalls[0].name, "recovered");
  assert.deepStrictEqual(res.toolCalls[0].arguments, { path: "a.txt" });
});

test("StreamingToolParser: preserves tags in non-tool text", () => {
  const parser = new StreamingToolParser();

  // When it looks like a tool call (has open+close tags), it tries to parse
  // If parse fails, tags are NOT preserved (they're dropped as malformed tool calls)
  const res1 = parser.feed(
    'Fake: <tool_call> { "only_args": 1 } </tool_call> ',
  );
  // Malformed tool call is dropped, lead-in restored (with trailing space)
  assert.strictEqual(res1.text, "Fake:  ");
  assert.strictEqual(res1.toolCalls.length, 0);

  const res2 = parser.feed('Real: <tool_call>{"name":"r"}</tool_call>');
  assert.strictEqual(res2.toolCalls.length, 1);
  assert.strictEqual(res2.toolCalls[0].name, "r");
});

test("StreamingToolParser: handles multiple tool calls in array format", () => {
  const parser = new StreamingToolParser();

  const chunk = `<tool_call>[
  {"name": "bash", "arguments": {"command": "ls", "description": "List files"}},
  {"name": "read", "arguments": {"path": "test.txt"}}
]</tool_call>`;

  const result = parser.feed(chunk);
  assert.strictEqual(
    result.toolCalls.length,
    2,
    "Should extract both tool calls",
  );
  assert.strictEqual(result.toolCalls[0].name, "bash");
  assert.strictEqual(result.toolCalls[1].name, "read");
  assert.strictEqual(result.toolCalls[0].arguments.command, "ls");
});

test("StreamingToolParser: no tool calls emits text normally", () => {
  const parser = new StreamingToolParser();

  const result = parser.feed("Hello, how can I help you today?");
  assert.strictEqual(result.text, "Hello, how can I help you today?");
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: pendingLeadIn cleared after tool call", () => {
  const parser = new StreamingToolParser();

  // After processing a successful tool call, pendingLeadIn is cleared
  parser.feed(
    'Hello! <tool_call>{"name": "t1", "arguments": {"a": 1}}</tool_call>',
  );
  assert.strictEqual(parser.getPendingLeadIn(), "");
  assert.strictEqual(parser.getEmittedToolCallCount(), 1);
});

test("StreamingToolParser: preserves literal <tool_call> inside inline code across chunks", () => {
  const parser = new StreamingToolParser(TOOLS);

  const first = parser.feed(
    "Para usar uma ferramenta, eu gero um bloco JSON envolto exatamente nas tags `",
  );
  assert.strictEqual(
    first.text,
    "Para usar uma ferramenta, eu gero um bloco JSON envolto exatamente nas tags `",
  );
  assert.strictEqual(first.toolCalls.length, 0);

  const second = parser.feed("<tool_call>`. A estrutura é sempre esta:");
  assert.strictEqual(second.text, "<tool_call>`. A estrutura é sempre esta:");
  assert.strictEqual(second.toolCalls.length, 0);
});

test("StreamingToolParser: preserves literal <tool_call> example in fenced code block", () => {
  const parser = new StreamingToolParser(TOOLS);

  const literal = [
    "Exemplo:",
    "```json",
    "<tool_call>",
    '{"name":"nome_da_ferramenta","arguments":{"parametro":"valor"}}',
    "</tool_call>",
    "```",
  ].join("\n");

  const result = parser.feed(literal);
  assert.strictEqual(result.text, literal);
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: preserves explained literal tool_call block when tool name is undeclared", () => {
  const parser = new StreamingToolParser(TOOLS);

  const literal =
    'Exemplo: <tool_call>{"name":"nome_da_ferramenta","arguments":{"parametro":"valor"}}</tool_call>';

  const result = parser.feed(literal);
  assert.strictEqual(result.text, literal);
  assert.strictEqual(result.toolCalls.length, 0);
});

test("StreamingToolParser: suppresses a bare undeclared vision call with a Windows path", () => {
  const parser = new StreamingToolParser(TERMINAL_TOOLS);
  const raw = String.raw`<tool_call> {"name": "vision_analyze", "arguments": {"image_url": "C:\Users\sofia\AppData\Roaming\Hermes\composer-images\image.png", "query": "Descreva a imagem"}} </tool_call>`;

  const result = parser.feed(raw);
  const flushed = parser.flush();

  assert.strictEqual(result.text + flushed.text, "");
  assert.strictEqual(result.toolCalls.length + flushed.toolCalls.length, 0);
  assert.strictEqual(result.malformedToolCall, undefined);
  assert.strictEqual(flushed.malformedToolCall, undefined);
});

test("StreamingToolParser: passes through recovered tool call with undeclared name", () => {
  const parser = new StreamingToolParser(TOOLS);

  const result = parser.feed(
    'Lead <tool_call>name": "invented_tool", "arguments": {"path": "a.txt"}}</tool_call>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "invented_tool");
});

test("StreamingToolParser: accepts declared tool names from flat tool definitions", () => {
  const parser = new StreamingToolParser(FLAT_TOOLS as any);

  const result = parser.feed(
    '<tool_call>{"name":"task","arguments":{"description":"Resume backend analysis","prompt":"Analyze all files"}}</tool_call>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "task");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    description: "Resume backend analysis",
    prompt: "Analyze all files",
  });
});

test("StreamingToolParser: fuzzy-matches declared tool names safely", () => {
  const parser = new StreamingToolParser(TOOLS);

  const result = parser.feed(
    '<tool_call>{"name":"readFile","arguments":{"path":"src/index.ts"}}</tool_call>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "read_file");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    path: "src/index.ts",
  });
});

test("StreamingToolParser: parses case-insensitive tool close tags", () => {
  const parser = new StreamingToolParser(TOOLS);

  const result = parser.feed(
    '<tool_call>{"name":"read_file","arguments":{"path":"package.json"}}</TOOL_CALL>',
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "read_file");
  assert.deepStrictEqual(result.toolCalls[0].arguments, {
    path: "package.json",
  });
});

test("StreamingToolParser: parses double-escaped JSON argument strings", () => {
  const parser = new StreamingToolParser(EDIT_FILE_TOOLS);

  const escapedEdits = JSON.stringify([
    { old_text: "a", new_text: "b" },
  ]).replaceAll('"', "\\" + '"');
  const payload = `<tool_call>${JSON.stringify({
    name: "edit_file",
    arguments: { path: "src/a.ts", edits: escapedEdits },
  })}</tool_call>`;
  const result = parser.feed(payload);

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "edit_file");
  assert.deepStrictEqual(result.toolCalls[0].arguments.edits, [
    { old_text: "a", new_text: "b" },
  ]);
});

test("StreamingToolParser: parses JSON-stringified nested argument fields", () => {
  const parser = new StreamingToolParser(EDIT_FILE_TOOLS);
  const edits = [
    {
      old_text:
        "        const streamState = createStreamState(responseId, requestModel);\n        let completionTokens = 0;\n        let streamError: Error | null = null;",
      new_text:
        "        const streamState = createStreamState(responseId, requestModel);\n        let completionTokens = 0;\n        let streamError: Error | null = null;\n        resetTimeout();",
    },
  ];

  const result = parser.feed(
    `<tool_call>${JSON.stringify({
      name: "edit_file",
      arguments: {
        path: "src/routes/responses/index.ts",
        edits: JSON.stringify(edits),
      },
    })}</tool_call>`,
  );

  assert.strictEqual(result.text, "");
  assert.strictEqual(result.toolCalls.length, 1);
  assert.strictEqual(result.toolCalls[0].name, "edit_file");
  assert.strictEqual(
    result.toolCalls[0].arguments.path,
    "src/routes/responses/index.ts",
  );
  assert.deepStrictEqual(result.toolCalls[0].arguments.edits, edits);
});
