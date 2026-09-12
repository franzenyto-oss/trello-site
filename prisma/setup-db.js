const { execFileSync } = require("node:child_process");
const path = require("node:path");

const databaseUrl = process.env.DATABASE_URL || "";
const isSqlite = databaseUrl.startsWith("file:");
const schemaPath = path.join(__dirname, isSqlite ? "schema.sqlite.prisma" : "schema.prisma");
const prismaCliPath = require.resolve("prisma/build/index.js");

function runPrisma(args) {
  execFileSync(process.execPath, [prismaCliPath, ...args], { stdio: "inherit" });
}

async function main() {
  runPrisma(["generate", "--schema", schemaPath]);

  if (isSqlite) {
    await require("./init-db").initDatabase();
  } else {
    runPrisma(["db", "push", "--schema", schemaPath]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
