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
    error.status = response.status;
    error.body = body;
    error.code =
      response.status === 409 ? "DATABASE_CONFLICT" : "DATABASE_REQUEST_FAILED";
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
    organizationId: row.organization_id,
    serial: row.serial,
    name: row.student_name,
    course: row.course_name,
    phone: String(row.metadata?.phone || ""),
    metadata: row.metadata || {},
    date: row.issued_at,
    status: row.status || "valid",
    ...(row.pdf_url ? { pdf: row.pdf_url } : {}),
    ...(row.pdf_path ? { pdfPath: row.pdf_path } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_reason ? { revokedReason: row.revoked_reason } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function certificateSelect() {
  return [
    "id",
    "organization_id",
    "serial",
    "student_name",
    "course_name",
    "metadata",
    "issued_at",
    "expires_at",
    "status",
    "pdf_url",
    "pdf_path",
    "revoked_at",
    "revoked_reason",
    "created_at",
    "updated_at",
  ].join(",");
}

async function listDatabaseCertificates({
  organizationId = null,
  q = "",
  status = "",
  limit = 100,
} = {}) {
  const params = new URLSearchParams();
  params.set("select", certificateSelect());
  params.set("order", "created_at.desc");
  params.set("limit", String(Math.min(Math.max(Number(limit) || 100, 1), 500)));

  const orgId = organizationId || (await getDefaultOrganizationId());
  params.set("organization_id", "eq." + orgId);

  if (status) params.set("status", "eq." + status);

  const search = String(q || "").trim();
  if (search) {
    const safe = search.replace(/[,%()]/g, " ").trim();
    if (safe) {
      params.set(
        "or",
        "(serial.ilike.*" +
          safe +
          "*,student_name.ilike.*" +
          safe +
          "*,course_name.ilike.*" +
          safe +
          "*)",
      );
    }
  }

  const rows = await supabaseRequest("certificates?" + params.toString());
  return Array.isArray(rows) ? rows.map(mapCertificate) : [];
}

async function getDatabaseCertificate(serial, { organizationId = null } = {}) {
  const normalized = String(serial || "").trim().toUpperCase();
  if (!normalized) return null;

  const params = new URLSearchParams();
  params.set("select", certificateSelect());
  params.set("serial", "eq." + normalized);
  params.set("limit", "1");

  if (organizationId) {
    params.set("organization_id", "eq." + organizationId);
  }

  const rows = await supabaseRequest("certificates?" + params.toString());
  return Array.isArray(rows) && rows[0] ? mapCertificate(rows[0]) : null;
}

async function createDatabaseCertificate(certificate, {
  organizationId = null,
} = {}) {
  const orgId = organizationId || (await getDefaultOrganizationId());

  const body = {
    organization_id: orgId,
    serial: certificate.serial,
    student_name: certificate.name,
    course_name: certificate.course,
    metadata: {
      ...(certificate.metadata || {}),
      ...(certificate.phone ? { phone: certificate.phone } : {}),
    },
    issued_at: certificate.date,
    expires_at: certificate.expiresAt || null,
    status: certificate.status || "valid",
    pdf_url: certificate.pdf || null,
    pdf_path: certificate.pdfPath || null,
    verification_path:
      "/#certificate/" + encodeURIComponent(certificate.serial),
    revoked_at:
      certificate.status === "revoked" ? new Date().toISOString() : null,
    revoked_reason:
      certificate.status === "revoked"
        ? certificate.revokedReason || null
        : null,
  };

  const rows = await supabaseRequest("certificates", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });

  return Array.isArray(rows) && rows[0]
    ? mapCertificate(rows[0])
    : certificate;
}

