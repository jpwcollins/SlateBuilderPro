export type BenchmarkWeeks = 2 | 4 | 6 | 12 | 26;

export type ClinicalFlags = {
  osa?: boolean;
  diabetes?: boolean;
  [key: string]: boolean | undefined;
};

export type PatientCase = {
  caseId: string;
  sourceKey: string;
  benchmarkWeeks: BenchmarkWeeks;
  timeToTargetDays: number;
  estimatedDurationMin: number;
  surgeonId: string;
  procedureName?: string;
  inpatient?: boolean;
  flags: ClinicalFlags;
};

export type ScoredCase = PatientCase & {
  urgencyWeight: number;
  overdueDays: number;
  riskScore: number;
  valueScore: number;
};

export type SlateResult = {
  blockMinutes: number;
  totalMinutes: number;
  utilizationPct: number;
  totalRiskScore: number;
  utilizationWeight: number;
  selected: ScoredCase[];
  remaining: ScoredCase[];
};
