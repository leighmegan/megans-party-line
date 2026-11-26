{
// ============ settings: change game numbers here; rules and labels read from this ============
const CONFIG={version:'7.0',build:'__BUILD__',perRound:10,skips:3,
 times:[60,90,120,0],defaultTime:60,backup:false,countdown:3,warnAt:10,mixedName:'Mixed',
 sync:true,syncHeardFor:15*60*1000,syncBeat:90*1000,liveWindow:3*60*1000,creditSecondsPerLine:2.2};

// ============ helpers ============
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normCode=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const clean=s=>String(s||'').trim().replace(/\s+/g,' ').slice(0,16);
const fmt=s=>{s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const timeLabel=t=>t?fmt(t):'Unlimited';   // round length 0 means no timer
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function hash(str){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
 h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return((h2>>>0)^(h1>>>0))>>>0}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function shuffle(arr,seed){const a=arr.slice(),r=rng(seed);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

// ============ storage: works even when the browser won't save ============
const mem={};
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?(k in mem?mem[k]:d):JSON.parse(v)}catch(e){return k in mem?mem[k]:d}},
 set(k,v){mem[k]=v;try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){delete mem[k];try{localStorage.removeItem(k)}catch(e){}}};
const KEY='mt:v3';

// ============ state: everything about a game lives in one record ============
// S = {name, sound, device, rulesSeen, liveRound, current, defaults:{deck,time},
//      games:{id:{id, partner, partnerT, partnerDevice, playAs, player, code, deck, time, timeT, seen:[card ids], cycle, rnd, created, last, lastMsg,
//                 session:{sid, prev, rounds:[{who:'me'|'them', rid, c, s, x, n, dur, deck, words|guessed}], final:{target}}}}}
const newSession=sid=>({sid:sid||uid(),prev:null,rounds:[],final:null,startedAt:Date.now()});
const newGame=o=>Object.assign({id:uid(),partner:'',playAs:null,session:newSession(),player:null,code:'',deck:'c',time:CONFIG.defaultTime,seen:[],cycle:0,rnd:Math.random().toString(36).slice(2,10),created:Date.now(),last:0},o);
function migrate(){// version 2 kept one setup in mt:prefs with played cards per player number
 const p=store.get('mt:prefs',null),s={name:'',sound:'on',current:null,games:{},defaults:{deck:'c',time:CONFIG.defaultTime}};
 if(p&&p.player){const g=newGame({partner:p.partner||'',player:String(p.player),code:p.code||'',deck:{classic:'c',adult:'a',mixed:'all'}[p.deck]||'c',time:p.time||CONFIG.defaultTime,
  seen:store.get('mt:seen:'+p.player,[]),cycle:store.get('mt:cycle:'+p.player,0),rnd:p.rnd||undefined,last:Date.now()});
  if(!g.rnd)g.rnd=Math.random().toString(36).slice(2,10);
  s.games[g.id]=g;s.current=g.id;s.name=p.name||'';s.sound=p.sound||'on';s.defaults={deck:g.deck,time:g.time}}
 return s}
let S=store.get(KEY,null)||migrate();
if(!S.device)S.device=uid();
if(!S.hist)S.hist=[];if(!S.merge)S.merge={};
const okTime=t=>CONFIG.times.includes(t)?t:CONFIG.defaultTime;
Object.values(S.games||{}).forEach(g=>{g.time=okTime(g.time)});if(S.defaults)S.defaults.time=okTime(S.defaults.time);
const save=()=>store.set(KEY,S);save();
const G=()=>S.games[S.current]||null;
let seen=new Set(G()?G().seen:[]);
const useGame=id=>{S.current=id;seen=new Set(G()?G().seen:[]);save();syncStart()};
const saveSeen=()=>{if(G()){G().seen=[...seen];save()}};
const partner=()=>(G()&&G().partner)||'your partner';
const myName=(g=G())=>(g&&g.playAs)||S.name||'You';
const sess=(g=G())=>{if(!g)return newSession();if(!g.session)g.session=newSession();if(!g.session.sid)g.session.sid=uid();return g.session};
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);

// ============ cards (from cards.json) ============
let DECKS=[],CARDS=[],BYID=new Map(),GROUP=new Map(),loaded=false;
// card: [id, deck, side 0|1, family, word, [forbidden], word group (same word in several decks)]
const copies=c=>GROUP.get(c[6]??c[0])||[c[0]];
// each deck tracks its own copy of a shared word; Mixed skips a word if any copy has been played
const markSeen=(c,on)=>{on?seen.add(c[0]):seen.delete(c[0])};
const played=(c,g=G())=>g&&g.deck==='all'?copies(c).some(id=>seen.has(id)):seen.has(c[0]);
const deckName=id=>id==='all'?CONFIG.mixedName:(DECKS.find(d=>d.id===id)||{name:'…'}).name;
const deckOptions=()=>DECKS.map(d=>[d.id,d.name]).concat(DECKS.length>1?[['all',CONFIG.mixedName]]:[]);
function pool(g=G()){if(!g||!g.player)return[];const side=Number(g.player)-1;
 if(g.deck!=='all')return CARDS.filter(c=>c[2]===side&&c[1]===g.deck);
 // Mixed: every deck marked for it, one copy of each word
 const mixed=new Set(DECKS.filter(d=>d.mixed!==false).map(d=>d.id)),one=new Set();
 return CARDS.filter(c=>{if(c[2]!==side||!mixed.has(c[1]))return false;const w=c[6]??c[0];if(one.has(w))return false;one.add(w);return true})}
const unseenCount=()=>pool().filter(c=>!played(c)).length;
function deal(){const g=G();let p=pool(),fresh=false;
 if(!p.some(c=>!played(c))){p.forEach(c=>g.deck==='all'?copies(c).forEach(id=>seen.delete(id)):markSeen(c,false));g.cycle++;saveSeen();fresh=true}
 const seed=(g.code?'code:'+g.code:'rnd:'+g.rnd)+'|'+g.cycle;
 return{cards:shuffle(p.slice().sort((a,b)=>a[0]-b[0]),hash(seed)).filter(c=>!played(c)).slice(0,CONFIG.perRound),fresh}}

// ============ match badge ============
const SHAPES={star:'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z',heart:'M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.6 0 5.8 3.7 4.3 7.3C19.5 16.4 12 21 12 21z',
 moon:'M15.5 2.5A9.5 9.5 0 1 0 21.5 17 7.5 7.5 0 0 1 15.5 2.5z',bolt:'M13.5 2 4 13.5h6.5L9 22l11-12.5h-6.8z',diamond:'M12 2l9 10-9 10-9-10z',
 cloud:'M7 19a5 5 0 0 1-.9-9.9A6.5 6.5 0 0 1 18.6 8 5.5 5.5 0 0 1 18 19z',drop:'M12 2s7 7.6 7 12.5a7 7 0 0 1-14 0C5 9.6 12 2 12 2z',crown:'M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z'};
const COLS={red:'#ff5a5f',orange:'#ff9f1c',yellow:'#ffd23f',green:'#3ddc97',teal:'#2ec4b6',blue:'#4ea8ff',purple:'#b388ff',pink:'#ff7eb6'};
function badgeHTML(g=G()){if(!g||!g.code)return'None';if(!loaded)return'…';
 const h=hash('badge|'+g.code),sk=Object.keys(SHAPES),ck=Object.keys(COLS),s=sk[h%sk.length],c=ck[(h>>>8)%ck.length];
 return'<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="'+SHAPES[s]+'" fill="'+COLS[c]+'"/></svg>'+c[0].toUpperCase()+c.slice(1)+' '+s}

// ============ sound, vibration, screen wake ============
let ac=null;
function audio(){if(S.sound!=='on')return null;try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume();return ac}catch(e){return null}}
function tone(f,dur,type='sine',vol=.18,when=0,f2){const a=audio();if(!a)return;try{const t=a.currentTime+when,o=a.createOscillator(),g=a.createGain();
 o.type=type;o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
 o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.02)}catch(e){}}
const sfx={tick:()=>tone(880,.08,'square',.08),go:()=>tone(660,.18,'triangle',.2),ok:()=>{tone(784,.12,'triangle');tone(1175,.18,'triangle',.18,.1)},
 buzz:()=>{tone(140,.45,'sawtooth',.22);tone(147,.45,'square',.12)},skip:()=>tone(440,.12,'triangle',.12,0,330),end:()=>{tone(523,.2,'triangle');tone(392,.2,'triangle',.18,.18);tone(262,.35,'triangle',.18,.36)}};
const vibrate=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
let wl=null;
async function wake(on){try{if(on&&'wakeLock' in navigator&&!wl){wl=await navigator.wakeLock.request('screen');wl.addEventListener('release',()=>{wl=null})}else if(!on&&wl){await wl.release();wl=null}}catch(e){wl=null}}

// ============ screens and dialogs ============
let screen='',draft=null,drafting=false;   // drafting: Home is filling in a brand-new game
// many messages can arrive at once: redraw once per frame
let renderQueued=false;const queueRender=()=>{if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;if(screen==='play')renderSync();else render()})};
const setVal=(sel,v)=>{const el=$(sel);if(el&&document.activeElement!==el)el.value=v};
function show(id){screen=id;$$('.screen').forEach(s=>s.classList.toggle('on',s.id==='s-'+id));window.scrollTo(0,0);render()}
function toast(msg,ms=2600){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),ms)}
const openModal=id=>$('#m-'+id).classList.add('on');
function closeModals(){$$('.modal').forEach(m=>m.classList.remove('on'));if(game&&game.pausedByDialog){game.pausedByDialog=false;resume()}}
function confirmBox(msg,yes,label='Yes'){$('#cf-p').textContent=msg;$('#cf-yes').textContent=label;$('#cf-yes').onclick=()=>{$('#m-confirm').classList.remove('on');if(game)game.pausedByDialog=false;yes()};openModal('confirm')}
$('#cf-no').onclick=closeModals;

// segmented controls are built from data: scope says where the value lives
const FIELDS={player:()=>[['1','Player 1'],['2','Player 2']],deck:deckOptions,time:()=>CONFIG.times.map(t=>[String(t),timeLabel(t)]),
 type:()=>[['team','Team'],['h2h','Head-to-head']],
 win:()=>mdraft&&mdraft.type==='team'?[['target',SCORE.target+' cards'],['rounds',SCORE.roundsEach+' rounds each']]:[['target','First to '+SCORE.target],['rounds',SCORE.roundsEach+' rounds each']],
 pen:()=>[['-1','−1'],['-0.5','−0.5'],['0','0']],mode:()=>[['fun','Just for fun'],['score','Keep score']],val:()=>[['weighted','Weighted'],['equal','Equal']],sound:()=>[['on','On'],['off','Off']]};
const target=scope=>scope==='setup'?draft:scope==='game'?G():scope==='match'?mdraft:S;
// some choices are locked: deck and round length during a match
const locked=(f,scope)=>(scope==='game'&&(f==='deck'||f==='time'||f==='mode')&&matchOn())||(scope==='match'&&!!G()&&!drafting&&matchOn());
// a single option that can't be picked right now: Keep score needs a round timer
const blocked=(f,v,t)=>f==='mode'&&v==='score'&&!t.time;
function renderSegs(){$$('.seg').forEach(seg=>{const t=target(seg.dataset.scope);if(!t)return;const f=seg.dataset.field,opts=FIELDS[f]();
 const lk=locked(f,seg.dataset.scope);
 seg.innerHTML=opts.length?opts.map(([v,l])=>'<button data-v="'+esc(v)+'" aria-pressed="'+(String(t[f])===v)+'"'+((lk&&String(t[f])!==v)||blocked(f,v,t)?' disabled':'')+'>'+esc(l)+'</button>').join(''):'<span class="note">Loading…</span>'})}
