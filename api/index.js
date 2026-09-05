const crypto=require("crypto");const {createClient}=require("redis");
const KEY="bfl:tennis:hp:v1",COOKIE="bfl_admin_session",MAX=43200;
let clientPromise;
function redis(){if(!clientPromise){const c=createClient({url:process.env.REDIS_URL});c.on("error",e=>console.error(e));clientPromise=c.connect().then(()=>c)}return clientPromise}
function init(){return {status:"setup",players:[],rounds:[],thirdPlace:null,podium:{first:null,second:null,third:null}}}
function cleanYoutube(v){return typeof v==="string"?v.trim():""}
async function resolveChannelId(handleRaw){
  let h=String(handleRaw||"").trim();
  if(/^UC[0-9A-Za-z_-]{20,}$/.test(h))return h; // sudah berupa Channel ID
  const m=h.match(/@([\w.-]+)/);
  const handle=m?("@"+m[1]):(h.startsWith("@")?h:"@"+h);
  const r=await fetch("https://www.youtube.com/"+handle,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}});
  if(!r.ok)throw new Error("Gagal membuka channel "+handle+" (HTTP "+r.status+")");
  const html=await r.text();
  const cm=html.match(/"channelId":"(UC[0-9A-Za-z_-]{20,})"/)||html.match(/"externalId":"(UC[0-9A-Za-z_-]{20,})"/);
  if(!cm)throw new Error("Channel ID tidak ditemukan untuk "+handle);
  return cm[1];
}

function pn(p){return typeof p==="string"?p:(p?.name||"TBD")}
function isHandleLike(raw){return /^@[\w.-]+$/.test(raw)||/^https?:\/\/(www\.)?youtube\.com\/@[\w.-]+/i.test(raw)||/^UC[0-9A-Za-z_-]{20,}$/.test(raw)}
async function resolvedStreamForName(s,playerName){
  if(!playerName||playerName==="TBD")return "";
  const p=(s.players||[]).find(x=>pn(x)===playerName);
  if(!p)return "";
  const raw=cleanYoutube(p.youtube||"");
  if(!raw)return "";
  if(!isHandleLike(raw))return raw; // link video/live langsung, tidak perlu diproses
  if(p.channelIdCache&&p.channelIdCache.src===raw)return "https://www.youtube.com/embed/live_stream?channel="+p.channelIdCache.id;
  try{
    const id=await resolveChannelId(raw);
    p.channelIdCache={src:raw,id};
    return "https://www.youtube.com/embed/live_stream?channel="+id;
  }catch(e){console.error(e.message||e);return ""}
}
async function refreshLiveStreams(s){
  let changed=false;
  const list=[...(s.rounds||[]).flatMap(r=>r.matches||[]),s.thirdPlace].filter(m=>m&&m.status==="live");
  for(const m of list){
    const v1=await resolvedStreamForName(s,pn(m.players?.[0]));
    const v2=await resolvedStreamForName(s,pn(m.players?.[1]));
    if(v1!==m.liveYoutube1){m.liveYoutube1=v1;changed=true}
    if(v2!==m.liveYoutube2){m.liveYoutube2=v2;changed=true}
  }
  return changed;
}
function norm(s){s=s||init();s.players=(s.players||[]).map(p=>typeof p==="string"?{name:p,youtube:""}:p);for(const r of s.rounds||[])for(const m of r.matches||[]){if(m.liveYoutube1===undefined)m.liveYoutube1=cleanYoutube(m.liveYoutube||"");if(m.liveYoutube2===undefined)m.liveYoutube2="";if(m.liveChannel1===undefined)m.liveChannel1="";if(m.liveChannel2===undefined)m.liveChannel2="";delete m.liveYoutube}if(s.thirdPlace){if(s.thirdPlace.liveYoutube1===undefined)s.thirdPlace.liveYoutube1=cleanYoutube(s.thirdPlace.liveYoutube||"");if(s.thirdPlace.liveYoutube2===undefined)s.thirdPlace.liveYoutube2="";if(s.thirdPlace.liveChannel1===undefined)s.thirdPlace.liveChannel1="";if(s.thirdPlace.liveChannel2===undefined)s.thirdPlace.liveChannel2="";delete s.thirdPlace.liveYoutube}return s}
async function get(){const c=await redis();const x=await c.get(KEY);return norm(x?JSON.parse(x):init())}
async function save(s){const c=await redis();await c.set(KEY,JSON.stringify(s))}
function cookieVal(req){const h=req.headers.cookie||"";const m=h.match(new RegExp("(^|; )"+COOKIE+"=([^;]+)"));return m?m[2]:null}
function sign(v){return crypto.createHmac("sha256",process.env.SESSION_SECRET||"change-me").update(v).digest("hex")}
function isAdmin(req){const v=cookieVal(req);if(!v)return false;const [u,exp,sig]=Buffer.from(v,"base64url").toString().split(".");return u&&exp&&sig&&Number(exp)>Date.now()/1000&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(u+"."+exp)))}
function setCookie(res,v){res.setHeader("Set-Cookie",COOKIE+"="+v+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+MAX+(process.env.NODE_ENV==="production"?"; Secure":""))}
function json(res,status,obj){res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(obj))}
function body(req){if(req.body&&typeof req.body==="object")return Promise.resolve(req.body);return new Promise(resolve=>{let x="";req.on("data",c=>x+=c);req.on("end",()=>{try{resolve(x?JSON.parse(x):{})}catch{resolve({})}})})}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function build(players,order){
 let real;
 if(Array.isArray(order)&&order.length){
   const byName={};for(const p of players)byName[pn(p)]=p;
   const mapped=order.map(nm=>byName[nm]).filter(Boolean).map(p=>({...p}));
   real=mapped.length===players.length?mapped:shuffle(players.map(p=>({...p})));
 }else{
   real=shuffle(players.map(p=>({...p})));
 }
 let n=1;while(n<real.length)n*=2;
 const numByes=n-real.length,numFullMatches=n/2-numByes;
 const fullReals=real.slice(0,numFullMatches*2),byeReals=real.slice(numFullMatches*2);
 const ps=[];for(let i=0;i<fullReals.length;i+=2)ps.push(fullReals[i],fullReals[i+1]);for(const r of byeReals)ps.push(r,null);
 let matches=[];for(let i=0;i<n;i+=2)matches.push({id:"r1m"+(i/2+1),players:[ps[i],ps[i+1]],winner:null,status:ps[i]&&ps[i+1]?"live":"bye",liveYoutube1:"",liveYoutube2:""});const rounds=[{name:"ROUND 1",matches}];let count=n/2,ri=2;while(count>=2){let ms=[];for(let i=0;i<count;i++)ms.push({id:"r"+ri+"m"+(i+1),players:[null,null],winner:null,status:"waiting",liveYoutube1:"",liveYoutube2:""});rounds.push({name:count===2?"FINAL":("ROUND "+ri),matches:ms});count/=2;ri++}return {rounds}}
