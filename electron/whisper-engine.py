# -*- coding: utf-8 -*-
"""Local Hebrew Whisper engine for Couple Lab (faster-whisper + ivrit-ai turbo).

The Electron transcription worker starts this once and keeps it alive. It only
decodes: the worker owns VAD, the decode windows, the keep-filter and word
ownership (transcription-pipeline.cjs), so the sherpa-onnx fallback and this
engine share one tested segmentation.

Decoding matches the production settings that were measured in the Shema
project (docs/TRANSCRIPTION_UPGRADE.md): beam 5, word timestamps,
language forced, condition_on_previous_text=False, no initial_prompt (names in
the prompt made Whisper invent them on silence), each window decoded on its own.

Protocol: one JSON object per line on stdin, one per line on stdout.
  -> {"id": 1, "type": "status"}
  -> {"id": 2, "type": "transcribe", "audioPath": "x.f32", "language": "he",
      "windows": [{"a0": 0, "b0": 32000}, ...]}           (samples, 16 kHz)
  <- {"id": 2, "ok": true, "result": {"windows": [{"segments": [...]}, ...]}}
Audio is raw little-endian float32 mono 16 kHz, written and deleted by the worker.
Nothing leaves the computer: the model loads with local_files_only=True.
"""
import glob
import json
import os
import sys
import time

SR = 16000
MODEL = os.environ.get("COUPLE_LAB_WHISPER_MODEL", "ivrit-ai/whisper-large-v3-turbo-ct2")


def _cuda_dll_dirs():
    """pip's nvidia-cublas/cudnn wheels put their DLLs where CTranslate2 does not look on Windows."""
    if os.name != "nt":
        return
    for site in sys.path:
        for d in glob.glob(os.path.join(site, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except OSError:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


_cuda_dll_dirs()

import numpy as np  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

_model = None
_device = None


def model():
    global _model, _device
    if _model is not None:
        return _model
    errors = []
    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            _model = WhisperModel(MODEL, device=device, compute_type=compute, local_files_only=True)
            _device = device
            return _model
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{device}: {exc}")
    raise RuntimeError("model-load-failed: " + " | ".join(errors))


def decode(clip, offset, language):
    segs, _ = model().transcribe(clip, vad_filter=False, beam_size=5, word_timestamps=True,
                                 condition_on_previous_text=False, language=language)
    out = []
    for s in segs:
        out.append({
            "text": s.text.strip(),
            "start": round(s.start + offset, 3),
            "end": round(s.end + offset, 3),
            "avgLogprob": float(s.avg_logprob),
            "noSpeechProb": float(s.no_speech_prob),
            "compressionRatio": float(s.compression_ratio),
            "tokenCount": len(s.tokens or []),
            "words": [[round(w.start + offset, 3), round(w.end + offset, 3), w.word.strip(), round(float(w.probability), 3)]
                      for w in (s.words or []) if w.word.strip()],
        })
    return out


def handle(msg):
    if msg.get("type") == "status":
        model()
        return {"ready": True, "modelId": MODEL.replace("/", "-").replace("-ct2", ""), "device": _device}
    if msg.get("type") != "transcribe":
        raise ValueError("unsupported-request")
    audio = np.fromfile(msg["audioPath"], dtype="<f4")
    language = "en" if msg.get("language") == "en" else "he"
    t = time.time()
    windows = []
    for w in msg.get("windows") or []:
        a0, b0 = max(0, int(w["a0"])), min(len(audio), int(w["b0"]))
        if b0 <= a0:
            windows.append({"segments": []})
            continue
        windows.append({"segments": decode(audio[a0:b0], a0 / SR, language)})
    return {"windows": windows, "device": _device, "seconds": round(time.time() - t, 2)}


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    out = sys.stdout
    sys.stdout = sys.stderr          # library prints must never corrupt the protocol
    for line in sys.stdin:
        line = line.lstrip("﻿").strip()
        if not line:
            continue
        msg = {}
        try:
            msg = json.loads(line)
            reply = {"id": msg.get("id"), "ok": True, "result": handle(msg)}
        except Exception as exc:  # noqa: BLE001
            reply = {"id": msg.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]}
        out.write(json.dumps(reply, ensure_ascii=False) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
