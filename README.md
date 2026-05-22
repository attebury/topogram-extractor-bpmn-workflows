# @topogram/extractor-bpmn-workflows

> Package-backed Topogram extractor for local BPMN 2.0 workflow definitions.

Status: current
Audience: extractor authors and maintainers
Use when: you need to extract review-only workflow candidates from checked-in BPMN process files.

This extractor reads local `.bpmn` and `.bpmn.xml` files and returns
review-only Topogram workflow candidates. It does not call Camunda, Flowable,
Activiti, Zeebe, or other workflow-engine APIs. It does not load credentials,
inspect execution history, mutate source files, or write canonical `topo/**`
records.

## Author Loop

```bash
npm install
npm test
npm run docs:rag:check
TOPOGRAM_CLI=/path/to/topogram/engine/src/cli.js npm run check
npm run release:preflight
```

`npm run check` runs:

- adapter unit tests;
- docs/RAG checks;
- `topogram extractor check .`;
- package-backed extraction against `fixtures/basic-source`;
- `topogram extract plan`;
- `topogram query extract-plan`;
- `topogram adopt --list`;
- fixture mutation guard.

## Extracted Evidence

The extractor scans checked-in local files such as:

- `*.bpmn`
- `*.bpmn.xml`
- XML files containing BPMN `definitions` or `process` records.

It emits:

- `workflow_definitions`
- `workflow_states`
- `workflow_transitions`

Workflow candidates come from BPMN `process` records. State candidates come
from events, tasks, gateways, subprocesses, and call activities. Transition
candidates come from `sequenceFlow` records, including condition expressions
when present.

## Boundaries

V1 is intentionally local and deterministic:

- no workflow-engine API calls;
- no credential loading;
- no deployed process discovery;
- no runtime-history inspection;
- no process diagram rendering;
- no source mutation;
- no adoption semantics in the package.

Camunda/Flowable/Activiti extensions, Zeebe deployment metadata, engine
histories, and generated diagrams are future scope unless they can be recovered
from local source files without credentials or source mutation.

Topogram core owns normalization, persistence, reports, extract plans, adoption,
and canonical workflow records.
