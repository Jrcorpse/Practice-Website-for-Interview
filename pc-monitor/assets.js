// assets.js — serves dashboard files.
// DEV MODE: EMBEDDED = {} and files are read from disk (public/).
// RELEASE MODE: scripts/embed-assets.js rewrites this file with the real
// file contents base64-inlined so the single-file EXE needs no extracted files.
const fs = require("fs");
const path = require("path");

const EMBEDDED = {}; // maps "relative/path" -> base64 string

const PUBLIC_DIR = path.join(__dirname, "public");

function read(rel) {
  if (EMBEDDED[rel] !== undefined) return Buffer.from(EMBEDDED[rel], "base64");
  return fs.readFileSync(path.join(PUBLIC_DIR, rel));
}

module.exports = { read };