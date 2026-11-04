// Point the shared Prisma client at the test database before any module imports it.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST must be set to run tests");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
