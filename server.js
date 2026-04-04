const express = require("express");
const { Pool } = require("pg");
const Redis = require("ioredis");
const cheerio = require("cheerio");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

const DATABASE_URL = process.env.DATABASE_URL || "";
const REDIS_URL = process.env.REDIS_URL || "";
const BROWSER_WORKER_URL = process.env.BROWSER_WORKER_URL || "";
const RESEARCH_API_KEY = process.env.RESEARCH_API_KEY || "";

const pool = DATABASE_URL
? new Pool({
connectionString: DATABASE_URL,
ssl: { rejectUnauthorized: false }
})
: null;

const redis = REDIS_URL
? new Redis(REDIS_URL, {
maxRetriesPerRequest: 1
})
: null;

async function ensureTables() {
if (!pool) return;

await pool.query(`
CREATE TABLE IF NOT EXISTS research_reports (
id SERIAL PRIMARY KEY,
query TEXT NOT NULL,
source_url TEXT,
title TEXT,
content TEXT,
created_at TIMESTAMP DEFAULT NOW()
)
`);
}

app.use((req, res, next) => {
if (!RESEARCH_API_KEY) {
return next();
}

if (req.path === "/" || req.path === "/health") {
return next();
}

const authHeader = req.headers.authorization || "";
const token = authHeader.startsWith("Bearer ")
? authHeader.slice("Bearer ".length)
: "";

if (token !== RESEARCH_API_KEY) {
return res.status(401).json({
ok: false,
error: "Unauthorized"
});
}

next();
});

app.get("/", (req, res) => {
res.json({
ok: true,
service: "research-api",
endpoints: ["/health", "/search?q=...", "/extract?url=..."]
});
});

app.get("/health", async (req, res) => {
const status = {
ok: true,
service: "research-api",
postgres: false,
redis: false,
browserWorkerConfigured: Boolean(BROWSER_WORKER_URL),
authEnabled: Boolean(RESEARCH_API_KEY)
};

try {
if (pool) {
await pool.query("SELECT 1");
status.postgres = true;
}
} catch (error) {
status.ok = false;
}

try {
if (redis) {
await redis.ping();
status.redis = true;
}
} catch (error) {
status.ok = false;
}

res.json(status);
});

async function runWebSearch(query) {
const searchUrl =
"https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);

const response = await fetch(searchUrl, {
headers: {
"user-agent": "Mozilla/5.0 (compatible; research-api/1.0)"
}
});

if (!response.ok) {
throw new Error("Search upstream failed with status " + response.status);
}

const html = await response.text();
const $ = cheerio.load(html);
const results = [];

$(".result").each((_, el) => {
const title = $(el).find(".result__title a").first().text().trim();
const url = $(el).find(".result__title a").first().attr("href") || "";
const snippet = $(el).find(".result__snippet").first().text().trim();

if (title && url) {
results.push({
title,
url,
snippet
});
}
});

return results.slice(0, 10);
}

app.get("/search", async (req, res) => {
try {
const q = String(req.query.q || "").trim();

if (!q) {
return res.status(400).json({
ok: false,
error: "Missing query parameter: q"
});
}

const cacheKey = "search:" + q.toLowerCase();

if (redis) {
const cached = await redis.get(cacheKey);
if (cached) {
const parsed = JSON.parse(cached);
return res.json({
ok: true,
query: q,
count: parsed.length,
results: parsed,
cached: true
});
}
}

const results = await runWebSearch(q);

if (redis) {
await redis.set(cacheKey, JSON.stringify(results), "EX", 3600);
}

res.json({
ok: true,
query: q,
count: results.length,
results
});
} catch (error) {
res.status(500).json({
ok: false,
error: error.message
});
}
});

app.get("/extract", async (req, res) => {
try {
const targetUrl = String(req.query.url || "").trim();

if (!targetUrl) {
return res.status(400).json({
ok: false,
error: "Missing query parameter: url"
});
}

if (!BROWSER_WORKER_URL) {
return res.status(500).json({
ok: false,
error: "BROWSER_WORKER_URL is not configured"
});
}

const response = await fetch(BROWSER_WORKER_URL + "/extract", {
method: "POST",
headers: {
"content-type": "application/json"
},
body: JSON.stringify({ url: targetUrl })
});

const data = await response.json();

if (!response.ok || !data.ok) {
return res.status(502).json({
ok: false,
error: data.error || "Browser worker extract failed"
});
}

if (pool) {
await pool.query(
`
INSERT INTO research_reports (query, source_url, title, content)
VALUES ($1, $2, $3, $4)
`,
["extract", data.finalUrl || targetUrl, data.title || "", data.content || ""]
);
}

res.json(data);
} catch (error) {
res.status(500).json({
ok: false,
error: error.message
});
}
});

async function start() {
try {
await ensureTables();
app.listen(PORT, () => {
console.log("research-api listening on " + PORT);
});
} catch (error) {
console.error("Startup error:", error);
process.exit(1);
}
}

start();
