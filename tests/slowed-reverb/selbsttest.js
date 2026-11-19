// Selbsttest P15: node tests/slowed-reverb/selbsttest.js  (liest den Script-Teil aus index.html)
const fs=require('fs');const h=fs.readFileSync(__dirname+'/../../tools/slowed-reverb/index.html','utf8').replace(/\r\n/g,'\n');
const js=h.split('<script>')[1].split('</script>')[0];const m={exports:{}};new Function('module',js)(m);
const E=m.exports;let ok=0,bad=0;const t=(n,c)=>{if(c){ok++}else{bad++;console.log('FAIL',n)}};const near=(a,b,e=1e-6)=>Math.abs(a-b)<e;
// Presets + Grenzen
t('7 Presets',Object.keys(E.PRESETS).length===7);
t('Presets in Grenzen',Object.values(E.PRESETS).every(p=>p.speed>=.5&&p.speed<=1.5&&p.mix>=0&&p.mix<=.9&&p.decay>=.5&&p.decay<=8&&p.bass>=0&&p.bass<=9));
t('Standard = slowed-reverb',E.norm({}).p==='slowed-reverb'&&E.norm({}).speed===0.85);
t('Speed geklemmt unten',E.norm({speed:0.1}).speed===0.5);t('Speed geklemmt oben',E.norm({speed:9}).speed===1.5);
t('Mix Text -> Preset-Wert',E.norm({mix:'abc'}).mix===0.38);t('Bass ganzzahlig',E.norm({bass:2.6}).bass===3);
t('unbekanntes Preset -> Standard',E.norm({p:'xyz'}).p==='slowed-reverb');
t('presetOf erkennt jedes Preset',Object.keys(E.PRESETS).every(k=>E.presetOf(E.norm(Object.assign({p:k},E.PRESETS[k])))===k));
t('presetOf custom',E.presetOf(E.norm({speed:0.83}))==='custom');
// Link
const s={p:'super-slowed',speed:0.77,mix:0.5,decay:4.4,bass:5};const b=E.parseState(E.stateToHash(s));
t('Link Roundtrip',b.p==='super-slowed'&&b.speed===0.77&&b.mix===0.5&&b.decay===4.4&&b.bass===5);
t('Link Unsinn',E.parseState('#s=<script>&b=99').speed===0.85&&E.parseState('#s=<script>&b=99').bass===9);
t('Link leer',E.parseState('').p==='slowed-reverb');
// Tonhoehe + Laenge
t('0,85x = -2,8 Halbtoene',near(E.semitones(0.85),-2.8135,1e-3));t('1x = 0',near(E.semitones(1),0));t('2x = +12',near(E.semitones(2),12));
t('Laenge slowed + Hall',near(E.outSeconds(170,{speed:0.85,mix:0.38,decay:3.4}),200+3.4));
t('Laenge ohne Hall kurzer Rest',near(E.outSeconds(100,{p:'nightcore',speed:1.25,mix:0,decay:1.5}),80.05));
// Hall
const sr=8000,ir=E.makeImpulse(sr,2,7);t('Hall stereo + Laenge',ir.length===2&&ir[0].length===16000);
t('Hall Vordelay still',ir[0].slice(0,100).every(x=>x===0));
const en=(d,a,b)=>{let s=0;for(let i=a;i<b;i++)s+=d[i]*d[i];return s};
t('Hall klingt aus',en(ir[0],200,2000)>50*en(ir[0],14000,16000));
t('Hall reproduzierbar',E.makeImpulse(sr,2,7)[1][5000]===ir[1][5000]);t('L != R (breit)',ir[0][3000]!==ir[1][3000]);
t('Hall endlich',ir[0].every(Number.isFinite));
// Pegel
t('normGain senkt',near(E.normGain(2),Math.pow(10,-1/20)/2));t('normGain hebt nie',E.normGain(0.3)===1&&E.normGain(0)===1);
t('peak',E.peak([new Float32Array([0.1,-0.7]),new Float32Array([0.5])])===Math.fround(0.7));
const g=E.mixGains(0.38);t('mix trocken+nass',g.dry>0&&g.wet>0&&E.mixGains(0).wet===0&&near(E.mixGains(0).dry,1));
// WAV
const w=E.encodeWav([new Float32Array([0,1,-1,2]),new Float32Array([0.5,-0.5,0,-3])],44100);const v=new DataView(w);
const str=(o,n)=>String.fromCharCode(...new Uint8Array(w,o,n));
t('WAV Kopf',str(0,4)==='RIFF'&&str(8,4)==='WAVE'&&str(36,4)==='data');t('WAV Groesse',w.byteLength===44+16&&v.getUint32(40,true)===16&&v.getUint32(4,true)===52);
t('WAV Rate/Kanaele',v.getUint32(24,true)===44100&&v.getUint16(22,true)===2&&v.getUint16(34,true)===16);
t('WAV Werte + Clipping',v.getInt16(44,true)===0&&v.getInt16(48,true)===32767&&v.getInt16(52,true)===-32768&&v.getInt16(56,true)===32767&&v.getInt16(58,true)===-32768);
t('WAV gain',new DataView(E.encodeWav([new Float32Array([1])],8000,0.5)).getInt16(44,true)===16384);
// Dateiname
t('Name Preset',E.outName('My Song.mp3',{p:'slowed-reverb'})==='My Song (slowed + reverb).wav');
t('Name custom',E.outName('a.wav',{speed:0.83,mix:0.2})==='a (slowed + reverb).wav'&&E.outName('a.wav',{speed:1.1,mix:0})==='a (sped up).wav');
t('Name bereinigt',E.outName('x/y:z?.flac',{p:'nightcore'})==='x y z (nightcore).wav');t('Name leer',E.outName('',{p:'slowed'})==='audio (slowed).wav');
// Zeit
t('fmtTime',E.fmtTime(0)==='0:00'&&E.fmtTime(65.9)==='1:05'&&E.fmtTime(3725)==='1:02:05'&&E.fmtTime(NaN)==='0:00');
// Wellenform + Demo
const pk=E.wavePeaks(new Float32Array([0,0.5,0,-1,0,0,0,0.2]),2);t('wavePeaks',pk.length===2&&pk[0]===0&&pk[1]===0);
const pk2=E.wavePeaks(new Float32Array(400).map((_,i)=>i%4===0?(i<200?0.2:0.9):0),2);t('wavePeaks Hoehe',near(pk2[0],0.2,1e-6)&&near(pk2[1],0.9,1e-6));
const d=E.demoSound(8000);t('Demo 8 s stereo',d.length===2&&d[0].length===64000);t('Demo hoerbar, nicht uebersteuert',E.peak(d)>0.2&&E.peak(d)<1.2);
// HTML
const ids=[...new Set([...js.matchAll(/\$\('([a-zA-Z0-9]+)'\)/g)].map(x=>x[1]))];t('alle IDs vorhanden ('+ids.length+')',ids.every(i=>h.includes('id="'+i+'"')));
t('canonical',h.includes('<link rel="canonical" href="https://paulvolk-mac.github.io/wordcaps/tools/slowed-reverb/">'));
t('WordCaps-Link ref=p15',h.includes('wordcaps/?ref=p15'));t('Slowed-Kanal-Link',h.includes('youtube.com/@slowedJaulana'));
t('keine Platzhalter',!h.includes('/*ENGINE*/')&&!/TODO|lorem/i.test(h));t('Rechte-Hinweis',h.includes('does not change who owns it'));
t('kein Server-Upload (kein fetch/XHR)',!/fetch\(|XMLHttpRequest|sendBeacon/.test(js));
t('UI nur im Browser',js.includes("if(typeof document!=='undefined')"));
// ===== A-318: 8D + Loop-Abschnitt =====
t('8D-Preset: pan an, Tempo 1',E.PRESETS['8d'].pan===1&&E.PRESETS['8d'].speed===1&&E.norm({p:'8d'}).pan===1&&E.norm({p:'8d'}).rot===8);
t('alte Presets ohne 8D',['slowed-reverb','super-slowed','slowed','daycore','sped-up','nightcore'].every(k=>E.PRESETS[k].pan===0&&E.norm({p:k}).pan===0));
t('Standard: Loop aus, 1x',E.norm({}).loop===0&&E.norm({}).n===1&&E.norm({}).a===0&&E.norm({}).e===0);
t('rot geklemmt',E.norm({rot:1}).rot===2&&E.norm({rot:99}).rot===20&&E.norm({rot:'x'}).rot===8);
t('n geklemmt + ganzzahlig',E.norm({n:0}).n===1&&E.norm({n:99}).n===32&&E.norm({n:3.6}).n===4&&E.norm({n:'abc'}).n===1);
t('a/e nie negativ oder NaN',E.norm({a:-5,e:'x'}).a===0&&E.norm({a:-5,e:'x'}).e===0&&E.norm({a:1.234}).a===1.23);
t('alter Link bleibt wortgleich',E.stateToHash({p:'super-slowed',speed:0.77,mix:0.5,decay:4.4,bass:5})==='#p=super-slowed&s=0.77&r=0.5&d=4.4&b=5');
t('alter Link -> 8D aus, Loop aus',E.parseState('#p=slowed-reverb&s=0.85&r=0.38&d=3.4&b=2').pan===0&&E.parseState('#p=slowed-reverb&s=0.85').loop===0);
const s8=E.parseState(E.stateToHash({p:'slowed-reverb',pan:1,rot:5.5,loop:1,a:12.5,e:20.25,n:4}));
t('Link Roundtrip 8D + Loop',s8.pan===1&&s8.rot===5.5&&s8.loop===1&&s8.a===12.5&&s8.e===20.25&&s8.n===4&&s8.speed===0.85);
t('Link 8D-Preset abgeschaltet',E.parseState(E.stateToHash({p:'8d',pan:0})).pan===0);
t('Link Unsinn 8D/Loop',(()=>{const x=E.parseState('#x=7&t=-3&l=yes&a=<b>&e=1e99&n=1e9');return x.pan===0&&x.rot===2&&x.loop===0&&x.a===0&&x.e===86400&&x.n===32})());
t('presetOf 8d',E.presetOf(E.norm({p:'8d'}))==='8d'&&E.presetOf(E.norm({p:'8d',rot:5}))==='custom'&&E.presetOf(E.norm({p:'slowed-reverb',pan:1}))==='custom');
t('presetOf: rot egal ohne 8D',E.presetOf(E.norm({p:'nightcore',rot:5}))==='nightcore');
t('Name 8D',E.outName('a.mp3',{p:'8d'})==='a (8d audio).wav'&&E.outName('a.mp3',{p:'slowed-reverb',pan:1})==='a (slowed + reverb 8d).wav');
t('Name Loop',E.outName('a.mp3',{p:'slowed-reverb',loop:1,a:1,e:3,n:4})==='a (slowed + reverb loop).wav');
// Bereich
const R=(d,s)=>E.loopRange(d,s);
t('Bereich Standard = ganze Datei',R(100,{}).a===0&&R(100,{}).e===100);
t('Bereich geklemmt',R(100,{a:50,e:500}).e===100&&R(100,{a:500,e:0}).a===99.75&&R(100,{a:500,e:0}).e===100);
t('Bereich mind. 0,25 s',near(R(100,{a:10,e:10.01}).e,10.25)&&near(R(100,{a:10,e:5}).e,10.25));
t('Bereich Mini-Datei',R(0.1,{a:5,e:9}).a===0&&R(0.1,{}).e===0.1&&R(0,{}).e===0);
// Laenge
t('Laenge Loop 4x slowed',near(E.outSeconds(180,{speed:0.85,mix:0.38,decay:3.4,loop:1,a:30,e:45,n:4}),4*15/0.85+3.4));
t('Laenge Loop 1x ohne Hall',near(E.outSeconds(180,{p:'nightcore',loop:1,a:10,e:20,n:1}),10/1.25+0.05));
t('Laenge Loop aus ignoriert a/e/n',near(E.outSeconds(170,{speed:0.85,mix:0.38,decay:3.4,a:10,e:20,n:8}),200+3.4));
t('Deckel 15 min',E.effRepeats(600,{speed:0.5,loop:1,a:0,e:60,n:32})===7&&E.outSeconds(600,{speed:0.5,mix:0,loop:1,a:0,e:60,n:32})<=E.MAXOUT+0.05);
t('Deckel: mind. 1x',E.effRepeats(3000,{speed:0.5,loop:1,a:0,e:3000,n:5})===1&&E.effRepeats(100,{loop:1,a:0,e:10,n:3})===3);
// Naht: Signal mit hartem Pegelsprung an jeder naiven Naht (Rampe 0..1 ueber die Datei)
const SR=8000,ramp=new Float32Array(SR*4).map((_,i)=>i/(SR*4)*2-1),sine=new Float32Array(SR*4).map((_,i)=>0.8*Math.sin(2*Math.PI*220.3*i/SR));
const maxStep=(d,a,b)=>{let m=0;for(let i=Math.max(1,a);i<b;i++){const x=Math.abs(d[i]-d[i-1]);if(x>m)m=x}return m};
const P=E.loopPeriod([ramp,ramp],SR,1,2.5);
t('Periode: Laenge exakt, stereo',P.L===12000&&P.chs.length===2&&P.chs[0].length===12000&&P.mode==='pre'&&P.X===96);
t('Periode: Anfang unveraendert',P.chs[0][0]===ramp[8000]&&P.chs[0][5000]===ramp[13000]);
t('Periode: Ende fuehrt in den Anfang',Math.abs(P.chs[0][11999]-ramp[7999])<0.02);
const naive=(d,a,e,n)=>{const p=d.slice(a,e),o=new Float32Array(p.length*n);for(let k=0;k<n;k++)o.set(p,k*p.length);return o};
const ML=E.makeLoop([ramp,ramp],SR,1,2.5,4),nv=naive(ramp,8000,20000,4);
t('Loop: Laenge = n x Abschnitt',ML.chs[0].length===48000&&ML.n===4);
t('Gegenprobe: naive Naht springt',maxStep(nv,11990,12010)>0.7);
t('Loop: kein Sprung an 3 Naehten (Rampe)',[1,2,3].every(k=>maxStep(ML.chs[0],k*12000-200,k*12000+200)<0.02));
const MS=E.makeLoop([sine],SR,0.5013,1.777,5),stepIn=maxStep(sine,0,sine.length);
t('Loop Sinus: Naht hoechstens 1,45x so steil wie das Signal (Ueberblendung zweier Phasen)',[1,2,3,4].every(k=>maxStep(MS.chs[0],k*MS.L-150,k*MS.L+150)<=stepIn*1.45));
t('Loop: Anfang/Ende weich (Schnitt mitten im Song)',Math.abs(ML.chs[0][0])<1e-6&&Math.abs(ML.chs[0][47999])<1e-6);
t('Loop: letzte Runde endet im Original, nicht im Vorlauf',Math.abs(ML.chs[0][47999-60]-ramp[19999-60])<1e-6);
t('Loop: endlich + nie lauter als Quelle x 1,42',ML.chs[0].every(Number.isFinite)&&E.peak(MS.chs)<=0.8*1.42);
// Start bei 0 -> Blende aus dem Nachlauf ('post'); ganze Datei -> 'dip'
const PO=E.loopPeriod([ramp],SR,0,1.5),MP=E.makeLoop([ramp],SR,0,1.5,3);
t('post-Modus bei Start 0',PO.mode==='post'&&PO.L===12000&&Math.abs(PO.chs[0][0]-ramp[12000])<0.02&&PO.chs[0][11999]===ramp[11999]);
t('post: Naehte ohne Sprung, erste Runde beginnt original',[1,2].every(k=>maxStep(MP.chs[0],k*12000-200,k*12000+200)<0.02)&&MP.chs[0][0]===ramp[0]&&MP.chs[0][50]===ramp[50]);
const DI=E.makeLoop([ramp],SR,0,4,2);
t('dip-Modus ganze Datei',DI.mode==='dip'&&DI.chs[0].length===64000&&maxStep(DI.chs[0],31900,32100)<0.03&&Math.abs(DI.chs[0][31999])<0.01&&Math.abs(DI.chs[0][32000])<0.01);
t('1x = nur schneiden',(()=>{const o=E.makeLoop([ramp],SR,1,2,1);return o.chs[0].length===8000&&o.chs[0][4000]===ramp[12000]})());
t('Mini-Abschnitt stuerzt nicht ab',(()=>{const o=E.makeLoop([new Float32Array(10).fill(0.5)],SR,0,0.0001,3);return o.chs[0].length===6&&o.chs[0].every(Number.isFinite)})());
t('Quelle bleibt unveraendert',ramp[8000]===8000/(SR*4)*2-1&&ramp[19999]===Math.fround(19999/(SR*4)*2-1));
t('Blende 12 ms',E.XFADE===0.012&&E.loopPeriod([new Float32Array(44100*3)],44100,1,2).X===529);
t('fmtExact',E.fmtExact(0)==='0:00.00'&&E.fmtExact(62.5)==='1:02.50'&&E.fmtExact(59.999)==='1:00.00'&&E.fmtExact(NaN)==='0:00.00'&&E.fmtExact(-3)==='0:00.00');
// HTML
t('8D-Tile + FAQ ehrlich',h.includes('What is 8D audio?')&&h.includes('not real surround sound'));
t('Loop-FAQ',h.includes('How do I loop one part of a song?'));
t('Bedienelemente mit Namen',['loopOn','la','le','setA','setE','rep','pan','rot'].every(i=>h.includes('id="'+i+'"'))&&h.includes('aria-label="Loop start"')&&h.includes('aria-label="Seconds per circle"'));
t('Export nutzt makeLoop, Vorhoeren loopPeriod',js.includes('makeLoop(bufChs()')&&js.includes('loopPeriod(bufChs()'));
t('8D ohne neues Paket (StereoPanner + Oszillator)',js.includes('createStereoPanner')&&js.includes('createOscillator')&&!/<script[^>]+src=(?!'https:\/\/static\.cloudflareinsights)/.test(h));
t('Preset-Wechsel behaelt die Wiederholungen (Preset-Name n ueberschreibt nicht)',js.includes('Object.assign({p:k},PRESETS[k],keepLoop())')&&E.norm(Object.assign({p:'slowed'},E.PRESETS.slowed,{loop:1,a:1,e:2,n:4})).n===4);
console.log(ok+'/'+(ok+bad)+(bad?' FEHLER':' OK'));process.exit(bad?1:0);
