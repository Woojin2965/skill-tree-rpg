import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade } from './grade.ts';

const accepts = (input: string, answer: string, form: Parameters<typeof grade>[2]) =>
  assert.equal(grade(input, answer, form), true, `${input} should match ${answer}`);
const rejects = (input: string, answer: string, form: Parameters<typeof grade>[2]) =>
  assert.equal(grade(input, answer, form), false, `${input} should not match ${answer}`);

test('number answers compare as exact rationals', () => {
  accepts('2', '2', 'number');
  accepts('\\frac{1}{2}', '0.5', 'number');
  accepts('-\\frac{3}{4}', '-0.75', 'number');
  accepts('\\frac{2}{4}', '\\frac{1}{2}', 'number');
  rejects('3', '2', 'number');
  rejects('1+1', '2', 'number');
  rejects('x', '2', 'number');
  rejects('0.1+0.2', '0.3', 'number');
  rejects('\\frac{1}{0}', '1', 'number');
});

test('number answers can carry the sign inside the fraction', () => {
  accepts('\\frac{-9}{8}', '- \\frac{9}{8}', 'number');
  accepts('\\frac{9}{-8}', '- \\frac{9}{8}', 'number');
  accepts('\\frac{-6}{8}', '-\\frac{3}{4}', 'number');
  accepts('-3/4', '-\\frac{3}{4}', 'number');
  accepts('\\frac{-3}{-4}', '\\frac{3}{4}', 'number');
  rejects('\\frac{-9}{-8}', '- \\frac{9}{8}', 'number');
  rejects('\\frac{1+1}{2}', '1', 'number');
  rejects('\\frac{1}{\\frac{0}{1}}', '1', 'number');
});

test('number answers can end in zeros', () => {
  accepts('3.0', '3', 'number');
  accepts('-1.0', '-1', 'number');
  accepts('2.50', '\\frac{5}{2}', 'number');
  rejects('3.0', '4', 'number');
});

test('number answers can name the variable', () => {
  accepts('x=3', '3', 'number');
  accepts('x = 3', '3', 'number');
  accepts('k=-3', '-3', 'number');
  accepts('x=\\frac{2}{5}', '\\frac{2}{5}', 'number');
  rejects('x=4', '3', 'number');
  rejects('x=y', '3', 'number');
  rejects('2x=6', '3', 'number');
  rejects('x=1+2', '3', 'number');
});

test('number answers can name the function value', () => {
  accepts('f(3)=702', '702', 'number');
  accepts("f'(3)=702", '702', 'number');
  accepts('f(-2)=7', '7', 'number');
  accepts("f'(-2)=\\frac{1}{2}", '\\frac{1}{2}', 'number');
  accepts('f\\left(3\\right)=702', '702', 'number');
  accepts('f^{\\prime}\\left(3\\right)=702', '702', 'number');
  rejects('f(3)=701', '702', 'number');
  rejects('f(3)=1+701', '702', 'number');
  rejects('g(3)=702', '702', 'number');
  rejects('f3=702', '702', 'number');
  rejects('2f(3)=702', '702', 'number');
  rejects("f''(3)=702", '702', 'number');
  rejects('702=f(3)', '702', 'number');
});

test('any form accepts equivalent expressions only', () => {
  accepts('3x^2+2x', 'x(3x+2)', 'any');
  accepts('2xy', '2yx', 'any');
  rejects('2x', '3x', 'any');
  rejects('x^2', 'x^3', 'any');
});

test('expanded form rejects brackets and uncollected terms', () => {
  accepts('x^2+5x+6', 'x^2+5x+6', 'expanded');
  accepts('6+5x+x^2', 'x^2+5x+6', 'expanded');
  accepts('x^2-1', 'x^2-1', 'expanded');
  rejects('(x+2)(x+3)', 'x^2+5x+6', 'expanded');
  rejects('(x+1)^2', 'x^2+2x+1', 'expanded');
  rejects('x^2+2x+3x+6', 'x^2+5x+6', 'expanded');
});

test('expanded form rejects a product hidden in braces or a fraction', () => {
  for (const input of [
    '{x+2}{x+3}',
    '{x+2}\\cdot{x+3}',
    '\\frac{{x+2}{x+3}}{1}',
    '\\frac{x+2}{\\frac{1}{x+3}}',
  ]) rejects(input, 'x^2+5x+6', 'expanded');
  rejects('{x-3}{x+1}', 'x^2-2x-3', 'expanded');
  rejects('{x+2}^2', 'x^2+4x+4', 'expanded');
  rejects('-{x+2}', '-x-2', 'expanded');
  rejects('{2x}{3x+1}+{x^2+1}{3}', '9x^2+2x+3', 'expanded');
  rejects('4x{2x+1}+2{2x^2+2}', '12x^2+4x+4', 'expanded');
  rejects('4x\\frac{2x+1}{1}+2\\frac{2x^2+2}{1}', '12x^2+4x+4', 'expanded');
  accepts('-x-2', '-x-2', 'expanded');
  accepts('\\frac{1}{2}x+3', '\\frac{1}{2}x+3', 'expanded');
});

