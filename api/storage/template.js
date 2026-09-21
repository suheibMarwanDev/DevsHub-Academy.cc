"use strict";

const { requireAdminAccess } = require("../../server/auth");
const {
  getDefaultOrganizationId,
  listCertificateTemplates,
} = require("../../server/database");
const { createSignedUrl } = require("../../server/file-storage");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end();
  }

  try {
    const access = await requireAdminAccess(req, res, { write: false });
    if (!access.allowed) {
      res.statusCode = access.status || 401;
      return res.end("Admin authentication required");
    }

    const organizationId =
      access?.session?.membership?.organization?.id ||
      (await getDefaultOrganizationId());

    const templateId = String(req.query?.id || "").trim();
    if (!templateId) {
      res.statusCode = 400;
      return res.end("Template id is required");
    }

    const templates = await listCertificateTemplates(organizationId);
    const template = templates.find((item) => item.id === templateId);

    if (!template?.file_path) {
      res.statusCode = 404;
      return res.end("Template not found");
    }

    const signedUrl = await createSignedUrl(template.file_path, 600);
    if (!signedUrl) {
      res.statusCode = 404;
      return res.end("Template file not found");
    }

    res.statusCode = 302;
    res.setHeader("Location", signedUrl);
    res.setHeader("Cache-Control", "private, no-store");
    return res.end();
  } catch (error) {
    console.error("template_file_error", error);
    res.statusCode = 500;
    return res.end("Unable to open template file");
  }
};
