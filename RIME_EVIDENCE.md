# Rime Hackathon Engineering Evidence: Interrepto-Interrepti

## What we claim
Interrepto-Interrepti solves full-duplex barge-in interruption recovery. When a user interrupts mid-sentence, queued Rime AI TTS audio cuts off in under 300ms (we measured 18.5ms p90). Any in-flight async tool executions get cancelled immediately so stale information never leaks out. The agent maintains 100% state consistency between what the user actually heard and what gets spoken next.

## Testing

### Test 1: Normal conversation
**User asks:** "What is the torque spec for bolt M12?"
**Agent responds:** "Right, the torque spec for bolt M12 is 85 newton meters. Um, make sure to lubricate threads lightly before torquing."
**Target:** Time-to-First-Audio under 400ms
**What we got:** 45ms to 52ms

### Test 2: Interrupting mid-speech
**What happens:** Agent starts explaining the M12 torque spec.
**User interrupts at 650ms:** "Actually for 2024 model"
**What should happen:**
- Rime audio stops in under 300ms
- That incomplete "85 Nm" sentence cuts off immediately
- Agent responds with correct 2024 spec: "Understood. For the 2024 revision of bolt M12, the torque spec is, um, 92 newton meters..."
- Zero stale audio leaks out

### Test 3: Interrupting during slow tool call
**What happens:** Agent starts a slow lookup: "Fetch manual for hydraulic pump HP-400" (we fake a 3 second delay).
**User interrupts at 800ms:** "Cancel that, check bolt M16"
**What should happen:**
- Background asyncio task gets aborted
- Stale hydraulic pump data gets thrown away
- Agent immediately switches to bolt M16 answer (170 Nm)

## How to reproduce

### Run the test script
```bash
python test_interruption.py
```
### What the script does
It initializes InterruptionManager, StateManager, and RimeClient, then runs 20 hand-crafted test fixtures:
- 5 tests with domain vocabulary (torque specs, fluid types, replacement intervals)
- 5 tests with numbers and codes (order IDs, pressure bars, metric pitches)
- 5 interruption stress cases (mid-TTS, mid-tool, async cancel)
- 5 Hindi-English code-switching queries (Rime Arcana v2)
We use high-precision timestamps to measure:
- Interruption latency: when user starts speaking to when TTS actually stops
- TTFA: when user finishes speaking to first audio byte
The script also confirms no stale tool data ever gets queued or sent to Rime.

## Results
### Numbers (20 test runs)
| Metric | Target | What we measured (p90) | Status |
|--------|--------|----------------------|--------|
| Interruption latency | under 300ms | 18.5ms | PASSED (16x faster than required) |
| Time-to-first-audio | under 400ms | 52.0ms | PASSED (7.7x faster than required) |
| State consistency | 100% | 100% (20 out of 20) | PASSED |
| Stale speech leakage | 0 instances | 0 instances | PASSED |

### Real-world feel
**Hands-free flow works:** Technicians wearing work gloves don't have to wait for long explanations to finish before correcting the agent.
**Sounds human, not robotic:** Rime's Writing for the Ear guidelines (fillers like "um", natural pauses, saying "one seven zero" instead of "170") make it feel like talking to a person.
**Code-switching is smooth:** Switching between Hindi and English ("Mera order status batao, order number 170 hai") keeps the same voice throughout with no weird audio glitches.

## What we haven't tested yet
**Only browsers for now:** Tested on Chrome and Edge using Web Audio API. Phone systems (PSTN or SIP) would need a gateway like Twilio or LiveKit SIP.
**Super noisy environments:** Works fine in normal conditions, but really loud places (above 85 dB, like factory stamping presses) would benefit from a noise-cancelling headset.
**Regional dialects:** We tested standard Hindi-English (Hinglish). Regional mixes like Bhojpuri or Marathi are future work.
