/**
 * Vercel's cron format as its docs describe it: five numeric fields in UTC (minute 0-59, hour 0-23, day of month 1-31,
 * month 1-12, day of week 0-6 for Sunday to Saturday), no names such as MON or JAN, and day of month or day of week
 * left at *. A field is *, a number, a range a-b, a step (*\/n, a-b/n or a/n) or a comma list of those.
 */
export type CronField = "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";

export type CronIssue =
  | { kind: "fields"; count: number }
  | { kind: "names"; token: string }
  | { kind: "range"; field: CronField; value: number; min: number; max: number }
  | { kind: "syntax"; field: CronField; text: string }
  | { kind: "both-days" };

/** A valid expression keeps the minutes and hours it fires at; an invalid one says why Vercel does not accept it. */
export type CronSchedule = { issue: CronIssue } | { fields: string[]; minutes: number[]; hours: number[] };

const FIELDS: Array<{ name: CronField; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 6 },
];
const NAME = /^(?:sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;
const PART = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/;

/** The values one field matches, an issue, or null for a range that runs backwards (parsers disagree on those). */
function expand(text: string, field: (typeof FIELDS)[number]): number[] | CronIssue | null {
  const letters = /[a-z]+/i.exec(text);
  if (letters) return NAME.test(letters[0]) ? { kind: "names", token: letters[0] } : { kind: "syntax", field: field.name, text };
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = PART.exec(part);
    if (!match || Number(match[3]) === 0 || (match[1] === "*" && match[2] !== undefined)) return { kind: "syntax", field: field.name, text };
    for (const raw of [match[1], match[2]]) {
      if (raw === undefined || raw === "*") continue;
      const value = Number(raw);
      if (value < field.min || value > field.max) return { kind: "range", field: field.name, value, min: field.min, max: field.max };
    }
    const from = match[1] === "*" ? field.min : Number(match[1]);
    // A bare number is one value; with a step and no end (5/15) it runs to the end of the field.
    const to = match[2] !== undefined ? Number(match[2]) : match[1] === "*" || match[3] !== undefined ? field.max : from;
    if (from > to) return null;
    for (let value = from; value <= to; value += Number(match[3] ?? 1)) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

/** Reads one crons[].schedule from vercel.json. null when it cannot tell, so callers never report a guess. */
export function parseVercelCron(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== FIELDS.length) return { issue: { kind: "fields", count: fields.length } };
  const expanded: number[][] = [];
  for (const [index, field] of FIELDS.entries()) {
    const values = expand(fields[index], field);
    if (values === null) return null;
    if (!Array.isArray(values)) return { issue: values };
    expanded.push(values);
  }
  if (fields[2] !== "*" && fields[4] !== "*") return { issue: { kind: "both-days" } };
  return { fields, minutes: expanded[0], hours: expanded[1] };
}

/** Only minute and hour decide how many times a day a job fires; the day fields only pick the days. */
export function runsMoreThanOnceADay(schedule: { minutes: number[]; hours: number[] }): boolean {
  return schedule.minutes.length > 1 || schedule.hours.length > 1;
}

/** The same days at the first minute and hour the expression already uses: 0 9 * * 1-5 for *\/30 9-17 * * 1-5. */
export function dailyVersion(schedule: { fields: string[]; minutes: number[]; hours: number[] }): string {
  return [schedule.minutes[0], schedule.hours[0], ...schedule.fields.slice(2)].join(" ");
}
