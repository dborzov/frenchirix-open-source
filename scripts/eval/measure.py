"""Run transcribe_episode or align_episode on a database and report seconds and peak GPU memory.

uv run --group asr python scripts/eval/measure.py <db> transcribe|align <episode> [--force]
Peak memory is this process's usage as nvidia-smi reports it (CUDA context included),
sampled every 0.2 s.
"""

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from frenchirix.db import connect

db, step, episode = sys.argv[1:4]
force = "--force" in sys.argv
peak = 0
stop = False


def poll():
    global peak
    pid = str(os.getpid())
    while not stop:
        out = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            p, m = [x.strip() for x in line.split(",")]
            if p == pid:
                peak = max(peak, int(m))
        time.sleep(0.2)


t = threading.Thread(target=poll, daemon=True)
t.start()
conn = connect(Path(db))
t0 = time.monotonic()
if step == "transcribe":
    from frenchirix.transcribe import transcribe_episode
    transcribe_episode(conn, episode, force=force)
else:
    from frenchirix.forced_align import align_episode
    align_episode(conn, episode, force=force)
elapsed = time.monotonic() - t0
stop = True
t.join()
print(f"MEASURE {step}: {elapsed:.1f} s wall, peak GPU memory of this process {peak} MiB")
