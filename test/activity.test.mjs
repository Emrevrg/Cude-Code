import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityEntry, formatActivity, summarizeActivity } from '../dist/core/activity.js';

test('activity summary counts observable events and excludes hidden reasoning', () => {
  const entries = [
    activityEntry('user', 'User turn', 'turn 1'),
    activityEntry('model', 'Model response', 'Streaming response completed', { cost: 0.25, inputTokens: 10, outputTokens: 20 }),
    activityEntry('tool', 'Tool: read_file', 'path=README.md'),
    activityEntry('error', 'Model request failed', 'timeout'),
  ];
  const summary = summarizeActivity(entries);
  assert.equal(summary.turns, 1);
  assert.equal(summary.modelCalls, 1);
  assert.equal(summary.toolCalls, 1);
  assert.equal(summary.errors, 1);
  assert.equal(summary.totalCost, 0.25);
  assert.match(formatActivity(entries), /Tool: read_file/);
  assert.doesNotMatch(formatActivity(entries), /chain-of-thought|private reasoning/i);
});
