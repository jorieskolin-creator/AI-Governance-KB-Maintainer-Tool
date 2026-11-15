# Next Plan: KB Document Creator scope refinement

Date: 14 November 2026  
Plan version: 1.1 — Vercel inputs and owner-supplied reference case

Audience: Augment Code and the repository owner  
Reviewed starting point: `b02a4bc9ad8507295505134cad42d20dc592fa69`

## Start here

Refine this repository into **KB Document Creator**: a focused application that creates source-supported, human-readable knowledge-base documents from a supplied input baseline and stores them in an agreed taxonomy-based structure.

The owner has selected a three-tool architecture:

| Tool | Owns | Does not own |
| --- | --- | --- |
| KB Document Creator — this repository | Input validation, source preparation, authoring, document review, targeted correction, rendering, and delivery | Source Register authoring/maintenance, Master Table creation or maintenance, consumer retrieval |
| Master Table Creator — separate tool | Reading an existing document collection and producing a proposed Master Table JSON | Authoring the source documents or silently approving their use |
| Solution Knowledge Hub — separate tool | Importing and maintaining Master Table JSON, document eligibility, retrieval, Package delivery | Running KB Document Creator as a prerequisite for retrieval |

The consuming analysis solution reads Packages from its Knowledge Hub. It does not read KB Document Creator's database or storage directly. These are independent tools with explicit handoffs, not one mandatory execution pipeline.

## Decisions in this plan

- **Markdown (`.md`) is the primary delivered document format.** HTML is a sanitized UI preview, not another KB source. PDF is an optional later rendition generated from the same reviewed content.
- **Vercel is the production input and output store. Google Drive is not used.** The owner prepares the folders/prefixes and places the input files there before a creation run. Creator reads those files and writes only to the configured output/operations areas.
- The first implementation/reference case is the owner’s **Solution Assessment Engine** KB, using the supplied SAE materials, some of which may be titled Solution Assurance Engine. Preserve actual supplied names and IDs; do not silently rename them.
- Inputs are the owner-supplied Source Register, cognitive model, taxonomy with criteria per capability/anti-pattern, linked Tactic Playbook, schemas, and **one Golden Reference capability/anti-pattern pair**, all resolved from Vercel.
- Augment Code receives representative copies from the owner to design and test input adapters. These development samples define the standardized input contracts; production reads the configured Vercel versions, not developer uploads or bundled repository copies.
- The owner has confirmed the supplied SAE Tactic Playbook is final. Older incomplete-approval wording is not a blocker. Record this decision against the supplied version/hash, preserve original bytes, and validate the actual links without imposing a new approval process.
- Source Register entries alone are not sufficient grounding. The Creator needs usable source content, exact locators, and recorded usage boundaries.
- One capability and one anti-pattern are separate output documents, optionally authored and reviewed together. Tactic documents are separate, created only when requested in the output plan.
- Schema-defined internal data is permitted. Canonical JSON KB publication is not a product requirement. Operational manifests are technical receipts, not a Master Table.
- Creation review permits delivery of the reviewed bytes. It does not grant Hub approval, legal assurance, customer findings, or tactic activation.
- Existing domain assets and useful components are reused selectively; the old 14-task control plane is retired only after the new path is proven.
- No changes to deployed data, governed baselines, or historical Golden fixtures are authorized by the existence of this plan alone. Implementation uses additive changes and the task boundaries below.

## Reading order

1. [Implementation plan](01-Implementation-Plan.md): product boundaries, architecture, workflow, migration, and delivery strategy.
2. [Input, document, and storage contracts](02-Contracts.md): precise content and handoff rules.
3. [Augment implementation tasks](03-Augment-Tasks.md): ordered work packages, allowed changes, acceptance checks, and deletion boundaries.
4. [Validation and acceptance](04-Validation-and-Acceptance.md): fixtures, live evaluation, and evidence required for completion.
5. [Storage readiness and sample onboarding](06-Storage-and-Sample-Onboarding.md): owner-prepared Vercel layout, sample-to-contract mapping, and startup checks.
6. [Augment kickoff prompt](05-Augment-Kickoff.md): copy into Augment Code to begin with DC-00.

## Authority and legacy instructions

This folder records the owner's revised product scope and is the implementation reference for the KB Document Creator transition. The September lifecycle-control plan remains historical context, not the specification for this transition. Root `AGENTS.md` contains the routing note that makes this distinction explicit.

For Creator tasks, use this README, the contracts, the current DC task brief, and the acceptance matrix together. Where these files conflict, record the discrepancy and resolve it before dependent work; do not silently pick the easier interpretation. User decisions take precedence.

Do not infer the status, completeness, or authority of the future supplied documentation from older files in this repository. This plan specifies the future workflow and contracts, not an inventory or evaluation of documentation produced so far. The owner-supplied Vercel input set and recorded owner decisions define the reference case.

Retain the useful legacy safeguards: no fabricated source support, no model-owned approval, no secrets in Git, no editing applied migrations, and immutable historical fixtures. Replace the old product-specific obligations for mandatory Git-to-Drive mirroring, JSON KB publication, full-domain approval, and register-maintenance UI with the boundaries in this plan.

## What has and has not happened

This commit supplies a plan and agent routing only. It does not implement KB Document Creator, migrate production, create a Master Table, or approve any KB content. Proposed filenames, commands, API routes, and data contracts in these documents are implementation targets unless explicitly described as existing.

No fixed delivery date is promised. Measure the first fresh pair end to end before estimating the remaining work or scaling the corpus.
