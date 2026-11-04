-- Google users have no phone number or password until they add a number on /profile.
-- The UNIQUE index on "number" is kept; Postgres allows many NULLs in a unique index.
ALTER TABLE "User" ALTER COLUMN "number" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
