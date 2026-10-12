// When the owned-ads sync runs: listed Bangkok times ("09:00,13:00,18:00"). Pure, for the loop and its tests.
const BANGKOK = 7 * 3600_000;

/** "09:00, 13:00" → ["09:00", "13:00"]; null when any entry is not HH:MM. */
export function parseTimes(text) {
  const times = String(text ?? "").split(",").map((time) => time.trim()).filter(Boolean);
  return times.length && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ? times : null;
}

/** The first listed Bangkok time strictly after `now`. */
export function nextRun(times, now = new Date()) {
  const day = new Date(now.getTime() + BANGKOK);
  const candidates = times.flatMap((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return [0, 1].map((ahead) => Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + ahead, hour, minute) - BANGKOK);
  });
  return new Date(Math.min(...candidates.filter((at) => at > now.getTime())));
}
