"use strict";

function databaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
    organizationSlug:
      String(process.env.DEFAULT_ORGANIZATION_SLUG || "").trim() ||
      "devshub-academy",
  };
}

async function supabaseRequest(path, options = {}) {
  const config = databaseConfig();

  if (!config.configured) {
    const error = new Error("PostgreSQL database is not configured");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(config.url + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: "Bearer " + config.serviceRoleKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      "Supabase request failed: " + response.status + " " + body,
    );
    error.code = "DATABASE_REQUEST_FAILED";
    throw error;
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getDefaultOrganizationId() {
  const config = databaseConfig();
  const rows = await supabaseRequest(
    "organizations?select=id&slug=eq." +
      encodeURIComponent(config.organizationSlug) +
      "&limit=1",
  );

  if (!Array.isArray(rows) || !rows[0]?.id) {
    const error = new Error("Default organization does not exist");
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }

  return rows[0].id;
}

function mapCertificate(row) {
  if (!row) return null;

  return {
    id: row.id,
    serial: row.serial,
    name: row.student_name,
    course: row.course_name,
    date: row.issued_at,
    status: row.status || "valid",
    ...(row.pdf_url ? { pdf: row.pdf_url } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  };
}

async function listDatabaseCertificates() {
  const rows = await supabaseRequest(
    "certificates?select=id,serial,student_name,course_name,issued_at,expires_at,status,pdf_url&order=created_at.desc",
  );

  return Array.isArray(rows) ? rows.map(mapCertificate) : [];
}

async function getDatabaseCertificate(serial) {
  const normalized = String(serial || "").trim().toUpperCase();
  if (!normalized) return null;

  const rows = await supabaseRequest(
    "certificates?select=id,serial,student_name,course_name,issued_at,expires_at,status,pdf_url&serial=eq." +
      encodeURIComponent(normalized) +
      "&limit=1",
  );

  return Array.isArray(rows) && rows[0] ? mapCertificate(rows[0]) : null;
}

async function upsertDatabaseCertificate(certificate) {
  const organizationId = await getDefaultOrganizationId();

  const body = {
    organization_id: organizationId,
    serial: certificate.serial,
    student_name: certificate.name,
    course_name: certificate.course,
    issued_at: certificate.date,
    status: certificate.status || "valid",
    pdf_url: certificate.pdf || null,
    verification_path:
      "/#certificate/" + encodeURIComponent(certificate.serial),
  };

  const rows = await supabaseRequest(
    "certificates?on_conflict=serial",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(body),
    },
  );

  return Array.isArray(rows) && rows[0]
    ? mapCertificate(rows[0])
    : certificate;
}

async function logVerification({
  certificateId = null,
  serial,
  result,
  source = "serial",
  userAgent = null,
  ipHash = null,
}) {
  const body = {
    certificate_id: certificateId,
    serial: String(serial || "").trim().toUpperCase(),
    result,
    source,
    user_agent: userAgent,
    ip_hash: ipHash,
  };

  await supabaseRequest("verification_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });

  return true;
}

module.exports = {
  databaseConfig,
  listDatabaseCertificates,
  getDatabaseCertificate,
  upsertDatabaseCertificate,
  logVerification,
};
