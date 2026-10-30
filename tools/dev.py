"""Start the local development servers in hidden processes; keep logs in .local."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


def ready(url):
    try:
        with urlopen(url, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def start():
    LOCAL.mkdir(exist_ok=True)
    subprocess.run([str(PYTHON), str(ROOT / "tools" / "local_db.py"), "start"], check=True)
    processes = {}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    commands = [
        ("backend", "http://127.0.0.1:8000/api/health/", [str(PYTHON), str(ROOT / "backend" / "manage.py"), "runserver", "127.0.0.1:8000", "--noreload"], ROOT / "backend"),
        ("frontend", "http://127.0.0.1:5173/", [shutil.which("node"), str(ROOT / "frontend" / "node_modules" / "vite" / "bin" / "vite.js"), "--host", "127.0.0.1"], ROOT / "frontend"),
    ]
    for name, url, command, cwd in commands:
        if ready(url):
            continue
        with (LOCAL / f"{name}.log").open("a", encoding="utf-8") as log:
            process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
        processes[name] = process.pid
    state_file = LOCAL / "dev-processes.json"
    old = json.loads(state_file.read_text()) if state_file.exists() else {}
    state_file.write_text(json.dumps({**old, **processes}), encoding="utf-8")
    for _ in range(40):
        if all(ready(url) for _, url, _, _ in commands):
            print("Application: http://127.0.0.1:5173")
            print("Logs: .local/backend.log and .local/frontend.log")
            return
        time.sleep(0.5)
    raise SystemExit("A server did not become ready. Read .local/backend.log and .local/frontend.log.")


def stop_servers():
    state_file = LOCAL / "dev-processes.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    for name, pid in state.items():
        script_path = ROOT / ("backend/manage.py" if name == "backend" else "frontend/node_modules/vite/bin/vite.js")
        env = {**os.environ, "DISPATCH_SERVER_PID": str(int(pid)), "DISPATCH_EXPECTED_SCRIPT": str(script_path)}
        script = "$ErrorActionPreference = 'Stop'\n$taskPid = [int]$env:DISPATCH_SERVER_PID\n$taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskPid)\nif ($null -eq $taskProcess) { exit 0 }\nif (-not $taskProcess.CommandLine.Contains($env:DISPATCH_EXPECTED_SCRIPT)) { throw 'The PID is no longer this project server; leaving it untouched.' }\n& taskkill.exe /PID $taskPid /T /F\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], env=env, check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "restart", "stop", "status"], nargs="?", default="start")
    action = parser.parse_args().action
    if action in {"stop", "restart"}:
        stop_servers()
    if action in {"start", "restart"}:
        start()
    elif action == "status":
        print("Backend:", "ready" if ready("http://127.0.0.1:8000/api/health/") else "not running")
        print("Frontend:", "ready" if ready("http://127.0.0.1:5173/") else "not running")

