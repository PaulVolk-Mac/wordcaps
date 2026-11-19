# Browser test safe zone checker with a real test video, 1280 px and 390 px (Playwright, Edge headless).
# Usage: python tests/safe-zone-checker/test_video.py [--shots <dir>]
# The test video is built with ffmpeg: 4 s, 30 fps; 0-2 s caption low (covered), 2-4 s caption high (safe).
import sys, os, subprocess, tempfile, threading, functools, http.server, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
shots = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
ok = fail = 0
def t(c, m):
    global ok, fail
    if c: ok += 1
    else: fail += 1; print("FAIL", m)

tmp = pathlib.Path(tempfile.mkdtemp(prefix="szc_"))
video = tmp / "testvideo.mp4"
F = "C\\:/Windows/Fonts/segoeuib.ttf"
txt = lambda y, en: f"drawtext=fontfile='{F}':text='MY CAPTION':fontsize=46:fontcolor=white:borderw=5:bordercolor=black:x=(w-tw)/2-40:y={y}:enable='{en}'"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x30384c:s=540x960:r=30:d=4", "-vf", txt(830, "lt(t,2)") + "," + txt(300, "gte(t,2)"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "1", "-movflags", "+faststart", str(video)], check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
image = tmp / "frame.png"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "3", "-i", str(video), "-frames:v", "1", str(image)], check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/tools/safe-zone-checker/"

