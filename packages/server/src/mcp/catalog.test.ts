import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpCatalog, type CapabilityLookup } from "./catalog.ts";

function createCapabilityLookup(capabilities: string[]): CapabilityLookup {
  const enabled = new Set(capabilities);
  return {
    hasCapability(capabilityId: string): boolean {
      return enabled.has(capabilityId);
    }
  };
}

test("runtime inspection tools are exposed when runtime.debug is enabled", () => {
  const catalog = buildMcpCatalog({
    capabilities: createCapabilityLookup(["runtime.debug", "runtime.input", "play.control"]),
    securityLevel: "WorkspaceWrite"
  });

  assert.ok(catalog.tools.includes("get_running_scene_tree"));
  assert.ok(catalog.tools.includes("get_running_node"));
  assert.ok(catalog.tools.includes("get_running_node_property"));
  assert.ok(catalog.tools.includes("wait_for_runtime_condition"));
  assert.ok(catalog.tools.includes("get_running_audio_players"));
  assert.ok(catalog.tools.includes("simulate_mouse"));
});

test("runtime inspection tools stay hidden without runtime.debug", () => {
  const catalog = buildMcpCatalog({
    capabilities: createCapabilityLookup(["play.control"]),
    securityLevel: "WorkspaceWrite"
  });

  assert.ok(!catalog.tools.includes("get_running_scene_tree"));
  assert.ok(!catalog.tools.includes("get_running_node"));
  assert.ok(!catalog.tools.includes("get_running_node_property"));
  assert.ok(!catalog.tools.includes("wait_for_runtime_condition"));
  assert.ok(!catalog.tools.includes("get_running_audio_players"));
  assert.ok(!catalog.tools.includes("simulate_mouse"));
});
