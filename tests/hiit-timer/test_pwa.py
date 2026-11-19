"""Browser test for the HIIT timer: My workouts + installable app (PWA) + offline reload.

    python tests/hiit-timer/test_pwa.py [--channel msedge|chrome|chromium] [--shots <dir>]

Needs only `pip install playwright` and an installed Edge/Chrome. Serves the repo on 127.0.0.1
(service workers need http://localhost or https), runs headless, exit 0 only if every check passes.

Checks
  1  page loads, service worker takes control, app shell is in the cache
  2  save a named workout -> list + localStorage
  3  OFFLINE (context.set_offline): reload still loads, saved workout still there,
     loading it restores the numbers, the timer runs
  4  offline deep link with other settings (?w=20&r=10&n=8) loads too
  5  delete, same-name update, storage survives a reload
  6  Chrome's own installability check (CDP Page.getInstallabilityErrors) reports no errors,
     manifest parses without errors
  7  phone width 390 px: no sideways scrolling, tap targets >= 44 px
"""
from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PFAD = "/tools/hiit-timer/"
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

    with sync_playwright() as pw, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as prof:
        # persistent profile: a normal (not incognito) browser, as installability requires
        ctx = pw.chromium.launch_persistent_context(
            prof, channel=a.channel, headless=True, viewport={"width": 1280, "height": 900}, color_scheme="light"
        )
        # the visitor counter is the only third-party request; keep the test hermetic
        ctx.route("**/static.cloudflareinsights.com/**", lambda r: r.abort())
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("pageerror", lambda e: fehler.append(f"pageerror: {e}"))
        page.on("console", lambda m: fehler.append(f"console.error: {m.text}")
                if m.type == "error" and "cloudflareinsights" not in m.text and "ERR_FAILED" not in m.text
                and "ERR_INTERNET_DISCONNECTED" not in m.text else None)

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

        print("2 save a workout")
        t("empty list shows the hint", page.locator("#wlist li").count() == 0 and "Stored on this device" in page.inner_text("#wnote"))
        for f, v in (("work", "50"), ("rest", "10"), ("rounds", "7")):
            page.fill("#" + f, v)
            page.dispatch_event("#" + f, "change")
        page.fill("#wname", "  Leg day   finisher ")
        page.click("#wsave")
        t("1 entry in the list", page.locator("#wlist li").count() == 1)
        t("name cleaned + summary", page.inner_text("#wlist .wload b") == "Leg day finisher" and "50/10 × 7" in page.inner_text("#wlist .wload small"), page.inner_text("#wlist .wload small"))
        t("status says saved", "Saved" in page.inner_text("#wnote"))
        t("entry marked as current", "on" in (page.get_attribute("#wlist .wload", "class") or ""))
        t("name field cleared", page.input_value("#wname") == "")
        st = page.evaluate("JSON.parse(localStorage.getItem('hiit5w'))")
        t("localStorage hiit5w", len(st) == 1 and st[0]["name"] == "Leg day finisher" and st[0]["work"] == 50 and st[0]["rounds"] == 7)
        page.fill("#wname", '<img src=x onerror="window.__xss=1">')
        page.keyboard.press("Enter")
        t("Enter saves; markup in a name stays text", page.locator("#wlist li").count() == 2 and page.locator("#wlist img").count() == 0 and page.evaluate("window.__xss") is None)
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_my_workouts.png"), full_page=True)

        print("3 offline: reload keeps working")
        ctx.set_offline(True)
        r = page.reload()
        t("offline reload answers 200 from the service worker", r is not None and r.status == 200 and r.from_service_worker, f"status {r.status if r else None}")
        t("page is complete", "HIIT Timer" in page.inner_text("h1") and page.locator("#presets .tile").count() == 6)
        t("navigator.onLine is false (really offline)", page.evaluate("navigator.onLine") is False)
        t("saved workouts survive", page.locator("#wlist li").count() == 2 and page.inner_text("#wlist li:nth-child(2) .wload b") == "Leg day finisher")
        page.click("#presets .tile >> nth=0")  # Tabata
        t("preset applied", page.input_value("#work") == "20" and page.input_value("#rounds") == "8")
        page.click("#wlist li:nth-child(2) .wload")
        t("saved workout restores its numbers", page.input_value("#work") == "50" and page.input_value("#rest") == "10" and page.input_value("#rounds") == "7")
        t("link carries the numbers", "w=50" in page.url and "n=7" in page.url, page.url.split("?")[-1])
        vor = page.inner_text("#clock")
        page.click("#go")
        page.wait_for_timeout(1500)
        nach = page.inner_text("#clock")
        t("timer runs offline", vor != nach and page.get_attribute("#go", "aria-label") == "Pause", f"{vor} -> {nach}")
        page.click("#go")
        page.click("#reset")
        if shots:
            page.screenshot(path=str(shots / "desktop_1280_offline.png"), full_page=True)

        print("4 offline deep link")
        r = page.goto(url + "?w=20&r=10&n=8&s=1&sr=60&p=10")
        t("offline deep link loads", r is not None and r.status == 200 and page.input_value("#work") == "20" and page.input_value("#rounds") == "8")
        mf = page.evaluate("fetch('manifest.webmanifest').then(r => r.json()).then(j => j.short_name).catch(e => 'ERR ' + e)")
        t("manifest served offline", mf == "HIIT Timer", str(mf))
        ic = page.evaluate("Promise.all(['icon-192.png','icon-512.png','icon-maskable-512.png'].map(f => fetch(f).then(r => r.ok).catch(() => false)))")
        t("icons served offline", ic == [True, True, True], str(ic))

        print("5 delete / update / persistence (back online)")
        ctx.set_offline(False)
        page.goto(url)
        page.click("#wlist li:nth-child(1) .wdel")
        t("delete removes one", page.locator("#wlist li").count() == 1 and "Deleted" in page.inner_text("#wnote"))
        page.fill("#work", "55")
        page.dispatch_event("#work", "change")
        t("changed numbers unmark the entry", "on" not in (page.get_attribute("#wlist .wload", "class") or "").split())
        page.fill("#wname", "leg day finisher")
        page.click("#wsave")
        st = page.evaluate("JSON.parse(localStorage.getItem('hiit5w'))")
        t("same name (any case) updates instead of duplicating", len(st) == 1 and st[0]["work"] == 55 and "Updated" in page.inner_text("#wnote"))
        page.fill("#wname", "")
        page.click("#wsave")
        t("empty name gets a readable default", page.inner_text("#wlist li:nth-child(1) .wload b") == "55/10 × 8", ascii(page.locator("#wlist .wload b").all_inner_texts()))
        page.reload()
        t("list survives a reload", page.locator("#wlist li").count() == 2)
        page.evaluate("localStorage.setItem('hiit5w', '{broken')")
        page.reload()
        t("broken storage does not break the page", page.locator("#wlist li").count() == 0 and page.inner_text("#clock") != "")

        print("6 installability (Chrome's own check)")
        cdp = ctx.new_cdp_session(page)
        man = cdp.send("Page.getAppManifest")
        t("manifest found + parses without errors", man.get("url", "").endswith("manifest.webmanifest") and not man.get("errors"), str(man.get("errors")))
        inst = cdp.send("Page.getInstallabilityErrors").get("installabilityErrors", [])
        t("no installability errors", inst == [], str([e.get("errorId") for e in inst]))
        t("theme-color + apple-touch-icon present", page.locator('meta[name="theme-color"]').count() == 1 and page.locator('link[rel="apple-touch-icon"]').count() == 1)

        print("7 phone 390 px")
        page.set_viewport_size({"width": 390, "height": 844})
        page.fill("#wname", "Tabata after legs")
        page.click("#wsave")
        t("no sideways scrolling", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        box = page.evaluate("['#wsave','#wname','#wlist .wload','#wlist .wdel'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)] })")
        t("tap targets >= 44 px high", all(b[2] >= 44 for b in box) and all(b[1] >= 44 for b in box), str(box))
        if shots:
            page.locator(".setup").screenshot(path=str(shots / "handy_390_my_workouts.png"))
            page.evaluate("document.getElementById('pwa').hidden = false")  # how the install row looks once offered
            page.locator(".setup").screenshot(path=str(shots / "handy_390_install_zeile.png"))
        t("0 page errors / console errors", not fehler, "; ".join(fehler)[:300])
        ctx.close()

    srv.shutdown()
    print(f"\nHIIT timer PWA test: {ok} OK, {bad} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