document.addEventListener('click',e=>{const b=e.target.closest('.seg button');if(!b||b.disabled)return;const seg=b.parentElement,t=target(seg.dataset.scope),f=seg.dataset.field;
 if(seg.dataset.scope==='match'){t[f]=b.dataset.v;const g=G();if(g&&!drafting){g.scoreCfg=Object.assign({},mdraft);save()}render();return}
 if(f==='deck'&&seg.dataset.scope==='game'&&t.deck!==b.dataset.v&&sess(t).rounds.length){
  confirmBox('Switching decks ends this game and shows your game summary.',()=>{endGame('deck',null);t.deck=b.dataset.v;S.defaults.deck=t.deck;save();render();afterCredits=()=>suggestTime(t)},'Switch and end');return}
 if(f==='player'&&seg.dataset.scope==='game'&&t.player&&t.player!==b.dataset.v&&(t.seen.length||sess(t).rounds.length)){
  confirmBox('Switch to Player '+b.dataset.v+'? You\'ll get the other half of the cards, and '+partner()+' may have already given clues for some of them. Only do this if your phones picked the same player.',()=>{t.player=b.dataset.v;save();announce();render()},'Switch');return}
 t[f]=f==='time'?Number(b.dataset.v):b.dataset.v;if(f==='time'&&t===G())t.timeT=Date.now();
 if(f==='time'&&!t.time&&t.mode==='score')t.mode='fun';
 if(seg.dataset.scope==='game'){if(f!=='player')S.defaults[f]=t[f];if(f==='time'||f==='player')announce()}save();render();
 if(f==='deck')suggestTime(t)});
// a deck can carry a suggested round length (cards.json decks[].suggestTime)
function suggestTime(t){const d=DECKS.find(x=>x.id===t.deck);if(!d||!d.suggestTime||!t.time||t.time>=d.suggestTime)return;
 confirmBox(d.name+' plays best with '+fmt(d.suggestTime)+' rounds. Switch to '+fmt(d.suggestTime)+'?',()=>{t.time=d.suggestTime;t.timeChosen=true;if(t===G()){S.defaults.time=t.time;t.timeT=Date.now();announce()}save();render();toast('Rounds set to '+fmt(d.suggestTime))},'Switch')}

function renderRules(){$('#rules-list').innerHTML=[
 'One of you gives clues and the other guesses. Swap after every round.',
 'Get your partner to say the big word on top. You can\'t say it, or any of the words under it.',
 'No cheating with close cousins: if "marriage" is off-limits, so is "marry." No rhymes, no "sounds like," no spelling it out.',
 'Tap Correct when they get it. Close enough counts, like "dogs" for "dog."',
 'Slip up and say a forbidden word? Be honest and tap Buzz.',
 'Stuck? You get '+plural(CONFIG.skips,'free skip')+' a round.',
 'A round is up to '+CONFIG.perRound+' cards, or until time runs out.',
 'Ready to wrap up? Tap Final round so you both get the same number of turns.',
 'Want bragging rights? Pick Keep score on the home screen.'
].map(t=>'<li>'+esc(t)+'</li>').join('')}

function badgeFor(code){if(!code)return'';const h=hash('badge|'+code),sk=Object.keys(SHAPES),ck=Object.keys(COLS),sh=sk[h%sk.length],c=ck[(h>>>8)%ck.length];
 return'<svg width="26" height="26" viewBox="0 0 24 24" aria-label="'+c+' '+sh+'"><path d="'+SHAPES[sh]+'" fill="'+COLS[c]+'"/></svg>'}
function render(){const g=G();
 // Home's deck, round length and mode edit the current game, or the new-game draft
 $$('#s-setup .seg[data-scope=setup], #s-setup .seg[data-scope=game]').forEach(x=>x.dataset.scope=drafting||!g?'setup':'game');renderSegs();
 $$('[data-backup]').forEach(el=>el.hidden=!CONFIG.backup);
 if(screen==='home'&&g){$('#h-game').textContent=g.title?g.title+' · with '+partner():'Game with '+partner();$('#h-badge').innerHTML=badgeFor(g.code);
  $('#h-deckname').textContent=deckName(g.deck);$('#h-time').textContent=g.time?timeLabel(g.time)+' rounds':'No timer';
  $('#h-left').textContent=g.player&&loaded?unseenCount()+' of '+pool().length+' left':'cards: picking a player…';
  const b=$('#start'),st=startState();b.disabled=!!st;b.textContent=st||'Start round';
  $('#h-manual').hidden=!!g.player;renderTurn();renderSync();renderMatchHome()}
 if(screen==='sum')renderTurn();
 if(screen==='set'){const hg=!drafting&&g;$('#set-game').hidden=!hg;$('#set-all-h').hidden=!hg;$('#set-name').closest('label').hidden=!hg;setVal('#set-name',S.name);
  $('#ver').textContent='Version '+CONFIG.version+' · build '+CONFIG.build+(loaded?' · '+CARDS.length+' cards':'')}
 if(screen==='set'&&g&&!drafting){setVal('#set-playas',g.playAs||'');$('#set-playas').placeholder=S.name;setVal('#set-partner',g.partner);$('#set-game-h').textContent=gameLabel(g);
  const p=pool();$('#set-seen').textContent=loaded?(p.length-unseenCount())+' of your '+p.length+' '+deckName(g.deck).toLowerCase()+' cards played in this game.':''}
 if(screen==='setup')renderHome();
 if(g)maybeInvite();
 if(screen==='brag')renderBrag()}

// ============ home: saved games, a new game, and how you'll play ============
const homeGame=()=>drafting?null:G();
const gameLabel=(g=G())=>g?(g.title||'Game with '+(g.partner||'your partner')):'';
// the code word links the two phones; once they've found each other, changing it would split them up
const codeLocked=g=>!!(g&&g.partnerDevice);
const otherGames=()=>Object.values(S.games).sort((a,b)=>(b.last||b.created)-(a.last||a.created));
// fill Home from the current game, or start a blank new one when there are no games
function loadHome(){closeModals();if(!G()){startSetup();return}drafting=false;draft=null;const g=G();
 $('#setup-name').value=myName(g);$('#setup-code').value=g.code||'';$('#setup-gname').value=g.title||'';mdraft=matchOn(g)?cfgOf(g.match):Object.assign({},SCORE.defaults,g.scoreCfg);if(!g.mode)g.mode='fun';show('setup')}
function startSetup(){drafting=true;draft={deck:S.defaults.deck,time:okTime(S.defaults.time),mode:'fun'};mdraft=Object.assign({},SCORE.defaults);
 $('#setup-name').value=S.name;$('#setup-code').value='';$('#setup-gname').value='';closeModals();show('setup')}
function renderHome(){const g=homeGame(),t=g||draft;if(!t)return;
 $('#sg-group').hidden=!Object.keys(S.games).length;
 $('#sg-name').textContent=g?gameLabel(g):'New game';
 const lk=codeLocked(g);$('#setup-code').readOnly=lk;$('#setup-code').classList.toggle('locked',lk);
 $('#code-note').hidden=!(!g||lk);$('#code-note').textContent=lk?'The code word is locked once your phones connect. Start a new game to use a different one.':'Type the same code word on both phones.';$('#sg-badge').innerHTML=g?badgeFor(g.code):'';
 $('#setup-cancel').hidden=!(drafting&&G());$('#setup-badge').innerHTML=badgeFor(normCode($('#setup-code').value));
 $('#setup-go').textContent=g&&matchOn(g)?'Back to the match':"Let's play";
 const on=g&&matchOn(g),sc=t.mode==='score'||on;$('#score-opts').hidden=!sc;
 $('#mode-note').hidden=!(on||!t.time);$('#mode-note').textContent=on?'Match in progress. End it from the game screen.':'Keep score needs a timer. Pick 1:00, 1:30 or 2:00.';
 if(sc)renderScoreNotes()}
function renderScoreNotes(){$('#type-note').textContent=mdraft.type==='team'?'Work together. Fewer seconds per card is better.':'Score your own clues. A buzz gives your partner a steal.';
 const ws=DECKS.filter(d=>(d.weight??1)!==1).map(d=>d.name+' '+half(d.weight));
 $('#val-note').textContent=mdraft.val==='equal'?'Every card is worth 1.':'Most cards are worth 1. '+ws.join(', ')+'.'}
$('#setup-go').onclick=()=>{const name=clean($('#setup-name').value),code=normCode($('#setup-code').value),title=clean($('#setup-gname').value);
 if(!name){toast('Add a name so your partner sees it');return}if(!code){toast('Add a code word. Your partner types the same one.');return}
 // a team name in your very first game shouldn't become your usual name
 if(!S.name&&!/\bteam\b/i.test(name))S.name=name;
 let g=homeGame();
 if(!g){g=newGame({deck:draft.deck,time:draft.time,code,last:Date.now(),timeT:draft.timeChosen?Date.now():0,playAs:name===S.name?null:name});
  g.mode=draft.mode;if(title){g.title=title;g.titleT=Date.now()}S.games[g.id]=g;S.defaults={deck:g.deck,time:g.time};useGame(g.id)}
 else{g.playAs=name===S.name?null:name;if((g.title||'')!==title){g.title=title||null;g.titleT=Date.now()}
  if(code!==g.code&&!codeLocked(g)){g.code=code;save();syncStart()}announce()}
 drafting=false;g.scoreCfg=Object.assign({},mdraft);g.wantMatch=g.mode==='score'&&!matchOn(g)&&!(g.match&&g.match.status==='invite');save();show('home');tryInvite(g);
 if(!S.rulesSeen){S.rulesSeen=true;save();setTimeout(()=>openModal('rules'),250)}};
$('#setup-cancel').onclick=loadHome;
$('#h-back').onclick=loadHome;
$$('[data-home]').forEach(b=>b.addEventListener('click',()=>{if(game)return;loadHome()}));
$('#setup-code').addEventListener('input',()=>{$('#setup-badge').innerHTML=badgeFor(normCode($('#setup-code').value))});
let backTo='home';
$('#setup-set').onclick=()=>{backTo='setup';show('set')};
function renderGames(){const list=otherGames();
 $('#games-list').innerHTML=list.map(g=>{const when=g.last?new Date(g.last).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'not played yet',cur=g.id===S.current&&!drafting;
  return'<li><button class="pick" data-game="'+esc(g.id)+'" aria-current="'+cur+'"><span>'+esc(gameLabel(g))+'</span><small>'+esc(deckName(g.deck))+' · '+esc(cur?'playing now':'last played '+when)+'</small></button></li>'}).join('')}
