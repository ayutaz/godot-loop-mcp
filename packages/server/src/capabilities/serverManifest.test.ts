import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { SERVER_VERSION } from "./serverManifest.ts";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: string };

test("SERVER_VERSION matches package.json", () => {
  assert.equal(SERVER_VERSION, packageJson.version);
});
