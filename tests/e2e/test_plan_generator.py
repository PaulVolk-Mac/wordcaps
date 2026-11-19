"""E2E test for tools/workout-plan-generator (Playwright, Edge headless, file:// – no server).

    python tests/e2e/test_plan_generator.py [--channel msedge|chromium] [--shots <dir>]

Checks at 1280 px and 390 px: title + h1, 0 pageerror / console.error, no horizontal scroll,
plan renders for every equipment (days = cards), week tabs switch, deload week has fewer sets,
CSV download (header + one row per set), settings survive a reload via the URL, screenshots.
External requests (Cloudflare beacon) are blocked and only counted.
"""
import argparse, os, sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = (ROOT / "tools" / "workout-plan-generator" / "index.html").as_uri()

ap = argparse.ArgumentParser()
ap.add_argument("--channel", default="msedge")
ap.add_argument("--shots", default=str(ROOT / "tests" / "e2e" / "_shots"))
a = ap.parse_args()
os.makedirs(a.shots, exist_ok=True)
ok = fail = 0


def t(name, cond, info: object = ""):
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("FAIL", name, info)


with sync_playwright() as p:
    b = p.chromium.launch(channel=None if a.channel == "chromium" else a.channel, headless=True)
    for w, h in ((1280, 900), (390, 844)):
        ctx = b.new_context(viewport={"width": w, "height": h}, accept_downloads=True)
        ext = []
        ctx.route("**/*", lambda r: (ext.append(r.request.url), r.abort()) if r.request.url.startswith("http") else r.continue_())
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(PAGE + "?g=muscle&d=4&e=gym&l=intermediate")
        pg.wait_for_selector(".day")
        t(f"{w} title", "Workout Plan Generator" in pg.title())
        t(f"{w} h1", pg.locator("h1").count() == 1)
        t(f"{w} 4 day cards", pg.locator(".wk:not([hidden]) .day").count() == 4)
        noscroll = lambda: pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        t(f"{w} no h-scroll (gym 4)", noscroll())
        if w == 1280:
            pg.screenshot(path=f"{a.shots}/plan_generator_{w}.png", full_page=False)
        else:
            pg.screenshot(path=f"{a.shots}/plan_generator_{w}.png", full_page=True)
        # every equipment x days renders without empty days and without h-scroll
        for eq in ("Gym", "Dumbbells", "Bodyweight"):
            pg.locator('[data-k=equip] button', has_text=eq).click()
            for d in "23456":
                pg.locator(f'[data-k=days] button[data-v="{d}"]').click()
                n = pg.locator(".wk:not([hidden]) .day").count()
                empty = pg.locator(".wk:not([hidden]) .day").evaluate_all("ds => ds.filter(x => x.querySelectorAll('.ex').length < 3).length")
                t(f"{w} {eq} {d} days", n == int(d) and empty == 0, (n, empty))
                t(f"{w} {eq} {d} no h-scroll", noscroll())
        # week tabs + deload
        pg.locator('[data-k=equip] button', has_text="Gym").click()
        pg.locator('[data-k=days] button[data-v="3"]').click()
        sets = lambda: pg.evaluate("[...document.querySelectorAll('.wk:not([hidden]) .tg')].reduce((a,e)=>a+parseInt(e.textContent),0)")
        pg.locator("#tabs button", has_text="Week 3").click()
        s3 = sets()
        pg.locator("#tabs button", has_text="Week 4").click()
        s4 = sets()
        t(f"{w} deload fewer sets", 0 < s4 < s3, (s3, s4))
        t(f"{w} deload note", "Deload" in pg.locator(".wk:not([hidden]) .wnote").inner_text())
        # CSV
        with pg.expect_download() as dl:
            pg.locator("#csv").click()
        txt = pathlib.Path(dl.value.path()).read_text(encoding="utf-8-sig")
        lines = txt.strip().splitlines()
        t(f"{w} csv header", lines[0] == "Week,Date,Day / focus,Exercise,Set,Target,Rest,Reps,kg", lines[0])
        t(f"{w} csv rows", len(lines) > 100, len(lines))
        # URL keeps settings after reload
        pg.locator('[data-k=goal] button', has_text="Strength").click()
        pg.reload()
        pg.wait_for_selector(".day")
        t(f"{w} reload keeps goal", pg.locator('[data-k=goal] button[aria-pressed=true]').inner_text().startswith("Strength"))
        t(f"{w} url has params", "g=strength" in pg.url and "d=3" in pg.url, pg.url)
        # print view shows all 4 weeks
        pg.emulate_media(media="print")
        pg.evaluate("document.querySelectorAll('.wk').forEach(x=>x.hidden=false)")
        t(f"{w} print shows 4 weeks", pg.locator(".wk").evaluate_all("ws => ws.filter(x => getComputedStyle(x).display !== 'none').length") == 4)
        if w == 1280:
            pg.pdf(path=f"{a.shots}/plan_generator_print.pdf") if a.channel == "chromium" else None
        pg.emulate_media(media="screen")
        t(f"{w} 0 page errors", not errs, errs[:3])
        t(f"{w} only beacon is external", all("cloudflareinsights" in u for u in ext), ext[:3])
        ctx.close()
    b.close()
print(f"OK: {ok} | FAIL: {fail}")
sys.exit(1 if fail else 0)
