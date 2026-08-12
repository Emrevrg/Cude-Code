// Wire-format mapping for the tool-call protocol (F2).
//
// The Anthropic path cannot be exercised against the local stub server, and
// Anthropic is the default provider for `code` tasks — so its mapping is
// asserted directly here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { toOpenAIWireMessages, toAnthropicWireMessages, validateTurnSequence } =
  await import('../dist/providers/wire.js');

/** A one-round-trip conversation as the agent now builds it. */
const conversation = [
  { role: 'user', content: 'read the manifest' },
  {
    role: 'assistant',
    content: 'reading it now',
    tool_calls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'package.json' } }],
  },
  { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: '{"name":"cude-code"}' },
];

describe('F2: OpenAI wire format', () => {
  test('F2: assistant tool_calls are serialised into the protocol fields', () => {
    const wire = toOpenAIWireMessages(conversation, 'system prompt');

    assert.equal(wire[0].role, 'system');
    const assistant = wire.find(m => m.role === 'assistant');
    assert.equal(assistant.tool_calls[0].type, 'function');
    assert.equal(assistant.tool_calls[0].id, 'call_1');
    assert.equal(assistant.tool_calls[0].function.name, 'read_file');
    assert.equal(assistant.tool_calls[0].function.arguments, '{"path":"package.json"}');
  });

  test('F2: a tool result becomes a tool message keyed by tool_call_id', () => {
    const wire = toOpenAIWireMessages(conversation);
    const tool = wire.find(m => m.role === 'tool');
    assert.equal(tool.tool_call_id, 'call_1');
    assert.match(tool.content, /cude-code/);
  });

  test('F2: an assistant turn with only tool calls sends null content, not an empty string', () => {
    const wire = toOpenAIWireMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c', name: 't', arguments: {} }] },
      { role: 'tool', tool_call_id: 'c', content: 'ok' },
    ]);
    assert.equal(wire.find(m => m.role === 'assistant').content, null);
  });
});

describe('F2: Anthropic wire format', () => {
  test('F2: tool calls map to tool_use blocks on the assistant message', () => {
    const wire = toAnthropicWireMessages(conversation);
    const assistant = wire.find(m => m.role === 'assistant');

    assert.ok(Array.isArray(assistant.content), 'assistant content must be blocks');
    assert.deepEqual(
      assistant.content.map(b => b.type),
      ['text', 'tool_use']
    );
    const toolUse = assistant.content[1];
    assert.equal(toolUse.id, 'call_1');
    assert.equal(toolUse.name, 'read_file');
    assert.deepEqual(toolUse.input, { path: 'package.json' });
  });

  test('F2: tool results map to tool_result blocks in a user message keyed by tool_use_id', () => {
    const wire = toAnthropicWireMessages(conversation);
    const last = wire[wire.length - 1];

    assert.equal(last.role, 'user', 'a tool result is a user turn for Anthropic');
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].tool_use_id, 'call_1');
  });

  test('F2: consecutive tool results are merged into a single user message', () => {
    const wire = toAnthropicWireMessages([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'a', name: 't', arguments: {} },
          { id: 'b', name: 't', arguments: {} },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'one' },
      { role: 'tool', tool_call_id: 'b', content: 'two' },
    ]);

    const userTurns = wire.filter(m => m.role === 'user');
    assert.equal(userTurns.length, 2, 'both results belong to one user turn');
    assert.equal(userTurns[1].content.length, 2);
  });

  test('F2: the mapping never emits two consecutive assistant turns and never ends on one', () => {
    const wire = toAnthropicWireMessages([
      ...conversation,
      { role: 'assistant', content: 'and again', tool_calls: [{ id: 'call_2', name: 'read_file', arguments: {} }] },
      { role: 'tool', tool_call_id: 'call_2', content: 'more' },
    ]);

    for (let i = 1; i < wire.length; i++) {
      assert.ok(
        !(wire[i].role === 'assistant' && wire[i - 1].role === 'assistant'),
        'two consecutive assistant turns'
      );
    }
    assert.notEqual(wire[wire.length - 1].role, 'assistant');
  });
});

describe('F2: turn-sequence invariant', () => {
  test('F2: a well-formed conversation passes', () => {
    assert.equal(validateTurnSequence(conversation), null);
  });

  test('F2: two consecutive assistant messages are rejected', () => {
    const bad = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'one' },
      { role: 'assistant', content: 'two' },
    ];
    assert.match(validateTurnSequence(bad), /consecutive assistant/);
  });

  test('F2: ending on an assistant message is rejected', () => {
    const bad = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'one' },
    ];
    assert.match(validateTurnSequence(bad), /ends on an assistant message/);
  });

  test('F2: a tool message without a matching call is rejected', () => {
    const bad = [
      { role: 'user', content: 'go' },
      { role: 'tool', tool_call_id: 'nope', content: 'orphan' },
    ];
    assert.match(validateTurnSequence(bad), /unknown tool_call_id/);
  });
});
