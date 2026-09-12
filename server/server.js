const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const BCRYPT_ROUNDS = 10;
const buildPath = process.env.BUILD_PATH
  ? path.resolve(process.env.BUILD_PATH)
  : path.join(__dirname, "..", "build");
const jwtSecret = () => process.env.SESSION_SECRET || "dev-secret";

app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.static(buildPath));

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function isBcryptHash(passwordHash) {
  return typeof passwordHash === "string" && passwordHash.startsWith("$2");
}

async function verifyPassword(user, password) {
  if (isBcryptHash(user.passwordHash)) {
    return bcrypt.compare(password, user.passwordHash);
  }

  return hashPassword(password, user.salt) === user.passwordHash;
}

function createToken(user) {
  return jwt.sign(
    { email: user.email },
    jwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: TOKEN_TTL_SECONDS,
      subject: user.id,
    }
  );
}

function readToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  try {
    const data = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
    if (!data.sub) return null;
    return data;
  } catch {
    return null;
  }
}

function requireUser(req, res, next) {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = token.sub;
  next();
}

async function findOwnedBoard(userId, boardId) {
  return prisma.board.findFirst({ where: { id: boardId, userId } });
}

async function findOwnedColumn(userId, columnId) {
  return prisma.column.findFirst({
    where: { id: columnId, board: { userId } },
    include: { board: true },
  });
}

async function findOwnedCard(userId, cardId) {
  return prisma.card.findFirst({
    where: { id: cardId, column: { board: { userId } } },
    include: { column: { include: { board: true } } },
  });
}

async function sendUserState(req, res) {
  res.json(await getState(req.userId));
}

const archiveId = (userId, itemType, itemId) => `${userId}:${itemType}:${itemId}`;
const archiveKey = (itemType, itemId) => `${itemType}:${itemId}`;

async function archiveItem(userId, itemType, itemId) {
  await prisma.archiveItem.upsert({
    where: { userId_itemType_itemId: { userId, itemType, itemId } },
    create: {
      id: archiveId(userId, itemType, itemId),
      userId,
      itemType,
      itemId,
    },
    update: { archivedAt: new Date() },
  });
}

async function restoreArchiveItems(userId, items) {
  await prisma.archiveItem.deleteMany({
    where: {
      userId,
      OR: items.map((item) => ({ itemType: item.itemType, itemId: item.itemId })),
    },
  });
}

async function permanentlyDeleteBoardTree(tx, userId, boardId) {
  const columns = await tx.column.findMany({ where: { boardId }, select: { id: true } });
  const columnIds = columns.map((item) => item.id);
  const cards = columnIds.length
    ? await tx.card.findMany({ where: { columnId: { in: columnIds } }, select: { id: true } })
    : [];
  const cardIds = cards.map((item) => item.id);

  await tx.archiveItem.deleteMany({ where: { userId, itemType: "board", itemId: boardId } });
  if (columnIds.length) await tx.archiveItem.deleteMany({ where: { userId, itemType: "column", itemId: { in: columnIds } } });
  if (cardIds.length) await tx.archiveItem.deleteMany({ where: { userId, itemType: "card", itemId: { in: cardIds } } });

  if (cardIds.length) await tx.comment.deleteMany({ where: { cardId: { in: cardIds } } });
  if (cardIds.length) await tx.card.deleteMany({ where: { id: { in: cardIds } } });
  if (columnIds.length) await tx.column.deleteMany({ where: { id: { in: columnIds } } });
  await tx.board.delete({ where: { id: boardId } });
}

