# Interrepto-Interrepti
Natural interruptions for AI voice agents (an additional feature to chat gpt).

## Purpose
Most voice agents make you wait until they finish speaking before you can correct them. Interrepto-Interrepti lets you interrupt mid-sentence. The agent stops immediately, understands your correction, and responds without losing context.
Example:
- You: "What's the weather in Mum-"
- Agent: (starts responding) "The weather in Mu-"
- You: "Actually, Delhi."
- Agent: (stops within 300ms) "For Delhi, it's 35 degrees."
  
## Importance
Half-duplex conversations feel robotic. Full-duplex with proper barge-in handling is what separates a demo from something people actually want to use. We built this because waiting for a voice agent to finish a wrong answer is frustrating.

## Working
Three things need to happen when you interrupt:
1. Detect it fast (under 100ms) - We use client-side voice activity detection and audio energy thresholding in the browser
2. Stop the TTS (under 300ms) - Rime's streaming API lets us cancel mid-sentence and clear queued audio
3. Reconcile state - Track what the user actually said versus what the agent started responding to, then regenerate
The state manager is key here. Without it, you get agents that stop speaking but then read out stale tool results or ignore your correction.

## Tech Stack
- LiveKit Agents (version 1.7+) - Full-duplex audio, WebRTC, turn handling
- Rime AI (Arcana model) - TTS, low latency, natural voices
- AssemblyAI - STT
- Groq - LLM (Llama-3.3-70B)
- Python 3.10+ - Backend
- Vanilla JS - Frontend (no framework needed)

## Quick start

### Cloning and installing
```bash
git clone [https://github.com/yourusername/interrepto-interrepti.git](https://github.com/yourusername/interrepto-interrepti.git)
cd interrepto-interrepti
pip install -r requirements.txt
```

### Setting up environment
Copy .env.example to .env and fill in your API keys:
```env
RIME_API_KEY=your_rime_api_key
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_URL=wss://your-project.livekit.cloud
ASSEMBLYAI_API_KEY=your_assemblyai_key
GROQ_API_KEY=your_groq_key
```

### Run it
```bash
# Terminal 1: Backend
python src/agent_worker.py

# Terminal 2: Frontend
cd src/web_demo
python -m http.server 8000
```
Open http://localhost:8000, click Start, and try interrupting the agent mid-sentence.

## Testing
Run the test suite:
```bash
python tests/test_suite.py
```

You should see:
TTFA: 380ms - PASS
Interruption latency: 245ms - PASS
TTS cancellation: PASS
State consistency: PASS

If any test fails, check the logs. Usually it's an API key issue or the interruption threshold needs tuning.

## Tuning interruption sensitivity
If the agent interrupts on background noise or misses your interruptions, adjust these in src/interruption_handler.py:
```python
INTERRUPTION_CONFIG = {
    "vad_threshold": 0.5,      # Lower = more sensitive
    "rms_threshold": 0.3,      # Lower = more sensitive
    "confirmation_frames": 3,  # Higher = fewer false positives
}
```
Start with the defaults. If you're in a noisy environment, bump rms_threshold to 0.4. If it's missing interruptions, drop it to 0.2.

## Limitations
- Browser-only for now - No mobile app or telephony yet
- English-only - Rime supports other languages, but we haven't tested code-switching thoroughly
- Single user - This is a demo, not production-scale

## Future scope
If you want to extend this:
- Add real tools - Replace fake_equipment_lookup() in src/tools.py with actual API calls
- Telephony - Plug into Twilio or LiveKit SIP for phone-based interruption testing
- Multilingual - Test Rime's Hindi/Spanish voices and adjust prompting for code-switching

## License
MIT. Use it, break it, fix it.
