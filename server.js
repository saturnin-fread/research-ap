const express = require("express");
const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
res.json({ ok: true });
});

app.post("/search", (req, res) => {
res.json({ ok: true, message: "search endpoint ready" });
});

app.post("/extract", (req, res) => {
res.json({ ok: true, message: "extract endpoint ready" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`research-api listening on ${PORT}`);
});
