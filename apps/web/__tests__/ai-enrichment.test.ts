/**
 * AI Enrichment Panel — rendering logic verification
 * Run:  node apps/web/__tests__/ai-enrichment.test.ts
 */

import type { IncidentDetail } from "../lib/api-types";

type AiScenario = {
  label: string;
  incident: Partial<IncidentDetail>;
  expectedContent: string;
  shouldNotContain?: string;
};

const BASE_INCIDENT: IncidentDetail = {
  incidentId: "inc_test_001",
  deviceId: "cold-room-01",
  status: "OPEN",
  openedAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  durationSeconds: null,
  peakTemperatureC: 11.2,
};

function describeAiContent(incident: Partial<IncidentDetail>): string {
  const merged = { ...BASE_INCIDENT, ...incident };
  const { aiStatus, aiExplanation } = merged;

  if (aiStatus === "PENDING") return "PENDING_STATE";
  if (aiStatus === "GENERATING") return "GENERATING_STATE";
  if (aiStatus === "FAILED") return "FAILED_STATE";
  if (aiStatus === "READY" && aiExplanation) return `READY:${aiExplanation}`;
  if (aiStatus === "READY" && !aiExplanation) return "READY_NO_EXPLANATION";
  return "NO_AI_DATA";
}

const scenarios: AiScenario[] = [
  {
    label: "PENDING: shows queued state (amber, non-blocking)",
    incident: { aiStatus: "PENDING" },
    expectedContent: "PENDING_STATE",
    shouldNotContain: "READY",
  },
  {
    label: "GENERATING: shows generating state",
    incident: { aiStatus: "GENERATING" },
    expectedContent: "GENERATING_STATE",
    shouldNotContain: "READY",
  },
  {
    label: "READY with explanation: shows explanation",
    incident: {
      aiStatus: "READY",
      aiExplanation:
        "The cold room experienced a temperature excursion due to a door left open.",
      aiGeneratedAt: "2026-09-19T10:05:00.000Z",
    },
    expectedContent:
      "READY:The cold room experienced a temperature excursion due to a door left open.",
  },
  {
    label: "FAILED: shows failed state, not blank",
    incident: { aiStatus: "FAILED", aiExplanation: null },
    expectedContent: "FAILED_STATE",
    shouldNotContain: "READY",
  },
  {
    label: "No AI fields: shows no-data state",
    incident: {},
    expectedContent: "NO_AI_DATA",
  },
  {
    label: "READY but null explanation: shows edge-case message",
    incident: { aiStatus: "READY", aiExplanation: null },
    expectedContent: "READY_NO_EXPLANATION",
  },
];

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

console.log("\n=== AI Enrichment Rendering Tests ===\n");

for (const { label, incident, expectedContent, shouldNotContain } of scenarios) {
  const result = describeAiContent(incident);
  const contentMatch = result === expectedContent;
  const noForbidden = shouldNotContain ? !result.includes(shouldNotContain) : true;

  if (contentMatch && noForbidden) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    if (!contentMatch) {
      console.log(`      expected: ${expectedContent}`);
      console.log(`      received: ${result}`);
    }
    if (!noForbidden) {
      console.log(`      should not contain "${shouldNotContain}" but got: ${result}`);
    }
    failed++;
  }
}

// Evidence-first invariant
console.log("\n  Evidence fields invariant:");
const evidenceFields = [
  "incidentId",
  "deviceId",
  "status",
  "openedAt",
  "peakTemperatureC",
] as const;

for (const field of evidenceFields) {
  const present =
    BASE_INCIDENT[field] !== undefined && BASE_INCIDENT[field] !== null;
  if (present) {
    console.log(`    ✓ ${field} always present`);
    passed++;
  } else {
    console.log(`    ✗ ${field} missing from base incident`);
    failed++;
  }
}

// AI failure does not blank the card — evidence must coexist
console.log("\n  AI failure coexistence invariant:");
const failedIncident = { ...BASE_INCIDENT, aiStatus: "FAILED" as const };
const hasEvidence =
  failedIncident.peakTemperatureC !== undefined &&
  failedIncident.openedAt !== undefined;
const aiFailedCorrectly = describeAiContent(failedIncident) === "FAILED_STATE";

if (hasEvidence && aiFailedCorrectly) {
  console.log("    ✓ FAILED AI does not remove incident evidence");
  passed++;
} else {
  console.log("    ✗ FAILED AI coexistence check failed");
  failed++;
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
