export type PlacementSkill = { id: string; prerequisites: string[] };
export type PlacementAnswer = { skillId: string; correct: boolean };

const PROBE_SIZE = 2;
export const MAX_PLACEMENT_PROBLEMS = 20;

function reachable(start: string, edges: Map<string, string[]>) {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    for (const id of edges.get(stack.pop()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(id);
    }
  }
  return seen;
}

// Binary search over a DAG. Answers are the whole history, so a player can leave and resume.
export function placementStep(
  skills: PlacementSkill[],
  answers: PlacementAnswer[],
): { next: string } | { passed: string[] } {
  const ancestors = new Map(skills.map((s) => [s.id, s.prerequisites]));
  const descendants = new Map<string, string[]>();
  for (const s of skills) {
    for (const id of s.prerequisites) descendants.set(id, [...(descendants.get(id) ?? []), s.id]);
  }

  const passed = new Set<string>();
  const failed = new Set<string>();
  for (const skillId of new Set(answers.map((a) => a.skillId))) {
    const probe = answers.filter((a) => a.skillId === skillId);
    if (probe.length < PROBE_SIZE) return { next: skillId };
    const [result, edges] = probe.every((a) => a.correct) ? [passed, ancestors] : [failed, descendants];
    for (const id of [skillId, ...reachable(skillId, edges)]) result.add(id);
  }

  const undecided = skills.filter((s) => !passed.has(s.id) && !failed.has(s.id));
  const countUndecided = (ids: Set<string>) => undecided.filter((s) => ids.has(s.id)).length;
  let next: string | undefined;
  let bestEven = -1;
  let bestTotal = -1;
  if (answers.length < MAX_PLACEMENT_PROBLEMS) {
    for (const s of undecided) {
      const up = countUndecided(reachable(s.id, ancestors));
      const down = countUndecided(reachable(s.id, descendants));
      const even = Math.min(up, down);
      if (even > bestEven || (even === bestEven && up + down > bestTotal)) {
        [next, bestEven, bestTotal] = [s.id, even, up + down];
      }
    }
  }
  return next ? { next } : { passed: skills.filter((s) => passed.has(s.id)).map((s) => s.id) };
}
