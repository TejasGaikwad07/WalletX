/** Integration tests hit a real Postgres (DATABASE_URL_TEST); run serially because they share one database. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/packages/wallet", "<rootDir>/apps/bank-webhook"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  maxWorkers: 1,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json", diagnostics: false }],
  },
};
