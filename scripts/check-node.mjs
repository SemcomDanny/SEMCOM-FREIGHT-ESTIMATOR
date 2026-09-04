#!/usr/bin/env node
/**
 * Fail early, and in plain English, on an unsupported Node version.
 *
 * The database library ships pre-compiled binaries only for certain Node
 * versions. On anything else npm silently falls back to compiling from source,
 * which needs a C++ toolchain most people do not have and should not need to
 * install — and the failure it produces is hundreds of lines of node-gyp
 * output that says nothing useful to whoever is trying to install this.
 */
const MIN_MAJOR = 22;
const TESTED = [22, 24];

const major = Number(process.versions.node.split('.')[0]);

if (major < MIN_MAJOR) {
  console.error(`
  ------------------------------------------------------------------
  This tool needs Node ${TESTED.join(' or ')}. You have Node ${process.versions.node}.

  Install a current version from https://nodejs.org — take the one
  marked "LTS" — then run this again.
  ------------------------------------------------------------------
`);
  process.exit(1);
}

if (!TESTED.includes(major)) {
  console.warn(`
  Note: this has been tested on Node ${TESTED.join(' and ')}; you are on Node ${process.versions.node}.
  If the install fails while building better-sqlite3, install Node ${TESTED[TESTED.length - 1]} instead.
`);
}
