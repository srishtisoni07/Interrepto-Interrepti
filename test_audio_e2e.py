import asyncio, websockets, json, base64

async def test():
    uri = "ws://127.0.0.1:8001/ws/voice"
    async with websockets.connect(uri) as ws:
        print("Connected to WS")
        await ws.send(json.dumps({
            "type": "user_speech",
            "query": "say hello in one sentence",
            "delay_tool": False
        }))
        print("Query sent. Waiting for audio...")
        
        audio_chunks = 0
        total_bytes = 0
        is_wav_received = False
        
        for _ in range(30):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
                msg = json.loads(raw)
                mtype = msg.get("type", "?")
                
                if mtype == "audio_chunk":
                    b64 = msg.get("audio_base64", "")
                    is_wav = msg.get("is_wav", False)
                    is_final = msg.get("is_final", False)
                    chunk_idx = msg.get("chunk_index", -1)
                    nbytes = len(base64.b64decode(b64)) if b64 else 0
                    total_bytes += nbytes
                    audio_chunks += 1
                    is_wav_received = is_wav_received or is_wav
                    print(f"  audio_chunk idx={chunk_idx} is_wav={is_wav} bytes={nbytes} final={is_final}")
                    if is_final:
                        break
                else:
                    print(f"  msg: {mtype}")
            except asyncio.TimeoutError:
                print("[timeout waiting for message]")
                break
        
        print("---")
        print(f"chunks: {audio_chunks}  total_bytes: {total_bytes}  WAV: {is_wav_received}")
        if total_bytes > 5000:
            print("SUCCESS - Real Rime audio received and ready for browser playback!")
        else:
            print("FAIL - No substantial audio received.")

asyncio.run(test())
