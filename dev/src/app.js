{
// ============ settings: change game numbers here; rules and labels read from this ============
const CONFIG={version:'5.1',build:'__BUILD__',perRound:10,skips:3,
 times:[30,60,90,120],defaultTime:60,countdown:3,warnAt:10,mixedName:'Mixed',
 sync:true,syncHeardFor:15*60*1000,syncBeat:90*1000,liveWindow:3*60*1000,creditSecondsPerLine:2.2};

// ============ helpers ============
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normCode=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const clean=s=>String(s||'').trim().replace(/\s+/g,' ').slice(0,16);
const fmt=s=>{s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
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
let screen='',draft=null;
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
const FIELDS={player:()=>[['1','Player 1'],['2','Player 2']],deck:deckOptions,time:()=>CONFIG.times.map(t=>[String(t),fmt(t)]),sound:()=>[['on','On'],['off','Off']]};
const target=scope=>scope==='setup'?draft:scope==='game'?G():S;
function renderSegs(){$$('.seg').forEach(seg=>{const t=target(seg.dataset.scope);if(!t)return;const f=seg.dataset.field,opts=FIELDS[f]();
 seg.innerHTML=opts.length?opts.map(([v,l])=>'<button data-v="'+esc(v)+'" aria-pressed="'+(String(t[f])===v)+'">'+esc(l)+'</button>').join(''):'<span class="note">Loading…</span>'})}
document.addEventListener('click',e=>{const b=e.target.closest('.seg button');if(!b)return;const seg=b.parentElement,t=target(seg.dataset.scope),f=seg.dataset.field;
 if(f==='deck'&&seg.dataset.scope==='game'&&t.deck!==b.dataset.v&&sess(t).rounds.length){
  confirmBox('Switching decks ends this game and shows your game summary.',()=>{endGame('deck',null);t.deck=b.dataset.v;S.defaults.deck=t.deck;save();render();afterCredits=()=>suggestTime(t)},'Switch and end');return}
 if(f==='player'&&seg.dataset.scope==='game'&&t.player&&t.player!==b.dataset.v&&(t.seen.length||sess(t).rounds.length)){
  confirmBox('Switch to Player '+b.dataset.v+'? You\'ll get the other half of the cards, and '+partner()+' may have already given clues for some of them. Only do this if your phones picked the same player.',()=>{t.player=b.dataset.v;save();announce();render()},'Switch');return}
 t[f]=f==='time'?Number(b.dataset.v):b.dataset.v;if(f==='time'&&t===G())t.timeT=Date.now();
 if(seg.dataset.scope==='game'){if(f!=='player')S.defaults[f]=t[f];if(f==='time'||f==='player')announce()}save();render();
 if(f==='deck')suggestTime(t)});
// a deck can carry a suggested round length (cards.json decks[].suggestTime)
function suggestTime(t){const d=DECKS.find(x=>x.id===t.deck);if(!d||!d.suggestTime||t.time>=d.suggestTime)return;
 confirmBox(d.name+' plays best with '+fmt(d.suggestTime)+' rounds. Switch to '+fmt(d.suggestTime)+'?',()=>{t.time=d.suggestTime;t.timeChosen=true;if(t===G()){S.defaults.time=t.time;t.timeT=Date.now();announce()}save();render();toast('Rounds set to '+fmt(d.suggestTime))},'Switch')}

function renderRules(){$('#rules-list').innerHTML=[
 ['Roles.','One of you gives clues, the other guesses. Swap after every round.'],
 ['Goal.','Get your partner to say the word in the colored band. Don\'t say that word or any of the 5 forbidden words under it.'],
 ['Word forms count.','If "marriage" is forbidden, "marry" is too. No parts of the words, rhymes, "sounds like," or spelling it out.'],
 ['Correct.','Tap ✓ when they say it. Close forms count, like "dogs" for "dog." The clue-giver decides.'],
 ['Buzz.','Said a forbidden word? Tap Buzz on yourself. The card is thrown out.'],
 ['Skip.','You get '+plural(CONFIG.skips,'free skip')+' per round.'],
 ['Rounds.','Each round has up to '+CONFIG.perRound+' cards. The card showing when time runs out is retired, and cards you didn\'t reach go back in your deck.'],
 ['Turns.','When your partner is giving clues, your phone shows their timer. Just guess. The home screen says whose turn is next.'],
 ['Final round.','Tap Final round to wrap up. You both finish with the same number of rounds, each of you plays one more, then the credits roll. Switching decks also ends the game.'],
 ['Your own cards.','The app makes one of you Player 1 and the other Player 2 the first time your phones connect, and you keep that for the whole saved game. Every card belongs to one player, so you never draw each other\'s cards, and cards you\'ve played don\'t come back.'],
 ['Saved games.','Each partner gets their own saved game with its own played cards. Switch games from the home screen.'],
 ['Code word.','You both type the same code word. That\'s how your phones find each other to share names, players and round length. Matching badges mean you typed the same word. Pick something only you two would use.']
].map(([b,t])=>'<li><b>'+esc(b)+'</b> '+esc(t)+'</li>').join('')}

function render(){const g=G();renderSegs();
 if(screen==='home'&&g){$('#h-game').textContent='Game with '+partner();$('#h-badge').innerHTML=badgeHTML();$('#h-deck').textContent=deckName(g.deck);
  $('#h-player').textContent=g.player?'Player '+g.player:'Picking…';$('#h-left').textContent=!g.player?'—':loaded?unseenCount()+' of '+pool().length:'…';
  const b=$('#start'),st=startState();b.disabled=!!st;b.textContent=st||'Start round';
  $('#h-manual').hidden=!!g.player;renderTurn();renderSync()}
 if(screen==='sum')renderTurn();
 if(screen==='set'&&g){setVal('#set-playas',g.playAs||'');$('#set-playas').placeholder=S.name;setVal('#set-partner',g.partner);setVal('#set-code',g.code);setVal('#set-name',S.name);$('#set-game-h').textContent='Game with '+partner();
  const p=pool();$('#set-seen').textContent=loaded?(p.length-unseenCount())+' of your '+p.length+' '+deckName(g.deck).toLowerCase()+' cards played in this game.':'';
  const out=DECKS.filter(d=>d.mixed===false).map(d=>d.name);$('#mixed-note').textContent=DECKS.length>1?CONFIG.mixedName+' shuffles every deck'+(out.length?' except '+out.join(' and '):'')+'.':'';
  $('#ver').textContent='Version '+CONFIG.version+' · build '+CONFIG.build+' · '+CARDS.length+' cards in '+DECKS.length+' decks'}
 if(screen==='setup'){$('#setup-cancel').hidden=!G();$('#setup-title').textContent=Object.keys(S.games).length?'New game':"Megan's Taboo"}}

// ============ saved games ============
function startSetup(){draft={deck:S.defaults.deck,time:S.defaults.time};
 $('#setup-name').value=S.name;$('#setup-code').value='';closeModals();show('setup')}
$('#setup-go').onclick=()=>{const name=clean($('#setup-name').value),code=normCode($('#setup-code').value);
 if(!name){toast('Add a name so your partner sees it');return}if(!code){toast('Add a code word. Your partner types the same one.');return}
 // a team name in your very first game shouldn't become your usual name
 if(!S.name&&!/\bteam\b/i.test(name))S.name=name;
 const g=newGame({deck:draft.deck,time:draft.time,code,last:Date.now(),timeT:draft.timeChosen?Date.now():0,playAs:name===S.name?null:name});
 S.games[g.id]=g;S.defaults={deck:g.deck,time:g.time};useGame(g.id);show('home');if(!S.rulesSeen){S.rulesSeen=true;save();setTimeout(()=>openModal('rules'),250)}};
$('#setup-cancel').onclick=()=>show('home');
function renderGames(){const list=Object.values(S.games).sort((a,b)=>(b.last||b.created)-(a.last||a.created));
 $('#games-list').innerHTML=list.map(g=>{const when=g.last?new Date(g.last).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'not played yet',cur=g.id===S.current;
  return'<li><button class="pick" data-game="'+esc(g.id)+'" aria-current="'+cur+'"><span>Game with '+esc(g.partner||'your partner')+'</span><small>'+esc(deckName(g.deck))+' · '+esc(cur?'playing now':'last played '+when)+'</small></button>'+
   (cur?'':'<button class="del" data-del="'+esc(g.id)+'">Delete</button>')+'</li>'}).join('')}
$('#to-games').onclick=()=>{renderGames();openModal('games')};
$('#games-list').addEventListener('click',e=>{const p=e.target.closest('[data-game]'),d=e.target.closest('[data-del]');
 if(p){useGame(p.dataset.game);closeModals();show('home');toast('Switched to game with '+partner())}
 if(d){const g=S.games[d.dataset.del];$('#m-games').classList.remove('on');confirmBox('Delete your game with '+(g.partner||'your partner')+'? Its played cards are lost.',()=>{delete S.games[g.id];save();renderGames();openModal('games')},'Delete')}});
$('#new-game').onclick=startSetup;
$('#del-game').onclick=()=>confirmBox('Delete your game with '+partner()+'? Its played cards are lost, and you\'ll start a new game.',()=>{delete S.games[S.current];useGame(null);startSetup()},'Delete');
$('#set-partner').addEventListener('change',e=>{const v=clean(e.target.value);if(v){G().partner=v;save()}render()});
$('#set-code').addEventListener('change',e=>{G().code=normCode(e.target.value);save();syncStart();render()});
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
 game={rid,cards:d.cards,i:0,res:Array(d.cards.length).fill('none'),secs:[],shownAt:0,hist:[],skips:CONFIG.skips,left:G().time*1000,dur:G().time*1000,end:0,running:false,counting:true,lastTick:null,warned:false,pausedByDialog:false,deck:G().deck};
 hideSplash();show('play');renderCard();renderHud();wake(true);
 const cd=CONFIG.countdown*800;send('start',{rid,left:game.left+cd,dur:game.dur});S.liveRound={game:S.current,rid};save();
 const c=$('#count'),n=$('#count-n');let k=CONFIG.countdown;c.classList.add('on');
 const step=()=>{if(!game||game.rid!==rid||game.cancelled){c.classList.remove('on');return}
  if(k===0){c.classList.remove('on');game.counting=false;sfx.go();go();return}n.textContent=k;n.style.animation='none';void n.offsetWidth;n.style.animation='';sfx.tick();k--;setTimeout(step,800)};step()}
function cancelRound(msg){if(!game||!game.counting)return;game.cancelled=true;S.liveRound=null;save();wake(false);game=null;$('#count').classList.remove('on');show('home');toast(msg,3500)}
function go(){game.running=true;game.end=performance.now()+game.left;if(!game.shownAt)game.shownAt=performance.now();if(game.pausedAt){game.shownAt+=performance.now()-game.pausedAt;game.pausedAt=0}loop()}
function loop(){cancelAnimationFrame(raf);if(!game||!game.running)return;game.left=game.end-performance.now();const s=Math.ceil(game.left/1000);
 if(game.left<=0){finish('time');return}
 if(s<=CONFIG.warnAt&&s!==game.lastTick){game.lastTick=s;sfx.tick();if(!game.warned){game.warned=true;vibrate(200)}}
 const t=$('#timer');t.textContent=fmt(game.left/1000);t.classList.toggle('low',s<=CONFIG.warnAt);raf=requestAnimationFrame(loop)}
function pause(byDialog){if(!game||!game.running)return;game.left=game.end-performance.now();game.running=false;game.pausedAt=performance.now();cancelAnimationFrame(raf);game.pausedByDialog=!!byDialog;send('pause',{rid:game.rid,left:game.left});
 if(!byDialog){$('#paused-t').textContent=fmt(game.left/1000)+' left';$('#paused').classList.add('on')}}
function resume(){if(!game||game.running||screen!=='play')return;$('#paused').classList.remove('on');send('resume',{rid:game.rid,left:game.left});go()}
function fit(el,max,min){let s=max;el.style.fontSize=s+'px';const c=el.parentElement;while(s>min&&(el.scrollWidth>c.clientWidth-4||el.scrollHeight>c.clientHeight-4)){s-=2;el.style.fontSize=s+'px'}}
function renderCard(){const c=game.cards[game.i];if(!c)return;const w=$('#p-word');w.textContent=c[4];$('#p-list').innerHTML=c[5].map(t=>'<li>'+esc(t)+'</li>').join('');
 requestAnimationFrame(()=>{fit(w,44,20);$$('#p-list li').forEach(li=>{let s=26;li.style.fontSize=s+'px';while(s>14&&li.scrollWidth>li.clientWidth){s-=1;li.style.fontSize=s+'px'}})})}
function renderHud(){const n=game.cards.length;
 $('#meter').innerHTML=game.res.map((r,i)=>'<i class="'+({correct:'c',buzz:'x',skip:'s'}[r]||(i===game.i?'now':''))+'"></i>').join('');
 $('#p-info').textContent='Card '+Math.min(game.i+1,n)+' of '+n;
 $('#p-score').textContent=game.res.filter(r=>r==='correct').length;$('#skipn').textContent=game.skips;
 $('#b-skip').disabled=game.skips<=0;$('#b-undo').disabled=!game.hist.length;$('#timer').textContent=fmt(game.left/1000)}
function act(kind){if(!game||!game.running)return;const now=performance.now();game.hist.push({i:game.i,skips:game.skips,shownAt:game.shownAt});
 game.secs[game.i]=Math.round((now-game.shownAt)/100)/10;game.shownAt=now;game.res[game.i]=kind;markSeen(game.cards[game.i],true);saveSeen();
 if(kind==='correct')sfx.ok();else if(kind==='buzz'){sfx.buzz();vibrate([80,60,80])}else{game.skips--;sfx.skip()}
 game.i++;if(game.i>=game.cards.length){renderHud();finish('all');return}renderCard();renderHud()}
function undo(){if(!game||!game.hist.length)return;const h=game.hist.pop();game.i=h.i;game.skips=h.skips;game.res[h.i]='none';game.shownAt=h.shownAt;
 markSeen(game.cards[h.i],false);saveSeen();renderCard();renderHud()}
function finish(why){game.running=false;cancelAnimationFrame(raf);wake(false);$('#paused').classList.remove('on');sfx.end();vibrate(300);
 // the card on screen when time runs out or the round ends gets revealed, so it's retired too
 if(why!=='all'&&game.i<game.cards.length){game.res[game.i]=why==='time'?'time':'ended';markSeen(game.cards[game.i],true);saveSeen()}
 const n=k=>game.res.filter(r=>r===k).length,c=n('correct'),x=n('buzz'),sk=n('skip'),back=n('none');
 $('#sum-title').textContent=myName()+"'s round";$('#sum-why').textContent=why==='all'?'All '+game.cards.length+' done!':why==='time'?"Time's up":'Ended early';
 $('#t-c').textContent=c;$('#t-s').textContent=sk;$('#t-x').textContent=x;
 const used=Math.round(game.dur-Math.max(0,game.left)),words=game.cards.map((card,i)=>[card[4],game.res[i],game.secs[i]||null]).filter(w=>w[1]!=='none');
 sess().rounds.push({who:'me',rid:game.rid,at:Date.now(),c,s:sk,x,n:words.length,dur:used,deck:game.deck,words});S.liveRound=null;save();
 send('end',{rid:game.rid,c,s:sk,x,cnt:words.length,dur:used,deck:game.deck,guessed:words.filter(w=>w[1]==='correct').map(w=>[w[0],w[2]])});
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
$$('[data-back]').forEach(b=>b.addEventListener('click',()=>show('home')));
$('#to-settings').onclick=()=>show('set');
$('#h-manual').onclick=()=>show('set');
$('#to-maker').onclick=()=>{show('mk');drawMaker()};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&game&&game.running)wake(true)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModals()});