async function getState(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      boards: {
        orderBy: { createdAt: "asc" },
        include: {
          columns: {
            orderBy: { position: "asc" },
            include: {
              cards: {
                orderBy: { position: "asc" },
                include: { comments: { orderBy: { createdAt: "asc" } } },
              },
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  const archiveItems = await prisma.archiveItem.findMany({ where: { userId } });
  const archiveMap = new Map(archiveItems.map((item) => [archiveKey(item.itemType, item.itemId), item.archivedAt]));
  const archivedAtFor = (itemType, itemId) => archiveMap.get(archiveKey(itemType, itemId))?.toISOString() || null;

  const state = {
    users: [{ id: user.id, email: user.email, salt: user.salt, passwordHash: user.passwordHash, createdAt: user.createdAt.toISOString() }],
    boards: [],
    columns: [],
    cards: [],
    comments: [],
  };

  for (const board of user.boards) {
    state.boards.push({
      id: board.id,
      userId: board.userId,
      title: board.title,
      createdAt: board.createdAt.toISOString(),
      archivedAt: archivedAtFor("board", board.id),
    });
    for (const column of board.columns) {
      state.columns.push({
        id: column.id,
        boardId: column.boardId,
        title: column.title,
        color: column.color,
        position: column.position,
        archivedAt: archivedAtFor("column", column.id),
      });
      for (const card of column.cards) {
        state.cards.push({
          id: card.id,
          columnId: card.columnId,
          title: card.title,
          description: card.description,
          dueDate: card.dueDate,
          label: card.label,
          labelColor: card.labelColor,
          completed: card.completed,
          position: card.position,
          archivedAt: archivedAtFor("card", card.id),
        });
        for (const comment of card.comments) {
          state.comments.push({ id: comment.id, cardId: comment.cardId, author: comment.author, text: comment.text, createdAt: comment.createdAt.toISOString() });
        }
      }
    }
  }

  return state;
}

async function replaceState(userId, state) {
  const ownedBoardIds = new Set((state.boards || []).filter((board) => board.userId === userId).map((board) => board.id));
  const columns = (state.columns || []).filter((column) => ownedBoardIds.has(column.boardId));
  const columnIds = new Set(columns.map((column) => column.id));
  const cards = (state.cards || []).filter((card) => columnIds.has(card.columnId));
  const cardIds = new Set(cards.map((card) => card.id));
  const comments = (state.comments || []).filter((comment) => cardIds.has(comment.cardId));

  await prisma.$transaction(async (tx) => {
    const existingBoards = await tx.board.findMany({
      where: { userId },
      select: { id: true },
    });
    const existingBoardIds = existingBoards.map((board) => board.id);
    const existingColumns = existingBoardIds.length
      ? await tx.column.findMany({ where: { boardId: { in: existingBoardIds } }, select: { id: true } })
      : [];
    const existingColumnIds = existingColumns.map((column) => column.id);
    const existingCards = existingColumnIds.length
      ? await tx.card.findMany({ where: { columnId: { in: existingColumnIds } }, select: { id: true } })
      : [];
    const existingCardIds = existingCards.map((card) => card.id);

    await tx.archiveItem.deleteMany({ where: { userId } });
    if (existingCardIds.length) await tx.comment.deleteMany({ where: { cardId: { in: existingCardIds } } });
    if (existingColumnIds.length) await tx.card.deleteMany({ where: { columnId: { in: existingColumnIds } } });
    if (existingBoardIds.length) await tx.column.deleteMany({ where: { boardId: { in: existingBoardIds } } });
    await tx.board.deleteMany({ where: { userId } });

    for (const board of state.boards || []) {
      if (board.userId !== userId) continue;
      await tx.board.create({
        data: {
          id: board.id,
          userId,
          title: board.title || "Untitled board",
          createdAt: board.createdAt ? new Date(board.createdAt) : new Date(),
        },
      });
    }

    for (const column of columns) {
      await tx.column.create({
        data: {
          id: column.id,
          boardId: column.boardId,
          title: column.title || "Untitled column",
          color: column.color || "#64748b",
          position: Number.isInteger(column.position) ? column.position : 0,
        },
      });
    }

    for (const card of cards) {
      await tx.card.create({
        data: {
          id: card.id,
          columnId: card.columnId,
          title: String(card.title || "").trim(),
          description: card.description || "",
          dueDate: card.dueDate || "",
          label: card.label || "",
          labelColor: card.labelColor || "#10b981",
          completed: Boolean(card.completed),
          position: Number.isInteger(card.position) ? card.position : 0,
        },
      });
    }

    for (const comment of comments) {
      await tx.comment.create({
        data: {
          id: comment.id,
          cardId: comment.cardId,
          author: comment.author || "User",
          text: comment.text || "",
          createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
        },
      });
    }

    const archivedItems = [
      ...(state.boards || [])
        .filter((board) => board.userId === userId && board.archivedAt)
        .map((board) => ({ itemType: "board", itemId: board.id, archivedAt: board.archivedAt })),
      ...columns
        .filter((column) => column.archivedAt)
        .map((column) => ({ itemType: "column", itemId: column.id, archivedAt: column.archivedAt })),
      ...cards
        .filter((card) => card.archivedAt)
        .map((card) => ({ itemType: "card", itemId: card.id, archivedAt: card.archivedAt })),
    ];

    for (const item of archivedItems) {
      await tx.archiveItem.create({
        data: {
          id: archiveId(userId, item.itemType, item.itemId),
          userId,
          itemType: item.itemType,
          itemId: item.itemId,
          archivedAt: new Date(item.archivedAt),
        },
      });
    }
  });
}

app.post("/api/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || password.length < 6) {
    res.status(400).json({ error: "Введите email и пароль минимум из 6 символов." });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Такой email уже зарегистрирован." });
    return;
  }

  const user = await prisma.user.create({
    data: {
      id: uid(),
      email,
      salt: "",
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    },
  });

  res.json({ token: createToken(user), userId: user.id, state: await getState(user.id) });
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(user, password))) {
    res.status(401).json({ error: "Неверный email или пароль." });
    return;
  }

  if (!isBcryptHash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        salt: "",
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      },
    });
  }

  res.json({ token: createToken(user), userId: user.id, state: await getState(user.id) });
});

