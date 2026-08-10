import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

app = FastAPI(title="SongSmith DiffSinger Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"] ,
    allow_headers=["*"] ,
)

DIFFSINGER_ROOT = Path(os.environ.get("DIFFSINGER_ROOT", "")).expanduser()
DIFFSINGER_EXP = os.environ.get("DIFFSINGER_EXP", "")
DIFFSINGER_PYTHON = os.environ.get("DIFFSINGER_PYTHON", sys.executable)
DIFFSINGER_CKPT = os.environ.get("DIFFSINGER_CKPT", "")
DEFAULT_SPEAKER = os.environ.get("DIFFSINGER_SPEAKER", "")
DEFAULT_LANG = os.environ.get("DIFFSINGER_LANG", "ja")
RENDER_TIMEOUT = int(os.environ.get("DIFFSINGER_RENDER_TIMEOUT", "180"))


class RenderRequest(BaseModel):
    project: list[dict] | dict
    speaker: str | None = None
    lang: str | None = None
    title: str = Field(default="songsmith-render", min_length=1, max_length=80)


def configuration_error() -> str | None:
    if not str(DIFFSINGER_ROOT):
        return "DIFFSINGER_ROOT is not set"
    if not DIFFSINGER_ROOT.exists():
        return f"DIFFSINGER_ROOT does not exist: {DIFFSINGER_ROOT}"
    if not (DIFFSINGER_ROOT / "scripts" / "infer.py").exists():
        return f"scripts/infer.py was not found under {DIFFSINGER_ROOT}"
    if not DIFFSINGER_EXP:
        return "DIFFSINGER_EXP is not set"
    return None


@app.get("/health")
def health():
    error = configuration_error()
    return {
        "ok": error is None,
        "configured": error is None,
        "error": error,
        "diffsingerRoot": str(DIFFSINGER_ROOT) if str(DIFFSINGER_ROOT) else None,
        "exp": DIFFSINGER_EXP or None,
        "speaker": DEFAULT_SPEAKER or None,
        "lang": DEFAULT_LANG,
        "python": DIFFSINGER_PYTHON,
    }


@app.post("/render")
def render(req: RenderRequest):
    error = configuration_error()
    if error:
        raise HTTPException(status_code=503, detail=error)

    workdir = Path(tempfile.mkdtemp(prefix="songsmith-diffsinger-"))
    ds_file = workdir / "input.ds"
    out_dir = workdir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    with ds_file.open("w", encoding="utf-8") as f:
        json.dump(req.project, f, ensure_ascii=False, indent=2)

    title = "".join(c for c in req.title if c.isalnum() or c in "-_ ").strip() or "songsmith-render"
    command = [
        DIFFSINGER_PYTHON,
        str(DIFFSINGER_ROOT / "scripts" / "infer.py"),
        "acoustic",
        str(ds_file),
        "--exp",
        DIFFSINGER_EXP,
        "--out",
        str(out_dir),
        "--title",
        title,
    ]

    if DIFFSINGER_CKPT:
        command += ["--ckpt", DIFFSINGER_CKPT]
    speaker = req.speaker or DEFAULT_SPEAKER
    if speaker:
        command += ["--spk", speaker]
    lang = req.lang or DEFAULT_LANG
    if lang:
        command += ["--lang", lang]

    env = os.environ.copy()
    env["PYTHONPATH"] = str(DIFFSINGER_ROOT)

    try:
        proc = subprocess.run(
            command,
            cwd=DIFFSINGER_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=RENDER_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=504, detail=f"DiffSinger render timed out after {RENDER_TIMEOUT}s") from exc
    except Exception as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to launch DiffSinger: {exc}") from exc

    if proc.returncode != 0:
        output = proc.stdout[-12000:] if proc.stdout else "(no output)"
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail={"message": "DiffSinger inference failed", "log": output})

    wavs = sorted(out_dir.rglob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not wavs:
        output = proc.stdout[-12000:] if proc.stdout else "(no output)"
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail={"message": "DiffSinger produced no WAV file", "log": output})

    wav = wavs[0]
    return FileResponse(
        path=wav,
        media_type="audio/wav",
        filename=f"{title}.wav",
        background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
    )