// ============ card maker ============
const MK_COLORS=['#d6246e','#2f6fdf','#14946c','#f08a24','#7b3fe4','#1d1027'];let mkColor=MK_COLORS[0];
$('#mk-sw').innerHTML=MK_COLORS.map((c,i)=>'<button style="background:'+c+'" data-c="'+c+'" aria-label="Color '+(i+1)+'" aria-pressed="'+(i===0)+'"></button>').join('');
$('#mk-sw').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;mkColor=b.dataset.c;$$('#mk-sw button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawMaker()});
$$('#s-mk input').forEach(i=>i.addEventListener('input',drawMaker));
function fitCanvas(ctx,text,maxW,size,min,font){let s=size;do{ctx.font=font.replace('S',s);if(ctx.measureText(text).width<=maxW)break;s-=2}while(s>min);return s}
function wrapTitle(ctx,text,maxW,maxH){for(let s=150;s>=50;s-=4){ctx.font="400 "+s+"px 'Archivo Black', Archivo, sans-serif";const words=text.split(' ');let lines=[''];
  for(const w of words){const t=lines[lines.length-1]?lines[lines.length-1]+' '+w:w;if(ctx.measureText(t).width<=maxW)lines[lines.length-1]=t;else lines.push(w)}
  if(lines.length<=2&&lines.every(l=>ctx.measureText(l).width<=maxW)&&lines.length*s*1.05<=maxH)return{s,lines}}return{s:50,lines:[text]}}
function drawMaker(){const cv=$('#mk'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
 const vals=['#mk-w','#mk-1','#mk-2','#mk-3','#mk-4','#mk-5'].map(s=>$(s).value.trim()),from=$('#mk-from').value.trim();
 ctx.clearRect(0,0,W,H);ctx.fillStyle='#2b0d3f';ctx.fillRect(0,0,W,H);const x=70,y=70,w=W-140,h=H-140,r=60;
 ctx.save();ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}ctx.clip();
 ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);ctx.fillStyle=mkColor;ctx.fillRect(x,y,w,360);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
 const t=wrapTitle(ctx,vals[0]||'Main word',w-100,300);ctx.font="400 "+t.s+"px 'Archivo Black', Archivo, sans-serif";t.lines.forEach((l,i)=>ctx.fillText(l,W/2,y+180+(i-(t.lines.length-1)/2)*t.s*1.05));
 const top=y+400,bottom=y+h-(from?190:110),step=(bottom-top)/5;
 for(let i=0;i<5;i++){const cy=top+step*(i+.5),txt=vals[i+1]||'Forbidden '+(i+1);ctx.fillStyle=vals[i+1]?'#1d1027':'#b9a6c9';
  const s=fitCanvas(ctx,txt,w-120,84,40,"800 Spx Archivo, sans-serif");ctx.font="800 "+s+"px Archivo, sans-serif";ctx.fillText(txt,W/2,cy);
  if(i<4){ctx.fillStyle='#e7dcef';ctx.fillRect(x+90,top+step*(i+1)-2,w-180,4)}}
 if(from){ctx.fillStyle='#6b5a78';const s=fitCanvas(ctx,'From: '+from,w-120,54,30,"600 Spx Archivo, sans-serif");ctx.font="600 "+s+"px Archivo, sans-serif";ctx.fillText('From: '+from,W/2,y+h-130)}
 ctx.fillStyle='#b9a6c9';ctx.font="600 34px Archivo, sans-serif";ctx.fillText("Megan's Taboo",W/2,y+h-58);ctx.restore();$('#mk-save').disabled=vals.some(v=>!v)}