test('factored form needs a product of linear factors', () => {
  accepts('(x+2)(x+3)', '(x+2)(x+3)', 'factored');
  accepts('(x+3)(x+2)', '(x+2)(x+3)', 'factored');
  accepts('2(x+1)(x-1)', '2(x-1)(x+1)', 'factored');
  accepts('(x+1)^2', '(x+1)(x+1)', 'factored');
  accepts('x(x+1)', 'x(x+1)', 'factored');
  rejects('x^2+5x+6', '(x+2)(x+3)', 'factored');
  rejects('2(x^2-1)', '2(x-1)(x+1)', 'factored');
  rejects('(x+2)(x+4)', '(x+2)(x+3)', 'factored');
});

test('factored form rejects the unfactored polynomial in disguise', () => {
  for (const input of [
    '(x^2+5x+6)^1',
    '\\left(x^2+5x+6\\right)^1',
    '-(-x^2-5x-6)^1',
    '(x\\cdot x+5x+6)\\cdot1',
    '1(x\\cdot x+5x+6)',
    '(xx+5x+6)1',
    '(xx+5x+6)(1)',
    '1(xx+5x+6)',
    '(x^2+5x+6)(x+1-x)',
    '(x^2+5x+6)\\frac{x}{x}',
    '(x^2+5x+6)x\\cdot x^{-1}',
    '\\frac{(x+1)(x^2+5x+6)}{x+1}',
  ]) rejects(input, '(x+2)(x+3)', 'factored');
  rejects('(3x^2+3x-6)^1', '3(x-1)(x+2)', 'factored');
  accepts('((x+2)(x+3))^1', '(x+2)(x+3)', 'factored');
  accepts('-(x+2)(-x-3)', '(x+2)(x+3)', 'factored');
  accepts('(2x+2)(x+3)', '2(x+1)(x+3)', 'factored');
  accepts('\\frac{1}{2}(2x+4)(x+3)', '(x+2)(x+3)', 'factored');
});

test('factored form rejects a fraction hidden in a bracket', () => {
  rejects('x(3x+18+\\frac{24}{x})', '3(x+4)(x+2)', 'factored');
  rejects('(x+1)(x+4+\\frac{2}{x+1})', '(x+2)(x+3)', 'factored');
  rejects('(x+1)(x+4+2(x+1)^{-1})', '(x+2)(x+3)', 'factored');
  // A pole on a sample point must not read as linear.
  rejects('(x-2)(x+7+\\frac{20}{x-2})', '(x+2)(x+3)', 'factored');
  rejects('(x-3)(x+8+\\frac{30}{x-3})', '(x+2)(x+3)', 'factored');
  rejects('(x-4)(x+9+\\frac{42}{x-4})', '(x+2)(x+3)', 'factored');
  // Fractions with no variable below them are still linear factors, even when they do not sum exactly in floats.
  accepts('(x+\\frac{1}{3})(3x+6)', '(3x+1)(x+2)', 'factored');
  accepts('(\\frac{1}{7}x+\\frac{2}{7})(7x+21)', '(x+2)(x+3)', 'factored');
  accepts('(0.1x+0.2)(10x+30)', '(x+2)(x+3)', 'factored');
});

test('answers typed with a Japanese IME grade like half-width ones', () => {
  accepts('３', '3', 'number');
  accepts('－３', '-3', 'number');
  accepts('ー３', '-3', 'number');
  accepts('−３', '-3', 'number');
  accepts('３／４', '\\frac{3}{4}', 'number');
  accepts('ｘ＝３', '3', 'number');
  accepts('ｘ＋２', 'x+2', 'any');
  accepts('ｘー２', 'x-2', 'any');
  accepts('ｘ＾２＋５ｘ＋６', 'x^2+5x+6', 'expanded');
  accepts('（ｘ＋２）（ｘ＋３）', '(x+2)(x+3)', 'factored');
  rejects('４', '3', 'number');
  rejects('（ｘ＋２）（ｘ＋３）', 'x^2+5x+6', 'expanded');
  rejects('ｘ'.repeat(201), 'x', 'any');
  // Folding everything with NFKC would turn this into x2.
  accepts('x²+5x+6', 'x^2+5x+6', 'expanded');
});

