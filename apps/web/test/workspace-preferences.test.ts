import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultRoutingPreference,
  defaultManualExecutionPreference,
  effortOptions,
  isThemePreference,
  modelOptions,
  modelSupportsUltra,
  normalizeManualExecutionPreference,
  normalizeModeForModel,
  resolveExecutionPreference,
  resolveTheme,
  tokenResearchRoutingProfile
} from "../src/workspace-preferences";

test("exposes the complete GPT-5.6 model and reasoning choices", () => {
  assert.deepEqual(
    modelOptions.map((option) => option.value),
    ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "auto"]
  );
  assert.deepEqual(
    effortOptions.map((option) => option.value),
    ["low", "medium", "high", "xhigh", "max"]
  );
});

test("keeps Ultra separate and available only for Sol and Terra", () => {
  assert.equal(modelSupportsUltra("gpt-5.6-sol"), true);
  assert.equal(modelSupportsUltra("gpt-5.6-terra"), true);
  assert.equal(modelSupportsUltra("gpt-5.6-luna"), false);
  assert.equal(modelSupportsUltra("auto"), false);
  assert.equal(normalizeModeForModel("gpt-5.6-sol", "ultra"), "ultra");
  assert.equal(normalizeModeForModel("gpt-5.6-luna", "ultra"), "standard");
  assert.equal(normalizeModeForModel("auto", "ultra"), "standard");
});

test("defines TokenResearch as the default Sol Ultra coordinator with Luna Max workers", () => {
  assert.equal(defaultRoutingPreference, "tokenresearch");
  assert.deepEqual(tokenResearchRoutingProfile.coordinator, {
    model: "gpt-5.6-sol",
    effort: "max",
    mode: "ultra"
  });
  assert.deepEqual(tokenResearchRoutingProfile.subagent, {
    agentType: "luna-worker",
    model: "gpt-5.6-luna",
    effort: "max"
  });
  assert.deepEqual(
    resolveExecutionPreference("tokenresearch", "gpt-5.6-luna", "low", "standard"),
    { model: "gpt-5.6-sol", effort: "max", mode: "ultra" }
  );
});

test("keeps manual model, effort, and mode changes independent", () => {
  assert.deepEqual(
    resolveExecutionPreference("manual", "gpt-5.6-terra", "high", "standard"),
    { model: "gpt-5.6-terra", effort: "high", mode: "standard" }
  );
  assert.deepEqual(
    resolveExecutionPreference("manual", "gpt-5.6-sol", "low", "ultra"),
    { model: "gpt-5.6-sol", effort: "max", mode: "ultra" }
  );
});

test("normalizes persisted manual execution preferences", () => {
  assert.deepEqual(defaultManualExecutionPreference, {
    model: "gpt-5.6-sol",
    effort: "medium",
    mode: "standard"
  });
  assert.deepEqual(
    normalizeManualExecutionPreference({ model: "gpt-5.6-terra", effort: "high", mode: "standard" }),
    { model: "gpt-5.6-terra", effort: "high", mode: "standard" }
  );
  assert.deepEqual(
    normalizeManualExecutionPreference({ model: "gpt-5.6-luna", effort: "low", mode: "ultra" }),
    { model: "gpt-5.6-luna", effort: "max", mode: "standard" }
  );
  assert.deepEqual(
    normalizeManualExecutionPreference({ model: "unknown", effort: "unknown", mode: "unknown" }),
    defaultManualExecutionPreference
  );
});

test("resolves and validates persisted theme preferences", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("sepia"), false);
});
