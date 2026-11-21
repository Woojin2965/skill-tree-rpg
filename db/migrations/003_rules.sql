-- One row per promotion or placement test. Its problems are problem_instances with test_id set,
-- and its answers are attempts. Passed gates and the 24 hour retry wait are both read from here.
-- For placement, passed means at least one skill passed; the skills themselves are its xp_events rows.
CREATE TABLE tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('promotion', 'placement')),
  skill_id text REFERENCES skills,
  gate integer CHECK (gate IN (30, 60, 90)),
  passed boolean,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((kind = 'promotion') = (skill_id IS NOT NULL)),
  CHECK ((kind = 'promotion') = (gate IS NOT NULL)),
  CHECK ((passed IS NULL) = (finished_at IS NULL))
);
CREATE INDEX ON tests (user_id, skill_id, gate);
CREATE UNIQUE INDEX one_open_test_per_user ON tests (user_id) WHERE finished_at IS NULL;
CREATE UNIQUE INDEX one_placement_per_user ON tests (user_id) WHERE kind = 'placement';

-- revealed_at is set on one instance but read per user and problem: a reveal follows the problem
-- to every later instance, so asking for the same problem again cannot restore full XP.
ALTER TABLE problem_instances
  ADD COLUMN test_id uuid REFERENCES tests ON DELETE CASCADE,
  ADD COLUMN revealed_at timestamptz,
  ADD CHECK (test_id IS NULL OR revealed_at IS NULL);
CREATE INDEX ON problem_instances (test_id) WHERE test_id IS NOT NULL;
CREATE INDEX ON problem_instances (user_id, problem_id) WHERE revealed_at IS NOT NULL;

-- The UNIQUE key from 002 still stops double payment for problems. NULLs never conflict in it,
-- so the CHECK keeps NULL for placement rows, which have their own unique index.
ALTER TABLE xp_events
  ALTER COLUMN problem_id DROP NOT NULL,
  ADD COLUMN reason text NOT NULL DEFAULT 'problem' CHECK (reason IN ('problem', 'placement')),
  ADD CHECK ((reason = 'problem') = (problem_id IS NOT NULL));
CREATE UNIQUE INDEX one_placement_award_per_skill ON xp_events (user_id, skill_id) WHERE reason = 'placement';
