"""Host Realize on a Vultr VPS. Standard library only; run from the repo root.

    python deploy/vultr.py provision            create the VPS (Docker, firewall, swap via cloud-init)
    python deploy/vultr.py deploy [--init]      ship the committed code + .env, build and start everything
    python deploy/vultr.py status               GET https://$DOMAIN/api/health
    python deploy/vultr.py logs [service]       last lines of docker compose logs
    python deploy/vultr.py ssh                  print the ssh command for the server

provision needs VULTR_API_KEY (environment or .env) and an SSH public key.
deploy needs DOMAIN and PUBLIC_BASE_URL=https://<domain> in .env, and DNS
pointing at the server. The server's address is kept in deploy/.host.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST_FILE = ROOT / "deploy" / ".host"
CLOUD_INIT = ROOT / "deploy" / "cloud-init.yaml"
REMOTE_DIR = "/opt/realize"
API = "https://api.vultr.com/v2"
OS_NAME = "Ubuntu 24.04 LTS x64"
# Always name the key: a shell whose HOME isn't the Windows profile would offer
# no key (or every key), and repeated failed logins get the IP banned by fail2ban.
IDENTITY = Path(os.environ.get("REALIZE_SSH_KEY") or Path.home() / ".ssh" / "id_ed25519")
SSH_OPTS = ["-i", str(IDENTITY), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30",
            "-o", f"UserKnownHostsFile={Path.home() / '.ssh' / 'known_hosts'}"]


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


# ---------------------------------------------------------------- Vultr API

def vultr(method: str, path: str, body: dict | None = None) -> dict:
    key = os.environ.get("VULTR_API_KEY") or read_env().get("VULTR_API_KEY")
    if not key:
        die("set VULTR_API_KEY (Vultr dashboard, Account, API) in your environment or .env")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        die(f"Vultr {method} {path} answered {e.code}: {e.read().decode(errors='replace')}")
    return json.loads(raw) if raw else {}


def find_os_id() -> int:
    cursor = ""
    while True:
        page = vultr("GET", "/os?per_page=500" + (f"&cursor={cursor}" if cursor else ""))
        for item in page.get("os", []):
            if item["name"] == OS_NAME:
                return item["id"]
        cursor = page.get("meta", {}).get("links", {}).get("next", "")
        if not cursor:
            die(f"Vultr doesn't list an OS called {OS_NAME!r}")


def ensure_ssh_key(pub_path: Path) -> str:
    if not pub_path.exists():
        die(f"no SSH public key at {pub_path}. Make one with: ssh-keygen -t ed25519")
    pub = pub_path.read_text(encoding="utf-8").strip()
    for item in vultr("GET", "/ssh-keys?per_page=500").get("ssh_keys", []):
        if item["ssh_key"].split()[:2] == pub.split()[:2]:
            return item["id"]
    return vultr("POST", "/ssh-keys", {"name": "realize-deploy", "ssh_key": pub})["ssh_key"]["id"]


def cmd_provision(args: argparse.Namespace) -> None:
    existing = vultr("GET", f"/instances?label={args.label}").get("instances", [])
    if existing:
        inst = existing[0]
        print(f"An instance labeled {args.label!r} already exists ({inst['main_ip']}). Reusing it.")
    else:
        key_id = ensure_ssh_key(Path(args.ssh_key).expanduser())
        user_data = base64.b64encode(CLOUD_INIT.read_bytes()).decode()
        inst = vultr("POST", "/instances", {
            "region": args.region, "plan": args.plan, "os_id": find_os_id(),
            "label": args.label, "hostname": args.label, "sshkey_id": [key_id],
            "user_data": user_data, "backups": "disabled", "tags": ["realize"],
        })["instance"]
        print(f"Created instance {inst['id']} ({args.plan} in {args.region}). Waiting for an IP...")
    while inst.get("status") != "active" or inst.get("main_ip") in (None, "", "0.0.0.0"):
        time.sleep(5)
        inst = vultr("GET", f"/instances/{inst['id']}")["instance"]
    ip = inst["main_ip"]
    HOST_FILE.write_text(ip + "\n", encoding="utf-8")
    domain = read_env().get("DOMAIN") or "<your domain>"
    print(f"""
Server is up at {ip} (saved to deploy/.host). Cloud-init keeps installing Docker for a few minutes.

Next, by hand:
  1. DNS: add an A record  {domain} -> {ip}
  2. Atlas: Network Access, add {ip}/32
  3. .env: DOMAIN={domain} and PUBLIC_BASE_URL=https://{domain}
