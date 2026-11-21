// MathLive leaves \placeholder{} in an unfilled fraction and {} in an unfilled power. Either would burn a one-shot problem.
export const isUnfinished = (latex: string) => /\\placeholder|\{\s*\}/.test(latex);
