import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpCatalog, listEnabledToolEntries, type CapabilityLookup } from "./catalog.ts";

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

test("startup catalog stays stable before addon capabilities are known", () => {
  const catalog = buildMcpCatalog({
    securityLevel: "WorkspaceWrite"
  });

  assert.ok(catalog.tools.includes("get_project_info"));
  assert.ok(catalog.tools.includes("search_project"));
  assert.ok(catalog.tools.includes("create_scene"));
  assert.ok(catalog.tools.includes("play_scene"));
  assert.ok(catalog.tools.includes("get_running_node_property"));
  assert.ok(catalog.tools.includes("wait_for_runtime_condition"));
  assert.ok(catalog.tools.includes("get_running_audio_players"));
  assert.ok(!catalog.tools.includes("execute_editor_script"));
});

test("context-less catalog helpers fall back to a minimal safe exposure", () => {
  const tools = listEnabledToolEntries().map((entry) => entry.name);

  assert.ok(tools.includes("get_editor_state"));
  assert.ok(!tools.includes("get_project_info"));
  assert.ok(!tools.includes("search_project"));
  assert.ok(!tools.includes("create_scene"));
  assert.ok(!tools.includes("wait_for_runtime_condition"));
  assert.ok(!tools.includes("execute_editor_script"));
});
