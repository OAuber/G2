/**
 * ADR-001 Option B : seuil node global 1, seuil relevé à 2 si majorité personhood.
 */
export const WOT_NODE_CONFIG_V1 = {
  nodeMinCertifications: 1,
  nodeMinCertificationsNonKin: 2,
  nonKinMajorityThreshold: 0.5,
  /** TTL par défaut pour une annonce node (heures). */
  defaultNodeTtlHours: 168,
  maxGenUpDefault: 5,
} as const;
