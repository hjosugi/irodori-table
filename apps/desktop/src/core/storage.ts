/**
 * Parse a value read from web storage as a number, distinguishing "nothing
 * stored" from "zero stored".
 *
 * `Number(null)` is `0` and `Number.isFinite(0)` is true, so the obvious
 * `Number(getItem(...))` + isFinite guard silently converts an absent key into
 * a stored zero. That one conversion has now shipped twice: query history
 * recorded nothing on every fresh profile because its retention clamped to 0
 * (#114), and the results memory budget started at the clamp minimum of 1,000
 * instead of its 10,000 default (#166). Returns null for absent, empty, or
 * non-numeric input so the caller's fallback actually applies.
 */
export function parseStoredNumber(
  raw: string | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
