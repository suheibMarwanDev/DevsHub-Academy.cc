"use strict";

const {
  databaseConfig,
  getOrganizationBySlug,
} = require("../../server/database");
const { createSignedUrl } = require("../../server/file-storage");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end();
  }

  try {
    if (!databaseConfig().configured) {
      res.statusCode = 404;
      return res.end("Logo not configured");
    }

    const slug =
      String(req.query?.slug || "").trim() ||
      String(process.env.DEFAULT_ORGANIZATION_SLUG || "").trim() ||
      "devshub-academy";

    const organization = await getOrganizationBySlug(slug);

    if (!organization?.logo_path) {
      res.statusCode = 404;
      return res.end("Logo not found");
    }

    const signedUrl = await createSignedUrl(organization.logo_path, 900);

    if (!signedUrl) {
      res.statusCode = 404;
      return res.end("Logo not found");
    }

    res.statusCode = 302;
    res.setHeader("Location", signedUrl);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.end();
  } catch (error) {
    console.error("organization_logo_error", error);
    res.statusCode = 500;
    return res.end("Unable to open organization logo");
  }
};
