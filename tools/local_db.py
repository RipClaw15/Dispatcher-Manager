"""Project-local PostgreSQL for Windows. No Windows service is installed."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
BIN = LOCAL / "pgsql" / "bin"
DATA = LOCAL / "pgdata"
PORT = "55432"


def run(args, **kwargs):
    return subprocess.run([str(value) for value in args], check=True, **kwargs)


def setup():
    LOCAL.mkdir(exist_ok=True)
    password_file = LOCAL / "postgres-password.txt"
    if not password_file.exists():
        password_file.write_text(secrets.token_urlsafe(30), encoding="utf-8")
    password = password_file.read_text(encoding="utf-8").strip()
    env_path = ROOT / "backend" / ".env"
    if not env_path.exists():
        env_path.write_text(f"DJANGO_SECRET_KEY={secrets.token_urlsafe(60)}\nDJANGO_DEBUG=1\n"
                            "DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,testserver\n"
                            f"DATABASE_URL=postgresql://shipment:{password}@127.0.0.1:{PORT}/shipment\n", encoding="utf-8")
    if not (BIN / "postgres.exe").exists():
        archive = ROOT / ".cache" / "postgresql-windows.zip"
        if not archive.exists():
            raise SystemExit("Download the official EDB Windows binary archive into .cache/postgresql-windows.zip first.")
        with zipfile.ZipFile(archive) as source:
            members = [member for member in source.infolist() if member.filename.startswith(("pgsql/bin/", "pgsql/lib/", "pgsql/share/"))]
            for member in members:
                target = (LOCAL / member.filename).resolve()
                if not target.is_relative_to(LOCAL.resolve()):
                    raise SystemExit("Unexpected archive path")
                source.extract(member, LOCAL)
        print("PostgreSQL binaries extracted inside .local/pgsql.")
    if not (DATA / "PG_VERSION").exists():
        run([BIN / "initdb.exe", "-D", DATA, "-U", "shipment", "--pwfile", password_file,
             "--encoding=UTF8", "--no-locale", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256"])
    start()
    env = {**os.environ, "PGPASSWORD": password}
    result = subprocess.run([str(BIN / "psql.exe"), "-h", "127.0.0.1", "-p", PORT, "-U", "shipment", "-d", "postgres",
                             "-tAc", "SELECT 1 FROM pg_database WHERE datname='shipment'"], env=env, capture_output=True, text=True, check=True)
    if result.stdout.strip() != "1":
        run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "shipment", "shipment"], env=env)
    print(f"Development PostgreSQL is ready at 127.0.0.1:{PORT}; credentials are in backend/.env.")


def start():
    # A server launched outside the sandbox can be reachable even when Windows
    # does not permit pg_ctl to inspect that process under the sandbox identity.
    import psycopg
    try:
        password = (LOCAL / "postgres-password.txt").read_text(encoding="utf-8").strip()
        with psycopg.connect(host="127.0.0.1", port=PORT, user="shipment", password=password, dbname="postgres", connect_timeout=2):
            return
    except psycopg.OperationalError:
        pass
    status = subprocess.run([str(BIN / "pg_ctl.exe"), "status", "-D", str(DATA)], capture_output=True)
    if status.returncode != 0:
        run([BIN / "pg_ctl.exe", "start", "-D", DATA, "-l", LOCAL / "postgres.log", "-o", f"-p {PORT} -h 127.0.0.1", "-w", "-t", "45"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["setup", "start", "stop"], default="setup", nargs="?")
    action = parser.parse_args().action
    if action == "setup":
        setup()
    elif action == "start":
        start()
    else:
        run([BIN / "pg_ctl.exe", "stop", "-D", DATA, "-m", "fast", "-w"])

