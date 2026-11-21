-- Sign-in is by provider account only. No email is asked for or stored, so the column may be empty,
-- and one provider account can never become two players.
ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX one_user_per_provider_account ON account ("providerId", "accountId");
