"use strict";

const { requireAdminAccess } = require("../lib/auth");
const {
  databaseConfig,
  getDefaultOrganizationId,
  getOrganizationById,
  listCertificateTemplates,
  setActiveCertificateTemplate,
  deleteCertificateTemplate,
  logAudit,
} = require("../lib/database");
const {
  fileStorageConfig,
  removeObject,
} = require("../lib/file-storage");

function json(res, status, body) {
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
  try {
    const write = req.method !== "GET";
    const access = await requireAdminAccess(req, res, { write });

    if (!access.allowed) {
      return json(res, access.status || 401, {
        error: write
          ? "This account does not have asset management permission"
          : "Admin authentication required",
      });
    }

    if (!databaseConfig().configured || !fileStorageConfig().configured) {
      return json(res, 503, {
        error: "Supabase database/storage is not configured",
        storageConfigured: false,
      });
    }

    const organizationId = await organizationIdFrom(access);

    if (req.method === "GET") {
      const [organization, templates] = await Promise.all([
        getOrganizationById(organizationId),
        listCertificateTemplates(organizationId),
      ]);

      return json(res, 200, {
        organization: organization
          ? {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              hasLogo: Boolean(organization.logo_path),
              logoUrl: organization.logo_path
                ? "/api/storage/logo?slug=" +
                  encodeURIComponent(organization.slug)
                : null,
            }
          : null,
        templates: templates.map((template) => ({
          id: template.id,
          name: template.name,
          fileType: template.file_type,
          isActive: template.is_active,
          createdAt: template.created_at,
          fileUrl:
            "/api/storage/template?id=" +
            encodeURIComponent(template.id),
        })),
      });
    }

    const body = parseBody(req.body);

    if (req.method === "PATCH") {
      const templateId = String(body.templateId || "").trim();
      if (!templateId) {
        return json(res, 400, { error: "Template id is required" });
      }

      const template = await setActiveCertificateTemplate(
        organizationId,
        templateId,
      );

      if (!template) {
        return json(res, 404, { error: "Template not found" });
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "template.activated",
        entityType: "template",
        entityId: template.id,
        details: { name: template.name },
      }).catch(() => {});

      return json(res, 200, { template });
    }

    if (req.method === "DELETE") {
      const templateId = String(
        req.query?.id || body.templateId || "",
      ).trim();

      if (!templateId) {
        return json(res, 400, { error: "Template id is required" });
      }

      const template = await deleteCertificateTemplate(
        organizationId,
        templateId,
      );

      if (!template) {
        return json(res, 404, { error: "Template not found" });
      }

      if (template.file_path) {
        await removeObject(template.file_path).catch(() => {});
      }
      if (template.preview_path) {
        await removeObject(template.preview_path).catch(() => {});
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "template.deleted",
        entityType: "template",
        entityId: template.id,
        details: { path: template.file_path },
      }).catch(() => {});

      return json(res, 200, { deleted: true, id: templateId });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("storage_assets_error", error);
    return json(res, 500, { error: "Asset request failed" });
  }
};