let downloads=null;
try{if(window.claude&&window.claude.use)window.claude.use('downloads').then(d=>{downloads=d||null}).catch(()=>{})}catch(e){}
$('#mk-save').onclick=async()=>{const name='megans-taboo-'+($('#mk-w').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'card')+'.png';
 const blob=await new Promise(r=>$('#mk').toBlob(r,'image/png'));if(!blob){toast('Could not make the image. Take a screenshot instead.');return}
 if(downloads){try{await downloads.save({filename:name,data:blob});toast('Saved')}catch(e){toast(e&&e.code==='declined'?'Not saved':'Saving isn\'t available here. Take a screenshot instead.')}return}
 try{const f=new File([blob],name,{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:"Megan's Taboo card"});return}}catch(e){if(e&&e.name==='AbortError')return}
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
 return{sid:se.sid,prev:se.prev||null,n:se.rounds.length,rs:mine.map(r=>[r.rid,r.c,r.s,r.x,r.n,r.dur,r.deck]),fin:se.final?se.final.target:null,
  live:game&&!game.cancelled&&(game.running||game.counting||game.pausedAt)?{rid:game.rid,left:Math.max(0,game.running?game.end-performance.now():game.left),paused:!game.running&&!game.counting}:null,
  last:last?{rid:last.rid,c:last.c,s:last.s,x:last.x,n:last.n,dur:last.dur,deck:last.deck,guessed:last.words.filter(w=>w[1]==='correct').map(w=>[w[0],w[2]])}:null}}
