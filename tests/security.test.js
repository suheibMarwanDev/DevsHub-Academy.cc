"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requestOriginAllowed,
  hashedClientKey,
} = require("../server/security");

test("same-origin requests are accepted", () => {
  const req = {
    headers: {
      origin: "https://example.com",
      host: "example.com",
    },
  };
  assert.equal(requestOriginAllowed(req), true);
});

test("cross-origin requests are rejected", () => {
  const req = {
    headers: {
      origin: "https://evil.example",
      host: "example.com",
    },
  };
  assert.equal(requestOriginAllowed(req), false);
});

test("rate-limit keys do not expose raw IP addresses", () => {
  process.env.RATE_LIMIT_SALT = "test-secret";
  const req = {
    headers: {
      "x-forwarded-for": "192.0.2.1",
    },
  };

  const key = hashedClientKey(req, "verification");
  assert.match(key, /^verification:[a-f0-9]{64}$/);
  assert.equal(key.includes("192.0.2.1"), false);
});
