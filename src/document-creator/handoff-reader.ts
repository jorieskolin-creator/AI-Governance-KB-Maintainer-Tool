export interface StandaloneParsedSection {
  section_id: string;
  section_code: string;
  title: string;
  prose: string;
  bullets: string[];
}

export interface StandaloneParsedQuestion {
  id: string;
  dimension: string;
  question: string;
  assessment_guidance: string;
}

export interface StandaloneParsedRelatedLink {
  target_object_id: string;
  relationship_kind: string;
  meaning: string;
}

export interface StandaloneParsedTacticRow {
  tactic_id: string;
  title: string;
  version: string;
  effective_status: string;
  provenance: string;
  completion_effect: string;
  activation_authority: string;
  scope_and_boundary: string;
}

export interface StandaloneParsedClaim {
  claim_id: string;
  support_state: string;
  authority_distinction: string;
  statement: string;
  applicability: string;
  attribution: string;
}

export interface StandaloneParsedBibliographyRow {
  source_id: string;
  title: string;
  edition_version: string;
  authority: string;
  origin_and_locator: string;
  extraction_status: string;
  usage_policy_and_limitations: string;
}

export interface StandaloneParsedMarkdownDocument {
  front_matter: Record<string, string | boolean>;
  has_unsafe_yaml_tags: boolean;
  heading_object_id: string;
  heading_title: string;
  metadata_table: Record<string, string>;
  sections: StandaloneParsedSection[];
  questions: StandaloneParsedQuestion[];
  related_links: StandaloneParsedRelatedLink[];
  tactics: StandaloneParsedTacticRow[];
  sourced_claims: StandaloneParsedClaim[];
  methodology_interpretations: Array<{ interpretation_id: string; statement: string }>;
  unresolved_items: string[];
  bibliography: StandaloneParsedBibliographyRow[];
}

function stripBackticks(cell: string): string {
  return cell.trim().replace(/^`+|`+$/g, '').trim();
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  const inner = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === '\\' && i + 1 < inner.length && inner[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseMarkdownTables(block: string): string[][][] {
  const lines = block.split('\n');
  const tables: string[][][] = [];
  let currentTable: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = splitMarkdownTableRow(trimmed);
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
      if (!isSeparator && cells.length > 0) {
        currentTable.push(cells);
      }
    } else if (currentTable.length > 0) {
      tables.push(currentTable);
      currentTable = [];
    }
  }
  if (currentTable.length > 0) {
    tables.push(currentTable);
  }
  return tables;
}

/**
 * Independent parser that inspects a delivered `.md` document file without using Creator's internal
 * `CreatorDocument` model or UI (`04-Validation-and-Acceptance.md` §4).
 */
