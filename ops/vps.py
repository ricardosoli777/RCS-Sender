"""Paramiko transport for versioned deployments; credentials remain in a local private file."""
import argparse
import hashlib
import re
import sys
import time
import unicodedata
from pathlib import Path

import paramiko


def credentials(path):
    content = Path(path).read_text(encoding="utf-8-sig")
    fields = {}
    for line in content.splitlines():
        match = re.match(r"\s*([^:=]+)\s*[:=]\s*(.*?)\s*$", line)
        if match:
            label = unicodedata.normalize("NFKD", match[1]).encode("ascii", "ignore").decode().strip().lower()
            fields[label] = match[2]
    host = fields.get("host") or fields.get("ip")
    if not host:
        match = re.search(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", content)
        host = match[0] if match else None
    user = fields.get("login") or fields.get("user") or fields.get("usuario")
    password = fields.get("senha") or fields.get("password")
    if not host or not user or not password:
        raise ValueError("Private file must contain host/IP, LOGIN and Senha; values are never printed.")
    return host, int(fields.get("porta") or fields.get("port") or 22), user, password


class PinFirstHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        client.get_host_keys().add(hostname, key.get_name(), key)
        client.save_host_keys(client._host_keys_filename)
        fingerprint = hashlib.sha256(key.asbytes()).hexdigest()
        print(f"SSH first-use host key pinned: SHA256:{fingerprint}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--credentials", required=True)
    parser.add_argument("--known-hosts", default=".secrets/vps-known-hosts")
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("run", help="Execute a Bash script read from stdin.")
    upload = sub.add_parser("upload")
    upload.add_argument("source")
    upload.add_argument("destination")
    args = parser.parse_args()
    host, port, user, password = credentials(args.credentials)
    known = Path(args.known_hosts)
    known.parent.mkdir(parents=True, exist_ok=True)
    known.touch(exist_ok=True)
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.load_host_keys(str(known))
    client.set_missing_host_key_policy(PinFirstHost())
    try:
        client.connect(host, port=port, username=user, password=password, timeout=20,
                       auth_timeout=20, banner_timeout=20, look_for_keys=False, allow_agent=False)
        if args.operation == "upload":
            with client.open_sftp() as sftp:
                sftp.put(args.source, args.destination)
            print("Upload completed.")
            return
        script = sys.stdin.read().lstrip("\ufeff")
        stdin, stdout, _ = client.exec_command("bash -se", timeout=3600)
        stdin.write(script)
        stdin.flush()
        stdin.channel.shutdown_write()
        channel = stdout.channel
        # Drain both streams continuously, including long image builds.
        while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
            for ready, receive in [(channel.recv_ready, channel.recv), (channel.recv_stderr_ready, channel.recv_stderr)]:
                if ready():
                    text = receive(32768).decode("utf-8", "replace").replace(password, "[REDACTED]")
                    print(text, end="", flush=True)
            time.sleep(0.1)
        sys.exit(channel.recv_exit_status())
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except (paramiko.SSHException, OSError, ValueError) as error:
        # Exception text may contain connection/authentication details.
        print(f"VPS operation failed ({type(error).__name__}); credentials omitted.", file=sys.stderr)
        sys.exit(1)
