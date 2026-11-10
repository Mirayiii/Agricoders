// Integration check: every server function and table column the app asks for
// exists in a database built from the migrations, with the argument names the
// app sends. Usage: node scripts/check-api-contract.mjs <database> (uses psql
// with the PG* environment variables). Prints problems and exits 1 if any.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const db = process.argv[2] ?? "meah_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !full.includes(`${path.sep}app${path.sep}dev${path.sep}`)) files.push(full);
  }
})(path.join(root, "src"));
files.push(path.join(root, "lib", "supabase.ts"));

const sql = (query) => execFileSync("psql", ["-d", db, "-Atc", query], { encoding: "utf8" }).trim();

// Functions: name -> argument names (in order), and which have defaults.
const procs = new Map();
for (const line of sql(`select p.proname, coalesce(array_to_string(p.proargnames, ','), ''), p.pronargs, p.pronargdefaults from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`).split("\n")) {
  const [name, argnames, nargs, ndefaults] = line.split("|");
  const args = argnames ? argnames.split(",").slice(0, Number(nargs)) : [];
  const list = procs.get(name) ?? [];
  list.push({ args, required: args.slice(0, args.length - Number(ndefaults)) });
  procs.set(name, list);
}
const columns = new Map();
for (const line of sql(`select table_name, column_name from information_schema.columns where table_schema = 'public'`).split("\n")) {
  const [table, column] = line.split("|");
  if (!columns.has(table)) columns.set(table, new Set());
  columns.get(table).add(column);
}
// Computed columns (functions taking a row) are selectable too.
for (const line of sql(`select p.proname, t.typname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.proargtypes[0] where n.nspname = 'public' and p.pronargs = 1 and t.typtype = 'c'`).split("\n").filter(Boolean)) {
  const [fn, table] = line.split("|");
  columns.get(table)?.add(fn);
}

// Functions the app's mutate() helper sends p_client_request_id to.
const mutationsSource = readFileSync(path.join(root, "src/services/data/mutations.ts"), "utf8");
const idempotent = new Set([...(mutationsSource.match(/IDEMPOTENT_RPCS[^\]]*\]/s)?.[0].matchAll(/"([a-z_]+)"/g) ?? [])].map((m) => m[1]));

const problems = [];
const seen = new Set();
function topLevelKeys(objectText) {
  // Keys of the first-level object literal: `p_x:` or shorthand `p_x,`.
  let depth = 0;
  const keys = [];
  let token = "";
  for (const ch of objectText.slice(1)) {
    if ("{[(".includes(ch)) depth += 1;
    if ("}])".includes(ch)) { if (depth === 0) break; depth -= 1; }
    if (depth === 0) {
      if (ch === "," ) { const m = token.trim().match(/^(?:\.\.\.)?([a-z_][a-z0-9_]*)\s*(?::|$)/i); if (m && !token.trim().startsWith("...")) keys.push(m[1]); token = ""; continue; }
      token += ch;
    }
  }
  const m = token.trim().match(/^([a-z_][a-z0-9_]*)\s*(?::|$)/i);
  if (m && !token.trim().startsWith("...")) keys.push(m[1]);
  // A spread ("...payload") adds keys this check can't see.
  keys.spread = /(^|[{,\s])\.\.\./.test(objectText.slice(0, objectText.indexOf("}") + 1));
  return keys;
}
function checkCall(file, name, keys, viaMutate, offline) {
  const rel = path.relative(root, file);
  const list = procs.get(name);
  if (!list) { problems.push(`${rel}: function ${name}() does not exist`); return; }
  if (!keys) return; // arguments built elsewhere
  const sent = new Set(keys);
  if (viaMutate && idempotent.has(name)) sent.add("p_client_request_id");
  if (offline) { sent.add("p_client_request_id"); sent.add("p_offline"); }
  const fits = list.some((p) => [...sent].every((k) => p.args.includes(k)) && (keys.spread || p.required.every((k) => sent.has(k))));
  if (!fits) problems.push(`${rel}: ${name}(${[...sent].join(", ")}) matches no version (${list.map((p) => p.args.join(", ")).join(" | ")})`);
  seen.add(name);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\b(rpc|mutate)(?:<[^()]*?>)?\(\s*"([a-z_]+)"\s*(?:,\s*)?/g)) {
    const after = text.slice(m.index + m[0].length);
    const keys = after.startsWith("{") ? topLevelKeys(after) : after.startsWith(")") ? [] : null;
    checkCall(file, m[2], keys, m[1] === "mutate", false);
  }
  for (const m of text.matchAll(/rpc:\s*"(offline_[a-z_]+)",\s*\n?\s*args:\s*/g)) {
    const after = text.slice(m.index + m[0].length);
    const keys = after.startsWith("{") ? topLevelKeys(after) : null;
    checkCall(file, m[1], keys, false, true);
  }
  for (const m of text.matchAll(/from\("([a-z_]+)"\)\s*\.(select|insert|update|upsert|delete)\(\s*("([^"]*)"|[A-Z_]+)?/g)) {
    const table = m[1];
    const rel = path.relative(root, file);
    if (!columns.has(table)) { problems.push(`${rel}: table ${table} does not exist`); continue; }
    let select = m[4];
    if (m[2] === "select" && !select && m[3]) {
      const constant = text.match(new RegExp(`const ${m[3]}\\s*=\\s*((?:"[^"]*"\\s*\\+?\\s*)+|\\[[\\s\\S]*?\\]\\.join\\(","\\))`));
      select = constant ? [...constant[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join(",") : null;
    }
    if (m[2] !== "select" || !select) continue;
    let depth = 0; let token = ""; const top = [];
    for (const ch of select + ",") {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { top.push(token.trim()); token = ""; } else token += ch;
    }
    for (const field of top) {
      if (!field || field === "*" || field.includes("(")) continue;
      const name = field.split(":").pop().split("::")[0].trim();
      if (!columns.get(table).has(name)) problems.push(`${rel}: ${table}.${name} does not exist`);
    }
  }
}

console.log(`Checked ${seen.size} server functions and table selects in ${files.length} files against ${db}.`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("No problems found.");