$('#to-games').onclick=()=>{renderGames();openModal('games')};
// tapping a saved game shows its summary first
let gsum=null;
function showGameSummary(id){const g=S.games[id];if(!g)return;gsum=id;const when=g.last?new Date(g.last).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'not played yet';
 $('#gs-h').innerHTML=esc(gameLabel(g))+' '+badgeFor(g.code);$('#gs-sub').textContent=(g.title?'With '+(g.partner||'your partner')+' · ':'')+'Last played '+when+' · '+deckName(g.deck)+' · '+(g.time?timeLabel(g.time)+' rounds':'No timer');
 const es=g.partnerDevice?record(g):[],h=es.filter(e=>e.t==='h2h'),tm=es.filter(e=>e.t==='team'&&e.sp!=null),n=k=>h.filter(e=>e.r===k).length;
 const box=(l,v,w)=>'<div'+(w?' class="wide"':'')+'><small>'+esc(l)+'</small><b>'+esc(v)+'</b></div>';
 $('#gs-stats').innerHTML=box('Cards played',String(g.seen.length))+box('Rounds this game',String(sess(g).rounds.length))+
  (h.length?box('Head-to-head',myName(g)+' '+n('w')+' – '+n('l')+' '+cap(g.partner||'partner')+(n('t')?' · '+plural(n('t'),'tie'):''),true):'')+
  (tm.length?box('Team best speed',num(Math.min(...tm.map(e=>e.sp)))+' s a card',true):'')+(!es.length?box('Matches','None yet',true):'');
 $('#m-games').classList.remove('on');openModal('gsum')}
$('#games-list').addEventListener('click',e=>{const p=e.target.closest('[data-game]');if(p)showGameSummary(p.dataset.game)});
$('#gs-play').onclick=()=>{const id=gsum;if(!S.games[id])return;if(id!==S.current||drafting){useGame(id);toast('Switched to game with '+partner())}loadHome()};
$('#gs-del').onclick=()=>{const g=S.games[gsum];if(!g)return;$('#m-gsum').classList.remove('on');
 confirmBox('Delete "'+gameLabel(g)+'"? Its played cards are lost. Bragging Rights stay.',()=>{const cur=g.id===S.current;delete S.games[g.id];save();
  if(cur){const nx=otherGames()[0];useGame(nx?nx.id:null)}if(G())loadHome();else startSetup();toast('Game deleted')},'Delete')};
$('#new-game').onclick=startSetup;
$('#del-game').onclick=()=>confirmBox('Delete "'+gameLabel()+'"? Its played cards are lost. Bragging Rights stay.',()=>{delete S.games[S.current];const nx=otherGames()[0];useGame(nx?nx.id:null);if(G())loadHome();else startSetup()},'Delete');
$('#set-partner').addEventListener('change',e=>{const v=clean(e.target.value);if(v){G().partner=v;save()}render()});
$('#set-name').addEventListener('change',e=>{S.name=clean(e.target.value);save();announce()});
$('#set-playas').addEventListener('change',e=>{const v=clean(e.target.value);G().playAs=v&&v!==S.name?v:null;save();announce();render()});
$('#reset-seen').onclick=()=>confirmBox('Put all of your played cards in this game back in your deck? You may see cards you\'ve already played.',()=>{seen.clear();G().cycle++;saveSeen();render();toast('Played cards reset')},'Reset');

// ============ backup: all games as one short code (played cards packed as bits) ============
const toB64=u8=>{let s='';u8.forEach(b=>s+=String.fromCharCode(b));return btoa(s)};
const fromB64=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
function packIds(ids){const max=Math.max(0,...ids),u8=new Uint8Array((max>>3)+1);ids.forEach(i=>u8[i>>3]|=1<<(i&7));return toB64(u8)}
function unpackIds(b){const u8=fromB64(b),out=[];u8.forEach((v,i)=>{for(let k=0;k<8;k++)if(v&1<<k)out.push(i*8+k)});return out}
function makeBackup(){const data={v:1,n:S.name,so:S.sound,c:S.current,d:S.defaults,g:Object.values(S.games).map(g=>({i:g.id,p:g.partner,pa:g.playAs,pl:g.player,co:g.code,de:g.deck,t:g.time,cy:g.cycle,r:g.rnd,cr:g.created,l:g.last,s:packIds(g.seen)}))};
 return'MTB1.'+btoa(unescape(encodeURIComponent(JSON.stringify(data))))}
function readBackup(code){const raw=String(code).trim();if(!raw.startsWith('MTB1.'))throw 0;const d=JSON.parse(decodeURIComponent(escape(atob(raw.slice(5)))));
 const games={};d.g.forEach(x=>{games[x.i]=newGame({id:x.i,partner:x.p,playAs:x.pa||null,player:x.pl,code:x.co,deck:x.de,time:x.t,cycle:x.cy,rnd:x.r,created:x.cr,last:x.l,seen:unpackIds(x.s)})});
 return{name:d.n||'',sound:d.so||'on',current:games[d.c]?d.c:Object.keys(games)[0]||null,games,defaults:d.d||{player:'1',deck:'c',time:CONFIG.defaultTime}}}
$('#bk-copy').onclick=async()=>{const code=makeBackup(),box=$('#bk-text');
 try{await navigator.clipboard.writeText(code);toast('Backup code copied. Paste it somewhere safe.')}
 catch(e){box.hidden=false;box.value=code;box.focus();box.select();$('#bk-restore').hidden=true;toast('Copy the code from the box below')}};
$('#bk-open').onclick=()=>{const box=$('#bk-text');box.hidden=false;box.value='';box.placeholder='Paste your backup code here';$('#bk-restore').hidden=false;box.focus()};
function restoreFrom(text){let next;try{next=readBackup(text)}catch(e){toast('That code didn\'t work. Check you copied all of it.');return}
 const n=Object.keys(next.games).length;confirmBox('Replace the saved games on this phone with the '+plural(n,'game')+' in this backup?',()=>{
  next.device=S.device;S=next;save();useGame(S.current);['#bk-text','#bk-restore','#setup-bk-text','#setup-bk-go'].forEach(q=>$(q).hidden=true);if(G())show('home');else startSetup();toast('Restored '+plural(n,'game'))},'Restore')}
$('#bk-restore').onclick=()=>restoreFrom($('#bk-text').value);
$('#setup-bk').onclick=()=>{$('#setup-bk-text').hidden=false;$('#setup-bk-go').hidden=false;$('#setup-bk-text').focus()};
$('#setup-bk-go').onclick=()=>restoreFrom($('#setup-bk-text').value);

// ============ a round ============
let game=null,raf=0;
function startRound(){if(startState())return;audio();const d=deal();if(!d.cards.length){toast('No cards in this deck');return}
 if(d.fresh)toast('You\'ve played every card in this deck. Shuffling them all back in.',3800);
 G().last=Date.now();save();
 const rid=uid();
 game={rid,cards:d.cards,i:0,res:Array(d.cards.length).fill('none'),secs:[],shownAt:0,hist:[],skips:CONFIG.skips,unl:!G().time,left:G().time*1000,dur:G().time*1000,used:0,end:0,running:false,counting:true,lastTick:null,warned:false,pausedByDialog:false,deck:G().deck,
  mid:matchOn()?G().match.id:null};
 hideSplash();show('play');renderCard();renderHud();wake(true);
 const cd=CONFIG.countdown*800;send('start',{rid,left:game.left+cd,dur:game.dur,unl:game.unl});S.liveRound={game:S.current,rid};save();
 const c=$('#count'),n=$('#count-n');let k=CONFIG.countdown;c.classList.add('on');
 const step=()=>{if(!game||game.rid!==rid||game.cancelled){c.classList.remove('on');return}
  if(k===0){c.classList.remove('on');game.counting=false;sfx.go();go();return}n.textContent=k;n.style.animation='none';void n.offsetWidth;n.style.animation='';sfx.tick();k--;setTimeout(step,800)};step()}
function cancelRound(msg){if(!game||!game.counting)return;game.cancelled=true;S.liveRound=null;save();wake(false);game=null;$('#count').classList.remove('on');show('home');toast(msg,3500)}
function go(){game.running=true;game.end=performance.now()+game.left;game.runFrom=performance.now();if(!game.shownAt)game.shownAt=performance.now();if(game.pausedAt){game.shownAt+=performance.now()-game.pausedAt;game.pausedAt=0}loop()}
function loop(){cancelAnimationFrame(raf);if(!game||!game.running)return;if(game.unl){$('#timer').textContent='No timer';return}
 game.left=game.end-performance.now();const s=Math.ceil(game.left/1000);
 if(game.left<=0){finish('time');return}
 if(s<=CONFIG.warnAt&&s!==game.lastTick){game.lastTick=s;sfx.tick();if(!game.warned){game.warned=true;vibrate(200)}}
 const t=$('#timer');t.textContent=fmt(game.left/1000);t.classList.toggle('low',s<=CONFIG.warnAt);raf=requestAnimationFrame(loop)}
function pause(byDialog){if(!game||!game.running)return;game.left=game.end-performance.now();game.used+=performance.now()-game.runFrom;game.running=false;game.pausedAt=performance.now();cancelAnimationFrame(raf);game.pausedByDialog=!!byDialog;send('pause',{rid:game.rid,left:game.left});
 if(!byDialog){$('#paused-t').textContent=game.unl?'':fmt(game.left/1000)+' left';$('#paused').classList.add('on')}}
function resume(){if(!game||game.running||screen!=='play')return;$('#paused').classList.remove('on');send('resume',{rid:game.rid,left:game.left});go()}
function fit(el,max,min){let s=max;el.style.fontSize=s+'px';const c=el.parentElement;while(s>min&&(el.scrollWidth>c.clientWidth-4||el.scrollHeight>c.clientHeight-4)){s-=2;el.style.fontSize=s+'px'}}
function renderCard(){const c=game.cards[game.i];if(!c)return;const w=$('#p-word');w.textContent=c[4];$('#p-list').innerHTML=c[5].map(t=>'<li>'+esc(t)+'</li>').join('');
 requestAnimationFrame(()=>{fit(w,44,20);$$('#p-list li').forEach(li=>{let s=26;li.style.fontSize=s+'px';while(s>14&&li.scrollWidth>li.clientWidth){s-=1;li.style.fontSize=s+'px'}})})}
function renderHud(){const n=game.cards.length;
 $('#meter').innerHTML=game.res.map((r,i)=>'<i class="'+({correct:'c',buzz:'x',skip:'s'}[r]||(i===game.i?'now':''))+'"></i>').join('');
 $('#p-info').textContent='Card '+Math.min(game.i+1,n)+' of '+n;
 $('#p-score').textContent=game.res.filter(r=>r==='correct').length;$('#skipn').textContent=game.skips;
 $('#b-skip').disabled=game.skips<=0;$('#b-undo').disabled=!game.hist.length;$('#timer').textContent=game.unl?'No timer':fmt(game.left/1000);$('#timer').classList.toggle('none',game.unl)}
function act(kind){if(!game||!game.running)return;const now=performance.now();game.hist.push({i:game.i,skips:game.skips,shownAt:game.shownAt});
 game.secs[game.i]=Math.round((now-game.shownAt)/100)/10;game.shownAt=now;game.res[game.i]=kind;markSeen(game.cards[game.i],true);saveSeen();
 if(kind==='correct')sfx.ok();else if(kind==='buzz'){sfx.buzz();vibrate([80,60,80])}else{game.skips--;sfx.skip()}
 game.i++;if(game.i>=game.cards.length){renderHud();finish('all');return}renderCard();renderHud()}
function undo(){if(!game||!game.hist.length)return;const h=game.hist.pop();game.i=h.i;game.skips=h.skips;game.res[h.i]='none';game.shownAt=h.shownAt;
 markSeen(game.cards[h.i],false);saveSeen();renderCard();renderHud()}
