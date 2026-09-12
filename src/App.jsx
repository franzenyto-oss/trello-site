import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";

const STORAGE_KEY = "mini-trello-state-v1";
const TOKEN_KEY = "mini-trello-token";
const THEME_KEY = "mini-trello-theme";
const API_BASE = process.env.REACT_APP_API_BASE || "";
const CARD_DROP_END = "__card-drop-end__";
const LOADING_MIN_DURATION = 4000;
const LOADING_FADE_DURATION = 420;
const emptyDragImage = document.createElement("div");
emptyDragImage.style.position = "fixed";
emptyDragImage.style.top = "-1000px";
emptyDragImage.style.left = "-1000px";
emptyDragImage.style.width = "1px";
emptyDragImage.style.height = "1px";
document.body.appendChild(emptyDragImage);

const emptyState = {
  users: [],
  boards: [],
  columns: [],
  cards: [],
  comments: [],
};

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyState;
  } catch {
    return emptyState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function removeBoardTreeFromState(current, boardId) {
  const removedColumnIds = new Set(
    current.columns
      .filter((column) => column.boardId === boardId)
      .map((column) => column.id)
  );
  const removedCardIds = new Set(
    current.cards
      .filter((card) => removedColumnIds.has(card.columnId))
      .map((card) => card.id)
  );

  return {
    ...current,
    boards: current.boards.filter((board) => board.id !== boardId),
    columns: current.columns.filter((column) => column.boardId !== boardId),
    cards: current.cards.filter((card) => !removedColumnIds.has(card.columnId)),
    comments: current.comments.filter((comment) => !removedCardIds.has(comment.cardId)),
  };
}

function reorderColumnsInState(current, columnId, boardId, targetColumnId) {
  if (!columnId || columnId === targetColumnId) return current;

  const draggedColumn = current.columns.find((column) => column.id === columnId && column.boardId === boardId);
  const targetColumn = current.columns.find((column) => column.id === targetColumnId && column.boardId === boardId);
  if (!draggedColumn || !targetColumn) return current;

  return {
    ...current,
    columns: current.columns.map((column) => {
      if (column.id === draggedColumn.id) return { ...column, position: targetColumn.position };
      if (column.id === targetColumn.id) return { ...column, position: draggedColumn.position };
      return column;
    }),
  };
}

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Ошибка сервера");
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Сервер не запущен. Откройте http://localhost:3000 или запустите npm run dev.");
    }
    throw error;
  }
}

function readTokenUserId() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const encodedPayload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=")));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return payload.sub;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

function AppLogo({ compact = false }) {
  return (
    <div className={`app-logo ${compact ? "app-logo-compact" : ""}`} aria-label="Trello">
      <span className="app-logo-mark" aria-hidden="true">
        <span className="app-logo-block app-logo-block-top"></span>
        <span className="app-logo-block app-logo-block-mid"></span>
        <span className="app-logo-block app-logo-block-bottom"></span>
      </span>
      {!compact && <span className="app-logo-word">Trello</span>}
    </div>
  );
}

function AuthPage({ mode, setMode, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isLogin = mode === "login";

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || password.length < 6) {
      setError("Введите email и пароль минимум из 6 символов.");
      setLoading(false);
      return;
    }

    try {
      const result = await api(isLogin ? "/api/login" : "/api/register", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
      onLogin(result.userId, result.state);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-header">
          <AppLogo />
          <h1>{isLogin ? "Вход" : "Регистрация"}</h1>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input className="focus-ring" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input className="focus-ring" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit focus-ring" disabled={loading}>
            {loading ? "Проверяем..." : isLogin ? "Войти" : "Создать аккаунт"}
          </button>
        </form>

        <button className="auth-mode-button focus-ring" onClick={() => setMode(isLogin ? "register" : "login")}>
          {isLogin ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>
      </section>
    </main>
  );
}

function Sidebar({ user, boards, activeBoardId, activeBoardTitle, setActiveBoardId, createBoard, updateBoard, deleteBoard, archiveItems, archiveActions, logout, closeMenu }) {
  const [draft, setDraft] = useState("");

  function addBoard(event) {
    event.preventDefault();
    if (!draft.trim()) return;
    createBoard(draft.trim());
    setDraft("");
  }

  return (
    <aside className="sidebar flex flex-col gap-5 p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <AppLogo />
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
          <div className="flex gap-2">
            <button className="menu-toggle-button focus-ring" type="button" aria-label="Скрыть меню" onClick={closeMenu}>
              <span aria-hidden="true"></span>
            </button>
            <button className="sidebar-text-button focus-ring" onClick={logout}>Exit</button>
          </div>
        </div>
      </div>

      <form className="flex gap-2" onSubmit={addBoard}>
        <input className="focus-ring min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Новая доска" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="add-board-button focus-ring" aria-label="Создать доску">
          <span aria-hidden="true"></span>
        </button>
      </form>

      <nav className="space-y-2 overflow-y-auto">
        {boards.map((board) => (
          <BoardNavItem key={board.id} board={board} active={board.id === activeBoardId} setActiveBoardId={setActiveBoardId} updateBoard={updateBoard} deleteBoard={deleteBoard} />
        ))}
        {!boards.length && <p className="sidebar-empty-state">Создайте первую доску.</p>}
      </nav>
      <ArchivePanel items={archiveItems} actions={archiveActions} boardTitle={activeBoardTitle} />
    </aside>
  );
}

function BoardNavItem({ board, active, setActiveBoardId, updateBoard, deleteBoard }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(board.title);

  function save() {
    const value = title.trim();
    if (value) updateBoard(board.id, value);
    setEditing(false);
  }

  return (
    <div
      className={`board-nav-item rounded-md border ${active ? "border-blue-300 bg-blue-50" : "border-transparent bg-white hover:bg-slate-50"}`}
      role="button"
      tabIndex="0"
      onMouseDown={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("input, button")) return;
        event.preventDefault();
        setActiveBoardId(board.id);
      }}
      onClick={() => setActiveBoardId(board.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setActiveBoardId(board.id);
      }}
    >
      <div className="board-nav-title focus-ring w-full px-3 py-2 text-left text-sm font-medium">
        {editing ? (
          <input
            className="focus-ring w-full rounded border border-slate-300 px-2 py-1"
            value={title}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") save();
            }}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={save}
            autoFocus
          />
        ) : (
          <span className="block truncate">{board.title}</span>
        )}
      </div>
      <div className="flex gap-2 px-3 pb-2">
        <IconButton
          label="Редактировать"
          tone="blue"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
        >
          <PencilIcon />
        </IconButton>
        <IconButton
          label="Удалить"
          tone="red"
          onClick={(event) => {
            event.stopPropagation();
            deleteBoard(board.id);
          }}
        >
          <TrashIcon />
        </IconButton>
      </div>
    </div>
  );
}

