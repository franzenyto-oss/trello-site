const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mini-trello-test-"));
const dbPath = path.join(tempDir, "test.db").replaceAll("\\", "/");

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.SESSION_SECRET = "test-secret";

const { initDatabase, prisma: initPrisma } = require("../prisma/init-db");
const { app, prisma } = require("../server/server");

async function registerUser(email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`) {
  const response = await request(app)
    .post("/api/register")
    .send({ email, password: "password123" })
    .expect(200);

  assert.ok(response.body.token);
  const payload = jwt.verify(response.body.token, process.env.SESSION_SECRET);
  assert.equal(payload.sub, response.body.userId);
  assert.equal(response.body.state.boards.length, 0);
  assert.equal(response.body.state.columns.length, 0);
  assert.equal(response.body.state.cards.length, 0);
  assert.equal(response.body.state.comments.length, 0);

  return {
    token: response.body.token,
    auth: { Authorization: `Bearer ${response.body.token}` },
    userId: response.body.userId,
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function testAuth() {
  await request(app).get("/api/state").expect(401);

  await request(app)
    .post("/api/register")
    .send({ email: "bad@example.com", password: "123" })
    .expect(400);

  await request(app)
    .post("/api/login")
    .send({ email: "missing@example.com", password: "password123" })
    .expect(401);
}

async function testBcryptPasswordHashing() {
  const email = "bcrypt-user@example.com";
  await registerUser(email);

  const user = await prisma.user.findUnique({ where: { email } });
  assert.ok(user.passwordHash.startsWith("$2"));
  assert.notEqual(user.passwordHash, "password123");

  const login = await request(app)
    .post("/api/login")
    .send({ email, password: "password123" })
    .expect(200);

  assert.ok(login.body.token);
}

async function testCrud() {
  const { auth } = await registerUser();

  const createdBoard = await request(app)
    .post("/api/boards")
    .set(auth)
    .send({ title: "Project board" })
    .expect(200);

  const board = createdBoard.body.boards.find((item) => item.title === "Project board");
  assert.ok(board);

  const updatedBoard = await request(app)
    .patch(`/api/boards/${board.id}`)
    .set(auth)
    .send({ title: "Updated board" })
    .expect(200);

  assert.equal(updatedBoard.body.boards.find((item) => item.id === board.id).title, "Updated board");

  const createdColumn = await request(app)
    .post(`/api/boards/${board.id}/columns`)
    .set(auth)
    .send({ title: "Todo" })
    .expect(200);

  const column = createdColumn.body.columns.find((item) => item.title === "Todo");
  assert.ok(column);

  const updatedColumn = await request(app)
    .patch(`/api/columns/${column.id}`)
    .set(auth)
    .send({ title: "Doing", color: "#2563eb" })
    .expect(200);

  const columnAfterUpdate = updatedColumn.body.columns.find((item) => item.id === column.id);
  assert.equal(columnAfterUpdate.title, "Doing");
  assert.equal(columnAfterUpdate.color, "#2563eb");

  const createdReviewColumn = await request(app)
    .post(`/api/boards/${board.id}/columns`)
    .set(auth)
    .send({ title: "Review" })
    .expect(200);

  const reviewColumn = createdReviewColumn.body.columns.find((item) => item.title === "Review");
  assert.ok(reviewColumn);

  const createdDoneColumn = await request(app)
    .post(`/api/boards/${board.id}/columns`)
    .set(auth)
    .send({ title: "Done" })
    .expect(200);

  const doneColumn = createdDoneColumn.body.columns.find((item) => item.title === "Done");
  assert.ok(doneColumn);

  const movedColumnRight = await request(app)
    .patch(`/api/columns/${column.id}/move`)
    .set(auth)
    .send({ targetColumnId: doneColumn.id })
    .expect(200);

  const movedColumnTitles = movedColumnRight.body.columns
    .filter((item) => item.boardId === board.id)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.title);
  assert.deepEqual(movedColumnTitles, ["Done", "Review", "Doing"]);

  const movedColumnLeft = await request(app)
    .patch(`/api/columns/${column.id}/move`)
    .set(auth)
    .send({ targetColumnId: reviewColumn.id })
    .expect(200);

  const movedColumnLeftTitles = movedColumnLeft.body.columns
    .filter((item) => item.boardId === board.id)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.title);
  assert.deepEqual(movedColumnLeftTitles, ["Done", "Doing", "Review"]);

  const archiveBoardResponse = await request(app)
    .post("/api/boards")
    .set(auth)
    .send({ title: "Archive board" })
    .expect(200);

  const archiveBoard = archiveBoardResponse.body.boards.find((item) => item.title === "Archive board");
  assert.ok(archiveBoard);

  const movedColumnToBoard = await request(app)
    .patch(`/api/columns/${reviewColumn.id}/move`)
    .set(auth)
    .send({ boardId: archiveBoard.id })
    .expect(200);

  const transferredColumn = movedColumnToBoard.body.columns.find((item) => item.id === reviewColumn.id);
  assert.equal(transferredColumn.boardId, archiveBoard.id);

  const createdCard = await request(app)
    .post(`/api/columns/${column.id}/cards`)
    .set(auth)
    .send({ title: "Build API" })
    .expect(200);

  const card = createdCard.body.cards.find((item) => item.title === "Build API");
  assert.ok(card);

  const updatedCard = await request(app)
    .patch(`/api/cards/${card.id}`)
    .set(auth)
    .send({
      title: "Build CRUD API",
      description: "Use dedicated routes",
      dueDate: "2026-05-10",
      label: "Backend",
      completed: true,
    })
    .expect(200);

  const cardAfterUpdate = updatedCard.body.cards.find((item) => item.id === card.id);
  assert.equal(cardAfterUpdate.title, "Build CRUD API");
  assert.equal(cardAfterUpdate.completed, true);

  const commented = await request(app)
    .post(`/api/cards/${card.id}/comments`)
    .set(auth)
    .send({ text: "Looks good" })
    .expect(200);

  assert.equal(commented.body.comments.find((item) => item.cardId === card.id).text, "Looks good");

  const deletedCard = await request(app)
    .delete(`/api/cards/${card.id}`)
    .set(auth)
    .expect(200);

  assert.ok(deletedCard.body.cards.find((item) => item.id === card.id).archivedAt);

  const restoredCard = await request(app)
    .patch(`/api/cards/${card.id}/restore`)
    .set(auth)
    .expect(200);

  assert.equal(restoredCard.body.cards.find((item) => item.id === card.id).archivedAt, null);
  assert.equal(restoredCard.body.cards.find((item) => item.id === card.id).completed, false);

  const permanentlyDeletedCard = await request(app)
    .delete(`/api/cards/${card.id}?permanent=1`)
    .set(auth)
    .expect(200);

  assert.equal(permanentlyDeletedCard.body.cards.some((item) => item.id === card.id), false);

  const deletedColumn = await request(app)
    .delete(`/api/columns/${column.id}`)
    .set(auth)
    .expect(200);

  assert.ok(deletedColumn.body.columns.find((item) => item.id === column.id).archivedAt);

  const restoredColumn = await request(app)
    .patch(`/api/columns/${column.id}/restore`)
    .set(auth)
    .expect(200);

  assert.equal(restoredColumn.body.columns.find((item) => item.id === column.id).archivedAt, null);

  const permanentlyDeletedColumn = await request(app)
    .delete(`/api/columns/${column.id}?permanent=1`)
    .set(auth)
    .expect(200);

  assert.equal(permanentlyDeletedColumn.body.columns.some((item) => item.id === column.id), false);

  const deletedBoard = await request(app)
    .delete(`/api/boards/${board.id}`)
    .set(auth)
    .expect(200);

  assert.ok(deletedBoard.body.boards.find((item) => item.id === board.id).archivedAt);

  const restoredBoard = await request(app)
    .patch(`/api/boards/${board.id}/restore`)
    .set(auth)
    .expect(200);

  assert.equal(restoredBoard.body.boards.find((item) => item.id === board.id).archivedAt, null);

  const permanentlyDeletedBoard = await request(app)
    .delete(`/api/boards/${board.id}?permanent=1`)
    .set(auth)
    .expect(200);

  assert.equal(permanentlyDeletedBoard.body.boards.some((item) => item.id === board.id), false);
}

async function testOwnership() {
  const owner = await registerUser("owner@example.com");
  const other = await registerUser("other@example.com");

  const createdBoard = await request(app)
    .post("/api/boards")
    .set(owner.auth)
    .send({ title: "Private board" })
    .expect(200);

  const board = createdBoard.body.boards.find((item) => item.title === "Private board");

  await request(app)
    .patch(`/api/boards/${board.id}`)
    .set(other.auth)
    .send({ title: "Stolen board" })
    .expect(404);
}

async function testLegacyFlooringDemoCleanup() {
  const userId = `legacy-user-${Date.now()}`;
  const boardId = `legacy-board-${Date.now()}`;
  const safeBoardId = `safe-board-${Date.now()}`;
  const columns = [
    { id: `legacy-column-0-${Date.now()}`, title: "Unassigned", color: "#3f3f46", cards: ["New Hardwood Floor Installation", "Carpet Replacement"] },
    { id: `legacy-column-1-${Date.now()}`, title: "Axis Estimator", color: "#52525b", cards: ["Laminate Installation", "Tile Floor Repair"] },
    { id: `legacy-column-2-${Date.now()}`, title: "John Estimator", color: "#71717a", cards: ["Vinyl Flooring Installation"] },
    { id: `legacy-column-3-${Date.now()}`, title: "Completed", color: "#22c55e", cards: ["Hard Wood Floor Refinishing"] },
  ];

  await prisma.user.create({
    data: {
      id: userId,
      email: `legacy-${Date.now()}@example.com`,
      salt: "",
      passwordHash: "legacy",
    },
  });
  await prisma.board.create({ data: { id: boardId, userId, title: "Flooring pipeline" } });
  await prisma.board.create({ data: { id: safeBoardId, userId, title: "Flooring pipeline" } });

  for (const [columnIndex, column] of columns.entries()) {
    await prisma.column.create({
      data: {
        id: column.id,
        boardId,
        title: column.title,
        color: column.color,
        position: columnIndex,
      },
    });
    for (const [cardIndex, title] of column.cards.entries()) {
      await prisma.card.create({
        data: {
          id: `${column.id}-card-${cardIndex}`,
          columnId: column.id,
          title,
          position: cardIndex,
        },
      });
    }
  }

  await initDatabase();

  assert.equal(await prisma.board.findUnique({ where: { id: boardId } }), null);
  assert.ok(await prisma.board.findUnique({ where: { id: safeBoardId } }));
}

async function testPermanentDeleteLastBoardRemovesItsTree() {
  const { auth } = await registerUser();

  const createdBoard = await request(app)
    .post("/api/boards")
    .set(auth)
    .send({ title: "Last board" })
    .expect(200);
  const board = createdBoard.body.boards.find((item) => item.title === "Last board");
  assert.ok(board);

  const createdColumn = await request(app)
    .post(`/api/boards/${board.id}/columns`)
    .set(auth)
    .send({ title: "Only column" })
    .expect(200);
  const column = createdColumn.body.columns.find((item) => item.boardId === board.id);
  assert.ok(column);

  await request(app)
    .post(`/api/columns/${column.id}/cards`)
    .set(auth)
    .send({ title: "Only card" })
    .expect(200);

  await request(app)
    .delete(`/api/boards/${board.id}`)
    .set(auth)
    .expect(200);

  const deleted = await request(app)
    .delete(`/api/boards/${board.id}`)
    .set(auth)
    .expect(200);

  assert.equal(deleted.body.boards.length, 0);
  assert.equal(deleted.body.columns.length, 0);
  assert.equal(deleted.body.cards.length, 0);
  assert.equal(deleted.body.comments.length, 0);
}

async function main() {
  try {
    await initDatabase();
    await runTest("auth rejects invalid credentials and protects state", testAuth);
    await runTest("passwords are stored and verified with bcrypt", testBcryptPasswordHashing);
    await runTest("boards, columns, cards, comments CRUD works through dedicated API routes", testCrud);
    await runTest("users cannot access another user's board resources", testOwnership);
    await runTest("legacy flooring demo boards are removed during database init", testLegacyFlooringDemoCleanup);
    await runTest("permanent delete of the last board removes its full tree", testPermanentDeleteLastBoardRemovesItsTree);
  } finally {
    await prisma.$disconnect();
    await initPrisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
