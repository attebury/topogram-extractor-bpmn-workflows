# Extractor Pack Agent Guide

> Agent operating rules for maintaining the @topogram/extractor-bpmn-workflows extractor pack safely.

Status: current
Audience: coding agents and humans maintaining this extractor package
Use when: you are editing extractor detection, extraction, fixtures, package metadata, or verification in this repo.

This repository is a Topogram extractor pack for the `workflows` track. It reads
local BPMN 2.0 XML process definitions only.

## Rules

- Extractors are read-only. Do not mutate source app files.
- Do not write canonical `topo/**`, `topogram.project.json`, patches, adoption plans, or generated app output.
- Do not install packages or perform network access during detection or extraction.
- Return review-only `findings`, `candidates`, and `diagnostics`; Topogram core owns persistence, reconcile, adoption, and canonical writes.
- Keep candidate evidence project-relative and portable.
- Use scalar `stacks: ["framework"]` and `frameworks: ["tool"]` metadata buckets.
- Keep `llms.txt` and `llms-full.txt` current when README or agent guidance changes.
- Run `npm run check` before committing. It must prove extractor check, real fixture extraction, extract plan, query extract-plan, adopt list, docs RAG check, and unchanged fixture source.
- Run `npm run release:preflight` before publishing or sharing. It adds package dry-run and secret scanning to `npm run check`.

## Local Engine Testing

```bash
TOPOGRAM_CLI=/absolute/path/to/topogram/engine/src/cli.js npm run check
```

SDLC is recommended for shared or published extractor packs. If adopted, keep extractor rules and tasks in the package repo's `topo/` workspace so agents can query them.