def run(pw, name, w, h, touch):
    b = pw.chromium.launch(channel="msedge", headless=True)
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" and "cloudflareinsights" not in m.text and "ERR_" not in m.text else None)
    p.route("**/static.cloudflareinsights.com/**", lambda r: r.abort())
    p.goto(URL); p.wait_for_selector("#chk.bad, #chk.ok")
    tc = lambda: p.inner_text("#tc")
    zones = lambda: p.get_attribute("#chk", "data-zones")
    def settle(expect=None):
        if expect: p.wait_for_function("e => document.getElementById('tc').textContent === e", arg=expect, timeout=5000)
        else: p.wait_for_timeout(350)
    # start: sample frame, strictest zones, sources
    t(p.locator("#tabs button").count() == 4, f"{name}: 4 platform tabs")
    t(p.get_attribute("#tabs button.on", "data-p") == "combined", f"{name}: All-in-one is the default")
    t("bottom" in zones() and "bad" in p.get_attribute("#chk", "class"), f"{name}: sample caption sits too low -> warning")
    t(not p.is_visible("#steps") and not p.is_visible("#scanw") and not p.is_visible("#seekw"), f"{name}: video controls hidden without a video")
    for k, vals, host in [("tiktok", ["240", "660", "120", "120"], "ads.tiktok.com"), ("shorts", ["288", "672", "192", "48"], "support.google.com"), ("reels", ["220", "672", "130", "60"], "developers.facebook.com")]:
        p.click(f"#tabs button[data-p={k}]")
        got = [p.inner_text(f"#{i}").replace("px", "").strip() for i in ("nt", "nb", "nr", "nl")]
        t(got == vals, f"{name}: {k} margins {got}")
        t(host in (p.get_attribute("#srcl a", "href") or ""), f"{name}: {k} source link to {host}")
        t("checked 19 Nov 2026" in p.inner_text("#srcl"), f"{name}: {k} shows the check date")
    t("estimate" in p.inner_text("#srcl"), f"{name}: Reels says what is estimated")
    p.click("#tabs button[data-p=combined]")
    t(p.locator("#srcl a").count() == 0 and "Strictest" in p.inner_text("#srcl"), f"{name}: All-in-one explains itself")
    # video
    p.set_input_files("#file", str(video)); p.wait_for_selector("#steps.on"); settle("0:01.00")
    t(p.is_visible("#seekw") and p.is_visible("#scanb") and p.inner_text("#ftag") == "video", f"{name}: video loaded, controls visible")
    t(zones() == "bottom", f"{name}: at 0:01 the caption is in the bottom zone ({zones()})")
    p.click("#f1f"); settle("0:01.01"); t(tc() == "0:01.01", f"{name}: +1 frame -> {tc()}")
    p.click("#f1f"); settle("0:01.02"); p.click("#b1f"); settle("0:01.01"); t(tc() == "0:01.01", f"{name}: -1 frame -> {tc()}")
    p.click("#f1s"); settle("0:02.01"); t(tc() == "0:02.01", f"{name}: +1 s -> {tc()}")
    t(zones() == "" and "ok" in p.get_attribute("#chk", "class"), f"{name}: after 2 s the caption is safe -> no warning")
    p.click("#b1f"); settle("0:02.00"); p.click("#b1f"); settle("0:01.29")
    t(tc() == "0:01.29" and zones() == "bottom", f"{name}: one frame before the change the warning is back (frame accurate)")
    p.click("#b1s"); settle("0:00.29"); t(tc() == "0:00.29", f"{name}: -1 s -> {tc()}")
    p.locator("#tabs button.on").focus()
    p.keyboard.press("ArrowRight"); settle("0:01.00"); t(tc() == "0:01.00", f"{name}: Right arrow = +1 frame")
    p.keyboard.press("Shift+ArrowRight"); settle("0:02.00"); p.keyboard.press("ArrowLeft"); settle("0:01.29"); t(tc() == "0:01.29", f"{name}: Shift+Right, Left")
    for _ in range(3): p.click("#b1s")
    p.wait_for_timeout(400); t(tc() == "0:00.00", f"{name}: stops at the start ({tc()})")
    for _ in range(6): p.click("#f1s"); p.wait_for_timeout(120)
    p.wait_for_timeout(400); t(tc() in ("0:03.29", "0:04.00"), f"{name}: stops at the end ({tc()})")
    p.select_option("#fps", "60"); t(tc().endswith((".58", ".59", ".00")), f"{name}: fps 60 changes the frame count ({tc()})"); p.select_option("#fps", "30")
    p.eval_on_selector("#seek", "e => { e.value = 750; e.dispatchEvent(new Event('input', {bubbles: true})) }"); settle("0:03.00")
    t(tc() == "0:03.00" and zones() == "", f"{name}: slider to 75% -> 0:03.00, safe")
    # whole video
    p.click("#scanb"); p.wait_for_selector("#hits[data-done]", timeout=30000); p.wait_for_timeout(500)
    hb = p.locator("#hits button")
    t(p.get_attribute("#hits", "data-done") == "8", f"{name}: 8 frames checked for 4 s")
    t(hb.count() == 1, f"{name}: exactly one covered stretch found ({hb.count()})")
    if hb.count():
        lab = hb.first.inner_text(); a = float(hb.first.get_attribute("data-t"))
        t(a < 0.5 and "bottom" in lab and "–" in lab, f"{name}: stretch starts at the beginning and names the zone ({lab})")
        t(lab.split(" – ")[1].startswith("0:01."), f"{name}: stretch ends before 2 s ({lab})")
        t(zones() == "bottom" and tc().startswith("0:00."), f"{name}: jumped to the first covered frame ({tc()})")
        p.click("#f1s"); p.click("#f1s"); p.wait_for_timeout(400); hb.first.click(); p.wait_for_timeout(400)
        t(tc().startswith("0:00."), f"{name}: click on the stretch jumps there")
    # Shorts has a smaller left margin but the same bottom: still covered; picture upload
    p.click("#tabs button[data-p=shorts]"); p.wait_for_timeout(300)
    t(zones() == "bottom" and p.locator("#hits button").count() == 0, f"{name}: platform change re-checks the frame and clears the old list")
    if shots:
        shots.mkdir(parents=True, exist_ok=True); p.click("#tabs button[data-p=combined]"); p.click("#scanb"); p.wait_for_selector("#hits button"); p.wait_for_timeout(500)
        p.screenshot(path=str(shots / f"{name}_video_warnung.png"), full_page=True)
        p.locator("#cv").screenshot(path=str(shots / f"{name}_vorschau_warnung.png"))
    p.set_input_files("#file", str(image)); p.wait_for_function("document.getElementById('ftag').textContent === 'image'"); p.wait_for_timeout(400)
    t(not p.is_visible("#steps") and not p.is_visible("#scanw"), f"{name}: picture -> video controls hidden again")
    t(zones() == "" and "ok" in p.get_attribute("#chk", "class"), f"{name}: picture with a safe caption -> no warning")
    if shots: p.screenshot(path=str(shots / f"{name}_bild_ok.png"), full_page=True)
    # layout
    t(p.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"{name}: no horizontal scrolling")
    if touch:
        p.set_input_files("#file", str(video)); p.wait_for_selector("#steps.on"); p.wait_for_timeout(400)
        small = p.evaluate("[...document.querySelectorAll('#steps button, #scanb, #fps, #tabs button')].filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44 }).map(e => e.id || e.textContent)")
        t(small == [], f"{name}: tap targets >= 44 px ({small})")
        t(p.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"{name}: no horizontal scrolling with the video controls")
    t(errs == [], f"{name}: no page errors {errs[:3]}")
    b.close()

with sync_playwright() as pw:
    run(pw, "desktop_1280", 1280, 900, False)
    run(pw, "handy_390", 390, 844, True)
srv.shutdown()
print(f"Safe zone checker video test: {ok} OK, {fail} FAIL"); sys.exit(1 if fail else 0)
