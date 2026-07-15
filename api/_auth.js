// api/_auth.js — shared passcode gate for serverless endpoints (Vercel skips files prefixed
// with "_" when building routes, so this never becomes its own endpoint). Env APP_TOKEN unset
// -> gate disabled (local dev). Both api/gemini.js and api/sync.js call checkAuth() first.

export function checkAuth(req, res) {
  const required = (process.env.APP_TOKEN || "").trim();
  if (required === "") return true; // no token configured -> allow (local dev)

  const provided = req.headers["x-snapcal-token"];
  if (provided === required) return true;

  res.status(401).json({ errorType: "unauthorized", message: "Invalid or missing passcode." });
  return false;
}