function send(type,data={}){const g=G();if(!CONFIG.sync||!syncTopic||!g)return;
 const body=JSON.stringify(Object.assign({v:3,ver:CONFIG.build,type,d:S.device,n:myName(g),p:g.player||null,tm:g.time,tt:g.timeT||0,at:Date.now(),st:myState()},data));
 if(Date.now()<backoffUntil&&type==='hi'){pending=body;return}post(body)}
function post(body,tries=0){fetch(SYNC_URL+syncTopic,{method:'POST',body}).then(r=>{
  if(r.status===429){backoffUntil=Date.now()+30000;if(tries<2)setTimeout(()=>post(body,tries+1),30000*(tries+1))}
  else if(pending&&Date.now()>=backoffUntil){const p=pending;pending=null;post(p)}}).catch(()=>{if(tries<2)setTimeout(()=>post(body,tries+1),5000*(tries+1))})}
// live messages count as just sent (so clocks don't matter); only replayed history uses the message's age
const age=m=>replaying?Math.max(0,Date.now()-m.at):0;
const fresh=(m,ms=CONFIG.syncHeardFor)=>age(m)<ms;
const sameGame=(g,m)=>m.st&&m.st.sid===sess(g).sid;
const roundKnown=(g,rid)=>sess(g).rounds.some(r=>r.rid===rid);
function addTheirRound(g,r){const se=sess(g);if(!r||roundKnown(g,r.rid))return false;
 se.rounds.push({who:'them',rid:r.rid,at:Date.now(),c:r.c,s:r.s,x:r.x,n:r.cnt??r.n,dur:r.dur,deck:r.deck,guessed:r.guessed||[]});save();return true}
