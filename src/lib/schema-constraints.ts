import type { RepositorySnapshot } from "@/lib/analyzer";
import { MIGRATION_FILE } from "@/lib/supabase-sql";

/**
 * Unique keys and SQL functions visible in the snapshot: Prisma schemas and Supabase SQL migrations.
 * Only files already in the scan are read. Expression or partial unique indexes are not treated as keys,
 * because which rows they cover cannot be established statically.
 */
export type TableKeys = { name: string; uniques: string[][]; source: string; kind: "prisma" | "sql" };
export type SqlFunction = { name: string; params: string[]; body: string; file: string; line: number };
export type Uniqueness = { state: "unique"; columns: string[]; source: string } | { state: "not-unique"; source: string } | { state: "unknown"; reason: string };

const bare = (identifier: string) => identifier.replace(/"/g, "").split(".").pop()!.toLowerCase();
const PRISMA_MODEL = /\bmodel\s+(\w+)\s*\{([\s\S]*?)\n\s*\}/g;

/** Removes -- and block comments outside quoted strings; dollar-quoted function bodies keep their code. */
export function stripSqlComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop); i = stop - 1; continue;
    }
    if (char === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; out += "\n"; continue; }
    if (char === "/" && sql[i + 1] === "*") { const end = sql.indexOf("*/", i + 2); const stop = end === -1 ? sql.length : end + 2; out += sql.slice(i, stop).replace(/[^\n]/g, " "); i = stop - 1; continue; }
    out += char;
  }
  return out;
}

/** Splits on top-level `;`, respecting quotes and dollar-quoted bodies. Each statement keeps its starting offset. */
export function splitSql(sql: string): Array<{ text: string; offset: number }> {
  const statements: Array<{ text: string; offset: number }> = [];
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") { const end = sql.indexOf("'", i + 1); i = end === -1 ? sql.length : end; continue; }
    if (sql[i] === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) { const end = sql.indexOf(tag, i + tag.length); i = end === -1 ? sql.length : end + tag.length - 1; continue; }
    }
    if (sql[i] === ";") { statements.push({ text: sql.slice(start, i), offset: start }); start = i + 1; }
  }
  if (sql.slice(start).trim()) statements.push({ text: sql.slice(start), offset: start });
  return statements;
}

