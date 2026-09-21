"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDataUrl,
} = require("../server/file-storage");

test("valid PDF data URL is accepted", () => {
  const pdf = Buffer.from("%PDF-1.4\n%%EOF", "ascii").toString("base64");
  const file = parseDataUrl(
    "data:application/pdf;base64," + pdf,
    "certificate",
  );

  assert.equal(file.mimeType, "application/pdf");
  assert.equal(file.extension, "pdf");
  assert.ok(file.size > 0);
});

test("fake PDF payload is rejected by file signature", () => {
  const fake = Buffer.from("not a pdf", "utf8").toString("base64");

  assert.throws(
    () =>
      parseDataUrl(
        "data:application/pdf;base64," + fake,
        "certificate",
      ),
    /signature/i,
  );
});