// --- handlers: one per message type; each only acts on messages from the same game ---
const HANDLERS={
 hi:()=>{},
 start:(m,g)=>{if(!sameGame(g,m)||roundKnown(g,m.rid))return;
  if(game&&!game.cancelled){if(game.counting&&S.device>m.d)cancelRound(cap(m.n||partner())+' started first. Their round is on.');else return}
  livePartner(m.rid,m.left-age(m),false,m.dur)},
 pause:(m)=>{if(plive&&plive.rid===m.rid){plive.paused=true;plive.left=m.left;paintSplash()}},
 resume:(m)=>{if(plive&&plive.rid===m.rid)livePartner(m.rid,m.left-age(m),false,plive.dur)},
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
 if(CONFIG.times.includes(m.tm)&&(m.tt||0)>(g.timeT||0)){const was=g.time;g.time=m.tm;g.timeT=m.tt;changed=true;
  if(was!==m.tm&&!replaying)toast(cap(nm||partner())+' set rounds to '+fmt(m.tm)+(game?'. It starts next round.':''))}
 // game state carried by every message: line up on one game id, then heal anything we missed
 const st=m.st||{},se=sess(g);
 if(st.sid&&st.sid!==se.sid){
  if(st.prev&&st.prev===se.sid&&se.rounds.length&&m.type!=='over'){endGame('over',nm||partner(),st.sid);return}   // they ended our game and we missed it
  // join their game, unless it's one we already finished
  if(!se.rounds.length&&!(g.ended||[]).includes(st.sid)&&(st.n>0||st.sid<se.sid)){se.sid=st.sid;changed=true}}
 if(sameGame(g,m)){
  if(st.last&&addTheirRound(g,st.last))changed=true;
  (st.rs||[]).forEach(r=>{if(addTheirRound(g,{rid:r[0],c:r[1],s:r[2],x:r[3],n:r[4],dur:r[5],deck:r[6]}))changed=true});
  if(st.fin&&(!se.final||se.final.target<st.fin)){se.final={target:st.fin};changed=true}
  if(m.type==='hi'&&fresh(m,30000)){if(st.live&&!plive&&!roundKnown(g,st.live.rid))livePartner(st.live.rid,st.live.left-age(m),st.live.paused,null);
   else if(!st.live&&plive){plive=null;hideSplash()}}}
 if(changed)save();
 (HANDLERS[m.type]||(()=>{}))(m,g);
 if(m.ver&&m.ver>CONFIG.build)showUpdate();
 queueRender()}
