const $=s=>document.querySelector(s);let state=null;
function name(p){return typeof p==="string"?p:(p?.name||"TBD")}
function esc(x){return String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;")}
function escAttr(x){return esc(x).replaceAll("'","&#39;")}
async function api(action,body){const r=await fetch("/api/index?action="+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(d.error||"Request gagal");return d}
function drawConnectors(container){const svg=container.querySelector("svg.bracket-lines"),bracketEl=container.querySelector(":scope > .bracket");if(!svg||!bracketEl)return;const w=bracketEl.offsetWidth,h=bracketEl.offsetHeight;svg.setAttribute("width",w);svg.setAttribute("height",h);svg.setAttribute("viewBox",`0 0 ${w} ${h}`);const refRect=bracketEl.getBoundingClientRect();const rounds=[...bracketEl.querySelectorAll(":scope > .round:not(.third-place)")];let html="";rounds.forEach((roundEl,ri)=>{if(ri===rounds.length-1)return;const nextMatches=rounds[ri+1].querySelectorAll(".match"),matches=roundEl.querySelectorAll(".match");matches.forEach((m,mi)=>{const t=nextMatches[Math.floor(mi/2)];if(!t)return;const r1=m.getBoundingClientRect(),r2=t.getBoundingClientRect(),x1=r1.right-refRect.left,y1=r1.top+r1.height/2-refRect.top,x2=r2.left-refRect.left,y2=r2.top+r2.height/2-refRect.top,midX=x1+(x2-x1)/2;html+=`<path d="M ${x1} ${y1} H ${midX} V ${y2} H ${x2}" fill="none" stroke="rgba(207,118,255,.35)" stroke-width="2"/>`});});svg.innerHTML=html}
function bracket(s){const el=$("#adminBracket");if(!s.rounds?.length){el.innerHTML='<div class="empty">Bracket belum dimulai.</div>';return}const roundsHtml=s.rounds.map(r=>`<div class="round"><h3>${r.name}</h3><div class="matches">${r.matches.map(m=>`<div class="match ${m.status==="live"?"live":""}">${m.players.map(p=>{const n=name(p),win=m.winner&&name(m.winner)===n,los=m.winner&&!win;return `<div class="slot ${win?"win":""} ${los?"lose":""}" ${m.status==="live"&&n!=="TBD"?`data-mid="${m.id}" data-name="${encodeURIComponent(n)}"`:""}>${n}<span class="tag">${win?"WIN":m.status==="live"?"KLIK MENANG":""}</span></div>`}).join("")}</div>`).join("")}</div></div>`).join("");const thirdHtml=s.thirdPlace?`<div class="round third-place"><h3>3RD PLACE</h3><div class="matches"><div class="match ${s.thirdPlace.status==="live"?"live":""}">${s.thirdPlace.players.map(p=>{const n=name(p);return `<div class="slot" ${s.thirdPlace.status==="live"&&n!=="TBD"?`data-mid="third" data-name="${encodeURIComponent(n)}"`:""}>${n}<span class="tag">${s.thirdPlace.status==="live"?"KLIK MENANG":""}</span></div>`}).join("")}</div></div></div>`:"";el.innerHTML=`<svg class="bracket-lines"></svg><div class="bracket admin-bracket">${roundsHtml}${thirdHtml}</div>`;el.querySelectorAll("[data-mid]").forEach(x=>x.onclick=()=>winner(x.dataset.mid,decodeURIComponent(x.dataset.name)));requestAnimationFrame(()=>drawConnectors(el))}
function liveEditors(s){
 const live=[...(s.rounds||[]).flatMap(r=>r.matches||[]),s.thirdPlace].filter(x=>x&&x.status==="live");
 const el=$("#liveEditors");if(!el)return;
 if(!live.length){el.innerHTML='<div class="empty">Belum ada match live.</div>';return}
 const stat=(url,youtube)=>url?"🟢 LIVE terdeteksi":(youtube?"⏳ Menunggu live channel...":"⚪ Belum ada link YouTube di Player List");
 el.innerHTML=live.map(m=>{
   const p1=m.players?.[0],p2=m.players?.[1],n1=name(p1),n2=name(p2);
   return `<div class="admin-live-card"><strong>🔴 ${esc(n1)} vs ${esc(n2)}</strong>
   <small>${m.id} • Live diambil otomatis dari link YouTube masing-masing player (atur/ubah di PLAYER LIST di atas).</small>
   <div class="live-status-row" style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap;font-size:10px">
     <span>${esc(n1)}: ${stat(m.liveYoutube1,p1?.youtube)}</span>
     <span>${esc(n2)}: ${stat(m.liveYoutube2,p2?.youtube)}</span>
   </div></div>`
 }).join("");
}
window.addEventListener("resize",()=>{const c=$("#adminBracket");if(c)drawConnectors(c)});
async function load(forceLive=false){
 try{
  const r=await fetch("/api/index?action=state",{cache:"no-store"});if(!r.ok)throw Error("API "+r.status);
  state=await r.json();
  if(state.admin){
   $("#loginBox").hidden=true;$("#panel").hidden=false;
   renderPlayers();
   const active=document.activeElement;
   const editingLive=active&&active.closest&&active.closest("#liveEditors");
   if(forceLive||!editingLive)liveEditors(state);
   bracket(state);
  }else{$("#loginBox").hidden=false;$("#panel").hidden=true}
 }catch(e){$("#loginMsg").textContent=e.message}
}
function renderPlayers(){const p=state.players||[];$("#count").textContent=p.length+" PLAYER";$("#players").innerHTML=p.map((x,i)=>`<div class="player-row"><input data-n="${i}" class="pn" value="${esc(name(x))}"><input data-y="${i}" class="py" value="${esc(x?.youtube||"")}" placeholder="YouTube default (opsional)"><button data-save="${i}">SAVE</button></div>`).join("");document.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{const i=b.dataset.save;try{await api("update-player",{index:+i,name:$(`.pn[data-n="${i}"]`).value,youtube:$(`.py[data-y="${i}"]`).value});$("#adminMsg").textContent="Player tersimpan.";load(true)}catch(e){$("#adminMsg").textContent=e.message}})}
async function winner(mid,n){if(!confirm("Menangkan "+n+"?"))return;try{await api("winner",{matchId:mid,playerName:n});$("#adminMsg").textContent=n+" menang dan otomatis maju.";load(true)}catch(e){$("#adminMsg").textContent=e.message}}
$("#loginForm").onsubmit=async e=>{e.preventDefault();try{await api("login",{username:$("#username").value,password:$("#password").value});load(true)}catch(x){$("#loginMsg").textContent=x.message}}
$("#addForm").onsubmit=async e=>{e.preventDefault();try{await api("add-player",{name:$("#playerName").value,youtube:$("#playerYoutube").value});$("#playerName").value="";$("#playerYoutube").value="";$("#adminMsg").textContent="Player ditambahkan.";load(true)}catch(x){$("#adminMsg").textContent=x.message}}
$("#startBtn").onclick=async()=>{if(!confirm("Mulai/randomize bracket sekarang?"))return;try{await api("start");$("#adminMsg").textContent="Bracket dimulai.";load(true)}catch(e){$("#adminMsg").textContent=e.message}}
$("#resetBtn").onclick=async()=>{if(!confirm("RESET SEMUA DATA TURNAMEN?"))return;try{await api("reset");$("#adminMsg").textContent="Tournament di-reset.";load(true)}catch(e){$("#adminMsg").textContent=e.message}}
$("#logoutBtn").onclick=async()=>{await api("logout");location.reload()};
load(true);setInterval(()=>{if(state)load(false)},2000);
