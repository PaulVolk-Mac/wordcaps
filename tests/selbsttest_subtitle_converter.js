// Unit test for tools/subtitle-converter (engine inside index.html, no dependencies):
//   node tests/selbsttest_subtitle_converter.js [path/to/index.html]
const fs=require('fs'),path=require('path');
const cand=[process.argv[2],path.join(__dirname,'index.html'),path.join(__dirname,'..','tools','subtitle-converter','index.html')].filter(Boolean);
const file=cand.find(p=>fs.existsSync(p));const h=fs.readFileSync(file,'utf8');
const js=h.split('<script>')[1].split('</script>')[0];const m={exports:{}};new Function('module',js)(m);
const {convert,parse,ptime,plan,retime,crc32,zip,batch}=m.exports;let ok=0,bad=0;const t=(n,c,i)=>{if(c){ok++}else{bad++;console.log('FAIL',n,i===undefined?'':i)}};

// ---- v1/v2: formats ----
const srt="﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>world</i>\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\nLine one\r\nLine two\r\n";
let r=convert(srt,'vtt',0);t('srt->vtt n',r.n===2);t('vtt header',r.out.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello world'));
const vtt="WEBVTT\n\nNOTE x\n\nc1\n00:00:05.100 --> 00:00:06.000 align:start position:10%\n<v Paul>Hi there\n\n01:02.000 --> 01:03.000\nShort stamp\n";
r=convert(vtt,'srt',0);t('vtt->srt n',r.n===2);t('vtt->srt text',r.out.includes('1\n00:00:05,100 --> 00:00:06,000\nHi there'));t('mm:ss',r.out.includes('00:01:02,000 --> 00:01:03,000'));
r=convert(srt,'srt',-1.5);t('shift clamp',r.out.includes('00:00:00,000 --> 00:00:02,000'));
r=convert(srt,'ass',0);t('ass dialog',r.out.includes('Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world'));t('ass newline',r.out.includes('Line one\\NLine two'));
const back=convert(r.out,'srt',0);t('ass->srt roundtrip',back.n===2&&back.out.includes('Line one\nLine two'));
const assComma="[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\b1}Hi, you, there\n";
r=convert(assComma,'txt',0);t('ass comma text',r.out==='Hi, you, there\n');
r=convert(srt,'txtt',0);t('txt timestamps',r.out.startsWith('[00:00:01] Hello world'));
t('garbage',convert('hello','srt',0).n===0);

// ---- shift in ms ----
r=convert(srt,'srt',0.25);t('shift +250 ms',r.out.includes('00:00:01,250 --> 00:00:03,750'),r.out);
r=convert(srt,'srt',{shift:'-0.001'});t('shift -1 ms (string)',r.out.includes('00:00:00,999 --> 00:00:03,499'));
r=convert(srt,'srt',{shift:'abc'});t('shift garbage = 0',r.out.includes('00:00:01,000 --> 00:00:03,500')&&r.err==='');
r=convert(srt,'srt',undefined);t('no options = unchanged',r.n===2&&r.k===1&&r.cut===0);

// ---- negative times are caught ----
r=convert(srt,'srt',-3.5);t('cue ending at 0 is removed',r.n===1&&r.cut===1,r);
t('renumbered after removal',r.out.startsWith('1\n00:00:58,750 --> 00:01:00,500\nLine one'),r.out);
r=convert(srt,'srt',-2);t('start clamped, end kept',r.out.startsWith('1\n00:00:00,000 --> 00:00:01,500'));
r=convert(srt,'vtt',-999);t('all removed -> empty, no crash',r.n===0&&r.out===''&&r.cut===2);
t('no minus sign ever in output',!/-\d/.test(convert(srt,'srt',-1.2).out.replace(/-->/g,'')));

// ---- hour overflow ----
const long="1\n99:59:59,500 --> 99:59:59,900\nLate\n";
r=convert(long,'srt',1);t('100 h in SRT',r.out.includes('100:00:00,500 --> 100:00:00,900'),r.out);
r=convert(long,'ass',1);t('100 h in ASS',r.out.includes('Dialogue: 0,100:00:00.50,100:00:00.90'),r.out);
r=convert("1\n00:59:59,900 --> 01:00:00,100\nx\n",'vtt',0.2);t('minute -> hour carry',r.out.includes('01:00:00.100 --> 01:00:00.300'));
r=convert("1\n123:00:00,000 --> 123:00:01,000\nx\n",'srt',0);t('3-digit hours parsed',r.out.includes('123:00:00,000 --> 123:00:01,000'));

// ---- frame rate ----
const hour="1\n01:00:00,000 --> 01:00:02,000\nOne hour in\n";
r=convert(hour,'srt',{mode:'fps',from:25,to:24000/1001});t('25 -> 23.976 stretches',r.out.includes('01:02:33,750 --> 01:02:35,835'),r.out);
r=convert(hour,'srt',{mode:'fps',from:24000/1001,to:25});t('23.976 -> 25 shrinks',r.out.includes('00:57:32,547 --> 00:57:34,466'),r.out);
r=convert(hour,'srt',{mode:'fps',from:25,to:25});t('same fps = unchanged',r.out.includes('01:00:00,000 --> 01:00:02,000')&&r.k===1);
const there=convert(hour,'srt',{mode:'fps',from:25,to:24000/1001}).out,backAgain=convert(there,'srt',{mode:'fps',from:24000/1001,to:25}).out;
t('fps round trip within 1 ms',/01:00:00,00[01] --> 01:00:0[12],(000|001|999)/.test(backAgain),backAgain);
r=convert(hour,'srt',{mode:'fps',from:0,to:25});t('bad fps -> error, timing untouched',r.err==='fps'&&r.out.includes('01:00:00,000'));
r=convert(hour,'srt',{mode:'fps',from:25,to:24000/1001,shift:-10});t('fps + shift combined',r.out.includes('01:02:23,750'),r.out);

// ---- two-point sync ----
const two="1\n00:00:10,000 --> 00:00:12,000\nA\n\n2\n00:10:00,000 --> 00:10:02,000\nB\n\n3\n00:20:00,000 --> 00:20:02,000\nC\n";
r=convert(two,'srt',{mode:'pts',a1:10000,b1:12000,a2:1200000,b2:1202000});t('pts pure offset',r.k===1&&r.out.includes('00:00:12,000 --> 00:00:14,000')&&r.out.includes('00:20:02,000'));
r=convert(two,'srt',{mode:'pts',a1:10000,b1:10000,a2:1200000,b2:1260000});
t('pts anchors land exactly',r.out.includes('1\n00:00:10,000')&&r.out.includes('3\n00:21:00,000'),r.out);
t('pts middle is interpolated',r.out.includes('2\n00:10:29,748'),r.out);
t('pts k',Math.abs(r.k-1250/1190)<1e-9);
t('pts same line -> error',convert(two,'srt',{mode:'pts',a1:10000,b1:1,a2:10000,b2:2}).err==='same');
t('pts reversed -> error',convert(two,'srt',{mode:'pts',a1:10000,b1:50000,a2:1200000,b2:40000}).err==='order');
t('pts absurd stretch -> error',convert(two,'srt',{mode:'pts',a1:10000,b1:10000,a2:1200000,b2:9000000}).err==='range');
r=convert(two,'srt',{mode:'pts',a1:10000,b1:NaN,a2:1200000,b2:1200000});t('pts bad time -> error, timing untouched',r.err==='time'&&r.out.includes('00:00:10,000 --> 00:00:12,000'));
t('retime keeps input untouched',(()=>{const c=parse(two),s=JSON.stringify(c);retime(c,{shift:5});return JSON.stringify(c)===s})());

// ---- typed times ----
t('ptime seconds',ptime('62.5')===62500);t('ptime m:ss',ptime('1:02.5')===62500);t('ptime srt style',ptime('00:01:02,500')===62500);
t('ptime h:mm:ss',ptime('1:00:00')===3600000);t('ptime negative',ptime('-0:01')===-1000);
t('ptime rejects text',isNaN(ptime('abc'))&&isNaN(ptime(''))&&isNaN(ptime('1:2:3:4'))&&isNaN(ptime('1::2'))&&isNaN(ptime(null)));
t('plan number = shift',plan(1.5).d===1500&&plan(1.5).k===1);

// ---- batch + zip ----
const enc=new TextEncoder();
t('crc32 check value',crc32(enc.encode('123456789'))===0xCBF43926);t('crc32 empty',crc32(new Uint8Array(0))===0);
const b=batch([{name:'a.srt',text:srt},{name:'notes.txt',text:'just text'},{name:'A.vtt',text:vtt},{name:'sub/dir:x?.srt',text:srt}],'vtt',{shift:1});
t('batch converts 3, skips 1',b.files.length===3&&b.skipped.join()==='notes.txt',b);
t('batch unique names',b.files.map(f=>f.name).join('|')==='a.vtt|A (2).vtt|sub_dir_x_.vtt',b.files.map(f=>f.name));
t('batch applies timing to every file',b.files[0].text.includes('00:00:02.000 --> 00:00:04.500')&&b.files[1].text.includes('00:00:06.100'));
t('batch txt extension',batch([{name:'x.srt',text:srt}],'txtt',0).files[0].name==='x.txt');
const z=zip([{name:'ä.srt',text:'héllo'},{name:'b.vtt',text:''}],new Date(2026,10,19,17,30,0)),dv=new DataView(z.buffer);
t('zip local header',dv.getUint32(0,true)===0x04034b50);t('zip utf-8 flag',dv.getUint16(6,true)===0x0800);
const eo=z.length-22;t('zip end record',dv.getUint32(eo,true)===0x06054b50&&dv.getUint16(eo+10,true)===2);
const co=dv.getUint32(eo+16,true);t('zip central dir',dv.getUint32(co,true)===0x02014b50&&co+dv.getUint32(eo+12,true)===eo);
t('zip stored size = utf-8 bytes',dv.getUint32(18,true)===6&&dv.getUint16(26,true)===6);
t('zip crc of first entry',dv.getUint32(14,true)===crc32(enc.encode('héllo')));
t('zip second entry offset',dv.getUint32(co+46+6+42,true)===30+6+6);
t('zip dos date',dv.getUint16(12,true)===((2026-1980)<<9|11<<5|19));

// ---- markup: every id used by the UI exists, no leftovers ----
const ui=js.split('// ===== UI')[1]||'';const ids=[...new Set([...ui.matchAll(/\$\('([a-zA-Z]+)'\)/g)].map(x=>x[1]))];
const miss=ids.filter(i=>!h.includes('id="'+i+'"'));t('ids present '+miss.join(','),ids.length>15&&miss.length===0);
const fm=[...ui.matchAll(/\['(srt|vtt|ass|txt|txtt)',/g)].map(x=>x[1]);t('5 formats',fm.join()==='srt,vtt,ass,txt,txtt');
t('canonical',h.includes('tools/subtitle-converter/'));t('no placeholder',!h.includes('/*ENGINE*/')&&!h.includes('/*CSS*/'));
t('wordcaps ref',h.includes('wordcaps/?ref=p01'));t('ui guard',/if\(typeof document!=='undefined'/.test(ui));
t('file input takes several files',/<input type="file" id="file"[^>]* multiple>/.test(h));
t('no network call in the engine',!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(js));
console.log(`Selbsttest P01 (${path.basename(path.dirname(file))}): ${ok} OK, ${bad} FAIL`);process.exit(bad?1:0);
