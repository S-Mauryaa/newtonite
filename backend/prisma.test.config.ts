import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const testDatabaseUrl = env("TEST_DATABASE_URL");
if (!new URL(testDatabaseUrl).pathname.slice(1).endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testDatabaseUrl,
  },
});
