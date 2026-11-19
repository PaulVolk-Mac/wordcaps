"""E2E test for tools/subtitle-converter (Playwright, Edge headless, file:// – no server).

    python tests/e2e/test_subtitle_converter.py [--channel msedge|chromium] [--shots <dir>]

Checks at 1280 px and 390 px: title + h1, 0 pageerror / console.error, no horizontal scroll (also with
"Fix drift" open), convert, shift in ms, frame rate, two-line sync incl. error message, several files ->
one ZIP (opened with Python's zipfile), single download, Clear, tap targets on the phone, screenshots.
External requests (Cloudflare beacon) are blocked and only counted.
"""
import argparse, io, os, sys, pathlib, tempfile, zipfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = (ROOT / "tools" / "subtitle-converter" / "index.html").as_uri()

ap = argparse.ArgumentParser()
ap.add_argument("--channel", default="msedge")
ap.add_argument("--shots", default=str(ROOT / "tests" / "e2e" / "_shots"))
a = ap.parse_args()
os.makedirs(a.shots, exist_ok=True)
ok = fail = 0

SRT = ("1\n00:00:10,000 --> 00:00:12,000\nFirst line\n\n2\n00:10:00,000 --> 00:10:02,000\nMiddle line\n\n"
       "3\n01:00:00,000 --> 01:00:02,000\nLast line, one hour in\n")
VTT = "WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nHällo from VTT\n"


def t(name, cond, info: object = ""):
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("FAIL", name, info)


tmp = pathlib.Path(tempfile.mkdtemp(prefix="p01_e2e_"))
(tmp / "episode 1.srt").write_text(SRT, encoding="utf-8")
(tmp / "épisode 2.vtt").write_text(VTT, encoding="utf-8")
(tmp / "notes.txt").write_text("shopping list, no subtitles", encoding="utf-8")

