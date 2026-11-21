import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveLevel, gateDue, gradeAfterReveal, gradeForLevel, gradeForPractice, isRusty, levelForXp, levelProgress, xpForLevel, xpPerSkill } from './xp.ts';

test('levels follow the RuneScape table', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(92), 6_517_253);
  assert.equal(xpForLevel(99), 13_034_431);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(82), 1);
  assert.equal(levelForXp(83), 2);
  assert.equal(levelForXp(13_034_430), 98);
  assert.equal(levelForXp(13_034_431), 99);
  assert.equal(levelForXp(999_999_999), 99);
});

test('XP splits across skills and rust pays 1.5x from grade C up', () => {
  assert.equal(xpPerSkill('B', 1, false), 1000);
  assert.equal(xpPerSkill('A', 2, false), 2500);
  assert.equal(xpPerSkill('S', 3, false), 6666);
  assert.equal(xpPerSkill('C', 1, true), 375);
  assert.equal(xpPerSkill('D', 1, true), 50);
});

test('rust threshold grows with level', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  assert.equal(isRusty(19, daysAgo(14), now), false);
  assert.equal(isRusty(19, daysAgo(15), now), true);
  assert.equal(isRusty(20, daysAgo(15), now), false);
  assert.equal(isRusty(39, daysAgo(31), now), true);
  assert.equal(isRusty(59, daysAgo(61), now), true);
  assert.equal(isRusty(60, daysAgo(90), now), false);
  assert.equal(isRusty(60, daysAgo(91), now), true);
  assert.equal(isRusty(1, null, now), false);
});

test('problem grade follows level bands', () => {
  assert.deepEqual([1, 9, 10, 29, 30, 49, 50, 69, 70, 99].map(gradeForLevel),
    ['D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'S', 'S']);
});

test('a rusty skill is offered grade C or higher, since only that restores it', () => {
  assert.equal(gradeForPractice(5, false), 'D');
  assert.equal(gradeForPractice(5, true), 'C');
  assert.equal(gradeForPractice(40, true), 'B');
});

test('a reveal drops one grade and a revealed D is worth nothing', () => {
  assert.deepEqual((['S', 'A', 'B', 'C', 'D'] as const).map(gradeAfterReveal), ['A', 'B', 'C', 'D', null]);
});

test('level stops at the first unpassed gate however much XP is earned', () => {
  const xp = xpForLevel(95);
  assert.equal(effectiveLevel(xpForLevel(29), []), 29);
  assert.equal(effectiveLevel(xp, []), 30);
  assert.equal(effectiveLevel(xp, [30]), 60);
  assert.equal(effectiveLevel(xp, [30, 60]), 90);
  assert.equal(effectiveLevel(xp, [30, 60, 90]), 95);
  assert.equal(effectiveLevel(xpForLevel(45), [30]), 45);
});

test('a gate is due once uncapped XP reaches it, in order', () => {
  assert.equal(gateDue(xpForLevel(30) - 1, []), null);
  assert.equal(gateDue(xpForLevel(30), []), 30);
  assert.equal(gateDue(xpForLevel(95), []), 30);
  assert.equal(gateDue(xpForLevel(59), [30]), null);
  assert.equal(gateDue(xpForLevel(95), [30]), 60);
  assert.equal(gateDue(xpForLevel(95), [30, 60, 90]), null);
});

test('the level ring fills inside a level and stays full at a gate or the top level', () => {
  assert.equal(levelProgress(0, []), 0);
  assert.equal(levelProgress((xpForLevel(5) + xpForLevel(6)) / 2, []), 0.5);
  assert.equal(levelProgress(xpForLevel(30), []), 1);
  assert.equal(levelProgress(xpForLevel(45), []), 1);
  assert.equal(levelProgress(xpForLevel(45), [30]), 0);
  assert.equal(levelProgress(xpForLevel(99), [30, 60, 90]), 1);
});
