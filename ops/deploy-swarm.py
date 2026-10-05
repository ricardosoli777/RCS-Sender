"""Run on the VPS from an extracted git archive, before public activation."""
import argparse
import datetime
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def call(*args, **kwargs):
    return subprocess.check_output(args, **kwargs).decode().strip()


def private_write(path, content):
    # Never overwrite credentials from an earlier deployment.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)


def wait_service(name, image=None):
    for _ in range(90):
        ids = call("docker", "ps", "-q", "--filter", f"label=com.docker.swarm.service.name={name}").split()
        if ids:
            task = json.loads(call("docker", "inspect", ids[0]))[0]
            state = task["State"]
            if state.get("Health", {}).get("Status") == "healthy" and (image is None or task["Config"]["Image"] == image):
                return ids[0]
        time.sleep(2)
    raise RuntimeError(f"Service did not become healthy: {name}")


def wait_stopped(name):
    for _ in range(90):
        if not call("docker", "ps", "-q", "--filter", f"label=com.docker.swarm.service.name={name}"):
            return
        time.sleep(2)
    raise RuntimeError(f"Service did not stop before migration: {name}")


def wait_public_origin(domain):
    request = urllib.request.Request("https://"+domain+"/login", headers={"User-Agent": "curl/8.10.1"})
    for _ in range(30):
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    raise RuntimeError("Public HTTPS route did not become ready")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("revision")
    parser.add_argument("--target", default="ops/targets/arkitekt.json")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        raise ValueError("Full git revision required")
    target = json.loads(Path(args.target).read_text())
    root = Path.cwd()
    expected = Path(target["release_directory"]) / args.revision
    if root.resolve() != expected.resolve():
        raise ValueError("Execute from the exact release directory")
    shared = Path(target["shared_directory"])
    shared.mkdir(parents=True, exist_ok=True, mode=0o700)
    shared.chmod(0o700)
    env_path = shared / "production.env"
    password_files = {"postgres": shared / "postgres-password", "redis": shared / "redis-password"}
    if not env_path.exists():
        if call("docker", "volume", "ls", "-q", "--filter", "label=com.docker.stack.namespace="+target["stack"]):
            raise RuntimeError("Existing volumes require their original credentials")
        passwords = {key: secrets.token_hex(32) for key in password_files}
        values = {
            "NODE_ENV": "production", "API_PORT": "3001",
            "APP_URL": "https://"+target["domain"], "API_URL": "http://127.0.0.1:3001",
            "DATABASE_URL": f"postgresql://rcs_sender:{passwords['postgres']}@{target['stack']}_postgres:5432/rcs_sender",
            "REDIS_URL": f"redis://:{passwords['redis']}@{target['stack']}_redis:6379/0",
            "RCS_EDGE_PROXY_SECRET": secrets.token_hex(32), "RCS_API_PROXY_SECRET": secrets.token_hex(32),
            "RCS_CREDENTIAL_KEYS": json.dumps({"key1": secrets.token_hex(32)}, separators=(",", ":")),
            "RCS_CREDENTIAL_ACTIVE_KEY": "key1", "LOG_LEVEL": "info",
            "RCS_DOMAIN": target["domain"], "RCS_TRUSTED_PROXY_CIDR": target["trusted_proxy_cidr"],
            "RCS_CLOUDFLARE_CIDRS": " ".join(target["cloudflare_cidrs"]),
        }
        for key, path in password_files.items():
            private_write(path, passwords[key])
        private_write(env_path, "".join(f"{key}='{value}'\n" for key, value in values.items()))
    secret_files = {
        "rcssender_postgres_v1": password_files["postgres"],
        "rcssender_redis_v1": password_files["redis"],
        "rcssender_runtime_v1": env_path,
    }
    for name, path in secret_files.items():
        exists = subprocess.run(["docker", "secret", "inspect", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if not exists:
            call("docker", "secret", "create", name, "-", input=path.read_bytes())
    image = "rcs-sender:"+args.revision
    digests = {}
    for name in [target["postgres_image"], target["redis_image"]]:
        subprocess.run(["docker", "pull", name], check=True)
        digests[name] = json.loads(call("docker", "image", "inspect", name))[0]["RepoDigests"][0]
    env = {**os.environ,
        "RCS_IMAGE": image, "RCS_POSTGRES_IMAGE": digests[target["postgres_image"]],
        "RCS_REDIS_IMAGE": digests[target["redis_image"]], "RCS_NODE": target["node"],
        "RCS_PROXY_NETWORK": target["proxy_network"], "RCS_CERT_RESOLVER": target["certificate_resolver"],
        "RCS_DOMAIN": target["domain"], "RCS_APP_REPLICAS": "0",
        "RCS_POSTGRES_SECRET": "rcssender_postgres_v1", "RCS_REDIS_SECRET": "rcssender_redis_v1",
        "RCS_RUNTIME_SECRET": "rcssender_runtime_v1",
    }
    # Docker 20.10 has no `stack config`; render only our known deployment vars.
    # Preserve $$ so stack deploy performs its normal shell-dollar escaping.
    def variable(match):
        key, fallback = match.group(1), match.group(2)
        if key in env:
            return env[key]
        if fallback is not None:
            return fallback
        raise ValueError("Missing deployment variable: "+key)
    rendered = re.sub(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}", variable, Path("ops/swarm.yaml").read_text()).encode()
    rendered_path = shared / "stack-rendered.yaml"
    rendered_path.write_bytes(rendered)
    subprocess.run(["docker", "compose", "-f", str(rendered_path), "config", "--quiet"], check=True)
    subprocess.run(["docker", "stack", "deploy", "--resolve-image", "never", "-c", str(rendered_path), target["stack"]], check=True)
    wait_stopped(target["stack"]+"_app")
    wait_service(target["stack"]+"_postgres")
    wait_service(target["stack"]+"_redis")
    # A migration failure prevents enabling the public application task.
    subprocess.run(["docker", "run", "--rm", "--user", "0:0", "--network", target["stack"]+"_internal",
                    "-v", str(env_path)+":/run/secrets/rcs_runtime_env:ro",
                    image, "node", "--env-file=/run/secrets/rcs_runtime_env",
                    "packages/database/dist/migrate.js"], check=True)
    record = {"revision": args.revision, "image": image, "image_id": json.loads(call("docker", "image", "inspect", image))[0]["Id"],
              "database_images": digests, "domain": target["domain"], "time_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "state": "migrated", "production_env": str(env_path)}
    (root / "deployment.json").write_text(json.dumps(record, indent=2)+"\n")
    if args.activate:
        subprocess.run(["docker", "service", "scale", "--detach=true", target["stack"]+"_app=1"], check=True)
        wait_service(target["stack"]+"_app", image)
        wait_public_origin(target["domain"])
        record["state"] = "healthy"
        (root / "deployment.json").write_text(json.dumps(record, indent=2)+"\n")
        link = shared.parent / "current"
        temporary = shared.parent / "current.next"
        if temporary.exists() or temporary.is_symlink():
            temporary.unlink()
        temporary.symlink_to(root)
        temporary.replace(link)
    print("Versioned deployment completed: "+record["state"])


if __name__ == "__main__":
    main()
