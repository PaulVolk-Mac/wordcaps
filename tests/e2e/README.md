# E2E-Tests der 5 Web-Tools (Playwright)

```
python tests/e2e/test_tools.py              # Edge (installiert), headless
python tests/e2e/test_tools.py --channel chromium   # nach `playwright install chromium`
python tests/e2e/test_tools.py --nur hiit-timer
```
Prüft je Tool bei 1280 px und 390 px: HTTP 200, `<title>` + `<h1>`, 0 pageerror/console.error, keine HTTP-Fehler ≥ 400,
kein Querscrollen, **keine Anfrage an fremde Hosts** (Offline-Versprechen), Screenshot nach `tests/e2e/_shots/`.
Dazu eine Funktionsprobe je Tool (SRT→VTT, Safe-Zone-Tabs/Tabelle, Noise-Machine Play, HIIT-Timer läuft, Slowed-Reverb-Demo).
Benötigt nur `pip install playwright` (kein Server, kein Build).
