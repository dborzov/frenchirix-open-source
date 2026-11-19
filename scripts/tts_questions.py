"""Speak every distinct French sentence of the questions, answers and line alternates with local Qwen3-TTS.

Runs in a Python environment that has torch (CUDA), qwen-tts, huggingface_hub, numpy and soundfile, with
the Qwen3-TTS weights already in the Hugging Face cache (it runs offline), ffmpeg, and the `voxtype` CLI
with its Parakeet v3 model for the check. This project's .venv does not hold them; for example:

    uv run --project <a uv project with torch and qwen-tts> --frozen --no-sync python scripts/tts_questions.py [--force] [--only HASH ...] [--limit N]

See docs/app-tts.md. Output: work/app-media/q/<sha1[:16]>.m4a and manifest.json (the export links the released ones into app/public/media/q).
Generation: Qwen3-TTS 12Hz 1.7B Base, cloning one fixed reference clip (assets/tts-voice/)
that the VoiceDesign model made from a text description (a synthetic voice, no real person). Each clip is
transcribed back with Voxtype's local Parakeet v3 and regenerated up to 3 times if it scores badly.
"""
import argparse, glob, hashlib, json, os, re, subprocess, sys, tempfile, time, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The clips go to the export's media cache; `frenchirix export-app` links the ones the released
# scenes name into app/public/media/q (docs/app-export.md).
OUT = ROOT / "work/app-media/q"
# Work files go here, never into OUT: the export may run during generation and links whatever is in
# OUT, so OUT only ever gains complete clips, by one atomic rename. Same filesystem as OUT (git-ignored).
WORK = ROOT / "work/tts-q"
VOICE_DIR = ROOT / "assets/tts-voice"            # the reference clip, its text and how it was designed: irreplaceable, committed
PARAKEET = Path.home() / ".local/share/voxtype/models/parakeet-tdt-0.6b-v3"
SR_OUT = 48000
TARGET_LUFS, MAX_TP = -16.0, -2.5                 # limiter ceiling, under the -1.5 dBTP limit to leave room for AAC
MARGIN_S = 0.08
MAX_ATTEMPTS = 3
GOOD_CER = 0.10                                   # accept without retry at or below this
DOUBT_CER = 0.20                                  # still above this after all attempts: listed as doubtful
SEEDS = [42, 7, 1234]


