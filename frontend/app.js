/**
 * Interrepto Voice Client
 * ChatGPT-style UI | Audio-only AI responses | Instant voice interruption
 */

// ── Audio Engine ─────────────────────────────────────────
let audioCtx        = null;
let masterGain      = null;
let activeNodes     = [];
let audioQueue      = [];     // Array of AudioBuffer ready to play
let isPlaying       = false;
let isAiSpeaking    = false;  // Independent of mic state
let pendingFinal    = false;  // Tracks whether we're waiting for audio to finish

// ── WebSocket ────────────────────────────────────────────
let socket          = null;

// ── Mic / Speech ─────────────────────────────────────────
let recognizer      = null;
let isContinuous    = false;
let restartTimer    = null;
let lastBargeText   = "";
let isRecording     = false;

// ── DOM refs ─────────────────────────────────────────────
const orbWrapper     = document.getElementById("orb-wrapper");
const waveCanvas     = document.getElementById("wave-canvas");
const waveCtx        = waveCanvas.getContext("2d");
const statusText     = document.getElementById("status-text");
const interruptBadge = document.getElementById("interrupt-badge");
const userBubble     = document.getElementById("user-bubble");
const bubbleText     = document.getElementById("bubble-text");
const modelChip      = document.getElementById("model-chip");
const textInput      = document.getElementById("text-input");
const sendBtn        = document.getElementById("send-btn");
const micBtn         = document.getElementById("mic-btn");

// ── Init Web Audio (no fixed sampleRate — let browser pick default) ──
function initAudio() {
  if (!audioCtx) {
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// ── WebSocket ─────────────────────────────────────────────
// ── WebSocket ─────────────────────────────────────────────
function connectWS() {
  const BACKEND_URL = "https://interrepto-interrepti.onrender.com/";
  const proto = BACKEND_URL.startsWith("https") ? "wss:" : "ws:";
  const host = BACKEND_URL.replace(/^https?:\/\//, "");

  socket = new WebSocket(`${proto}//${host}/ws/voice`);

  socket.onopen = () => console.log("[WS] Connected");

  socket.onmessage = (ev) => {
    try {
      handleMsg(JSON.parse(ev.data));
    } catch (e) {
      console.error("[WS] Parse error:", e);
    }
  };

  socket.onerror = (ev) => console.error("[WS] Error:", ev);

  socket.onclose = (ev) => {
    console.log(`[WS] Disconnected (code=${ev.code}) — reconnecting in 2s...`);
    setTimeout(connectWS, 2000);
  };
}

// ── Handle server messages ────────────────────────────────
function handleMsg(msg) {
  if (msg.type === "cancel_audio") {
    // Only cut audio for intentional barge-in, not mic-off
    if (msg.reason === "user_barge_in" || msg.reason === "barge_in_mid_stream") {
      cutAudio(msg.latency_ms || 18, msg.reason || "barge_in");
    }

  } else if (msg.type === "thinking") {
    setOrbState(isContinuous ? "listening" : "idle");
    setStatus("Thinking...");

  } else if (msg.type === "audio_chunk") {
    if (msg.chunk_index === 0 || (msg.audio_base64 && !isAiSpeaking)) {
      isAiSpeaking = true;
      setOrbState("speaking");
      setStatus("Speaking...");
    }
    if (msg.audio_base64) {
      enqueueAudio(msg.audio_base64, msg.is_wav === true);
    }
    if (msg.is_final) {
      pendingFinal = true;
      waitForPlaybackComplete();
    }
  }
}

function waitForPlaybackComplete() {
  const checkDone = setInterval(() => {
    if (!isPlaying && audioQueue.length === 0 && pendingFinal) {
      clearInterval(checkDone);
      pendingFinal = false;
      isAiSpeaking = false;
      setOrbState(isContinuous ? "listening" : "idle");
      setStatus(isContinuous ? "Listening... speak or interrupt anytime" : "Tap the microphone to begin");
    }
  }, 200);
}

// ── Instant Audio Cut ────────────────────────────────────
function cutAudio(latencyMs, reason) {
  initAudio();

  // Stop all playing nodes immediately
  activeNodes.forEach(n => { try { n.stop(0); n.disconnect(); } catch(_) {} });
  activeNodes = [];
  audioQueue  = [];
  isPlaying   = false;
  isAiSpeaking = false;
  pendingFinal = false;

  // Brief gain dip to avoid pop
  masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  masterGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + 0.04);

  // Show interrupt badge only for intentional barge-in
  if (reason === "user_barge_in" || reason === "barge_in") {
    interruptBadge.classList.add("show");
    setTimeout(() => interruptBadge.classList.remove("show"), 1600);
    setOrbState("interrupted");
    setStatus(`Interrupted in ${Math.round(latencyMs)}ms — Listening...`);
  }
}

// ── Enqueue Audio (WAV or raw PCM) ───────────────────────
function enqueueAudio(b64, isWav) {
  initAudio();

  // Decode base64 → ArrayBuffer
  const raw  = atob(b64);
  const u8   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
  const arrayBuf = u8.buffer;

  if (isWav) {
    // Use decodeAudioData — handles WAV header + sample rate automatically
    audioCtx.decodeAudioData(arrayBuf.slice(0)).then(audioBuf => {
      audioQueue.push(audioBuf);
      if (!isPlaying) playNext();
    }).catch(err => {
      console.error("[Audio] decodeAudioData failed for chunk, skipping:", err.message);
      // Skip failed chunk but continue playing remaining queue
      if (!isPlaying && audioQueue.length) playNext();
    });
  } else {
    // Raw 16-bit PCM at 16000 Hz (fallback / emulated)
    const int16   = new Int16Array(arrayBuf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    const buf = audioCtx.createBuffer(1, float32.length, 16000);
    buf.copyToChannel(float32, 0);
    audioQueue.push(buf);
    if (!isPlaying) playNext();
  }
}

// ── Sequential Playback Queue ─────────────────────────────
function playNext() {
  if (!audioQueue.length) { isPlaying = false; return; }
  isPlaying = true;
  setOrbState("speaking");

  const buf  = audioQueue.shift();
  const src  = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(masterGain);
  activeNodes.push(src);

  src.onended = () => {
    const i = activeNodes.indexOf(src);
    if (i !== -1) activeNodes.splice(i, 1);
    playNext();
  };
  src.start(0);
}

// ── Send Query via WebSocket ──────────────────────────────
function sendQuery(text) {
  if (!text || !text.trim()) return;
  initAudio();
  const q = text.trim();
  showUserBubble(q);
  setOrbState("listening");
  setStatus("Thinking...");
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "user_speech", query: q, delay_tool: false }));
  }
}