function finish(why){if(game.running)game.used+=performance.now()-game.runFrom;game.running=false;cancelAnimationFrame(raf);wake(false);$('#paused').classList.remove('on');sfx.end();vibrate(300);
 // the card on screen when time runs out or the round ends gets revealed, so it's retired too
 if(why!=='all'&&game.i<game.cards.length){game.res[game.i]=why==='time'?'time':'ended';markSeen(game.cards[game.i],true);saveSeen()}
 const n=k=>game.res.filter(r=>r===k).length,c=n('correct'),x=n('buzz'),sk=n('skip'),back=n('none');
 $('#sum-title').textContent=myName()+"'s round";$('#sum-why').textContent=why==='all'?'All '+game.cards.length+' done!':why==='time'?"Time's up":'Ended early';
 $('#t-c').textContent=c;$('#t-s').textContent=sk;$('#t-x').textContent=x;
 const used=Math.round(game.unl?game.used:game.dur-Math.max(0,game.left)),words=game.cards.map((card,i)=>[card[4],game.res[i],game.secs[i]||null]).filter(w=>w[1]!=='none');
 const mm=game.mid&&matchOn()&&G().match.id===game.mid?G().match:null,sc=mm?roundScore(game.cards,game.res,mm):{};
 const rec={who:'me',rid:game.rid,at:Date.now(),c,s:sk,x,n:words.length,dur:used,deck:game.deck,words};if(mm)Object.assign(rec,{m:mm.id,pts:sc.pts,st:sc.stl,net:sc.net,adj:0});
 sess().rounds.push(rec);S.liveRound=null;save();
 send('end',Object.assign({rid:game.rid,c,s:sk,x,cnt:words.length,dur:used,deck:game.deck,guessed:words.filter(w=>w[1]==='correct').map(w=>[w[0],w[2]])},mm?{mid:mm.id,pts:sc.pts,stl:sc.stl,net:sc.net}:{}));
 renderRoundPoints(mm?rec:null);matchCheck();
 const lab={correct:'✓ Correct',buzz:'✕ Buzzed',skip:'↷ Skipped',time:"Time's up",ended:'Ended'};
 $('#sum-list').innerHTML=game.cards.map((card,i)=>{const r=game.res[i];return r==='none'?'':'<li><span>'+esc(card[4])+'</span><span class="tag '+({time:'none',ended:'none'}[r]||r)+'">'+esc(lab[r])+'</span></li>'}).join('');
 $('#sum-back').textContent=back?plural(back,'card')+' you didn\'t reach went back into your deck.':'';
 show('sum')}
$('#start').onclick=startRound;
$('#b-ok').onclick=()=>act('correct');$('#b-buzz').onclick=()=>act('buzz');$('#b-skip').onclick=()=>{if(game&&game.skips>0)act('skip')};
$('#b-undo').onclick=undo;$('#b-pause').onclick=()=>pause(false);$('#resume').onclick=resume;
$('#b-end').onclick=()=>{pause(true);confirmBox('End this round now? The card on screen counts as played. Cards you haven\'t reached go back into your deck.',()=>finish('end'),'End round')};
$('#sum-done').onclick=()=>{const after=game&&game.endAfter;game=null;if(after)endGame(after.reason,after.n||partner(),after.next);else if(!checkFinal())show('home')};

// ============ navigation ============
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>{if(game&&game.running)pause(true);openModal(b.dataset.open)}));
$$('[data-close]').forEach(b=>b.addEventListener('click',closeModals));
$$('[data-back]').forEach(b=>b.addEventListener('click',()=>{const t=backTo;backTo='home';if(t==='setup'||!G())show('setup');else show(t)}));
$('#to-settings').onclick=()=>{backTo='home';show('set')};
$('#h-manual').onclick=()=>show('set');
$('#to-maker').onclick=()=>{backTo='setup';show('mk');drawMaker()};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&game&&game.running)wake(true)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModals()});

// ============ card maker ============
const MK_COLORS=['#D6246E','#2EC4B6','#5B5FE8','#179C7E','#56639A','#1B1A17'];let mkColor=MK_COLORS[0];
$('#mk-sw').innerHTML=MK_COLORS.map((c,i)=>'<button style="background:'+c+'" data-c="'+c+'" aria-label="Color '+(i+1)+'" aria-pressed="'+(i===0)+'"></button>').join('');
$('#mk-sw').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;mkColor=b.dataset.c;$$('#mk-sw button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawMaker()});
$$('#s-mk input').forEach(i=>i.addEventListener('input',drawMaker));
function fitCanvas(ctx,text,maxW,size,min,font){let s=size;do{ctx.font=font.replace('S',s);if(ctx.measureText(text).width<=maxW)break;s-=2}while(s>min);return s}
// the main word shrinks to fit, and wraps onto up to three lines
function wrapTitle(ctx,text,maxW,maxH){for(let s=150;s>=34;s-=4){ctx.font="400 "+s+"px 'Archivo Black', Archivo, sans-serif";const words=text.split(' ');let lines=[''];
  for(const w of words){const t=lines[lines.length-1]?lines[lines.length-1]+' '+w:w;if(ctx.measureText(t).width<=maxW)lines[lines.length-1]=t;else lines.push(w)}
  if(lines.length<=3&&lines.every(l=>ctx.measureText(l).width<=maxW)&&lines.length*s*1.05<=maxH)return{s,lines}}
 const s=fitCanvas(ctx,text,maxW,34,16,"400 Spx 'Archivo Black', Archivo, sans-serif");return{s,lines:[text]}}
function drawMaker(){const cv=$('#mk'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
 const vals=['#mk-w','#mk-1','#mk-2','#mk-3','#mk-4','#mk-5'].map(s=>$(s).value.trim()),from=$('#mk-from').value.trim();
 ctx.clearRect(0,0,W,H);ctx.fillStyle='#0D1226';ctx.fillRect(0,0,W,H);const x=70,y=70,w=W-140,h=H-140,r=60;
 ctx.save();ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}ctx.clip();
 ctx.fillStyle='#F4EFE6';ctx.fillRect(x,y,w,h);ctx.fillStyle=mkColor;ctx.fillRect(x,y,w,360);ctx.fillStyle='#F4EFE6';ctx.textAlign='center';ctx.textBaseline='middle';
 const t=wrapTitle(ctx,vals[0]||'Main word',w-100,300);ctx.font="400 "+t.s+"px 'Archivo Black', Archivo, sans-serif";t.lines.forEach((l,i)=>ctx.fillText(l,W/2,y+180+(i-(t.lines.length-1)/2)*t.s*1.05));
 const top=y+400,bottom=y+h-(from?190:110),step=(bottom-top)/5;
 for(let i=0;i<5;i++){const cy=top+step*(i+.5),txt=vals[i+1]||'Forbidden '+(i+1);ctx.fillStyle=vals[i+1]?'#1B1A17':'#B0A898';
  const s=fitCanvas(ctx,txt,w-120,84,40,"800 Spx Archivo, sans-serif");ctx.font="800 "+s+"px Archivo, sans-serif";ctx.fillText(txt,W/2,cy);
  if(i<4){ctx.fillStyle='#E6DECF';ctx.fillRect(x+90,top+step*(i+1)-2,w-180,4)}}
 if(from){ctx.fillStyle='#7B756B';const s=fitCanvas(ctx,'From: '+from,w-120,54,30,"600 Spx Archivo, sans-serif");ctx.font="600 "+s+"px Archivo, sans-serif";ctx.fillText('From: '+from,W/2,y+h-130)}
 ctx.fillStyle='#A9A293';ctx.font="600 34px Archivo, sans-serif";ctx.fillText("Megan's Party Line",W/2,y+h-58);ctx.restore();$('#mk-save').disabled=vals.some(v=>!v)}
let downloads=null;
try{if(window.claude&&window.claude.use)window.claude.use('downloads').then(d=>{downloads=d||null}).catch(()=>{})}catch(e){}
$('#mk-save').onclick=async()=>{const name='bite-your-tongue-'+($('#mk-w').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'card')+'.png';
 const blob=await new Promise(r=>$('#mk').toBlob(r,'image/png'));if(!blob){toast('Could not make the image. Take a screenshot instead.');return}
 if(downloads){try{await downloads.save({filename:name,data:blob});toast('Saved')}catch(e){toast(e&&e.code==='declined'?'Not saved':'Saving isn\'t available here. Take a screenshot instead.')}return}
 try{const f=new File([blob],name,{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:"Bite Your Tongue card"});return}}catch(e){if(e&&e.name==='AbortError')return}
 try{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);toast('Saved to downloads')}
 catch(e){toast('Saving isn\'t available here. Take a screenshot instead.')}};

// ============ partner sync: a free relay (ntfy.sh), keyed by the code word ============
// One send() and one table of handlers. Every message carries the sender's name, player, round length and game state,
// so a lost message heals itself at the next one (or the 90-second check-in).
// Games are matched by a shared game id (sid), never by clock times, so two phones' clocks can disagree.
const SYNC_URL=store.get('mt:syncUrl',null)||'https://ntfy.sh/';
const LIVE_WINDOW=store.get('mt:liveWindow',null)||CONFIG.liveWindow;   // tests shorten this
let es=null,syncTopic=null,heard={},beat=null,plive=null,spTimer=null,backoffUntil=0,pending=null,replaying=false,replayTimer=null,replayBuf={};
const topicFor=code=>'mtaboo-'+hash('megans-taboo|'+code).toString(36)+hash(code+'|mt|'+code.length).toString(36);
const other=p=>p==='1'?'2':'1';let assignTimer=null;
// a partner counts as connected if their phone checked in recently (check-ins come every 90 seconds while the app is open)
const peerNow=()=>{const now=Date.now(),g=G();return Object.entries(heard).filter(([d,h])=>now-h.seenAt<LIVE_WINDOW&&(!g||!g.partnerDevice||d===g.partnerDevice))};
const connected=()=>peerNow().length>0;
const theyPlayed=(g=G())=>sess(g).rounds.some(r=>r.who==='them');
const isSolo=(g=G())=>!connected()&&!theyPlayed(g);   // one rule for "playing alone", used everywhere
function syncStart(){if(!CONFIG.sync)return;const g=G(),t=g&&g.code?topicFor(g.code):null;if(t===syncTopic){send('hi');return}
 syncStop();syncTopic=t;if(!t){renderSync();return}
 // fetch only what we haven't seen: since the last message id, or the last 10 minutes
 // while catching up, keep only each phone's newest message: it carries that phone's whole game state
 const since=g.lastMsg||'10m';replaying=true;replayBuf={};clearTimeout(replayTimer);
 try{es=new EventSource(SYNC_URL+t+'/sse?since='+encodeURIComponent(since));
  es.onmessage=e=>{try{const o=JSON.parse(e.data);if(o.id){const gg=G();if(gg)gg.lastMsg=o.id}const m=JSON.parse(o.message);
   if(replaying){if(m&&m.d&&(!replayBuf[m.d]||replayBuf[m.d].at<m.at))replayBuf[m.d]=m;return}receive(m)}catch(_){}};
  es.onopen=()=>{clearTimeout(replayTimer);replayTimer=setTimeout(()=>{const buf=Object.values(replayBuf).sort((a,b)=>a.at-b.at),ended=new Set(buf.map(m=>m.st&&m.st.prev).filter(Boolean));
   // a phone still announcing a game that another phone has since ended is out of date: use only its name and settings
   buf.forEach(m=>{if(m.st&&ended.has(m.st.sid)&&m.type!=='over')m=Object.assign({},m,{st:{}});try{receive(m)}catch(_){}});replayBuf={};
   replaying=false;save();if(plive)paintSplash();queueRender()},1200);send('hi');renderSync()};
  es.onerror=()=>renderSync()}catch(e){es=null}
 clearInterval(beat);beat=setInterval(()=>{if(document.visibilityState==='visible')send('hi');renderSync();renderTurn()},CONFIG.syncBeat);renderSync()}