app.get("/api/state", requireUser, async (req, res) => {
  const state = await getState(req.userId);
  if (!state) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(state);
});

app.put("/api/state", requireUser, async (req, res) => {
  await replaceState(req.userId, req.body);
  res.json(await getState(req.userId));
});

app.get("/api/boards", requireUser, async (req, res) => {
  const state = await getState(req.userId);
  res.json(state?.boards || []);
});

app.post("/api/boards", requireUser, async (req, res) => {
  const title = String(req.body.title || "").trim() || "Untitled board";
  await prisma.board.create({
    data: {
      id: uid(),
      userId: req.userId,
      title,
    },
  });
  await sendUserState(req, res);
});

app.patch("/api/boards/:id", requireUser, async (req, res) => {
  const board = await findOwnedBoard(req.userId, req.params.id);
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
  }

  const title = String(req.body.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "Board title is required" });
    return;
  }

  await prisma.board.update({ where: { id: board.id }, data: { title } });
  await sendUserState(req, res);
});

app.delete("/api/boards/:id", requireUser, async (req, res) => {
  const board = await findOwnedBoard(req.userId, req.params.id);
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
  }

  const archivedBoard = await prisma.archiveItem.findFirst({
    where: { userId: req.userId, itemType: "board", itemId: board.id },
    select: { id: true },
  });

  if (req.query.permanent === "1" || archivedBoard) {
    await prisma.$transaction(async (tx) => {
      await permanentlyDeleteBoardTree(tx, req.userId, board.id);
    });
    await sendUserState(req, res);
    return;
  }

  await archiveItem(req.userId, "board", board.id);
  await sendUserState(req, res);
});

app.patch("/api/boards/:id/restore", requireUser, async (req, res) => {
  const board = await findOwnedBoard(req.userId, req.params.id);
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
  }

  await restoreArchiveItems(req.userId, [{ itemType: "board", itemId: board.id }]);
  await sendUserState(req, res);
});

app.post("/api/boards/:boardId/columns", requireUser, async (req, res) => {
  const board = await findOwnedBoard(req.userId, req.params.boardId);
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
  }

  const position = await prisma.column.count({ where: { boardId: board.id } });
  await prisma.column.create({
    data: {
      id: uid(),
      boardId: board.id,
      title: String(req.body.title || "").trim() || "Untitled column",
      color: req.body.color || "#64748b",
      position,
    },
  });
  await sendUserState(req, res);
});

