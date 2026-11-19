import { planPair } from './plan.js';
import { loadLocalSaeProfile } from './sae-profile.js';

const [inventoryPath, outputPath, pairId] = process.argv.slice(2);
if (!inventoryPath || !outputPath || !pairId || process.argv.length !== 5) {
  console.error('Usage: local-preview <inventory path> <output directory> <pair ID> (run from the workspace root)');
  process.exitCode = 1;
} else {
  try {
    const profile = await loadLocalSaeProfile({ workspace: process.cwd(), inventoryPath, outputPath });
    console.log(JSON.stringify({
      inputSetId: profile.inputSetId,
      outputPath: profile.outputPath,
      planningReady: true,
      authoringReady: false,
      authoringFinding: 'Source passages and usage permissions have not been checked by this preview.',
      goldenPairId: profile.goldenPairId,
      documents: planPair(profile.kbId, profile.pairs, pairId)
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local SAE preview failed');
    process.exitCode = 1;
  }
}