function syncStop(){if(es){es.close();es=null}syncTopic=null;heard={};plive=null;hideSplash();clearInterval(beat)}
const announce=()=>send('hi');
function myState(){const g=G(),se=sess(g),mine=se.rounds.filter(r=>r.who==='me'),last=mine.slice(-1)[0];
 return{sid:se.sid,prev:se.prev||null,n:se.rounds.length,rs:mine.map(r=>r.m?[r.rid,r.c,r.s,r.x,r.n,r.dur,r.deck,r.m,r.pts,r.st,r.net,r.adj||0]:[r.rid,r.c,r.s,r.x,r.n,r.dur,r.deck]),fin:se.final?se.final.target:null,
  live:game&&!game.cancelled&&(game.running||game.counting||game.pausedAt)?{rid:game.rid,left:game.unl?0:Math.max(0,game.running?game.end-performance.now():game.left),paused:!game.running&&!game.counting,unl:game.unl||undefined}:null,
  last:last?Object.assign({rid:last.rid,c:last.c,s:last.s,x:last.x,n:last.n,dur:last.dur,deck:last.deck,guessed:last.words.filter(w=>w[1]==='correct').map(w=>[w[0],w[2]])},
   last.m?{mid:last.m,pts:last.pts,stl:last.st,net:last.net,adj:last.adj||0}:{}):null,...matchState(g)}}
function send(type,data={}){const g=G();if(!CONFIG.sync||!syncTopic||!g)return;
 const body=JSON.stringify(Object.assign({v:3,ver:CONFIG.build,type,d:S.device,n:myName(g),p:g.player||null,tm:g.time,tt:g.timeT||0,gn:g.title||'',gt:g.titleT||0,at:Date.now(),st:myState()},data));
 if(Date.now()<backoffUntil&&type==='hi'){pending=body;return}post(body)}
function post(body,tries=0){fetch(SYNC_URL+syncTopic,{method:'POST',body}).then(r=>{
  if(r.status===429){backoffUntil=Date.now()+30000;if(tries<2)setTimeout(()=>post(body,tries+1),30000*(tries+1))}
  else if(pending&&Date.now()>=backoffUntil){const p=pending;pending=null;post(p)}}).catch(()=>{if(tries<2)setTimeout(()=>post(body,tries+1),5000*(tries+1))})}
// live messages count as just sent (so clocks don't matter); only replayed history uses the message's age
const age=m=>replaying?Math.max(0,Date.now()-m.at):0;
const fresh=(m,ms=CONFIG.syncHeardFor)=>age(m)<ms;
const sameGame=(g,m)=>m.st&&m.st.sid===sess(g).sid;
const roundKnown=(g,rid)=>sess(g).rounds.some(r=>r.rid===rid);
function addTheirRound(g,r){const se=sess(g);if(!r)return false;
 if(roundKnown(g,r.rid)){const k=se.rounds.find(x=>x.rid===r.rid);if(k.who==='them'&&r.adj!=null&&k.adj!==r.adj){k.adj=r.adj;save();return true}return false}
 const rec={who:'them',rid:r.rid,at:Date.now(),c:r.c,s:r.s,x:r.x,n:r.cnt??r.n,dur:r.dur,deck:r.deck,guessed:r.guessed||[]};
 if(r.mid)Object.assign(rec,{m:r.mid,pts:r.pts||0,st:r.stl||0,net:r.net||0,adj:r.adj||0});se.rounds.push(rec);save();return true}
// --- handlers: one per message type; each only acts on messages from the same game ---
const HANDLERS={
 hi:()=>{},
 start:(m,g)=>{if(!sameGame(g,m)||roundKnown(g,m.rid))return;
  if(game&&!game.cancelled){if(game.counting&&S.device>m.d)cancelRound(cap(m.n||partner())+' started first. Their round is on.');else return}
  livePartner(m.rid,m.left-age(m),false,m.dur,m.unl)},
 pause:(m)=>{if(plive&&plive.rid===m.rid){plive.paused=true;plive.left=m.left;paintSplash()}},
 resume:(m)=>{if(plive&&plive.rid===m.rid)livePartner(m.rid,m.left-age(m),false,plive.dur,plive.unl)},
 abort:(m)=>{if(plive&&plive.rid===m.rid){plive=null;hideSplash();if(!replaying)toast(cap(m.n||partner())+"'s round was interrupted. It's still their turn.")}},
 end:(m,g)=>{if(!sameGame(g,m))return;addTheirRound(g,m);if(plive&&plive.rid===m.rid){plive=null;hideSplash()}
  if(roundKnown(g,m.rid)&&!replaying&&!game)splashSummary(m);else checkFinal()},
 final:(m,g)=>{if(!sameGame(g,m))return;const se=sess(g);if(!se.final||se.final.target<m.target){se.final={target:m.target};save();if(!replaying)toast(cap(m.n||partner())+' started the final round.')}},
 over:(m,g)=>{if(!sameGame(g,m)||!sess(g).rounds.length){if(m.next&&!sess(g).rounds.length)sess(g).sid=m.next;return}
  if(game)game.endAfter=m;else endGame(m.reason,m.n||partner(),m.next)}};
function receive(m){const g=G();if(!g||!m||m.v!==3||m.d===S.device||typeof m.at!=='number')return;
 // once players are set, this game only listens to its partner's phone (strangers can pick the same code word)
 if(g.partnerDevice&&m.d!==g.partnerDevice)return;
 const prev=heard[m.d];heard[m.d]={name:clean(m.n),player:m.p==='1'||m.p==='2'?m.p:null,at:m.at,seenAt:replaying?Date.now()-age(m):Date.now(),ver:m.ver};
 if(prev&&prev.at>m.at&&m.type==='hi'){heard[m.d]=prev;return}
 let changed=false;const theirs=heard[m.d].player;
 // players are picked on first contact: a phone that already has a player keeps it; otherwise the lower phone id is Player 1
 if(!g.player&&Date.now()-heard[m.d].seenAt<LIVE_WINDOW){clearTimeout(assignTimer);assignTimer=setTimeout(()=>assign(m.d),200)}
 if(g.player&&!g.partnerDevice&&theirs&&theirs!==g.player){g.partnerDevice=m.d;changed=true}
 const nm=clean(m.n);if(nm&&nm!==g.partner&&m.at>(g.partnerT||0)){g.partner=nm;g.partnerT=m.at;changed=true}
 if((m.gt||0)>(g.titleT||0)){g.title=m.gn||null;g.titleT=m.gt;changed=true;if(!replaying&&m.gn)toast(cap(nm||partner())+' named this game "'+m.gn+'"');
  if(screen==='setup'&&!drafting&&document.activeElement!==$('#setup-gname'))$('#setup-gname').value=g.title||''}
 if(CONFIG.times.includes(m.tm)&&(m.tt||0)>(g.timeT||0)){const was=g.time;g.time=m.tm;g.timeT=m.tt;changed=true;
  if(was!==m.tm&&!replaying)toast(cap(nm||partner())+' set rounds to '+timeLabel(m.tm)+(game?'. It starts next round.':''))}
 // game state carried by every message: line up on one game id, then heal anything we missed
 const st=m.st||{},se=sess(g);
 if(st.sid&&st.sid!==se.sid){
  if(st.prev&&st.prev===se.sid&&se.rounds.length&&m.type!=='over'){endGame('over',nm||partner(),st.sid);return}   // they ended our game and we missed it
  // join their game, unless it's one we already finished
  if(!se.rounds.length&&!(g.ended||[]).includes(st.sid)&&(st.n>0||st.sid<se.sid)){se.sid=st.sid;changed=true}}
 if(sameGame(g,m)){
  if(st.last&&addTheirRound(g,st.last))changed=true;
  (st.rs||[]).forEach(r=>{if(addTheirRound(g,{rid:r[0],c:r[1],s:r[2],x:r[3],n:r[4],dur:r[5],deck:r[6],mid:r[7],pts:r[8],stl:r[9],net:r[10],adj:r[11]}))changed=true});
  healMatch(g,m);
  if(st.fin&&(!se.final||se.final.target<st.fin)){se.final={target:st.fin};changed=true}
  if(m.type==='hi'&&fresh(m,30000)){if(st.live&&!plive&&!roundKnown(g,st.live.rid))livePartner(st.live.rid,st.live.left-age(m),st.live.paused,null,st.live.unl);
   else if(!st.live&&plive){plive=null;hideSplash()}}}
 if(changed)save();
 (HANDLERS[m.type]||MATCH_HANDLERS[m.type]||(()=>{}))(m,g);matchCheck(g);if(!replaying)tryInvite(g);
 if(m.ver&&m.ver>CONFIG.build)showUpdate();
 queueRender()}
function assign(dev){const g=G(),h=heard[dev];if(!g||g.player||!h)return;
 g.player=h.player?other(h.player):(S.device<dev?'1':'2');g.partnerDevice=dev;seen=new Set(g.seen);save();send('hi');render();
 toast('You\'re Player '+g.player+'. '+cap(h.name||partner())+' is Player '+other(g.player)+'.')}
function showUpdate(){if($('#upd'))return;const b=document.createElement('button');b.id='upd';b.className='primary';b.textContent='Update available. Tap to reload';
 b.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));z-index:60;min-height:48px';b.onclick=()=>location.reload();document.body.appendChild(b)}

// ---------- the guesser's splash card ----------
function livePartner(rid,left,paused,dur,unl){if(left<=0&&!paused&&!unl)return;plive={rid,left,paused,unl:!!unl,dur:dur||plive&&plive.dur||null,at:performance.now()};if(!replaying)paintSplash()}
function liveLeft(){if(!plive)return 0;return plive.paused?plive.left:plive.left-(performance.now()-plive.at)}
function paintSplash(){const sp=$('#splash');if(!plive||screen==='play'){if(sp.dataset.mode==='live')hideSplash();return}
 sp.dataset.mode='live';$('#sp-name').textContent=cap(partner());$('#sp-line').textContent='is giving clues';$('#sp-sub').textContent=plive.paused?'Paused':'Just guess!';
 $('#sp-ok').hidden=true;$('#sp-timer').hidden=false;$('#sp-final').hidden=!!sess().final;sp.classList.add('on');clearInterval(spTimer);
 const tick=()=>{if(!plive){hideSplash();return}
  // no timer: the round ends when their phone says so (or stops checking in)
  $('#sp-timer').classList.toggle('none',plive.unl);if(plive.unl){$('#sp-timer').textContent='No timer';if(!connected()){plive=null;hideSplash();queueRender()}return}
  const l=liveLeft();if(l<=-4000){plive=null;hideSplash();queueRender();return}$('#sp-timer').textContent=fmt(Math.min(l,plive.dur||l)/1000)};tick();spTimer=setInterval(tick,250);queueRender()}
function splashSummary(m){clearInterval(spTimer);const sp=$('#splash');sp.dataset.mode='sum';
 $('#sp-name').textContent=cap(m.n||partner())+"'s round";const mt=G().match,pl=m.mid&&mt&&mt.id===m.mid?(mt.type==='team'?'<br><span class="note">Team cards: '+num(m.net)+'</span>':'<br><span class="note">'+esc(cap(m.n||partner()))+' '+(m.pts>=0?'+':'')+num(m.pts)+(m.stl?' · you stole '+num(m.stl):'')+'</span>'):'';
 $('#sp-line').innerHTML='<span class="sp-counts">'+esc(m.c+' guessed · '+m.s+' skipped · '+m.x+' buzzed')+'</span>'+pl;
 const done=finalDone();$('#sp-timer').hidden=true;$('#sp-final').hidden=true;$('#sp-sub').textContent=done?'That was the last round.':turnText();
 $('#sp-ok').textContent=done?'See the credits':'Got it';$('#sp-ok').hidden=false;sp.classList.add('on');queueRender()}
