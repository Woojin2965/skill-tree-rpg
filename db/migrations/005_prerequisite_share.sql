-- Percent of a problem's XP that also goes to each direct prerequisite of its skills. Set per skill in content/skills.
ALTER TABLE skill_prerequisites ADD COLUMN share smallint NOT NULL DEFAULT 0 CHECK (share BETWEEN 0 AND 100);