/** Top-level comma split of a parenthesised list body. */
export function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0, quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") quote = !quote;
    if (quote) continue;
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && text.startsWith(separator, i)) { parts.push(text.slice(start, i)); start = i + separator.length; i += separator.length - 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

/** The body of the balanced parenthesis group that opens at `open`, and where it ends. */
export function balanced(text: string, open: number): { body: string; end: number } | undefined {
  if (text[open] !== "(") return undefined;
  let depth = 0, quote = false;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") quote = !quote;
    if (quote) continue;
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  return undefined;
}

const columnList = (text: string): string[] | undefined => {
  const columns = splitTopLevel(text).map(column => column.replace(/\s+(?:asc|desc|nulls\s+(?:first|last))\b.*$/i, "").trim());
  // An expression index (lower(email)) is not a plain column key.
  return columns.every(column => /^"?[\w]+"?$/.test(column)) ? columns.map(bare) : undefined;
};

export class ConstraintIndex {
  private readonly tables = new Map<string, TableKeys>();
  readonly functions = new Map<string, SqlFunction>();
  /** Schema or migration files that are in the tree but were not read. */
  readonly unreadSchemaFiles: string[] = [];
  readonly schemaSources: string[] = [];

  constructor(snapshot: RepositorySnapshot) {
    for (const entry of snapshot.entries) {
      if (entry.type === "blob" && (/\.prisma$/.test(entry.path) || MIGRATION_FILE.test(entry.path)) && !snapshot.contents.has(entry.path)) this.unreadSchemaFiles.push(entry.path);
    }
    const files = [...snapshot.contents.keys()].sort();
    for (const file of files) {
      const text = snapshot.contents.get(file)!;
      if (/\.prisma$/.test(file)) { this.schemaSources.push(file); this.readPrisma(file, text); }
      else if (MIGRATION_FILE.test(file)) { this.schemaSources.push(file); this.readSql(file, text); }
    }
  }

  private table(name: string, source: string, kind: TableKeys["kind"]) {
    const key = name.toLowerCase();
    if (!this.tables.has(key)) this.tables.set(key, { name, uniques: [], source, kind });
    return this.tables.get(key)!;
  }

  private readPrisma(file: string, text: string) {
    const code = text.replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(PRISMA_MODEL)) {
      const uniques: string[][] = [];
      let mapped: string | undefined;
      for (const raw of match[2].split("\n")) {
        const line = raw.trim();
        const block = /^@@(unique|id)\s*\(\s*(?:fields\s*:\s*)?\[([^\]]*)\]/.exec(line);
        if (block) { uniques.push(block[2].split(",").map(column => column.replace(/\(.*$/, "").trim().toLowerCase()).filter(Boolean)); continue; }
        const map = /^@@map\(\s*"([^"]+)"\s*\)/.exec(line);
        if (map) { mapped = map[1]; continue; }
        const field = /^(\w+)\s+[\w.]+(?:\[\])?\??\s*(.*)$/.exec(line);
        if (field && /@(?:id|unique)\b/.test(field[2])) uniques.push([field[1].toLowerCase()]);
      }
      for (const name of [match[1], ...(mapped ? [mapped] : [])]) {
        const table = this.table(name, file, "prisma");
        table.uniques.push(...uniques);
      }
    }
  }

  private readSql(file: string, text: string) {
    const code = stripSqlComments(text);
    for (const { text: statement, offset } of splitSql(code)) {
      const s = statement.trim();
      const create = /^create\s+(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*/i.exec(s);
      if (create) {
        const group = balanced(s, create[0].length);
        if (!group) continue;
        const table = this.table(bare(create[1]), file, "sql");
        for (const item of splitTopLevel(group.body)) {
          const body = item.replace(/^constraint\s+[\w"]+\s+/i, "");
          const tableKey = /^(?:primary\s+key|unique(?:\s+nulls\s+(?:not\s+)?distinct)?)\s*\(([^)]*)\)/i.exec(body);
          if (tableKey) { const columns = columnList(tableKey[1]); if (columns) table.uniques.push(columns); continue; }
          if (/^(?:check|foreign\s+key|exclude|like)\b/i.test(body)) continue;
          const column = /^"?(\w+)"?\s+([\s\S]*)$/.exec(body);
          if (column && /\b(?:primary\s+key|unique)\b/i.test(column[2])) table.uniques.push([column[1].toLowerCase()]);
        }
        continue;
      }
      const index = /^create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:[\w."]+\s+)?on\s+(?:only\s+)?([\w."]+)\s*(?:using\s+\w+\s*)?/i.exec(s);
      if (index) {
        const group = balanced(s, index[0].length);
        if (!group || /\bwhere\b/i.test(s.slice(group.end))) continue;
        const columns = columnList(group.body);
        if (columns) this.table(bare(index[1]), file, "sql").uniques.push(columns);
        continue;
      }
      const alter = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([\s\S]*)$/i.exec(s);
      if (alter) {
        for (const action of splitTopLevel(alter[2])) {
          const key = /^add\s+(?:constraint\s+[\w"]+\s+)?(?:primary\s+key|unique(?:\s+nulls\s+(?:not\s+)?distinct)?)\s*\(([^)]*)\)/i.exec(action);
          const columns = key && columnList(key[1]);
          if (columns) this.table(bare(alter[1]), file, "sql").uniques.push(columns);
          const column = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+([\s\S]*)$/i.exec(action);
          if (!key && column && /\b(?:primary\s+key|unique)\b/i.test(column[2])) this.table(bare(alter[1]), file, "sql").uniques.push([column[1].toLowerCase()]);
        }
        continue;
      }
      const fn = /^create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(/i.exec(s);
      if (fn) {
        const params = balanced(s, fn[0].length - 1);
        const body = /\bas\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(s);
        if (!params || !body) continue;
        const names = splitTopLevel(params.body).map(param => param.replace(/^(?:in|out|inout|variadic)\s+/i, "").split(/\s+/)[0].replace(/"/g, "").toLowerCase());
        // The line where the function body starts, so statements inside it get their own line numbers.
        const lead = statement.length - statement.trimStart().length;
        const line = code.slice(0, offset + lead + body.index + body[1].length).split("\n").length;
        this.functions.set(bare(fn[1]), { name: bare(fn[1]), params: names, body: body[2], file, line });
      }
    }
  }

  /** Prisma model or SQL table, matched without schema prefix and case. */
  keys(name: string | undefined): TableKeys | undefined {
    return name ? this.tables.get(name.toLowerCase()) : undefined;
  }

  /**
   * Whether the columns a write provides cover a unique key that includes `required` (for example the event ID column).
   * A composite key only counts when every one of its columns is provided.
   */
  uniqueness(target: string | undefined, provided: string[], required: string[]): Uniqueness {
    const table = this.keys(target);
    if (!table) {
      const unread = this.unreadSchemaFiles.length ? ` (${this.unreadSchemaFiles.length} schema or migration file${this.unreadSchemaFiles.length === 1 ? " was" : "s were"} not read)` : "";
      return { state: "unknown", reason: target ? `${target} is not defined in the Prisma schema or Supabase migrations read${unread}` : "the table or model could not be identified" };
    }
    const have = new Set(provided.map(column => column.toLowerCase()));
    const need = required.map(column => column.toLowerCase());
    const key = table.uniques.find(columns => columns.every(column => have.has(column)) && need.some(column => columns.includes(column)));
    return key ? { state: "unique", columns: key, source: table.source } : { state: "not-unique", source: table.source };
  }
}