function hideSplash(){clearInterval(spTimer);const sp=$('#splash');sp.classList.remove('on');sp.dataset.mode=''}
$('#sp-ok').onclick=()=>{hideSplash();if(!checkFinal())render()};

// ---------- whose turn, final round ----------
function counts(g=G()){const se=sess(g);return{mine:se.rounds.filter(r=>r.who==='me').length,theirs:se.rounds.filter(r=>r.who==='them').length+(plive?1:0)}}
function finalLeft(g=G()){const se=sess(g);if(!se.final)return null;const c=counts(g);return{mine:Math.max(0,se.final.target-c.mine),theirs:isSolo(g)?0:Math.max(0,se.final.target-c.theirs)}}
const finalLeftMine=()=>{const f=finalLeft();return f?f.mine:null};
// one place decides what "whose turn" says, so the home screen, splash and summary always agree
function turnText(g=G()){const se=sess(g),last=se.rounds[se.rounds.length-1],P=cap(partner()),f=finalLeft(g);
 if(plive)return P+' is giving clues now.';
 if(f){if(!f.mine&&f.theirs)return P+"'s final "+(f.theirs>1?'rounds are':'round is')+' next.';if(f.mine&&!f.theirs)return'Your final '+(f.mine>1?'rounds are':'round is')+' next.'}
 return!last?'Either of you can start.':last.who==='me'&&!isSolo(g)?P+"'s turn to give clues.":'Your turn to give clues.'}
function startState(){const g=G();if(!loaded)return'Loading cards…';if(!g||!g.player)return'Waiting for '+partner()+"'s phone…";
 if(plive)return cap(partner())+' is giving clues…';if(finalLeftMine()===0)return'Waiting for '+partner()+"'s final round…";return''}
function renderTurn(){const g=G(),t=$('#h-turn'),f=$('#h-final');if(!g||!t)return;const se=sess(g);
 const show=connected()||theyPlayed(g);t.hidden=!show;if(show)t.textContent=turnText(g);
 const fl=finalLeft(g);if(fl){f.hidden=false;f.textContent='Final round: '+(isSolo(g)?'':cap(partner())+' has '+plural(fl.theirs,'round')+' left, ')+'you have '+plural(fl.mine,'round')+' left.'}else f.hidden=true;
 $$('#final-btn,#sum-final').forEach(b=>b.hidden=!!se.final||!se.rounds.length||matchOn(g));
 const sn=$('#sum-next');if(sn&&screen==='sum')sn.textContent=fl&&!fl.mine?'That was your final round.':turnText(g)}
$$('[data-final]').forEach(b=>b.onclick=()=>confirmBox('Start the final round? You\'ll both finish with the same number of rounds, then the credits roll.',()=>{
 const se=sess(),c=counts();se.final={target:(isSolo()?c.mine:Math.max(c.mine,c.theirs))+1};save();send('final',{target:se.final.target});
 $('#sp-final').hidden=true;if(screen==='sum'){game=null;show('home')}else render()},'Final round'));
function finalDone(g=G()){const f=finalLeft(g);return!!f&&!f.mine&&!f.theirs&&!plive}
function checkFinal(){if(game&&(game.running||game.counting))return false;if(!finalDone())return false;game=null;endGame('final',null);return true}

// ---------- the end of a game: credits ----------
// Each line is a template that only shows when it has something to say; add a highlight by adding a line.
const CREDITS=[
 (k)=>['big','Thanks for playing!'],
 (k)=>['Starring',k.me+' & '+k.them],
 (k)=>['Rounds played',k.me+' '+k.mineR.length+' · '+k.them+' '+k.theirR.length],
 (k)=>k.cards?['Cards played',String(k.cards)]:null,
 (k)=>k.guessed?['Cards guessed',String(k.guessed)]:null,
 (k)=>k.fast?['Fastest guess',k.fast[0]+' in '+k.fast[1]+' seconds']:null,
 (k)=>k.tough?['Toughest card',k.tough+' (skipped)']:null,
 (k)=>k.perfect?['Perfect rounds',k.perfect]:null,
 (k)=>k.buzz?['Buzzes',k.me+' '+k.buzzMine+' · '+k.them+' '+k.buzzTheirs]:null,
 (k)=>k.decks?['Decks',k.decks]:null,
 (k)=>k.match?['Match',k.match]:null,
 (k)=>k.gave.length?['list','You gave clues for',k.gave.join(' · ')]:null,
 (k)=>k.heardW.length?['list','You guessed',k.heardW.join(' · ')]:null,
 (k)=>['big','See you next game']];
function creditFacts(se){const mineR=se.rounds.filter(r=>r.who==='me'),theirR=se.rounds.filter(r=>r.who==='them');
 const sum=(rs,f)=>rs.reduce((a,r)=>a+(r[f]||0),0),allWords=mineR.flatMap(r=>r.words||[]),heardWords=theirR.flatMap(r=>r.guessed||[]);
 const timed=allWords.filter(w=>w[1]==='correct'&&w[2]).map(w=>[w[0],w[2]]).concat(heardWords.filter(w=>w[1]).map(w=>[w[0],w[1]])).sort((a,b)=>a[1]-b[1]);
 const perfectMine=mineR.filter(r=>r.n&&r.c===r.n).length,perfectTheirs=theirR.filter(r=>r.n&&r.c===r.n).length,decks=[...new Set(se.rounds.map(r=>r.deck).filter(Boolean))].map(deckName);
 return{me:myName(),them:cap(partner()),mineR,theirR,cards:sum(mineR,'n')+sum(theirR,'n'),guessed:sum(mineR,'c')+sum(theirR,'c'),fast:timed[0]||null,
  tough:(allWords.find(w=>w[1]==='skip')||[])[0]||null,perfect:perfectMine+perfectTheirs?myName()+' '+perfectMine+' · '+cap(partner())+' '+perfectTheirs:'',
  buzz:sum(mineR,'x')+sum(theirR,'x'),buzzMine:sum(mineR,'x'),buzzTheirs:sum(theirR,'x'),decks:decks.join(', '),
  gave:allWords.map(w=>w[0]),heardW:heardWords.map(w=>w[0])}}
function endGame(reason,byName,nextSid){const g=G();if(!g)return;const se=sess(g);hideSplash();plive=null;
 if(matchOn(g)){const t=tally(g);if(g.match.type!=='team'&&t.a!==t.b){const lead=t.a>t.b?t.mine:t.theirs;g.match.drop=(g.match.drop||[]).concat(lead[lead.length-1].rid)}g.match.early=true;finalizeMatch(g)}
 const mres=g.match&&g.match.result;if(g.match&&g.match.status==='done')g.match=null;
 const next=newSession(nextSid);next.prev=se.sid;
 if(!se.rounds.length){g.ended=[se.sid].concat(g.ended||[]).slice(0,10);g.session=next;save();render();return}
 const k=creditFacts(se);k.match=mres?(mres.t==='team'?(mres.sp!=null?'Team: '+num(mres.sp)+' seconds a card':''):mres.r==='t'?'Tied '+num(mres.mp)+'–'+num(mres.tp):(mres.r==='w'?mres.me:mres.them)+' won '+num(Math.max(mres.mp,mres.tp))+'–'+num(Math.min(mres.mp,mres.tp))):'';const lines=CREDITS.map(f=>f(k)).filter(Boolean);
 $('#cr-why').textContent=reason==='deck'&&byName?cap(byName)+' switched decks. Here\'s your game summary.':reason==='deck'?'You switched decks, so this game is over.':reason==='over'&&byName?cap(byName)+' ended the game.':'';
 $('#cr-in').innerHTML=lines.map(l=>l[0]==='big'?'<p class="big">'+esc(l[1])+'</p>':l[0]==='list'?'<h3>'+esc(l[1])+'</h3><p class="list">'+esc(l[2])+'</p>':'<h3>'+esc(l[0])+'</h3><p>'+esc(l[1])+'</p>').join('');
 $('#cr-in').style.setProperty('--dur',Math.max(18,lines.length*CONFIG.creditSecondsPerLine+(k.gave.length+k.heardW.length)*.25)+'s');
 $('#cr-roll').classList.remove('static');$('#cr-in').style.animation='none';void $('#cr-in').offsetWidth;$('#cr-in').style.animation='';
 const endedSid=se.sid;g.ended=[endedSid].concat(g.ended||[]).slice(0,10);g.session=next;save();
 // tell the partner which game ended (sid) and which game comes next, so both phones move on together
 if(!byName)send('over',{reason,st:Object.assign(myState(),{sid:endedSid}),next:next.sid});game=null;show('credits')}
$('#cr-skip').onclick=()=>$('#cr-roll').classList.add('static');
let afterCredits=null;
$('#cr-done').onclick=()=>{show('home');const f=afterCredits;afterCredits=null;if(f)f()};

function renderSync(){const el=$('#h-sync');if(!el)return;const g=G();el.hidden=!CONFIG.sync||!g;if(el.hidden)return;
 if(!g.code){el.textContent='Add a code word in Settings to sync with '+partner()+'.';el.className='sync';return}
 const peers=peerNow().map(([,h])=>h),clash=g.player&&peers.find(h=>h.player===g.player);
 if(clash){el.textContent='⚠ You and '+(clash.name||partner())+' are both Player '+g.player+'. One of you should switch in Settings.';el.className='sync warn'}
 else if(peers.length){el.textContent='● Synced with '+(peers[0].name||partner());el.className='sync on'}
 else{el.textContent=es&&es.readyState===1?'Waiting for '+partner()+"'s phone…":es&&es.readyState===2?"Can't reach "+partner()+"'s phone. Playing solo.":'Connecting…';el.className='sync'}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&CONFIG.sync){if(!es||es.readyState===2){syncTopic=null;syncStart()}else send('hi');queueRender()}});

// ============ keep score: matches, points, Bragging Rights ============
// Numbers live here; deck weights live in cards/decks.json ("weight").
const SCORE={target:20,roundsEach:5,perfectBonus:1,buzz:-1,maxAdjust:1,historyKeep:300,
 defaults:{type:'team',win:'target',pen:'-1',val:'weighted'}};
let mdraft=null,inviteIn=null,lastIds=0;
const matchOn=(g=G())=>!!(g&&g.match&&g.match.status==='on');
const rnd2=x=>Math.round(x*100)/100;
const num=x=>String(rnd2(x)).replace('-','−');
const weight=id=>{const d=DECKS.find(x=>x.id===id);return d&&d.weight!=null?d.weight:1};
const half=w=>({0.5:'½',1.5:'1½'}[w]||String(w));
const cardValue=(c,m)=>m.val==='equal'?1:weight(c[1]);
// one round's points, worked out by the clue-giver's phone. Head-to-head: correct cards by value, −1 a buzz, the skip setting,
// +1 for all 10; each buzz gives the guesser that card's value. Team: net cards (a buzz costs one card, skips use the setting).
function roundScore(cards,res,m){let pts=0,steal=0,net=0;const pen=Number(m.pen);
 cards.forEach((c,i)=>{const r=res[i],v=cardValue(c,m);
  if(r==='correct'){pts+=v;net+=v}else if(r==='buzz'){pts+=SCORE.buzz;steal+=v;net-=1}else if(r==='skip'){pts+=pen;net+=pen}});
 if(res.filter(r=>r==='correct').length===CONFIG.perRound)pts+=SCORE.perfectBonus;
 return{pts:rnd2(pts),stl:rnd2(steal),net:rnd2(net)}}