async function createDatabaseCertificates(certificates, {
  organizationId = null,
} = {}) {
  const orgId = organizationId || (await getDefaultOrganizationId());

  const body = certificates.map((certificate) => ({
    organization_id: orgId,
    serial: certificate.serial,
    student_name: certificate.name,
    course_name: certificate.course,
    metadata: {
      ...(certificate.metadata || {}),
      ...(certificate.phone ? { phone: certificate.phone } : {}),
    },
    issued_at: certificate.date,
    expires_at: certificate.expiresAt || null,
    status: certificate.status || "valid",
    pdf_url: certificate.pdf || null,
    pdf_path: certificate.pdfPath || null,
    verification_path:
      "/#certificate/" + encodeURIComponent(certificate.serial),
    revoked_at:
      certificate.status === "revoked" ? new Date().toISOString() : null,
    revoked_reason:
      certificate.status === "revoked"
        ? certificate.revokedReason || null
        : null,
  }));

  const rows = await supabaseRequest("certificates", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });

  return Array.isArray(rows) ? rows.map(mapCertificate) : [];
}

async function updateDatabaseCertificate(serial, patch, {
  organizationId = null,
} = {}) {
  const normalized = String(serial || "").trim().toUpperCase();
  if (!normalized) return null;

  const body = {};

  if ("name" in patch) body.student_name = patch.name;
  if ("course" in patch) body.course_name = patch.course;
  if ("phone" in patch) {
    const existingForMetadata = await getDatabaseCertificate(normalized, {
      organizationId,
    });
    body.metadata = {
      ...(existingForMetadata?.metadata || {}),
      phone: patch.phone || null,
    };
  }
  if ("date" in patch) body.issued_at = patch.date;
  if ("expiresAt" in patch) body.expires_at = patch.expiresAt;
  if ("pdf" in patch) body.pdf_url = patch.pdf;
  if ("pdfPath" in patch) body.pdf_path = patch.pdfPath;

  if ("status" in patch) {
    body.status = patch.status;

    if (patch.status === "revoked") {
      body.revoked_at = new Date().toISOString();
      body.revoked_reason = patch.revokedReason || null;
    } else {
      body.revoked_at = null;
      body.revoked_reason = null;
    }
  } else if ("revokedReason" in patch) {
    body.revoked_reason = patch.revokedReason || null;
  }

  const params = new URLSearchParams();
  params.set("serial", "eq." + normalized);
  if (organizationId) params.set("organization_id", "eq." + organizationId);

  const rows = await supabaseRequest("certificates?" + params.toString(), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });

  return Array.isArray(rows) && rows[0] ? mapCertificate(rows[0]) : null;
}

async function upsertDatabaseCertificate(certificate, options = {}) {
  const existing = await getDatabaseCertificate(certificate.serial, options);
  if (!existing) return createDatabaseCertificate(certificate, options);

  return updateDatabaseCertificate(
    certificate.serial,
    {
      name: certificate.name,
      course: certificate.course,
      ...(certificate.phone !== undefined ? { phone: certificate.phone } : {}),
      date: certificate.date,
      status: certificate.status,
      ...(certificate.expiresAt !== undefined
        ? { expiresAt: certificate.expiresAt }
        : {}),
      ...(certificate.pdf !== undefined ? { pdf: certificate.pdf } : {}),
      ...(certificate.pdfPath !== undefined
        ? { pdfPath: certificate.pdfPath }
        : {}),
      ...(certificate.revokedReason !== undefined
        ? { revokedReason: certificate.revokedReason }
        : {}),
    },
    options,
  );
}

