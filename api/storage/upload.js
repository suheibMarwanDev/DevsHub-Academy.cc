"use strict";

const { requireAdminAccess } = require("../../server/auth");
const {
  databaseConfig,
  getDefaultOrganizationId,
  getDatabaseCertificate,
  updateDatabaseCertificate,
  getOrganizationById,
  updateOrganizationLogoPath,
  createCertificateTemplate,
  logAudit,
} = require("../../server/database");
const {
  fileStorageConfig,
  uploadDataUrl,
  removeObject,
} = require("../../server/file-storage");
const {
  requestOriginAllowed,
  applyApiSecurityHeaders,
} = require("../../server/security");

function json(res, status, body) {
  applyApiSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function organizationIdFrom(access) {
  return (
    access?.session?.membership?.organization?.id ||
    (await getDefaultOrganizationId())
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!requestOriginAllowed(req)) {
      return json(res, 403, { error: "Invalid request origin" });
    }

    const access = await requireAdminAccess(req, res, { write: true });
    if (!access.allowed) {
      return json(res, access.status || 401, {
        error:
          access.status === 403
            ? "This account does not have file upload permission"
            : "Admin authentication required",
      });
    }

    if (!databaseConfig().configured || !fileStorageConfig().configured) {
      return json(res, 503, {
        error: "Supabase database/storage is not configured",
        storageConfigured: false,
      });
    }

    const body = parseBody(req.body);
    const kind = String(body.kind || "").trim().toLowerCase();
    const dataUrl = String(body.dataUrl || "");
    const organizationId = await organizationIdFrom(access);

    if (!["certificate", "logo", "template"].includes(kind)) {
      return json(res, 400, { error: "Invalid file kind" });
    }

    if (!dataUrl) {
      return json(res, 400, { error: "File data is required" });
    }

    if (kind === "certificate") {
      const serial = String(body.serial || "").trim().toUpperCase();
      if (!serial) {
        return json(res, 400, { error: "Certificate serial is required" });
      }

      const current = await getDatabaseCertificate(serial, {
        organizationId,
      });

      if (!current) {
        return json(res, 404, { error: "Certificate not found" });
      }

      const uploaded = await uploadDataUrl({
        organizationId,
        kind: "certificate",
        identifier: serial,
        dataUrl,
      });

      const updated = await updateDatabaseCertificate(
        serial,
        { pdfPath: uploaded.path, pdf: null },
        { organizationId },
      );

      if (current.pdfPath && current.pdfPath !== uploaded.path) {
        await removeObject(current.pdfPath).catch(() => {});
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "certificate.pdf_uploaded",
        entityType: "certificate",
        entityId: updated?.id || current.id || null,
        details: {
          serial,
          path: uploaded.path,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
        },
      }).catch(() => {});

      return json(res, 200, {
        kind,
        certificate: {
          ...updated,
          pdf: "/api/storage/certificate?serial=" + encodeURIComponent(serial),
        },
        file: uploaded,
      });
    }

    if (kind === "logo") {
      const organization = await getOrganizationById(organizationId);
      if (!organization) {
        return json(res, 404, { error: "Organization not found" });
      }

      const uploaded = await uploadDataUrl({
        organizationId,
        kind: "logo",
        identifier: organization.slug,
        dataUrl,
      });

      await updateOrganizationLogoPath(organizationId, uploaded.path);

      if (organization.logo_path && organization.logo_path !== uploaded.path) {
        await removeObject(organization.logo_path).catch(() => {});
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "organization.logo_updated",
        entityType: "organization",
        entityId: organizationId,
        details: {
          path: uploaded.path,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
        },
      }).catch(() => {});

      return json(res, 200, {
        kind,
        logoUrl:
          "/api/storage/logo?slug=" + encodeURIComponent(organization.slug),
        file: uploaded,
      });
    }

    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) {
      return json(res, 400, { error: "Template name is required" });
    }

    const uploaded = await uploadDataUrl({
      organizationId,
      kind: "template",
      identifier: name,
      dataUrl,
    });

    const template = await createCertificateTemplate({
      organizationId,
      name,
      filePath: uploaded.path,
      fileType: uploaded.mimeType,
      isActive: Boolean(body.isActive),
    });

    await logAudit({
      organizationId,
      actorUserId: access.session?.user?.id || null,
      action: "template.created",
      entityType: "template",
      entityId: template?.id || null,
      details: {
        name,
        path: uploaded.path,
        active: Boolean(body.isActive),
      },
    }).catch(() => {});

    return json(res, 201, {
      kind,
      template,
      file: uploaded,
    });
  } catch (error) {
    const known = {
      INVALID_FILE_KIND: 400,
      INVALID_FILE: 400,
      INVALID_FILE_TYPE: 415,
      INVALID_FILE_SIGNATURE: 415,
      FILE_TOO_LARGE: 413,
      FILE_STORAGE_NOT_CONFIGURED: 503,
    };

    const status = known[error?.code] || 500;
    console.error("storage_upload_error", error);

    return json(res, status, {
      error:
        status === 500
          ? "File upload failed"
          : error.message,
    });
  }
};
