"""E2E + axe for the v2 page draft coach-kit/index.html (Playwright, Edge headless, file://).
    F:\\Claude\\tools\\venv_upload\\Scripts\\python.exe e2e_seite.py [--shots <dir>] [--ohne-axe]
1280 + 390 px, light + dark: one h1, 0 pageerror / console.error, no horizontal scroll, 4 images decode, demo recalculates,
buy buttons >= 44 px and point to the shop, theme switch, layout shift < 0.1. External requests are blocked and counted
(only the analytics beacon is allowed). axe-core (WCAG A/AA + best-practice) is loaded from the CDN in a second pass."""
import argparse, os, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HIER = ROOT / "tests" / "e2e"
PAGE = (ROOT / "coach-kit" / "index.html").as_uri()
AXE = "https://cdn.jsdelivr.net/npm/axe-core@4.10.3/axe.min.js"
ap = argparse.ArgumentParser()
ap.add_argument("--shots", default=str(HIER / "_shots"))
ap.add_argument("--channel", default="msedge")
ap.add_argument("--ohne-axe", action="store_true")
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


CLS = """() => new Promise(r => { let s = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) s += e.value })
  .observe({type: 'layout-shift', buffered: true}); setTimeout(() => r(s), 600) })"""
axe_total = 0
with sync_playwright() as p:
    b = p.chromium.launch(channel=a.channel, headless=True)
    for w, h in ((1280, 900), (390, 844)):
        for scheme in ("light", "dark"):
            tag = f"{w}-{scheme}"
            ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
            ext = []
            ctx.route("**/*", lambda r: (ext.append(r.request.url), r.abort()) if r.request.url.startswith("http") else r.continue_())
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
            pg.goto(PAGE)
            pg.wait_for_load_state("load")
            t(tag + " title", "Personal Trainers" in pg.title(), pg.title())
            t(tag + " one h1", pg.locator("h1").count() == 1)
            t(tag + " layout shift < 0.1", pg.evaluate(CLS) < 0.1)
            t(tag + " no horizontal scroll", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), pg.evaluate("document.documentElement.scrollWidth"))
            pg.evaluate("document.querySelectorAll('img').forEach(i => i.loading = 'eager')")
            pg.wait_for_function("[...document.images].every(i => i.complete)")
            t(tag + " 4 images decoded", pg.evaluate("document.images.length === 4 && [...document.images].every(i => i.naturalWidth > 300)"))
            t(tag + " images not wider than the column", pg.evaluate("[...document.images].every(i => i.getBoundingClientRect().right <= window.innerWidth)"))
            bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
            t(tag + " colour scheme follows the system", (bg == "rgb(28, 28, 28)") == (scheme == "dark"), bg)
            t(tag + " demo default", pg.inner_text("#epley") == "116.7")
            pg.fill("#kg", "80"); pg.fill("#reps", "8")
            t(tag + " demo 80 x 8", pg.inner_text("#epley") == "101.3", pg.inner_text("#epley"))
            rows = pg.locator("#loads tr")
            t(tag + " demo 80 % row", rows.count() == 10 and rows.nth(6).inner_text().split() == ["80", "%", "80.0"], rows.nth(6).inner_text())
            pg.fill("#reps", "12")
            t(tag + " demo hint above 10 reps", "1 to 10" in pg.inner_text("#msg") and pg.inner_text("#epley") == "–" and rows.count() == 10)
            pg.fill("#reps", "5"); pg.fill("#kg", "100")
            t(tag + " demo back to default", pg.inner_text("#epley") == "116.7" and pg.inner_text("#msg") == "")
            for bid in ("buy-top", "buy-bottom"):
                box = pg.locator("#" + bid).bounding_box()
                t(f"{tag} {bid} >= 44 px", box["height"] >= 44, box)
                t(f"{tag} {bid} href", pg.get_attribute("#" + bid, "href").startswith("https://volkster45.gumroad.com/l/daqeao?ref="))
            t(tag + " buy button visible without scrolling", pg.locator("#buy-top").bounding_box()["y"] + 48 <= h, pg.locator("#buy-top").bounding_box())
            t(tag + " data note visible", pg.locator("#data-note").is_visible() and "no sync" in pg.inner_text("#data-note"))
            other = "light" if scheme == "dark" else "dark"
            pg.click(f".theme button[data-t={other}]")
            bg2 = pg.evaluate("getComputedStyle(document.body).backgroundColor")
            t(tag + " theme switch", bg2 != bg and pg.get_attribute(f".theme button[data-t={other}]", "aria-pressed") == "true", bg2)
            pg.click(".theme button[data-t=auto]")
            t(tag + " 0 errors", not errs, errs)
            t(tag + " only the analytics beacon is external", all("cloudflareinsights" in u for u in ext), ext)
            pg.screenshot(path=os.path.join(a.shots, f"seite_v2_{tag}.png"), full_page=True)
            ctx.close()
            if not a.ohne_axe:
                pg = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme).new_page()
                pg.route("**/cloudflareinsights.com/**", lambda r: r.abort())
                pg.goto(PAGE)
                pg.add_script_tag(url=AXE)
                res = pg.evaluate("""async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}))
                    .violations.map(v => [v.impact, v.id, v.nodes.length, v.nodes.slice(0,3).map(x => x.target.join(' ')).join('; ')])""")
                n = sum(r[2] for r in res)
                axe_total += n
                for r in res:
                    print("AXE", tag, r)
                t(tag + " axe 0 violations", n == 0, n)
    b.close()

print(f"SEITE-V2-E2E {ok} OK, {fail} FAIL" + ("" if a.ohne_axe else f" · AXE_TOTAL {axe_total}"))
raise SystemExit(1 if fail else 0)
