"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateSerial,
  normalizeCertificate,
  normalizeCertificatePatch,
  normalizePrefix,
} = require("../server/certificates");

test("normalizePrefix removes unsafe characters", () => {
  assert.equal(normalizePrefix(" dvh-! "), "DVH");
});

test("generateSerial follows official certificate pattern", () => {
  const serial = generateSerial("DVH", new Date("2026-09-21T00:00:00Z"));
  assert.match(serial, /^DVH-2026-\d{6}$/);
});

test("normalizeCertificate validates and normalizes certificate data", () => {
  const cert = normalizeCertificate(
    {
      name: " Ahmed Ali ",
      course: " Web Development ",
      date: "2026-09-21",
      status: "valid",
    },
    { requireSerial: false },
  );

  assert.equal(cert.name, "Ahmed Ali");
  assert.equal(cert.course, "Web Development");
  assert.equal(cert.date, "2026-09-21");
  assert.equal(cert.status, "valid");
});

test("normalizeCertificatePatch rejects invalid status", () => {
  assert.equal(
    normalizeCertificatePatch({ status: "deleted" }),
    null,
  );
});

test("normalizeCertificatePatch supports revocation metadata", () => {
  const patch = normalizeCertificatePatch({
    status: "revoked",
    revokedReason: "Reissued",
  });

  assert.equal(patch.status, "revoked");
  assert.equal(patch.revokedReason, "Reissued");
});
