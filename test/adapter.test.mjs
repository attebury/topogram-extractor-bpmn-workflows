import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const adapter = require("../index.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureContext() {
  const fixtureRoot = path.join(root, "fixtures", "basic-source");
  return {
    paths: { inputRoot: fixtureRoot },
    helpers: {
      readTextIfExists(filePath) {
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
      }
    }
  };
}

test("exports a valid extractor adapter boundary", () => {
  assert.equal(adapter.manifest.id, "@topogram/extractor-bpmn-workflows");
  assert.equal(adapter.manifest.source, "package");
  assert.deepEqual(adapter.manifest.tracks, ["workflows"]);
  assert.equal(Array.isArray(adapter.extractors), true);
  assert.equal(adapter.extractors.length, 1);
  assert.equal(adapter.extractors[0].id, "workflows.bpmn");
  assert.equal(adapter.extractors[0].track, "workflows");
  assert.equal(typeof adapter.extractors[0].detect, "function");
  assert.equal(typeof adapter.extractors[0].extract, "function");
});

test("extracts BPMN workflow definitions, states, and transitions", () => {
  const detection = adapter.extractors[0].detect(fixtureContext());
  assert.equal(detection.score > 0, true);

  const result = adapter.extractors[0].extract(fixtureContext());
  assert.deepEqual(
    result.candidates.workflow_definitions.map((entry) => entry.id_hint).sort(),
    ["workflow_request_review"]
  );
  assert.deepEqual(
    result.candidates.workflow_states
      .filter((entry) => entry.workflow_id === "workflow_request_review")
      .map((entry) => `${entry.state_id}:${entry.type}:${entry.source_type}`)
      .sort(),
    [
      "approved:terminal:endEvent",
      "changes_requested:terminal:endEvent",
      "publish_decision:normal:serviceTask",
      "request_changes:normal:userTask",
      "review_decision:decision:exclusiveGateway",
      "review_request:normal:userTask",
      "submitted:initial:startEvent"
    ]
  );
  assert.deepEqual(
    result.candidates.workflow_transitions
      .filter((entry) => entry.workflow_id === "workflow_request_review")
      .map((entry) => `${entry.from_state}:${entry.event}:${entry.to_state}:${entry.guard || "none"}`)
      .sort(),
    [
      "publish_decision:PUBLISH:approved:none",
      "request_changes:NOTIFY:changes_requested:none",
      "review_decision:APPROVE:publish_decision:${approved == true}",
      "review_decision:REQUEST_CHANGES:request_changes:${approved == false}",
      "review_request:DECIDE:review_decision:none",
      "submitted:SUBMIT:review_request:none"
    ]
  );
});