// ── Orb Visual State ──────────────────────────────────────
function setOrbState(state) {
  orbWrapper.className = "orb-wrapper";
  if (state === "listening")   orbWrapper.classList.add("listening");
  if (state === "speaking")    orbWrapper.classList.add("speaking");
  if (state === "interrupted") orbWrapper.classList.add("interrupted");
}

function setStatus(msg) { statusText.textContent = msg; }

function showUserBubble(text) {
  bubbleText.textContent = text;
  userBubble.classList.add("show");
}

// ── Canvas Waveform Visualizer ────────────────────────────
function drawWave() {
  requestAnimationFrame(drawWave);
  const W = waveCanvas.width, H = waveCanvas.height;
  waveCtx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2, R = 58;
  const t   = Date.now() * 0.003;
  const amp = isPlaying ? 28 : (isRecording ? 18 : 5);
  const col = isPlaying ? "#ffffff" : (isRecording ? "#34d399" : "rgba(255,255,255,0.35)");

  waveCtx.strokeStyle = col;
  waveCtx.lineWidth   = 2.5;
  waveCtx.beginPath();
  const pts = 56;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const m = Math.sin(a * 4 + t) * amp * 0.5 + Math.cos(a * 2 - t * 1.5) * amp * 0.4;
    const r = R + m;
    i === 0 ? waveCtx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r)
            : waveCtx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
  }
  waveCtx.closePath();
  waveCtx.stroke();

  if (isPlaying || isRecording) {
    waveCtx.strokeStyle = isPlaying ? "rgba(96,165,250,0.5)" : "rgba(52,211,153,0.45)";
    waveCtx.lineWidth = 1.2;
    waveCtx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const m = Math.cos(a * 3 - t * 2) * (amp * 0.55);
      const r = R * 0.65 + m;
      i === 0 ? waveCtx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r)
              : waveCtx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
    }
    waveCtx.closePath();
    waveCtx.stroke();
  }
}