Then: python deploy/vultr.py deploy --init""")


# ---------------------------------------------------------------- server side

def host(args: argparse.Namespace) -> str:
    h = getattr(args, "host", None) or (HOST_FILE.read_text().strip() if HOST_FILE.exists() else "")
    if not h:
        die("no server address. Run provision first or pass --host")
    return f"{args.user}@{h}"


def ssh(target: str, command: str, check: bool = True, **kw) -> subprocess.CompletedProcess:
    proc = subprocess.run(["ssh", *SSH_OPTS, target, command], **kw)
    if check and proc.returncode != 0:
        die(f"remote command failed ({proc.returncode}): {command}")
    return proc


def scp(target: str, local: Path, remote: str) -> None:
    if subprocess.run(["scp", *SSH_OPTS, "-q", str(local), f"{target}:{remote}"]).returncode != 0:
        die(f"copying {local.name} failed")


def wait_for_server(target: str) -> None:
    for _ in range(60):
        proc = ssh(target, "test -f /var/lib/cloud/realize-ready && docker compose version >/dev/null",
                   check=False, capture_output=True, text=True)
        if proc.returncode == 0:
            return
        if "Permission denied" in proc.stderr:
            # Retrying a rejected key only gets this IP banned by fail2ban.
            die(f"the server rejected {IDENTITY}. Use the key you gave provision (REALIZE_SSH_KEY=...)")
        print("  waiting for cloud-init to finish installing Docker...")
        time.sleep(10)
    die("the server never finished setup. Check /var/log/cloud-init-output.log on it")


def check_env() -> dict[str, str]:
    env = read_env()
    if not env:
        die(".env is missing. Copy .env.example and fill it in")
    domain = env.get("DOMAIN", "")
    if not domain:
        die("set DOMAIN in .env (Caddy needs it for the HTTPS certificate)")
    if env.get("PUBLIC_BASE_URL", "").rstrip("/") != f"https://{domain}":
        die(f"set PUBLIC_BASE_URL=https://{domain} in .env so links in tickets open the live site")
    for key in ("MONGODB_URI", "GEMINI_API_KEY"):
        if not env.get(key):
            die(f"{key} is empty in .env")
    return env


def health(domain: str) -> dict | None:
    contexts = [None]
    try:
        # Python on Windows can carry a stale root store that rejects newer
        # Let's Encrypt chains that browsers accept; certifi's bundle doesn't.
        import ssl
        import certifi
        contexts.append(ssl.create_default_context(cafile=certifi.where()))
    except ImportError:
        pass
    for ctx in contexts:
        try:
            with urllib.request.urlopen(f"https://{domain}/api/health", timeout=10, context=ctx) as resp:
                return json.loads(resp.read())
        except Exception:  # noqa: BLE001
            continue
    return None


def remote_env(target: str) -> dict[str, str]:
    """The .env already on the server (CI deploys keep it instead of uploading one)."""
    out = ssh(target, f"cat {REMOTE_DIR}/.env 2>/dev/null || true", capture_output=True, text=True).stdout
    env = {}
    for line in out.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    if not env.get("DOMAIN"):
        die(f"{REMOTE_DIR}/.env on the server is missing or has no DOMAIN. Run one deploy from a laptop first")
    return env


def cmd_deploy(args: argparse.Namespace) -> None:
    target = host(args)
    env = remote_env(target) if args.keep_remote_env else check_env()
    dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"],
                           cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty:
        print("note: uncommitted changes are not deployed, only the last commit is:")
        print("  " + dirty.replace("\n", "\n  "))

    print(f"Checking {target}...")
    wait_for_server(target)

    print("Uploading code (git archive HEAD)...")
    ssh(target, f"mkdir -p {REMOTE_DIR}/secrets && cd {REMOTE_DIR} && "
                "find . -mindepth 1 -maxdepth 1 ! -name .env ! -name secrets -exec rm -rf {} +")
    archive = subprocess.Popen(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, stdout=subprocess.PIPE)
    extract = subprocess.run(["ssh", *SSH_OPTS, target, f"tar -x -C {REMOTE_DIR}"], stdin=archive.stdout)
    archive.stdout.close()
    if archive.wait() != 0 or extract.returncode != 0:
        die("uploading the code failed")

    cookies = ROOT / "secrets" / "instagram_cookies.txt"
    if args.keep_remote_env:
        print("Keeping the .env and secrets/ already on the server.")
    else:
        print("Uploading .env and secrets/...")
        scp(target, ROOT / ".env", f"{REMOTE_DIR}/.env")
        ssh(target, f"chmod 600 {REMOTE_DIR}/.env")
    if not args.keep_remote_env and cookies.exists():
        scp(target, cookies, f"{REMOTE_DIR}/secrets/instagram_cookies.txt")
        if env.get("INSTAGRAM_COOKIES_PATH") != "/secrets/instagram_cookies.txt":
            print("note: set INSTAGRAM_COOKIES_PATH=/secrets/instagram_cookies.txt in .env to use the cookies")

    print("Building and starting containers (the first build takes a few minutes)...")
    # The upload replaces Caddyfile with a new file, but a running container keeps the
    # old one bind-mounted; recreating caddy makes it read the new one.
    ssh(target, f"cd {REMOTE_DIR} && docker compose up -d --build --remove-orphans && "
                "docker compose up -d --force-recreate --no-deps caddy && docker image prune -f")

    # Every deploy: new features can add collections or indexes, and creating them again is a
    # no-op, so the server's Atlas never lags behind the code. No model calls.
    print("Creating Atlas indexes...")
    ssh(target, f"cd {REMOTE_DIR} && docker compose exec -T api python -m scripts.create_indexes",
        check=args.init)
    if args.init and not args.skip_samples:
        print("Building demo samples (needs Instagram access and Gemini quota)...")
        ssh(target, f"cd {REMOTE_DIR} && docker compose exec -T worker python -m scripts.build_samples",
            check=False)
    if (args.init and not args.skip_samples) or args.story:
        # The guided first open shows a finished nutrition answer and trip plan without waiting
        # on a model; they are made once here (about 6 Gemini calls and a few web searches).
        print("Building the demo story's results...")
        ssh(target, f"cd {REMOTE_DIR} && docker compose exec -T worker python -m scripts.build_demo_story",
            check=False)

    domain = env["DOMAIN"]
    print(f"Waiting for https://{domain}/api/health ...")
    for _ in range(30):
        h = health(domain)
        if h:
            print(json.dumps(h, indent=2))
            if not h.get("ok"):
                print("The API is up but can't reach Atlas. Add the server's IP in Atlas Network Access.")
            print(f"\nLive at https://{domain}")
            return
        time.sleep(5)
    die("not answering over https. Check that DNS points at the server, then:"
        "\n  python deploy/vultr.py logs caddy")


def cmd_status(args: argparse.Namespace) -> None:
    domain = read_env().get("DOMAIN") or die("DOMAIN is not set in .env")
    h = health(domain)
    print(json.dumps(h, indent=2) if h else f"https://{domain}/api/health is not answering")
    if args.containers:
        ssh(host(args), f"cd {REMOTE_DIR} && docker compose ps", check=False)


def cmd_logs(args: argparse.Namespace) -> None:
    ssh(host(args), f"cd {REMOTE_DIR} && docker compose logs --tail {args.tail} {args.service or ''}",
        check=False)


def cmd_ssh(args: argparse.Namespace) -> None:
    print(f"ssh {host(args)}   (code lives in {REMOTE_DIR})")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("provision", help="create the Vultr VPS")
    pr.add_argument("--region", default="ewr", help="Vultr region id (default ewr, New Jersey)")
    pr.add_argument("--plan", default="vc2-2c-4gb", help="Vultr plan id (default vc2-2c-4gb)")
    pr.add_argument("--label", default="realize")
    pr.add_argument("--ssh-key", default=str(IDENTITY) + ".pub")
    pr.set_defaults(fn=cmd_provision)

    for name, fn, helptext in (("deploy", cmd_deploy, "ship the code and (re)start"),
                               ("status", cmd_status, "check /api/health"),
                               ("logs", cmd_logs, "show container logs"),
                               ("ssh", cmd_ssh, "print the ssh command")):
        sp = sub.add_parser(name, help=helptext)
        sp.add_argument("--host", help="server IP (default: deploy/.host)")
        sp.add_argument("--user", default="root")
        sp.set_defaults(fn=fn)
        if name == "deploy":
            sp.add_argument("--init", action="store_true",
                            help="also build the demo samples and the demo story's results")
            sp.add_argument("--skip-samples", action="store_true", help="with --init, skip samples and story")
            sp.add_argument("--story", action="store_true",
                            help="build the demo story's results (about 6 Gemini calls)")
            sp.add_argument("--keep-remote-env", action="store_true",
                            help="don't upload .env or secrets/; use the server's (for GitHub Actions)")
        if name == "status":
            sp.add_argument("--containers", action="store_true", help="also show docker compose ps")
        if name == "logs":
            sp.add_argument("service", nargs="?", help="api, worker, web or caddy (default all)")
            sp.add_argument("--tail", type=int, default=100)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
