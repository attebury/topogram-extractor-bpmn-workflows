const fs = require("node:fs");
const path = require("node:path");

const manifest = require("./topogram-extractor.json");

const IGNORED_DIRS = new Set([
  ".git",
  ".topogram",
  "app",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "tmp",
  ".tmp"
]);

const BPMN_FILE_PATTERN = /\.bpmn(?:\.xml)?$/i;
const BPMN_CONTENT_PATTERN = /<(?:bpmn2?:)?(?:definitions|process)\b/i;
const NODE_TYPES = new Map([
  ["startEvent", "initial"],
  ["endEvent", "terminal"],
  ["terminateEndEvent", "terminal"],
  ["exclusiveGateway", "decision"],
  ["inclusiveGateway", "decision"],
  ["parallelGateway", "decision"],
  ["eventBasedGateway", "decision"],
  ["complexGateway", "decision"],
  ["userTask", "normal"],
  ["serviceTask", "normal"],
  ["scriptTask", "normal"],
  ["manualTask", "normal"],
  ["businessRuleTask", "normal"],
  ["receiveTask", "normal"],
  ["sendTask", "normal"],
  ["task", "normal"],
  ["callActivity", "normal"],
  ["subProcess", "normal"],
  ["intermediateCatchEvent", "normal"],
  ["intermediateThrowEvent", "normal"],
  ["boundaryEvent", "normal"]
]);

function rootDir(context) {
  return context.paths.inputRoot || context.paths.workspaceRoot || process.cwd();
}

function normalizeRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/") || ".";
}

function idHintify(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function listFilesRecursive(dirPath, predicate, result = []) {
  if (!fs.existsSync(dirPath)) return result;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) listFilesRecursive(absolutePath, predicate, result);
    } else if (entry.isFile() && predicate(absolutePath)) {
      result.push(absolutePath);
    }
  }
  return result;
}