test('MathLive and SymPy LaTeX styles parse', () => {
  accepts('\\left(x+2\\right)\\left(x+3\\right)', '\\left(x + 2\\right) \\left(x + 3\\right)', 'factored');
  accepts('x^{2}+5x+6', 'x^{2} + 5 x + 6', 'expanded');
  accepts('2\\cdot x', '2 x', 'any');
});

test('hostile input is rejected quickly', () => {
  const started = performance.now();
  for (const input of [
    '9^{9^{9^{9}}}',
    '\\sum_{n=1}^{1000000000} n',
    '(x+1)^{100000}',
    '2^{1000}',
    '99999999999999999999',
    '\\frac{d}{dx}x^2',
    'x'.repeat(201),
    '('.repeat(150),
    '',
    'foo(',
    '(x+1)^{100}'.repeat(18),
    '\\sqrt{'.repeat(30) + 'x' + '}'.repeat(30),
  ]) rejects(input, 'x+1', 'any');
  assert.ok(performance.now() - started < 1000);
});

test('hostile input stays quick on the factored and expanded checks too', () => {
  const started = performance.now();
  for (const input of [
    '(x+1)^{100}'.repeat(18),
    '((x+1)^{100}+1)'.repeat(12),
    '(x+y+z)^{100}(x+y+z)^{100}+1',
    '{x+1}^{100}'.repeat(18),
  ]) {
    rejects(input, '(x+1)(x+2)', 'factored');
    rejects(input, 'x^2+3x+2', 'expanded');
  }
  assert.ok(performance.now() - started < 1000);
});

test('composite answer styles', () => {
  const factored = '3\\left(x - 1\\right)\\left(x + 2\\right)';
  accepts('3(x+2)(x-1)', factored, 'factored');
  rejects('(x+2)(x-1)', factored, 'factored');
  rejects('3x^2+3x-6', factored, 'factored');

  const expanded = '12 x^{2} - 6 x y - 8 y';
  accepts('-6xy+12x^2-8y', expanded, 'expanded');
  rejects('2y(3x-4)+12x^2-20xy', expanded, 'expanded');
  rejects('12x^2-6xy+8y', expanded, 'expanded');
});

const generated = { skip: !existsSync('db/problems.json') };
type Generated = { id: string; skills: string[]; grade: string; form: Parameters<typeof grade>[2]; answer: string };
const problems = (): Generated[] => JSON.parse(readFileSync('db/problems.json', 'utf8'));

// Different equations may share a number. Anything else with the same answer is one problem, like (x-4)(x-5) and
// (x-5)(x-4), and a reveal of one would pay full XP on the other.
test('an answer is never shared within a skill, so a reveal stays with one problem', generated, () => {
  const seen = new Set<string>();
  for (const p of problems().filter((p) => p.skills.length > 1 || p.form !== 'number')) {
    const key = `${p.skills.join('+')}|${p.answer}`;
    assert.ok(!seen.has(key), key);
    seen.add(key);
  }
});

test('every generated answer grades as correct', generated, () => {
  for (const p of problems()) {
    accepts(p.answer, p.answer, p.form);
    // MathLive sends no spaces, and the grader must not accept just anything for this problem.
    accepts(p.answer.replaceAll(' ', ''), p.answer, p.form);
    rejects(p.form === 'number' ? '12345' : 'x+12345', p.answer, p.form);
  }
});

test('a factoring key leaves no common factor in a bracket', generated, () => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  for (const p of problems().filter((p) => p.skills.join() === 'factoring')) {
    const brackets = [...p.answer.matchAll(/\\left\((\d*) ?x [+-] (\d+)\\right\)/g)];
    assert.ok(brackets.length > 0, p.answer);
    for (const [, a, b] of brackets) assert.equal(gcd(Number(a || 1), Number(b)), 1, p.answer);
  }
});

test('A and S problems cover every skill with the right skill count', generated, () => {
  const all = problems();
  const skills = new Set(all.flatMap((p) => p.skills));
  assert.equal(skills.size, 6);
  for (const [grade, size] of [['A', 2], ['S', 3]] as const) {
    const ofGrade = all.filter((p) => p.grade === grade);
    for (const p of ofGrade) assert.equal(p.skills.length, size, p.id);
    for (const skill of skills) {
      const count = ofGrade.filter((p) => p.skills.includes(skill)).length;
      assert.ok(count >= 5, `${skill} has ${count} grade ${grade} problems`);
    }
  }
});
