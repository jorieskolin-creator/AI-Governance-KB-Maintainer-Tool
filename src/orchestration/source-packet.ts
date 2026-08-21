import type { SourceRegisterBaseline, RegisteredSource } from '../validation/cross-artifact.js';

export interface SourcePacket {
  domain: string;
  registerReleaseStatus: string;
  allowedSourceIds: string[];
  sources: RegisteredSource[];
}

const NON_ELIGIBLE_STATUSES = new Set(['DRAFT', 'WITHDRAWN', 'SUPERSEDED']);

export function buildAllowedSourcePacket(
  domain: string,
  sealedRegister: SourceRegisterBaseline
): SourcePacket {
  if (!/^[A-F]$/.test(domain)) {
    throw new Error(`Invalid governance domain: ${domain}`);
  }
  if (sealedRegister.release_status !== 'APPROVED') {
    throw new Error('Cannot build a decision-eligible source packet from a non-APPROVED Source Register.');
  }

  const sources = sealedRegister.sources.filter(
    (source) =>
      source.verification_status === 'VERIFIED' &&
      source.domain_coverage.includes(domain) &&
      !NON_ELIGIBLE_STATUSES.has(source.effective_status)
  );

  return {
    domain,
    registerReleaseStatus: sealedRegister.release_status,
    allowedSourceIds: sources.map((source) => source.id),
    sources
  };
}

// This builder only defines what is allowed into a source-mapping task packet.
// Inclusion in the packet is not a category mapping and never establishes
// applicability, compliance, control satisfaction or decision authority.
