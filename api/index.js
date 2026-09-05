const crypto=require("crypto");const {createClient}=require("redis");
const KEY="bfl:tennis:hp:v1",COOKIE="bfl_admin_session",MAX=43200;
let clientPromise;
function redis(){if(!clientPromise){const c=createClient({url:process.env.REDIS_URL});c.on("error",e=>console.error(e));clientPromise=c.connect().then(()=>c)}return clientPromise}
function init(){return {status:"setup",players:[],rounds:[],thirdPlace:null,podium:{first:null,second:null,third:null}}}
function cleanYoutube(v){return typeof v==="string"?v.trim():""}
function cleanChannel(v){
  if(typeof v!=="string")return "";
  let x=v.trim().replace(/^https?:\/\/(www\.)?youtube\.com\/@/i,"@");
  if(!x.startsWith("@"))x="@"+x;
  return x;
}
async function ytJson(url){
  const r=await fetch(url);
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||("YouTube API "+r.status));
  return d;
}
async function findLiveFromChannel(input){
  const key=process.env.YOUTUBE_API_KEY;
  if(!key)throw new Error("YOUTUBE_API_KEY belum diatur di Vercel.");
  const handle=cleanChannel(input);
  const c=await ytJson("https://www.googleapis.com/youtube/v3/channels?part=id&forHandle="+encodeURIComponent(handle)+"&key="+encodeURIComponent(key));
  const channelId=c.items?.[0]?.id;
  if(!channelId)throw new Error("Channel "+handle+" tidak ditemukan.");
  const q=new URLSearchParams({part:"snippet",channelId,type:"video",eventType:"live",maxResults:"1",key});
  const sr=await ytJson("https://www.googleapis.com/youtube/v3/search?"+q.toString());
  const item=sr.items?.[0];
  return {handle,channelId,videoId:item?.id?.videoId||"",title:item?.snippet?.title||""};
}

