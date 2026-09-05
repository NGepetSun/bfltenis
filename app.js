const $=s=>document.querySelector(s);
function yt(url){if(!url)return null;let raw=String(url).trim();if(!raw)return null;if(/^[a-zA-Z0-9_-]{11}$/.test(raw))return `https://www.youtube.com/embed/${raw}?autoplay=1&mute=1&playsinline=1&rel=0`;if(!/^https?:\/\//i.test(raw))raw="https://"+raw;let id=null;try{const u=new URL(raw);id=u.searchParams.get("v");if(!id&&u.hostname.includes("youtu.be"))id=u.pathname.slice(1).split("/")[0];if(!id){const m=u.pathname.match(/\/(?:live|shorts|embed)\/([^/?]+)/);if(m)id=m[1]}}catch{}if(!id){const m=raw.match(/(?:v=|youtu\.be\/|\/(?:live|shorts|embed)\/)([a-zA-Z0-9_-]{11})/);if(m)id=m[1]}return id?`https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`:null}
function name(p){return typeof p==="string"?p:(p?.name||"TBD")}
function esc(x){return String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;")}
function drawConnectors(container){const svg=container.querySelector("svg.bracket-lines"),bracketEl=container.querySelector(":scope > .bracket");if(!svg||!bracketEl)return;const w=bracketEl.offsetWidth,h=bracketEl.offsetHeight;svg.setAttribute("width",w);svg.setAttribute("height",h);svg.setAttribute("viewBox",`0 0 ${w} ${h}`);const refRect=bracketEl.getBoundingClientRect();const rounds=[...bracketEl.querySelectorAll(":scope > .round:not(.third-place)")];let html="";rounds.forEach((roundEl,ri)=>{if(ri===rounds.length-1)return;const nextMatches=rounds[ri+1].querySelectorAll(".match"),matches=roundEl.querySelectorAll(".match");matches.forEach((m,mi)=>{const t=nextMatches[Math.floor(mi/2)];if(!t)return;const r1=m.getBoundingClientRect(),r2=t.getBoundingClientRect(),x1=r1.right-refRect.left,y1=r1.top+r1.height/2-refRect.top,x2=r2.left-refRect.left,y2=r2.top+r2.height/2-refRect.top,midX=x1+(x2-x1)/2;const won=m.querySelector(".win");html+=`<path d="M ${x1} ${y1} H ${midX} V ${y2} H ${x2}" fill="none" stroke="${won?"rgba(255,216,117,.6)":"rgba(207,118,255,.35)"}" stroke-width="2"/>`});});svg.innerHTML=html}
function bracket(state){const el=$("#bracket");if(!state.rounds?.length){el.innerHTML='<div class="empty">Bracket belum dimulai admin.</div>';return}const roundsHtml=state.rounds.map(r=>`<div class="round"><h3>${r.name}</h3><div class="matches">${r.matches.map(m=>`<div class="match ${m.status==="live"?"live":""}">${m.players.map(p=>{const n=name(p),win=m.winner&&name(m.winner)===n,los=m.winner&&!win;return `<div class="slot ${win?"win":""} ${los?"lose":""}">${n}<span class="tag">${win?"WIN":m.status==="live"?"LIVE":""}</span></div>`}).join("")}</div>`).join("")}</div></div>`).join("");const thirdHtml=state.thirdPlace?`<div class="round third-place"><h3>3RD PLACE</h3><div class="matches"><div class="match ${state.thirdPlace.status==="live"?"live":""}">${state.thirdPlace.players.map(p=>`<div class="slot">${name(p)}<span class="tag">${state.thirdPlace.status==="live"?"LIVE":""}</span></div>`).join("")}</div></div></div>`:"";el.innerHTML=`<svg class="bracket-lines"></svg><div class="bracket">${roundsHtml}${thirdHtml}</div>`;requestAnimationFrame(()=>drawConnectors(el))}
let lastCourtSig=null;
function courtSignature(live){
 return live.map(m=>{
   const p1=m.liveYoutube1||m.liveYoutube||"",p2=m.liveYoutube2||"";
   return [m.id,m.status,p1,p2,(m.players||[]).map(name).join(",")].join(":");
 }).join("|");
}
function videoSlot(url,playerObj,fallbackLabel){
 const u=yt(url),pname=name(playerObj)||fallbackLabel;
 const link=String(url||"").trim(),href=/^https?:\/\//i.test(link)?link:"https://"+link;
 return `<div class="video-slot">
   <div class="video-frame">${u?`<iframe src="${u}" title="BFL Tennis Live - ${esc(pname)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`:'<div class="empty">Live belum diatur admin.</div>'}</div>
   <div class="video-name">${esc(pname)}</div>
   ${link?`<a class="watch-link" href="${href}" target="_blank" rel="noopener">Buka YouTube ↗</a>`:""}
 </div>`;
}
function court(state){
 const live=[...(state.rounds||[]).flatMap(r=>r.matches||[]),state.thirdPlace].filter(x=>x&&x.status==="live");
 const el=$("#court");
 if(!live.length){
   if(lastCourtSig!=="")el.innerHTML='<div class="empty">Belum ada live streaming.<br>Admin dapat menambahkan link saat pertandingan berjalan.</div>';
   lastCourtSig="";
   return;
 }
 const sig=courtSignature(live);
 if(sig===lastCourtSig)return; // data tidak berubah -> jangan render ulang (biar iframe tidak reload / blank)
 lastCourtSig=sig;
 el.innerHTML=live.map(m=>{
   const players=m.players||[];
   const p1=m.liveYoutube1||m.liveYoutube||"",p2=m.liveYoutube2||"";
   const title=players.map(name).join("  vs  "),safe=String(m.id).replace(/[^a-zA-Z0-9_-]/g,"");
   const slots=[videoSlot(p1,players[0],"Pemain 1"),videoSlot(p2,players[1],"Pemain 2")];
   return `<article class="video-card" data-court="${safe}">
     <div class="video-card-head"><span class="live-dot">● LIVE</span><span class="match-name">${esc(title)}</span></div>
     <div class="video-grid dual">${slots.join("")}</div>
   </article>`;
 }).join("");
}
function podium(s){$("#podium").innerHTML=[["🥇","JUARA 1",s.podium?.first,"Rp 500.000"],["🥈","JUARA 2",s.podium?.second,"Rp 300.000"],["🥉","JUARA 3",s.podium?.third,"Rp 200.000"]].map(x=>`<div class="place"><b>${x[0]}</b><span>${x[1]}</span><strong>${name(x[2])}</strong><small>${x[3]}</small></div>`).join("")}
async function load(){try{const r=await fetch("/api/index?action=state",{cache:"no-store"});if(!r.ok)throw Error("API "+r.status);const d=await r.json();const live=[...(d.rounds||[]).flatMap(r=>r.matches||[]),d.thirdPlace].some(x=>x&&x.status==="live");$("#statusText").textContent=d.status==="completed"?"COMPLETED":live?"● LIVE":"WAITING";$("#topStatus").textContent=live?"● LIVE":"● "+(d.status||"OFFLINE").toUpperCase();$("#topStatus").classList.toggle("live",live);$("#updated").textContent=new Date().toLocaleTimeString();court(d);bracket(d);podium(d)}catch(e){$("#statusText").textContent="OFFLINE";$("#topStatus").textContent="● OFFLINE";$("#topStatus").classList.remove("live")}}
window.addEventListener("resize",()=>{const c=$("#bracket");if(c)drawConnectors(c)});load();setInterval(load,1500);