export function parseStandaloneDeliveredMarkdown(
  rawMarkdown: string
): StandaloneParsedMarkdownDocument {
  const normalized = rawMarkdown.replace(/\r\n/g, '\n');
  const frontMatter: Record<string, string | boolean> = {};
  let hasUnsafeYamlTags = false;
  let bodyText = normalized;

  if (normalized.startsWith('---\n')) {
    const endIdx = normalized.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      const yamlBlock = normalized.slice(4, endIdx);
      bodyText = normalized.slice(endIdx + 5);
      for (const line of yamlBlock.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/:\s*!/.test(trimmed)) {
          hasUnsafeYamlTags = true;
        }
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const rawVal = trimmed.slice(colonIdx + 1).trim();
        if (rawVal === 'true') {
          frontMatter[key] = true;
        } else if (rawVal === 'false') {
          frontMatter[key] = false;
        } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
          try {
            frontMatter[key] = JSON.parse(rawVal) as string;
          } catch {
            frontMatter[key] = rawVal.slice(1, -1);
          }
        } else {
          frontMatter[key] = rawVal;
        }
      }
    }
  }

  const h1Match = bodyText.match(/^#\s+([A-Za-z0-9_-]+)\s+—\s+(.+)$/m);
  const headingObjectId = h1Match?.[1]?.trim() ?? '';
  const headingTitle = h1Match?.[2]?.trim() ?? '';

  // Split level-2 sections (`## <OBJECT_ID>.<CODE> — <Title>`).
  const h2Regex = /^##\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s+—\s+(.+)$/gm;
  const h2Matches: Array<{
    sectionId: string;
    title: string;
    headerStart: number;
    bodyStart: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = h2Regex.exec(bodyText)) !== null) {
    h2Matches.push({
      sectionId: match[1]!.trim(),
      title: match[2]!.trim(),
      headerStart: match.index,
      bodyStart: match.index + match[0].length
    });
  }

  const preambleText = h2Matches.length > 0 ? bodyText.slice(0, h2Matches[0]!.headerStart) : bodyText;
  const preambleTables = parseMarkdownTables(preambleText);
  const metadataTable: Record<string, string> = {};
  if (preambleTables[0] && preambleTables[0].length > 1) {
    for (const row of preambleTables[0].slice(1)) {
      if (row.length >= 2 && row[0]) {
        metadataTable[row[0]] = row[1] ?? '';
      }
    }
  }

  const sections: StandaloneParsedSection[] = [];
  const questions: StandaloneParsedQuestion[] = [];
  const relatedLinks: StandaloneParsedRelatedLink[] = [];
  const tactics: StandaloneParsedTacticRow[] = [];
  const sourcedClaims: StandaloneParsedClaim[] = [];
  const methodologyInterpretations: Array<{ interpretation_id: string; statement: string }> = [];
  const unresolvedItems: string[] = [];
  const bibliography: StandaloneParsedBibliographyRow[] = [];

  for (let i = 0; i < h2Matches.length; i += 1) {
    const cur = h2Matches[i]!;
    const end = i + 1 < h2Matches.length ? h2Matches[i + 1]!.headerStart : bodyText.length;
    const rawSecBody = bodyText.slice(cur.bodyStart, end).trim();
    const dotIdx = cur.sectionId.indexOf('.');
    const sectionCode = dotIdx !== -1 ? cur.sectionId.slice(dotIdx + 1) : cur.sectionId;

    if (sectionCode === 'BIB') {
      const bibTables = parseMarkdownTables(rawSecBody);
      if (bibTables[0] && bibTables[0].length > 1) {
        for (const row of bibTables[0].slice(1)) {
          if (row.length >= 7) {
            bibliography.push({
              source_id: stripBackticks(row[0]!),
              title: row[1]!,
              edition_version: stripBackticks(row[2]!),
              authority: stripBackticks(row[3]!),
              origin_and_locator: row[4]!,
              extraction_status: stripBackticks(row[5]!),
              usage_policy_and_limitations: row[6]!
            });
          }
        }
      }
      continue;
    }

    // Extract top-level prose and bullets before the first `### ` or table in this section.
    const firstSubIdx = rawSecBody.search(/^###\s+|^\|/m);
    const primaryChunk =
      firstSubIdx !== -1 ? rawSecBody.slice(0, firstSubIdx).trim() : rawSecBody;
    const proseLines: string[] = [];
    const bullets: string[] = [];

    for (const line of primaryChunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('- ')) {
        bullets.push(trimmed.slice(2).trim());
      } else if (!trimmed.startsWith('*Questions:') && !trimmed.startsWith('*Source citations:')) {
        proseLines.push(trimmed);
      }
    }

    sections.push({
      section_id: cur.sectionId,
      section_code: sectionCode,
      title: cur.title,
      prose: proseLines.join('\n'),
      bullets
    });

    if (sectionCode === 'CRI') {
      const criTables = parseMarkdownTables(rawSecBody);
      if (criTables[0] && criTables[0].length > 1) {
        for (const row of criTables[0].slice(1)) {
          if (row.length >= 4) {
            questions.push({
              id: stripBackticks(row[0]!),
              dimension: stripBackticks(row[1]!),
              question: row[2]!,
              assessment_guidance: row[3]!
            });
          }
        }
      }
    }

    if (sectionCode === 'REL' || sectionCode === 'MAP') {
      const relTables = parseMarkdownTables(rawSecBody);
      for (const tbl of relTables) {
        if (tbl[0]?.[0]?.includes('Target Object')) {
          for (const row of tbl.slice(1)) {
            if (row.length >= 3) {
              relatedLinks.push({
                target_object_id: stripBackticks(row[0]!),
                relationship_kind: stripBackticks(row[1]!),
                meaning: row[2]!
              });
            }
          }
        }
      }
    }

    if (sectionCode === 'TAC' || sectionCode === 'MAP') {
      const tacTables = parseMarkdownTables(rawSecBody);
      for (const tbl of tacTables) {
        if (tbl[0]?.[0]?.includes('Tactic ID')) {
          for (const row of tbl.slice(1)) {
            if (row.length >= 8) {
              tactics.push({
                tactic_id: stripBackticks(row[0]!),
                title: row[1]!,
                version: stripBackticks(row[2]!),
                effective_status: stripBackticks(row[3]!),
                provenance: stripBackticks(row[4]!),
                completion_effect: stripBackticks(row[5]!),
                activation_authority: stripBackticks(row[6]!),
                scope_and_boundary: row[7]!
              });
            }
          }
        }
      }
    }

    if (sectionCode === 'SRC') {
      const claimMatches = [
        ...rawSecBody.matchAll(
          /-\s+\*\*`([^`]+)`\s+\[([^\]]+)\]:\*\*\s+([^\n]+)\n\s+-\s+Applicability:\s+([^\n]+)\n\s+-\s+Attribution:\s+([^\n]+)/g
        )
      ];
      for (const m of claimMatches) {
        const stateParts = m[2]!.split('·').map((s) => s.trim());
        sourcedClaims.push({
          claim_id: m[1]!.trim(),
          support_state: stateParts[0] ?? 'UNRESOLVED',
          authority_distinction: stateParts[1] ?? 'UNRESOLVED_SOURCE_BASIS',
          statement: m[3]!.trim(),
          applicability: m[4]!.trim(),
          attribution: m[5]!.trim()
        });
      }

      const interpMatches = [
        ...rawSecBody.matchAll(
          /-\s+\*\*`([^`]+)`\s+\[METHODOLOGY_INTERPRETATION\]:\*\*\s+([^\n]+)/g
        )
      ];
      for (const m of interpMatches) {
        methodologyInterpretations.push({
          interpretation_id: m[1]!.trim(),
          statement: m[2]!.trim()
        });
      }
    }

    if (sectionCode === 'REV') {
      const unresIdx = rawSecBody.indexOf('### Unresolved Items');
      if (unresIdx !== -1) {
        const unresChunk = rawSecBody.slice(unresIdx + '### Unresolved Items'.length).trim();
        for (const line of unresChunk.split('\n')) {
          const t = line.trim();
          if (t.startsWith('- ') && t !== '- None recorded.') {
            unresolvedItems.push(t.slice(2).trim());
          }
        }
      }
    }
  }

  return {
    front_matter: frontMatter,
    has_unsafe_yaml_tags: hasUnsafeYamlTags,
    heading_object_id: headingObjectId,
    heading_title: headingTitle,
    metadata_table: metadataTable,
    sections,
    questions,
    related_links: relatedLinks,
    tactics,
    sourced_claims: sourcedClaims,
    methodology_interpretations: methodologyInterpretations,
    unresolved_items: unresolvedItems,
    bibliography
  };
}
