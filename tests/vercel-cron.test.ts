import assert from "node:assert/strict";
import test from "node:test";
import { analysisText } from "../src/lib/analysis-text";
import { guideBySlug } from "../src/lib/guides";
import { dailyVersion, parseVercelCron, runsMoreThanOnceADay, type CronIssue } from "../src/lib/vercel-cron";

const valid = (expression: string) => {
  const schedule = parseVercelCron(expression);
  assert.ok(schedule && !("issue" in schedule), expression);
  return schedule;
};
const issue = (expression: string) => {
  const schedule = parseVercelCron(expression);
  assert.ok(schedule && "issue" in schedule, expression);
  return schedule.issue;
};

test("daily, weekly and monthly schedules run at most once a day", () => {
  for (const expression of ["0 5 * * *", "0 0 * * *", "30 23 * * 1-5", "0 5 1 * *", "0 5 * 1-6 *", "59 23 31 12 *", "0 5 * * 0", "  0   5 * * *  ", "05 09 * * *"]) {
    assert.equal(runsMoreThanOnceADay(valid(expression)), false, expression);
  }
});

test("schedules where the minute or hour field matches more than one value run more than once a day", () => {
  for (const expression of ["* * * * *", "0 * * * *", "*/30 * * * *", "0 */6 * * *", "0 9-17 * * *", "0,30 5 * * *", "0 5,17 * * *", "5/15 5 * * *", "0 5-6 * * 1"]) {
    assert.equal(runsMoreThanOnceADay(valid(expression)), true, expression);
  }
});

test("the daily version keeps the days and the first minute and hour", () => {
  assert.equal(dailyVersion(valid("*/30 9-17 * * 1-5")), "0 9 * * 1-5");
  assert.equal(dailyVersion(valid("*/15 * * * *")), "0 0 * * *");
  assert.equal(dailyVersion(valid("15,45 */4 1 * *")), "15 0 1 * *");
});

test("expressions outside Vercel's cron format", () => {
  assert.deepEqual(issue("0 5 * *"), { kind: "fields", count: 4 });
  assert.deepEqual(issue("0 2 * * * *"), { kind: "fields", count: 6 });
  assert.deepEqual(issue("@daily"), { kind: "fields", count: 1 });
  assert.deepEqual(issue("60 5 * * *"), { kind: "range", field: "minute", value: 60, min: 0, max: 59 });
  assert.deepEqual(issue("0 24 * * *"), { kind: "range", field: "hour", value: 24, min: 0, max: 23 });
  assert.deepEqual(issue("0 5 0 * *"), { kind: "range", field: "dayOfMonth", value: 0, min: 1, max: 31 });
  assert.deepEqual(issue("0 5 * 13 *"), { kind: "range", field: "month", value: 13, min: 1, max: 12 });
  assert.deepEqual(issue("0 5 * * 7"), { kind: "range", field: "dayOfWeek", value: 7, min: 0, max: 6 });
  assert.deepEqual(issue("0 0-60 * * *"), { kind: "range", field: "hour", value: 60, min: 0, max: 23 });
  assert.deepEqual(issue("0 5 * * MON-FRI"), { kind: "names", token: "MON" });
  assert.deepEqual(issue("0 5 * jan *"), { kind: "names", token: "jan" });
  assert.deepEqual(issue("0 5 1 * 1"), { kind: "both-days" });
  assert.deepEqual(issue("0 5 */2 * 1-5"), { kind: "both-days" });
  assert.deepEqual(issue("*/0 5 * * *"), { kind: "syntax", field: "minute", text: "*/0" });
  assert.deepEqual(issue("0 5 ? * *"), { kind: "syntax", field: "dayOfMonth", text: "?" });
  assert.deepEqual(issue("0 5 L * *"), { kind: "syntax", field: "dayOfMonth", text: "L" });
  assert.deepEqual(issue("0 1,,2 * * *"), { kind: "syntax", field: "hour", text: "1,,2" });
});

test("a range that runs backwards is left alone instead of guessed at", () => {
  assert.equal(parseVercelCron("0 22-2 * * *"), null);
});

test("the cron and functions copy exists in English and Swedish and keeps the copy rules", () => {
  const issues: CronIssue[] = [{ kind: "fields", count: 6 }, { kind: "names", token: "MON" }, { kind: "range", field: "hour", value: 24, min: 0, max: 23 },
    { kind: "syntax", field: "minute", text: "*/0" }, { kind: "both-days" }];
  const copy = (lang: "en" | "sv") => {
    const text = analysisText(lang).build;
    return [text.cronHobby("*/5 * * * *", "/api/sync"), text.cronHobby("*/5 * * * *"), text.cronHobbyFix("0 5 * * *"),
      ...issues.map((item) => text.cronInvalid("0 5 * * *", text.cronReason(item), "/api/sync")), text.cronInvalidFix,
      text.cronCount(101), text.cronCountFix, text.maxDuration("api/report.ts", 600), text.maxDurationFix, text.memory("api/big.ts"), text.memoryFix];
  };
  const [en, sv] = [copy("en"), copy("sv")];
  en.forEach((text, index) => assert.notEqual(text, sv[index], text));
  for (const text of [...en, ...sv]) assert.doesNotMatch(text, /[\u2013\u2014"\u201c\u201d\u201e]/, text);
  const guide = guideBySlug("vercel-hobby-cron-more-than-once-a-day");
  assert.ok(guide);
  for (const text of [guide.title, guide.description, ...guide.sections.flatMap((section) => [section.heading, ...section.body])]) {
    assert.doesNotMatch(text, /[\u2013\u2014"\u201c\u201d\u201e]/, text);
  }
});