function pn(p){return typeof p==="string"?p:(p?.name||"TBD")}
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
function build(players){let ps=shuffle(players.map(p=>({...p})));let n=1;while(n<ps.length)n*=2;while(ps.length<n)ps.push(null);let matches=[];for(let i=0;i<n;i+=2)matches.push({id:"r1m"+(i/2+1),players:[ps[i],ps[i+1]],winner:null,status:ps[i]&&ps[i+1]?"live":"bye",liveYoutube1:"",liveYoutube2:""});const rounds=[{name:"ROUND 1",matches}];let count=n/2,ri=2;while(count>=2){let ms=[];for(let i=0;i<count;i++)ms.push({id:"r"+ri+"m"+(i+1),players:[null,null],winner:null,status:"waiting",liveYoutube1:"",liveYoutube2:""});rounds.push({name:count===2?"FINAL":("ROUND "+ri),matches:ms});count/=2;ri++}return {rounds}}
function same(a,b){return pn(a)!=="TBD"&&pn(a)===pn(b)}
function advance(s,roundIndex,matchIndex,w){const r=s.rounds[roundIndex],m=r.matches[matchIndex];m.winner=w;m.status="done";const loser=same(m.players[0],w)?m.players[1]:m.players[0];if(roundIndex===s.rounds.length-1){s.podium.first=w;s.podium.second=loser;return}const next=s.rounds[roundIndex+1].matches[Math.floor(matchIndex/2)];const slot=matchIndex%2;next.players[slot]=w;if(next.players[0]&&next.players[1]){next.status="live";next.liveYoutube1="";next.liveYoutube2=""}}
function maybeThird(s){if(s.rounds.length<2)return;if(!s.thirdPlace){const sf=s.rounds[s.rounds.length-2];if(sf.matches.length===2&&sf.matches.every(m=>m.winner)){const losers=sf.matches.map(m=>same(m.players[0],m.winner)?m.players[1]:m.players[0]);if(losers[0]&&losers[1])s.thirdPlace={id:"third",players:losers,winner:null,status:"live",liveYoutube1:"",liveYoutube2:""}}}}
function addLivePlayerToDraw(s,player){
  if(!s.rounds?.length)return;
  const locked=new Set();
  for(const r of s.rounds)for(const m of r.matches||[])if(m.status==="live"||m.status==="done")for(const p of m.players||[])if(p&&pn(p)!=="TBD")locked.add(pn(p));
  if(s.thirdPlace?.status==="live"||s.thirdPlace?.status==="done")for(const p of s.thirdPlace.players||[])if(p&&pn(p)!=="TBD")locked.add(pn(p));
  const first=s.rounds[0],pool=[];
  for(const m of first.matches||[])if(m.status!=="live"&&m.status!=="done"){for(const p of m.players||[])if(p&&pn(p)!=="TBD")pool.push(p);m.players=[null,null];m.winner=null;m.status="waiting";m.liveYoutube1="";m.liveYoutube2=""}
  pool.push(player);
  for(const p of s.players||[])if(p&&pn(p)!=="TBD"&&!locked.has(pn(p))&&!pool.some(x=>pn(x)===pn(p)))pool.push(p);
  shuffle(pool);let pi=0;
  for(const m of first.matches||[]){if(m.status==="live"||m.status==="done")continue;m.players=[pool[pi++]||null,pool[pi++]||null];m.winner=null;m.status=m.players[0]&&m.players[1]?"live":m.players[0]?"bye":"waiting";m.liveYoutube1="";m.liveYoutube2=""}
  while(pi<pool.length){const id="r1m"+(first.matches.length+1),a=pool[pi++],b=pool[pi++];first.matches.push({id,players:[a,b||null],winner:null,status:b?"live":"bye",liveYoutube1:"",liveYoutube2:""})}
  for(let i=0;i<first.matches.length;i++){const m=first.matches[i];if(m.status==="bye"&&m.players[0]){m.winner=m.players[0];m.status="done";const next=s.rounds[1]?.matches[Math.floor(i/2)];if(next&&!next.players[i%2])next.players[i%2]=m.winner;if(next&&next.players[0]&&next.players[1]&&next.status!=="done"){next.status="live";next.liveYoutube1="";next.liveYoutube2=""}}}
}
async function handler(req,res){try{const action=(req.query&&req.query.action)||"state";if(action==="state"){const s=await get();return json(res,200,{...s,admin:isAdmin(req)})}
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
if(action==="start"){if(s.players.length<2)return json(res,400,{error:"Minimal 2 player"});if(s.status!=="setup")return json(res,400,{error:"Tournament sudah dimulai"});s=init();s.players=(await get()).players;s.rounds=build(s.players).rounds;s.status="live";for(let i=0;i<s.rounds[0].matches.length;i++){let m=s.rounds[0].matches[i];if(m.status==="bye"){const w=m.players.find(Boolean);m.winner=w;m.status="done";const next=s.rounds[1]?.matches[Math.floor(i/2)];if(next){next.players[i%2]=w;if(next.players[0]&&next.players[1]){next.status="live";next.liveYoutube1="";next.liveYoutube2=""}}}}await save(s);return json(res,200,{ok:true})}
if(action==="set-live"){
 const mid=String(b.matchId||"");let found=mid==="third"?s.thirdPlace:null;
 if(!found)for(const r of s.rounds)for(const m of r.matches)if(m.id===mid)found=m;
 if(!found)return json(res,404,{error:"Match tidak ditemukan"});
 if(found.status==="done")return json(res,400,{error:"Match sudah selesai"});
 if(!found.players?.[0]||!found.players?.[1])return json(res,400,{error:"Match belum memiliki 2 player"});
 found.status="live";
 const vals=[cleanYoutube(b.youtube1),cleanYoutube(b.youtube2)];
 for(let i=0;i<2;i++){
   const raw=vals[i],n=i+1;
   found["liveYoutube"+n]="";found["liveChannel"+n]="";
   if(!raw)continue;
   if(/^@[\w.-]+$/.test(raw)||/^https?:\/\/(www\.)?youtube\.com\/@[\w.-]+/i.test(raw)){
     const x=await findLiveFromChannel(raw);
     found["liveChannel"+n]=x.handle;
     found["liveChannelId"+n]=x.channelId;
     found["liveTitle"+n]=x.title;
     if(x.videoId)found["liveYoutube"+n]="https://www.youtube.com/watch?v="+x.videoId;
   }else{
     found["liveYoutube"+n]=raw;
   }
 }
 if(!found.liveYoutube1&&!found.liveYoutube2)return json(res,400,{error:"Channel ditemukan, tetapi channel tersebut saat ini tidak sedang LIVE."});
 await save(s);return json(res,200,{ok:true,state:s});
}
if(action==="winner"){if(s.status!=="live"&&s.status!=="completed")return json(res,400,{error:"Tournament belum dimulai"});let found=null;if(b.matchId==="third")found=s.thirdPlace;else for(const r of s.rounds)for(const m of r.matches)if(m.id===b.matchId)found=m;if(!found||found.status!=="live")return json(res,400,{error:"Match tidak live"});const w=found.players.find(p=>pn(p)===b.playerName);if(!w)return json(res,400,{error:"Player tidak ditemukan di match"});if(b.matchId==="third"){found.winner=w;s.podium.third=w;found.status="done"}else{let ri=s.rounds.findIndex(r=>r.matches.some(m=>m.id===found.id)),mi=s.rounds[ri].matches.findIndex(m=>m.id===found.id);advance(s,ri,mi,w)}maybeThird(s);const anyLive=[...s.rounds.flatMap(r=>r.matches||[]),s.thirdPlace].some(m=>m&&m.status==="live");if(s.podium.first&&s.podium.second&&!anyLive)s.status="completed";await save(s);return json(res,200,{ok:true,state:s})}
if(action==="reset"){await save(init());return json(res,200,{ok:true})}
return json(res,404,{error:"Action tidak dikenal"})}catch(e){console.error(e);return json(res,500,{error:"Server error",detail:String(e.message||e)})}}
module.exports=handler;
