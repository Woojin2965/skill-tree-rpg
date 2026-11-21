export const GRADE_XP = { D: 50, C: 250, B: 1_000, A: 5_000, S: 20_000 } as const;
export type Grade = keyof typeof GRADE_XP;

const MAX_LEVEL = 99;
const DAY_MS = 86_400_000;

// RuneScape curve: XP_TABLE[n] is the total XP needed for level n + 1.
const XP_TABLE = [0];
for (let level = 1, points = 0; level < MAX_LEVEL; level++) {
  points += Math.floor(level + 300 * 2 ** (level / 7));
  XP_TABLE.push(Math.floor(points / 4));
}

export const xpForLevel = (level: number) => XP_TABLE[level - 1];

export function levelForXp(xp: number) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

const GATES = [30, 60, 90];

const nextGate = (passedGates: number[]) => GATES.find((gate) => !passedGates.includes(gate));

// XP keeps growing past a gate, but the level stays there until the gate is passed.
export const effectiveLevel = (xp: number, passedGates: number[]) =>
  Math.min(levelForXp(xp), nextGate(passedGates) ?? MAX_LEVEL);

export function gateDue(xp: number, passedGates: number[]) {
  const gate = nextGate(passedGates);
  return gate !== undefined && levelForXp(xp) >= gate ? gate : null;
}

// Share of the current level done, for the XP bar. At a gate the XP may be far past the level, so it reads as full.
export function levelProgress(xp: number, passedGates: number[]) {
  const level = effectiveLevel(xp, passedGates);
  if (level === MAX_LEVEL || gateDue(xp, passedGates)) return 1;
  return (xp - xpForLevel(level)) / (xpForLevel(level + 1) - xpForLevel(level));
}

export function xpPerSkill(grade: Grade, skillCount: number, rusty: boolean) {
  const multiplier = rusty && restoresRust(grade) ? 1.5 : 1;
  return Math.floor((GRADE_XP[grade] / skillCount) * multiplier);
}

export const rustDays = (level: number) => (level < 20 ? 14 : level < 40 ? 30 : level < 60 ? 60 : 90);

export function isRusty(level: number, lastPracticedAt: Date | null, now: Date) {
  return lastPracticedAt !== null && now.getTime() - lastPracticedAt.getTime() > rustDays(level) * DAY_MS;
}

const GRADES: Grade[] = ['D', 'C', 'B', 'A', 'S'];

// Null means the problem pays nothing: a revealed D would otherwise be free XP.
export const gradeAfterReveal = (grade: Grade): Grade | null => GRADES[GRADES.indexOf(grade) - 1] ?? null;

export const gradeForLevel = (level: number): Grade =>
  level < 10 ? 'D' : level < 30 ? 'C' : level < 50 ? 'B' : level < 70 ? 'A' : 'S';

export const restoresRust = (grade: Grade) => grade !== 'D';

export function gradeForPractice(level: number, rusty: boolean): Grade {
  const grade = gradeForLevel(level);
  return rusty && !restoresRust(grade) ? 'C' : grade;
}