app.patch("/api/columns/:id", requireUser, async (req, res) => {
  const column = await findOwnedColumn(req.userId, req.params.id);
  if (!column) {
    res.status(404).json({ error: "Column not found" });
    return;
  }

  const data = {};
  if (req.body.title !== undefined) data.title = String(req.body.title || "").trim() || "Untitled column";
  if (req.body.color !== undefined) data.color = String(req.body.color || "#64748b");

  await prisma.column.update({ where: { id: column.id }, data });
  await sendUserState(req, res);
});

app.patch("/api/columns/:id/move", requireUser, async (req, res) => {
  const column = await findOwnedColumn(req.userId, req.params.id);
  if (!column) {
    res.status(404).json({ error: "Column not found" });
    return;
  }

  const targetBoardId = String(req.body.boardId || column.boardId);
  const targetBoard = await findOwnedBoard(req.userId, targetBoardId);
  if (!targetBoard) {
    res.status(404).json({ error: "Target board not found" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const targetColumnId = req.body.targetColumnId || req.body.beforeColumnId || null;

    if (targetBoardId !== column.boardId) {
      const sourceColumns = await tx.column.findMany({
        where: { boardId: column.boardId, id: { not: column.id } },
        orderBy: { position: "asc" },
      });
      for (const [position, item] of sourceColumns.entries()) {
        await tx.column.update({ where: { id: item.id }, data: { position } });
      }

      const targetColumns = await tx.column.findMany({
        where: { boardId: targetBoardId },
        orderBy: { position: "asc" },
      });
      const targetIndex = targetColumnId ? targetColumns.findIndex((item) => item.id === targetColumnId) : targetColumns.length;
      if (targetIndex < 0) throw new Error("Target column not found");

      targetColumns.splice(targetIndex, 0, column);
      for (const [position, item] of targetColumns.entries()) {
        await tx.column.update({ where: { id: item.id }, data: { boardId: targetBoardId, position } });
      }
      return;
    }

    const targetColumn = targetColumnId
      ? await tx.column.findFirst({ where: { id: targetColumnId, boardId: column.boardId } })
      : null;
    if (!targetColumn) {
      if (!targetColumnId) return;
      throw new Error("Target column not found");
    }

    await tx.column.update({ where: { id: column.id }, data: { position: targetColumn.position } });
    await tx.column.update({ where: { id: targetColumn.id }, data: { position: column.position } });
  }).catch((error) => {
    if (error.message === "Target column not found") {
      res.status(404).json({ error: "Target column not found" });
      return;
    }
    throw error;
  });
  if (res.headersSent) return;
  await sendUserState(req, res);
});

app.delete("/api/columns/:id", requireUser, async (req, res) => {
  const column = await findOwnedColumn(req.userId, req.params.id);
  if (!column) {
    res.status(404).json({ error: "Column not found" });
    return;
  }

  if (req.query.permanent === "1") {
    await prisma.$transaction(async (tx) => {
      const cards = await tx.card.findMany({ where: { columnId: column.id }, select: { id: true } });
      await tx.archiveItem.deleteMany({
        where: {
          userId: req.userId,
          OR: [
            { itemType: "column", itemId: column.id },
            ...(cards.length ? [{ itemType: "card", itemId: { in: cards.map((item) => item.id) } }] : []),
          ],
        },
      });
      await tx.column.delete({ where: { id: column.id } });
    });
    await sendUserState(req, res);
    return;
  }

  await archiveItem(req.userId, "column", column.id);
  await sendUserState(req, res);
});

app.patch("/api/columns/:id/restore", requireUser, async (req, res) => {
  const column = await findOwnedColumn(req.userId, req.params.id);
  if (!column) {
    res.status(404).json({ error: "Column not found" });
    return;
  }

  await restoreArchiveItems(req.userId, [
    { itemType: "board", itemId: column.boardId },
    { itemType: "column", itemId: column.id },
  ]);
  await sendUserState(req, res);
});

app.post("/api/columns/:columnId/cards", requireUser, async (req, res) => {
  const column = await findOwnedColumn(req.userId, req.params.columnId);
  if (!column) {
    res.status(404).json({ error: "Column not found" });
    return;
  }

  const position = await prisma.card.count({ where: { columnId: column.id } });
  await prisma.card.create({
    data: {
      id: uid(),
      columnId: column.id,
      title: String(req.body.title || "").trim(),
      description: String(req.body.description || ""),
      dueDate: String(req.body.dueDate || ""),
      label: String(req.body.label || ""),
      labelColor: String(req.body.labelColor || "#10b981"),
      completed: Boolean(req.body.completed),
      position,
    },
  });
  await sendUserState(req, res);
});

app.patch("/api/cards/:id", requireUser, async (req, res) => {
  const card = await findOwnedCard(req.userId, req.params.id);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  const data = {};
  if (req.body.title !== undefined) data.title = String(req.body.title || "").trim();
  if (req.body.description !== undefined) data.description = String(req.body.description || "");
  if (req.body.dueDate !== undefined) data.dueDate = String(req.body.dueDate || "");
  if (req.body.label !== undefined) data.label = String(req.body.label || "");
  if (req.body.labelColor !== undefined) data.labelColor = String(req.body.labelColor || "#10b981");
  if (req.body.completed !== undefined) data.completed = Boolean(req.body.completed);

  await prisma.card.update({ where: { id: card.id }, data });
  await sendUserState(req, res);
});

app.patch("/api/cards/:id/move", requireUser, async (req, res) => {
  const card = await findOwnedCard(req.userId, req.params.id);
  const targetColumn = await findOwnedColumn(req.userId, req.body.columnId);
  if (!card || !targetColumn) {
    res.status(404).json({ error: "Card or target column not found" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (card.columnId !== targetColumn.id) {
      const sourceCards = await tx.card.findMany({
        where: { columnId: card.columnId, id: { not: card.id } },
        orderBy: { position: "asc" },
      });
      for (const [position, item] of sourceCards.entries()) {
        await tx.card.update({ where: { id: item.id }, data: { position } });
      }
    }

    const targetCards = await tx.card.findMany({
      where: { columnId: targetColumn.id, id: { not: card.id } },
      orderBy: { position: "asc" },
    });
    const beforeIndex = req.body.beforeCardId ? targetCards.findIndex((item) => item.id === req.body.beforeCardId) : -1;
    targetCards.splice(beforeIndex >= 0 ? beforeIndex : targetCards.length, 0, card);

    for (const [position, item] of targetCards.entries()) {
      await tx.card.update({ where: { id: item.id }, data: { columnId: targetColumn.id, position } });
    }
  });
  await sendUserState(req, res);
});

app.delete("/api/cards/:id", requireUser, async (req, res) => {
  const card = await findOwnedCard(req.userId, req.params.id);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  if (req.query.permanent === "1") {
    await prisma.$transaction([
      prisma.archiveItem.deleteMany({ where: { userId: req.userId, itemType: "card", itemId: card.id } }),
      prisma.card.delete({ where: { id: card.id } }),
    ]);
    await sendUserState(req, res);
    return;
  }

  await archiveItem(req.userId, "card", card.id);
  await sendUserState(req, res);
});

app.patch("/api/cards/:id/restore", requireUser, async (req, res) => {
  const card = await findOwnedCard(req.userId, req.params.id);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  await restoreArchiveItems(req.userId, [
    { itemType: "board", itemId: card.column.boardId },
    { itemType: "column", itemId: card.columnId },
    { itemType: "card", itemId: card.id },
  ]);
  await prisma.card.update({ where: { id: card.id }, data: { completed: false } });
  await sendUserState(req, res);
});

app.post("/api/cards/:id/comments", requireUser, async (req, res) => {
  const card = await findOwnedCard(req.userId, req.params.id);
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }

  const text = String(req.body.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "Comment text is required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  await prisma.comment.create({
    data: {
      id: uid(),
      cardId: card.id,
      author: user?.email || "User",
      text,
    },
  });
  await sendUserState(req, res);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(buildPath, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Trello app is running at http://localhost:${PORT}`);
  });
}

module.exports = { app, prisma };
