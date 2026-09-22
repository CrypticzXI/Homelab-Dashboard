# Tapo cameras

[← back to the README](../README.md) · [Widgets](widgets.md) · [Installation](install.md) · [Configuration](configuration.md) · [Development](development.md)

Battery-friendly support for TP-Link Tapo cameras, including battery models and doorbells, either standalone or behind an **H200 hub**.

## What you get

- **Live view on demand** — press ▶ and the stream opens; mute and fullscreen in the control bar. Stopping closes the connection so the camera can sleep again.
- **Event timeline** grouped by day, with detection types (person, vehicle, pet, package, doorbell ring, baby cry, tamper…), clock time, relative time and duration.
- **Event photos** — when a refresh notices a new detection, one frame is captured and stored against that event. Thumbnails appear in the timeline, click to enlarge, and the newest doubles as the tile's idle image.
- **Battery %**, charging state, offline badge.

## Battery behaviour

Battery cameras sleep between detections, and every contact costs power. So:

- The server contacts a camera **at most once every 10 minutes**, no matter how many browsers have the page open. Battery, events and (optionally) a still image come from that one wake-up.
- **Still images default to mains-powered cameras only.** Battery cameras show their most recent event photo instead. You can switch to *All cameras* or *Never* per widget.
- Live view runs only while you're watching.
- Optional **background watch** keeps the 10-minute check running even with no browser open, so event photos are captured while you're away.

## Setup

### 1. Turn on Third-Party Compatibility

In the Tapo app: **Me → Third-Party Compatibility → On** (on some versions it's under *Me → Tapo Lab*). Then open each camera once in the app while on the same Wi-Fi.

Since late 2024 TP-Link gates local API access behind this switch. Without it the camera rejects a perfectly correct password with `-40401`, which looks exactly like a wrong password. A firmware update can silently reset it — if the widget breaks later, toggle it off and on again.

### 2. Add the widget

**Edit → + Add widget → Home & cameras → Tapo cameras**

| Field | Value |
|---|---|
| Camera or hub IP | `192.168.1.60` — a hub lists all its cameras |
| Login with | **TP-Link ID password** (works for everything), or **Camera Account** (wired cameras only) |
| TP-Link ID email | your Tapo account email — newer firmware (KLAP) needs it |
| Password | your TP-Link account password |

Press **Test connection**. A sleeping battery camera can take 10–20 s to answer the first time.

> **This is not a cloud service.** "TP-Link ID password" means the password of the free account you set the cameras up with; the camera verifies it locally on your LAN. Tapo Care (paid cloud recording) isn't involved, and nothing is sent to TP-Link.

### Which login do I use?

| Camera type | Camera Account | TP-Link ID | Live view |
|---|---|---|---|
| Wired (C100, C200, C210, C320…) | ✅ Advanced → Camera Account | ✅ | RTSP or `tapo://` |
| Battery (C400, C420, C425, TC82…) | ❌ not offered | ✅ | `tapo://` |
| Doorbells (D230, TD21…) | ❌ not offered | ✅ | `tapo://` |

Battery models don't expose RTSP/ONVIF or a local Camera Account — that's a TP-Link limitation, not this app's.

## How it works

```
Tapo widget ──► API ──► tapo bridge (pytapo)  ──► camera/hub  device info, battery, events
            └─► API ──► go2rtc (tapo:// )     ──► camera      live stream + JPEG frames
browser     ──► nginx /go2rtc/ (login required, playback endpoints only)
```

- The **pytapo bridge** handles the encrypted local login (legacy and KLAP), hub child-device enumeration, battery and `searchDetectionList` events.
- **go2rtc** speaks the proprietary `tapo://` protocol and only connects to a camera while something is consuming the stream.
- Registered streams embed the camera credential, so go2rtc runs against a throwaway copy of its config — nothing is written into the image or the repo — and nginx only proxies its playback endpoints, never its stream list.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *Tapo rejected the login* | Third-Party Compatibility off (most likely), wrong account, or the camera was set up on someone else's account. If your TP-Link ID uses Google/Apple sign-in, set a password on the account first |
| *…needs your TP-Link ID email* | Newer KLAP firmware — fill in the email field |
| *Temporary Suspension* | Too many failed attempts; the camera locks briefly. The bridge waits 2 minutes after any rejection to protect you from this |
| Events show but live view fails | go2rtc can't reach the camera, or the model isn't supported by `tapo://`. Check `docker compose logs -f` |
| No event photos | Photo capture needs go2rtc to grab a frame — check the widget's *Capture a photo…* option and that live view works |
| Nothing at all after a firmware update | Toggle Third-Party Compatibility off/on, open the camera in the app, retry |