function assign(dev){const g=G(),h=heard[dev];if(!g||g.player||!h)return;
 g.player=h.player?other(h.player):(S.device<dev?'1':'2');g.partnerDevice=dev;seen=new Set(g.seen);save();send('hi');render();
 toast('You\'re Player '+g.player+'. '+cap(h.name||partner())+' is Player '+other(g.player)+'.')}
function showUpdate(){if($('#upd'))return;const b=document.createElement('button');b.id='upd';b.className='primary';b.textContent='Update available. Tap to reload';
 b.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));z-index:60;min-height:48px';b.onclick=()=>location.reload();document.body.appendChild(b)}

// ---------- the guesser's splash card ----------
function livePartner(rid,left,paused,dur){if(left<=0&&!paused)return;plive={rid,left,paused,dur:dur||plive&&plive.dur||null,at:performance.now()};if(!replaying)paintSplash()}
function liveLeft(){if(!plive)return 0;return plive.paused?plive.left:plive.left-(performance.now()-plive.at)}
function paintSplash(){const sp=$('#splash');if(!plive||screen==='play'){if(sp.dataset.mode==='live')hideSplash();return}
 sp.dataset.mode='live';$('#sp-name').textContent=cap(partner());$('#sp-line').textContent='is giving clues';$('#sp-sub').textContent=plive.paused?'Paused':'Just guess!';
 $('#sp-ok').hidden=true;$('#sp-timer').hidden=false;$('#sp-final').hidden=!!sess().final;sp.classList.add('on');clearInterval(spTimer);
 const tick=()=>{if(!plive){hideSplash();return}const l=liveLeft();if(l<=-4000){plive=null;hideSplash();queueRender();return}$('#sp-timer').textContent=fmt(Math.min(l,plive.dur||l)/1000)};tick();spTimer=setInterval(tick,250);queueRender()}
function splashSummary(m){clearInterval(spTimer);const sp=$('#splash');sp.dataset.mode='sum';
 $('#sp-name').textContent=cap(m.n||partner())+"'s round";$('#sp-line').innerHTML='<span class="sp-counts">'+esc(m.c+' guessed · '+m.s+' skipped · '+m.x+' buzzed')+'</span>';
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
 $$('#final-btn,#sum-final').forEach(b=>b.hidden=!!se.final||!se.rounds.length);
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
 const next=newSession(nextSid);next.prev=se.sid;
 if(!se.rounds.length){g.ended=[se.sid].concat(g.ended||[]).slice(0,10);g.session=next;save();render();return}
 const k=creditFacts(se),lines=CREDITS.map(f=>f(k)).filter(Boolean);
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

// ============ start ============
renderRules();
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(screen==='mk')drawMaker()});
if(G())show('home');else startSetup();
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
