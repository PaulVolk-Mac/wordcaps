"""Browser test for the noise machine: focus timer + local stats + installable app (PWA) + offline reload.

    python tests/noise-machine/test_pwa.py [--channel msedge|chrome|chromium] [--shots <dir>]

Needs only `pip install playwright` (>= 1.45, for the fake clock) and an installed Edge/Chrome.
Serves the repo on 127.0.0.1 (service workers need http://localhost or https), runs headless,
exit 0 only if every check passes. Time is faked (Thu 2026-11-19 10:00 local), so 30 minutes
of focus run in a few seconds.

Checks
  1  page loads, service worker takes control, app shell is in the cache
  2  focus mode buttons: link carries f=25&b=5, focus and sleep timer exclude each other
  3  a full 25/5 cycle: countdown, minutes counted only in focus, break state, round 2, storage
  4  OFFLINE (context.set_offline): reload still loads, stats and mode survive, it plays,
     manifest + icons come from the cache, offline deep link works
  5  stats from stored days (week since Monday, streak), broken storage, old links
  6  Chrome's own installability check (CDP Page.getInstallabilityErrors) reports no errors
  7  phone width 390 px: no sideways scrolling, tap targets >= 44 px
  8  focus mode as specified (A-314): #fokus deep link, 15/25/50 with 5/10 freely combined,
     switch "sound at the change", switch "quieter noise in breaks" (gain measured in the audio graph)
"""
from __future__ import annotations

import argparse
import datetime
import functools
import http.server
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PFAD = "/tools/noise-machine/"
ok = 0
bad = 0


def t(name: str, cond: bool, info: str = "") -> None:
    global ok, bad
    if cond:
        ok += 1
        print(f"  ok    {name}" + (f"  [{info}]" if info else ""))
    else:
        bad += 1
        print(f"  FAIL  {name}" + (f"  [{info}]" if info else ""))


