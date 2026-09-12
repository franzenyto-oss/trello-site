const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const legacyFlooringColumns = [
  { title: "Unassigned", color: "#3f3f46" },
  { title: "Axis Estimator", color: "#52525b" },
  { title: "John Estimator", color: "#71717a" },
  { title: "Completed", color: "#22c55e" },
];

const legacyFlooringCards = [
  "New Hardwood Floor Installation",
  "Carpet Replacement",
  "Laminate Installation",
  "Tile Floor Repair",
  "Vinyl Flooring Installation",
  "Hard Wood Floor Refinishing",
];

function sameSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((item) => actualSet.has(item));
}

function isLegacyFlooringBoard(board) {
  if (board.title !== "Flooring pipeline") return false;

  const columns = board.columns.map((column) => `${column.title}:${column.color}`);
  const expectedColumns = legacyFlooringColumns.map((column) => `${column.title}:${column.color}`);
  const cards = board.columns.flatMap((column) => column.cards.map((card) => card.title));

  return sameSet(columns, expectedColumns) && sameSet(cards, legacyFlooringCards);
}

async function permanentlyDeleteBoardTree(tx, userId, boardId) {
  const columns = await tx.column.findMany({ where: { boardId }, select: { id: true } });
  const columnIds = columns.map((column) => column.id);
  const cards = columnIds.length
    ? await tx.card.findMany({ where: { columnId: { in: columnIds } }, select: { id: true } })
    : [];
  const cardIds = cards.map((card) => card.id);

  await tx.archiveItem.deleteMany({ where: { userId, itemType: "board", itemId: boardId } });
  if (columnIds.length) await tx.archiveItem.deleteMany({ where: { userId, itemType: "column", itemId: { in: columnIds } } });
  if (cardIds.length) await tx.archiveItem.deleteMany({ where: { userId, itemType: "card", itemId: { in: cardIds } } });

  if (cardIds.length) await tx.comment.deleteMany({ where: { cardId: { in: cardIds } } });
  if (cardIds.length) await tx.card.deleteMany({ where: { id: { in: cardIds } } });
  if (columnIds.length) await tx.column.deleteMany({ where: { id: { in: columnIds } } });
  await tx.board.delete({ where: { id: boardId } });
}

async function cleanupLegacyFlooringDemoData() {
  const demoBoards = await prisma.board.findMany({
    where: { title: "Flooring pipeline" },
    include: {
      columns: {
        include: {
          cards: true,
        },
      },
    },
  });
  const boardsToDelete = demoBoards.filter(isLegacyFlooringBoard);

  if (!boardsToDelete.length) return;

  await prisma.$transaction(async (tx) => {
    for (const board of boardsToDelete) {
      await permanentlyDeleteBoardTree(tx, board.userId, board.id);
    }
  });

  console.log(`Removed ${boardsToDelete.length} legacy demo board(s).`);
}

async function initDatabase() {
  if (!(process.env.DATABASE_URL || "").startsWith("file:")) {
    throw new Error("prisma/init-db.js only supports SQLite DATABASE_URL values.");
  }

  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "salt" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Board" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Column" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "boardId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#64748b',
      "position" INTEGER NOT NULL,
      CONSTRAINT "Column_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Card" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "columnId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "dueDate" TEXT NOT NULL DEFAULT '',
      "label" TEXT NOT NULL DEFAULT '',
      "labelColor" TEXT NOT NULL DEFAULT '#10b981',
      "completed" BOOLEAN NOT NULL DEFAULT false,
      "position" INTEGER NOT NULL,
      CONSTRAINT "Card_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  const cardColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info("Card")`);
  if (!cardColumns.some((column) => column.name === "labelColor")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Card" ADD COLUMN "labelColor" TEXT NOT NULL DEFAULT '#10b981'`);
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Comment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "cardId" TEXT NOT NULL,
      "author" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Comment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ArchiveItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "itemType" TEXT NOT NULL,
      "itemId" TEXT NOT NULL,
      "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ArchiveItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ArchiveItem_userId_itemType_itemId_key"
    ON "ArchiveItem" ("userId", "itemType", "itemId")
  `);

  await cleanupLegacyFlooringDemoData();

  console.log("SQLite database is ready.");
}

if (require.main === module) {
  initDatabase()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { initDatabase, prisma };