# ---------- sentences ----------
def sentences():
    seen = {}
    for f in sorted(glob.glob(str(ROOT / "app/data/questions/s[0-9][0-9]e[0-9][0-9].json"))):
        d = json.load(open(f, encoding="utf-8"))
        for sc in d["scenes"].values():
            for q in sc["questions"]:
                seen.setdefault(q["fr"], "question")
                for a in q["answers"]:
                    seen.setdefault(a["fr"], "answer")
    # the funny alterations of scene lines (Line.alternates, for say-choice): same voice, same hash rule
    for f in sorted(glob.glob(str(ROOT / "app/data/alternates/s[0-9][0-9]e[0-9][0-9]*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for alts in d.values():
            for alt in alts:
                seen.setdefault(alt["fr"], "alternate")
    return seen


def h(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


# ---------- scoring (text normalisation, numbers spelled out) ----------
UNITS = "zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf".split()
TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante", 8: "quatre-vingt"}


def num_fr(n):
    if n < 20:
        return UNITS[n]
    if n < 100:
        t, u = divmod(n, 10)
        if t in (7, 9):
            rest = n - (t - 1) * 10
            return TENS[t - 1] + ("-et-" if rest == 11 and t == 7 else "-") + UNITS[rest]
        if u == 0:
            return TENS[t] + ("s" if t == 8 else "")
        return TENS[t] + ("-et-" if u == 1 and t != 8 else "-") + UNITS[u]
    if n < 1000:
        c, r = divmod(n, 100)
        s = "cent" if c == 1 else UNITS[c] + "-cent" + ("s" if r == 0 else "")
        return s + ("-" + num_fr(r) if r else "")
    if n < 1_000_000:
        k, r = divmod(n, 1000)
        return ("mille" if k == 1 else num_fr(k) + "-mille") + ("-" + num_fr(r) if r else "")
    return str(n)


def norm(text):
    t = text.lower().replace("’", "'").replace("œ", "oe").replace("æ", "ae").replace("môssieur", "monsieur")
    t = re.sub(r"(\d+)[.,](\d+)", lambda m: num_fr(int(m.group(1))) + " virgule " + num_fr(int(m.group(2))), t)
    t = re.sub(r"\d+", lambda m: num_fr(int(m.group())), t)
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).split()


def _edits(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return d[len(b)]


def sound_key(word):
    """Drop French endings that are usually silent, so 'ils chantent' ~ 'il chante', 'files' ~ 'fils'."""
    w = re.sub(r"[sx]$", "", word)
    w = re.sub(r"ent$", "", w) if len(w) > 4 else w
    w = re.sub(r"(er|ez|ai)$", "e", w) if len(w) > 3 else w
    while len(w) > 2 and w[-1] in "etd":
        w = w[:-1]
    return w


def score(ref, hyp):
    """WER on words; CER on letters with spaces removed (so 'idée fixe' ~ 'Idéfix' counts as close).
    `cer` compares sound keys (silent endings dropped: the recogniser cannot hear them either);
    `cer_strict` compares the spelled words."""
    r, hy = norm(ref), norm(hyp)
    rc, hc = "".join(r), "".join(hy)
    rk, hk = "".join(map(sound_key, r)), "".join(map(sound_key, hy))
    return {"wer": round(_edits(r, hy) / max(1, len(r)), 3), "cer": round(_edits(list(rk), list(hk)) / max(1, len(rk)), 3),
            "cer_strict": round(_edits(list(rc), list(hc)) / max(1, len(rc)), 3)}


# ---------- audio ----------
def ff(*args, **kw):
    return subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", *args], check=True, capture_output=True, **kw)


def trim(wav, sr):
    import numpy as np
    f = int(sr * 0.01)
    n = len(wav) // f
    if n == 0:
        return wav, 0.0, 0.0
    rms = np.sqrt(np.mean(wav[: n * f].reshape(n, f) ** 2, axis=1))
    thr = max(rms.max() * 10 ** (-40 / 20), 1e-4)            # -40 dB below the loudest 10 ms
    on = np.where(rms > thr)[0]
    if not len(on):
        return wav, 0.0, 0.0
    a = max(0, on[0] * f - int(MARGIN_S * sr))
    b = min(len(wav), (on[-1] + 1) * f + int(MARGIN_S * sr))
    out = wav[a:b].copy()
    fade = min(int(0.01 * sr), len(out) // 4)
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=out.dtype)
        out[:fade] *= ramp
        out[-fade:] *= ramp[::-1]
    # pauses inside the speech longer than 0.7 s are suspicious
    gaps = np.diff(on)
    return out, a / sr, float((gaps.max() - 1) * 0.01) if len(gaps) else 0.0


def loudness(path):
    """Integrated LUFS and true peak (dBTP). Short clips are looped to 4 s so the gating has enough audio."""
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-af", "aloop=loop=-1:size=2e9,atrim=0:4,ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    lines = r.stderr[r.stderr.rfind("Summary:"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", lines).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", lines).group(1))
    return lufs, tp


def encode(wav, sr, dest):
    """Trimmed float wav -> AAC-LC .m4a, mono 48 kHz, 160 kb/s, faststart, about -16 LUFS, true peak under -1.5 dBTP.

    A linear gain to TARGET_LUFS, then a peak limiter running at 192 kHz (sample peaks there are close
    to true peaks) with its ceiling at MAX_TP. The encoded file is measured; gain and ceiling are
    corrected from that and the best legal encoding is kept. 160 kb/s because ffmpeg's AAC encoder at
    96 kb/s mono added up to 4.7 dB of overshoot (distortion) on limited speech; 160 kb/s added none.
    Returns (lufs, true_peak) of the kept file."""
    import soundfile as sf
    with tempfile.TemporaryDirectory(dir=WORK) as t:
        raw = Path(t) / "a.wav"
        sf.write(raw, wav, sr, subtype="FLOAT")
        lufs0, _ = loudness(raw)
        gain, ceiling = TARGET_LUFS - lufs0, MAX_TP
        tmp, keep = Path(t) / "tmp.m4a", WORK / f"{dest.stem}.keep.m4a"
        best = None
        for _ in range(6):
            af = (f"volume={gain:.2f}dB,aresample=192000:resampler=soxr,"
                  f"alimiter=limit={10 ** (ceiling / 20):.4f}:attack=1:release=40:level=0,aresample={SR_OUT}:resampler=soxr")
            ff("-y", "-i", str(raw), "-af", af, "-ac", "1", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "160k",
               "-movflags", "+faststart", str(tmp))
            lufs, tp = loudness(tmp)
            if tp <= -1.6 and (best is None or abs(lufs - TARGET_LUFS) < abs(best[0] - TARGET_LUFS)):
                best = (lufs, tp)
                os.replace(tmp, keep)
            if tp > -1.6:
                ceiling = max(ceiling - (tp + 1.8), -12.0)
            elif abs(lufs - TARGET_LUFS) > 0.4:
                gain += TARGET_LUFS - lufs
            else:
                break
        if best is None:
            raise RuntimeError(f"could not bring {dest.name} under -1.6 dBTP")
        os.replace(keep, dest)
        tmp.unlink(missing_ok=True)
    return best


def probe(path):
    r = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout)
    s = r["streams"][0]
    return {"codec": s["codec_name"], "profile": s.get("profile"), "sr": int(s["sample_rate"]), "ch": s["channels"], "dur": float(r["format"]["duration"])}


def faststart(path):
    data = Path(path).read_bytes()
    moov, mdat = data.find(b"moov"), data.find(b"mdat")
    return 0 <= moov and (mdat < 0 or moov < mdat)


# ---------- recognition ----------
_cfg = None


def transcribe(path):
    global _cfg
    if _cfg is None:
        _cfg = Path(tempfile.mkdtemp(prefix="tts-q-")) / "voxtype.toml"
        _cfg.write_text(f'engine = "parakeet"\n[parakeet]\nmodel = "{PARAKEET}"\nmodel_type = "tdt"\n[vad]\nenabled = false\n')
    with tempfile.TemporaryDirectory() as t:
        w = Path(t) / "a.wav"
        ff("-i", str(path), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(w))
        out = subprocess.run(["voxtype", "--config", str(_cfg), "-q", "transcribe", str(w)], capture_output=True, text=True,
                             env=dict(os.environ, RUST_LOG="error")).stdout
    return out.rsplit("\n\n", 1)[-1].strip() if "\n\n" in out else ""


# ---------- main ----------
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    p.add_argument("--only", nargs="+", metavar="HASH", help="only these hashes (implies regenerate)")
    p.add_argument("--limit", type=int, help="process at most N clips")
    p.add_argument("--attempts", type=int, default=MAX_ATTEMPTS)
    args = p.parse_args()

    voice = json.loads((VOICE_DIR / "voice.json").read_text())
    if not (VOICE_DIR / voice["ref_audio"]).is_file():
        sys.exit(f"voice reference missing: {VOICE_DIR / voice['ref_audio']} (see docs/app-tts.md)")
    print(f"voice: {VOICE_DIR / voice['ref_audio']}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    sents = sentences()
    todo = []
    for text, kind in sents.items():
        k = h(text)
        if args.only and k not in args.only:
            continue
        if (OUT / f"{k}.m4a").exists() and not (args.force or args.only):
            continue
        todo.append((k, text, kind))
    if args.limit is not None:
        todo = todo[: args.limit]
    print(f"{len(sents)} sentences, {len(todo)} to generate", flush=True)
    if not todo:
        return write_manifest(mpath, manifest, sents)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import numpy as np, torch
    from huggingface_hub import snapshot_download
    from qwen_tts import Qwen3TTSModel
    snap = snapshot_download(voice["model"], revision=voice.get("revision"), local_files_only=True)
    model = Qwen3TTSModel.from_pretrained(snap, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    prompt = model.create_voice_clone_prompt(ref_audio=str(VOICE_DIR / voice["ref_audio"]), ref_text=voice["ref_text"])

    t_start = time.time()
    for n, (k, text, kind) in enumerate(todo, 1):
        dest = OUT / f"{k}.m4a"
        best = None
        tries = []
        for attempt in range(args.attempts):
            seed = SEEDS[attempt % len(SEEDS)] + 1000 * (attempt // len(SEEDS))
            torch.manual_seed(seed)
            t0 = time.time()
            with torch.inference_mode():
                wavs, sr = model.generate_voice_clone(text=text, language="French", voice_clone_prompt=prompt, max_new_tokens=60 + 12 * len(text))
            gen_s = time.time() - t0
            wav = np.asarray(wavs[0], dtype=np.float32)
            if not wav.size or not np.isfinite(wav).all():
                tries.append({"seed": seed, "error": "empty or nonfinite"})
                continue
            wav, lead, gap = trim(wav, sr)
            cand = WORK / f"{k}.try{attempt}.m4a"
            lufs, tp = encode(wav, sr, cand)
            heard = transcribe(cand)
            sc = score(text, heard)
            words = max(1, len(norm(text)))
            slow = words >= 3 and (len(wav) / sr - 2 * MARGIN_S) / words > 0.8   # one long name may take 1 s
            dur = len(wav) / sr
            rec = {"seed": seed, "heard": heard, **sc, "duration": round(dur, 3), "sec_per_word": round((dur - 2 * MARGIN_S) / words, 3),
                   "max_pause": round(gap, 2), "lufs": lufs, "true_peak": tp, "gen_seconds": round(gen_s, 2)}
            tries.append(rec)
            # rank: CER, then WER, then a penalty for a long internal pause
            # (a pause over 0.7 s or more than 0.8 s per word suggests a stall or babbling)
            key = (rec["cer"] + (0.2 if gap > 0.7 else 0) + (0.2 if slow else 0), rec["wer"])
            rec["slow"] = slow
            if best is None or key < best[0]:
                if best:
                    best[2].unlink(missing_ok=True)
                best = (key, rec, cand)
            else:
                cand.unlink(missing_ok=True)
            if rec["cer"] <= GOOD_CER and gap <= 0.7 and not slow:
                break
        if best is None:
            print(f"[{n}/{len(todo)}] FAILED {k} {text!r}", flush=True)
            continue
        os.replace(best[2], dest)
        lufs, tp = best[1]["lufs"], best[1]["true_peak"]
        pr = probe(dest)
        manifest[k] = {"text": text, "kind": kind, "duration": round(pr["dur"], 3), "heard": best[1]["heard"], "cer": best[1]["cer"], "cer_strict": best[1]["cer_strict"], "wer": best[1]["wer"],
                       "sec_per_word": best[1]["sec_per_word"], "max_pause": best[1]["max_pause"], "lufs": round(lufs, 1), "true_peak": round(tp, 1),
                       "codec": f'{pr["codec"]}/{pr["profile"]}', "sample_rate": pr["sr"], "channels": pr["ch"], "faststart": faststart(dest),
                       "attempts": len(tries), "seed": best[1]["seed"], "tries": tries, "doubtful": best[1]["cer"] > DOUBT_CER or best[1]["max_pause"] > 0.7 or best[1]["slow"]}
        el = time.time() - t_start
        print(f"[{n}/{len(todo)}] {k} cer={best[1]['cer']:.2f} tries={len(tries)} {text!r} -> {best[1]['heard']!r}  ({el/n:.1f}s/clip)", flush=True)
        if n % 25 == 0:
            write_manifest(mpath, manifest, sents, quiet=True)
    write_manifest(mpath, manifest, sents)


def write_manifest(mpath, manifest, sents, quiet=False):
    keep = {h(t) for t in sents}
    manifest = {k: v for k, v in sorted(manifest.items()) if k in keep and (OUT / f"{k}.m4a").exists()}
    tmp = WORK / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, mpath)
    if not quiet:
        missing = [t for t in sents if h(t) not in manifest]
        doubt = [v for v in manifest.values() if v["doubtful"]]
        print(f"manifest: {len(manifest)} clips, {len(missing)} missing, {len(doubt)} doubtful", flush=True)


if __name__ == "__main__":
    main()
