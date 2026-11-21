import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUnfinished } from './answer.ts';

test('an empty slot left by MathLive is unfinished', () => {
  for (const value of ['\\frac{3}{\\placeholder{}}', '\\frac{\\placeholder{}}{3}', '\\placeholder{}', 'x^{}', '3^{}', 'x_{}', '\\frac{3}{}', '\\sqrt{}', 'x^{}+1']) {
    assert.equal(isUnfinished(value), true, value);
  }
});

test('a complete answer is not', () => {
  for (const value of ['3', '-\\frac{3}{4}', 'x^{2}+5x+6', 'x^2', '\\left(x+2\\right)\\left(x+3\\right)', '8\\left(x+1\\right)^{2}', '\\left\\{x\\right\\}']) {
    assert.equal(isUnfinished(value), false, value);
  }
});
