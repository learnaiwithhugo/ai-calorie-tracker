// numeric-field.js — shared "can't delete the last digit" numeric input behavior
// (SPEC-UI.md §13). Local string buffer decoupled from the model; the model is only ever
// touched on a successful commit (blur, or Enter), never mid-keystroke, so a full screen
// re-render triggered by a store change can never steal focus out from under the user's typing.
//
// Formatting rule on (re)sync: integers display as plain integers; decimal-capable fields round
// to 1 decimal place and drop a trailing ".0".

/** Formats a numeric model value for display, per §13's resync formatting rule. */
export function formatNumeric(value, { decimal = true } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (!decimal) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(1));
}

/** Parses a user-typed buffer, accepting both "." and "," as decimal separators. Returns null if unparsable. */
export function parseNumeric(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed.endsWith(".")) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wires up an <input> for commit-on-blur numeric editing.
 * @param {HTMLInputElement} inputEl
 * @param {{getValue:() => number, decimal?:boolean, min?:number, max?:number, onCommit:(n:number) => void}} opts
 */
export function wireNumericInput(inputEl, { getValue, decimal = true, min = 0, max = Infinity, onCommit }) {
  inputEl.value = formatNumeric(getValue(), { decimal });
  inputEl.inputMode = decimal ? "decimal" : "numeric";

  const commit = () => {
    const parsed = parseNumeric(inputEl.value);
    if (parsed === null) {
      inputEl.value = formatNumeric(getValue(), { decimal });
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onCommit(clamped);
    inputEl.value = formatNumeric(clamped, { decimal });
  };

  inputEl.addEventListener("blur", commit);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      inputEl.blur();
    }
  });

  return {
    /** Re-syncs the displayed buffer from the model — call only when the field is NOT focused. */
    resync() {
      if (document.activeElement === inputEl) return;
      inputEl.value = formatNumeric(getValue(), { decimal });
    },
  };
}