function ArchivePanel({ items, actions, boardTitle }) {
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const groups = [
    ...(boardTitle ? [
      { key: "columns", title: "Колонки", restore: actions.restoreColumn, purge: actions.permanentDeleteColumn },
      { key: "cards", title: "Карточки", restore: actions.restoreCard, purge: actions.permanentDeleteCard },
    ] : []),
    ...(items.boards.length ? [
      { key: "boards", title: "Архивированные доски", restore: actions.restoreBoard, purge: actions.permanentDeleteBoard },
    ] : []),
  ];
  const archiveTitle = boardTitle ? `Архив: ${boardTitle}` : "Архив досок";

  function toggleGroup(key) {
    setCollapsedGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className="archive-panel">
      <div className="archive-panel-header">
        <h2 title={archiveTitle}>{archiveTitle}</h2>
      </div>
      {groups.map((group) => {
        const collapsed = Boolean(collapsedGroups[group.key]);
        const listId = `archive-group-${group.key}`;

        return (
          <div key={group.key} className={`archive-group ${collapsed ? "archive-group-collapsed" : ""}`}>
            <button
              type="button"
              className="archive-group-toggle focus-ring"
              aria-expanded={!collapsed}
              aria-controls={listId}
              onClick={() => toggleGroup(group.key)}
            >
              <span>{group.title}</span>
              <ChevronDownIcon />
            </button>
            <div id={listId} className="archive-group-list" aria-hidden={collapsed}>
              <div className="archive-group-list-inner">
                {items[group.key].map((item) => (
                  <div key={item.id} className="archive-item">
                    <div>
                      <strong>{item.title}</strong>
                      {item.context && <span>{item.context}</span>}
                    </div>
                    <div className="archive-actions">
                      <IconButton label="Восстановить" tone="blue" onClick={() => group.restore(item.id)}>
                        <RestoreIcon />
                      </IconButton>
                      <IconButton label="Удалить окончательно" tone="red" onClick={() => group.purge(item.id)}>
                        <TrashIcon />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconButton({ label, tone = "blue", onClick, children }) {
  return (
    <button
      type="button"
      className={`icon-button icon-button-${tone} focus-ring`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.7 8.4A6.8 6.8 0 1 0 19 15" />
      <path d="M19 4.8v4.1h-4.1" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.2L18.7 9.5l-4.2-4.2L4 15.8V20Z" />
      <path d="m13.4 6.4 4.2 4.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </svg>
  );
}

function ThemeToggleButton({ theme, setTheme }) {
  const nextTheme = theme === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      className="theme-toggle-button focus-ring"
      aria-label="Сменить тему"
      title="Сменить тему"
      onClick={() => setTheme(nextTheme)}
    >
      <SunIcon />
    </button>
  );
}

function BoardView({ board, boards, allColumns, columns, cards, actions }) {
  const [activeCardId, setActiveCardId] = useState(null);
  const [hoveredColumnId, setHoveredColumnId] = useState(null);
  const [draggedColumnId, setDraggedColumnId] = useState(null);
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [cardHoverColumnId, setCardHoverColumnId] = useState(null);
  const [editingColumnId, setEditingColumnId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [draggedCardHeight, setDraggedCardHeight] = useState(58);
  const columnMoveRef = useRef({
    draggedId: null,
  });
  const activeCard = cards.find((card) => card.id === activeCardId);

  function closeContextMenu() {
    setContextMenu(null);
  }

  function openColumnContextMenu(column, event) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      type: "column",
      x: event.clientX,
      y: event.clientY,
      columnId: column.id,
    });
  }

  function openCardContextMenu(card, event) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      type: "card",
      x: event.clientX,
      y: event.clientY,
      cardId: card.id,
    });
  }

  useEffect(() => {
    if (!contextMenu) return undefined;

    function closeOnKey(event) {
      if (event.key === "Escape") closeContextMenu();
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu]);

  function startColumnDrag(columnId) {
    columnMoveRef.current = {
      draggedId: columnId,
    };
    setDraggedColumnId(columnId);
  }

  function finishColumnDrag() {
    columnMoveRef.current.draggedId = null;
    setDraggedColumnId(null);
    setHoveredColumnId(null);
  }

  function startCardDrag(cardId, height) {
    setDraggedCardId(cardId);
    setCardHoverColumnId(null);
    setDraggedCardHeight(height || 58);
  }

  function finishCardDrag() {
    setDraggedCardId(null);
    setCardHoverColumnId(null);
    setDraggedCardHeight(58);
  }

  useEffect(() => {
    if (!draggedCardId) return undefined;

    const clearCardDrag = () => finishCardDrag();
    window.addEventListener("dragend", clearCardDrag, true);
    window.addEventListener("drop", clearCardDrag, true);
    window.addEventListener("mouseup", clearCardDrag, true);

    return () => {
      window.removeEventListener("dragend", clearCardDrag, true);
      window.removeEventListener("drop", clearCardDrag, true);
      window.removeEventListener("mouseup", clearCardDrag, true);
    };
  }, [draggedCardId]);

  useEffect(() => {
    if (!draggedColumnId) return undefined;

    const clearColumnDrag = () => finishColumnDrag();
    window.addEventListener("dragend", clearColumnDrag, true);
    window.addEventListener("mouseup", clearColumnDrag, true);

    return () => {
      window.removeEventListener("dragend", clearColumnDrag, true);
      window.removeEventListener("mouseup", clearColumnDrag, true);
    };
  }, [draggedColumnId]);

  function dropDraggedColumn(boardId, targetColumnId) {
    const draggedId = columnMoveRef.current.draggedId || draggedColumnId;
    const nextTargetId = targetColumnId || hoveredColumnId;
    if (!draggedId || !nextTargetId || draggedId === nextTargetId) return;
    actions.moveColumn(draggedId, boardId, nextTargetId);
    setHoveredColumnId(null);
  }

  function moveColumnToBoard(columnId, boardId) {
    closeContextMenu();
    actions.moveColumnToBoard(columnId, boardId);
  }

  function moveCardToColumn(cardId, columnId) {
    closeContextMenu();
    actions.moveCard(cardId, columnId);
  }

  function archiveColumn(columnId) {
    closeContextMenu();
    actions.deleteColumn(columnId);
  }

  function archiveCard(cardId) {
    closeContextMenu();
    actions.deleteCard(cardId);
  }

  async function createDefaultColumn() {
    const newColumnId = await actions.createColumn(board.id, `Новая колонка ${columns.length + 1}`);
    if (newColumnId) setEditingColumnId(newColumnId);
  }

  return (
    <main className="min-w-0 p-4">
      <section
        className="board-scroll flex h-[calc(100vh-32px)] items-start gap-4 overflow-y-hidden pb-4"
        onDragOver={(event) => {
          if (draggedCardId) {
            const targetColumn = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest("[data-column-id]");
            setCardHoverColumnId(targetColumn?.dataset.columnId || null);
            return;
          }

          const draggedId = columnMoveRef.current.draggedId || draggedColumnId;
          if (!draggedId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const targetColumn = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest("[data-column-id]");
          const targetColumnId = targetColumn?.dataset.columnId || null;
          setHoveredColumnId(targetColumnId && targetColumnId !== draggedId ? targetColumnId : null);
        }}
        onDrop={(event) => {
          if (!columnMoveRef.current.draggedId && !draggedColumnId) return;
          event.preventDefault();
          const targetColumn = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest("[data-column-id]");
          dropDraggedColumn(board.id, targetColumn?.dataset.columnId || hoveredColumnId);
        }}
        onDragLeave={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            if (draggedCardId) setCardHoverColumnId(null);
            if (columnMoveRef.current.draggedId || draggedColumnId) setHoveredColumnId(null);
          }
        }}
      >
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            cards={cards.filter((card) => card.columnId === column.id && !card.completed).sort((a, b) => a.position - b.position)}
            actions={actions}
            onOpenCard={setActiveCardId}
            onColumnDragStart={startColumnDrag}
            onColumnDragEnd={finishColumnDrag}
            onColumnHover={setHoveredColumnId}
            onColumnDrop={dropDraggedColumn}
            onColumnContextMenu={openColumnContextMenu}
            onCardContextMenu={openCardContextMenu}
            draggedColumnId={draggedColumnId}
            draggedCardId={draggedCardId}
            cardHoverColumnId={cardHoverColumnId}
            draggedCardHeight={draggedCardHeight}
            onCardDragStart={startCardDrag}
            onCardHoverColumn={setCardHoverColumnId}
            onCardDragEnd={finishCardDrag}
            hovered={hoveredColumnId === column.id}
            autoEditTitle={editingColumnId === column.id}
            onTitleEditDone={() => setEditingColumnId(null)}
          />
        ))}
        {columns.length ? (
          <AddColumnButton onAdd={createDefaultColumn} />
        ) : (
          <div className="empty-column-prompt">
            <AddColumnButton onAdd={createDefaultColumn} />
            <div className="board-empty-state">Добавьте колонку, чтобы начать.</div>
          </div>
        )}
      </section>

      {contextMenu && (
        <MoveContextMenu
          menu={contextMenu}
          boards={boards}
          columns={allColumns}
          cards={cards}
          onMoveColumn={moveColumnToBoard}
          onMoveCard={moveCardToColumn}
          onArchiveColumn={archiveColumn}
          onArchiveCard={archiveCard}
        />
      )}

      {activeCard && (
        <CardModal
          card={activeCard}
          close={() => setActiveCardId(null)}
          actions={actions}
        />
      )}
    </main>
  );
}

function MoveContextMenu({ menu, boards, columns, cards, onMoveColumn, onMoveCard, onArchiveColumn, onArchiveCard }) {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  const opensLeft = menu.x > viewportWidth - 460;
  const left = Math.max(8, Math.min(menu.x, viewportWidth - 196));
  const top = Math.max(8, Math.min(menu.y, viewportHeight - 368));
  const sortedBoards = [...boards].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  function sortedColumns(boardId) {
    return columns
      .filter((column) => column.boardId === boardId)
      .sort((a, b) => a.position - b.position);
  }

  if (menu.type === "column") {
    const column = columns.find((item) => item.id === menu.columnId);
    if (!column) return null;
    const targetBoards = sortedBoards.filter((item) => item.id !== column.boardId);

    return (
      <section
        className={`move-menu ${opensLeft ? "move-menu-left" : ""}`}
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="move-menu-move">
          <button type="button" className="move-menu-trigger">Перенести колонку</button>
          <div className="move-menu-flyout move-menu-list">
            {targetBoards.map((board) => (
              <button key={board.id} type="button" onClick={() => onMoveColumn(column.id, board.id)}>
                <span>{board.title}</span>
              </button>
            ))}
            {!targetBoards.length && <p>Нет другой доски</p>}
          </div>
        </div>
        <button type="button" className="move-menu-trigger move-menu-archive" onClick={() => onArchiveColumn(column.id)}>
          <span>В архив</span>
        </button>
      </section>
    );
  }

  const card = cards.find((item) => item.id === menu.cardId);
  if (!card) return null;
  const currentColumn = columns.find((column) => column.id === card.columnId);
  const targetBoards = sortedBoards.filter((board) => board.id !== currentColumn?.boardId);

  return (
    <section
      className={`move-menu move-menu-card ${opensLeft ? "move-menu-left" : ""}`}
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="move-menu-move">
        <button type="button" className="move-menu-trigger">Перенести карточку</button>
        <div className="move-menu-flyout move-menu-board-list">
          {targetBoards.map((board) => {
            const boardColumns = sortedColumns(board.id);
            return (
              <div key={board.id} className="move-menu-board">
                <h3>{board.title}</h3>
                {boardColumns.map((column) => (
                  <button key={column.id} type="button" onClick={() => onMoveCard(card.id, column.id)}>
                    <span className="move-menu-color" style={{ backgroundColor: column.color || "#64748b" }}></span>
                    <span>{column.title}</span>
                  </button>
                ))}
                {!boardColumns.length && <p>Нет доступных колонок</p>}
              </div>
            );
          })}
          {!targetBoards.length && <p>Нет другой доски</p>}
        </div>
      </div>
      <button type="button" className="move-menu-trigger move-menu-archive" onClick={() => onArchiveCard(card.id)}>
        <span>В архив</span>
      </button>
    </section>
  );
}

function AddColumnButton({ onAdd }) {
  function addColumn(event) {
    event.preventDefault();
    event.stopPropagation();
    onAdd();
  }

  return (
    <button
      type="button"
      className="add-column-button focus-ring"
      aria-label="Добавить колонку"
      title="Добавить колонку"
      onClick={addColumn}
    >
      <span aria-hidden="true"></span>
    </button>
  );
}

function Column({ column, cards, actions, onOpenCard, onColumnDragStart, onColumnDragEnd, onColumnHover, onColumnDrop, onColumnContextMenu, onCardContextMenu, draggedColumnId, draggedCardId, cardHoverColumnId, draggedCardHeight, onCardDragStart, onCardHoverColumn, onCardDragEnd, hovered, autoEditTitle = false, onTitleEditDone }) {
  const [editing, setEditing] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);
  const [title, setTitle] = useState(column.title);
  const [cardTitle, setCardTitle] = useState("");
  const [cardDropTargetId, setCardDropTargetId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [sourceHidden, setSourceHidden] = useState(false);
  const [dragPreview, setDragPreview] = useState(null);
  const liftTimer = useRef(null);
  const titleInputRef = useRef(null);
  const cardListRef = useRef(null);
  const cardRectsRef = useRef(new Map());
  const cardDropTargetRef = useRef(null);
  const cardLayoutKey = `${cardDropTargetId || ""}|${cards.map((card) => card.id).join("|")}`;
  const columnColor = column.color || "#64748b";

  useEffect(() => () => clearTimeout(liftTimer.current), []);

  useEffect(() => {
    if (editing) return;
    setTitle(column.title);
  }, [column.title, editing]);

  useEffect(() => {
    if (!autoEditTitle) return;
    setTitle("");
    setEditing(true);
  }, [autoEditTitle]);

  useLayoutEffect(() => {
    if (!editing) return;
    const input = titleInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  useEffect(() => {
    cardDropTargetRef.current = cardDropTargetId;
  }, [cardDropTargetId]);

  useEffect(() => {
    if (draggedCardId) return;
    cardDropTargetRef.current = null;
    setCardDropTargetId(null);
  }, [draggedCardId]);

  useEffect(() => {
    if (!draggedCardId || cardHoverColumnId === column.id) return;
    cardDropTargetRef.current = null;
    setCardDropTargetId(null);
  }, [cardHoverColumnId, column.id, draggedCardId]);

  useEffect(() => {
    if (!editingCardId || cards.some((card) => card.id === editingCardId)) return;
    setEditingCardId(null);
  }, [cards, editingCardId]);

  useLayoutEffect(() => {
    const previousRects = cardRectsRef.current;
    const list = cardListRef.current;
    if (!list) return;

    const cardElements = Array.from(list.querySelectorAll("[data-card-id]"));
    const nextRects = new Map();
    for (const element of cardElements) {
      const cardId = element.dataset.cardId;
      const previousRect = previousRects.get(cardId);
      const nextRect = element.getBoundingClientRect();
      nextRects.set(cardId, nextRect);
      if (!previousRect || cardId === draggedCardId) continue;

      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

      element.style.transition = "none";
      element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      element.getBoundingClientRect();
      requestAnimationFrame(() => {
        element.style.transition = "";
        element.style.transform = "";
      });
    }

    cardRectsRef.current = nextRects;
  }, [cardLayoutKey, draggedCardId]);

  function saveTitle() {
    const nextTitle = title.trim();
    if (nextTitle) {
      actions.updateColumn(column.id, nextTitle);
    } else {
      setTitle(column.title);
    }
    setEditing(false);
    onTitleEditDone?.();
  }

  async function createCardFromTitle(rawTitle) {
    const nextTitle = rawTitle.trim();
    if (!nextTitle) return;
    const newCardId = await actions.createCard(column.id, nextTitle);
    setCardTitle("");
    if (!newCardId) setCardTitle(nextTitle);
  }

  function addCard(event) {
    event.preventDefault();
    createCardFromTitle(cardTitle);
  }

  function measureCardRects() {
    const list = cardListRef.current;
    if (!list) return;

    const nextRects = new Map();
    for (const element of list.querySelectorAll("[data-card-id]")) {
      nextRects.set(element.dataset.cardId, element.getBoundingClientRect());
    }
    cardRectsRef.current = nextRects;
  }

  function updateCardDropTarget(nextTargetId) {
    if (cardDropTargetRef.current === nextTargetId) return;
    measureCardRects();
    cardDropTargetRef.current = nextTargetId;
    setCardDropTargetId(nextTargetId);
  }

  function hasCardDrag(event) {
    return Array.from(event.dataTransfer.types).includes("application/x-card-id");
  }

  function readDraggedCardId(event) {
    return event.dataTransfer.getData("application/x-card-id") || event.dataTransfer.getData("text/plain");
  }

  function normalizeCardDropTarget(targetId, nextDraggedCardId = draggedCardId) {
    if (!targetId) return null;

    const sourceIndex = cards.findIndex((card) => card.id === nextDraggedCardId);
    if (sourceIndex < 0) return targetId;

    if (targetId === CARD_DROP_END) {
      return sourceIndex === cards.length - 1 ? null : CARD_DROP_END;
    }

    const targetIndex = cards.findIndex((card) => card.id === targetId);
    if (targetIndex < 0 || targetIndex === sourceIndex || targetIndex === sourceIndex + 1) {
      return null;
    }

    return targetId;
  }

  function getCardDropTarget(cardId, event) {
    const cardIndex = cards.findIndex((card) => card.id === cardId);
    if (cardIndex < 0) return null;

    const rect = event.currentTarget.getBoundingClientRect();
    const shouldDropAfter = event.clientY > rect.top + rect.height / 2;
    const nextTargetId = shouldDropAfter
      ? cards[cardIndex + 1]?.id || CARD_DROP_END
      : cardId;

    return normalizeCardDropTarget(nextTargetId, readDraggedCardId(event) || draggedCardId);
  }

  function getCardDropTargetFromList(event) {
    const list = cardListRef.current;
    if (!list) return null;

    for (const element of list.querySelectorAll("[data-card-id]")) {
      const rect = element.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        return normalizeCardDropTarget(element.dataset.cardId, readDraggedCardId(event) || draggedCardId);
      }
    }

    return normalizeCardDropTarget(CARD_DROP_END, readDraggedCardId(event) || draggedCardId);
  }

  function isPointerOutside(element, event) {
    const rect = element.getBoundingClientRect();
    const buffer = 2;
    return (
      event.clientX < rect.left - buffer ||
      event.clientX > rect.right + buffer ||
      event.clientY < rect.top - buffer ||
      event.clientY > rect.bottom + buffer
    );
  }

  function previewCardDrop(cardId, event) {
    if (!hasCardDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onCardHoverColumn(column.id);
    updateCardDropTarget(getCardDropTarget(cardId, event));
  }

  function previewCardDropAtEnd(event) {
    if (!hasCardDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onCardHoverColumn(column.id);
    updateCardDropTarget(getCardDropTargetFromList(event));
  }

  function dropCardAtTarget(targetId, event) {
    if (!hasCardDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const nextDraggedCardId = readDraggedCardId(event);
    const nextTargetId = normalizeCardDropTarget(targetId, nextDraggedCardId);
    onCardHoverColumn(null);
    updateCardDropTarget(null);
    onCardDragEnd();
    if (!nextDraggedCardId || !nextTargetId) return;

    actions.moveCard(nextDraggedCardId, column.id, nextTargetId === CARD_DROP_END ? null : nextTargetId);
  }

  function dropCardOnCard(cardId, event) {
    dropCardAtTarget(getCardDropTarget(cardId, event), event);
  }

  function finishCardDragInColumn() {
    onCardHoverColumn(null);
    updateCardDropTarget(null);
    onCardDragEnd();
  }

  function trackColumnUnderPointer(event) {
    if (!event.clientX && !event.clientY) return;
    setDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : null);
  }

  function startColumnDrag(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-card], input, textarea, select, button, .color-picker, .add-card-form")) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    setDragging(true);
    setLifting(true);
    setSourceHidden(false);
    clearTimeout(liftTimer.current);
    liftTimer.current = setTimeout(() => setLifting(false), 1000);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(emptyDragImage, 0, 0);
    event.dataTransfer.setData("application/x-column-id", column.id);
    event.dataTransfer.setData("text/plain", `column:${column.id}`);
    onColumnDragStart(column.id);

    const columnElement = event.currentTarget.closest("[data-column-id]");
    const rect = columnElement?.getBoundingClientRect();
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      width: rect?.width || 286,
      height: rect?.height || undefined,
    });
  }

  function finishColumnDrag() {
    clearTimeout(liftTimer.current);
    setDragging(false);
    setLifting(false);
    setSourceHidden(false);
    setDragPreview(null);
    onColumnDragEnd();
  }

  return (
    <>
    <article
      data-column-id={column.id}
      data-board-id={column.boardId}
      className={`column flex flex-col rounded-lg border bg-slate-100 p-3 ${hovered ? "column-over" : ""} ${dragging ? "column-dragging" : ""} ${sourceHidden ? "column-source-hidden" : ""}`}
      style={{ "--column-color": columnColor }}
      onContextMenu={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-card], input, textarea, select, button, .color-picker, .add-card-form")) return;
        onColumnContextMenu(column, event);
      }}
      onDragOver={(event) => {
        const dragTypes = Array.from(event.dataTransfer.types);
        const hasCard = dragTypes.includes("application/x-card-id");
        const hasColumn = dragTypes.includes("application/x-column-id") || Boolean(draggedColumnId);
        if (!hasCard && !hasColumn) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (hasCard) {
          onCardHoverColumn(column.id);
        }
        if (hasColumn) {
          onColumnHover(draggedColumnId === column.id ? null : column.id);
        }
      }}
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("application/x-column-id") && !draggedColumnId) return;
        event.preventDefault();
        onColumnHover(draggedColumnId === column.id ? null : column.id);
      }}
      onDragLeave={(event) => {
        if (isPointerOutside(event.currentTarget, event)) {
          if (draggedColumnId) onColumnHover(null);
          onCardHoverColumn(null);
          updateCardDropTarget(null);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onColumnHover(null);
        updateCardDropTarget(null);
        const droppedText = event.dataTransfer.getData("text/plain");
        const droppedColumnId = event.dataTransfer.getData("application/x-column-id")
          || (droppedText.startsWith("column:") ? droppedText.slice(7) : "")
          || draggedColumnId;
        if (droppedColumnId) {
          event.stopPropagation();
          onColumnDrop(column.boardId, column.id);
          return;
        }
        const cardId = event.dataTransfer.getData("application/x-card-id") || droppedText;
        if (!cardId) return;
        onCardHoverColumn(null);
        onCardDragEnd();
        actions.moveCard(cardId, column.id);
      }}
    >
      <div
        className="column-handle mb-3 flex items-center justify-between gap-2"
        draggable={!editing}
        onDragStart={startColumnDrag}
        onDragEnd={finishColumnDrag}
        onDrag={trackColumnUnderPointer}
      >
        {editing ? (
          <input
            ref={titleInputRef}
            className="column-title-input focus-ring"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveTitle();
              if (event.key === "Escape") {
                setTitle(column.title);
                setEditing(false);
                onTitleEditDone?.();
              }
            }}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wide text-slate-700">
            <span>{column.title}</span>
          </h2>
        )}
        <label className="color-picker" title="Цвет колонки">
          <span style={{ backgroundColor: columnColor }}></span>
          <input
            type="color"
            value={columnColor}
            onChange={(event) => actions.updateColumn(column.id, { color: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        </label>
        <IconButton label="Редактировать колонку" tone="blue" onClick={() => setEditing(true)}>
          <PencilIcon />
        </IconButton>
        <IconButton label="Удалить колонку" tone="red" onClick={() => actions.deleteColumn(column.id)}>
          <TrashIcon />
        </IconButton>
      </div>

      <div
        ref={cardListRef}
        className={`card-list flex-1 overflow-y-auto pr-1 ${cardDropTargetId ? "card-list-dropping" : ""}`}
        onDragOver={previewCardDropAtEnd}
        onDragLeave={(event) => {
          if (isPointerOutside(event.currentTarget, event)) updateCardDropTarget(null);
        }}
        onDrop={(event) => dropCardAtTarget(cardDropTargetRef.current || getCardDropTargetFromList(event), event)}
      >
        {cards.map((card) => (
          <React.Fragment key={card.id}>
            {cardDropTargetId === card.id && <CardDropPlaceholder height={draggedCardHeight} />}
            <Card
              card={card}
              actions={actions}
              onOpenCard={onOpenCard}
              isDragging={draggedCardId === card.id}
              isEditingTitle={editingCardId === card.id}
              onFinishTitleEdit={() => setEditingCardId(null)}
              onCardContextMenu={onCardContextMenu}
              onCardDragStart={onCardDragStart}
              onCardDragEnd={finishCardDragInColumn}
              onCardDragOver={previewCardDrop}
              onCardDrop={dropCardOnCard}
            />
          </React.Fragment>
        ))}
        {cardDropTargetId === CARD_DROP_END && <CardDropPlaceholder height={draggedCardHeight} />}
      </div>

      <form
        className="add-card-form mt-3 flex gap-2"
        onSubmit={addCard}
        onDragEnter={(event) => {
          if (!hasCardDrag(event)) return;
          onCardHoverColumn(column.id);
          updateCardDropTarget(normalizeCardDropTarget(CARD_DROP_END, draggedCardId));
        }}
        onDragOver={(event) => {
          if (!hasCardDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          onCardHoverColumn(column.id);
          updateCardDropTarget(normalizeCardDropTarget(CARD_DROP_END, readDraggedCardId(event) || draggedCardId));
        }}
        onDrop={(event) => {
          dropCardAtTarget(CARD_DROP_END, event);
        }}
      >
        <input
          className="focus-ring min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Новая карточка"
          value={cardTitle}
          onChange={(event) => setCardTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            createCardFromTitle(event.currentTarget.value);
          }}
        />
        <button
          type="submit"
          className="focus-ring"
          aria-label="Добавить карточку"
        >
          <span aria-hidden="true"></span>
        </button>
      </form>
    </article>
    {dragPreview && ReactDOM.createPortal(
      <div
        className={`column-drag-preview ${lifting ? "column-preview-wiggle" : ""}`}
        style={{
          "--column-color": columnColor,
          left: `${dragPreview.x}px`,
          top: `${dragPreview.y}px`,
          width: `${Math.round(dragPreview.width || 286)}px`,
          minWidth: `${Math.round(dragPreview.width || 286)}px`,
          maxWidth: `${Math.round(dragPreview.width || 286)}px`,
          ...(dragPreview.height ? { height: `${Math.round(dragPreview.height)}px` } : {}),
        }}
      >
        <div className="column-drag-preview-header">
          <h2>
            <span>{column.title}</span>
          </h2>
          <span className="column-drag-preview-color" style={{ backgroundColor: columnColor }}></span>
          <span className="column-drag-preview-icon" aria-hidden="true">
            <PencilIcon />
          </span>
          <span className="column-drag-preview-icon" aria-hidden="true">
            <TrashIcon />
          </span>
        </div>
        <div className="column-drag-preview-cards">
          {cards.map((card) => (
            <CardPreview key={card.id} card={card} />
          ))}
        </div>
        <div className="column-drag-preview-add add-card-form">
          <input className="focus-ring min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" value="" placeholder="Новая карточка" readOnly tabIndex={-1} />
          <button type="button" className="focus-ring" tabIndex={-1} aria-hidden="true">
            <span aria-hidden="true"></span>
          </button>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function CardDropPlaceholder({ height }) {
  return (
    <div
      className="card-drop-placeholder"
      style={{ "--card-drop-height": `${Math.max(46, Math.round(height || 58))}px` }}
      aria-hidden="true"
    ></div>
  );
}

function CardPreview({ card }) {
  const details = getCardDetails(card);
  const dueDate = formatCardDate(card.dueDate);
  const hasMeta = Boolean(details.client || details.address || dueDate || details.noteLines.length);
  const hasLabel = Boolean(card.label);

  return (
    <div
      className={`column-drag-preview-card card-shadow focus-ring w-full rounded-md border border-slate-200 bg-white p-3 text-left ${hasMeta ? "card-with-details" : ""} ${card.completed ? "card-completed" : ""}`}
      style={hasLabel ? { "--label-color": card.labelColor || "#10b981" } : undefined}
    >
      <div className="card-header">
        <h3 className="min-w-0 flex-1 font-semibold leading-snug">{card.title}</h3>
        <div className="card-actions">
          <button type="button" className={`task-check focus-ring ${card.completed ? "task-check-done" : ""}`} tabIndex={-1} aria-hidden="true">
            {card.completed && <span>{"\u2713"}</span>}
          </button>
        </div>
      </div>
      {hasMeta && (
        <div className="card-meta-stack">
          {details.client && (
            <p className="card-meta-line">
              <span>{details.client}</span>
            </p>
          )}
          {details.address && (
            <p className="card-meta-line">
              <span>{details.address}</span>
            </p>
          )}
          {details.noteLines.map((line, index) => (
            <p key={`${line}-${index}`} className="card-meta-line card-note-line">
              <span>{line}</span>
            </p>
          ))}
          {dueDate && (
            <p className="card-meta-line card-date-line">
              <span>{dueDate}</span>
            </p>
          )}
        </div>
      )}
      {details.amount && <strong className={`card-estimate-value ${hasLabel ? "card-label-text" : ""}`}>{details.amount}</strong>}
    </div>
  );
}

function getCardDetails(card) {
  const lines = (card.description || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const progressLineIndex = lines.findIndex((line) => /\bprogress\b/i.test(line) || /\d{1,3}\s*%/.test(line));
  const amountLineIndex = lines.findIndex((line) => /^\$/.test(line));
  const detailLines = lines.filter((_, index) => index !== progressLineIndex && index !== amountLineIndex);
  const noteLines = detailLines.slice(2);

  return {
    client: detailLines[0] || "",
    address: detailLines[1] || "",
    noteLines,
    amount: card.label || (amountLineIndex >= 0 ? lines[amountLineIndex] : ""),
  };
}

function formatCardDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function Card({ card, actions, onOpenCard, isDragging, isEditingTitle, onFinishTitleEdit, onCardContextMenu, onCardDragStart, onCardDragEnd, onCardDragOver, onCardDrop }) {
  const [titleDraft, setTitleDraft] = useState(card.title || "");
  const titleInputRef = useRef(null);
  const details = getCardDetails(card);
  const dueDate = formatCardDate(card.dueDate);
  const hasMeta = Boolean(details.client || details.address || dueDate || details.noteLines.length);
  const hasLabel = Boolean(card.label);

  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(card.title || "");
  }, [card.title, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    const nextTitle = card.title === "Untitled card" ? "" : card.title || "";
    setTitleDraft(nextTitle);
    requestAnimationFrame(() => {
      const input = titleInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextTitle.length, nextTitle.length);
    });
  }, [card.id, card.title, isEditingTitle]);

  function openCard() {
    onOpenCard(card.id);
  }

  function startCardDrag(event) {
    if (isEditingTitle) {
      event.preventDefault();
      return;
    }

    if (event.target.closest(".card-actions")) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-card-id", card.id);
    event.dataTransfer.setData("text/plain", card.id);
    onCardDragStart(card.id, event.currentTarget.getBoundingClientRect().height);
  }

  function finishCardDrag(event) {
    event.stopPropagation();
    onCardDragEnd();
  }

  async function saveTitle() {
    const nextTitle = titleDraft.trim();
    if (nextTitle !== card.title) {
      await actions.updateCard(card.id, { title: nextTitle });
    }
    onFinishTitleEdit();
  }

  return (
    <div
      data-card="true"
      data-card-id={card.id}
      draggable={!isEditingTitle}
      onDragStart={startCardDrag}
      onDragEnd={finishCardDrag}
      onDragEnter={(event) => onCardDragOver(card.id, event)}
      onDragOver={(event) => onCardDragOver(card.id, event)}
      onDrop={(event) => onCardDrop(card.id, event)}
      onContextMenu={(event) => {
        if (isEditingTitle) return;
        onCardContextMenu(card, event);
      }}
      onClick={(event) => {
        if (isEditingTitle) return;
        if (event.target.closest(".card-actions")) return;
        openCard();
      }}
      onKeyDown={(event) => {
        if (isEditingTitle) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenCard(card.id);
        }
      }}
      role="button"
      tabIndex="0"
      className={`card-shadow focus-ring w-full rounded-md border border-slate-200 bg-white p-3 text-left ${hasMeta ? "card-with-details" : ""} ${card.completed ? "card-completed" : ""} ${isDragging ? "card-dragging" : ""}`}
      style={hasLabel ? { "--label-color": card.labelColor || "#10b981" } : undefined}
    >
      <div className="card-header">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="card-title-input focus-ring"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={saveTitle}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setTitleDraft(card.title || "");
                onFinishTitleEdit();
              }
            }}
          />
        ) : (
          <h3 className="min-w-0 flex-1 font-semibold leading-snug">{card.title}</h3>
        )}
        <div className="card-actions" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`task-check focus-ring ${card.completed ? "task-check-done" : ""}`}
            aria-label="Архивировать карточку"
            onClick={(event) => {
              event.stopPropagation();
              actions.deleteCard(card.id);
            }}
          >
            {card.completed && <span>{"\u2713"}</span>}
          </button>
        </div>
      </div>
      {hasMeta && (
        <div className="card-meta-stack">
          {details.client && (
            <p className="card-meta-line">
              <span>{details.client}</span>
            </p>
          )}
          {details.address && (
            <p className="card-meta-line">
              <span>{details.address}</span>
            </p>
          )}
          {details.noteLines.map((line, index) => (
            <p key={`${line}-${index}`} className="card-meta-line card-note-line">
              <span>{line}</span>
            </p>
          ))}
          {dueDate && (
            <p className="card-meta-line card-date-line">
              <span>{dueDate}</span>
            </p>
          )}
        </div>
      )}
      {details.amount && <strong className={`card-estimate-value ${hasLabel ? "card-label-text" : ""}`}>{details.amount}</strong>}
    </div>
  );
}