function sourceFiles(context) {
  const root = rootDir(context);
  return listFilesRecursive(root, (filePath) => {
    const relative = normalizeRelative(root, filePath);
    if (BPMN_FILE_PATTERN.test(relative)) return true;
    if (!/\.xml$/i.test(relative)) return false;
    const text = context.helpers.readTextIfExists(filePath);
    return Boolean(text && BPMN_CONTENT_PATTERN.test(text));
  }).sort();
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagLocalName(name) {
  return String(name || "").split(":").pop();
}

function parseAttributes(raw) {
  const attrs = {};
  for (const match of String(raw || "").matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[tagLocalName(match[1])] = xmlDecode(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function parseElementRecords(text, localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openClose = new RegExp(`<([A-Za-z_][\\w.-]*:)?${escaped}\\b(?![^>]*\\/\\s*>)([^>]*)>([\\s\\S]*?)<\\/([A-Za-z_][\\w.-]*:)?${escaped}>`, "gi");
  const selfClosing = new RegExp(`<([A-Za-z_][\\w.-]*:)?${escaped}\\b([^>]*)\\/\\s*>`, "gi");
  const records = [];
  for (const match of text.matchAll(openClose)) {
    records.push({ attrs: parseAttributes(match[2]), inner: match[3] || "", raw: match[0] });
  }
  for (const match of text.matchAll(selfClosing)) {
    records.push({ attrs: parseAttributes(match[2]), inner: "", raw: match[0] });
  }
  return records;
}

function parseProcessRecords(text) {
  return parseElementRecords(text, "process").filter((record) => record.attrs.id);
}

function parseNodeRecords(processInner) {
  const nodes = [];
  for (const localName of NODE_TYPES.keys()) {
    for (const record of parseElementRecords(processInner, localName)) {
      if (!record.attrs.id) continue;
      nodes.push({ ...record, localName });
    }
  }
  return nodes;
}

function parseSequenceFlows(processInner) {
  return parseElementRecords(processInner, "sequenceFlow")
    .filter((record) => record.attrs.id && record.attrs.sourceRef && record.attrs.targetRef)
    .map((record) => ({
      ...record,
      guard: conditionExpression(record.inner)
    }));
}

function conditionExpression(inner) {
  const condition = parseElementRecords(inner, "conditionExpression")[0];
  if (!condition) return null;
  const text = String(condition.inner || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function nodeLabel(node) {
  return node.attrs.name || titleCase(node.attrs.id);
}

function eventName(flow) {
  return idHintify(flow.attrs.name || flow.attrs.id).toUpperCase();
}

function stateTypeFor(node, initialNodeId) {
  if (node.attrs.id === initialNodeId) return "initial";
  return NODE_TYPES.get(node.localName) || "normal";
}

function workflowCandidatesForProcess(processRecord, relativeFile) {
  const processId = idHintify(processRecord.attrs.id || processRecord.attrs.name);
  const workflowId = `workflow_${processId}`;
  const nodes = parseNodeRecords(processRecord.inner);
  const flows = parseSequenceFlows(processRecord.inner);
  if (nodes.length === 0 && flows.length === 0) return null;

  const initialNode = nodes.find((node) => node.localName === "startEvent") || nodes[0] || null;
  const label = processRecord.attrs.name || titleCase(processRecord.attrs.id);
  const evidence = [{ file: relativeFile, reason: "BPMN 2.0 process definition" }];
  const workflow = {
    id_hint: workflowId,
    label,
    confidence: initialNode ? "high" : "medium",
    source_kind: "workflow_native",
    source_system: "bpmn",
    initial_state: initialNode ? idHintify(initialNode.attrs.id) : null,
    evidence,
    provenance: [`${relativeFile}#process.${processRecord.attrs.id}`]
  };

  const states = nodes.map((node) => ({
    id_hint: `${workflowId}_${idHintify(node.attrs.id)}`,
    workflow_id: workflowId,
    state_id: idHintify(node.attrs.id),
    label: nodeLabel(node),
    type: stateTypeFor(node, initialNode?.attrs.id),
    source_type: node.localName,
    confidence: "high",
    evidence: [{ file: relativeFile, reason: `BPMN ${node.localName} '${node.attrs.id}'` }],
    provenance: [`${relativeFile}#${node.localName}.${node.attrs.id}`]
  }));

  const transitions = flows.map((flow, index) => ({
    id_hint: `${workflowId}_${idHintify(flow.attrs.sourceRef)}_${idHintify(flow.attrs.targetRef)}_${index + 1}`,
    workflow_id: workflowId,
    from_state: idHintify(flow.attrs.sourceRef),
    to_state: idHintify(flow.attrs.targetRef),
    event: eventName(flow),
    label: flow.attrs.name || titleCase(flow.attrs.id),
    guard: flow.guard,
    source_type: "sequenceFlow",
    confidence: "high",
    evidence: [{ file: relativeFile, reason: `BPMN sequenceFlow '${flow.attrs.id}'` }],
    provenance: [`${relativeFile}#sequenceFlow.${flow.attrs.id}`]
  }));

  return { workflow, states, transitions };
}

function discover(context) {
  const root = rootDir(context);
  const findings = [];
  const diagnostics = [];
  const candidates = {
    workflow_definitions: [],
    workflow_states: [],
    workflow_transitions: []
  };

  for (const filePath of sourceFiles(context)) {
    const text = context.helpers.readTextIfExists(filePath);
    if (!text) continue;
    const relativeFile = normalizeRelative(root, filePath);
    try {
      const processes = parseProcessRecords(text);
      if (processes.length === 0) {
        diagnostics.push({
          severity: "warning",
          message: `BPMN source '${relativeFile}' did not contain a process with an id.`
        });
        continue;
      }
      for (const processRecord of processes) {
        const workflow = workflowCandidatesForProcess(processRecord, relativeFile);
        if (!workflow) continue;
        findings.push({
          kind: "bpmn_process_source",
          source: relativeFile,
          process_id: processRecord.attrs.id,
          state_count: workflow.states.length,
          transition_count: workflow.transitions.length
        });
        candidates.workflow_definitions.push(workflow.workflow);
        candidates.workflow_states.push(...workflow.states);
        candidates.workflow_transitions.push(...workflow.transitions);
      }
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        message: `Unable to parse BPMN source '${relativeFile}': ${error.message}`
      });
    }
  }

  return { findings, candidates, diagnostics };
}

exports.manifest = manifest;
exports.extractors = [{
  id: "workflows.bpmn",
  track: "workflows",
  detect(context) {
    const found = discover(context);
    const workflowCount = found.candidates.workflow_definitions.length;
    return {
      score: workflowCount > 0 ? Math.min(95, 65 + workflowCount * 10) : 0,
      reasons: workflowCount > 0
        ? [`${workflowCount} BPMN process${workflowCount === 1 ? "" : "es"} found`]
        : ["No local BPMN process definitions found"]
    };
  },
  extract(context) {
    const found = discover(context);
    return {
      findings: found.findings,
      candidates: found.candidates,
      diagnostics: found.diagnostics
    };
  }
}];
