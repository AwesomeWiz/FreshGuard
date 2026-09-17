# Risk Register

## 1. Purpose

Track risks that can prevent submission or create misleading claims.

| Risk | Probability | Impact | Mitigation | Trigger/cut decision |
|---|---:|---:|---|---|
| IoT certificate setup consumes too much time | Medium | High | Follow minimal one-device runbook; verify with IoT test client first | If blocked for hours, diagnose IAM/cert/topic before building more services |
| Bedrock model access unavailable | Medium | Medium | Keep AI async; switch to another accessible Bedrock model | Never block P0 incident path |
| Amplify/Next deployment issue | Medium | High | Deploy basic page early on Day 2 | Use simplest supported Next configuration; avoid exotic server features |
| Duplicate async invocation creates duplicate incident | Medium | High | Conditional writes/idempotency tests | Must fix before recording |
| SNS email not confirmed | Medium | Medium | Subscribe/confirm early | Demo CloudWatch alert evidence only as fallback, but real SNS preferred |
| CORS breaks deployed UI | High | Medium | Test Amplify origin immediately after deployment | Fix before UI polish |
| Too many features | High | High | Follow priority ladder | Cut P1/P2 immediately if Day-2 exit criteria slips |
| Hardware temptation | Low/Medium | High | Explicitly no hardware P0 | Do not buy/integrate during hackathon |
| Unsupported food-safety claims | Medium | High | Use “configured excursion” language | Remove any universal safety/health claims |
| Secret/certificate committed | Low/Medium | Critical | `.gitignore`, secret scan, peer review | Rotate certificate immediately if leaked |
| Repository violates event timing | Low | Critical | New project only during event; preserve honest history | Do not import old project code/history |
| Demo relies on AI response time | Medium | Medium | Incident renders before AI; show loading state | Record only after AI path validated |
| Dashboard polish delays backend | High | High | Mock UI in parallel, prioritize core path | No animation/theme work before Day-2 flow |
| Current state polluted by prior test incident | High | Medium | private reset script + pre-record checklist | Reset before every recording |
| AWS spend unexpectedly grows | Low | Medium | publish-rate cap, TTL, no public mutation/AI API | Stop simulator/tear down resource |

## 2. Highest-priority risks

### A. Core pipeline not finished by Day 2

Response: cut all P1/P2; no new AWS service; finish one flow.

### B. Duplicate incident/alert behavior

Response: prioritize idempotency above AI/UI enhancements.

### C. Bedrock dependency accidentally placed in critical path

Response: architecture violation; refactor so event persists/alerts independently.

### D. Security leak

Response: rotate compromised credentials/certificates and rewrite/remove from Git history as needed before public submission.
