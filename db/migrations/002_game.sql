CREATE TABLE skills (
  id text PRIMARY KEY,
  subject text NOT NULL,
  title_en text NOT NULL,
  title_ja text NOT NULL
);

CREATE TABLE skill_prerequisites (
  skill_id text NOT NULL REFERENCES skills ON DELETE CASCADE,
  prerequisite_id text NOT NULL REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (skill_id, prerequisite_id),
  CHECK (skill_id <> prerequisite_id)
);

-- answer_latex stays on the server. Never select it into an API response.
CREATE TABLE problems (
  id text PRIMARY KEY,
  grade text NOT NULL CHECK (grade IN ('D', 'C', 'B', 'A', 'S')),
  prompt_en text NOT NULL,
  prompt_ja text NOT NULL,
  prompt_latex text NOT NULL,
  answer_latex text NOT NULL,
  answer_form text NOT NULL CHECK (answer_form IN ('any', 'number', 'expanded', 'factored'))
);

CREATE TABLE problem_skills (
  problem_id text NOT NULL REFERENCES problems ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (problem_id, skill_id)
);

CREATE TABLE problem_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
  problem_id text NOT NULL REFERENCES problems,
  skill_id text NOT NULL REFERENCES skills,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON problem_instances (user_id, skill_id);

CREATE TABLE attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id uuid NOT NULL UNIQUE REFERENCES problem_instances ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
  answer text NOT NULL,
  correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON attempts (user_id, created_at);

CREATE TABLE user_skill_progress (
  user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES skills,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  last_practiced_at timestamptz,
  PRIMARY KEY (user_id, skill_id)
);

-- Ledger: totals can be rebuilt from it. The unique key means a problem pays each skill once per user.
CREATE TABLE xp_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES skills,
  problem_id text NOT NULL REFERENCES problems,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, problem_id, skill_id)
);

-- Deletes stay allowed so that deleting an account removes its history.
CREATE FUNCTION reject_xp_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'xp_events is append-only';
END $$;
CREATE TRIGGER xp_events_append_only BEFORE UPDATE ON xp_events
  FOR EACH ROW EXECUTE FUNCTION reject_xp_event_update();
