const http = require("http");

// Environment configuration
const IDENTITY_PORT = Number(process.env.IDENTITY_PORT) || 3001;
const CATALOG_PORT = Number(process.env.CATALOG_PORT) || 3003;

// In-memory stores
const usersById = new Map();
let userCounter = 1;
let assignmentCounter = 1;

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// Helper to send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Helper to extract path parameters
function matchPath(url, pattern) {
  const urlParts = url.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);

  if (urlParts.length !== patternParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// ============================================
// IDENTITY SERVICE (port 3001)
// ============================================
const identityServer = http.createServer(async (req, res) => {
  const { method } = req;
  const url = req.url.split("?")[0]; // Remove query string

  // GET /health
  if (method === "GET" && url === "/health") {
    sendJson(res, 200, { status: "ok", service: "identity-api-mock" });
    return;
  }

  // GET /users/:userId
  const getUserParams = matchPath(url, "/users/:userId");
  if (method === "GET" && getUserParams) {
    const { userId } = getUserParams;

    // Return 404 for users starting with "unknown"
    if (userId.startsWith("unknown")) {
      sendJson(res, 404, { error: "user not found" });
      return;
    }

    // Check in-memory store first
    if (usersById.has(userId)) {
      sendJson(res, 200, { user: usersById.get(userId) });
      return;
    }

    // Return mock user for any other userId
    sendJson(res, 200, {
      user: {
        id: userId,
        name: "Mock User",
        email: "mock@example.com",
      },
    });
    return;
  }

  // POST /users
  if (method === "POST" && url === "/users") {
    try {
      const body = await parseJsonBody(req);
      const { name, email } = body;

      if (!name || !email) {
        sendJson(res, 400, { error: "name and email are required" });
        return;
      }

      const id = `u${userCounter++}`;
      const user = { id, name, email };
      usersById.set(id, user);

      sendJson(res, 201, { user });
      return;
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
  }

  // Fallback 404
  sendJson(res, 404, { error: "Route not found", method, url });
});

// ============================================
// CATALOG SERVICE (port 3003)
// ============================================
const catalogServer = http.createServer(async (req, res) => {
  const { method } = req;
  const url = req.url.split("?")[0]; // Remove query string

  // GET /health
  if (method === "GET" && url === "/health") {
    sendJson(res, 200, { status: "ok", service: "catalog-api-mock" });
    return;
  }

  // POST /products/:productId/assign
  const assignParams = matchPath(url, "/products/:productId/assign");
  if (method === "POST" && assignParams) {
    const { productId } = assignParams;

    // Return 404 for products starting with "unknown"
    if (productId.startsWith("unknown")) {
      sendJson(res, 404, { error: "product not found" });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { accountId } = body;

      if (!accountId) {
        sendJson(res, 400, { error: "accountId is required" });
        return;
      }

      const assignment = {
        id: `as${assignmentCounter++}`,
        productId,
        accountId,
      };

      sendJson(res, 200, { assignment });
      return;
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
  }

  // Fallback 404
  sendJson(res, 404, { error: "Route not found", method, url });
});

// ============================================
// START SERVERS
// ============================================
identityServer.listen(IDENTITY_PORT, () => {
  console.log(`Identity API mock running on port ${IDENTITY_PORT}`);
});

catalogServer.listen(CATALOG_PORT, () => {
  console.log(`Catalog API mock running on port ${CATALOG_PORT}`);
});