function CardModal({ card, close, actions }) {
  const [form, setForm] = useState(card);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(card), [card.id]);

  async function save(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    const saved = await actions.updateCard(card.id, {
      title: form.title.trim(),
      description: form.description,
      dueDate: form.dueDate,
      label: form.label,
      labelColor: form.labelColor || "#10b981",
    });

    setSaving(false);
    if (saved === false) {
      setError("Не удалось сохранить изменения. Попробуйте еще раз.");
      return;
    }
    close();
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={close}>
      <section className="card-modal max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Карточка</h2>
          <button type="button" className="modal-close-button focus-ring" onClick={close}>Close</button>
        </div>

        <form className="modal-card-form grid gap-4" onSubmit={save}>
          <label className="modal-field">
            <span className="text-sm font-medium">Title</span>
            <input className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="modal-field">
            <span className="text-sm font-medium">Description</span>
            <textarea className="focus-ring h-28 w-full resize-none rounded-md border border-slate-300 px-3 py-2" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <div className="modal-form-grid grid gap-4 sm:grid-cols-2">
            <label className="modal-field">
              <span className="text-sm font-medium">Due date</span>
              <input className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
            </label>
            <div className="modal-field">
              <span className="text-sm font-medium">Label</span>
              <div className="label-editor">
                <input className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
                <label className="label-color-picker" title="Цвет метки">
                  <span style={{ backgroundColor: form.labelColor || "#10b981" }}></span>
                  <input type="color" value={form.labelColor || "#10b981"} onChange={(event) => setForm({ ...form, labelColor: event.target.value })} />
                </label>
              </div>
            </div>
          </div>
          <div className="modal-actions flex flex-wrap gap-2">
            {error && <p className="w-full text-sm font-medium text-red-700">{error}</p>}
            <button type="submit" className="modal-save-button focus-ring" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="modal-delete-button focus-ring" aria-label="Удалить карточку" title="Удалить карточку" onClick={() => { actions.deleteCard(card.id); close(); }}>
              <TrashIcon />
            </button>
          </div>
        </form>

      </section>
    </div>
  );
}

