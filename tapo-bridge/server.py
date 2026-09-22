"""
Tiny HTTP bridge around pytapo so the dashboard API can talk to TP-Link Tapo
cameras (and H200 hub child devices) without re-implementing the Tapo login
crypto in Node. Internal-only: never exposed outside the compose network.

POST /devices  {host, user, password}                 -> camera(s) behind that host
POST /events   {host, user, password, childId?, hours} -> detection events
"""
import json
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from pytapo import Tapo

SESSIONS = {}  # (host, childId) -> Tapo
TRANSPORT = {}  # host -> "klap" | "legacy"
AUTH_FAILED = {}  # host -> unix time of last rejected login; cameras lock after ~10 bad attempts
AUTH_HOLDOFF = 120


def is_klap(host):
    """Newer firmware answers plain HTTP on 443 with '200 OK' and wants KLAP (email+password)."""
    if host in TRANSPORT:
        return TRANSPORT[host] == "klap"
    try:
        r = requests.get(f"http://{host}:443", timeout=3)
        klap = "200 OK" in r.text
    except requests.RequestException:
        klap = False
    TRANSPORT[host] = "klap" if klap else "legacy"
    return klap


def client(host, user, password, child_id=None, auth="cloud", email=""):
    key = (host, child_id)
    if key not in SESSIONS:
        last = AUTH_FAILED.get(host)
        if last and time.time() - last < AUTH_HOLDOFF:
            wait = int(AUTH_HOLDOFF - (time.time() - last))
            raise Exception(f"Last login was rejected; holding off {wait}s so the camera doesn't lock (it allows ~10 wrong attempts)")
        if auth == "camera":
            # local "Camera Account" (Advanced -> Camera Account); no TP-Link ID involved
            SESSIONS[key] = Tapo(host, user, password, childID=child_id, printDebugInformation=False, printWarnInformation=False)
        elif is_klap(host):
            # KLAP: credential is the TP-Link ID *email* + password
            if not email:
                raise Exception("This camera uses the newer KLAP login, which needs your TP-Link ID email as well as the password")
            SESSIONS[key] = Tapo(host, email, password, cloudPassword=password, childID=child_id, isKLAP=True, printDebugInformation=False, printWarnInformation=False)
        else:
            # legacy: username is always admin, password doubles as cloudPassword for SHA256 firmware
            SESSIONS[key] = Tapo(host, "admin", password, cloudPassword=password, childID=child_id, isKLAP=False, printDebugInformation=False, printWarnInformation=False)
    return SESSIONS[key]


def basic(t):
    info = t.getBasicInfo()
    b = info.get("device_info", {}).get("basic_info", info)
    if "result" in b and isinstance(b["result"], dict):
        b = b["result"]
    nick = b.get("nickname")
    if nick:
        try:
            import base64
            nick = base64.b64decode(nick).decode("utf8")
        except Exception:
            pass
    return {
        "name": b.get("device_alias") or b.get("device_name") or nick or b.get("model"),
        "model": b.get("device_model") or b.get("model"),
        "mac": b.get("mac"),
        "firmware": b.get("sw_version"),
        "type": b.get("device_type"),
        "hub": (b.get("device_type") or "").upper().find("HUB") >= 0 or (b.get("device_model") or "").upper().startswith("H"),
    }


def battery(t):
    try:
        r = t.getBatteryStatus()
        s = r.get("battery", {}).get("status", r)
        if not isinstance(s, dict):
            return None
        pct = s.get("battery_percent", s.get("percent"))
        ch = s.get("battery_charging", s.get("charging"))
        charging = (ch is True) or (isinstance(ch, str) and ch.upper() not in ("NO", "FALSE", "0", ""))
        return {
            "percent": pct,
            "charging": charging,
            "low": bool(s.get("low_battery")),
            "power": s.get("power_mode"),
            "temperature": s.get("battery_temperature"),
            "raw": s,
        }
    except Exception:
        return None