function tally(g=G()){const m=g.match,drop=m.drop||[],rs=sess(g).rounds.filter(r=>r.m===m.id&&!drop.includes(r.rid));
 const mine=rs.filter(r=>r.who==='me'),theirs=rs.filter(r=>r.who==='them'),sum=(a,f)=>a.reduce((x,r)=>x+f(r),0),P=r=>(r.pts||0)+(r.adj||0);
 return{mine,theirs,a:mine.length,b:theirs.length,my:rnd2(sum(mine,P)+sum(theirs,r=>r.st||0)),their:rnd2(sum(theirs,P)+sum(mine,r=>r.st||0)),
  net:rnd2(sum(rs,r=>(r.net||0)+(r.adj||0))),secs:sum(rs,r=>r.dur||0)/1000}}
const matchLabel=m=>(m.type==='team'?'Team':'Head-to-head')+' · '+(m.win==='rounds'?SCORE.roundsEach+' rounds each':m.type==='team'?SCORE.target+' cards':'First to '+SCORE.target);
const matchDetail=m=>'Skips '+num(Number(m.pen))+' · '+(m.val==='equal'?'Every card worth 1':'Weighted cards');
// both phones see the same rounds, so both reach the same result on their own
function matchCheck(g=G()){const m=g&&g.match;if(!m||m.status!=='on')return;const t=tally(g);let done=false;
 if(m.stopAt!=null)done=t.a>=m.stopAt&&t.b>=m.stopAt;
 else if(m.type==='team')done=m.win==='target'?t.net>=SCORE.target:t.a>=SCORE.roundsEach&&t.b>=SCORE.roundsEach;
 else if(t.a===t.b&&t.a>0&&(m.win==='target'?Math.max(t.my,t.their)>=SCORE.target:t.a>=SCORE.roundsEach)){
  if(t.my===t.their&&!m.tb){m.tb=true;m.stopAt=t.a+1;save();if(!replaying)toast("It's a tie! One more round each.",3500);return}   // a tie gets one more round each, then stays a tie
  done=true}
 if(done)finalizeMatch(g)}
// a record belongs to the saved game: the two phones plus the code word (locked once they connect), so renaming yourself keeps it.
// Older records used the play-as names; those still count toward the game they were played in.
const pairKey=(g=G())=>'g'+hash(normCode(g.code||'')+'|'+[S.device,g.partnerDevice||'?'].sort().join('|')).toString(36);
const legacyKey=(g=G())=>[S.device+':'+myName(g).toLowerCase(),(g.partnerDevice||'?')+':'+String(g.partner||'').toLowerCase()].sort().join('|');
function finalizeMatch(g){const m=g.match,t=tally(g);m.status='done';
 const perfect=a=>a.filter(r=>r.c===CONFIG.perRound).length,sum=(a,f)=>a.reduce((x,r)=>x+(r[f]||0),0);
 const e={id:m.id,k:pairKey(g),t:m.type,w:m.win,at:Date.now(),me:myName(g),them:cap(partner()),r:m.type==='team'?'t':t.my>t.their?'w':t.my<t.their?'l':'t',
  mp:t.my,tp:t.their,mr:t.a,tr:t.b,mpf:perfect(t.mine),tpf:perfect(t.theirs),mx:sum(t.mine,'x'),tx:sum(t.theirs,'x'),mc:sum(t.mine,'c'),tc:sum(t.theirs,'c'),
  d:[...new Set(t.mine.concat(t.theirs).map(r=>r.deck).filter(Boolean))],nc:t.net,sp:t.net>0?rnd2(t.secs/t.net):null,early:!!m.early};
 m.result=e;addHist(e);save()}
function addHist(e){if(S.hist.some(x=>x.id===e.id))return false;S.hist.push(e);S.hist.sort((a,b)=>a.at-b.at);if(S.hist.length>SCORE.historyKeep)S.hist.shift();return true}
const FLIP=[['me','them'],['mp','tp'],['mr','tr'],['mpf','tpf'],['mx','tx'],['mc','tc']];
function flip(e){const o=Object.assign({},e);FLIP.forEach(([a,b])=>{o[a]=e[b];o[b]=e[a]});o.r={w:'l',l:'w'}[e.r]||e.r;return o}
const keysFor=k=>[k].concat(S.merge[k]||[]);
const record=(g=G())=>{const ks=keysFor(pairKey(g)).concat(legacyKey(g));return S.hist.filter(e=>ks.includes(e.k))};

// --- home: the score strip, Keep score and End match ---
function renderMatchHome(){const g=G(),box=$('#h-match'),m=g.match,on=matchOn(g),wait=!!(m&&m.status==='invite'&&m.host===S.device);
 box.hidden=!on;$('#h-hero').hidden=on;$('#h-mend').hidden=!on;
 $('#h-mwait').hidden=!(wait||g.wantMatch);$('#h-mwait-t').textContent=wait?'Keep score: waiting for '+partner()+' to join…':'Keep score starts when '+partner()+"'s phone connects.";
 if(on){const t=tally(g);box.classList.toggle('team',m.type==='team');
  box.innerHTML=m.type==='team'
   ?'<div><small>Team cards</small><b>'+num(t.net)+(m.win==='target'?' of '+SCORE.target:'')+'</b></div><div><small>'+(m.win==='rounds'?'Rounds: '+Math.min(t.a,t.b)+' of '+SCORE.roundsEach:'Seconds a card')+'</small><b>'+(t.net>0?num(rnd2(t.secs/t.net)):'—')+'</b></div>'
   :'<div><small>'+esc(myName(g))+'</small><b>'+num(t.my)+'</b></div><div class="mid">'+esc(m.stopAt!=null?'Last round'+(m.tb?' (tiebreak)':''):m.win==='rounds'?SCORE.roundsEach+' rounds each':'First to '+SCORE.target)+'</div><div><small>'+esc(cap(partner()))+'</small><b>'+num(t.their)+'</b></div>'}
 if(m&&m.status==='done'&&!game&&!plive&&!$('#splash').classList.contains('on'))setTimeout(()=>{if(screen==='home'&&G()&&G().match&&G().match.status==='done')showResult(G())},0)}
// invites show on Home or the game screen, never during a round
function maybeInvite(){if(inviteIn&&!game&&!plive&&(screen==='home'||screen==='setup')&&!$('#m-invite').classList.contains('on'))showInvite()}
// Let's play with Keep score: invite as soon as the partner's phone is connected
let verWarned=0;
function tryInvite(g=G()){if(!g||!g.wantMatch||g.match||!g.time||!g.partnerDevice)return;const peer=peerNow()[0];if(!peer)return;
 if(peer[1].ver&&peer[1].ver!==CONFIG.build){if(Date.now()-verWarned>60000){verWarned=Date.now();toast('Your phones are on different versions. Close and reopen the app on both phones to keep score.',5000)}return}
 const c=Object.assign({},SCORE.defaults,g.scoreCfg);g.wantMatch=false;g.match={id:uid(),type:c.type,win:c.win,pen:c.pen,val:c.val,host:S.device,status:'invite',at:Date.now()};
 save();send('invite',{m:cfgOf(g.match)});queueRender()}
$('#h-mcancel').onclick=()=>{const g=G(),m=g.match;if(m&&m.status==='invite'&&m.host===S.device){send('mcancel',{mid:m.id});g.match=null}g.wantMatch=false;g.mode='fun';save();render();toast('Playing just for fun')};
const cfgOf=m=>({id:m.id,type:m.type,win:m.win,pen:m.pen,val:m.val,host:m.host});
function showInvite(){const iv=inviteIn;if(!iv)return;$('#iv-h').textContent=cap(iv.from)+' wants to keep score';
 $('#iv-p').textContent=matchLabel(iv.m)+'. '+matchDetail(iv.m)+'.';openModal('invite')}
function acceptInvite(iv){const g=G();if(!iv||!g)return;g.match=Object.assign(cfgOf(iv.m),{status:'on',at:Date.now()});g.mode='score';g.wantMatch=false;g.scoreCfg=cfgOf(iv.m);
 if(screen==='setup'&&!drafting)mdraft=cfgOf(iv.m);save();send('join',{mid:iv.m.id});toast('Match on! Good luck.');render()}
$('#iv-yes').onclick=()=>{const iv=inviteIn;inviteIn=null;$('#m-invite').classList.remove('on');acceptInvite(iv)};
$('#iv-no').onclick=()=>{const iv=inviteIn;inviteIn=null;$('#m-invite').classList.remove('on');if(iv)send('decline',{mid:iv.m.id})};

// --- ending a match early ---
$('#h-mend').onclick=()=>{const g=G(),t=tally(g),m=g.match,even=t.a===t.b||m.type==='team';
 $('#me-p').textContent=even?'The match ends now and goes into Bragging Rights.':(t.a>t.b?'You have':cap(partner())+' has')+' played one more round than '+(t.a>t.b?partner():'you')+'.';
 $('#me-more').hidden=even;$('#me-drop').hidden=even;$('#me-now').hidden=!even;
 $('#me-more').textContent=t.a>t.b?cap(partner())+' plays one more round':'You play one more round';openModal('mend')};
function applyEnd(g,how,stopAt,drop){const m=g&&g.match;if(!m||m.status!=='on')return;m.early=true;
 if(how==='more'){m.stopAt=stopAt;save();matchCheck(g);return}
 if(how==='drop'&&drop)m.drop=(m.drop||[]).concat(drop);finalizeMatch(g)}
function endMatch(how){const g=G(),t=tally(g),m=g.match;$('#m-mend').classList.remove('on');
 const lead=t.a>t.b?t.mine:t.theirs,drop=how==='drop'?lead[lead.length-1].rid:null,stopAt=Math.max(t.a,t.b);
 send('mend',{mid:m.id,how,stopAt,drop});applyEnd(g,how,stopAt,drop);if(how==='more')toast('One more round, then the match ends.');render()}
$('#me-more').onclick=()=>endMatch('more');$('#me-drop').onclick=()=>endMatch('drop');$('#me-now').onclick=()=>endMatch('now');

// --- the result screen ---
function showResult(g){const e=g.match.result;if(!e){g.match=null;save();return}
 $('#mr-why').textContent=e.early?'Match ended early.':matchLabel(g.match);
 if(e.t==='team'){$('#mr-h').textContent='Nice teamwork!';
  $('#mr-tot').innerHTML='<div class="big"><b>'+(e.sp!=null?num(e.sp):'—')+'</b><small>seconds a card</small></div><div><b>'+num(e.nc)+'</b><small>team cards</small></div>'}
 else{$('#mr-h').textContent=e.r==='t'?"It's a tie!":(e.r==='w'?e.me:e.them)+' wins!';
  $('#mr-tot').innerHTML='<div'+(e.r==='w'?' class="big"':'')+'><b>'+num(e.mp)+'</b><small>'+esc(e.me)+'</small></div><div'+(e.r==='l'?' class="big"':'')+'><b>'+num(e.tp)+'</b><small>'+esc(e.them)+'</small></div>'}
 const li=(a,b)=>'<li><span>'+esc(a)+'</span><span>'+esc(b)+'</span></li>';
 $('#mr-list').innerHTML=li('Rounds',e.me+' '+e.mr+' · '+e.them+' '+e.tr)+li('Perfect rounds',e.me+' '+e.mpf+' · '+e.them+' '+e.tpf)+li('Buzzes',e.me+' '+e.mx+' · '+e.them+' '+e.tx);
 show('mres')}
