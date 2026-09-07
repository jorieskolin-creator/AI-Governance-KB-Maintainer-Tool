import { validateResponsibilityMap } from './responsibility-map.js';

async function main(): Promise<void> {
  const summary = await validateResponsibilityMap();
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        responsibilityMapVersion: summary.version,
        capabilityLeafFields: summary.capabilityLeafFields,
        antipatternLeafFields: summary.antipatternLeafFields,
        commonResponsibilities: summary.commonResponsibilities,
        semanticRelationships: summary.semanticRelationships
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
