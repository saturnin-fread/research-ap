const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
res.json({
ok: true,
service: "research-api",
endpoints: ["/health", "/search?q=chatgpt", "/extract?url=https://example.com"]
});
});

app.get("/health", (req, res) => {
res.json({ ok: true });
});

app.get("/search", async (req, res) => {
try {
const q = String(req.query.q || "").trim();

if (!q) {
return res.status(400).json({
ok: false,
error: "Missing query parameter: q"
});
}

const apiUrl =
"https://api.duckduckgo.com/?q=" +
encodeURIComponent(q) +
"&format=json&no_html=1&skip_disambig=1";

const response = await fetch(apiUrl, {
headers: {
"user-agent": "research-api/1.0"
}
});

if (!response.ok) {
return res.status(502).json({
ok: false,
error: "Upstream search failed with status " + response.status
});
}

const data = await response.json();
const results = [];

if (data.AbstractURL) {
results.push({
title: data.Heading || q,
url: data.AbstractURL,
snippet: data.AbstractText || ""
});
}

for (const item of data.RelatedTopics || []) {
if (item.FirstURL && item.Text) {
results.push({
title: item.Text.split(" - ")[0],
url: item.FirstURL,
snippet: item.Text
});
}

if (Array.isArray(item.Topics)) {
for (const sub of item.Topics) {
if (sub.FirstURL && sub.Text) {
results.push({
title: sub.Text.split(" - ")[0],
url: sub.FirstURL,
snippet: sub.Text
});
}
}
}
}

res.json({
ok: true,
query: q,
count: results.length,
results: results.slice(0, 10)
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

let parsedUrl;
try {
parsedUrl = new URL(targetUrl);
} catch (e) {
return res.status(400).json({
ok: false,
error: "Invalid URL"
});
}

if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
return res.status(400).json({
ok: false,
error: "Only http and https URLs are allowed"
});
}

const response = await fetch(parsedUrl.toString(), {
headers: {
"user-agent": "Mozilla/5.0 (compatible; research-api/1.0)"
}
});

if (!response.ok) {
return res.status(502).json({
ok: false,
error: "Upstream fetch failed with status " + response.status
});
}

const html = await response.text();

const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

const content = html
.replace(/<script[\s\S]*?<\/script>/gi, " ")
.replace(/<style[\s\S]*?<\/style>/gi, " ")
.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
.replace(/<[^>]+>/g, " ")
.replace(/&nbsp;/gi, " ")
.replace(/&amp;/gi, "&")
.replace(/&lt;/gi, "<")
.replace(/&gt;/gi, ">")
.replace(/&quot;/gi, '"')
.replace(/&#39;/gi, "'")
.replace(/\s+/g, " ")
.trim()
.slice(0, 12000);

res.json({
ok: true,
url: parsedUrl.toString(),
title: title,
content: content
});
} catch (error) {
res.status(500).json({
ok: false,
error: error.message
});
}
});

app.listen(PORT, () => {
console.log("research-api listening on " + PORT);
});