with sync_playwright() as p:
    b = p.chromium.launch(channel=None if a.channel == "chromium" else a.channel, headless=True)
    for w, h in ((1280, 900), (390, 844)):
        ctx = b.new_context(viewport={"width": w, "height": h}, accept_downloads=True, has_touch=(w == 390))
        ext = []
        ctx.route("**/*", lambda r: (ext.append(r.request.url), r.abort()) if r.request.url.startswith("http") else r.continue_())
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(PAGE)
        pg.evaluate("localStorage.clear()")
        pg.reload()
        out = lambda: pg.locator("#out").input_value()
        msg = lambda: pg.locator("#msg").inner_text()
        noscroll = lambda: pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        settle = lambda: pg.wait_for_timeout(250)
        t(f"{w} title", "Subtitle Converter" in pg.title())
        t(f"{w} h1", pg.locator("h1").count() == 1)
        t(f"{w} empty: download disabled", pg.locator("#dl").is_disabled())
        t(f"{w} no h-scroll (start)", noscroll())

        # convert + shift
        pg.locator("#inp").fill(SRT)
        settle()
        t(f"{w} srt -> vtt", out().startswith("WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nFirst line"), out()[:80])
        t(f"{w} detected", pg.locator("#detected").inner_text() == "SRT detected")
        pg.locator('.st button[data-d="0.1"]').click()
        t(f"{w} + button = +0.1 s", "00:00:10.100 --> 00:00:12.100" in out())
        pg.locator("#shift").fill("-0.25")
        settle()
        t(f"{w} typed -0.25 s", "00:00:09.750 --> 00:00:11.750" in out(), out()[:60])
        pg.locator("#shift").fill("-12")
        settle()
        t(f"{w} line before 0:00 removed + said so", out().count("-->") == 2 and "1 before 0:00 removed" in pg.locator("#stats").inner_text(), pg.locator("#stats").inner_text())
        pg.locator("#shift").fill("-99999")
        settle()
        t(f"{w} all before 0:00 -> warning, no download", "before 0:00" in msg() and pg.locator("#dl").is_disabled(), msg())
        pg.locator("#shift").fill("0")
        settle()

        # frame rate
        t(f"{w} drift panel closed at start", not pg.locator("#modes").is_visible())
        pg.locator("#sync summary").click()
        pg.locator('#modes button[data-m="fps"]').click()
        t(f"{w} 25 -> 23.976 fps", "01:02:33.750 --> 01:02:35.835" in out(), out()[-80:])
        t(f"{w} stats name the stretch", "stretched ×1.0427" in pg.locator("#stats").inner_text(), pg.locator("#stats").inner_text())
        t(f"{w} no h-scroll (frame rate)", noscroll())
        pg.locator("#ff").select_option("23.976")
        pg.locator("#ft").select_option("25")
        t(f"{w} 23.976 -> 25 fps", "00:57:32.547 --> 00:57:34.466" in out(), out()[-80:])
        if w == 1280:
            pg.screenshot(path=f"{a.shots}/subtitle_converter_{w}_fps.png", full_page=False)

        # two lines
        pg.locator('#modes button[data-m="pts"]').click()
        t(f"{w} two lines: untouched until a time is typed", "01:00:00.000 --> 01:00:02.000" in out())
        t(f"{w} two lines: 3 options, last preselected", pg.locator("#pb option").count() == 3 and pg.locator("#pb").input_value() == "2")
        t(f"{w} placeholder shows current start", pg.locator("#tb").get_attribute("placeholder") == "01:00:00.000")
        pg.locator("#ta").fill("0:12")
        pg.locator("#tb").fill("1:02:30.5")
        settle()
        o = out()
        t(f"{w} two lines: anchors land", "00:00:12.000 --> " in o and "01:02:30.500 --> " in o, o)
        t(f"{w} two lines: middle stretched", "00:10:26.405 --> " in o, o)
        t(f"{w} no h-scroll (two lines)", noscroll())
        pg.locator("#tb").fill("soon")
        settle()
        t(f"{w} bad time -> clear message", pg.locator("#msg").get_attribute("class") == "bad" and "1:02.5" in msg(), msg())
        pg.locator("#tb").fill("0:05")
        settle()
        t(f"{w} reversed times -> clear message", pg.locator("#msg").get_attribute("class") == "bad" and "later line" in msg(), msg())
        pg.locator("#tb").fill("1:02:30.5")
        settle()
        if w == 390:
            small = pg.evaluate("[...document.querySelectorAll('#sync select,#sync input,#modes button,.st button')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.id||e.textContent)")
            t("390 tap targets >= 44 px in the timing block", small == [], small)
            pg.screenshot(path=f"{a.shots}/subtitle_converter_{w}_two_lines.png", full_page=True)

        # single download keeps name logic
        with pg.expect_download() as d:
            pg.locator("#dl").click()
        t(f"{w} single download name", d.value.suggested_filename == "subtitles.vtt", d.value.suggested_filename)

        # several files -> ZIP (same timing for all; the two-line plan comes from the previewed file)
        pg.locator('#modes button[data-m="off"]').click()
        pg.locator("#shift").fill("1")
        pg.locator('#fmts button[data-f="srt"]').click()
        pg.locator("#file").set_input_files([str(tmp / "episode 1.srt"), str(tmp / "épisode 2.vtt"), str(tmp / "notes.txt")])
        pg.wait_for_function("document.getElementById('dlt').textContent.includes('3 files')")
        t(f"{w} batch: file label", "3 files" in pg.locator("#fname").inner_text(), pg.locator("#fname").inner_text())
        t(f"{w} batch: preview is read-only", pg.locator("#inp").get_attribute("readonly") is not None)
        t(f"{w} no h-scroll (batch)", noscroll())
        with pg.expect_download() as d:
            pg.locator("#dl").click()
        t(f"{w} zip name", d.value.suggested_filename == "subtitles_srt.zip", d.value.suggested_filename)
        z = zipfile.ZipFile(io.BytesIO(pathlib.Path(d.value.path()).read_bytes()))
        t(f"{w} zip passes CRC check", z.testzip() is None)
        t(f"{w} zip names (utf-8, skipped file missing)", z.namelist() == ["episode 1.srt", "épisode 2.srt"], z.namelist())
        t(f"{w} zip file 1 shifted", z.read("episode 1.srt").decode("utf-8").startswith("1\n00:00:11,000 --> 00:00:13,000\nFirst line"))
        t(f"{w} zip file 2 converted + shifted", z.read("épisode 2.srt").decode("utf-8") == "1\n00:00:06,000 --> 00:00:07,000\nHällo from VTT\n")
        t(f"{w} skipped file is named", "notes.txt" in msg(), msg())
        if w == 1280:
            pg.screenshot(path=f"{a.shots}/subtitle_converter_{w}_batch.png", full_page=False)

        # clear
        pg.locator("#clr").click()
        t(f"{w} clear resets", out() == "" and pg.locator("#dl").is_disabled() and pg.locator("#shift").input_value() == "0"
          and pg.locator("#inp").get_attribute("readonly") is None and "Drop files" in pg.locator("#fname").inner_text())
        pg.locator("#inp").fill(SRT)
        settle()
        t(f"{w} after clear: single mode again", pg.locator("#dlt").inner_text() == "Download .srt", pg.locator("#dlt").inner_text())

        t(f"{w} 0 page errors", errs == [], errs)
        t(f"{w} only the analytics beacon was requested (and blocked)", all("cloudflareinsights" in u for u in ext), ext)
        ctx.close()
    b.close()

print(f"E2E subtitle-converter: {ok} OK, {fail} FAIL")
sys.exit(1 if fail else 0)