function App() {
  const [state, setState] = useState(readState);
  const [userId, setUserId] = useState(readTokenUserId);
  const [authMode, setAuthMode] = useState("login");
  const [stateReady, setStateReady] = useState(!localStorage.getItem(TOKEN_KEY));
  const [loadingExiting, setLoadingExiting] = useState(false);
  const loadingStartedAt = useRef(Date.now());
  const [theme, setTheme] = useState(() => (
    localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"
  ));
  const [menuOpen, setMenuOpen] = useState(true);
  const [menuButtonVisible, setMenuButtonVisible] = useState(false);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const user = state.users.find((item) => item.id === userId);
  const userBoards = state.boards.filter((board) => board.userId === userId);
  const boards = userBoards.filter((board) => !board.archivedAt);
  const activeBoard = boards.find((board) => board.id === activeBoardId) || boards[0];
  const activeBoardIds = new Set(boards.map((board) => board.id));
  const visibleColumns = state.columns.filter((column) => !column.archivedAt && activeBoardIds.has(column.boardId));
  const visibleColumnIds = new Set(visibleColumns.map((column) => column.id));
  const visibleCards = state.cards.filter((card) => !card.archivedAt && visibleColumnIds.has(card.columnId));
  const columnById = new Map(state.columns.map((column) => [column.id, column]));
  const activeBoardColumnIds = new Set(
    state.columns
      .filter((column) => column.boardId === activeBoard?.id)
      .map((column) => column.id)
  );
  const archiveItems = {
    boards: userBoards
      .filter((board) => board.archivedAt)
      .map((board) => ({ id: board.id, title: board.title })),
    columns: state.columns
      .filter((column) => column.archivedAt && column.boardId === activeBoard?.id)
      .map((column) => ({ id: column.id, title: column.title })),
    cards: state.cards
      .filter((card) => {
        const column = columnById.get(card.columnId);
        return (card.archivedAt || card.completed) && column && activeBoardColumnIds.has(card.columnId);
      })
      .map((card) => {
        const column = columnById.get(card.columnId);
        return { id: card.id, title: card.title || "Untitled card", context: column?.title || "" };
      }),
  };

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setStateReady(true);
      return;
    }

    let finishTimer;
    let fadeTimer;

    api("/api/state")
      .then((nextState) => {
        setState(nextState);
        saveState(nextState);
        setUserId(readTokenUserId());
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUserId(null);
      })
      .finally(() => {
        const remaining = Math.max(
          0,
          LOADING_MIN_DURATION - (Date.now() - loadingStartedAt.current)
        );
        finishTimer = setTimeout(() => {
          setLoadingExiting(true);
          fadeTimer = setTimeout(() => setStateReady(true), LOADING_FADE_DURATION);
        }, remaining);
      });

    return () => {
      clearTimeout(finishTimer);
      clearTimeout(fadeTimer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (menuOpen) {
      setMenuButtonVisible(false);
      return;
    }

    const timer = setTimeout(() => setMenuButtonVisible(true), 520);
    return () => clearTimeout(timer);
  }, [menuOpen]);

  useEffect(() => {
    if (!activeBoardId && boards[0]) setActiveBoardId(boards[0].id);
    if (activeBoardId && !boards.some((board) => board.id === activeBoardId)) setActiveBoardId(boards[0]?.id || null);
  }, [boards.length, activeBoardId]);

  const actions = useMemo(() => ({
    async createBoard(title) {
      try {
        const nextState = await api("/api/boards", {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        setState(nextState);
        setActiveBoardId(nextState.boards.filter((board) => !board.archivedAt).at(-1)?.id || null);
      } catch (error) {
        console.error(error);
      }
    },
    async updateBoard(id, title) {
      try {
        setState(await api(`/api/boards/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        }));
      } catch (error) {
        console.error(error);
      }
    },
    async deleteBoard(id) {
      try {
        setState(await api(`/api/boards/${id}`, { method: "DELETE" }));
      } catch (error) {
        console.error(error);
      }
    },
    async restoreBoard(id) {
      try {
        const nextState = await api(`/api/boards/${id}/restore`, { method: "PATCH" });
        setState(nextState);
        setActiveBoardId(id);
      } catch (error) {
        console.error(error);
      }
    },
    async permanentDeleteBoard(id) {
      try {
        const nextState = removeBoardTreeFromState(
          await api(`/api/boards/${id}?permanent=1`, { method: "DELETE" }),
          id
        );
        setState(nextState);
        saveState(nextState);
        setActiveBoardId(nextState.boards.filter((board) => !board.archivedAt)[0]?.id || null);
      } catch (error) {
        console.error(error);
      }
    },
    async createColumn(boardId, title) {
      try {
        const nextState = await api(`/api/boards/${boardId}/columns`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        setState(nextState);
        return nextState.columns
          .filter((column) => column.boardId === boardId)
          .sort((a, b) => a.position - b.position)
          .at(-1)?.id || null;
      } catch (error) {
        console.error(error);
        return null;
      }
    },
    async updateColumn(id, patch) {
      const nextPatch = typeof patch === "string" ? { title: patch } : patch;
      try {
        setState(await api(`/api/columns/${id}`, {
          method: "PATCH",
          body: JSON.stringify(nextPatch),
        }));
      } catch (error) {
        console.error(error);
      }
    },
    async moveColumn(columnId, boardId, targetColumnId = null) {
      if (!columnId || columnId === targetColumnId) return;
      setState((current) => reorderColumnsInState(current, columnId, boardId, targetColumnId));
      try {
        setState(await api(`/api/columns/${columnId}/move`, {
          method: "PATCH",
          body: JSON.stringify({ boardId, targetColumnId }),
        }));
      } catch (error) {
        console.error(error);
      }
    },
    async moveColumnToBoard(columnId, boardId) {
      if (!columnId || !boardId) return;
      try {
        setState(await api(`/api/columns/${columnId}/move`, {
          method: "PATCH",
          body: JSON.stringify({ boardId }),
        }));
      } catch (error) {
        console.error(error);
      }
    },
    async deleteColumn(id) {
      try {
        setState(await api(`/api/columns/${id}`, { method: "DELETE" }));
      } catch (error) {
        console.error(error);
      }
    },
    async restoreColumn(id) {
      try {
        setState(await api(`/api/columns/${id}/restore`, { method: "PATCH" }));
      } catch (error) {
        console.error(error);
      }
    },
    async permanentDeleteColumn(id) {
      try {
        setState(await api(`/api/columns/${id}?permanent=1`, { method: "DELETE" }));
      } catch (error) {
        console.error(error);
      }
    },
    async createCard(columnId, title) {
      try {
        const nextState = await api(`/api/columns/${columnId}/cards`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        setState(nextState);
        return nextState.cards
          .filter((card) => card.columnId === columnId)
          .sort((a, b) => a.position - b.position)
          .at(-1)?.id || null;
      } catch (error) {
        console.error(error);
        return null;
      }
    },
    async updateCard(id, patch) {
      try {
        setState(await api(`/api/cards/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }));
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },
    async deleteCard(id) {
      try {
        setState(await api(`/api/cards/${id}`, { method: "DELETE" }));
      } catch (error) {
        console.error(error);
      }
    },
    async restoreCard(id) {
      try {
        setState(await api(`/api/cards/${id}/restore`, { method: "PATCH" }));
      } catch (error) {
        console.error(error);
      }
    },
    async permanentDeleteCard(id) {
      try {
        setState(await api(`/api/cards/${id}?permanent=1`, { method: "DELETE" }));
      } catch (error) {
        console.error(error);
      }
    },
    async moveCard(cardId, columnId, beforeCardId = null) {
      if (!cardId || cardId === beforeCardId) return;
      try {
        setState(await api(`/api/cards/${cardId}/move`, {
          method: "PATCH",
          body: JSON.stringify({ columnId, beforeCardId }),
        }));
      } catch (error) {
        console.error(error);
      }
    },
    async addComment(cardId, text) {
      try {
        setState(await api(`/api/cards/${cardId}/comments`, {
          method: "POST",
          body: JSON.stringify({ text }),
        }));
      } catch (error) {
        console.error(error);
      }
    },
  }), []);

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUserId(null);
    setActiveBoardId(null);
  }

  function handleLogin(nextUserId, nextState = readState()) {
    setState(nextState);
    setUserId(nextUserId);
    setStateReady(true);
  }

  if (!stateReady) {
    return (
      <main className={`loading-state ${loadingExiting ? "loading-state-exiting" : ""}`} aria-busy="true">
        <section className="loading-state-card" aria-labelledby="loading-title">
          <div className="loading-logo-wrap">
            <div className="loading-orbit" aria-hidden="true">
              <span className="loading-orbit-track">
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
                <span className="loading-orbit-dot"></span>
              </span>
              <AppLogo />
            </div>
          </div>
          <div className="loading-state-copy">
            <p className="loading-kicker">Your workspace is almost ready</p>
            <h1 id="loading-title">Getting things in order</h1>
            <p className="loading-description" role="status" aria-live="polite">
              Waking up your workspace and loading your boards.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return <AuthPage mode={authMode} setMode={setAuthMode} onLogin={handleLogin} />;
  }

  return (
    <div className={`app-shell ${menuOpen ? "" : "menu-collapsed"}`}>
      <ThemeToggleButton theme={theme} setTheme={setTheme} />
      <Sidebar
        user={user}
        boards={boards}
        activeBoardId={activeBoard?.id}
        activeBoardTitle={activeBoard?.title || ""}
        setActiveBoardId={setActiveBoardId}
        createBoard={actions.createBoard}
        updateBoard={actions.updateBoard}
        deleteBoard={actions.deleteBoard}
        archiveItems={archiveItems}
        archiveActions={actions}
        logout={logout}
        closeMenu={() => {
          setMenuButtonVisible(false);
          setMenuOpen(false);
        }}
      />
      {!menuOpen && menuButtonVisible && (
        <button className="menu-open-button focus-ring" type="button" aria-label="Показать меню" onClick={() => setMenuOpen(true)}>
          <span aria-hidden="true"></span>
        </button>
      )}
      {activeBoard ? (
        <BoardView
          board={activeBoard}
          boards={boards}
          allColumns={visibleColumns}
          columns={visibleColumns.filter((column) => column.boardId === activeBoard.id).sort((a, b) => a.position - b.position)}
          cards={visibleCards}
          actions={actions}
        />
      ) : (
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="app-empty-state">
            <h1 className="text-xl font-bold">Нет досок</h1>
            <p className="mt-2 text-sm text-slate-500">Создайте доску в sidebar.</p>
          </div>
        </main>
      )}
    </div>
  );
}

export default App;
