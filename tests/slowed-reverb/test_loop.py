# Browser test slowed + reverb maker: loop a section + 8D audio, 1280 px and 390 px (Playwright, Edge headless).
# Usage: python tests/slowed-reverb/test_loop.py [--shots <dir>]
# Loads a generated 6 s WAV into the page, downloads the rendered WAVs and measures them:
# length, no click at the loop seams (with a naive loop as counter-check), left/right movement of 8D.
import sys, math, wave, array, tempfile, threading, functools, http.server, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
shots = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
if shots: shots.mkdir(parents=True, exist_ok=True)
ok = fail = 0
def t(c, m):
    global ok, fail
    if c: ok += 1
    else: fail += 1; print("FAIL", m)

SR = 44100
tmp = pathlib.Path(tempfile.mkdtemp(prefix="p15_"))
src = tmp / "testsong.wav"
# steady two-tone "song", same on both channels, never silent at the cut points -> a naive loop clicks
mono = [0.5 * math.sin(2 * math.pi * 196.7 * i / SR) + 0.3 * math.sin(2 * math.pi * 331.3 * i / SR + 1) for i in range(SR * 6)]
with wave.open(str(src), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    a = array.array("h"); [a.extend((int(x * 32767),) * 2) for x in mono]; w.writeframes(a.tobytes())

def read(path):
    with wave.open(str(path), "rb") as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        d = array.array("h"); d.frombytes(w.readframes(n))
    return [d[c::ch] for c in range(ch)], sr
def click(x, at, win=400):
    """2nd-difference energy around sample `at` relative to the loudest spot elsewhere (> 1.5 = click)."""
    d2 = lambda i: abs(x[i + 1] - 2 * x[i] + x[i - 1])
    near = max(d2(i) for i in range(max(1, at - win), min(len(x) - 1, at + win)))
    inner = sorted(d2(i) for i in range(SR // 2, len(x) - SR // 2, 7) if abs(i - at) > 4 * win and all(abs(i - s) > 4 * win for s in click.skip))
    return near / max(1, inner[int(len(inner) * 0.999)])
click.skip = []

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/tools/slowed-reverb/"

def run(pw, name, w, h, touch):
    b = pw.chromium.launch(channel="msedge", headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1, accept_downloads=True)
    p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" and "cloudflareinsights" not in m.text and "ERR_" not in m.text else None)
    p.route("**/static.cloudflareinsights.com/**", lambda r: r.abort())
    T = lambda c, m: t(c, f"{name}: {m}")
    setv = lambda i, v: p.evaluate("([i,v])=>{const e=document.getElementById(i);e.value=v;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))}", [i, v])
    def download(to):
        with p.expect_download() as d: p.click("#dl")
        d.value.save_as(str(to)); p.wait_for_selector("#msg.ok"); return d.value.suggested_filename
    shot = lambda n: shots and p.screenshot(path=str(shots / f"{name}_{n}.png"), full_page=True)

    p.goto(URL)
    T(p.is_disabled("#loopOn"), "loop switch is off until a file is open")
    T(p.locator("#tiles .tile").count() == 7 and p.locator("#tiles .tile[data-p='8d']").count() == 1, "7 presets incl. 8D")
    p.set_input_files("#file", str(src)); p.wait_for_selector("#msg.ok")
    T(not p.is_disabled("#loopOn") and p.is_hidden("#loopBody") and p.is_hidden("#rotBox"), "file open: loop available, details folded")
    T(p.inner_text("#oLen") == "0:10", "length without loop 6 s / 0.85 + 3.4 s reverb = 0:10")

    # ---- loop 1.0 s .. 2.5 s, 4x, preset Slowed (0.88x, no reverb) ----
    p.click("#tiles .tile[data-p='slowed']"); p.check("#loopOn")
    T(p.is_visible("#loopBody") and p.inner_text("#vA") == "0:00.00" and p.inner_text("#vE") == "0:06.00", "loop starts as the whole file")
    setv("le", "2.5"); setv("la", "1"); setv("rep", "4")
    T(p.inner_text("#vA") == "0:01.00" and p.inner_text("#vE") == "0:02.50" and "0:01.50 of the song" in p.inner_text("#vLoop"), "loop points shown exactly")
    T(p.inner_text("#oLen") == "0:06" and p.inner_text("#len") == "0:01", "length 4 x 1.5 s / 0.88 = 6.8 s shown")
    T("l=1&a=1&e=2.5&n=4" in p.evaluate("location.hash"), "loop is saved in the link")
    setv("la", "2.4")
    T(p.inner_text("#vA") == "0:02.25", "start cannot pass the end (keeps 0.25 s)")
    setv("la", "1")
    f1 = tmp / f"{name}_loop.wav"; fn = download(f1)
    T(fn == "testsong (slowed loop).wav", f"file name says loop ({fn})")
    ch, sr = read(f1); per = 1.5 / 0.88 * sr; want = math.ceil((4 * 1.5 / 0.88 + 0.05) * sr)
    T(len(ch) == 2 and abs(len(ch[0]) - want) <= 1, f"WAV length {len(ch[0])} = 4 x section / speed + rest ({want})")
    seams = [round(k * per) for k in (1, 2, 3)]; click.skip = seams + [round(4 * per)]
    vals = [round(click(ch[0], s), 2) for s in seams]
    T(max(vals) <= 1.5, f"no click at the 3 seams (click value {vals}, limit 1.5)")
    # counter-check: the same section looped naively must be caught by the same measure
    cut = [int(x * 32767) for x in mono[SR:int(2.5 * SR)]] * 4; click.skip = []
    nv = round(click(cut, len(cut) // 4), 2)
    T(nv > 1.5, f"counter-check: naive loop is detected as click ({nv})")
    rms = lambda x: math.sqrt(sum(v * v for v in x) / len(x))
    T(abs(rms(ch[0][seams[0] - 2000:seams[0] + 2000]) / rms(ch[0][seams[0] + 20000:seams[0] + 24000]) - 1) < 0.15, "no level dip or bump at the seam")
    T(max(abs(v) for v in ch[0][-int(0.04 * sr):]) < 40, "ends in silence (soft cut)")
    if shots: (shots / f"{name}_loop.wav").write_bytes(f1.read_bytes())

    # ---- playback: playhead stays inside the section ----
    p.click("#play"); p.wait_for_timeout(2600)
    left = p.evaluate("parseFloat(document.getElementById('ph').style.left)")
    T(p.get_attribute("#play", "aria-label") == "Pause" and 1 / 6 * 100 - 0.5 <= left <= 2.5 / 6 * 100 + 0.5, f"after 2.6 s (section lasts 1.7 s) the playhead is still inside the loop ({left:.1f} %)")
    setv("le", "2")
    p.wait_for_timeout(500)
    T(p.get_attribute("#play", "aria-label") == "Pause", "changing the loop while playing keeps it playing")
    shot("loop")
    p.click("#play"); setv("le", "2.5")

    # ---- loop with reverb: still clean, tail added ----
    p.click("#tiles .tile[data-p='slowed-reverb']")
    T(p.is_checked("#loopOn") and p.inner_text("#vE") == "0:02.50", "changing the preset keeps the loop")
    f2 = tmp / f"{name}_loop_reverb.wav"; download(f2); ch, sr = read(f2); per = 1.5 / 0.85 * sr
    T(abs(len(ch[0]) - math.ceil((4 * 1.5 / 0.85 + 3.4) * sr)) <= 1, f"with reverb: 4 x section / 0.85 + 3.4 s tail ({len(ch[0])} at {sr}, loop {p.is_checked('#loopOn')}, {p.inner_text('#vA')}-{p.inner_text('#vE')} x{p.input_value('#rep')}, {p.evaluate('location.hash')})")
    click.skip = [round(k * per) for k in (1, 2, 3, 4)]
    vals = [round(click(ch[0], s), 2) for s in click.skip[:3]]
    T(max(vals) <= 1.5, f"with reverb: no click at the seams ({vals})")
    if shots: (shots / f"{name}_loop_reverb.wav").write_bytes(f2.read_bytes())

    # ---- 8D ----
    p.uncheck("#loopOn"); p.click("#tiles .tile[data-p='8d']")
    T(p.is_checked("#pan") and p.is_visible("#rotBox") and p.inner_text("#vRot") == "8.0 s", "8D preset switches 8D on, one circle 8 s")
    setv("rot", "2")
    T("x=1&t=2" in p.evaluate("location.hash") and "l=1" not in p.evaluate("location.hash"), "8D is saved in the link, loop is off")
    f3 = tmp / f"{name}_8d.wav"; fn = download(f3); ch, sr = read(f3)
    T(fn == "testsong (edit + reverb 8d).wav", f"file name says 8d ({fn})")
    win = sr // 10; bal = []
    for i in range(0, sr * 6 - win, win):
        l, r = rms(ch[0][i:i + win]), rms(ch[1][i:i + win]); bal.append((r - l) / (r + l))
    ref = [math.sin(2 * math.pi * ((i + 0.5) * win / sr) / 2) for i in range(len(bal))]
    corr = sum(x * y for x, y in zip(bal, ref)) / math.sqrt(sum(x * x for x in bal) * sum(y * y for y in ref))
    T(max(bal) > 0.4 and min(bal) < -0.4, f"8D moves between the ears (balance {min(bal):.2f} .. {max(bal):.2f})")
    T(corr > 0.9, f"one circle really takes 2 s (match with a 2 s sine {corr:.2f})")
    p.uncheck("#pan"); setv("mix", "0")  # dry: the stereo reverb alone already differs left/right on steady tones
    f4 = tmp / f"{name}_no8d.wav"; download(f4); ch, sr = read(f4)
    b0 = max(abs(rms(ch[1][i:i + win]) - rms(ch[0][i:i + win])) / (rms(ch[1][i:i + win]) + rms(ch[0][i:i + win])) for i in range(sr, sr * 5, win))
    T(b0 < 0.02, f"counter-check: without 8D (dry) the sound stays in the middle ({b0:.3f})")
    T(p.is_hidden("#rotBox"), "8D off hides the circle slider")
    p.check("#pan"); p.check("#loopOn"); setv("la", "1"); setv("le", "2.5")
    shot("8d_loop")

    # ---- layout / touch ----
    T(p.evaluate("document.documentElement.scrollWidth<=window.innerWidth"), "no sideways scrolling")
    if touch:
        small = p.evaluate("[...document.querySelectorAll('.chk,#setA,#setE,#rep,#la,#le,#rot')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.id||e.className)")
        T(not small, f"tap targets at least 44 px ({small})")
    # ---- link with loop: survives a reload with the same file, is dropped for a shorter file ----
    p.goto(URL + "#p=slowed&s=0.88&r=0&d=2.5&b=1&l=1&a=1&e=2.5&n=4"); p.reload()
    p.set_input_files("#file", str(src)); p.wait_for_selector("#msg.ok")
    T(p.is_checked("#loopOn") and p.inner_text("#vA") == "0:01.00" and p.input_value("#rep") == "4", "link with loop + same file: loop is back")
    p.goto(URL + "#p=slowed&l=1&a=30&e=40&n=2"); p.reload()
    p.set_input_files("#file", str(src)); p.wait_for_selector("#msg.ok")
    T(not p.is_checked("#loopOn") and p.inner_text("#oLen") == "0:06", "link loop that does not fit the file is switched off")
    p.click("#demo"); p.check("#loopOn"); setv("la", "0"); setv("le", "8"); setv("rep", "2"); f5 = tmp / f"{name}_demo.wav"; download(f5); ch, sr = read(f5)
    T(abs(len(ch[0]) / sr - (16 / 0.88 + 0.05)) < 0.01, "demo loop, whole file twice: length fits")
    T(not errs, f"no page errors ({errs[:2]})")
    b.close()

with sync_playwright() as pw:
    run(pw, "desktop_1280", 1280, 900, False)
    run(pw, "handy_390", 390, 844, True)
print(f"Slowed + reverb loop/8D test: {ok} OK, {fail} FAIL")
sys.exit(1 if fail else 0)