def devices(body):
    host, user, password, auth, email = body["host"], body.get("user") or "admin", body["password"], body.get("auth") or "cloud", body.get("email") or ""
    root = client(host, user, password, None, auth, email)
    info = basic(root)
    info["transport"] = "camera-account" if auth == "camera" else TRANSPORT.get(host)
    cams = []
    if info["hub"]:
        r = root.getChildDevices()
        for d in r.get("childControl", {}).get("child_device_list", r.get("child_device_list", [])):
            cid = d.get("device_id")
            cam = {
                "id": cid,
                "name": d.get("alias") or d.get("device_alias") or d.get("model"),
                "model": d.get("device_model") or d.get("model"),
                "category": d.get("category"),
                "online": d.get("status") == "online" if "status" in d else None,
                "childId": cid,
            }
            cat = (cam["category"] or "").lower()
            if "camera" in cat or "cam" in (cam["model"] or "").lower() or (cam["model"] or "").upper().startswith("C") or (cam["model"] or "").upper().startswith("D"):
                try:
                    cam["battery"] = battery(client(host, user, password, cid, auth, email))
                except Exception as e:  # child may be asleep
                    cam["battery"] = None
                    cam["error"] = str(e)
                cams.append(cam)
    else:
        cams.append({"id": info.get("mac") or host, "name": info["name"], "model": info["model"], "childId": None, "online": True, "battery": battery(root)})
    return {"host": info, "cameras": cams}


ALARM_TYPES = {
    2: "motion", 3: "tamper", 4: "linecrossing", 5: "intrusion", 6: "person", 7: "baby", 8: "vehicle", 9: "pet",
    11: "bark", 12: "meow", 13: "glassbreak", 14: "smoke", 15: "package", 16: "package_taken", 20: "face", 32: "loitering",
    # doorbells
    1: "ring", 10: "ring",
}


def classify(e):
    """Tapo event payloads vary by model; use the numeric alarm_type when present, else sniff keys/values."""
    at = e.get("alarm_type")
    if isinstance(at, int) and at in ALARM_TYPES:
        return ALARM_TYPES[at]
    blob = json.dumps(e).lower()
    explicit = e.get("alarm_type") or e.get("event_type") or e.get("type") or e.get("detect_type")
    if isinstance(explicit, str):
        blob = explicit.lower() + " " + blob
    for needle, kind in (("ring", "ring"), ("doorbell", "ring"), ("button", "ring"), ("person", "person"), ("people", "person"), ("human", "person"),
                         ("vehicle", "vehicle"), ("car", "vehicle"), ("pet", "pet"), ("dog", "pet"), ("cat", "pet"), ("package", "package"),
                         ("baby", "baby"), ("cry", "baby"), ("tamper", "tamper"), ("line", "linecrossing"), ("motion", "motion")):
        if needle in blob:
            return kind
    return "motion"


def events(body):
    host, user, password, auth, email = body["host"], body.get("user") or "admin", body["password"], body.get("auth") or "cloud", body.get("email") or ""
    child = body.get("childId")
    hours = float(body.get("hours") or 24)
    t = client(host, user, password, child, auth, email)
    now = int(time.time())
    corr = t.getTimeCorrection() or 0
    evs = t.getEvents(startTime=now - corr - int(hours * 3600), endTime=now - corr + 60)
    out = []
    for e in evs:
        out.append({
            "start": e.get("start_time"),
            "end": e.get("end_time"),
            "type": classify(e),
            "raw": {k: v for k, v in e.items() if k not in ("start_time", "end_time", "startRelative", "endRelative")},
        })
    out.sort(key=lambda x: x["start"] or 0, reverse=True)
    return {"events": out[: int(body.get("limit") or 20)], "total": len(out)}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._json(200, {"ok": True, "service": "tapo-bridge"})

    def do_POST(self):
        try:
            n = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/devices":
                return self._json(200, {"ok": True, **devices(body)})
            if self.path == "/events":
                return self._json(200, {"ok": True, **events(body)})
            return self._json(404, {"ok": False, "error": "unknown endpoint"})
        except Exception as e:
            # drop a broken session so the next call re-logs-in
            try:
                SESSIONS.pop((body.get("host"), body.get("childId")), None)
                TRANSPORT.pop(body.get("host"), None)
                if "Invalid authentication" in str(e) or "-40401" in str(e):
                    AUTH_FAILED[body.get("host")] = time.time()
            except Exception:
                pass
            traceback.print_exc()
            return self._json(200, {"ok": False, "error": str(e)})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8484), H).serve_forever()