function same(a,b){return pn(a)!=="TBD"&&pn(a)===pn(b)}
function advance(s,roundIndex,matchIndex,w){const r=s.rounds[roundIndex],m=r.matches[matchIndex];m.winner=w;m.status="done";const loser=same(m.players[0],w)?m.players[1]:m.players[0];if(roundIndex===s.rounds.length-1){s.podium.first=w;s.podium.second=loser;return}const next=s.rounds[roundIndex+1].matches[Math.floor(matchIndex/2)];const slot=matchIndex%2;next.players[slot]=w;if(next.players[0]&&next.players[1]){next.status="live";next.liveYoutube1="";next.liveYoutube2=""}}
function maybeThird(s){if(s.rounds.length<2)return;if(!s.thirdPlace){const sf=s.rounds[s.rounds.length-2];if(sf.matches.length===2&&sf.matches.every(m=>m.winner)){const losers=sf.matches.map(m=>same(m.players[0],m.winner)?m.players[1]:m.players[0]);if(losers[0]&&losers[1])s.thirdPlace={id:"third",players:losers,winner:null,status:"live",liveYoutube1:"",liveYoutube2:""}}}}
function addLivePlayerToDraw(s,player){
  if(!s.rounds?.length)return;
  const locked=new Set();
  for(const r of s.rounds)for(const m of r.matches||[])if(m.status==="live"||m.status==="done")for(const p of m.players||[])if(p&&pn(p)!=="TBD")locked.add(pn(p));
  if(s.thirdPlace?.status==="live"||s.thirdPlace?.status==="done")for(const p of s.thirdPlace.players||[])if(p&&pn(p)!=="TBD")locked.add(pn(p));
  const first=s.rounds[0],pool=[],keepMatches=[];
  // kumpulkan lagi semua player dari match yang belum live/selesai (waiting/menunggu lawan) ke pool, buang match lamanya
  for(const m of first.matches||[]){
    if(m.status==="live"||m.status==="done"){keepMatches.push(m);continue}
    for(const p of m.players||[])if(p&&pn(p)!=="TBD")pool.push(p);
  }
  first.matches=keepMatches;
  pool.push(player);
  for(const p of s.players||[])if(p&&pn(p)!=="TBD"&&!locked.has(pn(p))&&!pool.some(x=>pn(x)===pn(p)))pool.push(p);
  shuffle(pool);
  let pi=0;
  while(pi+1<pool.length){
    const a=pool[pi++],b=pool[pi++];
    first.matches.push({id:"r1m"+(first.matches.length+1),players:[a,b],winner:null,status:"live",liveYoutube1:"",liveYoutube2:""});
  }
  if(pi<pool.length){
    // sisa 1 player tanpa lawan -> tunggu, JANGAN otomatis menang
    const a=pool[pi++];
    first.matches.push({id:"r1m"+(first.matches.length+1),players:[a,null],winner:null,status:"waiting",liveYoutube1:"",liveYoutube2:""});
  }
}
async function handler(req,res){try{const action=(req.query&&req.query.action)||"state";if(action==="state"){const s=await get();try{if(await refreshLiveStreams(s))await save(s)}catch(e){console.error(e)}return json(res,200,{...s,admin:isAdmin(req)})}
if(action==="login"){const b=await body(req);if(req.method!=="POST")return json(res,405,{error:"POST only"});if(b.username!==process.env.ADMIN_USERNAME||b.password!==process.env.ADMIN_PASSWORD)return json(res,401,{error:"Username/password salah"});const exp=Math.floor(Date.now()/1000)+MAX,raw=b.username+"."+exp,sig=sign(raw);setCookie(res,Buffer.from(raw+"."+sig).toString("base64url"));return json(res,200,{ok:true})}
if(!isAdmin(req))return json(res,401,{error:"Admin login diperlukan"});
if(action==="logout"){setCookie(res,"; Max-Age=0");return json(res,200,{ok:true})}
let s=await get(),b=await body(req);
if(action==="register")return json(res,403,{error:"Public registration disabled"});
if(action==="add-player"){
 if(!b.name?.trim())return json(res,400,{error:"Nama player wajib"});
 const playerName=b.name.trim();if(s.players.some(p=>pn(p).toLowerCase()===playerName.toLowerCase()))return json(res,400,{error:"Nama sudah ada"});
 const player={name:playerName,youtube:cleanYoutube(b.youtube)};s.players.push(player);if(s.status!=="setup")addLivePlayerToDraw(s,player);await save(s);return json(res,200,{ok:true,state:s});
}
if(action==="update-player"){
 const i=Number(b.index);if(!s.players[i])return json(res,404,{error:"Player tidak ditemukan"});const old=s.players[i],nextName=String(b.name??pn(old)).trim();if(!nextName)return json(res,400,{error:"Nama wajib"});if(nextName.toLowerCase()!==pn(old).toLowerCase()&&s.players.some((p,idx)=>idx!==i&&pn(p).toLowerCase()===nextName.toLowerCase()))return json(res,400,{error:"Nama sudah ada"});if(s.status!=="setup"&&nextName!==pn(old))return json(res,400,{error:"Nama player tidak bisa diubah setelah acara dimulai"});s.players[i]={name:nextName,youtube:cleanYoutube(b.youtube)};await save(s);return json(res,200,{ok:true});
}
if(action==="start"){if(s.players.length<2)return json(res,400,{error:"Minimal 2 player"});if(s.status!=="setup")return json(res,400,{error:"Tournament sudah dimulai"});const rawOrder=Array.isArray(b.order)?b.order.map(x=>String(x)):null;s=init();s.players=(await get()).players;const validOrder=rawOrder&&rawOrder.length===s.players.length&&rawOrder.every(nm=>s.players.some(p=>pn(p)===nm))?rawOrder:null;s.rounds=build(s.players,validOrder).rounds;s.status="live";for(let i=0;i<s.rounds[0].matches.length;i++){let m=s.rounds[0].matches[i];if(m.status==="bye"){const w=m.players.find(Boolean);m.winner=w;m.status="done";const next=s.rounds[1]?.matches[Math.floor(i/2)];if(next){next.players[i%2]=w;if(next.players[0]&&next.players[1]){next.status="live";next.liveYoutube1="";next.liveYoutube2=""}}}}await save(s);return json(res,200,{ok:true})}
if(action==="winner"){if(s.status!=="live"&&s.status!=="completed")return json(res,400,{error:"Tournament belum dimulai"});let found=null;if(b.matchId==="third")found=s.thirdPlace;else for(const r of s.rounds)for(const m of r.matches)if(m.id===b.matchId)found=m;if(!found||found.status!=="live")return json(res,400,{error:"Match tidak live"});const w=found.players.find(p=>pn(p)===b.playerName);if(!w)return json(res,400,{error:"Player tidak ditemukan di match"});if(b.matchId==="third"){found.winner=w;s.podium.third=w;found.status="done"}else{let ri=s.rounds.findIndex(r=>r.matches.some(m=>m.id===found.id)),mi=s.rounds[ri].matches.findIndex(m=>m.id===found.id);advance(s,ri,mi,w)}maybeThird(s);const anyLive=[...s.rounds.flatMap(r=>r.matches||[]),s.thirdPlace].some(m=>m&&m.status==="live");if(s.podium.first&&s.podium.second&&!anyLive)s.status="completed";await save(s);return json(res,200,{ok:true,state:s})}
if(action==="reset"){await save(init());return json(res,200,{ok:true})}
if(action==="reset-bracket"){s.rounds=[];s.thirdPlace=null;s.podium={first:null,second:null,third:null};s.status="setup";await save(s);return json(res,200,{ok:true})}
return json(res,404,{error:"Action tidak dikenal"})}catch(e){console.error(e);return json(res,500,{error:"Server error",detail:String(e.message||e)})}}
module.exports=handler;