// ── Microphone (Web Speech API) ──────────────────────────
function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { setStatus("Speech recognition not supported in this browser."); return; }

  recognizer = new SR();
  recognizer.continuous     = true;
  recognizer.interimResults = true;
  recognizer.lang           = "en-US";

  recognizer.onstart = () => {
    isRecording = true;
    micBtn.classList.add("active");
    setOrbState("listening");
    setStatus("Listening... speak or interrupt anytime");
  };

  recognizer.onresult = (ev) => {
    // Ignore speech results when mic is not actively listening
    if (!isContinuous || !isRecording) return;

    let interim = "", final = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript.trim();
      ev.results[i].isFinal ? (final += t + " ") : (interim += t + " ");
    }
    const live = (final || interim).trim();
    if (!live) return;

    // Barge-in: only when mic is ON and AI is speaking (intentional interrupt)
    if (isContinuous && isRecording && isAiSpeaking && live.length > 2 && live !== lastBargeText) {
      lastBargeText = live;
      cutAudio(18, "barge_in");
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "barge_in", new_input: live }));
      }
      showUserBubble(live);
    }

    // Final clause → send new query (only when AI is NOT speaking)
    if (final.trim() && !isAiSpeaking) {
      lastBargeText = "";
      sendQuery(final.trim());
    }
  };

  recognizer.onerror = (ev) => {
    if (isContinuous && ev.error !== "not-allowed") {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (isContinuous) try { recognizer.start(); } catch(_) {}
      }, 300);
    }
  };

  recognizer.onend = () => {
    if (isContinuous) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (isContinuous) try { recognizer.start(); } catch(_) {}
      }, 150);
    } else {
      isRecording = false;
      micBtn.classList.remove("active");
      setOrbState("idle");
      setStatus("Tap the microphone to begin");
    }
  };
}

function toggleMic() {
  initAudio();
  if (isContinuous) {
    // Mic OFF — stop listening only, do NOT cancel AI response
    isContinuous = false;
    clearTimeout(restartTimer);
    lastBargeText = "";
    try { recognizer && recognizer.stop(); } catch(_) {}
    isRecording = false;
    micBtn.classList.remove("active");
    if (isAiSpeaking) {
      // AI is still speaking — leave it alone
      setStatus("Microphone off — AI still speaking...");
    } else {
      setOrbState("idle");
      setStatus("Microphone off — tap to resume");
    }
  } else {
    isContinuous = true;
    if (!recognizer) initMic();
    try { recognizer.start(); } catch(_) {}
    micBtn.classList.add("active");
    setOrbState("listening");
    setStatus("Listening... speak or interrupt anytime");
  }
}

// ── Status API ────────────────────────────────────────────
async function fetchStatus() {
  try {
    const BACKEND_URL = "https://interrepto-interrepti.onrender.com";

    const r = await fetch(`${BACKEND_URL}/api/status`);
    const d = await r.json();

    if (d.ai_provider && modelChip) {
      const live = d.ai_provider.live_api_connected ? "Live" : "Offline";
      modelChip.textContent =
        `${d.ai_provider.name} · ${d.ai_provider.model} · ${live}`;
    }
  } catch (_) {}
}

// ── Event Wiring ──────────────────────────────────────────
micBtn.addEventListener("click", toggleMic);

sendBtn.addEventListener("click", () => {
  const v = textInput.value.trim();
  if (v) { sendQuery(v); textInput.value = ""; }
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = textInput.value.trim();
    if (v) { sendQuery(v); textInput.value = ""; }
  }
});

// ── Boot ─────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  fetchStatus();
  connectWS();
  drawWave();
  initMic();
});
