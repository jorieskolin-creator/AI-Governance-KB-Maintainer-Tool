import { createDocumentPlan } from './plan.js';
import { buildProfileFromInventoryFile, buildSaeLocalPilotProfile, resolveProfileInputSet } from './profiles.js';
import { prepareSourcesForPlan } from './sources.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let pairId = 'PAIR-A2';
  let customInventoryPath: string | undefined;
  let customOutputRoot: string | undefined;

  if (args.length === 1) {
    pairId = args[0]!;
  } else if (args.length === 3) {
    [customInventoryPath, customOutputRoot, pairId] = args as [string, string, string];
  } else if (args.length !== 0) {
    console.error(
      'Usage: local-preview [<pairId>] OR local-preview <inventoryPath> <outputRoot> <pairId>'
    );
    process.exitCode = 1;
    return;
  }

  const workspaceRoot = process.cwd();
  const profile = customInventoryPath && customOutputRoot
    ? await buildProfileFromInventoryFile({
        workspaceRoot,
        inventoryPath: customInventoryPath,
        profileId: 'local-preview-profile',
        kbId: 'solution-assurance-engine',
        kbTitle: 'Solution Assurance Engine Knowledge Base',
        outputRoot: customOutputRoot
      })
    : await buildSaeLocalPilotProfile(workspaceRoot);

  const runtime = await resolveProfileInputSet({ workspaceRoot, profile });
  if (!runtime.inputSet.readiness.planning_ready) {
    console.error(JSON.stringify({ ready: false, findings: runtime.inputSet.readiness.findings }, null, 2));
    process.exitCode = 1;
    return;
  }

  const plan = createDocumentPlan(runtime, {
    mode: 'pair',
    pair_ids: [pairId],
    include_tactics: false
  });

  const sourceBundle = await prepareSourcesForPlan({
    workspaceRoot,
    runtime,
    plan,
    enableUrlAcquisition: false
  });

  console.log(
    JSON.stringify(
      {
        input_set_id: runtime.inputSet.input_set_id,
        readiness: runtime.inputSet.readiness,
        golden_reference: runtime.inputSet.golden_reference,
        applied_owner_decisions: runtime.inputSet.applied_owner_decisions,
        plan,
        pair_baselines: sourceBundle.pair_baselines,
        source_readiness: sourceBundle.readiness
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
