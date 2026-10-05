"""Public HTTPS smoke test; creates a clearly identified isolated QA workspace."""
import argparse
import http.cookiejar
import json
import os
import secrets
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("origin")
    parser.add_argument("--private-output", required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    if not origin.startswith("https://"):
        raise ValueError("Verified HTTPS origin required")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(method, path, data=None, expected=200, mutation_headers=True):
        headers = {"User-Agent": "curl/8.10.1", "Accept": "application/json,text/html;q=0.9"}
        if method != "GET" and mutation_headers:
            headers.update({"Origin": origin, "X-RCS-Request": "1"})
        body = None if data is None else json.dumps(data).encode()
        if body:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(origin+path, data=body, headers=headers, method=method)
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        if response.code != expected:
            raise RuntimeError(f"Smoke request failed: {method} {path}: status {response.code}, expected {expected}")
        content = response.read()
        return json.loads(content) if content and "application/json" in response.headers.get("Content-Type", "") else None

    suffix = uuid.uuid4().hex
    account = {"name": "Deployment QA", "email": "deploy-"+suffix+"@example.test",
               "password": secrets.token_urlsafe(32), "workspaceName": "Deployment QA - no RCS sends"}
    output = Path(args.private_output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(account, stream)
    request("GET", "/login")
    request("POST", "/api/auth/register", account, 201)
    cookies = list(jar)
    assert any(cookie.name.startswith("__Host-") and cookie.secure for cookie in cookies), "Secure host-only cookie"
    workspaces = request("GET", "/api/workspaces")["workspaces"]
    workspace = workspaces[0]["id"]
    base = "/api/workspaces/"+workspace
    request("GET", "/api/workspaces/"+str(uuid.uuid4())+"/messages", expected=404)
    request("POST", base+"/messages", {"name": "CSRF blocked", "purpose": "marketing", "content": {"type": "text", "text": "QA"}}, expected=403, mutation_headers=False)
    created = request("POST", base+"/messages", {"name": "Deployment QA", "purpose": "marketing", "archetype": "offer", "content": {"type": "text", "text": "QA draft - never sent"}}, 201)
    message = created["message"]["id"]
    request("PATCH", base+"/messages/"+message+"/status", {"status": "active", "expectedVersion": 1})
    changed = request("PUT", base+"/messages/"+message, {"name": "Deployment QA updated", "purpose": "marketing", "archetype": "launch", "expectedVersion": 1, "content": {"type": "text", "text": "QA draft - never sent"}})
    assert changed["current"]["archetype"] == "launch" and changed["active"]["archetype"] == "offer"
    request("POST", base+"/contacts", {"phone": "+12025550142", "name": "Reserved fictional QA number"}, 201)
    contact = request("GET", base+"/contacts")["contacts"][0]["id"]
    journey = request("POST", base+"/journeys", {"name": "Deployment QA - local only"}, 201)["journey"]["id"]
    graph = {"nodes": [
        {"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "config": {}},
        {"id": "tag", "type": "tag", "position": {"x": 200, "y": 0}, "config": {"action": "add", "tag": "deployment_qa"}},
        {"id": "end", "type": "end", "position": {"x": 400, "y": 0}, "config": {}}],
        "edges": [{"id": "a", "source": "start", "target": "tag", "port": "next"}, {"id": "b", "source": "tag", "target": "end", "port": "next"}],
        "viewport": {"x": 0, "y": 0, "zoom": 1}}
    request("PUT", base+"/journeys/"+journey, {"name": "Deployment QA - local only", "expectedRevision": 1, "graph": graph})
    request("POST", base+"/journeys/"+journey+"/publish", {"expectedRevision": 2}, 201)
    request("POST", base+"/journeys/"+journey+"/control", {"expectedRevision": 3, "action": "activate"})
    request("POST", base+"/journeys/"+journey+"/enrollments", {"contactId": contact, "source": "manual"}, 201)
    for _ in range(35):
        rows = request("GET", base+"/journeys/"+journey+"/enrollments")["enrollments"]
        if rows[0]["status"] == "completed":
            break
        time.sleep(4)
    else:
        raise RuntimeError("Worker did not complete the local QA journey")
    assert request("GET", base+"/operations")["worker"] == "healthy"
    catalog = request("GET", base+"/providers/catalog")["providers"]
    assert len(catalog) == 5 and all(not item["active"] for item in catalog)
    request("POST", "/api/auth/logout", {}, 204)
    request("GET", "/api/auth/me", expected=401)
    request("POST", "/api/auth/login", {"email": account["email"], "password": account["password"]})
    request("POST", "/api/auth/logout", {}, 204)
    account.update({"workspaceId": workspace, "journeyId": journey, "state": "smoke_passed"})
    output.write_text(json.dumps(account))
    print("Public smoke passed: HTTPS, Secure cookie, CSRF, isolation, message revision/category, worker journey, inactive providers, logout/login.")


if __name__ == "__main__":
    main()
