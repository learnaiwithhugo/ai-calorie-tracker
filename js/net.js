// net.js — shared helper for calling this app's own /api/* endpoints with the passcode header
// (x-snapcal-token) attached, and prompting for the passcode on 401. Used by api.js (Gemini)
// and sync.js so the gate lives in exactly one place.

const TOKEN_KEY = "snapcal.apiToken";
const MAX_PASSCODE_ATTEMPTS = 5;

export function getStoredToken() {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token) {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    // best-effort only
  }
}

let promptInFlight = null;

/** De-duped: concurrent 401s from multiple calls share a single passcode prompt. */
function promptForPasscode(showError) {
  if (promptInFlight) return promptInFlight;
  promptInFlight = (async () => {
    const { openPasscodeSheet } = await import("./ui/passcode.js");
    return openPasscodeSheet(showError);
  })().finally(() => {
    promptInFlight = null;
  });
  return promptInFlight;
}

/**
 * Fetches a same-origin /api/* endpoint, attaching the stored passcode header. On 401, prompts
 * once for the passcode and retries (looping up to MAX_PASSCODE_ATTEMPTS on repeated wrong
 * entries); if the user cancels the prompt, resolves with the original 401 response so the
 * caller can treat it like any other failed request.
 */
export async function apiFetch(url, options = {}) {
  let attempt = 0;
  let res;
  while (attempt < MAX_PASSCODE_ATTEMPTS) {
    const headers = { ...(options.headers || {}), "x-snapcal-token": getStoredToken() };
    res = await fetch(url, { ...options, headers });
    if (res.status !== 401) return res;

    const submitted = await promptForPasscode(attempt > 0);
    if (!submitted) return res;
    attempt += 1;
  }
  return res;
}