$('#mr-done').onclick=()=>{const g=G();if(g){g.match=null;save()}show('home')};
$('#mr-brag').onclick=()=>{const g=G();if(g){g.match=null;save()}backTo='home';show('brag')};
$('#to-brag').onclick=()=>{backTo='setup';show('brag')};

// --- the round summary: points for this round, adjustable by the clue-giver ---
function renderRoundPoints(r){const box=$('#sum-pts'),g=G(),m=g.match;box.hidden=!r||!r.m||!m||m.id!==r.m||m.status==='invite';if(box.hidden)return;
 const v=(r.pts||0)+(r.adj||0),n=(r.net||0)+(r.adj||0);
 $('#sum-pts-t').textContent=(m.type==='team'?'Team cards: '+num(n):'This round: '+(v>=0?'+':'')+num(v)+' points')+(r.adj?' (adjusted)':'');
 $('#adj-down').disabled=(r.adj||0)<=-SCORE.maxAdjust||m.status!=='on';$('#adj-up').disabled=(r.adj||0)>=SCORE.maxAdjust||m.status!=='on'}
function adjust(d){const g=G(),r=sess(g).rounds.filter(x=>x.who==='me').slice(-1)[0];if(!r||!matchOn(g))return;
 r.adj=Math.max(-SCORE.maxAdjust,Math.min(SCORE.maxAdjust,(r.adj||0)+d));save();send('adj',{rid:r.rid,adj:r.adj});renderRoundPoints(r);matchCheck(g)}
$('#adj-down').onclick=()=>adjust(-1);$('#adj-up').onclick=()=>adjust(1);

// --- Bragging Rights ---
function streaks(es){let best=0,cur=0,now=0;es.forEach(e=>{cur=e.r==='w'?cur+1:0;best=Math.max(best,cur)});
 for(let i=es.length-1;i>=0&&es[i].r==='w';i--)now++;return{best,now}}
function renderBrag(){const g=G(),body=$('#br-body');if(!g){body.innerHTML='';return}
 const es=record(g),h=es.filter(e=>e.t==='h2h'),tm=es.filter(e=>e.t==='team'&&e.sp!=null),me=myName(g),them=cap(partner());
 $('#br-who').textContent=me+' & '+them;
 const box=(label,val,wide)=>'<div'+(wide?' class="wide"':'')+'><small>'+esc(label)+'</small><b>'+esc(val)+'</b></div>',sum=(a,f)=>a.reduce((x,e)=>x+(e[f]||0),0);
 let out='';
 if(!es.length)out='<p class="sub">No matches yet. Tap Keep score on the home screen to start one.</p>';
 if(h.length){const w=h.filter(e=>e.r==='w').length,l=h.filter(e=>e.r==='l').length,t=h.filter(e=>e.r==='t').length,st=streaks(h);
  const decks={};es.forEach(e=>(e.d||[]).forEach(d=>decks[d]=(decks[d]||0)+1));const fav=Object.entries(decks).sort((a,b)=>b[1]-a[1])[0];
  const avg=(p,r)=>r?num(rnd2(p/r)):'—';
  out+='<p class="brh">Head-to-head</p><div class="stats">'+box(me+' – '+them+(t?' – ties':''),w+' – '+l+(t?' – '+t:''),true)+
   box('Win streak now',String(st.now))+box('Longest win streak',String(st.best))+
   box('Points a round',me+' '+avg(sum(h,'mp'),sum(h,'mr'))+' · '+them+' '+avg(sum(h,'tp'),sum(h,'tr')),true)+
   box('Perfect rounds',me+' '+sum(es,'mpf')+' · '+them+' '+sum(es,'tpf'),true)+box('Buzzes',me+' '+sum(es,'mx')+' · '+them+' '+sum(es,'tx'),true)+
   (fav?box('Favorite deck',deckName(fav[0]),true):'')+'</div>'}
 if(tm.length){const best=Math.min(...tm.map(e=>e.sp)),avg=sum(tm,'sp')/tm.length;
  out+='<p class="brh">Team</p><div class="stats">'+box('Best speed',num(best)+' s a card')+box('Average speed',num(rnd2(avg))+' s a card')+box('Team matches',String(tm.length),true)+'</div>'}
 if(es.length){const fmtD=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  out+='<p class="brh">Recent matches</p><ul class="hist">'+es.slice(-10).reverse().map(e=>'<li><span>'+esc(fmtD(e.at))+' <small>'+(e.t==='team'?'Team':'Head-to-head')+(e.early?' · ended early':'')+'</small></span><span>'+
   esc(e.t==='team'?(e.sp!=null?num(e.sp)+' s a card':'—'):({w:'Won ',l:'Lost ',t:'Tied '}[e.r])+num(e.mp)+'–'+num(e.tp))+'</span></li>').join('')+'</ul>'}
 body.innerHTML=out;
 const k=pairKey(g),others=otherRecords(k);$('#br-merge').hidden=!others.length;
 $('#br-merged').innerHTML=(S.merge[k]||[]).map(o=>'<div class="merged"><span class="note">Includes '+esc(recName(o))+'</span><button class="ghost" data-unmerge="'+esc(o)+'">Undo</button></div>').join('')}
const recName=k=>{const e=S.hist.filter(x=>x.k===k).slice(-1)[0];return e?e.me+' & '+e.them+' ('+plural(S.hist.filter(x=>x.k===k).length,'match')+')':'an old record'};
const otherRecords=k=>{const mine=keysFor(k).concat(legacyKey()),merged=new Set(Object.values(S.merge).flat());return[...new Set(S.hist.map(e=>e.k))].filter(x=>!mine.includes(x)&&!merged.has(x)&&!S.merge[x])};
$('#br-merge').onclick=()=>{const k=pairKey();$('#mg-list').innerHTML=otherRecords(k).map(o=>'<li><button class="pick" data-merge="'+esc(o)+'"><span>'+esc(recName(o))+'</span></button></li>').join('');openModal('merge')};
$('#mg-list').addEventListener('click',e=>{const b=e.target.closest('[data-merge]');if(!b)return;const k=pairKey();S.merge[k]=(S.merge[k]||[]).concat(b.dataset.merge);save();closeModals();render();toast('Records merged')});
$('#br-merged').addEventListener('click',e=>{const b=e.target.closest('[data-unmerge]');if(!b)return;const k=pairKey();S.merge[k]=(S.merge[k]||[]).filter(x=>x!==b.dataset.unmerge);if(!S.merge[k].length)delete S.merge[k];save();render();toast('Merge undone')});

// --- match messages (added to the sync handler table below) ---
const MATCH_HANDLERS={
 invite:(m,g)=>{if(!sameGame(g,m)||!m.m||matchOn(g))return;const mine=g.match&&g.match.status==='invite'?g.match:null;
  if(mine&&mine.id!==m.m.id){if(S.device<m.d)return;g.match=null;save()}   // both invited at once: the lower phone id's invite wins
  if(replaying&&!fresh(m,5*60*1000))return;const iv={m:m.m,from:m.n||partner()};
  if(mine||g.wantMatch){acceptInvite(iv);return}   // this phone wanted a match too: join theirs
  inviteIn=iv;queueRender()},
 join:(m,g)=>{const x=g.match;if(x&&x.id===m.mid&&x.status==='invite')joined(g,m.n)},
 decline:(m,g)=>{const x=g.match;if(x&&x.id===m.mid&&x.status==='invite'){g.match=null;g.mode='fun';save();if(!replaying)toast(cap(m.n||partner())+' said not now. Playing just for fun.',3500)}},
 mcancel:(m)=>{if(inviteIn&&inviteIn.m.id===m.mid){inviteIn=null;$('#m-invite').classList.remove('on')}},
 mend:(m,g)=>{if(g.match&&g.match.id===m.mid){applyEnd(g,m.how,m.stopAt,m.drop);if(!replaying&&m.how==='more')toast(cap(m.n||partner())+' is ending the match after one more round.')}},
 adj:(m,g)=>{const r=sess(g).rounds.find(x=>x.who==='them'&&x.rid===m.rid);if(r){r.adj=m.adj;save()}},
 hids:(m,g)=>{if(!g.partnerDevice||m.k!==pairKey(g))return;const have=new Set(m.ids||[]),mine=S.hist.filter(e=>e.k===m.k),miss=mine.filter(e=>!have.has(e.id)).slice(-8);
  if(miss.length)send('hist',{h:miss});
  // they have matches this phone doesn't: send our list so they can fill us in
  const ids=new Set(mine.map(e=>e.id));if([...have].some(i=>!ids.has(i)))sendIds(g,true)},
 hist:(m,g)=>{let n=0;(m.h||[]).forEach(e=>{if(e&&e.id&&e.k===pairKey(g)&&addHist(flip(e)))n++});if(n)save()}};
// the match part of every check-in, so a missed join or End match heals at the next message
function matchState(g){const m=g.match;return{mt:m?{id:m.id,s:m.status,stop:m.stopAt??null,drop:m.drop||null,early:!!m.early}:null,hn:g.partnerDevice?S.hist.filter(e=>e.k===pairKey(g)).length:null}}
function joined(g,n){g.match.status='on';save();if(!replaying)toast(cap(n||partner())+' joined. Match on!')}
function healMatch(g,m){const st=m.st||{},x=g.match,mt=st.mt;
 if(x&&mt&&mt.id===x.id){if(x.status==='invite'&&mt.s==='on'&&x.host===S.device)joined(g,m.n);
  if(x.status==='on'&&mt.early&&!x.early){if(mt.drop)applyEnd(g,'drop',null,mt.drop);else if(mt.stop!=null&&mt.s==='on')applyEnd(g,'more',mt.stop);else if(mt.s==='done')applyEnd(g,'now')}}
 // the partner has matches this phone doesn't: tell them which ones it has
 if(g.partnerDevice&&st.hn!=null&&!replaying&&st.hn!==S.hist.filter(e=>e.k===pairKey(g)).length)sendIds(g)}
function sendIds(g,now){if(!now&&Date.now()-lastIds<20000)return;lastIds=Date.now();send('hids',{k:pairKey(g),ids:S.hist.filter(e=>e.k===pairKey(g)).slice(-60).map(e=>e.id)})}

// ============ start ============
renderRules();
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(screen==='mk')drawMaker()});
loadHome();
syncStart();
// the app closed mid-round last time: tell the partner's phone so its splash clears (the round doesn't count)
if(S.liveRound){const lr=S.liveRound;S.liveRound=null;save();if(lr.game===S.current)setTimeout(()=>send('abort',{rid:lr.rid}),1500)}
fetch('cards.json?v='+CONFIG.build,{cache:'no-cache'}).then(r=>{if(!r.ok)throw 0;return r.json()}).then(d=>{
 DECKS=d.decks;CARDS=d.cards;CARDS.forEach(c=>{BYID.set(c[0],c);const w=c[6]??c[0];if(!GROUP.has(w))GROUP.set(w,[]);GROUP.get(w).push(c[0])});loaded=true;
 // tidy: drop played cards that no longer exist, and decks that were removed
 Object.values(S.games).forEach(g=>{g.seen=g.seen.filter(id=>BYID.has(id));if(g.deck!=='all'&&!DECKS.some(x=>x.id===g.deck))g.deck=DECKS[0].id});
 if(G())seen=new Set(G().seen);if(draft&&draft.deck!=='all'&&!DECKS.some(x=>x.id===draft.deck))draft.deck=DECKS[0].id;save();render()})
 .catch(()=>{const b=$('#start');b.textContent='Couldn\'t load cards. Reload to try again.'});
/*SW*/
}
