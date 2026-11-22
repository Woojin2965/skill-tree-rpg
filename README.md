# Skill Tree RPG

**Live:** https://skill-tree-rpg.vercel.app

A math practice site that plays like an RPG. Every topic is a skill on a prerequisite tree, from arithmetic to partial derivatives, and solving problems earns XP and levels in that skill. It is available in English and Japanese, for learners in North America and Japan.

I built it alone, end to end: game design, problem generation, a Rust backend, the answer checker, OAuth sign-in, the database and deployment.

## What it does

- **13 skills, 14,484 problems.** The problems are generated offline with SymPy. The problem types follow the exercise kinds in OpenStax textbooks, but no textbook problems are copied.
- **Typed math answers.** Students enter answers in a MathLive math field. The server checks whether the answer is mathematically equivalent, not just the same text, and can require a form such as expanded or factored.
- **RPG progression.**
  - Levels run from 1 to 99 on a RuneScape-style XP curve.
  - Problems come in five grades, D to S, worth 50 to 20,000 XP.
  - Problems that combine several skills split their XP across those skills.
  - Revealing the answer drops the reward by one grade.
- **Prerequisites level up too.** Solving a linear equation also trains arithmetic, so a set share of the XP, defined per skill, goes to each direct prerequisite.
- **Rust instead of decay.** Levels and XP are never taken away. A skill left unpractised turns "rusty" after 14 to 90 days, depending on its level, and one solved problem of grade C or higher restores it with a 1.5× XP bonus.
- **Placement and gate tests.**
  - A placement test binary-searches the skill tree in at most 20 problems.
  - Gate tests at levels 30, 60 and 90 must be passed to move on.
- **Sign in with Google or LINE.** No email address or name is stored.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TypeScript, KaTeX, MathLive |
| Backend | Rust (axum, sqlx) as one Vercel serverless function |
| Database | Postgres (Neon), with plain SQL migrations |
| Content | Python and SymPy, offline only; skills are Obsidian-compatible Markdown notes |
| Hosting | Vercel |

## What I considered

**A safe answer checker, written from scratch.** The usual shortcut is to pass the student's input to a computer-algebra system's parser, such as SymPy's `sympify`, but that can run arbitrary code. `server/grade.rs` instead parses a small LaTeX grammar by hand.
- It caps input length, nesting, literal size, exponents and polynomial degree before doing any arithmetic.
- It decides equivalence by evaluating both expressions at random points modulo the prime 2⁶¹−1. The degree cap is far below the prime, so a wrong answer passes with probability around 10⁻¹⁴.
- Slow and adversarial inputs are kept as regression tests in `server/grade_tests.rs`.

**Answers never reach the browser early.** The stored answer is returned by exactly one endpoint, `POST /api/problems/reveal`, which also lowers that attempt's reward. Composite problems are generated with distinct answers, so a revealed answer cannot be reused on another problem.

**Game rules that hold up under concurrency.**
- Every write locks the user's row and runs in a single transaction.
- Unique constraints make XP for a given (user, problem, skill) payable only once, so a double submit cannot pay twice.
- The prerequisite share is a single SQL statement made of chained CTEs.

**Small surface.**
- One Rust function serves the whole `/api/*` route.
- The XP and level rules live in `server/xp.rs` and are mirrored for display in `src/shared/xp.ts`.
- Sessions are random tokens, stored only as SHA-256 hashes.
- Write endpoints check the request's Origin header.
- A development login exists for local testing, and the server refuses it unless the site's base URL is localhost.

## Project layout

```
api/index.rs           Vercel function entry (also runs as a local server)
server/                Rust backend: routes, auth, game rules, grader, placement, XP
src/client/            React app
src/shared/xp.ts       XP and level formulas shared with the UI
content/skills/        Skill definitions (Markdown with frontmatter)
scripts/               Problem generator (SymPy) and local Postgres helper
db/migrations/         SQL schema
tests/                 HTTP tests of the game rules against a real database
```
