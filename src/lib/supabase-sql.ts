/**
 * Reads Supabase migrations in order and works out, per table in the public schema, whether row level security is on
 * and whether the Data API roles were granted access. Static text analysis only: nothing is executed.
 */

export const MIGRATION_FILE = /(?:^|\/)supabase\/migrations\/[^/]+\.sql$/i;

const DATA_API_ROLES = new Set(["anon", "authenticated", "service_role", "public"]);
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const NAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;

export type TableState = { name: string; file: string; line: number; rls: boolean; granted: boolean };
export type OpenPolicy = { policy: string; table: string; command: string; file: string; line: number };
export type MigrationAudit = { tables: TableState[]; openPolicies: OpenPolicy[] };

/** Blanks out comments and dollar-quoted bodies, keeping every newline so line numbers stay right. */
export function stripSql(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "-" && next === "-") {
      while (index < source.length && source[index] !== "\n") { out += " "; index += 1; }
      if (index < source.length) out += "\n";
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop - 1;
    } else if (char === "'") {
      // String literals are kept, but scanned to their end so a quote inside cannot open a comment.
      let stop = index + 1;
      while (stop < source.length && !(source[stop] === "'" && source[stop + 1] !== "'")) stop += source[stop] === "'" ? 2 : 1;
      out += source.slice(index, stop + 1);
      index = stop;
    } else if (char === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(source.slice(index))?.[0];
      const end = tag ? source.indexOf(tag, index + tag.length) : -1;
      if (!tag || end === -1) { out += char; continue; }
      const stop = end + tag.length;
      out += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop - 1;
    } else {
      out += char;
    }
  }
  return out;
}

function unquote(part: string): string {
  return part.startsWith('"') ? part.slice(1, -1).replaceAll('""', '"') : part.toLowerCase();
}

/** public.x, "public"."x" and plain x all become x when they are in public; other schemas return null. */
export function publicTable(raw: string): string | null {
  const parts = raw.match(new RegExp(IDENT, "g"))?.map(unquote) ?? [];
  if (parts.length === 2) return parts[0] === "public" ? parts[1] : null;
  return parts[0] ?? null;
}

function lineAt(source: string, index: number) { return source.slice(0, index).split("\n").length; }

function rolesOf(list: string) {
  return list.split(",").map((role) => unquote(role.trim()));
}

/** Replays the migrations in file order. Files must be passed in the order Supabase applies them. */
export function auditMigrations(files: Array<{ file: string; source: string }>): MigrationAudit {
  const tables = new Map<string, TableState>();
  const openPolicies: OpenPolicy[] = [];
  let defaultGrant = false;

  for (const { file, source } of files) {
    const sql = stripSql(source);
    for (const match of sql.matchAll(/[^;]+/g)) {
      const statement = match[0].replace(/\s+/g, " ").trim();
      if (!statement) continue;
      const line = lineAt(sql, match.index + (match[0].length - match[0].trimStart().length));

      let found = new RegExp(String.raw`^create (?:(?:global |local )?(?:temp|temporary) )?(unlogged )?table (?:if not exists )?${NAME}`, "i").exec(statement);
      if (found && !/^create (?:global |local )?temp/i.test(statement)) {
        const name = publicTable(found[2]);
        if (name && !tables.has(name)) tables.set(name, { name, file, line, rls: false, granted: defaultGrant });
        continue;
      }
      found = /^drop table (?:if exists )?(.+?)(?: cascade| restrict)?$/i.exec(statement);
      if (found) {
        for (const raw of found[1].split(",")) { const name = publicTable(raw.trim()); if (name) tables.delete(name); }
        continue;
      }
      found = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?${NAME} (.*)$`, "i").exec(statement);
      if (found) {
        const name = publicTable(found[1]);
        const table = name ? tables.get(name) : undefined;
        const action = found[2];
        const renamed = new RegExp(String.raw`^rename to (${IDENT})`, "i").exec(action);
        if (table && renamed) {
          tables.delete(table.name);
          const next = unquote(renamed[1]);
          tables.set(next, { ...table, name: next });
        } else if (table && /\b(?:enable|force) row level security\b/i.test(action)) {
          table.rls = true;
        } else if (table && /\bdisable row level security\b/i.test(action)) {
          table.rls = false;
        }
        continue;
      }
      found = /^grant (.+?) on all tables in schema (.+?) to (.+?)(?: with grant option)?$/i.exec(statement);
      if (found) {
        if (rolesOf(found[3]).some((role) => DATA_API_ROLES.has(role)) && rolesOf(found[2]).includes("public")) {
          for (const table of tables.values()) table.granted = true;
        }
        continue;
      }
      found = /^grant (.+?) on (?:table )?(.+?) to (.+?)(?: with grant option)?$/i.exec(statement);
      if (found && !/^(?:schema|function|procedure|routine|sequence|all (?:functions|sequences|procedures|routines))\b/i.test(found[2])) {
        if (rolesOf(found[3]).some((role) => DATA_API_ROLES.has(role))) {
          for (const raw of found[2].split(",")) { const table = tables.get(publicTable(raw.trim()) ?? ""); if (table) table.granted = true; }
        }
        continue;
      }
      found = /^alter default privileges (.*?)in schema (.+?) (grant|revoke) (.+?) on tables (?:to|from) (.+)$/i.exec(statement);
      if (found && rolesOf(found[2]).includes("public") && rolesOf(found[5]).some((role) => DATA_API_ROLES.has(role))) {
        defaultGrant = found[3].toLowerCase() === "grant";
        continue;
      }
      found = new RegExp(String.raw`^create policy (${IDENT}) on ${NAME}(.*)$`, "i").exec(statement);
      if (found) {
        const table = publicTable(found[2]);
        const rest = found[3];
        const command = /\bfor (all|select|insert|update|delete)\b/i.exec(rest)?.[1].toLowerCase() ?? "all";
        const roles = /\bto (.+?)(?= using\b| with check\b|$)/i.exec(rest)?.[1];
        const forAnyone = !roles || rolesOf(roles).some((role) => role === "anon" || role === "public");
        const usingTrue = /\busing \(\s*true\s*\)/i.test(rest);
        const checkTrue = /\bwith check \(\s*true\s*\)/i.test(rest);
        // A public read policy (select using true) is usually on purpose; writes open to anyone are not.
        if (table && forAnyone && (checkTrue || (usingTrue && command !== "select"))) {
          openPolicies.push({ policy: unquote(found[1]), table, command, file, line });
        }
      }
    }
  }
  return { tables: [...tables.values()], openPolicies };
}

/** The grants Supabase's documentation shows for a table the Data API should reach. */
export function grantSql(table: string): string {
  const name = /^[a-z_][a-z0-9_$]*$/.test(table) ? table : `"${table.replaceAll('"', '""')}"`;
  return [
    `grant select on table public.${name} to anon;`,
    `grant select, insert, update, delete on table public.${name} to authenticated;`,
    `grant select, insert, update, delete on table public.${name} to service_role;`,
  ].join("\n");
}
