const express = require("express");

const app = express();
app.use(express.json());

const IDENTITY_BASE_URL =
  process.env.IDENTITY_BASE_URL || "http://identity-api:3001";
const CATALOG_BASE_URL =
  process.env.CATALOG_BASE_URL || "http://catalog-api:3003";

const accountsById = new Map();
const accountsByUserId = new Map();
const balancesByAccountId = new Map();
let accountCounter = 1;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = new Error(data.error || res.statusText);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function ensureUserExists(userId) {
  const data = await fetchJson(
    `${IDENTITY_BASE_URL}/users/${encodeURIComponent(userId)}`
  );
  return data.user || data;
}

function createAccount({ userId, type }) {
  const id = `a${accountCounter++}`;
  const account = { id, userId, type, createdAt: new Date().toISOString() };
  accountsById.set(id, account);
  const existing = accountsByUserId.get(userId) || [];
  existing.push(account);
  accountsByUserId.set(userId, existing);
  balancesByAccountId.set(id, 0);
  return account;
}

function applyCredit(accountId, amount) {
  const current = balancesByAccountId.get(accountId) || 0;
  const next = current + amount;
  balancesByAccountId.set(accountId, next);
  return next;
}

/**
 * POST /accounts
 * Creates an account for an existing user.
 * Request body:
 * {
 *   "userId": "u123",
 *   "type": "standard" // optional, defaults to "standard"
 * }
 * Response 201:
 * {
 *   "account": {
 *     "id": "a1",
 *     "userId": "u123",
 *     "type": "standard",
 *     "createdAt": "2026-02-11T10:00:00.000Z"
 *   }
 * }
 * Errors:
 * 400 { "error": "userId is required" }
 * 4xx/5xx { "error": "<identity service error>" }
 */
app.post("/accounts", async (req, res) => {
  try {
    const { userId, type = "standard" } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    await ensureUserExists(userId);
    const account = createAccount({ userId, type });
    return res.status(201).json({ account });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

/**
 * GET /accounts/:id
 * Fetches an account by id along with its balance.
 * Response 200:
 * {
 *   "account": {
 *     "id": "a1",
 *     "userId": "u123",
 *     "type": "standard",
 *     "createdAt": "2026-02-11T10:00:00.000Z"
 *   },
 *   "balance": 42
 * }
 * Errors:
 * 404 { "error": "account not found" }
 */
app.get("/accounts/:id", (req, res) => {
  const account = accountsById.get(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "account not found" });
  }
  const balance = balancesByAccountId.get(account.id) || 0;
  return res.json({ account, balance });
});

/**
 * GET /accounts?userId=:userId
 * Lists accounts for a user.
 * Response 200:
 * {
 *   "accounts": [
 *     { "id": "a1", "userId": "u123", "type": "standard", "createdAt": "2026-02-11T10:00:00.000Z" }
 *   ]
 * }
 * Errors:
 * 400 { "error": "userId query is required" }
 */
app.get("/accounts", (req, res) => {
  const { userId } = req.query || {};
  if (!userId) {
    return res.status(400).json({ error: "userId query is required" });
  }
  const accounts = accountsByUserId.get(userId) || [];
  return res.json({ accounts });
});

/**
 * POST /accounts/:id/credit
 * Applies a credit to an account balance (positive or negative).
 * Request body:
 * { "amount": 25 }
 * Response 200:
 * { "accountId": "a1", "balance": 67 }
 * Errors:
 * 400 { "error": "amount must be a number" }
 * 404 { "error": "account not found" }
 */
app.post("/accounts/:id/credit", (req, res) => {
  const account = accountsById.get(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "account not found" });
  }
  const { amount } = req.body || {};
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return res.status(400).json({ error: "amount must be a number" });
  }
  const balance = applyCredit(account.id, amount);
  return res.json({ accountId: account.id, balance });
});

/**
 * POST /accounts/onboard
 * Creates a user, creates an account, optionally credits it,
 * and assigns a product via the catalog service.
 * Request body:
 * {
 *   "name": "Ada Lovelace",
 *   "email": "ada@example.com",
 *   "productId": "p123",
 *   "initialCredit": 100 // optional, defaults to 0
 * }
 * Response 201:
 * {
 *   "user": { "id": "u123", "name": "Ada Lovelace", "email": "ada@example.com" },
 *   "account": { "id": "a1", "userId": "u123", "type": "standard", "createdAt": "2026-02-11T10:00:00.000Z" },
 *   "assignment": { "id": "as1", "productId": "p123", "accountId": "a1" },
 *   "balance": 100
 * }
 * Errors:
 * 400 { "error": "name, email, and productId are required" }
 * 4xx/5xx { "error": "<identity/catalog service error>" }
 */
app.post("/accounts/onboard", async (req, res) => {
  try {
    const { name, email, productId, initialCredit = 0 } = req.body || {};
    if (!name || !email || !productId) {
      return res
        .status(400)
        .json({ error: "name, email, and productId are required" });
    }

    const userResponse = await fetchJson(`${IDENTITY_BASE_URL}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const user = userResponse.user || userResponse;

    const account = createAccount({ userId: user.id, type: "standard" });
    if (typeof initialCredit === "number" && !Number.isNaN(initialCredit)) {
      applyCredit(account.id, initialCredit);
    }

    const assignmentResponse = await fetchJson(
      `${CATALOG_BASE_URL}/products/${encodeURIComponent(productId)}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id }),
      }
    );

    const balance = balancesByAccountId.get(account.id) || 0;
    return res.status(201).json({
      user,
      account,
      assignment: assignmentResponse.assignment || assignmentResponse,
      balance,
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

/**
 * GET /health
 * Basic service health check.
 * Response 200:
 * { "status": "ok", "service": "accounts-api" }
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "accounts-api" });
});

const port = Number(process.env.PORT) || 3002;
app.listen(port, () => {
  console.log(`accounts-api listening on port ${port}`);
});
