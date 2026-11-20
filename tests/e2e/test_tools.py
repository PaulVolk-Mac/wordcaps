"""Playwright-Tests fuer die 5 Web-Tools (J-138 / A-255).

Aufruf (Python mit playwright; Browser = installiertes Edge, kein Download noetig):
    python tests/e2e/test_tools.py [--channel msedge|chrome|chromium] [--shots <ordner>]

Je Tool, Desktop 1280 px und Handy 390 px:
  - Seite laedt (HTTP 200), <title> und <h1> vorhanden
  - 0 pageerror, 0 console.error
  - kein Querscrollen
  - offline-Versprechen: keine Anfrage an fremde Hosts
  - Screenshot
Dazu je Tool eine Funktionsprobe (Hauptaktion). Exit 0 nur, wenn alles gruen.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ["subtitle-converter", "safe-zone-checker", "noise-machine", "hiit-timer", "slowed-reverb"]
SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line\n"


def probe_subtitle_converter(page):
    page.fill("#inp", SRT)
    page.select_option("#fmt", "vtt")
    page.click("#go")
    out = page.input_value("#out") if page.eval_on_selector("#out", "e => 'value' in e") else page.inner_text("#out")
    assert "WEBVTT" in out and "00:00:01.000 --> 00:00:02.500" in out, f"VTT falsch: {out[:120]!r}"
    return "SRT->VTT ok"


def probe_safe_zone_checker(page):
    n = page.eval_on_selector_all("#tabs button, #tabs [role=tab], #tabs > *", "els => els.length")
    assert n >= 3, f"nur {n} Plattform-Tabs"
    rows = page.eval_on_selector_all("#tbl tr", "els => els.length")
    assert rows >= 2, f"Tabelle leer ({rows} Zeilen)"
    return f"{n} Tabs, {rows} Tabellenzeilen"


def probe_noise_machine(page):
    n = page.eval_on_selector_all("#mixer input[type=range]", "els => els.length")
    assert n >= 3, f"nur {n} Regler"
    page.click("#play")
    page.wait_for_timeout(400)
    txt = page.inner_text("#play")
    assert "Play" not in txt or "Pause" in txt or "Stop" in txt, f"Play-Knopf unveraendert: {txt!r}"
    return f"{n} Regler, Knopf jetzt {txt.strip()!r}"


def probe_hiit_timer(page):
    vor = page.inner_text("#clock")
    page.click("#go")
    page.wait_for_timeout(1500)
    nach = page.inner_text("#clock")
    assert nach != vor or page.inner_text("#go").strip() != "Start", f"Timer laeuft nicht ({vor} -> {nach})"
    return f"Uhr {vor} -> {nach}"


def probe_slowed_reverb(page):
    page.click("#demo")
    page.wait_for_timeout(2500)
    sichtbar = page.is_visible("#play")
    assert sichtbar, "Play-Knopf nach Demo nicht sichtbar"
    return "Demo-Loop geladen, Play sichtbar"


PROBEN = {
    "subtitle-converter": probe_subtitle_converter,
    "safe-zone-checker": probe_safe_zone_checker,
    "noise-machine": probe_noise_machine,
    "hiit-timer": probe_hiit_timer,
    "slowed-reverb": probe_slowed_reverb,
}


class _Leise(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def server_starten():
    h = functools.partial(_Leise, directory=str(ROOT))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="msedge")
    ap.add_argument("--shots", default=str(ROOT / "tests" / "e2e" / "_shots"))
    ap.add_argument("--nur", help="nur dieses Tool")
    a = ap.parse_args(argv)
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    srv, base = server_starten()
    ok = fehl = 0
    with sync_playwright() as p:
        kw = {"headless": True}
        if a.channel != "chromium":
            kw["channel"] = a.channel
        br = p.chromium.launch(**kw)
        for tool in TOOLS:
            if a.nur and tool != a.nur:
                continue
            for name, vp in (("desktop", {"width": 1280, "height": 900}), ("handy", {"width": 390, "height": 844})):
                ctx = br.new_context(viewport=vp)
                page = ctx.new_page()
                fehler, fremd = [], []
                page.on("pageerror", lambda e, f=fehler: f.append(f"pageerror: {e}"))
                page.on("console", lambda m, f=fehler: f.append(f"console: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
                page.on("request", lambda r, f=fremd: f.append(r.url) if urlparse(r.url).hostname not in ("127.0.0.1", None) and not r.url.startswith(("data:", "blob:")) else None)
                page.on("response", lambda r, f=fehler: f.append(f"HTTP {r.status}: {urlparse(r.url).path}") if r.status >= 400 else None)
                pruef = []
                try:
                    resp = page.goto(f"{base}/tools/{tool}/", wait_until="load")
                    assert resp is not None and resp.status == 200, f"HTTP {resp.status if resp else '-'}"
                    assert page.title().strip(), "kein <title>"
                    assert page.locator("h1").count() >= 1, "kein <h1>"
                    breit = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                    assert breit <= 1, f"Querscrollen {breit}px"
                    if name == "desktop":
                        pruef.append(PROBEN[tool](page))
                    page.wait_for_timeout(300)
                    page.screenshot(path=str(shots / f"{tool}_{name}.png"), full_page=False)
                    assert not fehler, "; ".join(fehler)[:300]
                    assert not fremd, "fremde Anfragen: " + ", ".join(sorted(set(fremd)))[:300]
                    ok += 1
                    print(f"OK   {tool:20s} {name:7s} {' | '.join(pruef)}")
                except Exception as e:  # noqa: BLE001 - Testbericht
                    fehl += 1
                    print(f"FAIL {tool:20s} {name:7s} {type(e).__name__}: {str(e)[:300]}")
                finally:
                    ctx.close()
        br.close()
    srv.shutdown()
    print(f"\n{ok}/{ok + fehl} OK  (Screenshots: {shots})")
    return 1 if fehl else 0


if __name__ == "__main__":
    sys.exit(main())
