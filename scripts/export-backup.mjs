import { mkdir, writeFile } from "node:fs/promises";

const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!url || !key) {
  console.log("Backup skipped: Supabase backup secrets are not configured.");
  process.exit(0);
}

const tables = [
  "organizations",
  "organization_members",
  "courses",
  "students",
  "certificates",
  "verification_logs",
  "audit_logs",
  "certificate_templates",
];

async function fetchTable(table) {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      url +
        "/rest/v1/" +
        table +
        "?select=*&limit=" +
        pageSize +
        "&offset=" +
        offset,
      {
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        "Backup failed for " +
          table +
          ": HTTP " +
          response.status +
          " " +
          (await response.text()),
      );
    }

    const page = await response.json();
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

const backup = {
  format: "devshub-academy-json-backup-v1",
  generatedAt: new Date().toISOString(),
  tables: {},
};

for (const table of tables) {
  backup.tables[table] = await fetchTable(table);
  console.log(table + ": " + backup.tables[table].length + " rows");
}

await mkdir("backups", { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-");
const path = "backups/devshub-backup-" + stamp + ".json";

await writeFile(path, JSON.stringify(backup, null, 2), "utf8");

console.log("Backup written to " + path);
