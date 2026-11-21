import { ComputeEngine } from '@cortex-js/compute-engine';

export type AnswerForm = 'any' | 'number' | 'expanded' | 'factored';

type Tree = number | string | Tree[] | Record<string, unknown>;

const MAX_INPUT_LENGTH = 200;
const MAX_DEPTH = 20;
const MAX_LITERAL = 1_000_000;
const MAX_EXPONENT = 100;
const OPERATORS = new Set([
  'Add', 'Subtract', 'Negate', 'Multiply', 'InvisibleOperator', 'Divide', 'Power', 'Sqrt', 'Delimiter',
]);

const isLiteral = (t: Tree): t is number => typeof t === 'number' && Math.abs(t) <= MAX_LITERAL;

// A small exponent is a literal, or a negated or fractional one. Anything else could be a power tower.
function isSmallExponent(t: Tree): boolean {
  if (isLiteral(t)) return Math.abs(t) <= MAX_EXPONENT;
  if (!Array.isArray(t)) return false;
  const [op, ...args] = t;
  if (op === 'Delimiter') return args.length === 1 && isSmallExponent(args[0]);
  return (op === 'Negate' || op === 'Divide') && args.every((a) => isLiteral(a) && Math.abs(a) <= MAX_EXPONENT);
}

// Compute Engine can hang on Sum, or on large powers, so only plain arithmetic reaches it.
function isSafe(t: Tree, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof t === 'number') return isLiteral(t);
  if (typeof t === 'string') return /^[a-z]$/.test(t) || t === 'Pi';
  if (!Array.isArray(t)) return false;
  const [op, ...args] = t;
  if (typeof op !== 'string' || !OPERATORS.has(op) || args.length === 0) return false;
  if (op === 'Power' && !isSmallExponent(args[1])) return false;
  return args.every((a) => isSafe(a, depth + 1));
}

type Rational = { n: bigint; d: bigint };

function literalToRational(value: number): Rational | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(Math.abs(value)));
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  const n = BigInt(whole + fraction) * (value < 0 ? -1n : 1n);
  return { n, d: 10n ** BigInt(fraction.length) };
}

function toRational(t: Tree): Rational | null {
  if (typeof t === 'number') return literalToRational(t);
  if (!Array.isArray(t)) return null;
  const [op, a, b] = t;
  if (op === 'Delimiter' && t.length === 2) return toRational(a);
  if (op === 'Negate' && t.length === 2) {
    const r = toRational(a);
    return r && { n: -r.n, d: r.d };
  }
  if (op === 'Divide') {
    const top = toRational(a);
    const bottom = toRational(b);
    if (!top || !bottom || bottom.n === 0n) return null;
    return { n: top.n * bottom.d, d: top.d * bottom.n };
  }
  return null;
}

// Compute Engine keeps 3.0 as {num: '3.0'}. Past the literal limit Number() fails isLiteral, as it should.
const plainNumbers = (t: Tree): Tree =>
  Array.isArray(t) ? t.map(plainNumbers) : typeof t === 'object' && 'num' in t ? Number(t.num) : t;

const OVER_A_SUM = new Set(['Multiply', 'InvisibleOperator', 'Divide', 'Power', 'Negate']);

// TeX braces and \frac leave no Delimiter, so a sum inside a product is what marks an unexpanded bracket.
function hasBracket(t: Tree, overSum = false): boolean {
  if (!Array.isArray(t)) return false;
  const [op, ...args] = t;
  if (op === 'Delimiter' || (overSum && (op === 'Add' || op === 'Subtract'))) return true;
  return args.some((a) => hasBracket(a, overSum || OVER_A_SUM.has(op as string)));
}

function termCount(t: Tree): number {
  if (Array.isArray(t) && (t[0] === 'Add' || t[0] === 'Subtract')) {
    return t.slice(1).reduce<number>((sum, a) => sum + termCount(a), 0);
  }
  return 1;
}

// The grader proves the polynomial is equal, so as many non-constant factors as the reference forces them all to be
// linear. Anything that could cancel, like x/x or x^{-1}, makes the count fail.
// ponytail: linear factors only, which is all the templates produce. Irreducible quadratics need a real check.
function factorCount(t: Tree, ce: ComputeEngine): number {
  const box = ce.box(t as never);
  if (box.unknowns.length === 0) return 0;
  if (typeof t === 'string') return 1;
  const [op, ...args] = t as Tree[];
  if (op === 'Delimiter' || op === 'Negate') return factorCount(args[0], ce);
  if (op === 'Multiply' || op === 'InvisibleOperator') return args.reduce<number>((n, a) => n + factorCount(a, ce), 0);
  if (op === 'Power' && Number.isInteger(args[1]) && (args[1] as number) > 0) return factorCount(args[0], ce) * (args[1] as number);
  if (op !== 'Add' && op !== 'Subtract') return -Infinity;
  // A sum like x+1-x is no factor, and one like 3x+18+24/x is no linear factor. simplify() can hang on large powers,
  // so three sample points decide. A pole leaves the bend infinite or NaN, so the test is written to fail on both.
  const at = (value: number) => box.subs(Object.fromEntries(box.unknowns.map((u, i) => [u, value + i]))).N();
  const [a, b, c] = [at(2), at(3), at(4)];
  if (!(Math.abs(c.sub(b).sub(b.sub(a)).re) < 1e-9)) return -Infinity;
  return a.isSame(b) ? 0 : 1;
}

// A Japanese IME commits full-width characters, and its minus key gives the long vowel mark. NFKC on the whole input
// would also turn x² into x2.
const foldWidth = (text: string) => text.replace(/[\uFF01-\uFF5E]/g, (c) => c.normalize('NFKC')).replaceAll('ー', '-');

// A value can fairly be written out as x = 3, f(3) = 702 or f'(3) = 702. Anything else on the left, like 2x = 6, is work
// left undone. Only the right side is graded.
const namesValue = (t: Tree) =>
  typeof t === 'string'
    ? /^[a-z]$/.test(t)
    : Array.isArray(t) && t.length === 3 && (
      (t[0] === 'InvisibleOperator' && t[1] === 'f' && Array.isArray(t[2]) && t[2][0] === 'Delimiter') ||
      (t[0] === 'Apply' && JSON.stringify(t[1]) === '["Derivative","f",1]'));

// One engine for the whole isolate: building one costs about 55 ms CPU, more than a Workers Free request may use.
// grade() never calls assume() or declares anything, so nothing a user types outlives their request.
const ce = new ComputeEngine();

export function grade(typed: string, answer: string, form: AnswerForm): boolean {
  const input = foldWidth(typed);
  if (input.length === 0 || input.length > MAX_INPUT_LENGTH) return false;

  const parse = (latex: string) => plainNumbers(ce.parse(latex, { form: 'raw' }).json as Tree);
  const reference = parse(answer);
  let raw = parse(input);
  if (form === 'number' && Array.isArray(raw) && raw[0] === 'Equal' && raw.length === 3 && namesValue(raw[1])) raw = raw[2];
  if (!isSafe(raw)) return false;

  if (form === 'number') {
    const a = toRational(raw);
    const b = toRational(reference);
    return a !== null && b !== null && a.n * b.d === b.n * a.d;
  }
  if (form === 'expanded' && (hasBracket(raw) || termCount(raw) > termCount(reference))) return false;
  if (form === 'factored' && factorCount(raw, ce) < factorCount(reference, ce)) return false;

  try {
    return ce.parse(input).isIdenticallyEqual(ce.parse(answer)) === true;
  } catch {
    return false;
  }
}
