"use strict";

const { resolveSession } = require("../lib/auth");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const session = await resolveSession(req, res);
    return json(res, 200, session);
  } catch (error) {
    return json(res, 200, {
      authenticated: false,
      demoMode: false,
      error: "Unable to resolve session",
    });
  }
};