class Still(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass


def server():
    h = functools.partial(Still, directory=str(ROOT))
    Still.extensions_map = {**Still.extensions_map, ".webmanifest": "application/manifest+json"}
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default="msedge")
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    shots = Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    srv = server()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    url = base + PFAD
    fehler: list[str] = []
    pressed = "[...document.querySelectorAll('#%s button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)"

    with sync_playwright() as pw, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as prof:
        # persistent profile: a normal (not incognito) browser, as installability requires
        ctx = pw.chromium.launch_persistent_context(
            prof, channel=a.channel, headless=True, viewport={"width": 1280, "height": 900}, color_scheme="light",
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        # the visitor counter is the only third-party request; keep the test hermetic
        ctx.route("**/static.cloudflareinsights.com/**", lambda r: r.abort())
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("pageerror", lambda e: fehler.append(f"pageerror: {e}"))
        page.on("console", lambda m: fehler.append(f"console.error: {m.text}")
                if m.type == "error" and "cloudflareinsights" not in m.text and "ERR_FAILED" not in m.text
                and "ERR_INTERNET_DISCONNECTED" not in m.text else None)
        page.clock.install(time=datetime.datetime(2026, 11, 19, 10, 0, 0))  # a Thursday, local time

        print("1 load + service worker")
        r = page.goto(url)
        t("HTTP 200", r is not None and r.status == 200)
        page.evaluate("navigator.serviceWorker.ready.then(() => 1)")
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        t("service worker controls the page", True)
        keys = page.evaluate("caches.keys().then(async ks => { const o = {}; for (const k of ks) o[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); return o })")
        shell = [p for v in keys.values() for p in v]
        t("app shell cached", PFAD in shell and any(p.endswith("manifest.webmanifest") for p in shell) and sum(p.endswith(".png") for p in shell) == 3, f"{len(shell)} files")
        t("install row hidden until the browser offers it", page.is_hidden("#pwa") or page.is_visible("#install"))
        t("the 7 sounds and 7 sleep timers are still there", page.locator("#presets .tile").count() == 7 and page.locator("#timer button").count() == 7)

        print("2 focus timer buttons")
        t("5 choices (Off, 15, 25, 50, 90), Off is selected", page.evaluate("[...document.querySelectorAll('#focus button')].map(b => b.textContent)") == ["Off", "15 m", "25 m", "50 m", "90 m"] and page.evaluate(pressed % "focus") == ["Off"])
        t("break length and switches hidden while focus is off, short text shown", page.is_hidden("#focusOpts") and page.is_visible("#focusSub"))
        t("stats hidden while unused", page.is_hidden("#stats"))
        page.click("#focus button >> nth=2")
        t("25 m selected with 5 m break, link carries f=25&b=5", page.evaluate(pressed % "focus") == ["25 m"] and page.evaluate(pressed % "brk") == ["5 m"] and page.url.endswith("#brown=70&f=25&b=5"), page.url.split("#")[-1])
        t("break length + both switches appear, both on", page.is_visible("#focusOpts") and page.is_hidden("#focusSub") and page.is_checked("#fChime") and page.is_checked("#fQuiet"))
        t("stats appear with zeros", page.is_visible("#stats") and page.inner_text("#sToday") == "0 min" and page.inner_text("#sStreak") == "0 days")
        t("status explains the mode", "Focus 25 min, break 5 min" in page.inner_text("#status"), page.inner_text("#status"))
        page.click("#timer button >> nth=2")  # 30 m sleep timer
        t("sleep timer switches focus off", page.evaluate(pressed % "focus") == ["Off"] and page.url.endswith("#brown=70&t=30") and page.is_hidden("#stats") and page.is_hidden("#focusOpts"))
        page.click("#focus button >> nth=2")
        t("focus switches the sleep timer off", page.evaluate(pressed % "timer") == ["Off"] and page.url.endswith("#brown=70&f=25&b=5"))

        print("3 one full 25/5 cycle (fake clock)")
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(61_000)
        t("counts down", page.inner_text("#status") == "Focus 1 · 23:59 left", page.inner_text("#status"))
        t("tab title shows the countdown", page.title() == "23:59 focus · Noise Machine", page.title())
        t("1 minute counted", page.inner_text("#sToday") == "1 min" and page.inner_text("#sStreak") == "1 day")
        st = page.evaluate("JSON.parse(localStorage.getItem('noise11f'))")
        t("stored under today's date, in seconds", list(st.keys()) == ["2026-11-19"] and 60 <= st["2026-11-19"] <= 61, str(st))
        t("audio graph is running", page.evaluate("document.body.classList.contains('on')") and not page.evaluate("document.body.classList.contains('brk')"))
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_focus.png"), full_page=True)
        page.clock.run_for(1_439_000)
        t("break starts after 25:00", page.inner_text("#status").startswith("Break · 5:00"), page.inner_text("#status"))
        t("break state on the page", page.evaluate("document.body.classList.contains('brk')") and page.title() == "5:00 break · Noise Machine")
        t("break text: round done, stand up", "round 1 done" in page.inner_text("#status") and "stand up, drink some water" in page.inner_text("#status"), page.inner_text("#status"))
        t("25 minutes counted", page.inner_text("#sToday") == "25 min" and page.inner_text("#sWeek") == "25 min")
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_break.png"), full_page=True)
        page.clock.run_for(301_000)
        t("round 2 starts by itself", page.inner_text("#status") == "Focus 2 · 24:59 left", page.inner_text("#status"))
        t("break minutes are not counted", page.inner_text("#sToday") == "25 min")
        page.click("#play")
        st = page.evaluate("JSON.parse(localStorage.getItem('noise11f'))")
        t("pause saves at once (1501 s = 25 min focus + 1 s)", abs(st["2026-11-19"] - 1501) < 0.01, str(st))
        t("paused, break colour off", page.get_attribute("#play", "aria-label") == "Play" and not page.evaluate("document.body.classList.contains('brk')"))
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(2_000)
        t("resume continues the round instead of restarting", page.inner_text("#status") == "Focus 2 · 24:57 left", page.inner_text("#status"))
        page.click("#play")

        print("4 offline")
        ctx.set_offline(True)
        r = page.reload()
        t("offline reload answers 200 from the service worker", r is not None and r.status == 200 and r.from_service_worker, f"status {r.status if r else None}")
        t("navigator.onLine is false (really offline)", page.evaluate("navigator.onLine") is False)
        t("page is complete", "Noise Machine" in page.inner_text("h1") and page.locator("#presets .tile").count() == 7)
        t("mode and minutes survive", page.evaluate(pressed % "focus") == ["25 m"] and page.inner_text("#sToday") == "25 min" and page.is_visible("#stats"))
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(60_000)
        t("plays and counts offline", page.inner_text("#status") == "Focus 1 · 24:00 left" and page.inner_text("#sToday") == "26 min", page.inner_text("#status") + " / " + page.inner_text("#sToday"))
        page.click("#play")
        mf = page.evaluate("fetch('manifest.webmanifest').then(r => r.json()).then(j => j.short_name).catch(e => 'ERR ' + e)")
        t("manifest served offline", mf == "Noise Machine", str(mf))
        ic = page.evaluate("Promise.all(['icon-192.png','icon-512.png','icon-maskable-512.png'].map(f => fetch(f).then(r => r.ok).catch(() => false)))")
        t("icons served offline", ic == [True, True, True], str(ic))
        r = page.goto(url + "?src=app#rain=58&pink=13&f=50")
        t("offline deep link loads with its mix", r is not None and r.status == 200 and page.inner_text("#mixName") == "Rain" and page.evaluate(pressed % "focus") == ["50 m"] and page.evaluate(pressed % "brk") == ["10 m"])
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_offline.png"), full_page=True)

        print("5 stats from stored days / robustness (back online)")
        ctx.set_offline(False)
        page.evaluate("localStorage.setItem('noise11f', JSON.stringify({'2026-11-15': 7200, '2026-11-17': 3600, '2026-11-18': 1800, '2026-11-19': 1500}))")
        page.goto(url + "?a=1#brown=70&f=25")
        t("week counts Monday to today (Sunday left out)", page.inner_text("#sWeek") == "1 h 55 min", page.inner_text("#sWeek"))
        t("streak of 3 days", page.inner_text("#sStreak") == "3 days" and page.inner_text("#sToday") == "25 min")
        page.goto(url + "?a=2#rain=65&pink=15&t=30")
        t("old link with sleep timer still works", page.evaluate(pressed % "timer") == ["30 m"] and page.evaluate(pressed % "focus") == ["Off"] and page.inner_text("#n_rain") == "65")
        t("stats stay visible once there are minutes", page.is_visible("#stats"))
        page.evaluate("localStorage.setItem('noise11f', '{broken')")
        page.goto(url + "?a=3#brown=70")
        t("broken storage does not break the page", page.is_hidden("#stats") and page.inner_text("#mixName") == "Deep sleep")
        page.click("#focus button >> nth=3")
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(60_000)
        page.click("#play")
        st = page.evaluate("JSON.parse(localStorage.getItem('noise11f'))")
        t("broken storage is replaced by clean data", list(st.keys()) == ["2026-11-19"] and abs(st["2026-11-19"] - 60) < 0.01, str(st))
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(5_000)
        page.click("#focus button >> nth=0")
        page.clock.run_for(2_000)
        t("switching focus off while playing keeps the noise on", page.inner_text("#status") == "Playing · no timer" and page.get_attribute("#play", "aria-label") == "Pause")
        page.click("#play")

        print("6 installability (Chrome's own check)")
        cdp = ctx.new_cdp_session(page)
        man = cdp.send("Page.getAppManifest")
        t("manifest found + parses without errors", man.get("url", "").endswith("manifest.webmanifest") and not man.get("errors"), str(man.get("errors")))
        inst = cdp.send("Page.getInstallabilityErrors").get("installabilityErrors", [])
        t("no installability errors", inst == [], str([e.get("errorId") for e in inst]))
        t("theme-color + apple-touch-icon present", page.locator('meta[name="theme-color"]').count() == 1 and page.locator('link[rel="apple-touch-icon"]').count() == 1)

        print("7 phone 390 px")
        page.set_viewport_size({"width": 390, "height": 844})
        page.evaluate("localStorage.setItem('noise11f', JSON.stringify({'2026-11-17': 3600, '2026-11-18': 5400, '2026-11-19': 3000}))")
        page.goto(url + "?a=4#brown=64&pink=42&f=50")
        page.evaluate("document.getElementById('pwa').hidden = false")  # how the install row looks once offered
        t("no sideways scrolling", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        box = page.evaluate("['#focus button','#brk button','#timer button','.fopt .sw','#install','#play'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)] })")
        t("tap targets >= 44 px", all(b[1] >= 44 and b[2] >= 44 for b in box), str(box))
        sb = page.evaluate("(() => { const r = document.getElementById('stats').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] })()")
        t("stats fit the screen", sb[0] >= 0 and sb[1] <= 390, str(sb))
        if shots:
            page.screenshot(path=str(shots / "handy_390_focus.png"), full_page=True)
        print("8 focus mode as specified (A-314)")
        # the master gain is the last node before the speakers: record what the page sets on it
        page.add_init_script("""(() => { const G = window.GainNode && GainNode.prototype; if (!G) return; window.__gain = []; window.__osc = 0;
          const P = AudioParam.prototype, s = P.setTargetAtTime; P.setTargetAtTime = function (v, t, c) { if (c >= 0.8 || c === 0.5) window.__gain.push(v); return s.call(this, v, t, c) };
          const o = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { if (this.type === 'sine' && (this.frequency.value === 440 || this.frequency.value === 660)) window.__osc++; return o.apply(this, a) } })()""")
        page.set_viewport_size({"width": 1280, "height": 900})
        page.evaluate("localStorage.removeItem('noise11f')")
        page.goto(url + "?a=5#fokus")
        t("#fokus opens focus mode 25 · 5", page.evaluate(pressed % "focus") == ["25 m"] and page.evaluate(pressed % "brk") == ["5 m"] and page.is_visible("#focusOpts"))
        t("#fokus brings the Focus mix and rewrites the link", page.inner_text("#mixName") == "Focus" and page.url.endswith("#brown=64&pink=42&f=25&b=5"), page.url.split("#")[-1])
        t("#fokus: stats visible, waits for Play",page.is_visible("#stats") and page.get_attribute("#play", "aria-label") == "Play")
        page.goto(url + "?a=6#focus&rain=58&pink=13")
        t("#focus (English) works too and keeps a given mix", page.evaluate(pressed % "focus") == ["25 m"] and page.inner_text("#mixName") == "Rain")
        if shots:
            page.goto(url + "?a=7#fokus")
            page.screenshot(path=str(shots / "desktop_1280_fokus_link.png"), full_page=True)

        page.goto(url + "?a=8#brown=70")
        page.click("#focus button >> nth=1")  # 15 m
        t("15 m suggests a 5 m break", page.evaluate(pressed % "brk") == ["5 m"] and page.url.endswith("#brown=70&f=15&b=5"), page.url.split("#")[-1])
        page.click("#brk button >> nth=1")  # 10 m
        t("15 m focus + 10 m break can be combined", page.evaluate(pressed % "focus") == ["15 m"] and page.evaluate(pressed % "brk") == ["10 m"] and page.url.endswith("#brown=70&f=15&b=10"), page.url.split("#")[-1])
        t("status names the pair", "Focus 15 min, break 10 min" in page.inner_text("#status"), page.inner_text("#status"))
        page.click("#focus button >> nth=3")  # 50 m
        t("a break picked by hand stays when the focus length changes", page.evaluate(pressed % "brk") == ["10 m"] and page.url.endswith("#brown=70&f=50&b=10"))
        page.click("#brk button >> nth=0")
        t("50 m focus + 5 m break", page.url.endswith("#brown=70&f=50&b=5"), page.url.split("#")[-1])
        page.click("#focus button >> nth=4")
        page.click("#brk button >> nth=2")
        t("90 · 20 is still there", page.url.endswith("#brown=70&f=90&b=20"), page.url.split("#")[-1])

        # switches: defaults on -> gong at the change, noise quieter (not silent) in the break
        page.goto(url + "?a=9#brown=70&f=15&b=5")
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(899_000)
        t("15 m focus counts down", page.inner_text("#status").startswith("Focus 1 · 0:0"), page.inner_text("#status"))
        page.clock.run_for(3_000)
        g = page.evaluate("window.__gain.slice(-1)[0]")
        t("break after 15:00", page.inner_text("#status").startswith("Break · 4:5"), page.inner_text("#status"))
        t("default: noise gets quieter in the break, not silent (gain 0.4)", g == 0.4, str(g))
        t("default: gong at the change", page.evaluate("window.__osc") == 1, str(page.evaluate("window.__osc")))
        page.click(".fopt .sw >> nth=1")  # quieter off
        page.clock.run_for(2_000)
        g = page.evaluate("window.__gain.slice(-1)[0]")
        t("switch 'quieter' off: noise stays at full volume in the break", g == 1 and not page.is_checked("#fQuiet"), str(g))
        t("switch state is in the link (q=0)", page.url.endswith("#brown=70&f=15&b=5&q=0"), page.url.split("#")[-1])
        page.click(".fopt .sw >> nth=1")
        page.clock.run_for(2_000)
        t("switch 'quieter' on again: 0.4", page.evaluate("window.__gain.slice(-1)[0]") == 0.4 and page.url.endswith("#brown=70&f=15&b=5"))
        t("toggling a switch does not restart the break", page.inner_text("#status").startswith("Break · 4:5"), page.inner_text("#status"))
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_fokus_pause.png"), full_page=True)
        page.click(".fopt .sw >> nth=0")  # sound off
        t("switch 'sound' off is in the link (c=0)", not page.is_checked("#fChime") and page.url.endswith("#brown=70&f=15&b=5&c=0"), page.url.split("#")[-1])
        page.clock.run_for(300_000)
        t("back in focus, round 2, full volume", page.inner_text("#status").startswith("Focus 2 · 14:5") and page.evaluate("window.__gain.slice(-1)[0]") == 1, page.inner_text("#status"))
        t("sound off: no gong at this change", page.evaluate("window.__osc") == 1, str(page.evaluate("window.__osc")))
        t("15 focus minutes counted, break not", page.inner_text("#sToday") == "15 min", page.inner_text("#sToday"))
        page.click("#play")
        page.goto(url + "?a=10#brown=70&f=25&b=10&c=0&q=0")
        t("link with both switches off restores them", not page.is_checked("#fChime") and not page.is_checked("#fQuiet") and page.evaluate(pressed % "brk") == ["10 m"])
        page.click("#play")
        page.wait_for_selector('#play[aria-label="Pause"]')
        page.clock.run_for(1_502_000)
        t("both off: break keeps full volume and stays without gong", page.inner_text("#status").startswith("Break · 9:5") and page.evaluate("window.__gain.slice(-1)[0]") == 1 and page.evaluate("window.__osc") == 0, page.inner_text("#status"))
        page.click("#play")

        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(url + "?a=11#fokus")
        t("390 px: no sideways scrolling in focus mode", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        box = page.evaluate("[...document.querySelectorAll('#focus button, #brk button, .fopt .sw')].map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 12), Math.round(r.width), Math.round(r.height)] })")
        t("390 px: focus, break and switch targets >= 44 px", len(box) == 10 and all(b[1] >= 44 and b[2] >= 44 for b in box), str(box))
        if shots:
            page.screenshot(path=str(shots / "handy_390_fokus.png"), full_page=True)
        t("0 page errors / console errors", not fehler, "; ".join(fehler)[:300])
        ctx.close()

    srv.shutdown()
    print(f"\nNoise machine PWA test: {ok} OK, {bad} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