async function getOrganizationById(organizationId) {
  if (!organizationId) return null;

  const rows = await supabaseRequest(
    "organizations?select=id,name,display_name,slug,verification_slug,custom_domain,status,logo_path,primary_color,secondary_color&id=eq." +
      encodeURIComponent(organizationId) +
      "&limit=1",
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getOrganizationBySlug(slug) {
  const normalized = String(slug || "").trim();
  if (!normalized) return null;

  const rows = await supabaseRequest(
    "organizations?select=id,name,display_name,slug,verification_slug,custom_domain,status,logo_path,primary_color,secondary_color&slug=eq." +
      encodeURIComponent(normalized) +
      "&limit=1",
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function updateOrganizationSettings(
  organizationId,
  settings,
) {
  const body = {};

  if ("displayName" in settings) {
    body.display_name = String(settings.displayName || "")
      .trim()
      .slice(0, 120);
  }

  if ("customDomain" in settings) {
    const domain = String(settings.customDomain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .slice(0, 253);
    body.custom_domain = domain || null;
  }

  if ("primaryColor" in settings) {
    body.primary_color = settings.primaryColor;
  }

  if ("secondaryColor" in settings) {
    body.secondary_color = settings.secondaryColor;
  }

  const rows = await supabaseRequest(
    "organizations?id=eq." + encodeURIComponent(organizationId),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    },
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function updateOrganizationLogoPath(organizationId, logoPath) {
  const rows = await supabaseRequest(
    "organizations?id=eq." + encodeURIComponent(organizationId),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ logo_path: logoPath || null }),
    },
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function listCertificateTemplates(organizationId) {
  const rows = await supabaseRequest(
    "certificate_templates?select=id,organization_id,name,file_path,preview_path,file_type,is_active,metadata,created_at,updated_at&organization_id=eq." +
      encodeURIComponent(organizationId) +
      "&order=created_at.desc",
  );

  return Array.isArray(rows) ? rows : [];
}

async function createCertificateTemplate({
  organizationId,
  name,
  filePath,
  fileType,
  isActive = false,
}) {
  if (isActive) {
    await supabaseRequest(
      "certificate_templates?organization_id=eq." +
        encodeURIComponent(organizationId),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ is_active: false }),
      },
    );
  }

  const rows = await supabaseRequest("certificate_templates", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: organizationId,
      name,
      file_path: filePath,
      file_type: fileType || null,
      is_active: Boolean(isActive),
    }),
  });

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function setActiveCertificateTemplate(organizationId, templateId) {
  await supabaseRequest(
    "certificate_templates?organization_id=eq." +
      encodeURIComponent(organizationId),
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_active: false }),
    },
  );

  const rows = await supabaseRequest(
    "certificate_templates?id=eq." +
      encodeURIComponent(templateId) +
      "&organization_id=eq." +
      encodeURIComponent(organizationId),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ is_active: true }),
    },
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function deleteCertificateTemplate(organizationId, templateId) {
  const rows = await supabaseRequest(
    "certificate_templates?select=id,file_path,preview_path&id=eq." +
      encodeURIComponent(templateId) +
      "&organization_id=eq." +
      encodeURIComponent(organizationId) +
      "&limit=1",
  );

  const template = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!template) return null;

  await supabaseRequest(
    "certificate_templates?id=eq." +
      encodeURIComponent(templateId) +
      "&organization_id=eq." +
      encodeURIComponent(organizationId),
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
  );

  return template;
}

async function getDashboardMetrics(organizationId) {
  if (!organizationId) {
    return {
      certificatesTotal: 0,
      validCertificates: 0,
      revokedCertificates: 0,
      expiredCertificates: 0,
      issuedThisMonth: 0,
      verificationsToday: 0,
      verifications30d: 0,
      serialToday: 0,
      qrToday: 0,
      directToday: 0,
      successfulToday: 0,
      daily30d: [],
    };
  }

  const payload = await supabaseRequest(
    "rpc/get_org_dashboard_metrics",
    {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
      }),
    },
  );

  return payload || {};
}

async function consumeRateLimit(key, limit, windowSeconds) {
  const payload = await supabaseRequest(
    "rpc/consume_rate_limit",
    {
      method: "POST",
      body: JSON.stringify({
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    },
  );

  return payload === true;
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

async function logAudit({
  organizationId = null,
  actorUserId = null,
  action,
  entityType = "certificate",
  entityId = null,
  details = {},
}) {
  const body = {
    organization_id: organizationId,
    actor_user_id: actorUserId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  };

  await supabaseRequest("audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });

  return true;
}

module.exports = {
  databaseConfig,
  getDefaultOrganizationId,
  listDatabaseCertificates,
  getDatabaseCertificate,
  createDatabaseCertificate,
  createDatabaseCertificates,
  updateDatabaseCertificate,
  upsertDatabaseCertificate,
  getOrganizationById,
  getOrganizationBySlug,
  updateOrganizationSettings,
  updateOrganizationLogoPath,
  listCertificateTemplates,
  createCertificateTemplate,
  setActiveCertificateTemplate,
  deleteCertificateTemplate,
  getDashboardMetrics,
  consumeRateLimit,
  logVerification,
  logAudit,
};
