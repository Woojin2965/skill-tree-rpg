import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placementStep, type PlacementAnswer, type PlacementSkill } from './placement.ts';

const TREE: PlacementSkill[] = [
  { id: 'derivatives', prerequisites: ['factoring', 'function-values'] },
  { id: 'expanding', prerequisites: ['linear-equations'] },
  { id: 'factoring', prerequisites: ['expanding'] },
  { id: 'function-values', prerequisites: ['linear-equations'] },
  { id: 'linear-equations', prerequisites: [] },
  { id: 'partial-derivatives', prerequisites: ['derivatives'] },
];

const probe = (skillId: string, correct: boolean): PlacementAnswer[] => [
  { skillId, correct: true },
  { skillId, correct },
];

// Plays a whole placement for a player who knows exactly the skills in `known`.
function play(skills: PlacementSkill[], known: (id: string) => boolean) {
  const answers: PlacementAnswer[] = [];
  for (;;) {
    const step = placementStep(skills, answers);
    if ('passed' in step) return { passed: step.passed, count: answers.length };
    answers.push({ skillId: step.next, correct: known(step.next) });
  }
}

test('the first probe sits in the middle of the tree', () => {
  assert.deepEqual(placementStep(TREE, []), { next: 'factoring' });
});

test('a probe asks twice before it is decided', () => {
  assert.deepEqual(placementStep(TREE, [{ skillId: 'factoring', correct: true }]), { next: 'factoring' });
  assert.deepEqual(placementStep(TREE, [{ skillId: 'factoring', correct: false }]), { next: 'factoring' });
});

test('one wrong answer fails the probe', () => {
  const answers = [{ skillId: 'factoring', correct: false }, { skillId: 'factoring', correct: true }];
  assert.notDeepEqual(placementStep(TREE, answers), { next: 'factoring' });
});

test('a passed probe passes every ancestor, so they are never asked', () => {
  const { passed } = play(TREE, (id) => id === 'derivatives' || id === 'factoring' || id === 'function-values');
  assert.deepEqual(passed, ['derivatives', 'expanding', 'factoring', 'function-values', 'linear-equations']);
});

test('a failed probe fails every descendant, so they are never asked', () => {
  const asked: string[] = [];
  const { passed } = play(TREE, (id) => (asked.push(id), false));
  assert.deepEqual(passed, []);
  assert.ok(!asked.includes('derivatives') && !asked.includes('partial-derivatives'));
});

test('ancestors pass through both branches of a diamond', () => {
  const answers = [...probe('derivatives', true), ...probe('partial-derivatives', false)];
  assert.deepEqual(placementStep(TREE, answers), {
    passed: ['derivatives', 'expanding', 'factoring', 'function-values', 'linear-equations'],
  });
});

test('the current tree finishes in far fewer than 20 problems', () => {
  for (const known of [() => true, () => false, (id: string) => id !== 'partial-derivatives']) {
    assert.ok(play(TREE, known).count <= 8);
  }
});

const chain = (size: number): PlacementSkill[] =>
  Array.from({ length: size }, (_, i) => ({ id: `s${i}`, prerequisites: i ? [`s${i - 1}`] : [] }));

test('a chain of hundreds is a binary search landing in 10 to 20 problems', () => {
  const skills = chain(400);
  for (const mastered of [-1, 0, 1, 57, 199, 200, 201, 398, 399]) {
    const { passed, count } = play(skills, (id) => Number(id.slice(1)) <= mastered);
    assert.equal(passed.length, mastered + 1);
    assert.ok(count >= 10 && count <= 20, `${mastered} took ${count}`);
  }
});

test('a wide DAG stops at the cap and undecided skills do not pass', () => {
  // Every skill in a row needs two skills of the row before it.
  const skills: PlacementSkill[] = [];
  for (let row = 0; row < 12; row++) {
    for (let i = 0; i < 30; i++) {
      const prerequisites = row ? [`${row - 1}-${i}`, `${row - 1}-${(i + 1) % 30}`] : [];
      skills.push({ id: `${row}-${i}`, prerequisites });
    }
  }
  const { passed, count } = play(skills, () => true);
  assert.equal(count, 20);
  assert.ok(passed.length > 0 && passed.length < skills.length);
  const { passed: none, count: failed } = play(skills, () => false);
  assert.deepEqual(none, []);
  assert.ok(failed >= 10 && failed <= 20);
});

test('skills without prerequisites still get decided', () => {
  const skills = [{ id: 'a', prerequisites: [] }, { id: 'b', prerequisites: [] }];
  assert.deepEqual(play(skills, (id) => id === 'b'), { passed: ['b'], count: 4 });
});
