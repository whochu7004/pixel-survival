(() => {
"use strict";
/* ================= 클라우드 저장 (구글 로그인) 설정 =================
   Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → firebaseConfig 값을 그대로 붙여 넣으세요.
   비워 두면 클라우드 저장 기능이 꺼진 채로 동작해요. (apiKey는 공개돼도 괜찮은 값이에요 — 보안은 Firestore 규칙이 지켜요) */
const CLOUD_CONFIG={
 apiKey:"AIzaSyBGdSIERC_zLzlLljHV4FnSlK6-wlFkhqE",
 authDomain:"pixel-survivors-50404.firebaseapp.com",
 projectId:"pixel-survivors-50404",
 appId:"1:454016966243:web:e531ef450ea40ebe942256"
};
const canvas=document.getElementById("game"),ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
const W=canvas.width,H=canvas.height,TILE=32,$=id=>document.getElementById(id);
/* 화면(W×H)은 그대로, 맵(월드)만 넓게 */
/* 스토리 맵 크기 (화면의 몇 배) · 배경 해상도(2 = 절반 해상도로 저장해 메모리 1/4, 화면에는 2배로 확대해 그림) */
const STORY_SCALE=7,BG_RES=2;
let WORLD_SCALE=STORY_SCALE,WW=W*WORLD_SCALE,WH=H*WORLD_SCALE;
const cam={x:0,y:0};
/* ===== 마법의 탑 난이도 (층이 오를수록) — 숫자만 바꿔서 조절하세요 =====
   fl = 현재 층 - 1 (1층이면 0)
   적 체력 배율  = 1 + fl*hpLin + fl*fl*hpQuad        (10층 ≈ 3.1배 / 50층 ≈ 20배 / 100층 ≈ 60배)
   적 공격 배율  = 1 + fl*dmg  (적 탄환 피해는 1 + fl*bulletDmg)
   이동 속도     = 기본 + min(speedMax, fl*speedPerFloor)
   출현 간격     = 기본 × max(spawnMin, 1 - fl*spawnPerFloor)
   바위형 비율   = min(tankMax, tankBase + fl*tankPerFloor)
   정예 적       = eliteFrom층부터, 확률 min(eliteMax, (층-eliteFrom+1)*elitePerFloor) · 체력 3배 · 공격 1.5배
   보스 체력     = bossHp × 적 체력 배율 (용은 × dragonMul)
   처치 목표     = floorBase + 층*floorPerFloor          (1층 9 / 10층 13 / 50층 33 / 100층 58)
                   lateFrom층을 넘으면 + (층-lateFrom)*latePerFloor 추가 (101층 61 / 150층 208 / 200층 358)
   출현 속도     = 탑에서만 spawnBoost배 더 빠르게 (위의 층별 출현 간격과 곱해짐) */
const TOWER_DIFF={worldScale:1.5,floorBase:8,floorPerFloor:.5,lateFrom:100,latePerFloor:2.5,spawnBoost:2,hpLin:.2,hpQuad:.004,dmg:.06,bulletDmg:.03,speedPerFloor:2.5,speedMax:60,spawnPerFloor:.02,spawnMin:.4,tankBase:.1,tankPerFloor:.01,tankMax:.45,eliteFrom:10,elitePerFloor:.005,eliteMax:.2,bossHp:450,dragonMul:2.5};
function towerHpMul(){const fl=(state.floor||1)-1,D=TOWER_DIFF;return 1+fl*D.hpLin+fl*fl*D.hpQuad}
function setWorld(scale){WORLD_SCALE=scale;WW=W*scale;WH=H*scale}
function setCam(){const p=state&&state.p;if(!p)return;cam.x=Math.round(clamp(p.x-W/2,0,WW-W));cam.y=Math.round(clamp(p.y-H/2,0,WH-H))}
const ui={start:$("startOverlay"),level:$("levelOverlay"),over:$("gameOverOverlay"),pause:$("pauseBadge"),choices:$("upgradeChoices"),hpText:$("hpText"),hpFill:$("hpFill"),expText:$("expText"),expFill:$("expFill"),levelText:$("levelText"),timeText:$("timeText"),killsText:$("killsText"),finalStats:$("finalStats"),worldExpText:$("worldExpText"),worldExpFill:$("worldExpFill")};
const ending=(()=>{const d=document.createElement("div");d.id="endingOverlay";d.className="overlay hidden";d.innerHTML='<div class="panel"><p class="eyebrow">THE END</p><h2 data-i18n="endTitle">이그니는 둥지로 돌아왔다</h2><p data-i18n="endText">식음의 그림자가 사라지자, 흩어졌던 불씨들이 둥지로 가는 길을 밝혀 주었습니다. 어미 불꽃이 다시 활활 타오릅니다.</p><p id="endingStats"></p><div class="panel-actions"><button id="endingRetry" class="primary-button" type="button" data-i18n="retry">다시 도전</button><button id="endingTitle" class="ghost-button big" type="button" data-i18n="toTitle">타이틀로</button></div></div>';(canvas.closest(".game-frame")||document.body).appendChild(d);d.querySelector("#endingRetry").addEventListener("click",()=>reset());d.querySelector("#endingTitle").addEventListener("click",()=>showTitle());return d})();
const keys=new Set(),rand=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),dist2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2,fmtTime=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;
let state,lastTime=0,raf=0,gameMode="story",gameDiff="easy";
/* ===== 하드 모드 디버프 (이지 = 기본 난이도) — 숫자만 바꿔서 조절하세요 ===== */
const TOWER_LIVES={easy:3,hard:1};
const TOWER_HARD_UNLOCK=100; // 마법의 탑 하드 해금: 이지에서 이 층을 돌파(다음 층 도달)해야 열려요 // 마법의 탑 목숨 (죽으면 1개 잃고 시작 지점에서 부활, 0개가 되면 끝)
/* ===== 난이도별 적 강화 — 적 쪽 배율, 숫자만 바꿔서 조절하세요 =====
   hp 일반 적 체력 · bossHp 보스 체력 · dmg 받는 피해 · spd 적 이동 속도 · spawn 출현 간격(작을수록 많이 나옴)
   하드는 이 배율에 더해 플레이어 디버프(HARD)가 따로 걸려요 */
const ENEMY_UP={easy:{hp:1.8,bossHp:1.5,dmg:1.6,spd:1.12,spawn:.65},hard:{hp:1.15,bossHp:1.1,dmg:1.1,spd:1.03,spawn:.9}};
const EASY_UP=ENEMY_UP.easy,upT=()=>ENEMY_UP[state&&state.diff==="hard"?"hard":"easy"],spawnGapMul=()=>upT().spawn;
function easyScale(){const U=upT();for(const e of state.enemies)if(!e.ez){e.ez=1;e.xb=e.maxHp/(e.hpMul||1);const m=e.boss?U.bossHp:U.hp;e.hp*=m;e.maxHp=(e.maxHp||e.hp/m)*m;if(e.speed)e.speed*=U.spd}}
const HARD={hp:.7,atk:.75,dmgTaken:1.25,spd:.95,rate:1.1,pick:.8,xp:.7,heal:.5}; // 최대 체력 · 공격력 · 받는 피해 · 이동 속도 · 공격 간격 · 흡수 범위 · 경험치 · 회복량 (배율) + 캐릭터 패시브 비활성화
const dbg={on:false,god:false,nomob:false};
/* ===== 모바일 터치 조작 (가상 조이스틱) ===== */
const joy={on:false,x:0,y:0};
const setTouchMode=()=>document.body.classList.add("touch");
if(matchMedia("(pointer:coarse)").matches||(navigator.maxTouchPoints>0&&!matchMedia("(hover:hover)").matches))setTouchMode();
document.addEventListener("pointerdown",e=>{if(e.pointerType==="touch")setTouchMode()},{passive:true});
document.addEventListener("contextmenu",e=>{if(document.body.classList.contains("touch"))e.preventDefault()});
(()=>{
const zone=$("joyZone"),base=$("joyBase"),knob=$("joyKnob"),R=52,DEAD=.14;let pid=null,ox=0,oy=0;
const release=()=>{pid=null;joy.on=false;joy.x=joy.y=0;knob.style.transform="";base.classList.add("idle");base.style.left=base.style.top=""};
function move(e){const r=zone.getBoundingClientRect();let fx=e.clientX-r.left,fy=e.clientY-r.top,dx=fx-ox,dy=fy-oy,d=Math.hypot(dx,dy);
if(d>R){ox=fx-dx/d*R;oy=fy-dy/d*R;base.style.left=ox+"px";base.style.top=oy+"px";dx=fx-ox;dy=fy-oy;d=R}
knob.style.transform=`translate(${dx}px,${dy}px)`;
const m=d/R;if(m<DEAD){joy.on=false;joy.x=joy.y=0}else{const k=Math.min(1,(m-DEAD)/(1-DEAD))/m;joy.on=true;joy.x=dx/R*k;joy.y=dy/R*k}}
zone.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"||pid!==null)return;e.preventDefault();pid=e.pointerId;try{zone.setPointerCapture(pid)}catch(_){}
const r=zone.getBoundingClientRect();ox=clamp(e.clientX-r.left,R+8,r.width-R-8);oy=clamp(e.clientY-r.top,R+8,r.height-R-8);
base.classList.remove("idle");base.style.left=ox+"px";base.style.top=oy+"px";move(e)});
zone.addEventListener("pointermove",e=>{if(e.pointerId===pid)move(e)});
for(const t of ["pointerup","pointercancel","lostpointercapture"])zone.addEventListener(t,e=>{if(e.pointerId===pid)release()});
})();
const SETTINGS_KEY="ps_settings_v1",settings=Object.assign({fireflies:true,vignette:true,autoPause:true,pixelFont:true,mapTheme:"forest",lang:/^ko/i.test(navigator.language||"ko")?"ko":"en"},(()=>{try{return JSON.parse(localStorage.getItem(SETTINGS_KEY))||{}}catch(_){return{}}})());
const saveSettings=()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}catch(_){}};
const MAP_THEMES=["forest","burnt","frozen","canyon","blossom","palace","cloud"];
const themeOf=()=>MAP_THEMES.includes(settings.mapTheme)?settings.mapTheme:"forest";
/* ===== 언어 (한국어 / English) ===== */
if(settings.lang!=="en")settings.lang="ko";
const isEN=()=>settings.lang==="en",tx=(ko,en)=>isEN()?en:ko,tf=(o,k)=>o&&isEN()&&o[k+"En"]!=null?o[k+"En"]:o&&o[k];
const gameTitle=()=>tx("최후의 불씨","THE LAST EMBER");
const worldXp=document.querySelector(".world-xp");if(worldXp)worldXp.style.display="none";
for(const id of ["hpFill","expFill"]){const s=document.getElementById(id)?.closest(".stat");if(s)s.style.display="none"}
const hudEl=document.querySelector(".hud");if(hudEl)hudEl.style.gridTemplateColumns="repeat(2,1fr)";
/* ===== 강화 아이콘 (16x16 도트) ===== */
const iconCache={},IK="#1a120c";
const icCirc=(g,x,y,r,c)=>{g.fillStyle=c;g.beginPath();g.arc(x,y,r,0,6.283);g.fill()};
const icPoly=(g,pts,c)=>{g.fillStyle=c;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill()};
const icRect=(g,x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(x,y,w,h)};
const icDrop=(g,cx,by,r,c)=>{icCirc(g,cx,by-r,r,c);icPoly(g,[[cx-r*.95,by-r*1.2],[cx+r*.1,by-r*2.9],[cx+r*.95,by-r*1.2]],c)};
const icFlame=(g,cx,by,s)=>{icDrop(g,cx,by+1,s+1,IK);icDrop(g,cx,by,s,"#e0523a");icDrop(g,cx,by-.5,s*.7,"#f08a2a");icDrop(g,cx,by-1,s*.4,"#ffd54a")};
const icStar=(g,cx,cy,ro,ri,n,c)=>{const pts=[];for(let i=0;i<n*2;i++){const a=i*Math.PI/n-Math.PI/2,r=i%2?ri:ro;pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r])}icPoly(g,pts,c)};
const ICON_DRAW={
ad:g=>icFlame(g,8,14,4),
ap:g=>{icRect(g,4,2,2,12,"#52606b");icRect(g,9,2,2,12,"#52606b");icPoly(g,[[0,8],[11,4.5],[11,11.5]],"#e0523a");icPoly(g,[[1,8],[11,6],[11,10]],"#f08a2a");icCirc(g,12,8,4.2,IK);icCirc(g,12,8,3.4,"#e0523a");icCirc(g,12.4,8,2.3,"#f08a2a");icCirc(g,12.8,8,1.2,"#ffd54a")},
ar:g=>{const C=[[4,9,3],[7,6.5,3.4],[7,11,3]];for(const [x,y,r] of C)icCirc(g,x,y,r+1,IK);for(const [x,y,r] of C)icCirc(g,x,y,r,"#d5dde2");icCirc(g,6,5,1.2,"#ffffff");icFlame(g,12,14,3)},
blade:g=>{g.strokeStyle="#a8501a";g.lineWidth=1.3;g.beginPath();g.arc(8,8,5.6,0,6.283);g.stroke();icCirc(g,8,8,2.4,IK);icCirc(g,8,8,1.6,"#e0523a");for(const a of [-1.57,.52,2.62]){const x=8+Math.cos(a)*5.6,y=8+Math.sin(a)*5.6;icCirc(g,x,y,2.7,IK);icCirc(g,x,y,2,"#f08a2a");icCirc(g,x,y,1,"#ffd54a")}},
bd:g=>{icCirc(g,8,9,6.3,IK);icCirc(g,8,9,5.3,"#3a2a28");icCirc(g,6.5,7.2,2,"#54464a");icRect(g,4,9,7,1,"#ff8a2a");icRect(g,8,5,1,8,"#ffd54a");icRect(g,6,11,3,1,"#f08a2a");icRect(g,9,7,3,1,"#ffd54a");icRect(g,2,3,1,1,"#ffd54a");icRect(g,13,2,1,1,"#ffd54a");icRect(g,14,6,1,1,"#ff8a2a")},
spore:g=>{icStar(g,8,8,7.8,4.4,8,IK);icStar(g,8,8,6.6,3.6,8,"#e0523a");icStar(g,8,8,5,3,8,"#f08a2a");icCirc(g,8,8,2.6,"#ffd54a");icCirc(g,8,8,1.1,"#fff7dc")},
storm:g=>{for(let i=9;i>=1;i--)icCirc(g,5+i*1.15,11-i*1.15,Math.max(1,3.8-i*.3),"#e0523a");for(let i=8;i>=1;i--)icCirc(g,5+i*1.15,11-i*1.15,Math.max(.7,2.4-i*.22),"#f08a2a");for(let i=5;i>=1;i--)icCirc(g,5+i*1.15,11-i*1.15,Math.max(.6,1.4-i*.2),"#ffd54a");icCirc(g,5,11,5,IK);icCirc(g,5,11,4.2,"#7a4a24");icCirc(g,3.8,9.8,1.7,"#c98a1d");icCirc(g,6.4,12.4,1.2,"#3a2a1c");icRect(g,12,3,1,1,"#fff7dc");icRect(g,14,6,1,1,"#ffd54a")},
speed:g=>{const P=[[3,14],[3,5],[8,8],[10,2],[12,8],[15,6],[13,14]];g.lineJoin="round";g.strokeStyle=IK;g.lineWidth=2.4;g.beginPath();P.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.stroke();icPoly(g,P,"#f08a2a");g.strokeStyle="#a8322a";g.lineWidth=1;for(const [x,y] of [[3,5],[10,2],[15,6]]){g.beginPath();g.moveTo(3,14);g.lineTo(x,y);g.stroke()}icRect(g,2,3,1,2,"#fff7dc")},
magnet:g=>{g.strokeStyle=IK;g.lineWidth=1.2;g.beginPath();g.arc(8,3.6,2.4,Math.PI,0);g.stroke();icRect(g,3,5,10,2,IK);icRect(g,4,6,8,8,"#5a3a1c");icRect(g,5,7,6,6,"#ffb04a");icFlame(g,8,13,1.6);icRect(g,3,13,10,2,IK);icRect(g,4,13,8,1,"#8a5a2c");icRect(g,1,9,1,1,"#ffd54a");icRect(g,14,8,1,1,"#ffd54a")},
heal:g=>{g.lineCap="round";g.strokeStyle=IK;g.lineWidth=3.6;g.beginPath();g.moveTo(9,9);g.lineTo(13,13);g.stroke();g.strokeStyle="#f2e8cf";g.lineWidth=2;g.beginPath();g.moveTo(9,9);g.lineTo(13,13);g.stroke();icCirc(g,14,12,2,IK);icCirc(g,12,14,2,IK);icCirc(g,14,12,1.2,"#f2e8cf");icCirc(g,12,14,1.2,"#f2e8cf");icCirc(g,6,6,6,IK);icCirc(g,6,6,5,"#b8602a");icCirc(g,5,5,3,"#e08a4a");icCirc(g,4,4,1.2,"#ffd0a0")},
heart:g=>{const P=[[3,3],[13,3],[13,9],[8,14],[3,9]];g.lineJoin="round";g.strokeStyle=IK;g.lineWidth=2.4;g.beginPath();P.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.stroke();icPoly(g,P,"#e0523a");for(const [x,y] of [[5,5],[8,5],[11,5],[6.5,7.5],[9.5,7.5],[8,10]]){icCirc(g,x,y,1.5,"#ff8a5a");icRect(g,x-1,y+1,2,1,"#a8322a")}}
};
function iconURL(id){if(iconCache[id])return iconCache[id];const f=ICON_DRAW[id];if(!f)return"";const c=document.createElement("canvas");c.width=c.height=16;const g=c.getContext("2d");f(g);const im=g.getImageData(0,0,16,16),d=im.data;for(let i=3;i<d.length;i+=4)d[i]=d[i]>110?255:0;g.putImageData(im,0,0);return iconCache[id]=c.toDataURL()}
/* ===== 주작 전용 강화 아이콘 (검기 / 불꽃의 검) ===== */
const icCres=(g,x,y,k,c)=>{g.save();g.translate(x,y);g.scale(k,k);g.fillStyle=c;g.beginPath();g.arc(-2,0,6.7,-1.2,1.2);g.arc(-9,0,11.3,.585,-.585,true);g.closePath();g.fill();g.restore()};
const icQi=(g,x,y,k,cs)=>{icCres(g,x,y,k*1.22,IK);icCres(g,x,y,k,cs[0]);icCres(g,x+.4*k,y,k*.78,cs[1]);icCres(g,x+.8*k,y,k*.5,cs[2])};
Object.assign(ICON_DRAW,{
ad_z:g=>{g.save();g.translate(8,8);g.rotate(-.785);icRect(g,-8,-1.6,3.6,3.2,IK);icRect(g,-7.4,-.8,2.6,1.6,"#a82020");icRect(g,-4.6,-4.6,3,9.2,IK);icRect(g,-4,-3.8,1.8,7.6,"#ffc83a");icRect(g,-2,-2.8,12.4,5.6,IK);icPoly(g,[[10,-2.8],[13.4,0],[10,2.8]],IK);icRect(g,-1.4,-1.8,11,3.6,"#e0523a");icRect(g,-1.4,-1.2,11,2.4,"#f08a2a");icPoly(g,[[9.6,-1.8],[12.2,0],[9.6,1.8]],"#f08a2a");icRect(g,-1,-.5,10,1,"#ffd54a");g.restore();icRect(g,2,2,1,1,"#ffd54a");icRect(g,13,13,1,1,"#ff8a2a");icRect(g,12,3,1,1,"#fff7dc")},
ap_z:g=>{icRect(g,3,1,2,14,"#52606b");icRect(g,7,1,2,14,"#52606b");icPoly(g,[[0,8],[9,4.5],[9,11.5]],"#a8322a");icPoly(g,[[1,8],[9,6],[9,10]],"#f08a2a");icQi(g,9.5,8,1,["#e0523a","#f08a2a","#ffd54a"])},
ar_z:g=>{icQi(g,3,8,.55,["#7a2a2a","#a8322a","#c8502a"]);icQi(g,6.8,8,.75,["#b8402a","#e0523a","#f08a2a"]);icQi(g,10.6,8,.92,["#e0523a","#f08a2a","#ffd54a"])}
});
/* ===== 주작 전용 레벨업 아이콘 (불꽃 깃털 / 불사조 테마) ===== */
const icFeather=(g,x,y,k,rot,cs)=>{g.save();g.translate(x,y);g.rotate(rot);g.scale(k,k);
 const P=s=>{g.beginPath();g.moveTo(-8*s,0);g.quadraticCurveTo(-2*s,-7*s,10*s,-.4*s);g.quadraticCurveTo(-1*s,6.4*s,-8*s,0);g.closePath()};
 g.lineJoin="round";g.strokeStyle=IK;g.lineWidth=2.2/k;P(1);g.stroke();
 g.fillStyle=cs[0];P(1);g.fill();g.fillStyle=cs[1];P(.78);g.fill();g.fillStyle=cs[2];P(.5);g.fill();
 g.fillStyle=IK;g.fillRect(-11,-1,5,2);g.fillStyle=cs[3]||"#ffd54a";g.fillRect(-10,-.5,5,1);g.restore()};
const FC=[["#7a2a2a","#a8322a","#e0802a","#ffb04a"],["#a8322a","#e0523a","#ffb04a","#ffd54a"],["#e0523a","#f08a2a","#ffd54a","#fff7dc"]];
Object.assign(ICON_DRAW,{
feather_z:g=>{[-1.3,-.82,-.34].forEach((a,i)=>icFeather(g,3.4+Math.cos(a)*7.2,13.2+Math.sin(a)*7.2,.72,a,FC[i]));icRect(g,1,4,1,1,"#ffd54a");icRect(g,13,13,1,1,"#ff8a2a")},
blade_z:g=>{g.strokeStyle="#7a3a1a";g.lineWidth=1.1;g.beginPath();g.arc(8,8,5.6,0,6.283);g.stroke();icCirc(g,8,8,2.6,IK);icCirc(g,8,8,1.9,"#f08a2a");icCirc(g,8,8,.9,"#fff7dc");[-1.57,.52,2.62].forEach((a,i)=>icFeather(g,8+Math.cos(a)*5.6,8+Math.sin(a)*5.6,.44,a+1.57,FC[2]))},
bd_z:g=>{icFeather(g,8,8.4,.86,-.75,FC[2]);icRect(g,2,3,1,1,"#ffd54a");icRect(g,13,2,1,3,"#fff7dc");icRect(g,12,3,3,1,"#fff7dc");icRect(g,13,13,1,1,"#ff8a2a")},
spore_z:g=>{for(let i=0;i<8;i++){const a=i*Math.PI/4;icFeather(g,8+Math.cos(a)*5.4,8+Math.sin(a)*5.4,.4,a,FC[i%2?1:2])}icCirc(g,8,8,3.2,IK);icCirc(g,8,8,2.4,"#f08a2a");icCirc(g,8,8,1.2,"#fff7dc")},
storm_z:g=>{icFeather(g,4.4,5.4,.7,-2.55,FC[1]);icFeather(g,11.6,5.4,.7,-.6,FC[1]);icFlame(g,8,14.6,4.2);icRect(g,7,2,2,2,"#ffd54a");icRect(g,2,12,1,1,"#ffd54a");icRect(g,13,12,1,1,"#ff8a2a")},
speed_z:g=>{[-.15,-.55,-.95].forEach((a,i)=>icFeather(g,5+Math.cos(a)*6.5,12.5+Math.sin(a)*6.5,.74,a,FC[i]));icRect(g,0,5,3,1,"#ffd54a");icRect(g,0,8,2,1,"#ff8a2a");icRect(g,1,11,2,1,"#ffd54a")},
magnet_z:g=>{g.lineJoin="round";g.fillStyle="#fff2c8";g.strokeStyle=IK;g.lineWidth=2;g.beginPath();g.moveTo(1,8);g.quadraticCurveTo(8,0,15,8);g.quadraticCurveTo(8,16,1,8);g.closePath();g.stroke();g.fill();icCirc(g,8,8,3.7,IK);icCirc(g,8,8,2.9,"#e0523a");icCirc(g,8,8,1.5,IK);icRect(g,6,6,1,1,"#fff7dc");icRect(g,2,2,1,2,"#ffd54a");icRect(g,8,0,1,2,"#ff8a2a");icRect(g,13,2,1,2,"#ffd54a")},
heal_z:g=>{icDrop(g,8,14.6,4.6,IK);icDrop(g,8,14,3.8,"#e0523a");icDrop(g,8,13.4,2.8,"#f08a2a");icDrop(g,8,12.8,1.6,"#ffd54a");icRect(g,5,9,1,2,"#fff7dc");icRect(g,2,3,1,1,"#ffd54a");icRect(g,13,5,1,1,"#ff8a2a")},
heart_z:g=>{icFeather(g,3.2,6.6,.55,-2.5,FC[1]);icFeather(g,12.8,6.6,.55,-.64,FC[1]);const P=[[4.5,6],[11.5,6],[11.5,10],[8,14],[4.5,10]];g.lineJoin="round";g.strokeStyle=IK;g.lineWidth=2.4;g.beginPath();P.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.stroke();icPoly(g,P,"#e0523a");icCirc(g,6.4,7.4,1.3,"#ff8a5a");icCirc(g,9.6,7.4,1.3,"#ff8a5a");icRect(g,7,10,2,1,"#a8322a")}
});

const upgrades=[
{id:"ad",name:"타오르는 불꽃",nameEn:"Blazing Flame",desc:"불꽃 피해 +1",descEn:"Flame damage +1",apply:()=>state.p.arrowDamage++},
{id:"ap",name:"꿰뚫는 화염",nameEn:"Piercing Fire",desc:"불꽃 관통 +3명",descEn:"Flame pierce +3",apply:()=>state.p.arrowPierce+=3},
{id:"ar",name:"깊은 숨",nameEn:"Deep Breath",desc:"불꽃 발사 간격 -6%",descEn:"Flame fire interval -6%",apply:()=>state.p.arrowRate=Math.max(.3,state.p.arrowRate*.94)},
{id:"blade",name:"맴도는 불씨",nameEn:"Orbiting Embers",desc:"회전 불씨 구슬 +2개",descEn:"Orbiting ember orbs +2",apply:()=>state.p.blades+=2},
{id:"bd",name:"뜨거운 불씨",nameEn:"Searing Embers",desc:"불씨 구슬 피해 +1",descEn:"Ember orb damage +1",apply:()=>state.p.bladeDamage++},
{id:"spore",name:"화염 폭발",nameEn:"Flame Burst",desc:"주기적 불 폭발 대폭 강화 (+2단계)",descEn:"Periodic fire burst greatly empowered (+2 levels)",apply:()=>state.p.pulse+=2},
{id:"storm",name:"메테오 소환",nameEn:"Meteor Call",desc:"하늘에서 메테오가 쏟아져요 (+3단계)",descEn:"Meteors rain from the sky (+3 levels)",apply:()=>state.p.lightning+=3},
{id:"speed",name:"작은 날갯짓",nameEn:"Little Wingbeat",desc:"이동 속도 +5%",descEn:"Move speed +5%",apply:()=>state.p.speed*=1.05},
{id:"magnet",name:"불씨 등불",nameEn:"Ember Lantern",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",apply:()=>state.p.pickup*=1.15},
{id:"heal",name:"노릇한 고기",nameEn:"Roasted Meat",desc:"체력 20 회복",descEn:"Restore 20 HP",apply:()=>state.p.hp=Math.min(state.p.maxHp,state.p.hp+20)},
{id:"heart",name:"단단한 비늘",nameEn:"Hard Scales",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",apply:()=>{state.p.maxHp+=20;state.p.hp=Math.min(state.p.maxHp,state.p.hp+20)}},
{id:"leech",name:"흡혈 송곳니",nameEn:"Vampire Fang",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",apply:()=>{state.p.killHeal=(state.p.killHeal||0)+1}}
];
/* ===== 등급 시스템 (커먼 회색 / 언커먼 초록 / 에픽 보라 / 레전더리 노랑 / 미스틱 빨강) ===== */
const RARITY={common:{n:"커먼",nEn:"Common",c:"#9aa0a8"},uncommon:{n:"언커먼",nEn:"Uncommon",c:"#4ade80"},epic:{n:"에픽",nEn:"Epic",c:"#b06cff"},legendary:{n:"레전더리",nEn:"Legendary",c:"#ffd54a"},mythic:{n:"미스틱",nEn:"Mythic",c:"#ff4a5a"}};
// 레벨업 강화: id -> [등급, 등장 확률(%)] (합계 100)
const UP_RARITY={leech:["uncommon",6],heal:["common",16],speed:["common",15],magnet:["common",14],ar:["common",15],ad:["uncommon",11],bd:["uncommon",9],heart:["uncommon",8],ap:["epic",2.5],blade:["epic",1.5],spore:["legendary",1.5],storm:["mythic",.5]};
upgrades.forEach(u=>{[u.rar,u.w]=UP_RARITY[u.id]});

/* ===== 레벨업 선택지: 부가 스탯(현재 → 적용 후) + 부가 설명 ===== */
const fmt=n=>Number.isInteger(n)?n:+n.toFixed(2);
const UP_INFO={
ad:{stats:p=>[[tx("불꽃 피해","Flame damage"),p.arrowDamage,p.arrowDamage+1],[tx("초당 피해","DPS"),fmt(p.arrowDamage/p.arrowRate),fmt((p.arrowDamage+1)/p.arrowRate)]],tip:"모든 불꽃의 기본 피해가 올라요. 초반에 가장 확실한 화력 강화예요.",tipEn:"Raises the base damage of every flame. The surest early power boost."},
ap:{stats:p=>[[tx("관통 수","Pierce"),p.arrowPierce,p.arrowPierce+3]],tip:"한 발로 여러 적을 꿰뚫어요. 줄지어 몰려오는 적에게 특히 좋아요.",tipEn:"One shot pierces many foes. Great against enemies lined up in a row."},
ar:{stats:p=>{const n=Math.max(.3,p.arrowRate*.94);return[[tx("발사 간격","Fire interval"),fmt(p.arrowRate)+tx("초","s"),fmt(n)+tx("초","s")],[tx("초당 발사","Shots / sec"),fmt(1/p.arrowRate),fmt(1/n)]]},tip:"더 자주 불꽃을 쏴요. 피해 강화와 함께 쓰면 효과가 곱절이에요.",tipEn:"Fire flames more often. Twice as effective with damage upgrades."},
blade:{stats:p=>[[tx("구슬 개수","Orbs"),p.blades,p.blades+2],[tx("구슬 피해 합계","Total orb damage"),p.blades*p.bladeDamage,(p.blades+2)*p.bladeDamage]],tip:"몸 주위를 도는 구슬이 늘어나 가까이 붙은 적을 빈틈없이 막아줘요.",tipEn:"More orbs circle your body, shielding you from enemies up close."},
bd:{stats:p=>[[tx("구슬 피해","Orb damage"),p.bladeDamage,p.bladeDamage+1],[tx("구슬 피해 합계","Total orb damage"),p.blades*p.bladeDamage,p.blades*(p.bladeDamage+1)]],tip:"구슬이 많을수록 더 큰 효과! 맴도는 불씨와 궁합이 좋아요.",tipEn:"The more orbs, the bigger the payoff! Great with Orbiting Embers."},
spore:{stats:p=>[[tx("폭발 단계","Burst level"),p.pulse,p.pulse+2],[tx("폭발 범위","Burst radius"),72+p.pulse*10,72+(p.pulse+2)*10],[tx("폭발 피해","Burst damage"),p.pulse,p.pulse+2]],tip:"주기적으로 몸 주변이 폭발해요. 적에게 둘러싸였을 때 든든한 한 방!",tipEn:"Periodically explodes around you. A lifesaver when surrounded!"},
storm:{stats:p=>[[tx("메테오 단계","Meteor level"),p.lightning,p.lightning+3],[tx("메테오 피해","Meteor damage"),2+p.lightning,2+p.lightning+3]],tip:"하늘에서 메테오가 쏟아져요. 아주 드문 최상급 강화예요.",tipEn:"Meteors rain from the sky. An extremely rare top-tier upgrade."},
speed:{stats:p=>[[tx("이동 속도","Move speed"),Math.round(p.speed),Math.round(p.speed*1.05)]],tip:"적 사이를 빠져나가기 쉬워져요. 가만히 있으면 둘러싸여요!",tipEn:"Slip between enemies more easily. Stand still and you'll be surrounded!"},
magnet:{stats:p=>[[tx("흡수 범위","Pickup range"),Math.round(p.pickup),Math.round(p.pickup*1.15)]],tip:"불씨 조각을 멀리서도 끌어당겨 레벨업이 빨라져요.",tipEn:"Pull in ember shards from farther away to level up faster."},
heal:{stats:p=>{const n=Math.min(p.maxHp,p.hp+20);return[[tx("체력","HP"),Math.round(p.hp),Math.round(n)],[tx("체력 비율","HP %"),Math.round(p.hp/p.maxHp*100)+"%",Math.round(n/p.maxHp*100)+"%"]]},tip:"위험할 때 바로 쓰는 응급 회복이에요. 최대 체력은 늘지 않아요.",tipEn:"An emergency heal for tight spots. Does not raise max HP."},
leech:{stats:p=>[[tx("처치당 회복","Heal per kill"),p.killHeal||0,(p.killHeal||0)+1]],tip:"적을 쓰러뜨릴 때마다 조금씩 회복해요. 적이 많이 몰려올수록 든든해요.",tipEn:"Heal a little with every kill. The bigger the horde, the better it gets."},
heart:{stats:p=>[[tx("최대 체력","Max HP"),p.maxHp,p.maxHp+20],[tx("현재 체력","Current HP"),Math.round(p.hp),Math.round(Math.min(p.maxHp+20,p.hp+20))]],tip:"더 오래 버티는 튼튼한 몸! 최대 체력이 늘고 그만큼 회복돼요.",tipEn:"A sturdier body to last longer! Raises max HP and heals the same amount."}
};
upgrades.forEach(u=>{u.info=UP_INFO[u.id]});
/* ===== 주작 전용 레벨업 문구/아이콘 (캐릭터를 바꾸면 자동으로 원래 문구로 돌아와요) ===== */
const ZQ=1.5,ZR=1.25;
/* ================= 사신 · 황룡 전용 고유 스킬 (레벨업 카드) =================
   회전 구슬 · 주기 폭발 · 메테오 같은 공용 강화 대신, 캐릭터마다 완전히 다른 방식으로 싸우는 스킬이에요.
   SKN: 수치 — 숫자만 바꿔서 조절하세요 (dmg/dps는 기본 공격 피해 배율 · cd 대기 초 · per 단계당 변화) */
const skL=(p,id)=>(p&&p["sk_"+id])||0;
const SKN={
 z_echo:{delay:.22,dmg:.45,per:.2},
 z_trail:{gap:18,life:1.6,per:.5,r:16,dps:.9},
 z_dive:{cd:22,per:5,dmg:6,band:60,time:1.1},
 h_spike:{n:5,per:2,dmg:1.1},
 h_vortex:{every:3,time:2.2,per:.6,r:64,rp:12,pull:110,dps:.6},
 h_tide:{cd:14,per:3,dmg:2.2,len:640,h:300,time:1.7},
 h_stance:{still:.7,red:.4,reach:1.4,atk:1.3},
 b_prey:{cd:6,per:1.5,taken:.35,heal:3,range:420},
 b_ghost:{hits:2,dmg:.85,r:72,gap:.18},
 b_chain:{range:280},
 b_roar:{cd:16,per:4,r:280,time:2.2,rend:3},
 c_web:{time:3,r:100,rp:18,dps:.7},
 c_spout:{speed:70,stun:1,ps:.35,dmg:2.2},
 c_ascend:{cd:22,per:5,time:3,spd:1.6,gap:.14,r:240,dmg:1.6},
 w_ley:{win:1.3,dist:230,dp:25,dmg:1,w:12,life:.6},
 w_form:{r:330,marks:1,dmg:1.2},
 w_desc:{cd:30,per:7,dmg:3,time:1.5,marks:2}};
const skLv=(id,p,pct)=>{const l=skL(p,id);return[tx("단계","Level"),l?"Lv "+l:"—","Lv "+(l+1)]};
const SK={
// ---- 주작 ----
z_echo:{max:3,name:"불새 분신",nameEn:"Phoenix Echo",desc:"뒤따르는 불새 분신이 검기를 한 박자 늦게 한 번 더 베어요",descEn:"A phoenix echo trails you and repeats every sword wave a beat later",icon:"z_echo",
 stats:p=>{const l=skL(p,"z_echo"),N=SKN.z_echo,v=k=>Math.round((N.dmg+N.per*(k-1))*100)+"%";return[skLv("z_echo",p),[tx("분신 검기 피해","Echo damage"),l?v(l):"—",v(l+1)]]},tip:"검기 · 관통 강화가 분신에도 그대로 적용돼요.",tipEn:"Your sword-wave upgrades carry over to the echo."},
z_trail:{max:4,name:"업화의 발자취",nameEn:"Trail of Hellfire",desc:"움직인 자리에 불길이 남아 밟은 적을 태워요 (화상)",descEn:"You leave a trail of flames that burns foes who cross it",icon:"z_trail",
 stats:p=>{const l=skL(p,"z_trail"),N=SKN.z_trail;return[skLv("z_trail",p),[tx("불길 유지","Flame duration"),l?fmt(N.life+N.per*(l-1))+tx("초","s"):"—",fmt(N.life+N.per*l)+tx("초","s")]]},tip:"적 사이를 빙글빙글 돌며 불바다를 만들어 보세요.",tipEn:"Circle through the horde to turn the ground into a sea of fire."},
z_dive:{max:3,name:"주작 강림",nameEn:"Zhuque Descends",desc:"거대한 불새가 화면을 가로질러 날며 지나는 길의 적을 모두 태워요",descEn:"A giant firebird sweeps across the screen, scorching everything in its path",icon:"z_dive",
 stats:p=>{const l=skL(p,"z_dive"),N=SKN.z_dive,cd=k=>Math.max(8,N.cd-N.per*(k-1))+tx("초","s");return[skLv("z_dive",p),[tx("강림 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"주작이 지나간 자리에는 화상이 남아요.",tipEn:"Every foe it passes is left burning."},
// ---- 현무 ----
h_spike:{max:4,name:"가시 물방울",nameEn:"Spiked Droplets",desc:"결계 물방울이 공격을 막을 때마다 사방으로 물 가시를 쏘아 반격해요",descEn:"Whenever a barrier droplet blocks a hit, it bursts into water spikes in all directions",icon:"h_spike",
 stats:p=>{const l=skL(p,"h_spike"),N=SKN.h_spike;return[skLv("h_spike",p),[tx("가시 수","Spikes"),l?N.n+N.per*(l-1):"—",N.n+N.per*l]]},tip:"맞을수록 강해지는 현무다운 반격이에요.",tipEn:"A Hyunmu-style counter that thrives on getting hit."},
h_vortex:{max:3,name:"소용돌이",nameEn:"Whirlpool",desc:"채찍 3번마다 끝자락에 소용돌이가 생겨 적을 한가운데로 빨아들여요",descEn:"Every 3rd whip leaves a whirlpool that drags foes into its center",icon:"h_vortex",
 stats:p=>{const l=skL(p,"h_vortex"),N=SKN.h_vortex;return[skLv("h_vortex",p),[tx("유지 시간","Duration"),l?fmt(N.time+N.per*(l-1))+tx("초","s"):"—",fmt(N.time+N.per*l)+tx("초","s")]]},tip:"모인 적을 다음 채찍으로 한꺼번에 후려치세요.",tipEn:"Gather them up, then lash them all at once."},
h_tide:{max:3,name:"북해의 해일",nameEn:"Northern Tidal Wave",desc:"주기적으로 거대한 해일이 앞쪽으로 밀려가 적을 쓸어 가요",descEn:"A huge tidal wave periodically rolls forward, sweeping foes away",icon:"h_tide",
 stats:p=>{const l=skL(p,"h_tide"),N=SKN.h_tide,cd=k=>Math.max(6,N.cd-N.per*(k-1))+tx("초","s");return[skLv("h_tide",p),[tx("해일 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"바라보는 방향으로 밀려가요. 적을 멀리 밀어내 숨 돌릴 틈을 만들어요.",tipEn:"Rolls the way you face, pushing foes far away for breathing room."},
h_stance:{max:1,name:"수호 자세",nameEn:"Guardian Stance",desc:"멈춰 서 있으면 수호 자세: 받는 피해 -40% · 채찍 사거리 +40% · 공격력 +30%",descEn:"Stand still to enter Guardian Stance: damage taken -40% · whip reach +40% · attack +30%",icon:"h_stance",
 stats:p=>[[tx("자세 돌입","Enter after"),"—",SKN.h_stance.still+tx("초 정지","s still")]],tip:"움직이면 풀려요. 적이 몰려올 때 버티는 용도예요.",tipEn:"Moving breaks it. Perfect for holding your ground against a rush."},
// ---- 백호 ----
b_prey:{max:3,name:"사냥감 표식",nameEn:"Mark the Prey",desc:"가장 튼튼한 적에게 표식: 받는 피해 +35%, 잡으면 돌진 즉시 충전 · 사냥 +3 · 체력 회복",descEn:"Marks the toughest foe: it takes +35% damage; killing it recharges your dash, adds 3 Hunt stacks and heals",icon:"b_prey",
 stats:p=>{const l=skL(p,"b_prey"),N=SKN.b_prey,cd=k=>fmt(Math.max(2,N.cd-N.per*(k-1)))+tx("초","s");return[skLv("b_prey",p),[tx("표식 간격","Mark interval"),l?cd(l):"—",cd(l+1)]]},tip:"엘리트와 원거리 몹을 노리기 좋아요.",tipEn:"Great for picking off elites and ranged foes."},
b_ghost:{max:3,name:"백호 잔상",nameEn:"Tiger Afterimage",desc:"돌진한 자리에 잔상이 남아 주변을 여러 번 할퀴어요",descEn:"Each dash leaves an afterimage that claws everything around it several times",icon:"b_ghost",
 stats:p=>{const l=skL(p,"b_ghost"),N=SKN.b_ghost;return[skLv("b_ghost",p),[tx("잔상 할퀴기","Afterimage hits"),l?N.hits+l-1:"—",N.hits+l]]},tip:"적 무리 한가운데로 돌진할수록 강해요.",tipEn:"Strongest when you dash into the middle of a crowd."},
b_chain:{max:2,name:"질풍 연격",nameEn:"Gale Chain",desc:"돌진이 적을 베면 곧바로 다른 적에게 이어서 돌진해요",descEn:"When a dash hits, you immediately chain into another dash toward a new foe",icon:"b_chain",
 stats:p=>{const l=skL(p,"b_chain");return[skLv("b_chain",p),[tx("연속 돌진","Chain dashes"),l?"+"+l:"—","+"+(l+1)]]},tip:"돌진 중에는 무적이라 연격이 길수록 안전해요.",tipEn:"You're invincible while dashing — longer chains are safer."},
b_roar:{max:2,name:"백호의 포효",nameEn:"Tiger's Roar",desc:"주기적으로 포효해 주변 적을 겁먹게 해요: 2초 동안 도망치고 베임 3중첩",descEn:"Periodically roars: nearby foes flee in fear for 2s and gain 3 Rend stacks",icon:"b_roar",
 stats:p=>{const l=skL(p,"b_roar"),N=SKN.b_roar,cd=k=>Math.max(6,N.cd-N.per*(k-1))+tx("초","s");return[skLv("b_roar",p),[tx("포효 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"도망치는 적의 등을 노려 돌진하세요. (보스는 겁먹지 않아요)",tipEn:"Dash into their backs as they flee. (Bosses don't scare)"},
// ---- 청룡 ----
c_web:{max:3,name:"전기 그물",nameEn:"Static Web",desc:"번개를 맞은 적은 3초 동안 대전돼요. 가까운 대전된 적끼리 전류로 이어져 계속 피해를 줘요",descEn:"Foes struck by lightning stay charged for 3s; nearby charged foes link up with currents that deal constant damage",icon:"c_web",
 stats:p=>{const l=skL(p,"c_web"),N=SKN.c_web;return[skLv("c_web",p),[tx("연결 거리","Link range"),l?N.r+N.rp*(l-1):"—",N.r+N.rp*l]]},tip:"적이 빽빽할수록 그물이 촘촘해져요.",tipEn:"The denser the horde, the tighter the web."},
c_spout:{max:3,name:"용오름",nameEn:"Waterspout",desc:"비구름이 적 무리를 따라다니고, 사라질 때 용오름이 되어 적을 띄워 올려요 (기절)",descEn:"Rain clouds chase the horde and end as a waterspout that lifts foes up (stun)",icon:"c_spout",
 stats:p=>{const l=skL(p,"c_spout"),N=SKN.c_spout;return[skLv("c_spout",p),[tx("기절","Stun"),l?fmt(N.stun+N.ps*(l-1))+tx("초","s"):"—",fmt(N.stun+N.ps*l)+tx("초","s")]]},tip:"비구름 강화(단비)와 함께 고르면 더 자주 터져요.",tipEn:"Pairs well with Blessed Rain for more frequent spouts."},
c_ascend:{max:2,name:"청룡 승천",nameEn:"Dragon Ascension",desc:"주기적으로 3초 동안 번개가 되어요: 무적 · 이동 속도 +60% · 주변 적에게 벼락이 연달아 떨어져요",descEn:"Periodically become lightning for 3s: invincible · +60% move speed · bolts rain on nearby foes",icon:"c_ascend",
 stats:p=>{const l=skL(p,"c_ascend"),N=SKN.c_ascend,cd=k=>Math.max(8,N.cd-N.per*(k-1))+tx("초","s");return[skLv("c_ascend",p),[tx("승천 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"위험할 때 적 무리를 뚫고 지나가는 탈출기로도 좋아요.",tipEn:"Doubles as an escape — just bolt straight through the horde."},
// ---- 황룡 ----
w_ley:{max:3,name:"지맥",nameEn:"Ley Lines",desc:"가까이 솟은 황금 기둥끼리 금빛 지맥으로 이어져, 선을 지나는 적을 베고 속성을 남겨요",descEn:"Nearby golden pillars link with ley lines that cut every foe crossing them and leave elements",icon:"w_ley",
 stats:p=>{const l=skL(p,"w_ley"),N=SKN.w_ley;return[skLv("w_ley",p),[tx("이어지는 거리","Link range"),l?N.dist+N.dp*(l-1):"—",N.dist+N.dp*l]]},tip:"기둥이 많을수록(갈라지는 대지) 지맥이 촘촘해져요. 봉인 표식도 함께 남아요.",tipEn:"More pillars (Splitting Earth) means a denser web — and more seal marks."},
w_form:{max:2,name:"오방진",nameEn:"Five-Direction Array",desc:"오방 순환이 한 바퀴 돌 때마다 오방진이 발동해 주변 모든 적에게 속성 표식을 새겨요",descEn:"Each time the Five-Way Cycle completes a lap, the array activates and brands every nearby foe with elements",icon:"w_form",
 stats:p=>{const l=skL(p,"w_form"),N=SKN.w_form;return[skLv("w_form",p),[tx("새기는 표식","Marks per foe"),l?N.marks+l-1:"—",N.marks+l]]},tip:"봉인 연쇄의 시작점이 돼요.",tipEn:"The perfect spark for a seal chain."},
w_desc:{max:2,name:"황룡 강림",nameEn:"Hwangryong Descends",desc:"거대한 황룡이 화면을 휩쓸고 지나가며 모든 적에게 땅 + 속성 2개를 새겨요",descEn:"A colossal golden dragon sweeps across the screen, branding every foe with Earth + 2 elements",icon:"w_desc",
 stats:p=>{const l=skL(p,"w_desc"),N=SKN.w_desc,cd=k=>Math.max(10,N.cd-N.per*(k-1))+tx("초","s");return[skLv("w_desc",p),[tx("강림 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"지나간 직후 화면 전체에서 봉인이 연달아 터져요.",tipEn:"Right after it passes, seals erupt all over the screen."}};
for(const id in SK)SK[id].apply=()=>{const p=state.p;p["sk_"+id]=skL(p,id)+1};
const skFilter=(p,list)=>list.filter(u=>!SK[u.id]||skL(p,u.id)<SK[u.id].max);
Object.assign(ICON_DRAW,{
z_echo:g=>{for(const [o,c1,c2] of [[4,"#7a2a1a","#c8603a"],[0,"#e8442a","#ffd54a"]]){icPoly(g,[[3+o,2],[13+o,8],[3+o,14],[7+o,8]],IK);icPoly(g,[[4.4+o,3.6],[11.6+o,8],[4.4+o,12.4],[7.6+o,8]],c1);icPoly(g,[[5.4+o,5],[9+o,8],[5.4+o,11],[7+o,8]],c2)}},
z_trail:g=>{for(const [x,y] of [[3,12],[8,8],[13,4]]){icPoly(g,[[x-3,y+3],[x,y-4],[x+3,y+3]],IK);icPoly(g,[[x-2,y+2.4],[x,y-2.4],[x+2,y+2.4]],"#ff6a2a");icRect(g,x-1,y,2,2,"#ffd54a")}},
z_dive:g=>{icPoly(g,[[0,9],[8,3],[16,6],[10,9],[16,14],[6,12]],IK);icPoly(g,[[1.6,9],[8,4.4],[14,6.4],[8.6,9],[14,12.6],[6,11]],"#e8442a");icPoly(g,[[4,9],[8,6],[11,7],[8,9]],"#ffd54a");icRect(g,7,7,2,2,"#ffffff")},
h_spike:g=>{for(let i=0;i<6;i++){const a=i*1.047;icPoly(g,[[8+Math.cos(a)*3,8+Math.sin(a)*3],[8+Math.cos(a+.3)*3,8+Math.sin(a+.3)*3],[8+Math.cos(a+.15)*8,8+Math.sin(a+.15)*8]],"#9fe4ff")}icCirc(g,8,8,4,IK);icCirc(g,8,8,3,"#3fa0c8");icRect(g,6,6,2,2,"#e8fbff")},
h_vortex:g=>{g.lineCap="round";for(const [w,c] of [[3,IK],[1.4,"#9fe4ff"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();for(let k=0;k<=40;k++){const a=k*.42,r=1+k*.17;const x=8+Math.cos(a)*r,y=8+Math.sin(a)*r;k?g.lineTo(x,y):g.moveTo(x,y)}g.stroke()}},
h_tide:g=>{icPoly(g,[[0,15],[0,9],[4,4],[10,2],[15,5],[11,6],[9,9],[12,11],[16,11],[16,15]],IK);icPoly(g,[[1,14],[1,9.4],[4.6,5],[10,3.2],[13,5],[10.4,5.4],[8,9],[11,12],[15,12],[15,14]],"#3fa0c8");icRect(g,9,3,4,1,"#e8fbff");icRect(g,10,11,5,1,"#e8fbff")},
h_stance:g=>{icPoly(g,[[8,1],[14,4],[13,11],[8,15],[3,11],[2,4]],IK);icPoly(g,[[8,2.6],[12.6,5],[11.8,10.4],[8,13.4],[4.2,10.4],[3.4,5]],"#3f6b5a");icPoly(g,[[8,4],[11,6],[8,11],[5,6]],"#7fd0ff");icRect(g,7,5,2,2,"#e8fbff")},
b_prey:g=>{icCirc(g,8,8,7,IK);icCirc(g,8,8,5.6,"#ff4a4a");icCirc(g,8,8,4.2,IK);icCirc(g,8,8,2,"#ff4a4a");for(const [x,y,w,h] of [[7,0,2,4],[7,12,2,4],[0,7,4,2],[12,7,4,2]])icRect(g,x,y,w,h,"#ffffff")},
b_ghost:g=>{for(const [o,c] of [[3,"#8aa0c0"],[0,"#ffffff"]]){icPoly(g,[[2+o,4],[4+o,1],[6+o,4],[10+o,4],[12+o,1],[14+o,4],[14+o,12],[8+o,15],[2+o,12]],IK);icPoly(g,[[3+o,5],[4+o,3],[5.6+o,5.2],[10.4+o,5.2],[12+o,3],[13+o,5],[13+o,11.6],[8+o,14],[3+o,11.6]],c)}icRect(g,5,8,2,2,IK);icRect(g,9,8,2,2,IK);icRect(g,6,11,4,1,"#ff8aa0")},
b_chain:g=>{g.lineCap="round";g.lineJoin="round";for(const [w,c] of [[3.4,IK],[1.6,"#ffffff"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(1,13);g.lineTo(6,5);g.lineTo(9,11);g.lineTo(14,3);g.stroke()}icPoly(g,[[14,1],[15.5,6],[11,4]],"#bfe4ff")},
b_roar:g=>{icPoly(g,[[1,4],[9,4],[9,12],[1,12]],IK);icPoly(g,[[2,5],[8,5],[8,11],[2,11]],"#f4f4f8");icRect(g,3,7,4,3,"#ff8aa0");icRect(g,3,6,1,1,"#ffffff");icRect(g,6,6,1,1,"#ffffff");g.strokeStyle="#ffe070";g.lineWidth=1.4;for(const r of [3,5.5]){g.beginPath();g.arc(9,8,r,-.9,.9);g.stroke()}},
c_web:g=>{g.lineCap="round";g.strokeStyle="#fff2a0";g.lineWidth=1.4;g.beginPath();g.moveTo(3,4);g.lineTo(6,7);g.lineTo(5,9);g.lineTo(8,12);g.moveTo(3,4);g.lineTo(9,5);g.lineTo(13,4);g.moveTo(13,4);g.lineTo(11,8);g.lineTo(13,12);g.lineTo(8,12);g.stroke();for(const [x,y] of [[3,4],[13,4],[8,12],[13,12]]){icCirc(g,x,y,2.2,IK);icCirc(g,x,y,1.4,"#5ac8ff")}},
c_spout:g=>{for(let i=0;i<7;i++){const y=1+i*2,w=7-i*.7,x=8+Math.sin(i*.9)*2;icRect(g,x-w,y,w*2,2,IK);icRect(g,x-w+1,y,w*2-2,1,i%2?"#9fd8ff":"#e8f4ff")}icRect(g,3,14,10,2,"#3a4a6a")},
c_ascend:g=>{icPoly(g,[[9,0],[3,9],[7,9],[5,16],[13,6],[9,6],[11,0]],IK);icPoly(g,[[9.4,1],[4.6,8.2],[8.2,8.2],[6.6,13.6],[11.6,6.8],[8.2,6.8],[10.2,1]],"#5ac8ff");icPoly(g,[[9.2,1.6],[6.4,6.6],[7.6,6.6],[9.6,1.6]],"#ffffff")},
w_ley:g=>{for(const x of [2,11]){icRect(g,x,3,4,12,IK);icRect(g,x+1,4,2,10,"#ffd54a")}g.lineCap="round";for(const [w,c] of [[3,"#a8781e"],[1.4,"#fff0a0"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(4,8);g.lineTo(7,6);g.lineTo(9,10);g.lineTo(13,8);g.stroke()}},
w_form:g=>{icCirc(g,8,8,7.6,IK);icCirc(g,8,8,6.4,"#5a4418");g.strokeStyle="#ffd54a";g.lineWidth=1;g.beginPath();for(let i=0;i<=5;i++){const a=-1.571+i*2.513;const x=8+Math.cos(a)*5.4,y=8+Math.sin(a)*5.4;i?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();["#2f4a5a","#5ac8ff","#e8442a","#ffffff","#ffd54a"].forEach((c,i)=>{const a=-1.571+i*1.2566;icCirc(g,8+Math.cos(a)*5.4,8+Math.sin(a)*5.4,1.5,c)})},
w_desc:g=>{g.lineCap="round";for(const [w,c] of [[5,IK],[3,"#e8a820"],[1,"#ffe070"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(1,14);g.bezierCurveTo(5,6,9,15,13,6);g.stroke()}icCirc(g,13,5,3,IK);icCirc(g,13,5,2,"#f0b828");icRect(g,14,1,1,3,"#ff7a4a");icRect(g,12,4,1,1,"#ffffff")}});
// ---- 주작 분신: 검기를 쏠 때 복사해 두었다가 한 박자 뒤에 분신 위치에서 다시 발사 ----
{const _arrow=arrow;arrow=function(){const p=state&&state.p,n0=state?state.arrows.length:0;const r=_arrow.apply(this,arguments);
 if(p&&p.charId==="zhuque"&&skL(p,"z_echo")){for(let i=n0;i<state.arrows.length;i++){const a=state.arrows[i];if(a.qi&&!a.src)(p.echoQ=p.echoQ||[]).push({t:SKN.z_echo.delay,vx:a.vx,vy:a.vy,r:a.r,big:a.big,damage:a.damage,pierce:a.pierce,life:a.life})}}return r}}
function skPreyKill(e){const p=state.p;if(p.charId!=="baekho")return;const l=skL(p,"b_prey");p.dashTimer=0;if(!p.noPassive){p.hunt=Math.min(BAEKHO.hunt.max,(p.hunt||0)+3);p.huntT=BAEKHO.hunt.keep}if(p.hp>0)p.hp=Math.min(p.maxHp,p.hp+SKN.b_prey.heal*l);burst(e.x,e.y,"#ff5a5a",12);p.preyT=.6}
function skHit(e,src){const p=state.p;if(src==="main"&&p.charId==="cheongryong"&&skL(p,"c_web"))e.chgT=SKN.c_web.time}
function skLey(f){const p=state.p,l=skL(p,"w_ley");if(!l)return;const N=SKN.w_ley,t=state.time;p.leyPts=(p.leyPts||[]).filter(q=>t-q.t<N.win);
 for(const q of p.leyPts){if(Math.hypot(q.x-f.x,q.y-f.y)<N.dist+N.dp*(l-1)&&Math.hypot(q.x-f.x,q.y-f.y)>20){state.fx.push({type:"wley",x1:q.x,y1:q.y,x2:f.x,y2:f.y,life:N.life*(p.ev_hw?3:1),max:N.life*(p.ev_hw?3:1),hit:new Set(),l,rt:.5});break}}p.leyPts.push({x:f.x,y:f.y,t})}
function skForm(){const p=state.p,l=skL(p,"w_form");if(!l)return;const N=SKN.w_form,pool=["blaze","water","wind","thunder","earth"];
 for(const e of state.enemies){if(e.ghost||!inMap(e)||e.hp<=0)continue;if(dist2(e,p)<N.r*N.r){hurt(e,p.arrowDamage*N.dmg,"#ffe070","w_form");if(e.hp>0)for(let i=0;i<N.marks+l-1;i++)hwMark(e,pool[(Math.random()*5)|0])}}
 state.fx.push({type:"wform",x:p.x,y:p.y,life:.9,max:.9});state.banner={text:tx("오방진 발동!","Five-Direction Array!"),t:1.2};if(typeof audio!=="undefined")audio.sfx("altar")}
function skTick(dt){const p=state.p;if(!p||state.dead)return;const id=p.charId,AD=p.arrowDamage,live=e=>!e.ghost&&inMap(e)&&e.hp>0,S=n=>{if(typeof audio!=="undefined")audio.sfx(n)};
 if(id==="zhuque"){
  if(skL(p,"z_echo")){const N=SKN.z_echo,l=skL(p,"z_echo"),fx=p.x-(p.face||1)*24,fy=p.y-16;p.echoX=p.echoX==null?fx:p.echoX+(fx-p.echoX)*Math.min(1,dt*6);p.echoY=p.echoY==null?fy:p.echoY+(fy-p.echoY)*Math.min(1,dt*6);
   if(p.echoQ){for(const q of p.echoQ){q.t-=dt;if(q.t<=0&&!q.done){q.done=true;const a=Math.atan2(q.vy,q.vx);for(const da of (p.ev_zq?[-.17,.17]:[0])){const sp=Math.hypot(q.vx,q.vy),aa=a+da;state.arrows.push({qi:true,big:q.big,src:"z_echo",x:p.echoX+Math.cos(aa)*14,y:p.echoY+Math.sin(aa)*14,vx:Math.cos(aa)*sp,vy:Math.sin(aa)*sp,r:q.r,damage:q.damage*(N.dmg+N.per*(l-1)),pierce:q.pierce,hit:new Set(),life:q.life})}S("qi")}}p.echoQ=p.echoQ.filter(q=>!q.done)}}
  if(skL(p,"z_trail")){const N=SKN.z_trail,l=skL(p,"z_trail"),L=N.life+N.per*(l-1);if(p.moving){p.trailD=(p.trailD||0)+p.speed*dt;if(p.trailD>=N.gap){p.trailD=0;state.fx.push({type:"ztrail",x:p.x+rand(-4,4),y:p.y+8+rand(-3,3),life:L,max:L,tick:0,sd:rand(0,6)})}}
   for(const f of state.fx){if(f.type!=="ztrail")continue;f.tick-=dt;if(f.tick>0)continue;f.tick=.25;for(const e of state.enemies)if(live(e)&&dist2(e,f)<(N.r+e.r)**2)hurt(e,AD*N.dps*.25*(p.ev_zq?2:1),"#ff8a3a","z_trail")}}
  if(skL(p,"z_dive")){const N=SKN.z_dive,l=skL(p,"z_dive");p.diveT=(p.diveT==null?5:p.diveT)-dt;
   if(p.diveT<=0){p.diveT=Math.max(8,N.cd-N.per*(l-1));const dir=Math.random()<.5?1:-1;state.fx.push({type:"zdive",y:p.y,dir,x0:cam.x+(dir>0?-140:W+140),x1:cam.x+(dir>0?W+140:-140),life:N.time,max:N.time,hit:new Set()});state.banner={text:tx("주작 강림!","Zhuque descends!"),t:1.2};S("fboom")}
   for(const f of state.fx){if(f.type!=="zdive")continue;const k=1-f.life/f.max,x=f.x0+(f.x1-f.x0)*k;for(const e of state.enemies){if(f.hit.has(e)||!live(e))continue;if(Math.abs(e.x-x)<34&&Math.abs(e.y-f.y)<N.band+e.r){f.hit.add(e);hurt(e,AD*N.dmg,"#ffb070","z_dive");burst(e.x,e.y,"#ff8a3a",5)}}}}}
 if(id==="hyunmu"){
  const swung=p.whipT>(p._wT||0)+.01;p._wT=p.whipT||0;
  if(skL(p,"h_vortex")){const N=SKN.h_vortex,l=skL(p,"h_vortex");if(swung){p.whipN=(p.whipN||0)+1;if(p.whipN%N.every===0){const R=(p.whipLen||96)*.8*(p.stance?SKN.h_stance.reach:1),L=N.time+N.per*(l-1);state.fx.push({type:"hvortex",x:p.x+Math.cos(p.whipA||0)*R,y:p.y+Math.sin(p.whipA||0)*R,r:N.r+N.rp*(l-1),life:L,max:L,tick:0});S("water")}}
   for(const f of state.fx){if(f.type!=="hvortex")continue;f.tick-=dt;const tk=f.tick<=0;if(tk)f.tick=.5;for(const e of state.enemies){if(!live(e))continue;const dx=f.x-e.x,dy=f.y-e.y,d=Math.hypot(dx,dy)||1;if(d<f.r+e.r){if(!e.boss&&d>6){const m=Math.min(d,N.pull*dt);e.x+=dx/d*m;e.y+=dy/d*m}if(tk)hurt(e,AD*N.dps*.5*l,"#9fe4ff","h_vortex")}}}}
  if(skL(p,"h_tide")){const N=SKN.h_tide,l=skL(p,"h_tide");p.tideT=(p.tideT==null?5:p.tideT)-dt;
   if(p.tideT<=0){p.tideT=Math.max(6,N.cd-N.per*(l-1));const dir=p.face||1;state.fx.push({type:"htide",x0:p.x-dir*40,y:p.y,dir,life:N.time,max:N.time,hit:new Set()});if(p.ev_hm){const V=SKN.h_vortex,lv=skL(p,"h_vortex")||1;for(const k of [1,2,3]){const L2=V.time+V.per*(lv-1)+.4;state.fx.push({type:"hvortex",x:p.x+dir*k*170,y:p.y+rand(-60,60),r:V.r+V.rp*(lv-1),life:L2+k*.3,max:L2+k*.3,tick:0})}}S("wave")}
   for(const f of state.fx){if(f.type!=="htide")continue;const k=1-f.life/f.max,x=f.x0+f.dir*N.len*k;for(const e of state.enemies){if(!live(e))continue;const rel=(e.x-x)*f.dir;if(Math.abs(e.y-f.y)<N.h/2&&rel<12&&rel>-34){if(!f.hit.has(e)){f.hit.add(e);hurt(e,AD*N.dmg*(1+.4*(l-1)),"#9fe4ff","h_tide")}if(!e.boss){e.x=x+f.dir*14;e.slowT=Math.max(e.slowT||0,1.5)}}}}}
  if(skL(p,"h_stance")){const N=SKN.h_stance;if(p.moving){p.stillT=0;if(p.stance){p.stance=false;p.dmgMul/=N.atk}}else{p.stillT=(p.stillT||0)+dt;if(!p.stance&&p.stillT>=N.still){p.stance=true;p.dmgMul=(p.dmgMul||1)*N.atk;burst(p.x,p.y-6,"#9fe4ff",12)}}}}
 if(id==="baekho"){
  const dashing=p.dashT>0;
  if(dashing&&!p._dash){p.chainN=0;if(skL(p,"b_ghost")){const N=SKN.b_ghost;(p.ghosts=p.ghosts||[]).push({x:p.x,y:p.y,f:p.face||1,n:N.hits+skL(p,"b_ghost")-1+(p.ev_bk?2:0),t:.05,life:1.4,slash:0,sa:0})}}
  if(!dashing&&p._dash){if(p.ev_bk){const N=SKN.b_ghost;(p.ghosts=p.ghosts||[]).push({x:p.x,y:p.y,f:p.face||1,n:N.hits+skL(p,"b_ghost")+1,t:.08,life:1.4,slash:0,sa:0})}const l=skL(p,"b_chain");if(l&&p.dashHit&&p.dashHit.size>0&&(p.chainN||0)<l){let tg=null,bd=SKN.b_chain.range**2;for(const e of state.enemies){if(!live(e)||p.dashHit.has(e))continue;const d2=dist2(e,p);if(d2<bd){bd=d2;tg=e}}
   if(tg){const D=BAEKHO.dash,dx=tg.x-p.x,dy=tg.y-p.y,d=Math.hypot(dx,dy)||1,dist=Math.min(D.dist,d+20);p.dashVx=dx/d*dist/D.time;p.dashVy=dy/d*dist/D.time;p.dashT=D.time;p.dashHit=new Set();p.face=dx>0?1:-1;p.invuln=Math.max(p.invuln||0,D.time+.08);p.chainN=(p.chainN||0)+1;burst(p.x,p.y,"#bfe4ff",10);S("dash")}}}
  p._dash=p.dashT>0;
  if(p.ghosts){const N=SKN.b_ghost;for(const g of p.ghosts){g.life-=dt;if(g.slash>0)g.slash-=dt;if(g.n>0){g.t-=dt;if(g.t<=0){g.t=N.gap;g.n--;g.slash=.15;g.sa=rand(0,6.283);for(const e of state.enemies)if(live(e)&&dist2(e,g)<(N.r+e.r)**2)hurt(e,AD*N.dmg,"#ffffff","b_ghost");S("claw")}}}p.ghosts=p.ghosts.filter(g=>g.life>0)}
  if(skL(p,"b_prey")){const N=SKN.b_prey,l=skL(p,"b_prey");p.preyT=(p.preyT==null?1:p.preyT)-dt;if(p.preyT<=0&&!state.enemies.some(e=>e.prey&&e.hp>0)){let best=null,bh=-1;for(const e of state.enemies){if(!live(e)||dist2(e,p)>N.range**2)continue;if(e.hp>bh){bh=e.hp;best=e}}if(best){best.prey=true;p.preyT=Math.max(2,N.cd-N.per*(l-1))}}}
  if(skL(p,"b_roar")){const N=SKN.b_roar,l=skL(p,"b_roar");p.roarT=(p.roarT==null?4:p.roarT)-dt;if(p.roarT<=0){p.roarT=Math.max(6,N.cd-N.per*(l-1));for(const e of state.enemies){if(!live(e)||dist2(e,p)>N.r*N.r)continue;if(!e.boss)e.fearT=N.time;e.rend=Math.min(ELEM.wind.max,(e.rend||0)+N.rend);e.rendT=ELEM.wind.time}state.fx.push({type:"broar",x:p.x,y:p.y-8,life:.5,max:.5});state.shake=Math.max(state.shake||0,5);S("boss")}}}
 if(id==="cheongryong"){
  if(skL(p,"c_web")){const N=SKN.c_web,l=skL(p,"c_web"),R=N.r+N.rp*(l-1);const ch=state.enemies.filter(e=>e.chgT>0&&live(e)).slice(0,40);p.webLinks=[];
   for(let i=0;i<ch.length;i++){let n=0;for(let j=i+1;j<ch.length&&n<2;j++)if(dist2(ch[i],ch[j])<R*R){p.webLinks.push([ch[i],ch[j]]);n++}}
   p.webT=(p.webT||0)-dt;if(p.webT<=0){p.webT=.25;const d=AD*N.dps*.25*(1+.3*(l-1))*(p.ev_cr?2:1);for(const [a,b] of p.webLinks){hurt(a,d,"#9fe8ff","c_web");hurt(b,d,"#9fe8ff","c_web")}}}
  if(skL(p,"c_spout")){const N=SKN.c_spout,l=skL(p,"c_spout");for(const f of state.fx){if(f.type!=="rain")continue;let sx=0,sy=0,n=0;for(const e of state.enemies)if(live(e)&&dist2(e,f)<260*260){sx+=e.x;sy+=e.y;n++}
    if(n){const dx=sx/n-f.x,dy=sy/n-f.y,d=Math.hypot(dx,dy)||1;if(d>8){f.x+=dx/d*N.speed*dt;f.y+=dy/d*N.speed*dt}}
    if(!f.spout&&f.life<=dt*1.5){f.spout=true;const st=N.stun+N.ps*(l-1)+(p.ev_cr?.5:0),sr=f.r*(p.ev_cr?1.4:1);for(const e of state.enemies){if(!live(e))continue;const ex=e.x-f.x,ey=(e.y-f.y)/.62;if(ex*ex+ey*ey<sr*sr){hurt(e,AD*N.dmg*l,"#cfe8ff","c_spout");if(!e.boss)e.stunT=Math.max(e.stunT||0,st)}}state.fx.push({type:"cspout",x:f.x,y:f.y,r:f.r,life:.8,max:.8});S("wave")}}}
  if(skL(p,"c_ascend")){const N=SKN.c_ascend,l=skL(p,"c_ascend");
   if(p.ascT>0){p.ascT-=dt;p.invuln=Math.max(p.invuln||0,.12);p.ascZ=(p.ascZ||0)-dt;if(p.ascZ<=0){p.ascZ=N.gap;const cs=state.enemies.filter(e=>live(e)&&dist2(e,p)<N.r*N.r),e=cs[(Math.random()*cs.length)|0];if(e){hurt(e,AD*N.dmg,"#fff2a0","c_ascend");state.fx.push({type:"bolt",paths:[boltPath(e.x+rand(-12,12),e.y-170,e.x,e.y-6)],thunder:true,life:.2,max:.2});S("zap")}}
    if(p.ascT<=0){p.ascT=0;p.speed/=N.spd}}
   else{p.ascCD=(p.ascCD==null?6:p.ascCD)-dt;if(p.ascCD<=0){p.ascCD=Math.max(8,N.cd-N.per*(l-1));p.ascT=N.time;p.speed*=N.spd;state.flash=.4;state.flashC="#bfe8ff";state.banner={text:tx("청룡 승천!","Cheongryong ascends!"),t:1.2};S("thunder")}}}}
 if(id==="hwangryong"){
  for(const f of state.fx){if(f.type!=="wley")continue;if(p.ev_hw){f.rt-=dt;if(f.rt<=0){f.rt=.5;f.hit.clear()}}const N=SKN.w_ley,dx=f.x2-f.x1,dy=f.y2-f.y1,L2=dx*dx+dy*dy||1;for(const e of state.enemies){if(f.hit.has(e)||!live(e))continue;let u=((e.x-f.x1)*dx+(e.y-f.y1)*dy)/L2;u=Math.max(0,Math.min(1,u));const qx=f.x1+dx*u,qy=f.y1+dy*u;if((e.x-qx)**2+(e.y-qy)**2<(N.w+e.r)**2){f.hit.add(e);hurt(e,AD*N.dmg*(1+.3*(f.l-1)),"#ffe070","w_ley")}}}
  if(skL(p,"w_desc")){const N=SKN.w_desc,l=skL(p,"w_desc");p.descT=(p.descT==null?8:p.descT)-dt;
   if(p.descT<=0){p.descT=Math.max(10,N.cd-N.per*(l-1));const dir=Math.random()<.5?1:-1;state.fx.push({type:"wdesc",x0:cam.x+(dir>0?-260:W+260),x1:cam.x+(dir>0?W+260:-260),y:cam.y+H/2,dir,life:N.time,max:N.time,hit:new Set()});state.banner={text:tx("황룡 강림!","Hwangryong descends!"),t:1.3};state.shake=Math.max(state.shake||0,6);S("thunder")}
   for(const f of state.fx){if(f.type!=="wdesc")continue;const k=1-f.life/f.max,hx=f.x0+(f.x1-f.x0)*k;for(const e of state.enemies){if(f.hit.has(e)||!live(e))continue;if(Math.abs(e.x-hx)<44){f.hit.add(e);hurt(e,AD*N.dmg*(1+.5*(l-1)),"#ffe070","w_desc");if(e.hp>0){hwMark(e,"earth");const pool=["blaze","water","wind","thunder"];for(let i=0;i<N.marks;i++)hwMark(e,pool[(Math.random()*4)|0])}}}}}}}
// ---- 그리기 ----
const SK_FX={ikindle:1,qbeam:1,qsmite:1,qbell:1,ztrail:1,zdive:1,hvortex:1,htide:1,broar:1,cspout:1,wley:1,wform:1,wdesc:1};const skSpr={};const skTint=(k,src,col)=>skSpr[k]||(skSpr[k]=tint(src,col));
function skDrawUnder(){const p=state.p;if(!p)return;const t=state.time;ctx.save();
 for(const f of state.fx){
  if(f.type==="ztrail"){const k=f.life/f.max,x=Math.round(f.x),y=Math.round(f.y),h=Math.round(Math.sin(t*12+f.sd)*1.5),z=k>.3?1:k/.3;ctx.globalAlpha=Math.min(1,k*2.5);ctx.fillStyle="#7a1e10";ctx.fillRect(x-5,y+1,10,2);ctx.fillStyle="#e8442a";ctx.fillRect(x-3,y-3-h,6,Math.round(5*z)+1);ctx.fillStyle="#ff9a3a";ctx.fillRect(x-2,y-5-h,4,Math.round(4*z)+1);ctx.fillStyle="#ffe080";ctx.fillRect(x-1,y-3-h,2,2)}
  else if(f.type==="hvortex"){const fade=Math.min(1,f.life/.3,(f.max-f.life)/.2);for(let arm=0;arm<3;arm++)for(let i=0;i<12;i++){const a=-t*5+arm*2.094+i*.5,r=f.r*(1-i/12),x=Math.round(f.x+Math.cos(a)*r),y=Math.round(f.y+Math.sin(a)*r*.6);ctx.globalAlpha=fade*(.25+.6*(1-i/12));ctx.fillStyle=i%3?"#3fa0c8":"#bfefff";ctx.fillRect(x-2,y-1,4,2)}ctx.globalAlpha=fade*.5;ctx.fillStyle="#14303c";ctx.fillRect(Math.round(f.x)-3,Math.round(f.y)-2,6,4)}
  else if(f.type==="wley"){const fade=f.life/f.max;ctx.globalCompositeOperation="lighter";ctx.lineCap="round";for(const [w,c,a] of [[12,"#ffb020",.25],[5,"#ffd54a",.8],[2,"#fff8d0",1]]){ctx.globalAlpha=a*fade;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(f.x1,f.y1+6);const n=6;for(let i=1;i<=n;i++){const u=i/n,j=i<n?Math.sin(t*30+i*2)*3:0;ctx.lineTo(f.x1+(f.x2-f.x1)*u,f.y1+6+(f.y2-f.y1)*u+j)}ctx.stroke()}ctx.globalCompositeOperation="source-over"}}
 ctx.restore()}
function skDrawOver(){const p=state.p;if(!p)return;const t=state.time;qDraw();igDraw();ctx.save();
 // 주작 분신
 if(p.charId==="zhuque"&&skL(p,"z_echo")&&p.echoX!=null){const im=skTint("zecho",SP.zhuqueA.n,"#ff7a3a");ctx.save();ctx.globalAlpha=.45+.1*Math.sin(t*6);ctx.translate(Math.round(p.echoX),Math.round(p.echoY+Math.sin(t*3)*2));ctx.scale(p.face||1,1);ctx.drawImage(im,-16,-24);ctx.restore()}
 // 백호 잔상
 if(p.ghosts)for(const g of p.ghosts){ctx.save();ctx.globalAlpha=Math.min(.55,g.life*.6);ctx.translate(Math.round(g.x),Math.round(g.y));ctx.scale(g.f,1);ctx.drawImage(SP.baekhoA.f,-16,-24);ctx.restore();
  if(g.slash>0){const k=g.slash/.15;ctx.save();ctx.globalCompositeOperation="lighter";ctx.lineCap="round";for(let i=0;i<3;i++){const a=g.sa+i*2.094;ctx.globalAlpha=.85*k;ctx.strokeStyle=i?"#bfe4ff":"#ffffff";ctx.lineWidth=3;ctx.beginPath();ctx.arc(g.x,g.y-6,SKN.b_ghost.r*.7,a,a+1.2*(1-k*.3));ctx.stroke()}ctx.restore()}}
 // 사냥감 표식 · 겁먹은 적 · 전기 그물
 for(const e of state.enemies){if(e.hp<=0)continue;const x=Math.round(e.x),y=Math.round(e.y)-4,r=(e.r||10)+6;
  if(e.prey){const s=Math.sin(t*6)*2;ctx.fillStyle="#2a0a0a";for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){ctx.fillRect(x+dx*(r+s)-(dx>0?5:0)-1,y+dy*(r+s)-1,6,4);ctx.fillRect(x+dx*(r+s)-1,y+dy*(r+s)-(dy>0?5:0)-1,4,6)}ctx.fillStyle="#ff4a4a";for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){ctx.fillRect(x+dx*(r+s)-(dx>0?4:0),y+dy*(r+s),4,2);ctx.fillRect(x+dx*(r+s),y+dy*(r+s)-(dy>0?4:0),2,4)}}
  if(e.fearT>0){ctx.fillStyle="#2a1040";ctx.fillRect(x-2,y-r-8,4,8);ctx.fillStyle="#c89aff";ctx.fillRect(x-1,y-r-7,2,4);ctx.fillRect(x-1,y-r-2,2,1)}}
 if(p.charId==="cheongryong"&&p.webLinks&&p.webLinks.length){ctx.globalCompositeOperation="lighter";ctx.lineWidth=1.5;for(const [a,b] of p.webLinks){ctx.strokeStyle=Math.sin(t*40+a.x)>0?"#fff2a0":"#9fe8ff";ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(a.x,a.y-6);const mx=(a.x+b.x)/2+rand(-6,6),my=(a.y+b.y)/2-6+rand(-6,6);ctx.lineTo(mx,my);ctx.lineTo(b.x,b.y-6);ctx.stroke()}ctx.globalCompositeOperation="source-over";ctx.globalAlpha=1}
 for(const f of state.fx){
  if(f.type==="zdive"){const k=1-f.life/f.max,x=f.x0+(f.x1-f.x0)*k,y=f.y-36+Math.sin(k*9)*8;ctx.save();ctx.globalCompositeOperation="lighter";for(let i=1;i<16;i++){const tx2=x-f.dir*i*16,ty=y+20+Math.sin(i*1.7+t*10)*14;ctx.globalAlpha=.5*(1-i/16);ctx.fillStyle=i%3?"#ff6a2a":"#ffd54a";ctx.fillRect(Math.round(tx2)-6,Math.round(ty)-4,12-i*.5,8-i*.3)}ctx.globalAlpha=.6;ctx.drawImage(GL.big,x-90,y-70,180,180);ctx.restore();
   ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(f.dir*3.2,3.2);ctx.globalAlpha=.95;drawWings(ctx,t*2,true);ctx.drawImage(SP.zhuqueA.n,-16,-24);ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35;ctx.drawImage(skTint("zfire",SP.zhuqueA.n,"#ff8a3a"),-16,-24);ctx.restore()}
  else if(f.type==="htide"){const N=SKN.h_tide,k=1-f.life/f.max,x=f.x0+f.dir*N.len*k,fade=Math.min(1,f.life/.3);ctx.save();ctx.globalAlpha=.85*fade;for(let yy=-N.h/2;yy<N.h/2;yy+=4){const edge=Math.abs(yy)/(N.h/2),w=Math.round(72*(1-edge*edge)),wob=Math.round(Math.sin(t*14+yy*.15)*3),fx2=Math.round(x+wob*f.dir);ctx.fillStyle="#1e5a7a";ctx.fillRect(f.dir>0?fx2-w:fx2,f.y+yy,w,4);ctx.fillStyle="#3fa0c8";ctx.fillRect(f.dir>0?fx2-Math.round(w*.6):fx2,f.y+yy,Math.round(w*.6),4);ctx.fillStyle="#e8fbff";ctx.fillRect(f.dir>0?fx2-3:fx2,f.y+yy,3+((yy/4)%3===0?3:0),4)}ctx.restore()}
  else if(f.type==="broar"){const k=1-f.life/f.max;ctx.save();ctx.globalAlpha=1-k;ctx.strokeStyle="#ffffff";ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<14;i++){const a=i*.449+.2,r0=22+k*90;ctx.moveTo(f.x+Math.cos(a)*r0,f.y+Math.sin(a)*r0*.8);ctx.lineTo(f.x+Math.cos(a)*(r0+14),f.y+Math.sin(a)*(r0+14)*.8)}ctx.stroke();ctx.restore()}
  else if(f.type==="cspout"){const k=1-f.life/f.max,fade=Math.min(1,f.life/.3),h=170*Math.min(1,k*3);ctx.save();ctx.globalAlpha=.8*fade;for(let i=0;i<h;i+=4){const u=i/170,w=Math.round(6+u*f.r*.5),x=Math.round(f.x+Math.sin(t*16-i*.08)*(4+u*10));ctx.fillStyle=(i/4)%3===0?"#e8f4ff":"#7fb8e0";ctx.fillRect(x-w,Math.round(f.y-i),w*2,3)}ctx.restore()}
  else if(f.type==="wform"){const k=1-f.life/f.max,fade=f.life/f.max;ctx.save();ctx.globalCompositeOperation="lighter";["#2f6a8a","#5ac8ff","#ff6a3a","#ffffff","#ffd54a"].forEach((c,i)=>{const x=f.x+(i-2)*14,h=180*Math.min(1,k*3);ctx.globalAlpha=.55*fade;ctx.fillStyle=c;ctx.fillRect(Math.round(x)-3,Math.round(f.y-h),6,h);ctx.globalAlpha=fade;ctx.fillRect(Math.round(x)-1,Math.round(f.y-h),2,h)});ctx.restore()}
  else if(f.type==="wdesc"){const k=1-f.life/f.max,hx=f.x0+(f.x1-f.x0)*k,N=40,pts=[];for(let i=0;i<N;i++)pts.push([hx-f.dir*i*18,f.y+Math.sin(i*.32-t*5)*70*(1-i/N*.4)]);ctx.save();ctx.globalAlpha=.92;
   for(let i=N-1;i>=0;i--){const [x,y]=pts[i],r=Math.max(4,Math.round(22*(1-i/N)+4));disc(ctx,Math.round(x/2)*2,Math.round(y/2)*2,r+3,"#2a1606");disc(ctx,Math.round(x/2)*2,Math.round(y/2)*2,r,i%4<2?"#e8a820":"#d08c18");disc(ctx,Math.round(x/2)*2,Math.round(y/2)*2-Math.round(r/3),Math.max(2,r-6),"#ffe070");if(i%3===0){ctx.fillStyle="#e8443a";ctx.fillRect(Math.round(x)-3,Math.round(y)-r-6,6,6)}}
   const [hx2,hy]=pts[0];ctx.fillStyle="#fff0d0";for(let k2=0;k2<6;k2++)ctx.fillRect(Math.round(hx2-f.dir*(6+k2*4)),Math.round(hy-26-k2*3),4,4);ctx.fillStyle="#ffffff";ctx.fillRect(Math.round(hx2+f.dir*8)-3,Math.round(hy-8)-3,6,6);ctx.fillStyle="#2a1606";ctx.fillRect(Math.round(hx2+f.dir*9)-1,Math.round(hy-8)-2,2,4);
   ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.5;ctx.drawImage(GL.warm,hx2-110,hy-110,220,220);ctx.restore()}}
 // 청룡 승천
 if(p.charId==="cheongryong"&&p.ascT>0){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.55;ctx.drawImage(GL.ice,p.x-40,p.y-50,80,80);ctx.strokeStyle=Math.sin(t*50)>0?"#ffffff":"#9fe8ff";ctx.lineWidth=1.5;ctx.globalAlpha=.9;ctx.beginPath();for(let i=0;i<3;i++){const a=rand(0,6.283);let x=p.x,y=p.y-8;ctx.moveTo(x,y);for(let k=0;k<4;k++){x+=Math.cos(a)*7+rand(-4,4);y+=Math.sin(a)*7+rand(-4,4);ctx.lineTo(x,y)}}ctx.stroke();ctx.restore()}
 // 현무 수호 자세
 if(p.charId==="hyunmu"&&p.stance){ctx.save();for(let i=0;i<4;i++){const ph=(t*.8+i/4)%1;ctx.globalAlpha=.7*(1-ph);ctx.fillStyle=i%2?"#9fe4ff":"#e8fbff";ctx.fillRect(Math.round(p.x-14+i*9),Math.round(p.y+6-ph*34),2,3)}ctx.restore()}
 ctx.restore()}
const ZUP={
ad:{name:"타오르는 검기",nameEn:"Blazing Slash",desc:"검기 피해 +1",descEn:"Slash damage +1",icon:"ad_z",stats:p=>[[tx("검기 피해","Slash damage"),fmt(p.arrowDamage*ZQ),fmt((p.arrowDamage+1)*ZQ)],[tx("초당 피해","DPS"),fmt(p.arrowDamage*ZQ/(p.arrowRate*ZR)),fmt((p.arrowDamage+1)*ZQ/(p.arrowRate*ZR))]],tip:"불의 검기의 기본 피해가 올라요. 초반에 가장 확실한 화력 강화예요.",tipEn:"Raises the base damage of your fire slash. The surest early power boost."},
ap:{name:"꿰뚫는 검기",nameEn:"Piercing Slash",desc:"검기 관통 +3명",descEn:"Slash pierce +3",icon:"ap_z",stats:p=>[[tx("관통 수","Pierce"),p.arrowPierce+2,p.arrowPierce+5]],tip:"검기 한 번으로 줄지어 선 적을 한꺼번에 베어 넘겨요.",tipEn:"One slash cuts down a whole line of enemies at once."},
ar:{name:"날랜 검격",nameEn:"Swift Strikes",desc:"검기 발사 간격 -6%",descEn:"Slash interval -6%",icon:"ar_z",stats:p=>{const n=Math.max(.3,p.arrowRate*.94);return[[tx("검기 발사 간격","Slash interval"),fmt(p.arrowRate*ZR)+tx("초","s"),fmt(n*ZR)+tx("초","s")],[tx("초당 검기","Slashes / sec"),fmt(1/(p.arrowRate*ZR)),fmt(1/(n*ZR))]]},tip:"검을 더 자주 휘둘러 검기를 날려요. 피해 강화와 함께 쓰면 효과가 곱절이에요.",tipEn:"Swing your sword more often. Twice as effective with damage upgrades."}
};
Object.assign(ZUP,{
feather:{name:"불꽃 깃털 발사",nameEn:"Flame Feather Volley",desc:"불꽃 깃털 +1발 (8발이면 사방 360°)",descEn:"Flame feathers +1 (8 = full 360°)",icon:"feather_z",stats:p=>{const n=p.feathers||0;return[[tx("깃털 수","Feathers"),n,Math.min(FEATHER_MAX,n+1)],[tx("발사 범위","Spread"),Math.min(360,n*45)+"°",Math.min(360,(n+1)*45)+"°"]]},tip:"고를 때마다 깃털이 한 발씩 늘어나요. 8발을 모으면 사방 360°로 쏟아져요!",tipEn:"Each pick adds one feather. Collect 8 to fire in all 360°!"},
blade:{name:"붉은 날개의 춤",nameEn:"Dance of Crimson Wings",desc:"몸 주위를 도는 불꽃 깃털 +2개",descEn:"Orbiting flame feathers +2",icon:"blade_z",stats:p=>[[tx("깃털 개수","Feathers"),p.blades,p.blades+2],[tx("깃털 피해 합계","Total feather damage"),p.blades*p.bladeDamage,(p.blades+2)*p.bladeDamage]],tip:"날개를 펼치듯 깃털이 몸을 감싸 가까이 붙은 적을 빈틈없이 베어내요.",tipEn:"Feathers wrap around you like spread wings, cutting down foes up close."},
bd:{name:"뜨거운 날개깃",nameEn:"Searing Plumes",desc:"회전 깃털 피해 +1",descEn:"Orbiting feather damage +1",icon:"bd_z",stats:p=>[[tx("깃털 피해","Feather damage"),p.bladeDamage,p.bladeDamage+1],[tx("깃털 피해 합계","Total feather damage"),p.blades*p.bladeDamage,p.blades*(p.bladeDamage+1)]],tip:"깃털이 많을수록 더 큰 효과! 붉은 날개의 춤과 궁합이 좋아요.",tipEn:"The more feathers, the bigger the payoff! Great with Dance of Crimson Wings."},
spore:{name:"봉황의 폭염",nameEn:"Phoenix Blaze",desc:"주기적 불꽃 폭발 대폭 강화 (+2단계)",descEn:"Periodic flame burst greatly empowered (+2 levels)",icon:"spore_z",stats:UP_INFO.spore.stats,tip:"주기적으로 날개를 펴 몸 주변을 불태워요. 둘러싸였을 때 든든한 한 방!",tipEn:"Spread your wings to set everything around you ablaze. A lifesaver when surrounded!"},
storm:{name:"주작 강림",nameEn:"Zhuque Descends",desc:"하늘에서 불의 유성이 쏟아져요 (+3단계)",descEn:"Fire meteors rain from the sky (+3 levels)",icon:"storm_z",stats:UP_INFO.storm.stats,tip:"붉은 새가 하늘에서 불의 유성을 내리꽂아요. 아주 드문 최상급 강화예요.",tipEn:"The crimson bird hurls fire meteors from the sky. An extremely rare top-tier upgrade."},
speed:{name:"날개 가르기",nameEn:"Wing Cleave",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed_z",stats:UP_INFO.speed.stats,tip:"바람을 가르며 적 사이를 빠져나가기 쉬워져요. 가만히 있으면 둘러싸여요!",tipEn:"Cut through the wind and slip between enemies. Stand still and you'll be surrounded!"},
magnet:{name:"불새의 눈",nameEn:"Firebird's Eye",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet_z",stats:UP_INFO.magnet.stats,tip:"먼 곳의 불씨 조각도 알아보고 끌어당겨 레벨업이 빨라져요.",tipEn:"Spot and pull in distant ember shards to level up faster."},
heal:{name:"불사조의 눈물",nameEn:"Phoenix Tears",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal_z",stats:UP_INFO.heal.stats,tip:"위험할 때 바로 쓰는 응급 회복이에요. 최대 체력은 늘지 않아요.",tipEn:"An emergency heal for tight spots. Does not raise max HP."},
leech:{name:"핏빛 깃털",nameEn:"Crimson Plume",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"베어 넘긴 적의 기운을 깃털로 빨아들여요.",tipEn:"Your feathers drink the life of every foe you cut down."},
heart:{name:"불사조의 깃옷",nameEn:"Phoenix Plumage",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart_z",stats:UP_INFO.heart.stats,tip:"더 오래 버티는 튼튼한 깃털옷! 최대 체력이 늘고 그만큼 회복돼요.",tipEn:"A sturdier feathered cloak! Raises max HP and heals the same amount."}
});
/* 주작 전용 레벨업 풀: 불꽃 깃털은 8발(=360°)까지만 등장 */
const FEATHER_MAX=8,FEATHER_STEP=Math.PI/4;
Object.assign(ZUP,SK);const ZUP_RARITY={feather:["epic",14],leech:["uncommon",6],heal:["common",10],speed:["common",10],magnet:["common",9],ar:["common",11],ad:["uncommon",9],z_trail:["uncommon",8],heart:["uncommon",7],ap:["epic",5],z_echo:["epic",7],z_dive:["mythic",4]};
const ZPOOL=Object.keys(ZUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=ZUP_RARITY[id];return{id,rar,w,apply:id==="feather"?()=>{state.p.feathers=Math.min(FEATHER_MAX,(state.p.feathers||0)+1)}:SK[id]?SK[id].apply:b.apply}});
const zhuPool=p=>ZPOOL.filter(u=>u.id!=="feather"||(p.feathers||0)<FEATHER_MAX);

/* ===== 현무 전용 레벨업: 아이콘 (물 · 뱀 · 등껍질 테마) ===== */
const HW=["#1f5f7a","#3fa0c8","#9fe4ff","#e8fbff"],HG=["#1f4a32","#3f8a5a","#7fd08a","#d8f0a0"],HS=["#14262a","#2f5a52","#4f8a74"];
Object.assign(ICON_DRAW,{
leech:g=>{icPoly(g,[[2,1.5],[14,1.5],[13,5],[3,5]],IK);icPoly(g,[[3,2.2],[13,2.2],[12.4,4.4],[3.6,4.4]],"#8a2030");icRect(g,4,2,8,1,"#c84050");icPoly(g,[[3.4,4],[7.2,4],[5.2,11.4]],IK);icPoly(g,[[4.2,4.3],[6.5,4.3],[5.3,9.8]],"#fff8ea");icPoly(g,[[8.8,4],[12.6,4],[10.8,11.4]],IK);icPoly(g,[[9.5,4.3],[11.8,4.3],[10.7,9.8]],"#fff8ea");icDrop(g,5.3,15.8,1.9,IK);icDrop(g,5.3,15.3,1.35,"#e0303c");icDrop(g,10.8,15.8,1.9,IK);icDrop(g,10.8,15.3,1.35,"#e0303c")},
ad_h:g=>{icCirc(g,8,7,6.5,IK);icCirc(g,8,7,5.5,HG[1]);icCirc(g,7,5.5,2.6,HG[2]);icRect(g,4,5,2,2,"#ffe27a");icRect(g,10,5,2,2,"#ffe27a");icRect(g,5,5,1,2,IK);icRect(g,11,5,1,2,IK);icPoly(g,[[4.5,9],[7,9],[5.8,15]],IK);icPoly(g,[[9,9],[11.5,9],[10.2,15]],IK);icPoly(g,[[5,9],[6.6,9],[5.8,14]],"#fff8ea");icPoly(g,[[9.4,9],[11,9],[10.2,14]],"#fff8ea")},
ap_h:g=>{g.lineCap="round";g.strokeStyle=IK;g.lineWidth=4.4;g.beginPath();g.arc(7,9,5,.4,5.6);g.stroke();g.strokeStyle=HG[1];g.lineWidth=2.6;g.beginPath();g.arc(7,9,5,.4,5.6);g.stroke();g.strokeStyle=HG[2];g.lineWidth=1;g.beginPath();g.arc(7,9,5,3.4,4.6);g.stroke();icCirc(g,12.5,5,2.9,IK);icCirc(g,12.5,5,2.1,HG[1]);icRect(g,12,4,1,1,"#ffe27a");icRect(g,14,6,2,1,"#e0523a")},
ar_h:g=>{g.lineCap="round";for(const [r,c] of [[6.4,HW[1]],[4,HW[2]]]){g.strokeStyle=IK;g.lineWidth=3.2;g.beginPath();g.arc(8,9,r,3.3,5.7);g.stroke();g.strokeStyle=c;g.lineWidth=1.6;g.beginPath();g.arc(8,9,r,3.3,5.7);g.stroke()}icCirc(g,11,11,3.2,IK);icCirc(g,11,11,2.4,HG[1]);icRect(g,11,10,1,1,"#ffe27a")},
barrier_h:g=>{icCirc(g,8,8,7.4,IK);icCirc(g,8,8,6.4,HW[0]);icCirc(g,8,8,5.2,HW[1]);icCirc(g,8,8,3.4,HW[0]);icCirc(g,5.8,5.6,1.7,HW[3]);for(const [x,y] of [[1,2],[14,3],[14,13]])icRect(g,x,y,1,1,HW[2])},
shell_h:g=>{icCirc(g,8,9,7,IK);icCirc(g,8,9,6,HS[1]);icPoly(g,[[8,4.6],[11.4,6.8],[11.4,11.2],[8,13.4],[4.6,11.2],[4.6,6.8]],HS[0]);icPoly(g,[[8,5.8],[10.3,7.4],[10.3,10.6],[8,12.2],[5.7,10.6],[5.7,7.4]],HS[2]);for(const [x,y] of [[8,1],[1,6],[15,6],[2,14],[14,14]])icPoly(g,[[x-1.4,y+1.6],[x+1.4,y+1.6],[x,y-1]],"#d8ccc0")},
blade_h:g=>{g.strokeStyle=HW[0];g.lineWidth=1.3;g.beginPath();g.arc(8,8,5.6,0,6.283);g.stroke();icCirc(g,8,8,2.4,IK);icCirc(g,8,8,1.6,HS[2]);for(const a of [-1.57,.52,2.62]){const x=8+Math.cos(a)*5.6,y=8+Math.sin(a)*5.6;icCirc(g,x,y,2.8,IK);icCirc(g,x,y,2.1,HW[1]);icCirc(g,x-.5,y-.5,1,HW[3])}},
bd_h:g=>{icDrop(g,7,15.4,5,IK);icDrop(g,7,14.8,4.2,HW[1]);icDrop(g,7,14.2,2.6,HW[2]);icRect(g,5,8,1,3,HW[3]);icRect(g,13,1,1,5,"#ffffff");icRect(g,11,3,5,1,"#ffffff")},
spore_h:g=>{g.lineCap="round";const W=(w,c)=>{g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(1,13);g.quadraticCurveTo(3,3,10,3.5);g.quadraticCurveTo(15,4.5,13,9);g.stroke()};W(5.4,IK);W(3.4,HW[1]);W(1.2,HW[3]);icRect(g,0,13,16,3,IK);icRect(g,0,14,16,1,HW[1])},
storm_h:g=>{icPoly(g,[[8,0],[12.4,5],[11.4,15.6],[4.6,15.6],[3.6,5]],IK);icPoly(g,[[8,1.6],[11.2,5.4],[10.4,14.4],[5.6,14.4],[4.8,5.4]],HW[1]);icPoly(g,[[8,2.4],[9.6,5.6],[9.2,13],[6.8,13],[6.4,5.6]],HW[2]);icRect(g,7,4,1,7,HW[3]);icRect(g,0,9,2,2,HW[2]);icRect(g,14,11,2,2,HW[2])},
speed_h:g=>{g.lineCap="round";for(let i=0;i<3;i++){g.strokeStyle=IK;g.lineWidth=2.6;g.beginPath();g.moveTo(1,3+i*4);g.quadraticCurveTo(5,1+i*4,9,3+i*4);g.stroke();g.strokeStyle=i===1?HW[2]:HW[1];g.lineWidth=1.2;g.beginPath();g.moveTo(1,3+i*4);g.quadraticCurveTo(5,1+i*4,9,3+i*4);g.stroke()}icPoly(g,[[8,10],[15.4,6],[14.4,14]],IK);icPoly(g,[[9.4,10],[14.2,7.6],[13.6,12.6]],HS[2])},
magnet_h:g=>{icCirc(g,8,8,7.2,IK);icCirc(g,8,8,6.2,HW[0]);icCirc(g,8,8,4.2,HW[1]);icCirc(g,8,8,2.2,IK);icRect(g,6,6,2,1,HW[3]);g.strokeStyle=HW[2];g.lineWidth=1;g.beginPath();g.arc(8,8,6.6,-.7,.7);g.stroke();g.beginPath();g.arc(8,8,6.6,2.4,3.8);g.stroke()},
heal_h:g=>{icDrop(g,6.5,15.4,4.8,IK);icDrop(g,6.5,14.8,4,HW[1]);icDrop(g,6.5,14.2,2.4,HW[3]);icRect(g,10.5,1,3,7,IK);icRect(g,8.5,3,7,3,IK);icRect(g,11.5,2,1,5,"#7fff9a");icRect(g,9.5,4,5,1,"#7fff9a")},
ad_c:g=>{icPoly(g,[[9,0],[3,9],[7,9],[5,16],[13,6],[9,6],[11,0]],IK);icPoly(g,[[9.4,1],[4.6,8.2],[8.2,8.2],[6.6,13.6],[11.6,6.8],[8.2,6.8],[10.2,1]],"#ffe680");icPoly(g,[[9.2,1.6],[6.4,6.6],[7.6,6.6],[9.6,1.6]],"#ffffff")},
ap_c:g=>{g.lineCap="round";g.lineJoin="round";for(const [w,c] of [[3.4,IK],[1.6,"#9fe8ff"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(2,2);g.lineTo(6,7);g.lineTo(4,9);g.lineTo(8,14);g.moveTo(6,7);g.lineTo(11,5);g.lineTo(10,9);g.lineTo(14,12);g.stroke()}},
rain_c:g=>{icCirc(g,5,6,4,IK);icCirc(g,10,5,5,IK);icCirc(g,12,8,3.6,IK);icRect(g,2,7,13,4,IK);icCirc(g,5,6,3,"#8aa0c8");icCirc(g,10,5,4,"#a8bce0");icCirc(g,12,8,2.6,"#8aa0c8");icRect(g,3,7,11,3,"#8aa0c8");g.strokeStyle="#5ac8ff";g.lineWidth=1.4;g.lineCap="round";for(const x of [4,8,12]){g.beginPath();g.moveTo(x,12);g.lineTo(x-1,15);g.stroke()}},
ad_b:g=>{icPoly(g,[[3,1],[6,1],[4,15],[2,15]],IK);icPoly(g,[[7,1],[10,1],[8,15],[6,15]],IK);icPoly(g,[[11,1],[14,1],[12,15],[10,15]],IK);icPoly(g,[[4,2],[5,2],[3.4,14],[2.8,14]],"#ffffff");icPoly(g,[[8,2],[9,2],[7.4,14],[6.8,14]],"#cfe8ff");icPoly(g,[[12,2],[13,2],[11.4,14],[10.8,14]],"#ffffff")},
ap_b:g=>{g.lineCap="round";for(const [r,c] of [[13,IK],[12,"#ffffff"]]){g.strokeStyle=c;g.lineWidth=c===IK?4:2;g.beginPath();g.arc(2,14,r,-1.45,-.15);g.stroke()}g.strokeStyle="#9fd8ff";g.lineWidth=2;g.beginPath();g.arc(2,14,8,-1.4,-.2);g.stroke()},
ad_w:g=>{icRect(g,4,1,8,13,IK);icRect(g,5,2,6,11,"#ffd54a");icRect(g,6,2,2,11,"#fff4c0");icRect(g,5,1,6,2,"#ffffff");icPoly(g,[[0,16],[3,10],[6,16]],IK);icPoly(g,[[10,16],[13,10],[16,16]],IK);icPoly(g,[[1.4,15.4],[3,11.6],[4.6,15.4]],"#c88a18");icPoly(g,[[11.4,15.4],[13,11.6],[14.6,15.4]],"#8a5a14")},
ap_w:g=>{icRect(g,0,9,16,7,IK);icRect(g,1,10,14,5,"#8a5a14");g.lineCap="round";g.lineJoin="round";for(const [w,c] of [[3,IK],[1.4,"#ffd54a"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(8,15);g.lineTo(7,12);g.lineTo(9,10);g.moveTo(9,10);g.lineTo(4,7);g.moveTo(9,10);g.lineTo(13,6);g.stroke()}icPoly(g,[[2,9],[4,2],[6,9]],IK);icPoly(g,[[10,9],[12,1],[14,9]],IK);icPoly(g,[[3,8.4],[4,4],[5,8.4]],"#ffd54a");icPoly(g,[[11,8.4],[12,3],[13,8.4]],"#fff0a0")},
cycle_w:g=>{for(const [x,y,c,h] of [[8,3,"#e8442a","#ffb070"],[13,8,"#2f4a5a","#7fd0ff"],[8,13,"#e8eef4","#ffffff"],[3,8,"#2a6ac8","#9fe8ff"]]){icCirc(g,x,y,3.4,IK);icCirc(g,x,y,2.4,c);icRect(g,x-1.4,y-1.6,1.4,1.4,h)}icCirc(g,8,8,2.6,IK);icCirc(g,8,8,1.7,"#ffd54a")},
seal_w:g=>{icCirc(g,8,8,7.6,IK);icCirc(g,8,8,6.4,"#3a2408");for(const [i,c] of [[0,"#ffd54a"],[1,"#ff6a3a"],[2,"#7fd0ff"],[3,"#ffffff"],[4,"#5ac8ff"]]){const a=-1.571+i*1.2566,x=8+Math.cos(a)*4.4,y=8+Math.sin(a)*4.4;icCirc(g,x,y,1.9,c)}icCirc(g,8,8,1.6,"#ffd54a")},
gscale_w:g=>{icPoly(g,[[8,0],[15,7],[8,16],[1,7]],IK);icPoly(g,[[8,2],[13,7],[8,14],[3,7]],"#ffc830");icPoly(g,[[8,2],[13,7],[8,8],[3,7]],"#ffe070");icRect(g,6,4,2,2,"#ffffff")},
dash_b:g=>{g.lineCap="round";for(let i=0;i<3;i++){g.strokeStyle=IK;g.lineWidth=3;g.beginPath();g.moveTo(1,4+i*4);g.lineTo(9-i,4+i*4);g.stroke();g.strokeStyle=i===1?"#ffffff":"#bfe4ff";g.lineWidth=1.4;g.beginPath();g.moveTo(1,4+i*4);g.lineTo(9-i,4+i*4);g.stroke()}icPoly(g,[[8,2],[15.5,8],[8,14]],IK);icPoly(g,[[9.4,4.6],[13.6,8],[9.4,11.4]],"#ffffff")},
heart_h:g=>{icCirc(g,8,10,6.2,IK);icCirc(g,8,10,5.2,HS[1]);icPoly(g,[[8,6.6],[10.4,8.2],[10.4,11.4],[8,13],[5.6,11.4],[5.6,8.2]],HS[2]);icPoly(g,[[9.5,.5],[12,.5],[12.75,1.4],[13.5,.5],[16,.5],[16,3.2],[12.75,6.6],[9.5,3.2]],IK);icPoly(g,[[10.3,1.3],[11.8,1.3],[12.75,2.4],[13.7,1.3],[15.2,1.3],[15.2,3],[12.75,5.6],[10.3,3]],"#e0523a")}
});
/* ===== 현무 전용 레벨업: 문구 · 수치 · 팁 ===== */
const HUP={
ad:{name:"독니 채찍",nameEn:"Venom Whip",desc:"채찍 피해 +1",descEn:"Whip damage +1",icon:"ad_h",stats:p=>{const m=1.6*(p.dmgMul||1);return[[tx("채찍 피해","Whip damage"),fmt(p.arrowDamage*m),fmt((p.arrowDamage+1)*m)],[tx("물방울 피해","Droplet damage"),fmt(p.arrowDamage*.8*(p.dmgMul||1)),fmt((p.arrowDamage+1)*.8*(p.dmgMul||1))]]},tip:"뱀의 독니가 더 깊이 박혀요. 가장 확실한 화력 강화예요.",tipEn:"The serpent's fangs sink deeper. The surest damage boost."},
ap:{name:"긴 꼬리",nameEn:"Long Tail",desc:"채찍 사거리 +16",descEn:"Whip reach +16",icon:"ap_h",stats:p=>[[tx("채찍 사거리","Whip reach"),Math.round(p.whipLen||96),Math.round((p.whipLen||96)+16)]],tip:"뱀이 더 멀리 뻗어 한 번에 더 많은 적을 후려쳐요.",tipEn:"The serpent reaches farther and hits more foes in one lash."},
ar:{name:"날랜 휘감기",nameEn:"Swift Coil",desc:"공격 간격 -6%",descEn:"Attack interval -6%",icon:"ar_h",stats:UP_INFO.ar.stats,tip:"뱀이 더 자주 휘둘러요. 독니 채찍과 함께 쓰면 효과가 곱절이에요.",tipEn:"The serpent strikes more often. Twice as effective with Venom Whip."},
barrier:{name:"물의 결계",nameEn:"Water Barrier",desc:"결계 최대 +1 · 충전 15% 빠르게",descEn:"Barrier max +1 · recharges 15% faster",icon:"barrier_h",stats:p=>[[tx("결계 수","Barriers"),p.barMax||2,(p.barMax||2)+1],[tx("충전 시간","Recharge"),fmt(p.barCD||6)+tx("초","s"),fmt(Math.max(2.5,(p.barCD||6)*.85))+tx("초","s")]],tip:"공격을 한 번씩 막아 주는 물방울이 늘어나요. 현무 생존의 핵심이에요!",tipEn:"More droplets that each block one hit. The core of Hyunmu's survival!"},
shell:{name:"가시 등껍질",nameEn:"Spiked Shell",desc:"받는 피해 -8% · 반격 피해 +1",descEn:"Damage taken -8% · counter damage +1",icon:"shell_h",stats:p=>[[tx("받는 피해","Damage taken"),Math.round((p.guard||1)*100)+"%",Math.round(Math.max(.4,(p.guard||1)*.92)*100)+"%"],[tx("반격 피해","Counter damage"),p.counter||2,(p.counter||2)+1]],tip:"맞을수록 더 아프게 되갚아요. 적에게 둘러싸일수록 강해져요.",tipEn:"The more you're hit, the harder you hit back. Stronger when surrounded."},
blade:{name:"회전 물방울",nameEn:"Orbiting Droplets",desc:"몸 주위를 도는 물방울 +2개",descEn:"Orbiting droplets +2",icon:"blade_h",stats:p=>[[tx("물방울 개수","Droplets"),p.blades,p.blades+2],[tx("물방울 피해 합계","Total droplet damage"),p.blades*p.bladeDamage,(p.blades+2)*p.bladeDamage]],tip:"물방울이 몸을 감싸 가까이 붙은 적을 계속 깎아내요.",tipEn:"Droplets circle your body and wear down foes up close."},
bd:{name:"차가운 물방울",nameEn:"Chilling Droplets",desc:"회전 물방울 피해 +1",descEn:"Orbiting droplet damage +1",icon:"bd_h",stats:p=>[[tx("물방울 피해","Droplet damage"),p.bladeDamage,p.bladeDamage+1],[tx("물방울 피해 합계","Total droplet damage"),p.blades*p.bladeDamage,p.blades*(p.bladeDamage+1)]],tip:"물방울이 많을수록 더 큰 효과! 회전 물방울과 궁합이 좋아요.",tipEn:"The more droplets, the bigger the payoff! Great with Orbiting Droplets."},
spore:{name:"해일",nameEn:"Tidal Wave",desc:"주기적인 물결 폭발 강화 (+2단계) · 맞은 적 느려짐",descEn:"Periodic tidal burst empowered (+2 levels) · slows foes hit",icon:"spore_h",stats:UP_INFO.spore.stats,tip:"주기적으로 큰 물결이 퍼져 적을 쓸어내고 느리게 만들어요.",tipEn:"A great wave sweeps out periodically, washing foes away and slowing them."},
storm:{name:"빙결 감옥",nameEn:"Ice Prison",desc:"하늘에서 얼음 기둥이 떨어져요 (+3단계) · 맞은 적 느려짐",descEn:"Ice pillars fall from the sky (+3 levels) · slows foes hit",icon:"storm_h",stats:UP_INFO.storm.stats,tip:"거대한 얼음 기둥이 적을 짓누르고 얼려요. 아주 드문 최상급 강화예요.",tipEn:"Massive ice pillars crush and freeze foes. An extremely rare top-tier upgrade."},
speed:{name:"느긋한 헤엄",nameEn:"Leisurely Swim",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed_h",stats:UP_INFO.speed.stats,tip:"현무는 느린 편이라 조금만 빨라져도 큰 차이가 나요.",tipEn:"Hyunmu is slow, so even a little speed makes a big difference."},
magnet:{name:"거북의 감각",nameEn:"Tortoise Sense",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet_h",stats:UP_INFO.magnet.stats,tip:"흡수 범위가 좁은 현무에게 특히 쓸모 있어요.",tipEn:"Especially useful for Hyunmu's narrow pickup range."},
heal:{name:"차가운 샘물",nameEn:"Cool Spring",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal_h",stats:UP_INFO.heal.stats,tip:"위험할 때 바로 쓰는 응급 회복이에요. 최대 체력은 늘지 않아요.",tipEn:"An emergency heal for tight spots. Does not raise max HP."},
leech:{name:"독사의 흡혈",nameEn:"Viper's Drain",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"뱀이 쓰러진 적의 기운을 빨아들여 현무를 치유해요.",tipEn:"The serpent drains fallen foes to mend Hyunmu."},
heart:{name:"두꺼운 등껍질",nameEn:"Thick Shell",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart_h",stats:UP_INFO.heart.stats,tip:"더 두꺼운 등껍질로 더 오래 버텨요.",tipEn:"A thicker shell to last even longer."}
};
/* 현무 레벨업 풀: id -> [등급, 등장 확률(%)] (합계 100) */
Object.assign(HUP,SK);const HUP_RARITY={barrier:["epic",12],shell:["uncommon",9],leech:["uncommon",6],heal:["common",9],speed:["common",9],magnet:["common",9],ar:["common",11],ad:["uncommon",9],h_spike:["uncommon",5],heart:["uncommon",9],ap:["epic",4],h_vortex:["epic",4],h_tide:["legendary",3],h_stance:["mythic",1]};
const HAPPLY={ap:()=>{state.p.whipLen=(state.p.whipLen||96)+16},
 barrier:()=>{const p=state.p;p.barMax=(p.barMax||2)+1;p.bar=Math.min(p.barMax,(p.bar||0)+1);p.barCD=Math.max(2.5,(p.barCD||6)*.85)},
 shell:()=>{const p=state.p;p.guard=Math.max(.4,(p.guard||1)*.92);p.counter=(p.counter||2)+1}};
const HPOOL=Object.keys(HUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=HUP_RARITY[id];return{id,rar,w,apply:HAPPLY[id]||(SK[id]&&SK[id].apply)||b.apply}});
/* ===== 백호 전용 레벨업 ===== */
const BUP={
ad:{name:"날카로운 발톱",nameEn:"Razor Claws",desc:"발톱 피해 +1",descEn:"Claw damage +1",icon:"ad_b",stats:p=>{const m=BAEKHO.claw.dmg*(p.dmgMul||1);return[[tx("발톱 피해","Claw damage"),fmt(p.arrowDamage*m),fmt((p.arrowDamage+1)*m)],[tx("돌진 피해","Dash damage"),fmt((p.arrowDamage*BAEKHO.dash.dmg+(p.dashDmg||0))*(p.dmgMul||1)),fmt(((p.arrowDamage+1)*BAEKHO.dash.dmg+(p.dashDmg||0))*(p.dmgMul||1))]]},tip:"발톱과 돌진이 함께 강해져요. 백호의 핵심 강화예요.",tipEn:"Strengthens both claws and dash. Baekho's core upgrade."},
ap:{name:"넓은 할퀴기",nameEn:"Wide Swipe",desc:"발톱 사거리 +12 · 범위 넓게",descEn:"Claw reach +12 · wider arc",icon:"ap_b",stats:p=>[[tx("발톱 사거리","Claw reach"),Math.round(p.clawReach||BAEKHO.claw.reach),Math.round((p.clawReach||BAEKHO.claw.reach)+12)],[tx("발톱 범위","Claw arc"),Math.round((p.clawArc||BAEKHO.claw.arc)*2*57.3)+"°",Math.round(Math.min(2.6,(p.clawArc||BAEKHO.claw.arc)+.17)*2*57.3)+"°"]],tip:"한 번에 더 많은 적을 할퀴어요. 무리 속으로 파고드는 백호에게 딱이에요.",tipEn:"Rake more foes at once. Perfect for a tiger that dives into the pack."},
ar:{name:"빠른 앞발",nameEn:"Quick Paws",desc:"공격 간격 -6%",descEn:"Attack interval -6%",icon:"ar",stats:UP_INFO.ar.stats,tip:"발톱을 더 자주 휘둘러요.",tipEn:"Swipe more often."},
dash:{name:"질풍",nameEn:"Gale",desc:"돌진 대기 -15% · 돌진 피해 +1",descEn:"Dash cooldown -15% · dash damage +1",icon:"dash_b",stats:p=>[[tx("돌진 대기","Dash cooldown"),fmt(p.dashCD||BAEKHO.dash.cd)+tx("초","s"),fmt(Math.max(1.2,(p.dashCD||BAEKHO.dash.cd)*.85))+tx("초","s")],[tx("추가 돌진 피해","Bonus dash damage"),p.dashDmg||0,(p.dashDmg||0)+1]],tip:"더 자주 돌진해서 적 사이를 꿰뚫어요. 돌진 중에는 잠깐 무적이에요.",tipEn:"Dash more often to cut through foes. You're briefly invincible while dashing."},
blade:{name:"회전 바람칼",nameEn:"Orbiting Gales",desc:"몸 주위를 도는 바람칼 +2개",descEn:"Orbiting wind blades +2",icon:"blade",stats:UP_INFO.blade.stats,tip:"바람칼이 몸을 감싸 가까이 붙은 적을 깎아내요.",tipEn:"Wind blades circle you and shred nearby foes."},
bd:{name:"날 선 바람",nameEn:"Honed Wind",desc:"바람칼 피해 +1",descEn:"Wind blade damage +1",icon:"bd",stats:UP_INFO.bd.stats,tip:"회전 바람칼과 함께 고를수록 강해져요.",tipEn:"Gets stronger alongside Orbiting Gales."},
spore:{name:"백호의 포효",nameEn:"Tiger's Roar",desc:"주기적인 포효 충격파 강화 (+2단계)",descEn:"Periodic roar shockwave empowered (+2 levels)",icon:"spore",stats:UP_INFO.spore.stats,tip:"주기적으로 포효해 주변 적을 날려 버려요.",tipEn:"Roar periodically to blast nearby foes."},
storm:{name:"벼락 발톱",nameEn:"Thunder Claw",desc:"하늘에서 벼락이 내리꽂혀요 (+3단계)",descEn:"Lightning strikes from the sky (+3 levels)",icon:"storm",stats:UP_INFO.storm.stats,tip:"아주 드문 최상급 강화예요.",tipEn:"An extremely rare top-tier upgrade."},
speed:{name:"날쌘 몸놀림",nameEn:"Nimble Body",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed",stats:UP_INFO.speed.stats,tip:"원래 빠른 백호가 더 빨라져요.",tipEn:"The already-fast Baekho gets even faster."},
magnet:{name:"예민한 수염",nameEn:"Keen Whiskers",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet",stats:UP_INFO.magnet.stats,tip:"멀리 있는 불씨 조각도 느껴요.",tipEn:"Sense shards from farther away."},
heal:{name:"사냥한 고기",nameEn:"Fresh Catch",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal",stats:UP_INFO.heal.stats,tip:"체력이 낮은 백호의 응급 회복이에요.",tipEn:"An emergency heal for low-HP Baekho."},
leech:{name:"포식자의 피",nameEn:"Predator's Blood",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"많이 잡는 백호와 특히 잘 맞아요.",tipEn:"A great match for Baekho's fast kills."},
heart:{name:"두꺼운 털가죽",nameEn:"Thick Pelt",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart",stats:UP_INFO.heart.stats,tip:"약한 몸을 보완해 줘요.",tipEn:"Shores up Baekho's frail body."}};
Object.assign(BUP,SK);const BUP_RARITY={dash:["epic",12],ad:["uncommon",11],ar:["common",13],ap:["epic",5],leech:["uncommon",7],heal:["common",10],speed:["common",10],magnet:["common",10],b_prey:["uncommon",5],heart:["uncommon",9],b_ghost:["epic",4],b_chain:["legendary",3],b_roar:["mythic",1]};
const BAPPLY={ap:()=>{const p=state.p;p.clawReach=(p.clawReach||BAEKHO.claw.reach)+12;p.clawArc=Math.min(2.6,(p.clawArc||BAEKHO.claw.arc)+.17)},
 dash:()=>{const p=state.p;p.dashCD=Math.max(1.2,(p.dashCD||BAEKHO.dash.cd)*.85);p.dashDmg=(p.dashDmg||0)+1}};

/* ===== 청룡 전용 레벨업 ===== */
const CUP={
ad:{name:"벼락 강화",nameEn:"Charged Bolt",desc:"번개 피해 +1",descEn:"Lightning damage +1",icon:"ad_c",stats:p=>{const m=CHEONG.chain.dmg*(p.dmgMul||1);return[[tx("번개 피해","Lightning damage"),fmt(p.arrowDamage*m),fmt((p.arrowDamage+1)*m)]]},tip:"튕길 때마다 줄어들지만, 처음 맞는 적에게 가장 강하게 꽂혀요.",tipEn:"Weakens with each bounce, but hits the first foe hardest."},
ap:{name:"갈래 번개",nameEn:"Forked Lightning",desc:"번개가 튕기는 횟수 +1",descEn:"Lightning bounces +1",icon:"ap_c",stats:p=>[[tx("튕기는 횟수","Bounces"),CHEONG.chain.jumps+(p.chainJumps||0),CHEONG.chain.jumps+(p.chainJumps||0)+1]],tip:"한 번에 더 많은 적을 지져요. 몹이 많을수록 강해요.",tipEn:"Fry more foes at once. Stronger in a crowd."},
ar:{name:"빠른 번개",nameEn:"Quick Spark",desc:"공격 간격 -6%",descEn:"Attack interval -6%",icon:"ar",stats:UP_INFO.ar.stats,tip:"번개를 더 자주 내리쳐요. 여의주도 더 빨리 차요.",tipEn:"Strike more often — and charge the pearl faster."},
rain:{name:"단비",nameEn:"Blessed Rain",desc:"비구름 대기 -15% · 반경 +15",descEn:"Rain cloud cooldown -15% · radius +15",icon:"rain_c",stats:p=>[[tx("비구름 대기","Rain cooldown"),fmt(p.rainCD||CHEONG.rain.cd)+tx("초","s"),fmt(Math.max(3,(p.rainCD||CHEONG.rain.cd)*.85))+tx("초","s")],[tx("비구름 반경","Rain radius"),p.rainR||CHEONG.rain.r,(p.rainR||CHEONG.rain.r)+15]],tip:"비구름 안에서는 적이 느려지고 청룡은 회복해요.",tipEn:"Inside the rain, foes slow down and Cheongryong heals."},
blade:{name:"회전 구름",nameEn:"Orbiting Clouds",desc:"몸 주위를 도는 번개 구름 +2개",descEn:"Orbiting thunderclouds +2",icon:"blade",stats:UP_INFO.blade.stats,tip:"가까이 붙은 적을 계속 지져요.",tipEn:"Keeps zapping foes that get close."},
bd:{name:"짙은 먹구름",nameEn:"Dark Clouds",desc:"번개 구름 피해 +1",descEn:"Thundercloud damage +1",icon:"bd",stats:UP_INFO.bd.stats,tip:"회전 구름과 함께 고를수록 강해져요.",tipEn:"Gets stronger with Orbiting Clouds."},
spore:{name:"천둥 울림",nameEn:"Thunderclap",desc:"주기적인 천둥 충격파 강화 (+2단계)",descEn:"Periodic thunder shockwave empowered (+2 levels)",icon:"spore",stats:UP_INFO.spore.stats,tip:"주기적으로 천둥이 울려 주변 적을 쓸어내요.",tipEn:"Thunder booms periodically, sweeping away nearby foes."},
storm:{name:"용오름",nameEn:"Dragon Spout",desc:"하늘에서 벼락이 쏟아져요 (+3단계)",descEn:"Bolts rain from the sky (+3 levels)",icon:"storm",stats:UP_INFO.storm.stats,tip:"아주 드문 최상급 강화예요.",tipEn:"An extremely rare top-tier upgrade."},
speed:{name:"구름 타기",nameEn:"Cloud Ride",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed",stats:UP_INFO.speed.stats,tip:"구름을 타고 가볍게 움직여요.",tipEn:"Glide along on the clouds."},
magnet:{name:"여의주 감각",nameEn:"Pearl Sense",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet",stats:UP_INFO.magnet.stats,tip:"여의주가 멀리 있는 조각도 끌어와요.",tipEn:"The pearl draws in distant shards."},
heal:{name:"봄 이슬",nameEn:"Spring Dew",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal",stats:UP_INFO.heal.stats,tip:"위험할 때 쓰는 응급 회복이에요.",tipEn:"An emergency heal."},
leech:{name:"생명의 비",nameEn:"Rain of Life",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"번개로 한꺼번에 잡는 청룡과 잘 맞아요.",tipEn:"Great with Cheongryong's mass chain kills."},
heart:{name:"푸른 비늘",nameEn:"Azure Scales",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart",stats:UP_INFO.heart.stats,tip:"더 단단한 비늘로 오래 버텨요.",tipEn:"Tougher scales to last longer."}};
Object.assign(CUP,SK);const CUP_RARITY={rain:["epic",12],ad:["uncommon",11],ap:["epic",7],ar:["common",12],leech:["uncommon",6],heal:["common",10],speed:["common",9],magnet:["common",9],heart:["uncommon",10],c_web:["epic",7],c_spout:["legendary",5],c_ascend:["mythic",2]};
const CAPPLY={ap:()=>{state.p.chainJumps=(state.p.chainJumps||0)+1},
 rain:()=>{const p=state.p;p.rainCD=Math.max(3,(p.rainCD||CHEONG.rain.cd)*.85);p.rainR=(p.rainR||CHEONG.rain.r)+15}};
const CPOOL=Object.keys(CUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=CUP_RARITY[id];return{id,rar,w,apply:CAPPLY[id]||(SK[id]&&SK[id].apply)||b.apply}});
const BPOOL=Object.keys(BUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=BUP_RARITY[id];return{id,rar,w,apply:BAPPLY[id]||(SK[id]&&SK[id].apply)||b.apply}});

/* ===== 황룡 전용 레벨업 ===== */
const WUP={
ad:{name:"대지의 분노",nameEn:"Wrath of the Earth",desc:"황금 기둥 피해 +1",descEn:"Golden pillar damage +1",icon:"ad_w",stats:p=>{const m=HWANG.pillar.dmg*(p.dmgMul||1);return[[tx("기둥 피해","Pillar damage"),fmt(p.arrowDamage*m),fmt((p.arrowDamage+1)*m)]]},tip:"사신에게서 빌려 쓰는 기술도 함께 강해져요.",tipEn:"Borrowed guardian skills grow stronger too."},
ap:{name:"갈라지는 대지",nameEn:"Splitting Earth",desc:"황금 기둥 +1개 (최대 +4) · 반경 +6",descEn:"Golden pillars +1 (max +4) · radius +6",icon:"ap_w",stats:p=>[[tx("기둥 수","Pillars"),1+(p.pillarExtra||0),1+Math.min(4,(p.pillarExtra||0)+1)],[tx("기둥 반경","Pillar radius"),p.pillarR||HWANG.pillar.r,(p.pillarR||HWANG.pillar.r)+6]],tip:"주변의 다른 적 발밑에서도 기둥이 솟아요.",tipEn:"Pillars also erupt under other nearby foes."},
ar:{name:"잦은 진동",nameEn:"Quick Tremor",desc:"공격 간격 -6%",descEn:"Attack interval -6%",icon:"ar",stats:UP_INFO.ar.stats,tip:"황금 기둥이 더 자주 솟아요.",tipEn:"Pillars erupt more often."},
cycle:{name:"오방 순환",nameEn:"Five-Way Cycle",desc:"사신 부르기 대기 -12% · 빌린 기술 피해 +15%",descEn:"Guardian summon cooldown -12% · borrowed skill damage +15%",icon:"cycle_w",stats:p=>[[tx("부르기 대기","Summon cooldown"),fmt(p.cycleCD||HWANG.cycle.cd)+tx("초","s"),fmt(Math.max(2,(p.cycleCD||HWANG.cycle.cd)*.88))+tx("초","s")],[tx("빌린 기술 피해","Borrowed damage"),Math.round((p.cycleMul||1)*100)+"%",Math.round((p.cycleMul||1)*115)+"%"]],tip:"주작 → 현무 → 백호 → 청룡 순서로 힘을 빌려요.",tipEn:"Borrows power in order: Zhuque → Hyunmu → Baekho → Cheongryong."},
gscale:{name:"황금 비늘",nameEn:"Golden Scale",desc:"황금 비늘 충전 -15% · 최대 체력 +10",descEn:"Golden scale recharges 15% faster · Max HP +10",icon:"gscale_w",stats:p=>[[tx("비늘 충전","Scale recharge"),fmt(p.gscaleCD||HWANG.scale.cd)+tx("초","s"),fmt(Math.max(4,(p.gscaleCD||HWANG.scale.cd)*.85))+tx("초","s")],[tx("최대 체력","Max HP"),p.maxHp,p.maxHp+10]],tip:"공격을 막아 주는 비늘이 더 빨리 돌아와요. (하드에서는 체력만 올라요)",tipEn:"The blocking scale returns sooner. (Hard: only the HP bonus applies)"},
blade:{name:"황금 여의주",nameEn:"Golden Pearls",desc:"몸 주위를 도는 여의주 +2개",descEn:"Orbiting pearls +2",icon:"blade",stats:UP_INFO.blade.stats,tip:"가까이 붙은 적을 계속 두드려요.",tipEn:"Keeps pounding foes that get close."},
bd:{name:"빛나는 여의주",nameEn:"Radiant Pearls",desc:"여의주 피해 +1",descEn:"Pearl damage +1",icon:"bd",stats:UP_INFO.bd.stats,tip:"황금 여의주와 함께 고를수록 강해져요.",tipEn:"Gets stronger with Golden Pearls."},
spore:{name:"땅울림",nameEn:"Earthquake",desc:"주기적인 땅울림 강화 (+2단계)",descEn:"Periodic earthquake empowered (+2 levels)",icon:"spore",stats:UP_INFO.spore.stats,tip:"주기적으로 땅이 울려 주변 적을 쓸어내요.",tipEn:"The ground shakes periodically, sweeping away nearby foes."},
storm:{name:"하늘의 돌비",nameEn:"Stone Rain",desc:"하늘에서 바위가 쏟아져요 (+3단계)",descEn:"Boulders rain from the sky (+3 levels)",icon:"storm",stats:UP_INFO.storm.stats,tip:"아주 드문 최상급 강화예요.",tipEn:"An extremely rare top-tier upgrade."},
speed:{name:"구름 걸음",nameEn:"Cloud Step",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed",stats:UP_INFO.speed.stats,tip:"황금 구름을 타고 가볍게 움직여요.",tipEn:"Glide along on golden clouds."},
magnet:{name:"금빛 수염",nameEn:"Golden Whiskers",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet",stats:UP_INFO.magnet.stats,tip:"멀리 있는 조각도 느껴요.",tipEn:"Sense shards from farther away."},
heal:{name:"오곡 공양",nameEn:"Harvest Offering",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal",stats:UP_INFO.heal.stats,tip:"위험할 때 쓰는 응급 회복이에요.",tipEn:"An emergency heal."},
leech:{name:"생명의 대지",nameEn:"Living Earth",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"기둥으로 한꺼번에 잡는 황룡과 잘 맞아요.",tipEn:"Great with Hwangryong's pillar sweeps."},
seal:{name:"오행 상생",nameEn:"Five-Phase Harmony",desc:"봉인 폭발 피해 +30% · 범위 +12 (처음 고르면 봉인에 필요한 속성 -1)",descEn:"Seal blast damage +30% · radius +12 (first pick: one fewer element needed)",icon:"seal_w",stats:p=>[[tx("필요 속성","Elements needed"),Math.max(2,HWANG.seal.need-(p.sealEase||0)),Math.max(2,HWANG.seal.need-1)],[tx("폭발 피해","Blast damage"),Math.round((p.sealMul||1)*100)+"%",Math.round((p.sealMul||1)*130)+"%"]],tip:"속성이 2개만 모여도 봉인돼서 연쇄 폭발이 훨씬 잦아져요.",tipEn:"Seals trigger with just 2 elements, so chain blasts happen far more often."},
heart:{name:"단단한 용린",nameEn:"Sturdy Dragonhide",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart",stats:UP_INFO.heart.stats,tip:"더 오래 버텨요.",tipEn:"Last longer."}};
Object.assign(WUP,SK);const WUP_RARITY={seal:["epic",6],cycle:["epic",9],ad:["uncommon",10],ap:["epic",7],ar:["common",11],gscale:["uncommon",7],leech:["uncommon",6],heal:["common",8],speed:["common",7],magnet:["common",8],heart:["uncommon",9],w_ley:["epic",6],w_form:["legendary",4],w_desc:["mythic",2]};
const WAPPLY={ap:()=>{const p=state.p;p.pillarExtra=Math.min(4,(p.pillarExtra||0)+1);p.pillarR=(p.pillarR||HWANG.pillar.r)+6},
 cycle:()=>{const p=state.p;p.cycleCD=Math.max(2,(p.cycleCD||HWANG.cycle.cd)*.88);p.cycleMul=(p.cycleMul||1)*1.15},
 seal:()=>{const p=state.p;p.sealEase=1;p.sealMul=(p.sealMul||1)*1.3;p.sealR=(p.sealR||0)+12},
 gscale:()=>{const p=state.p;p.gscaleCD=Math.max(4,(p.gscaleCD||HWANG.scale.cd)*.85);p.maxHp+=10;p.hp=Math.min(p.maxHp,p.hp+10)}};
const WPOOL=Object.keys(WUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=WUP_RARITY[id];return{id,rar,w,apply:WAPPLY[id]||(SK[id]&&SK[id].apply)||b.apply}});

/* ===== 기린 전용 레벨업 ===== */
Object.assign(SKN,{q_prism:{len:230,spread:.45,dmg:.55,per:.15},q_bell:{cd:10,heal:5,per:3,r:220},q_angel:{low:.3,cd:60,inv:2,heal:.15},q_gate:{cd:26,per:6,time:4,gap:.2,n:3,dmg:1.5}});
Object.assign(SK,{
q_prism:{max:3,name:"굴절",nameEn:"Refraction",desc:"성광 창이 처음 맞힌 적에게서 빛줄기 2갈래로 갈라져요 (3단계: 4갈래)",descEn:"The lance splits into 2 beams at the first foe it hits (Lv3: 4 beams)",icon:"q_prism",stats:p=>{const l=skL(p,"q_prism"),N=SKN.q_prism,v=k=>Math.round((N.dmg+N.per*(k-1))*100)+"%";return[skLv("q_prism",p),[tx("갈래 피해","Split damage"),l?v(l):"—",v(l+1)]]},tip:"적이 줄지어 있지 않아도 넓게 쓸어요.",tipEn:"Sweeps wide even when foes aren't lined up."},
q_bell:{max:4,name:"축복의 종",nameEn:"Bell of Blessing",desc:"10초마다 종이 울려 체력을 회복하고, 주변 적 모두에게 낙인을 새겨요",descEn:"Every 10s a bell rings: heals you and Brands every nearby foe",icon:"q_bell",stats:p=>{const l=skL(p,"q_bell"),N=SKN.q_bell;return[skLv("q_bell",p),[tx("회복량","Heal"),l?N.heal+N.per*(l-1):"—",N.heal+N.per*l]]},tip:"체력이 가득 차 있으면 넘친 만큼 보호막이 돼요.",tipEn:"At full HP the overflow becomes a shield."},
q_angel:{max:1,name:"수호의 빛",nameEn:"Guardian Light",desc:"체력이 30% 아래로 떨어지면 2초 무적 · 보호막 가득 · 체력 15% 회복 (60초마다)",descEn:"Below 30% HP: 2s invincibility, full shield and 15% heal (every 60s)",icon:"q_angel",stats:p=>[[tx("재사용","Cooldown"),"—",SKN.q_angel.cd+tx("초","s")]],tip:"한 번은 꼭 살려 주는 보험이에요.",tipEn:"A safety net that saves you once a minute."},
q_gate:{max:2,name:"천상의 문",nameEn:"Heavenly Gate",desc:"주기적으로 하늘 문이 4초 동안 열려 화면 안의 적에게 빛기둥이 쏟아져요",descEn:"Periodically the Heavenly Gate opens for 4s, raining pillars of light on foes across the screen",icon:"q_gate",stats:p=>{const l=skL(p,"q_gate"),N=SKN.q_gate,cd=k=>Math.max(10,N.cd-N.per*(k-1))+tx("초","s");return[skLv("q_gate",p),[tx("문 대기","Cooldown"),l?cd(l):"—",cd(l+1)]]},tip:"맞은 적 모두 낙인이 찍혀 회복이 쏟아져요.",tipEn:"Every foe struck is Branded — healing pours in."}});
for(const id of ["q_prism","q_bell","q_angel","q_gate"])SK[id].apply=()=>{const p=state.p;p["sk_"+id]=skL(p,id)+1};
Object.assign(ICON_DRAW,{
q_prism:g=>{icPoly(g,[[8,1],[14,13],[2,13]],IK);icPoly(g,[[8,3.4],[12.4,11.8],[3.6,11.8]],"#e8f4ff");icPoly(g,[[8,3.4],[10,8],[6,8]],"#ffffff");icRect(g,0,7,5,1,"#fff6c0");icRect(g,11,4,5,1,"#ffd54a");icRect(g,11,9,5,1,"#9ae8d0");icRect(g,11,14,5,1,"#ffa8c0")},
q_bell:g=>{icPoly(g,[[4,4],[12,4],[14,13],[2,13]],IK);icPoly(g,[[5,5],[11,5],[12.6,12],[3.4,12]],"#ffd54a");icRect(g,5,6,2,5,"#fff0a0");icRect(g,1,12,14,3,IK);icRect(g,2,12,12,2,"#c88a18");icRect(g,7,1,2,3,IK);icRect(g,7,14,2,2,IK)},
q_angel:g=>{icPoly(g,[[8,4],[1,1],[3,9],[8,8]],IK);icPoly(g,[[8,4],[15,1],[13,9],[8,8]],IK);icPoly(g,[[7.4,4.6],[2.2,2.2],[3.6,8.2],[7.4,7.4]],"#ffffff");icPoly(g,[[8.6,4.6],[13.8,2.2],[12.4,8.2],[8.6,7.4]],"#ffffff");icCirc(g,8,11,3.4,IK);icCirc(g,8,11,2.4,"#fff6c0")},
q_gate:g=>{icRect(g,1,2,14,3,IK);icRect(g,2,3,12,1,"#ffd54a");icRect(g,2,5,3,11,IK);icRect(g,11,5,3,11,IK);icRect(g,3,5,1,10,"#e8443a");icRect(g,12,5,1,10,"#e8443a");icRect(g,5,6,6,10,"#fff6c0");icRect(g,7,6,2,10,"#ffffff")},
ad_q:g=>{g.lineCap="round";for(const [w,c] of [[4,IK],[2,"#fff0a0"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(2,14);g.lineTo(13,3);g.stroke()}icPoly(g,[[15,1],[14,7],[9,2]],IK);icPoly(g,[[14,2],[13.4,5.6],[10.4,2.6]],"#ffd54a")},
ap_q:g=>{icRect(g,0,6,16,4,IK);icRect(g,1,7,14,2,"#fff6c0");icRect(g,1,7,14,1,"#ffffff");icPoly(g,[[12,3],[16,8],[12,13]],IK);icPoly(g,[[12.8,5],[14.8,8],[12.8,11]],"#ffd54a")},
smite_q:g=>{icRect(g,5,0,6,13,IK);icRect(g,6,0,4,12,"#fff6c0");icRect(g,7,0,2,12,"#ffffff");icRect(g,2,12,12,3,IK);icRect(g,3,12,10,2,"#ffd54a")},
grace_q:g=>{icPoly(g,[[8,1],[14,4],[13,11],[8,15],[3,11],[2,4]],IK);icPoly(g,[[8,2.6],[12.6,5],[11.8,10.4],[8,13.4],[4.2,10.4],[3.4,5]],"#ffd54a");icPoly(g,[[8,4],[11,6],[8,11],[5,6]],"#fff6c0");icRect(g,7,5,2,2,"#ffffff")}});
const QUP={
ad:{name:"성광 강화",nameEn:"Brighter Lance",desc:"성광 창 피해 +1",descEn:"Holy lance damage +1",icon:"ad_q",stats:p=>{const m=QILIN.lance.dmg*(p.dmgMul||1);return[[tx("창 피해","Lance damage"),fmt(p.arrowDamage*m),fmt((p.arrowDamage+1)*m)]]},tip:"천벌 · 천상의 문 피해도 함께 올라요.",tipEn:"Smite and Heavenly Gate damage rise too."},
ap:{name:"멀리 뻗는 빛",nameEn:"Far-reaching Light",desc:"성광 창 사거리 +40 · 굵기 +3",descEn:"Lance range +40 · width +3",icon:"ap_q",stats:p=>[[tx("사거리","Range"),QILIN.lance.range+(p.lanceLen||0),QILIN.lance.range+(p.lanceLen||0)+40],[tx("굵기","Width"),QILIN.lance.w+(p.lanceW||0),QILIN.lance.w+(p.lanceW||0)+3]],tip:"한 줄로 더 많은 적을 꿰뚫어요.",tipEn:"Pierce more foes in one line."},
ar:{name:"빠른 기도",nameEn:"Swift Prayer",desc:"공격 간격 -6%",descEn:"Attack interval -6%",icon:"ar",stats:UP_INFO.ar.stats,tip:"성광 창을 더 자주 쏴요.",tipEn:"Fire the lance more often."},
smite:{name:"천벌 강화",nameEn:"Greater Smite",desc:"천벌 대상 +1 · 대기 -10%",descEn:"Smite targets +1 · cooldown -10%",icon:"smite_q",stats:p=>[[tx("천벌 대상","Smite targets"),QILIN.smite.n+(p.smiteN||0),QILIN.smite.n+(p.smiteN||0)+1],[tx("천벌 대기","Smite cooldown"),fmt(Math.max(1.5,QILIN.smite.cd*(p.smiteCDm||1)))+tx("초","s"),fmt(Math.max(1.5,QILIN.smite.cd*(p.smiteCDm||1)*.9))+tx("초","s")]],tip:"가장 튼튼한 적부터 내리쳐요.",tipEn:"Strikes the toughest foes first."},
grace:{name:"깊은 은총",nameEn:"Deeper Grace",desc:"보호막 최대치 +10% · 낙인 회복 +1",descEn:"Shield cap +10% · Brand heal +1",icon:"grace_q",stats:p=>[[tx("보호막 최대","Shield cap"),Math.round((QILIN.grace.cap+(p.graceCap||0))*100)+"%",Math.round((QILIN.grace.cap+(p.graceCap||0)+.1)*100)+"%"],[tx("낙인 회복","Brand heal"),QILIN.brand.heal+(p.brandHeal||0),QILIN.brand.heal+(p.brandHeal||0)+1]],tip:"오래 버틸수록 보호막이 두꺼워져요. (하드에서는 회복량만 올라요)",tipEn:"The longer you last, the thicker the shield. (Hard: heal bonus only)"},
speed:{name:"구름 발굽",nameEn:"Cloud Hooves",desc:"이동 속도 +5%",descEn:"Move speed +5%",icon:"speed",stats:UP_INFO.speed.stats,tip:"구름을 밟고 가볍게 달려요.",tipEn:"Trot lightly across the clouds."},
magnet:{name:"상서로운 기운",nameEn:"Auspicious Aura",desc:"불씨 조각 흡수 범위 +15%",descEn:"Shard pickup range +15%",icon:"magnet",stats:UP_INFO.magnet.stats,tip:"멀리 있는 조각도 끌어와요.",tipEn:"Draw in distant shards."},
heal:{name:"성스러운 샘",nameEn:"Holy Spring",desc:"체력 20 회복",descEn:"Restore 20 HP",icon:"heal",stats:UP_INFO.heal.stats,tip:"넘치는 회복은 보호막이 돼요.",tipEn:"Overflow becomes a shield."},
leech:{name:"정화의 빛",nameEn:"Purifying Light",desc:"적 처치 시 체력 +1 회복",descEn:"Heal 1 HP per enemy defeated",icon:"leech",stats:UP_INFO.leech.stats,tip:"낙인과 함께라면 회복이 끊이지 않아요.",tipEn:"With Brand, the healing never stops."},
heart:{name:"상서로운 비늘",nameEn:"Auspicious Scales",desc:"최대 체력 +20 및 회복",descEn:"Max HP +20 and heal",icon:"heart",stats:UP_INFO.heart.stats,tip:"보호막 최대치도 함께 늘어나요.",tipEn:"Raises the shield cap too."}};
Object.assign(QUP,SK);
const QUP_RARITY={smite:["epic",11],ad:["uncommon",11],ap:["epic",6],ar:["common",12],grace:["uncommon",7],leech:["uncommon",5],heal:["common",8],speed:["common",8],magnet:["common",7],heart:["uncommon",7],q_bell:["uncommon",6],q_prism:["epic",7],q_angel:["legendary",3],q_gate:["mythic",2]};
const QAPPLY={ap:()=>{const p=state.p;p.lanceLen=(p.lanceLen||0)+40;p.lanceW=(p.lanceW||0)+3},smite:()=>{const p=state.p;p.smiteN=(p.smiteN||0)+1;p.smiteCDm=(p.smiteCDm||1)*.9},grace:()=>{const p=state.p;p.graceCap=(p.graceCap||0)+.1;p.brandHeal=(p.brandHeal||0)+1}};
const QPOOL=Object.keys(QUP_RARITY).map(id=>{const b=upgrades.find(u=>u.id===id),[rar,w]=QUP_RARITY[id];return{id,rar,w,apply:QAPPLY[id]||(SK[id]&&SK[id].apply)||b.apply}});

/* ===== 이그니 전용 레벨업: 공용 회전 구슬 · 폭발 · 메테오 대신 잿불 고유 스킬 ===== */
Object.assign(SKN,{i_ignite:{dmg:1.2,per:.4,r:48,rp:8,spread:1},i_kindle:{cd:8,life:5,per:1,r:50,heal:1.2,dps:.7},i_bounce:{range:230},i_swarm:{n:2,speed:250,dmg:.6,cd:.45,seek:320}});
Object.assign(SK,{
i_ignite:{max:3,name:"불씨 점화",nameEn:"Kindle Burst",desc:"그을림이 5중첩 쌓인 적이 터지며 주변에 피해를 주고 그을림을 1중첩 옮겨요",descEn:"Foes at 5 Scorch stacks burst, damaging nearby foes and spreading 1 stack",icon:"i_ignite",stats:p=>{const l=skL(p,"i_ignite"),N=SKN.i_ignite,v=k=>Math.round((N.dmg+N.per*(k-1))*100)+"%";return[skLv("i_ignite",p),[tx("점화 피해","Burst damage"),l?v(l):"—",v(l+1)]]},tip:"빽빽한 무리에서 연쇄로 터져요.",tipEn:"Chains through dense hordes."},
i_kindle:{max:4,name:"모닥불",nameEn:"Campfire",desc:"8초마다 발밑에 모닥불을 피워요. 곁에 있으면 체력이 회복되고, 다가온 적은 그을려요",descEn:"Every 8s, light a campfire at your feet: it heals you while you're near and scorches foes that come close",icon:"i_kindle",stats:p=>{const l=skL(p,"i_kindle"),N=SKN.i_kindle;return[skLv("i_kindle",p),[tx("유지 시간","Duration"),l?(N.life+N.per*(l-1))+tx("초","s"):"—",(N.life+N.per*l)+tx("초","s")]]},tip:"모닥불 주위를 돌며 싸우면 오래 버텨요.",tipEn:"Fight around the fire to last much longer."},
i_bounce:{max:2,name:"튀는 불씨",nameEn:"Bouncing Embers",desc:"불씨 화살이 적을 맞히면 근처의 다른 적에게 튕겨 날아가요",descEn:"Ember arrows ricochet to another nearby foe on hit",icon:"i_bounce",stats:p=>{const l=skL(p,"i_bounce");return[skLv("i_bounce",p),[tx("튕김","Bounces"),l?"+"+l:"—","+"+(l+1)]]},tip:"관통이 다 떨어진 뒤에도 튕겨요.",tipEn:"Bounces even after pierce runs out."},
i_swarm:{max:2,name:"꼬마 불씨 용",nameEn:"Ember Hatchlings",desc:"꼬마 불씨 용 2마리가 따라다니며 적을 찾아가 깨물어요",descEn:"Two ember hatchlings follow you and fly off to nibble foes",icon:"i_swarm",stats:p=>{const l=skL(p,"i_swarm");return[skLv("i_swarm",p),[tx("꼬마 용","Hatchlings"),l?SKN.i_swarm.n*l:"—",SKN.i_swarm.n*(l+1)]]},tip:"깨물 때마다 그을림이 쌓여요.",tipEn:"Every nibble adds Scorch."}});
for(const id of ["i_ignite","i_kindle","i_bounce","i_swarm"])SK[id].apply=()=>{const p=state.p;p["sk_"+id]=skL(p,id)+1};
Object.assign(ICON_DRAW,{
i_ignite:g=>{icCirc(g,8,9,6.4,IK);icCirc(g,8,9,5,"#e8442a");icCirc(g,8,9,3.2,"#ffb04a");icCirc(g,8,9,1.6,"#fff2c0");for(const [x,y] of [[1,2],[14,3],[2,15],[14,14]]){icRect(g,x,y,2,2,"#ffd54a")}},
i_kindle:g=>{icRect(g,2,12,12,3,IK);icRect(g,3,12,10,2,"#7a4a20");icRect(g,1,13,4,2,IK);icRect(g,11,13,4,2,IK);icPoly(g,[[4,12],[8,1],[12,12]],IK);icPoly(g,[[5,11.4],[8,3],[11,11.4]],"#e8442a");icPoly(g,[[6.4,11.4],[8,6],[9.6,11.4]],"#ffd54a")},
i_bounce:g=>{g.lineCap="round";g.strokeStyle="#ffb070";g.lineWidth=1.4;g.setLineDash([2,2]);g.beginPath();g.moveTo(2,13);g.lineTo(8,4);g.lineTo(14,12);g.stroke();g.setLineDash([]);for(const [x,y] of [[2,13],[8,4],[14,12]]){icCirc(g,x,y,2.6,IK);icCirc(g,x,y,1.6,"#ff8a2a")}},
i_swarm:g=>{for(const [o,y] of [[0,4],[6,10]]){icPoly(g,[[1+o,y],[5+o,y-3],[9+o,y],[5+o,y+3]],IK);icRect(g,3+o,y-1,4,2,"#f2643c");icRect(g,2+o,y-3,2,2,"#ffc24a");icRect(g,6+o,y-1,1,1,"#ffffff")}}});
const IGN_GENERIC=["bd","blade","spore","storm"],IUP_EXTRA={i_kindle:["uncommon",6],i_ignite:["epic",4],i_bounce:["legendary",1.8],i_swarm:["mythic",.7]};
const IPOOL=[...upgrades.filter(u=>!IGN_GENERIC.includes(u.id)),...Object.entries(IUP_EXTRA).map(([id,[rar,w]])=>({id,rar,w,apply:SK[id].apply}))];
function igBurst(e){const p=state.p,l=skL(p,"i_ignite"),N=SKN.i_ignite,R=N.r+N.rp*(l-1);e.emb=0;e.embT=0;
 for(const o of state.enemies){if(o.ghost||!inMap(o)||o.hp<=0)continue;if(dist2(o,e)<(R+o.r)**2){hurt(o,p.arrowDamage*(N.dmg+N.per*(l-1)),"#ffb070","i_ignite");if(o!==e){o.emb=Math.min(ELEM.ember.max,(o.emb||0)+N.spread);o.embT=ELEM.ember.time}}}
 state.fx.push({type:"evoBoom",x:e.x,y:e.y,r:R,life:.25,max:.25});burst(e.x,e.y,"#ff8a2a",10);burst(e.x,e.y,"#ffd54a",6);if(typeof audio!=="undefined")audio.sfx("fboom")}
function igTick(dt){const p=state.p;if(!p||p.charId!=="ignis"||state.dead)return;const AD=p.arrowDamage;
 const lk=skL(p,"i_kindle");if(lk){const N=SKN.i_kindle;p.fireT=(p.fireT==null?2:p.fireT)-dt;if(p.fireT<=0){p.fireT=N.cd;const L=N.life+N.per*(lk-1);state.fx.push({type:"ikindle",x:p.x,y:p.y+6,life:L,max:L,tick:0})}
  for(const f of state.fx){if(f.type!=="ikindle")continue;if(dist2(p,f)<N.r*N.r&&p.hp>0&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+N.heal*lk*dt);f.tick-=dt;if(f.tick<=0){f.tick=.5;for(const e of state.enemies)if(!e.ghost&&inMap(e)&&e.hp>0&&dist2(e,f)<(N.r+e.r)**2)hurt(e,AD*N.dps*.5,"#ff8a3a","i_kindle")}}}
 const ls=skL(p,"i_swarm");if(ls){const N=SKN.i_swarm,want=N.n*ls*(p.ev_ig?2:1);p.swarm=p.swarm||[];while(p.swarm.length<want)p.swarm.push({x:p.x,y:p.y,cd:0,ph:rand(0,6.283),f:1});
  for(const m of p.swarm){m.cd-=dt;m.ph+=dt*3;let tg=null,bd=N.seek*N.seek;for(const e of state.enemies){if(e.ghost||!inMap(e)||e.hp<=0)continue;const d2=dist2(e,p);if(d2<bd){const dm=dist2(e,m);if(!tg||dm<dist2(tg,m))tg=e}}
   const tx2=tg?tg.x:p.x+Math.cos(m.ph)*26,ty2=tg?tg.y-6:p.y-18+Math.sin(m.ph*1.3)*8,dx=tx2-m.x,dy=ty2-m.y,d=Math.hypot(dx,dy)||1,sp=tg?N.speed:Math.min(N.speed,d*4);m.x+=dx/d*Math.min(d,sp*dt);m.y+=dy/d*Math.min(d,sp*dt);if(Math.abs(dx)>1)m.f=dx>0?1:-1;
   if(tg&&m.cd<=0&&d<tg.r+8){m.cd=N.cd;hurt(tg,AD*N.dmg,"#ffb070","i_swarm");if(p.ev_ig){const a=rand(0,6.283);state.arrows.push({x:m.x,y:m.y,vx:Math.cos(a)*p.arrowSpeed,vy:Math.sin(a)*p.arrowSpeed,r:4,damage:AD*.6,pierce:1,hit:new Set([tg]),life:1.2,bnc:2})}}}}}
function igDraw(){const p=state.p;if(!p)return;const t=state.time;ctx.save();
 for(const f of state.fx){if(f.type!=="ikindle")continue;const k=Math.min(1,f.life/.5),x=Math.round(f.x),y=Math.round(f.y),fl=Math.round(Math.sin(t*14+f.x)*1.5);ctx.globalAlpha=k;
  ctx.fillStyle="#2a1408";ctx.fillRect(x-9,y+2,18,4);ctx.fillStyle="#7a4a20";ctx.fillRect(x-8,y+2,16,2);ctx.fillStyle="#5a3418";ctx.fillRect(x-10,y+4,6,2);ctx.fillRect(x+4,y+4,6,2);
  ctx.fillStyle="#e8442a";ctx.fillRect(x-5,y-8-fl,10,10+fl);ctx.fillStyle="#ff9a3a";ctx.fillRect(x-3,y-12-fl,6,10+fl);ctx.fillStyle="#ffe080";ctx.fillRect(x-1,y-8,2,6);
  ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35*k;ctx.drawImage(GL.warm,x-36,y-40,72,72);ctx.globalCompositeOperation="source-over"}
 if(p.charId==="ignis"&&p.swarm)for(const m of p.swarm){const x=Math.round(m.x),y=Math.round(m.y),w=Math.sin(t*20+m.ph)>0?1:0;ctx.save();ctx.translate(x,y);ctx.scale(m.f,1);ctx.globalAlpha=1;
  ctx.fillStyle="#3b1522";ctx.fillRect(-5,-3,11,7);ctx.fillStyle="#f2643c";ctx.fillRect(-4,-2,9,5);ctx.fillStyle="#fff1c8";ctx.fillRect(-2,1,5,2);ctx.fillStyle="#2a1020";ctx.fillRect(2,-1,2,2);ctx.fillStyle="#ffc24a";ctx.fillRect(-3,-5-w,3,3);ctx.fillRect(-7,-1,3,2);
  ctx.fillStyle="#ff9a3a";ctx.fillRect(-8+(w?0:1),1,2,2);ctx.restore()}
 ctx.restore()}



// 가중치 추첨 (중복 없이 n개)
function pickWeighted(list,n){const pool=[...list],out=[];while(out.length<n&&pool.length){let t=pool.reduce((a,u)=>a+u.w,0),r=Math.random()*t,i=0;for(;i<pool.length-1;i++){r-=pool[i].w;if(r<0)break}out.push(pool.splice(i,1)[0])}return out}
const NIGHT_LEN=30,BOSS_EVERY=10; // 한 NIGHT 길이(초), 보스 등장 주기(NIGHT)
function reset(){
state={paused:false,dead:false,choosing:false,time:0,kills:0,spawn:0,arrowTimer:0,pulseTimer:3.5,lightTimer:4.5,featherTimer:0,level:1,xp:0,next:8,enemies:[],arrows:[],gems:[],magnets:[],particles:[],fx:[],eb:[],night:1,nightT:0,bossNight:false,bossSpawned:false,banner:null,dark:0,win:null,rs:{dmg:{},taken:0,hits:0,healed:0,blocked:0,ups:{},altar:{},bosses:[],elites:0},won:false,winDone:false,mode:gameMode,diff:gameDiff,lives:gameMode==="tower"?TOWER_LIVES[gameDiff]:0,floor:1,floorKills:0,floorTarget:floorTarget(1),portal:null,wardenSpawned:false,
p:{x:WW/2,y:WH/2,r:10,face:1,anim:0,moving:false,speed:175,hp:100,maxHp:100,invuln:0,pickup:48,arrowDamage:1,arrowRate:.72,arrowSpeed:390,arrowPierce:2,blades:1,bladeDamage:1,bladeRadius:40,pulse:0,lightning:0,feathers:0}};
initChests();initAltars();state.startX=state.p.x;state.startY=state.p.y;state.p.charId=chars.sel();state.p.swingT=0;applyCharStats(state.p);rec.newRun();stopTitle();document.body.classList.remove("on-title");closeModals();ui.start.classList.add("hidden");ui.start.classList.remove("fade");ui.level.classList.add("hidden");ui.over.classList.add("hidden");ending.classList.add("hidden");ui.pause.classList.add("hidden");hud();
if(gameMode==="tower")state.banner={text:"1F · "+tx("마법의 탑","Magic Tower"),t:2.4};
if(raf)cancelAnimationFrame(raf);lastTime=performance.now();raf=requestAnimationFrame(loop);
}
function pause(){if(!state||state.dead||state.won||state.choosing||!ui.start.classList.contains("hidden"))return;state.paused=!state.paused;ui.pause.classList.toggle("hidden",!state.paused)}
window.addEventListener("keydown",e=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)&&!(e.key===" "&&e.target&&e.target.closest&&e.target.closest("button")))e.preventDefault();keys.add(e.key.toLowerCase());if(e.key.toLowerCase()==="p")pause()});
window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
function autoPause(force){if((force||settings.autoPause)&&state&&!state.dead&&!state.won&&!state.choosing&&ui.start.classList.contains("hidden")){state.paused=true;ui.pause.classList.remove("hidden")}}
window.addEventListener("blur",()=>autoPause());
document.addEventListener("visibilitychange",()=>{if(document.hidden)autoPause()});
matchMedia("(orientation:portrait)").addEventListener?.("change",e=>{if(e.matches&&document.body.classList.contains("touch"))autoPause(true)});
$("pauseTop").addEventListener("click",e=>{e.currentTarget.blur();pause()});
ui.pause.addEventListener("click",()=>pause());
$("startButton").addEventListener("click",e=>diffUI.open("story",e.currentTarget));$("restartButton").addEventListener("click",reset);$("restartTop").addEventListener("click",e=>{e.currentTarget.blur();if(state&&state.p&&!state.dead&&!state.won&&state.time>0){quitUI.open("restart");return}reset()});
/* 몹 스폰 배율(기본 대비 몇 배) / 동시에 존재할 수 있는 최대 몹 수 */
const SPAWN_MUL=3,MAX_ENEMIES=400;
function spawnEnemy(){
let side=Math.floor(Math.random()*4),x=side===0?cam.x-20:side===1?cam.x+W+20:rand(cam.x,cam.x+W),y=side===2?cam.y-20:side===3?cam.y+H+20:rand(cam.y,cam.y+H);
if(side<2)y=rand(cam.y,cam.y+H);else x=rand(cam.x,cam.x+W);
const T=state.mode==="tower",D=TOWER_DIFF,fl=(state.floor||1)-1;
let roll=Math.random(),tank=roll<(T?Math.min(D.tankMax,D.tankBase+fl*D.tankPerFloor):Math.min(.28,state.time/240)),fast=!tank&&roll>.78;
const rr=Math.random(),R=RANGED,toadP=T?(fl+1>=R.toad.floor?R.toad.towerP:0):Math.min(R.toad.max,Math.max(0,(state.time-R.toad.from)/R.toad.ramp)),wispP=T?(fl+1>=R.wisp.floor?R.wisp.towerP:0):Math.min(R.wisp.max,Math.max(0,(state.time-R.wisp.from)/R.wisp.ramp));
if(!T){const mm=mapMobRoll();if(mm){spawnMapMob(mm,x,y);return}}
const ranged=!tank&&rr<toadP?"toad":!tank&&rr<toadP+wispP?"wisp":null;
const elite=T&&fl+1>=D.eliteFrom&&Math.random()<Math.min(D.eliteMax,(fl+2-D.eliteFrom)*D.elitePerFloor),hm=(T?towerHpMul():1)*(elite?3:1),dm=(T?1+fl*D.dmg:1)*(elite?1.5:1),sb=T?Math.min(D.speedMax,fl*D.speedPerFloor):0;
if(ranged){const C=RANGED[ranged];state.enemies.push({x,y,type:ranged,ai:ranged,xpv:C.xp,ph:rand(0,6.28),r:C.r*(elite?1.3:1),elite,speed:C.speed+sb*.5,hp:C.hp*hm,maxHp:C.hp*hm,hpMul:T?hm:undefined,damage:Math.round(C.touch*dm),shot:C.shot*dm,color:C.color,hit:0,bladeCD:0,cd:rand(1,C.cd),orbit:Math.random()<.5?1:-1});return}
state.enemies.push({x,y,type:tank?"stump":fast?"bat":"blob",ph:rand(0,6.28),r:(tank?13:fast?8:10)*(elite?1.3:1),elite,speed:(tank?43:fast?92:55)+Math.min(35,state.time*.12)+sb,hp:(tank?4:1)*hm,maxHp:(tank?4:1)*hm,hpMul:T?hm:undefined,damage:Math.round((tank?18:fast?7:10)*dm),color:tank?"#9fd8ff":fast?"#8fc0ff":"#b4b8c8",hit:0,bladeCD:0});
}

/* ===== 원거리 몹 2종 — 숫자만 바꿔서 조절하세요 =====
   toad(서리 두꺼비): 일정 거리에서 멈춰 몸을 부풀린 뒤 얼음 덩어리를 뱉음
   wisp(도깨비불): 거리를 유지하며 플레이어 주위를 맴돌다 3갈래 혼불을 쏨
   xp: 처치 시 불씨 조각 값 (경험치 배율 ×4 전 기준 · 그루터기 6, 슬라임 3)
   from/ramp/max: 스토리에서 몇 초부터 등장해 얼마 동안 비율이 max까지 오르는지 · floor/towerP: 탑에서 등장 층/비율 */
const RANGED={
 toad:{xp:10,hp:2,speed:46,r:11,touch:8,shot:10,cd:2.8,range:230,charge:.6,bullet:190,color:"#5a9ab8",from:60,ramp:900,max:.1,floor:3,towerP:.08},
 wisp:{xp:10,hp:1.5,speed:70,r:9,touch:6,shot:8,cd:3.2,range:250,charge:.6,bullet:150,color:"#9a5ae0",from:150,ramp:1200,max:.08,floor:6,towerP:.06}};
function rangedAI(e,dt,ux,uy,d){const C=RANGED[e.ai],p=state.p,sl=e.slowT>0?.45:1;e.cd-=dt;
 if(e.ai==="toad"){
  if(e.charge>0){e.charge-=dt;if(e.charge<=0){const a=Math.atan2(uy,ux);state.eb.push({x:e.x,y:e.y-4,vx:Math.cos(a)*C.bullet,vy:Math.sin(a)*C.bullet,r:6,life:3.5,c:"#9fe4ff",dmg:e.shot,glob:1});burst(e.x,e.y-6,"#bfefff",5);e.cd=C.cd*rand(.85,1.15)}}
  else{const hop=Math.max(0,Math.sin(state.time*5+e.ph));if(d>C.range){e.x+=ux*e.speed*sl*dt*(.4+hop*1.4);e.y+=uy*e.speed*sl*dt*(.4+hop*1.4)}else if(d<C.range*.55){e.x-=ux*e.speed*.6*sl*dt;e.y-=uy*e.speed*.6*sl*dt}
   if(e.cd<=0&&d<C.range*1.25&&inMap(e))e.charge=C.charge}}
 else{
  const want=d>C.range*1.15?1:d<C.range*.75?-1:0;e.x+=(ux*want*e.speed+(-uy)*e.orbit*e.speed*.7)*sl*dt;e.y+=(uy*want*e.speed+ux*e.orbit*e.speed*.7)*sl*dt;
  if(Math.random()<dt*.25)e.orbit*=-1;
  if(e.charge>0){e.charge-=dt;if(e.charge<=0){fan(e,ux,uy,3,.28,C.bullet,"#c89aff");for(let i=state.eb.length-3;i<state.eb.length;i++)state.eb[i].dmg=e.shot;burst(e.x,e.y,"#c89aff",6);e.cd=C.cd*rand(.85,1.15)}}
  else if(e.cd<=0&&inMap(e))e.charge=C.charge}
 e.x=clamp(e.x,20,WW-20);e.y=clamp(e.y,40,WH-20);if(state.mode==="tower")rockPush(e,e.r)}

/* ===== 맵 전용 몹 — 스토리 모드에서 그 맵에서만 나와요. 숫자만 바꿔서 조절하세요 =====
   hp/r/speed/touch(닿을 때 피해)/xp(불씨 조각) · rate: 등장 비율 (from초부터 ramp초 동안 base→max) · cap: 화면에 동시에 있을 수 있는 최대 수 */
const MAPMOB={
 shroom:{map:"forest",hp:3,r:11,speed:40,touch:12,xp:6,cap:14,kidHp:.6,kidR:7,kidSpeed:74,kidTouch:6,kidXp:2,color:"#3fc8a8"},             // 등불 버섯: 쓰러지면 작은 버섯 2마리로 갈라짐
 newt:{map:"burnt",hp:1.5,r:9,speed:52,touch:9,xp:5,cap:14,chase:1.3,wind:.45,dash:.35,dashSpd:380,color:"#e8542a"},                          // 잿불 도롱뇽: 멈춰서 달아오른 뒤 짧게 돌진
 penguin:{map:"frozen",hp:1.2,r:9,speed:44,touch:8,xp:4,cap:18,group:3,slideR:260,slide:1.5,slideSpd:240,rest:.7,color:"#f0f8ff"},           // 썰매 펭귄: 3마리씩 나와 배로 미끄러져 돌진
 dustdevil:{map:"canyon",hp:2,r:10,speed:88,touch:8,xp:5,cap:12,weave:1.2,push:170,color:"#d8b070"},                                            // 모래 회오리: 지그재그로 빠르게 다가오고 닿으면 밀어냄
 pixie:{map:"blossom",hp:1.5,r:8,speed:62,touch:6,xp:8,cap:6,keep:170,cd:3.5,healR:110,heal:.3,color:"#ff8ac0"},                               // 꽃잎 요정: 거리를 두고 주변 적의 체력을 회복시킴
 lion:{map:"palace",hp:6,r:13,speed:24,touch:16,xp:10,cap:8,taken:.4,wake:170,windup:.4,leap:.55,awake:2.2,awakeSpd:72,rest:1.5,color:"#b8b0a0"}, // 돌사자 석상: 돌일 땐 피해 60% 감소, 가까이 가면 깨어나 덮침
 cloudsp:{map:"cloud",hp:2,r:10,speed:58,touch:9,xp:6,cap:12,every:3.5,mist:1.3,mistSpd:1.6,color:"#f4f8ff"}};                                 // 구름 정령: 가끔 안개로 흩어져 공격이 통하지 않음
const MAPMOB_RATE={from:20,base:.06,ramp:1500,max:.18};
function mapMobRoll(){if(state.mode==="tower"||state.time<MAPMOB_RATE.from)return null;const th=themeOf(),type=Object.keys(MAPMOB).find(k=>MAPMOB[k].map===th);if(!type)return null;
 const R=MAPMOB_RATE,ch=Math.min(R.max,R.base+(state.time-R.from)/R.ramp*(R.max-R.base));if(Math.random()>=ch)return null;
 let n=0;for(const e of state.enemies)if(e.mm===type)n++;return n>=MAPMOB[type].cap?null:type}
function mkMM(type,x,y,o){const C=MAPMOB[type];return Object.assign({x,y,type,mm:type,ph:rand(0,6.28),r:C.r,speed:C.speed+Math.min(25,state.time*.08),hp:C.hp,maxHp:C.hp,damage:C.touch,baseDmg:C.touch,xpv:C.xp,color:C.color,hit:0,bladeCD:0,ms:0,mt:rand(.3,1)},o||{})}
function spawnMapMob(type,x,y){const C=MAPMOB[type],p=state.p;
 if(type==="penguin"){const a=Math.atan2(p.y-y,p.x-x),px=-Math.sin(a),py=Math.cos(a);for(let i=0;i<C.group;i++)state.enemies.push(mkMM(type,clamp(x+px*(i-1)*24,20,WW-20),clamp(y+py*(i-1)*24,40,WH-20),{mt:.4+i*.15}));return}
 state.enemies.push(mkMM(type,x,y,type==="lion"?{mt:C.rest}:type==="cloudsp"?{mt:rand(1,C.every)}:type==="pixie"?{mt:rand(1,C.cd),morb:Math.random()<.5?1:-1}:null))}
function mmSplit(e,out){const C=MAPMOB.shroom;for(let i=0;i<2;i++){const a=rand(0,6.283);out.push(mkMM("shroom",clamp(e.x+Math.cos(a)*10,20,WW-20),clamp(e.y+Math.sin(a)*10,40,WH-20),{mkid:1,hp:C.kidHp,maxHp:C.kidHp,r:C.kidR,speed:C.kidSpeed,damage:C.kidTouch,baseDmg:C.kidTouch,xpv:C.kidXp,hit:.1}))}burst(e.x,e.y,"#9affe0",8)}
function pixieHeal(e){const C=MAPMOB.pixie;for(const o of state.enemies){if(o===e||o.boss||o.mm==="pixie"||o.hp<=0||o.hp>=o.maxHp||o.ghost)continue;if(dist2(o,e)<C.healR**2){o.hp=Math.min(o.maxHp,o.hp+o.maxHp*C.heal);for(let i=0;i<3;i++)state.particles.push({x:o.x+rand(-6,6),y:o.y-6,vx:rand(-12,12),vy:rand(-50,-25),life:rand(.4,.7),max:.7,color:i%2?"#ff8ac0":"#9affb0",size:2})}}
 e.mcast=.6;for(let i=0;i<8;i++){const a=i*.785;state.particles.push({x:e.x,y:e.y-8,vx:Math.cos(a)*60,vy:Math.sin(a)*60,life:.5,max:.5,color:i%2?"#ffd0e4":"#ff8ac0",size:2})}}
// 상태 타이머 (기절 중에도 흘러가야 하는 것)
function mmTick(e,dt){if(e.mcast>0)e.mcast-=dt;if(e.mmist>0){e.mmist-=dt;if(e.mmist<=0){e.mmist=0;e.immune=false;e.ghost=false;e.damage=e.baseDmg;e.mt=MAPMOB.cloudsp.every*rand(.8,1.2);burst(e.x,e.y-6,"#ffffff",8)}}}
function mapMobAI(e,dt,ux,uy,d){const C=MAPMOB[e.mm],p=state.p,sl=e.slowT>0?.45:1;if(e.mm==="newt")e.mf=e.ms===2?(e.mdx<0?-1:1):(ux<0?-1:1);const mv=k=>{e.x+=ux*e.speed*k*sl*dt;e.y+=uy*e.speed*k*sl*dt};e.mt-=dt;
 if(e.mm==="newt"){
  if(e.ms===0){mv(1);if(e.mt<=0&&d<300&&inMap(e)){e.ms=1;e.mt=C.wind;e.mdx=ux;e.mdy=uy}}
  else if(e.ms===1){if(e.mt<=0){e.ms=2;e.mt=C.dash}}
  else{e.x+=e.mdx*C.dashSpd*sl*dt;e.y+=e.mdy*C.dashSpd*sl*dt;if(Math.random()<dt*40)state.particles.push({x:e.x+rand(-3,3),y:e.y+rand(-2,4),vx:rand(-10,10),vy:rand(-30,-10),life:rand(.2,.45),max:.45,color:Math.random()<.5?"#ff8a3a":"#ffd54a",size:2});if(e.mt<=0){e.ms=0;e.mt=C.chase*rand(.8,1.2)}}}
 else if(e.mm==="penguin"){
  if(e.ms===0){mv(1);if(e.mt<=0&&d<C.slideR&&inMap(e)){e.ms=1;e.mt=C.slide;e.mdx=ux;e.mdy=uy}}
  else if(e.ms===1){e.x+=e.mdx*C.slideSpd*sl*dt;e.y+=e.mdy*C.slideSpd*sl*dt;if(Math.random()<dt*25)state.particles.push({x:e.x-e.mdx*8+rand(-3,3),y:e.y+4,vx:-e.mdx*30+rand(-10,10),vy:rand(-20,-5),life:rand(.25,.5),max:.5,color:Math.random()<.5?"#ffffff":"#bfefff",size:2});if(e.mt<=0){e.ms=2;e.mt=C.rest}}
  else if(e.mt<=0){e.ms=0;e.mt=.5}}
 else if(e.mm==="dustdevil"){const w=Math.sin(state.time*3+e.ph)*C.weave;e.x+=(ux-uy*w)*e.speed*sl*dt;e.y+=(uy+ux*w)*e.speed*sl*dt;
  if(Math.random()<dt*12)state.particles.push({x:e.x+rand(-8,8),y:e.y+6,vx:rand(-30,30),vy:rand(-12,0),life:rand(.3,.6),max:.6,color:Math.random()<.5?"#d8b070":"#a8804a",size:2});
  if(d<p.r+e.r+6&&p.hp>0){p.x=clamp(p.x+ux*C.push*dt,16,WW-16);p.y=clamp(p.y+uy*C.push*dt,30,WH-16)}}
 else if(e.mm==="pixie"){const want=d>C.keep*1.15?1:d<C.keep*.8?-1:0;e.x+=(ux*want*e.speed+(-uy)*e.morb*e.speed*.5)*sl*dt;e.y+=(uy*want*e.speed+ux*e.morb*e.speed*.5)*sl*dt;if(Math.random()<dt*.3)e.morb*=-1;
  if(e.mt<=0&&inMap(e)){pixieHeal(e);e.mt=C.cd*rand(.85,1.15)}}
 else if(e.mm==="lion"){
  if(e.ms===0){e.x+=ux*C.speed*sl*dt;e.y+=uy*C.speed*sl*dt;if(e.mt<=0&&d<C.wake&&inMap(e)){e.ms=1;e.mt=C.windup}}
  else if(e.ms===1){if(e.mt<=0){e.ms=2;e.mt=C.leap;e.lx0=e.x;e.ly0=e.y;e.lx=p.x;e.ly=p.y;e.damage=0}}
  else if(e.ms===2){const k=clamp(1-e.mt/C.leap,0,1);e.x=e.lx0+(e.lx-e.lx0)*k;e.y=e.ly0+(e.ly-e.ly0)*k;e.mz=Math.sin(k*Math.PI)*38;
   if(e.mt<=0){e.mz=0;e.damage=e.baseDmg;e.ms=3;e.mt=C.awake;state.shake=Math.max(state.shake||0,4);burst(e.x,e.y+6,"#c8a04a",10);burst(e.x,e.y+6,"#b8b0a0",8)}}
  else{e.x+=ux*C.awakeSpd*sl*dt;e.y+=uy*C.awakeSpd*sl*dt;if(e.mt<=0){e.ms=0;e.mt=C.rest;burst(e.x,e.y,"#8a8478",6)}}}
 else if(e.mm==="cloudsp"){if(e.mmist>0)mv(C.mistSpd);else{mv(1);if(e.mt<=0&&inMap(e)){e.mmist=C.mist;e.immune=true;e.ghost=true;e.damage=0;burst(e.x,e.y-6,"#e8f0ff",10)}}}
 else mv(1);
 e.x=clamp(e.x,20,WW-20);e.y=clamp(e.y,40,WH-20)}
const inMap=e=>e.x>=cam.x&&e.x<=cam.x+W&&e.y>=cam.y&&e.y<=cam.y+H; // 화면(맵) 안에 있는 적만 공격 대상
function nearest(from=state.p,strongest=false){let best=null,score=strongest?-Infinity:Infinity;for(const e of state.enemies){if(e.ghost||!inMap(e))continue;let v=strongest?e.hp:dist2(from,e);if(strongest?v>score:v<score){best=e;score=v}}return best}
function burst(x,y,color,n){for(let i=0;i<n;i++){let a=rand(0,Math.PI*2),v=rand(20,100);state.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rand(.15,.45),max:.45,color,size:rand(2,4)})}}
/* ================= 속성: 캐릭터 공격에 붙는 상태이상 =================
   ember 잿불(이그니) 그을림 · blaze 업화(주작) 화상 · water 물(현무) 둔화 · wind 바람(백호) 베임 · thunder 번개(청룡) 감전 · earth 땅(황룡) 석화
   수치 — 숫자만 바꿔서 조절하세요 (dps는 기본 공격 피해 배율 / 초) */
const ELEM={
 ember:{n:"잿불",nEn:"Embers",icon:"🔥",c:"#ffb070",fx:"그을림",fxEn:"Scorch",d:"맞은 적에게 그을림이 쌓여요 (최대 5중첩, 3초). 중첩마다 약한 지속 피해를 줘요.",dEn:"Hits stack Scorch on foes (up to 5, 3s). Each stack deals light damage over time.",max:5,time:3,dps:.12},
 blaze:{n:"업화",nEn:"Hellfire",icon:"🔥",c:"#ff6a3a",fx:"화상",fxEn:"Burn",d:"맞은 적이 2.5초 동안 불타요. 불타던 적이 쓰러지면 주변 적 2마리에게 불이 옮겨붙어요.",dEn:"Foes burn for 2.5s. When a burning foe falls, the fire spreads to 2 nearby foes.",time:2.5,dps:.3,spread:2,spreadR:90},
 water:{n:"물",nEn:"Water",icon:"💧",c:"#7fd0ff",fx:"둔화",fxEn:"Slow",d:"맞은 적이 1.2초 동안 느려져요.",dEn:"Foes hit are slowed for 1.2s.",time:1.2},
 wind:{n:"바람",nEn:"Wind",icon:"🌪",c:"#e8f4ff",fx:"베임",fxEn:"Rend",d:"맞은 적이 받는 피해가 중첩마다 +5%씩 늘어요 (최대 +25%, 3초).",dEn:"Foes hit take +5% damage per stack (up to +25%, 3s).",max:5,per:.05,time:3},
 thunder:{n:"번개",nEn:"Thunder",icon:"⚡",c:"#fff2a0",fx:"감전",fxEn:"Shock",d:"맞은 적이 25% 확률로 0.35초 동안 굳어요 (보스 제외).",dEn:"25% chance to freeze foes in place for 0.35s (not bosses).",chance:.25,time:.35,cd:.6},
 earth:{n:"땅",nEn:"Earth",icon:"⛰",c:"#e8b850",fx:"석화",fxEn:"Petrify",d:"4번 맞은 적은 1.2초 동안 돌이 되어 멈추고 받는 피해 +20%. (보스는 느려지기만 해요)",dEn:"After 4 hits a foe turns to stone for 1.2s: it can't move and takes +20% damage. (Bosses are only slowed)",need:4,time:1.2,taken:.2},
 light:{n:"빛",nEn:"Light",icon:"✨",c:"#fff6c0",fx:"낙인",fxEn:"Brand",d:"맞은 적에게 4초 동안 낙인이 남아요. 낙인 찍힌 적이 쓰러지면 기린이 체력을 회복해요 (넘치면 보호막).",dEn:"Foes hit are Branded for 4s. When a Branded foe falls, the Qilin heals (overflow becomes a shield).",time:4}};
const CHAR_ELEM={ignis:"ember",zhuque:"blaze",hyunmu:"water",baekho:"wind",cheongryong:"thunder",hwangryong:"earth",qilin:"light"};
// 속성이 붙는 공격 (1 = 캐릭터 속성 · 문자열 = 그 속성) — 황룡이 빌린 기술에는 그 사신의 속성이 붙어요
const ELEM_SRC={ignis:{main:1,boom:1,aura:1,i_kindle:1,i_swarm:1},zhuque:{main:1,feather:1,z_echo:1,z_trail:1,z_dive:1},hyunmu:{main:1,whip:1,counter:1,h_spike:1,h_vortex:1,h_tide:1},baekho:{main:1,dash:1,b_ghost:1},cheongryong:{main:1,rain:1,c_spout:1,c_ascend:1},
 hwangryong:{main:1,scale:1,w_ley:1,hw_fire:"blaze",hw_water:"water",hw_wind:"wind",hw_bolt:"thunder"},qilin:{main:1,q_smite:1,q_prism:1,q_gate:1,q_mandate:1}};
function elemOf(src){const p=state.p,m=p&&ELEM_SRC[p.charId];if(!m||!src)return null;const v=m[src];return v===1?CHAR_ELEM[p.charId]:v||null}
function elemTaken(e){let k=1;if(e.type==="hundun")k*=e.order>0?HUNDUN.orderMul:HUNDUN.taken;if(e.prey)k*=1+SKN.b_prey.taken;if(e.rendT>0)k*=1+(e.rend||0)*ELEM.wind.per;if(e.petT>0)k*=1+ELEM.earth.taken;if(e.mm==="lion"&&e.ms===0)k*=MAPMOB.lion.taken;return k}
function elemHit(e,src){const el=elemOf(src);if(!el)return;const E=ELEM[el];if(state.p.charId==="hwangryong"){hwMark(e,el);if((src==="main"||src==="w_ley")&&state.p.hwImbue&&!(e.sealT>0))hwMark(e,state.p.hwImbue)}
 if(el==="ember"){e.emb=Math.min(E.max,(e.emb||0)+1);e.embT=E.time;if(e.emb>=E.max&&state.p.charId==="ignis"&&skL(state.p,"i_ignite")&&e.hp>0)igBurst(e)}
 else if(el==="blaze"){e.burnT=E.time}
 else if(el==="water"){e.slowT=Math.max(e.slowT||0,E.time)}
 else if(el==="wind"){e.rend=Math.min(E.max,(e.rend||0)+1);e.rendT=E.time}
 else if(el==="thunder"){if(!e.boss&&!(e.shockCD>0)&&Math.random()<E.chance){e.stunT=Math.max(e.stunT||0,E.time);e.shockT=E.time;e.shockCD=E.cd}}
 else if(el==="light"){e.brandT=E.time}
 else if(el==="earth"){if(e.petT>0)return;e.pet=(e.pet||0)+1;if(e.pet>=E.need){e.pet=0;if(e.boss)e.slowT=Math.max(e.slowT||0,E.time);else{e.petT=E.time;e.stunT=Math.max(e.stunT||0,E.time);burst(e.x,e.y,"#a8a090",6)}}}}
function elemTick(e,dt){
 if(e.brandT>0)e.brandT-=dt;if(e.chgT>0)e.chgT-=dt;if(e.fearT>0)e.fearT-=dt;if(e.stunT>0)e.stunT-=dt;if(e.shockT>0)e.shockT-=dt;if(e.shockCD>0)e.shockCD-=dt;if(e.petT>0)e.petT-=dt;
 if(e.rendT>0){e.rendT-=dt;if(e.rendT<=0)e.rend=0}
 if(e.embT>0){e.embT-=dt;if(e.embT<=0)e.emb=0}
 if(e.burnT>0)e.burnT-=dt;
 if(e.sealT>0){e.sealT-=dt;if(e.sealT<=0)hwSealBoom(e)}
 if((e.emb>0||e.burnT>0)&&e.hp>0){e.dotT=(e.dotT==null?.5:e.dotT)-dt;if(e.dotT<=0){e.dotT=.5;const ad=state.p.arrowDamage,d=ad*((e.emb>0?e.emb*ELEM.ember.dps:0)+(e.burnT>0?ELEM.blaze.dps:0))*.5;if(d>0)hurt(e,d,e.burnT>0?"#ff7a3a":"#ffb070",e.burnT>0?"elem_burn":"elem_ember")}}}
function elemSpread(e){const E=ELEM.blaze;let n=0;for(const o of state.enemies){if(n>=E.spread)break;if(o===e||o.hp<=0||o.burnT>0||o.ghost||!inMap(o))continue;if(dist2(o,e)<E.spreadR**2){o.burnT=E.time*.8;n++;burst(o.x,o.y,"#ff7a3a",5)}}}
// 상태이상 표시 (작은 픽셀 효과)
function elemDraw(e){if(e.brandT>0&&e.hp>0){const bx=Math.round(e.x),by=Math.round(e.y)-(e.r||10)-9+Math.round(Math.sin(state.time*4+e.x)*1.5);ctx.fillStyle="#5a3a10";ctx.fillRect(bx-3,by-1,6,4);ctx.fillRect(bx-1,by-3,2,8);ctx.fillStyle="#fff0a0";ctx.fillRect(bx-2,by,4,2);ctx.fillRect(bx,by-2,0+1,6)}if(!(e.emb>0||e.burnT>0||e.rendT>0||e.shockT>0||e.petT>0||e.sealT>0||e.marks))return;const t=state.time,x=Math.round(e.x),y=Math.round(e.y),r=e.r||10;ctx.save();
 if(e.marks&&!(e.sealT>0)){const ks=Object.keys(e.marks).filter(k=>t-e.marks[k]<=HWANG.seal.window);ks.forEach((k,i)=>{const dx=x-((ks.length-1)*6)/2+i*6;ctx.fillStyle="#2a1606";ctx.fillRect(Math.round(dx)-3,y+r+2,6,6);ctx.fillStyle=HW_MARK_C[k];ctx.fillRect(Math.round(dx)-2,y+r+3,4,4)})}
 if(e.sealT>0){const k=1-e.sealT/(e.sealMax||.6),rr=r+4+k*4,cy=y-4;for(let i=0;i<5;i++){const a=t*6+i*1.2566,px=Math.round(x+Math.cos(a)*rr),py=Math.round(cy+Math.sin(a)*rr*.7);ctx.fillStyle="#2a1606";ctx.fillRect(px-3,py-3,6,6);ctx.fillStyle=["#ffd54a","#ff6a3a","#7fd0ff","#ffffff","#5ac8ff"][i];ctx.fillRect(px-2,py-2,4,4)}
  ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.25+.5*k*(.5+.5*Math.sin(t*30));ctx.fillStyle="#ffd54a";ctx.fillRect(x-3,cy-3,6,6);ctx.globalCompositeOperation="source-over";ctx.globalAlpha=1}
 if(e.petT>0){ctx.fillStyle="#3a3630";for(const [dx,dy,w,h] of [[-r,r-5,r*.9,5],[r*.1,r-6,r*.9,6]])ctx.fillRect(Math.round(x+dx),Math.round(y+dy),Math.round(w),Math.round(h));ctx.fillStyle="#8a8478";ctx.fillRect(x-r+1,y+r-5,Math.round(r*.7),2);ctx.fillRect(x+2,y+r-6,Math.round(r*.6),2);ctx.fillStyle="#cfc8b8";ctx.fillRect(x-3,y-r+2,2,2)}
 if(e.burnT>0){for(let i=0;i<3;i++){const fx=x+Math.round(Math.sin(i*2.1+e.x)*r*.6),fl=Math.round(Math.sin(t*14+i*2)*1.5),fy=y-r-2+fl+(i===1?-3:0);ctx.fillStyle="#e8442a";ctx.fillRect(fx-2,fy,4,4);ctx.fillStyle="#ff9a3a";ctx.fillRect(fx-1,fy-2,2,4);ctx.fillStyle="#ffe080";ctx.fillRect(fx-1,fy+1,2,2)}}
 else if(e.emb>0){for(let i=0;i<e.emb;i++){const ex=x-((e.emb-1)*3)/2+i*3,ey=y-r-5+Math.round(Math.sin(t*5+i)*1.5);ctx.fillStyle=i%2?"#ff8a3a":"#ffb070";ctx.fillRect(Math.round(ex),ey,2,2)}}
 if(e.rendT>0){ctx.globalAlpha=.35+.1*e.rend;ctx.strokeStyle="#ffffff";ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<Math.min(3,Math.ceil(e.rend/2));i++){ctx.moveTo(x-r*.6+i*4,y-r*.6);ctx.lineTo(x-r*.1+i*4,y+r*.3)}ctx.stroke();ctx.globalAlpha=1}
 if(e.shockT>0){ctx.strokeStyle=Math.sin(t*40)>0?"#fff2a0":"#9fe8ff";ctx.lineWidth=1.5;ctx.beginPath();for(const d of[-1,1]){ctx.moveTo(x+d*(r+1),y-r);ctx.lineTo(x+d*(r+4),y-r+3);ctx.lineTo(x+d*(r+1),y-r+5);ctx.lineTo(x+d*(r+4),y-r+8)}ctx.stroke()}
 ctx.restore()}
function hurt(e,n,color="#fff0b0",src){if(!inMap(e)||e.immune)return;if(e.mirror){mirrorHit(e);return}if(e.type==="witch"){if(e.exposed>0)n*=WITCH.exposedMul;else if(e.shieldOn){n*=WITCH.shieldMul;color="#7affe0"}}const dm=n*(state.p.dmgMul||1)*elemTaken(e),h0=Math.max(0,e.hp);e.hp-=dm;if(state.rs){const k=src||"etc";state.rs.dmg[k]=(state.rs.dmg[k]||0)+Math.min(dm,h0)}{const p=state.p;if(p.vamp&&p.hp>0&&p.hp<p.maxHp&&p.vampBud>0){const h=Math.min(dm*p.vamp,p.vampBud);p.vampBud-=h;p.hp=Math.min(p.maxHp,p.hp+h);if(Math.random()<.08)burst(p.x,p.y-10,"#ff5a6a",1)}}e.hit=.12;burst(e.x,e.y,color,3);elemHit(e,src);skHit(e,src)}
function zig(x1,y1,x2,y2,n,j){const pts=[{x:x1,y:y1}];for(let i=1;i<n;i++){const t=i/n;pts.push({x:x1+(x2-x1)*t+rand(-j,j),y:y1+(y2-y1)*t+rand(-j,j)})}pts.push({x:x2,y:y2});return pts}
const SPORE_PAL={fire:["#ff8a2a","#c0301a","#ffb04a","#ffe08a"],ice:["#8da2ff","#3a4a9a","#a8baff","#e0e8ff"],dark:["#b27be0","#7b3fb8","#c08cf0","#ead3ff"]};
const METEOR_FALL=.45;
function meteor(x,y,dmg,delay,r){state.fx.push({type:"meteor",ice:!!(state.p&&state.p.charId==="hyunmu"),x,y,dmg,r,delay,hit:false,life:delay+METEOR_FALL+.4,max:delay+METEOR_FALL+.4})}
function meteorBoom(f){for(const e of state.enemies)if(dist2(e,f)<(f.r+e.r)**2){hurt(e,f.dmg,f.ice?"#bfefff":"#ffcf6a","meteor");if(f.ice)e.slowT=2}burst(f.x,f.y,f.ice?"#7fd0ff":"#ff8a2a",18);burst(f.x,f.y,f.ice?"#e8fbff":"#ffd54a",8)}
function drawMeteor(f){const Q=f.ice?["#7fd0ff","#e8fbff","#9fe4ff","#3fa0c8","#9fe4ff","#1f3a4a","#7fd0ff","#e8fbff","#7fd0ff","#e8fbff","#bfefff"]:["#ff4a3a","#ffd54a","#ff8a2a","#e0523a","#ff8a2a","#2a1218","#7a4a24","#ffb04a","#ff8a2a","#fff2c0","#ffd54a"];const el=f.max-f.life-f.delay;ctx.save();
if(el<METEOR_FALL){const k=Math.max(0,el)/METEOR_FALL;
 ctx.globalAlpha=.18+.3*k;ctx.fillStyle=Q[0];ctx.beginPath();ctx.ellipse(f.x,f.y+8,f.r*(.5+.5*k),f.r*.55*(.5+.5*k),0,0,6.283);ctx.fill();
 if(el>0){const sx=f.x+150,sy=f.y-340,mx=sx+(f.x-sx)*k,my=sy+(f.y-sy)*k;
  for(let i=9;i>=1;i--){ctx.globalAlpha=.6-i*.05;ctx.fillStyle=i<4?Q[1]:i<7?Q[2]:Q[3];ctx.beginPath();ctx.arc(mx+i*5.5,my-i*12.5,Math.max(2,10-i),0,6.283);ctx.fill()}
  ctx.globalAlpha=.4;ctx.fillStyle=Q[4];ctx.beginPath();ctx.arc(mx,my,18,0,6.283);ctx.fill();
  ctx.globalAlpha=1;ctx.fillStyle=Q[5];ctx.beginPath();ctx.arc(mx,my,11,0,6.283);ctx.fill();ctx.fillStyle=Q[6];ctx.beginPath();ctx.arc(mx,my,9,0,6.283);ctx.fill();ctx.fillStyle=Q[7];ctx.beginPath();ctx.arc(mx-3,my-3,4,0,6.283);ctx.fill()}}
else{const q=Math.min(1,(el-METEOR_FALL)/.4),e=1-(1-q)**2;
 ctx.globalAlpha=(1-q)*.55;ctx.fillStyle=Q[8];ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.35+.75*e),0,6.283);ctx.fill();
 ctx.globalAlpha=(1-q)*.8;ctx.fillStyle=Q[9];ctx.beginPath();ctx.arc(f.x,f.y,f.r*.45*(1-q),0,6.283);ctx.fill();
 ctx.globalAlpha=1-q;ctx.strokeStyle=Q[10];ctx.lineWidth=3;ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.35+.75*e),0,6.283);ctx.stroke()}
ctx.restore()}
function sporeFx(x,y,r,k){const puffs=[],spores=[];for(let i=0;i<16;i++){const a=rand(0,Math.PI*2),d=Math.sqrt(Math.random())*r*.62;puffs.push({dx:Math.cos(a)*d,dy:Math.sin(a)*d,size:rand(.22,.34)*r})}for(let i=0;i<14;i++){const a=rand(0,Math.PI*2),d=rand(.2,1)*r;spores.push({dx:Math.cos(a)*d,dy:Math.sin(a)*d,s:rand(2,4)})}return{type:"pulse",x,y,r,life:.7,max:.7,puffs,spores,c:SPORE_PAL[k||"fire"]}}
function drawFx(){for(const f of state.fx){if(f.type==="meteor"){drawMeteor(f);continue}if(f.type==="bolt"){drawBolt(f);continue}if(f.type==="pillar"){drawPillar(f);continue}if(f.type==="seal"){drawSealFx(f);continue}if(SK_FX[f.type])continue;if(f.type==="rain"){drawRain(f);continue}if(f.type==="evoBoom"){const k=1-f.life/f.max,r=f.r*(.45+.55*k);ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35*(1-k);ctx.fillStyle="#ff7a2a";ctx.beginPath();ctx.arc(f.x,f.y,r,0,6.283);ctx.fill();ctx.globalAlpha=.8*(1-k);ctx.strokeStyle="#ffd54a";ctx.lineWidth=3;ctx.beginPath();ctx.arc(f.x,f.y,r,0,6.283);ctx.stroke();ctx.restore();continue}
if(f.type==="ring"){const k=1-f.life/f.max,r=f.r0+(f.r1-f.r0)*(1-(1-k)**2);ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=(1-k)*.9;ctx.strokeStyle=f.c;ctx.lineWidth=f.w*(1-k)+1;ctx.beginPath();ctx.ellipse(f.x,f.y,r,r*f.sq,0,0,6.283);ctx.stroke();ctx.restore();continue}
if(f.type==="flamecol"){const k=1-f.life/f.max,h=110*(k<.25?k/.25:1),a=1-k;ctx.save();ctx.globalCompositeOperation="lighter";for(const [w,c] of [[40,"#e0301a"],[28,"#ff8a2a"],[16,"#ffd04a"],[6,"#fffbe0"]]){ctx.globalAlpha=a*.75;ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(f.x,f.y-h/2,w/2*(1-k*.4),h/2+4,0,0,6.283);ctx.fill()}ctx.restore();continue}const t=1-f.life/f.max,fade=1-t;
if(f.type==="pulse"){const e=1-(1-Math.min(1,t*2.2))**2;
ctx.globalAlpha=fade*.35;ctx.strokeStyle=f.c[0];ctx.lineWidth=2;ctx.beginPath();ctx.arc(f.x,f.y,f.r*e,0,Math.PI*2);ctx.stroke();
for(const s of f.puffs){const rr=s.size*(.6+t*.8),cx=f.x+s.dx*e,cy=f.y+s.dy*e-t*22;ctx.globalAlpha=fade*.4;ctx.fillStyle=f.c[1];ctx.beginPath();ctx.arc(cx,cy,rr,0,Math.PI*2);ctx.fill();ctx.globalAlpha=fade*.3;ctx.fillStyle=f.c[2];ctx.beginPath();ctx.arc(cx-rr*.15,cy-rr*.15,rr*.55,0,Math.PI*2);ctx.fill()}
ctx.fillStyle=f.c[3];ctx.globalAlpha=fade*.9;for(const s of f.spores)ctx.fillRect(Math.round(f.x+s.dx*e),Math.round(f.y+s.dy*e-t*36),s.s,s.s)}
else{ctx.lineJoin="round";for(const [w,c,al] of [[8,"#ff9a4a",.35],[3,"#f6ffd0",1]]){ctx.globalAlpha=fade*al;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();f.pts.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.stroke()}
for(const q of f.pts){ctx.globalAlpha=fade*.9;ctx.fillStyle="#ffe0a0";ctx.fillRect(Math.round(q.x)-1,Math.round(q.y)-1,3,3)}
const end=f.pts[f.pts.length-1];ctx.globalAlpha=fade*.5;ctx.fillStyle="#ffcf6a";ctx.beginPath();ctx.arc(end.x,end.y,8+t*14,0,Math.PI*2);ctx.fill()}}
ctx.globalAlpha=1}
function arrow(){let p=state.p,t=nearest();if(!t)return;let dx=t.x-p.x,dy=t.y-p.y,d=Math.hypot(dx,dy)||1;
if(p.charId==="qilin"){const Q=QILIN.lance,L=Q.range+(p.lanceLen||0);if(d>L+30)return;p.face=dx>0?1:-1;qBeam(p.x+p.face*8,p.y-10,Math.atan2(t.y-(p.y-10),t.x-(p.x+p.face*8)),L,p.arrowDamage*Q.dmg,"main",Q.w+(p.lanceW||0),skL(p,"q_prism")>0);if(typeof audio!=="undefined")audio.sfx("zap");return}
if(p.charId==="hwangryong"){const P=HWANG.pillar;if(d>P.range)return;p.face=dx>0?1:-1;const R=p.pillarR||P.r,n=1+(p.pillarExtra||0),dm=p.arrowDamage*P.dmg;hwPillar(t.x,t.y,R,dm,0);
 if(n>1){const others=state.enemies.filter(e=>e!==t&&!e.ghost&&inMap(e)&&dist2(e,p)<P.range**2).sort((a,b)=>dist2(a,t)-dist2(b,t));
  for(let i=1;i<n;i++){const o=others[i-1],a=rand(0,6.283);hwPillar(o?o.x:t.x+Math.cos(a)*R*1.5,o?o.y:t.y+Math.sin(a)*R*1.5,R*.85,dm*.75,.1*i)}}return}
if(p.charId==="cheongryong"){const C=CHEONG.chain,P=CHEONG.pearl;if(d>C.range)return;p.face=dx>0?1:-1;let n=C.jumps+(p.chainJumps||0),mul=1,thunder=false;
 if(!p.noPassive){p.pearl=(p.pearl||0)+1;if(p.pearl>=(p.pearlEvery||P.every)){p.pearl=0;thunder=true;n+=P.extra;mul=P.dmg}}
 let cur=t,fx=p.x+(p.face||1)*12,fy=p.y-20,dmg=p.arrowDamage*C.dmg*mul;const hit=new Set(),paths=[];
 for(let i=0;i<=n&&cur;i++){hit.add(cur);paths.push(boltPath(fx,fy,cur.x,cur.y-6));hurt(cur,dmg,thunder?"#fff2a0":"#bfefff","main");if(thunder&&!cur.boss)cur.slowT=Math.max(cur.slowT||0,P.stun);fx=cur.x;fy=cur.y-6;dmg*=(p.falloff||C.falloff);
  let best=null,bd=C.jump*C.jump;for(const e of state.enemies){if(hit.has(e)||e.ghost||!inMap(e)||e.hp<=0)continue;const d2=(e.x-fx)**2+(e.y-fy)**2;if(d2<bd){bd=d2;best=e}}cur=best}
 state.fx.push({type:"bolt",paths,thunder,life:thunder?.3:.18,max:thunder?.3:.18});if(thunder){state.shake=Math.max(state.shake||0,3);burst(t.x,t.y,"#fff2a0",10)}return}
if(p.charId==="baekho"){const a=Math.atan2(dy,dx),C=BAEKHO.claw,R=p.clawReach||C.reach,arc=p.clawArc||C.arc;p.face=dx>0?1:-1;
 if(d<=R+t.r+24){p.clawA=a;p.clawT=.2;if(p.claw2)p.claw2T=.1;for(const e of state.enemies){if(e.ghost||!inMap(e))continue;const ex=e.x-p.x,ey=e.y-p.y,de=Math.hypot(ex,ey)||1;if(de>R+e.r)continue;let da=Math.atan2(ey,ex)-a;da=Math.atan2(Math.sin(da),Math.cos(da));if(Math.abs(da)<arc){hurt(e,p.arrowDamage*C.dmg,"#ffffff","main");if(!e.boss){e.x+=ex/de*C.push;e.y+=ey/de*C.push}}}}
 else{const W2=BAEKHO.wind;state.arrows.push({wind:true,x:p.x,y:p.y-6,vx:dx/d*W2.speed,vy:dy/d*W2.speed,r:9,damage:p.arrowDamage*W2.dmg,pierce:W2.pierce,hit:new Set(),life:W2.life})}return}
if(p.charId==="hyunmu"){const a=Math.atan2(dy,dx),R=(p.whipLen||96)*(p.stance?SKN.h_stance.reach:1);
 if(d<=R+t.r+6){p.whipA=a;p.whipT=.28;p.face=dx>0?1:-1;for(const e of state.enemies){if(e.ghost||!inMap(e))continue;const ex=e.x-p.x,ey=e.y-p.y,de=Math.hypot(ex,ey)||1;if(de>R+e.r)continue;let da=Math.atan2(ey,ex)-a;da=Math.atan2(Math.sin(da),Math.cos(da));if(Math.abs(da)<.95){hurt(e,p.arrowDamage*1.6,"#9fe4ff","whip");if(p.tide&&!e.boss)e.slowT=Math.max(e.slowT||0,1.2);if(!e.boss){e.x+=ex/de*8;e.y+=ey/de*8}}}}
 else state.arrows.push({water:true,x:p.x,y:p.y-6,vx:dx/d*300,vy:dy/d*300,r:6,damage:p.arrowDamage*.8,pierce:1,hit:new Set(),life:1.3});return}
if(p.charId==="zhuque"){const sp=p.arrowSpeed*.9,a0=Math.atan2(dy,dx),bg=p.qiBig||1;p.swingA=a0;p.swingT=.22;for(const da of (p.qiSpread?[0,-.26,.26]:[0])){const a=a0+da;state.arrows.push({qi:true,big:bg>1?bg:0,x:p.x+Math.cos(a)*18,y:p.y+Math.sin(a)*18-4,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:Math.round(13*bg),damage:p.arrowDamage*1.5*(da?.6:1),pierce:p.arrowPierce+2,hit:new Set(),life:1.7})}return}
const EV=p.evo?IGN_EVO[p.evo]:null,a0=Math.atan2(dy,dx),shots=EV&&EV.spread?[0,-EV.spread,EV.spread]:[0];
for(const da of shots){const a=a0+da;state.arrows.push({x:p.x,y:p.y,vx:Math.cos(a)*p.arrowSpeed,vy:Math.sin(a)*p.arrowSpeed,r:EV?Math.round(4*EV.big):4,damage:p.arrowDamage*(da?EV.sideDmg:1),pierce:p.arrowPierce,hit:new Set(),life:2.1,big:EV?EV.big:0,boom:EV?EV.boomR:0,boomDmg:EV?EV.boomDmg:0,bnc:skL(p,"i_bounce")})}}
/* ===== 자석: 몹 처치 시 0.5% 드롭, 먹으면 맵 전체 불씨 조각이 몰려옴 ===== */
const MAGNET_DROP=.005;
const MAGNET_IMG=(()=>{const rows=["...ooooo...","..oqrrrro..",".orrrrrrro.","orrrooorrro","orrro.orrro","orrro.orrro","orrro.orrro","orrro.orrro","owwwo.owwwo","owwwo.owwwo","ooooo.ooooo"],pal={o:"#2a0e14",r:"#e0303c",q:"#ff9aa0",w:"#f4f4f8"},c=document.createElement("canvas");c.width=11;c.height=11;const g=c.getContext("2d");rows.forEach((r,y)=>{for(let x=0;x<11;x++){const k=r[x];if(k!==".")g.fillStyle=pal[k],g.fillRect(x,y,1,1)}});return c})();
function magnetPickup(){const p=state.p;for(const g of state.gems){g.pull=true;g.v=260}burst(p.x,p.y,"#7fd0ff",24);burst(p.x,p.y,"#ff6a7a",16);state.banner={text:tx("자석 획득! 모든 불씨 조각이 모여든다","Magnet! All ember shards rush to you"),t:2.2}}
function drawMagnets(){for(const m of (state.magnets||[])){const t=m.phase,b=Math.round(Math.sin(t)*2),x=Math.round(m.x),y=Math.round(m.y)+b;
ctx.globalAlpha=.35;ctx.fillStyle="#050a08";ctx.fillRect(x-8,Math.round(m.y)+12,16,3);
ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.25+.1*Math.sin(t*2);ctx.fillStyle="#7fd0ff";ctx.beginPath();ctx.arc(x,y,16,0,6.283);ctx.fill();ctx.restore();
ctx.globalAlpha=.55;ctx.strokeStyle="#9fe0ff";ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,15+Math.sin(t*1.5)*2,0,6.283);ctx.stroke();
ctx.globalAlpha=1;ctx.drawImage(MAGNET_IMG,x-11,y-11,22,22)}ctx.globalAlpha=1}

/* ===== 이그니 진화: 레벨 20 · 40에 외형 · 스킬 · 스탯 진화 ===== */
function fireBoom(a,hitE){const R=a.boom;for(const e of state.enemies)if(e!==hitE&&!e.ghost&&inMap(e)&&dist2(e,a)<(R+e.r)**2)hurt(e,a.damage*a.boomDmg,"#ffb070","boom");
 burst(a.x,a.y,"#ff8a2a",8);burst(a.x,a.y,"#ffd54a",4);state.fx.push({type:"evoBoom",x:a.x,y:a.y,r:R,life:.25,max:.25});if(typeof audio!=="undefined")audio.sfx("fboom")}
function ignisAura(p,t){}
function ignisEvolve(st){const p=state.p,E=IGN_EVO[st];p.evo=st;
 p.maxHp+=E.hp;p.hp=Math.min(p.maxHp,p.hp+E.hp);p.dmgMul=(p.dmgMul||1)*E.atk;p.speed*=E.spd;p.pickup*=E.pick;p.invuln=Math.max(p.invuln||0,1.5);
 state.flash=.7;state.flashC="#ffb04a";state.shake=Math.max(state.shake||0,10);
 for(const c of["#ff5a2a","#ffd54a","#fff0b0","#ff8a2a"])burst(p.x,p.y,c,24);
 state.banner={text:tx(`진화! 이그니 → ${E.name}`,`Evolved! Ignis → ${E.nameEn}`),t:3.2};
 if(typeof audio!=="undefined")audio.sfx("revive");hud()}
function ignisEvoCheck(){const p=state&&state.p;if(!p)return;if(p.charId==="ignis"){for(let i=1;i<IGN_EVO.length;i++)if(state.level>=IGN_EVO[i].lv&&(p.evo||0)<i)ignisEvolve(i);return}
 if(p.charId==="hwangryong"){hwGateCheck();return}const T=CHAR_EVO[p.charId];if(T)for(let i=1;i<T.length;i++)if(state.level>=T[i].lv&&(p.evo||0)<i)charEvolve(i)}
function xp(n){state.xp+=n;if(state.xp>=state.next&&!state.choosing){state.xp-=state.next;state.level++;state.next=nextNeed(state.next);ignisEvoCheck();levelUp()}}

(function(){const st=document.createElement("style");st.id="lvStyle";st.textContent=`
#levelOverlay:not(.hidden){display:flex!important;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
#levelOverlay .level-panel{width:min(660px,96vw)!important;max-width:none!important;max-height:96vh;overflow-y:auto;text-align:center;padding:14px 20px 16px!important;box-sizing:border-box}
#levelOverlay .level-panel .eyebrow{font-size:14px;letter-spacing:.16em;color:#ffd54a;margin:0!important}
#levelOverlay .level-panel h2{font-size:26px!important;margin:2px 0 12px!important}
#levelOverlay .upgrade-choices{display:flex!important;flex-direction:column!important;grid-template-columns:none!important;gap:10px!important;width:100%}
#levelOverlay .upgrade-card{position:relative;display:flex!important;flex-direction:row!important;align-items:center!important;gap:16px!important;width:100%!important;max-width:none!important;min-height:0!important;padding:11px 20px 11px 52px!important;text-align:left!important;box-sizing:border-box;border-width:2px!important;border-style:solid!important;cursor:pointer;animation:lvIn .32s cubic-bezier(.2,.9,.3,1.2) both;transition:transform .12s,filter .12s}
#levelOverlay .upgrade-card:nth-child(2){animation-delay:.07s}#levelOverlay .upgrade-card:nth-child(3){animation-delay:.14s}
#levelOverlay .upgrade-card:hover,#levelOverlay .upgrade-card:focus-visible{transform:scale(1.025);filter:brightness(1.15)}
#levelOverlay .upgrade-card .symbol{width:64px!important;height:64px!important;flex:none;image-rendering:pixelated}
#levelOverlay .lv-body{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
#levelOverlay .lv-body strong{font-size:20px;line-height:1.15;color:#fff}
#levelOverlay .lv-desc{font-size:14px;color:#d8e6d4;line-height:1.35;display:block}
#levelOverlay .lv-stats{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:2px}
#levelOverlay .lv-stat{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;font-size:13px;background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.14);border-radius:3px}
#levelOverlay .lv-stat i{font-style:normal;color:#9fb3a0}
#levelOverlay .lv-stat b{color:#e8efe6;font-weight:400}#levelOverlay .lv-stat u{text-decoration:none;color:#7a8a7c}
#levelOverlay .lv-stat b.up{color:#7dff9a;font-weight:700}
#levelOverlay .lv-tip{font-size:12px;color:#aab8a8;line-height:1.35;display:block;margin:0}
#levelOverlay .lv-rar{position:absolute;top:8px;right:12px;font-style:normal;font-size:12px;letter-spacing:.03em}
#levelOverlay .lv-key{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:26px;height:26px;line-height:24px;text-align:center;font-size:14px;border:1px solid rgba(255,255,255,.35);border-radius:4px;color:#fff;background:rgba(0,0,0,.35)}
body.touch #levelOverlay .lv-key{display:none}body.touch #levelOverlay .upgrade-card{padding-left:20px!important}
@keyframes lvIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
@media (max-height:480px){#levelOverlay .level-panel{padding:10px 14px!important}#levelOverlay .level-panel h2{font-size:20px!important;margin:2px 0 8px!important}#levelOverlay .upgrade-choices{gap:7px!important}#levelOverlay .upgrade-card{padding:7px 14px 7px 46px!important;gap:10px!important}#levelOverlay .upgrade-card .symbol{width:40px!important;height:40px!important}#levelOverlay .lv-body strong{font-size:16px}#levelOverlay .lv-desc{font-size:12px}#levelOverlay .lv-tip{display:none}#levelOverlay .lv-stat{font-size:11px;padding:2px 6px}}
`;document.head.appendChild(st)})();
document.addEventListener("keydown",e=>{if(typeof state==="undefined"||!state||!state.choosing||ui.level.classList.contains("hidden"))return;const n=["1","2","3"].indexOf(e.key);if(n>=0&&ui.choices.children[n])ui.choices.children[n].click()});
function levelUp(){state.choosing=true;state.paused=true;ui.choices.innerHTML="";const p=state.p,ey=ui.level.querySelector(".eyebrow"),h2l=ui.level.querySelector("h2");if(ey)ey.textContent="LEVEL UP! · LV "+state.level;if(h2l)h2l.textContent=tx("강화를 선택하세요","Choose an upgrade");
pickWeighted(skFilter(p,p.charId==="zhuque"?zhuPool(p):p.charId==="hyunmu"?HPOOL:p.charId==="baekho"?BPOOL:p.charId==="cheongryong"?CPOOL:p.charId==="hwangryong"?WPOOL:p.charId==="qilin"?QPOOL:IPOOL),3).forEach((u,i)=>{let b=document.createElement("button");b.className="upgrade-card";const R=RARITY[u.rar],inf0=u.info||{stats:()=>[],tip:""},zv=p.charId==="zhuque"?ZUP[u.id]:p.charId==="hyunmu"?HUP[u.id]:p.charId==="baekho"?BUP[u.id]:p.charId==="cheongryong"?CUP[u.id]:p.charId==="hwangryong"?WUP[u.id]:p.charId==="qilin"?QUP[u.id]:SK[u.id]||null,inf=zv?{stats:zv.stats,tip:tf(zv,"tip")}:{stats:inf0.stats,tip:tf(inf0,"tip")};b.style.borderColor=R.c;b.style.boxShadow=`0 0 0 1px ${R.c},0 0 18px ${R.c}66`;b.style.setProperty("--rc",R.c);
const stats=inf.stats(p).map(([l,a,c])=>`<span class="lv-stat"><i>${l}</i><b>${a}</b><u>→</u><b class="up">${c}</b></span>`).join("");
b.innerHTML=`<span class="lv-key">${i+1}</span><img class="symbol" src="${iconURL(zv?zv.icon:u.id)}" alt="" width="64" height="64"><span class="lv-body"><strong>${tf(zv||u,"name")}</strong><small class="lv-desc">${tf(zv||u,"desc")}</small><span class="lv-stats">${stats}</span><small class="lv-tip">💡 ${inf.tip}</small></span><em class="lv-rar" style="color:${R.c}">${tf(R,"n")} · ${u.w}%</em>`;
b.onclick=()=>{u.apply();if(state.rs){const r=state.rs.ups[u.id]||(state.rs.ups[u.id]={n:0,name:tf(zv||u,"name"),icon:iconURL(zv?zv.icon:u.id),rar:u.rar});r.n++}weaponEvo.check();state.choosing=false;state.paused=false;ui.level.classList.add("hidden");hud()};b.dataset.uid=u.id;ui.choices.appendChild(b)});ui.level.classList.remove("hidden")}
function update(dt){
if(state.paused||state.dead)return;let p=state.p;state.time+=dt;p.invuln=Math.max(0,p.invuln-dt);if(state.win)p.invuln=Math.max(p.invuln,.5);if(dbg.god)p.hp=p.maxHp;if(dbg.nomob)state.spawn=999;if(state.dark>0){state.dark-=dt;if(!state.enemies.some(e=>e.boss&&e.type==="owl"))state.dark=0}
let dx=0,dy=0;if(keys.has("w")||keys.has("arrowup"))dy--;if(keys.has("s")||keys.has("arrowdown"))dy++;if(keys.has("a")||keys.has("arrowleft"))dx--;if(keys.has("d")||keys.has("arrowright"))dx++;if(joy.on){dx=joy.x;dy=joy.y}else if(dx||dy){let m=Math.hypot(dx,dy);dx/=m;dy/=m}
p.moving=!!(dx||dy);if(dx)p.face=dx>0?1:-1;if(p.moving)p.anim+=dt;p.x=clamp(p.x+dx*p.speed*dt,p.r+26,WW-p.r-26);p.y=clamp(p.y+dy*p.speed*dt,p.r+30,WH-p.r-24);if(state.mode==="tower")rockPush(p,p.r);setCam();updatePassives(dt);
easyScale();state.spawn-=dt;if(state.spawn<=0&&!state.win){if(state.enemies.length<MAX_ENEMIES)spawnEnemy();state.spawn=Math.max(.25,1.2-state.time*.007)/SPAWN_MUL*spawnGapMul()*(state.mode==="tower"?Math.max(TOWER_DIFF.spawnMin,1-((state.floor||1)-1)*TOWER_DIFF.spawnPerFloor)/TOWER_DIFF.spawnBoost:1)}
if(state.skipQ>0&&!state.win&&!dbg.nomob){state.skipAcc=(state.skipAcc||0)+dt*(state.skipRate||state.skipQ/SKIP_FLUSH);while(state.skipAcc>=1&&state.skipQ>0&&state.enemies.length<MAX_ENEMIES){spawnEnemy();state.skipQ--;state.skipAcc--}if(state.enemies.length>=MAX_ENEMIES)state.skipAcc=Math.min(state.skipAcc,1)}
if(state.mode==="tower")towerTick(dt);
else if(state.bossNight){if(!state.bossSpawned){if(spawnBoss(state.night===WITCH_NIGHT?"witch":state.night/BOSS_EVERY))state.bossSpawned=true}else if(!state.enemies.some(e=>e.boss)&&!state.win){state.bossNight=false;state.bossSpawned=false;state.night++;state.nightT=0}}
else{state.nightT+=dt;if(state.nightT>=NIGHT_LEN){if(state.night%BOSS_EVERY===0||state.night===WITCH_NIGHT){state.nightT=NIGHT_LEN;state.bossNight=true}else{state.night++;state.nightT=0}}}
for(const b of state.eb){if(b.ax){b.vx+=b.ax*dt;b.vy+=b.ay*dt}if(b.home>0){b.home-=dt;const sp=Math.hypot(b.vx,b.vy),cur=Math.atan2(b.vy,b.vx);let da=Math.atan2(p.y-b.y,p.x-b.x)-cur;da=Math.atan2(Math.sin(da),Math.cos(da));const na=cur+clamp(da,-2.4*dt,2.4*dt);b.vx=Math.cos(na)*sp;b.vy=Math.sin(na)*sp}b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(p.invuln<=0&&dist2(p,b)<(p.r+b.r)**2){p.hp-=(b.dmg||12)*(p.guard||1)*(state.mode==="tower"?1+((state.floor||1)-1)*TOWER_DIFF.bulletDmg:1);p.invuln=.8;b.life=0;burst(p.x,p.y,"#ff6b78",8);if(p.hp<=0){p.hp=0;die()}}}
state.eb=state.eb.filter(b=>b.life>0&&b.x>-20&&b.x<WW+20&&b.y>-20&&b.y<WH+20);
p.swingT=Math.max(0,(p.swingT||0)-dt);p.whipT=Math.max(0,(p.whipT||0)-dt);state.arrowTimer-=dt;if(state.arrowTimer<=0){arrow();state.arrowTimer=p.arrowRate*(p.charId==="zhuque"?1.25:1)}
if(p.feathers>0){state.featherTimer-=dt;if(state.featherTimer<=0){const ft=nearest();if(ft){featherVolley(p,ft);state.featherTimer=Math.max(1,1.9-p.feathers*.1)}else state.featherTimer=.2}}
for(const e of state.enemies){e.hit=Math.max(0,e.hit-dt);if(e.slowT>0)e.slowT-=dt;elemTick(e,dt);if(e.mm)mmTick(e,dt)}
for(let i=0;i<p.blades;i++){let a=state.time*2.4+i*Math.PI*2/p.blades,bx=p.x+Math.cos(a)*p.bladeRadius,by=p.y+Math.sin(a)*p.bladeRadius;for(const e of state.enemies)if(dist2({x:bx,y:by},e)<(e.r+8)**2){e.bladeCD-=dt;if(e.bladeCD<=0){hurt(e,p.bladeDamage*(p.ev_blade?WEVO_FX.blade.dmg:1),p.ev_blade?"#ff4a5a":"#ffb070","blade");if(p.ev_blade)weaponEvo.bladeHeal(p);e.bladeCD=.45}}}
if(p.pulse){state.pulseTimer-=dt;if(state.pulseTimer<=0){const HMw=p.charId==="hyunmu";const PR=(72+p.pulse*10)*(p.ev_pulse?WEVO_FX.pulse.r:1);if(p.ev_pulse)weaponEvo.gravity(p,PR);for(const e of state.enemies)if(dist2(p,e)<PR**2){hurt(e,p.pulse,HMw?"#9fe4ff":"#ffb070","pulse");if(HMw)e.slowT=1.5}state.pulseTimer=Math.max(1.3,3.5-p.pulse*.25)}}
if(p.lightning){state.lightTimer-=dt;if(state.lightTimer<=0){let t=nearest(p,true);if(t){meteor(t.x,t.y,(2+p.lightning)*(p.ev_storm?WEVO_FX.storm.dmg:1),0,p.ev_storm?WEVO_FX.storm.r:52);let nearby=state.enemies.filter(e=>e!==t&&inMap(e)&&dist2(e,t)<150**2).slice(0,Math.min(2,p.lightning-1));nearby.forEach((e,i)=>meteor(e.x,e.y,1,.18*(i+1),38))}state.lightTimer=Math.max(1.1,4.5-p.lightning*.45)*(p.ev_storm?WEVO_FX.storm.cd:1)}}
for(const a of state.arrows){a.x+=a.vx*dt;a.y+=a.vy*dt;a.life-=dt;for(const e of state.enemies)if(!a.hit.has(e)&&inMap(e)&&dist2(a,e)<(a.r+e.r)**2){a.hit.add(e);hurt(e,a.damage,"#ffd070",a.src||(a.feather?"feather":"main"));if(a.slow&&!e.boss)e.slowT=Math.max(e.slowT||0,a.slow);if(a.boom)fireBoom(a,e);if(a.bnc>0){let nt=null,bd=SKN.i_bounce.range**2;for(const o of state.enemies){if(o===e||a.hit.has(o)||o.ghost||!inMap(o)||o.hp<=0)continue;const d2=dist2(o,a);if(d2<bd){bd=d2;nt=o}}if(nt){a.bnc--;const sp=Math.hypot(a.vx,a.vy),dx=nt.x-a.x,dy=nt.y-a.y,dd=Math.hypot(dx,dy)||1;a.vx=dx/dd*sp;a.vy=dy/dd*sp;a.life=Math.max(a.life,.9);burst(a.x,a.y,"#ffb070",3);break}}if(--a.pierce<=0){a.life=0;break}}}
state.arrows=state.arrows.filter(a=>a.life>0&&a.x>-20&&a.x<WW+20&&a.y>-20&&a.y<WH+20);
for(const e of state.enemies){let vx=p.x-e.x,vy=p.y-e.y,d=Math.hypot(vx,vy)||1;if(e.boss)bossAI(e,dt,vx/d,vy/d);else if(e.stunT>0){}else if(e.fearT>0){const sl=e.slowT>0?.45:1;e.x-=vx/d*e.speed*.9*sl*dt;e.y-=vy/d*e.speed*.9*sl*dt}else if(e.mm)mapMobAI(e,dt,vx/d,vy/d,d);else if(e.ai)rangedAI(e,dt,vx/d,vy/d,d);else if(e.type==="lantern"){}else{const sl=e.slowT>0?.45:1;e.x+=vx/d*e.speed*sl*dt;e.y+=vy/d*e.speed*sl*dt;if(state.mode==="tower"){const h=rockPush(e,e.r);if(h){const gx=-h.ny,gy=h.nx,dot=gx*vx+gy*vy,sg=Math.abs(dot)>1?Math.sign(dot):(e.ph>3.14?1:-1);e.x+=gx*sg*e.speed*dt*.6;e.y+=gy*sg*e.speed*dt*.6}}}if(d<p.r+e.r&&p.invuln<=0&&e.damage>0){p.hp-=e.damage*(p.guard||1);p.invuln=.8;burst(p.x,p.y,"#ff6b78",8);if(p.hp<=0){p.hp=0;die()}}}
let alive=[];for(const e of state.enemies){if(e.hp<=0){state.kills++;rec.kill(e.type);if(e.mm==="shroom"&&!e.mkid&&!state.win)mmSplit(e,alive);if(e.elite)rec.kill("elite");if(e.burnT>0)elemSpread(e);if(e.sealT>0)hwSealBoom(e);if(e.prey)skPreyKill(e);if(e.brandT>0&&p.charId==="qilin")qHeal(QILIN.brand.heal+(p.brandHeal||0));if(p.killHeal&&p.hp>0&&p.hp<p.maxHp){p.hp=Math.min(p.maxHp,p.hp+p.killHeal);if(Math.random()<.15)burst(p.x,p.y-10,"#7dff9a",1)}if(state.mode==="tower"&&!e.boss&&!state.portal)state.floorKills++;state.gems.push({x:e.x,y:e.y,r:5,value:e.xpv??((e.xb??e.maxHp/(e.hpMul||1))>1?6:3),phase:rand(0,6)});if(e.elite)for(let i=0;i<3;i++)state.gems.push({x:e.x+rand(-14,14),y:e.y+rand(-14,14),r:5,value:5,phase:rand(0,6)});if(Math.random()<MAGNET_DROP)state.magnets.push({x:e.x,y:e.y,phase:rand(0,6)});burst(e.x,e.y,e.color,8);baekhoKill();if(state.rs&&e.elite)state.rs.elites++;if(e.boss){rec.boss(e.type);if(e.gateStage)hwGateWin(e);if(state.rs)state.rs.bosses.push({t:e.type,time:state.time,f:state.floor});for(let i=0;i<12;i++)state.gems.push({x:e.x+rand(-34,34),y:e.y+rand(-34,34),r:5,value:5,phase:rand(0,6)});p.hp=Math.min(p.maxHp,p.hp+25);burst(e.x,e.y,e.color,36);state.banner={text:tx("BOSS 처치!","BOSS DEFEATED!"),t:2};if(e.type==="warden"||e.type==="astra")openPortal(e.x,e.y,true);if(e.type==="astra"){dragonImpact(e,true);state.flash=1;state.flashC="#fff4d8";state.shake=24;for(let i=0;i<4;i++)ringFx(e.x,e.y,20,200+i*90,.6+i*.2,i%2?"#fff0a0":"#ff5a12",14,.6);for(let i=0;i<80;i++){const a=rand(0,6.283),v=rand(150,520);fireP(e.x,e.y,Math.cos(a)*v,Math.sin(a)*v,rand(.5,1.2),rand(3,6))}state.banner={text:tx("흑룡왕을 쓰러뜨렸다!","The Black Dragon King has fallen!"),t:3}}if(e.type==="shadow"){state.win={t:3.2};state.banner={text:tx("식음의 그림자 처치!","The Chilling Shadow is defeated!"),t:3}}}}else alive.push(e)}state.enemies=alive;if(!state.enemies.some(o=>o.type==="witch")&&state.enemies.some(o=>o.type==="lantern")){for(const o of state.enemies)if(o.type==="lantern")burst(o.x,o.y,"#7affe0",10);state.enemies=state.enemies.filter(o=>o.type!=="lantern")}if(state.win&&!state.winDone){state.winDone=true;state.eb=[];for(const o of state.enemies)o.hp=0}
for(const g of state.gems){g.phase+=dt*4;if(g.pull){g.v=Math.min(1500,(g.v||260)+dt*1800);let vx=p.x-g.x,vy=p.y-g.y,l=Math.hypot(vx,vy)||1,st=Math.min(l,g.v*dt);g.x+=vx/l*st;g.y+=vy/l*st;continue}let d=Math.sqrt(dist2(p,g));if(d<p.pickup){let pull=(p.pickup-d)/p.pickup,vx=p.x-g.x,vy=p.y-g.y,l=Math.hypot(vx,vy)||1;g.x+=vx/l*(70+pull*280)*dt;g.y+=vy/l*(70+pull*280)*dt}}
state.gems=state.gems.filter(g=>{if(dist2(p,g)<(p.r+g.r+3)**2){xpGain(g.value);return false}return true});
for(const m of state.magnets){m.phase+=dt*4;const d=Math.sqrt(dist2(p,m));if(d<p.pickup){const l=d||1,sp=(90+(p.pickup-d)/p.pickup*280)*dt;m.x+=(p.x-m.x)/l*sp;m.y+=(p.y-m.y)/l*sp}}
state.magnets=state.magnets.filter(m=>{if(dist2(p,m)<(p.r+12)**2){magnetPickup();return false}return true});
for(const q of state.particles){if(q.suck){const dx=q.suck.x-q.x,dy=q.suck.y-q.y,dd=Math.hypot(dx,dy)||1;q.vx=dx/dd*420;q.vy=dy/dd*420}q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=.94;q.vy*=.94;q.life-=dt}state.particles=state.particles.filter(q=>q.life>0);
if(state.win){state.win.t-=dt;if(state.win.t<=0&&!state.won){state.won=true;state.paused=true;showEnding()}}if(state.banner)state.banner.t-=dt;if(state.shake>0)state.shake=Math.max(0,state.shake-dt*28);if(state.flash>0)state.flash=Math.max(0,state.flash-dt*2.2);for(const f of state.fx){f.life-=dt;if(f.type==="meteor"&&!f.hit&&f.max-f.life>=f.delay+METEOR_FALL){f.hit=true;meteorBoom(f)}}state.fx=state.fx.filter(f=>f.life>0);hud()
}
/* ================= ART: 스프라이트 / 맵 ================= */
const PX=2;
function spr(rows,pal){const c=document.createElement("canvas");c.width=rows[0].length*PX;c.height=rows.length*PX;const g=c.getContext("2d");rows.forEach((r,y)=>{for(let x=0;x<r.length;x++){const k=r[x];if(k!=="."){g.fillStyle=pal[k];g.fillRect(x*PX,y*PX,PX,PX)}}});return c}
function whiten(c){const f=document.createElement("canvas");f.width=c.width;f.height=c.height;const g=f.getContext("2d");g.drawImage(c,0,0);g.globalCompositeOperation="source-atop";g.fillStyle="#fff4d8";g.fillRect(0,0,f.width,f.height);return f}
const pack=(rows,pal)=>{const n=spr(rows,pal);return{n,f:whiten(n)}};

// 이그니 (불꽃 꼬리를 가진 아기 용 / 정면 2등신)
const DRAGON_PAL={"o":"#3b1522","R":"#f2643c","r":"#ff9a6a","D":"#c9432f","h":"#fff1c8","H":"#e9c98c","w":"#ffffff","e":"#2a1020","p":"#ff8fa3","n":"#8a2a2a","m":"#8a2a2a","s":"#ffe9b8","S":"#f7c97e","g":"#ffc24a","G":"#e8892a"};
const DRAGON_BODY=[
"..oh........ho..",
".ohHo......oHho.",
".oHhoooooooohHo.",
"..oRRrrRRrrRRo..",
".oRRrRRRRRRrRRo.",
".oRRRRRRRRRRRRo.",
"oRRRRRRRRRRRRRRo",
"oRRweeRRRRweeRRo",
"oRReeeRRRReeeRRo",
"oRReeeRnnReeeRRo",
"oRppRmRRRRmRppRo",
".oRRRRmmmmRRRRo.",
"..ooDRRRRRRDoo..",
"..goRssssssRog..",
".gGoRssssssRoGg.",
"..goRSssssSRog.."];
const DRAGON_A=["..oRRRo..oRRRo..", "..oooo....oooo..", "................"],DRAGON_B=["...oRRRo.oRRRo..", "...ooooo.oooooo.", "................"];

// 적 3종: 재 덩이 / 서리 박쥐 / 서리 바위
const BLOB_PAL={"o":"#1c1a22","p":"#6c7080","q":"#a9aebd","e":"#1c1a22","w":"#ffffff","k":"#ff8a3a"};
const BLOB=[
"....oooooo....",
"..ooppppppoo..",
".oqqpppppppppo",
"oqqppppppppppo",
"oppweppppweppo",
"oppeeppppeeppo",
"oppeeppppeeppo",
"oppkpppooppkpo",
".oppppppppppo.",
"..opo.opo.opo."];
const BAT_PAL={"o":"#10182a","a":"#6fa8e8","e":"#10182a","w":"#ffffff","n":"#bfefff"};
const BAT=[
"oo....oo",
"oaaooaao",
"oaaaaaao",
"oawaawao",
"oaeaaeao",
"oaannaao",
".oaaaao.",
"..oooo.."];
const STUMP_PAL={"o":"#141a24","b":"#5d6678","d":"#343c4c","l":"#7e889c","g":"#8fd6ee","h":"#d6f6ff","k":"#9aa4b8","e":"#141a24","w":"#ffffff","p":"#9fb4d0","y":"#d6f6ff"};
const STUMP=[
"...oooooooooo...",
"..oggghggpyhgo..",
".ogghgggggggghgo",
".obbkkkkkkkkkbbo",
"obbbwebbbbwebbbo",
"obbbeebbbbeebbbo",
"obbbeebbbbeebbbo",
"obbppbbddbbppbbo",
"obbbbblbbbbbbbbo",
"obbblbbbbbblbbbo",
"obbbbbbbbbbbbbbo",
"oobbbbbbbbbbbboo",
".oobbbbbbbbbboo.",
"..ooobbbbbbooo..",
"..odo.oooo.odo.."];
const SP={dragonA:pack([...DRAGON_BODY,...DRAGON_A],DRAGON_PAL),dragonB:pack([...DRAGON_BODY,...DRAGON_B],DRAGON_PAL),blob:pack(BLOB,BLOB_PAL),bat:pack(BAT,BAT_PAL),stump:pack(STUMP,STUMP_PAL)};
// 주작 (불꽃 볏을 가진 아기 불새 / 정면 2등신) — 이그니와 같은 16×19 규격
const ZHU_PAL={"o":"#3b1522","R":"#e8442a","r":"#ff8a4a","D":"#a82020","Y":"#ffc83a","y":"#fff2a8","w":"#ffffff","e":"#2a1020","p":"#ff8fa3","k":"#ffd36a","K":"#e8892a"};
const ZHU_BODY=[
".......oo.......",
"..o...oYYo...o..",
".oYo.oYyyYo.oYo.",
".oRYooRRRRooYRo.",
"..oRRrrRRrrRRo..",
".oRRrRRRRRRrRRo.",
"oRRDDRRRRRRDDRRo",
"oRRweeRRRRweeRRo",
"oRReeeRRRReeeRRo",
"oRReeeRkkReeeRRo",
"oRppRRRKKRRRppRo",
".oRRRRRRRRRRRRo.",
"oYoDRRRYYRRRDoYo",
"oYYoDRYyyYRDoYYo",
".oYYoRRYYRRoYYo.",
"..ooDRRRRRRDoo.."];
const ZHU_A=["..oKKKo..oKKKo..","..ooooo..ooooo..","................"],ZHU_B=["...oKKKo.oKKKo..","...ooooo.oooooo.","................"];
SP.zhuqueA=pack([...ZHU_BODY,...ZHU_A],ZHU_PAL);SP.zhuqueB=pack([...ZHU_BODY,...ZHU_B],ZHU_PAL);
// 현무 (흑수 등껍질의 아기 거북 + 등껍질을 휘감은 뱀) — 같은 16×19 규격
const HYUN_PAL={o:"#0c1418",K:"#3f6b5a",k:"#2c4f44",w:"#ffffff",e:"#0c1418",p:"#ff8fa3",m:"#1c2c24",S:"#1e2f3a",s:"#2f4a5a",h:"#5a8aa0",P:"#cdb878",r:"#a08850"};
const HYUN_BODY=[".....oooooo.....","...ooKKKKKKoo...","..oKKkKKKKkKKo..",".oKKKKKKKKKKKKo.",".oKKweKKKKweKKo.",".oKKeeKKKKeeKKo.","ooKKeeKKKKeeKKoo","oSoKpKKmmKKpKoSo","oSsooKKKKKKoosSo","oShoPPPPPPPPohSo","oSsoPrPPPPrPosSo","oShoPPPPPPPPohSo","oSsoPPrPPrPPosSo",".oSoPPPPPPPPoSo.","..oKoPPPPPPoKo..","..ooo.oooo.ooo.."],HYUN_A=["..oKKKo..oKKKo..","..ooooo..ooooo..","................"],HYUN_B=["...oKKKo.oKKKo..","...ooooo.ooooo..","................"];
SP.hyunmuA=pack([...HYUN_BODY,...HYUN_A],HYUN_PAL);SP.hyunmuB=pack([...HYUN_BODY,...HYUN_B],HYUN_PAL);
SP.crown=pack(["y..y..y..y","yyyyyyyyyy","yyrryyrryy","oooooooooo"],{y:"#ffd54a",r:"#e0526a",o:"#7a5a1a"});
SP.horns=pack(["r......r","rr....rr",".rr..rr."],{r:"#bfefff"});
SP.antlers=pack(["k..k........k..k","kk.k........k.kk",".kkk........kkk.","..kk........kk..","...kk......kk..."],{k:"#bfefff"});
const BOSS_NAME={witch:"혼등의 마녀",king:"재의 왕",lord:"서리 박쥐 군주",guardian:"얼음 바위 수호자",owl:"그믐달 올빼미",shadow:"식음의 그림자",warden:"탑의 수문장",astra:"흑룡왕 아스트라",taotie:"탐식의 흉수 도철",hundun:"형체 없는 혼돈"};
const BOSS_NAME_EN={witch:"The Lantern Witch",king:"King of Ash",lord:"Frost Bat Lord",guardian:"Ice Rock Guardian",owl:"Waning Moon Owl",shadow:"The Chilling Shadow",warden:"Tower Warden",astra:"Astra, the Black Dragon King",taotie:"Taotie, the Devourer",hundun:"Hundun, the Formless Chaos"},bossName=t=>(isEN()?BOSS_NAME_EN:BOSS_NAME)[t];
const BOSS_ORDER=["king","lord","guardian","owl","shadow"],DARK_T=6;
const tint=(c,col)=>{const f=document.createElement("canvas");f.width=c.width;f.height=c.height;const g=f.getContext("2d");g.drawImage(c,0,0);g.globalCompositeOperation="source-atop";g.globalAlpha=.88;g.fillStyle=col;g.fillRect(0,0,f.width,f.height);return f};
SP.owl=pack(["..oo......oo..",".oddo....oddo.",".oddddooddddo.","oddddddddddddo","odyyyddddyyydo","odyeyddddyeydo","odyyyddddyyydo","odddddkkddddd o".replace(" ",""),"odd"+"llllllll"+"ddo",".odd"+"llllll"+"ddo.","..oddddddddo..","...oooooooo...","..kk......kk.."],{o:"#0d1230",d:"#2a3a7a",y:"#ffe27a",e:"#0d1230",l:"#8da2d8",k:"#e8a23a"});
SP.moon=pack([".yy.","yy..","yy..",".yy."],{y:"#ffe27a"});
{const n=tint(SP.dragonA.n,"#1a1030");SP.shadowDragon={n,f:whiten(n)}}

/* ================= 백호 (바람의 신수): 발톱 베기 · 질풍 돌진 · 사냥 본능 ================= */
const BAEKHO_PAL={"o":"#2a2a3a","W":"#f4f4f8","w":"#ffffff","E":"#ffb0c0","K":"#3a3a4a","e":"#22283a","n":"#ff8aa0","p":"#ffa0b8","m":"#5a4a5a","B":"#ffffff"};
const BAEKHO_BODY=["..oo........oo..",".oWEo......oEWo.",".oWWooooooooWWo.","oWWWWKWKKWKWWWWo","oWWWWWKWWKWWWWWo","oKWWWWWWWWWWWWKo","oWWweeWWWWweeWWo","oKWeeeWWWWeeeWKo","oWWeeeWnnWeeeWWo","oWppWWmWWmWWppWo",".oWWWWWmmWWWWWo.","..ooWWWWWWWWoo..","..oKWBBBBBBWKo..",".oWKWBBBBBBWKWo.",".oWWKBBBBBBKWWo."];
const BAEKHO_FA=["..oWWWo..oWWWo..","..oooo....oooo..","................"],BAEKHO_FB=["...oWWWooWWWo...","...ooooo.ooooo..","................"];
SP.baekhoA=pack([...BAEKHO_BODY,...BAEKHO_FA],BAEKHO_PAL);SP.baekhoB=pack([...BAEKHO_BODY,...BAEKHO_FB],BAEKHO_PAL);
/* 수치 — 숫자만 바꿔서 조절하세요
   claw: 발톱 사거리 · 부채꼴 반각(라디안) · 피해 배율 · 밀어내기 / wind: 사거리 밖일 때 날리는 바람 칼날 (사거리 짧음)
   dash: 돌진 대기 · 최대 거리 · 시간 · 피해 배율 · 탐지 거리 / hunt: 사냥 본능 (처치마다 1스택, 스택당 이동 +2% · 공격 속도 +3%, 최대 10스택, 2초 유지) */
const BAEKHO={claw:{reach:72,arc:1.05,dmg:1.3,push:10},wind:{speed:380,life:.42,dmg:.6,pierce:2},dash:{cd:3.2,dist:190,time:.18,dmg:1.5,seek:300},hunt:{max:10,spd:.02,rate:.03,keep:2,decay:.22}};
function baekhoTail(g,t,mv){const N=4,sp=mv?10:3.4,am=mv?2.4:1.4,pts=[];
 for(let i=0;i<N;i++)pts.push([Math.round(-12-i*3.6),Math.round(6-i*2.6+Math.sin(t*sp-i*.9)*am*(i+1)*.45)]);
 for(let i=0;i<N;i++){const s=Math.round(5-i*.6);g.fillStyle="#2a2a3a";g.fillRect(pts[i][0]-Math.ceil(s/2)-1,pts[i][1]-Math.ceil(s/2)-1,s+2,s+2)}
 for(let i=0;i<N;i++){const s=Math.round(5-i*.6);g.fillStyle=i%2?"#3a3a4a":"#f4f4f8";g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s,s)}
 const tp=pts[N-1];g.fillStyle="#2a2a3a";g.fillRect(tp[0]-3,tp[1]-5,5,5);g.fillStyle="#3a3a4a";g.fillRect(tp[0]-2,tp[1]-4,3,3);return tp}
function baekhoBlink(g,t){if((t%3.4)<.12){g.fillStyle="#f4f4f8";g.fillRect(-10,-12,6,6);g.fillRect(4,-12,6,6);g.fillStyle="#22283a";g.fillRect(-10,-8,6,2);g.fillRect(4,-8,6,2)}}
// 발톱 자국 (부채꼴로 세 줄)
function drawClaw(p,bob){const k=p.clawT/.2,a=p.clawA,R=(p.clawReach||BAEKHO.claw.reach)+6,arc=p.clawArc||BAEKHO.claw.arc,cx=p.x,cy=p.y-6+bob;
 ctx.save();ctx.globalCompositeOperation="lighter";ctx.lineCap="round";
 for(let i=-1;i<=1;i++){const r=R*(.72+i*.14),a0=a-arc*(1-k*.2),a1=a0+arc*2*(1-k);ctx.globalAlpha=.75*k;ctx.strokeStyle=i===0?"#ffffff":"#bfe4ff";ctx.lineWidth=i===0?4:3;ctx.beginPath();ctx.arc(cx,cy,r,a0,Math.max(a0+.05,a1));ctx.stroke()}
 ctx.restore()}
function drawWind(a){ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(a.vy,a.vx));ctx.globalCompositeOperation="lighter";const k=Math.min(1,a.life/.15);
 ctx.globalAlpha=.25*k;ctx.fillStyle="#cfe8ff";ctx.beginPath();ctx.ellipse(-4,0,14,10,0,0,6.283);ctx.fill();
 ctx.globalAlpha=.95*k;ctx.strokeStyle="#ffffff";ctx.lineWidth=3;ctx.lineCap="round";ctx.beginPath();ctx.arc(-8,0,11,-1.1,1.1);ctx.stroke();ctx.strokeStyle="#9fd8ff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(-13,0,9,-1,1);ctx.stroke();ctx.restore()}
function baekhoTick(dt){const p=state.p;if(!p||p.charId!=="baekho"||state.dead)return;const D=BAEKHO.dash,H=BAEKHO.hunt;
 p.clawT=Math.max(0,(p.clawT||0)-dt);if(p.claw2T>0){p.claw2T-=dt;if(p.claw2T<=0){const C=BAEKHO.claw,R=p.clawReach||C.reach,arc=p.clawArc||C.arc,a=p.clawA;p.clawT=.2;for(const e of state.enemies){if(e.ghost||!inMap(e))continue;const ex=e.x-p.x,ey=e.y-p.y,de=Math.hypot(ex,ey)||1;if(de>R+e.r)continue;let da=Math.atan2(ey,ex)-a;da=Math.atan2(Math.sin(da),Math.cos(da));if(Math.abs(da)<arc)hurt(e,p.arrowDamage*C.dmg*.6,"#cfe8ff","main")}if(typeof audio!=="undefined")audio.sfx("claw")}}
 // 질풍 돌진
 if(p.dashT>0){p.dashT-=dt;const nx=clamp(p.x+p.dashVx*dt,p.r+26,WW-p.r-26),ny=clamp(p.y+p.dashVy*dt,p.r+30,WH-p.r-24);
  (p.dashTrail=p.dashTrail||[]).push({x:p.x,y:p.y,t:.25,f:p.face});p.x=nx;p.y=ny;if(state.mode==="tower")rockPush(p,p.r);
  for(const e of state.enemies)if(!e.ghost&&!p.dashHit.has(e)&&dist2(e,p)<(e.r+26)**2){p.dashHit.add(e);hurt(e,p.arrowDamage*D.dmg+(p.dashDmg||0),"#e8f4ff","dash");if(!e.boss){const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*14;e.y+=dy/d*14}}
  if(p.dashT<=0)p.dashT=0}
 else{p.dashTimer=(p.dashTimer==null?1:p.dashTimer)-dt;if(p.dashTimer<=0){let t=null,bd=1e9;for(const e of state.enemies){if(e.ghost||!inMap(e))continue;const d2=Math.hypot(e.x-p.x,e.y-p.y);if(d2>80&&d2<D.seek&&d2<bd){bd=d2;t=e}}const thru=!t;if(!t)t=nearest();if(t){const dx=t.x-p.x,dy=t.y-p.y,d=Math.hypot(dx,dy)||1;
   if(d<D.seek){const dist=thru?D.dist*.7:Math.min(D.dist,d+20);p.dashVx=dx/d*dist/D.time;p.dashVy=dy/d*dist/D.time;p.dashT=D.time;p.dashHit=new Set();p.face=dx>0?1:-1;p.invuln=Math.max(p.invuln||0,D.time+.08);p.dashTimer=p.dashCD||D.cd;burst(p.x,p.y,"#e8f4ff",8);if(typeof audio!=="undefined")audio.sfx("dash")}else p.dashTimer=.25}else p.dashTimer=.25}}
 if(p.dashTrail){for(const q of p.dashTrail)q.t-=dt;p.dashTrail=p.dashTrail.filter(q=>q.t>0)}
 // 사냥 본능 (하드에서는 꺼짐)
 if(p.noPassive){p.hunt=0}else if(p.hunt>0){p.huntT-=dt;if(p.huntT<=0){p.hunt--;p.huntT=H.decay}}
 const ws=1+(p.hunt||0)*H.spd,wr=1/(1+(p.hunt||0)*H.rate);if(p.huntS!==ws){p.speed*=ws/(p.huntS||1);p.huntS=ws}if(p.huntR!==wr){p.arrowRate*=wr/(p.huntR||1);p.huntR=wr}}
function baekhoKill(){const p=state.p;if(p&&p.charId==="baekho"&&!p.noPassive){p.hunt=Math.min(BAEKHO.hunt.max,(p.hunt||0)+1);p.huntT=BAEKHO.hunt.keep}}

/* ================= 청룡 (번개의 신수): 번개 사슬 · 비구름 · 여의주 ================= */
const CHEONG_PAL={"o":"#14243a","B":"#3a8ad8","b":"#7ac0f8","D":"#2a5aa8","h":"#f4e8c0","g":"#5affc8","G":"#2ab890","w":"#ffffff","e":"#14203a","n":"#1a3a6a","p":"#ff9ab8","m":"#1a3a6a","s":"#f0f0d0","S":"#d8d0a0"};
const CHEONG_BODY=["..h.h......h.h..","..ohho....ohho..",".oggBooooooBggo.","ogBBbbBBBBbbBBgo","oBBbBBBBBBBBbBBo","oBBBBBBBBBBBBBBo","oBBweeBBBBweeBBo","oBBeeeBBBBeeeBBo","oBBeeeBnnBeeeBBo","oBppBmBBBBmBppBo",".oBBBBmmmmBBBBo.","..ooDBBBBBBDoo..","..goBssssssBog..",".gGoBssssssBoGg.","..goBSssssSBog.."];
const CHEONG_FA=["..oBBBo..oBBBo..","..oooo....oooo..","................"],CHEONG_FB=["...oBBBo.oBBBo..","...ooooo.oooooo.","................"];
SP.cheongA=pack([...CHEONG_BODY,...CHEONG_FA],CHEONG_PAL);SP.cheongB=pack([...CHEONG_BODY,...CHEONG_FB],CHEONG_PAL);
/* 수치 — 숫자만 바꿔서 조절하세요
   chain: 첫 대상 사거리 · 튕기는 거리 · 튕기는 횟수 · 피해 배율 · 튈 때마다 피해 감소
   rain: 비구름 대기 · 반경 · 지속 · 적 피해(초당, 공격력 배율) · 적 둔화 · 안에 있을 때 회복(초당 최대 체력 비율)
   pearl: 여의주 — 공격 몇 번마다 천둥 (추가 튕김 · 피해 배율 · 기절) */
const CHEONG={chain:{range:320,jump:130,jumps:2,dmg:1.05,falloff:.85},rain:{cd:7,r:110,time:4,dps:.6,slow:.45,regen:.01},pearl:{every:8,extra:3,dmg:1.6,stun:.6}};
function cheongTail(g,t,mv){const N=6,sp=mv?9:3,pts=[];
 for(let i=0;i<N;i++)pts.push([Math.round(-11-i*3.2),Math.round(6-i*1.6+Math.sin(t*sp-i*1.1)*(mv?3:2)*(.4+i*.25))]);
 for(let i=0;i<N;i++){const s=Math.round(6-i*.7);g.fillStyle="#14243a";g.fillRect(pts[i][0]-Math.ceil(s/2)-1,pts[i][1]-Math.ceil(s/2)-1,s+2,s+2)}
 for(let i=0;i<N;i++){const s=Math.round(6-i*.7);g.fillStyle=i%2?"#2a5aa8":"#3a8ad8";g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s,s);if(i%2===0){g.fillStyle="#5affc8";g.fillRect(pts[i][0]-1,pts[i][1]-Math.ceil(s/2)-2,2,2)}}
 const tp=pts[N-1];g.fillStyle="#5affc8";g.fillRect(tp[0]-4,tp[1]-3,3,5);g.fillStyle="#2ab890";g.fillRect(tp[0]-5,tp[1]-1,2,3);return tp}
function cheongBlink(g,t){if((t%3.8)<.12){g.fillStyle="#3a8ad8";g.fillRect(-10,-12,6,6);g.fillRect(4,-12,6,6);g.fillStyle="#14203a";g.fillRect(-10,-8,6,2);g.fillRect(4,-8,6,2)}}
// 수염 + 여의주 (스프라이트 위에 그림)
function cheongExtras(g,t,mv,p){g.lineCap="round";for(const d of[-1,1]){g.strokeStyle="#14243a";g.lineWidth=2.4;g.beginPath();g.moveTo(d*4,-5);for(let k=1;k<=6;k++)g.lineTo(d*(4+k*2.6),-5+Math.sin(t*4+k*.9+(d>0?1:0))*2+k*.6);g.stroke();
  g.strokeStyle="#bfe8ff";g.lineWidth=1.2;g.beginPath();g.moveTo(d*4,-5);for(let k=1;k<=6;k++)g.lineTo(d*(4+k*2.6),-5+Math.sin(t*4+k*.9+(d>0?1:0))*2+k*.6);g.stroke()}
 const ch=p&&!p.noPassive?Math.min(1,(p.pearl||0)/(p.pearlEvery||CHEONG.pearl.every)):0,px=12,py=-20+Math.sin(t*2.5)*2,big=p&&p.evo>=2?1.5:1;
 g.save();g.globalCompositeOperation="lighter";g.globalAlpha=.25+.45*ch;g.fillStyle="#9fe8ff";g.beginPath();g.arc(px,py,(6+ch*3)*big,0,6.283);g.fill();g.restore();
 g.fillStyle="#14243a";g.fillRect(px-3,py-3,6,6);g.fillStyle=ch>=.99?"#fff6c0":"#bfe8ff";g.fillRect(px-2,py-2,4,4);g.fillStyle="#ffffff";g.fillRect(px-2,py-2,2,2)}
// 번개 사슬 그리기 (fx: bolt)
function drawBolt(f){const k=f.life/f.max;ctx.save();ctx.globalCompositeOperation="lighter";ctx.lineJoin="round";ctx.lineCap="round";
 for(const pts of f.paths){for(const [w,c,a] of (f.thunder?[[12,"#fff2a0",.25],[6,"#ffe680",.6],[2.5,"#ffffff",1]]:[[9,"#5ac8ff",.25],[4,"#9fe8ff",.6],[1.8,"#ffffff",1]])){ctx.globalAlpha=a*k;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.stroke()}}
 ctx.restore()}
function boltPath(x0,y0,x1,y1){const n=Math.max(3,Math.round(Math.hypot(x1-x0,y1-y0)/18)),pts=[[x0,y0]],nx=-(y1-y0),ny=x1-x0,l=Math.hypot(nx,ny)||1;
 for(let i=1;i<n;i++){const q=i/n,j=rand(-9,9);pts.push([x0+(x1-x0)*q+nx/l*j,y0+(y1-y0)*q+ny/l*j])}pts.push([x1,y1]);return pts}
// 비구름 그리기 (fx: rain)
function drawRain(f){const t=state.time,k=Math.min(1,(f.max-f.life)/.3,f.life/.4);ctx.save();
 ctx.globalAlpha=.7*k;ctx.strokeStyle="#cfe8ff";ctx.lineWidth=1.5;for(let i=0;i<26;i++){const a=i*2.4,rr=(i*37%100)/100*f.r*.95,x=f.x+Math.cos(a)*rr,yy=f.y+Math.sin(a)*rr*.62,h=((t*260+i*53)%60);ctx.beginPath();ctx.moveTo(x-2,yy-60+h);ctx.lineTo(x-4,yy-50+h);ctx.stroke()}
 const cy=f.y-f.r*.62-40;ctx.globalAlpha=.85*k;for(const [dx,dy,r,c] of [[-28,6,18,"#3a4a6a"],[0,0,24,"#4a5a7a"],[28,6,18,"#3a4a6a"],[-12,-6,16,"#6a7a9a"],[14,-8,14,"#6a7a9a"]]){ctx.fillStyle=c;ctx.beginPath();ctx.arc(f.x+dx,cy+dy,r,0,6.283);ctx.fill()}
 ctx.restore()}
function cheongTick(dt){const p=state.p;if(!p||p.charId!=="cheongryong"||state.dead)return;const R=CHEONG.rain;
 p.rainTimer=(p.rainTimer==null?2:p.rainTimer)-dt;
 if(p.rainTimer<=0){const tg=nearest();const x=tg&&dist2(tg,p)<260*260?(tg.x+p.x)/2:p.x,y=tg&&dist2(tg,p)<260*260?(tg.y+p.y)/2:p.y;
  state.fx.push({type:"rain",x,y,r:p.rainR||R.r,life:R.time,max:R.time,tick:0});p.rainTimer=p.rainCD||R.cd;if(typeof audio!=="undefined")audio.sfx("rain")}
 for(const f of state.fx){if(f.type!=="rain")continue;f.tick-=dt;const r2=f.r*f.r;
  for(const e of state.enemies){const dx=e.x-f.x,dy=(e.y-f.y)/.62;if(dx*dx+dy*dy<r2){e.slowT=Math.max(e.slowT||0,.25);if(f.tick<=0)hurt(e,p.arrowDamage*R.dps*.5,"#9fd8ff","rain")}}
  if(f.tick<=0)f.tick=.5;
  const dx=p.x-f.x,dy=(p.y-f.y)/.62;if(dx*dx+dy*dy<r2&&p.hp>0&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+p.maxHp*R.regen*dt)}}

/* ================= 황룡 (중앙의 신수 · 사신의 왕): 황금 기둥 · 오방 순환 · 황금 비늘 =================
   해금: 주작 · 현무 · 백호 · 청룡을 모두 Lv 40까지 진화시키면 열려요 (코인으로 살 수 없음) */
const HW_PAL={"o":"#3a2408","Y":"#f0b828","y":"#ffe070","D":"#c88a18","h":"#ff8a4a","M":"#e8443a","j":"#7affe0","w":"#ffffff","e":"#2a1408","n":"#7a4a10","p":"#ff9a8a","m":"#7a4a10","s":"#fff2c8","S":"#f0d890","g":"#ff7a4a","G":"#c84a2a"};
const HW_BODY=["..h.h......h.h..","..ohho....ohho..",".oMMYooooooYMMo.","oMYYyyYYYYyyYYMo","oYYyYYYjjYYYyYYo","oYYYYYYYYYYYYYYo","oYYweeYYYYweeYYo","oYYeeeYYYYeeeYYo","oYYeeeYnnYeeeYYo","oYppYmYYYYmYppYo",".oYYYYmmmmYYYYo.","..ooDYYYYYYDoo..","..goYssssssYog..",".gGoYssssssYoGg.","..goYSssssSYog.."];
const HW_FA=["..oYYYo..oYYYo..","..oooo....oooo..","................"],HW_FB=["...oYYYo.oYYYo..","...ooooo.oooooo.","................"];
SP.hwangA=pack([...HW_BODY,...HW_FA],HW_PAL);SP.hwangB=pack([...HW_BODY,...HW_FB],HW_PAL);
const HW_CROWN=pack(["y.y.y.y","yyyyyyy","yrryrry","ooooooo"],{y:"#ffd54a",r:"#e83a4a",o:"#7a5a1a"});
/* 수치 — 숫자만 바꿔서 조절하세요
   pillar: 황금 기둥 (사거리 · 반경 · 피해 배율 · 맞은 적 둔화 시간 · 솟아오르기까지)
   cycle: 오방 순환 — cd초마다 주작 → 현무 → 백호 → 청룡 순서로 사신의 힘을 빌려요
   borrow: 빌려 쓰는 사신 기술 (fire 주작 검기 · water 현무 물방울 · wind 백호 바람 칼날 · bolt 청룡 번개 사슬)
   scale: 황금 비늘 — 공격을 1번 막고 깨지면 땅울림 (충전 · 반경 · 피해 배율 · 밀어내기 · 둔화) */
const HWANG={pillar:{range:340,r:46,dmg:1.25,slow:.5,delay:.16},cycle:{cd:5},
 borrow:{fire:{n:6,dmg:1.2,speed:380,pierce:4,life:.8},water:{n:8,dmg:.8,speed:300,pierce:2,life:1.1,slow:1.5},wind:{n:4,dmg:1.3,speed:420,pierce:3,life:.55},bolt:{range:360,jumps:5,jump:150,dmg:1.2,falloff:.9,slow:.5}},
 scale:{cd:12,r:130,dmg:1.5,push:30,slow:1.2},
 /* seal: 오행 봉인 — 한 적에게 window초 안에 서로 다른 속성 need개(보스 bossNeed개)가 쌓이면 봉인 → delay초 뒤 폭발
    dmg 폭발 피해 배율 (boss 보스) · r 주변 범위 · splash 주변 피해 비율 · marks 주변 적에게 남기는 속성 수 · refill 봉인 몇 번마다 황금 비늘 재생 */
 seal:{need:3,bossNeed:4,window:8,delay:.6,dmg:3,boss:8,r:80,splash:.5,marks:2,refill:5}};
const HW_ORDER=["zhuque","hyunmu","baekho","cheongryong"],HW_BEADS=[["#e8442a","#ffb070"],["#2f4a5a","#7fd0ff"],["#e8eef4","#ffffff"],["#2a6ac8","#9fe8ff"]];
function hwangTail(g,t,mv){const N=6,sp=mv?9:3,pts=[];
 for(let i=0;i<N;i++)pts.push([Math.round(-11-i*3.2),Math.round(6-i*1.6+Math.sin(t*sp-i*1.1)*(mv?3:2)*(.4+i*.25))]);
 for(let i=0;i<N;i++){const s=Math.round(6-i*.7);g.fillStyle="#3a2408";g.fillRect(pts[i][0]-Math.ceil(s/2)-1,pts[i][1]-Math.ceil(s/2)-1,s+2,s+2)}
 for(let i=0;i<N;i++){const s=Math.round(6-i*.7);g.fillStyle=i%2?"#c88a18":"#f0b828";g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s,s);if(i%2===0){g.fillStyle="#e8443a";g.fillRect(pts[i][0]-1,pts[i][1]-Math.ceil(s/2)-2,2,2)}}
 const tp=pts[N-1];g.fillStyle="#e8443a";g.fillRect(tp[0]-4,tp[1]-3,3,5);g.fillStyle="#ff8a4a";g.fillRect(tp[0]-5,tp[1]-1,2,3);return tp}
function hwangBlink(g,t){if((t%4.1)<.12){g.fillStyle="#f0b828";g.fillRect(-10,-12,6,6);g.fillRect(4,-12,6,6);g.fillStyle="#2a1408";g.fillRect(-10,-8,6,2);g.fillRect(4,-8,6,2)}}
// 금빛 수염 + 사신 구슬 4개 (다음에 부를 신수가 차오르며 빛나요) + 황금 비늘
function hwangExtras(g,t,mv,p){g.lineCap="round";
 for(const d of[-1,1]){const pts=[];for(let k=1;k<=5;k++)pts.push([d*(4+k*2.4),-5+Math.sin(t*4+k*.9+(d>0?1:0))*1.6+k*.7]);
  for(const [w,c] of [[2.4,"#3a2408"],[1.2,"#ffe070"]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(d*4,-5);for(const q of pts)g.lineTo(q[0],q[1]);g.stroke()}}
 const st=p&&p.evo||0,nx=p?(p.cycI||0)%4:-1,ch=p?Math.max(0,Math.min(1,1-(p.cycT==null?2.5:p.cycT)/(p.cycleCD||HWANG.cycle.cd))):0,by=(st>=2?-37:-31)+Math.sin(t*2.2)*1.5;
 HW_BEADS.forEach((c,i)=>{const x=-9+i*6,y=Math.round(by+(i===1||i===2?-2:0)),on=p&&(i===nx||(p.cycleDouble&&i===(nx+1)%4));
  if(on&&ch>0){g.save();g.globalCompositeOperation="lighter";g.globalAlpha=.15+.55*ch;g.fillStyle=c[1];g.beginPath();g.arc(x,y,3+ch*2.5,0,6.283);g.fill();g.restore()}
  g.fillStyle="#3a2408";g.fillRect(x-3,y-3,6,6);g.fillStyle=c[0];g.fillRect(x-2,y-2,4,4);g.fillStyle=c[1];g.fillRect(x-2,y-2,2,2)});
 if(p&&!p.noPassive&&p.gscale>0){const sy=Math.round(-2+Math.sin(t*3)*1.5),sx=14,fl=(Math.sin(t*5)+1)/2;
  g.fillStyle="#3a2408";g.beginPath();g.moveTo(sx,sy-6);g.lineTo(sx+5,sy-1);g.lineTo(sx,sy+5);g.lineTo(sx-5,sy-1);g.closePath();g.fill();
  g.fillStyle="#ffc830";g.beginPath();g.moveTo(sx,sy-4);g.lineTo(sx+3,sy-1);g.lineTo(sx,sy+3);g.lineTo(sx-3,sy-1);g.closePath();g.fill();
  g.fillStyle=fl>.7?"#ffffff":"#fff0a0";g.fillRect(sx-1,sy-3,2,2)}}
// 황금 기둥 (fx: pillar) — 적 발밑에서 솟아올라요
function hwPillar(x,y,r,dmg,delay,vis){const dl=(delay||0)+HWANG.pillar.delay;state.fx.push({type:"pillar",x,y,r,dmg,delay:dl,life:dl+.55,max:dl+.55,hit:false,vis:!!vis,seed:rand(0,6.283),imb:!vis&&state.p.hwImbue?HW_MARK_C[state.p.hwImbue]:null})}
function drawPillar(f){const e=f.max-f.life,x=Math.round(f.x),y=Math.round(f.y)+8;ctx.save();
 if(e<f.delay){const k=e/f.delay;ctx.globalAlpha=.6*k;ctx.fillStyle="#7a4a10";for(let i=0;i<5;i++){const a=i*1.257+f.seed;ctx.fillRect(Math.round(x+Math.cos(a)*f.r*.3*k)-1,Math.round(y+Math.sin(a)*f.r*.14*k),3,2)}ctx.restore();return}
 const u=(e-f.delay)/(f.max-f.delay),up=Math.min(1,u/.18),fade=u<.55?1:Math.max(0,1-(u-.55)/.45),w=Math.max(6,Math.round(f.r*.55)),h=Math.round(f.r*2.4*up);
 ctx.globalAlpha=fade;for(let i=0;i<6;i++){const a=i*1.047+f.seed,dd=f.r*(.45+.25*(i%2)),sx=x+Math.round(Math.cos(a)*dd),sy=y+Math.round(Math.sin(a)*dd*.45),sh=Math.round((5+(i%3)*3)*up*Math.min(1,f.r/40));
  ctx.fillStyle="#3a2408";ctx.beginPath();ctx.moveTo(sx-5,sy+2);ctx.lineTo(sx,sy-sh-2);ctx.lineTo(sx+5,sy+2);ctx.fill();ctx.fillStyle=i%2?"#c88a18":"#8a5a14";ctx.beginPath();ctx.moveTo(sx-3,sy+1);ctx.lineTo(sx,sy-sh);ctx.lineTo(sx+3,sy+1);ctx.fill()}
 ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.3*fade;ctx.fillStyle="#ffb020";ctx.fillRect(x-w/2-4,y-h,w+8,h);
 ctx.globalAlpha=.85*fade;ctx.fillStyle="#ffd54a";ctx.fillRect(x-w/2,y-h,w,h);ctx.fillStyle="#fff4c0";ctx.fillRect(x-Math.round(w/4),y-h,Math.max(2,Math.round(w/2)),h);
 ctx.globalAlpha=fade;ctx.fillStyle="#ffffff";ctx.fillRect(x-w/2,y-h-2,w,3);
 ctx.fillStyle=f.imb||"#fff0a0";for(let i=0;i<7;i++){const sx=x+((i*37+Math.round(f.seed*50))%w)-w/2,sy=y-((u*260+i*31)%(h+1));ctx.fillRect(Math.round(sx),Math.round(sy),2,2)}
 ctx.restore()}
// 오방 순환: 사신의 힘을 빌려 쓰기
function hwBorrow(id){const p=state.p;p.hwImbue={zhuque:"blaze",hyunmu:"water",baekho:"wind",cheongryong:"thunder"}[id];const B=HWANG.borrow,m=p.arrowDamage*(p.cycleMul||1),S=n=>{if(typeof audio!=="undefined")audio.sfx(n)};
 burst(p.x,p.y-8,{zhuque:"#ff8a4a",hyunmu:"#9fe4ff",baekho:"#ffffff",cheongryong:"#5ac8ff"}[id],14);
 if(id==="zhuque"){const F=B.fire,a0=rand(0,6.283);for(let i=0;i<F.n;i++){const a=a0+i*6.283/F.n;state.arrows.push({qi:true,big:0,src:"hw_fire",x:p.x+Math.cos(a)*16,y:p.y+Math.sin(a)*16-4,vx:Math.cos(a)*F.speed,vy:Math.sin(a)*F.speed,r:13,damage:m*F.dmg,pierce:F.pierce,hit:new Set(),life:F.life})}S("qi")}
 else if(id==="hyunmu"){const F=B.water,a0=rand(0,6.283);for(let i=0;i<F.n;i++){const a=a0+i*6.283/F.n;state.arrows.push({water:true,src:"hw_water",slow:F.slow,x:p.x,y:p.y-6,vx:Math.cos(a)*F.speed,vy:Math.sin(a)*F.speed,r:7,damage:m*F.dmg,pierce:F.pierce,hit:new Set(),life:F.life})}S("water")}
 else if(id==="baekho"){const F=B.wind,ts=state.enemies.filter(e=>!e.ghost&&inMap(e)).sort((a,b)=>dist2(a,p)-dist2(b,p)).slice(0,F.n);
  for(let i=0;i<F.n;i++){const e=ts[i],a=e?Math.atan2(e.y-p.y,e.x-p.x):i*6.283/F.n;state.arrows.push({wind:true,src:"hw_wind",x:p.x,y:p.y-6,vx:Math.cos(a)*F.speed,vy:Math.sin(a)*F.speed,r:10,damage:m*F.dmg,pierce:F.pierce,hit:new Set(),life:F.life})}S("claw")}
 else{const F=B.bolt;let cur=nearest();if(!cur||dist2(cur,p)>F.range**2)return;let fx=p.x,fy=p.y-20,dmg=m*F.dmg;const hit=new Set(),paths=[];
  for(let i=0;i<=F.jumps&&cur;i++){hit.add(cur);paths.push(boltPath(fx,fy,cur.x,cur.y-6));hurt(cur,dmg,"#bfefff","hw_bolt");if(!cur.boss)cur.slowT=Math.max(cur.slowT||0,F.slow);fx=cur.x;fy=cur.y-6;dmg*=F.falloff;
   let best=null,bd=F.jump*F.jump;for(const e of state.enemies){if(hit.has(e)||e.ghost||!inMap(e)||e.hp<=0)continue;const d2=(e.x-fx)**2+(e.y-fy)**2;if(d2<bd){bd=d2;best=e}}cur=best}
  state.fx.push({type:"bolt",paths,thunder:false,life:.22,max:.22});S("zap")}}
// 황금 비늘이 깨질 때: 땅울림
function hwQuake(p){const S=HWANG.scale;let n=0;
 for(const e of state.enemies){if(e.ghost||!inMap(e))continue;const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy)||1;if(d<S.r+e.r){hurt(e,p.arrowDamage*S.dmg,"#ffd54a","scale");if(!e.boss){e.x+=dx/d*S.push;e.y+=dy/d*S.push;e.slowT=Math.max(e.slowT||0,S.slow)}if(n<5){n++;hwPillar(e.x,e.y,22,0,n*.04,true)}}}
 for(const c of["#ffd54a","#fff0a0","#c88a18"])burst(p.x,p.y,c,14);state.shake=Math.max(state.shake||0,6);p.invuln=Math.max(p.invuln||0,.6);if(typeof audio!=="undefined")audio.sfx("fboom")}

// 오행 봉인: 서로 다른 속성이 한 적에게 모이면 봉인 → 폭발하며 주변 적에게 속성을 퍼뜨려 연쇄를 노릴 수 있어요
const HW_MARK_C={earth:"#e8b850",blaze:"#ff6a3a",water:"#7fd0ff",wind:"#ffffff",thunder:"#fff2a0"};
function hwMark(e,el){const S=HWANG.seal,now=state.time;(e.marks||(e.marks={}))[el]=now;if(e.sealT>0||e.hp<=0)return;let n=0;for(const k in e.marks)if(now-e.marks[k]<=S.window)n++;
 if(n>=(e.boss?S.bossNeed:Math.max(2,S.need-(state.p.sealEase||0)))){e.sealT=S.delay;e.sealMax=S.delay;e.marks={};burst(e.x,e.y-8,"#ffd54a",6);if(typeof audio!=="undefined")audio.sfx("zap")}}
function hwSealBoom(e){const p=state.p,S=HWANG.seal,ad=p.arrowDamage*(p.sealMul||1),R=S.r+(p.sealR||0);e.sealT=0;
 if(e.hp>0)hurt(e,ad*(e.boss?S.boss:S.dmg),"#ffe070","seal");
 const pool=["blaze","water","wind","thunder"];
 for(const o of state.enemies){if(o===e||o.hp<=0||o.ghost||!inMap(o))continue;if(dist2(o,e)<(R+o.r)**2){hurt(o,ad*S.dmg*S.splash,"#ffe070","seal");if(o.hp>0&&!(o.sealT>0))for(let k=0;k<S.marks;k++)(o.marks||(o.marks={}))[pool[(Math.random()*4)|0]]=state.time}}
 state.fx.push({type:"seal",x:e.x,y:e.y,r:R,life:.5,max:.5,a:rand(0,6.283)});state.shake=Math.max(state.shake||0,4);
 for(const c of ["#ffd54a","#ff6a3a","#7fd0ff","#ffffff","#5ac8ff"])burst(e.x,e.y,c,6);if(typeof audio!=="undefined")audio.sfx("thunder");
 if(e.type==="hundun"&&!(e.order>0)){e.order=HUNDUN.order;e.strikes=[];state.banner={text:tx("질서가 돌아왔다! 혼돈이 멈췄어요","Order returns! Chaos is stilled"),t:1.6};state.shake=Math.max(state.shake||0,8)}p.seals=(p.seals||0)+1;if(!p.noPassive&&p.seals%S.refill===0&&!(p.gscale>0)){p.gscale=1;p.gscaleT=0;burst(p.x+10,p.y-8,"#ffd54a",14);state.banner={text:tx("오행 봉인 → 황금 비늘 재생!","Five-Phase Seal → Golden Scale restored!"),t:1.4}}}
// 폭발: 오방색 빛줄기 5갈래
function drawSealFx(f){const k=1-f.life/f.max,fade=f.life/f.max,x=Math.round(f.x),y=Math.round(f.y)-6,L=f.r*(.3+.45*Math.min(1,k*2.5));ctx.save();ctx.globalCompositeOperation="lighter";ctx.lineCap="square";
 ["#ffd54a","#ff6a3a","#7fd0ff","#ffffff","#5ac8ff"].forEach((c,i)=>{const a=f.a+i*1.2566;for(const [w,al] of [[10,.3],[5,.95],[2,1]]){ctx.globalAlpha=al*fade;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*L,y+Math.sin(a)*L);ctx.stroke()}});
 ctx.globalAlpha=fade;ctx.fillStyle="#fff6c0";const z=Math.round(16*(1-k))+4;ctx.fillRect(x-z/2,y-z/2,z,z);ctx.globalAlpha=.5*fade;ctx.drawImage(GL.warm,x-40,y-40,80,80);ctx.restore()}
function hwangTick(dt){const p=state.p;if(!p||p.charId!=="hwangryong"||state.dead)return;const H=HWANG;
 p.cycT=(p.cycT==null?2.5:p.cycT)-dt;
 if(p.cycT<=0){const k=p.cycI||0;hwBorrow(HW_ORDER[k%4]);if(p.cycleDouble)hwBorrow(HW_ORDER[(k+1)%4]);p.cycI=(k+(p.cycleDouble?2:1))%4;if(k+(p.cycleDouble?2:1)>=4)skForm();p.cycT=p.cycleCD||H.cycle.cd}
 if(p.gscale==null)p.gscale=p.noPassive?0:1;
 if(!p.noPassive&&p.gscale<1){p.gscaleT=(p.gscaleT||0)+dt;if(p.gscaleT>=(p.gscaleCD||H.scale.cd)){p.gscaleT=0;p.gscale=1;burst(p.x+10,p.y-8,"#ffd54a",10)}}
 for(const f of state.fx){if(f.type!=="pillar"||f.hit||f.max-f.life<f.delay)continue;f.hit=true;if(f.vis)continue;
  for(const e of state.enemies){if(e.ghost||!inMap(e))continue;if(dist2(e,f)<(f.r+e.r)**2){hurt(e,f.dmg,"#ffe070","main");if(!e.boss)e.slowT=Math.max(e.slowT||0,H.pillar.slow)}}
  burst(f.x,f.y,"#ffd54a",6);burst(f.x,f.y,"#c88a18",4);state.shake=Math.max(state.shake||0,1.5);skLey(f);if(typeof audio!=="undefined")audio.sfx("boom")}}

/* ================= 기린 (빛의 영수 · 사령의 으뜸): 성광 창 · 천벌 · 은총 =================
   공격과 회복을 함께 하는 성기사. 스스로 회복한 양이 넘치면 성스러운 보호막이 돼요. */
const QI_PAL={"o":"#3a2a40","h":"#ffd54a","H":"#e8a820","E":"#ffc8d4","W":"#fff6e8","w":"#ffffff","e":"#2a1a30","n":"#c88a9a","p":"#ffa8c0","m":"#8a4a5a","M":"#ffc840","S":"#7ad8c0","s":"#c4f2e4","C":"#eaf6ff"};
const QI_BODY=[".......hh.......","..oE..ohho..Eo..",".oEEoooHHoooEEo.","oMMWWWWWWWWWWMMo","oMWWwWWWWWWwWWMo","oWWWWWWWWWWWWWWo","oWWweeWWWWweeWWo","oWWeeeWWWWeeeWWo","oWWeeeWnnWeeeWWo","oWppWmWWWWmWppWo",".oWWWWmmmmWWWWo.","..ooSWWWWWWSoo..","..MoWSsSsSsWoM..",".MMoWsSsSsSWoMM.","..MoWSssssSWoM.."];
const QI_FA=["..oCCCo..oCCCo..","..oooo....oooo..","................"],QI_FB=["...oCCCo.oCCCo..","...ooooo.oooooo.","................"];
SP.qilinA=pack([...QI_BODY,...QI_FA],QI_PAL);SP.qilinB=pack([...QI_BODY,...QI_FB],QI_PAL);
/* 수치 — 숫자만 바꿔서 조절하세요
   lance: 성광 창 (사거리 · 굵기 · 피해 배율) · smite: 천벌 (대기 · 대상 수 · 피해 배율 · 내리치기까지 · 범위 · 탐색 거리)
   grace: 은총 (보호막 최대치 = 최대 체력 비율) · brand: 낙인 찍힌 적을 잡을 때 회복량 */
const QILIN={karma:{cap:.45,base:2,per:.3,maxHit:14,heal:.25,overflow:.5,min:3},lance:{range:360,w:9,dmg:1.15},smite:{cd:4,n:2,dmg:2.2,delay:.35,r:34,seek:440},grace:{cap:.3},brand:{heal:1}};
function qilinTail(g,t,mv){const N=4,sp=mv?10:3.2,pts=[];for(let i=0;i<N;i++)pts.push([Math.round(-12-i*3.4),Math.round(5-i*2.4+Math.sin(t*sp-i*.9)*(mv?2.4:1.3)*(i+1)*.45)]);
 for(let i=0;i<N;i++){const s=Math.round(5-i*.5);g.fillStyle="#3a2a40";g.fillRect(pts[i][0]-Math.ceil(s/2)-1,pts[i][1]-Math.ceil(s/2)-1,s+2,s+2)}
 for(let i=0;i<N;i++){const s=Math.round(5-i*.5);g.fillStyle=i%2?"#7ad8c0":"#fff6e8";g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s,s)}
 const tp=pts[N-1];for(const [dx,dy,c] of [[-3,-4,"#ffc840"],[-5,-1,"#ffa8c0"],[-3,2,"#ffc840"]]){g.fillStyle="#3a2a40";g.fillRect(tp[0]+dx-1,tp[1]+dy-1,5,4);g.fillStyle=c;g.fillRect(tp[0]+dx,tp[1]+dy,3,2)}return tp}
function qilinBlink(g,t){if((t%3.6)<.12){g.fillStyle="#fff6e8";g.fillRect(-10,-12,6,6);g.fillRect(4,-12,6,6);g.fillStyle="#2a1a30";g.fillRect(-10,-8,6,2);g.fillRect(4,-8,6,2)}}
// 뿔의 반짝임 + 보호막이 있을 때 금빛으로 빛나요
function qilinExtras(g,t,mv,p){const tw=(Math.sin(t*4)+1)/2;if(p&&p.karma>0){const k=Math.min(1,p.karma/(p.maxHp*QILIN.karma.cap));g.save();g.globalCompositeOperation="lighter";g.globalAlpha=.2+.6*k*(.7+.3*Math.sin(t*(4+k*10)));g.fillStyle="#fff6c0";g.beginPath();g.arc(0,-26,2+k*6,0,6.283);g.fill();g.restore()}g.fillStyle=tw>.6?"#ffffff":"#fff0a0";g.fillRect(-1,-26,2,2);if(tw>.85){g.fillRect(-3,-25,1,1);g.fillRect(2,-25,1,1)}
 if(p&&p.holy>0){g.save();g.globalCompositeOperation="lighter";g.globalAlpha=.18+.12*Math.sin(t*5);g.drawImage(SP.qilinA.f,-16,-24);g.restore();g.fillStyle="#fff6c0";const k=Math.floor(t*6)%4;for(let i=0;i<3;i++){const a=t*2+i*2.09;g.fillRect(Math.round(Math.cos(a)*15)-1,Math.round(Math.sin(a)*8)-4,2,2)}}}
function qHeal(n){const p=state.p;if(!p||p.hp<=0)return;const miss=p.maxHp-p.hp;if(n<=miss){p.hp=p.hp+n;return}p.hp=p.maxHp;if(!p.noPassive){const cap=p.maxHp*(QILIN.grace.cap+(p.graceCap||0));const was=p.holy||0;const over=was+(n-miss)-cap;p.holy=Math.min(cap,was+(n-miss));if(over>0)p.karma=Math.min(p.maxHp*QILIN.karma.cap,(p.karma||0)+over*QILIN.karma.overflow);if(!was&&p.holy>0)burst(p.x,p.y-8,"#fff6c0",6)}}
// 성광 창: 곧게 뻗는 빛줄기 (줄 위의 적 모두 관통)
function qBeam(x,y,a,L,dmg,src,w,prism){const p=state.p,cx=Math.cos(a),cy=Math.sin(a),x2=x+cx*L,y2=y+cy*L;let first=null,fu=1e9;
 for(const e of state.enemies){if(e.ghost||!inMap(e)||e.hp<=0)continue;const u=(e.x-x)*cx+(e.y-y)*cy;if(u<-e.r||u>L+e.r)continue;const d=Math.abs((e.x-x)*cy-(e.y-y)*cx);if(d<w+e.r){hurt(e,dmg,"#fff6c0",src);if(u<fu){fu=u;first=e}}}
 state.fx.push({type:"qbeam",x1:x,y1:y,x2,y2,w,life:.2,max:.2});
 if(prism&&first){const l=skL(p,"q_prism"),N=SKN.q_prism,n=p.ev_ql?6:l>=3?4:2,sp=N.spread;for(let i=0;i<n;i++){const da=(i%2?1:-1)*sp*(1+(i>>1)*.8);qBeam(first.x,first.y,a+da,N.len,dmg*(N.dmg+N.per*(l-1)),"q_prism",w*.7,false)}}}
// 천명: 받은 피해(보호막이 막은 것 포함)와 넘친 회복이 쌓여 가득 차면, 화면의 낙인 찍힌 적 모두에게 심판이 내려요
function qMandate(){const p=state.p,K=QILIN.karma,AD=p.arrowDamage,kv=p.karma||0;p.karma=0;p.mandT=1;
 let ts=state.enemies.filter(e=>!e.ghost&&inMap(e)&&e.hp>0&&e.brandT>0&&Math.abs(e.x-p.x)<W/2+40&&Math.abs(e.y-p.y)<H/2+40);
 if(ts.length<K.min){const more=state.enemies.filter(e=>!e.ghost&&inMap(e)&&e.hp>0&&!ts.includes(e)&&dist2(e,p)<480*480).sort((a,b)=>b.hp-a.hp).slice(0,K.min-ts.length);ts=ts.concat(more)}
 const dmg=AD*Math.min(K.maxHit,K.base+kv*K.per/Math.max(1,AD));ts.forEach((e,i)=>state.fx.push({type:"qsmite",tg:e,x:e.x,y:e.y,r:30,dmg,delay:.2+i*.025,life:.55+i*.025,max:.55+i*.025,hit:false,src:"q_mandate"}));
 qHeal(kv*K.heal);p.invuln=Math.max(p.invuln||0,.8);state.flash=.6;state.flashC="#fff6c0";state.shake=Math.max(state.shake||0,6);state.banner={text:tx("천명! 하늘의 심판이 내린다","Mandate of Heaven! Judgment descends"),t:1.6};burst(p.x,p.y,"#fff6c0",30);if(typeof audio!=="undefined")audio.sfx("thunder")}
function qilinTick(dt){const p=state.p;if(!p||p.charId!=="qilin"||state.dead)return;const Q=QILIN,AD=p.arrowDamage,S=n=>{if(typeof audio!=="undefined")audio.sfx(n)};
 if(p.mandT>0)p.mandT-=dt;if((p.karma||0)>=p.maxHp*Q.karma.cap-.01&&p.hp>0)qMandate();
 // 천벌
 p.smiteT=(p.smiteT==null?2:p.smiteT)-dt;
 if(p.smiteT<=0){p.smiteT=Math.max(1.5,Q.smite.cd*(p.smiteCDm||1));const n=Q.smite.n+(p.smiteN||0);const cs=state.enemies.filter(e=>!e.ghost&&inMap(e)&&e.hp>0&&dist2(e,p)<Q.smite.seek**2).sort((a,b)=>b.hp-a.hp).slice(0,n);
  for(const e of cs)state.fx.push({type:"qsmite",tg:e,x:e.x,y:e.y,r:Q.smite.r,dmg:AD*Q.smite.dmg,delay:Q.smite.delay,life:Q.smite.delay+.35,max:Q.smite.delay+.35,hit:false,src:"q_smite"});if(cs.length)S("zap")}
 for(const f of state.fx){if(f.type!=="qsmite")continue;if(!f.hit&&f.tg&&f.tg.hp>0){f.x=f.tg.x;f.y=f.tg.y}if(f.hit||f.max-f.life<f.delay)continue;f.hit=true;
  for(const e of state.enemies){if(e.ghost||!inMap(e))continue;if(dist2(e,f)<(f.r+e.r)**2){hurt(e,f.dmg,"#fff6c0",f.src);if(p.smiteHeal)qHeal(p.smiteHeal)}}burst(f.x,f.y,"#fff6c0",8);burst(f.x,f.y,"#ffd54a",4)}
 // 축복의 종
 const lb=skL(p,"q_bell");if(lb){const N=SKN.q_bell;p.bellT=(p.bellT==null?4:p.bellT)-dt;if(p.bellT<=0){p.bellT=N.cd;qHeal(N.heal+N.per*(lb-1));for(const e of state.enemies)if(!e.ghost&&inMap(e)&&dist2(e,p)<N.r*N.r){e.brandT=ELEM.light.time}state.fx.push({type:"qbell",x:p.x,y:p.y,life:.9,max:.9});S("altar")}}
 // 수호의 빛
 if(skL(p,"q_angel")){const N=SKN.q_angel;p.angelCD=Math.max(0,(p.angelCD||0)-dt);if(p.angelCD<=0&&p.hp>0&&p.hp<p.maxHp*N.low){p.angelCD=N.cd;p.invuln=Math.max(p.invuln||0,N.inv);p.holy=p.maxHp*(QILIN.grace.cap+(p.graceCap||0));qHeal(p.maxHp*N.heal);state.flash=.5;state.flashC="#fff6c0";state.banner={text:tx("수호의 빛!","Guardian Light!"),t:1.4};burst(p.x,p.y,"#fff6c0",30);S("revive")}}
 // 천상의 문
 const lg=skL(p,"q_gate");if(lg){const N=SKN.q_gate;if(p.gateOn>0){p.gateOn-=dt;p.gateZ=(p.gateZ||0)-dt;if(p.gateZ<=0){p.gateZ=N.gap;const cs=state.enemies.filter(e=>!e.ghost&&inMap(e)&&e.hp>0&&Math.abs(e.x-p.x)<W/2&&Math.abs(e.y-p.y)<H/2);for(let i=0;i<N.n&&cs.length;i++){const e=cs.splice((Math.random()*cs.length)|0,1)[0];state.fx.push({type:"qsmite",tg:e,x:e.x,y:e.y,r:22,dmg:AD*N.dmg*(1+.4*(lg-1)),delay:.05,life:.4,max:.4,hit:false,src:"q_gate"})}}}
  else{p.gateT=(p.gateT==null?6:p.gateT)-dt;if(p.gateT<=0){p.gateT=Math.max(10,N.cd-N.per*(lg-1));p.gateOn=N.time;state.banner={text:tx("천상의 문이 열린다!","The Heavenly Gate opens!"),t:1.3};state.flash=.3;state.flashC="#fff6c0";S("revive")}}}}
function qDraw(){const p=state.p;if(!p)return;const t=state.time;ctx.save();
 for(const f of state.fx){
  if(f.type==="qbeam"){const k=f.life/f.max;ctx.save();ctx.globalCompositeOperation="lighter";ctx.lineCap="round";for(const [w,c,a] of [[f.w*2.6,"#ffd54a",.25],[f.w*1.4,"#fff0a0",.7],[Math.max(2,f.w*.5),"#ffffff",1]]){ctx.globalAlpha=a*k;ctx.strokeStyle=c;ctx.lineWidth=w*(.6+.4*k);ctx.beginPath();ctx.moveTo(f.x1,f.y1);ctx.lineTo(f.x2,f.y2);ctx.stroke()}ctx.restore()}
  else if(f.type==="qsmite"){const el=f.max-f.life,x=Math.round(f.x),y=Math.round(f.y);ctx.save();ctx.globalCompositeOperation="lighter";
   if(el<f.delay){ctx.globalAlpha=.35;ctx.fillStyle="#fff6c0";ctx.fillRect(x-1,y-260,2,256);ctx.globalAlpha=.7;ctx.fillRect(x-4,y-1,8,2);ctx.fillRect(x-1,y-4,2,8)}
   else{const k=1-(el-f.delay)/(f.max-f.delay),w=Math.round(f.r*.7*k)+2;ctx.globalAlpha=.35*k;ctx.fillStyle="#ffd54a";ctx.fillRect(x-w-4,y-280,w*2+8,280);ctx.globalAlpha=.9*k;ctx.fillStyle="#fff6c0";ctx.fillRect(x-w,y-280,w*2,280);ctx.fillStyle="#ffffff";ctx.fillRect(x-Math.ceil(w/3),y-280,Math.ceil(w/3)*2,280);ctx.globalAlpha=.6*k;ctx.drawImage(GL.warm,x-40,y-40,80,80)}ctx.restore()}
  else if(f.type==="qbell"){const k=1-f.life/f.max,fade=f.life/f.max,x=Math.round(f.x),y=Math.round(f.y)-46-Math.round(k*6),sw=Math.round(Math.sin(t*20)*3*fade);ctx.save();ctx.globalAlpha=fade;
   ctx.fillStyle="#5a3a10";ctx.fillRect(x-7+sw,y-2,14,12);ctx.fillStyle="#ffd54a";ctx.fillRect(x-6+sw,y-1,12,10);ctx.fillStyle="#fff0a0";ctx.fillRect(x-4+sw,y,3,7);ctx.fillStyle="#c88a18";ctx.fillRect(x-8+sw,y+9,16,3);ctx.fillStyle="#5a3a10";ctx.fillRect(x-1,y-5,2,3);ctx.fillRect(x-1+sw*1.4,y+12,3,3);
   for(let i=0;i<5;i++){const a=i*1.257+k*2,r=14+k*40;ctx.fillStyle=i%2?"#fff6c0":"#ffd54a";ctx.fillRect(Math.round(x+Math.cos(a)*r),Math.round(y+6+Math.sin(a)*r*.6),3,4);ctx.fillRect(Math.round(x+Math.cos(a)*r)+3,Math.round(y+6+Math.sin(a)*r*.6)-3,1,4)}ctx.restore()}}
 if(p.charId==="qilin"&&p.gateOn>0){const x=Math.round(p.x),y=Math.round(cam.y)+46,fade=Math.min(1,p.gateOn/.4);ctx.save();ctx.globalAlpha=.85*fade;ctx.fillStyle="#c83a2a";ctx.fillRect(x-70,y,6,46);ctx.fillRect(x+64,y,6,46);ctx.fillStyle="#3a2a20";ctx.fillRect(x-80,y-6,160,6);ctx.fillStyle="#ffd54a";ctx.fillRect(x-76,y-4,152,2);ctx.fillRect(x-60,y+6,120,3);
  ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.5*fade+.15*Math.sin(t*8);ctx.fillStyle="#fff6c0";ctx.fillRect(x-62,y+10,124,36);ctx.globalAlpha=.6*fade;ctx.drawImage(GL.warm,x-90,y-50,180,180);ctx.restore()}
 ctx.restore()}


/* ================= 황룡의 시련: 진화 관문 보스 =================
   황룡은 Lv20 · Lv40이 되어도 바로 진화하지 않아요. 전용 보스가 나타나고, 쓰러뜨려야 진화해요.
   1단계(Lv20) 도철 — 탐식의 흉수: 졸개를 빨아들여 먹고 커져요. 삼킴 패턴 동안 졸개를 먼저 처치하세요.
   2단계(Lv40) 혼돈 — 형체 없는 혼돈: 속성이 계속 바뀌며 공격이 달라져요. 받는 피해가 적지만,
                   오행 봉인에 걸리면 '질서'가 돌아와 3초 기절 · 받는 피해 2배.
   수치 — 숫자만 바꿔서 조절하세요 */
const HWGATE={1:{type:"taotie",hp:900,r:30,speed:50,damage:22,color:"#6a9a6a"},2:{type:"hundun",hp:2400,r:30,speed:58,damage:26,color:"#e0a040"}};
const TAOTIE={eatMax:6,pull:70,pullPh2:100,feed:180,eatHeal:.015,grow:1,growMax:10,biteSpeed:480,spit:7,spitDmg:14,minions:6,minionHp:4};
const HUNDUN={aspectT:7,aspectT2:4.5,taken:.6,order:3,orderMul:2,strikeWarn:.9,strikeR:34,strikeDmg:22,rockR:46,rockDmg:26};
const HD_ASP=["blaze","water","wind","thunder","earth"],HD_COL={blaze:"#ff6a3a",water:"#5ac8ff",wind:"#e8f4ff",thunder:"#fff2a0",earth:"#e8b850"};
function gateHitP(dmg,col){const p=state.p;if(p.invuln>0)return;p.hp-=dmg*(p.guard||1);p.invuln=.8;burst(p.x,p.y,col||"#ffffff",10);if(p.hp<=0){p.hp=0;die()}}
function hwGateCheck(){const p=state.p;if(!p||p.charId!=="hwangryong"||state.dead)return;const T=CHAR_EVO.hwangryong,i=(p.evo||0)+1;if(i>2||state.level<T[i].lv||state.hwGate===i)return;
 state.hwGate=i;state.hwGateWait=1.6;state.banner={text:tx(`황룡의 시련! ${bossName(HWGATE[i].type)}을(를) 쓰러뜨려야 진화할 수 있어요`,`Trial of Hwangryong! Defeat ${bossName(HWGATE[i].type)} to evolve`),t:3.2}}
function hwGateTick(dt){const p=state.p;if(!p||p.charId!=="hwangryong"||state.dead||state.win)return;hwGateCheck();const i=state.hwGate;if(!i)return;
 if(state.enemies.some(e=>e.gate))return;if(state.hwGateWait>0){state.hwGateWait-=dt;return}if(state.enemies.some(e=>e.boss))return;
 const G=HWGATE[i],hp=Math.round(G.hp*(state.mode==="tower"?1+(state.floor||1)*.02:1));
 state.enemies.push({x:cam.x+W/2,y:cam.y-60,type:G.type,boss:true,gate:true,gateStage:i,n:i*2,ph:0,r:G.r,speed:G.speed,damage:G.damage,hp,maxHp:hp,color:G.color,hit:0,bladeCD:0,cd:2,mode:"enter",sk:0,face:1,asp:0,aspT:HUNDUN.aspectT,strikes:[]});
 state.banner={text:`${tx("황룡의 시련","TRIAL")} · ${bossName(G.type)}`,t:3};state.shake=Math.max(state.shake||0,8);state.flash=.4;state.flashC=i===1?"#6a9a6a":"#e0a040";if(typeof audio!=="undefined")audio.sfx("boss");
 setTimeout(()=>{if(state&&state.enemies.some(e=>e.gate))state.banner={text:i===1?tx("도철은 졸개를 삼켜 강해져요. 삼키기 전에 졸개를 처치하세요!","Taotie grows by devouring minions — clear them before it feeds!"):tx("혼돈은 오행 봉인에 걸려야 질서를 되찾아요! (기절 · 받는 피해 2배)","Only a Five-Phase Seal restores order to Chaos! (stun · double damage)"),t:3.2}},3200)}
function hwGateWin(e){const p=state.p;state.hwGate=0;if(p.charId==="hwangryong"&&(p.evo||0)<e.gateStage){charEvolve(e.gateStage);state.flash=.9;state.flashC="#ffd54a"}}
// ---- 도철 ----
function taotieAI(e,dt,ux,uy){const p=state.p,T=TAOTIE,d=Math.hypot(p.x-e.x,p.y-e.y);e.face=p.x>e.x?1:-1;
 if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.speed*=1.25;state.banner={text:tx("도철이 굶주림에 날뛴다!","Taotie rages with hunger!"),t:2};burst(e.x,e.y,"#c8a04a",30)}
 const m=e.mode;
 if(m==="enter"){e.y+=80*dt;if(e.cd<=0||e.y>cam.y+130){e.mode="chase";e.cd=1.5}return}
 if(m==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
  if(e.cd<=0){const L=e.ph2?["devour","bite","spit","summon","bite","devour","spit"]:["summon","devour","bite","spit","bite"],k=L[e.sk++%L.length];
   if(k==="devour"){e.mode="devour";e.cd=e.ph2?3:2.4;state.banner={text:tx("도철이 모든 것을 삼키려 한다!","Taotie tries to swallow everything!"),t:1.4};if(typeof audio!=="undefined")audio.sfx("wave")}
   else if(k==="bite"){e.mode="aim";e.cd=.7}
   else if(k==="spit"){const n=T.spit+(e.ph2?4:0),a0=Math.atan2(uy,ux);for(let v=0;v<(e.ph2?2:1);v++)for(let i=0;i<n;i++){const a=a0+(i-(n-1)/2)*.17,sp=190+v*60;state.eb.push({x:e.x+ux*20,y:e.y+uy*20,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:5,life:4,dmg:T.spitDmg,c:"#e8e0c0"})}e.cd=1.8;burst(e.x,e.y,"#e8e0c0",10)}
   else{for(let i=0;i<T.minions;i++){const a=i*6.283/T.minions+e.t,mm=minion(e.x+Math.cos(a)*90,e.y+Math.sin(a)*90);mm.hp=mm.maxHp=T.minionHp;mm.feed=true;mm.color="#c8a0a0";state.enemies.push(mm)}burst(e.x,e.y,"#9aa0ac",16);e.cd=1.6}}}
 else if(m==="devour"){const pull=e.ph2?T.pullPh2:T.pull,mx=e.x+e.face*e.r*.6,my=e.y+4;
  if(d>e.r){p.x+=(e.x-p.x)/d*pull*dt;p.y+=(e.y-p.y)/d*pull*dt}
  let eaten=0;const keep=[];for(const o of state.enemies){if(o===e||o.boss||o.type==="lantern"||o.ghost||!o.feed){keep.push(o);continue}const dx=mx-o.x,dy=my-o.y,dd=Math.hypot(dx,dy)||1;if(dd<300){if(dd<e.r+12&&(e.ate||0)+eaten<TAOTIE.eatMax){eaten++;continue}o.x+=dx/dd*T.feed*dt;o.y+=dy/dd*T.feed*dt}keep.push(o)}
  if(eaten){e.ate=(e.ate||0)+eaten;state.enemies=keep;e.hp=Math.min(e.maxHp,e.hp+e.maxHp*T.eatHeal*eaten);e.grow=Math.min(T.growMax,(e.grow||0)+T.grow*eaten);e.r=HWGATE[1].r+e.grow;e.damage=HWGATE[1].damage+e.grow;burst(mx,my,"#c8302a",8*eaten)}
  if(Math.random()<dt*30)state.particles.push({x:mx+rand(-120,120),y:my+rand(-90,90),vx:0,vy:0,life:.3,max:.3,color:"#c8e0c8",size:2,suck:{x:mx,y:my}});
  if(e.cd<=0){e.mode="chase";e.cd=1.2;e.ate=0}}
 else if(m==="aim"){e.ax=ux;e.ay=uy;if(e.cd<=0){e.mode="bite";e.cd=.45;if(typeof audio!=="undefined")audio.sfx("dash")}}
 else if(m==="bite"){e.x=clamp(e.x+e.ax*TAOTIE.biteSpeed*dt,30,WW-30);e.y=clamp(e.y+e.ay*TAOTIE.biteSpeed*dt,50,WH-30);if(e.cd<=0){e.mode="chase";e.cd=1.4}}
 e.x=clamp(e.x,30,WW-30);e.y=clamp(e.y,50,WH-30)}
function drawTaotie(e,cx){const ctx=cx||canvas.getContext("2d"),t=state?state.time:performance.now()/1000,hit=e.hit>0,C=c=>hit?"#fff4d8":c,S=e.r/30,open=e.mode==="devour"?1:e.mode==="bite"||e.mode==="aim"?.6:.18+.06*Math.sin(t*3),x=Math.round(e.x),y=Math.round(e.y),f=e.face||1;
 ctx.save();ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.fillRect(x-34*S,y+22*S,68*S,8*S);ctx.globalAlpha=1;ctx.translate(x,y);ctx.scale(S*f,S);const R=(a,b,w,h,c)=>{ctx.fillStyle=C(c);ctx.fillRect(a,b,w,h)};
 const lg=Math.sin(t*(e.mode==="chase"?8:2))*2;for(const [lx,ph] of [[-26,0],[-12,1],[10,1],[22,0]]){R(lx-1,12,10,13+(ph?lg:-lg),"#14201a");R(lx,12,8,12+(ph?lg:-lg),"#3a5a44");R(lx-1,23+(ph?lg:-lg),10,3,"#d8c890")}
 R(-36,-24,72,42,"#14201a");R(-34,-22,68,38,"#3e6a4e");R(-34,-22,68,6,"#5a8a64");R(-34,10,68,6,"#2e5040");
 for(const sx of [-1,1]){for(const [a,b,w,h] of [[-30,-12,10,2],[-30,-12,2,10],[-30,-4,6,2],[-26,-10,2,6],[-26,-10,4,2]])R(sx<0?a:-a-w,b,w,h,"#c8a04a")}
 for(const sx of [-1,1]){for(let k=0;k<7;k++){const hx=sx*(14+k*3.2),hy=-24-k*3.4+k*k*.42;R(Math.round(hx)-3,Math.round(hy)-3,7,7,"#3a2a10");R(Math.round(hx)-2,Math.round(hy)-2,5,5,k>4?"#fff0c0":"#e0b050")}}
 const ex=Math.round(Math.max(-1,Math.min(1,((state&&state.p?state.p.x:e.x+60)-e.x)*f/200))*2);for(const sx of [-12,12]){R(sx-6,-16,12,9,"#14201a");R(sx-5,-15,10,7,"#ffd54a");R(sx-1+ex,-14,3,5,"#c8202a");R(sx-4,-15,2,2,"#ffffff")}
 const mh=Math.round(4+open*20);R(-22,0,44,mh+2,"#14201a");R(-20,1,40,mh,"#5a0a14");if(open>.5){R(-14,3,28,mh-6,"#2a0408")}for(let k=0;k<6;k++){R(-18+k*7,1,4,4,"#f4ecd8");R(-18+k*7+2,mh-3,4,4,"#f4ecd8")}
 if(e.ph2){ctx.globalAlpha=.5+.3*Math.sin(t*10);R(-34,-22,68,2,"#ff4a3a");ctx.globalAlpha=1}
 ctx.restore()}
// ---- 혼돈 ----
function hundunAI(e,dt,ux,uy){const p=state.p,H=HUNDUN,d=Math.hypot(p.x-e.x,p.y-e.y);
 if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.speed*=1.2;state.banner={text:tx("혼돈이 더욱 요동친다!","Chaos churns even wilder!"),t:2}}
 if(e.order>0){e.order-=dt;e.stunT=e.order;return}
 e.aspT-=dt;if(e.aspT<=0){e.asp=(e.asp+1)%HD_ASP.length;e.aspT=e.ph2?H.aspectT2:H.aspectT;burst(e.x,e.y,HD_COL[HD_ASP[e.asp]],18);e.cd=Math.min(e.cd,.6)}
 for(const s2 of e.strikes){s2.t-=dt;if(s2.t<=0&&!s2.done){s2.done=true;s2.fl=.25;if(Math.hypot(p.x-s2.x,p.y-s2.y)<s2.r+p.r)gateHitP(s2.dmg,s2.c);burst(s2.x,s2.y,s2.c,10);if(typeof audio!=="undefined")audio.sfx(s2.rock?"boom":"thunder")}if(s2.fl>0)s2.fl-=dt}
 e.strikes=e.strikes.filter(s2=>!s2.done||s2.fl>0);
 const m=e.mode,A=HD_ASP[e.asp];
 if(m==="enter"){e.y+=80*dt;if(e.cd<=0||e.y>cam.y+130){e.mode="chase";e.cd=1.5}return}
 if(m==="dash"){e.x=clamp(e.x+e.ax*460*dt,30,WW-30);e.y=clamp(e.y+e.ay*460*dt,50,WH-30);if(e.cd<=0){e.dn=(e.dn||0)-1;if(e.dn>0){e.ax=ux;e.ay=uy;e.cd=.35}else{e.mode="chase";e.cd=1.6}}return}
 const want=d>170?1:d<110?-.6:.2;e.x+=(ux*want-uy*.4)*e.speed*dt;e.y+=(uy*want+ux*.4)*e.speed*dt;e.x=clamp(e.x,30,WW-30);e.y=clamp(e.y,50,WH-30);
 if(e.cd>0)return;const reps=e.ph2?2:1;
 for(let rr=0;rr<reps;rr++){
 if(A==="blaze"){const n=16,o=rand(0,.4);for(let i=0;i<n;i++){const a=o+i*6.283/n;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*(150+rr*50),vy:Math.sin(a)*(150+rr*50),r:6,life:4,dmg:15,c:"#ff6a3a"})}e.cd=1.9}
 else if(A==="water"){for(let i=0;i<5;i++){const a=i*1.257+e.t;state.eb.push({x:e.x+Math.cos(a)*24,y:e.y+Math.sin(a)*24,vx:Math.cos(a)*110,vy:Math.sin(a)*110,r:7,life:5,home:2.4,dmg:13,c:"#5ac8ff"})}e.cd=2.4}
 else if(A==="wind"){e.mode="dash";e.ax=ux;e.ay=uy;e.cd=.4;e.dn=3;if(typeof audio!=="undefined")audio.sfx("dash");break}
 else if(A==="thunder"){for(let i=0;i<5;i++){const a=rand(0,6.283),r=i?rand(30,120):0;e.strikes.push({x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r,r:H.strikeR,t:H.strikeWarn+i*.08,max:H.strikeWarn,dmg:H.strikeDmg,c:"#fff2a0"})}e.cd=2.2}
 else{for(let i=0;i<3;i++){const a=rand(0,6.283),r=i?rand(40,140):0;e.strikes.push({x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r,r:H.rockR,t:1.1+i*.15,max:1.1,dmg:H.rockDmg,c:"#e8b850",rock:true})}e.cd=2.6}}}
function drawHundun(e,cx){const ctx=cx||canvas.getContext("2d"),t=state?state.time:performance.now()/1000,hit=e.hit>0,A=HD_ASP[e.asp||0],AC=HD_COL[A],C=c=>hit?"#fff4d8":c,x=Math.round(e.x),y=Math.round(e.y),S=e.r/30,ord=e.order>0;
 for(const s2 of e.strikes||[]){if(!s2.done){const k=Math.max(0,Math.min(1,1-Math.max(0,s2.t)/s2.max));ctx.save();ctx.globalAlpha=.18+.3*k;ctx.fillStyle=s2.c;ctx.beginPath();ctx.ellipse(s2.x,s2.y,s2.r,s2.r*.6,0,0,6.283);ctx.fill();ctx.globalAlpha=.8;ctx.strokeStyle=s2.c;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(s2.x,s2.y,s2.r*k,s2.r*.6*k,0,0,6.283);ctx.stroke();if(s2.rock&&k>.5){ctx.fillStyle="#6a5a3a";const fy=s2.y-(1-k)*200;ctx.fillRect(s2.x-8,fy-10,16,14);ctx.fillStyle="#9a8a5a";ctx.fillRect(s2.x-6,fy-9,8,5)}ctx.restore()}
  else if(s2.fl>0){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=s2.fl*3;if(!s2.rock){ctx.fillStyle="#fff6c0";ctx.fillRect(s2.x-4,s2.y-300,8,300)}ctx.fillStyle=s2.c;ctx.beginPath();ctx.ellipse(s2.x,s2.y,s2.r,s2.r*.6,0,0,6.283);ctx.fill();ctx.restore()}}
 ctx.save();ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.fillRect(x-30*S,y+22*S,60*S,7*S);ctx.globalAlpha=1;ctx.translate(x,y+(ord?0:Math.round(Math.sin(t*2)*3)));ctx.scale(S,S);const R=(a,b,w,h,c)=>{ctx.fillStyle=C(c);ctx.fillRect(a,b,w,h)};
 const fl=ord?0:Math.sin(t*9)*6;ctx.globalAlpha=.55;for(const [sx,yo,len] of [[-1,-14,30],[-1,-2,24],[1,-14,30],[1,-2,24]]){ctx.fillStyle=C(AC);ctx.beginPath();ctx.moveTo(sx*14,yo);ctx.lineTo(sx*(14+len),yo-10-fl*(yo<-6?1:.6));ctx.lineTo(sx*(14+len*.8),yo+8);ctx.closePath();ctx.fill()}ctx.globalAlpha=1;
 for(let i=0;i<6;i++){const sx=i<3?-1:1,k=i%3,lx=sx*(6+k*8),sw=ord?0:Math.sin(t*10+i*1.3)*3;ctx.strokeStyle=C("#3a1a10");ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(lx,12);ctx.lineTo(lx+sx*6+sw,22);ctx.lineTo(lx+sx*8+sw,30);ctx.stroke()}
 R(-26,-22,52,40,"#3a1a10");R(-24,-24,48,4,"#3a1a10");R(-24,-20,48,36,ord?"#c8c0b0":"#d89a3a");R(-22,-22,44,6,ord?"#e8e0d0":"#f0c060");R(-24,10,48,6,ord?"#9a9488":"#b86a2a");
 if(!ord){ctx.globalAlpha=.45+.2*Math.sin(t*4);R(-24,-20,48,36,AC);ctx.globalAlpha=1;for(let k=0;k<10;k++){const a=t*3+k*.63,r=4+k*1.3;R(Math.round(Math.cos(a)*r)-1,Math.round(Math.sin(a)*r*.8)-3,2,2,k%2?"#2a0a10":"#5a1a20")}}
 else{R(-6,-6,4,3,"#3a1a10");R(4,-6,4,3,"#3a1a10");R(-4,4,8,2,"#3a1a10")}
 ctx.restore();
 if(ord){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.6;["#ffd54a","#ff6a3a","#7fd0ff","#ffffff","#5ac8ff"].forEach((c,i)=>{const a=t*3+i*1.2566;ctx.fillStyle=c;ctx.fillRect(Math.round(x+Math.cos(a)*36)-2,Math.round(y-10+Math.sin(a)*20)-2,4,4)});ctx.restore()}}
/* ================= 사신 진화 (Lv20 · Lv40) — 주작 · 현무 · 백호 · 청룡 · 황룡 · 기린 =================
   이그니(IGN_EVO)와 같은 기준: 스탯 +체력 30/50 · 공격력 ×1.2/×1.25 · 이동 +5%/+5% · (2단계) 흡수 범위 +15%
   pal: 기본 팔레트에서 바뀌는 색 · scale: 크기 · skill: 단계별 고유 강화 · acc: 머리 장식 등 추가 그림 */
const SMALL_CROWN=pack(["y.y.y.y","yyyyyyy","yrryrry","ooooooo"],{y:"#ffd54a",r:"#5ac8ff",o:"#7a5a1a"});
const CHAR_EVO={
 zhuque:[null,
  {lv:20,name:"불꽃 주작",nameEn:"Blazing Zhuque",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{R:"#ff5a2a",r:"#ffa060",Y:"#ffe04a",y:"#fffbd0",K:"#ffc23a"},wing:1.12,
   desc:"검기가 1.3배 커지고 관통 +2",descEn:"Sword waves 1.3× larger · pierce +2",skill:p=>{p.qiBig=1.3;p.arrowPierce+=2}},
  {lv:40,name:"태양 주작",nameEn:"Solar Zhuque",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{R:"#ff6a3a",r:"#ffb070",D:"#d83a20",Y:"#ffd54a",y:"#ffffff",K:"#ffd54a",k:"#fff2a8"},wing:1.25,
   desc:"검기를 세 갈래로 날리고 깃털 +1",descEn:"Sword waves fire in three directions · feathers +1",skill:p=>{p.qiSpread=true;p.feathers=Math.min(FEATHER_MAX,(p.feathers||0)+1)}}],
 hyunmu:[null,
  {lv:20,name:"청동 현무",nameEn:"Bronze Hyunmu",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{K:"#4a8a6a",k:"#346a54",S:"#1e4a4a",s:"#2f6a6a",h:"#6ac0b0"},shell:["#0c1418","#1e4a4a","#2f6a6a","#6ac0b0"],
   desc:"채찍 사거리 +20 · 결계 +1",descEn:"Whip reach +20 · barrier +1",skill:p=>{p.whipLen=(p.whipLen||96)+20;p.barMax=(p.barMax||2)+1;p.bar=Math.min(p.barMax,(p.bar||0)+1)}},
  {lv:40,name:"옥빛 현무",nameEn:"Jade Hyunmu",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{K:"#5aa880",k:"#3a8060",S:"#2a6a5a",s:"#3a9a80",h:"#9fe8d0",P:"#f0e0a0",r:"#c8a860"},shell:["#0c1418","#2a6a5a","#3a9a80","#9fe8d0"],
   desc:"채찍에 맞은 적이 느려지고 반격 피해 ×2 · 결계 충전 20% 빠르게",descEn:"Whip hits slow foes · counter damage ×2 · barrier recharges 20% faster",skill:p=>{p.tide=true;p.counter=(p.counter||2)*2;p.barCD=Math.max(2.5,(p.barCD||6)*.8)}}],
 baekho:[null,
  {lv:20,name:"푸른바람 백호",nameEn:"Bluewind Baekho",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{K:"#3a5a9a",E:"#ffc0d0"},
   desc:"발톱 사거리 +12 · 돌진 대기 -20%",descEn:"Claw reach +12 · dash cooldown -20%",skill:p=>{p.clawReach=(p.clawReach||BAEKHO.claw.reach)+12;p.dashCD=Math.max(1.2,(p.dashCD||BAEKHO.dash.cd)*.8)}},
  {lv:40,name:"은월 백호",nameEn:"Silvermoon Baekho",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{K:"#5a6ac8",E:"#ffd0e0",W:"#ffffff",B:"#fff6e0"},
   desc:"발톱이 두 번 할퀴고 (두 번째 60%) · 돌진 피해 +2",descEn:"Claws strike twice (second hit 60%) · dash damage +2",skill:p=>{p.claw2=true;p.dashDmg=(p.dashDmg||0)+2}}],
 cheongryong:[null,
  {lv:20,name:"푸른 비늘 청룡",nameEn:"Azurescale Cheongryong",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{B:"#3a9ae8",b:"#8ad0ff",g:"#7affe0",h:"#ffd870"},
   desc:"번개 튕김 +1 · 비구름 반경 +20",descEn:"Lightning bounces +1 · rain radius +20",skill:p=>{p.chainJumps=(p.chainJumps||0)+1;p.rainR=(p.rainR||CHEONG.rain.r)+20}},
  {lv:40,name:"천룡",nameEn:"Heavenly Cheongryong",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{B:"#4aa8f0",b:"#9fdcff",D:"#2a6ac0",g:"#aaffee",G:"#5ae0c0",h:"#ffe680",s:"#fffbe0"},
   desc:"여의주가 6번마다 천둥 · 번개가 덜 약해짐 · 비구름 대기 -25%",descEn:"Thunder every 6 attacks · less falloff per bounce · rain cooldown -25%",skill:p=>{p.pearlEvery=6;p.falloff=.92;p.rainCD=Math.max(3,(p.rainCD||CHEONG.rain.cd)*.75)}}],
 hwangryong:[null,
  {lv:20,name:"황금비늘 황룡",nameEn:"Goldscale Hwangryong",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{Y:"#ffc830",y:"#fff0a0",M:"#ff5a3a",j:"#9affea"},
   desc:"황금 기둥 반경 +10 · 사신 부르기 대기 -20%",descEn:"Golden pillar radius +10 · guardian summon cooldown -20%",skill:p=>{p.pillarR=(p.pillarR||HWANG.pillar.r)+10;p.cycleCD=Math.max(2,(p.cycleCD||HWANG.cycle.cd)*.8)}},
  {lv:40,name:"오방 황룡",nameEn:"Five-Realm Hwangryong",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{Y:"#ffd848",y:"#fffbe0",D:"#e0a020",M:"#ff6a4a",s:"#fffbe8",h:"#ffb080",j:"#ffffff"},
   desc:"사신 둘을 한꺼번에 불러요 · 황금 기둥 +1 · 황금 비늘 충전 -25%",descEn:"Summons two guardians at once · golden pillars +1 · golden scale recharges 25% faster",skill:p=>{p.cycleDouble=true;p.pillarExtra=(p.pillarExtra||0)+1;p.gscaleCD=Math.max(4,(p.gscaleCD||HWANG.scale.cd)*.75)}}],
 qilin:[null,
  {lv:20,name:"빛뿔 기린",nameEn:"Radiant-horn Qilin",scale:1.1,hp:30,atk:1.2,spd:1.05,pick:1,pal:{W:"#fffaf0",M:"#ffd860",S:"#8ae8d8",h:"#fff0a0"},
   desc:"천벌 대상 +1 · 성광 창 굵기 +4",descEn:"Smite targets +1 · lance width +4",skill:p=>{p.smiteN=(p.smiteN||0)+1;p.lanceW=(p.lanceW||0)+4}},
  {lv:40,name:"천상 기린",nameEn:"Celestial Qilin",scale:1.18,hp:50,atk:1.25,spd:1.05,pick:1.15,pal:{W:"#ffffff",M:"#ffe890",S:"#a8f4ec",s:"#e8fff8",C:"#ffffff",h:"#ffffff",H:"#ffd54a",E:"#ffd8e8"},
   desc:"천벌이 맞힐 때마다 체력 +1 · 보호막 최대치 +20% · 성광 창 사거리 +60",descEn:"Each Smite hit heals 1 · shield cap +20% · lance range +60",skill:p=>{p.smiteHeal=(p.smiteHeal||0)+1;p.graceCap=(p.graceCap||0)+.2;p.lanceLen=(p.lanceLen||0)+60}}]};
{const SRC={zhuque:[ZHU_BODY,ZHU_A,ZHU_B,ZHU_PAL],hyunmu:[HYUN_BODY,HYUN_A,HYUN_B,HYUN_PAL],baekho:[BAEKHO_BODY,BAEKHO_FA,BAEKHO_FB,BAEKHO_PAL],cheongryong:[CHEONG_BODY,CHEONG_FA,CHEONG_FB,CHEONG_PAL],hwangryong:[HW_BODY,HW_FA,HW_FB,HW_PAL],qilin:[QI_BODY,QI_FA,QI_FB,QI_PAL]};
 for(const id in CHAR_EVO){const [B,FA,FB,PAL]=SRC[id];for(let i=1;i<3;i++){const E=CHAR_EVO[id][i],pl={...PAL,...E.pal};E.A=pack([...B,...FA],pl);E.B=pack([...B,...FB],pl)}}}
// 머리 장식 등 (스프라이트 좌표: 왼쪽 위 -16,-24 · 한 칸 2px)
function evoAcc(g,t,mv,p,id,st){const gold="#ffd54a",lite="#fff6c0",ol="#7a5a1a";
 if(id==="zhuque"){if(st>=2){g.drawImage(SP.crown.n,-10,-34)}
  else for(const [x,h] of [[-5,8],[-1,11],[3,8]]){g.fillStyle=ol;g.fillRect(x-1,-24-h-1,4,h+2);g.fillStyle=gold;g.fillRect(x,-24-h,2,h);g.fillStyle=lite;g.fillRect(x,-24-h,2,2)}}
 if(id==="hyunmu"){if(st>=2){for(const [x,h,d] of [[-6,7,-1],[0,10,0],[6,7,1]]){g.fillStyle="#7a2a3a";g.fillRect(x-1,-23-h,3,h+1);g.fillStyle="#ff8aa0";g.fillRect(x,-22-h,2,h);g.fillRect(x+d*2,-20-h,2,2);g.fillStyle="#ffd0d8";g.fillRect(x,-22-h,2,2)}g.drawImage(SMALL_CROWN.n,-7,-28)}
  else{g.fillStyle=ol;g.fillRect(-9,-23,18,4);g.fillStyle=gold;g.fillRect(-8,-22,16,2);g.fillStyle="#5ac8ff";g.fillRect(-1,-23,2,4)}}
 if(id==="baekho"){const sw=Math.sin(t*(mv?12:4));g.fillStyle="#7a1a1a";g.fillRect(-10,-1,20,5);g.fillStyle="#e8443a";g.fillRect(-9,0,18,3);g.fillStyle="#ff8a6a";g.fillRect(-9,0,18,1);
  g.fillStyle="#e8443a";g.fillRect(-14,1+Math.round(sw),5,3);g.fillRect(-18,3+Math.round(sw*1.6),4,3);
  if(st>=2){g.drawImage(SMALL_CROWN.n,-7,-29);g.fillStyle=gold;g.fillRect(-2,-19,4,2);g.fillRect(-3,-18,2,2);g.fillStyle=lite;g.fillRect(-1,-19,2,1)}}
 if(id==="cheongryong"){for(const d of[-1,1]){g.fillStyle=ol;g.fillRect(d<0?-13:9,-31,4,8);g.fillStyle=gold;g.fillRect(d<0?-12:10,-30,2,7);g.fillRect(d<0?-15:12,-28,3,2);g.fillStyle=lite;g.fillRect(d<0?-12:10,-30,2,2)}
  g.globalAlpha=.85;for(const [x,r] of [[-9,4],[-3,5],[4,5],[10,4]]){g.fillStyle="#e8f4ff";g.beginPath();g.arc(x,12,r,0,6.283);g.fill()}g.globalAlpha=1;
  if(st>=2)g.drawImage(SMALL_CROWN.n,-7,-30)}
 if(id==="hwangryong"){if(st>=2){g.drawImage(HW_CROWN.n,-7,-30);g.globalAlpha=.85;for(const [x,r] of [[-9,4],[-3,5],[4,5],[10,4]]){g.fillStyle="#fff0b0";g.beginPath();g.arc(x,12,r,0,6.283);g.fill()}g.globalAlpha=1}
  else for(const [x,h] of [[-4,5],[-1,7],[2,5]]){g.fillStyle="#7a2a1a";g.fillRect(x-1,-20-h-1,4,h+2);g.fillStyle="#ff7a4a";g.fillRect(x,-20-h,2,h);g.fillStyle="#ffd0a0";g.fillRect(x,-20-h,2,2)}}
 if(id==="qilin"){const by=-31+Math.round(Math.sin(t*2.4));g.fillStyle="#7a5a1a";g.fillRect(-9,by-1,18,4);g.fillStyle=st>=2?"#fff0a0":"#ffd54a";g.fillRect(-8,by,16,2);g.fillStyle="#ffffff";g.fillRect(-3,by,3,1);
  if(st>=2){g.globalAlpha=.85;for(const [x,r] of [[-9,4],[-3,5],[4,5],[10,4]]){g.fillStyle="#f4f8ff";g.beginPath();g.arc(x,12,r,0,6.283);g.fill()}g.globalAlpha=1;for(const [x,y] of [[-6,-2],[5,-4],[0,4]]){g.fillStyle="#ffd54a";g.fillRect(x,y,2,2);g.fillRect(x-1,y+1,4,0+1)}}}}
function charEvolve(st){const p=state.p,E=CHAR_EVO[p.charId][st],c=chars.get(p.charId);p.evo=st;
 p.maxHp+=E.hp;p.hp=Math.min(p.maxHp,p.hp+E.hp);p.dmgMul=(p.dmgMul||1)*E.atk;p.speed*=E.spd;p.pickup*=E.pick;p.invuln=Math.max(p.invuln||0,1.5);E.skill(p);
 state.flash=.7;state.flashC="#ffd54a";state.shake=Math.max(state.shake||0,10);
 for(const col of["#ffd54a","#fff0b0","#ffffff","#9fe8ff"])burst(p.x,p.y,col,24);
 state.banner={text:tx(`진화! ${c?c.name:""} → ${E.name}`,`Evolved! ${c?c.nameEn:""} → ${E.nameEn}`),t:3.2};
 if(typeof audio!=="undefined")audio.sfx("revive");hud();if(st>=2&&!dbg.on)rec.evo40(p.charId)}
/* ===== 원거리 몹 2종 + N45 보스 스프라이트 ===== */
const TOAD_PAL={"o":"#0e1a22","G":"#5a9ab8","g":"#3a7090","W":"#e8f8ff","e":"#0e1a22","m":"#1e3a4a"};
const TOAD=["..oo......oo..", ".oWWo....oWWo.", ".oWeo....oeWo.", "oGGGGGGGGGGGGo", "oGGgGGGGGGgGGo", "oGGGGGGGGGGGGo", "oGGmmmmmmmmGGo", ".oGGGGGGGGGGo.", ".oGo.oGGo.oGo.", "..o...oo...o.."];
const WISP_PAL={"o":"#1a0a2a","F":"#9a5ae0","f":"#c89aff","w":"#ffffff","e":"#2a0a3a","m":"#5a2a8a"};
const WISP=["....o.....", "...oFo..o.", "..oFFo.oFo", "..oFFFoFFo", ".oFFFFFFFo", ".oFffffFFo", "oFFweFweFo", "oFFeeFeeFo", "oFFFFFFFFo", ".oFFmmFFo.", "..oFFFFo..", "...oooo..."];
const WITCH_PAL={"o":"#14081e","H":"#3a1c5a","h":"#5a3a8a","f":"#d8d0f0","e":"#7affe0","m":"#2a1040","C":"#2a1446","c":"#4a2a78","g":"#7affe0"};
const WITCH_ROWS=["......oooo......", ".....oHHHHo.....", "....oHHHHHHo....", "...oHHhHHHHHo...", "...oHHffffHHo...", "..oHHfeffefHHo..", "..oHHffffffHHo..", "..oHHHfmmfHHHo..", ".oHHHHHffHHHHHo.", ".oCCHHHHHHHHCCo.", "oCCCCHHHHHHCCCCo", "oCCcCCCCCCCCcCCo", "oCCcCCCCCCCCcCCo", ".oCCcCCCCCCcCCo.", ".oCCcCCggCCcCCo.", "..oCCCCggCCCCo..", "..oCcCCCCCCcCo..", "...oCcCCCCcCo...", "...o.oCo.oCo.o..", ".....o.o..o....."];

/* ===== 맵 전용 몹 스프라이트 ===== */
SP.shroom=pack(["....oooooo....","..ooCCCCCCoo..",".oCCwCCCCCwCo.","oCCwwCCCCCCCCo","oCCCCCCCwwCCCo","oCCCCCCCwCCCCo","ooccccccccccoo","..oSSSSSSSSo..","..oSeSSSSeSo..","..oSeSSSSeSo..","..oSSSmmSSSo..","..oSSSSSSSSo..","...oSSSSSSo...","....oo..oo...."],{o:"#1a1408",C:"#3fc8a8",w:"#c8fff0",c:"#1f6a5a",S:"#e8dcc0",e:"#1a1408",m:"#8a5a4a"});
SP.newt=pack(["..........oooo..",".........oRRwRo.","o...YY..oRRReRRo","Ro.oYYooooRRRRmo","oRoRRYRRRYRRRRo.",".oRRRRRRRRRRRo..","..ooRoooooRoo...","...oRo...oRo....","...oo....oo....."],{o:"#2a0e08",R:"#e8542a",Y:"#ffc83a",w:"#fff2c8",e:"#2a0a08",m:"#5a1a10"});
SP.penguin=pack(["...oooooo...","..oKKKKKKo..",".oKKKKKKKKo.",".oKWWKKWWKo.",".oWWeWWeWWo.",".oWWWyyWWWo.","oKoWWWWWWoKo","oKoWWWWWWoKo","oKoWWWWWWoKo",".ooWWWWWWoo.","..oWWWWWWo..","...oooooo...","..yyy..yyy.."],{o:"#0e1420",K:"#2a3a5a",W:"#f0f8ff",e:"#0e1420",y:"#ffb43a"});
SP.dustdevil=pack(["oooooooooooooo","oSSsSSSSsSSSSo",".oSSSSsSSSSSo.",".oSsSSSSSSsSo.","..oSSweSweSo..","..oSSeeSeeSo..","...oSSSsSSo...","...oSsSSSSo...","....oSSSso....","....oSSSSo....",".....oSSo.....",".....oSso.....","......oo......","......o......."],{o:"#4a3018",S:"#d8b070",s:"#a8804a",w:"#fff4d8",e:"#2a1a0a"});
SP.pixie=pack(["...oo..oo...","..oPPooPPo..",".oPPPPPPPPo.",".oPpFFFFpPo.","..oFeFFeFo..","..okFFFFko..","...oFFFFo...","...oGGGGo...","..oGGGGGGo..","...oGGGGo...","....o..o...."],{o:"#3a1020",P:"#ff8ac0",p:"#ffd0e4",F:"#ffe8d8",e:"#3a1020",k:"#ff9ab8",G:"#7ad890"});
SP.lion=pack(["....oooooooo....","..ooMMMMMMMMoo..",".oMMmMMMMMMmMMo.","oMMmooooooooomMo","oMMoSSSSSSSSoMMo","oMmoSeeSSeeSomMo","oMMoSewSSewSoMMo","oMmoSSSnnSSSomMo","oMMoSSmmmmSSoMMo",".oMMooSSSSooMMo.","..oMMMooooMMMo..",".oSSSoSSSSoSSSo.",".oSSSoSSSSoSSSo.",".oooo.oooo.oooo."],{o:"#1e1a14",M:"#8a8478",m:"#5e584e",S:"#b8b0a0",e:"#2a2620",w:"#ffd54a",n:"#3a342a"});
SP.lionBase=pack(["oPPPPPPPPPPPPPPPPo","oppppppppppppppppo","oooooooooooooooooo"],{o:"#1e1a14",P:"#c8a04a",p:"#8a6a2a"});
SP.cloudsp=pack([".....oooo.......","...ooCCCCoo.ooo.","..oCCCCCCCCooCCo",".oCCCCCCCCCCCCCo","oCCCeCCCCeCCCCCo","oCCkeCCCCekCCCCo","oCCCCCmmCCCCCCCo","occCCCCCCCCCCcco",".occcCCCCCCcccco","..ooccccccccooo.","....oooooooo...."],{o:"#8a9ac8",C:"#f4f8ff",c:"#c8d4f0",e:"#4a5a8a",k:"#ffc0d0",m:"#7a8ab8"});
function drawMapMob(e,t,im){const C=MAPMOB[e.mm];
 if(e.mm==="shroom"){const s=e.mkid?.6:1;ctx.fillRect(-10*s,e.r-2,20*s,4);ctx.globalAlpha=1;
  ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.12+.06*Math.sin(t*3+e.ph);ctx.fillStyle="#3fc8a8";ctx.beginPath();ctx.arc(0,-8*s,16*s,0,6.283);ctx.fill();ctx.restore();
  const w=Math.sin(t*5+e.ph)*.07;ctx.translate(0,e.r-1);ctx.scale(s*(1+w),s*(1-w));ctx.drawImage(im,-14,-28)}
 else if(e.mm==="newt"){ctx.fillRect(-10,e.r,20,3);ctx.globalAlpha=1;const ch=e.ms===1?1-e.mt/C.wind:0,ds=e.ms===2;
  if(ch>0||ds){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=ds?.25:.1+.3*ch;ctx.fillStyle="#ff6a2a";ctx.beginPath();ctx.ellipse(0,e.r-6,14+ch*3,8+ch*2,0,0,6.283);ctx.fill();ctx.restore()}
  if(ch>0)ctx.translate(Math.round(Math.sin(t*60)*1.5),0);const wg=e.ms===0?Math.sin(t*12+e.ph)*.06:0;ctx.translate(0,e.r+1);ctx.rotate(wg);ctx.scale((e.mf||1)*(ds?1.2:1),ds?.85:1);ctx.drawImage(im,-16,-18)}
 else if(e.mm==="penguin"){ctx.fillRect(-9,e.r,18,3);ctx.globalAlpha=1;ctx.translate(0,e.r);
  if(e.ms===1){const f=(e.mdx||1)<0?-1:1;ctx.translate(0,-6);ctx.rotate(f*Math.PI/2);ctx.drawImage(im,-12,-13)}
  else{const r=e.ms===2?(e.mdx<0?-1:1)*Math.PI/2*Math.max(0,e.mt/C.rest):Math.sin(t*10+e.ph)*.14;ctx.rotate(r);ctx.drawImage(im,-12,-26)}}
 else if(e.mm==="dustdevil"){ctx.fillRect(-9,e.r+1,18,3);ctx.globalAlpha=1;for(let i=0;i<14;i++){const off=Math.round(Math.sin(t*12+i*.7+e.ph)*i*.28);ctx.drawImage(im,0,i*2,28,2,-14+off,-22+i*2,28,2)}}
 else if(e.mm==="pixie"){ctx.globalAlpha=.25;ctx.fillRect(-6,e.r+4,12,3);ctx.globalAlpha=1;const by=-10+Math.round(Math.sin(t*4+e.ph)*3),fl=Math.abs(Math.sin(t*18+e.ph));
  ctx.save();ctx.globalAlpha=.7;for(const s of[-1,1]){ctx.fillStyle=s<0?"#ffc0dc":"#ffd8ea";ctx.beginPath();ctx.ellipse(s*9,by-8,4+fl*4,8,s*.5,0,6.283);ctx.fill();ctx.fillStyle="#ff8ac0";ctx.beginPath();ctx.ellipse(s*8,by-3,3+fl*2,5,s*.9,0,6.283);ctx.fill()}ctx.restore();
  if(e.mcast>0){ctx.save();ctx.globalAlpha=Math.min(1,e.mcast*2);for(let i=0;i<6;i++){const a=t*5+i*1.047,rx=Math.round(Math.cos(a)*16),ry=Math.round(by-8+Math.sin(a)*10);ctx.fillStyle=i%2?"#ffd0e4":"#ff8ac0";ctx.fillRect(rx-2,ry-1,4,3)}ctx.restore()}
  ctx.drawImage(im,-12,by-16)}
 else if(e.mm==="lion"){const z=Math.round(e.mz||0);ctx.fillRect(-15,e.r-2,30,5);ctx.globalAlpha=1;let sx=0;if(e.ms===1)sx=Math.round(Math.sin(t*70)*1.5);
  if(e.ms===0)ctx.drawImage(SP.lionBase.n,-18,e.r-6);
  ctx.translate(sx,(e.ms===0?e.r-6:e.r)-z);if(e.ms===3){const sq=Math.sin(t*10+e.ph)*.05;ctx.scale(1+sq,1-sq)}ctx.drawImage(im,-16,-28);
  if(e.ms>0&&!(e.hit>0)){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.6+.3*Math.sin(t*12);ctx.fillStyle="#ffb43a";ctx.fillRect(-6,-16,4,2);ctx.fillRect(4,-16,4,2);ctx.restore()}}
 else if(e.mm==="cloudsp"){const by=-6+Math.round(Math.sin(t*2.5+e.ph)*3),m=e.mmist>0;ctx.globalAlpha=m?.12:.3;ctx.fillRect(-10,e.r+2,20,3);
  ctx.globalAlpha=m?.3+.1*Math.sin(t*20):1;ctx.translate(0,by);if(m)ctx.scale(1.25+Math.sin(t*9)*.08,.8);ctx.drawImage(im,-16,-16);
  if(m&&Math.random()<.3)state.particles.push({x:e.x+rand(-14,14),y:e.y+by+rand(-8,6),vx:rand(-14,14),vy:rand(-14,4),life:.4,max:.4,color:"#e8f0ff",size:2})}}
SP.toad=pack(TOAD,TOAD_PAL);SP.wisp=pack(WISP,WISP_PAL);SP.witch=pack(WITCH_ROWS,WITCH_PAL);
/* ===== 이그니 진화 (Lv20 화룡 / Lv40 염제룡) — 외형 스프라이트 ===== */
const IGN_EVO=[null,
 {lv:20,name:"꼬마 화룡 이그니",nameEn:"Little Flame Drake Ignis",scale:1.1,top:["...h........h...","..ohh......hho..",".ohHo......oHho.",".oHhoooooooohHo."],
  pal:{"o":"#3b1522","R":"#f5583a","r":"#ffa07a","D":"#d04a30","h":"#fff4d0","H":"#f0c878","w":"#ffffff","e":"#2a1020","p":"#ff8fa3","n":"#8a2a2a","m":"#8a2a2a","s":"#fff0c0","S":"#ffd08a","g":"#ffc24a","G":"#e8892a"},
  tail:{o:"#3b1522",a:"#f5583a",b:"#dd4a30",c:"#ffa07a"},wing:{o:"#3b1522",M:"#e8603e",m:"#ffc09a"},
  hp:30,atk:1.2,spd:1.05,pick:1,boomR:40,boomDmg:.5,big:1.3},
 {lv:40,name:"불꽃 왕자 이그니",nameEn:"Ember Prince Ignis",scale:1.18,top:[".....g.gg.g.....","..h..gggggg..h..","..oh.gGpGGg.ho..",".ohHo......oHho.",".oHhoooooooohHo."],
  pal:{"o":"#3b1522","R":"#ff5a48","r":"#ffb08a","D":"#e04a3a","h":"#fff8e0","H":"#ffd890","w":"#ffffff","e":"#2a1020","p":"#ff8fb0","n":"#8a2a2a","m":"#8a2a2a","s":"#fff4c8","S":"#ffd890","g":"#ffd54a","G":"#f0a020"},
  tail:{o:"#3b1522",a:"#ff5a48",b:"#e84a3a",c:"#ffb08a"},wing:{o:"#3b1522",M:"#f0705a",m:"#ffd0b0"},
  hp:50,atk:1.25,spd:1.05,pick:1.15,boomR:56,boomDmg:.6,big:1.6,spread:.2,sideDmg:.6,auraR:72,auraDmg:.4,auraCD:.5}];
for(let i=1;i<IGN_EVO.length;i++){const E=IGN_EVO[i],b0=DRAGON_BODY.slice(3);if(E.face)b0.splice(3,5,...E.face);const body=[...E.top,...b0];E.extra=E.top.length-3;
 SP["ign"+i+"A"]=pack([...body,...DRAGON_A],E.pal);SP["ign"+i+"B"]=pack([...body,...DRAGON_B],E.pal)}
const IGN_WING=[null,["....oo","..ooMo",".oMMMo","oMMmMo","oMmmMo",".oMmo.","..oo.."],
 ["...oo.","..oMMo",".oMmMo","oMmmMo","oMmmMo",".oMmo.","..oo.."]];
const IGN_WING_Y=7,IGN_WING_X=-12; // 날개 위치: Y = 아래쪽 끝 높이(클수록 아래), X = 몸에서 떨어진 거리(음수일수록 바깥)
function ignisWings(g,t,mv,st){const P=IGN_EVO[st].wing,rows=IGN_WING[st],w=rows[0].length,fl=Math.round(Math.sin(t*(mv?12:4))*(mv?2.5:1.2)),y0=-24-rows.length*2+6;
 for(const side of[-1,1])rows.forEach((r,y)=>{for(let x=0;x<w;x++){const c=r[x];if(c===".")continue;g.fillStyle=P[c];const cs=st>=2?2.5:2,k=(w-x)/w,xx=Math.round(side<0?IGN_WING_X-(w-x)*cs:-IGN_WING_X+(w-1-x)*cs),yy=Math.round(IGN_WING_Y-(rows.length-y)*cs+fl*k*1.8+y0*0);g.fillRect(xx,yy,Math.ceil(cs),Math.ceil(cs))}})}

// 탑의 수문장 (룬이 새겨진 돌 골렘)
SP.warden=pack(["...oooooooooo...","..osllllllllso..",".oslssssssssslo.",".osRRssssssRRso.",".osrRssssssRrso.",".osssssddssssso.","oossssrrrrssssoo","osllsssrrsssslso","osssmsssssssmsso","ossssssrrsssssso","odsssssssssssdso",".odssssssssssdo.","..odsssmssssdo..","..oddo....oddo..",".oddddo..oddddo.",".oooooo..oooooo."],{o:"#141218",s:"#6b6878",l:"#8f8ca0",d:"#45424f",r:"#7a5ac8",R:"#d6c4ff",m:"#4f6b45"});

// ---- 이그니 애니메이션: 걷기(통통 튀기·기울기) / 숨쉬기·눈깜빡 / 꼬리 흔들림 / 일렁이는 불꽃 ----
function dragonFlame(g,x,y,h,sw,t){
const L=[["#e8442a",1],["#ff8a2a",.78],["#ffd54a",.52],["#fff7dc",.28]],rh=Math.max(2,Math.round(h/4));
for(const [c,s] of L){g.fillStyle=c;for(let k=0;k<4;k++){const rw=Math.max(2,Math.round(8*s*(1-k*.22)));g.fillRect(Math.round(x-rw/2+sw*k*(.6+.4*s)),Math.round(y-(k+1)*rh*(.55+.45*s)),rw,Math.ceil(rh*(.55+.45*s))+1)}}}
function dragonTail(g,t,mv,P){
const N=3,sp=mv?9:3.2,am=mv?2.3:1.2,pts=[];
for(let i=0;i<N;i++)pts.push([Math.round(-13-i*4),Math.round(6-i*.7+Math.sin(t*sp-i*.9)*am*(i+1)*.5)]);
const TP=P&&P.a?P:{o:"#3b1522",a:"#f2643c",b:"#d9502f",c:"#ff9a6a"};
for(let i=0;i<N;i++){const s=Math.round(6-i*.9);g.fillStyle=TP.o;g.fillRect(pts[i][0]-Math.ceil(s/2)-1,pts[i][1]-Math.ceil(s/2)-1,s+2,s+2)}
for(let i=0;i<N;i++){const s=Math.round(6-i*.9);g.fillStyle=i%2?TP.b:TP.a;g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s,s);if(i<2){g.fillStyle=TP.c;g.fillRect(pts[i][0]-Math.ceil(s/2),pts[i][1]-Math.ceil(s/2),s-1,1)}}
const tp=pts[N-1],h=8+Math.sin(t*20)*2+Math.sin(t*33)*1.5+(mv?3:0),sw=Math.sin(t*11)*1.2+(mv?-1.5:0);
g.save();g.globalCompositeOperation="lighter";g.fillStyle="rgba(255,140,50,.10)";g.beginPath();g.arc(tp[0]-1,tp[1]-8,17+Math.sin(t*9)*1.5,0,6.283);g.fill();g.fillStyle="rgba(255,200,90,.12)";g.beginPath();g.arc(tp[0]-1,tp[1]-8,10,0,6.283);g.fill();g.restore();
dragonFlame(g,tp[0]-1,tp[1]-1,h,sw,t);return tp}
function dragonBlink(g,t,bc){if((t%3.6)<.12){g.fillStyle=bc||"#f2643c";g.fillRect(-10,-10,6,6);g.fillRect(4,-10,6,6);g.fillStyle="#2a1020";g.fillRect(-10,-6,6,2);g.fillRect(4,-6,6,2)}}
/* ===== 주작: 불꽃의 검 / 불의 검기 ===== */
function drawSword(g,x,y,ang,len,t){
g.save();g.translate(Math.round(x),Math.round(y));g.rotate(ang);
g.save();g.globalCompositeOperation="lighter";g.fillStyle="rgba(255,120,40,.2)";g.beginPath();g.arc(len*.55,0,len*.55+Math.sin(t*12)*1.5,0,6.283);g.fill();g.restore();
g.fillStyle="#3b1522";g.fillRect(-5,-2,10,4);g.fillStyle="#a82020";g.fillRect(-4,-1,8,2);
g.fillStyle="#3b1522";g.fillRect(4,-6,5,12);g.fillStyle="#ffc83a";g.fillRect(5,-5,3,10);
g.fillStyle="#3b1522";g.fillRect(8,-4,len-8,8);g.beginPath();g.moveTo(len,-4);g.lineTo(len+6,0);g.lineTo(len,4);g.closePath();g.fill();
g.fillStyle="#ff8a2a";g.fillRect(9,-3,len-9,6);g.beginPath();g.moveTo(len,-3);g.lineTo(len+4,0);g.lineTo(len,3);g.closePath();g.fill();
g.fillStyle="#ffd54a";g.fillRect(9,-2,len-9,3);g.fillStyle="#fff2a8";g.fillRect(9,-1,len-10,1);
g.fillStyle="#ffd54a";for(let i=0;i<3;i++)g.fillRect(Math.round(len-5-i*7),Math.round(-6-Math.abs(Math.sin(t*14+i*2))*3),2,2);
g.restore()}
function drawSwing(p,bob){
const k=1-p.swingT/.22,a0=p.swingA-1.35,a=a0+2.7*Math.min(1,k*1.15),cx=Math.round(p.x),cy=Math.round(p.y+bob)-6;
ctx.save();ctx.translate(cx,cy);ctx.lineCap="round";
for(const [w,c,al] of [[10,"#ff6a2a",.3],[5,"#ffb04a",.6],[2,"#fff2a8",.9]]){ctx.globalAlpha=al*(1-k*.4);ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.arc(0,0,30,a0+(a-a0)*.25,a);ctx.stroke()}
ctx.globalAlpha=1;ctx.restore();
drawSword(ctx,cx+Math.cos(a)*8,cy+Math.sin(a)*8,a,26,state.time)}
function drawQi(a){
const ang=Math.atan2(a.vy,a.vx),fl=Math.sin(state.time*30+a.x*.05);
const cres=()=>{ctx.beginPath();ctx.arc(-6,0,20,-1.2,1.2);ctx.arc(-18,0,26.77,.768,-.768,true);ctx.closePath();ctx.fill()};
ctx.save();ctx.translate(Math.round(a.x),Math.round(a.y));ctx.rotate(ang);if(a.big)ctx.scale(a.big,a.big);
for(let i=3;i>=0;i--){ctx.save();ctx.translate(-i*9,0);ctx.scale(1-i*.12,1-i*.12);const al=i?.2:1;
ctx.globalAlpha=al*.3;ctx.fillStyle="#ff4a2a";ctx.save();ctx.scale(1.3+fl*.04,1.3);cres();ctx.restore();
ctx.globalAlpha=al;ctx.fillStyle="#ff8a2a";cres();
ctx.fillStyle="#ffd54a";ctx.save();ctx.translate(2,0);ctx.scale(.8,.8);cres();ctx.restore();ctx.restore()}
ctx.globalAlpha=1;ctx.restore()}

/* ===== 현무: 등껍질을 휘감은 뱀 · 뱀 채찍 · 물의 결계 · 물방울 탄 ===== */
const SNK=["#0f2418","#2f7f5a","#5fbf8a","#c8e6a0"];
function snakeSeg(g,x,y,r,band){const X=Math.round(x-r),Y=Math.round(y-r),D=Math.round(r*2);g.fillStyle=SNK[0];g.fillRect(X-1,Y-1,D+2,D+2);g.fillStyle=band?"#25664a":SNK[1];g.fillRect(X,Y,D,D);g.fillStyle=SNK[2];g.fillRect(X,Y,D-1,1);g.fillStyle=SNK[3];g.fillRect(X+1,Y+D-1,Math.max(1,D-2),1)}
// 등 뒤로 보이는 둥근 흑수 등껍질
function shellBack(g,CC){const C=CC||["#0c1418","#1e2f3a","#2f4a5a","#5a8aa0"],E=(rx,ry,col,cy)=>{g.fillStyle=col;for(let y=-ry;y<=ry;y+=2){const w=Math.round(rx*Math.sqrt(Math.max(0,1-(y/ry)**2))/2)*2;if(w>0)g.fillRect(-w,cy+y,w*2,2)}};
 E(23,17,C[0],-2);E(21,15,C[1],-2);
 g.fillStyle=C[2];for(let y=-15;y<=11;y+=2){const w=Math.round(21*Math.sqrt(Math.max(0,1-((y)/15)**2))/2)*2;if(w>4){g.fillRect(-w,y-2,3,2);g.fillRect(w-3,y-2,2,2)}}
 g.fillStyle=C[3];for(const [x,y] of [[-20,-8],[-21,-2],[18,-8],[19,-2],[-18,6],[16,6]])g.fillRect(x,y,2,2);
 g.fillStyle=C[0];for(const [x,y] of [[-19,0],[17,0],[-17,-12],[15,-12]])g.fillRect(x,y,2,2)}
function snakeBack(g,t,mv){for(let i=0;i<7;i++){const k=i/6;snakeSeg(g,-17-k*5,7+k*4+Math.sin(t*(mv?8:3)+i)*.8,2.6-k*1.3,i%2)}}
function snakeFront(g,t,mv){const sw=Math.sin(t*(mv?7:2.4)),P=[];for(let i=0;i<11;i++){const k=i/10;P.push([17+Math.sin(k*3.2)*2.6,9-k*27+sw*k*1.5])}
 P.forEach(([x,y],i)=>snakeSeg(g,x,y,2.4,i%2));
 const hx=Math.round(P[10][0]),H=Math.round(P[10][1]-2);g.fillStyle=SNK[0];g.fillRect(hx-6,H-4,10,7);g.fillRect(hx-7,H-2,2,4);g.fillStyle=SNK[1];g.fillRect(hx-5,H-3,8,5);g.fillRect(hx-6,H-1,1,2);g.fillStyle=SNK[2];g.fillRect(hx-5,H-3,7,2);g.fillStyle=SNK[3];g.fillRect(hx-5,H+1,6,1);
 g.fillStyle="#ffe27a";g.fillRect(hx-3,H-2,2,2);g.fillStyle=SNK[0];g.fillRect(hx-3,H-2,1,2);g.fillRect(hx-6,H-1,1,1);
 if(Math.floor(t*3)%3===0){g.fillStyle="#e0523a";g.fillRect(hx-10,H,3,1);g.fillRect(hx-11,H-1,1,1);g.fillRect(hx-11,H+1,1,1)}}
function hyunmuBlink(g,t){if((t%3.6)<.12){g.fillStyle="#3f6b5a";g.fillRect(-8,-16,4,6);g.fillRect(4,-16,4,6);g.fillStyle="#0c1418";g.fillRect(-8,-12,4,2);g.fillRect(4,-12,4,2)}}
function drawWhip(p,bob){const k=1-p.whipT/.28,R=(p.whipLen||96)*(p.stance?SKN.h_stance.reach:1),a0=p.whipA-.95,a=a0+1.9*Math.min(1,k*1.25),reach=R*Math.min(1,k*2.5),ox=Math.round(p.x+(p.face||1)*12),oy=Math.round(p.y+bob)-14;
 const ex=ox+Math.cos(a)*reach,ey=oy+Math.sin(a)*reach,qx=ox+Math.cos(a-.5)*reach*.55,qy=oy+Math.sin(a-.5)*reach*.55;
 ctx.save();ctx.lineCap="round";ctx.globalAlpha=1;for(const [w,c] of [[8,SNK[0]],[5,SNK[1]],[2,SNK[2]]]){ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(ox,oy);ctx.quadraticCurveTo(qx,qy,ex,ey);ctx.stroke()}
 ctx.translate(Math.round(ex),Math.round(ey));ctx.rotate(a);ctx.fillStyle=SNK[0];ctx.fillRect(-4,-5,12,10);ctx.fillStyle=SNK[1];ctx.fillRect(-3,-4,10,8);ctx.fillStyle=SNK[2];ctx.fillRect(-3,-4,9,3);ctx.fillStyle="#fff8ea";ctx.fillRect(6,2,2,3);ctx.fillRect(6,-5,2,3);ctx.fillStyle="#ffe27a";ctx.fillRect(2,-3,2,2);
 ctx.restore();if(!state.paused&&Math.random()<.5)state.particles.push({x:ex,y:ey,vx:rand(-30,30),vy:rand(-30,30),life:.3,max:.3,color:"#bfefff",size:2})}
function drawBarrier(p,bob,t){const n=p.bar||0;if(n<=0)return;const x=Math.round(p.x),y=Math.round(p.y+bob)-6;ctx.save();
 ctx.globalAlpha=.14+.05*Math.sin(t*3);ctx.fillStyle="#7fd0ff";ctx.beginPath();ctx.arc(x,y,24,0,6.283);ctx.fill();ctx.globalAlpha=.45;ctx.strokeStyle="#bfefff";ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,24,0,6.283);ctx.stroke();
 ctx.globalAlpha=1;for(let i=0;i<n;i++){const a=t*1.6+i*6.283/n,dx=Math.round(x+Math.cos(a)*25),dy=Math.round(y+Math.sin(a)*15);ctx.fillStyle="#14303c";ctx.fillRect(dx-3,dy-3,6,6);ctx.fillStyle="#3fa0c8";ctx.fillRect(dx-2,dy-2,4,4);ctx.fillStyle="#e8fbff";ctx.fillRect(dx-2,dy-2,2,1)}
 ctx.restore()}
function drawWaterShot(a){const x=Math.round(a.x),y=Math.round(a.y);ctx.save();for(let i=1;i<=3;i++){ctx.globalAlpha=.4-i*.1;ctx.fillStyle="#7fd0ff";ctx.beginPath();ctx.arc(x-a.vx*.024*i,y-a.vy*.024*i,4-i*.8,0,6.283);ctx.fill()}
 ctx.globalAlpha=1;ctx.fillStyle="#14303c";ctx.beginPath();ctx.arc(x,y,6,0,6.283);ctx.fill();ctx.fillStyle="#3fa0c8";ctx.beginPath();ctx.arc(x,y,4.8,0,6.283);ctx.fill();ctx.fillStyle="#9fe4ff";ctx.beginPath();ctx.arc(x-1,y-1,2.8,0,6.283);ctx.fill();ctx.fillStyle="#fff";ctx.fillRect(x-3,y-3,2,2);ctx.restore()}
// 결계가 막음 / 반격 물결
function barrierBreak(p){burst(p.x,p.y-6,"#bfefff",18);burst(p.x,p.y-6,"#3fa0c8",10);for(const e of state.enemies)if(!e.boss&&dist2(p,e)<120**2)e.slowT=2.2;const l=skL(p,"h_spike");if(l){const N=SKN.h_spike,n=N.n+N.per*(l-1),a0=rand(0,6.283);for(let i=0;i<n;i++){const a=a0+i*6.283/n;state.arrows.push({water:true,src:"h_spike",x:p.x,y:p.y-6,vx:Math.cos(a)*340,vy:Math.sin(a)*340,r:7,damage:p.arrowDamage*N.dmg*(1+.3*(l-1)),pierce:3,hit:new Set(),life:.9})}}}
function counterWave(p){if(state.time-(p.cwT==null?-9:p.cwT)<.3)return;p.cwT=state.time;
 for(const e of state.enemies){const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy)||1;if(d<95+e.r){hurt(e,p.counter||2,"#9fe4ff","counter");if(!e.boss){e.x+=dx/d*34;e.y+=dy/d*34}}}}
// 체력이 줄어드는 순간을 가로채서: 결계가 있으면 막고, 없으면 반격 물결 (모든 피해 경로에 공통 적용)
// (현무) 결계가 있으면 막고, 없으면 반격 물결 · (하드) 모든 회복량 감소 — 모든 피해/회복 경로에 공통 적용
function installHp(p){let hv=p.hp;Object.defineProperty(p,"hp",{configurable:true,enumerable:true,get(){return hv},set(v){
 if(state&&state.p===p&&!state.dead){if(v<hv-.001&&p.dmgInMul&&p.dmgInMul!==1)v=hv-(hv-v)*p.dmgInMul;if(v<hv-.001&&p.stance)v=hv-(hv-v)*(1-SKN.h_stance.red);if(v<hv-.001&&p.charId==="qilin"&&!(p.mandT>0))p.karma=Math.min(p.maxHp*QILIN.karma.cap,(p.karma||0)+(hv-v));if(v<hv-.001&&p.charId==="qilin"&&p.holy>0){const a=Math.min(p.holy,hv-v);p.holy-=a;v+=a;if(state.rs)state.rs.blocked+=0;if(v>=hv-.001){burst(p.x,p.y-8,"#fff6c0",4);return}}if(v<hv-.001&&p.charId==="hwangryong"&&p.gscale>0&&!p.noPassive){p.gscale=0;p.gscaleT=0;if(state.rs)state.rs.blocked++;hwQuake(p);hud();return}if(v<hv-.001&&p.charId==="hyunmu"){if(p.bar>0){p.bar--;p.barT=0;if(state.rs)state.rs.blocked++;barrierBreak(p);return}if(!p.noCounter)counterWave(p)}
  else if(v>hv&&hv>0&&p.healMul!=null&&p.healMul!==1)v=hv+(v-hv)*p.healMul;
  if(state.rs){if(v<hv-.001){state.rs.taken+=Math.min(hv,hv-v);state.rs.hits++}else if(v>hv&&hv>0)state.rs.healed+=Math.min(v,p.maxHp)-hv}}
 hv=v}})}
function hyunmuTick(p,dt){if((p.bar||0)<(p.barMax||2)){p.barT=(p.barT||0)+dt;if(p.barT>=(p.barCD||6)){p.barT=0;p.bar=(p.bar||0)+1;burst(p.x,p.y-6,"#9fe4ff",8)}}else p.barT=0}
/* 캐릭터 기본 스탯 적용 (캐릭터 목록의 stats 표) */
function applyCharStats(p){if(Object.getOwnPropertyDescriptor(p,"hp")?.get){const v=p.hp;delete p.hp;p.hp=v}const c=chars.get(p.charId),st=c&&c.stats;if(st){p.maxHp=p.hp=st.hp;p.speed=st.spd;p.pickup=st.pick;if(st.guard!==1)p.guard=st.guard;if(c.applyAtk){p.dmgMul=st.atk;p.arrowRate=st.rate}}
 if(p.charId==="hyunmu"){p.bar=p.barMax=2;p.barCD=6;p.barT=0;p.counter=2;p.whipLen=96;p.whipT=0}
 p.blades=0; // 사신·황룡: 공용 회전 구슬 대신 고유 스킬
 shopApply(p);if(state.diff==="hard")applyHard(p);p.dmgInMul=upT().dmg;installHp(p)}
function applyHard(p){const H=HARD;p.noPassive=true;if(p.charId==="hyunmu"){p.guard=1;p.noCounter=true}if(p.charId==="zhuque")p.noRevive=true;
 p.maxHp=Math.max(1,Math.round(p.maxHp*H.hp));p.hp=p.maxHp;p.dmgMul=(p.dmgMul||1)*H.atk;p.guard=(p.guard||1)*H.dmgTaken;p.speed*=H.spd;p.arrowRate*=H.rate;p.pickup*=H.pick;p.xpMul=(p.xpMul||1)*H.xp;p.healMul=H.heal}
/* ===== 주작: 불꽃 깃털 발사 ===== */
function featherVolley(p,t){const n=p.feathers,base=Math.atan2(t.y-p.y,t.x-p.x),sp=420;
 for(let i=0;i<n;i++){const a=base+(i-(n-1)/2)*FEATHER_STEP;state.arrows.push({feather:true,x:p.x+Math.cos(a)*14,y:p.y+Math.sin(a)*14-4,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:9,damage:p.arrowDamage*.9,pierce:2,hit:new Set(),life:1.5})}
 p.swingT=Math.max(p.swingT||0,.12)}
function drawFeatherShape(g,k,fl){g.save();g.scale(k,k);
 const P=s=>{g.beginPath();g.moveTo(-9*s,0);g.quadraticCurveTo(-2*s,-7.5*s,11*s,-.5*s);g.quadraticCurveTo(-1*s,7*s,-9*s,0);g.closePath()};
 const ga=g.globalAlpha;g.globalAlpha=ga*.25;g.fillStyle="#ff6a2a";g.save();g.scale(1.5+(fl||0)*.05,1.8);P(1);g.fill();g.restore();g.globalAlpha=ga;
 g.fillStyle="#7a1e22";P(1);g.fill();g.fillStyle="#e0523a";P(.82);g.fill();g.fillStyle="#ff8a2a";P(.58);g.fill();g.fillStyle="#ffd54a";P(.3);g.fill();
 g.fillStyle="#7a1e22";g.fillRect(-12,-1.2,5,2.4);g.fillStyle="#fff7dc";g.fillRect(-11,-.5,16,1);g.restore()}
function drawFeatherShot(a){const ang=Math.atan2(a.vy,a.vx),fl=Math.sin(state.time*30+a.x*.05);
 ctx.save();ctx.translate(Math.round(a.x),Math.round(a.y));ctx.rotate(ang);
 for(let i=1;i<=4;i++){ctx.globalAlpha=.34-i*.07;ctx.fillStyle=i<3?"#ff8a2a":"#e0523a";ctx.beginPath();ctx.arc(-i*7,0,6-i*.9,0,6.283);ctx.fill()}
 ctx.globalAlpha=1;drawFeatherShape(ctx,1.25,fl);ctx.globalAlpha=1;ctx.restore()}

function drawWings(g,t,mv){
const fl=Math.sin(t*(mv?16:4.5))*(mv?.38:.12),L=[19,25,24,17],C=["#a82020","#e8442a","#ff8a2a","#ffc83a"],H=["#e8442a","#ff8a4a","#ffc83a","#fff2a8"];
for(const s of [-1,1]){
g.save();g.translate(s*9,-7);g.scale(s,1);
const ang=i=>-1.2+i*.42+fl*(1+i*.18);
g.save();g.globalCompositeOperation="lighter";g.fillStyle="rgba(255,110,40,.16)";g.beginPath();g.arc(15,-4+fl*8,17,0,6.283);g.fill();g.restore();
for(let i=0;i<4;i++){g.save();g.rotate(ang(i));g.fillStyle="#3b1522";g.fillRect(-1,-4,L[i]+2,8);g.beginPath();g.moveTo(L[i]+1,-4);g.lineTo(L[i]+6,0);g.lineTo(L[i]+1,4);g.closePath();g.fill();g.restore()}
for(let i=3;i>=0;i--){g.save();g.rotate(ang(i));g.fillStyle=C[i];g.fillRect(0,-3,L[i],6);g.beginPath();g.moveTo(L[i],-3);g.lineTo(L[i]+4,0);g.lineTo(L[i],3);g.closePath();g.fill();g.fillStyle=H[i];g.fillRect(1,-2,L[i]-3,2);g.restore()}
g.restore()}}
const selChar=()=>{try{return chars.sel()}catch(_){return"ignis"}};
function drawPlayer(p){
const f=p.face||1,mv=p.moving,t=performance.now()/1000,w=p.anim*31.4,fr=mv?Math.floor(p.anim*10)%2:0,Z=p.charId==="zhuque",HM=p.charId==="hyunmu",BK=p.charId==="baekho",CR=p.charId==="cheongryong",HW=p.charId==="hwangryong",QL=p.charId==="qilin",im=Z?(fr?SP.zhuqueB.n:SP.zhuqueA.n):HM?(fr?SP.hyunmuB.n:SP.hyunmuA.n):BK?(fr?SP.baekhoB.n:SP.baekhoA.n):CR?(fr?SP.cheongB.n:SP.cheongA.n):HW?(fr?SP.hwangB.n:SP.hwangA.n):QL?(fr?SP.qilinB.n:SP.qilinA.n):(fr?SP.dragonB.n:SP.dragonA.n);
if(BK&&p.dashTrail)for(const q of p.dashTrail){ctx.save();ctx.globalAlpha=q.t/.25*.45;ctx.translate(Math.round(q.x),Math.round(q.y));ctx.scale(q.f||1,1);ctx.drawImage(SP.baekhoA.f,-16,-24);ctx.restore()}
if(BK&&p.hunt>0){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.08+p.hunt*.025;ctx.fillStyle="#ffb04a";ctx.beginPath();ctx.ellipse(Math.round(p.x),Math.round(p.y)+6,20+p.hunt,10+p.hunt*.4,0,0,6.283);ctx.fill();ctx.restore()}
const EV=!Z&&!HM&&!BK&&!CR&&!HW&&!QL&&p.evo?IGN_EVO[p.evo]:null,evIm=EV?(fr?SP["ign"+p.evo+"B"].n:SP["ign"+p.evo+"A"].n):null,EVX=!EV&&p.evo&&CHAR_EVO[p.charId]?CHAR_EVO[p.charId][p.evo]:null,EVS=EV||EVX;
if(EV&&p.evo>=2)ignisAura(p,t);
const hop=mv?Math.abs(Math.sin(w)):0,bob=mv?-Math.round(hop*2):0,sy=mv?1+(hop-.5)*.08:1+Math.sin(t*3)*.025,sx=1/sy,rot=mv?Math.sin(w/2)*.05:0;
ctx.globalAlpha=.4-hop*.1;ctx.fillStyle="#050a08";const sw=24-Math.round(hop*3);ctx.fillRect(Math.round(p.x)-sw/2,Math.round(p.y)+11,sw,5);ctx.globalAlpha=1;
ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y)+bob);ctx.scale(f,1);ctx.translate(0,12);ctx.rotate(rot);ctx.scale(sx*(EVS?EVS.scale:1),sy*(EVS?EVS.scale:1));ctx.translate(0,-12);
if(Z){if(EVX){ctx.save();ctx.translate(0,-7);ctx.scale(EVX.wing,EVX.wing);ctx.translate(0,7);drawWings(ctx,t,mv);ctx.restore()}else drawWings(ctx,t,mv)}if(EV)ignisWings(ctx,t,mv,p.evo);if(HM){shellBack(ctx,EVX&&EVX.shell);snakeBack(ctx,t,mv)}const tp=Z?[-12,10]:HM?[2,-14]:BK?baekhoTail(ctx,t,mv):CR?cheongTail(ctx,t,mv):HW?hwangTail(ctx,t,mv):QL?qilinTail(ctx,t,mv):dragonTail(ctx,t,mv,EV&&EV.tail);if(EV)ctx.drawImage(evIm,-16,-24-EV.extra*2);else ctx.drawImage(EVX?(fr?EVX.B:EVX.A).n:im,-16,-24);if(HM){hyunmuBlink(ctx,t);if(!(p.whipT>0))snakeFront(ctx,t,mv)}else if(BK)baekhoBlink(ctx,t);else if(CR){cheongBlink(ctx,t);cheongExtras(ctx,t,mv,p)}else if(HW){hwangBlink(ctx,t);hwangExtras(ctx,t,mv,p)}else if(QL){qilinBlink(ctx,t);qilinExtras(ctx,t,mv,p)}else dragonBlink(ctx,t,Z?(EVX?EVX.pal.R:"#e8442a"):EV?EV.pal.R:undefined);if(EVX)evoAcc(ctx,t,mv,p,p.charId,p.evo);if(Z&&!(p.swingT>0))drawSword(ctx,13,2,-.8+Math.sin(t*2.2)*.06,22,t);ctx.restore();if(Z&&p.swingT>0)drawSwing(p,bob);if(HM){if(p.whipT>0)drawWhip(p,bob);drawBarrier(p,bob,t)}if(BK&&p.clawT>0)drawClaw(p,bob);
if(!state.paused&&!state.dead&&Math.random()<(HM?(mv?.18:.08):BK?(mv?.3:.06):CR||HW||QL?(mv?.25:.08):mv?.5:.25)){state.particles.push({x:Math.round(p.x+f*tp[0]+rand(-3,3)),y:Math.round(p.y+bob+tp[1]-12),vx:rand(-10,10)-f*(mv?14:0),vy:rand(-46,-22),life:rand(.4,.8),max:.8,color:(HM?["#bfefff","#7fd0ff","#e8fbff","#9fe4ff"]:BK?["#ffffff","#cfe8ff","#e8f0ff","#bfd4ff"]:CR?["#5affc8","#9fe8ff","#ffffff","#7ac0f8"]:HW?["#ffd54a","#fff0a0","#ffffff","#ff8a4a"]:QL?["#fff6c0","#ffffff","#9ae8d0","#ffc8d4"]:["#ffd54a","#ff8a2a","#ffb43a","#fff0b0"])[Math.floor(rand(0,4))],size:2})}}
function drawEnemy(e){if(e.boss){drawBoss(e);return}if(e.elite){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35+.15*Math.sin(state.time*6+e.ph);ctx.strokeStyle="#ffd54a";ctx.lineWidth=2;ctx.beginPath();ctx.arc(Math.round(e.x),Math.round(e.y)-4,e.r+8,0,6.283);ctx.stroke();ctx.restore()}
const t=state.time,hit=e.hit>0,k=SP[e.type]||SP.blob,im=hit?k.f:e.petT>0?(k.g||(k.g=tint(k.n,"#8a8478"))):k.n;
ctx.save();ctx.translate(Math.round(e.x),Math.round(e.y));ctx.globalAlpha=.4;ctx.fillStyle="#050a08";
if(e.type==="toad"){ctx.fillRect(-12,e.r-3,24,4);ctx.globalAlpha=1;const ch=e.charge>0?1-e.charge/RANGED.toad.charge:0,hop=Math.max(0,Math.sin(t*5+e.ph)),sc=1+ch*.28;
 ctx.translate(0,e.r-1-Math.round(hop*3));ctx.scale(sc*(e.elite?1.3:1),(1+ch*.18-hop*.06)*(e.elite?1.3:1));ctx.drawImage(im,-14,-20);if(ch>0){ctx.globalAlpha=.5*ch;ctx.fillStyle="#bfefff";ctx.fillRect(-6,-10,12,4)}}
else if(e.type==="wisp"){ctx.globalAlpha=1;const ch=e.charge>0?1-e.charge/RANGED.wisp.charge:0,by=-6+Math.round(Math.sin(t*3+e.ph)*3);
 ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.22+.3*ch;ctx.fillStyle="#9a5ae0";ctx.beginPath();ctx.arc(0,by,14+ch*8,0,6.283);ctx.fill();ctx.restore();
 ctx.translate(0,by);if(e.elite)ctx.scale(1.3,1.3);ctx.scale(1+Math.sin(t*9+e.ph)*.05,1-Math.sin(t*9+e.ph)*.05);ctx.drawImage(im,-10,-12)}
else if(e.type==="lantern"){drawLantern(e,t)}
else if(e.mm){drawMapMob(e,t,im)}
else if(e.type==="bat"){
 ctx.fillRect(-7,e.r+2,14,3);ctx.globalAlpha=1;
 const w=Math.sin(t*22+e.ph),by=-6+Math.round(Math.sin(t*8+e.ph)*2);
 for(const d of [-1,1]){ctx.fillStyle=hit?"#fff4d8":"#3a5a8a";ctx.beginPath();ctx.moveTo(d*4,by-1);ctx.lineTo(d*18,by-5+w*8);ctx.lineTo(d*13,by+3+w*4);ctx.lineTo(d*4,by+5);ctx.closePath();ctx.fill()}
 ctx.drawImage(im,-8,by-8)}
else if(e.type==="stump"){
 ctx.fillRect(-14,e.r-4,28,6);ctx.globalAlpha=1;
 ctx.drawImage(im,-16,-19-Math.round(Math.abs(Math.sin(t*4+e.ph))*2))}
else{
 ctx.fillRect(-10,e.r-2,20,4);ctx.globalAlpha=1;
 const w=Math.sin(t*6+e.ph)*.07;ctx.translate(0,e.r-1);ctx.scale(1+w,1-w);ctx.drawImage(im,-14,-20)}
ctx.restore()}

// ---- 보스 ----
const minion=(x,y)=>({x,y,type:"blob",ph:rand(0,6.28),r:10,speed:62,hp:1,maxHp:1,damage:10,color:"#9aa0ac",hit:0,bladeCD:0});
function spawnBoss(n){
if(state.enemies.some(e=>e.boss))return false;
if(n==="witch")return spawnWitch();
const type=BOSS_ORDER[Math.min(n,BOSS_ORDER.length)-1],hp=type==="shadow"?2600:Math.round(400+(n-1)*300);
const base={king:{r:28,speed:42,damage:20},lord:{r:20,speed:85,damage:18},guardian:{r:32,speed:34,damage:25},owl:{r:26,speed:68,damage:22},shadow:{r:34,speed:58,damage:25}}[type];
state.enemies.push({x:cam.x+rand(W*.25,W*.75),y:cam.y-50,type,boss:true,n,ph:0,...base,hp,maxHp:hp,color:{king:"#9aa0ac",lord:"#7fb0ff",guardian:"#7fd0e8",owl:"#5a6ac8",shadow:"#8a3ac0"}[type],hit:0,bladeCD:0,cd:2,mode:"chase",sk:0});
state.banner={text:type==="shadow"?`FINAL BOSS · ${bossName(type)}`:`BOSS ${n} · ${bossName(type)}`,t:3};return true}
function bossAI(e,dt,ux,uy){
e.t=(e.t||0)+dt;e.cd-=dt;if(e.type==="owl"){owlAI(e,dt,ux,uy);return}if(e.type==="witch"){witchAI(e,dt,ux,uy);return}if(e.type==="shadow"){shadowAI(e,dt,ux,uy);return}if(e.type==="guardian"){guardianAI(e,dt,ux,uy);return}if(e.type==="warden"){wardenAI(e,dt,ux,uy);return}if(e.type==="astra"){dragonAI(e,dt,ux,uy);return}if(e.type==="taotie"){taotieAI(e,dt,ux,uy);return}if(e.type==="hundun"){hundunAI(e,dt,ux,uy);return}
if(e.type==="king"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
 if(e.cd<=0){e.cd=4.2;for(let i=0;i<4;i++){const a=i*Math.PI/2+e.t;state.enemies.push(minion(e.x+Math.cos(a)*e.r,e.y+Math.sin(a)*e.r))}burst(e.x,e.y,"#b27be0",16)}}
else if(e.type==="lord"){
 if(e.mode==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;if(e.cd<=0){e.mode="aim";e.cd=.8}}
 else if(e.mode==="aim"){e.dx=ux;e.dy=uy;if(e.cd<=0){e.mode="dash";e.cd=.55}}
 else{e.x=clamp(e.x+e.dx*430*dt,20,WW-20);e.y=clamp(e.y+e.dy*430*dt,40,WH-20);if(e.cd<=0){e.mode="chase";e.cd=2.6}}}
else{e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
 if(e.cd<=0){e.cd=2.6;e.spin=(e.spin||0)+.3;for(let i=0;i<12;i++){const a=e.spin+i*Math.PI/6;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*150,vy:Math.sin(a)*150,r:5,life:4})}}}}


/* ===== N45 보스: 혼등의 마녀 =====
   핵심 매커니즘
   · 등불 결계: 맵에 혼등(등불)이 켜져 있는 동안 마녀는 받는 피해 -75%. 등불을 모두 깨면 결계가 깨져 6초간 받는 피해 +50% · 2초 기절
     깨진 등불은 14초 뒤 다시 켜짐 (2페이즈는 4개)
   · 등불 사슬: 등불끼리 이어진 사슬이 주기적으로 1초 깜빡인 뒤 1.2초간 불타올라, 닿으면 피해
   · 패턴: 나선 혼불 탄막 / 유도 도깨비불 / 등불과 자리 바꾸기 / (2페이즈) 영혼 끌어당기기 */
const WITCH_NIGHT=45;
const WITCH={hp:1900,shieldMul:.25,exposedMul:1.5,exposeT:6,stunT:2,relight:14,lanterns:3,lanternsPh2:4,lanternHp:14,beamCD:8,beamCDPh2:5.5,beamWarn:1,beamOn:1.2,beamDmg:18,pull:75};
function spawnWitch(){const hp=WITCH.hp;
 const e={x:cam.x+W/2,y:cam.y-50,type:"witch",boss:true,n:4.5,ph:0,r:26,speed:60,damage:22,hp,maxHp:hp,color:"#9a5ae0",hit:0,bladeCD:0,cd:2.2,mode:"enter",sk:0,beamT:5,lanterns:[]};
 state.enemies.push(e);state.banner={text:`BOSS · ${bossName("witch")}`,t:3};state.shake=Math.max(state.shake||0,6);return true}
function witchLanterns(e,n){e.lanterns=[];const p=state.p,cx=clamp(p.x,cam.x+160,cam.x+W-160),cy=clamp(p.y,cam.y+140,cam.y+H-120),R=Math.min(W,H)*.36,a0=rand(0,6.28);
 for(let i=0;i<n;i++){const a=a0+i*6.283/n,l={x:clamp(cx+Math.cos(a)*R,40,WW-40),y:clamp(cy+Math.sin(a)*R*.8,60,WH-40),type:"lantern",owner:e,ph:rand(0,6),r:12,speed:0,hp:WITCH.lanternHp,maxHp:WITCH.lanternHp,damage:0,color:"#7affe0",hit:0,bladeCD:0};
  state.enemies.push(l);e.lanterns.push(l);state.fx.push(sporeFx(l.x,l.y,40,"ice"))}
 e.beamT=Math.max(e.beamT,3)}
function witchAI(e,dt,ux,uy){const p=state.p;e.t=(e.t||0);
 const lan=(e.lanterns||[]).filter(l=>l.hp>0&&state.enemies.includes(l));e.lanterns=lan;e.shieldOn=lan.length>0;
 if(e.exposed>0)e.exposed-=dt;
 // 2페이즈
 if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.speed=78;e.sk=0;state.eb=[];state.fx.push(sporeFx(e.x,e.y,150,"ice"));burst(e.x,e.y,"#7affe0",30);
  state.banner={text:tx("혼등이 푸르게 타오른다… 영혼이 끌려간다!","The lanterns burn blue… your soul is being drawn in!"),t:2.4};if(e.lanterns.length<WITCH.lanternsPh2&&!e.relight){for(const l of e.lanterns)l.hp=0;witchLanterns(e,WITCH.lanternsPh2)}}
 // 등불을 모두 깸 → 결계 붕괴
 if(e.lit&&lan.length===0&&!e.relight){e.relight=WITCH.relight;e.exposed=WITCH.exposeT;e.mode="stagger";e.cd=WITCH.stunT;e.beamOn=0;e.beamWarn=0;e.pullT=0;state.eb=state.eb.filter(b=>b.home==null);
  state.fx.push(sporeFx(e.x,e.y,120,"ice"));burst(e.x,e.y,"#ffffff",24);state.banner={text:tx("결계가 깨졌다! 지금 공격하세요!","The ward is broken! Strike now!"),t:2.2};state.shake=Math.max(state.shake||0,5)}
 if(e.relight>0){e.relight-=dt;if(e.relight<=0){e.relight=0;witchLanterns(e,e.ph2?WITCH.lanternsPh2:WITCH.lanterns);state.banner={text:tx("혼등이 다시 켜졌다","The lanterns rekindle"),t:1.6}}}
 if(lan.length)e.lit=true;
 // 등불 사슬
 if(lan.length>=2&&!e.relight){e.beamT-=dt;if(e.beamT<=0&&!e.beamWarn&&!e.beamOn){e.beamWarn=WITCH.beamWarn;e.beamT=e.ph2?WITCH.beamCDPh2:WITCH.beamCD}}
 if(e.beamWarn>0){e.beamWarn-=dt;if(e.beamWarn<=0){e.beamWarn=0;e.beamOn=WITCH.beamOn;burst(p.x,p.y,"#7affe0",0)}}
 if(e.beamOn>0){e.beamOn-=dt;if(e.beamOn<0)e.beamOn=0;if(p.invuln<=0&&lan.length>=2)for(let i=0;i<lan.length;i++){const a=lan[i],b=lan[(i+1)%lan.length];if(lan.length===2&&i===1)break;if(segDist(p,a,b)<p.r+5){p.hp-=WITCH.beamDmg*(p.guard||1);p.invuln=.8;burst(p.x,p.y,"#7affe0",10);if(p.hp<=0){p.hp=0;die()}break}}}
 const m=e.mode,d=Math.hypot(p.x-e.x,p.y-e.y);
 const drift=k=>{const want=d>200?1:d<130?-.8:0;e.x+=(ux*want+(-uy)*.5)*e.speed*k*dt;e.y+=(uy*want+ux*.5)*e.speed*k*dt;e.x=clamp(e.x,30,WW-30);e.y=clamp(e.y,50,WH-30)};
 if(m==="enter"){e.y+=90*dt;if(e.cd<=0||e.y>cam.y+120){e.mode="chase";e.cd=1.2;witchLanterns(e,WITCH.lanterns);state.banner={text:tx("혼등을 깨면 결계가 풀려요!","Break the lanterns to drop her ward!"),t:2.6}}}
 else if(m==="stagger"){if(e.cd<=0){e.mode="chase";e.cd=1}}
 else if(m==="chase"){drift(1);
  if(e.cd<=0){const L=e.ph2?["spiral","wisps","pull","swap","spiral","wisps"]:["spiral","wisps","swap"],s=L[e.sk++%L.length];
   if(s==="swap"&&!lan.length){e.mode="spiral";e.cd=2.4;e.spinT=0}
   else if(s==="spiral"){e.mode="spiral";e.cd=e.ph2?2.8:2.4;e.spinT=0}
   else if(s==="wisps"){const n=e.ph2?7:5;for(let i=0;i<n;i++){const a=i*6.283/n+e.t;state.eb.push({x:e.x+Math.cos(a)*20,y:e.y+Math.sin(a)*20,vx:Math.cos(a)*125,vy:Math.sin(a)*125,r:6,life:5,home:2.2,dmg:11,c:"#7affe0"})}burst(e.x,e.y,"#7affe0",12);e.cd=e.ph2?2.2:2.8}
   else if(s==="swap"){e.mode="swapAim";e.cd=.85;e.swap=lan[Math.floor(rand(0,lan.length))]}
   else if(s==="pull"){e.mode="pull";e.cd=1.9;e.pullT=1.9;state.banner={text:tx("영혼 끌어당기기!","Soul pull!"),t:1}}}}
 else if(m==="spiral"){drift(.35);e.spinT=(e.spinT||0)-dt;e.spin=(e.spin||0)+dt*(e.ph2?2.6:2.1);
  if(e.spinT<=0){e.spinT=.11;const arms=e.ph2?4:3;for(let i=0;i<arms;i++){const a=e.spin+i*6.283/arms;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*140,vy:Math.sin(a)*140,r:5,life:4,dmg:10,c:"#c89aff"})}}
  if(e.cd<=0){e.mode="chase";e.cd=e.ph2?1.2:1.6}}
 else if(m==="swapAim"){if(!e.swap||e.swap.hp<=0){e.mode="chase";e.cd=.8}else if(e.cd<=0){const l=e.swap,ox=e.x,oy=e.y;e.x=l.x;e.y=l.y;l.x=ox;l.y=oy;
   for(const o of[e,l]){state.fx.push(sporeFx(o.x,o.y,60,"ice"));for(let i=0;i<12;i++){const a=i*Math.PI/6+(o===l?Math.PI/12:0);state.eb.push({x:o.x,y:o.y,vx:Math.cos(a)*155,vy:Math.sin(a)*155,r:5,life:3.5,dmg:10,c:"#c89aff"})}}
   burst(e.x,e.y,"#ffffff",14);e.mode="chase";e.cd=e.ph2?1.3:1.8;e.swap=null}}
 else if(m==="pull"){e.pullT-=dt;if(d>30){p.x=clamp(p.x-(p.x-e.x)/d*WITCH.pull*dt,20,WW-20);p.y=clamp(p.y-(p.y-e.y)/d*WITCH.pull*dt,40,WH-20)}
  e.ringT=(e.ringT||0)-dt;if(e.ringT<=0){e.ringT=.5;for(let i=0;i<10;i++){const a=i*.628+e.t*2;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*130,vy:Math.sin(a)*130,r:5,life:3,dmg:10,c:"#9a5ae0"})}}
  if(e.cd<=0){e.mode="chase";e.cd=1.4;e.pullT=0}}
 e.t+=dt}
function drawLantern(e,t){const w=e.owner,on=w&&w.beamWarn>0,ph2=w&&w.ph2,fl=.7+.3*Math.sin(t*9+e.ph),C=ph2?"#5ac8ff":"#7affe0";
 ctx.globalAlpha=1;ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.25*fl+(on?.2:0);ctx.fillStyle=C;ctx.beginPath();ctx.arc(0,-10,26,0,6.283);ctx.fill();ctx.restore();
 ctx.fillStyle="#2a1446";ctx.fillRect(-1,-34,2,8);ctx.fillRect(-5,-26,10,3);ctx.fillStyle=e.hit>0?"#ffffff":"#1a0a2a";ctx.fillRect(-7,-23,14,20);ctx.fillRect(-5,-3,10,3);
 ctx.fillStyle=e.hit>0?"#ffffff":C;ctx.fillRect(-5,-21,10,16);ctx.fillStyle="#e8fff8";ctx.fillRect(-2,-17+Math.round(Math.sin(t*12+e.ph)),4,8);ctx.fillStyle="#2a1446";ctx.fillRect(-1,-21,2,16);ctx.fillRect(-5,-14,10,2);
 const k=e.hp/e.maxHp;ctx.fillStyle="#1a0a2a";ctx.fillRect(-10,6,20,3);ctx.fillStyle=C;ctx.fillRect(-10,6,Math.round(20*k),3)}
function drawWitch(e){const t=state.time,hit=e.hit>0,lan=e.lanterns||[],C=e.ph2?"#5ac8ff":"#7affe0";
 bossWarn(e,t);
 // 등불 사슬 (경고: 깜빡이는 점선 / 발동: 굵은 빛줄기) + 마녀와 이어진 결계 줄
 if(lan.length>=2){ctx.save();for(let i=0;i<lan.length;i++){if(lan.length===2&&i===1)break;const a=lan[i],b=lan[(i+1)%lan.length];
  if(e.beamOn>0){ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35;ctx.strokeStyle=C;ctx.lineWidth=14;ctx.beginPath();ctx.moveTo(a.x,a.y-10);ctx.lineTo(b.x,b.y-10);ctx.stroke();ctx.globalAlpha=.9;ctx.strokeStyle="#e8fff8";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(a.x,a.y-10);ctx.lineTo(b.x,b.y-10);ctx.stroke();ctx.globalCompositeOperation="source-over"}
  else{ctx.globalAlpha=e.beamWarn>0?(Math.floor(t*14)%2?.9:.35):.18;ctx.strokeStyle=e.beamWarn>0?"#ffffff":C;ctx.lineWidth=e.beamWarn>0?3:2;ctx.setLineDash([6,6]);ctx.lineDashOffset=-t*20;ctx.beginPath();ctx.moveTo(a.x,a.y-10);ctx.lineTo(b.x,b.y-10);ctx.stroke();ctx.setLineDash([])}}
  ctx.restore()}
 if(e.shieldOn){ctx.save();ctx.globalAlpha=.22;ctx.strokeStyle=C;ctx.lineWidth=1;for(const l of lan){ctx.beginPath();ctx.moveTo(l.x,l.y-10);ctx.quadraticCurveTo((l.x+e.x)/2,(l.y+e.y)/2-40,e.x,e.y-20);ctx.stroke()}ctx.restore()}
 if(e.mode==="swapAim"&&e.swap){ctx.save();ctx.globalAlpha=Math.floor(t*16)%2?.8:.3;ctx.strokeStyle="#ffffff";ctx.lineWidth=2;for(const o of[e,e.swap]){ctx.beginPath();ctx.arc(o.x,o.y-10,30,0,6.283);ctx.stroke()}ctx.restore()}
 if(e.mode==="pull"){const p=state.p;ctx.save();ctx.globalCompositeOperation="lighter";for(let i=0;i<3;i++){const k=(t*1.6+i/3)%1;ctx.globalAlpha=.4*(1-k)+.1;ctx.strokeStyle="#9a5ae0";ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,30+(1-k)*170,0,6.283);ctx.stroke()}
  ctx.globalAlpha=.5;ctx.strokeStyle="#c89aff";ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(e.x,e.y);ctx.stroke();ctx.restore()}
 ctx.save();ctx.translate(Math.round(e.x),Math.round(e.y));
 ctx.globalAlpha=.25+.1*Math.sin(t*5);ctx.fillStyle="#ff4a5a";ctx.beginPath();ctx.ellipse(0,e.r+6,e.r+12,8,0,0,6.283);ctx.fill();
 ctx.globalAlpha=.35;ctx.fillStyle="#050a08";ctx.beginPath();ctx.ellipse(0,e.r+4,e.r,6,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
 const by=-14+Math.round(Math.sin(t*2.2)*4),stun=e.mode==="stagger";
 // 결계 방울 / 노출 상태
 if(e.shieldOn){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.16+.06*Math.sin(t*4);ctx.fillStyle=C;ctx.beginPath();ctx.arc(0,by,e.r+18,0,6.283);ctx.fill();ctx.globalAlpha=.6;ctx.strokeStyle=C;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,by,e.r+18,0,6.283);ctx.stroke();ctx.restore()}
 if(e.exposed>0){ctx.globalAlpha=.5+.3*Math.sin(t*12);ctx.strokeStyle="#ff5a6a";ctx.lineWidth=3;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(0,by,e.r+12,0,6.283);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1}
 // 망토 자락 (아래로 흩날림)
 ctx.fillStyle=hit?"#ffffff":"#2a1446";for(let i=-3;i<=3;i++){const sw=Math.sin(t*4+i)*3;ctx.fillRect(i*6-3+Math.round(sw),by+16,6,10+Math.round(Math.abs(Math.sin(t*3+i))*6))}
 ctx.save();ctx.translate(0,by);if(stun)ctx.rotate(Math.sin(t*20)*.08);ctx.scale(2.4,2.4);ctx.drawImage(hit?SP.witch.f:SP.witch.n,-16,-20);ctx.restore();
 // 지팡이 + 손에 든 등불
 const sx=24,sy=by-6;ctx.fillStyle="#3a2a1a";ctx.fillRect(sx,sy-34,3,62);ctx.fillStyle="#1a0a2a";ctx.fillRect(sx-5,sy-44,13,13);ctx.fillStyle=C;ctx.fillRect(sx-3,sy-42,9,9);ctx.fillStyle="#e8fff8";ctx.fillRect(sx,sy-40,3,5);
 ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.4+.2*Math.sin(t*7);ctx.fillStyle=C;ctx.beginPath();ctx.arc(sx+1,sy-38,14,0,6.283);ctx.fill();ctx.restore();
 if(stun){ctx.fillStyle="#fff0b0";for(let i=0;i<3;i++)ctx.fillRect(Math.round(Math.cos(t*6+i*2.1)*18)-1,by-50+Math.round(Math.sin(t*6+i*2.1)*3),3,3)}
 ctx.restore()}
/* 공용: 바닥 경고 → 낙하 피해 구역 */
function zoneTick(e,dt){const p=state.p;
e.zones=e.zones||[];
for(const z of e.zones){z.t-=dt;if(!z.hit&&z.t<=0){z.hit=true;z.fade=.4;burst(z.x,z.y,z.fire?"#ff8a2a":"#bfefff",14);burst(z.x,z.y,z.fire?"#fff0a0":"#ffffff",6);if(z.fire)state.fx.push({type:"flamecol",x:z.x,y:z.y,life:.6,max:.6});
 if(p.invuln<=0&&dist2(p,z)<(z.r+p.r)**2){p.hp-=(z.dmg||16)*(p.guard||1);p.invuln=.8;burst(p.x,p.y,"#ff6b78",8);if(p.hp<=0){p.hp=0;die()}}}
 if(z.hit)z.fade-=dt}
e.zones=e.zones.filter(z=>!z.hit||z.fade>0);
}
/* ===== 얼음 바위 수호자 (N30) 패턴: 서리 고리 / 낙빙 / 바위 굴리기 / 2페이즈 폭주 ===== */
function guardianAI(e,dt,ux,uy){
const p=state.p;
if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.mode="roar";e.cd=1.3;e.sk=0;e.speed=50;state.eb=[];state.fx.push(sporeFx(e.x,e.y,140,"ice"));burst(e.x,e.y,"#bfefff",30);state.banner={text:tx("바위가 갈라지며 서리가 폭주한다!","The rock splits — the frost runs wild!"),t:2.2}}
zoneTick(e,dt);
const m=e.mode,ICE="#9fe4ff";
if(m==="roar"){if(e.cd<=0){e.mode="chase";e.cd=1.2}}
else if(m==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
 if(e.cd<=0){const L=e.ph2?["ring","rain","roll","rain"]:["ring","rain","roll"],s=L[e.sk++%L.length];
  if(s==="ring"){e.spin=(e.spin||0)+.3;for(let i=0;i<12;i++){const a=e.spin+i*Math.PI/6;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*150,vy:Math.sin(a)*150,r:5,life:4,c:ICE})}
   if(e.ph2)for(let i=0;i<12;i++){const a=e.spin+Math.PI/12+i*Math.PI/6;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*100,vy:Math.sin(a)*100,r:5,life:4,c:ICE})}
   burst(e.x,e.y,ICE,10);e.cd=e.ph2?1.7:2.2}
  else if(s==="rain"){e.mode="rain";e.vol=e.ph2?3:2;e.cd=.25;state.banner={text:tx("서리 낙빙!","Falling ice!"),t:1}}
  else{e.mode="aim";e.cd=e.ph2?.7:.95}}}
else if(m==="rain"){e.x+=ux*e.speed*.3*dt;e.y+=uy*e.speed*.3*dt;
 if(e.cd<=0){const n=e.ph2?5:3;e.zones.push({x:p.x,y:p.y,r:46,t:1.05,d:1.05});
  for(let i=0;i<n;i++){const a=rand(0,6.283),d=rand(50,170);e.zones.push({x:clamp(p.x+Math.cos(a)*d,30,WW-30),y:clamp(p.y+Math.sin(a)*d,40,WH-30),r:46,t:1.05+i*.08,d:1.05+i*.08})}
  e.vol--;e.cd=1.15;if(e.vol<=0){e.mode="chase";e.cd=2}}}
else if(m==="aim"){e.dx=ux;e.dy=uy;if(e.cd<=0){e.mode="roll";e.cd=e.ph2?1.15:.9;state.fx.push(sporeFx(e.x,e.y,50,"ice"))}}
else if(m==="roll"){e.x=clamp(e.x+e.dx*400*dt,30,WW-30);e.y=clamp(e.y+e.dy*400*dt,40,WH-30);if(Math.random()<.6)burst(e.x,e.y+e.r*.6,"#dff6ff",1);
 if(e.cd<=0){e.mode="stun";e.cd=1.2;burst(e.x,e.y,"#bfefff",24);for(let i=0;i<(e.ph2?10:6);i++){const a=i*6.283/(e.ph2?10:6);state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*170,vy:Math.sin(a)*170,r:5,life:3,c:ICE})}}}
else if(m==="stun"){if(e.cd<=0){e.mode="chase";e.cd=1.6}}}
function guardianWarn(e,t){if(!e.zones)return;
for(const z of e.zones){ctx.save();
 if(!z.hit){const k=1-z.t/z.d;ctx.globalAlpha=.16+.16*k;ctx.fillStyle=z.c1||"#7fd0ff";ctx.beginPath();ctx.ellipse(z.x,z.y,z.r,z.r*.6,0,0,6.283);ctx.fill();
  ctx.globalAlpha=.75;ctx.strokeStyle=z.t<.3&&Math.floor(t*20)%2?"#ffffff":(z.c2||"#bfefff");ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(z.x,z.y,z.r*(1-k*.25),z.r*.6*(1-k*.25),0,0,6.283);ctx.stroke();
  if(z.echo){ctx.globalAlpha=.25+.45*k;ctx.drawImage((state.p.charId==="zhuque"?SP.zhuqueA:SP.dragonA).n,Math.round(z.x)-16,Math.round(z.y)-30)}
  if(z.t<.4&&!z.echo){const h=Math.round(z.t/.4*110);ctx.globalAlpha=1;ctx.fillStyle=z.c3||"#dff6ff";ctx.beginPath();ctx.moveTo(z.x-6,z.y-h-26);ctx.lineTo(z.x+6,z.y-h-26);ctx.lineTo(z.x,z.y-h);ctx.closePath();ctx.fill();ctx.fillStyle="#7fd0ff";ctx.fillRect(Math.round(z.x)-1,Math.round(z.y-h-24),2,16)}}
 else{ctx.globalAlpha=Math.max(0,z.fade/.4)*.8;ctx.strokeStyle="#ffffff";ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(z.x,z.y,z.r*(1.1+(1-z.fade/.4)*.5),z.r*.66,0,0,6.283);ctx.stroke()}
 ctx.restore()}}
function fan(e,ux,uy,n,step,spd,c){const a0=Math.atan2(uy,ux);for(let i=0;i<n;i++){const a=a0+(i-(n-1)/2)*step;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,r:5,life:4,c})}}
function owlSlam(e){const p=state.p;state.fx.push(sporeFx(e.x,e.y,80,"ice"));burst(e.x,e.y,"#8da2ff",24);
if(dist2(p,e)<(78+p.r)**2&&p.invuln<=0){p.hp-=24*(p.guard||1);p.invuln=.8;burst(p.x,p.y,"#ff6b78",8);if(p.hp<=0){p.hp=0;die()}}
for(let i=0;i<10;i++){const a=i*Math.PI/5+e.t;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*170,vy:Math.sin(a)*170,r:5,life:3,c:"#8da2ff"})}}
function owlAI(e,dt,ux,uy){zoneTick(e,dt);
if(!e.ph2&&e.hp<=e.maxHp*.5&&e.mode==="chase"){e.ph2=true;e.speed=84;e.sk=0;state.eb=[];state.fx.push(sporeFx(e.x,e.y,130,"ice"));burst(e.x,e.y,"#8da2ff",26);state.banner={text:tx("달이 기운다… 그믐이 깊어진다!","The moon wanes… darkness deepens!"),t:2.2}}
const m=e.mode;
if(m==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
 if(e.cd<=0){const s=e.sk++%5;
  if(s===0){e.mode="feather";e.vol=e.ph2?4:3;e.cd=.4}
  else if(s===1){e.mode="moon";e.vol=e.ph2?2:1;e.cd=.5;state.banner={text:tx("초승달 부메랑!","Crescent boomerang!"),t:1}}
  else if(s===2){e.mode="rise";e.ghost=true}
  else if(s===3){e.mode="star";e.vol=e.ph2?3:2;e.cd=.3;state.banner={text:tx("별똥별이 떨어진다!","Shooting stars incoming!"),t:1}}
  else{e.mode="dark";e.dt=DARK_T;e.fcd=.8;state.dark=DARK_T;state.banner={text:tx("불빛이 꺼진다…","The lights go out…"),t:1.6}}}}
else if(m==="feather"){e.x+=ux*e.speed*.25*dt;e.y+=uy*e.speed*.25*dt;
 if(e.cd<=0){fan(e,ux,uy,e.ph2?7:5,.24,200,"#8da2ff");e.vol--;e.cd=.55;if(e.vol<=0){e.mode="chase";e.cd=2.2}}}
else if(m==="moon"){e.x+=ux*e.speed*.25*dt;e.y+=uy*e.speed*.25*dt;
 if(e.cd<=0){const n=e.ph2?5:3,a0=Math.atan2(uy,ux);for(let i=0;i<n;i++){const a=a0+(i-(n-1)/2)*.42,v=270;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,ax:-Math.cos(a)*v/1.05,ay:-Math.sin(a)*v/1.05,r:8,life:2.5,moon:true})}
  burst(e.x,e.y,"#e0e8ff",10);e.vol--;e.cd=1.2;if(e.vol<=0){e.mode="chase";e.cd=2.4}}}
else if(m==="star"){e.x+=ux*e.speed*.3*dt;e.y+=uy*e.speed*.3*dt;
 if(e.cd<=0){const p=state.p,n=e.ph2?6:4,K={c1:"#b89cff",c2:"#e8dcff",c3:"#f4eeff",dmg:18};e.zones.push({x:p.x,y:p.y,r:46,t:1.05,d:1.05,...K});
  for(let i=0;i<n;i++){const a=rand(0,6.283),d=rand(50,190);e.zones.push({x:clamp(p.x+Math.cos(a)*d,30,WW-30),y:clamp(p.y+Math.sin(a)*d,40,WH-30),r:46,t:1.05+i*.08,d:1.05+i*.08,...K})}
  e.vol--;e.cd=1.1;if(e.vol<=0){e.mode="chase";e.cd=2.2}}}
else if(m==="rise"){e.y-=520*dt;if(e.y<cam.y-70){e.mode="mark";e.cd=1.3;e.tx=state.p.x;e.ty=state.p.y}}
else if(m==="mark"){if(e.cd>.5){e.tx=state.p.x;e.ty=state.p.y}if(e.cd<=0){e.mode="slam";e.x=e.tx;e.y=cam.y-70}}
else if(m==="slam"){e.x=e.tx;e.y+=900*dt;if(e.y>=e.ty){e.y=e.ty;e.ghost=false;e.mode="chase";e.cd=2.4;owlSlam(e)}}
else if(m==="dark"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;e.dt-=dt;e.fcd-=dt;
 if(e.fcd<=0){fan(e,ux,uy,1,0,235,"#8da2ff");e.fcd=.9}
 if(e.dt<=0){e.mode="chase";e.cd=2}}}
function shadowAI(e,dt,ux,uy){
if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.mode="roar";e.cd=1.6;e.sk=0;e.speed=80;state.eb=[];state.fx.push(sporeFx(e.x,e.y,150,"dark"));burst(e.x,e.y,"#c06bff",30);state.banner={text:tx("식음이 폭주한다!","The Shadow goes berserk!"),t:2.2}}
const m=e.mode;
if(m==="roar"){if(e.cd<=0){e.mode="chase";e.cd=1.2}}
else if(m==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
 if(e.cd<=0){const L=e.ph2?["quill","summon","dash","ring","drain"]:["quill","drain"],s=L[e.sk++%L.length];
  if(s==="quill"){e.mode="quill";e.vol=e.ph2?4:3;e.cd=.3}
  else if(s==="drain"){e.mode="drain";e.dt=2.4;e.heal=0}
  else if(s==="summon"){for(let i=0;i<4;i++){const a=i*Math.PI/2+e.t;state.enemies.push(minion(e.x+Math.cos(a)*e.r,e.y+Math.sin(a)*e.r))}burst(e.x,e.y,"#b27be0",16);e.cd=2.2}
  else if(s==="dash"){e.mode="aim";e.cd=.8}
  else{e.mode="ring";e.vol=3;e.cd=.2}}}
else if(m==="quill"){e.x+=ux*e.speed*.2*dt;e.y+=uy*e.speed*.2*dt;
 if(e.cd<=0){fan(e,ux,uy,e.ph2?5:3,.26,215,"#c06bff");e.vol--;e.cd=.5;if(e.vol<=0){e.mode="chase";e.cd=2}}}
else if(m==="drain"){e.dt-=dt;
 state.gems=state.gems.filter(g=>{const vx=e.x-g.x,vy=e.y-g.y,d=Math.hypot(vx,vy)||1;
  if(d<e.r+6){const h=g.value>=5?30:15;if(e.heal<150){e.hp=Math.min(e.maxHp,e.hp+h);e.heal+=h}return false}
  g.x+=vx/d*260*dt;g.y+=vy/d*260*dt;return true});
 if(e.dt<=0){e.mode="chase";e.cd=2}}
else if(m==="aim"){e.dx=ux;e.dy=uy;if(e.cd<=0){e.mode="dash";e.cd=.5}}
else if(m==="dash"){e.x=clamp(e.x+e.dx*470*dt,30,WW-30);e.y=clamp(e.y+e.dy*470*dt,40,WH-30);if(e.cd<=0){e.mode="chase";e.cd=2}}
else if(m==="ring"){if(e.cd<=0){e.spin=(e.spin||0)+.27;for(let i=0;i<14;i++){const a=e.spin+i*Math.PI/7;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*165,vy:Math.sin(a)*165,r:5,life:4,c:"#c06bff"})}e.vol--;e.cd=.75;if(e.vol<=0){e.mode="chase";e.cd=2.2}}}}
/* ================= 마법의 탑 (무한 모드) ================= */
function floorTarget(f){const D=TOWER_DIFF;return Math.round(D.floorBase+f*D.floorPerFloor+Math.max(0,f-D.lateFrom)*D.latePerFloor)} // 층별 처치 목표
function isBossFloor(f){return f%5===0} // 5층마다 수문장
function towerTick(dt){const p=state.p;
 const tr=state.ptrail||(state.ptrail=[]);if(!tr.length||state.time-tr[tr.length-1].t>.05)tr.push({x:p.x,y:p.y,t:state.time});while(tr.length&&state.time-tr[0].t>3)tr.shift();
 if(isBossFloor(state.floor)&&!state.portal&&!state.wardenSpawned&&(state.floor%100===0?spawnDragon():spawnWarden()))state.wardenSpawned=true;
 if(!isBossFloor(state.floor)&&!state.portal&&state.floorKills>=state.floorTarget)openPortal();
 const pt=state.portal;if(pt){pt.t+=dt;if(pt.t>.6&&dist2(p,pt)<(p.r+24)**2)nextFloor()}}
function openPortal(x,y,quiet){const p=state.p;let px,py;
 if(x==null){for(let i=0;i<20;i++){const a=rand(0,6.283),d=rand(170,260);px=clamp(p.x+Math.cos(a)*d,90,WW-90);py=clamp(p.y+Math.sin(a)*d,100,WH-90);if(!TOWER_ROCKS.some(k=>Math.hypot(px-k.x,py-k.y)<k.r+50))break}}else{px=clamp(x,90,WW-90);py=clamp(y,100,WH-90)}
 {const q={x:px,y:py};rockPush(q,40);px=clamp(q.x,90,WW-90);py=clamp(q.y,100,WH-90)}
 state.portal={x:px,y:py,t:0};burst(px,py,"#b48cff",30);state.fx.push(sporeFx(px,py,70,"dark"));
 if(!quiet)state.banner={text:tx("포탈이 열렸다! 다음 층으로","The portal is open! Head upstairs"),t:2.4}}
function nextFloor(){const p=state.p;if(window.__qAdd)window.__qAdd("floor",1);toStart(p);state.floor++;state.floorKills=0;state.floorTarget=floorTarget(state.floor);state.portal=null;state.wardenSpawned=false;
 for(const e of state.enemies)burst(e.x,e.y,"#8f8ca0",4);state.enemies=[];state.eb=[];
 p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.1);p.invuln=Math.max(p.invuln,1);burst(p.x,p.y,"#e9dcff",30);
 state.altars=[];placeAltar(260);state.banner={text:`${state.floor}F`,t:2};grantRelic(p.x,p.y);hud()}
function spawnWarden(){if(state.enemies.some(e=>e.boss))return false;const k=Math.max(1,Math.floor(state.floor/5)),hp=Math.round(TOWER_DIFF.bossHp*towerHpMul());
 state.enemies.push({x:cam.x+rand(W*.25,W*.75),y:cam.y-50,type:"warden",boss:true,n:k,lv:k,ph:0,r:34,speed:40+Math.min(30,(k-1)*4),damage:Math.round(24*(1+(state.floor-1)*TOWER_DIFF.dmg*.5)),hp,maxHp:hp,color:"#9a8cff",hit:0,bladeCD:0,cd:2,mode:"chase",sk:0});
 state.banner={text:`${state.floor}F · BOSS · ${bossName("warden")}`,t:3};return true}
const stoneling=(x,y)=>{const m=towerHpMul();return{x,y,type:"stump",ph:rand(0,6.28),r:13,speed:48,hp:3*m,maxHp:3*m,hpMul:m,damage:16,color:"#9aa4b8",hit:0,bladeCD:0}};
/* 탑의 수문장 패턴: 룬 탄막 / 돌기둥 낙하 / 돌진 충격파 / 돌멩이 소환 · 체력 50% 이하 2페이즈 */
function wardenAI(e,dt,ux,uy){const p=state.p,RUNE="#b48cff",sp=1+Math.min(.5,(e.lv-1)*.08);
 if(!e.ph2&&e.hp<=e.maxHp*.5){e.ph2=true;e.mode="roar";e.cd=1.3;e.sk=0;e.speed*=1.25;state.eb=[];state.fx.push(sporeFx(e.x,e.y,150,"dark"));burst(e.x,e.y,RUNE,30);state.banner={text:tx("룬이 깨어난다! 수문장이 분노한다!","The runes awaken! The Warden is enraged!"),t:2.2}}
 zoneTick(e,dt);const m=e.mode;
 if(m==="roar"){if(e.cd<=0){e.mode="chase";e.cd=1}}
 else if(m==="chase"){e.x+=ux*e.speed*dt;e.y+=uy*e.speed*dt;
  if(e.cd<=0){const L=e.ph2?["ring","pillar","slam","summon","pillar"]:["ring","pillar","slam","summon"],s=L[e.sk++%L.length];
   if(s==="ring"){e.mode="ring";e.vol=e.ph2?3:2;e.cd=.2}
   else if(s==="pillar"){e.mode="pillar";e.vol=e.ph2?3:2;e.cd=.3;state.banner={text:tx("돌기둥이 무너진다!","The pillars are collapsing!"),t:1}}
   else if(s==="slam"){e.mode="aim";e.cd=e.ph2?.6:.85}
   else{const n=e.ph2?4:3;for(let i=0;i<n;i++){const a=i*6.283/n+e.t;state.enemies.push(stoneling(e.x+Math.cos(a)*(e.r+10),e.y+Math.sin(a)*(e.r+10)))}burst(e.x,e.y,"#8f8ca0",18);e.cd=e.ph2?1.8:2.4}}}
 else if(m==="ring"){if(e.cd<=0){e.spin=(e.spin||0)+.21;const n=e.ph2?18:14;for(let i=0;i<n;i++){const a=e.spin+i*6.283/n;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*150*sp,vy:Math.sin(a)*150*sp,r:5,life:4,c:RUNE})}burst(e.x,e.y,RUNE,8);e.vol--;e.cd=.7;if(e.vol<=0){e.mode="chase";e.cd=e.ph2?1.6:2.2}}}
 else if(m==="pillar"){e.x+=ux*e.speed*.3*dt;e.y+=uy*e.speed*.3*dt;
  if(e.cd<=0){const n=e.ph2?6:4,K={c1:"#8f8ca0",c2:"#d6d0e8",c3:"#b9b4c8",dmg:Math.round(18*(1+(e.lv-1)*.12))};e.zones.push({x:p.x,y:p.y,r:44,t:1,d:1,...K});
   for(let i=0;i<n;i++){const a=rand(0,6.283),d=rand(60,200);e.zones.push({x:clamp(p.x+Math.cos(a)*d,30,WW-30),y:clamp(p.y+Math.sin(a)*d,40,WH-30),r:44,t:1+i*.07,d:1+i*.07,...K})}
   e.vol--;e.cd=1.1;if(e.vol<=0){e.mode="chase";e.cd=2}}}
 else if(m==="aim"){e.dx=ux;e.dy=uy;if(e.cd<=0){e.mode="slam";e.cd=e.ph2?.7:.55}}
 else if(m==="slam"){e.x=clamp(e.x+e.dx*440*dt,30,WW-30);e.y=clamp(e.y+e.dy*440*dt,40,WH-30);
  if(e.cd<=0){e.mode="stun";e.cd=1;state.fx.push(sporeFx(e.x,e.y,90,"dark"));burst(e.x,e.y,"#b9b4c8",24);const n=e.ph2?14:10;for(let i=0;i<n;i++){const a=i*6.283/n;state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*175*sp,vy:Math.sin(a)*175*sp,r:5,life:3,c:"#d6d0e8"})}}}
 else if(m==="stun"){if(e.cd<=0){e.mode="chase";e.cd=1.5}}}
function drawWarden(e){const t=state.time,hit=e.hit>0,im=hit?SP.warden.f:SP.warden.n,S=3;
 ctx.save();ctx.translate(Math.round(e.x),Math.round(e.y));
 ctx.globalAlpha=.25+.1*Math.sin(t*5);ctx.fillStyle=e.ph2?"#c06bff":"#7a5ac8";ctx.beginPath();ctx.ellipse(0,e.r-4,e.r+16,11,0,0,6.283);ctx.fill();
 ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.beginPath();ctx.ellipse(0,e.r-6,e.r+4,7,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
 if(e.mode==="aim"){ctx.strokeStyle="rgba(180,140,255,.6)";ctx.lineWidth=6;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(e.dx*600,e.dy*600);ctx.stroke();ctx.setLineDash([])}
 ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=(e.ph2?.35:.2)+.08*Math.sin(t*4);ctx.strokeStyle="#b48cff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-6,e.r+14+Math.sin(t*3)*2,0,6.283);ctx.stroke();
 for(let i=0;i<8;i++){const a=t*.8+i*.785;ctx.fillStyle="#d6c4ff";ctx.fillRect(Math.round(Math.cos(a)*(e.r+14))-2,Math.round(-6+Math.sin(a)*(e.r+14))-2,4,4)}ctx.restore();
 const fb=Math.sin(t*3)*4,sl=e.mode==="slam"||e.mode==="stun";
 for(const d of [-1,1]){const fx=d*(e.r+16),fy=-4+(sl?14:fb*d);ctx.fillStyle="#141218";ctx.fillRect(fx-10,fy-10,20,20);ctx.fillStyle=hit?"#fff4d8":"#6b6878";ctx.fillRect(fx-8,fy-8,16,16);ctx.fillStyle=hit?"#fff4d8":"#8f8ca0";ctx.fillRect(fx-8,fy-8,16,5);ctx.fillStyle="#b48cff";ctx.fillRect(fx-2,fy-1,4,4)}
 if(e.mode==="aim")ctx.translate(Math.round(Math.sin(t*60)*2),0);
 ctx.scale(S,S);ctx.translate(0,-Math.round(Math.abs(Math.sin(t*2.4))));ctx.drawImage(im,-16,-19);
 ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.6+.4*Math.sin(t*6);ctx.fillStyle=e.ph2?"#ff6ad5":"#d6c4ff";ctx.fillRect(-10,-13,4,3);ctx.fillRect(6,-13,4,3);
 ctx.restore();
 if(e.mode==="stun"){ctx.fillStyle="#fff0b0";for(let i=0;i<3;i++)ctx.fillRect(Math.round(e.x+Math.cos(t*6+i*2.1)*40)-2,Math.round(e.y-70+Math.sin(t*6+i*2.1)*6),4,4)}}
/* ================= 100층 보스: 흑룡왕 아스트라 =================
   흑철 갑옷 · 용암 균열 · 찢긴 불꽃 날개의 오리지널 용왕 (저해상도에 그려 외곽선 처리 후 확대 → 도트 느낌)
   용의 숨결(부채꼴 휩쓸기) · 잔불의 메아리(1.2초 전 내 위치에서 불기둥) · 업화의 낙인(화염 룬을 잇는 용암 레이저) · 흑요 비늘(내 공격이 반사) */
/* ================= 흑룡왕 3D 도트 렌더러 =================
   외부 라이브러리 없이 작은 3D 모델(타원체·튜브·뿔·날개막)을 저해상도 버퍼에 직접 래스터화하고
   부드러운 명암을 7단계 팔레트로 양자화(디더링) → 테두리 빛 · 부위 경계선 · 1px 외곽선을 입혀 도트처럼 보이게 한다 */
const D3K=(()=>{
const BW=300,BH=236,CX=150,CY=160,SC=1,PITCH=.4;
const hex=h=>{const n=parseInt(h.slice(1),16);return(0xff000000|((n&255)<<16)|(n&0xff00)|(n>>16))>>>0};
const MAT=[null,
 {r:["#060407","#100c12","#1b151d","#281f2a","#382d38","#4e414a","#6c5a5a"].map(hex),crack:1},           // 1 갑옷
 {r:["#09070a","#18131a","#29222b","#3f3640","#5c5258","#857870","#b8a692"].map(hex)},                   // 2 뿔·뼈·발톱
 {r:["#120205","#290509","#46090c","#6c120d","#98200f","#c63612","#f05c1a"].map(hex),flat:1,vein:1},     // 3 날개막
 {r:["#0c080a","#1a1216","#2a1e22","#3d2c2e","#523b38","#6c4e46","#8c6656"].map(hex)},                   // 4 배 비늘
 {r:["#5a0a02","#9c1e08","#e0400e","#ff6a14","#ffa020","#ffd060","#fff4c8"].map(hex),emit:1}];          // 5 용암·발광
const OUT=hex("#050304"),MV=24000,MT=48000;
const VX=new Float32Array(MV),VY=new Float32Array(MV),VZ=new Float32Array(MV),NX=new Float32Array(MV),NY=new Float32Array(MV),NZ=new Float32Array(MV),PX=new Float32Array(MV),PY=new Float32Array(MV),PZ=new Float32Array(MV);
const TA=new Int32Array(MT),TB=new Int32Array(MT),TC=new Int32Array(MT),TM=new Uint8Array(MT),TL=new Int8Array(MT);
const DEP=new Float32Array(BW*BH),MID=new Uint8Array(BW*BH),LVL=new Uint8Array(BW*BH),PIX=new Uint32Array(BW*BH),TRI=new Int32Array(BW*BH),W0=new Float32Array(BW*BH),W1=new Float32Array(BW*BH);
let nv=0,nt=0,cy=1,sy=0,cp=Math.cos(PITCH),sp=Math.sin(PITCH),ph2=0,T=0;
// ── 벡터
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
 crs=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],nrm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]},lerp=(a,b,k)=>add(a,mul(sub(b,a),k));
// ── 모델 좌표 → 화면(버퍼) 좌표 (Y축 회전 후 아래로 내려다보는 기울기)
function proj(p){const x1=p[0]*cy+p[2]*sy,z1=-p[0]*sy+p[2]*cy,ys=p[1]*cp-z1*sp,zs=p[1]*sp+z1*cp;return[CX+x1*SC,CY-ys*SC,zs]}
function vtx(p,n){const i=nv++;const x1=p[0]*cy+p[2]*sy,z1=-p[0]*sy+p[2]*cy;VX[i]=CX+x1*SC;VY[i]=CY-(p[1]*cp-z1*sp)*SC;VZ[i]=p[1]*sp+z1*cp;
 const n1x=n[0]*cy+n[2]*sy,n1z=-n[0]*sy+n[2]*cy;NX[i]=n1x;NY[i]=n[1]*cp-n1z*sp;NZ[i]=n[1]*sp+n1z*cp;PX[i]=p[0];PY[i]=p[1];PZ[i]=p[2];return i}
function tri(a,b,c,m,lv){if(nt>=MT)return;TA[nt]=a;TB[nt]=b;TC[nt]=c;TM[nt]=m;TL[nt]=lv==null?-1:lv;nt++}
// ── 기본 도형
function ell(c,r,m,ax,su,sv){ax=ax||[[1,0,0],[0,1,0],[0,0,1]];su=su||12;sv=sv||8;const b=nv;
 for(let i=0;i<=sv;i++){const ph=-Math.PI/2+Math.PI*i/sv,cp1=Math.cos(ph),sp1=Math.sin(ph);for(let j=0;j<su;j++){const th=6.2832*j/su,l=[cp1*Math.cos(th),sp1,cp1*Math.sin(th)];
  const p=add(c,add(add(mul(ax[0],l[0]*r[0]),mul(ax[1],l[1]*r[1])),mul(ax[2],l[2]*r[2]))),n=nrm(add(add(mul(ax[0],l[0]/r[0]),mul(ax[1],l[1]/r[1])),mul(ax[2],l[2]/r[2])));vtx(p,n)}}
 for(let i=0;i<sv;i++)for(let j=0;j<su;j++){const a=b+i*su+j,bb=b+i*su+(j+1)%su,c2=a+su,d=bb+su;tri(a,bb,d,m);tri(a,d,c2,m)}}
function tube(P,R,m,sides){sides=sides||7;const n=P.length,b=nv;let N=null;
 for(let i=0;i<n;i++){const Tg=nrm(sub(P[Math.min(n-1,i+1)],P[Math.max(0,i-1)]));if(!N){const up=Math.abs(Tg[1])>.9?[1,0,0]:[0,1,0];N=nrm(crs(Tg,up))}else N=nrm(sub(N,mul(Tg,dot(N,Tg))));const B=crs(Tg,N);
  for(let k=0;k<sides;k++){const a=6.2832*k/sides,d=add(mul(N,Math.cos(a)),mul(B,Math.sin(a)));vtx(add(P[i],mul(d,R[i])),d)}}
 for(let i=0;i<n-1;i++)for(let k=0;k<sides;k++){const a=b+i*sides+k,bb=b+i*sides+(k+1)%sides,c2=a+sides,d=bb+sides;tri(a,bb,d,m);tri(a,d,c2,m)}
 if(R[0]>1){const T0=nrm(sub(P[0],P[1])),c0=vtx(P[0],T0);for(let k=0;k<sides;k++)tri(c0,b+(k+1)%sides,b+k,m)}}
const cone=(base,tip,r,m)=>tube([base,lerp(base,tip,.55),tip],[r,r*.5,0],m,6);
function flat(a,b,c,m,lv){const n=nrm(crs(sub(b,a),sub(c,a)));tri(vtx(a,n),vtx(b,n),vtx(c,n),m,lv)}
// ── 용암 균열 / 날개 핏줄 (모델 좌표 기반 패턴)
const crackV=(x,y,z)=>Math.sin(x*.13+Math.sin(z*.11)*2.2)+Math.sin(y*.12+Math.sin(x*.09)*2.4)+Math.sin(z*.15+y*.07)*.8;
const veinV=(x,y,z)=>Math.sin(x*.13+Math.sin(z*.08)*2.6)+Math.sin(z*.07-y*.06+Math.sin(x*.05)*1.5);
// ── 래스터화 + 셰이딩 (빛: 왼쪽 위 앞쪽)
const LX=-.5,LY=.72,LZ=.48,BAY=[0,.5,.75,.25];
function raster(){DEP.fill(-1e9);TRI.fill(-1);const pulse=.5+.5*Math.sin(T*(ph2?9:4)),cth=ph2?.15:.09;
 for(let t=0;t<nt;t++){const a=TA[t],b=TB[t],c=TC[t],M=MAT[TM[t]];
  if(!M.flat&&!M.emit&&NZ[a]<-.15&&NZ[b]<-.15&&NZ[c]<-.15)continue;
  const x0=VX[a],y0=VY[a],x1=VX[b],y1=VY[b],x2=VX[c],y2=VY[c];
  const ar=(x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);if(ar>-1e-6&&ar<1e-6)continue;const ia=1/ar,z0=VZ[a],z1=VZ[b],z2=VZ[c];
  const mnx=Math.max(0,Math.floor(Math.min(x0,x1,x2))),mxx=Math.min(BW-1,Math.ceil(Math.max(x0,x1,x2))),mny=Math.max(0,Math.floor(Math.min(y0,y1,y2))),mxy=Math.min(BH-1,Math.ceil(Math.max(y0,y1,y2)));
  for(let y=mny;y<=mxy;y++){const py=y+.5;for(let x=mnx;x<=mxx;x++){const px=x+.5;
   const w0=((x1-px)*(y2-py)-(x2-px)*(y1-py))*ia;if(w0<0)continue;const w1=((x2-px)*(y0-py)-(x0-px)*(y2-py))*ia;if(w1<0||w0+w1>1)continue;
   const z=w0*z0+w1*z1+(1-w0-w1)*z2,id=y*BW+x;if(z<=DEP[id])continue;DEP[id]=z;TRI[id]=t;W0[id]=w0;W1[id]=w1}}}
 // 보이는 픽셀만 한 번씩 칠하기
 for(let id=0;id<BW*BH;id++){const t=TRI[id];if(t<0){MID[id]=0;continue}const a=TA[t],b=TB[t],c=TC[t],m=TM[t],M=MAT[m],w0=W0[id],w1=W1[id],w2=1-w0-w1,x=id%BW,y=(id/BW)|0,th=M.flat?.5:BAY[(y&1)*2+(x&1)];
  let nx=w0*NX[a]+w1*NX[b]+w2*NX[c],ny=w0*NY[a]+w1*NY[b]+w2*NY[c],nz=w0*NZ[a]+w1*NZ[b]+w2*NZ[c];const nl=Math.hypot(nx,ny,nz)||1;nx/=nl;ny/=nl;nz/=nl;
  let mm=m,lv;
  if(M.emit){if(TL[t]>=0)lv=TL[t];else{const q=2.2+Math.max(0,nz)*4.2+pulse*.8;lv=Math.min(6,Math.floor(q)+((q%1)>th?1:0))}}
  else{let back=0;if(M.flat&&nz<0){nx=-nx;ny=-ny;nz=-nz;back=1}
   let v=.1+.84*Math.pow(Math.max(0,Math.min(1,(nx*LX+ny*LY+nz*LZ)*.62+.4)),1.4);if(ny<-.5)v+=.07;if(M.flat)v=v*.62+(back?.1:0);
   const q=Math.min(5.99,v*5.6);lv=1+Math.floor(q)+((q%1)>th?1:0);if(lv>6)lv=6;
   if(M.crack||M.vein){const px3=w0*PX[a]+w1*PX[b]+w2*PX[c],py3=w0*PY[a]+w1*PY[b]+w2*PY[c],pz3=w0*PZ[a]+w1*PZ[b]+w2*PZ[c];
    if(M.crack){const cv=Math.abs(crackV(px3,py3,pz3));if(cv<cth){mm=5;const k=1-cv/cth;lv=Math.min(6,2+Math.floor(k*3+pulse*1.2+th*.5))}}
    else{const vv=Math.abs(veinV(px3,py3,pz3));if(vv<(ph2?.1:.07)){mm=5;lv=ph2?3:2}}}}
  MID[id]=mm;LVL[id]=lv}
 // ── 도트 마무리: 부위 경계선(뒤쪽 픽셀을 어둡게) · 테두리 빛(왼쪽 위 가장자리) · 1px 외곽선
 for(let y=0;y<BH;y++)for(let x=0;x<BW;x++){const id=y*BW+x,m=MID[id];
  if(!m){const nb=(x>0&&MID[id-1])||(x<BW-1&&MID[id+1])||(y>0&&MID[id-BW])||(y<BH-1&&MID[id+BW]);PIX[id]=nb?OUT:0;continue}
  let lv=LVL[id];const z=DEP[id],E=7;
  if(!MAT[m].emit&&((x>0&&MID[id-1]&&DEP[id-1]>z+E)||(x<BW-1&&MID[id+1]&&DEP[id+1]>z+E)||(y>0&&MID[id-BW]&&DEP[id-BW]>z+E)||(y<BH-1&&MID[id+BW]&&DEP[id+BW]>z+E)))lv=0;
  else if(!MAT[m].emit&&((y>0&&!MID[id-BW])||(x>0&&!MID[id-1])))lv=Math.min(6,lv+1);
  else if(m===1&&((x<BW-1&&!MID[id+1])||(y<BH-1&&!MID[id+BW]))){PIX[id]=MAT[5].r[ph2?2:1];continue}
  PIX[id]=MAT[m].r[lv]}}
// ── 흑룡왕 모델 (기본: +x 방향을 바라봄 · z+가 카메라 쪽)
function wing(side,raise,sweep,flap){const zs=side,S=[4,24,12*zs];
 const L=[[0,0,0],[14,0,30],[4,0,62],[14,0,126],[-26,0,122],[-58,0,98],[-76,0,60],[-46,0,10]];
 const tf=p=>{let x=p[0],za=p[2];const k=za/126;x+=flap*k*k*-6;const x2=x*Math.cos(sweep)-za*Math.sin(sweep),z2=x*Math.sin(sweep)+za*Math.cos(sweep);const r=raise+flap*.5*Math.min(1,k*1.6);return add(S,[x2,z2*Math.sin(r),zs*z2*Math.cos(r)])};
 const [Sh,El,Wr,F1,F2,F3,F4,Rt]=L.map(tf),F=[F1,F2,F3,F4];
 const sc=[];for(let i=0;i<3;i++)sc.push(lerp(lerp(F[i],F[i+1],.5),Wr,.15));sc.push(lerp(lerp(F4,Rt,.5),Wr,.13));
 for(let i=0;i<3;i++){flat(Wr,F[i],sc[i],3);flat(Wr,sc[i],F[i+1],3)}flat(Wr,F4,sc[3],3);flat(Wr,sc[3],Rt,3);flat(Wr,Rt,El,3);flat(El,Rt,Sh,3);
 if(ph2){const E=[F1,sc[0],F2,sc[1],F3,sc[2],F4,sc[3],Rt];for(let i=0;i<E.length-1;i++){const A=E[i],B=E[i+1],A2=lerp(A,Wr,.07),B2=lerp(B,Wr,.07),lv=4+((i+Math.floor(T*10))%2);flat(A,B,B2,5,lv);flat(A,B2,A2,5,lv)}}
 tube([Sh,lerp(Sh,El,.5),El],[5,4.2,3.6],1,7);tube([El,lerp(El,Wr,.5),Wr],[3.6,3.1,2.8],1,7);ell(Wr,[3.6,3.6,3.6],1,null,8,6);
 for(const f of F)tube([Wr,lerp(Wr,f,.5),f],[2.6,1.8,.5],1,5);
 cone(Wr,add(Wr,[8,10,zs*2]),2.2,2)}
function head(H,hp,jaw){const hf=[Math.cos(hp),Math.sin(hp),0],hu=[-Math.sin(hp),Math.cos(hp),0],hs=[0,0,1],AX=[hf,hu,hs],h=(a,b,c)=>add(H,add(add(mul(hf,a),mul(hu,b)),mul(hs,c)));
 // 왕관 뿔 (뒤로 휘다 갈고리처럼 꺾임) · 볼 뿔 · 정수리 가시
 for(const s of[-1,1]){tube([h(-3,8,6*s),h(-15,17,9*s),h(-29,22,12*s),h(-42,18,13*s),h(-49,9,12*s),h(-47,3,11*s)],[4.8,4,3,2,1,.1],2,7);
  tube([h(-1,-2,9*s),h(-14,-4,14*s),h(-24,-1,17*s)],[3,2,.1],2,6);cone(h(8,-6,8*s),h(2,-11,13*s),1.8,2)}
 for(let k=0;k<3;k++)cone(h(6-k*6,8.5-k,0),h(2-k*7,17-k*1.5,0),2.2,2);
 ell(h(3,3,0),[15,10,10.5],1,AX,12,8);
 for(const s of[-1,1])ell(h(12,8,6.5*s),[9,2.8,3.2],1,AX,8,6);
 tube([h(11,2,0),h(25,-.5,0),h(39,-3.5,0)],[8.6,6.8,4.4],1,7);
 const ja=jaw*.6,jd=add(mul(hf,Math.cos(ja)),mul(hu,-Math.sin(ja))),ju=add(mul(hf,Math.sin(ja)),mul(hu,Math.cos(ja))),J0=h(0,-5,0),j=(a,b,c)=>add(J0,add(add(mul(jd,a),mul(ju,b)),mul(hs,c)));
 tube([J0,j(18,-2,0),j(34,-2.5,0)],[7,5.2,3.2],1,7);
 for(const a of[16,22,28,34])for(const s of[-1,1])cone(h(a,-4,3.4*s),h(a,-8.5,3.4*s),1.2,2);
 for(const a of[14,21,28])for(const s of[-1,1])cone(j(a,2,3*s),j(a,6.5,3*s),1.1,2);
 if(jaw>.05){const g=Math.min(1,jaw*1.6);flat(h(4,-4,0),h(36,-5.5,0),j(32,0,0),5,Math.round(3+g*3));flat(h(4,-4,0),j(32,0,0),j(6,0,0),5,Math.round(3+g*3))}
 for(const s of[-1,1])ell(h(15,5.5,7.6*s),[3.2,1.3,1.2],5,AX,8,5);
 for(const s of[-1,1])ell(h(38.5,-.5,2.4*s),[.9,.9,.9],5,AX,6,4);
 return{mouth:h(40,-6,0),eyeN:h(15,5.5,7.6),core:null}}
function leg(hip,knee,ank,foot,R,s){tube([hip,knee,ank],R,1,7);ell(foot,[8.5,3.4,5],1,null,10,6);
 for(const k of[-1,0,1])cone(add(foot,[6,-1,k*3.4*s]),add(foot,[14,-5,k*5*s]),1.8,2)}
function model(o){const fl=o.flap,ss=o.lunge||0,tw=o.tsw;
 const r=o.wingUp;wing(-1,r,.24,fl);
 // 꼬리 (철퇴 끝)
 const TP=[],TR=[];for(let i=0;i<=24;i++){const t=i/24;TP.push([-40-t*112,4-Math.sin(t*Math.PI*.9)*12+t*t*16,Math.sin(tw+t*3.2)*13*t]);TR.push(15*(1-t)+2.6)}
 tube(TP,TR,1,7);for(let i=3;i<23;i+=3){const p=TP[i],r2=TR[i];cone(add(p,[0,r2*.8,0]),add(p,[-6,r2*.8+7,0]),2.6,2)}
 const cl=TP[24];ell(cl,[9,7.5,7.5],1,null,10,7);for(const d of[[0,1,0],[0,-.2,1],[0,-.2,-1],[-1,.15,0]])cone(add(cl,mul(d,6)),add(cl,mul(d,17)),3.2,2);
 // 뒷다리 · 몸통 · 앞다리
 for(const s of[-1,1]){ell([-26,-4,14*s],[14,13,8],1,null,10,7);leg([-20,-14,16*s],[-31,-29,18*s],[-22,-42,18*s],[-16,-46,18*s],[6.4,5,4],s)}
 ell([0,-7,0],[30,12,15],4,null,12,7);
 ell([8,6,0],[26,22,19],1,null,14,9);ell([-22,2,0],[24,18,17],1,null,12,8);
 ell([28.5,4,0],[7.5,7.5,7.5],5,null,10,7);
 for(const s of[-1,1])ell([22,10,8.6*s],[9,11,7.5],1,null,10,7);
 const yTop=x=>x>-7?26:19;for(const x of[14,4,-6,-16,-26,-36])cone([x,yTop(x)-3,0],[x-9,yTop(x)+14-Math.abs(x+10)*.12,0],4.2,2);
 for(const s of[-1,1]){ell([14,16,15*s],[12,9,9],1,null,10,7);cone([14,22,19*s],[8,33,27*s],3.5,2)}
 for(const s of[-1,1])leg([16,-6,15*s],[22,-24,17*s],[15,-39,17*s],[21,-44,17*s],[7.5,6,4.8],s);
 // 목 · 머리
 const N0=[24,18,0],N1=[52,30,0],H=[56+ss,60-ss*.4,0],NP=[],NR=[];for(let i=0;i<=7;i++){const t=i/7;NP.push(add(add(mul(N0,(1-t)*(1-t)),mul(N1,2*t*(1-t))),mul(H,t*t)));NR.push(12.5-t*4)}
 tube(NP,NR,1,8);for(const t of[.25,.5,.75]){const i=Math.round(t*7),p=NP[i];cone(add(p,[-2,NR[i]*.8,0]),add(p,[-9,NR[i]*.8+9,0]),3,2)}
 const an=head(H,o.headPitch,o.jaw);
 wing(1,r,.24,fl);
 an.core=[33,4,0];return an}
// ── 외부에서 부르는 함수
let cvs=null,ctx2=null,img=null;
function render(o){T=o.t;ph2=o.ph2?1:0;cy=Math.cos(o.yaw);sy=Math.sin(o.yaw);nv=0;nt=0;const an=model(o);raster();
 const P=k=>{const q=proj(an[k]);return{x:q[0],y:q[1],z:q[2]}};return{pix:PIX,mouth:P("mouth"),eye:P("eyeN"),core:P("core"),nv,nt}}
function canvas(o){const r=render(o);if(!cvs){cvs=document.createElement("canvas");cvs.width=BW;cvs.height=BH;ctx2=cvs.getContext("2d");img=ctx2.createImageData(BW,BH)}
 img.data.set(new Uint8ClampedArray(PIX.buffer));ctx2.putImageData(img,0,0);r.cvs=cvs;return r}
return{BW,BH,CX,CY,render,canvas}})();
function dragonFace(e){return(state.p.x>e.x)?1:-1}
function dragonMouth(e){return e.m3||{x:e.x+dragonFace(e)*120,y:e.y-90}}
function spawnDragon(){if(state.enemies.some(e=>e.boss))return false;const k=Math.max(1,Math.floor(state.floor/100)),hp=Math.round(TOWER_DIFF.bossHp*towerHpMul()*TOWER_DIFF.dragonMul);
 const x=cam.x+W/2,y=cam.y-260;
 state.enemies.push({x,y,type:"astra",boss:true,n:k,lv:k,ph:0,r:64,speed:120,damage:Math.round(30*(1+(state.floor-1)*TOWER_DIFF.dmg*.5)),hp,maxHp:hp,color:"#ff5a12",hit:0,bladeCD:0,cd:3,mode:"enter",sk:0,ang:Math.PI/2,mcd:0,side:1,lean:0,ghost:true,immune:true,ty:cam.y+H*.32});
 state.banner={text:`${state.floor}F · ${tx("전설","LEGEND")} · ${bossName("astra")}`,t:3.4};state.shake=8;return true}
function pastPos(sec){const tr=state.ptrail||[],t=state.time-sec;for(let i=tr.length-1;i>=0;i--)if(tr[i].t<=t)return tr[i];return tr[0]||state.p}
function segDist(p,a,b){const vx=b.x-a.x,vy=b.y-a.y,l=vx*vx+vy*vy||1,k=clamp(((p.x-a.x)*vx+(p.y-a.y)*vy)/l,0,1);return Math.hypot(p.x-(a.x+vx*k),p.y-(a.y+vy*k))}
function mirrorHit(e){if(e.mcd>0)return;e.mcd=.12;const p=state.p,a=Math.atan2(p.y-e.y,p.x-e.x)+rand(-.15,.15);state.eb.push({x:e.x,y:e.y,vx:Math.cos(a)*240,vy:Math.sin(a)*240,r:5,life:3,c:"#ff8a2a"});burst(e.x,e.y,"#ffb02a",3)}
const FIRE_C=["#fff0a0","#ffd04a","#ffb02a","#ff8a2a","#ff5a12","#e0301a"];
function fireP(x,y,vx,vy,life,size){state.particles.push({x,y,vx,vy,life,max:life,color:FIRE_C[Math.floor(rand(0,FIRE_C.length))],size})}
function ringFx(x,y,r0,r1,life,c,w,sq){state.fx.push({type:"ring",x,y,r0,r1,life,max:life,c,w:w||10,sq:sq||.45})}
function dragonImpact(e,big){state.shake=Math.max(state.shake||0,big?16:10);ringFx(e.x,e.y+100,40,big?300:210,.7,"#ffb02a",14);ringFx(e.x,e.y+100,30,big?210:140,.5,"#fff0a0",8);state.fx.push(sporeFx(e.x,e.y+60,big?150:110,"fire"));
 for(let i=0;i<40;i++){const a=rand(0,6.283),v=rand(120,380);fireP(e.x,e.y+90,Math.cos(a)*v,Math.sin(a)*v*.5-60,rand(.4,.9),rand(2,5))}}
function dragonAI(e,dt,ux,uy){const p=state.p,dmg=e.damage,ph2=e.ph2;
 e.mcd=Math.max(0,(e.mcd||0)-dt);
 // 몸 주위에서 솟아오르는 불티
 for(let i=0;i<(ph2?4:2);i++)fireP(e.x+rand(-110,110),e.y+rand(-60,60),rand(-15,15),rand(-110,-40),rand(.5,1.1),rand(2,4));
 if(ph2&&Math.random()<.8)for(const sd of[-1,1])fireP(e.x+sd*rand(40,190),e.y-rand(120,200),rand(-20,20),rand(-80,-30),rand(.4,.8),rand(2,4));
 if(!ph2&&e.hp<=e.maxHp*.5&&e.mode==="chase"){e.ph2=true;e.speed*=1.3;state.eb=[];state.flash=.9;state.flashC="#fff4d8";state.shake=18;dragonImpact(e,true);
  state.banner={text:tx("아스트라가 업화를 깨운다!","Astra unleashes the hellfire!"),t:2.6};e.cd=1.4}
 zoneTick(e,dt);
 const steer=(gx,gy,sp,turn)=>{let d=Math.atan2(gy-e.y,gx-e.x)-e.ang;d=Math.atan2(Math.sin(d),Math.cos(d));e.ang+=clamp(d,-turn*dt,turn*dt);e.x=clamp(e.x+Math.cos(e.ang)*sp*dt,60,WW-60);e.y=clamp(e.y+Math.sin(e.ang)*sp*dt,80,WH-70);
  const c=Math.cos(e.ang);if(Math.abs(c)>.2)e.side=c>0?1:-1;e.lean+=(clamp(c*.1,-.1,.1)-e.lean)*Math.min(1,dt*4)};
 const m=e.mode;
 if(m==="enter"){e.y+=420*dt;fireP(e.x+rand(-30,30),e.y-40,rand(-20,20),rand(-200,-80),rand(.4,.8),rand(3,5));
  if(e.y>=e.ty){e.ghost=false;e.immune=false;e.mode="chase";e.cd=2;state.flash=.45;state.flashC="#ff5a12";dragonImpact(e,true)}}
 else if(m==="chase"){steer(p.x+Math.sin(e.t*1.7)*150,p.y-170+Math.cos(e.t*1.3)*70,e.speed,2.4);
  if(e.cd<=0){const L=ph2?["breath","constellation","echo","mirror","breath"]:["breath","echo","constellation","mirror"],sk=L[e.sk++%L.length];
   if(sk==="breath"){e.mode="breathAim";e.cd=.9;e.bDir=Math.random()<.5?-1:1}
   else if(sk==="echo"){e.mode="echo";e.cd=.35;e.vol=ph2?12:8;state.banner={text:tx("잔불의 메아리 — 지나온 자리가 불타오른다!","Embers of the Past — your trail erupts!"),t:2}}
   else if(sk==="constellation"){e.mode="rise";e.ghost=true;e.immune=true;state.banner={text:tx("업화의 낙인!","Hellfire Brand!"),t:1.6}}
   else{e.mode="mirror";e.mirror=true;e.cd=ph2?6:5;const n=ph2?5:4;for(let i=0;i<n;i++){const a=i*6.283/n;state.enemies.push(stoneling(clamp(p.x+Math.cos(a)*160,40,WW-40),clamp(p.y+Math.sin(a)*160,50,WH-40)))}state.banner={text:tx("흑요 비늘 — 공격이 되돌아온다!","Obsidian Scales — your attacks bounce back!"),t:2.2}}}}
 else if(m==="breathAim"){steer(p.x,p.y-190,40,1.5);const mo=dragonMouth(e);e.bA=Math.atan2(p.y-mo.y,p.x-mo.x)-e.bDir*.7;
  if(Math.random()<.6)fireP(mo.x+rand(-6,6),mo.y+rand(-4,4),rand(-30,30),rand(-30,10),rand(.2,.4),rand(2,4));
  if(e.cd<=0){e.mode="breath";e.cd=ph2?1.8:1.4;state.shake=Math.max(state.shake||0,6)}}
 else if(m==="breath"){e.bA+=e.bDir*(ph2?1.9:1.4)/(ph2?1.8:1.4)*dt;const mo=dragonMouth(e);
  for(let i=0;i<7;i++){const a=e.bA+rand(-.17,.17),v=rand(260,480);fireP(mo.x,mo.y,Math.cos(a)*v,Math.sin(a)*v,rand(.45,.85),rand(3,6))}
  state.shake=Math.max(state.shake||0,3);
  const dx=p.x-mo.x,dy=p.y-mo.y;let da=Math.atan2(dy,dx)-e.bA;da=Math.atan2(Math.sin(da),Math.cos(da));
  if(Math.hypot(dx,dy)<400&&Math.abs(da)<.2&&p.invuln<=0){p.hp-=dmg*.8*(p.guard||1);p.invuln=.6;burst(p.x,p.y,"#ff6b78",8);if(p.hp<=0){p.hp=0;die()}}
  if(e.cd<=0){e.mode="chase";e.cd=ph2?1.4:2}}
 else if(m==="echo"){steer(p.x,p.y-170,e.speed*.5,2);
  if(e.cd<=0){const q=pastPos(1.2);e.zones.push({x:q.x,y:q.y,r:38,t:.55,d:.55,echo:true,fire:true,c1:"#ff5a12",c2:"#ffd04a",c3:"#fff0a0",dmg:Math.round(dmg*.7)});e.vol--;e.cd=ph2?.28:.35;if(e.vol<=0){e.mode="chase";e.cd=1.8}}}
 else if(m==="rise"){e.y-=560*dt;fireP(e.x+rand(-40,40),e.y+40,rand(-20,20),rand(40,120),rand(.3,.6),rand(3,5));
  if(e.y<cam.y-280){e.mode="stars";e.cd=ph2?1.4:1.6;const n=ph2?7:5;e.stars=[];for(let i=0;i<n;i++)e.stars.push({x:clamp(p.x+rand(-W*.42,W*.42),40,WW-40),y:clamp(p.y+rand(-H*.4,H*.4),50,WH-40)});e.stars.splice(Math.floor(rand(0,n)),0,{x:p.x,y:p.y})}}
 else if(m==="stars"){if(e.cd<=0){e.mode="laser";e.cd=.45;e.lHit=false;state.shake=Math.max(state.shake||0,8)}}
 else if(m==="laser"){const S=e.stars;
  for(let i=0;i<S.length-1;i++){const k=Math.random();fireP(S[i].x+(S[i+1].x-S[i].x)*k,S[i].y+(S[i+1].y-S[i].y)*k,rand(-40,40),rand(-120,-30),rand(.3,.6),rand(2,4))}
  if(!e.lHit&&p.invuln<=0)for(let i=0;i<S.length-1;i++)if(segDist(p,S[i],S[i+1])<p.r+8){p.hp-=dmg*(p.guard||1);p.invuln=.8;e.lHit=true;burst(p.x,p.y,"#ff6b78",10);if(p.hp<=0){p.hp=0;die()}break}
  if(e.cd<=0){for(const st of S){burst(st.x,st.y,"#ffb02a",12);ringFx(st.x,st.y,6,60,.4,"#ff8a2a",6,1)}const last=S[S.length-1];e.stars=null;e.mode="dive";e.x=last.x;e.y=cam.y-280;e.ang=Math.PI/2;e.dty=last.y-90}}
 else if(m==="dive"){e.y+=760*dt;for(let i=0;i<3;i++)fireP(e.x+rand(-30,30),e.y-30,rand(-30,30),rand(-260,-120),rand(.3,.6),rand(3,6));
  if(e.y>=e.dty){e.y=e.dty;e.ghost=false;e.immune=false;e.mode="chase";e.cd=2;dragonImpact(e,ph2);const n=ph2?18:12;for(let i=0;i<n;i++){const a=i*6.283/n;state.eb.push({x:e.x,y:e.y+30,vx:Math.cos(a)*170,vy:Math.sin(a)*170,r:5,life:3,c:"#ff8a2a"})}}}
 else if(m==="mirror"){steer(p.x+Math.cos(e.t)*230,p.y-150+Math.sin(e.t)*120,e.speed*.8,2.4);if(e.cd<=0){e.mirror=false;e.mode="chase";e.cd=1.6}}}
/* 흑룡왕 그리기: 3D 모델을 초당 15번 도트로 렌더링해 2배 확대 · 플레이어 쪽으로 실제로 몸을 돌림 */
function drawDragon(e){const t=state.time,f=dragonFace(e),x=Math.round(e.x),bob=Math.round(Math.sin(t*3)*4),y=Math.round(e.y)+bob,S=2;
 const dt=Math.max(0,Math.min(.1,t-(e._lt==null?t:e._lt)));e._lt=t;
 const ty=f>0?-.55:-Math.PI+.55;if(e.yaw3==null)e.yaw3=ty;e.yaw3+=(ty-e.yaw3)*Math.min(1,dt*3.5);
 const jt=(e.mode==="breathAim"||e.mode==="breath")?1:0;e.jaw3=(e.jaw3||0)+(jt-(e.jaw3||0))*Math.min(1,dt*8);
 if(!e._r||t-e._rt>=1/15||e._rt>t){e._rt=t;const up=(e.mode==="rise"||e.mode==="dive"||e.mode==="enter")?1.35:.95;
  e._r=D3K.canvas({t,yaw:e.yaw3,flap:Math.sin(t*(e.ph2?7:4.5)),wingUp:up,jaw:e.jaw3,headPitch:e.mode==="breath"?-.12:-.28,lunge:e.mode==="breath"?6:0,tsw:t*2.2,ph2:e.ph2})}
 const r=e._r,W2=p=>({x:x+(p.x-D3K.CX)*S,y:y+(p.y-D3K.CY)*S});e.m3=W2(r.mouth);
 ctx.save();
 if(!e.ghost){const gy=e.y+88;ctx.globalAlpha=.55;ctx.fillStyle="#050304";ctx.beginPath();ctx.ellipse(x,gy,130,22,0,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.3+.12*Math.sin(t*6);ctx.strokeStyle="#ff5a12";ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(x,gy,140+Math.sin(t*3)*5,26,0,0,6.283);ctx.stroke();
  ctx.globalAlpha=.18+.08*Math.sin(t*4+1);ctx.strokeStyle="#ffd04a";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,gy,164+Math.sin(t*2)*6,32,0,0,6.283);ctx.stroke()}
 ctx.globalCompositeOperation="lighter";const ag=ctx.createRadialGradient(x,y-30,20,x,y-30,270);ag.addColorStop(0,`rgba(255,90,20,${e.ph2?.34:.18})`);ag.addColorStop(1,"rgba(255,40,0,0)");ctx.globalAlpha=e.ghost?.4:1;ctx.fillStyle=ag;ctx.fillRect(x-270,y-300,540,540);
 ctx.globalCompositeOperation="source-over";ctx.globalAlpha=e.ghost?.3:1;ctx.imageSmoothingEnabled=false;
 const dx=x-D3K.CX*S,dy=y-D3K.CY*S,dw=D3K.BW*S,dh=D3K.BH*S;ctx.drawImage(r.cvs,dx,dy,dw,dh);
 if(e.hit>0){ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.55;ctx.drawImage(r.cvs,dx,dy,dw,dh)}
 ctx.restore();
 // 발광: 눈 · 용암 심장 · 목구멍
 ctx.save();ctx.globalCompositeOperation="lighter";
 const gd=(gx,gy,rr,rgb,a)=>{const gr=ctx.createRadialGradient(gx,gy,0,gx,gy,rr);gr.addColorStop(0,`rgba(${rgb},1)`);gr.addColorStop(1,`rgba(${rgb},0)`);ctx.globalAlpha=a*(e.ghost?.4:1);ctx.fillStyle=gr;ctx.fillRect(gx-rr,gy-rr,rr*2,rr*2)};
 const ey=W2(r.eye),co=W2(r.core);gd(ey.x,ey.y,16,e.ph2?"255,245,230":"255,200,90",.8+.2*Math.sin(t*8));
 gd(co.x,co.y,46,"255,110,30",.5+.3*Math.sin(t*(e.ph2?9:4)));
 if(jt){gd(e.m3.x,e.m3.y,e.mode==="breath"?80:50,"255,190,80",.95)}
 if(e.mirror){const yc=y-30;ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.22+.08*Math.sin(t*6);ctx.fillStyle="#0a0608";ctx.beginPath();for(let i=0;i<=6;i++){const a=i*1.047+t*.6,rr=200;i?ctx.lineTo(x+Math.cos(a)*rr,yc+Math.sin(a)*rr*.75):ctx.moveTo(x+Math.cos(a)*rr,yc+Math.sin(a)*rr*.75)}ctx.fill();
  ctx.globalCompositeOperation="lighter";ctx.lineWidth=3;for(let j=0;j<2;j++){ctx.globalAlpha=(.5+.3*Math.sin(t*10+j*3))*(j?.5:1);ctx.strokeStyle=j?"#ffd04a":"#ff5a12";ctx.beginPath();for(let i=0;i<=6;i++){const a=i*1.047+t*.6,rr=200-j*10;i?ctx.lineTo(x+Math.cos(a)*rr,yc+Math.sin(a)*rr*.75):ctx.moveTo(x+Math.cos(a)*rr,yc+Math.sin(a)*rr*.75)}ctx.stroke()}
  for(let i=0;i<6;i++){const a=i*1.047+t*.6;ctx.globalAlpha=.8;ctx.fillStyle="#fff0a0";ctx.fillRect(Math.round(x+Math.cos(a)*200)-2,Math.round(yc+Math.sin(a)*200*.75)-2,4,4)}}
 ctx.restore()}
function drawDragonFx(e){const t=state.time;guardianWarn(e,t);ctx.save();const mo=dragonMouth(e);
 const sector=(a0,a1,r,col,al)=>{ctx.globalAlpha=al;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(mo.x,mo.y);ctx.arc(mo.x,mo.y,r,Math.min(a0,a1),Math.max(a0,a1));ctx.closePath();ctx.fill()};
 if(e.mode==="breathAim"&&e.bA!=null){sector(e.bA,e.bA+e.bDir*(e.ph2?1.9:1.4),400,"#ff2a1a",.13+.09*Math.sin(t*16));ctx.globalAlpha=.7;ctx.strokeStyle="#ff6a4a";ctx.lineWidth=2;ctx.setLineDash([8,8]);ctx.beginPath();ctx.arc(mo.x,mo.y,400,Math.min(e.bA,e.bA+e.bDir*(e.ph2?1.9:1.4)),Math.max(e.bA,e.bA+e.bDir*(e.ph2?1.9:1.4)));ctx.stroke();ctx.setLineDash([])}
 if(e.mode==="breath"){ctx.globalCompositeOperation="lighter";const fl=Math.sin(t*40)*.02;sector(e.bA-.22-fl,e.bA+.22+fl,400,"#e0301a",.4);sector(e.bA-.16,e.bA+.16,385,"#ff8a2a",.5);sector(e.bA-.1,e.bA+.1,360,"#ffd04a",.55);sector(e.bA-.04,e.bA+.04,330,"#fff0a0",.7);ctx.globalCompositeOperation="source-over"}
 if(e.stars){const S=e.stars,laser=e.mode==="laser",k=laser?1:1-Math.max(0,e.cd)/(e.ph2?1.4:1.6);ctx.lineCap="round";
  for(let i=0;i<S.length-1;i++){const a=S[i],b=S[i+1],sg=clamp(k*(S.length-1)-i,0,1);if(sg<=0)break;
   if(laser){ctx.globalCompositeOperation="lighter";const j=Math.sin(t*60+i)*2;for(const [w,c,al] of [[22+j,"#c0200a",.35],[12,"#ff5a12",.7],[6,"#ffd04a",.9],[2,"#fffbe0",1]]){ctx.globalAlpha=al;ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}ctx.globalCompositeOperation="source-over"}
   else{ctx.globalAlpha=.75;ctx.strokeStyle="#ff6a3a";ctx.lineWidth=2;ctx.setLineDash([6,6]);ctx.lineDashOffset=-t*40;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x+(b.x-a.x)*sg,a.y+(b.y-a.y)*sg);ctx.stroke();ctx.setLineDash([])}}
  ctx.globalCompositeOperation="lighter";
  for(const st of S){const rr=18+Math.sin(t*6)*2;ctx.globalAlpha=.85;ctx.strokeStyle="#ff8a2a";ctx.lineWidth=2;ctx.beginPath();ctx.arc(st.x,st.y,rr,0,6.283);ctx.stroke();
   ctx.strokeStyle="#ffd04a";ctx.beginPath();for(let i=0;i<=5;i++){const a=t*2+i*2*6.283/5,px=st.x+Math.cos(a)*(rr-4),py=st.y+Math.sin(a)*(rr-4);i?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.stroke();
   ctx.fillStyle="#fff0a0";ctx.beginPath();ctx.arc(st.x,st.y,4+Math.sin(t*10)*1.5,0,6.283);ctx.fill()}}
 ctx.restore()}
/* 포탈 · 층 표시 · 색조 */
function drawPortal(){const pt=state.portal;if(!pt)return;const t=state.time,o=Math.min(1,pt.t/.6),x=Math.round(pt.x),y=Math.round(pt.y);
 ctx.save();ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.beginPath();ctx.ellipse(x,y+30,32,7,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
 ctx.fillStyle="#141218";ctx.fillRect(x-30,y-36,10,66);ctx.fillRect(x+20,y-36,10,66);ctx.fillRect(x-32,y-46,64,12);
 ctx.fillStyle="#6b6878";ctx.fillRect(x-28,y-34,6,62);ctx.fillRect(x+22,y-34,6,62);ctx.fillRect(x-30,y-44,60,8);ctx.fillStyle="#8f8ca0";ctx.fillRect(x-30,y-44,60,2);ctx.fillStyle="#b48cff";ctx.fillRect(x-2,y-42,4,4);
 ctx.globalCompositeOperation="lighter";
 for(let i=0;i<4;i++){ctx.globalAlpha=o*(.25+.12*i);ctx.fillStyle=["#3a1a6a","#6a3ab8","#a06cff","#e9dcff"][i];ctx.beginPath();ctx.ellipse(x,y-4,(18-i*4)*(1+.06*Math.sin(t*4+i)),30-i*7,0,0,6.283);ctx.fill()}
 for(let i=0;i<10;i++){const a=t*2.2+i*.628,r=14+6*Math.sin(t*3+i);ctx.globalAlpha=o*.9;ctx.fillStyle="#e9dcff";ctx.fillRect(Math.round(x+Math.cos(a)*r*.7)-1,Math.round(y-4+Math.sin(a)*r*1.4)-1,2,2)}
 ctx.globalCompositeOperation="source-over";ctx.globalAlpha=o*(.7+.3*Math.sin(t*5));ctx.font="bold 12px monospace";ctx.textAlign="center";ctx.fillStyle="#e9dcff";ctx.fillText(tx("▲ 다음 층","▲ NEXT FLOOR"),x,y-54);ctx.textAlign="left";ctx.restore()}
function drawPortalArrow(){const pt=state.portal,sx=pt.x-cam.x,sy=pt.y-cam.y;if(sx>20&&sx<W-20&&sy>20&&sy<H-20)return;
 const a=Math.atan2(sy-H/2,sx-W/2),ex=clamp(sx,36,W-36),ey=clamp(sy,80,H-40);
 ctx.save();ctx.translate(ex,ey);ctx.rotate(a);ctx.globalAlpha=.7+.3*Math.sin(state.time*8);ctx.fillStyle="#b48cff";ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(-8,-10);ctx.lineTo(-8,10);ctx.closePath();ctx.fill();ctx.strokeStyle="#1a0f2a";ctx.lineWidth=2;ctx.stroke();ctx.restore()}
const HEART=[".XX.XX.","XXXXXXX","XXXXXXX",".XXXXX.","..XXX..","...X..."];
function drawLives(){const tot=TOWER_LIVES[state.diff]||3;ctx.fillStyle="#0b1510aa";ctx.fillRect(12,66,tot*18+10,18);
 for(let i=0;i<tot;i++){const full=i<state.lives;ctx.fillStyle=full?"#ff4a5a":"#3a2030";const x0=18+i*18,y0=69;HEART.forEach((r,y)=>{for(let x=0;x<7;x++)if(r[x]==="X")ctx.fillRect(x0+x*2,y0+y*2,2,2)})}}
function drawFloorUI(){drawLives();const f=state.floor||1,bossF=isBossFloor(f),r=state.portal?1:bossF?0:Math.min(1,state.floorKills/state.floorTarget);
 ctx.fillStyle="#0b1510aa";ctx.fillRect(12,34,160,30);ctx.font="bold 13px monospace";ctx.fillStyle=bossF?"#ff9aa8":"#d6c4ff";ctx.fillText(`FLOOR ${f}F`,22,50);
 ctx.fillStyle="#1d1b24";ctx.fillRect(22,55,140,4);ctx.fillStyle=state.portal?"#b48cff":bossF?"#e0526a":"#ffd54a";ctx.fillRect(22,55,Math.round(140*r),4);
 ctx.font="11px monospace";ctx.fillStyle="#b8c9b6";ctx.textAlign="right";ctx.fillText(state.portal?tx("포탈 열림","PORTAL"):bossF?"BOSS":`${state.floorKills}/${state.floorTarget}`,162,50);ctx.textAlign="left";
 if(state.portal)drawPortalArrow()}
const TOWER_TINT=[null,"rgba(70,110,190,.13)","rgba(130,70,190,.15)","rgba(190,70,70,.14)","rgba(60,160,130,.12)"];
function towerTint(){const c=TOWER_TINT[Math.floor(((state.floor||1)-1)/5)%TOWER_TINT.length];if(c){ctx.fillStyle=c;ctx.fillRect(0,0,W,H)}
 const dr=state.enemies.find(e=>e.type==="astra");if(dr){const T=state.time;ctx.fillStyle=dr.ph2?"rgba(40,4,0,.42)":"rgba(28,6,2,.28)";ctx.fillRect(0,0,W,H);
  for(let i=0;i<60;i++){const sp=dr.ph2?70:32,x=(i*97.3+Math.sin(T*.8+i)*24)%W,y=H-((i*53.7+T*sp*(1+(i%3)*.5))%(H+20));ctx.globalAlpha=.35+.4*Math.sin(T*3+i);ctx.fillStyle=i%4?"#ff8a2a":"#ffd04a";ctx.fillRect(Math.round(x),Math.round(y),i%5?2:3,i%5?2:3)}
  const vg=ctx.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,W*.65);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,`rgba(130,12,0,${(dr.ph2?.5:.28)+.1*Math.sin(T*2)})`);ctx.globalAlpha=1;ctx.fillStyle=vg;ctx.fillRect(0,0,W,H)}}
function showEnding(){rec.clear();const eid=state.p&&state.p.charId,E=CHAR_END[eid]||CHAR_END.ignis;{const h=ending.querySelector("h2"),pp=ending.querySelector("h2+p");h.removeAttribute("data-i18n");pp.removeAttribute("data-i18n");h.textContent=tx(E.t,E.te);pp.textContent=tx(E.d,E.de);let nt=ending.querySelector("#endingNote");if(!nt){nt=document.createElement("p");nt.id="endingNote";nt.style.cssText="color:#ffcf6a;font-size:14px;margin-top:4px";$("endingStats").after(nt)}const got=END_ORDER.filter(k=>rec.clearOf(k)>0).length,first=rec.clearOf(eid)===1;nt.textContent=(first?tx("📖 새 엔딩이 도감에 기록되었어요! ","📖 New ending added to the Codex! "):"📖 ")+tx("모은 엔딩 ","Endings ")+got+" / "+END_ORDER.length}$("endingStats").textContent=tx(`생존 시간 ${fmtTime(state.time)} · 처치 ${state.kills} · 레벨 ${state.level}`,`Time ${fmtTime(state.time)} · Kills ${state.kills} · Level ${state.level}`)+(state.diff==="hard"?" · HARD":"");runReport.ending();intro.ending(()=>ending.classList.remove("hidden"),eid)}
function drawEb(){for(const b of state.eb){if(b.moon){ctx.save();ctx.translate(Math.round(b.x),Math.round(b.y));ctx.rotate(state.time*14);ctx.globalAlpha=.3;ctx.fillStyle="#8da2ff";ctx.beginPath();ctx.arc(0,0,15,0,6.283);ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle="#e0e8ff";ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,8,.9,5.4);ctx.stroke();ctx.strokeStyle="#8da2ff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(2,0,6,1,5.3);ctx.stroke();ctx.restore();continue}if(b.glob){ctx.save();ctx.translate(Math.round(b.x),Math.round(b.y));ctx.globalAlpha=.3;ctx.fillStyle="#9fe4ff";ctx.beginPath();ctx.arc(0,0,11,0,6.283);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle="#2a6a9a";ctx.fillRect(-5,-5,10,10);ctx.fillStyle="#9fe4ff";ctx.fillRect(-4,-4,8,8);ctx.fillStyle="#e8fbff";ctx.fillRect(-3,-3,3,3);ctx.restore();continue}
if(b.home!=null){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.35;ctx.fillStyle="#7affe0";ctx.beginPath();ctx.arc(b.x,b.y,11,0,6.283);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle="#c8fff0";ctx.fillRect(Math.round(b.x)-3,Math.round(b.y)-3,6,6);ctx.globalAlpha=.4;ctx.fillStyle="#7affe0";ctx.fillRect(Math.round(b.x-b.vx*.04)-2,Math.round(b.y-b.vy*.04)-2,4,4);ctx.restore();continue}
const c=b.c||"#ff9a3a";ctx.globalAlpha=.25;ctx.fillStyle=c;ctx.beginPath();ctx.arc(b.x,b.y,9,0,6.283);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle=c;ctx.fillRect(Math.round(b.x)-3,Math.round(b.y)-3,6,6);ctx.fillStyle="#fff0b0";ctx.fillRect(Math.round(b.x)-1,Math.round(b.y)-1,2,2)}}
function drawDark(){const d=state.dark;if(!(d>0))return;const p=state.p,a=Math.min(1,d*2,(DARK_T-d)*3)*.9,g=ctx.createRadialGradient(p.x,p.y,50,p.x,p.y,170);g.addColorStop(0,"rgba(2,4,14,0)");g.addColorStop(1,`rgba(2,4,14,${a})`);ctx.fillStyle=g;ctx.fillRect(cam.x,cam.y,W,H);
drawEb();const o=state.enemies.find(e=>e.type==="owl");if(o){const t=state.time;ctx.globalAlpha=.35;ctx.fillStyle="#ffe27a";for(const d2 of [-21,21]){ctx.beginPath();ctx.arc(o.x+d2,o.y-6,10,0,6.283);ctx.fill()}ctx.globalAlpha=1;for(const d2 of [-21,21]){ctx.fillRect(Math.round(o.x+d2)-4,Math.round(o.y)-10,8,8)}}}
function bossWarn(e,t){guardianWarn(e,t);if(e.type==="owl"&&(e.mode==="mark"||e.mode==="slam")){const lock=e.mode==="slam"||e.cd<=.5;ctx.save();ctx.globalAlpha=lock?.5+.2*Math.sin(t*30):.22+.1*Math.sin(t*10);ctx.fillStyle="#ff4a5a";ctx.beginPath();ctx.ellipse(e.tx,e.ty+10,78,46,0,0,6.283);ctx.fill();ctx.globalAlpha=.9;ctx.strokeStyle="#ffb0b8";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(e.tx,e.ty+10,78,46,0,0,6.283);ctx.stroke();ctx.restore()}}
function drawBoss(e){if(e.type==="witch"){drawWitch(e);return}if(e.type==="taotie"){drawTaotie(e);return}if(e.type==="hundun"){drawHundun(e);return}if(e.type==="warden"){bossWarn(e,state.time);drawWarden(e);return}if(e.type==="astra"){drawDragonFx(e);drawDragon(e);return}
const t=state.time,hit=e.hit>0,k=SP[{king:"blob",lord:"bat",guardian:"stump",owl:"owl",shadow:"shadowDragon"}[e.type]],im=hit?k.f:k.n,S=3;
bossWarn(e,t);ctx.save();ctx.translate(Math.round(e.x),Math.round(e.y));
ctx.globalAlpha=.25+.1*Math.sin(t*5);ctx.fillStyle="#ff4a5a";ctx.beginPath();ctx.ellipse(0,e.r-4,e.r+14,10,0,0,6.283);ctx.fill();
ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.beginPath();ctx.ellipse(0,e.r-6,e.r+4,7,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
if((e.type==="lord"||e.type==="shadow"||e.type==="guardian")&&e.mode==="aim"){ctx.strokeStyle="rgba(255,80,90,.55)";ctx.lineWidth=6;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(e.dx*600,e.dy*600);ctx.stroke();ctx.setLineDash([])}
if(e.type==="king"){const w=Math.sin(t*3)*.05;ctx.translate(0,e.r);ctx.scale(S*(1+w),S*(1-w));ctx.drawImage(im,-14,-20);ctx.drawImage(SP.crown.n,-10,-26)}
else if(e.type==="lord"){ctx.scale(S,S);const w=Math.sin(t*22),by=-1+Math.round(Math.sin(t*8));
 for(const d of [-1,1]){ctx.fillStyle=hit?"#fff4d8":"#3a5a8a";ctx.beginPath();ctx.moveTo(d*4,by-1);ctx.lineTo(d*18,by-5+w*8);ctx.lineTo(d*13,by+3+w*4);ctx.lineTo(d*4,by+5);ctx.closePath();ctx.fill()}
 ctx.drawImage(im,-8,by-8);ctx.drawImage(SP.horns.n,-8,by-13)}
else if(e.type==="owl"){ctx.scale(S,S);const w=Math.sin(t*10),by=-2+Math.round(Math.sin(t*4));
 for(const d of [-1,1]){ctx.fillStyle=hit?"#fff4d8":"#1b2456";ctx.beginPath();ctx.moveTo(d*10,by-6);ctx.lineTo(d*26,by-12+w*7);ctx.lineTo(d*23,by+6+w*4);ctx.lineTo(d*12,by+9);ctx.closePath();ctx.fill()}
 ctx.drawImage(im,-14,by-13);ctx.drawImage(SP.moon.n,-4,by-17)}
else if(e.type==="shadow"){const ph2=e.ph2,pl=Math.sin(t*5);
 if(e.mode==="drain"){ctx.lineWidth=2;ctx.strokeStyle="#c06bff";for(let i=0;i<3;i++){const k2=(t*1.4+i/3)%1;ctx.globalAlpha=.55*(1-k2);ctx.beginPath();ctx.arc(0,0,20+(1-k2)*150,0,6.283);ctx.stroke()}ctx.globalAlpha=1}
 ctx.globalAlpha=(ph2?.35:.2)+.08*pl;ctx.fillStyle=ph2?"#d03a7a":"#7a2ab0";ctx.beginPath();ctx.ellipse(0,0,e.r+16+pl*3,e.r+20+pl*3,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
 const f=state.p.x<e.x?-1:1;ctx.scale(f*2.2,2.2);ctx.translate(0,Math.round(Math.sin(t*3)));ctx.drawImage(im,-16,-19);
 ctx.fillStyle=hit?"#fff":(ph2?"#ff2a4a":"#ff5a6a");ctx.fillRect(-8,-9,4,6);ctx.fillRect(4,-9,4,6);ctx.fillStyle="#ffd0d8";ctx.fillRect(-7,-8,2,2);ctx.fillRect(5,-8,2,2)}
else{if(e.ph2){ctx.globalAlpha=.3+.1*Math.sin(t*6);ctx.fillStyle="#9fe4ff";ctx.beginPath();ctx.ellipse(0,0,e.r+14,e.r+16,0,0,6.283);ctx.fill();ctx.globalAlpha=1}
if(e.mode==="aim")ctx.translate(Math.round(Math.sin(t*60)*2),0);if(e.mode==="roll")ctx.rotate(t*18);
ctx.scale(S,S);ctx.translate(0,-Math.round(Math.abs(Math.sin(t*3))*1));ctx.drawImage(im,-16,-19);ctx.drawImage(SP.antlers.n,-16,-27);
if(e.mode==="stun"){ctx.fillStyle="#fff0b0";for(let i=0;i<3;i++)ctx.fillRect(Math.round(Math.cos(t*6+i*2.1)*14)-1,-30+Math.round(Math.sin(t*6+i*2.1)*3),3,3)}}
ctx.restore()}
function drawBossUI(){
const b=state.enemies.find(e=>e.boss);
if(b){const w=320,x=(W-w)/2,y=H-34,f=Math.round(w*Math.max(0,b.hp)/b.maxHp);ctx.fillStyle="#0b1510";ctx.fillRect(x-3,y-3,w+6,18);ctx.fillStyle="#3a1218";ctx.fillRect(x,y,w,12);ctx.fillStyle="#c0392b";ctx.fillRect(x,y,f,12);ctx.fillStyle="#ff9aa8";ctx.fillRect(x,y,f,3);if(b.type==="shadow"){ctx.fillStyle="#f2e8cf";ctx.fillRect(x+w/2-1,y-2,2,16)}ctx.font="bold 12px monospace";ctx.textAlign="center";ctx.fillStyle="#f2e8cf";ctx.fillText(bossName(b.type),W/2,y-8);ctx.textAlign="left"}
const n=state.banner;
if(n&&n.t>0){ctx.globalAlpha=Math.min(1,n.t);ctx.font="bold 28px monospace";ctx.textAlign="center";ctx.fillStyle="#2a0a10";ctx.fillText(n.text,W/2+2,122);ctx.fillStyle="#ffd54a";ctx.fillText(n.text,W/2,120);ctx.textAlign="left";ctx.globalAlpha=1}}

// ---- 맵 (한 번만 그려서 캐시) ----
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function disc(g,cx,cy,r,c){g.fillStyle=c;for(let y=-r;y<=r;y+=2){const w=Math.floor(Math.sqrt(r*r-y*y)/2)*2;g.fillRect(cx-w,cy+y,w*2,2)}}
const pathY=x=>WH*.64+Math.sin(x/120)*42+Math.sin(x/47)*8;
const mkForestBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(7),pr=(a,b)=>a+R()*(b-a);
const greens=["#2b2326","#271f22","#2f2528","#251d20"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=greens[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 for(let i=0;i<5;i++){g.fillStyle=R()<.5?"#1d1719":"#3d3236";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
// 집으로 가는 흙길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#1a1215");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#4a3b28");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#54432d");
for(let i=0;i<140*WORLD_SCALE;i++){const x=Math.round(pr(0,WW)/2)*2,y=Math.round((pathY(x)+pr(-18,18))/2)*2;g.fillStyle=["#6a5740","#3b2e1e","#7a6850"][Math.floor(R()*3)];g.fillRect(x,y,R()<.5?2:4,2)}
// 꽃 / 풀 / 버섯 / 바위
for(let n=0;n<110*WORLD_SCALE*WORLD_SCALE;n++){
 const x=Math.round(pr(40,WW-40)/2)*2,y=Math.round(pr(56,WH-40)/2)*2;
 if(Math.abs(y-pathY(x))<30||Math.hypot(x-WW/2,y-WH/2)<44)continue;
 const q=R();
 if(q<.38){g.fillStyle="#5a3a2a";g.fillRect(x,y+2,2,4);g.fillStyle=["#ff9a4a","#ffd06a","#ff6a5a","#ffe0b0"][Math.floor(R()*4)];g.fillRect(x-2,y,6,2);g.fillRect(x,y-2,2,6);g.fillStyle="#ffd166";g.fillRect(x,y,2,2)}
 else if(q<.68){g.fillStyle="#4a3a30";g.fillRect(x,y,2,6);g.fillRect(x-3,y+2,2,4);g.fillRect(x+3,y+1,2,5);g.fillStyle="#6a5040";g.fillRect(x,y,2,3)}
 else if(q<.86){g.fillStyle="#2a1a22";g.fillRect(x-3,y+4,8,2);g.fillStyle="#e0402a";g.fillRect(x-1,y-4,3,9);g.fillRect(x-4,y,3,5);g.fillStyle="#ff9a5a";g.fillRect(x-1,y-4,1,9);g.fillRect(x-4,y,1,5);g.fillStyle="#ffe08a";g.fillRect(x-1,y-4,1,2)}
 else{disc(g,x,y,6,"#3f3a40");disc(g,x-1,y-2,4,"#625b64");g.fillStyle="#8fd6ee";g.fillRect(x-4,y-5,6,2);g.fillStyle="#857c88";g.fillRect(x-3,y-3,2,2)}}
// 테두리 숲 벽
const trees=[];
for(let x=-10;x<WW+30;x+=24){trees.push([x+pr(-6,6),pr(-2,18),pr(15,20)]);trees.push([x+12+pr(-6,6),WH-pr(2,18),pr(15,20)])}
for(let y=24;y<WH-10;y+=24){trees.push([pr(-2,16),y+pr(-6,6),pr(15,20)]);trees.push([WW-pr(2,16),y+12+pr(-6,6),pr(15,20)])}
trees.sort((a,b)=>a[1]-b[1]);
for(const [tx,ty,tr] of trees){const x=Math.round(tx),y=Math.round(ty),r=Math.round(tr);
 disc(g,x,y+4,r,"#0c0709");disc(g,x,y,r-2,"#1e1418");disc(g,x-2,y-3,r-7,"#33222a");
 for(let i=0;i<7;i++){g.fillStyle=R()<.5?"#150d10":"#4a2a30";g.fillRect(x+Math.round(pr(-r+6,r-8)/2)*2,y+Math.round(pr(-r+6,r-8)/2)*2,2,2)}}
return c};
const mkBurntBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(77),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1));
const ash=["#1d1716","#191312","#211a18","#16100f"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=ash[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 for(let i=0;i<5;i++){g.fillStyle=R()<.5?"#0d0808":"#34272a";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
// 그을린 얼룩
g.globalAlpha=.4;for(let n=0;n<90*WORLD_SCALE*WORLD_SCALE;n++)disc(g,Math.round(pr(0,WW)/2)*2,Math.round(pr(0,WH)/2)*2,ri(7,20)*2,"#0c0707");g.globalAlpha=1;
// 집으로 가는 그을린 길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#0e0809");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#33261f");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#3d2d24");
for(let i=0;i<140*WORLD_SCALE;i++){const x=Math.round(pr(0,WW)/2)*2,y=Math.round((pathY(x)+pr(-18,18))/2)*2;g.fillStyle=["#5a4a40","#1a110d","#6a5a4c"][Math.floor(R()*3)];g.fillRect(x,y,R()<.5?2:4,2)}
const free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||30)&&Math.hypot(x-WW/2,y-WH/2)>=60;
// 용암 균열
const crack=(x,y)=>{let a=pr(0,6.28);const n=ri(8,22),pts=[];for(let k=0;k<n;k++){pts.push([Math.round(x/2)*2,Math.round(y/2)*2]);a+=pr(-.7,.7);x+=Math.cos(a)*4;y+=Math.sin(a)*4}
 for(const [px,py] of pts){g.fillStyle="#2a0c08";g.fillRect(px-4,py-4,8,8)}
 for(const [px,py] of pts){g.fillStyle="#a8300f";g.fillRect(px-2,py-2,4,4)}
 for(const [px,py] of pts){g.fillStyle="#ff7a2a";g.fillRect(px-2,py-2,2,2);if(R()<.4){g.fillStyle="#ffd070";g.fillRect(px-2,py-2,2,2)}}};
for(let n=0;n<70*WORLD_SCALE;n++){const x=pr(60,WW-60),y=pr(70,WH-60);if(free(x,y,36))crack(x,y)}
// 용암 웅덩이
for(let n=0;n<14*WORLD_SCALE;n++){const x=Math.round(pr(80,WW-80)/2)*2,y=Math.round(pr(90,WH-80)/2)*2;if(!free(x,y,60))continue;const r=ri(7,13)*2;
 disc(g,x,y,r+4,"#1a0806");disc(g,x,y,r,"#b8380f");disc(g,x,y,r-4,"#ff7a2a");if(r>10)disc(g,x,y,r-8,"#ffd070")}
// 잿더미 / 그루터기 / 불씨 / 바위 / 통나무
for(let n=0;n<110*WORLD_SCALE*WORLD_SCALE;n++){
 const x=Math.round(pr(40,WW-40)/2)*2,y=Math.round(pr(56,WH-40)/2)*2;
 if(!free(x,y,30)||Math.hypot(x-WW/2,y-WH/2)<44)continue;
 const q=R();
 if(q<.3){g.fillStyle="#0b0707";g.fillRect(x-3,y,6,8);g.fillStyle="#2a1612";g.fillRect(x-3,y,6,2);g.fillStyle="#ff7a2a";g.fillRect(x-1,y+2,2,2)}
 else if(q<.55){g.fillStyle="#3a2c28";g.fillRect(x,y,2,6);g.fillRect(x-3,y+2,2,4);g.fillRect(x+3,y+1,2,5);g.fillStyle="#5a4640";g.fillRect(x,y,2,2)}
 else if(q<.75){for(let i=0;i<4;i++){g.fillStyle=["#ff9a4a","#ff6a2a","#ffd070","#e0523a"][ri(0,3)];g.fillRect(x+ri(-6,6)*2/2,y+ri(-4,4),2,2)}}
 else if(q<.9){disc(g,x,y,6,"#2a2427");disc(g,x-1,y-2,4,"#463e42");g.fillStyle="#7a5a4a";g.fillRect(x-4,y-5,4,2);g.fillStyle="#ff7a2a";g.fillRect(x+1,y+1,2,2)}
 else{g.fillStyle="#0b0707";g.fillRect(x-8,y,16,4);g.fillStyle="#2a1612";g.fillRect(x-8,y,16,1);g.fillStyle="#6a2a14";g.fillRect(x+6,y,2,4)}}
// 테두리: 불탄 나무 벽
const trees=[];
for(let x=-10;x<WW+30;x+=24){trees.push([x+pr(-6,6),pr(-2,18),pr(15,20)]);trees.push([x+12+pr(-6,6),WH-pr(2,18),pr(15,20)])}
for(let y=24;y<WH-10;y+=24){trees.push([pr(-2,16),y+pr(-6,6),pr(15,20)]);trees.push([WW-pr(2,16),y+12+pr(-6,6),pr(15,20)])}
trees.sort((a,b)=>a[1]-b[1]);
for(const [tx,ty,tr] of trees){const x=Math.round(tx),y=Math.round(ty),r=Math.round(tr);
 disc(g,x,y+4,r,"#050304");disc(g,x,y,r-2,"#0f0a0a");disc(g,x-2,y-3,r-7,"#1d1312");
 for(let i=0;i<7;i++){g.fillStyle=R()<.75?"#080505":(R()<.5?"#5a2210":"#ff7a2a");g.fillRect(x+Math.round(pr(-r+6,r-8)/2)*2,y+Math.round(pr(-r+6,r-8)/2)*2,2,2)}}
return c};

/* 현무의 맵: 얼어붙은 북해 (눈 덮인 얼음 평원 · 얼음 호수 · 눈 덮인 침엽수 벽) */
const mkFrozenBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(311),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1));
const snow=["#2b3a4a","#283646","#2f3f50","#253342"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=snow[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 for(let i=0;i<5;i++){g.fillStyle=R()<.5?"#1e2a38":"#43566a";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
// 쌓인 눈 더미 (밝은 얼룩)
g.globalAlpha=.35;for(let n=0;n<80*WORLD_SCALE*WORLD_SCALE;n++)disc(g,Math.round(pr(0,WW)/2)*2,Math.round(pr(0,WH)/2)*2,ri(8,22)*2,"#3e5266");g.globalAlpha=1;
// 둥지로 가는 눈길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#18222e");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#56708a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#6a86a0");
for(let i=0;i<140*WORLD_SCALE;i++){const x=Math.round(pr(0,WW)/2)*2,y=Math.round((pathY(x)+pr(-18,18))/2)*2;g.fillStyle=["#8aa6be","#3e5468","#a8c2d6"][Math.floor(R()*3)];g.fillRect(x,y,R()<.5?2:4,2)}
const free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||30)&&Math.hypot(x-WW/2,y-WH/2)>=60;
// 얼음 호수 (금 간 얼음판)
for(let n=0;n<12*WORLD_SCALE;n++){const x=Math.round(pr(90,WW-90)/2)*2,y=Math.round(pr(100,WH-90)/2)*2;if(!free(x,y,70))continue;const r=ri(10,20)*2;
 disc(g,x,y,r+4,"#1a2634");disc(g,x,y,r,"#3a6a8a");disc(g,x-3,y-3,r-6,"#4f86a8");
 g.fillStyle="#9fd2ec";for(let k=0;k<3;k++){let a=pr(0,6.28),px=x,py=y;for(let j=0;j<ri(5,10);j++){g.fillRect(Math.round(px/2)*2,Math.round(py/2)*2,2,2);a+=pr(-.6,.6);px+=Math.cos(a)*4;py+=Math.sin(a)*4;if(Math.hypot(px-x,py-y)>r-4)break}}
 g.fillStyle="#d8f0ff";g.fillRect(x-r/2,y-r/2,4,2);g.fillRect(x-r/2+6,y-r/2+4,2,2)}
// 얼음 결정 / 눈 덮인 풀 / 바위 / 눈사람 같은 눈덩이 / 얼어붙은 그루터기
for(let n=0;n<110*WORLD_SCALE*WORLD_SCALE;n++){
 const x=Math.round(pr(40,WW-40)/2)*2,y=Math.round(pr(56,WH-40)/2)*2;
 if(!free(x,y,30)||Math.hypot(x-WW/2,y-WH/2)<44)continue;
 const q=R();
 if(q<.3){g.fillStyle="#1a2a3a";g.fillRect(x-3,y+4,8,2);g.fillStyle="#7fd0ff";g.fillRect(x-1,y-4,3,9);g.fillRect(x-4,y,2,5);g.fillRect(x+3,y+1,2,4);g.fillStyle="#d8f4ff";g.fillRect(x-1,y-4,1,6);g.fillRect(x-4,y,1,2)}
 else if(q<.58){g.fillStyle="#4e6478";g.fillRect(x,y,2,6);g.fillRect(x-3,y+2,2,4);g.fillRect(x+3,y+1,2,5);g.fillStyle="#cfe6f5";g.fillRect(x,y,2,2);g.fillRect(x-3,y+2,2,1);g.fillRect(x+3,y+1,2,1)}
 else if(q<.78){disc(g,x,y,6,"#33404c");disc(g,x-1,y-2,4,"#4c5a68");g.fillStyle="#e4f2fc";g.fillRect(x-5,y-6,8,2);g.fillRect(x-3,y-8,4,2)}
 else if(q<.9){disc(g,x,y+2,5,"#9ab4c8");disc(g,x,y+1,4,"#d8eaf6");g.fillStyle="#ffffff";g.fillRect(x-2,y-2,2,2)}
 else{g.fillStyle="#24303c";g.fillRect(x-4,y,8,6);g.fillStyle="#cfe6f5";g.fillRect(x-5,y-1,10,2);g.fillStyle="#7fd0ff";g.fillRect(x+3,y+2,2,4)}}
// 테두리: 눈 덮인 침엽수 벽
const trees=[];
for(let x=-10;x<WW+30;x+=24){trees.push([x+pr(-6,6),pr(-2,18),pr(15,20)]);trees.push([x+12+pr(-6,6),WH-pr(2,18),pr(15,20)])}
for(let y=24;y<WH-10;y+=24){trees.push([pr(-2,16),y+pr(-6,6),pr(15,20)]);trees.push([WW-pr(2,16),y+12+pr(-6,6),pr(15,20)])}
trees.sort((a,b)=>a[1]-b[1]);
for(const [tx,ty,tr] of trees){const x=Math.round(tx),y=Math.round(ty),r=Math.round(tr);
 disc(g,x,y+4,r,"#0a1219");disc(g,x,y,r-2,"#132430");disc(g,x-2,y-3,r-7,"#c8dcea");disc(g,x-1,y-1,r-10,"#e8f4fc");
 for(let i=0;i<7;i++){g.fillStyle=R()<.5?"#0e1a24":"#ffffff";g.fillRect(x+Math.round(pr(-r+6,r-8)/2)*2,y+Math.round(pr(-r+6,r-8)/2)*2,2,2)}}
return c};

/* 백호의 맵: 은빛 억새 협곡 (달빛 억새밭 · 바위 · 협곡 절벽 벽) */
const mkCanyonBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(521),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1));
const base=["#2a2832","#27252e","#2d2b36","#24222b"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=base[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 for(let i=0;i<5;i++){g.fillStyle=R()<.5?"#1c1a22":"#3e3b48";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
// 달빛에 밝은 풀밭 얼룩
g.globalAlpha=.3;for(let n=0;n<70*WORLD_SCALE*WORLD_SCALE;n++)disc(g,Math.round(pr(0,WW)/2)*2,Math.round(pr(0,WH)/2)*2,ri(10,26)*2,"#3e3c4c");g.globalAlpha=1;
// 둥지로 가는 흙길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#15131a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#4a4352");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#56505e");
for(let i=0;i<140*WORLD_SCALE;i++){const x=Math.round(pr(0,WW)/2)*2,y=Math.round((pathY(x)+pr(-18,18))/2)*2;g.fillStyle=["#6a6478","#2e2a34","#7e7890"][Math.floor(R()*3)];g.fillRect(x,y,R()<.5?2:4,2)}
const free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||30)&&Math.hypot(x-WW/2,y-WH/2)>=60;
// 억새 덤불 / 바위 / 들꽃
const grass=(x,y,n)=>{for(let k=0;k<n;k++){const bx=x+ri(-8,8)*2/2,h=ri(6,15),lean=pr(-.35,.35);for(let j=0;j<h;j++){const xx=Math.round(bx+lean*j),c=j>h-3?"#eef0f8":j>h-6?"#c8ccd8":"#8a8ea2";g.fillStyle=c;g.fillRect(xx,y-j,2,1)}}};
for(let n=0;n<130*WORLD_SCALE*WORLD_SCALE;n++){
 const x=Math.round(pr(40,WW-40)/2)*2,y=Math.round(pr(56,WH-40)/2)*2;
 if(!free(x,y,30)||Math.hypot(x-WW/2,y-WH/2)<44)continue;
 const q=R();
 if(q<.55)grass(x,y,ri(3,7));
 else if(q<.75){disc(g,x,y,7,"#33313c");disc(g,x-1,y-2,5,"#5a5868");g.fillStyle="#a8a6b8";g.fillRect(x-4,y-6,6,2);g.fillStyle="#7a7888";g.fillRect(x+2,y-3,2,2)}
 else if(q<.88){g.fillStyle="#3a3a4a";g.fillRect(x,y,2,5);g.fillStyle=["#c8b0ff","#e8e8ff","#9ac0ff"][ri(0,2)];g.fillRect(x-2,y-2,6,2);g.fillRect(x,y-4,2,6);g.fillStyle="#ffffff";g.fillRect(x,y-2,2,2)}
 else{g.fillStyle="#1c1a22";g.fillRect(x-6,y+2,14,3);g.fillStyle="#4a4858";g.fillRect(x-6,y,14,2);g.fillStyle="#6a6878";g.fillRect(x-4,y-2,8,2)}}
// 테두리: 협곡 절벽
const cl=[];
for(let x=-10;x<WW+30;x+=22){cl.push([x+pr(-6,6),pr(-2,16),pr(16,22)]);cl.push([x+11+pr(-6,6),WH-pr(2,16),pr(16,22)])}
for(let y=22;y<WH-10;y+=22){cl.push([pr(-2,14),y+pr(-6,6),pr(16,22)]);cl.push([WW-pr(2,14),y+11+pr(-6,6),pr(16,22)])}
cl.sort((a,b)=>a[1]-b[1]);
for(const [tx,ty,tr] of cl){const x=Math.round(tx),y=Math.round(ty),r=Math.round(tr);
 disc(g,x,y+4,r,"#0c0b10");disc(g,x,y,r-2,"#24222c");disc(g,x-2,y-4,r-7,"#3e3c4a");disc(g,x-3,y-6,r-12,"#5a5868");
 for(let i=0;i<6;i++){g.fillStyle=R()<.6?"#14121a":"#8a88a0";g.fillRect(x+Math.round(pr(-r+6,r-8)/2)*2,y+Math.round(pr(-r+6,r-8)/2)*2,2,2)}}
return c};

/* 청룡의 맵: 봄비 내리는 벚꽃 계곡 (꽃잎 깔린 풀밭 · 연못 · 벚나무 벽) */
const mkBlossomBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(913),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1));
const base=["#1f3330","#1c2f2c","#223834","#1a2c29"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=base[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 for(let i=0;i<5;i++){g.fillStyle=R()<.5?"#152522":"#2e4a44";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
// 바닥에 떨어진 꽃잎
for(let n=0;n<900*WORLD_SCALE*WORLD_SCALE;n++){const x=Math.round(pr(0,WW)/2)*2,y=Math.round(pr(0,WH)/2)*2;g.fillStyle=["#ffb8d0","#f490b4","#ffe0ea"][ri(0,2)];g.fillRect(x,y,2,R()<.5?2:1)}
// 둥지로 가는 돌길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#101c1a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#4a5650");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#58645e");
for(let x=-10;x<WW+10;x+=14){const y=Math.round(pathY(x)/2)*2;g.fillStyle="#6e7a72";g.fillRect(x-4,y-3+ri(-4,4),8,6);g.fillStyle="#3a4440";g.fillRect(x-4,y+3+ri(-4,4)*0,8,1)}
const free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||30)&&Math.hypot(x-WW/2,y-WH/2)>=60;
// 연못
for(let n=0;n<12*WORLD_SCALE;n++){const x=Math.round(pr(90,WW-90)/2)*2,y=Math.round(pr(100,WH-90)/2)*2;if(!free(x,y,70))continue;const r=ri(10,18)*2;
 disc(g,x,y,r+4,"#14221f");disc(g,x,y,r,"#1e4a5a");disc(g,x-3,y-3,r-6,"#2a6a7a");g.fillStyle="#9fd8e8";g.fillRect(x-r/2,y-r/2,6,2);
 for(let k=0;k<ri(2,4);k++){const lx=x+ri(-r+8,r-8),ly=y+ri(-r+8,r-8);disc(g,lx,ly,4,"#3a8a5a");g.fillStyle="#ffb8d0";g.fillRect(lx-1,ly-2,3,2)}}
// 풀 / 꽃 / 바위 / 석등
for(let n=0;n<110*WORLD_SCALE*WORLD_SCALE;n++){
 const x=Math.round(pr(40,WW-40)/2)*2,y=Math.round(pr(56,WH-40)/2)*2;
 if(!free(x,y,30)||Math.hypot(x-WW/2,y-WH/2)<44)continue;
 const q=R();
 if(q<.4){g.fillStyle="#2e6a4a";g.fillRect(x,y,2,6);g.fillRect(x-3,y+2,2,4);g.fillRect(x+3,y+1,2,5);g.fillStyle="#4a9a6a";g.fillRect(x,y,2,2)}
 else if(q<.7){g.fillStyle="#2e5a44";g.fillRect(x,y+2,2,4);g.fillStyle=["#ffb8d0","#ffffff","#f490b4"][ri(0,2)];g.fillRect(x-2,y,6,2);g.fillRect(x,y-2,2,6);g.fillStyle="#ffe680";g.fillRect(x,y,2,2)}
 else if(q<.88){disc(g,x,y,6,"#2a3634");disc(g,x-1,y-2,4,"#46524e");g.fillStyle="#3a7a5a";g.fillRect(x-4,y-5,6,2);g.fillStyle="#ffb8d0";g.fillRect(x+1,y-4,2,1)}
 else{g.fillStyle="#1a2422";g.fillRect(x-4,y+4,8,2);g.fillStyle="#7a847e";g.fillRect(x-3,y-6,6,10);g.fillStyle="#9aa49e";g.fillRect(x-5,y-8,10,3);g.fillStyle="#ffd070";g.fillRect(x-1,y-3,2,3)}}
// 테두리: 벚나무 벽
const trees=[];
for(let x=-10;x<WW+30;x+=24){trees.push([x+pr(-6,6),pr(-2,18),pr(15,20)]);trees.push([x+12+pr(-6,6),WH-pr(2,18),pr(15,20)])}
for(let y=24;y<WH-10;y+=24){trees.push([pr(-2,16),y+pr(-6,6),pr(15,20)]);trees.push([WW-pr(2,16),y+12+pr(-6,6),pr(15,20)])}
trees.sort((a,b)=>a[1]-b[1]);
for(const [tx,ty,tr] of trees){const x=Math.round(tx),y=Math.round(ty),r=Math.round(tr);
 disc(g,x,y+4,r,"#2a0e1c");disc(g,x,y,r-2,"#c8507a");disc(g,x-2,y-3,r-7,"#f08aac");disc(g,x-3,y-5,r-12,"#ffc0d4");
 for(let i=0;i<7;i++){g.fillStyle=R()<.5?"#a03a60":"#ffe6ee";g.fillRect(x+Math.round(pr(-r+6,r-8)/2)*2,y+Math.round(pr(-r+6,r-8)/2)*2,2,2)}}
return c};

/* 황룡의 맵: 오방천궁 — 황금빛 균열이 흐르는 돌 궁궐 마당 · 어도(御道) · 중앙의 오방진 · 궁궐 담장 */
const mkPalaceBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(5151),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),ev=v=>Math.round(v/2)*2;
const base=["#2c2721","#29241e","#302a23","#27221c"];
// 박석 (넓은 돌판) 바닥
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){
 g.fillStyle=base[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);
 g.fillStyle="#373028";g.fillRect(x+2,y+2,TILE-6,2);g.fillRect(x+2,y+2,2,TILE-6);
 g.fillStyle="#16120e";g.fillRect(x,y+TILE-2,TILE,2);g.fillRect(x+TILE-2,y,2,TILE);
 for(let i=0;i<3;i++){g.fillStyle=R()<.5?"#211c17":"#3c352b";g.fillRect(x+4+Math.floor(R()*12)*2,y+4+Math.floor(R()*12)*2,2,2)}
 if(R()<.05){g.fillStyle="#8a6a2a";g.fillRect(x+TILE-2,y+ri(2,10)*2,2,ri(2,5)*2)}}
const cx0=ev(WW/2),cy0=ev(WH/2);
const free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||34)&&Math.hypot(x-cx0,y-cy0)>=140;
// 황금빛 균열 (땅의 기운)
const crack=(x,y,len,a,depth)=>{const pts=[[x,y]];let px=x,py=y;for(let i=0;i<len;i++){a+=pr(-.55,.55);px+=Math.cos(a)*6;py+=Math.sin(a)*6;pts.push([px,py]);if(depth<1&&R()<.12)crack(px,py,ri(3,6),a+pr(-1.2,1.2),depth+1)}
 for(const [w,col] of [[6,"#3a2a0e"],[4,"#a8781e"],[2,"#ffd860"]])for(let i=1;i<pts.length;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i];for(let k=0;k<=3;k++){g.fillStyle=col;g.fillRect(ev(x0+(x1-x0)*k/3)-w/2,ev(y0+(y1-y0)*k/3)-w/2,w,w)}}};
for(let n=0;n<10*WORLD_SCALE*WORLD_SCALE;n++){const x=pr(60,WW-60),y=pr(70,WH-60);if(!free(x,y,40))continue;crack(x,y,ri(5,12),pr(0,6.283),0)}
// 떨어진 은행잎
for(let n=0;n<700*WORLD_SCALE*WORLD_SCALE;n++){const x=ev(pr(0,WW)),y=ev(pr(0,WH));g.fillStyle=["#e8a820","#ffd54a","#c88a18"][ri(0,2)];g.fillRect(x,y,R()<.5?4:2,2)}
// 어도: 금테를 두른 돌길
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),30,"#120e0a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),27,"#c8902a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),24,"#5e5446");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),15,"#6c6152");
for(let x=0;x<WW;x+=72){const y=ev(pathY(x));g.fillStyle="#3e362c";g.fillRect(x-12,y-8,24,18);g.fillStyle="#8a7a62";g.fillRect(x-12,y-10,24,16);g.fillStyle="#c8902a";g.fillRect(x-8,y-6,16,2);g.fillRect(x-8,y+2,16,2);g.fillRect(x-8,y-6,2,10);g.fillRect(x+6,y-6,2,10);g.fillStyle="#ffd54a";g.fillRect(x-2,y-4,4,4)}
// 한가운데: 오방진 (북 현무 · 동 청룡 · 남 주작 · 서 백호 · 중앙 황룡)
{const cx=cx0,cy=cy0;
 disc(g,cx,cy,128,"#120e0a");disc(g,cx,cy,124,"#c8902a");disc(g,cx,cy,120,"#3a3228");disc(g,cx,cy,104,"#8a6a2a");disc(g,cx,cy,101,"#2a241e");
 for(let k=0;k<48;k++){const a=k*Math.PI/24;g.fillStyle=k%6?"#5a4418":"#ffd54a";g.fillRect(ev(cx+Math.cos(a)*112)-1,ev(cy+Math.sin(a)*112)-1,k%6?2:4,k%6?2:4)}
 for(let k=0;k<8;k++){const a=k*Math.PI/4+Math.PI/8;for(let d=40;d<98;d+=2){g.fillStyle=d%8<4?"#6a5220":"#4a3a18";g.fillRect(ev(cx+Math.cos(a)*d),ev(cy+Math.sin(a)*d),2,2)}}
 for(const [a,c1,c2] of [[-Math.PI/2,"#1e3a44","#5a9aa8"],[0,"#1e4a9a","#6ab8ff"],[Math.PI/2,"#a82a1e","#ff8a5a"],[Math.PI,"#a8acb8","#ffffff"]]){const x=ev(cx+Math.cos(a)*74),y=ev(cy+Math.sin(a)*74);disc(g,x,y,20,"#120e0a");disc(g,x,y,17,"#c8902a");disc(g,x,y,14,c1);disc(g,x-2,y-3,7,c2);g.fillStyle="#fff";g.fillRect(x-4,y-6,2,2)}
 disc(g,cx,cy,40,"#120e0a");disc(g,cx,cy,36,"#ffd54a");disc(g,cx,cy,32,"#e0a020");disc(g,cx,cy,24,"#c8881a");
 for(let k=0;k<70;k++){const a=k*.22,d=3+k*.3;g.fillStyle=k%3?"#fff0a0":"#ffd54a";g.fillRect(ev(cx+Math.cos(a)*d),ev(cy+Math.sin(a)*d),2,2)}}
// 작은 오방 문양 (흩어진 마법진)
for(let n=0;n<6*WORLD_SCALE;n++){const x=ev(pr(120,WW-120)),y=ev(pr(140,WH-120));if(!free(x,y,60))continue;
 disc(g,x,y,26,"#120e0a");disc(g,x,y,24,"#8a6a2a");disc(g,x,y,21,"#2c2620");
 [["#5a9aa8",-Math.PI/2],["#6ab8ff",0],["#ff8a5a",Math.PI/2],["#ffffff",Math.PI]].forEach(([col,a])=>{disc(g,ev(x+Math.cos(a)*14),ev(y+Math.sin(a)*14),3,col)});disc(g,x,y,4,"#ffd54a")}
// 장식: 은행나무 · 석등 · 향로 · 붉은 기둥 · 황금 연못 · 돌 부스러기
for(let n=0;n<48*WORLD_SCALE*WORLD_SCALE;n++){
 const x=ev(pr(50,WW-50)),y=ev(pr(70,WH-50));
 if(!free(x,y,38))continue;const q=R();
 if(q<.16){const r=ri(6,9)*2,L=[[0,-r*.55,r],[-r*.7,r*.1,r*.72],[r*.7,r*.1,r*.72],[0,r*.35,r*.6]];disc(g,x+4,y+r+2,r,"#16110b");g.fillStyle="#2a1a10";g.fillRect(x-2,y+r*.2,4,r);
  for(const [dx,dy,rr] of L)disc(g,ev(x+dx),ev(y+dy),ev(rr)+2,"#3a2406");for(const [dx,dy,rr] of L)disc(g,ev(x+dx),ev(y+dy),ev(rr),"#a86e10");for(const [dx,dy,rr] of L)disc(g,ev(x+dx-rr*.2),ev(y+dy-rr*.25),ev(rr*.68),"#e0a020");for(const [dx,dy,rr] of L)disc(g,ev(x+dx-rr*.35),ev(y+dy-rr*.42),ev(rr*.32),"#ffd54a");
  for(let i=0;i<6;i++){g.fillStyle=R()<.5?"#fff0a0":"#8a5a10";g.fillRect(ev(x+pr(-r,r)),ev(y+pr(-r*.9,r*.6)),2,2)}}
 else if(q<.34){g.fillStyle="#14100c";g.fillRect(x-6,y+6,12,3);g.fillStyle="#6a6052";g.fillRect(x-2,y-2,4,8);g.fillStyle="#7a705e";g.fillRect(x-5,y-10,10,8);g.fillStyle="#ffd070";g.fillRect(x-3,y-8,6,4);g.fillStyle="#fff2b0";g.fillRect(x-1,y-8,2,2);g.fillStyle="#8a806c";g.fillRect(x-7,y-14,14,4);g.fillStyle="#c8902a";g.fillRect(x-1,y-16,2,2)}
 else if(q<.46){g.fillStyle="#14100c";g.fillRect(x-8,y+4,16,3);g.fillStyle="#3a2a1a";g.fillRect(x-7,y-4,14,8);g.fillStyle="#5a4428";g.fillRect(x-6,y-3,12,2);g.fillStyle="#c8902a";g.fillRect(x-8,y-6,16,2);g.fillStyle="#3a2a1a";g.fillRect(x-6,y+4,2,3);g.fillRect(x+4,y+4,2,3);g.fillStyle="#ffb04a";g.fillRect(x-2,y-8,4,2);g.fillStyle="#8a8070";g.fillRect(x-1,y-14,2,4);g.fillRect(x+1,y-18,2,4)}
 else if(q<.58){g.fillStyle="#120e0a";g.fillRect(x-4,y+12,14,4);g.fillStyle="#4a3a2c";g.fillRect(x-7,y+8,14,6);g.fillStyle="#8a2a20";g.fillRect(x-4,y-22,8,32);g.fillStyle="#c84432";g.fillRect(x-4,y-22,3,32);g.fillStyle="#c8902a";g.fillRect(x-5,y-16,10,2);g.fillRect(x-5,y+2,10,2);g.fillStyle="#ffd54a";g.fillRect(x-1,y-10,2,8);g.fillStyle="#5a5040";g.fillRect(x-6,y-26,12,4)}
 else if(q<.63){const r=ri(8,12)*2;disc(g,x,y,r+6,"#4a4034");disc(g,x,y,r+4,"#8a7a62");disc(g,x,y,r+2,"#c8902a");disc(g,x,y,r,"#1e2034");disc(g,x-2,y-2,r-4,"#2c3050");disc(g,x+2,y+2,r-10>2?r-10:2,"#3a3a58");g.fillStyle="#ffd54a";g.fillRect(x-r/2,y-r/3,8,2);g.fillStyle="#c8902a";g.fillRect(x,y+2,6,2);for(let k=0;k<ri(1,3);k++){const lx=ev(x+pr(-r+8,r-8)),ly=ev(y+pr(-r+8,r-8));disc(g,lx,ly,4,"#3a6a3a");g.fillStyle="#ffe070";g.fillRect(lx-1,ly-3,3,3)}}
 else{g.fillStyle="#3c352b";g.fillRect(x,y,4,2);g.fillStyle="#211c17";g.fillRect(x+2,y+2,4,2);g.fillStyle=R()<.5?"#e8a820":"#ffd54a";g.fillRect(x+6,y-2,2,2)}}
// 테두리: 궁궐 담장 (기와 지붕 · 단청 · 붉은 벽)
const DC=["#e8443a","#ffd54a","#3a8a6a","#5aa8f0"];
const wallH=(y0,flip)=>{for(let x=0;x<WW;x+=4){const roofY=flip?y0+18:y0,wallY=flip?y0:y0+22;
  g.fillStyle="#2a3040";g.fillRect(x,roofY,4,22);g.fillStyle=x%12<4?"#3a4458":"#1c2230";g.fillRect(x,roofY,2,22);
  g.fillStyle="#7a1e18";g.fillRect(x,wallY,4,18);g.fillStyle="#5a140e";g.fillRect(x,wallY+(flip?0:14),4,4)}
 const ey=flip?y0+18:y0+20;g.fillStyle="#c8902a";g.fillRect(0,ey,WW,2);for(let x=0;x<WW;x+=4){g.fillStyle=DC[(x/4)%4];g.fillRect(x,ey+(flip?-4:2),2,2)}};
wallH(0,false);wallH(WH-40,true);
const wallV=(x0,flip)=>{for(let y=0;y<WH;y+=4){const roofX=flip?x0+16:x0,wallX=flip?x0:x0+20;
  g.fillStyle="#2a3040";g.fillRect(roofX,y,20,4);g.fillStyle=y%12<4?"#3a4458":"#1c2230";g.fillRect(roofX,y,20,2);
  g.fillStyle="#7a1e18";g.fillRect(wallX,y,16,4)}
 const ex=flip?x0+16:x0+18;g.fillStyle="#c8902a";g.fillRect(ex,0,2,WH);for(let y=0;y<WH;y+=4){g.fillStyle=DC[(y/4)%4];g.fillRect(ex+(flip?-4:2),y,2,2)}};
wallV(0,false);wallV(WW-36,true);
return c};

/* 기린의 맵: 구름 성소 — 해질녘 구름 위 금빛 초원 · 흰 돌길 · 성소의 빛기둥 · 구름 벽 */
const mkCloudBg=()=>{
const c=document.createElement("canvas");c.k=BG_RES;c.width=Math.ceil(WW/BG_RES);c.height=Math.ceil(WH/BG_RES);const g=(x=>(x.scale(1/BG_RES,1/BG_RES),x))(c.getContext("2d")),R=rng(7171),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),ev=v=>Math.round(v/2)*2;
const base=["#343a66","#30365f","#383f6c","#2e335a"];
for(let y=0;y<WH;y+=TILE)for(let x=0;x<WW;x+=TILE){g.fillStyle=base[Math.floor(R()*4)];g.fillRect(x,y,TILE,TILE);for(let i=0;i<4;i++){g.fillStyle=R()<.5?"#2a2f52":"#444b7a";g.fillRect(x+Math.floor(R()*15)*2,y+Math.floor(R()*15)*2,2,2)}}
const cx0=ev(WW/2),cy0=ev(WH/2),free=(x,y,m)=>Math.abs(y-pathY(x))>=(m||34)&&Math.hypot(x-cx0,y-cy0)>=120;
// 발밑의 뭉게구름 (밟고 선 구름 바다)
for(let n=0;n<26*WORLD_SCALE*WORLD_SCALE;n++){const x=ev(pr(0,WW)),y=ev(pr(0,WH)),r=ri(10,22)*2;disc(g,x+4,y+6,r,"#262a4a");disc(g,x,y,r,"#4a5288");disc(g,x-r*.3,y-r*.3,Math.round(r*.6/2)*2,"#5c66a0");disc(g,x-r*.45,y-r*.45,Math.max(2,Math.round(r*.25/2)*2),"#7a84bc")}
// 금빛 초원 섬
for(let n=0;n<10*WORLD_SCALE*WORLD_SCALE;n++){const x=ev(pr(80,WW-80)),y=ev(pr(90,WH-80));if(!free(x,y,60))continue;const r=ri(14,26)*2;disc(g,x,y+4,r+2,"#20244a");disc(g,x,y,r,"#5a7a3a");disc(g,x-2,y-2,r-6,"#7a9a42");
 for(let k=0;k<r;k++){g.fillStyle=["#ffd54a","#ffffff","#ffa8c0","#c8e86a"][ri(0,3)];g.fillRect(ev(x+pr(-r*.7,r*.7)),ev(y+pr(-r*.6,r*.6)),2,2)}}
// 흰 돌길 (금테)
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),28,"#1e2244");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),25,"#d8b04a");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),22,"#c8cce0");
for(let x=-20;x<WW+24;x+=4)disc(g,x,Math.round(pathY(x)),13,"#dde0f0");
for(let x=0;x<WW;x+=56){const y=ev(pathY(x));g.fillStyle="#9aa0c0";g.fillRect(x-1,y-20,2,40);g.fillStyle="#ffd54a";g.fillRect(x-3,y-3,6,6);g.fillStyle="#ffffff";g.fillRect(x-1,y-1,2,2)}
// 한가운데: 성소의 연꽃 문양
{const cx=cx0,cy=cy0;disc(g,cx,cy,100,"#1e2244");disc(g,cx,cy,96,"#d8b04a");disc(g,cx,cy,92,"#3a4070");
 for(let k=0;k<8;k++){const a=k*Math.PI/4;const x=ev(cx+Math.cos(a)*56),y=ev(cy+Math.sin(a)*56);disc(g,x,y,26,"#1e2244");disc(g,x,y,23,"#ffc8d4");disc(g,ev(x-Math.cos(a)*6),ev(y-Math.sin(a)*6),14,"#fff0f4")}
 disc(g,cx,cy,36,"#1e2244");disc(g,cx,cy,32,"#ffd54a");disc(g,cx,cy,24,"#fff0a0");disc(g,cx,cy,12,"#ffffff");
 for(let k=0;k<32;k++){const a=k*Math.PI/16;g.fillStyle=k%4?"#a88a3a":"#fff6c0";g.fillRect(ev(cx+Math.cos(a)*84)-1,ev(cy+Math.sin(a)*84)-1,2,2)}}
// 장식: 홍살문 · 석등 · 빛기둥 · 별 결정 · 구름 정자
for(let n=0;n<34*WORLD_SCALE*WORLD_SCALE;n++){const x=ev(pr(60,WW-60)),y=ev(pr(80,WH-60));if(!free(x,y,40))continue;const q=R();
 if(q<.18){g.fillStyle="#1e2244";g.fillRect(x-14,y+10,28,3);g.fillStyle="#b02a22";g.fillRect(x-12,y-18,4,30);g.fillRect(x+8,y-18,4,30);g.fillStyle="#e04a3a";g.fillRect(x-12,y-18,1,30);g.fillRect(x+8,y-18,1,30);g.fillStyle="#3a2a20";g.fillRect(x-16,y-22,32,4);g.fillStyle="#ffd54a";g.fillRect(x-14,y-21,28,1);for(let k=-8;k<=8;k+=4){g.fillStyle="#b02a22";g.fillRect(x+k,y-26,2,4)}}
 else if(q<.4){g.fillStyle="#1e2244";g.fillRect(x-6,y+6,12,3);g.fillStyle="#9aa0c0";g.fillRect(x-2,y-2,4,8);g.fillStyle="#b8bcd8";g.fillRect(x-5,y-10,10,8);g.fillStyle="#fff0a0";g.fillRect(x-3,y-8,6,4);g.fillStyle="#d0d4ec";g.fillRect(x-7,y-14,14,4);g.fillStyle="#ffd54a";g.fillRect(x-1,y-16,2,2)}
 else if(q<.56){for(let k=0;k<18;k++){g.fillStyle=k%3?"#5a6aa8":"#7a8ad0";g.fillRect(x-3,y-k*4,6,4)}g.fillStyle="#9aaaf0";g.fillRect(x-1,y-72,2,72);g.fillStyle="#fff6c0";g.fillRect(x-4,y-2,8,4);for(let k=0;k<5;k++){g.fillStyle="#fff6c0";g.fillRect(ev(x+pr(-8,8)),ev(y-pr(4,70)),2,2)}}
 else if(q<.7){g.fillStyle="#1e2244";g.fillRect(x-5,y+4,10,2);g.fillStyle="#9ae8d0";g.fillRect(x-2,y-8,4,12);g.fillRect(x-4,y-4,8,4);g.fillStyle="#e8fff8";g.fillRect(x-1,y-7,2,4);g.fillStyle="#ffffff";g.fillRect(x-1,y-12,2,2)}
 else{disc(g,x,y,8,"#262a4a");disc(g,x,y-2,6,"#5c66a0");g.fillStyle=["#ffd54a","#ffa8c0","#ffffff"][ri(0,2)];g.fillRect(x-1,y-4,2,2)}}
// 테두리: 두터운 구름 벽
const puff=(x,y,r)=>{disc(g,ev(x+3),ev(y+5),r,"#1e2244");disc(g,ev(x),ev(y),r,"#8a90c8");disc(g,ev(x-r*.25),ev(y-r*.3),Math.round(r*.65/2)*2,"#b8bce8");disc(g,ev(x-r*.4),ev(y-r*.45),Math.max(2,Math.round(r*.3/2)*2),"#e8eaff")};
const P=[];for(let x=-10;x<WW+30;x+=26){P.push([x+pr(-6,6),pr(-4,16),pr(18,24)]);P.push([x+13+pr(-6,6),WH-pr(0,16),pr(18,24)])}for(let y=24;y<WH-10;y+=26){P.push([pr(-4,14),y+pr(-6,6),pr(18,24)]);P.push([WW-pr(0,14),y+13+pr(-6,6),pr(18,24)])}
P.sort((a,b)=>a[1]-b[1]);for(const [x,y,r] of P)puff(x,y,Math.round(r/2)*2);
return c};
/* 탑의 돌기둥: 플레이어와 일반 적이 통과하지 못하는 장애물 */
const TOWER_ROCKS=[];
function rockPush(o,r){let hit=null;for(const k of TOWER_ROCKS){let dx=o.x-k.x,dy=o.y-k.y,d=Math.hypot(dx,dy);const m=k.r+r;if(d<.01){dx=1;dy=0;d=1}if(d<m){o.x=k.x+dx/d*m;o.y=k.y+dy/d*m;hit={nx:dx/d,ny:dy/d}}}return hit}
const mkTowerBg=()=>{TOWER_ROCKS.length=0;
const c=document.createElement("canvas");c.width=WW;c.height=WH;const g=c.getContext("2d"),R=rng(313),pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1));
const stones=["#3b3843","#37343f","#403c48","#34313b","#3d3a44"];
// 돌바닥: 엇갈린 벽돌
for(let y=0,row=0;y<WH;y+=TILE,row++)for(let x=-(row%2)*TILE/2;x<WW;x+=TILE){
 g.fillStyle=stones[ri(0,4)];g.fillRect(x,y,TILE,TILE);
 g.fillStyle="#24222b";g.fillRect(x,y,TILE,2);g.fillRect(x,y,2,TILE);
 g.fillStyle="#4a4654";g.fillRect(x+2,y+2,TILE-4,2);
 for(let i=0;i<4;i++){g.fillStyle=R()<.5?"#2c2a33":"#4a4652";g.fillRect(x+ri(2,14)*2,y+ri(2,14)*2,2,2)}}
// 금 간 자국
for(let n=0;n<60*WORLD_SCALE;n++){let x=pr(40,WW-40),y=pr(40,WH-40),a=pr(0,6.28);g.fillStyle="#1e1c24";for(let k=0,m=ri(6,16);k<m;k++){g.fillRect(Math.round(x/2)*2,Math.round(y/2)*2,2,2);a+=pr(-.8,.8);x+=Math.cos(a)*3;y+=Math.sin(a)*3}}
// 이끼
for(let n=0;n<40*WORLD_SCALE;n++){const x=Math.round(pr(30,WW-30)/2)*2,y=Math.round(pr(30,WH-30)/2)*2;g.globalAlpha=.5;disc(g,x,y,ri(3,7)*2,"#3a4a38");g.globalAlpha=1;for(let i=0;i<5;i++){g.fillStyle="#56704e";g.fillRect(x+ri(-6,6)*2,y+ri(-6,6)*2,2,2)}}
// 룬 마법진
const rune=(cx,cy,r)=>{g.fillStyle="#3a2a5a";for(let a=0;a<6.283;a+=2/r){g.fillRect(Math.round(cx+Math.cos(a)*r),Math.round(cy+Math.sin(a)*r),2,2);g.fillRect(Math.round(cx+Math.cos(a)*(r-8)),Math.round(cy+Math.sin(a)*(r-8)),2,2)}
 for(let i=0;i<3;i++){const a1=i*2.094-1.57,a2=(i+1)*2.094-1.57,x1=cx+Math.cos(a1)*(r-12),y1=cy+Math.sin(a1)*(r-12),x2=cx+Math.cos(a2)*(r-12),y2=cy+Math.sin(a2)*(r-12),n=Math.ceil(Math.hypot(x2-x1,y2-y1)/2);for(let k=0;k<=n;k++)g.fillRect(Math.round(x1+(x2-x1)*k/n),Math.round(y1+(y2-y1)*k/n),2,2)}
 g.fillStyle="#7a5ac8";for(let i=0;i<8;i++){const a=i*.785;g.fillRect(Math.round(cx+Math.cos(a)*(r-4))-2,Math.round(cy+Math.sin(a)*(r-4))-2,4,4)}};
rune(WW/2,WH/2,88);
for(let n=0;n<14*WORLD_SCALE;n++){const x=pr(160,WW-160),y=pr(160,WH-160);if(Math.hypot(x-WW/2,y-WH/2)<260)continue;rune(Math.round(x),Math.round(y),ri(24,40)*2)}
// 돌기둥
const pillar=(x,y)=>{disc(g,x,y+6,22,"#121016");disc(g,x,y,20,"#2a2830");disc(g,x-3,y-3,15,"#4a4654");disc(g,x-6,y-6,7,"#5e5a68");g.fillStyle="#7a5ac8";g.fillRect(x-2,y-2,4,4)};
for(let n=0;n<10*WORLD_SCALE;n++){const x=Math.round(pr(140,WW-140)),y=Math.round(pr(150,WH-140));if(Math.hypot(x-WW/2,y-WH/2)<200)continue;pillar(x,y);TOWER_ROCKS.push({x,y:y+1,r:21})}
// 테두리: 돌벽
const wall=(x,y,w,h)=>{g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.fillStyle="#17151c";g.fillRect(x,y,w,h);
 for(let yy=y,r=0;yy<y+h;yy+=16,r++)for(let xx=x-(r%2?12:0);xx<x+w;xx+=24){g.fillStyle=stones[ri(0,4)];g.fillRect(xx+1,yy+1,22,14);g.fillStyle="#55515f";g.fillRect(xx+1,yy+1,22,2)}g.restore()};
wall(0,0,WW,28);wall(0,WH-24,WW,24);wall(0,0,26,WH);wall(WW-26,0,26,WH);
return c};
let bg;const bgCache={};
function applyBg(){if(gameMode==="tower"){bg=bgCache.tower||(bgCache.tower=mkTowerBg());return}const th=themeOf();bg=bgCache[th]||(bgCache[th]=th==="burnt"?mkBurntBg():th==="frozen"?mkFrozenBg():th==="canyon"?mkCanyonBg():th==="blossom"?mkBlossomBg():th==="palace"?mkPalaceBg():th==="cloud"?mkCloudBg():mkForestBg())}
applyBg();
/* ===== 미니맵 (오른쪽 아래) ===== */
/* ===== 미니맵: 플레이어 주변만 보여 주는 정사각형 레이더 (오른쪽 위) =====
   MM_SIZE: 크기(px) · MM_RANGE: 미니맵 한 변이 보여 주는 실제 맵 거리 · 범위 밖 보스/포탈/제단은 가장자리에 표시 */
const MM_SIZE=112,MM_RANGE=2200,MM_X=W-MM_SIZE-12,MM_Y=60,MM_W=MM_SIZE,MM_H=MM_SIZE;let MM_S=MM_SIZE/MM_RANGE;
const MM_K=MM_SIZE/MM_RANGE;let mmWorld=null,mmKey="";
function mmBase(){const key=state.mode+WW+"x"+WH+themeOf();if(mmWorld&&mmKey===key)return mmWorld;mmKey=key;
 const c=document.createElement("canvas");c.width=Math.ceil(WW*MM_K);c.height=Math.ceil(WH*MM_K);const g=c.getContext("2d");
 const T=state.mode==="tower",th=themeOf(),col=T?["#3a3742","#17151c"]:th==="burnt"?["#2a1c1a","#120a0a"]:th==="frozen"?["#3a4a5a","#16202a"]:th==="canyon"?["#2e2c38","#121016"]:th==="blossom"?["#1f3330","#2a0e1c"]:th==="palace"?["#2c2620","#5a1410"]:th==="cloud"?["#343a66","#8a90c8"]:["#2a2024","#150d10"];
 g.fillStyle=col[0];g.fillRect(0,0,c.width,c.height);g.fillStyle=col[1];const e=Math.max(2,Math.round(40*MM_K));g.fillRect(0,0,c.width,e);g.fillRect(0,c.height-e,c.width,e);g.fillRect(0,0,e,c.height);g.fillRect(c.width-e,0,e,c.height);
 if(T){g.fillStyle="#24222c";for(const k of TOWER_ROCKS){g.beginPath();g.arc(k.x*MM_K,k.y*MM_K,Math.max(1.5,k.r*MM_K),0,6.283);g.fill()}}
 else{g.fillStyle=th==="frozen"?"#7a96ac":th==="canyon"?"#6a6478":th==="blossom"?"#6e7a72":th==="palace"?"#c8902a":th==="cloud"?"#dde0f0":"#6a5438";for(let x=0;x<c.width;x++)g.fillRect(x,Math.round(pathY(x/MM_K)*MM_K)-1,1,2)}
 return mmWorld=c}
function mmIcon(rows,pal,x,y){rows.forEach((r,j)=>{for(let i=0;i<r.length;i++){const k=r[i];if(k!==".")ctx.fillStyle=pal[k],ctx.fillRect(x+i,y+j,1,1)}})}
const MM_CHEST=[".ooooooo.","obbbbbbbo","obbbbbbbo","oyyyhyyyo","obbbhbbbo","obbbbbbbo",".ooooooo."],MM_CHEST_PAL={o:"#1a0d08",b:"#b8622e",y:"#ffd54a",h:"#fff4c0"};
const MM_ALTAR=[".....o.....","....oyo....","...oyhyo...","..oyhyyyo..","...oyyyo...","....oyo....",".....o.....",".ooooooooo.","oSSSSSSSSSo","ossssssssso",".ooooooooo."],MM_ALTAR_PAL={o:"#1a1418",y:"#ffc23a",h:"#fff2c0",S:"#d8ccdc",s:"#8a7e94"},MM_ALTAR_OFF={o:"#1a1418",y:"#5a5464",h:"#8a8098",S:"#6a6274",s:"#4a4452"};
const MM_SKULL=["..ooooo..",".owwwwwo.","owwwwwwwo","oweeweewo","oweeweewo",".owwowwo.","..owwwo..","..owowo..","...ooo..."];
function drawMinimap(){const p=state.p;if(!p||!p.r)return;
 const half=MM_RANGE/2,ox=p.x-half,oy=p.y-half,toX=x=>MM_X+(x-ox)*MM_K,toY=y=>MM_Y+(y-oy)*MM_K,inR=(x,y)=>Math.abs(x-p.x)<half&&Math.abs(y-p.y)<half;
 const edge=(x,y,m)=>{const dx=x-p.x,dy=y-p.y,s=Math.max(Math.abs(dx),Math.abs(dy))/(half-m/MM_K)||1;return s>1?[MM_X+MM_SIZE/2+dx/s*MM_K,MM_Y+MM_SIZE/2+dy/s*MM_K,true]:[toX(x),toY(y),false]};
 ctx.save();ctx.globalAlpha=.78;ctx.fillStyle="#050b09";ctx.fillRect(MM_X-3,MM_Y-3,MM_SIZE+6,MM_SIZE+6);
 ctx.save();ctx.beginPath();ctx.rect(MM_X,MM_Y,MM_SIZE,MM_SIZE);ctx.clip();ctx.fillStyle="#020504";ctx.fillRect(MM_X,MM_Y,MM_SIZE,MM_SIZE);
 const mb=mmBase();ctx.drawImage(mb,Math.round(MM_X-ox*MM_K),Math.round(MM_Y-oy*MM_K));
 ctx.globalAlpha=.9;ctx.strokeStyle="rgba(255,244,200,.7)";ctx.lineWidth=1;ctx.strokeRect(Math.round(toX(cam.x))+.5,Math.round(toY(cam.y))+.5,Math.round(W*MM_K),Math.round(H*MM_K));
 ctx.globalAlpha=1;
 for(const c of (state.chests||[]))if(inR(c.x,c.y))mmIcon(MM_CHEST,MM_CHEST_PAL,Math.round(toX(c.x))-4,Math.round(toY(c.y))-3);
 ctx.restore();ctx.globalAlpha=1;
 ctx.strokeStyle="#b8c9b6";ctx.lineWidth=1;ctx.strokeRect(MM_X-2.5,MM_Y-2.5,MM_SIZE+5,MM_SIZE+5);
 // 제단: 범위 안이면 아이콘, 밖이면 가장자리에 작은 점
 for(const a of (state.altars||[]))if(!a.spent){const off=a.cd>0,[ex,ey,out]=edge(a.x,a.y,4);
  if(out){if(!off){ctx.fillStyle=Math.floor(state.time*2)%2?"#ffc23a":"#c8901a";ctx.fillRect(Math.round(ex)-2,Math.round(ey)-2,4,4)}continue}
  const ax=Math.round(ex)-5,ay=Math.round(ey)-8;
  if(!off){ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.22+.12*Math.sin(state.time*3+a.ph);ctx.fillStyle="#ffb02a";ctx.beginPath();ctx.arc(ax+5.5,ay+3.5,7,0,6.283);ctx.fill();ctx.restore()}
  if(!off&&a.prog>0&&Math.floor(state.time*6)%2===0){ctx.fillStyle="#ffd54a";ctx.fillRect(ax-2,ay-2,15,1);ctx.fillRect(ax-2,ay+12,15,1);ctx.fillRect(ax-2,ay-2,1,15);ctx.fillRect(ax+12,ay-2,1,15)}
  mmIcon(MM_ALTAR,off?MM_ALTAR_OFF:MM_ALTAR_PAL,ax,ay)}
 for(const e of state.enemies)if(e.boss){const [bx,by]=edge(e.x,e.y,6),bb=Math.floor(state.time*3)%2===0;mmIcon(MM_SKULL,{o:bb?"#ff3040":"#ff8a94",w:"#f4efe0",e:"#2a1218"},Math.round(bx)-4,Math.round(by)-4)}
 if(state.portal){const [qx,qy]=edge(state.portal.x,state.portal.y,5);ctx.fillStyle=Math.floor(state.time*4)%2?"#e9dcff":"#b48cff";ctx.fillRect(Math.round(qx)-3,Math.round(qy)-4,6,8)}
 const px=MM_X+MM_SIZE/2,py=MM_Y+MM_SIZE/2;ctx.fillStyle="#0b1510";ctx.fillRect(px-3,py-3,6,6);ctx.fillStyle="#ffd54a";ctx.fillRect(px-2,py-2,4,4);
 ctx.restore()}
/* ================= 제단: 위에 서 있으면 게이지가 차고, 100%가 되면 능력치 선택 ================= */
const ALTAR_R=34,ALTAR_TIME=5,ALTAR_STORY=6; // 반경 · 충전 시간(초) · 본편 제단 수
const ALTAR_REUSE=false,ALTAR_CD=60; // true로 바꾸면 본편 제단이 ALTAR_CD초 뒤 다시 켜져요 (지금은 한 번 쓰면 끝)
const ALTAR_STATS=[
{id:"atk",icon:"⚔️",name:"공격력",nameEn:"Attack",desc:"모든 공격 피해 +10%",descEn:"All damage +10%",cur:p=>Math.round((p.dmgMul||1)*100)+"%",nxt:p=>Math.round(((p.dmgMul||1)+.1)*100)+"%",apply:p=>{p.dmgMul=(p.dmgMul||1)+.1}},
{id:"regen",icon:"💚",name:"자연 회복",nameEn:"Regeneration",desc:"초당 최대 체력의 0.5% 회복",descEn:"Regenerate 0.5% of max HP per second",cur:p=>((p.regen||0)*100).toFixed(1)+tx("%/초","%/s"),nxt:p=>(((p.regen||0)+.005)*100).toFixed(1)+tx("%/초","%/s"),apply:p=>{p.regen=(p.regen||0)+.005}},
{id:"hp",icon:"❤️",name:"최대 체력",nameEn:"Max HP",desc:"최대 체력 +15 및 회복",descEn:"Max HP +15 and heal",cur:p=>p.maxHp,nxt:p=>p.maxHp+15,apply:p=>{p.maxHp+=15;p.hp=Math.min(p.maxHp,p.hp+15)}},
{id:"spd",icon:"💨",name:"이동 속도",nameEn:"Move Speed",desc:"이동 속도 +4%",descEn:"Move speed +4%",cur:p=>Math.round(p.speed),nxt:p=>Math.round(p.speed*1.04),apply:p=>{p.speed*=1.04}},
{id:"rate",icon:"⚡",name:"공격 속도",nameEn:"Attack Speed",desc:"공격 간격 -5%",descEn:"Attack interval -5%",cur:p=>fmt(p.arrowRate)+tx("초","s"),nxt:p=>fmt(Math.max(.2,p.arrowRate*.95))+tx("초","s"),apply:p=>{p.arrowRate=Math.max(.2,p.arrowRate*.95)}},
{id:"guard",icon:"🛡️",name:"방어력",nameEn:"Defense",desc:"받는 피해 -5%",descEn:"Damage taken -5%",cur:p=>Math.round((p.guard||1)*100)+"%",nxt:p=>Math.round(Math.max(.4,(p.guard||1)*.95)*100)+"%",apply:p=>{p.guard=Math.max(.4,(p.guard||1)*.95)}},
{id:"pick",icon:"🧲",name:"흡수 범위",nameEn:"Pickup Range",desc:"불씨 조각 흡수 범위 +10%",descEn:"Shard pickup range +10%",cur:p=>Math.round(p.pickup),nxt:p=>Math.round(p.pickup*1.1),apply:p=>{p.pickup*=1.1}},
{id:"xp",icon:"⭐",name:"경험치",nameEn:"Experience",desc:"경험치 획득 +5%",descEn:"XP gain +5%",cur:p=>Math.round((p.xpMul||1)*100)+"%",nxt:p=>Math.round(((p.xpMul||1)+.05)*100)+"%",apply:p=>{p.xpMul=(p.xpMul||1)+.05}}];
function placeAltar(minFromP){const p=state.p,T=state.mode==="tower";
 for(let i=0;i<120;i++){const x=rand(140,WW-140),y=rand(160,WH-140);if(Math.hypot(x-p.x,y-p.y)<minFromP)continue;
  if(!T&&state.altars.some(a=>Math.hypot(a.x-x,a.y-y)<480))continue;if((state.chests||[]).some(c=>Math.hypot(c.x-x,c.y-y)<90))continue;
  if(T&&(TOWER_ROCKS.some(k=>Math.hypot(k.x-x,k.y-y)<k.r+60)||(state.portal&&Math.hypot(state.portal.x-x,state.portal.y-y)<120)))continue;
  state.altars.push({x,y,prog:0,cd:0,spent:false,ph:rand(0,6.28)});return true}return false}
function initAltars(){state.altars=[];if(state.mode==="tower")placeAltar(260);else for(let i=0;i<ALTAR_STORY;i++)placeAltar(420)}
function altarTick(dt){const p=state.p;for(const a of state.altars||[]){
 if(a.cd>0){a.cd-=dt;if(a.cd<=0){a.cd=0;a.prog=0;burst(a.x,a.y-14,"#ffd54a",12)}continue}if(a.spent)continue;
 if(dist2(p,a)<(ALTAR_R+p.r*.5)**2){a.prog=Math.min(1,a.prog+dt/ALTAR_TIME);if(Math.random()<.5)state.particles.push({x:a.x+rand(-ALTAR_R,ALTAR_R),y:a.y+rand(-8,8),vx:0,vy:rand(-80,-30),life:.6,max:.6,color:Math.random()<.5?"#ffd54a":"#fff2c0",size:2})}
 else a.prog=Math.max(0,a.prog-dt/ALTAR_TIME*.5);
 if(a.prog>=1&&!state.choosing){a.prog=0;if(ALTAR_REUSE&&state.mode!=="tower")a.cd=ALTAR_CD;else a.spent=true;state.fx.push(sporeFx(a.x,a.y,90));burst(a.x,a.y-14,"#ffd54a",30);altarChoice();return}}}
function altarChoice(){state.choosing=true;state.paused=true;ui.choices.innerHTML="";const p=state.p,ey=ui.level.querySelector(".eyebrow"),h2=ui.level.querySelector("h2");
 if(ey)ey.textContent=tx("제단의 축복","ALTAR BLESSING");if(h2)h2.textContent=tx("능력치를 하나 고르세요","Choose a stat to raise");
 const pool=[...ALTAR_STATS];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
 pool.slice(0,3).forEach((u,i)=>{const b=document.createElement("button"),C="#ffd54a";b.className="upgrade-card altar-card";b.style.borderColor=C;b.style.boxShadow=`0 0 0 1px ${C},0 0 18px ${C}66`;
  b.innerHTML=`<span class="lv-key">${i+1}</span><span class="symbol altar-sym">${u.icon}</span><span class="lv-body"><strong>${tf(u,"name")}</strong><small class="lv-desc">${tf(u,"desc")}</small><span class="lv-stats"><span class="lv-stat"><i>${tf(u,"name")}</i><b>${u.cur(p)}</b><u>→</u><b class="up">${u.nxt(p)}</b></span></span></span><em class="lv-rar" style="color:${C}">${tx("제단","Altar")}</em>`;
  b.onclick=()=>{u.apply(p);if(state.rs){const r=state.rs.altar[u.id]||(state.rs.altar[u.id]={n:0,name:tf(u,"name"),icon:u.icon});r.n++}state.choosing=false;state.paused=false;ui.level.classList.add("hidden");burst(p.x,p.y,"#ffd54a",20);hud()};ui.choices.appendChild(b)});
 ui.level.classList.remove("hidden")}
(()=>{const st=document.createElement("style");st.textContent="#levelOverlay .altar-sym{display:flex!important;align-items:center;justify-content:center;font-size:40px;font-style:normal;line-height:1}@media (max-height:480px){#levelOverlay .altar-sym{font-size:26px}}";document.head.appendChild(st)})();
function drawAltars(){const t=state.time;for(const a of state.altars||[]){if(a.x<cam.x-90||a.x>cam.x+W+90||a.y<cam.y-90||a.y>cam.y+H+90)continue;
 const x=Math.round(a.x),y=Math.round(a.y),act=!(a.cd>0)&&!a.spent,pr=a.prog;ctx.save();
 ctx.globalAlpha=.45;ctx.fillStyle="#050304";ctx.beginPath();ctx.ellipse(x,y+6,44,16,0,0,6.283);ctx.fill();ctx.globalAlpha=1;
 for(const [rx,ry,c,dy] of [[40,15,"#1c1a20",5],[39,14,"#3c3844",3],[38,13,"#56515e",2],[30,10,"#2e2a34",0],[29,9,"#4a4652",-1],[28,8,"#615c6a",-2]]){ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(x,y+dy,rx,ry,0,0,6.283);ctx.fill()}
 ctx.strokeStyle=act?"#ffd54a":"#6a6070";ctx.globalAlpha=act?.55+.25*Math.sin(t*3+a.ph):.45;ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(x,y-2,22,7,0,0,6.283);ctx.stroke();
 for(let i=0;i<6;i++){const an=t*.5+i*1.047;ctx.fillStyle=act?"#ffe08a":"#7a7080";ctx.fillRect(Math.round(x+Math.cos(an)*22)-1,Math.round(y-2+Math.sin(an)*7)-1,2,2)}
 ctx.globalAlpha=1;const cy=Math.round(y-16+Math.sin(t*2+a.ph)*2);
 ctx.fillStyle="#1a1418";ctx.beginPath();ctx.moveTo(x,cy-12);ctx.lineTo(x+7,cy);ctx.lineTo(x,cy+10);ctx.lineTo(x-7,cy);ctx.closePath();ctx.fill();
 ctx.fillStyle=act?"#ffb02a":"#5a5464";ctx.beginPath();ctx.moveTo(x,cy-10);ctx.lineTo(x+5,cy);ctx.lineTo(x,cy+8);ctx.lineTo(x-5,cy);ctx.closePath();ctx.fill();
 ctx.fillStyle=act?"#ffd54a":"#7a7080";ctx.beginPath();ctx.moveTo(x,cy-10);ctx.lineTo(x+5,cy);ctx.lineTo(x,cy);ctx.closePath();ctx.fill();ctx.fillStyle=act?"#fff2c0":"#9a90a0";ctx.fillRect(x-2,cy-6,2,4);
 if(act){ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.3+.4*pr+.1*Math.sin(t*4);ctx.drawImage(glow,x-60,cy-60,120,120);if(pr>0){ctx.globalAlpha=.25*pr;ctx.fillStyle="#ffd54a";ctx.beginPath();ctx.ellipse(x,y-2,38,13,0,0,6.283);ctx.fill()}ctx.globalCompositeOperation="source-over"}
 if(act&&pr>0){ctx.globalAlpha=1;ctx.lineWidth=5;ctx.strokeStyle="#1a1418";ctx.beginPath();ctx.arc(x,y-44,13,0,6.283);ctx.stroke();ctx.strokeStyle="#ffd54a";ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y-44,13,-Math.PI/2,-Math.PI/2+pr*6.283);ctx.stroke();
  ctx.font="bold 10px monospace";ctx.textAlign="center";ctx.fillStyle="#1a1418";ctx.fillText(Math.floor(pr*100)+"%",x+1,y-40);ctx.fillStyle="#fff2c0";ctx.fillText(Math.floor(pr*100)+"%",x,y-41);ctx.textAlign="left"}
 if(a.cd>0){ctx.globalAlpha=.85;ctx.lineWidth=3;ctx.strokeStyle="#2a2630";ctx.beginPath();ctx.arc(x,y-44,10,0,6.283);ctx.stroke();ctx.strokeStyle="#8a8098";ctx.beginPath();ctx.arc(x,y-44,10,-Math.PI/2,-Math.PI/2+(1-a.cd/ALTAR_CD)*6.283);ctx.stroke()}
 ctx.restore()}}
/* ===== 추억 상자 & 패시브 아이템 ===== */
const CHEST_MAX=21,CHEST_RESPAWN=35;
const relics=[
{id:"dew",icon:"🔥",name:"불씨 부싯돌",nameEn:"Ember Flint",desc:"공격 속도 +8%",descEn:"Attack speed +8%",apply:p=>p.arrowRate=Math.max(.2,p.arrowRate/1.08)},
{id:"needle",icon:"🌋",name:"식지 않는 용암석",nameEn:"Undying Lava Stone",desc:"공격력 +60%",descEn:"Attack +60%",apply:p=>p.dmgMul=(p.dmgMul||1)+.6},
{id:"sock",icon:"🪶",name:"엄마의 비늘 깃털",nameEn:"Mother's Scale Feather",desc:"이동 속도 +4%",descEn:"Move speed +4%",apply:p=>p.speed*=1.04},
{id:"lamp",icon:"🏮",name:"낡은 불씨 등잔",nameEn:"Old Ember Lamp",desc:"불씨 조각 흡수 범위 +8%",descEn:"Shard pickup range +8%",apply:p=>p.pickup*=1.08},
{id:"cap",icon:"🥚",name:"황금 알껍질",nameEn:"Golden Eggshell",desc:"최대 체력 +35%",descEn:"Max HP +35%",apply:p=>{const n=Math.round(p.maxHp*1.35),d=n-p.maxHp;p.maxHp=n;p.hp=Math.min(n,p.hp+d)}},
{id:"moss",icon:"🛡️",name:"단단한 비늘 조각",nameEn:"Hard Scale Shard",desc:"받는 피해 -20%",descEn:"Damage taken -20%",apply:p=>p.guard=Math.max(.4,(p.guard||1)*.8)},
{id:"star",icon:"⭐",name:"별똥별 조각",nameEn:"Shooting Star Shard",desc:"경험치 획득 +8%",descEn:"XP gain +8%",apply:p=>p.xpMul=(p.xpMul||1)+.08},
{id:"grail",icon:"🩸",name:"피의 성배",nameEn:"Blood Chalice",desc:"가한 피해의 4%를 체력으로 흡수 (1초에 최대 체력의 6%까지)",descEn:"Absorb 4% of damage dealt as HP (up to 6% of max HP per second)",apply:p=>p.vamp=(p.vamp||0)+.04},
{id:"honey",icon:"♨️",name:"따끈한 온천수",nameEn:"Warm Hot Spring",desc:"초당 체력 2.5% 재생",descEn:"Regenerate 2.5% HP per second",apply:p=>p.regen=(p.regen||0)+.025}
];
const CHEST_ROWS=["..oooooooooo..",".owwwwwwwwwwo.","owwWwwwwwwWwwo","owwwwwwwwwwwwo","oggggggggggggo","owwwwgyygwwwwo","owwwwggggwwwwo","owwWwwwwwwWwwo","owwwwwwwwwwwwo","oWWWWWWWWWWWWo",".oooooooooooo."];
const chestImg=(()=>{const k=3,c=document.createElement("canvas");c.width=14*k;c.height=11*k;const g=c.getContext("2d"),pal={o:"#0e0810",w:"#5a4a64",W:"#3a2e44",g:"#e8b83a",y:"#fff2a8"};
CHEST_ROWS.forEach((r,y)=>{for(let x=0;x<14;x++){const ch=r[x];if(ch!=="."){g.fillStyle=pal[ch];g.fillRect(x*k,y*k,k,k)}}});return c})();
function placeChest(minFromP){
 const p=state.p;
 for(let i=0;i<60;i++){
  const x=rand(130,WW-130),y=rand(150,WH-130);
  if(Math.hypot(x-p.x,y-p.y)<minFromP)continue;
  if(state.chests.some(c=>Math.hypot(c.x-x,c.y-y)<320))continue;
  state.chests.push({x,y,ph:rand(0,6.28)});return true}
 return false}
function initChests(){state.chests=[];state.items={};state.bag=[];state.chestT=0;state.toast=null;state.xpFrac=0;
 if(gameMode!=="tower")for(let i=0;i<CHEST_MAX;i++)placeChest(520)}
// 상자 아이템: id -> [등급, 등장 확률(%)] (합계 100)
const RELIC_RARITY={grail:["epic",2],sock:["common",33],lamp:["common",31],dew:["uncommon",15],star:["uncommon",13],moss:["epic",2.5],cap:["epic",1.5],needle:["legendary",1.5],honey:["mythic",.5]};
relics.forEach(r=>{[r.rar,r.w]=RELIC_RARITY[r.id]});
function drawRelic(){return pickWeighted(relics,1)[0]}
function openChest(c){rec.chest();grantRelic(c.x,c.y)}
// 상자 아이템 1개 지급 (탑에서는 층을 넘을 때마다)
function grantRelic(x,y){
 const p=state.p,r=drawRelic();r.apply(p);state.items[r.id]=(state.items[r.id]||0)+1;
 state.fx.push(sporeFx(x,y,56));burst(x,y,RARITY[r.rar].c,26);burst(x,y,"#fff2a8",10);
 state.toast={name:tf(r,"name"),desc:tf(r,"desc"),icon:r.icon,rar:r.rar,w:r.w,t:3.4};hud()}
/* ===== 경험치 규칙 — 숫자만 바꿔서 조절하세요 =====
   killMul: 몹 처치 경험치 배율 · decayPerLv: 레벨 1 오를 때마다 줄어드는 비율 (.0001 = 0.01%) · minRate: 최소 비율
   growth/add: 다음 레벨 필요 경험치 = 올림(지금 필요량 × growth + add) (예전 1.18 / 2) */
const XP_RULE={killMul:4,decayPerLv:.0001,minRate:.1,growth:1.12,add:2};
const xpLevelRate=()=>Math.max(XP_RULE.minRate,1-XP_RULE.decayPerLv*((state.level||1)-1));
const nextNeed=n=>Math.ceil(n*XP_RULE.growth+XP_RULE.add);
function xpGain(v){state.xpFrac=(state.xpFrac||0)+v*XP_RULE.killMul*xpLevelRate()*(state.p.xpMul||1);const n=Math.floor(state.xpFrac);state.xpFrac-=n;xp(n)}

/* ================= 무기 진화 (강화 조합) =================
   need: 강화 id → 필요한 선택 횟수. 모두 채우면 그 판 동안 상위 무기로 진화 (한 번만)
   레벨업 카드에 관련 강화가 나오면 진행도가 같이 표시돼요 */
const WEVO=[
 {id:"blade",flag:"ev_blade",icon:"🩸",name:"피의 회전검",nameEn:"Blood Orbit",need:{blade:4,leech:1},desc:"회전 구슬이 피의 칼날로: 피해 ×2 · 반경 +12 · 맞힐 때마다 체력 흡수",descEn:"Orbs become blood blades: damage ×2 · radius +12 · drain HP on hit"},
 {id:"main",flag:"ev_main",icon:"🐉",name:"용의 심장탄",nameEn:"Dragonheart Shot",nameZ:"주작의 진검",nameZEn:"Vermilion True Blade",nameH:"심해의 물살",nameHEn:"Abyssal Current",nameB:"백호의 송곳 발톱",nameBEn:"Rending Tiger Claws",nameC:"청룡의 뇌우",nameCEn:"Azure Thunderstorm",nameW:"황룡의 천지개벽",nameWEn:"Upheaval of Heaven and Earth",need:{ad:5,heart:1},desc:"기본 공격 피해 ×1.5 · 관통 +2",descEn:"Basic attack damage ×1.5 · pierce +2"},
 {id:"storm",flag:"ev_storm",icon:"☄️",name:"지옥불 유성우",nameEn:"Hellfire Rain",need:{storm:2,spore:1},desc:"메테오가 2배 자주 · 피해 ×1.5 · 폭발 범위 +40%",descEn:"Meteors twice as often · damage ×1.5 · blast radius +40%"},
 {id:"pulse",flag:"ev_pulse",icon:"🌀",name:"별빛 중력장",nameEn:"Starlight Gravity",need:{spore:2,magnet:3},desc:"폭발 범위 +40% · 터질 때 주변 불씨 조각을 끌어오고 적을 끌어당겨 느리게",descEn:"Burst radius +40% · pulls nearby shards in and drags & slows enemies"},
 {id:"heart",flag:"ev_heart",icon:"🔥",name:"불사조의 심장",nameEn:"Phoenix Heart",need:{heart:3,heal:2},desc:"초당 최대 체력 0.5% 회복 · 체력 30% 아래로 떨어지면 30% 회복 (60초마다)",descEn:"Regen 0.5% max HP/s · when below 30% HP, heal 30% (every 60s)"}];
for(const k of ["blade","storm","pulse"]){const i=WEVO.findIndex(w=>w.id===k);if(i>=0)WEVO.splice(i,1)} // 공용 스킬 진화는 이제 쓰지 않아요
WEVO.push(
 {id:"ig",flag:"ev_ig",icon:"🐉",name:"불씨 군단",nameEn:"Ember Legion",need:{i_swarm:2,i_bounce:1},desc:"꼬마 불씨 용이 2배로 늘고, 깨물 때마다 튀는 불씨 화살을 쏴요",descEn:"Twice as many hatchlings, and every bite fires a bouncing ember arrow"},
 {id:"zq",flag:"ev_zq",icon:"🪶",name:"불사조 행진",nameEn:"Phoenix Parade",need:{z_echo:3,z_trail:2},desc:"분신의 검기가 두 갈래로 나가고, 업화의 발자취 피해 ×2",descEn:"Echo sword waves fork in two · Trail of Hellfire damage ×2"},
 {id:"hm",flag:"ev_hm",icon:"🌊",name:"북해의 군림",nameEn:"Lord of the North Sea",need:{h_tide:2,h_vortex:2},desc:"해일이 지나가는 길에 소용돌이 3개가 생겨 적을 붙잡아요",descEn:"Each tidal wave leaves 3 whirlpools along its path"},
 {id:"bk",flag:"ev_bk",icon:"🐯",name:"백호 분신술",nameEn:"Tiger Clone Art",need:{b_ghost:3,b_chain:1},desc:"돌진이 끝난 자리에도 잔상이 남고, 잔상이 2번 더 할퀴어요",descEn:"Afterimages also appear where dashes end, and claw 2 extra times"},
 {id:"cr",flag:"ev_cr",icon:"⛈️",name:"뇌우 용왕",nameEn:"Storm Dragon King",need:{c_web:2,c_spout:2},desc:"전기 그물 피해 ×2 · 용오름 범위 +40% · 기절 +0.5초",descEn:"Static Web damage ×2 · Waterspout radius +40% · stun +0.5s"},
 {id:"hw",flag:"ev_hw",icon:"🏯",name:"오방 천하",nameEn:"Five Realms Under Heaven",need:{w_ley:2,w_form:1},desc:"지맥이 3배 오래 남아 계속 베고, 봉인에 필요한 속성 -1",descEn:"Ley lines last 3× longer and keep cutting · seals need one fewer element"},
 {id:"ql",flag:"ev_ql",icon:"✨",name:"천상의 성창",nameEn:"Celestial Lance",need:{q_prism:3,q_bell:2},desc:"성광 창이 굵어지고, 굴절이 6갈래로 갈라져요",descEn:"The holy lance thickens and Refraction splits into 6 beams",on:p=>{p.lanceW=(p.lanceW||0)+5}});
WEVO.find(w=>w.id==="hw").on=p=>{p.sealEase=(p.sealEase||0)+1};
const WEVO_FX={blade:{dmg:2,radius:12,heal:.3,healCap:.02},storm:{dmg:1.5,r:74,cd:.5},pulse:{r:1.4,pull:320},heart:{regen:.005,low:.3,heal:.3,cd:60},main:{dmg:1.5,pierce:2}};
const weaponEvo=(()=>{
const picks=id=>{const r=state.rs&&state.rs.ups[id];return r?r.n:0};
const avail=()=>{const p=state.p,pool=p.charId==="zhuque"?ZPOOL:p.charId==="hyunmu"?HPOOL:p.charId==="baekho"?BPOOL:p.charId==="cheongryong"?CPOOL:p.charId==="hwangryong"?WPOOL:p.charId==="qilin"?QPOOL:IPOOL;return WEVO.filter(w=>Object.keys(w.need).every(id=>pool.some(u=>u.id===id)))};
const nm=w=>{const c=state.p.charId;return c==="zhuque"&&w.nameZ?tx(w.nameZ,w.nameZEn):c==="hyunmu"&&w.nameH?tx(w.nameH,w.nameHEn):c==="baekho"&&w.nameB?tx(w.nameB,w.nameBEn):c==="cheongryong"&&w.nameC?tx(w.nameC,w.nameCEn):c==="hwangryong"&&w.nameW?tx(w.nameW,w.nameWEn):c==="qilin"?tx("기린의 천광창","Qilin's Heavenlight Lance"):tf(w,"name")};
function evolve(w){const p=state.p;p[w.flag]=true;const F=WEVO_FX;if(w.on)w.on(p);
 if(w.id==="blade")p.bladeRadius+=F.blade.radius;
 if(w.id==="main"){p.arrowDamage=Math.round(p.arrowDamage*F.main.dmg*100)/100;p.arrowPierce+=F.main.pierce}
 if(w.id==="heart")p.regen=(p.regen||0)+F.heart.regen;
 if(state.rs){state.rs.evo=state.rs.evo||[];state.rs.evo.push({id:w.id,name:nm(w),icon:w.icon,time:state.time})}
 state.flash=.5;state.flashC="#ffd54a";state.shake=Math.max(state.shake||0,6);for(const c of["#ffd54a","#ff8a2a","#fff0b0"])burst(p.x,p.y,c,22);
 state.banner={text:tx(`무기 진화! ${w.icon} ${nm(w)}`,`Weapon evolved! ${w.icon} ${nm(w)}`),t:3.2};if(typeof audio!=="undefined")audio.sfx("revive")}
function check(){const p=state.p;for(const w of avail())if(!p[w.flag]&&Object.entries(w.need).every(([id,n])=>picks(id)>=n))evolve(w)}
// 레벨업 카드: 이 강화가 들어가는 진화 조합과 진행도 표시
function decorate(){const p=state.p;if(!ui.choices)return;
 ui.choices.querySelectorAll(".upgrade-card").forEach(b=>{const id=b.dataset.uid;b.querySelectorAll(".lv-evo").forEach(x=>x.remove());if(!id)return;
  const ws=avail().filter(w=>!p[w.flag]&&w.need[id]);if(!ws.length)return;
  const html=ws.map(w=>{const parts=Object.entries(w.need).map(([k,n])=>{const c=Math.min(n,picks(k)+(k===id?1:0)),done=c>=n;return `<span style="color:${done?"#7dff9a":"#ffcf6a"}">${upName(k)} ${c}/${n}</span>`}).join(" + ");return `${w.icon} ${nm(w)} ← ${parts}`}).join("<br>");
  const el=document.createElement("small");el.className="lv-evo";el.style.cssText="display:block;margin-top:6px;padding:4px 6px;font-size:11px;line-height:1.5;color:#ffe9b0;background:rgba(255,180,60,.12);border:1px dashed rgba(255,200,90,.5)";el.innerHTML=html;
  (b.querySelector(".lv-body")||b).appendChild(el)})}
const upName=id=>{const p=state.p,z=p.charId==="zhuque"?ZUP[id]:p.charId==="hyunmu"?HUP[id]:p.charId==="baekho"?BUP[id]:p.charId==="cheongryong"?CUP[id]:p.charId==="hwangryong"?WUP[id]:p.charId==="qilin"?QUP[id]:SK[id]||null,u=upgrades.find(x=>x.id===id);return z?tf(z,"name"):u?tf(u,"name"):id};
function bladeHeal(p){const F=WEVO_FX.blade;if(p.hp<=0||p.hp>=p.maxHp)return;const now=state.time;if(!p.bhT||now-p.bhT>=1){p.bhT=now;p.bhBud=p.maxHp*F.healCap}if(p.bhBud<=0)return;const h=Math.min(F.heal,p.bhBud);p.bhBud-=h;p.hp=Math.min(p.maxHp,p.hp+h);if(Math.random()<.05)burst(p.x,p.y-10,"#ff5a6a",1)}
function gravity(p,R){const F=WEVO_FX.pulse;for(const g of state.gems)if(dist2(p,g)<F.pull**2){g.pull=true;g.v=Math.max(g.v||0,260)}
 for(const e of state.enemies)if(!e.boss&&dist2(p,e)<(R*1.6)**2){const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*Math.min(40,d*.3);e.y+=dy/d*Math.min(40,d*.3);e.slowT=Math.max(e.slowT||0,1.2)}}
function tick(dt){const p=state.p;if(!p||!p.ev_heart||state.dead)return;const F=WEVO_FX.heart;p.phT=Math.max(0,(p.phT||0)-dt);
 if(p.phT<=0&&p.hp>0&&p.hp<p.maxHp*F.low){p.phT=F.cd;p.hp=Math.min(p.maxHp,p.hp+p.maxHp*F.heal);burst(p.x,p.y,"#ff8a2a",30);burst(p.x,p.y,"#ffd54a",16);state.banner={text:tx("불사조의 심장이 타오른다!","The Phoenix Heart blazes!"),t:1.8};if(typeof audio!=="undefined")audio.sfx("revive")}}
return{check,decorate,bladeHeal,gravity,tick,list:()=>WEVO,name:nm}})();
function updatePassives(dt){weaponEvo.tick(dt);baekhoTick(dt);cheongTick(dt);hwangTick(dt);hwGateTick(dt);qilinTick(dt);igTick(dt);skTick(dt);{const p=state.p;if(p.charId==="ignis"&&p.evo>=2){const E=IGN_EVO[2];p.auraT=(p.auraT||0)-dt;if(p.auraT<=0){p.auraT=E.auraCD;for(const e of state.enemies)if(!e.ghost&&inMap(e)&&dist2(e,p)<(E.auraR+e.r)**2)hurt(e,p.arrowDamage*E.auraDmg,"#ff8a4a","aura")}}}
 const p=state.p;
 altarTick(dt);
 if(p.charId==="hyunmu")hyunmuTick(p,dt);
 if(p.vamp){const cap=p.maxHp*.06*(p.vamp/.04);p.vampBud=Math.min(cap,(p.vampBud||0)+cap*dt)}
 if(p.regen&&p.hp>0&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+p.maxHp*p.regen*dt);
 state.chestT+=dt;if(state.mode!=="tower"&&state.chestT>=CHEST_RESPAWN){state.chestT=0;if(state.chests.length<CHEST_MAX)placeChest(600)}
 for(let i=state.chests.length-1;i>=0;i--){const c=state.chests[i];if(dist2(p,c)<(p.r+24)**2){state.chests.splice(i,1);openChest(c)}}
 if(state.toast){state.toast.t-=dt;if(state.toast.t<=0)state.toast=null}}
function drawChests(){
 const t=performance.now()/1000;
 for(const c of (state.chests||[])){
  if(c.x<cam.x-60||c.x>cam.x+W+60||c.y<cam.y-60||c.y>cam.y+H+60)continue;
  const x=Math.round(c.x),y=Math.round(c.y),b=Math.round(Math.sin(t*2.4+c.ph)*1.5),pl=.5+.5*Math.sin(t*3+c.ph);
  ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.55+pl*.35;ctx.drawImage(glow,x-70,y-70,140,140);ctx.globalCompositeOperation="source-over";
  ctx.globalAlpha=.4;ctx.fillStyle="#050a08";ctx.fillRect(x-20,y+10,40,6);ctx.globalAlpha=1;
  ctx.drawImage(chestImg,x-21,y-20+b);
  const s=Math.max(0,Math.sin(t*2+c.ph*2));if(s>.2){const l=Math.round(2+s*3);ctx.globalAlpha=s;ctx.fillStyle="#fff7c0";ctx.fillRect(x+10-l,y-24+b,l*2+1,1);ctx.fillRect(x+10,y-24-l+b,1,l*2+1);ctx.globalAlpha=1}}}
/* ===== 보유 상자 아이템 바: 마우스 올리면 설명 / 화살표로 접기·펼치기 ===== */
const relicBar={open:true,slide:0,last:0,hit:[],tab:null,hover:null,pinned:null,mx:-99,my:-99,cur:false};
function wrapText(t,maxW){const out=[];let line="";for(const ch of t){const l=line+ch;if(ctx.measureText(l).width>maxW&&line){out.push(line);line=ch}else line=l}if(line)out.push(line);return out}
const inBox=(x,y,b,pad=0)=>x>=b.x-pad&&x<=b.x+b.w+pad&&y>=b.y-pad&&y<=b.y+b.h+pad;
function relicPtr(e){const rc=canvas.getBoundingClientRect();if(!rc.width)return false;relicBar.mx=(e.clientX-rc.left)*W/rc.width;relicBar.my=(e.clientY-rc.top)*H/rc.height;return relicBar.mx>=0&&relicBar.mx<=W&&relicBar.my>=0&&relicBar.my<=H}
document.addEventListener("pointermove",e=>{if(!relicPtr(e)){relicBar.mx=relicBar.my=-99}});
document.addEventListener("pointerdown",e=>{if(!relicPtr(e))return;const rb=relicBar,{mx,my}=rb;
 if(rb.tab&&inBox(mx,my,rb.tab,4)){rb.open=!rb.open;rb.pinned=null;return}
 const h=rb.slide<.3&&rb.hit.find(b=>inBox(mx,my,b));rb.pinned=h?(rb.pinned===h.r?null:h.r):null});
function drawRelicBar(){
 const rb=relicBar,now=performance.now(),dt=Math.min(.1,(now-(rb.last||now))/1000);rb.last=now;
 const goal=rb.open?0:1;rb.slide+=(goal-rb.slide)*Math.min(1,dt*10);if(Math.abs(goal-rb.slide)<.003)rb.slide=goal;
 const it=state.items||{},list=relics.filter(r=>it[r.id]);rb.hit=[];rb.tab=null;
 if(!list.length){rb.hover=null;if(rb.cur){canvas.style.cursor="";rb.cur=false}return}
 const cy=70,sw=list.reduce((a,r)=>a+(it[r.id]>1?46:28)+4,0),total=12+sw,off=-total*rb.slide;
 ctx.save();ctx.textAlign="left";let cx=Math.round(12+off);
 for(const r of list){const k=it[r.id],w=k>1?46:28,hv=rb.mx>=0&&rb.slide<.3&&inBox(rb.mx,rb.my,{x:cx,y:cy,w,h:22});
  ctx.fillStyle=hv||rb.pinned===r?"#1c3326ee":"#0b1510cc";ctx.fillRect(cx,cy,w,22);ctx.fillStyle=RARITY[r.rar].c;ctx.fillRect(cx,cy+20,w,2);
  if(hv||rb.pinned===r){ctx.strokeStyle=RARITY[r.rar].c;ctx.lineWidth=1;ctx.strokeRect(cx+.5,cy+.5,w-1,21)}
  ctx.font="14px sans-serif";ctx.fillStyle="#fff";ctx.fillText(r.icon,cx+3,cy+17);
  if(k>1){ctx.font="bold 11px monospace";ctx.fillStyle="#ffd54a";ctx.fillText("x"+k,cx+24,cy+16)}
  rb.hit.push({x:cx,y:cy,w,h:22,r,k});cx+=w+4}
 // 접기/펼치기 화살표 탭
 const tab={x:cx,y:cy,w:18,h:22},th=rb.mx>=0&&inBox(rb.mx,rb.my,tab,2);rb.tab=tab;
 ctx.fillStyle=th?"#1c3326f2":"#0b1510dd";ctx.fillRect(tab.x,tab.y,tab.w,tab.h);ctx.strokeStyle=th?"#fff4c8":"#7f9a86";ctx.lineWidth=1;ctx.strokeRect(tab.x+.5,tab.y+.5,tab.w-1,tab.h-1);
 const ax=tab.x+tab.w/2,ay=tab.y+11,d=rb.open?-1:1;ctx.fillStyle=th?"#fff4c8":"#cfe8c9";ctx.beginPath();ctx.moveTo(ax+4*d,ay);ctx.lineTo(ax-3*d,ay-6);ctx.lineTo(ax-3*d,ay+6);ctx.closePath();ctx.fill();
 if(rb.slide>.5){ctx.font="bold 10px monospace";ctx.textAlign="center";ctx.fillStyle="#ffd54a";ctx.fillText(String(list.reduce((a,r)=>a+it[r.id],0)),tab.x+tab.w/2,tab.y-3)}
 // 툴팁
 let hov=rb.slide<.3&&rb.mx>=0?rb.hit.find(b=>inBox(rb.mx,rb.my,b)):null;if(!hov&&rb.pinned&&rb.slide<.3)hov=rb.hit.find(b=>b.r===rb.pinned)||null;
 rb.hover=hov;const want=!!(hov||th);if(want!==rb.cur){canvas.style.cursor=want?"pointer":"";rb.cur=want}
 if(hov&&!state.choosing){const r=hov.r,R=RARITY[r.rar],tw=236;ctx.font="12px monospace";const lines=wrapText(tf(r,"desc"),tw-20),th2=14+20+14+lines.length*16+8,tx=Math.round(Math.min(Math.max(6,hov.x),W-tw-6)),ty=cy+28;
  ctx.fillStyle="#050b09f4";ctx.fillRect(tx,ty,tw,th2);ctx.strokeStyle=R.c;ctx.lineWidth=2;ctx.strokeRect(tx+1,ty+1,tw-2,th2-2);
  ctx.textAlign="left";ctx.font="18px sans-serif";ctx.fillStyle="#fff";ctx.fillText(r.icon,tx+10,ty+25);
  ctx.font="bold 13px monospace";ctx.fillStyle=R.c;ctx.fillText(tf(r,"name"),tx+36,ty+20);
  ctx.font="10px monospace";ctx.fillStyle="#9fb3a0";ctx.fillText(isEN()?R.nEn+" · Drop "+r.w+"% · Owned "+hov.k:R.n+" · 등장 "+r.w+"% · 보유 "+hov.k+"개",tx+36,ty+34);
  ctx.font="12px monospace";ctx.fillStyle="#e4f2de";lines.forEach((l,i)=>ctx.fillText(l,tx+10,ty+54+i*16))}
 ctx.restore()}
function drawChestUI(){
 const n=state.toast;
 if(n){const w=300,x=Math.round((W-w)/2),y=52,a=Math.min(1,n.t*2,(3.4-n.t)*6);ctx.save();ctx.globalAlpha=a;
  ctx.fillStyle="#050b09e6";ctx.fillRect(x,y,w,46);const R=RARITY[n.rar];ctx.strokeStyle=R.c;ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,w-2,44);ctx.textAlign="right";ctx.font="10px monospace";ctx.fillStyle=R.c;ctx.fillText(tf(R,"n")+" · "+n.w+"%",x+w-6,y+12);
  ctx.textAlign="center";ctx.font="22px sans-serif";ctx.fillStyle="#fff";ctx.fillText(n.icon,x+26,y+31);
  ctx.textAlign="center";ctx.font="bold 13px monospace";ctx.fillStyle=R.c;ctx.fillText(n.name,x+w/2+14,y+20);
  ctx.font="12px monospace";ctx.fillStyle="#cfe8c9";ctx.fillText(n.desc,x+w/2+14,y+37);ctx.restore()}
 drawRelicBar();ctx.textAlign="left"}
const glow=(()=>{const c=document.createElement("canvas");c.width=c.height=220;const g=c.getContext("2d"),r=g.createRadialGradient(110,110,4,110,110,110);r.addColorStop(0,"rgba(255,226,140,.20)");r.addColorStop(1,"rgba(255,226,140,0)");g.fillStyle=r;g.fillRect(0,0,220,220);return c})();
const vig=(()=>{const c=document.createElement("canvas");c.width=W;c.height=H;const g=c.getContext("2d"),r=g.createRadialGradient(W/2,H/2,H*.35,W/2,H/2,W*.62);r.addColorStop(0,"rgba(3,10,14,0)");r.addColorStop(1,"rgba(3,10,14,.72)");g.fillStyle=r;g.fillRect(0,0,W,H);return c})();
const flies=Array.from({length:26*WORLD_SCALE*WORLD_SCALE},()=>({x:rand(40,WW-40),y:rand(60,WH-40),a:rand(0,6.28),s:rand(.5,1.1),r:rand(10,30)}));
// 불씨 조각: 떠다니는 불씨 먼지와 구분되도록 각진 붉은 수정 모양
const SHARD_ROWS=["...b...","..bcb..",".bcwcb.","bcwccdb","bcccddb","bcccddb","bccdddb",".bcddb.","..bdb..","...b..."];
const mkShard=pal=>{const c=document.createElement("canvas");c.width=7;c.height=10;const g=c.getContext("2d");SHARD_ROWS.forEach((r,y)=>{for(let x=0;x<7;x++){const k=r[x];if(k!=="."){g.fillStyle=pal[k];g.fillRect(x,y,1,1)}}});return c};
const SHARDS={small:mkShard({b:"#5a1410",c:"#ff6a3a",w:"#fff2d8",d:"#d03a22"}),big:mkShard({b:"#6a3a00",c:"#ffd54a",w:"#fffbe6",d:"#f0a020"})};
function drawFlies(){const t=performance.now()/1000;
 if(themeOf()==="cloud"&&state.mode!=="tower"){let i=0;ctx.save();for(const f of flies){if(++i>140)break;
  if(i%4===0){const sp=26+f.s*20,x=cam.x+((f.x+t*sp)%(W+80)+W+80)%(W+80)-40,y=cam.y+(((f.y+Math.sin(t*f.s+f.a)*10)%H)+H)%H;ctx.globalAlpha=.12+.08*Math.sin(t+f.a);ctx.fillStyle="#e8eaff";ctx.fillRect(Math.round(x)-18,Math.round(y),36,3);ctx.fillRect(Math.round(x)-10,Math.round(y)-2,20,2)}
  else{const sp=10+f.s*14,y=cam.y+((((f.y-t*sp)%(H+20))+H+20)%(H+20))-10,x=cam.x+(((f.x+Math.sin(t*f.s+f.a)*12)%W)+W)%W;ctx.globalAlpha=.3+.45*(.5+.5*Math.sin(t*2.4+f.a));ctx.fillStyle=f.s>.9?"#ffffff":"#fff0c0";ctx.fillRect(Math.round(x),Math.round(y),2,2)}}ctx.restore();ctx.globalAlpha=1;return}
 if(themeOf()==="palace"&&state.mode!=="tower"){let i=0;for(const f of flies){if(++i>150)break;
  if(i%3===0){const sp=12+f.s*16,y=cam.y+((((f.y-t*sp)%(H+20))+H+20)%(H+20))-10,x=cam.x+(((f.x+Math.sin(t*f.s+f.a)*10)%W)+W)%W;ctx.globalAlpha=.25+.45*(.5+.5*Math.sin(t*2.4+f.a));ctx.fillStyle="#fff0a0";ctx.fillRect(Math.round(x),Math.round(y),2,2)}
  else{const sp=18+f.s*18,y=cam.y+((f.y+t*sp)%(H+20)+H+20)%(H+20)-10,x=cam.x+(((f.x+t*sp*.4+Math.sin(t*f.s*1.8+f.a)*18)%W)+W)%W,fl=Math.sin(t*3+f.a),X=Math.round(x),Y=Math.round(y);ctx.globalAlpha=.85;ctx.fillStyle=f.s>.85?"#ffe070":"#e8a820";
   if(fl>0){ctx.fillRect(X-2,Y,5,2);ctx.fillRect(X-1,Y+2,3,1);ctx.fillStyle="#8a5a10";ctx.fillRect(X,Y+3,1,2)}else{ctx.fillRect(X-1,Y,3,2);ctx.fillRect(X,Y+2,1,2)}}}ctx.globalAlpha=1;return}
 if(themeOf()==="blossom"&&state.mode!=="tower"){let i=0;for(const f of flies){if(++i>130)break;const sp=22+f.s*20,y=cam.y+((f.y+t*sp)%(H+20)+H+20)%(H+20)-10,x=cam.x+(((f.x+t*sp*.6+Math.sin(t*f.s*2+f.a)*14)%W)+W)%W;ctx.globalAlpha=.55+.3*Math.sin(t*3+f.a);ctx.fillStyle=f.s>.9?"#ffe0ea":"#ffb8d0";ctx.fillRect(Math.round(x),Math.round(y),3,2)}ctx.globalAlpha=1;return}
 if(themeOf()==="canyon"&&state.mode!=="tower"){let i=0;for(const f of flies){if(++i>120)break;const sp=40+f.s*50,x=cam.x+((f.x+t*sp)%(W+20)+W+20)%(W+20)-10,y=cam.y+(((f.y+Math.sin(t*f.s*1.6+f.a)*12)%H)+H)%H;ctx.globalAlpha=.3+.3*(.5+.5*Math.sin(t*2+f.a));ctx.fillStyle=f.s>.9?"#ffffff":"#d8d8f0";ctx.fillRect(Math.round(x),Math.round(y),f.s>.9?4:3,1)}ctx.globalAlpha=1;return}
 if(themeOf()==="frozen"&&state.mode!=="tower"){let i=0;for(const f of flies){if(++i>140)break;const sp=18+f.s*26,y=cam.y+((f.y+t*sp)%(H+20)+H+20)%(H+20)-10,x=cam.x+(((f.x+Math.sin(t*f.s+f.a)*14)%W)+W)%W;ctx.globalAlpha=.35+.35*(.5+.5*Math.sin(t*2+f.a));ctx.fillStyle=f.s>.9?"#ffffff":"#cfe6ff";const z=f.s>.9?3:2;ctx.fillRect(Math.round(x),Math.round(y),z,z)}ctx.globalAlpha=1;return}
 for(const f of flies){if(f.x<cam.x-40||f.x>cam.x+W+40||f.y<cam.y-40||f.y>cam.y+H+40)continue;const x=f.x+Math.cos(t*f.s+f.a)*f.r,y=f.y+Math.sin(t*f.s*1.3+f.a)*f.r*.7,b=.5+.5*Math.sin(t*2.2*f.s+f.a*3);ctx.globalAlpha=.12+b*.18;ctx.fillStyle="#ff9a4a";ctx.beginPath();ctx.arc(x,y,7,0,6.283);ctx.fill();ctx.globalAlpha=.5+b*.5;ctx.fillStyle="#ffe0a0";ctx.fillRect(Math.round(x),Math.round(y),2,2)}ctx.globalAlpha=1}
/* ================= /ART ================= */
function render(){
let p=state.p;if(!p)return;setCam();const sk=state.shake||0;if(sk>0){ctx.save();ctx.translate(Math.round(rand(-sk,sk)),Math.round(rand(-sk,sk)))}
{const k=bg.k||1;ctx.drawImage(bg,cam.x/k,cam.y/k,W/k,H/k,0,0,W,H)}if(state.mode==="tower")towerTint();ctx.save();ctx.translate(-cam.x,-cam.y);ctx.globalCompositeOperation="lighter";ctx.drawImage(glow,Math.round(p.x)-110,Math.round(p.y)-110);ctx.globalCompositeOperation="source-over";
drawChests();drawAltars();drawMagnets();drawPortal();
for(const g of state.gems){const b=Math.round(Math.sin(g.phase)*2),x=Math.round(g.x),y=Math.round(g.y)+b;ctx.globalAlpha=.35;ctx.fillStyle="#050a08";ctx.fillRect(x-6,Math.round(g.y)+10,13,3);ctx.globalAlpha=1;ctx.drawImage(g.value>=5?SHARDS.big:SHARDS.small,x-7,y-10,14,20);const s=Math.max(0,Math.sin(g.phase*.8));if(s>.15){const l=Math.round(3+s*4);ctx.globalAlpha=s;ctx.fillStyle="#fff";ctx.fillRect(x+5-l,y-8,l*2+1,1);ctx.fillRect(x+5,y-8-l,1,l*2+1);ctx.globalAlpha=1}}
for(const a of state.arrows){if(a.wind){drawWind(a);continue}if(a.qi){drawQi(a);continue}if(a.water){drawWaterShot(a);continue}if(a.feather){drawFeatherShot(a);continue}ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(a.vy,a.vx));if(a.big)ctx.scale(a.big,a.big);const fl=Math.sin(state.time*40+a.x*.1);
const dot=(x,r,c,al)=>{ctx.globalAlpha=al;ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,0,r,0,6.283);ctx.fill()};
dot(0,12,"#ff8a2a",.18);for(let i=5;i>=1;i--)dot(-i*5,6.5-i*.9+fl*.4,i<3?"#ff8a2a":"#e0523a",.55-i*.08);
dot(0,7,"#7a1e22",1);dot(0,5.8,"#e0523a",1);dot(1,4.2,"#ff8a2a",1);dot(1.5,2.6,"#ffd54a",1);dot(2,1.2,"#fff7dc",1);ctx.restore()}
for(let i=0;i<p.blades;i++){let a=state.time*2.4+i*Math.PI*2/p.blades,bx=p.x+Math.cos(a)*p.bladeRadius,by=p.y+Math.sin(a)*p.bladeRadius;ctx.globalAlpha=.22;ctx.strokeStyle=p.ev_blade?"#ff2a4a":p.charId==="hyunmu"?"#7fd0ff":p.charId==="baekho"?"#dff0ff":p.charId==="cheongryong"?"#9fe8ff":p.charId==="hwangryong"?"#ffd54a":"#ff8a2a";ctx.lineWidth=4;ctx.beginPath();ctx.arc(p.x,p.y,p.bladeRadius,a-.7,a-.05);ctx.stroke();ctx.globalAlpha=1;
ctx.save();ctx.translate(bx,by);const fl=Math.sin(state.time*18+i*2);
const dot=(r,c,al)=>{ctx.globalAlpha=al;ctx.fillStyle=c;ctx.beginPath();ctx.arc(0,0,r,0,6.283);ctx.fill()};
if(p.charId==="zhuque"){ctx.rotate(a+Math.PI/2);ctx.globalAlpha=1;drawFeatherShape(ctx,1.05,fl)}else if(p.charId==="cheongryong"){dot(14,"#5ac8ff",.2);ctx.globalAlpha=1;for(const [dx,dy,r,c] of [[-4,1,5,"#3a4a6a"],[4,1,5,"#3a4a6a"],[0,-2,6,"#6a7a9a"]]){ctx.fillStyle=c;ctx.beginPath();ctx.arc(dx,dy,r,0,6.283);ctx.fill()}ctx.strokeStyle=Math.sin(state.time*30+i)>0?"#fff2a0":"#9fe8ff";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,4);ctx.lineTo(-2,8);ctx.lineTo(1,8);ctx.lineTo(-1,12);ctx.stroke()}else if(p.charId==="hwangryong"){dot(13,"#ffd54a",.2);dot(7.5+fl*.4,"#3a2408",1);dot(6.3+fl*.4,"#f0b828",1);dot(4.4,"#ffe070",1);dot(2.2,"#ffffff",1);ctx.globalAlpha=1}else if(p.charId==="baekho"){ctx.rotate(a+Math.PI/2);dot(13,"#cfe8ff",.18);ctx.globalAlpha=1;ctx.lineCap="round";ctx.strokeStyle="#2a2a3a";ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,4,9,-2.6,-.5);ctx.stroke();ctx.strokeStyle="#ffffff";ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,4,9,-2.6,-.5);ctx.stroke();ctx.strokeStyle="#9fd8ff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,6,6,-2.5,-.6);ctx.stroke()}else if(p.charId==="hyunmu"){dot(13,"#7fd0ff",.2);dot(8.5+fl*.4,"#14303c",1);dot(7.2+fl*.4,"#2f7fa8",1);dot(5.2,"#5fc0e8",1);dot(3,"#bfefff",1);ctx.globalAlpha=1;ctx.fillStyle="#fff";ctx.fillRect(-3,-4,2,2)}else{dot(14,"#ff6a2a",.22);dot(9+fl*.5,"#7a1e22",1);dot(7.6+fl*.5,"#e0523a",1);dot(5.6,"#ff8a2a",1);dot(3.4,"#ffd54a",1);dot(1.6,"#fff7dc",1)}if(p.ev_blade){ctx.globalAlpha=.3;ctx.fillStyle="#ff2a4a";ctx.beginPath();ctx.arc(0,0,17,0,6.283);ctx.fill();ctx.rotate(state.time*14);ctx.globalAlpha=1;ctx.fillStyle="#c8102e";for(let k=0;k<3;k++){ctx.rotate(2.094);ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(4,-6);ctx.lineTo(-4,-6);ctx.closePath();ctx.fill()}ctx.fillStyle="#ffd0d8";ctx.fillRect(-1,-15,2,4)}ctx.restore()}
skDrawUnder();for(const e of state.enemies){drawEnemy(e);elemDraw(e);if(e.slowT>0&&!e.boss){ctx.globalAlpha=.3;ctx.fillStyle="#9fe4ff";ctx.beginPath();ctx.arc(e.x,e.y-4,e.r+5,0,6.283);ctx.fill();ctx.globalAlpha=1}}
drawEb();
if(p.invuln<=0||Math.floor(state.time*14)%2===0)drawPlayer(p);
drawFx();skDrawOver();
for(const q of state.particles){ctx.globalAlpha=Math.max(0,q.life/q.max);ctx.fillStyle=q.color;ctx.fillRect(q.x,q.y,q.size,q.size)}ctx.globalAlpha=1;
if(settings.fireflies)drawFlies();drawDark();ctx.restore();
if(settings.vignette)ctx.drawImage(vig,0,0);
{const r=state.next?Math.min(1,state.xp/state.next):0,w=Math.round(W*r);ctx.fillStyle="#0b1510";ctx.fillRect(0,0,W,12);ctx.fillStyle="#3a3416";ctx.fillRect(0,0,W,10);ctx.fillStyle="#ffd54a";ctx.fillRect(0,0,w,10);ctx.fillStyle="#fff1a8";ctx.fillRect(0,0,w,3);ctx.fillStyle="#6b5a1e";ctx.fillRect(0,10,W,2);ctx.fillStyle="#0b1510";for(let x=W/10;x<W;x+=W/10)ctx.fillRect(Math.round(x),0,2,10);if(state.level){ctx.font="bold 12px monospace";ctx.textAlign="center";ctx.fillStyle="#0b1510";ctx.fillText(`LV ${state.level}`,W/2+1,43);ctx.fillStyle="#ffe58a";ctx.fillText(`LV ${state.level}`,W/2,42);ctx.textAlign="left"}}
{const mh=state.p.maxHp||100,hp=Math.max(0,state.p.hp??mh),w=Math.round(W*hp/mh),t=`${Math.ceil(hp)} / ${mh}`+(state.p.charId==="zhuque"&&!state.p.revived&&!state.p.noRevive?tx(" · ✦불사"," · ✦Undying"):"")+(state.p.charId==="hyunmu"?tx(" · 결계 "," · Barrier ")+(state.p.bar||0):"");ctx.fillStyle="#3a1218";ctx.fillRect(0,12,W,14);ctx.fillStyle="#e0526a";ctx.fillRect(0,12,w,14);ctx.fillStyle="#ff9aa8";ctx.fillRect(0,12,w,3);ctx.fillStyle="#5e2430";ctx.fillRect(0,26,W,2);ctx.font="bold 11px monospace";ctx.textAlign="center";ctx.fillStyle="#2a0a10";ctx.fillText(t,W/2+1,23);ctx.fillStyle="#fff";ctx.fillText(t,W/2,22);ctx.textAlign="left"}
drawBossUI();if(state.mode==="tower")drawFloorUI();else{ctx.fillStyle="#0b1510aa";ctx.fillRect(12,34,112,30);ctx.fillStyle="#e7f1df";ctx.font="bold 13px monospace";ctx.fillStyle=state.bossNight?"#ff9aa8":"#e7f1df";ctx.fillText(`NIGHT ${String(state.night).padStart(2,"0")}`,22,50);ctx.fillStyle="#1d2b22";ctx.fillRect(22,55,92,4);ctx.fillStyle=state.bossNight?"#e0526a":"#ffd54a";ctx.fillRect(22,55,Math.round(92*Math.min(1,(state.nightT||0)/NIGHT_LEN)),4)}ctx.fillStyle="#b8c9b6";ctx.font="12px monospace";ctx.fillStyle="#b8c9b6";ctx.font="12px monospace";ctx.fillText(`${state.enemies.length} HOSTILES`,W-130,51);
if(state.diff==="hard"){const bx=state.mode==="tower"?178:130;ctx.fillStyle="#2a060cdd";ctx.fillRect(bx,34,48,16);ctx.strokeStyle="#ff4a5a";ctx.lineWidth=1;ctx.strokeRect(bx+.5,34.5,47,15);ctx.font="bold 11px monospace";ctx.textAlign="center";ctx.fillStyle="#ff8a94";ctx.fillText("HARD",bx+24,46);ctx.textAlign="left"}
drawChestUI();drawMinimap();
if(state.paused&&!state.choosing){ctx.fillStyle="#07100bb0";ctx.fillRect(0,0,W,H);ctx.fillStyle="#f2e8cf";ctx.font="bold 30px monospace";ctx.textAlign="center";ctx.fillText("PAUSED",W/2,H/2);ctx.textAlign="left"}
if(state.flash>0){ctx.globalAlpha=Math.min(1,state.flash);ctx.fillStyle=state.flashC||"#fff";ctx.fillRect(0,0,W,H);ctx.globalAlpha=1}if(sk>0)ctx.restore()
}
function hud(){if(!state)return;let p=state.p;ui.hpText.textContent=`${Math.ceil(p.hp)} / ${p.maxHp}`+(p.charId==="zhuque"&&!p.revived&&!p.noRevive?tx(" · ✦불사"," · ✦Undying"):"")+(p.charId==="hyunmu"?tx(" · 결계 "," · Barrier ")+(p.bar||0):"")+(p.charId==="baekho"&&p.hunt>0?tx(" · 사냥 "," · Hunt ")+p.hunt:"")+(p.charId==="cheongryong"&&!p.noPassive?tx(" · 여의주 "," · Pearl ")+(p.pearl||0)+"/"+(p.pearlEvery||CHEONG.pearl.every):"")+(p.charId==="hwangryong"&&!p.noPassive?tx(" · 비늘 "," · Scale ")+(p.gscale>0?"◆":"◇"):"")+(p.charId==="qilin"&&!p.noPassive&&p.holy>0?tx(" · 보호막 "," · Shield ")+Math.ceil(p.holy):"")+(p.charId==="qilin"?tx(" · 천명 "," · Mandate ")+Math.floor(Math.min(1,(p.karma||0)/(p.maxHp*QILIN.karma.cap))*100)+"%":"");ui.hpFill.style.width=`${p.hp/p.maxHp*100}%`;ui.expText.textContent=`${state.xp} / ${state.next}`;ui.expFill.style.width=`${state.xp/state.next*100}%`;ui.worldExpText.textContent=`LV ${state.level} · ${state.xp} / ${state.next}`;ui.worldExpFill.style.width=`${state.xp/state.next*100}%`;ui.levelText.textContent=state.level;ui.timeText.textContent=fmtTime(state.time);ui.killsText.textContent=state.kills;syncSkipBtn()}
/* ===== 주작 패시브 '불사': 1회 부활 (3초 무적, 최대 체력 50% 감소) ===== */
const REVIVE_INVULN=3,REVIVE_HP_CUT=.5;
function die(){const p=state.p;
 if(p.charId==="zhuque"&&!p.revived&&!p.noRevive){p.revived=true;p.maxHp=Math.max(10,Math.round(p.maxHp*(1-REVIVE_HP_CUT)));p.hp=p.maxHp;p.invuln=REVIVE_INVULN;state.eb=[];
  burst(p.x,p.y,"#ffb04a",40);burst(p.x,p.y,"#ffe0a0",20);
  state.banner={text:tx("불사 — 주작이 불꽃 속에서 되살아났다!","Undying — Zhuque rises from the flames!"),t:2.6};hud();return}
 if(state.mode==="tower"){state.lives=Math.max(0,state.lives-1);if(state.lives>0){towerRespawn();return}}
 end()}
/* ===== 마법의 탑: 시작 지점 복귀 · 목숨 ===== */
function toStart(p){p.x=state.startX??WW/2;p.y=state.startY??WH/2;p.moving=false;state.ptrail=[];setCam()}
function towerRespawn(){const p=state.p;burst(p.x,p.y,"#ff6b78",30);toStart(p);const hm=p.healMul;p.healMul=null;p.hp=p.maxHp;p.healMul=hm;p.invuln=3;state.eb=[];
 state.enemies=state.enemies.filter(e=>{if(e.boss||dist2(e,p)>260*260)return true;burst(e.x,e.y,"#8f8ca0",4);return false});
 burst(p.x,p.y,"#e9dcff",30);state.shake=Math.max(state.shake||0,.4);
 state.banner={text:tx(`쓰러졌다! 시작 지점으로 돌아갑니다 · 남은 목숨 ${state.lives}`,`You fell! Back to the start · Lives left ${state.lives}`),t:2.8};hud()}

/* ================= 판 결과 리포트: 무기별 피해 · 받은 피해 · 고른 강화 · 처치한 보스 ================= */
const runReport=(()=>{
const css=document.createElement("style");
css.textContent="#gameOverOverlay .panel{width:min(780px,95vw);max-height:94vh;max-height:94dvh;overflow:auto}.rr{display:grid;grid-template-columns:1.25fr 1fr;gap:12px;margin:10px 0 2px;text-align:left}.rr-box{padding:10px 12px;background:var(--panel2,#12281d);box-shadow:0 -2px 0 0 #24503b,0 2px 0 0 #24503b,-2px 0 0 0 #24503b,2px 0 0 0 #24503b}.rr-box h3{margin:0 0 8px;font-size:14px;font-weight:400;letter-spacing:.08em;color:var(--gold,#ffd54a)}.rr-box.wide{grid-column:1/-1}"
 +".rr-dmg{display:grid;grid-template-columns:auto 1fr auto;gap:5px 8px;align-items:center;font-size:13px}.rr-dmg i{font-style:normal;color:#d6e4d3;white-space:nowrap}.rr-dmg .bar{height:9px;background:#0a140f;position:relative}.rr-dmg .bar u{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#ff8a2a,#ffd54a)}.rr-dmg b{font-weight:400;color:#fff3b0;white-space:nowrap;text-align:right}.rr-dmg b small{color:var(--muted,#9db8a4);margin-left:4px}.rr-sum{margin-top:8px;font-size:12px;color:var(--muted,#9db8a4)}"
 +".rr-kv{display:grid;grid-template-columns:1fr auto;gap:4px 10px;font-size:13px}.rr-kv i{font-style:normal;color:#d6e4d3}.rr-kv b{font-weight:400;color:#fff3b0;text-align:right}.rr-kv b.bad{color:#ff9aa8}.rr-kv b.good{color:#7dff9a}"
 +".rr-chips{display:flex;flex-wrap:wrap;gap:6px}.rr-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 7px 3px 4px;font-size:12px;color:#e7f1df;background:#0a140f;border:1px solid var(--rc,#2d5c44)}.rr-chip img{width:20px;height:20px;image-rendering:pixelated}.rr-chip .em{font-size:15px;line-height:1}.rr-chip b{font-weight:400;color:var(--gold,#ffd54a)}.rr-sub{margin:8px 0 4px;font-size:12px;color:var(--muted,#9db8a4)}.rr-none{font-size:12px;color:var(--muted,#9db8a4)}"
 +".rr-boss{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px}.rr-boss span{color:#ffb0b8}.rr-boss small{color:var(--muted,#9db8a4);margin-left:4px}"
 +"@media (max-width:680px){.rr{grid-template-columns:1fr}}@media (max-height:520px){.rr-box{padding:6px 10px}.rr-dmg,.rr-kv{font-size:12px}}";
document.head.appendChild(css);
const upName=id=>{const p=state.p,z=p.charId==="zhuque"?ZUP[id]:p.charId==="hyunmu"?HUP[id]:p.charId==="baekho"?BUP[id]:p.charId==="cheongryong"?CUP[id]:p.charId==="hwangryong"?WUP[id]:p.charId==="qilin"?QUP[id]:SK[id]||null,u=upgrades.find(x=>x.id===id)||(p.charId==="zhuque"?ZPOOL:p.charId==="hyunmu"?HPOOL:p.charId==="baekho"?BPOOL:p.charId==="cheongryong"?CPOOL:p.charId==="hwangryong"?WPOOL:p.charId==="qilin"?QPOOL:upgrades).find(x=>x.id===id);return z?tf(z,"name"):u?tf(u,"name"):id};
function label(k){const c=state.p.charId;
 if(k==="main"&&state.p.ev_main)return weaponEvo.name(WEVO.find(w=>w.id==="main"));if(k==="blade"&&state.p.ev_blade)return weaponEvo.name(WEVO.find(w=>w.id==="blade"));if(k==="meteor"&&state.p.ev_storm)return weaponEvo.name(WEVO.find(w=>w.id==="storm"));if(k==="pulse"&&state.p.ev_pulse)return weaponEvo.name(WEVO.find(w=>w.id==="pulse"));
 if(k==="main")return c==="zhuque"?tx("검기","Sword Wave"):c==="hyunmu"?tx("물방울탄","Water Bolt"):c==="baekho"?tx("발톱 베기","Claw Swipe"):c==="cheongryong"?tx("번개 사슬","Chain Lightning"):c==="hwangryong"?tx("황금 기둥","Golden Pillar"):c==="qilin"?tx("성광 창","Holy Lance"):tx("불꽃탄","Fire Bolt");if(k==="dash")return tx("질풍 돌진","Gale Dash");if(k==="rain")return tx("비구름","Rain Cloud");
 return {whip:tx("채찍","Whip"),boom:tx("진화 폭발","Evolved Burst"),aura:tx("불꽃 오라","Flame Aura"),elem_burn:tx("화상 (업화)","Burn (Hellfire)"),seal:tx("오행 봉인 폭발","Five-Phase Seal Blast"),z_echo:tx("불새 분신","Phoenix Echo"),z_trail:tx("업화의 발자취","Trail of Hellfire"),z_dive:tx("주작 강림","Zhuque Descends"),h_spike:tx("가시 물방울","Spiked Droplets"),h_vortex:tx("소용돌이","Whirlpool"),h_tide:tx("북해의 해일","Tidal Wave"),b_ghost:tx("백호 잔상","Tiger Afterimage"),c_web:tx("전기 그물","Static Web"),c_spout:tx("용오름","Waterspout"),c_ascend:tx("청룡 승천","Dragon Ascension"),w_ley:tx("지맥","Ley Lines"),w_form:tx("오방진","Five-Direction Array"),w_desc:tx("황룡 강림","Hwangryong Descends"),q_smite:tx("천벌","Smite"),q_mandate:tx("천명","Mandate of Heaven"),i_ignite:tx("불씨 점화","Kindle Burst"),i_kindle:tx("모닥불","Campfire"),i_swarm:tx("꼬마 불씨 용","Ember Hatchlings"),q_prism:tx("굴절","Refraction"),q_gate:tx("천상의 문","Heavenly Gate"),elem_ember:tx("그을림 (잿불)","Scorch (Embers)"),counter:tx("반격 물결","Counter Wave"),hw_fire:tx("오방 · 주작 검기","Five-Way · Zhuque Wave"),hw_water:tx("오방 · 현무 물방울","Five-Way · Hyunmu Water"),hw_wind:tx("오방 · 백호 바람 칼날","Five-Way · Baekho Wind"),hw_bolt:tx("오방 · 청룡 번개","Five-Way · Cheongryong Bolt"),scale:tx("황금 비늘 땅울림","Golden Scale Quake"),feather:upName("feather"),blade:upName("blade"),pulse:upName("spore"),meteor:upName("storm"),etc:tx("기타","Other")}[k]||k}
const n0=v=>v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e4?(v/1e3).toFixed(1)+"k":Math.round(v).toLocaleString();
function html(){const s=state,R=s.rs;if(!R)return"";const t=Math.max(1,s.time);
 const list=Object.entries(R.dmg).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]),tot=list.reduce((a,[,v])=>a+v,0),mx=list.length?list[0][1]:1;
 const dmg=list.length?'<div class="rr-dmg">'+list.map(([k,v])=>`<i>${label(k)}</i><span class="bar"><u style="width:${Math.max(2,v/mx*100).toFixed(1)}%"></u></span><b>${n0(v)}<small>${Math.round(v/tot*100)}%</small></b>`).join("")+'</div><p class="rr-sum">'+tx(`총 ${n0(tot)} · 초당 ${n0(tot/t)}`,`Total ${n0(tot)} · ${n0(tot/t)}/s`)+'</p>':'<p class="rr-none">'+tx("기록 없음","No data")+'</p>';
 const kv=[[tx("받은 피해","Damage taken"),n0(R.taken),"bad"],[tx("피격 횟수","Times hit"),R.hits,"bad"],[tx("회복한 체력","HP healed"),n0(R.healed),"good"]];
 if(s.p.charId==="hyunmu")kv.push([tx("결계로 막은 공격","Hits blocked by barrier"),R.blocked,"good"]);
 kv.push([tx("처치","Kills"),s.kills,""],[tx("정예 처치","Elites slain"),R.elites,""],[tx("초당 받은 피해","Damage taken / s"),(R.taken/t).toFixed(1),"bad"]);
 const chip=(ic,name,n,c,img)=>`<span class="rr-chip" style="--rc:${c||"#2d5c44"}">${img?`<img src="${ic}" alt="">`:`<span class="em">${ic}</span>`}${name}${n>1?` <b>×${n}</b>`:""}</span>`;
 const ups=Object.values(R.ups).sort((a,b)=>b.n-a.n),alt=Object.values(R.altar).sort((a,b)=>b.n-a.n),it=s.items||{},rel=relics.filter(r=>it[r.id]);
 const build='<div class="rr-chips">'+(ups.length?ups.map(u=>chip(u.icon,u.name,u.n,RARITY[u.rar]&&RARITY[u.rar].c,true)).join(""):'<span class="rr-none">'+tx("고른 강화 없음","No upgrades chosen")+'</span>')+'</div>'
  +(rel.length?'<p class="rr-sub">'+tx("유물","Relics")+'</p><div class="rr-chips">'+rel.map(r=>chip(r.icon,tf(r,"name"),it[r.id],RARITY[r.rar].c)).join("")+'</div>':"")
  +(R.evo&&R.evo.length?'<p class="rr-sub">'+tx("무기 진화","Weapon evolutions")+'</p><div class="rr-chips">'+R.evo.map(v=>chip(v.icon,v.name+' <small style="color:#9db8a4">'+fmtTime(v.time)+'</small>',1,"#ffd54a")).join("")+'</div>':"")+(alt.length?'<p class="rr-sub">'+tx("제단의 축복","Altar blessings")+'</p><div class="rr-chips">'+alt.map(a=>chip(a.icon,a.name,a.n)).join("")+'</div>':"");
 const boss=R.bosses.length?'<div class="rr-boss">'+R.bosses.map(b=>`<span>💀 ${bossName(b.t)}<small>${s.mode==="tower"&&b.f?b.f+"F · ":""}${fmtTime(b.time)}</small></span>`).join("")+'</div>':'<p class="rr-none">'+tx("처치한 보스 없음","No bosses defeated")+'</p>';
 return '<div class="rr"><div class="rr-box"><h3>'+tx("무기별 피해","Damage by source")+'</h3>'+dmg+'</div><div class="rr-box"><h3>'+tx("전투 기록","Combat")+'</h3><div class="rr-kv">'+kv.map(([a,b,c])=>`<i>${a}</i><b class="${c}">${b}</b>`).join("")+'</div></div>'
  +'<div class="rr-box wide"><h3>'+tx("이번 판의 빌드","This run\'s build")+' · LV '+s.level+'</h3>'+build+'</div><div class="rr-box wide"><h3>'+tx("처치한 보스","Bosses defeated")+'</h3>'+boss+'</div></div>'}
function into(anchor,id){if(!anchor)return;let el=document.getElementById(id);if(!el){el=document.createElement("div");el.id=id;anchor.insertAdjacentElement("afterend",el)}el.innerHTML=html()}
return{over(){into(ui.finalStats,"runReport")},ending(){into($("endingStats"),"runReportEnd")},html}})();
function end(){state.dead=true;state.paused=true;ui.finalStats.textContent=tx(`생존 시간 ${fmtTime(state.time)} · 처치 ${state.kills} · 레벨 ${state.level}`,`Time ${fmtTime(state.time)} · Kills ${state.kills} · Level ${state.level}`);if(state.mode==="tower")ui.finalStats.textContent+=` · ${tx("도달","Reached")} ${state.floor}F`;if(state.diff==="hard")ui.finalStats.textContent+=" · HARD";runReport.over();ui.over.classList.remove("hidden")}
function loop(now){let dt=Math.min((now-lastTime)/1000,.033);lastTime=now;update(dt);rec.tick(dt);render();raf=requestAnimationFrame(loop)}
/* ================= TITLE SCREEN ================= */
const TW=384,TH=240,tg=$("titleCanvas").getContext("2d");tg.imageSmoothingEnabled=false;
const tpath=t=>({x:316-Math.pow(t,.9)*290+Math.sin(t*5.5)*14*(1-t*.4),y:158+t*82});
const HERO_T=.707,HX=Math.round(tpath(HERO_T).x),HY=216;
const mkGlow=(s,rgb,a)=>{const k=document.createElement("canvas");k.width=k.height=s;const g=k.getContext("2d"),r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);r.addColorStop(0,`rgba(${rgb},${a})`);r.addColorStop(.35,`rgba(${rgb},${a*.35})`);r.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=r;g.fillRect(0,0,s,s);return k};
const GL={silver:mkGlow(44,"220,220,255",.45),ice:mkGlow(44,"120,210,255",.6),fly:mkGlow(24,"255,150,70",.9),big:mkGlow(72,"255,140,60",.7),warm:mkGlow(90,"255,196,96",.7),cyan:mkGlow(44,"255,140,50",.65),purple:mkGlow(44,"255,80,70",.65)};
// [x, y, 크기, 색(0 청록 / 1 보라)]
const SHROOMS=[[60,198,1,0],[170,184,1,1],[232,192,1,0],[268,216,1,0],[352,228,2,0],[46,232,2,1]];
const buildForestScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),R=rng(1031);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
const pine=(x,base,h,c1,c2,k=.34)=>{for(let r=0;r<h;r++){const w=Math.floor(r*k)+(r%6<2?1:0);rect(x-w,base-h+r,w*2+1,1,c1);if(w>1)rect(x+w-1,base-h+r,2,1,c2)}rect(x-1,base,3,4,c1)};
const oak=(x,base,r,c1,c2)=>{const cy=base-Math.round(r*1.5),bl=[[0,-Math.round(r*.5),r],[-Math.round(r*.6),Math.round(r*.1),Math.round(r*.7)],[Math.round(r*.6),Math.round(r*.1),Math.round(r*.7)]];rect(x-2,cy,4,base-cy+3,c1);for(const [dx,dy,rr] of bl)dsc(x+dx+2,cy+dy-2,rr,c2);for(const [dx,dy,rr] of bl)dsc(x+dx,cy+dy,rr,c1)};
const shroom=(x,y,s,k)=>{const c1=k?"#e0402a":"#ff8a2a",c2=k?"#ffa088":"#ffe08a",dk=k?"#7a1a1a":"#a8501a";rect(x-4*s,y-s,8*s,s,"#2a1a22");for(const [dx,w,h] of [[-3,2,3],[-1,2,6],[1,2,4]]){const X=x+dx*s,Y=y-s-h*s;rect(X,Y+s,w*s,(h-1)*s,c1);rect(X,Y,s,h*s,c2);rect(X+s,Y+s,s,(h-1)*s,dk)}};
const blobs=(list)=>{for(const [x,y,r] of list)dsc(x+2,y+2,r,"#14382a");for(const [x,y,r] of list)dsc(x,y,r,"#07120e")};
// ---- 하늘 ----
band(0,156,["#060b1c","#0a1430","#0e1f3a","#132b46","#183850","#1e4753","#27565a"]);
// 달
c.globalAlpha=.06;for(const r of [46,38,31,25])dsc(312,46,r,"#cfe8ff");c.globalAlpha=1;
dsc(312,46,16,"#e8e2b4");dsc(314,44,14,"#f6f1cc");dsc(316,42,9,"#fffbe2");
for(const [x,y,r] of [[304,52,3],[318,54,2],[308,38,2]])dsc(x,y,r,"#d7d09c");
// 구름
c.globalAlpha=.85;for(const [x,y,w] of [[236,26,70],[290,64,70],[30,44,80],[150,72,60]]){rect(x,y,w,2,"#12264a");rect(x+8,y-2,w-22,2,"#12264a");rect(x+w*.3,y+2,w*.5,2,"#0f2040");rect(x+8,y-2,w-22,1,"#26446e")}c.globalAlpha=1;
// 먼 언덕과 숲
const hillTop=x=>Math.round((130+Math.sin(x/41)*7+Math.sin(x/17+2)*3)/2)*2;
for(let x=0;x<TW;x+=2){const t=hillTop(x);rect(x,t,2,TH-t,"#112d3a");rect(x,t,2,2,"#1d4452")}
for(let x=-4;x<TW;x+=ri(7,11))pine(x,hillTop(x)+8,ri(14,26),"#0f2b34","#18434d");
// ---- 땅 ----
const gT=x=>Math.round((150+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(148,TH,["#183a2f","#15342a","#122d25","#0f261f","#0c1f19"],gT);
for(let i=0;i<460;i++)rect(ri(0,TW),ri(156,TH),ri(1,3),1,R()<.55?"#1f4d3b":"#0a1c16");
// ---- 둥지: 속이 빈 고목 집 + 꼭대기의 나뭇가지 둥지 ----
dsc(322,176,30,"#13342c");dsc(318,174,24,"#173c32");
oak(286,160,9,"#0d2723","#17433b");oak(352,162,10,"#0d2723","#17433b");
{const CX=318,TOP=102,BASE=158,hwAt=y=>Math.round(12+(y-TOP)/(BASE-TOP)*5+Math.max(0,y-150)*.9);
 // 줄기 (왼쪽 밝게 · 오른쪽 어둡게 · 세로 나뭇결)
 for(let y=TOP;y<=BASE;y++){const hw=hwAt(y);rect(CX-hw,y,hw*2+1,1,"#4a3428");rect(CX-hw,y,1,1,"#241812");rect(CX-hw+1,y,3,1,"#6a4a36");rect(CX+hw-4,y,4,1,"#33241c");rect(CX+hw,y,1,1,"#1a100c")}
 for(const [dx,y0,len] of [[-8,106,18],[-3,112,22],[4,104,16],[9,118,20],[-10,128,14],[6,134,12],[0,122,10]])for(let k=0;k<len;k++)rect(CX+dx+Math.round(Math.sin((y0+k)/6)*.8),y0+k,1,1,"#3a281e");
 // 뿌리
 for(const [dx,d,len] of [[-14,-1,10],[-8,-1,6],[10,1,8],[15,1,11]])for(let k=0;k<len;k++)rect(CX+dx+d*k,BASE-2+Math.round(k*.35),3,2,k%3?"#4a3428":"#33241c");
 // 이끼
 for(const [x,y,w] of [[CX-12,140,5],[CX-13,126,3],[CX+8,150,6],[CX-6,103,4],[CX+5,110,3]]){rect(x,y,w,2,"#2e6a44");rect(x,y,w-1,1,"#3e8a58")}
 // 둥근 창
 dsc(CX+6,120,4,"#1a100c");dsc(CX+6,120,3,"#ffb04a");rect(CX+5,119,2,2,"#ffe9a0");rect(CX+3,120,7,1,"#5a3a26");rect(CX+6,117,1,7,"#5a3a26");
 // 아치형 문
 const dw=y=>{const q=Math.max(0,(142-y)/6);return Math.round(7*Math.sqrt(Math.max(0,1-q*q)))};
 for(let y=136;y<=BASE;y++){const hw=dw(y);rect(CX-2-hw,y,hw*2+1,1,"#2a1a10")}
 for(let y=138;y<=BASE;y++){const hw=dw(y)-1;if(hw<1)continue;rect(CX-2-hw,y,hw*2+1,1,y<146?"#ffd070":"#ffb04a");if(hw>2&&y>141)rect(CX-2-hw+2,y,hw*2-3,1,"#ffe9a0")}
 rect(CX-10,135,1,23,"#6a4a36");rect(CX+6,135,1,23,"#33241c");
 // 꼭대기의 나뭇가지 둥지 + 불씨 + 알
 for(let i=0;i<34;i++){const y=TOP-8+ri(0,9),x0=CX-22+ri(0,8),len=ri(14,34),dy=pr(-.25,.25);for(let k=0;k<len;k+=1)rect(x0+k,y+Math.round(k*dy),1,1,["#7a5a3a","#5a3e28","#9a7a50","#4a321e"][i%4])}
 for(let x=CX-22;x<=CX+22;x++){const q=(x-CX)/22;rect(x,TOP+1+Math.round(q*q*-2),1,2,"#3a281a")}
 {const EX=CX+3,EY=TOP-13,EW=[2,4,6,6,8,8,8,6];EW.forEach((w,i)=>{rect(EX-w/2-1,EY+i,w+2,1,"#8a6a48")});EW.forEach((w,i)=>{rect(EX-w/2,EY+i,w,1,i<3?"#fff8ea":"#f2e2c4");rect(EX-w/2,EY+i,1,1,"#fffdf4")});rect(EX-2,EY+3,2,1,"#ff8a2a");rect(EX+1,EY+5,2,1,"#ff8a2a");rect(EX-1,EY+6,1,1,"#e0523a")}
 rect(CX-8,TOP-9,4,2,"#ff8a2a");rect(CX-7,TOP-10,2,1,"#ffd070");rect(CX-13,TOP-8,3,1,"#ff6a2a");rect(CX+10,TOP-9,3,2,"#ff8a2a");rect(CX+11,TOP-10,1,1,"#fff2c0")}
for(let x=305;x<332;x+=3)rect(x,159+(x%2),3,2,"#5a3a26");rect(304,161,28,2,"#3a2618");
dsc(296,158,6,"#14382d");dsc(342,158,8,"#14382d");
// ---- 중간 숲 ----
const mids=[];for(let x=-8;x<TW+10;x+=ri(15,25)){if(x>236&&x<356)continue;mids.push([x,ri(160,176),ri(48,86),R()<.68])}
mids.sort((a,b)=>a[1]-b[1]);
for(const [x,b,h,isPine] of mids)isPine?pine(x,b,h,"#091d1d","#133737",.3):oak(x,b,Math.round(h/3),"#091d1d","#133737");
// ---- 집으로 가는 길 ----
for(let y=158;y<TH;y++){const t=(y-158)/82,p=tpath(t),w=2+t*30;rect(p.x-w-3,y,w*2+6,1,"#17261d");rect(p.x-w,y,w*2,1,"#3b3023");rect(p.x-w*.7,y,w*1.4,1,"#4b3d2b");rect(p.x-w*.3,y,w*.6,1,"#554431")}
for(let i=0;i<150;i++){const t=pr(0,1),p=tpath(t),w=2+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,3),1,["#6a5740","#2c2318","#7a6850"][ri(0,2)])}
// 풀 / 꽃
for(let i=0;i<150;i++){const x=ri(4,TW-4),y=ri(162,TH-6),t=(y-158)/82,p=tpath(t);if(Math.abs(x-p.x)<2+t*30+5)continue;
 rect(x,y,1,3,"#2e6a44");rect(x+1,y+1,1,2,"#3e8a58");rect(x-1,y+1,1,2,"#245a3a");
 if(R()<.22){rect(x,y-2,2,2,["#e6c78c","#e98aa0","#b99cf0","#f2f0d8"][ri(0,3)])}}
for(const [x,y,s,k] of SHROOMS)if(s===1)shroom(x,y,s,k);
// ================= 전경 =================
c=fgc.getContext("2d");
// 왼쪽 큰 나무
const lx=y=>22+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-196)*.8);
for(let y=0;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#07120e");rect(xr,y,2,1,"#1a382a")}
for(let i=0;i<14;i++){const y0=ri(0,200),xr=lx(y0);rect(ri(2,Math.max(3,xr-4)),y0,1,ri(14,50),"#0f2219")}
dsc(10,120,4,"#040a08");dsc(9,120,2,"#0b1913");
blobs([[10,8,34],[48,2,28],[84,-4,30],[120,-8,26],[26,36,22],[64,30,20],[104,22,16]]);
for(let i=0;i<16;i++){const x=ri(4,130),y0=ri(10,36),len=ri(12,48);for(let k=0;k<len;k++){rect(x+Math.round(Math.sin(k/5+i)*1.2),y0+k,1,1,"#173d2b");if(k%7===6)rect(x+(k%2?1:-2),y0+k,2,1,"#2a6a44")}}
// 오른쪽 큰 나무 + 달을 가로지르는 가지
for(let u=0;u<1;u++){for(let x=364;x>236;x--){const q=(364-x)/128,y=26+q*12+Math.sin(q*9)*2,th=Math.max(1,Math.round(6*(1-q)+1));rect(x,y-th/2,1,th,"#07120e")}}
for(let i=0;i<8;i++){const x0=ri(250,350),q=(364-x0)/128,y0=26+q*12+Math.sin(q*9)*2,dir=i%2?1:-1,len=ri(8,16);for(let k=0;k<len;k++)rect(x0-k*.8,y0+dir*k*.7,1,1,"#07120e");dsc(x0-len*.8,y0+dir*len*.7,2,"#0a1b14")}
const rx=y=>364-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-190)*.9);
for(let y=0;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#07120e");rect(xl-1,y,1,1,"#16322a")}
for(let i=0;i<10;i++){const y0=ri(0,200),xl=rx(y0);rect(ri(xl+2,TW-2),y0,1,ri(14,50),"#0f2219")}
blobs([[374,6,26],[342,-6,22],[388,40,18],[358,28,14]]);
for(let i=0;i<10;i++){const x=ri(330,380),y0=ri(10,34),len=ri(12,40);for(let k=0;k<len;k++){rect(x+Math.round(Math.sin(k/5+i)*1.2),y0+k,1,1,"#173d2b");if(k%7===6)rect(x+(k%2?1:-2),y0+k,2,1,"#2a6a44")}}
// 앞쪽 풀 / 고사리
rect(0,TH-3,TW,3,"#06100c");
for(let i=0;i<190;i++){const x=pr(0,TW),h=ri(6,20),d=R()<.5?-1:1;for(let k=0;k<h;k++)rect(x+d*Math.round(k*k*.012),TH-k,1,1,k>h-3?"#1d4a34":"#071812")}
const frond=(x,y,len,ang)=>{for(let k=0;k<len;k++){const px=x+Math.cos(ang)*k,py=y-Math.sin(ang)*k+k*k*.012;rect(px,py,1,1,"#0a2018");if(k>3&&k%2===0){rect(px-2,py+1,2,1,"#0e2c20");rect(px+1,py+1,2,1,"#0e2c20")}}};
for(const a of [.5,.9,1.3,1.8])frond(40,TH-4,34,a);
for(const a of [1.2,1.7,2.2,2.6])frond(340,TH-4,32,a);
for(const [x,y,s,k] of SHROOMS)if(s===2)shroom(x,y,s,k);
return{bg:bgc,fg:fgc}};
const buildBurntScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),R=rng(2077);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
// 불탄 나무: 줄기 + 앙상한 가지
const dead=(x,base,h,c1,c2)=>{rect(x-1,base-h,2,h+3,c1);rect(x,base-h,1,h+2,c2);
 for(let k=0;k<4;k++){const y0=base-h+Math.round(h*(.15+k*.2)),d=k%2?1:-1,len=ri(4,9)+Math.round(h*.08);for(let j=1;j<=len;j++)rect(x+d*j,y0-Math.round(j*.7),1,1,c1)}
 rect(x-2,base,5,2,c1)};
const ember=(x,y,s,k)=>{const o=k?"#e0402a":"#ff8a2a",h=k?"#ffa088":"#ffe08a";
 rect(x-4*s,y-s,8*s,s,"#0a0505");rect(x-3*s,y-3*s,6*s,2*s,"#1a0e0e");rect(x-2*s,y-4*s,4*s,s,"#241414");
 rect(x-s,y-3*s,2*s,s,o);rect(x-s,y-3*s,s,s,h);rect(x+s,y-2*s,s,s,o)};
const crk=(x,y)=>{let a=pr(0,6.28);for(let k=0,n=ri(10,26);k<n;k++){rect(x-1,y-1,4,3,"#2a0c08");a+=pr(-.6,.6);x+=Math.cos(a)*2;y+=Math.sin(a)*.8}
 };
// ---- 하늘: 붉게 달아오른 노을 ----
band(0,156,["#12060a","#1e080c","#34100f","#521a12","#74271a","#9a3a1c","#c25a24"]);
// 붉은 달
c.globalAlpha=.07;for(const r of [46,38,31,25])dsc(312,46,r,"#ff7a4a");c.globalAlpha=1;
dsc(312,46,16,"#9a2a1e");dsc(314,44,14,"#c4442a");dsc(316,42,9,"#e8704a");
for(const [x,y,r] of [[304,52,3],[318,54,2],[308,38,2]])dsc(x,y,r,"#7a1e18");
// 연기 구름
c.globalAlpha=.85;for(const [x,y,w] of [[236,26,70],[290,64,70],[30,44,80],[150,72,60]]){rect(x,y,w,2,"#2a0f10");rect(x+8,y-2,w-22,2,"#2a0f10");rect(x+w*.3,y+2,w*.5,2,"#220b0d");rect(x+8,y-2,w-22,1,"#7a3018")}c.globalAlpha=1;
// 먼 화산
const vx=150;
for(let r=0;r<60;r++){const w=Math.round(r*1.15),y=92+r;rect(vx-w,y,w*2,1,"#1a0a0c");rect(vx+w-2,y,2,1,"#35140f")}
rect(vx-6,92,12,2,"#ff7a2a");rect(vx-4,91,8,2,"#ffb04a");
for(const [off,ph] of [[-3,0],[2,1.7],[5,3.1]])for(let r=2;r<44;r++)rect(vx+off+Math.round(Math.sin(r/6+ph)*2)+Math.round(r*(off>0?.6:-.5)),92+r,2,1,r<20?"#ff7a2a":"#c4421a");
c.globalAlpha=.8;for(const [x,y,r] of [[vx+4,84,5],[vx+10,76,7],[vx+18,66,9],[vx+30,56,11]])dsc(x,y,r,"#2a1214");c.globalAlpha=1;
// 먼 언덕과 불탄 나무
const hillTop=x=>Math.round((130+Math.sin(x/41)*7+Math.sin(x/17+2)*3)/2)*2;
for(let x=0;x<TW;x+=2){const t=hillTop(x);rect(x,t,2,TH-t,"#1c0c0e");rect(x,t,2,2,"#3a1612")}
for(let x=-4;x<TW;x+=ri(14,22))dead(x,hillTop(x)+8,ri(14,26),"#120708","#2a100c");
// ---- 땅 ----
const gT=x=>Math.round((150+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(148,TH,["#2e1a15","#271512","#1f100e","#170b0b","#100707"],gT);
for(let i=0;i<460;i++)rect(ri(0,TW),ri(156,TH),ri(1,3),1,R()<.55?"#3c2420":"#0a0505");
for(let i=0;i<14;i++)crk(ri(8,TW-8),ri(166,TH-6));
// ---- 집(둥지) ----
dsc(322,176,30,"#0f0707");dsc(318,174,24,"#190d0c");
dead(292,160,36,"#0c0607","#2a110d");dead(348,162,42,"#0c0607","#2a110d");
for(let r=0;r<58;r++){const w=Math.round(7+r*.5),y=100+r,L=318-w;rect(L,y,w*2,1,r%6<3?"#3a2a3e":"#33253a");rect(L,y,2,1,"#241a2a");rect(318+w-3,y,3,1,"#54405a")}
for(let i=0;i<60;i++){const r=ri(2,56),w=Math.round(7+r*.5);rect(318+ri(-w+2,w-3),100+r,ri(1,3),1,R()<.5?"#241a2a":"#4a3850")}
rect(311,99,14,3,"#ff8a2a");rect(313,98,10,2,"#ffd070");rect(315,97,6,1,"#fff2c0");
for(const [x,y,h] of [[316,102,12],[322,104,9],[313,110,14],[320,114,8],[318,122,10]]){rect(x,y,2,h,"#e0523a");rect(x,y,1,h,"#ff8a2a")}
rect(311,138,14,20,"#120a10");rect(313,136,10,3,"#120a10");rect(314,141,8,17,"#ffb04a");rect(315,139,6,3,"#ffb04a");rect(316,145,4,13,"#ffe9a0");
for(let x=305;x<332;x+=3)rect(x,156+(x%2),3,2,"#5a3a26");rect(304,158,28,2,"#3a2618");
dsc(300,158,6,"#241414");dsc(299,156,3,"#3a2424");dsc(338,158,8,"#241414");dsc(336,155,4,"#3a2424");
// ---- 중간 불탄 숲 ----
const mids=[];for(let x=-8;x<TW+10;x+=ri(15,25)){if(x>236&&x<356)continue;mids.push([x,ri(160,176),ri(48,86)])}
mids.sort((a,b)=>a[1]-b[1]);
for(const [x,b,h] of mids)dead(x,b,Math.round(h*.7),"#0c0607","#2a110d");
// ---- 집으로 가는 그을린 길 ----
for(let y=158;y<TH;y++){const t=(y-158)/82,p=tpath(t),w=2+t*30;rect(p.x-w-3,y,w*2+6,1,"#120a09");rect(p.x-w,y,w*2,1,"#2a1f1a");rect(p.x-w*.7,y,w*1.4,1,"#34261f");rect(p.x-w*.3,y,w*.6,1,"#3f2f26")}
for(let i=0;i<150;i++){const t=pr(0,1),p=tpath(t),w=2+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,3),1,["#5a4a40","#1a110d","#6a5a4c"][ri(0,2)])}
// 재 풀 / 불씨
for(let i=0;i<150;i++){const x=ri(4,TW-4),y=ri(162,TH-6),t=(y-158)/82,p=tpath(t);if(Math.abs(x-p.x)<2+t*30+5)continue;
 rect(x,y,1,3,"#3a2a26");rect(x+1,y+1,1,2,"#54403a");rect(x-1,y+1,1,2,"#2a1c1a");
 if(R()<.22)rect(x,y-2,2,2,["#ff9a4a","#ff6a2a","#ffd070","#e0523a"][ri(0,3)])}
for(const [x,y,s,k] of SHROOMS)if(s===1)ember(x,y,s,k);
// ================= 전경 =================
c=fgc.getContext("2d");
const limb=(x,y,a,len,th,d)=>{for(let k=0;k<len;k++){const px=x+Math.cos(a)*k,py=y+Math.sin(a)*k,s=Math.max(1,Math.round(th*(1-k/len)));rect(px,py,s,s,"#050203");if(d>0&&k>len*.3&&k%7===0)limb(px,py,a+(R()<.5?-1:1)*pr(.5,.9),Math.round(len*.5),th*.6,d-1)}};
const lx=y=>22+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-196)*.8);
for(let y=0;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#050203");rect(xr,y,2,1,"#3a1810")}
for(let i=0;i<14;i++){const y0=ri(0,200),xr=lx(y0);rect(ri(2,Math.max(3,xr-4)),y0,1,ri(14,50),"#150a09")}
for(let i=0;i<9;i++){const y0=ri(10,200),xr=lx(y0),x0=ri(2,Math.max(3,xr-5)),h=ri(6,20);rect(x0,y0,1,h,"#c83a14");if(R()<.6)rect(x0,y0+ri(0,h-1),1,2,"#ff7a2a")}
limb(22,34,-.35,70,5,2);limb(22,62,.2,60,4,2);limb(24,14,-.7,50,4,2);
// 오른쪽 큰 나무 + 달을 가로지르는 가지
for(let x=364;x>236;x--){const q=(364-x)/128,y=26+q*12+Math.sin(q*9)*2,th=Math.max(1,Math.round(6*(1-q)+1));rect(x,y-th/2,1,th,"#050203")}
for(let i=0;i<8;i++){const x0=ri(250,350),q=(364-x0)/128,y0=26+q*12+Math.sin(q*9)*2,dir=i%2?1:-1,len=ri(8,16);for(let k=0;k<len;k++)rect(x0-k*.8,y0+dir*k*.7,1,1,"#050203")}
const rx=y=>364-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-190)*.9);
for(let y=0;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#050203");rect(xl-1,y,1,1,"#3a1810")}
for(let i=0;i<10;i++){const y0=ri(0,200),xl=rx(y0);rect(ri(xl+2,TW-2),y0,1,ri(14,50),"#150a09")}
for(let i=0;i<7;i++){const y0=ri(10,200),xl=rx(y0),x0=ri(xl+3,TW-2),h=ri(6,20);rect(x0,y0,1,h,"#c83a14");if(R()<.6)rect(x0,y0+ri(0,h-1),1,2,"#ff7a2a")}
limb(rx(64),64,Math.PI-.15,60,5,2);limb(rx(100),100,Math.PI+.1,48,4,2);
// 앞쪽 그을린 풀
rect(0,TH-3,TW,3,"#050202");
for(let i=0;i<190;i++){const x=pr(0,TW),h=ri(6,20),d=R()<.5?-1:1;for(let k=0;k<h;k++)rect(x+d*Math.round(k*k*.012),TH-k,1,1,k>h-3?"#3a1a12":"#0a0505")}
for(const [x,y,s,k] of SHROOMS)if(s===2)ember(x,y,s,k);
return{bg:bgc,fg:fgc}};
const buildFrozenScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),aur=mk(),R=rng(4049);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
// 눈 덮인 침엽수: 층마다 눈이 얹힘
const spine=(x,base,h,c1,c2,sn,k=.34)=>{for(let r=0;r<h;r++){const w=Math.floor(r*k)+(r%6<2?1:0);rect(x-w,base-h+r,w*2+1,1,c1);if(w>1)rect(x+w-1,base-h+r,2,1,c2);if(r%6===0&&w>1){rect(x-w,base-h+r,Math.max(1,Math.round(w*.8)),1,sn);if(r>8)rect(x-w+1,base-h+r+1,Math.max(1,Math.round(w*.4)),1,sn)}}rect(x-1,base,3,4,c1);rect(x,base-h-1,1,2,sn)};
// ---- 하늘: 깊은 밤 + 오로라 ----
band(0,150,["#02050c","#040a18","#071228","#0a1c38","#0e2846","#133650","#19465c"]);
// 달 (차가운 빛)
c.globalAlpha=.06;for(const r of [46,38,31,25])dsc(312,46,r,"#cfe8ff");c.globalAlpha=1;
dsc(312,46,16,"#b8d0e4");dsc(314,44,14,"#d8e8f4");dsc(316,42,9,"#f2f8ff");
for(const [x,y,r] of [[304,52,3],[318,54,2],[308,38,2]])dsc(x,y,r,"#a8c0d4");
// 오로라 (따로 그려 두고 타이틀에서 일렁이게)
{const a=aur.getContext("2d");for(const [y0,amp,len,col,ph] of [[34,10,TW,"80,255,190",0],[52,8,TW,"90,210,255",2.1],[24,6,TW*.7,"150,255,210",4.2]])
 for(let x=0;x<len;x+=2){const y=Math.round((y0+Math.sin(x/38+ph)*amp+Math.sin(x/13+ph*2)*3)/2)*2,h=18+Math.round(Math.sin(x/21+ph)*8);
  for(let k=0;k<h;k+=2){a.fillStyle=`rgba(${col},${(.22*(1-k/h)).toFixed(3)})`;a.fillRect(x,y+k,2,2)}a.fillStyle=`rgba(${col},.45)`;a.fillRect(x,y,2,2)}}
// 구름
c.globalAlpha=.7;for(const [x,y,w] of [[236,26,70],[30,44,80],[150,72,60]]){rect(x,y,w,2,"#0c1a30");rect(x+8,y-2,w-22,2,"#0c1a30");rect(x+8,y-2,w-22,1,"#2a4466")}c.globalAlpha=1;
// 먼 설산
const mtn=(cx,base,h,w)=>{for(let r=0;r<h;r++){const ww=Math.round(r*w/h),y=base-h+r;rect(cx-ww,y,ww*2+1,1,"#14283c");rect(cx-ww,y,2,1,"#1e3a52");if(r<h*.32){rect(cx-ww,y,ww*2+1,1,"#cfe4f2");rect(cx+ww-1,y,2,1,"#a8c8e0")}else if(r<h*.38&&r%2)rect(cx-ww+2,y,Math.round(ww*.6),1,"#a8c8e0")}};
for(const [x,h,w] of [[40,46,52],[110,38,40],[190,56,62],[262,34,38],[350,44,50]])mtn(x,132,h,w);
// 얼어붙은 바다 (수평선 + 떠 있는 얼음)
band(128,150,["#1a3448","#22425a","#2a5068"]);
for(let i=0;i<40;i++){const y=ri(130,148),x=ri(0,TW),w=ri(4,18);rect(x,y,w,1,R()<.6?"#5a8aa8":"#8fc0dc")}
for(const [x,y,w] of [[70,136,16],[150,140,22],[230,134,12],[372,138,14]]){rect(x,y,w,3,"#d8ecf8");rect(x+2,y-2,w-4,2,"#eef8ff");rect(x,y+3,w,1,"#4a7a98")}
// ---- 땅: 눈 덮인 평원 ----
const gT=x=>Math.round((150+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(148,TH,["#6a88a0","#5a7890","#4c6a82","#405c74","#344e64"],gT);
for(let i=0;i<460;i++)rect(ri(0,TW),ri(156,TH),ri(1,3),1,R()<.55?"#8eacc2":"#2c4256");
// ---- 둥지: 이글루 ----
dsc(322,176,30,"#5a7890");dsc(318,174,24,"#6a88a0");
spine(284,160,30,"#0e2230","#1a3a4c","#cfe6f5");spine(354,162,36,"#0e2230","#1a3a4c","#cfe6f5");
{const CX=318,BASE=158,RX=30,RY=28;
 // 돔: 왼쪽 위가 밝고 오른쪽 아래가 어두운 눈 벽돌
 for(let y=BASE-RY;y<=BASE;y++){const q=(BASE-y)/RY,hw=Math.round(RX*Math.sqrt(Math.max(0,1-q*q)));
  for(let x=CX-hw;x<=CX+hw;x++){const lx=(x-CX)/RX,lit=-lx*.6+q*.5;rect(x,y,1,1,lit>.35?"#eef8ff":lit>.05?"#d8ecf8":lit>-.3?"#bcd6e8":"#9ab8cc")}
  rect(CX-hw,y,1,1,"#6a8aa2");rect(CX+hw,y,1,1,"#5a7890")}
 // 벽돌 줄눈 (가로줄 + 엇갈린 세로줄)
 for(let row=0,y=BASE-4;y>BASE-RY+2;row++,y-=5){const q=(BASE-y)/RY,hw=Math.round(RX*Math.sqrt(Math.max(0,1-q*q)));rect(CX-hw+1,y,hw*2-1,1,"#8eacc2");
  for(let x=CX-hw+((row%2)?4:9);x<CX+hw-2;x+=10)rect(x,y-4,1,4,"#9ab8cc")}
 rect(CX-3,BASE-RY-1,6,2,"#cfe2f0");rect(CX-1,BASE-RY-3,2,2,"#5a7890"); // 꼭대기 환기 구멍
 // 앞쪽 입구 터널
 const TX=CX-2,TR=13,TB=BASE+2;
 for(let y=TB-TR;y<=TB;y++){const q=(TB-y)/TR,hw=Math.round(TR*Math.sqrt(Math.max(0,1-q*q)));for(let x=TX-hw;x<=TX+hw;x++)rect(x,y,1,1,(x-TX)<-hw*.3?"#eef8ff":"#cfe4f2");rect(TX-hw,y,1,1,"#6a8aa2");rect(TX+hw,y,1,1,"#5a7890")}
 for(let y=TB-6;y>TB-TR;y-=5){const q=(TB-y)/TR,hw=Math.round(TR*Math.sqrt(Math.max(0,1-q*q)));rect(TX-hw+1,y,hw*2-1,1,"#9ab8cc")}
 // 문 (따뜻한 불빛)
 const DR=8;for(let y=TB-DR;y<=TB;y++){const q=(TB-y)/DR,hw=Math.round(DR*Math.sqrt(Math.max(0,1-q*q)));rect(TX-hw,y,hw*2+1,1,"#3a2010");if(hw>1&&y>TB-DR)rect(TX-hw+1,y,hw*2-1,1,q>.55?"#ffb04a":"#ffd070");if(hw>3&&q<.55)rect(TX-hw+3,y,hw*2-5,1,"#ffe9a0")}
 rect(TX-14,TB+1,30,2,"#8eacc2");rect(TX-10,TB,22,1,"#e4f2fc")}
dsc(300,160,6,"#8eacc2");dsc(299,158,3,"#d8ecf8");dsc(340,160,8,"#8eacc2");dsc(338,157,4,"#d8ecf8");
// ---- 중간: 눈 덮인 침엽수 숲 ----
const mids=[];for(let x=-8;x<TW+10;x+=ri(15,25)){if(x>236&&x<356)continue;mids.push([x,ri(160,176),ri(48,86)])}
mids.sort((a,b)=>a[1]-b[1]);
for(const [x,b,h] of mids)spine(x,b,h,"#0a1a26","#14303e","#8aa8c0",.3);
// ---- 둥지로 가는 눈길 ----
for(let y=158;y<TH;y++){const t=(y-158)/82,p=tpath(t),w=2+t*30;rect(p.x-w-3,y,w*2+6,1,"#2a3e50");rect(p.x-w,y,w*2,1,"#7a96ac");rect(p.x-w*.7,y,w*1.4,1,"#8aa6bc");rect(p.x-w*.3,y,w*.6,1,"#9ab6ca")}
for(let i=0;i<150;i++){const t=pr(0,1),p=tpath(t),w=2+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,3),1,["#b8d0e2","#5a7488","#cfe2f0"][ri(0,2)])}
// 얼어붙은 풀 / 얼음 조각
for(let i=0;i<150;i++){const x=ri(4,TW-4),y=ri(162,TH-6),t=(y-158)/82,p=tpath(t);if(Math.abs(x-p.x)<2+t*30+5)continue;
 rect(x,y,1,3,"#3e5a70");rect(x+1,y+1,1,2,"#a8c8e0");rect(x-1,y+1,1,2,"#2c4458");
 if(R()<.18)rect(x,y-2,2,2,["#9fe4ff","#e8f8ff","#7fd0ff"][ri(0,2)])}
// 얼음 결정 (SHROOMS 자리에 빛나는 결정)
const crystal=(x,y,s)=>{rect(x-4*s,y-s,8*s,s,"#22384a");for(const [dx,h] of [[-3,4],[-1,7],[1,5],[3,3]]){const X=x+dx*s,Y=y-s-h*s;rect(X,Y,2*s,h*s,"#5ab8e8");rect(X,Y,s,h*s,"#c8f0ff");rect(X+s,Y+h*s-s,s,s,"#2a7ab0")}};
for(const [x,y,s] of SHROOMS)if(s===1)crystal(x,y,s);
// ================= 전경 =================
c=fgc.getContext("2d");
const lx=y=>22+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-196)*.8);
for(let y=0;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#050c12");rect(xr,y,2,1,"#6a8aa4")}
for(let i=0;i<14;i++){const y0=ri(0,200),xr=lx(y0);rect(ri(2,Math.max(3,xr-4)),y0,1,ri(14,50),"#0e1c28")}
// 눈 덮인 가지 덩어리
const sblobs=list=>{for(const [x,y,r] of list)dsc(x,y,r,"#06101a");for(const [x,y,r] of list)dsc(x-1,y-Math.round(r*.45),Math.round(r*.62),"#cfe2f0");for(const [x,y,r] of list)dsc(x-2,y-Math.round(r*.55),Math.round(r*.4),"#eef8ff")};
sblobs([[10,8,34],[48,2,28],[84,-4,30],[120,-8,26],[26,36,22],[64,30,20],[104,22,16]]);
for(let i=0;i<14;i++){const x=ri(4,130),y0=ri(30,50),len=ri(4,14);for(let k=0;k<len;k++)rect(x,y0+k,1,1,k===len-1?"#ffffff":"#bfe0f2")}
const rx=y=>364-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-190)*.9);
for(let x=364;x>236;x--){const q=(364-x)/128,y=26+q*12+Math.sin(q*9)*2,th=Math.max(1,Math.round(6*(1-q)+1));rect(x,y-th/2,1,th,"#050c12");rect(x,y-th/2-1,1,1,"#d8ecf8")}
for(let y=0;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#050c12");rect(xl-1,y,1,1,"#6a8aa4")}
for(let i=0;i<10;i++){const y0=ri(0,200),xl=rx(y0);rect(ri(xl+2,TW-2),y0,1,ri(14,50),"#0e1c28")}
sblobs([[374,6,26],[342,-6,22],[388,40,18],[358,28,14]]);
// 앞쪽 눈 더미
for(let x=0;x<TW;x+=2){const h=Math.round(6+Math.sin(x/23)*3+Math.sin(x/7)*1.5);rect(x,TH-h,2,h,"#8eacc2");rect(x,TH-h,2,2,"#e4f2fc");if(x%9===0)rect(x,TH-h+2,2,2,"#cfe2f0")}
for(const [x,y,s] of SHROOMS)if(s===2)crystal(x,y,s);
return{bg:bgc,fg:fgc,aur}};
const buildCanyonScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),R=rng(6151);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
const grass=(x,base,h,lean,c1,c2,c3)=>{for(let j=0;j<h;j++){const xx=x+Math.round(lean*j*j/h);rect(xx,base-j,1,1,j>h-3?c3:j>h-7?c2:c1)}};
// ---- 하늘: 보랏빛 밤 + 커다란 은빛 보름달 ----
band(0,150,["#06061a","#0a0a26","#12123a","#1a1a48","#24224e","#302a56","#3c3260"]);
c.globalAlpha=.07;for(const r of [58,48,40,33])dsc(304,52,r,"#e8e8ff");c.globalAlpha=1;
dsc(304,52,22,"#c8c8dc");dsc(306,50,20,"#e2e2f0");dsc(309,47,13,"#f6f6ff");
for(const [x,y,r] of [[296,58,4],[312,62,3],[300,42,2],[314,50,2]])dsc(x,y,r,"#b8b8cc");
c.globalAlpha=.6;for(const [x,y,w] of [[40,40,90],[150,70,70],[236,24,50]]){rect(x,y,w,2,"#1a1a3a");rect(x+8,y-2,w-22,2,"#1a1a3a");rect(x+8,y-2,w-22,1,"#4a4a7a")}c.globalAlpha=1;
// 먼 메사(탁상 절벽)
const mesa=(x0,x1,top,col,rim)=>{for(let x=x0;x<x1;x+=2){const t=top+(x<x0+8?(x0+8-x):x>x1-8?(x-(x1-8)):0)+((x>>3)%3===0?2:0);rect(x,t,2,150-t,col);rect(x,t,2,2,rim)}};
mesa(-10,70,96,"#1a1830","#4a4870");mesa(110,190,104,"#1a1830","#4a4870");mesa(220,300,92,"#1a1830","#4a4870");mesa(330,400,100,"#1a1830","#4a4870");
mesa(20,120,116,"#221f38","#5a5880");mesa(160,250,120,"#221f38","#5a5880");mesa(280,370,112,"#221f38","#5a5880");
// ---- 땅: 은빛 억새 평원 ----
const gT=x=>Math.round((148+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(146,TH,["#4a4a62","#403f56","#36354a","#2c2b3e","#232234"],gT);
for(let i=0;i<420;i++)rect(ri(0,TW),ri(154,TH),ri(1,3),1,R()<.55?"#5e5e78":"#1e1d2c");
// ---- 둥지: 바위 언덕 속 동굴 ----
{const CX=318,B=158;
 for(let y=104;y<=B;y++){const q=(B-y)/54,hw=Math.round(44*Math.sqrt(Math.max(0,1-q*q))*(1-q*.25));rect(CX-hw,y,hw*2,1,"#2c2a3a");rect(CX-hw,y,Math.max(1,Math.round(hw*.7)),1,"#3e3c50");rect(CX-hw,y,3,1,"#5a5878")}
 for(const [x,y,r] of [[296,118,8],[338,122,9],[316,108,7],[350,140,6],[286,140,7]]){dsc(x,y,r,"#44425a");dsc(x-2,y-2,r-3,"#5e5c78");rect(x-r+2,y-r+1,r,1,"#8a88a8")}
 for(let y=128;y<=B;y++){const q=(B-y)/30,hw=Math.round(12*Math.sqrt(Math.max(0,1-q*q)));rect(CX-hw,y,hw*2,1,"#120e14")}
 for(let y=134;y<=B;y++){const q=(B-y)/24,hw=Math.round(9*Math.sqrt(Math.max(0,1-q*q)));if(hw>1)rect(CX-hw,y,hw*2,1,y<142?"#ffd070":"#ffb04a");if(hw>4&&y>140)rect(CX-hw+3,y,hw*2-6,1,"#ffe9a0")}
 rect(CX-16,B,32,2,"#5a4a3a");rect(CX-12,B+2,24,1,"#3a2e24");
 for(let i=0;i<14;i++){const x=CX-40+ri(0,80),h=ri(6,12);grass(x,B+ri(0,4),h,pr(-1.5,1.5),"#6a6e84","#a8acc0","#e8ecf6")}}
// ---- 중간: 은빛 억새 군락 ----
for(let i=0;i<260;i++){const x=ri(-4,TW+4);if(x>270&&x<366&&R()<.8)continue;const b=ri(150,182),h=ri(14,34);grass(x,b,h,pr(-3,3),"#5a5e74","#9a9eb4","#dfe3ef")}
// ---- 둥지로 가는 흙길 ----
for(let y=158;y<TH;y++){const t=(y-158)/82,p=tpath(t),w=2+t*30;rect(p.x-w-3,y,w*2+6,1,"#1c1a24");rect(p.x-w,y,w*2,1,"#4a4352");rect(p.x-w*.7,y,w*1.4,1,"#56505e");rect(p.x-w*.3,y,w*.6,1,"#625a6a")}
for(let i=0;i<150;i++){const t=pr(0,1),p=tpath(t),w=2+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,3),1,["#7e7890","#2e2a34","#8e889e"][ri(0,2)])}
// 들풀 / 은빛 꽃
for(let i=0;i<170;i++){const x=ri(4,TW-4),y=ri(162,TH-6),t=(y-158)/82,p=tpath(t);if(Math.abs(x-p.x)<2+t*30+5)continue;
 grass(x,y,ri(4,9),pr(-2,2),"#4e5268","#8a8ea4","#d8dcea");if(R()<.12)rect(x,y-ri(8,10),2,2,["#e8e8ff","#c8b0ff","#ffffff"][ri(0,2)])}
const flower=(x,y,s)=>{rect(x-1,y-6*s,2,6*s,"#3a3a4a");for(const [dx,dy] of [[-2,-8],[2,-8],[0,-10],[0,-6]])rect(x+dx*s-s,y+dy*s-s,2*s,2*s,"#e8e8ff");rect(x-s,y-8*s-s,2*s,2*s,"#ffd070")};
for(const [x,y,s] of SHROOMS)if(s===1)flower(x,y,s);
// ================= 전경 =================
c=fgc.getContext("2d");
const lx=y=>22+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-196)*.8);
for(let y=0;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#0e0c14");rect(xr,y,2,1,"#4a4866")}
for(let i=0;i<16;i++){const y0=ri(0,220),xr=lx(y0);rect(ri(2,Math.max(3,xr-4)),y0,ri(2,6),1,"#24222e")}
const rx=y=>364-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-190)*.9);
for(let y=0;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#0e0c14");rect(xl-1,y,1,1,"#4a4866")}
for(let i=0;i<12;i++){const y0=ri(0,220),xl=rx(y0);rect(ri(xl+2,TW-2),y0,ri(2,6),1,"#24222e")}
// 위쪽에 걸친 바위 턱
for(let x=0;x<TW;x+=2){const h=x<150?Math.round(10+Math.sin(x/17)*4+Math.max(0,120-x)*.12):x>300?Math.round(8+Math.sin(x/13)*3+(x-300)*.15):0;if(h>0){rect(x,0,2,h,"#0e0c14");rect(x,h,2,1,"#4a4866")}}
// 앞쪽 억새
for(let i=0;i<150;i++){const x=pr(-4,TW+4),h=ri(10,34);grass(Math.round(x),TH,h,pr(-4,4),"#0e0e18","#2a2c3c","#8a8ea4")}
for(const [x,y,s] of SHROOMS)if(s===2)flower(x,y,s);
return{bg:bgc,fg:fgc}};
const buildBlossomScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),R=rng(7331);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
const sakura=(x,base,r,trunk,cols)=>{rect(x-2,base-r*1.6,4,r*1.6+3,trunk);rect(x-1,base-r*1.6,1,r*1.6,"#5a3a44");for(const [dx,dy,rr] of [[0,-r*1.9,r],[-r*.75,-r*1.5,r*.75],[r*.75,-r*1.5,r*.75],[-r*.4,-r*2.35,r*.6],[r*.45,-r*2.3,r*.6]]){dsc(x+dx,base+dy,rr,cols[0]);dsc(x+dx-rr*.2,base+dy-rr*.25,rr*.7,cols[1]);dsc(x+dx-rr*.35,base+dy-rr*.4,rr*.35,cols[2])}};
// ---- 하늘: 동틀 녘 (청록 → 분홍) ----
band(0,150,["#14233a","#1e3048","#2e3c58","#4a4a68","#7a5a78","#b06a84","#e08a90"]);
// 떠오르는 해 (안개 속)
c.globalAlpha=.1;for(const r of [56,46,38])dsc(300,128,r,"#ffd0a0");c.globalAlpha=1;dsc(300,130,20,"#ffc890");dsc(300,130,16,"#ffe0b0");
// 비구름 띠
c.globalAlpha=.75;for(const [x,y,w] of [[20,30,110],[180,52,90],[290,22,80]]){rect(x,y,w,3,"#2a3048");rect(x+10,y-3,w-26,3,"#2a3048");rect(x+10,y-3,w-26,1,"#6a6a90")}c.globalAlpha=1;
// 먼 산 (수묵화 느낌 겹산)
const ridge=(base,amp,f,ph,col,rim)=>{for(let x=0;x<TW;x+=2){const t=Math.round((base+Math.sin(x/f+ph)*amp+Math.sin(x/(f*.37)+ph*2)*amp*.35)/2)*2;rect(x,t,2,150-t,col);rect(x,t,2,1,rim)}};
ridge(96,14,40,0,"#3a3a5a","#6a6a8a");ridge(110,10,28,2,"#2e3a4e","#5a6a82");ridge(124,7,22,4,"#24343e","#4a6060");
// 강
band(130,150,["#3a5a72","#4a7088","#5a8098"]);for(let i=0;i<40;i++)rect(ri(0,TW),ri(132,148),ri(4,16),1,R()<.6?"#9ac0d8":"#ffd0d8");
// ---- 땅 ----
const gT=x=>Math.round((148+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(146,TH,["#2e5a46","#28503e","#224636","#1c3c2e","#163226"],gT);
for(let i=0;i<460;i++)rect(ri(0,TW),ri(154,TH),ri(1,3),1,R()<.55?"#3a7050":"#10241a");
for(let i=0;i<260;i++)rect(ri(0,TW),ri(152,TH),2,1,["#ffb8d0","#f490b4","#ffe0ea"][ri(0,2)]);
// ---- 둥지: 연못가 정자 ----
{const CX=318;dsc(CX+4,176,30,"#1c3c2e");dsc(CX,174,24,"#244a38");
 rect(CX-26,150,52,4,"#3a2a24");rect(CX-24,154,48,2,"#22160f");
 for(const x of [CX-20,CX+17])rect(x,116,4,36,"#8a3a2a");for(const x of [CX-20,CX+17])rect(x,116,1,36,"#b85a3a");
 for(let r=0;r<16;r++){const w=Math.round(18+r*1.9),y=100+r;rect(CX-w,y,w*2,1,r<3?"#2a5a5a":r%3===0?"#1e4646":"#2e6464");rect(CX-w,y,2,1,"#3a7a7a")}
 rect(CX-38,115,6,2,"#2e6464");rect(CX+32,115,6,2,"#2e6464");rect(CX-40,113,4,2,"#3a7a7a");rect(CX+36,113,4,2,"#3a7a7a");
 rect(CX-3,94,6,6,"#d8a040");rect(CX-1,90,2,4,"#d8a040");
 rect(CX-15,124,30,26,"#120a10");rect(CX-13,126,26,22,"#ffb04a");rect(CX-9,130,18,18,"#ffd070");rect(CX-5,134,10,14,"#ffe9a0");rect(CX-1,126,2,22,"#8a3a2a");rect(CX-13,137,26,2,"#8a3a2a");
 for(const [x,y] of [[CX-34,150],[CX+38,152]]){rect(x-2,y-14,4,14,"#7a847e");rect(x-4,y-17,8,3,"#9aa49e");rect(x-1,y-11,2,3,"#ffd070")}}
sakura(286,160,10,"#3a2228",["#c8507a","#f08aac","#ffc0d4"]);sakura(354,162,11,"#3a2228",["#c8507a","#f08aac","#ffc0d4"]);
// ---- 중간: 벚꽃 숲 ----
const mids=[];for(let x=-8;x<TW+10;x+=ri(16,26)){if(x>246&&x<372)continue;mids.push([x,ri(160,176),ri(14,22)])}
mids.sort((a,b)=>a[1]-b[1]);for(const [x,b,r] of mids)sakura(x,b,r,"#2a1820",["#a8406a","#d8709a","#f4a8c4"]);
// ---- 돌길 ----
for(let y=158;y<TH;y++){const t=(y-158)/82,p=tpath(t),w=2+t*30;rect(p.x-w-3,y,w*2+6,1,"#14241e");rect(p.x-w,y,w*2,1,"#4a5650");rect(p.x-w*.7,y,w*1.4,1,"#58645e");rect(p.x-w*.3,y,w*.6,1,"#66726c")}
for(let i=0;i<150;i++){const t=pr(0,1),p=tpath(t),w=2+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,3),1,["#ffb8d0","#2e3a34","#8a968e"][ri(0,2)])}
for(let i=0;i<150;i++){const x=ri(4,TW-4),y=ri(162,TH-6),t=(y-158)/82,p=tpath(t);if(Math.abs(x-p.x)<2+t*30+5)continue;
 rect(x,y,1,3,"#2e6a44");rect(x+1,y+1,1,2,"#4a9a6a");rect(x-1,y+1,1,2,"#245a3a");if(R()<.22)rect(x,y-2,2,2,["#ffb8d0","#ffffff","#f490b4"][ri(0,2)])}
const lantern=(x,y,s)=>{rect(x-3*s,y-s,6*s,s,"#2a2622");rect(x-2*s,y-7*s,4*s,6*s,"#7a847e");rect(x-3*s,y-9*s,6*s,2*s,"#9aa49e");rect(x-s,y-6*s,2*s,2*s,"#ffd070")};
for(const [x,y,s] of SHROOMS)if(s===1)lantern(x,y,s);
// ================= 전경 =================
c=fgc.getContext("2d");
const lx=y=>22+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-196)*.8);
for(let y=0;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#1a0c14");rect(xr,y,2,1,"#5a2a40")}
const blobs=(list)=>{for(const [x,y,r] of list)dsc(x+2,y+2,r,"#5a1a3a");for(const [x,y,r] of list)dsc(x,y,r,"#c8507a");for(const [x,y,r] of list)dsc(x-r*.25,y-r*.3,r*.6,"#f08aac");for(const [x,y,r] of list)dsc(x-r*.4,y-r*.45,r*.28,"#ffd0e0")};
blobs([[10,8,34],[48,2,28],[84,-4,30],[120,-8,26],[26,36,22],[64,30,20],[104,22,16]]);
const rx=y=>364-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-190)*.9);
for(let y=0;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#1a0c14");rect(xl-1,y,1,1,"#5a2a40")}
blobs([[374,6,26],[342,-6,22],[388,40,18],[358,28,14]]);
rect(0,TH-3,TW,3,"#0e1c14");
for(let i=0;i<190;i++){const x=pr(0,TW),h=ri(6,20),d=R()<.5?-1:1;for(let k=0;k<h;k++)rect(x+d*Math.round(k*k*.012),TH-k,1,1,k>h-3?"#3a7a50":"#0e2418")}
for(const [x,y,s] of SHROOMS)if(s===2)lantern(x,y,s);
return{bg:bgc,fg:fgc}};
const buildPalaceScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),midc=mk(),fgc=mk(),R=rng(8881);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
// ---- 하늘: 깊은 밤 → 지평선의 금빛 ----
band(0,150,["#0c0a1c","#151030","#21163e","#2e1c46","#45244a","#6a3044","#9a4a3a","#c87a3a"]);
// 황금 보름달
c.globalAlpha=.06;for(const r of [56,46,38])dsc(312,46,r,"#ffe0a0");c.globalAlpha=.14;dsc(312,46,30,"#ffe0a0");c.globalAlpha=1;
dsc(312,46,22,"#d89a30");dsc(311,45,20,"#ffd870");dsc(306,40,12,"#ffe8a8");for(const [x,y,r] of [[318,52,4],[303,50,3],[317,37,2],[322,44,2]])dsc(x,y,r,"#e8b860");
// 먼 산 · 먼 궁궐 실루엣
const ridge=(base,amp,f,ph,col,rim)=>{for(let x=0;x<TW;x+=2){const t=Math.round((base+Math.sin(x/f+ph)*amp+Math.sin(x/(f*.37)+ph*2)*amp*.35)/2)*2;rect(x,t,2,150-t,col);rect(x,t,2,1,rim)}};
ridge(100,16,44,1,"#2a1a3a","#4e3260");
const roofSil=(x,y,w,col)=>{for(let r=0;r<5;r++)rect(x-w-r,y+r,(w+r)*2,1,col);rect(x-w-5,y+3,2,2,col);rect(x+w+3,y+3,2,2,col);rect(x-w+3,y+5,(w-3)*2,7,col);rect(x-2,y-3,4,3,col)};
ridge(114,10,30,3,"#22162e","#3e2a4a");roofSil(52,104,14,"#1c1228");roofSil(142,110,10,"#1c1228");roofSil(206,112,8,"#1c1228");
ridge(128,6,22,5,"#1c1424","#3a2838");
for(const [x,y] of [[40,121],[96,126],[180,127],[236,124]]){rect(x,y,2,2,"#ffb04a")}
// ---- 땅: 궁궐 앞마당 박석 ----
const gT=x=>Math.round((146+Math.sin(x/34)*2)/2)*2;
band(144,TH,["#3a3026","#32291f","#2a231b","#231d16","#1c1712"],gT);
{let yy=150,h=3;while(yy<TH){rect(0,yy,TW,1,"#15110c");const off=ri(0,10),st=Math.round(10+h*3.4);for(let x=off;x<TW;x+=st)rect(x,yy-h+1,1,h-1,"#17130e");yy+=Math.round(h);h=Math.min(16,h+1.3)}}
for(let i=0;i<240;i++)rect(ri(0,TW),ri(150,TH),R()<.3?2:1,1,["#e8a820","#ffd54a","#c88a18"][ri(0,2)]);
// 황금빛 균열
for(const [x0,y0,a0,n] of [[30,200,-.3,9],[120,226,.2,7],[210,206,-.5,6],[96,170,.4,6]]){let x=x0,y=y0,a=a0;const pts=[[x,y]];for(let i=0;i<n;i++){a+=pr(-.6,.6);x+=Math.cos(a)*5;y+=Math.sin(a)*2;pts.push([x,y])}
 for(const [w,col] of [[3,"#3a2a0e"],[2,"#c8902a"],[1,"#ffe070"]])for(const [px,py] of pts)rect(px-w/2,py-w/2+.5,w+1,w,col)}
// ---- 어도 ----
for(let y=156;y<TH;y++){const t=Math.max(0,(y-158)/82),p=tpath(t),w=3+t*30;rect(p.x-w-3,y,w*2+6,1,"#120e0a");rect(p.x-w-1,y,w*2+2,1,"#c8902a");rect(p.x-w,y,w*2,1,"#5e5446");rect(p.x-w*.6,y,w*1.2,1,"#6c6152")}
for(const tt of [.1,.3,.52,.78]){const p=tpath(tt),y=Math.round(158+tt*82),s=1+tt*2.2;rect(p.x-5*s,y-2*s,10*s,4*s,"#8a7a62");rect(p.x-4*s,y-1.4*s,8*s,1,"#c8902a");rect(p.x-4*s,y+1*s,8*s,1,"#c8902a");rect(p.x-1*s,y-.6*s,2*s,1.4*s,"#ffd54a")}
// ================= 중간층 (하늘의 황룡보다 앞) =================
c=midc.getContext("2d");
const cloudc=mk();
// 오색 상서로운 구름 (하늘의 황룡보다 앞)
const cloud=(x,y,w,cols)=>{const c0=c;c=cloudc.getContext("2d");for(let i=0;i<=w;i+=6){const r=5+Math.round(Math.sin(i*.7+x)*2+2);dsc(x+i,y-r*.5+1,r+1,cols[0])}rect(x-4,y-1,w+8,4,cols[0]);
 for(let i=0;i<=w;i+=6){const r=5+Math.round(Math.sin(i*.7+x)*2+2);dsc(x+i,y-r*.5,r,cols[1])}rect(x-3,y-1,w+6,2,cols[1]);
 for(const cx of [x+2,x+w-2]){dsc(cx,y-5,4,cols[2]);dsc(cx+1,y-4,2,cols[1]);rect(cx,y-4,1,1,cols[2])}
 for(let i=8;i<w-6;i+=10)rect(x+i,y-6-((i/10)%2)*3,5,1,cols[2]);c=c0};
cloud(14,100,58,["#4a2238","#a8587a","#f0b0c8"]);cloud(112,74,44,["#1a3e3c","#3a8a7a","#9ae0c8"]);cloud(178,102,50,["#5a3c12","#c8902a","#ffe070"]);cloud(214,44,30,["#2e2450","#6a5aa0","#c0b0f8"]);cloud(48,50,28,["#5a3c12","#c8902a","#ffe070"]);
// 궁궐 언덕
const CX=318;for(let y=150;y<174;y++){const w=Math.round(54+(y-150)*1.1);rect(CX-w-2,y,w*2+4,1,"#14100c");rect(CX-w,y,w*2,1,y%6<1?"#2a241e":y<160?"#4a4034":"#3a3228");if(y%6===3)for(let x=CX-w+((y/6|0)%2)*6;x<CX+w;x+=12)rect(x,y-2,1,5,"#241e18")}
// 기단 · 난간
rect(CX-52,138,104,2,"#ffd54a");rect(CX-52,140,104,12,"#4a4034");rect(CX-52,140,104,1,"#6a5e4e");for(let x=CX-50;x<CX+50;x+=6)rect(x,142,2,8,"#2e2620");rect(CX-52,151,104,1,"#1a1410");
// 계단 + 답도 (가운데 용 문양 돌판)
for(let i=0;i<8;i++){const w=14+i*3;rect(CX-w,152+i*2,w*2,2,i%2?"#5e5446":"#6c6152")}rect(CX-3,152,6,16,"#c8902a");rect(CX-1,153,2,14,"#ffe070");
// 아래층 전각
rect(CX-38,110,76,28,"#2a1410");
for(const x of [-35,-23,-11,9,21,33]){rect(CX+x,110,3,28,"#a83228");rect(CX+x,110,1,28,"#d85a3a")}
rect(CX-9,117,18,21,"#ffb04a");rect(CX-7,119,14,19,"#ffd070");for(let k=0;k<5;k++)rect(CX-9+k*4,117,1,21,"#8a3a20");rect(CX-9,124,18,1,"#8a3a20");rect(CX-9,131,18,1,"#8a3a20");
for(const x of [CX-31,CX+21]){rect(x,119,10,9,"#c87a2a");rect(x+1,120,8,7,"#ffb04a");rect(x+4,119,1,9,"#8a3a20");rect(x,123,10,1,"#8a3a20")}
// 공포 (단청 띠)
rect(CX-44,104,88,6,"#1e4a40");for(let x=CX-44;x<CX+44;x+=4)rect(x,105,2,2,["#e8443a","#ffd54a","#3a8a6a","#5aa8f0"][((x-CX+44)/4)%4]);rect(CX-44,109,88,1,"#c8902a");
// 아래층 지붕
const roof=(y0,rows,w0,step,edge)=>{for(let r=0;r<rows;r++){const w=Math.round(w0+r*step),y=y0+r;rect(CX-w,y,w*2,1,r<2?"#4a5266":r%3===0?"#22263a":"#333a50");for(let x=CX-w+1;x<CX+w;x+=3)rect(x,y,1,1,"#1a1e2c")}
 const we=Math.round(w0+(rows-1)*step),ye=y0+rows-1;rect(CX-we-1,ye+1,we*2+2,1,"#c8902a");
 for(let k=0;k<7;k++){rect(CX-we-2-k*1.6,ye-k*.9,2,1,"#333a50");rect(CX+we+k*1.6,ye-k*.9,2,1,"#333a50")}rect(CX-we-13,ye-7,2,2,"#ffd54a");rect(CX+we+11,ye-7,2,2,"#ffd54a");
 rect(CX-w0,y0-2,w0*2,2,"#ffd54a");rect(CX-w0-2,y0-7,3,6,"#c8902a");rect(CX+w0-1,y0-7,3,6,"#c8902a");rect(CX-w0-3,y0-8,2,2,"#ffe070");rect(CX+w0+1,y0-8,2,2,"#ffe070")};
roof(92,12,32,2.3,1);
// 처마 아래 청사초롱
for(const x of [CX-48,CX+47]){rect(x,106,1,5,"#3a2408");rect(x-2,111,5,7,"#c83a2a");rect(x-1,112,3,5,"#ff9a5a");rect(x-2,118,5,1,"#ffd54a");rect(x,119,1,3,"#ffd54a")}
// 위층 전각
rect(CX-22,74,44,18,"#2a1410");for(const x of [-20,-9,6,17]){rect(CX+x,74,3,18,"#a83228");rect(CX+x,74,1,18,"#d85a3a")}
rect(CX-6,77,12,13,"#ffb04a");rect(CX-4,79,8,11,"#ffd070");rect(CX,77,1,13,"#8a3a20");rect(CX-6,83,12,1,"#8a3a20");
rect(CX-26,70,52,4,"#1e4a40");for(let x=CX-26;x<CX+26;x+=4)rect(x,71,2,2,["#ffd54a","#e8443a","#5aa8f0","#3a8a6a"][((x-CX+26)/4)%4]);
roof(58,11,20,2.3,1);
// 지붕 꼭대기: 황금 여의주
dsc(CX,51,4,"#7a5a10");dsc(CX,51,3,"#ffd54a");rect(CX-1,49,2,2,"#ffffff");rect(CX-1,54,2,3,"#c8902a");
// 깃발
for(const [x,d] of [[CX-58,-1],[CX+57,1]]){rect(x,92,1,48,"#5a3a20");rect(x-1,90,3,2,"#ffd54a");const fx=d<0?x-8:x+1;rect(fx,94,8,16,"#ffc830");rect(fx,94,8,1,"#fff0a0");rect(fx+3,99,2,5,"#e8443a");rect(fx+2,101,4,1,"#e8443a");for(let k=0;k<4;k++)rect(fx+k*2,110,1,2,"#ffc830")}
// 은행나무 숲
const ginkgo=(x,base,r)=>{rect(x-2,base-r*1.6,4,r*1.6+3,"#2a1a10");rect(x-1,base-r*1.6,1,r*1.6,"#4a3020");for(const [dx,dy,rr] of [[0,-r*1.9,r],[-r*.75,-r*1.5,r*.75],[r*.75,-r*1.5,r*.75],[-r*.4,-r*2.35,r*.6],[r*.45,-r*2.3,r*.6]]){dsc(x+dx,base+dy,rr,"#7a4a0c");dsc(x+dx-rr*.2,base+dy-rr*.25,rr*.72,"#d08a14");dsc(x+dx-rr*.35,base+dy-rr*.4,rr*.36,"#ffd54a")}for(let i=0;i<6;i++)rect(x+ri(-r,r),base-ri(r,r*2.6),2,2,"#fff0a0")};
const mids=[];for(let x=-8;x<TW+10;x+=ri(18,28)){if(x>240&&x<380)continue;mids.push([x,ri(160,176),ri(13,20)])}
mids.sort((a,b)=>a[1]-b[1]);for(const [x,b,r] of mids)ginkgo(x,b,r);
ginkgo(262,166,10);
// 석등
const lantern=(x,y,s)=>{rect(x-4*s,y-s,8*s,s,"#14100c");rect(x-1*s,y-5*s,2*s,4*s,"#6a6052");rect(x-3*s,y-9*s,6*s,4*s,"#7a705e");rect(x-2*s,y-8*s,4*s,2*s,"#ffd070");rect(x-4*s,y-11*s,8*s,2*s,"#8a806c");rect(x-1*s,y-12*s,2*s,1*s,"#c8902a")};
for(const [x,y,s] of SHROOMS)if(s===1)lantern(x,y,s);
// ================= 전경 =================
c=fgc.getContext("2d");
// 왼쪽 위: 기와 처마 + 매달린 등
const ex=y=>Math.round(150-y*2.6-Math.pow(y/56,3)*24);
for(let y=0;y<60;y++){const xr=ex(y);if(xr<=0)break;rect(0,y,xr,1,y%5<2?"#14121c":"#1c1a28");for(let x=(y*2)%6;x<xr-4;x+=6)rect(x,y,1,1,"#0a0910")}
for(let y=0;y<60;y++){const xr=ex(y);if(xr<=0)break;rect(xr-3,y,3,1,"#c8902a");rect(xr-6,y,3,1,["#e8443a","#3a8a6a","#5aa8f0","#ffd54a"][(y>>1)%4])}
rect(66,30,1,20,"#2a1a10");rect(62,50,10,2,"#c8902a");rect(61,52,12,12,"#b0302a");rect(63,53,8,10,"#ff6a3a");rect(65,54,4,8,"#ffc070");rect(62,64,10,2,"#c8902a");rect(66,66,1,6,"#ffd54a");rect(64,71,5,1,"#ffd54a");
// 오른쪽 위: 은행나무 가지
for(let k=0;k<40;k++)rect(384-k*1.4,62-k*1.3,3,2,"#2a1a10");
const blobs=(list)=>{for(const [x,y,r] of list)dsc(x+2,y+2,r,"#4a2e06");for(const [x,y,r] of list)dsc(x,y,r,"#c88a18");for(const [x,y,r] of list)dsc(x-r*.25,y-r*.3,r*.6,"#ffd54a");for(const [x,y,r] of list)dsc(x-r*.4,y-r*.45,r*.28,"#fff0a0")};
blobs([[378,8,24],[346,-4,20],[390,42,16],[360,26,12],[326,6,10]]);
const rx=y=>370-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-196)*.9);
for(let y=60;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#120c08");rect(xl-1,y,1,1,"#4a3010")}
const lx=y=>14+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-200)*.8);
for(let y=60;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#120c08");rect(xr,y,2,1,"#4a3010")}
rect(0,TH-3,TW,3,"#0e0b08");
for(let i=0;i<170;i++){const x=pr(0,TW),h=ri(5,16),d=R()<.5?-1:1;for(let k=0;k<h;k++)rect(x+d*Math.round(k*k*.012),TH-k,1,1,k>h-3?"#8a6a20":"#1a1408")}
for(let i=0;i<60;i++)rect(ri(0,TW),ri(TH-10,TH-2),2,1,["#e8a820","#ffd54a"][ri(0,1)]);
for(const [x,y,s] of SHROOMS)if(s===2)lantern(x,y,s);
{const g2=bgc.getContext("2d");g2.drawImage(midc,0,0)}return{bg:bgc,mid:cloudc,fg:fgc}};
// 하늘을 휘감아 나는 황룡 (타이틀 · 오방천궁)
function drawSkyDragon(g,t){const N=60,U=t*.2,P=u=>({x:200+150*Math.sin(u),y:58+24*Math.sin(2*u)}),sg=[];for(let i=0;i<N;i++)sg.push(P(U-i*.032));
 for(let i=N-1;i>=1;i--){const q=sg[i],k=1-i/N,r=Math.max(2,Math.round(1.8+6*Math.pow(k,.6))),x=Math.round(q.x/2)*2,y=Math.round(q.y/2)*2;
  disc(g,x,y,r+2,"#2a1606");disc(g,x,y,r,i%4<2?"#e8a820":"#d08c18");if(r>2)disc(g,x,y-Math.max(1,r>>1),Math.max(1,r-3),"#ffe070");
  if(i%3===0&&i<N-4){g.fillStyle="#e8443a";g.fillRect(x-1,y-r-3,2,3);g.fillStyle="#ff9a6a";g.fillRect(x-1,y-r-3,1,1)}
  if(i===9||i===30){g.fillStyle="#d08c18";g.fillRect(x-1,y+r,2,4);g.fillStyle="#2a1606";g.fillRect(x-3,y+r+4,5,1);g.fillStyle="#fff0c0";g.fillRect(x-3,y+r+3,1,1);g.fillRect(x+1,y+r+3,1,1)}
  if(i%7===3&&Math.sin(t*5+i)>.6){g.fillStyle="#ffffff";g.fillRect(x,y-1,1,1)}}
 {const tp=sg[N-1];disc(g,Math.round(tp.x),Math.round(tp.y),3,"#e8443a");g.fillStyle="#ff9a6a";g.fillRect(Math.round(tp.x)-1,Math.round(tp.y)-1,2,2)}
 const h=sg[0],q=sg[1];let dx=h.x-q.x,dy=h.y-q.y;const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;let nx=-dy,ny=dx;if(ny>0){nx=-nx;ny=-ny}
 const X=(a,b)=>Math.round(h.x+dx*a+nx*b),Y=(a,b)=>Math.round(h.y+dy*a+ny*b);
 for(let k=0;k<6;k++){const w=Math.sin(t*6+k)*2;g.fillStyle=k%2?"#e8443a":"#ff7a4a";g.fillRect(X(-5-k*2.2,4+w)-1,Y(-5-k*2.2,4+w)-1,3,3)}
 for(let k=0;k<7;k++){g.fillStyle=k>4?"#fff0d0":"#e8d0a0";g.fillRect(X(-2-k*1.5,5+k*1),Y(-2-k*1.5,5+k*1),2,2)}
 disc(g,X(0,0),Y(0,0),8,"#2a1606");disc(g,X(0,0),Y(0,0),6,"#f0b828");disc(g,X(7,-1),Y(7,-1),5,"#2a1606");disc(g,X(7,-1),Y(7,-1),4,"#f0b828");disc(g,X(0,2),Y(0,2),3,"#ffe070");
 g.fillStyle="#fff2c8";g.fillRect(X(7,-4),Y(7,-4),4,2);g.fillStyle="#e8443a";g.fillRect(X(10,-3),Y(10,-3),2,1);
 g.fillStyle="#ffffff";g.fillRect(X(2,2)-1,Y(2,2)-1,3,3);g.fillStyle="#2a1606";g.fillRect(X(2.5,2),Y(2.5,2),1,2);
 g.lineWidth=1;for(const sd of [1,-1]){g.strokeStyle=sd>0?"#ffe070":"#c8902a";g.beginPath();g.moveTo(X(10,sd*1.5),Y(10,sd*1.5));for(let k=1;k<=9;k++){const b=sd*(1.5+k*.7)+Math.sin(t*4+k*.8)*2;g.lineTo(X(10-k*3,b),Y(10-k*3,b))}g.stroke()}
 const px=X(24,Math.sin(t*3)*3),py=Y(24,Math.sin(t*3)*3);g.globalCompositeOperation="lighter";g.globalAlpha=.55+.15*Math.sin(t*4);g.drawImage(GL.warm,px-26,py-26,52,52);g.globalCompositeOperation="source-over";g.globalAlpha=1;
 disc(g,px,py,4,"#2a1606");disc(g,px,py,3,"#fff0b0");g.fillStyle="#ffffff";g.fillRect(px-1,py-2,2,2)}
const buildCloudScene=()=>{
const mk=()=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;return k},bgc=mk(),fgc=mk(),R=rng(4242);
let c=bgc.getContext("2d");
const pr=(a,b)=>a+R()*(b-a),ri=(a,b)=>Math.floor(pr(a,b+1)),BY=[[0,.5],[.75,.25]];
const rect=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)))};
const dsc=(x,y,r,col)=>disc(c,Math.round(x),Math.round(y),Math.max(1,Math.round(r)),col);
const band=(y0,y1,cols,skip)=>{for(let y=y0;y<y1;y+=2){const q=(y-y0)/(y1-y0)*(cols.length-1),i=Math.min(cols.length-2,Math.floor(q)),fr=q-i;for(let x=0;x<TW;x+=2){if(skip&&y<skip(x))continue;rect(x,y,2,2,fr>BY[(y>>1)&1][(x>>1)&1]?cols[i+1]:cols[i])}}};
// ---- 하늘: 동틀 녘 ----
band(0,140,["#1c1c44","#2a2860","#463876","#6e4486","#a8588a","#e07a86","#f8a888","#ffd49a"]);
// 떠오르는 해 + 햇살
c.globalAlpha=.08;for(const r of [70,56,44])dsc(300,126,r,"#fff0c0");c.globalAlpha=.16;dsc(300,126,34,"#fff0c0");c.globalAlpha=1;dsc(300,128,24,"#ffd890");dsc(300,128,20,"#fff0c8");dsc(296,124,10,"#ffffff");
c.globalAlpha=.12;for(let k=0;k<9;k++){const a=-Math.PI+.18+k*.35;for(let d=30;d<180;d+=2)rect(300+Math.cos(a)*d,128+Math.sin(a)*d,2,2,"#fff0c0")}c.globalAlpha=1;
// 무지개
for(const [r,col] of [[96,"#ff8a8a"],[92,"#ffc070"],[88,"#fff090"],[84,"#9ae8a0"],[80,"#8ac8ff"],[76,"#b8a0ff"]]){c.globalAlpha=.32;for(let a=Math.PI*1.08;a<Math.PI*1.62;a+=.01)rect(318+Math.cos(a)*r,150+Math.sin(a)*r*.9,2,2,col)}c.globalAlpha=1;
// 높은 구름 조각
for(const [x,y,w] of [[20,30,70],[150,50,60],[250,22,50]]){rect(x,y,w,3,"#f4b8b0");rect(x+8,y-3,w-20,3,"#ffd8c8");rect(x+4,y+3,w-8,1,"#c88aa0")}
// ---- 구름 바다 (해 앞) ----
const sea=(y0,cols,amp,seed)=>{for(let x=-10;x<TW+20;x+=8){const r=8+Math.round(Math.abs(Math.sin(x*.13+seed))*amp);dsc(x,y0-r*.3,r+1,cols[0])}rect(0,y0,TW,TH-y0,cols[0]);for(let x=-10;x<TW+20;x+=8){const r=7+Math.round(Math.abs(Math.sin(x*.13+seed))*amp);dsc(x,y0-r*.3-1,r,cols[1]);dsc(x-2,y0-r*.3-3,Math.max(2,r-5),cols[2])}};
sea(128,["#7a5a8a","#c08aa8","#f0c0c8"],6,1);sea(138,["#6a5088","#a878a0","#e0a8c0"],7,3);
// ---- 떠 있는 섬들 + 폭포 ----
const island=(x,y,w,h,shrine)=>{for(let i=0;i<h;i++){const ww=Math.round(w*(1-i/h)*(1-i/h*.3));rect(x-ww,y+i,ww*2,1,i<3?"#7a9a42":i%4===0?"#4a3a4a":"#5a4a5a")}rect(x-w,y,w*2,2,"#9aba52");for(let k=0;k<w/2;k++)rect(x+pr(-w+2,w-2),y-1,1,1,["#ffd54a","#ffffff","#ffa8c0"][ri(0,2)]);
 const fx=x+Math.round(w*.4);c.globalAlpha=.75;rect(fx,y+2,2,h+30,"#e8f4ff");rect(fx+2,y+2,1,h+30,"#a8c8f0");c.globalAlpha=1};
island(46,96,22,16);island(150,108,14,10);
// ---- 땅: 금빛 초원 고원 ----
const gT=x=>Math.round((146+Math.sin(x/30)*3+Math.sin(x/11)*1.5)/2)*2;
band(144,TH,["#7a9a42","#6a8a3a","#5a7a34","#4a6a2e","#3a5a28"],gT);
for(let i=0;i<420;i++)rect(ri(0,TW),ri(152,TH),ri(1,3),1,R()<.6?"#9aba52":"#2e4a20");
for(let i=0;i<260;i++)rect(ri(0,TW),ri(150,TH),2,1,["#ffd54a","#ffffff","#ffa8c0","#c8a8ff"][ri(0,3)]);
// ---- 성소 섬 (둥지 자리) ----
{const CX=318;for(let i=0;i<34;i++){const ww=Math.round(52*(1-i/34)*(1-i/34*.25));rect(CX-ww,150+i,ww*2,1,i<3?"#7a9a42":i%4===0?"#4a3a4a":"#5a4a5a")}rect(CX-52,150,104,2,"#9aba52");
 c.globalAlpha=.7;rect(CX+30,152,3,60,"#e8f4ff");rect(CX+33,152,1,60,"#a8c8f0");rect(CX-36,152,2,46,"#e8f4ff");c.globalAlpha=1;
 rect(CX-36,138,72,12,"#e8e4f0");rect(CX-36,138,72,1,"#ffffff");rect(CX-36,149,72,1,"#a8a4c0");
 for(const x of [-30,-18,15,27])rect(CX+x,112,3,26,"#c83a2a"),rect(CX+x,112,1,26,"#ff6a4a");
 rect(CX-26,112,52,26,"#f4f0ff");rect(CX-9,118,18,20,"#ffd890");rect(CX-7,120,14,18,"#fff0c0");rect(CX-1,118,1,20,"#c8a060");rect(CX-9,127,18,1,"#c8a060");
 rect(CX-38,106,76,6,"#2a6a6a");for(let x=CX-38;x<CX+38;x+=4)rect(x,107,2,2,["#ffd54a","#e8443a","#5aa8f0","#9ae8d0"][((x-CX+38)/4)%4]);
 for(let r=0;r<13;r++){const w=Math.round(24+r*2.4),y=93+r;rect(CX-w,y,w*2,1,r<2?"#4aa8a0":r%3===0?"#2a7a78":"#3a9890");for(let x=CX-w+1;x<CX+w;x+=3)rect(x,y,1,1,"#1e5a58")}
 rect(CX-56,105,112,1,"#ffd54a");for(let k=0;k<6;k++){rect(CX-56-k*1.5,104-k,2,1,"#3a9890");rect(CX+54+k*1.5,104-k,2,1,"#3a9890")}rect(CX-24,91,48,2,"#ffd54a");dsc(CX,87,3,"#ffd54a");rect(CX-1,85,2,2,"#ffffff");
 for(const x of [CX-46,CX+45]){rect(x,106,1,5,"#3a2408");rect(x-2,111,5,7,"#fff6e0");rect(x-1,112,3,5,"#ffd890");rect(x-2,118,5,1,"#ffd54a")}}
// ---- 흰 돌길 ----
for(let y=156;y<TH;y++){const t=Math.max(0,(y-158)/82),p=tpath(t),w=3+t*30;rect(p.x-w-3,y,w*2+6,1,"#3a4060");rect(p.x-w-1,y,w*2+2,1,"#d8b04a");rect(p.x-w,y,w*2,1,"#c8cce0");rect(p.x-w*.6,y,w*1.2,1,"#dde0f0")}
for(let i=0;i<120;i++){const t=pr(0,1),p=tpath(t),w=3+t*30;rect(p.x+pr(-w,w),158+t*82,ri(1,2),1,["#ffffff","#a8acc8","#ffd54a"][ri(0,2)])}
const lantern=(x,y,s)=>{rect(x-3*s,y-s,6*s,s,"#3a4060");rect(x-1*s,y-5*s,2*s,4*s,"#9aa0c0");rect(x-3*s,y-9*s,6*s,4*s,"#b8bcd8");rect(x-2*s,y-8*s,4*s,2*s,"#fff0a0");rect(x-4*s,y-11*s,8*s,2*s,"#d0d4ec");rect(x-1*s,y-12*s,2*s,1*s,"#ffd54a")};
for(const [x,y,s] of SHROOMS)if(s===1)lantern(x,y,s);
// ================= 전경: 구름 · 꽃 =================
c=fgc.getContext("2d");
const puffs=(list)=>{for(const [x,y,r] of list)dsc(x+2,y+3,r,"#7a6a9a");for(const [x,y,r] of list)dsc(x,y,r,"#e8d8f0");for(const [x,y,r] of list)dsc(x-r*.25,y-r*.3,r*.6,"#fff4fa");for(const [x,y,r] of list)dsc(x-r*.4,y-r*.45,r*.25,"#ffffff")};
puffs([[6,10,26],[40,2,20],[70,-6,18],[20,40,16]]);puffs([[380,8,24],[350,-4,18],[392,40,16]]);
const lx=y=>10+Math.round(Math.sin(y/25)*3)+Math.round(Math.max(0,y-200)*.8);for(let y=60;y<TH;y++){const xr=lx(y);rect(-4,y,xr+4,1,"#2a3a20");rect(xr,y,2,1,"#5a7a3a")}
const rx=y=>374-Math.round(Math.sin(y/21+1)*3)-Math.round(Math.max(0,y-196)*.9);for(let y=60;y<TH;y++){const xl=rx(y);rect(xl,y,TW-xl+4,1,"#2a3a20");rect(xl-1,y,1,1,"#5a7a3a")}
rect(0,TH-3,TW,3,"#1e2e18");
for(let i=0;i<190;i++){const x=pr(0,TW),h=ri(6,18),d=R()<.5?-1:1;for(let k=0;k<h;k++)rect(x+d*Math.round(k*k*.012),TH-k,1,1,k>h-3?"#9aba52":"#2e4a20");if(R()<.25)rect(x+d*Math.round(h*h*.012)-1,TH-h-1,3,2,["#ffd54a","#ffffff","#ffa8c0"][ri(0,2)])}
for(const [x,y,s] of SHROOMS)if(s===2)lantern(x,y,s);
return{bg:bgc,fg:fgc}};
// 하늘을 나는 학 (타이틀 · 구름 성소)
function drawCranes(g,t){for(let i=0;i<3;i++){const T=(t*.03+i*.33)%1,x=Math.round(-30+T*(TW+60)),y=Math.round(48+i*14+Math.sin(t*.7+i*2)*6),f=Math.sin(t*5+i*1.7),wy=Math.round(f*4);
 g.fillStyle="#3a2a40";g.fillRect(x-6,y-1,13,3);g.fillStyle="#ffffff";g.fillRect(x-5,y,11,1);g.fillStyle="#2a1a20";g.fillRect(x+7,y-1,4,1);g.fillStyle="#e8443a";g.fillRect(x+6,y-2,2,1);g.fillStyle="#2a1a20";g.fillRect(x-9,y,3,1);
 g.fillStyle="#f4f0ff";for(let k=0;k<6;k++){g.fillRect(x-2-k,y-1-Math.round(wy*k/5),2,1);g.fillRect(x-2-k,y+1+Math.round(-wy*k/5)*0,0,0)}g.fillStyle="#3a2a40";g.fillRect(x-8,y-1-wy,2,1)}}
const titleScenes={};let titleScene;
const sceneOf=th=>titleScenes[th]||(titleScenes[th]=th==="burnt"?buildBurntScene():th==="frozen"?buildFrozenScene():th==="canyon"?buildCanyonScene():th==="blossom"?buildBlossomScene():th==="palace"?buildPalaceScene():th==="cloud"?buildCloudScene():buildForestScene());
function applyTitleScene(){titleScene=sceneOf(themeOf())}
applyTitleScene();
const mkFog=(col)=>{const k=document.createElement("canvas");k.width=TW;k.height=44;const g=k.getContext("2d"),R=rng(5);g.fillStyle=col;for(let i=0;i<16;i++){const cx=Math.round(R()*TW),cy=12+Math.round(R()*20),rx=24+Math.round(R()*36),h=4+Math.round(R()*5);for(let dy=-h;dy<=h;dy+=2){const w=Math.round(rx*Math.sqrt(1-(dy/h)**2)/2)*2;for(const o of [-TW,0,TW])g.fillRect(cx+o-w,cy+dy,w*2,2)}}return k};const fogTex=mkFog("#a9d8cc"),fogBurn=mkFog("#b07a68"),fogIce=mkFog("#d8eeff"),fogSilver=mkFog("#d0d0ea"),fogPink=mkFog("#ffd8e4"),fogGold=mkFog("#f0d090"),fogCloud=mkFog("#ffe8f0");
const tstars=[];while(tstars.length<90){const x=Math.floor(rand(0,TW)),y=Math.floor(rand(0,118));if(Math.hypot(x-312,y-46)<26)continue;tstars.push({x,y,s:rand(.8,2.6),p:rand(0,6.28),c:Math.random()<.25?"#fff3c0":"#cfe8ff",big:Math.random()<.08})}
const tflies=Array.from({length:56},()=>({x:rand(8,TW-8),y:rand(40,TH-10),a:rand(0,6.28),s:rand(.25,.8),r:rand(6,24),b:rand(0,6.28),z:Math.random()<.25?2:1}));
function drawTitle(t){
const burnt=themeOf()==="burnt",frozen=themeOf()==="frozen",canyon=themeOf()==="canyon",blossom=themeOf()==="blossom",palace=themeOf()==="palace",cloudT=themeOf()==="cloud",FG=burnt?fogBurn:frozen?fogIce:canyon?fogSilver:blossom?fogPink:palace?fogGold:cloudT?fogCloud:fogTex;
const g=tg;g.globalCompositeOperation="source-over";g.globalAlpha=1;g.drawImage(titleScene.bg,0,0);
for(const s of tstars){if((blossom||cloudT)&&s.y>70)continue;g.globalAlpha=(.35+.65*(.5+.5*Math.sin(t*s.s+s.p)))*(burnt?.3:blossom?.4:1);g.fillStyle=s.c;g.fillRect(s.x,s.y,1,1);if(s.big){g.fillRect(s.x-1,s.y,3,1);g.fillRect(s.x,s.y-1,1,3)}}
if(frozen&&titleScene.aur){g.globalCompositeOperation="lighter";g.globalAlpha=.55+.25*Math.sin(t*.7);g.drawImage(titleScene.aur,Math.round(Math.sin(t*.25)*6),0);g.globalAlpha=.3+.2*Math.sin(t*1.1+1);g.drawImage(titleScene.aur,Math.round(-Math.sin(t*.31)*9)-4,4);g.globalCompositeOperation="source-over"}
if(palace&&titleScene.mid){g.globalAlpha=1;g.globalCompositeOperation="source-over";drawSkyDragon(g,t);g.globalAlpha=1;g.globalCompositeOperation="source-over";g.drawImage(titleScene.mid,0,0)}
if(cloudT){g.globalAlpha=1;g.globalCompositeOperation="source-over";drawCranes(g,t)}
const sh=(t%13)/1.1;if(sh<1)for(let k=0;k<12;k++){g.globalAlpha=(1-k/12)*(1-sh*.6);g.fillStyle="#fff";g.fillRect(Math.round(40+sh*150-k*1.8),Math.round(14+sh*46-k*.7),1,1)}
g.globalAlpha=.1;const fx=(t*5)%TW;g.drawImage(FG,fx-TW,146);g.drawImage(FG,fx,146);
g.globalAlpha=.07;const fx2=-((t*3)%TW);g.drawImage(FG,fx2,186);g.drawImage(FG,fx2+TW,186);
// 굴뚝 연기
g.fillStyle="#7c6a74";for(let i=0;i<6;i++){const ph=(t*.12+i/6)%1;g.globalAlpha=(canyon||blossom||palace||cloudT?0:frozen?.25:.4)*(1-ph);disc(g,Math.round((318+Math.sin(ph*7+i)*3+ph*10)/2)*2,Math.round(((frozen?127:96)-ph*40)/2)*2,Math.max(1,Math.round(1.5+ph*3)),"#7c6a74")}
// 불빛
g.globalCompositeOperation="lighter";
const fl=.75+.1*Math.sin(t*9)+.05*Math.sin(t*23.3);
if(burnt){g.globalAlpha=.22+.05*Math.sin(t*1.3);g.drawImage(GL.warm,-40,118,TW+80,64);g.globalAlpha=.1;g.drawImage(GL.warm,0,168,TW,70)}
if(frozen||canyon||blossom||palace||cloudT){g.globalAlpha=fl*.7;g.drawImage(GL.warm,(frozen?316:318)-45,(canyon?150:blossom?138:palace?128:cloudT?128:155)-45);if(palace){g.globalAlpha=fl*.45;g.drawImage(GL.warm,318-30,84-30,60,60)}g.globalAlpha=fl*.4;g.drawImage(GL.warm,(canyon?318:316)-45,162-12,90,24)}else{g.globalAlpha=fl*.75;g.drawImage(GL.warm,318-45,149-45);g.globalAlpha=fl*.45;g.drawImage(GL.warm,318-45,160-14,90,28);g.globalAlpha=fl*.6;g.drawImage(GL.warm,318-45,98-45)}
SHROOMS.forEach(([x,y,s,k],i)=>{g.globalAlpha=(burnt?.7:.5)+.2*Math.sin(t*1.7+i);g.drawImage(frozen?GL.ice:canyon?GL.silver:blossom||palace||cloudT?GL.warm:k?GL.purple:GL.cyan,x-22*s,y-4*s-22*s,44*s,44*s)});
g.globalCompositeOperation="source-over";
// 이그니
g.globalAlpha=.5;g.fillStyle="#030806";g.fillRect(HX-12,HY-3,24,3);g.fillRect(HX-9,HY-4,18,1);g.fillRect(HX-9,HY,18,1);g.globalAlpha=1;
{const sy=1+Math.sin(t*2.4)*.025;g.save();g.translate(HX,HY-14);g.translate(0,12);g.scale(1/sy,sy);g.translate(0,-12);if(selChar()==="zhuque"){drawWings(g,t,false);g.drawImage(SP.zhuqueA.n,-16,-24);dragonBlink(g,t,"#e8442a");drawSword(g,13,2,-.8+Math.sin(t*2.2)*.06,22,t)}else if(selChar()==="hyunmu"){shellBack(g);snakeBack(g,t,false);g.drawImage(SP.hyunmuA.n,-16,-24);hyunmuBlink(g,t);snakeFront(g,t,false)}else if(selChar()==="baekho"){baekhoTail(g,t,false);g.drawImage(SP.baekhoA.n,-16,-24);baekhoBlink(g,t)}else if(selChar()==="cheongryong"){cheongTail(g,t,false);g.drawImage(SP.cheongA.n,-16,-24);cheongBlink(g,t);cheongExtras(g,t,false,null)}else if(selChar()==="hwangryong"){hwangTail(g,t,false);g.drawImage(SP.hwangA.n,-16,-24);hwangBlink(g,t);hwangExtras(g,t,false,null)}else if(selChar()==="qilin"){qilinTail(g,t,false);g.drawImage(SP.qilinA.n,-16,-24);qilinBlink(g,t);qilinExtras(g,t,false,null)}else{dragonTail(g,t,false);g.drawImage(SP.dragonA.n,-16,-24);dragonBlink(g,t)}g.restore()}
g.globalCompositeOperation="lighter";
g.globalAlpha=.3;g.drawImage(GL.big,HX-36,HY-62);
// 둥지로 이어지는 불씨 길잡이
for(let i=0;i<9;i++){const p=tpath(HERO_T-.06-i*.062),v=.5+.5*Math.sin(t*2.4-i*.8),x=p.x+Math.sin(t*1.2+i)*3,y=p.y-14-Math.sin(t*1.7+i*2)*3;g.globalAlpha=.25+.75*v;g.drawImage(GL.fly,x-10,y-10,20,20);g.globalAlpha=.5+.5*v;g.fillStyle="#ffe0a0";g.fillRect(Math.round(x)-1,Math.round(y)-1,2,2)}
// 이그니의 반딧불이
const cx=HX+8+Math.cos(t*1.1)*16,cy=HY-54+Math.sin(t*1.9)*6;g.globalAlpha=.9;g.drawImage(GL.big,cx-24,cy-24,48,48);g.globalAlpha=1;g.fillStyle="#fffbd0";g.fillRect(Math.round(cx)-1,Math.round(cy)-1,3,3);g.fillStyle="#fff";g.fillRect(Math.round(cx),Math.round(cy),1,1);
g.globalCompositeOperation="source-over";g.globalAlpha=1;
g.drawImage(titleScene.fg,0,0);
if(palace){g.globalCompositeOperation="lighter";g.globalAlpha=.5+.12*Math.sin(t*7)+.06*Math.sin(t*17);g.drawImage(GL.warm,67-34,58-34,68,68);g.globalCompositeOperation="source-over";g.globalAlpha=1}
if(settings.fireflies&&cloudT){g.globalCompositeOperation="lighter";for(const f of tflies){const y=(f.y-t*(6+f.s*8)%TH+TH*2)%TH,x=(f.x+Math.sin(t*f.s*2+f.a)*6+TW)%TW;g.globalAlpha=.35+.45*Math.sin(t*2.4+f.b);g.fillStyle=f.z>1?"#ffffff":"#fff0c0";g.fillRect(Math.round(x),Math.round(y),f.z,f.z)}g.globalCompositeOperation="source-over";g.globalAlpha=1}
else if(settings.fireflies&&palace){for(const f of tflies){const y=(f.y+t*(9+f.s*12))%(TH+8)-4,x=(f.x+t*(6+f.s*6)+Math.sin(t*f.s*2+f.a)*10+TW)%TW,fl=Math.sin(t*3+f.b),X=Math.round(x),Y=Math.round(y);g.globalAlpha=.9;g.fillStyle=f.z>1?"#ffe070":"#e8a820";if(fl>0){g.fillRect(X-1,Y,3+f.z-1,1);g.fillRect(X,Y+1,1,1)}else g.fillRect(X,Y,1,2)}
 g.globalCompositeOperation="lighter";for(let i=0;i<26;i++){const x=(i*61+Math.sin(t*.7+i)*8+TW*4)%TW,y=TH-((t*(8+i%5*3)+i*37)%TH);g.globalAlpha=.35+.4*Math.sin(t*2+i);g.fillStyle="#fff0a0";g.fillRect(Math.round(x),Math.round(y),1,1)}g.globalCompositeOperation="source-over";g.globalAlpha=1}
else if(settings.fireflies&&blossom){for(const f of tflies){const y=(f.y+t*(16+f.s*14))%(TH+8)-4,x=(f.x+t*(10+f.s*8)+Math.sin(t*f.s*2+f.a)*8+TW)%TW;g.globalAlpha=.6+.3*Math.sin(t*3+f.b);g.fillStyle=f.z>1?"#ffe0ea":"#ffb8d0";g.fillRect(Math.round(x),Math.round(y),f.z+1,f.z)}g.globalAlpha=.22;g.fillStyle="#cfe0ff";for(let i=0;i<40;i++){const x=(i*97+t*40)%TW,y=(i*53+t*260)%TH;g.fillRect(Math.round(x),Math.round(y),1,5)}g.globalAlpha=1}
else if(settings.fireflies&&canyon){for(const f of tflies){const x=(f.x+t*(14+f.s*22)*f.z)%(TW+8)-4,y=(f.y+Math.sin(t*f.s*2+f.a)*5+TH)%TH;g.globalAlpha=.45+.35*Math.sin(t*2+f.b);g.fillStyle=f.z>1?"#ffffff":"#d8d8f0";g.fillRect(Math.round(x),Math.round(y),f.z+1,1)}g.globalAlpha=1}
else if(settings.fireflies&&frozen){for(const f of tflies){const y=(f.y+t*(10+f.s*14)*f.z)%(TH+8)-4,x=(f.x+Math.sin(t*f.s+f.a)*6+TW)%TW;g.globalAlpha=.55+.35*Math.sin(t*2+f.b);g.fillStyle=f.z>1?"#ffffff":"#d8ecff";g.fillRect(Math.round(x),Math.round(y),f.z,f.z)}g.globalAlpha=1}
else if(settings.fireflies){g.globalCompositeOperation="lighter";for(const f of tflies){const x=f.x+Math.cos(t*f.s+f.a)*f.r,y=f.y+Math.sin(t*f.s*1.3+f.a)*f.r*.6,v=Math.max(0,Math.sin(t*(1+f.s)+f.b)),z=f.z;g.globalAlpha=v*.9;g.drawImage(GL.fly,x-6*z,y-6*z,12*z,12*z);g.globalAlpha=.4+.6*v;g.fillStyle="#ffe0a0";g.fillRect(Math.round(x),Math.round(y),z,z)}g.globalCompositeOperation="source-over"}
g.globalAlpha=1;if(settings.vignette)g.drawImage(vig,0,0,TW,TH);
logo.draw(t);
}
let titleRaf=0;
function titleFrame(now){drawTitle(now/1000);titleRaf=requestAnimationFrame(titleFrame)}
function startTitle(){stopTitle();titleRaf=requestAnimationFrame(titleFrame)}
function stopTitle(){if(titleRaf)cancelAnimationFrame(titleRaf);titleRaf=0}
/* ---- 타이틀 메뉴 / 모달 / 설정 ---- */
const modals={settings:$("settingsPanel"),howto:$("howtoPanel")};
let lastOpener=null,starting=false;
const openModalEl=()=>Object.values(modals).find(m=>!m.classList.contains("hidden"))||null;
function openModal(k,opener){closeModals();lastOpener=opener||null;modals[k].classList.remove("hidden");const b=modals[k].querySelector("button");if(b)b.focus({preventScroll:true})}
function closeModals(){for(const m of Object.values(modals))m.classList.add("hidden")}
function closeAndRefocus(){const openM=Object.values(modals).find(m=>!m.classList.contains("hidden"));closeModals();if(!lastOpener)return;
 const back=lastOpener.closest&&lastOpener.closest("#playPanel,#recordsPanel,#settingsPanel"),mainBtn=b=>b&&(b.id==="playPanel"?$("playMenuButton"):b.id==="settingsPanel"?$("settingsButton"):$("recordsButton"));
 if(back&&back!==openM){back.classList.remove("hidden");lastOpener.focus({preventScroll:true});lastOpener=mainBtn(back);return}
 if(back&&back===openM){const mb=mainBtn(back);lastOpener=null;if(mb)mb.focus({preventScroll:true});return}
 lastOpener.focus({preventScroll:true})}
function showTitle(){
if(typeof quitUI!=="undefined"&&quitUI.open_)quitUI.close();
if(raf){cancelAnimationFrame(raf);raf=0}
if(state){state.paused=true;state.choosing=false}
ui.pause.classList.add("hidden");ui.level.classList.add("hidden");ui.over.classList.add("hidden");ending.classList.add("hidden");closeModals();
document.body.classList.add("on-title");ui.start.classList.remove("hidden","fade");towerBtn.refresh();logo.ignite();startTitle();$("startButton").focus({preventScroll:true})}
function startGame(mode,diff){if(starting)return;gameMode=mode==="tower"?"tower":"story";gameDiff=diff==="hard"&&(dbg.on||(gameMode==="tower"?rec.towerHardOpen():rec.storyHardOpen()))?"hard":"easy";setWorld(gameMode==="tower"?TOWER_DIFF.worldScale:STORY_SCALE);starting=true;ui.start.classList.add("fade");setTimeout(()=>{starting=false;applyBg();reset()},380)}
const fsOn=()=>!!document.fullscreenElement;
function toggleFs(){const el=document.documentElement;if(!el.requestFullscreen)return;try{const r=fsOn()?document.exitFullscreen():el.requestFullscreen();if(r&&r.catch)r.catch(()=>{})}catch(_){}}
function syncSettings(){
applyFont();
document.querySelectorAll(".toggle[data-key]").forEach(b=>{const on=!!settings[b.dataset.key];b.classList.toggle("on",on);b.setAttribute("aria-checked",String(on));b.querySelector(".state-text").textContent=on?tx("켜짐","On"):tx("꺼짐","Off")});
const fb=$("fsButton");fb.classList.toggle("on",fsOn());fb.setAttribute("aria-checked",String(fsOn()));fb.querySelector(".state-text").textContent=fsOn()?tx("켜짐","On"):tx("꺼짐","Off");
const lb=$("langButton");if(lb)lb.querySelector(".state-text").textContent=isEN()?"English":"한국어"}
$("settingsButton").addEventListener("click",e=>openModal("settings",e.currentTarget));
$("howtoButton").addEventListener("click",e=>openModal("howto",e.currentTarget));
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",closeAndRefocus));
for(const m of Object.values(modals))m.addEventListener("click",e=>{if(e.target===m)closeAndRefocus()});
document.querySelectorAll(".toggle[data-key]").forEach(b=>b.addEventListener("click",()=>{settings[b.dataset.key]=!settings[b.dataset.key];saveSettings();syncSettings()}));
$("fsButton").addEventListener("click",toggleFs);
if(!document.documentElement.requestFullscreen)$("fsButton").style.display="none";
document.addEventListener("fullscreenchange",syncSettings);
document.querySelectorAll("#mainMenu .menu-btn").forEach(b=>b.addEventListener("mouseenter",()=>b.focus({preventScroll:true})));
document.querySelectorAll("img[data-sprite]").forEach(im=>{const s=SP[im.dataset.sprite];if(s)im.src=s.n.toDataURL()});
/* ================= 인게임: 타이틀로 나가기 확인 창 (2단계 · Y / N) ================= */
const quitUI=(()=>{
const css=document.createElement("style");
css.textContent="#quitOverlay{position:absolute;inset:0;z-index:45;display:grid;place-items:center;padding:16px;background:rgba(3,8,6,.66)}#quitOverlay.hidden{display:none}#quitOverlay .panel{width:min(420px,92vw);text-align:center}#quitOverlay h2{margin:6px 0 6px;font-size:24px}#quitOverlay p.q-sub{margin:0 0 4px;font-size:14px;color:#cfe0cf;min-height:1.2em}#quitOverlay .panel-actions{gap:18px}#quitOverlay .panel-actions button{min-width:130px}#quitOverlay.q2 .panel{box-shadow:0 -4px 0 0 #a8303a,0 4px 0 0 #a8303a,-4px 0 0 0 #a8303a,4px 0 0 0 #a8303a,0 0 0 8px #1a0508,0 24px 60px rgba(0,0,0,.6)}#quitOverlay.q2 h2{color:#ff9aa8}#quitOverlay kbd{font-size:.8em;padding:0 5px;margin-left:4px}";
document.head.appendChild(css);
const ov=document.createElement("div");ov.id="quitOverlay";ov.className="hidden";ov.setAttribute("role","alertdialog");ov.setAttribute("aria-modal","true");
(canvas.closest(".game-frame")||document.body).appendChild(ov);
let step=0,wasPaused=false,kind="title";
function paint(){const R=kind==="restart",h=R?tx("새 게임을 시작할까요?","Start a new game?"):step===2?tx("정말 나가시겠습니까?","Are you really sure?"):tx("타이틀로 나가시겠습니까?","Return to the title?");
 ov.classList.toggle("q2",step===2);ov.setAttribute("aria-label",h);
 ov.innerHTML='<div class="panel"><p class="eyebrow">'+(step===2?"CONFIRM":R?"NEW GAME":"PAUSE")+'</p><h2>'+h+'</h2>'
  +'<p class="q-sub">'+(step===2?tx("지금 진행 중인 판은 여기서 끝나요","This run will end here"):"")+'</p>'
  +'<div class="panel-actions"><button type="button" class="'+(step===2?"ghost-button big":"primary-button")+'" data-q="y">'+tx("네","Yes")+'<kbd>Y</kbd></button><button type="button" class="'+(step===2?"primary-button":"ghost-button big")+'" data-q="n">'+tx("아니오","No")+'<kbd>N</kbd></button></div></div>';
 ov.querySelector('[data-q="y"]').addEventListener("click",yes);ov.querySelector('[data-q="n"]').addEventListener("click",no);
 // 2단계에서는 실수 방지로 '아니오'에 먼저 포커스
 const f=ov.querySelector(step===2?'[data-q="n"]':'[data-q="y"]');if(f)f.focus({preventScroll:true})}
function open(k){if(step)return;kind=k==="restart"?"restart":"title";wasPaused=!!(state&&state.paused);if(state)state.paused=true;step=kind==="restart"?2:1;ov.classList.remove("hidden");paint()}
function close(){step=0;ov.classList.add("hidden");if(state&&!wasPaused&&!state.dead&&!state.choosing)state.paused=false}
function yes(){if(step===1){step=2;paint();return}step=0;ov.classList.add("hidden");if(kind==="restart"){if(typeof pauseMenu!=="undefined")pauseMenu.hide();ui.pause.classList.add("hidden");reset()}else showTitle()}
function no(){close()}
window.addEventListener("keydown",e=>{if(!step)return;const k=e.key.toLowerCase();e.stopImmediatePropagation();if(e.repeat){e.preventDefault();return}
 if(k==="y"){e.preventDefault();yes()}else if(k==="n"||k==="escape"){e.preventDefault();no()}
 else if(k==="enter"||k===" "){/* 포커스된 버튼이 처리 */}else if(k!=="tab")e.preventDefault()},true);
return{open,close,get open_(){return!!step}}})();
$("titleTop").addEventListener("click",e=>{e.currentTarget.blur();if(state&&!state.dead&&!state.won&&state.time>0){quitUI.open();return}showTitle()});
$("toTitleButton").addEventListener("click",showTitle);
window.addEventListener("keydown",e=>{
if(e.key.toLowerCase()==="f"&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey)toggleFs();
if(ui.start.classList.contains("hidden"))return;
const m=openModalEl();
if(e.key==="Escape"&&m){closeAndRefocus();return}
if(e.key==="ArrowDown"||e.key==="ArrowUp"){const bs=[...(m||$("mainMenu")).querySelectorAll("button")].filter(b=>b.offsetParent!==null),i=bs.indexOf(document.activeElement),n=i<0?0:(i+(e.key==="ArrowDown"?1:-1)+bs.length)%bs.length;if(bs.length)bs[n].focus({preventScroll:true});e.preventDefault()}});
$("startButton").addEventListener("click",()=>{if(document.body.classList.contains("touch")&&!fsOn())toggleFs()});
/* ---- 타이틀 배경(맵) 전환: 재의 숲 ⇄ 불타버린 땅 ---- */
const MAP_NAMES={forest:"재의 숲",burnt:"불타버린 땅",frozen:"얼어붙은 북해",canyon:"은빛 억새 협곡",blossom:"봄비 벚꽃 계곡",palace:"오방천궁",cloud:"구름 성소"},MAP_NAMES_EN={forest:"Ashen Woods",burnt:"Scorched Land",frozen:"Frozen North Sea",canyon:"Silver Grass Canyon",blossom:"Spring Rain Blossom Valley",palace:"Celestial Palace of the Five",cloud:"Cloud Sanctuary"},mapName=th=>(isEN()?MAP_NAMES_EN:MAP_NAMES)[th];
const mapBtn=$("mapSwitch"),mapLabel=$("mapSwitchLabel");
let mapSwapping=false;
function syncMapBtn(){if(!mapBtn)return;const th=themeOf();mapBtn.dataset.theme=th;mapLabel.textContent=mapName(th);mapBtn.setAttribute("aria-label",tx("타이틀 배경 변경: 현재 ","Change title background: now ")+mapName(th))}
function switchMap(){if(mapSwapping)return;mapSwapping=true;const next=MAP_THEMES[(MAP_THEMES.indexOf(themeOf())+1)%MAP_THEMES.length],cv=$("titleCanvas");
 const swap=()=>{settings.mapTheme=next;saveSettings();applyTitleScene();applyBg();syncMapBtn();mapSwapping=false};
 if(cv.animate&&!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)){cv.animate([{filter:"brightness(1)"},{filter:"brightness(0)",offset:.45},{filter:"brightness(1)"}],{duration:480,easing:"ease-in-out"});setTimeout(swap,216)}else swap()}
{const st=document.createElement("style");st.textContent='.map-switch[data-theme="frozen"] .ms-ico{background:#9fe4ff;box-shadow:inset -3px -3px 0 #3a7aa8,0 0 0 1px #0a0505}.map-switch[data-theme="cloud"] .ms-ico{background:#e8eaff;box-shadow:inset -3px -3px 0 #8a90c8,0 0 0 1px #0a0505}.map-switch[data-theme="palace"] .ms-ico{background:#ffd54a;box-shadow:inset -3px -3px 0 #a8701a,0 0 0 1px #0a0505}.map-switch[data-theme="blossom"] .ms-ico{background:#ff9ab8;box-shadow:inset -3px -3px 0 #a8406a,0 0 0 1px #0a0505}.map-switch[data-theme="canyon"] .ms-ico{background:#d8dcea;box-shadow:inset -3px -3px 0 #6a6e88,0 0 0 1px #0a0505}';document.head.appendChild(st)}
if(mapBtn){mapBtn.addEventListener("click",()=>{switchMap();mapBtn.blur()});syncMapBtn()}

/* ================= 웨이브(NIGHT) 스킵 + 단축키 설정 ================= */
// 이동·일시정지·전체화면·배경전환·레벨업(1~3)·테스트(1~9) 키와 겹치지 않게 막아 둡니다
const RESERVED_KEYS=new Set(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","p","f","m","escape","enter","tab","0","1","2","3","4","5","6","7","8","9","shift","control","alt","meta","capslock","os","process","dead","unidentified","contextmenu"]);
const DEFAULT_SKIP_KEY="n",SKIP_GAP=350;
if(typeof settings.skipKey!=="string"||!settings.skipKey||RESERVED_KEYS.has(settings.skipKey))settings.skipKey=DEFAULT_SKIP_KEY;
const KEY_NAMES={" ":"Space",backspace:"Backspace",delete:"Delete",insert:"Insert",home:"Home",end:"End",pageup:"PgUp",pagedown:"PgDn"};
const keyName=k=>KEY_NAMES[k]||(k.length===1?k.toUpperCase():k.charAt(0).toUpperCase()+k.slice(1));
const pad2=n=>String(n).padStart(2,"0");
const inPlay=()=>!!(state&&state.p&&state.p.charId!==undefined&&!document.body.classList.contains("on-title")&&ui.start.classList.contains("hidden"));
const bossLock=()=>!!(state&&(state.mode==="tower"||state.bossNight||state.enemies.some(e=>e.boss)));
let lastSkip=0;
/* 스킵한 NIGHT의 남은 시간 동안 원래 나왔을 적의 수 (출현 간격 공식을 그대로 따라 계산) */
const SKIP_FLUSH=6; // 스킵으로 밀린 적을 몇 초에 걸쳐 내보낼지
function skipBacklog(){const rem=Math.max(0,NIGHT_LEN-state.nightT);let acc=Math.max(0,state.spawn),n=0;while(acc<=rem&&n<5000){n++;acc+=Math.max(.25,1.2-(state.time+acc)*.007)/SPAWN_MUL*spawnGapMul()}return n}
function skipWave(){
 if(!inPlay()||state.dead||state.won||state.win||state.choosing||state.paused)return;
 if(state.mode==="tower"){state.banner={text:tx("탑에서는 스킵할 수 없어요!","You can't skip in the tower!"),t:2};return}
 if(bossLock()){state.banner={text:tx("보스전 중에는 웨이브를 스킵할 수 없어요!","You can't skip waves during a boss fight!"),t:2};return}
 const now=performance.now();if(now-lastSkip<SKIP_GAP)return;lastSkip=now;
 const from=state.night,nb=skipBacklog();state.skipQ=(state.skipQ||0)+nb;state.skipRate=state.skipQ/SKIP_FLUSH;
 const join=nb?tx(` · 적 ${nb}마리 합류`,` · ${nb} foes incoming`):"";
 if(from%BOSS_EVERY===0||from===WITCH_NIGHT){ // 보스 직전 NIGHT를 스킵하면 바로 보스전으로
  state.nightT=NIGHT_LEN;state.bossNight=true;state.bossSpawned=false;
  state.banner={text:tx(`NIGHT ${pad2(from)} 스킵 · 보스가 다가온다!`,`NIGHT ${pad2(from)} skipped · The boss approaches!`)+join,t:2.4}}
 else{state.night++;state.nightT=0;state.banner={text:tx(`NIGHT ${pad2(from)} 스킵 → NIGHT ${pad2(state.night)}`,`NIGHT ${pad2(from)} skipped → NIGHT ${pad2(state.night)}`)+join,t:2}}
 burst(state.p.x,state.p.y,"#ffd54a",14)}
const skipTopBtn=$("skipTop"),skipKeyBtn=$("skipKeyButton"),skipKeyHint=$("skipKeyHint"),skipHint=()=>tx("누른 뒤 원하는 키를 입력하세요 · Esc 취소","Click, then press the key you want · Esc to cancel");
function syncSkipKey(){const n=keyName(settings.skipKey);document.querySelectorAll(".skip-key-label").forEach(el=>el.textContent=n);if(skipTopBtn)skipTopBtn.title=tx(`웨이브 스킵 (${n}) · 보스전 중에는 불가`,`Skip wave (${n}) · not during boss fights`)}
function syncSkipBtn(){if(!skipTopBtn)return;const l=bossLock();if(skipTopBtn.classList.contains("locked")!==l){skipTopBtn.classList.toggle("locked",l);skipTopBtn.setAttribute("aria-disabled",String(l))}}
if(skipTopBtn)skipTopBtn.addEventListener("click",e=>{e.currentTarget.blur();skipWave()});
// 단축키 입력
window.addEventListener("keydown",e=>{if(listening||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key.toLowerCase()===settings.skipKey&&inPlay()){e.preventDefault();skipWave()}});
// 설정: 단축키 변경 (버튼 누른 뒤 원하는 키 입력)
let listening=false,badT=0;
function stopListen(){listening=false;if(!skipKeyBtn)return;skipKeyBtn.classList.remove("listening");syncSkipKey()}
if(skipKeyBtn){
 skipKeyBtn.addEventListener("click",()=>{if(listening){stopListen();return}listening=true;clearTimeout(badT);skipKeyBtn.classList.remove("bad");skipKeyBtn.classList.add("listening");$("skipKeyLabel").textContent="…";skipKeyHint.textContent=tx("원하는 키를 누르세요 · Esc 취소","Press the key you want · Esc to cancel")});
 skipKeyBtn.addEventListener("blur",()=>{if(listening){stopListen();skipKeyHint.textContent=skipHint()}});
 window.addEventListener("keydown",e=>{if(!listening)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;
  const k=e.key.toLowerCase();
  if(k==="escape"){stopListen();skipKeyHint.textContent=skipHint();return}
  if(RESERVED_KEYS.has(k)||!k||k===settings.titleKey){skipKeyBtn.classList.add("bad");skipKeyHint.textContent=tx(`${keyName(k)} 키는 다른 기능에 쓰여서 지정할 수 없어요`,`${keyName(k)} is used by another function and can't be assigned`);clearTimeout(badT);badT=setTimeout(()=>skipKeyBtn.classList.remove("bad"),1600);return}
  settings.skipKey=k;saveSettings();stopListen();skipKeyHint.textContent=tx(`${keyName(k)} 키로 저장했어요`,`Saved as ${keyName(k)}`);clearTimeout(badT);badT=setTimeout(()=>{if(!listening)skipKeyHint.textContent=skipHint()},1800)},true)}
syncSkipKey();
window.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="m"&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!ui.start.classList.contains("hidden")&&!openModalEl())switchMap()});

/* ================= 타이틀로 돌아가기 단축키 (설정에서 변경 가능) ================= */
const DEFAULT_TITLE_KEY="t";
if(typeof settings.titleKey!=="string"||!settings.titleKey||RESERVED_KEYS.has(settings.titleKey)||settings.titleKey===settings.skipKey)settings.titleKey=settings.skipKey===DEFAULT_TITLE_KEY?"h":DEFAULT_TITLE_KEY;
const titleKeyUI=(()=>{
const top=$("titleTop"),row=document.createElement("button");row.id="titleKeyButton";row.type="button";row.className="setting-row kb-only";
const after=skipKeyBtn||$("langButton");if(after&&after.parentNode)after.parentNode.insertBefore(row,after.nextSibling);
let listen=false,badT=0,msg="";
const hint=()=>tx("누른 뒤 원하는 키를 입력하세요 · Esc 취소","Click, then press the key you want · Esc to cancel");
function paint(){const n=keyName(settings.titleKey);
 row.innerHTML='<span class="row-text"><strong>'+tx("타이틀로 돌아가기 단축키","Return-to-title key")+'</strong><small>'+(msg||hint())+'</small></span><span class="row-right"><kbd>'+(listen?"…":n)+'</kbd></span>';
 row.setAttribute("aria-label",tx("타이틀로 돌아가기 단축키 변경","Change return-to-title key"));
 if(top){top.title=tx(`타이틀로 돌아가기 (${n})`,`Return to title (${n})`);let k=top.querySelector(".title-key-label");if(!k){const w=document.createElement("span");w.className="kb-only";w.innerHTML=' (<span class="title-key-label"></span>)';top.appendChild(w);k=w.querySelector(".title-key-label")}k.textContent=n}}
function stop(m){listen=false;row.classList.remove("listening");msg=m||"";paint();clearTimeout(badT);if(m)badT=setTimeout(()=>{if(!listen){msg="";paint()}},1800)}
row.addEventListener("click",()=>{if(listen){stop();return}listen=true;row.classList.remove("bad");row.classList.add("listening");msg=tx("원하는 키를 누르세요 · Esc 취소","Press the key you want · Esc to cancel");paint()});
row.addEventListener("blur",()=>{if(listen)stop()});
window.addEventListener("keydown",e=>{if(!listen)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;const k=e.key.toLowerCase();
 if(k==="escape"){stop();return}
 if(RESERVED_KEYS.has(k)||!k||k===settings.skipKey){row.classList.add("bad");msg=tx(`${keyName(k)} 키는 다른 기능에 쓰여서 지정할 수 없어요`,`${keyName(k)} is used by another function and can't be assigned`);paint();clearTimeout(badT);badT=setTimeout(()=>{row.classList.remove("bad")},900);return}
 settings.titleKey=k;saveSettings();stop(tx(`${keyName(k)} 키로 저장했어요`,`Saved as ${keyName(k)}`))},true);
// 인게임에서 누르면 타이틀로 (진행 중이면 확인 창)
window.addEventListener("keydown",e=>{if(listen||listening||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key.toLowerCase()===settings.titleKey&&inPlay()&&ui.level.classList.contains("hidden")){e.preventDefault();if(top)top.click();else showTitle()}});
paint();return{relang(){if(!listen){msg="";paint()}},get listening(){return listen}}})();
const _applyLangT=applyLang;applyLang=function(){_applyLangT.apply(this,arguments);titleKeyUI.relang()};

/* ================= 타이틀 로고: 심플한 픽셀 글자 (주 제목 PIXEL SURVIVAL / 부제 최후의 불씨) ================= */
const LOGO_MAIN="PIXEL SURVIVAL";
const logo=(()=>{
const cv=$("logoCanvas");if(!cv)return{draw(){},ignite(){},relang(){}};
const LW=cv.width,LH=cv.height,g=cv.getContext("2d");g.imageSmoothingEnabled=false;
const st=document.createElement("style");st.textContent="#logoCanvas{display:block;margin:0 auto;height:auto;width:min(94%,calc(clamp(84px,22vh,150px)*3.6));image-rendering:pixelated}.logo .logo-sub{display:none}.logo-main{animation:none!important;text-shadow:none!important}";document.head.appendChild(st);
const fam=()=>'"DotGothic16","Galmuri11",monospace';let key="";
// 글자를 그린 뒤 알파값을 0/1로 잘라서 계단 픽셀만 남긴다 (번짐·발광 없음)
function mask(txt,px,base){const c=document.createElement("canvas");c.width=LW;c.height=LH;const x=c.getContext("2d");x.font=(settings.pixelFont?"":"bold ")+px+"px "+fam();x.textAlign="center";x.textBaseline="alphabetic";x.fillStyle="#fff";x.fillText(txt,LW/2,base);
 const d=x.getImageData(0,0,LW,LH).data,m=new Uint8Array(LW*LH);for(let i=0;i<m.length;i++)m[i]=d[i*4+3]>110?1:0;return m}
function bounds(m){let t=LH,b=0;for(let y=0;y<LH;y++)for(let x=0;x<LW;x++)if(m[y*LW+x]){if(y<t)t=y;if(y>b)b=y}return[t,b]}
function paint(){const k=fam()+settings.lang+(document.fonts&&document.fonts.check('20px "DotGothic16"')?1:0)+(document.fonts&&document.fonts.check('11px "Galmuri11"','가')?1:0);if(k===key)return;key=k;
 const M=mask(LOGO_MAIN,30,40),S=mask(gameTitle(),17,69),img=g.createImageData(LW,LH),d=img.data;
 const [mt,mb]=bounds(M),cut=mt+Math.round((mb-mt)*.58);
 const set=(i,c)=>{d[i*4]=c[0];d[i*4+1]=c[1];d[i*4+2]=c[2];d[i*4+3]=255};
 const at=(m,x,y)=>x>=0&&y>=0&&x<LW&&y<LH&&m[y*LW+x];
 const near=(m,x,y,r)=>{for(let oy=-r;oy<=r;oy++)for(let ox=-r;ox<=r;ox++)if(at(m,x+ox,y+oy))return true;return false};
 for(let y=0;y<LH;y++)for(let x=0;x<LW;x++){const i=y*LW+x;
  if(M[i])set(i,y<cut?[255,236,184]:[255,176,74]);            // 주 제목: 위 크림색 / 아래 주황 2단
  else if(S[i])set(i,[255,150,70]);                           // 부제: 주황 한 색
  else if(near(M,x,y,2)||near(S,x,y,1))set(i,[38,14,8]);      // 진한 갈색 테두리
  else if(at(M,x-3,y-3)||at(S,x-2,y-2))set(i,[0,0,0]);         // 오른쪽 아래 픽셀 그림자
 }
 // 부제 양옆의 작은 픽셀 장식 (불씨 모양 마름모 + 선)
 const [st0,sb0]=bounds(S);let sl=LW,sr=0;for(let y=st0;y<=sb0;y++)for(let x=0;x<LW;x++)if(S[y*LW+x]){if(x<sl)sl=x;if(x>sr)sr=x}
 const cy=Math.round((st0+sb0)/2),gem=(cx)=>{[[0,-2],[-1,-1],[0,-1],[1,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-1,1],[0,1],[1,1],[0,2]].forEach(([ox,oy])=>{const x=cx+ox,y=cy+oy;if(x>=0&&x<LW)set(y*LW+x,Math.abs(ox)+Math.abs(oy)<2?[255,224,138]:[217,64,42])})};
 if(sr>sl){for(let x=sl-34;x<sl-10;x+=2)if(x>=0)set(cy*LW+x,[140,60,36]);for(let x=sr+11;x<sr+35;x+=2)if(x<LW)set(cy*LW+x,[140,60,36]);gem(sl-7);gem(sr+7)}
 g.clearRect(0,0,LW,LH);g.putImageData(img,0,0);cv.setAttribute("aria-label",LOGO_MAIN+" — "+gameTitle())}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{key=""});
return{draw(){paint()},ignite(){key=""},relang(){key=""}}})();
/* ================= 픽셀 폰트 (설정에서 ON/OFF) ================= */
/* 한글 픽셀 폰트: DotGothic16에는 한글이 없어서 갈무리11(Galmuri, OFL 라이선스)로 한글을 채워요 */
const GALMURI_URL="https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/";
(()=>{const ff=document.createElement("style");ff.textContent='@font-face{font-family:"Galmuri11";src:url("'+GALMURI_URL+'Galmuri11.woff2") format("woff2"),url("'+GALMURI_URL+'Galmuri11.ttf") format("truetype");font-weight:400;font-display:swap}@font-face{font-family:"Galmuri11";src:url("'+GALMURI_URL+'Galmuri11-Bold.woff2") format("woff2");font-weight:700;font-display:swap}';document.head.appendChild(ff)})();
(()=>{const st=document.createElement("style");st.textContent='body.pixel-font,body.pixel-font *{font-family:"DotGothic16","Galmuri11",monospace!important;-webkit-font-smoothing:none;font-smooth:never;text-rendering:optimizeSpeed}body.pixel-font :is(h1,h2,h3,b,strong,button){font-weight:400!important}body:not(.pixel-font),body:not(.pixel-font) *{font-family:"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif!important}';document.head.appendChild(st);
const d=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,"font");
Object.defineProperty(ctx,"font",{configurable:true,get(){return d.get.call(this)},set(v){d.set.call(this,settings.pixelFont?String(v).replace(/bold\s*/,"").replace(/(monospace|sans-serif)\s*$/,'"DotGothic16","Galmuri11",$1'):String(v).replace(/(monospace|sans-serif)\s*$/,'"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif'))}});
if(document.fonts&&document.fonts.load){document.fonts.load('16px "DotGothic16"','PIXEL');try{const pr=document.fonts.load('11px "Galmuri11"','최후의 불씨');if(pr&&typeof pr.then==="function")pr.then(()=>logo.relang(),()=>{})}catch(_){}}})();
function applyFont(){document.body.classList.toggle("pixel-font",!!settings.pixelFont)}
{const r=document.querySelector('[data-i18n="rowFont"]');if(r){const k='<strong>픽셀 폰트</strong><small>켜면 도트 글꼴, 끄면 매끈한 일반 글꼴로 읽기 편해져요 (로고는 그대로)</small>';r.dataset.ko=k;if(!isEN())r.innerHTML=k}}
/* ================= INTRO CINEMATIC · 스토리 인트로 ================= */
/* ================= 캐릭터별 엔딩 =================
   name: 도감에 표시되는 엔딩 이름 · t/d: 엔딩 창 제목/본문 · s: 엔딩 컷 자막 3장 [한국어, 영어] (이그니는 아래 EC 장면을 그대로 써요) */
const CHAR_END={
 ignis:{name:"불씨의 둥지",nameEn:"The Ember Nest",t:"이그니는 둥지로 돌아왔다",te:"Ignis made it home",d:"식음의 그림자가 사라지자, 흩어졌던 불씨들이 둥지로 가는 길을 밝혀 주었습니다. 어미 불꽃이 다시 활활 타오릅니다.",de:"As the Chilling Shadow faded, the scattered embers lit the way back to the nest. The Mother Flame blazes once more."},
 zhuque:{th:"burnt",name:"재에서 돋은 새싹",nameEn:"Sprouts from the Ash",t:"불타버린 땅에 새싹이 돋다",te:"Sprouts Rise from the Burnt Land",d:"주작의 불씨 깃털이 내려앉은 곳마다 새싹이 돋았습니다. 불길이 휩쓸고 간 남쪽 땅이 다시 푸르게 숨 쉽니다.",de:"Wherever Zhuque's ember feathers fell, sprouts appeared. The fire-swept south breathes green once more.",
  s:[["식음의 그림자가 흩어지자,\n주작은 불타버린 남쪽 땅을 떠올렸습니다.","As the Chilling Shadow faded,\nZhuque remembered the burnt lands of the south."],["주작이 불씨를 깃털에 실어 흩뿌리자,\n잿빛 대지에 작은 새싹이 돋아났어요.","Zhuque scattered the embers on its feathers,\nand tiny sprouts rose from the gray earth."],["남쪽 하늘의 불새는 오늘도\n새 생명을 품은 불꽃을 지킨답니다.","To this day, the firebird of the south\nguards the flame that breeds new life."]]},
 hyunmu:{th:"frozen",name:"다시 숨 쉬는 북해",nameEn:"The Sea Breathes Again",t:"북해가 다시 숨 쉬다",te:"The Northern Sea Breathes Again",d:"현무가 품은 불씨에 얼음이 녹아내렸습니다. 다시 흐르는 바다 위로 이글루의 불빛이 따스하게 번집니다.",de:"The ice melted around the embers Hyunmu carried. Over the flowing sea, the igloo's light glows warm.",
  s:[["식음의 그림자가 흩어지자,\n현무는 얼어붙은 북쪽 바다로 향했습니다.","As the Chilling Shadow faded,\nHyunmu set out for the frozen northern sea."],["현무가 불씨를 품고 바다에 들자,\n두꺼운 얼음이 녹으며 물결이 일렁였어요.","Hyunmu carried the embers into the sea,\nand the thick ice melted into rippling waves."],["다시 숨 쉬는 북해 곁에서,\n현무는 오래도록 이글루의 불빛을 지켰답니다.","Beside the breathing northern sea,\nHyunmu long guarded the igloo's light."]]},
 baekho:{th:"canyon",name:"바람이 나른 온기",nameEn:"Warmth on the Wind",t:"바람이 불씨를 나르다",te:"The Wind Carries the Embers",d:"백호의 바람을 타고 불씨가 협곡 곳곳으로 퍼졌습니다. 은빛 억새 사이로 따뜻한 빛이 반짝입니다.",de:"Riding Baekho's wind, the embers spread throughout the canyon. Warm light glimmers among the silver grass.",
  s:[["식음의 그림자가 흩어지자,\n백호는 은빛 억새가 흔들리는 서쪽 협곡을 바라보았습니다.","As the Chilling Shadow faded,\nBaekho gazed toward the western canyon of silver grass."],["백호가 크게 포효하자 바람이 불씨를 실어 날라,\n협곡 구석구석에 온기가 번졌어요.","Baekho let out a mighty roar, and the wind\ncarried the embers to every corner of the canyon."],["은빛 억새가 바람에 노래하는 밤,\n서쪽의 수호자는 오늘도 협곡을 지킨답니다.","On nights when the silver grass sings in the wind,\nthe guardian of the west still watches the canyon."]]},
 cheongryong:{th:"blossom",name:"봄비 속의 벚꽃",nameEn:"Blossoms in the Rain",t:"봄비에 벚꽃이 피다",te:"Blossoms Bloom in the Spring Rain",d:"청룡이 부른 봄비가 계곡을 적시자, 벚꽃이 다시 흐드러지게 피었습니다. 동쪽에 봄이 돌아왔습니다.",de:"As Cheongryong's spring rain soaked the valley, the cherry blossoms burst into bloom. Spring has returned to the east.",
  s:[["식음의 그림자가 흩어지자,\n청룡은 봄을 잃은 동쪽 계곡으로 날아올랐습니다.","As the Chilling Shadow faded,\nCheongryong flew to the eastern valley that had lost its spring."],["청룡이 불씨를 머금은 봄비를 내리자,\n시들었던 벚꽃이 다시 피어났어요.","Cheongryong called down a spring rain laced with embers,\nand the wilted blossoms bloomed again."],["해마다 봄비가 내리면, 동쪽 계곡에는\n불씨처럼 따뜻한 꽃이 핀답니다.","Each year when the spring rain falls,\nflowers as warm as embers bloom in the eastern valley."]]},
 hwangryong:{th:"palace",name:"황금 기둥",nameEn:"The Golden Pillar",t:"오방에 질서가 돌아오다",te:"Order Returns to the Five Directions",d:"다섯 불씨가 황금 기둥이 되어 하늘을 떠받쳤습니다. 동서남북과 중앙, 세상의 균형이 다시 맞춰졌습니다.",de:"The five embers became a golden pillar holding up the sky. East, west, south, north and center are in balance again.",
  s:[["식음의 그림자가 흩어지자,\n황룡은 세상의 중심, 오방천궁으로 돌아왔습니다.","As the Chilling Shadow faded,\nHwangryong returned to the palace at the center of the world."],["황룡이 다섯 방위의 불씨를 한데 모으자,\n오방천궁에 황금빛 기둥이 솟아올랐어요.","Hwangryong gathered the embers of all five directions,\nand a golden pillar rose over the palace."],["사신과 영수를 이끄는 중앙의 왕은\n오늘도 세상의 균형을 지킨답니다.","The king at the center, leader of guardians and spirit beasts,\nstill keeps the world in balance."]]},
 qilin:{th:"cloud",name:"하늘의 축복",nameEn:"Heaven's Blessing",t:"하늘의 축복이 내리다",te:"Heaven's Blessing Descends",d:"기린이 전한 천명에 따라 상서로운 빛이 온 세상에 내려앉았습니다. 구름 성소의 초원에 꽃이 만발합니다.",de:"By the mandate the Qilin delivered, an auspicious light settled over the world. Flowers fill the meadow of the cloud sanctuary.",
  s:[["식음의 그림자가 흩어지자,\n기린은 구름 위 성소를 올려다보았습니다.","As the Chilling Shadow faded,\nthe Qilin looked up toward the sanctuary above the clouds."],["기린이 하늘의 뜻을 전하자,\n상서로운 빛이 내려와 초원에 꽃을 피웠어요.","The Qilin delivered Heaven's mandate,\nand an auspicious light bloomed flowers across the meadow."],["어진 이에게만 모습을 보인다는 기린은\n오늘도 구름 성소에서 세상을 굽어본답니다.","The Qilin, who appears only to the kind-hearted,\nstill watches over the world from the cloud sanctuary."]]}};
const END_ORDER=["ignis","zhuque","hyunmu","baekho","cheongryong","hwangryong","qilin"];
const intro=(()=>{
const cv=document.createElement("canvas");cv.width=TW;cv.height=TH;
const g=cv.getContext("2d");g.imageSmoothingEnabled=false;
const css=document.createElement("style");
css.textContent=`#introRoot{position:absolute;inset:0;z-index:70;background:#02050a;overflow:hidden;opacity:1;transition:opacity .35s;font-family:"DotGothic16","Galmuri11",monospace}
#introRoot.out{opacity:0}body:not(.pixel-font) #introRoot{font-family:system-ui,sans-serif}#introRoot canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated}
#introRoot .bar{position:absolute;left:0;right:0;height:15%;background:#000;z-index:2;transition:transform 1.2s ease}
#introRoot .bar.t{top:0;transform:translateY(-100%)}#introRoot .bar.b{bottom:0;transform:translateY(100%)}#introRoot.on .bar{transform:none}
#introSub{position:absolute;left:5%;right:5%;bottom:0;height:15%;z-index:3;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-line;word-break:keep-all;color:#fff4d8;line-height:1.35;text-shadow:2px 0 #1a0a06,-2px 0 #1a0a06,0 2px #1a0a06,0 -2px #1a0a06;transition:opacity .35s}
#introSkip{position:absolute;top:2.4%;right:2%;z-index:5;min-height:40px;padding:0 16px;font:inherit;font-size:15px;letter-spacing:.06em;color:#ffe9b8;background:rgba(10,6,4,.7);border:2px solid #ffb04a;border-radius:0;cursor:pointer;box-shadow:3px 3px 0 #000}
#introSkip:hover,#introSkip:focus-visible{background:#ffb04a;color:#2a0e08;outline:none}`;
document.head.appendChild(css);
const fnt=()=>settings.pixelFont?'"DotGothic16","Galmuri11",monospace':'"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const mixc=(a,b,t)=>{const p=s=>[1,3,5].map(i=>parseInt(s.substr(i,2),16)),A=p(a),B=p(b);return`rgb(${A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join()})`};
const ease=u=>1-(1-clamp(u,0,1))**3,sky=(c1,c2)=>{for(let y=0;y<TH;y+=2){g.fillStyle=mixc(c1,c2,y/TH);g.fillRect(0,y,TW,2)}};
const ell=(cx,cy,rx,ry,c)=>{g.fillStyle=c;for(let y=-ry;y<=ry;y+=2){const w=Math.floor(Math.sqrt(1-(y/ry)**2)*rx/2)*2;g.fillRect(cx-w,cy+y,w*2,2)}};
const glow=(k,x,y,s,a)=>{g.save();g.globalCompositeOperation="lighter";g.globalAlpha=a;g.drawImage(GL[k],x-s/2,y-s/2,s,s);g.restore()};
const spr=(im,x,y,s,flip)=>{g.save();g.translate(Math.round(x),Math.round(y));g.scale(flip?-s:s,s);g.drawImage(im,-im.width/2,-im.height);g.restore()};
const dragon=(x,y,s,t,mv,closed,a=1)=>{g.save();g.globalAlpha=a;g.translate(Math.round(x),Math.round(y));g.scale(s,s);dragonTail(g,t,mv);g.drawImage((mv&&Math.floor(t*8)%2?SP.dragonB:SP.dragonA).n,-16,-24);dragonBlink(g,closed?0:t);g.restore()};
const mkForest=(seed,base,h0,h1,col)=>{const k=document.createElement("canvas");k.width=TW;k.height=TH;const c=k.getContext("2d"),R=rng(seed);c.fillStyle=col;c.fillRect(0,base,TW,TH-base);for(let x=0;x<TW;x+=R()*10+8){const h=h0+R()*(h1-h0);for(let r=0;r<h;r+=2){const w=Math.floor(r*.3);c.fillRect(Math.round(x-w),Math.round(base-h+r),w*2+1,2)}}return k};
const F1=mkForest(11,176,30,60,"#07101a"),FA=mkForest(21,150,40,80,"#0b1a22"),FB=mkForest(22,178,30,60,"#07120f"),FC=mkForest(23,205,34,64,"#030806");
const scroll=(k,t,sp,y=0)=>{const o=-((t*sp)%TW);g.drawImage(k,o,y);g.drawImage(k,o+TW,y)};
const stars=(t,a)=>{for(const s of tstars){g.globalAlpha=a*(.35+.65*(.5+.5*Math.sin(t*s.s+s.p)));g.fillStyle=s.c;g.fillRect(s.x,s.y,1,1)}g.globalAlpha=1};
const flies=t=>{g.save();g.globalCompositeOperation="lighter";for(const f of tflies){const x=f.x+Math.cos(t*f.s+f.a)*f.r,y=f.y+Math.sin(t*f.s*1.3+f.a)*f.r*.6,v=Math.max(0,Math.sin(t*(1+f.s)+f.b));g.globalAlpha=v*.8;g.drawImage(GL.fly,x-6,y-6,12,12);g.globalAlpha=.4+.6*v;g.fillStyle="#ffe0a0";g.fillRect(Math.round(x),Math.round(y),1,1)}g.restore()};
const flakes=Array.from({length:60},()=>({x:rand(0,TW),y:rand(0,TH),v:rand(25,70)}));
const snow=(t,a)=>{g.fillStyle="#dff2ff";g.globalAlpha=a;for(const f of flakes)g.fillRect(Math.round((f.x+t*f.v*.7)%TW),Math.round((f.y+t*f.v)%TH),f.v>50?2:1,f.v>50?2:1);g.globalAlpha=1};
const fire=(x,y,S,t)=>{if(S<1)return;g.save();g.translate(x,y);g.scale(S,S);dragonFlame(g,0,0,26,Math.sin(t*11)*1.5,t);g.restore()};
/* 둥지 + 불씨 + 잠든 이그니 (장면 2·3·4에서 공유) */
function hearth(t,fl,fr,foe,aw,dw=0){
sky(hx("#050a1a","#2a1a3a",dw),hx("#18122c","#ff9a5a",dw));stars(t,.7*(1-dw));g.drawImage(F1,0,0);g.fillStyle="#0a0f10";g.fillRect(0,198,TW,TH);
ell(192,206,92,16,"#2a170f");ell(192,202,80,12,"#4a2c1a");ell(192,200,62,8,"#1c0e08");
const S=fl>0?Math.max(1,Math.ceil(fl*3)):0,fy=200-(S?0:0);
glow("warm",192,166,(60+fl*190),.35+.5*fl);if(!S)glow("cyan",192,196,40,.25+.1*Math.sin(t*3));
const sh=fr>.25?Math.round(Math.sin(t*45)):0;dragon(112+sh,182+Math.sin(t*2)*.8,2,t,false,!aw);
if(!fr&&!aw){g.font=`10px ${fnt()}`;g.fillStyle="#cfe8ff";for(let i=0;i<3;i++){const p=(t*.35+i/3)%1;g.globalAlpha=1-p;g.fillText("z",128+p*24+i*4,150-p*34)}g.globalAlpha=1}
fire(192,200,S,t);flies(t);if(dw){g.fillStyle=`rgba(255,150,80,${dw*.14})`;g.fillRect(0,0,TW,TH);glow("warm",192,176,440,.5*dw)}
if(foe){const q=ease((t-.5)/3.4),FO=[[SP.blob.n,-30,50,198,0],[SP.bat.n,420,300,96,1],[SP.stump.n,430,338,214,1]];
FO.forEach(([im,x0,x1,y,fl2],i)=>{const k=clamp(q*1.1-i*.05,0,1),x=x0+(x1-x0)*k,yy=y+(fl2&&i==1?Math.sin(t*5)*8:0);spr(im,x,yy,2,x0>0)})}
if(fr){g.globalAlpha=fr*.4;const o=(t*40)%TW;g.drawImage(fogTex,o-TW,150);g.drawImage(fogTex,o,150);g.drawImage(fogTex,-o,186);g.drawImage(fogTex,TW-o,186);g.globalAlpha=1;g.fillStyle=`rgba(110,170,255,${fr*.2})`;g.fillRect(0,0,TW,TH);snow(t,fr)}}
const SPK=Array.from({length:48},(_,i)=>({a:rand(0,6.283),v:rand(70,280),c:["#ffd54a","#ff8a2a","#fff0b0","#ff6a3a"][i%4],s:i%3?1:2}));
const pals=["#ffd54a","#ff8a2a","#fff0b0"];
/* ---- 장면 목록: d 길이(초) / fi·fo 페이드 / tx 자막 / f 그리기 ---- */
const SC=[
{d:4.6,fi:.9,fo:.5,te:"Long ago, deep in the Ashen Woods,\nlay a nest of undying embers.",tx:"아주 오래전, 재의 숲 한가운데에는\n꺼지지 않는 불씨의 둥지가 있었습니다.",f(t){
 const sx=Math.round(150+Math.min(t/4.6,1)*42),sy=70;g.save();g.scale(2,2);g.translate(-sx,-sy);g.drawImage(titleScene.bg,0,0);
 stars(t,.8);g.globalAlpha=.12;g.drawImage(fogTex,(t*5)%TW-TW,146);g.drawImage(fogTex,(t*5)%TW,146);g.globalAlpha=1;
 const fl=.75+.1*Math.sin(t*9)+.05*Math.sin(t*23);glow("warm",318,149,90,fl*.8);glow("warm",318,98,90,fl*.6);flies(t);g.restore()}},
{d:5,fi:.5,fo:0,te:"Its embers kept the whole forest warm,\nand baby dragon Ignis slept beside them.",tx:"그 불씨는 숲의 모든 생명을 따뜻하게 지켜 주었고,\n갓 태어난 아기 용 “이그니”는 그 곁에서 잠들어 있었죠.",f(t){hearth(t,1,0,false)}},
{d:5,fi:0,fo:.1,te:"One night, a frost wind swept in,\nand frost creatures overran the woods.",tx:"그러던 어느 밤, 서리 바람이 불어닥쳤습니다.\n재 덩이와 서리 박쥐, 서리 바위가 숲을 뒤덮었죠.",f(t){hearth(t,Math.max(0,1-t/4.3),ease(t/2.2),true)}},
{d:4.2,fi:0,fo:.5,te:"The embers shattered\nand scattered across the forest.",tx:"불씨는 산산이 부서져\n숲 곳곳으로 흩어지고 말았습니다.",f(t){
 hearth(t+9,0,1,false);const u=Math.max(0,t-.05);g.save();g.globalCompositeOperation="lighter";
 for(const s of SPK)for(let k=0;k<4;k++){const w=Math.max(0,u-k*.05),r=s.v*(1-Math.exp(-w*1.5))*1.5,x=192+Math.cos(s.a)*r,y=170+Math.sin(s.a)*r*.8+w*w*16;
  g.globalAlpha=Math.max(0,1-u/3.6)*(1-k*.25);g.drawImage(GL.fly,x-6*s.s,y-6*s.s,12*s.s,12*s.s);if(!k){g.fillStyle=s.c;g.fillRect(Math.round(x),Math.round(y),s.s+1,s.s+1)}}
 g.restore();g.globalAlpha=Math.max(0,1-t/.5);g.fillStyle="#fff";g.fillRect(0,0,TW,TH);g.globalAlpha=1}},
{d:5,fi:.6,fo:.5,te:"Ignis woke up alone, with only\na tiny flame left on his tail.",tx:"홀로 깨어난 이그니의 꼬리 끝에는\n작은 불꽃만이 남아 있었어요.",f(t){
 g.fillStyle="#02040a";g.fillRect(0,0,TW,TH);const o=ease((t-.3)/1.4),da=ease((t-1.8)/1.4);
 if(da<1){for(const sx of[-28,28]){const h=Math.round(o*10/2)*2;if(h>0){glow("fly",192+sx,92,40,.6*o*(1-da));g.fillStyle="#ff8a2a";g.fillRect(192+sx-5,92-h/2,10,h);g.fillStyle="#ffe08a";g.fillRect(192+sx-1,92-h/2+2,3,Math.max(0,h-4))}}}
 glow("warm",96,136,150,.35*da+.12*Math.sin(t*9));dragon(192,120,4,t,false,false,da);snow(t,.35)}},
{d:5,fi:.6,fo:.5,te:"“I must gather the scattered embers\nand find my way back to the nest.”",tx:"“흩어진 불씨 조각을 모아,\n둥지로 돌아가야 해.”",f(t){
 sky("#06101e","#1a2a3a");stars(t,.8);scroll(FA,t,6);scroll(FB,t,16);g.fillStyle="#050b09";g.fillRect(0,205,TW,TH);
 glow("big",376,170,120,.45+.1*Math.sin(t*3));
 for(let i=0;i<6;i++){const v=.5+.5*Math.sin(t*2.4-i*.9);glow("fly",250+i*24,176-i*3+Math.sin(t+i)*3,22,.3+.7*v);g.fillStyle="#ffe0a0";g.fillRect(Math.round(250+i*24),Math.round(176-i*3+Math.sin(t+i)*3),2,2)}
 scroll(FC,t,34);dragon(120,181-Math.abs(Math.sin(t*8))*2,2,t,true,false);flies(t)}},
{d:4,fi:.3,fo:.9,tx:"",f(t){
 sky("#0a0a1a","#2a1410");stars(t,.6);scroll(FA,0,0);g.drawImage(FB,0,0);g.drawImage(FC,0,0);
 const p=ease(t/.35),k=1+(1-p)*1.2,sh=t<.6?Math.round(Math.sin(t*90)*3*(1-t/.6)):0;glow("big",192,100,300,.5*p+.1*Math.sin(t*6));
 for(let i=0;i<14;i++){const ph=(t*.5+i/14)%1;g.globalAlpha=1-ph;g.fillStyle=pals[i%3];g.fillRect(Math.round(80+i*17+Math.sin(t*2+i)*5),Math.round(210-ph*150),2,2)}g.globalAlpha=1;
 g.textAlign="center";g.textBaseline="middle";g.save();g.translate(192+sh,100);g.scale(k,k);g.globalAlpha=p;g.font=`30px ${fnt()}`;g.lineJoin="round";g.lineWidth=6;g.strokeStyle="#2a0e08";g.strokeText(gameTitle(),0,0);
 g.shadowColor="rgba(255,120,40,.95)";g.shadowBlur=14;g.fillStyle="#c0301a";g.fillText(gameTitle(),0,2);g.shadowBlur=0;g.fillStyle="#ffb04a";g.fillText(gameTitle(),0,0);g.restore();
 g.globalAlpha=ease((t-1)/.8);g.font=`10px ${fnt()}`;g.fillStyle="#ffe9b8";g.fillText("P I X E L   S U R V I V O R S",192,128);g.globalAlpha=1;g.textAlign="left";g.textBaseline="alphabetic";
 g.globalAlpha=Math.max(0,1-t/.5)*.9;g.fillStyle="#fff";g.fillRect(0,0,TW,TH);g.globalAlpha=1}}
];
const hx=(a,b,t)=>"#"+[1,3,5].map(i=>{const p=parseInt(a.substr(i,2),16),q=parseInt(b.substr(i,2),16);return Math.round(p+(q-p)*t).toString(16).padStart(2,"0")}).join("");
const night=t=>{sky("#050a1a","#18122c");stars(t,.7);g.drawImage(F1,0,0);g.fillStyle="#0a0f10";g.fillRect(0,198,TW,TH)};
const boom=(cx,cy,u,life)=>{g.save();g.globalCompositeOperation="lighter";for(const s of SPK)for(let k=0;k<3;k++){const w=Math.max(0,u-k*.05),r=s.v*(1-Math.exp(-w*1.5)),x=cx+Math.cos(s.a)*r,y=cy+Math.sin(s.a)*r*.8-w*10;g.globalAlpha=Math.max(0,1-u/life)*(1-k*.3);g.drawImage(GL.fly,x-6*s.s,y-6*s.s,12*s.s,12*s.s);if(!k){g.fillStyle=s.c;g.fillRect(Math.round(x),Math.round(y),s.s+1,s.s+1)}}g.restore()};
const rise=(t,n,a)=>{for(let i=0;i<n;i++){const ph=(t*.35+i/n)%1;g.globalAlpha=(1-ph)*a;g.fillStyle=pals[i%3];g.fillRect(Math.round(60+i*(260/n)+Math.sin(t*2+i)*6),Math.round(200-ph*170),2,2)}g.globalAlpha=1};
const CV=Array.from({length:42},(_,i)=>({a:rand(0,6.283),d:i*.04,c:pals[i%3]}));
const hash=(x,y)=>((x*73856093^y*19349663)>>>0)%1000/1000;
/* ---- 엔딩 장면 목록 ---- */
const EC=[
{d:4.8,fi:.6,fo:.4,te:"As the Chilling Shadow faded,\nthe frost over the woods slowly melted.",tx:"식음의 그림자가 흩어지자,\n숲을 뒤덮던 서리가 천천히 녹아내렸습니다.",f(t){
 night(t);const u=clamp((t-.5)/2.8,0,1),im=SP.shadowDragon.n,s=3,B=4,x0=Math.round(260-im.width*s/2),y0=200-im.height*s;
 for(let by=0;by<im.height;by+=B)for(let bx=0;bx<im.width;bx+=B){const r=hash(bx,by);
  if(r>u){g.drawImage(im,bx,by,B,B,x0+bx*s+(u>0?Math.round(Math.sin(t*30+bx)):0),y0+by*s,B*s,B*s)}
  else{const k=(u-r)*2.2;if(k<1){g.globalAlpha=1-k;g.drawImage(im,bx,by,B,B,Math.round(x0+bx*s+Math.sin(bx+by)*k*24),Math.round(y0+by*s-k*80),B*s,B*s);g.globalAlpha=1}}}
 dragon(90,182,2,t,false,false);g.fillStyle=`rgba(110,170,255,${.2*(1-u)})`;g.fillRect(0,0,TW,TH);snow(t,.7*(1-u));rise(t,18,u)}},
{d:5,fi:.4,fo:.4,te:"The embers Ignis gathered flowed to his tail,\nand his little flame blazed once more.",tx:"이그니가 모은 불씨 조각들이 꼬리 끝으로 모여들었고,\n작은 불꽃은 다시 힘차게 타올랐어요.",f(t){
 night(t);let n=0;for(const c of CV)if(t-.3-c.d>1.7)n++;
 glow("warm",126,170,140+n*5,.3+n*.015);dragon(192,168,3,t,false,false);fire(126,178,n>34?3:n>16?2:1,t);
 g.save();g.globalCompositeOperation="lighter";for(const c of CV){const q=clamp((t-.3-c.d)/1.7,0,1);if(q>0&&q<1){const r=300*(1-q*q),x=126+Math.cos(c.a)*r,y=172+Math.sin(c.a)*r*.7;g.globalAlpha=.9;g.drawImage(GL.fly,x-8,y-8,16,16);g.fillStyle=c.c;g.fillRect(Math.round(x),Math.round(y),2,2)}}g.restore();flies(t)}},
{d:4.6,fi:.4,fo:.4,te:"Following the path the embers lit,\nIgnis finally made it home.",tx:"불씨가 밝혀 준 길을 따라,\n이그니는 마침내 둥지로 돌아왔습니다.",f(t){
 const p=ease(t/4.2);sky("#0a1224","#2a2236");stars(t,.7);scroll(FA,t,8);scroll(FB,t,18);g.fillStyle="#050b09";g.fillRect(0,205,TW,TH);
 ell(332,208,52,10,"#2a170f");ell(332,205,44,8,"#4a2c1a");ell(332,203,32,5,"#1c0e08");glow("cyan",332,200,40,.2+.1*Math.sin(t*3));
 scroll(FC,t,34);const x=50+p*180;dragon(x,181-Math.abs(Math.sin(t*8))*2,2,t,true,false);
 for(let i=0;i<6;i++){const a=t*2+i*1.05,sx=x+Math.cos(a)*28,sy=150+Math.sin(a)*10;glow("fly",sx,sy,20,.7);g.fillStyle="#ffe0a0";g.fillRect(Math.round(sx),Math.round(sy),2,2)}
 snow(t,.25);flies(t)}},
{d:5.4,fi:.4,fo:0,te:"He gave his flame to the cold nest,\nand the Mother Flame roared back to life.",tx:"꺼져 있던 둥지에 불꽃을 건네자,\n어미 불꽃이 활활 되살아났습니다.",f(t){
 hearth(t,ease((t-1.1)/2.2),0,false,true);
 if(t<1.1){const q=t/1.1,x=70+q*122,y=180+q*16-Math.sin(q*3.14)*34;glow("fly",x,y,22,.9);g.fillStyle="#fff0b0";g.fillRect(Math.round(x),Math.round(y),2,2)}
 else{const u=t-1.1;boom(192,190,u,2.6);const r=u*170;g.save();g.globalCompositeOperation="lighter";g.globalAlpha=Math.max(0,1-u/1.2)*.7;g.strokeStyle="#ffcf6a";g.lineWidth=3;g.beginPath();g.ellipse(192,196,r,r*.35,0,0,6.283);g.stroke();g.restore()}}},
{d:4.6,fi:0,fo:0,te:"A warm dawn returned to the forest,\nand the embers never died again.",tx:"숲에 다시 따뜻한 새벽이 찾아왔고,\n불씨는 더 이상 꺼지지 않았습니다.",f(t){hearth(t,1,0,false,true,ease(t/4.4));rise(t,20,.8)}},
{d:5.2,fi:0,fo:1.1,te:"Ignis's embers kept the forest\nwarm for a long, long time.",tx:"이그니의 불씨는 오래도록\n숲을 따뜻하게 밝혀 주었답니다.",f(t){
 hearth(t,1,0,false,true,1);rise(t,22,.8);const a=ease((t-.5)/1.2);
 g.save();g.globalAlpha=a;g.textAlign="center";g.textBaseline="middle";g.font=`26px ${fnt()}`;g.lineJoin="round";g.lineWidth=6;g.strokeStyle="#2a0e08";const y=52-(1-a)*10;
 g.strokeText("THE END",192,y);g.shadowColor="rgba(255,120,40,.95)";g.shadowBlur=12;g.fillStyle="#c0301a";g.fillText("THE END",192,y+2);g.shadowBlur=0;g.fillStyle="#ffb04a";g.fillText("THE END",192,y);g.restore()}}
];

/* ---- 캐릭터별 엔딩 컷: 그림자 소멸 → 불씨를 돌려놓기 → THE END ---- */
const LM=[317,158]; // 각 맵 풍경에서 집·궁·성소가 있는 자리
function hero(id,x,y,s,t,mv,a=1){g.save();g.globalAlpha=a;g.translate(Math.round(x),Math.round(y-14*s));g.scale(s,s);
 try{if(id==="zhuque"){drawWings(g,t,mv);g.drawImage(SP.zhuqueA.n,-16,-24)}
 else if(id==="hyunmu"){shellBack(g);snakeBack(g,t,mv);g.drawImage(SP.hyunmuA.n,-16,-24);snakeFront(g,t,mv)}
 else if(id==="baekho"){baekhoTail(g,t,mv);g.drawImage(SP.baekhoA.n,-16,-24)}
 else if(id==="cheongryong"){cheongTail(g,t,mv);g.drawImage(SP.cheongA.n,-16,-24);cheongExtras(g,t,mv,null)}
 else if(id==="hwangryong"){hwangTail(g,t,mv);g.drawImage(SP.hwangA.n,-16,-24);hwangExtras(g,t,mv,null)}
 else if(id==="qilin"){qilinTail(g,t,mv);g.drawImage(SP.qilinA.n,-16,-24);qilinExtras(g,t,mv,null)}}catch(_){}
 g.restore();g.globalAlpha=1}
function mapBG(th,dark,warm){const sc=sceneOf(th);g.drawImage(sc.bg,0,0);if(sc.mid)g.drawImage(sc.mid,0,0);g.drawImage(sc.fg,0,0);
 if(dark>0){g.fillStyle=`rgba(8,14,40,${dark*.62})`;g.fillRect(0,0,TW,TH)}
 if(warm>0){g.save();g.globalCompositeOperation="lighter";g.fillStyle=`rgba(255,150,70,${warm*.08})`;g.fillRect(0,0,TW,TH);g.restore()}}
const R01=i=>((i*9301+49297)%233280)/233280;
function endFx(id,t,k){if(k<=0)return;g.save();
 if(id==="zhuque"){for(let i=0;i<18;i++){const x=(R01(i)*TW+t*14+Math.sin(t*1.5+i)*10)%TW,y=(R01(i+40)*TH+t*(22+i%4*6))%TH;g.globalAlpha=k*.9;g.fillStyle=i%3?"#ff8a3a":"#ffd54a";g.fillRect(Math.round(x),Math.round(y),2,4);g.fillStyle="#fff0b0";g.fillRect(Math.round(x),Math.round(y),1,1)}
  for(let i=0;i<16;i++){const x=Math.round(14+i*23+R01(i+7)*10),y=192+(i%3)*4,h=Math.round(k*(3+i%3*2+R01(i)*3));if(h<1)continue;g.globalAlpha=1;g.fillStyle="#2a6a2a";g.fillRect(x,y-h,1,h);g.fillStyle="#6ad85a";if(h>2){g.fillRect(x-2,y-h,2,1);g.fillRect(x+1,y-h-1,2,1)}if(h>5){g.fillStyle="#9aff8a";g.fillRect(x-1,y-h-2,1,1)}}}
 else if(id==="hyunmu"){g.globalCompositeOperation="lighter";for(let i=0;i<6;i++){const r=(t*26+i*22)%110;g.globalAlpha=k*(1-r/110)*.6;g.strokeStyle=i%2?"#9fe4ff":"#e8fbff";g.lineWidth=1;g.beginPath();g.ellipse(120+i*40,192+(i%2)*5,r*.6,r*.14,0,0,6.283);g.stroke()}
  for(let i=0;i<14;i++){const tw=Math.max(0,Math.sin(t*3+i*1.7));g.globalAlpha=k*tw*.8;g.fillStyle="#bfefff";g.fillRect(Math.round(20+R01(i)*340),Math.round(176+R01(i+9)*24),1,1)}}
 else if(id==="baekho"){for(let i=0;i<12;i++){const y=50+i*14+Math.sin(t*2+i)*4,x=((t*240+R01(i)*500)%(TW+140))-70;g.globalAlpha=k*.35;g.fillStyle="#ffffff";g.fillRect(Math.round(x),Math.round(y),26+i%3*8,1);g.globalAlpha=k*.9;g.fillStyle=i%2?"#ffb070":"#ffd54a";g.fillRect(Math.round(x+30+i%3*8),Math.round(y),2,2)}}
 else if(id==="cheongryong"){g.globalAlpha=k*.45;g.fillStyle="#9fd8ff";for(let i=0;i<70;i++){const x=(R01(i)*TW+t*30)%TW,y=(R01(i+70)*TH+t*260)%TH;g.fillRect(Math.round(x),Math.round(y),1,5)}
  for(let i=0;i<22;i++){const x=(R01(i+5)*TW+t*24+Math.sin(t*2+i)*8)%TW,y=(R01(i+33)*TH+t*20)%TH;g.globalAlpha=k*.9;g.fillStyle=i%2?"#ffc0dc":"#ff8ac0";g.fillRect(Math.round(x),Math.round(y),2,2)}}
 else if(id==="hwangryong"){const C=["#ff6a3a","#5ac8ff","#e8f4ff","#fff2a0","#e8b850"];g.globalCompositeOperation="lighter";
  g.globalAlpha=k*.35;g.fillStyle="#ffd54a";g.fillRect(LM[0]-6,0,12,LM[1]+20);g.globalAlpha=k*.6;g.fillRect(LM[0]-2,0,4,LM[1]+20);
  for(let i=0;i<5;i++){const a=t*1.6+i*1.2566,r=70-k*30,x=LM[0]+Math.cos(a)*r,y=LM[1]-10+Math.sin(a)*r*.4;g.globalAlpha=k;glow("fly",x,y,26,.8);g.fillStyle=C[i];g.fillRect(Math.round(x)-2,Math.round(y)-2,4,4)}}
 else if(id==="qilin"){g.globalCompositeOperation="lighter";for(let i=0;i<4;i++){const x=110+i*62,w=10+i%2*6;g.globalAlpha=k*(.1+.05*Math.sin(t*2+i));g.fillStyle="#fff6c0";g.beginPath();g.moveTo(x-w,0);g.lineTo(x+w,0);g.lineTo(x+w*2.4,TH);g.lineTo(x-w*2.4,TH);g.fill()}
  g.globalCompositeOperation="source-over";for(let i=0;i<20;i++){const x=Math.round(16+R01(i+3)*350),y=Math.round(184+R01(i+11)*16),sz=Math.round(k*(1+i%2));if(sz<1)continue;g.globalAlpha=1;g.fillStyle=["#fff6c0","#ffc8d4","#ffffff","#ffd54a"][i%4];g.fillRect(x-sz,y,sz*2+1,1);g.fillRect(x,y-sz,1,sz*2+1);g.fillStyle="#ffb43a";g.fillRect(x,y,1,1)}}
 g.restore()}
function theEnd(t,col){const a=ease((t-.5)/1.2);g.save();g.globalAlpha=a;g.textAlign="center";g.textBaseline="middle";g.font=`26px ${fnt()}`;g.lineJoin="round";g.lineWidth=6;g.strokeStyle="#140a06";const y=52-(1-a)*10;
 g.strokeText("THE END",192,y);g.shadowColor=col;g.shadowBlur=12;g.fillStyle=col;g.fillText("THE END",192,y+2);g.shadowBlur=0;g.fillStyle="#fff4d8";g.fillText("THE END",192,y);g.restore()}
const END_COL={zhuque:"#ff6a3a",hyunmu:"#5ac8ff",baekho:"#cfe8ff",cheongryong:"#5affc8",hwangryong:"#ffd54a",qilin:"#fff0a0"};
function mkEnd(id){const E=CHAR_END[id],th=E.th,S=E.s;return[
 {d:5,fi:.6,fo:.4,tx:S[0][0],te:S[0][1],f(t){mapBG(th,1,0);const u=clamp((t-.6)/2.8,0,1),im=SP.shadowDragon.n,s=3,B=4,x0=Math.round(268-im.width*s/2),y0=200-im.height*s;
  for(let by=0;by<im.height;by+=B)for(let bx=0;bx<im.width;bx+=B){const r=hash(bx,by);
   if(r>u)g.drawImage(im,bx,by,B,B,x0+bx*s+(u>0?Math.round(Math.sin(t*30+bx)):0),y0+by*s,B*s,B*s);
   else{const k=(u-r)*2.2;if(k<1){g.globalAlpha=1-k;g.drawImage(im,bx,by,B,B,Math.round(x0+bx*s+Math.sin(bx+by)*k*24),Math.round(y0+by*s-k*80),B*s,B*s);g.globalAlpha=1}}}
  hero(id,96,198,2,t,false);g.fillStyle=`rgba(110,170,255,${.18*(1-u)})`;g.fillRect(0,0,TW,TH);snow(t,.5*(1-u));rise(t,16,u)}},
 {d:5.6,fi:.4,fo:.4,tx:S[1][0],te:S[1][1],f(t){const k=ease((t-1)/3.4),p=ease(t/2.6),x=70+p*120;mapBG(th,1-k,k);
  glow("warm",LM[0],LM[1],40+k*170,.15+.55*k);hero(id,x,198-(t<2.6?Math.abs(Math.sin(t*8))*2:0),2,t,t<2.6);
  g.save();g.globalCompositeOperation="lighter";for(let i=0;i<26;i++){const q=clamp((t-1.2-i*.07)/1.3,0,1);if(q<=0||q>=1)continue;const sx=x+8,sy=166,ex=LM[0],ey=LM[1],cx=sx+(ex-sx)*q,cy=sy+(ey-sy)*q-Math.sin(q*Math.PI)*(40+i%5*8);
   g.globalAlpha=.9;g.drawImage(GL.fly,cx-7,cy-7,14,14);g.fillStyle=pals[i%3];g.fillRect(Math.round(cx),Math.round(cy),2,2)}g.restore();
  if(t>2.6&&t<3.6)boom(LM[0],LM[1],t-2.6,1.6);endFx(id,t,k);flies(t)}},
 {d:6,fi:0,fo:1.1,tx:S[2][0],te:S[2][1],f(t){mapBG(th,0,1);glow("warm",LM[0],LM[1],210,.5);endFx(id,t+6,1);rise(t,20,.7);hero(id,192,202,3,t,false);theEnd(t,END_COL[id]||"#ffb04a")}}]}
const CE={};const endScenes=id=>id&&id!=="ignis"&&CHAR_END[id]&&CHAR_END[id].s?(CE[id]||(CE[id]=mkEnd(id))):EC;
const sum=l=>l.reduce((a,s)=>a+s.d,0);
let list=SC,TOTAL=sum(SC),root=null,sub=null,raf=0,t0=0,last=0,t=0,done=null,shown="",tStart=0;
function fit(){if(root&&sub)sub.style.fontSize=Math.max(11,Math.round(root.clientWidth*.026))+"px"}
function onKey(e){if(e.repeat||performance.now()-tStart<500)return;if(e.key==="Escape"||e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();finish()}}
function frame(now){const dt=Math.min((now-last)/1000,.05);last=now;t+=dt;if(t>=TOTAL){finish();return}
 let a=0,i=0;while(i<list.length-1&&t>=a+list[i].d)a+=list[i++].d;const s=list[i],lt=t-a;
 g.globalAlpha=1;g.globalCompositeOperation="source-over";s.f(lt);g.drawImage(vig,0,0,TW,TH);
 const fa=Math.max(s.fi?1-lt/s.fi:0,s.fo?1-(s.d-lt)/s.fo:0);if(fa>0){g.globalAlpha=clamp(fa,0,1);g.fillStyle="#02050a";g.fillRect(0,0,TW,TH);g.globalAlpha=1}
 const stx=isEN()&&s.te!=null?s.te:s.tx,n=clamp(Math.floor((lt-.35)*20),0,stx.length),txt=stx.slice(0,n);if(txt!==shown){sub.textContent=txt;shown=txt}
 sub.style.opacity=s.d-lt<.4?Math.max(0,(s.d-lt)/.4):1;raf=requestAnimationFrame(frame)}
function finish(){if(!root)return;cancelAnimationFrame(raf);window.removeEventListener("keydown",onKey,true);window.removeEventListener("resize",fit);
 const r=root,cb=done;root=null;done=null;r.style.opacity="";r.classList.add("out");cb&&cb();setTimeout(()=>r.remove(),400)}
function play(cb,sc){if(root)return;list=sc||SC;TOTAL=sum(list);done=cb;stopTitle();root=document.createElement("div");root.id="introRoot";root.innerHTML='<div class="bar t"></div><div class="bar b"></div><div id="introSub" aria-live="polite"></div><button id="introSkip" type="button" aria-label="'+tx("인트로 건너뛰기","Skip intro")+'">'+tx("건너뛰기","Skip")+' ▶▶</button>';
 root.insertBefore(cv,root.firstChild);sub=root.querySelector("#introSub");(canvas.closest(".game-frame")||document.body).appendChild(root);
 root.querySelector("#introSkip").addEventListener("click",finish);if(sc){root.style.opacity=0;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(root)root.style.opacity=1}))}
 t=0;shown="";tStart=performance.now();last=tStart;window.addEventListener("keydown",onKey,true);window.addEventListener("resize",fit);fit();
 requestAnimationFrame(()=>root&&root.classList.add("on"));raf=requestAnimationFrame(frame)}
return{play,ending:(cb,id)=>play(cb,endScenes(id))}})();

/* ================= 기록 · 업적 · 도전과제 (localStorage 영구 저장) ================= */
const rec=(()=>{let lastGain=1;
const KEY="ps_save_v1",mem={};
const def=()=>({best:{time:0,kills:0,level:1,night:1,clear:0,floor:0,floorHard:0},total:{runs:0,kills:0,time:0,wins:0,winsHard:0,chests:0},bosses:{},ach:{},coins:0,coinsEarned:0,evo40:{},clearBy:{},title:"",kt:{}});
const COIN_PER_CLEAR=1; // 클리어 1회당 획득 코인
const store={get(){try{return localStorage.getItem(KEY)}catch(_){return mem[KEY]||null}},set(v){try{localStorage.setItem(KEY,v)}catch(_){mem[KEY]=v}}};
let sv=def();
try{const r=JSON.parse(store.get());if(r&&typeof r==="object"){const d=def();sv={best:{...d.best,...r.best},total:{...d.total,...r.total},bosses:{...r.bosses},ach:{...r.ach},coins:Math.max(0,r.coins|0),coinsEarned:Math.max(0,r.coinsEarned|0),evo40:{...r.evo40},clearBy:{...r.clearBy},kt:{...r.kt},title:typeof r.title==="string"?r.title:""}}}catch(_){}
let dirty=false,acc=0,toasts=[],toastT=0;
const save=()=>{if(!dirty)return;dirty=false;store.set(JSON.stringify(sv))};
const BN={witch:"혼등의 마녀",king:"재의 왕",lord:"서리 박쥐 군주",guardian:"얼음 바위 수호자",owl:"그믐달 올빼미",warden:"탑의 수문장",astra:"흑룡왕 아스트라",taotie:"탐식의 흉수 도철",hundun:"형체 없는 혼돈"};
/* t: a 업적 / c 도전과제 · g 목표값 · v 현재값 */
const L=[
{id:"first",t:"a",n:"첫 불씨",nEn:"First Ember",d:"적을 처음으로 처치하기",dEn:"Defeat your first enemy",g:1,v:(s)=>s?s.kills:0},
{id:"lv10",t:"a",n:"불씨 수집가",nEn:"Ember Collector",d:"한 판에서 LV 10 달성",dEn:"Reach LV 10 in one run",g:10,v:()=>sv.best.level},
{id:"lv20",t:"a",n:"타오르는 불꽃",nEn:"Blazing Flame",d:"한 판에서 LV 20 달성",dEn:"Reach LV 20 in one run",g:20,v:()=>sv.best.level},
{id:"n5",t:"a",n:"긴 밤의 시작",nEn:"The Long Night Begins",d:"NIGHT 5에 도달하기",dEn:"Reach NIGHT 5",g:5,v:()=>sv.best.night},
{id:"n10",t:"a",n:"첫 번째 새벽",nEn:"The First Dawn",d:"NIGHT 10에 도달하기",dEn:"Reach NIGHT 10",g:10,v:()=>sv.best.night},
{id:"bk",t:"a",n:"재를 털어내다",nEn:"Shaking Off the Ash",d:"재의 왕 처치",dEn:"Defeat the King of Ash",g:1,v:()=>sv.bosses.king||0},
{id:"bl",t:"a",n:"서리 날개를 꺾다",nEn:"Clipping Frost Wings",d:"서리 박쥐 군주 처치",dEn:"Defeat the Frost Bat Lord",g:1,v:()=>sv.bosses.lord||0},
{id:"bg",t:"a",n:"얼음 바위를 깨다",nEn:"Breaking the Ice Rock",d:"얼음 바위 수호자 처치",dEn:"Defeat the Ice Rock Guardian",g:1,v:()=>sv.bosses.guardian||0},
{id:"bw",t:"a",n:"등불을 끄다",nEn:"Snuffing the Lanterns",d:"혼등의 마녀 처치",dEn:"Defeat the Lantern Witch",g:1,v:()=>sv.bosses.witch||0},
{id:"bo",t:"a",n:"그믐을 걷어내다",nEn:"Lifting the Waning Moon",d:"그믐달 올빼미 처치",dEn:"Defeat the Waning Moon Owl",g:1,v:()=>sv.bosses.owl||0},
{id:"chest",t:"a",n:"용암의 보물",nEn:"Lava Treasure",d:"용암 보물 상자 열기",dEn:"Open a lava treasure chest",g:1,v:()=>sv.total.chests},
{id:"clear",t:"a",n:"둥지로 돌아오다",nEn:"Home to the Nest",d:"식음의 그림자를 쓰러뜨리고 클리어",dEn:"Defeat the Chilling Shadow and clear the game",g:1,v:()=>sv.total.wins},
{id:"tw5",t:"a",n:"탑에 오르다",nEn:"Up the Tower",d:"마법의 탑 5층 도달",dEn:"Reach floor 5 of the Magic Tower",g:5,v:()=>sv.best.floor||0},
{id:"twb",t:"a",n:"수문장을 넘어서",nEn:"Past the Warden",d:"탑의 수문장 처치",dEn:"Defeat the Tower Warden",g:1,v:()=>sv.bosses.warden||0},
{id:"tw10",t:"a",n:"바람이 부는 층",nEn:"Windswept Heights",d:"마법의 탑 10층 도달",dEn:"Reach floor 10 of the Magic Tower",g:10,v:()=>sv.best.floor||0},
{id:"k300",t:"c",n:"불씨 사냥꾼",nEn:"Ember Hunter",d:"한 판에서 300마리 처치",dEn:"Defeat 300 enemies in one run",g:300,v:()=>sv.best.kills},
{id:"k1000",t:"c",n:"재의 숲의 재앙",nEn:"Scourge of the Ashen Woods",d:"한 판에서 1000마리 처치",dEn:"Defeat 1000 enemies in one run",g:1000,v:()=>sv.best.kills},
{id:"t15",t:"c",n:"꺼지지 않는 불씨",nEn:"Undying Ember",d:"한 판에서 15분 생존",dEn:"Survive 15 minutes in one run",g:900,v:()=>sv.best.time,f:fmtTime},
{id:"n30",t:"c",n:"깊은 밤의 끝자락",nEn:"Edge of the Deep Night",d:"NIGHT 30에 도달하기",dEn:"Reach NIGHT 30",g:30,v:()=>sv.best.night},
{id:"tk",t:"c",n:"숲의 청소부",nEn:"Forest Sweeper",d:"누적 5000마리 처치",dEn:"Defeat 5000 enemies in total",g:5000,v:()=>sv.total.kills},
{id:"ch10",t:"c",n:"보물 사냥꾼",nEn:"Treasure Hunter",d:"누적 상자 10개 열기",dEn:"Open 10 chests in total",g:10,v:()=>sv.total.chests},
{id:"w3",t:"c",n:"단골 귀향자",nEn:"Frequent Homecomer",d:"3번 클리어하기",dEn:"Clear the game 3 times",g:3,v:()=>sv.total.wins},
{id:"fast",t:"c",n:"번개 귀향",nEn:"Lightning Homecoming",d:"40분 이내에 클리어",dEn:"Clear within 40 minutes",g:1,v:()=>sv.best.clear&&sv.best.clear<=2400?1:0},
{id:"hr",t:"c",n:"불씨의 벗",nEn:"Friend of the Ember",d:"누적 플레이 1시간",dEn:"Play for 1 hour in total",g:3600,v:()=>sv.total.time,f:fmtTime},
{id:"hardw",t:"c",n:"꺼지지 않는 의지",nEn:"Unyielding Will",d:"하드 모드로 본편 클리어",dEn:"Clear the story on Hard",g:1,v:()=>sv.total.winsHard||0},
{id:"hardt",t:"c",n:"험난한 탑",nEn:"Treacherous Tower",d:"하드 모드로 마법의 탑 10층 도달",dEn:"Reach floor 10 of the Magic Tower on Hard",g:10,v:()=>sv.best.floorHard||0},
{id:"tw25",t:"c",n:"구름 위의 층",nEn:"Above the Clouds",d:"마법의 탑 25층 도달",dEn:"Reach floor 25 of the Magic Tower",g:25,v:()=>sv.best.floor||0},
{id:"twd",t:"c",n:"용의 탑을 넘어",nEn:"Dragonslayer",d:"100층의 흑룡왕 아스트라 처치",dEn:"Defeat Astra, the Black Dragon King, on floor 100",g:1,v:()=>sv.bosses.astra||0},
{id:"tw50",t:"c",n:"하늘에 닿은 탑",nEn:"Tower to the Sky",d:"마법의 탑 50층 도달",dEn:"Reach floor 50 of the Magic Tower",g:50,v:()=>sv.best.floor||0},
{id:"hwang",t:"a",n:"오방의 주인",nEn:"Master of the Five Directions",d:"주작 · 현무 · 백호 · 청룡을 모두 Lv 40까지 진화시키기 (황룡 해금)",dEn:"Evolve Zhuque, Hyunmu, Baekho and Cheongryong to Lv 40 (unlocks Hwangryong)",g:4,v:()=>GUARD4.filter(id=>sv.evo40[id]).length},
{id:"hwc",t:"c",n:"황금빛 귀환",nEn:"Golden Homecoming",d:"황룡으로 스토리 클리어",dEn:"Clear the story as Hwangryong",g:1,v:()=>sv.clearBy.hwangryong||0},
{id:"gt1",t:"a",n:"첫 번째 시련",nEn:"The First Trial",d:"황룡의 시련: 탐식의 흉수 도철 처치",dEn:"Trial of Hwangryong: defeat Taotie, the Devourer",g:1,v:()=>sv.bosses.taotie||0},
{id:"allend",t:"c",n:"일곱 불씨의 전설",nEn:"Legend of the Seven Embers",d:"모든 캐릭터로 스토리 클리어 (엔딩 7개)",dEn:"Clear the story with every character (all 7 endings)",g:7,v:()=>END_ORDER.filter(k=>sv.clearBy[k]).length},
{id:"gt2",t:"c",n:"혼돈을 다스리다",nEn:"Master of Chaos",d:"황룡의 시련: 형체 없는 혼돈 처치",dEn:"Trial of Hwangryong: defeat Hundun, the Formless Chaos",g:1,v:()=>sv.bosses.hundun||0}
];
const GUARD4=["zhuque","hyunmu","baekho","cheongryong"];
/* 칭호: 업적 · 도전과제를 달성하면 얻어요 (id = 업적 id) · 등급 c 일반 / r 희귀 / e 영웅 / l 전설 */
const TIER={c:{n:"일반",nEn:"Common",c:"#d8dce0"},r:{n:"희귀",nEn:"Rare",c:"#5ac8ff"},e:{n:"영웅",nEn:"Epic",c:"#c89aff"},l:{n:"전설",nEn:"Legendary",c:"#ffd54a"}};
const TITLES=[
 {id:"first",n:"새싹 불씨",nEn:"Fresh Ember",tier:"c"},{id:"lv20",n:"타오르는 자",nEn:"The Blazing",tier:"c"},
 {id:"n10",n:"새벽을 본 자",nEn:"Dawn Seer",tier:"r"},{id:"t15",n:"꺼지지 않는 불씨",nEn:"Undying Ember",tier:"r"},{id:"bw",n:"등불을 끈 자",nEn:"Lantern Snuffer",tier:"r"},{id:"tk",n:"숲의 청소부",nEn:"Forest Sweeper",tier:"r"},{id:"clear",n:"둥지의 수호자",nEn:"Nest Guardian",tier:"r"},
 {id:"k1000",n:"재앙의 사냥꾼",nEn:"Scourge Hunter",tier:"e"},{id:"fast",n:"번개 귀향자",nEn:"Lightning Homecomer",tier:"e"},{id:"hardw",n:"불굴의 의지",nEn:"Indomitable",tier:"e"},{id:"tw50",n:"하늘탑 등반가",nEn:"Sky Climber",tier:"e"},
 {id:"twd",n:"용을 쓰러뜨린 자",nEn:"Dragonslayer",tier:"l"},{id:"hwang",n:"오방의 주인",nEn:"Master of the Five",tier:"l"},{id:"hwc",n:"황금빛 제왕",nEn:"Golden Emperor",tier:"l"},{id:"gt1",n:"흉수 사냥꾼",nEn:"Beast Hunter",tier:"e"},{id:"gt2",n:"혼돈을 다스린 자",nEn:"Tamer of Chaos",tier:"l"},{id:"allend",n:"전설의 이야기꾼",nEn:"Teller of Legends",tier:"l"}];
const titleOf=id=>TITLES.find(T=>T.id===id),titleHTML=T=>T?'<em class="ttl ttl-'+T.tier+'" style="color:'+TIER[T.tier].c+'">«'+tf(T,"n")+'»</em>':"";
const done=a=>!!sv.ach[a.id];
function toast(a){toasts.push(a);if(!toastT)next()}
let el=null;function next(){const a=toasts.shift();if(!a){toastT=0;return}
 if(!el){el=document.createElement("div");el.style.cssText='position:absolute;left:50%;top:14px;transform:translate(-50%,-140%);z-index:65;padding:10px 18px;border:3px solid #ffb04a;background:rgba(18,8,4,.92);color:#ffe9b8;font-size:15px;line-height:1.4;text-align:center;box-shadow:4px 4px 0 #000;transition:transform .35s;pointer-events:none;white-space:nowrap';(canvas.closest(".game-frame")||document.body).appendChild(el)}
 {const T=titleOf(a.id);el.innerHTML="🏆 "+(a.t==="a"?tx("업적","Achievement"):tx("도전과제","Challenge"))+tx(" 달성"," unlocked")+"<br><b style=\"color:#ffcf6a\">"+tf(a,"n")+"</b>"+(a.id==="hwang"?"<br>🐉 "+tx("황룡 해금!","Hwangryong unlocked!"):"")+(T?"<br><small>🎖 "+tx("칭호 획득 ","Title earned ")+titleHTML(T)+"</small>":"")}requestAnimationFrame(()=>{el.style.transform="translate(-50%,0)"});
 toastT=setTimeout(()=>{el.style.transform="translate(-50%,-140%)";setTimeout(()=>{toastT=0;next()},400)},2800)}
function check(){const s=state;for(const a of L)if(!done(a)&&a.v(s)>=a.g){sv.ach[a.id]=Date.now();dirty=true;toast(a);refreshBtn();if(a.id==="hwang")try{chars.grant("hwangryong")}catch(_){}}}
function tick(dt){const s=state;if(!s||!s.p||s.paused||s.dead||document.body.classList.contains("on-title"))return;
 const T=sv.total,B=sv.best;T.time+=dt;const dk=s.kills-(s._k||0);s._k=s.kills;T.kills+=dk;if(window.__qAdd){if(dk>0)window.__qAdd("kill",dk);window.__qAdd("time",dt);if(acc+dt>=1&&s.mode!=="tower")window.__qAdd("night",s.night)}
 B.time=Math.max(B.time,s.time);B.kills=Math.max(B.kills,s.kills);B.level=Math.max(B.level,s.level);B.night=Math.max(B.night,s.night);if(s.mode==="tower"){B.floor=Math.max(B.floor||0,s.floor||0);if(s.diff==="hard")B.floorHard=Math.max(B.floorHard||0,s.floor||0);else B.floorEasy=Math.max(B.floorEasy||0,s.floor||0)}dirty=true;
 acc+=dt;if(acc>=1){acc=0;check()}if(dirty&&Math.random()<dt/3)save()}
const api={tick,
 relang(){refreshBtn();refreshCoin();refreshTitle();if(!pn.classList.contains("hidden"))paint()},
 newRun(){sv.total.runs++;if(window.__qAdd&&state&&state.p&&state.p.charId)window.__qAdd("chars",state.p.charId);if(state)state._k=0;dirty=true;save()},
 boss(type){if(!BN[type])return;if(window.__qAdd)window.__qAdd("boss",1);sv.bosses[type]=(sv.bosses[type]||0)+1;dirty=true;check();save()},
 chest(){sv.total.chests++;dirty=true;check();save()},
 coins:()=>sv.coins,coinImg:()=>coinImg,addCoins(n,earned){if(!(n>0))return;sv.coins+=n;if(earned)sv.coinsEarned+=n;dirty=true;save();refreshCoin()},
 // 해금 조건: 스토리 이지 = 기본 · 스토리 하드/마법의 탑 이지 = 스토리 이지 클리어 · 마법의 탑 하드 = 탑 이지 100F 돌파(101F 도달)
evo40(id){if(!id||sv.evo40[id])return;sv.evo40[id]=Date.now();dirty=true;check();save()},evo40Of:()=>sv.evo40,clearOf:id=>sv.clearBy[id]||0,kill(t){if(!t)return;sv.kt[t]=(sv.kt[t]||0)+1;dirty=true;if(window.__qAdd){if(MAPMOB[t])window.__qAdd("mapmob",1);else if(t==="elite")window.__qAdd("elite",1)}},kt:()=>sv.kt,bossN:()=>sv.bosses,hwangOpen:()=>GUARD4.every(id=>sv.evo40[id]),
 title:()=>titleOf(sv.title)&&done(L.find(a=>a.id===sv.title))?titleOf(sv.title):null,refreshTitle:()=>refreshTitle(),
easyClears:()=>Math.max(0,(sv.total.wins||0)-(sv.total.winsHard||0)),
floorEasy:()=>Math.max(sv.best.floorEasy||0,(sv.best.floor||0)>(sv.best.floorHard||0)?(sv.best.floor||0):0),
towerOpen:()=>api.easyClears()>0,storyHardOpen:()=>api.easyClears()>0,towerHardOpen:()=>api.floorEasy()>TOWER_HARD_UNLOCK,
 spend(n){if(n>0&&sv.coins>=n){sv.coins-=n;dirty=true;save();refreshCoin();return true}return false},
 clear(){if(window.__qAdd&&state&&state.mode!=="tower")window.__qAdd("clear",1);lastGain=COIN_PER_CLEAR+(state.diff==="hard"?COIN_RULE.hardBonus:0);sv.coins+=lastGain;sv.coinsEarned+=lastGain;refreshCoin();sv.total.wins++;{const cid=state.p&&state.p.charId;if(cid)sv.clearBy[cid]=(sv.clearBy[cid]||0)+1}if(state.diff==="hard")sv.total.winsHard=(sv.total.winsHard||0)+1;const c=Math.round(state.time);if(!sv.best.clear||c<sv.best.clear)sv.best.clear=c;dirty=true;check();save()}};
window.addEventListener("pagehide",save);document.addEventListener("visibilitychange",()=>{if(document.hidden)save()});
/* ---- 타이틀 UI ---- */
const css=document.createElement("style");
css.textContent=".rc-tabs{display:flex;gap:6px;margin:6px 0 10px}.rc-tabs button{flex:1;padding:8px 6px;border:2px solid #6b4a2a;background:rgba(20,10,6,.6);color:#d8c6a0;cursor:pointer;font:inherit}.rc-tabs button.on{background:#ffb04a;border-color:#ffb04a;color:#2a0e08}.rc-body{max-height:48vh;overflow:auto;padding-right:4px;text-align:left}.rc-row{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;margin-bottom:5px;border:2px solid #3a2a1a;background:rgba(10,6,4,.55)}.rc-row b{color:#ffcf6a}.rc-ach{display:block;opacity:.55}.rc-ach.on{opacity:1;border-color:#ffb04a}.rc-ach strong{display:block}.rc-ach small{display:block;color:#bfae88;margin-top:2px}.rc-bar{height:6px;margin-top:6px;background:#2a1a10}.rc-bar i{display:block;height:100%;background:#ff8a2a}.rc-reset{margin-top:8px;background:none;border:0;color:#8a7a5a;text-decoration:underline;cursor:pointer;font:inherit}";
document.head.appendChild(css);
const pn=document.createElement("div");pn.id="recordsPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");pn.setAttribute("aria-label","기록과 업적");pn.dataset.i18nAria="recAria";
pn.innerHTML='<div class="panel modal-panel wide-panel"><p class="eyebrow">RECORDS</p><h2 data-i18n="recTitle">기록 · 업적</h2><div class="rc-tabs"><button type="button" data-tab="r" data-i18n="tabR">기록</button><button type="button" data-tab="a" data-i18n="tabA">업적</button><button type="button" data-tab="c" data-i18n="tabC">도전과제</button><button type="button" data-tab="t" data-i18n="tabT">칭호</button></div><div class="rc-body"></div><div class="panel-actions"><button class="primary-button" type="button" data-rc-close data-i18n="back">돌아가기</button></div></div>';
ui.start.appendChild(pn);modals.records=pn;
const body=pn.querySelector(".rc-body"),tabs=[...pn.querySelectorAll("[data-tab]")];let tab="r";
const ft=s=>{s=Math.round(s);return s>=3600?Math.floor(s/3600)+tx("시간 ","h ")+Math.floor(s%3600/60)+tx("분","m"):fmtTime(s)};
function paint(){tabs.forEach(b=>b.classList.toggle("on",b.dataset.tab===tab));const B=sv.best,T=sv.total;
 if(tab==="r"){const R=isEN()?[["Best survival time",fmtTime(B.time)],["Most kills",B.kills],["Highest level","LV "+B.level],["Highest NIGHT","NIGHT "+B.night],["Highest floor",B.floor?B.floor+"F":"—"],["Highest floor (Hard)",B.floorHard?B.floorHard+"F":"—"],["Fastest clear",B.clear?fmtTime(B.clear):"—"],["Clears",T.wins],["Hard clears",T.winsHard||0],["Runs played",T.runs],["Total play time",ft(T.time)],["Total kills",T.kills],["Bosses defeated",Object.values(sv.bosses).reduce((a,b)=>a+b,0)],["Chests opened",T.chests],["Clear coins",coinImg+sv.coins+" (total "+sv.coinsEarned+")"]]:[["최고 생존 시간",fmtTime(B.time)],["최다 처치",B.kills+"마리"],["최고 레벨","LV "+B.level],["최고 NIGHT","NIGHT "+B.night],["최고 층",B.floor?B.floor+"F":"—"],["하드 최고 층",B.floorHard?B.floorHard+"F":"—"],["최단 클리어 시간",B.clear?fmtTime(B.clear):"—"],["클리어 횟수",T.wins+"회"],["하드 클리어",(T.winsHard||0)+"회"],["총 플레이 횟수",T.runs+"회"],["총 플레이 시간",ft(T.time)],["누적 처치",T.kills+"마리"],["보스 처치",Object.values(sv.bosses).reduce((a,b)=>a+b,0)+"회"],["열어 본 상자",T.chests+"개"],["클리어 코인",coinImg+sv.coins+"개 (누적 "+sv.coinsEarned+")"]];
  body.innerHTML=R.map(r=>'<div class="rc-row"><span>'+r[0]+'</span><b>'+r[1]+'</b></div>').join("")+'<button class="rc-reset" type="button">'+tx("기록 초기화","Reset records")+'</button>';
  body.querySelector(".rc-reset").addEventListener("click",()=>{if(confirm(tx("모든 기록, 업적, 클리어 코인을 지울까요? 되돌릴 수 없어요.","Erase all records, achievements and clear coins? This can't be undone."))){sv=def();dirty=true;save();paint();refreshBtn();refreshCoin()}})}
 else if(tab==="t"){const cur=api.title();body.innerHTML='<p class="rc-tnote">'+tx("업적 · 도전과제를 달성하면 칭호를 얻어요. 얻은 칭호를 누르면 장착되고, 타이틀 화면과 게임 화면 HP 옆에 표시돼요. (능력치 변화 없음)","Earn titles by completing achievements and challenges. Tap an earned title to equip it — it shows on the title screen and next to your HP in game. (Cosmetic only)")+'</p>'
  +TITLES.map(T=>{const a=L.find(x=>x.id===T.id),ok=done(a),on=cur===T,R=TIER[T.tier];return'<button type="button" class="rc-row rc-ttl'+(ok?" on":"")+(on?" eq":"")+'" data-title="'+T.id+'"'+(ok?"":" disabled")+'><span><strong>'+(ok?titleHTML(T):'🔒 <em class="ttl" style="color:#8a7a68">«'+tf(T,"n")+'»</em>')+'</strong><small><b style="color:'+R.c+'">'+tf(R,"n")+'</b> · '+tf(a,"n")+' — '+tf(a,"d")+'</small></span><b>'+(on?tx("장착중","Equipped"):ok?tx("장착","Equip"):tx("미획득","Locked"))+'</b></button>'}).join("")}
 else body.innerHTML=L.filter(a=>a.t===tab).map(a=>{const ok=done(a),v=Math.min(a.v(null),a.g),f=a.f||(x=>x);return'<div class="rc-row rc-ach'+(ok?" on":"")+'"><span><strong>'+(ok?"🏆 ":"🔒 ")+tf(a,"n")+'</strong><small>'+tf(a,"d")+'</small>'+(a.g>1?'<div class="rc-bar"><i style="width:'+(ok?100:v/a.g*100)+'%"></i></div>':'')+'</span><b>'+(a.g>1?f(ok?a.g:v)+" / "+f(a.g):(ok?tx("달성","Done"):tx("미달성","Locked")))+'</b></div>'}).join("")}
tabs.forEach(b=>b.addEventListener("click",()=>{tab=b.dataset.tab;paint()}));
body.addEventListener("click",e=>{const b=e.target.closest("[data-title]");if(!b||b.disabled)return;sv.title=sv.title===b.dataset.title?"":b.dataset.title;dirty=true;save();paint();refreshTitle();if(typeof audio!=="undefined")audio.sfx("ui")});
pn.querySelector("[data-rc-close]").addEventListener("click",closeAndRefocus);pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
const btn=document.createElement("button");btn.id="recordsButton";btn.className="menu-btn";btn.type="button";
const sb=$("settingsButton");sb.parentNode.insertBefore(btn,sb);
function refreshBtn(){btn.style.whiteSpace="nowrap";btn.innerHTML=tx("기록 · 업적","Records")+" <small style=\"font-size:.72em;letter-spacing:0;opacity:.85\">"+L.filter(done).length+"/"+L.length+"</small>"}
btn.addEventListener("click",e=>{tab="r";paint();openModal("records",btn)});btn.addEventListener("mouseenter",()=>btn.focus({preventScroll:true}));

/* ---- 클리어 코인 UI ---- */
const coinImg=(()=>{const c=document.createElement("canvas");c.width=c.height=10;const x=c.getContext("2d"),R=["..oooooo..",".oyyyyyyo.","oyyyhhyyyo","oyyhyyyyyo","oyyhyrryyo","oyyyyrryyo","oyyyyyyyyo","oyyyyyyyyo",".oyyyyyyo.","..oooooo.."],P={o:"#7a4a10",y:"#ffc23a",h:"#fff0a8",r:"#e8442a"};R.forEach((r,j)=>{for(let i=0;i<10;i++)if(r[i]!==".")x.fillStyle=P[r[i]],x.fillRect(i,j,1,1)});return'<img alt="" src="'+c.toDataURL()+'" style="width:20px;height:20px;image-rendering:pixelated;vertical-align:-4px;margin-right:4px">'})();
const badge=document.createElement("div");badge.style.cssText="position:absolute;top:14px;left:16px;z-index:3;padding:6px 12px;border:2px solid #ffb04a;background:rgba(18,8,4,.8);color:#ffe9b8;font-size:14px;box-shadow:3px 3px 0 #000";ui.start.appendChild(badge);
const ec=document.createElement("p");ec.id="endingCoin";ec.style.cssText="color:#ffcf6a;font-size:1.05em";const es=$("endingStats");if(es)es.after(ec);
function refreshCoin(){badge.innerHTML=coinImg+tx("클리어 코인","Clear coins")+" <b style=\"color:#ffcf6a\">"+sv.coins+"</b>";ec.innerHTML=coinImg+tx("클리어 코인 +"+lastGain+" 획득! · 보유 ","Clear coin +"+lastGain+" earned! · Owned ")+"<b>"+sv.coins+"</b>"}
refreshCoin();
const tcss=document.createElement("style");tcss.textContent=".ttl{font-style:normal;white-space:nowrap}.ttl-l{animation:ttlShine 1.6s steps(4) infinite}@keyframes ttlShine{0%,100%{color:#ffd54a}50%{color:#fff6c0}}.rc-ttl{width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;align-items:center}.rc-ttl:disabled{cursor:default}.rc-ttl.eq{border-color:#ffd54a!important;background:rgba(60,40,8,.65)}.rc-ttl small{display:block;margin-top:3px;font-size:12px;opacity:.9}.rc-ttl>b{white-space:nowrap;flex:none}.rc-ttl small b{color:inherit}.rc-tnote{margin:0 0 8px;font-size:13px;color:#d8c6a0}#titleChip{position:absolute;top:52px;left:16px;z-index:3;padding:4px 10px;border:2px solid #6b4a2a;background:rgba(18,8,4,.75);color:#d8c6a0;font:inherit;font-size:13px;cursor:pointer;box-shadow:3px 3px 0 #000}#titleChip:hover,#titleChip:focus-visible{border-color:#ffb04a;outline:none}#hudTitle{margin-left:6px;font-size:.85em}.title-screen:has(.modal:not(.hidden)) #titleChip{display:none}";document.head.appendChild(tcss);
const tchip=document.createElement("button");tchip.id="titleChip";tchip.type="button";ui.start.appendChild(tchip);
tchip.addEventListener("click",()=>{tab="t";paint();openModal("records",tchip)});
const hudT=document.createElement("span");hudT.id="hudTitle";{const hs=ui.hpText&&ui.hpText.parentNode&&ui.hpText.parentNode.querySelector("span");if(hs)hs.after(hudT)}
function refreshTitle(){const T=api.title();tchip.innerHTML="🎖 "+(T?titleHTML(T):'<span style="opacity:.75">'+tx("칭호 없음","No title")+'</span>');hudT.innerHTML=T?titleHTML(T):""}
refreshTitle();
refreshBtn();return api})();

/* ================= 캐릭터 선택 · 구매 (클리어 코인 사용) ================= */
const chars=(()=>{
const KEY="ps_chars_v1";
let sv={owned:["ignis"],sel:"ignis"};
try{const r=JSON.parse(localStorage.getItem(KEY));if(r&&Array.isArray(r.owned))sv={owned:[...new Set(["ignis",...r.owned])],sel:typeof r.sel==="string"?r.sel:"ignis"}}catch(_){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(sv))}catch(_){}};
const pix=(rows,pal)=>{const c=document.createElement("canvas");c.width=rows[0].length;c.height=rows.length;const g=c.getContext("2d");rows.forEach((r,y)=>{for(let x=0;x<r.length;x++)if(r[x]!=="."){g.fillStyle=pal[r[x]];g.fillRect(x,y,1,1)}});return c.toDataURL()};
const COIN_ROWS=["..oooooo..",".oyyyyyyo.","oyyyhhyyyo","oyyhyyyyyo","oyyhyrryyo","oyyyyrryyo","oyyyyyyyyo","oyyyyyyyyo",".oyyyyyyo.","..oooooo.."];
const coinURL=pix(COIN_ROWS,{o:"#7a4a10",y:"#ffc23a",h:"#fff0a8",r:"#e8442a"});
const coinImg='<img alt="" src="'+coinURL+'" style="width:18px;height:18px;image-rendering:pixelated;vertical-align:-3px;margin-right:3px">';
/* ---- 캐릭터 데이터: 새 동물은 여기에 항목만 추가하면 됩니다 ---- */
const LIST=[
{id:"ignis",name:"이그니",nameEn:"Ignis",kind:"아기 용",kindEn:"Baby dragon",price:0,
 desc:"불씨가 꺼져 가는 재의 숲에서 둥지를 찾는 아기 용.",descEn:"A baby dragon searching for the nest in the fading Ashen Woods.",
 weapon:{name:"불씨 화살",nameEn:"Ember Arrow",text:"가장 가까운 적에게 불씨 화살을 자동으로 발사해요.",textEn:"Automatically fires ember arrows at the nearest enemy."},
 ability:{name:"불씨 수집",nameEn:"Ember Gathering",text:"흩어진 불씨 조각을 모아 성장해요.",textEn:"Grows stronger by gathering scattered ember shards."},
 stats:{hp:100,spd:175,atk:1,rate:.72,pick:48,guard:1},
 img:()=>SP.dragonA.n.toDataURL()},
{id:"zhuque",name:"주작",nameEn:"Zhuque",kind:"불의 신수",kindEn:"Fire guardian beast",price:20,
 desc:"남쪽 하늘을 지키는 불꽃의 새. 타오르는 날개로 숲을 밝혀요.",descEn:"The flame bird guarding the southern sky. Its blazing wings light up the forest.",
 weapon:{name:"불꽃의 검",nameEn:"Flame Sword",text:"주작만 쓸 수 있는 고유 무기. 불꽃이 깃든 검.",textEn:"A sword imbued with fire that only Zhuque can wield."},
 ability:{name:"불의 검기",nameEn:"Fire Slash",text:"바라보는 방향으로 불의 검기를 날려 적을 베어 넘겨요.",textEn:"Sends a slash of fire flying toward enemies, cutting them down."},
 stats:{hp:100,spd:175,atk:1.5,rate:.9,pick:48,guard:1},
  passive:{name:"불사",nameEn:"Undying",text:"죽어도 1회 부활해요. 대신 부활하면 3초 동안 무적이 되고 최대 체력이 50% 줄어요.",textEn:"Revives once after death with 3 seconds of invincibility, but max HP drops by 50%."},
 img:()=>{if(!SP.zhuqueCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,36);drawWings(g,.35,false);g.drawImage(SP.zhuqueA.n,-16,-24);SP.zhuqueCard=c.toDataURL()}return SP.zhuqueCard}},
{id:"hyunmu",name:"현무",nameEn:"Hyunmu",kind:"물의 신수",kindEn:"Water guardian beast",price:15,
 desc:"북쪽 바다를 지키는 검은 거북과 뱀. 느리지만 웬만해서는 쓰러지지 않아요.",descEn:"The black tortoise and serpent guarding the northern sea. Slow, but almost impossible to bring down.",
 weapon:{name:"뱀 채찍",nameEn:"Serpent Whip",text:"등껍질을 휘감은 뱀이 앞쪽 적들을 한꺼번에 후려치고 밀쳐내요. 멀리 있는 적에게는 물방울을 뱉어요.",textEn:"The serpent coiled around the shell lashes every foe in front and knocks them back. It spits water at distant foes."},
 ability:{name:"물의 결계",nameEn:"Water Barrier",text:"몸 주위를 도는 물방울이 공격을 한 번 막고, 터지면서 주변 적을 느리게 해요. 6초마다 다시 차올라요 (최대 2개).",textEn:"Orbiting droplets each block one hit, then burst to slow nearby foes. Recharges every 6 seconds (up to 2)."},
 passive:{name:"단단한 등껍질",nameEn:"Hard Shell",text:"받는 피해 15% 감소. 피해를 입으면 반격 물결이 퍼져 주변 적에게 피해를 주고 밀쳐내요.",textEn:"Takes 15% less damage. When hit, a counter wave damages and knocks back nearby foes."},
 stats:{hp:160,spd:150,atk:.85,rate:.85,pick:40,guard:.85},applyAtk:true,
 img:()=>{if(!SP.hyunmuCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,36);shellBack(g);snakeBack(g,.35,false);g.drawImage(SP.hyunmuA.n,-16,-24);snakeFront(g,.35,false);SP.hyunmuCard=c.toDataURL()}return SP.hyunmuCard}},
{id:"baekho",name:"백호",nameEn:"Baekho",kind:"바람의 신수",kindEn:"Wind guardian beast",price:20,
 desc:"서쪽 협곡을 지키는 하얀 호랑이. 몸은 약하지만 누구보다 빠르게 적 사이를 가르며 사냥해요.",descEn:"The white tiger guarding the western canyon. Frail, but faster than anyone as it hunts through the enemy ranks.",
 weapon:{name:"발톱 베기",nameEn:"Claw Swipe",text:"가까운 적을 앞쪽 부채꼴로 빠르게 할퀴어요. 멀리 있는 적에게는 짧은 바람 칼날을 날려요.",textEn:"Rapidly rakes nearby foes in a frontal arc. Sends a short wind blade at distant foes."},
 ability:{name:"질풍 돌진",nameEn:"Gale Dash",text:"몇 초마다 가까운 적에게 번개처럼 돌진해 지나는 길의 적을 베어요. 돌진하는 동안 잠깐 무적이에요.",textEn:"Every few seconds, dashes like lightning toward a nearby foe, cutting everything in its path. Briefly invincible while dashing."},
 passive:{name:"사냥 본능",nameEn:"Hunting Instinct",text:"적을 처치할 때마다 사냥 스택이 쌓여 이동 속도 +2% · 공격 속도 +3% (최대 10스택). 2초 동안 처치하지 못하면 스택이 줄어요.",textEn:"Each kill adds a Hunt stack: +2% move speed and +3% attack speed (up to 10). Stacks fade if you go 2 seconds without a kill."},
 stats:{hp:85,spd:195,atk:1.1,rate:.55,pick:48,guard:1},applyAtk:true,
 img:()=>{if(!SP.baekhoCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,36);baekhoTail(g,.35,false);g.drawImage(SP.baekhoA.n,-16,-24);SP.baekhoCard=c.toDataURL()}return SP.baekhoCard}},
{id:"cheongryong",name:"청룡",nameEn:"Cheongryong",kind:"번개의 신수",kindEn:"Thunder guardian beast",price:25,
 desc:"동쪽 계곡을 지키는 푸른 용. 비와 번개를 부려 수많은 적을 한꺼번에 상대해요.",descEn:"The azure dragon guarding the eastern valley. Commands rain and lightning to take on whole hordes at once.",
 weapon:{name:"번개 사슬",nameEn:"Chain Lightning",text:"가까운 적에게 번개를 내리치면 근처 적에게 차례로 튕겨 가요 (튕길 때마다 피해가 조금씩 줄어요).",textEn:"Strikes the nearest foe with lightning that bounces to nearby foes (a little weaker each bounce)."},
 ability:{name:"비구름",nameEn:"Rain Cloud",text:"7초마다 비구름을 불러요. 비 안의 적은 느려지고 계속 피해를 입고, 청룡은 체력을 회복해요.",textEn:"Summons a rain cloud every 7 seconds. Foes inside are slowed and take damage over time, while Cheongryong heals."},
 passive:{name:"여의주",nameEn:"Dragon Pearl",text:"공격할 때마다 여의주가 차오르고, 8번째 공격은 천둥이 돼요: 피해 ×1.6 · 3번 더 튕기고 · 맞은 적을 잠깐 멈춰요.",textEn:"Each attack charges the pearl; every 8th attack becomes thunder: damage ×1.6, 3 extra bounces, and briefly stuns foes hit."},
 stats:{hp:110,spd:168,atk:.95,rate:.8,pick:56,guard:1},applyAtk:true,
 img:()=>{if(!SP.cheongCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,36);cheongTail(g,.35,false);g.drawImage(SP.cheongA.n,-16,-24);cheongExtras(g,.35,false,null);SP.cheongCard=c.toDataURL()}return SP.cheongCard}},
{id:"hwangryong",name:"황룡",nameEn:"Hwangryong",kind:"중앙의 신수 · 사신의 왕",kindEn:"Guardian of the Center · King of the Four",price:0,lock:"evo4",
 desc:"사방의 사신을 거느리고 한가운데를 다스리는 황금빛 용. 땅을 일으키고 사신의 힘을 빌려 싸워요.",descEn:"The golden dragon that rules the center and leads the four guardians. Raises the earth and fights with the guardians' borrowed power.",
 weapon:{name:"황금 기둥",nameEn:"Golden Pillar",text:"가장 가까운 적의 발밑에서 황금 기둥이 솟아올라 주변 적까지 함께 치고 잠깐 느리게 해요. 마지막으로 빌린 사신의 기운(속성)도 함께 실려요.",textEn:"A golden pillar erupts beneath the nearest foe, striking everything around it and briefly slowing them. It also carries the element of the last guardian borrowed."},
 ability:{name:"오방 순환",nameEn:"Five-Way Cycle",text:"5초마다 사신의 힘을 차례로 빌려요: 주작 검기(6방향) → 현무 물방울(8방향 · 둔화) → 백호 바람 칼날(4발) → 청룡 번개 사슬. 머리 위 구슬이 다음 차례를 알려줘요.",textEn:"Every 5 seconds, borrows a guardian's power in turn: Zhuque sword waves (6-way) → Hyunmu water (8-way, slows) → Baekho wind blades (4) → Cheongryong chain lightning. The beads above its head show who's next."},
 passive:{name:"황금 비늘",nameEn:"Golden Scale",text:"황금 비늘이 공격을 한 번 막아 줘요. 깨지면 땅이 울려 주변 적에게 피해를 주고 밀쳐내요. 12초마다 다시 생겨요.",textEn:"A golden scale blocks one hit. When it breaks, the ground quakes, damaging and knocking back nearby foes. Regrows every 12 seconds."},
 special:{name:"오행 봉인",nameEn:"Five-Phase Seal",text:"8초 안에 한 적에게 서로 다른 속성이 3개 모이면 봉인돼요 (적 아래 색 점으로 표시). 0.6초 뒤 봉인이 터져 큰 피해를 주고, 주변 적에게도 피해와 속성 2개를 퍼뜨려 연쇄 폭발을 일으킬 수 있어요. 봉인 5번마다 황금 비늘이 바로 다시 생겨요. (보스는 속성 4개 필요)",textEn:"When 3 different elements land on one foe within 8s, it gets sealed (shown as colored dots beneath it). 0.6s later the seal bursts for heavy damage, hitting nearby foes and spreading 2 elements to them — perfect for chain blasts. Every 5 seals instantly restores the Golden Scale. (Bosses need 4 elements)"},
 stats:{hp:140,spd:172,atk:1.2,rate:.72,pick:56,guard:.9},applyAtk:true,
 img:()=>{if(!SP.hwangCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,38);hwangTail(g,.35,false);g.drawImage(SP.hwangA.n,-16,-24);hwangExtras(g,.35,false,null);SP.hwangCard=c.toDataURL()}return SP.hwangCard}},
{id:"qilin",name:"기린",nameEn:"Qilin",kind:"빛의 영수 · 사령의 으뜸",kindEn:"Beast of Light · First of the Four Spirits",price:40,
 desc:"구름 위 성소에서 내려온 빛의 영수. 적을 꿰뚫는 빛으로 싸우고, 넘치는 생명력으로 스스로를 지켜요.",descEn:"A beast of light descended from the sanctuary above the clouds. Fights with piercing light and shields itself with overflowing life.",
 weapon:{name:"성광 창",nameEn:"Holy Lance",text:"가장 가까운 적을 향해 곧게 뻗는 빛줄기를 쏴요. 줄 위에 있는 적은 모두 꿰뚫어요.",textEn:"Fires a straight beam of light at the nearest foe, piercing every enemy along the line."},
 ability:{name:"천벌",nameEn:"Smite",text:"4초마다 하늘에서 빛기둥이 내려와 가장 튼튼한 적 2마리를 내리쳐요.",textEn:"Every 4 seconds, pillars of light strike the 2 toughest foes."},
 passive:{name:"은총",nameEn:"Grace",text:"기린이 스스로 회복할 때 넘치는 만큼 성스러운 보호막이 돼요 (최대 체력의 30%까지). 보호막이 먼저 피해를 받아요.",textEn:"When the Qilin heals itself, any overflow becomes a holy shield (up to 30% max HP) that absorbs damage first."},
 special:{name:"천명",nameEn:"Mandate of Heaven",text:"받은 피해(보호막이 막은 것 포함)와 보호막에서도 넘친 회복이 '천명'으로 쌓여요 (뿔이 점점 밝게 빛나요). 최대 체력의 45%만큼 차면 화면 안의 낙인 찍힌 적 모두에게 하늘의 심판이 내리고, 쌓인 양에 비례해 큰 피해 · 회복 · 잠깐 무적을 얻어요.",textEn:"Damage taken (even when the shield blocks it) and healing that overflows the shield build up as Mandate (the horn glows brighter). At 45% of max HP, Judgment strikes every Branded foe on screen — damage scales with the stored Mandate, and you heal and gain brief invincibility."},
 stats:{hp:125,spd:180,atk:1.1,rate:.85,pick:56,guard:.95},applyAtk:true,
 img:()=>{if(!SP.qilinCard){const c=document.createElement("canvas");c.width=84;c.height=60;const g=c.getContext("2d");g.translate(42,36);qilinTail(g,.35,false);g.drawImage(SP.qilinA.n,-16,-24);qilinExtras(g,.35,false,null);SP.qilinCard=c.toDataURL()}return SP.qilinCard}}
];
const byId=id=>LIST.find(c=>c.id===id)||LIST[0];
const owned=id=>sv.owned.includes(id)||(id==="hwangryong"&&(dbg.on||rec.hwangOpen()));
if(!owned(sv.sel)||byId(sv.sel).soon)sv.sel="ignis";
function statHTML(st){if(!st)return"";const R=[[tx("체력","HP"),st.hp/200,st.hp],[tx("이동 속도","Speed"),st.spd/220,st.spd],[tx("공격력","Attack"),st.atk/1.6,Math.round(st.atk*100)+"%"],[tx("공격 속도","Attack speed"),(1/st.rate)/1.8,(1/st.rate).toFixed(2)+tx("회/초","/s")],[tx("피해 감소","Damage reduction"),(1-st.guard)/.4,Math.round((1-st.guard)*100)+"%"]];
 return'<div class="ch-stats">'+R.map(([l,k,v])=>'<i>'+l+'</i><span class="ch-bar"><b style="width:'+Math.round(Math.max(0,Math.min(1,k))*100)+'%"></b></span><u>'+v+'</u>').join("")+'</div>'}
const api={sel:()=>sv.sel,owned,list:()=>LIST,get:byId,grant(id){if(!sv.owned.includes(id)){sv.owned.push(id);save()}refreshBtn();if(!pn.classList.contains("hidden"))paint()},relang(){refreshBtn();if(!pn.classList.contains("hidden"))paint()}};
/* ---- UI ---- */
const css=document.createElement("style");
css.textContent=".ch-special{border-color:#ffd54a!important;background:rgba(60,40,8,.5)!important}.ch-special strong{color:#ffd54a}.ch-el{margin-left:6px;font-size:.62em;white-space:nowrap}.ch-lock{display:block;width:100%;padding:8px 10px;border:2px dashed #b08a3a;background:rgba(40,28,8,.5);color:#ffe9b8;text-align:left}.ch-lock strong{display:block;color:#ffd54a}.ch-lock small{display:block;margin:2px 0 6px;color:#e8d8b0}.ch-lock ul{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}.ch-lock li{color:#bfa88a}.ch-lock li.ok{color:#7dff9a}.ch-lock li i{display:block;font-style:normal;font-size:.8em;opacity:.8}.ch-coin{display:flex;justify-content:flex-end;margin:2px 0 8px;color:#ffe9b8}.ch-coin b{color:#ffcf6a;margin-left:4px}.ch-wrap{position:relative;display:flex;align-items:center;gap:6px}.ch-list{flex:1;display:flex;gap:8px;overflow-x:auto;padding:4px 2px 10px;scrollbar-width:none;scroll-behavior:smooth}.ch-list::-webkit-scrollbar{display:none}.ch-arr{flex:none;width:30px;height:60px;padding:0;border:2px solid #6b4a2a;background:rgba(20,10,6,.75);color:#ffcf6a;font:inherit;font-size:14px;cursor:pointer;transition:opacity .15s}.ch-arr:hover{border-color:#ffb04a;background:rgba(60,30,10,.85)}.ch-arr.off{opacity:.25;cursor:default}.ch-card{flex:0 0 112px;padding:8px 6px;border:2px solid #3a2a1a;background:rgba(10,6,4,.6);color:#d8c6a0;cursor:pointer;font:inherit;text-align:center}.ch-card img,.ch-card .ch-q{display:block;width:56px;height:56px;margin:0 auto 6px;image-rendering:pixelated;object-fit:contain}.ch-card .ch-q{line-height:56px;font-size:28px;color:#5a4a3a}.ch-card strong{display:block}.ch-card small{display:block;margin-top:2px;color:#bfae88}.ch-card.view{border-color:#ffb04a;background:rgba(60,28,10,.7)}.ch-card.locked img{filter:brightness(.35) saturate(.6)}.ch-card.soon{opacity:.5;cursor:default}.ch-card.using small{color:#ffcf6a}.ch-detail{display:flex;gap:14px;text-align:left;border:2px solid #3a2a1a;background:rgba(10,6,4,.55);padding:12px}.ch-big{flex:0 0 96px;text-align:center}.ch-big img{width:96px;height:96px;image-rendering:pixelated;object-fit:contain}.ch-big.locked img{filter:brightness(.35) saturate(.6)}.ch-info{flex:1;min-width:0}.ch-info h3{margin:0 0 2px}.ch-info p{margin:0 0 8px;color:#bfae88}.ch-skill{padding:7px 9px;margin-bottom:6px;border-left:3px solid #ff8a2a;background:rgba(255,138,42,.08)}.ch-skill span{display:block;font-size:.8em;color:#ffb04a}.ch-skill strong{display:block}.ch-skill small{display:block;color:#d8c6a0;margin-top:2px}.ch-act{margin-top:10px}.ch-stats{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;margin:2px 0 10px;font-size:.82em}.ch-stats i{font-style:normal;color:#bfae88;white-space:nowrap}.ch-bar{height:7px;background:#2a1a10;box-shadow:0 0 0 1px #3a2a1a}.ch-bar b{display:block;height:100%;background:linear-gradient(90deg,#c8501a,#ffb04a)}.ch-stats u{text-decoration:none;color:#ffe9b8;text-align:right;white-space:nowrap}@media (max-height:480px){.ch-big{display:none}.ch-detail{padding:8px}}";
document.head.appendChild(css);
const pn=document.createElement("div");pn.id="charPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");pn.setAttribute("aria-label","캐릭터");pn.dataset.i18nAria="charTitle";
pn.innerHTML='<div class="panel modal-panel wide-panel"><p class="eyebrow">CHARACTERS</p><h2 data-i18n="charTitle">캐릭터</h2><div class="ch-coin"></div><div class="ch-wrap"><button type="button" class="ch-arr ch-l" aria-label="이전">◀</button><div class="ch-list"></div><button type="button" class="ch-arr ch-r" aria-label="다음">▶</button></div><div class="ch-detail"></div><div class="panel-actions"><button class="primary-button" type="button" data-ch-close data-i18n="back">돌아가기</button></div></div>';
ui.start.appendChild(pn);modals.chars=pn;
const coinEl=pn.querySelector(".ch-coin"),listEl=pn.querySelector(".ch-list"),detEl=pn.querySelector(".ch-detail");
let view="ignis";
function paint(){
 coinEl.innerHTML=tx("보유 코인","Coins")+"<b>"+coinImg+rec.coins()+"</b>";
 listEl.innerHTML=LIST.map(c=>{const o=owned(c.id),st=c.soon?tx("준비 중","Coming soon"):sv.sel===c.id?tx("✔ 선택중","✔ Selected"):o?tx("보유","Owned"):c.lock?tx("🔒 특별 해금","🔒 Special"):coinImg+c.price;
  return'<button type="button" class="ch-card'+(view===c.id?" view":"")+(o?"":" locked")+(c.soon?" soon":"")+(sv.sel===c.id?" using":"")+'" data-id="'+c.id+'">'+(c.img?'<img alt="" src="'+c.img()+'">':'<span class="ch-q">?</span>')+'<strong>'+tf(c,"name")+'</strong><small>'+st+'</small></button>'}).join("");setTimeout(()=>{try{syncArr()}catch(_){}},0);
 const c=byId(view);
 if(c.soon){detEl.innerHTML='<div class="ch-info"><h3>???</h3><p>'+tx("새로운 동물 친구가 곧 찾아와요.","A new animal friend is coming soon.")+'</p></div>';return}
 const o=owned(c.id),can=rec.coins()>=c.price;
 let act;
 if(sv.sel===c.id)act='<button class="primary-button" type="button" disabled>'+tx("선택중","Selected")+'</button>';
 else if(o)act='<button class="primary-button" type="button" data-act="sel">'+tx("선택하기","Select")+'</button>';
 else if(c.lock){const ev=rec.evo40Of(),G=["zhuque","hyunmu","baekho","cheongryong"],nd=G.filter(id=>ev[id]).length;
  act='<div class="ch-lock"><strong>🔒 '+tx("해금 조건","Unlock condition")+'</strong><small>'+tx("사신 넷을 모두 한 판에서 Lv 40까지 키워 진화시키기 ("+nd+"/4)","Evolve all four guardians to Lv 40 in a run ("+nd+"/4)")+'</small><ul>'+G.map(id=>{const g=byId(id),ok=!!ev[id];return'<li class="'+(ok?"ok":"")+'">'+(ok?"✔ ":"✖ ")+tf(g,"name")+'<i>'+(ok?tx("Lv 40 진화 완료","Lv 40 evolved"):owned(id)?tx("아직 Lv 40 진화 전","Not yet evolved at Lv 40"):tx("미보유","Not owned"))+'</i></li>'}).join("")+'</ul></div>'}
 else act='<button class="primary-button" type="button" data-act="buy"'+(can?"":" disabled")+'>'+tx(coinImg+c.price+' 코인으로 구매','Buy for '+coinImg+c.price)+'</button>'+(can?"":'<small style="margin-left:8px;color:#bfae88">'+tx("코인이 부족해요 (클리어 시 +1)","Not enough coins (+1 per clear)")+'</small>');
 detEl.innerHTML='<div class="ch-big'+(o?"":" locked")+'"><img alt="" src="'+c.img()+'"></div><div class="ch-info"><h3>'+tf(c,"name")+' <small style="color:#ffb04a">'+tf(c,"kind")+'</small>'+(CHAR_ELEM[c.id]?' <small class="ch-el" style="color:'+ELEM[CHAR_ELEM[c.id]].c+'">'+ELEM[CHAR_ELEM[c.id]].icon+' '+tf(ELEM[CHAR_ELEM[c.id]],"n")+'</small>':'')+'</h3><p>'+tf(c,"desc")+'</p>'+statHTML(c.stats)
  +(CHAR_ELEM[c.id]?'<div class="ch-skill ch-elem"><span>'+tx("속성","Element")+'</span><strong style="color:'+ELEM[CHAR_ELEM[c.id]].c+'">'+ELEM[CHAR_ELEM[c.id]].icon+' '+tf(ELEM[CHAR_ELEM[c.id]],"n")+' · '+tf(ELEM[CHAR_ELEM[c.id]],"fx")+'</strong><small>'+tf(ELEM[CHAR_ELEM[c.id]],"d")+(c.id==="hwangryong"?tx(" 오방 순환으로 빌린 기술에는 그 사신의 속성이 붙어요."," Skills borrowed through the Five-Way Cycle carry that guardian's element."):"")+'</small></div>':'')+'<div class="ch-skill"><span>'+tx("고유 무기","Signature weapon")+'</span><strong>'+tf(c.weapon,"name")+'</strong><small>'+tf(c.weapon,"text")+'</small></div>'
  +'<div class="ch-skill"><span>'+tx("능력","Ability")+'</span><strong>'+tf(c.ability,"name")+'</strong><small>'+tf(c.ability,"text")+'</small></div>'
  +(c.passive?'<div class="ch-skill"><span>'+tx("패시브","Passive")+'</span><strong>'+tf(c.passive,"name")+'</strong><small>'+tf(c.passive,"text")+'</small></div>':'')+(c.special?'<div class="ch-skill ch-special"><span>'+tx("고유 매커니즘","Unique mechanic")+'</span><strong>'+tf(c.special,"name")+'</strong><small>'+tf(c.special,"text")+'</small></div>':'')
  +'<div class="ch-act">'+act+'</div></div>'}
// 마우스 휠(위/아래)로 가로 스크롤 · 양옆 화살표로 넘기기
const arrL=pn.querySelector(".ch-l"),arrR=pn.querySelector(".ch-r"),syncArr=()=>{const max=listEl.scrollWidth-listEl.clientWidth-2;arrL.classList.toggle("off",listEl.scrollLeft<=2);arrR.classList.toggle("off",listEl.scrollLeft>=max)};
listEl.addEventListener("wheel",e=>{const d=Math.abs(e.deltaY)>Math.abs(e.deltaX)?e.deltaY:e.deltaX;if(!d||listEl.scrollWidth<=listEl.clientWidth)return;e.preventDefault();listEl.scrollLeft+=d>0?120:-120},{passive:false});
listEl.addEventListener("scroll",syncArr);arrL.addEventListener("click",()=>{listEl.scrollLeft-=240;setTimeout(syncArr,350)});arrR.addEventListener("click",()=>{listEl.scrollLeft+=240;setTimeout(syncArr,350)});
new (window.ResizeObserver||function(){this.observe=()=>{}})(syncArr).observe(listEl);
listEl.addEventListener("click",e=>{const b=e.target.closest(".ch-card");if(!b)return;const c=byId(b.dataset.id);if(c.soon)return;view=c.id;paint()});
detEl.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const c=byId(view);
 if(b.dataset.act==="buy"){if(!owned(c.id)&&rec.spend(c.price)){sv.owned.push(c.id);sv.sel=c.id;save()}}
 else if(owned(c.id)){sv.sel=c.id;save()}
 paint();refreshBtn()});
pn.querySelector("[data-ch-close]").addEventListener("click",closeAndRefocus);pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
const btn=document.createElement("button");btn.id="charButton";btn.className="menu-btn";btn.type="button";
const rb=$("recordsButton");rb.parentNode.insertBefore(btn,rb);
function refreshBtn(){btn.textContent=tx("캐릭터 · ","Character · ")+tf(byId(sv.sel),"name")}
btn.addEventListener("click",e=>{view=sv.sel;paint();openModal("chars",btn)});btn.addEventListener("mouseenter",()=>btn.focus({preventScroll:true}));
refreshBtn();return api})();



/* ================= 도감: 캐릭터 · 적 · 보스 · 맵 (만나거나 처치하면 등록) ================= */
const codex=(()=>{
const ENEMIES=[["blob","재 덩이","Ash Blob","가장 흔한 적. 무리 지어 다가와요.","The most common foe. Swarms in groups."],["bat","서리 박쥐","Frost Bat","빠르게 날아들지만 약해요.","Darts in fast, but frail."],["stump","서리 바위","Frost Rock","느리지만 튼튼하고 아파요.","Slow, but tough and hits hard."],["toad","서리 두꺼비","Frost Toad","거리를 두고 얼음 덩이를 뱉어요.","Keeps its distance and spits ice globs."],["wisp","보랏빛 도깨비불","Violet Wisp","주위를 맴돌다 혼불을 쏴요.","Circles you and fires spirit flames."],["shroom","등불 버섯","Glowcap","쓰러지면 작은 버섯 두 마리로 갈라져요.","Splits into two little shrooms when defeated.","forest"],["newt","잿불 도롱뇽","Cinder Newt","멈춰서 달아오르면 곧 짧게 돌진해요.","When it stops and glows, a quick dash is coming.","burnt"],["penguin","썰매 펭귄","Sled Penguin","셋이 함께 나타나 배로 미끄러지며 돌진해요.","Arrives in threes and belly-slides at you.","frozen"],["dustdevil","모래 회오리","Dust Devil","지그재그로 빠르게 다가오고, 닿으면 밀려나요.","Zigzags in fast and shoves you on contact.","canyon"],["pixie","꽃잎 요정","Petal Pixie","거리를 두고 주변 적의 체력을 회복시켜요. 먼저 노리세요.","Keeps away and heals nearby foes. Take it out first.","blossom"],["lion","돌사자 석상","Stone Lion","돌일 때는 단단해요. 가까이 가면 깨어나 덮쳐요.","Tough while stone. Wakes and pounces when you get close.","palace"],["cloudsp","구름 정령","Cloud Spirit","가끔 안개로 흩어져 공격이 통하지 않아요.","Sometimes scatters into mist, immune to attacks.","cloud"],["elite","정예","Elite","금빛 기운을 두른 강한 적. 크고 튼튼하며 보상이 많아요.","A strong foe wreathed in gold. Bigger, tougher, richer drops."]];
const BOSSES=[["king","NIGHT 10","재 덩이를 불러내며 다가오는 재의 왕.","Advances while summoning ash blobs."],["lord","NIGHT 20","조준한 뒤 번개처럼 돌진해요.","Takes aim, then dashes like lightning."],["guardian","NIGHT 30","사방으로 얼음 탄을 흩뿌려요.","Sprays ice shots in every direction."],["owl","NIGHT 40","하늘을 어둡게 덮고 내리꽂혀요.","Darkens the sky and dives down."],["witch","NIGHT 45","혼등을 모두 깨면 결계가 풀려요.","Break every lantern to drop her ward."],["shadow","NIGHT 50 · FINAL","숲의 온기를 삼킨 최후의 그림자.","The final shadow that devoured the forest's warmth."],["warden",["마법의 탑 5층마다","Every 5 tower floors"],"룬이 새겨진 돌 골렘.","A rune-carved stone golem."],["astra",["마법의 탑 100층","Tower floor 100"],"탑 꼭대기에 사는 전설의 흑룡왕.","The legendary black dragon king atop the tower."],["taotie",["황룡의 시련 · Lv20","Hwangryong's Trial · Lv20"],"졸개를 삼켜 커져요. 삼키기 전에 졸개를 처치하세요.","Grows by devouring minions — clear them first."],["hundun",["황룡의 시련 · Lv40","Hwangryong's Trial · Lv40"],"속성이 바뀌며 공격이 달라져요. 오행 봉인으로만 질서를 되찾아요.","Shifts elements and attacks. Only a Five-Phase Seal restores order."]];
const MAPS=[["forest","ignis","불씨가 꺼져 가는 밤의 숲. 둥지로 이어지는 흙길이 있어요.","A night forest where the embers are fading."],["burnt","zhuque","불길이 휩쓸고 간 붉은 대지.","Red earth swept by wildfire."],["frozen","hyunmu","얼음이 떠다니는 북쪽 바다와 이글루.","A northern sea of drifting ice and igloos."],["canyon","baekho","은빛 억새가 흔들리는 서쪽 협곡.","A western canyon of swaying silver grass."],["blossom","cheongryong","봄비가 내리는 동쪽 벚꽃 계곡.","An eastern valley of spring rain and blossoms."],["palace","hwangryong","황금 균열이 흐르는 중앙의 궁궐. 하늘에 황룡이 날아요.","The central palace laced with golden cracks."],["cloud","qilin","구름 바다 위 성소와 금빛 초원. 학이 날아요.","A sanctuary and golden meadow above a sea of clouds."]];
const pimg={};
function portrait(type){if(pimg[type])return pimg[type];const c=document.createElement("canvas");c.width=120;c.height=90;const g=c.getContext("2d");g.imageSmoothingEnabled=false;
 const spr=(im,s,dy=0)=>g.drawImage(im,Math.round(60-im.width*s/2),Math.round(48-im.height*s/2+dy),Math.round(im.width*s),Math.round(im.height*s));
 try{if(type==="taotie"||type==="hundun"){const e={type,x:60,y:42,r:22,hit:0,mode:"chase",face:1,asp:3,strikes:[],hp:1,maxHp:1};(type==="taotie"?drawTaotie:drawHundun)(e,g)}
  else if(type==="king"){spr(SP.blob.n,2.6,8);g.drawImage(SP.crown.n,Math.round(60-SP.crown.n.width*1.2),10,Math.round(SP.crown.n.width*2.4),Math.round(SP.crown.n.height*2.4))}
  else if(type==="lord")spr(SP.bat.n,3.4);else if(type==="guardian")spr(SP.stump.n,2.3);else if(type==="owl")spr(SP.owl.n,2.4);else if(type==="shadow")spr(SP.shadowDragon.n,1.9);
  else if(type==="witch")spr(SP.witch.n,1.9);else if(type==="warden")spr(SP.warden.n,2.1);else if(type==="astra")spr(tint(SP.dragonA.n,"#2a0a14"),1.9);
  else if(type==="elite"){g.globalAlpha=.6;g.strokeStyle="#ffd54a";g.lineWidth=3;g.beginPath();g.arc(60,46,30,0,6.283);g.stroke();g.globalAlpha=1;spr(SP.stump.n,2.2)}
  else if(type==="lion"){spr(SP.lionBase.n,2,22);spr(SP.lion.n,2,-4)}else if(SP[type])spr(SP[type].n,type==="stump"?2.3:type==="dustdevil"||type==="cloudsp"||type==="shroom"?2.5:3)}catch(_){}
 return pimg[type]=c.toDataURL()}
const mthumb={};function thumb(th){if(mthumb[th])return mthumb[th];const c=document.createElement("canvas");c.width=192;c.height=120;const g=c.getContext("2d");g.imageSmoothingEnabled=false;
 try{const sc=sceneOf(th);g.drawImage(sc.bg,0,0,192,120);if(sc.mid)g.drawImage(sc.mid,0,0,192,120);g.drawImage(sc.fg,0,0,192,120)}catch(_){}return mthumb[th]=c.toDataURL()}
const css=document.createElement("style");
css.textContent=".cx-tabs{display:flex;gap:6px;margin:6px 0 6px}.cx-tabs button{flex:1;padding:8px 4px;border:2px solid #6b4a2a;background:rgba(20,10,6,.6);color:#d8c6a0;cursor:pointer;font:inherit}.cx-tabs button.on{background:#ffb04a;border-color:#ffb04a;color:#2a0e08}.cx-prog{margin:0 0 8px;font-size:13px;color:#d8c6a0;text-align:right}.cx-prog b{color:#ffcf6a;font-weight:400}.cx-body{max-height:50vh;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-right:4px;text-align:left}.cx-card{display:flex;gap:10px;align-items:flex-start;padding:8px;border:2px solid #3a2a1a;background:rgba(10,6,4,.55)}.cx-card.on{border-color:#6b4a2a}.cx-card img{flex:none;width:72px;height:54px;object-fit:contain;image-rendering:pixelated;background:rgba(0,0,0,.35)}.cx-card.map img{width:112px;height:70px}.cx-card.off img{filter:brightness(0);opacity:.55}.cx-card strong{display:block;color:#fff}.cx-card small{display:block;color:#c8bca0;line-height:1.45;font-size:12px}.cx-card em{font-style:normal;color:#ffcf6a;font-size:12px}.cx-card.end.on{cursor:pointer}.cx-card.end.on:hover{border-color:#ffb04a}.cx-card .cx-play{display:block;margin-top:4px;color:#ffcf6a;font-weight:400;font-size:12px}.cx-tabs button{min-width:0}@media (max-width:640px){.cx-body{grid-template-columns:1fr}}";
document.head.appendChild(css);
const pn=document.createElement("div");pn.id="codexPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");
pn.innerHTML='<div class="panel modal-panel wide-panel"><p class="eyebrow">CODEX</p><h2 class="cx-h"></h2><div class="cx-tabs"></div><p class="cx-prog"></p><div class="cx-body"></div><div class="panel-actions"><button class="primary-button" type="button" data-cx-close></button></div></div>';
ui.start.appendChild(pn);modals.codex=pn;
const tabsEl=pn.querySelector(".cx-tabs"),body=pn.querySelector(".cx-body"),prog=pn.querySelector(".cx-prog");let tab="chars";
const card=(img,on,title,sub,lines,cls)=>'<div class="cx-card'+(on?" on":" off")+(cls?" "+cls:"")+'"><img alt="" src="'+img+'"><div><strong>'+title+'</strong>'+(sub?'<em>'+sub+'</em>':'')+lines.map(l=>'<small>'+l+'</small>').join("")+'</div></div>';
function paint(){pn.setAttribute("aria-label",tx("도감","Codex"));pn.querySelector(".cx-h").textContent=tx("도감","Codex");pn.querySelector("[data-cx-close]").textContent=tx("돌아가기","Back");
 const T=[["chars",tx("캐릭터","Characters")],["foes",tx("적","Foes")],["bosses",tx("보스","Bosses")],["maps",tx("맵","Maps")],["ends",tx("엔딩","Endings")]];
 tabsEl.innerHTML=T.map(([k,n])=>'<button type="button" data-cx="'+k+'" class="'+(k===tab?"on":"")+'">'+n+'</button>').join("");
 const kt=rec.kt(),bn=rec.bossN();let html="",got=0,all=0;
 if(tab==="chars"){for(const c of chars.list()){const on=chars.owned(c.id),el2=CHAR_ELEM[c.id]&&ELEM[CHAR_ELEM[c.id]],Ev=c.id==="ignis"?IGN_EVO:CHAR_EVO[c.id];all++;if(on)got++;
   html+=card(c.img(),on,on?tf(c,"name"):"???",on?tf(c,"kind")+(el2?' · <span style="color:'+el2.c+'">'+el2.icon+' '+tf(el2,"n")+'</span>':''):"",on?[tf(c,"desc"),tx("진화","Evolution")+": "+(Ev&&Ev[1]?tf(Ev[1],"name"):"—")+" → "+(Ev&&Ev[2]?tf(Ev[2],"name"):"—"),tx("이 캐릭터로 클리어","Clears")+": "+((rec.clearOf&&rec.clearOf(c.id))||0)]:[c.lock?tx("특별한 조건으로 해금돼요","Unlocked by a special condition"):tx("코인 "+c.price+"개로 만날 수 있어요","Meet it for "+c.price+" coins")])}}
 else if(tab==="foes"){for(const [id,n,nEn,d,dEn,th] of ENEMIES){const k=kt[id]||0,on=k>0,hab=th?tx("출현: ","Habitat: ")+mapName(th):"";all++;if(on)got++;html+=card(portrait(id),on,on?tx(n,nEn):"???",on?tx("처치 ","Defeated ")+k.toLocaleString():"",on?[tx(d,dEn)].concat(hab?[hab]:[]):[tx("아직 만나지 못했어요","Not encountered yet")].concat(hab?[hab]:[]))}}
 else if(tab==="bosses"){for(const [id,where,d,dEn] of BOSSES){const k=bn[id]||0,on=k>0;all++;if(on)got++;html+=card(portrait(id),on,on?bossName(id):"???",Array.isArray(where)?tx(where[0],where[1]):where,on?[tx(d,dEn),tx("처치 ","Defeated ")+k+tx("회"," times")]:[tx("쓰러뜨리면 등록돼요","Defeat it to record it")])}}
 else if(tab==="ends"){for(const id of END_ORDER){const c=chars.get(id),E=CHAR_END[id],on=(rec.clearOf&&rec.clearOf(id))>0;all++;if(on)got++;if(!c)continue;
   html+=card(c.img(),on,on?tf(E,"name"):"???",(chars.owned(id)?tf(c,"name"):"???")+tx("의 엔딩","'s ending"),on?[tx(E.t,E.te),'<b class="cx-play">▶ '+tx("눌러서 다시 보기","Tap to replay")+'</b>']:[tx(c.lock||!chars.owned(id)?"이 캐릭터를 얻어 스토리를 클리어하면 열려요":"이 캐릭터로 스토리를 클리어하면 열려요",c.lock||!chars.owned(id)?"Get this character and clear the story to unlock":"Clear the story with this character to unlock")],"end").replace('<div class="cx-card','<div data-end="'+id+'" class="cx-card')}}
 else{for(const [th,cid,d,dEn] of MAPS){const c=chars.get(cid);all++;got++;html+=card(thumb(th),true,mapName(th),(c?tf(c,"name"):"")+tx("의 맵","'s map"),[tx(d,dEn)],"map")}}
 prog.innerHTML=tx("발견 ","Discovered ")+"<b>"+got+" / "+all+"</b>";body.innerHTML=html}
tabsEl.addEventListener("click",e=>{const b=e.target.closest("[data-cx]");if(!b)return;tab=b.dataset.cx;paint();body.scrollTop=0});
body.addEventListener("click",e=>{const c=e.target.closest("[data-end]");if(!c||!c.classList.contains("on"))return;intro.ending(()=>{startTitle();const f=body.querySelector('[data-end="'+c.dataset.end+'"]');if(f)f.focus&&f.focus()},c.dataset.end)});
pn.querySelector("[data-cx-close]").addEventListener("click",closeAndRefocus);pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
const btn=document.createElement("button");btn.id="codexButton";btn.className="menu-btn";btn.type="button";const sb=$("settingsButton");sb.parentNode.insertBefore(btn,sb);
function refreshBtn(){btn.textContent=tx("도감","Codex")}
btn.addEventListener("click",()=>{tab="chars";paint();openModal("codex",btn)});btn.addEventListener("mouseenter",()=>btn.focus({preventScroll:true}));
refreshBtn();window.__codexRelang=()=>{refreshBtn();if(!pn.classList.contains("hidden"))paint()};return{paint}})();
/* ================= 게임 방법 (탭: 기본 · 캐릭터 · 속성 · 특수) ================= */
const howtoUI=(()=>{const pn=$("howtoPanel");if(!pn)return{paint(){}};const grid=pn.querySelector(".howto-grid");if(!grid)return{paint(){}};
const css=document.createElement("style");css.textContent=".ht-tabs{display:flex;gap:6px;margin:4px 0 10px}.ht-tabs button{flex:1;padding:7px 4px;border:2px solid #6b4a2a;background:rgba(20,10,6,.6);color:#d8c6a0;cursor:pointer;font:inherit}.ht-tabs button.on{background:#ffb04a;border-color:#ffb04a;color:#2a0e08}#howtoPanel .howto-grid{max-height:56vh;overflow:auto;padding-right:4px}.ht-ch{display:flex;gap:10px;align-items:flex-start;padding:8px;margin-bottom:6px;background:rgba(0,0,0,.28);border:2px solid #2a3a2a}.ht-ch img{width:56px;height:56px;flex:none;image-rendering:pixelated;object-fit:contain}.ht-ch strong{color:#fff}.ht-ch small{display:block;color:#bfcfbf;line-height:1.45}.ht-ch em{font-style:normal;color:#ffcf6a}.ht-el{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;align-items:start}.ht-el b{font-weight:400}.ht-el small{color:#c8d8c8;line-height:1.45}";document.head.appendChild(css);
let tab="base";const bar=document.createElement("div");bar.className="ht-tabs";grid.before(bar);
const li=a=>"<ul>"+a.map(x=>"<li"+(x[1]?' class="'+x[1]+'"':"")+">"+x[0]+"</li>").join("")+"</ul>";
const card=(h3,body,wide)=>'<div class="howto-card'+(wide?" wide":"")+'"><h3>'+h3+"</h3>"+body+"</div>";
function base(){const sk=keyName(settings.skipKey||"n"),tk=keyName(settings.titleKey||"t");
 return card(tx("조작","Controls"),li([[tx("<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 또는 방향키로 이동","<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to move"),"kb-only"],[tx("공격은 <b>자동</b>으로 나가요","Attacks fire <b>automatically</b>")],[tx("<kbd>P</kbd> 일시정지 (지금 빌드 확인) · <kbd>F</kbd> 전체화면","<kbd>P</kbd> pause (see your build) · <kbd>F</kbd> fullscreen"),"kb-only"],[tx("<kbd>"+sk+"</kbd> 웨이브 스킵 · <kbd>"+tk+"</kbd> 타이틀로","<kbd>"+sk+"</kbd> skip wave · <kbd>"+tk+"</kbd> back to title"),"kb-only"],[tx("레벨업 때 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 선택 · <kbd>R</kbd> 다시 뽑기","On level-up: <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> to pick · <kbd>R</kbd> to reroll"),"kb-only"],[tx("타이틀에서 <kbd>M</kbd> 배경(맵) 바꾸기","<kbd>M</kbd> on the title screen changes the map"),"kb-only"],[tx("<b>화면을 누르고 드래그</b>하면 가상 조이스틱","<b>Press and drag</b> for a virtual joystick"),"touch-only"],[tx("오른쪽 위 <b>⏸</b> 일시정지 · <b>⏭</b> 스킵","Top right: <b>⏸</b> pause · <b>⏭</b> skip"),"touch-only"]]))
 +card(tx("목표","Goal"),li([[tx("적을 피하며 오래 살아남기","Survive as long as you can")],[tx("불씨 조각 <span class=\"gem\"></span> 을 모아 레벨업 · 강화 3개 중 1개 선택","Collect ember shards <span class=\"gem\"></span> to level up and pick 1 of 3 upgrades")],[tx("캐릭터마다 <b>고유 스킬</b>이 달라요","Every character has its own <b>unique skills</b>")],[tx("NIGHT 50의 최종 보스를 쓰러뜨리면 클리어","Defeat the final boss on NIGHT 50 to clear")]]))
 +card(tx("생존 팁","Tips"),li([[tx("10 NIGHT마다 <b>보스</b>, N45에는 <b>혼등의 마녀</b>가 나타나요.","A <b>boss</b> appears every 10 NIGHTs, and the <b>Lantern Witch</b> on N45.")],[tx("계속 움직이며 적을 한쪽으로 모으세요. 흡수 범위를 늘리면 레벨업이 빨라져요.","Keep moving and herd foes to one side. More pickup range = faster level-ups.")],[tx("<b>제단</b> 위에 5초 서 있으면 능력치 하나를 올릴 수 있어요. <b>보물 상자</b>는 오래 가는 보너스를 줘요.","Stand on an <b>altar</b> for 5s to raise a stat. <b>Treasure chests</b> give lasting bonuses.")],[tx("특정 강화를 함께 모으면 <b>무기 진화</b>가 일어나요 (레벨업 카드에 조합이 표시돼요).","Collect certain upgrades together for a <b>weapon evolution</b> (combos show on the cards).")],[tx("클리어하면 <b>클리어 코인</b>을 얻어요. 캐릭터 구매와 <b>강화 상점</b>(영구 성장)에 써요.","Clearing earns <b>clear coins</b> for new characters and the <b>upgrade shop</b> (permanent growth).")],[tx("본편을 클리어하면 <b>마법의 탑</b>이 열려요. 5층마다 수문장, 100층에 전설의 용이 기다려요.","Clearing the story opens the <b>Magic Tower</b>: a Warden every 5 floors, a legendary dragon on floor 100.")]]),true)}
function charsTab(){return'<div class="howto-card wide"><h3>'+tx("캐릭터","Characters")+'</h3>'+chars.list().map(c=>{const el2=CHAR_ELEM[c.id]&&ELEM[CHAR_ELEM[c.id]],own=chars.owned(c.id),T=c.id==="ignis"?IGN_EVO:CHAR_EVO[c.id];
 const unlock=c.lock?tx("사신 넷을 모두 Lv 40까지 진화시키면 해금","Unlocked by evolving all four guardians to Lv 40"):c.price?tx("코인 "+c.price+"개로 구매","Buy for "+c.price+" coins"):tx("기본 캐릭터","Starter character");
 return'<div class="ht-ch"><img alt="" src="'+c.img()+'" style="'+(own?"":"filter:brightness(.35)")+'"><div><strong>'+tf(c,"name")+'</strong> <em>'+tf(c,"kind")+'</em>'+(el2?' <span style="color:'+el2.c+'">'+el2.icon+' '+tf(el2,"n")+'</span>':'')
  +'<small>'+tx("무기","Weapon")+': '+tf(c.weapon,"name")+' · '+tx("능력","Ability")+': '+tf(c.ability,"name")+(c.passive?' · '+tx("패시브","Passive")+': '+tf(c.passive,"name"):"")+(c.special?' · '+tx("고유 매커니즘","Mechanic")+': '+tf(c.special,"name"):"")+'</small>'
  +'<small>'+tx("진화","Evolution")+': Lv20 '+(T&&T[1]?tf(T[1],"name"):"—")+' · Lv40 '+(T&&T[2]?tf(T[2],"name"):"—")+(c.id==="hwangryong"?tx(" (시련 보스를 쓰러뜨려야 진화)"," (defeat the trial boss to evolve)"):"")+'</small><small>'+(own?tx("✔ 보유","✔ Owned"):"🔒 "+unlock)+'</small></div></div>'}).join("")+'</div>'}
function elemTab(){const who=k=>chars.list().filter(c=>CHAR_ELEM[c.id]===k).map(c=>tf(c,"name")).join(", ");
 return'<div class="howto-card wide"><h3>'+tx("속성과 상태이상","Elements & Status Effects")+'</h3><div class="ht-el">'+Object.keys(ELEM).map(k=>{const E=ELEM[k];return'<b style="color:'+E.c+'">'+E.icon+' '+tf(E,"n")+' · '+tf(E,"fx")+'</b><small>'+tf(E,"d")+' <em style="color:#9db8a4">('+who(k)+')</em></small>'}).join("")+'</div>'
  +li([[tx("속성은 각 캐릭터의 <b>고유 공격과 고유 스킬</b>에만 붙어요.","Elements apply only to each character's <b>own attacks and unique skills</b>.")],[tx("보스는 감전 · 석화로 멈추지 않고 느려지기만 해요.","Bosses aren't frozen by Shock or Petrify — they're only slowed.")]])+'</div>'}
function specTab(){return card(tx("진화","Evolution"),li([[tx("한 판에서 <b>Lv 20 · Lv 40</b>이 되면 캐릭터가 진화해요. 외형이 바뀌고 스탯과 고유 능력이 강해져요.","At <b>Lv 20 and Lv 40</b> in a run, your character evolves: new look, better stats and stronger abilities.")],[tx("황룡은 진화 때마다 <b>황룡의 시련</b> 보스(도철 · 혼돈)를 쓰러뜨려야 해요.","Hwangryong must defeat a <b>Trial</b> boss (Taotie, then Hundun) to evolve.")]]),true)
 +card(tx("황룡 · 오행 봉인","Hwangryong · Five-Phase Seal"),li([[tx("8초 안에 한 적에게 <b>서로 다른 속성 3개</b>가 모이면 봉인 → 0.6초 뒤 폭발하며 주변에 속성을 퍼뜨려 연쇄를 일으켜요.","When <b>3 different elements</b> land on one foe within 8s it's sealed, then bursts 0.6s later and spreads elements for chain blasts.")],[tx("적 아래의 색 점이 모인 속성이에요. 혼돈은 봉인에 걸려야 질서를 되찾아요.","Colored dots under foes show gathered elements. Hundun only calms when sealed.")]]),true)
 +card(tx("기린 · 은총","Qilin · Grace"),li([[tx("낙인 찍힌 적이 쓰러지면 회복하고, 넘치는 회복은 <b>성스러운 보호막</b>이 돼요.","Branded foes heal you when they fall; overflow healing becomes a <b>holy shield</b>.")]]),true)
 +card(tx("하드 모드 · 칭호","Hard mode · Titles"),li([[tx("하드 모드는 디버프가 붙고 <b>캐릭터 패시브가 꺼져요</b>. 클리어 코인을 더 줘요.","Hard mode adds debuffs and <b>disables character passives</b>, but pays more coins.")],[tx("업적을 달성하면 <b>칭호</b>를 얻어요. 기록 · 업적 창의 칭호 탭에서 장착하세요.","Achievements grant <b>titles</b> — equip them in the Titles tab of Records.")],[tx("<b>도감</b>에서 만난 적 · 보스 · 맵 정보를 볼 수 있어요.","Check foes, bosses and maps you've met in the <b>Codex</b>.")]]),true)}
function paint(){const T=[["base",tx("기본","Basics")],["chars",tx("캐릭터","Characters")],["elem",tx("속성","Elements")],["spec",tx("특수","Special")]];
 bar.innerHTML=T.map(([k,n])=>'<button type="button" data-ht="'+k+'" class="'+(k===tab?"on":"")+'">'+n+'</button>').join("");
 grid.innerHTML=tab==="base"?base():tab==="chars"?charsTab():tab==="elem"?elemTab():specTab()}
bar.addEventListener("click",e=>{const b=e.target.closest("[data-ht]");if(!b)return;tab=b.dataset.ht;paint();grid.scrollTop=0});
const hb=$("howtoButton");if(hb)hb.addEventListener("click",()=>{tab="base";paint()},true);
window.__howtoPaint=paint;paint();return{paint}})();
/* ================= 난이도 선택 창 (이지 / 하드) ================= */
const diffUI=(()=>{
const css=document.createElement("style");
css.textContent=".df-mode{text-align:center;margin:-4px 0 12px;color:#ffcf6a;letter-spacing:.1em}.df-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}.df-card{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:16px 16px 14px;text-align:left;font:inherit;color:#e8dcc8;cursor:pointer;border:3px solid #3a2a1a;background:rgba(10,6,4,.62);transition:transform .1s,border-color .12s,background .12s}.df-card strong{font-size:26px;font-weight:400;letter-spacing:.12em}.df-card>span{color:#bfae88;margin-top:-4px}.df-card small{color:#d8c6a0;line-height:1.5}.df-easy strong{color:#7dff9a}.df-hard strong{color:#ff6a7a}.df-card:hover,.df-card:focus{outline:none;transform:translateY(-3px)}.df-easy:hover,.df-easy:focus{border-color:#7dff9a;background:rgba(20,40,24,.7)}.df-hard:hover,.df-hard:focus{border-color:#ff6a7a;background:rgba(48,10,14,.7)}.df-card ul{list-style:none;margin:2px 0 0;padding:0;font-size:.86em}.df-card li{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px dashed rgba(255,255,255,.08)}.df-card li i{font-style:normal;color:#bfae88}.df-card li b{font-weight:400;color:#ff8a94}.df-card li.df-x b{color:#ff4a5a}@media (max-width:680px){.df-cards{grid-template-columns:1fr}}@media (max-height:480px){.df-card{padding:8px 12px}.df-card strong{font-size:18px}.df-card ul{font-size:.78em}}";
css.textContent+=".df-cont{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;margin:0 0 6px;padding:12px 16px;font:inherit;color:#2a1a05;cursor:pointer;border:0;background:#c89aff;box-shadow:0 -3px 0 0 #e9dcff,0 3px 0 0 #6a3aa8,-3px 0 0 0 #e9dcff,3px 0 0 0 #6a3aa8;transition:transform .1s,background .12s}.df-cont strong{font-size:22px;font-weight:400;letter-spacing:.1em}.df-cont span{font-size:13px;color:#2a1446}.df-cont:hover,.df-cont:focus{outline:none;background:#e0c8ff;transform:translateY(-2px)}.df-cont-note{margin:0 0 12px;text-align:center;font-size:12px;color:#bfae88}.df-locked{opacity:.55;cursor:not-allowed;filter:grayscale(.6)}.df-locked:hover,.df-locked:focus{transform:none}.df-lock{display:block;font-style:normal;color:#ffcf6a;font-size:.9em;padding:4px 8px;margin:2px 0 4px;border:1px dashed rgba(255,207,106,.5)}.df-shake{animation:dfShake .3s}@keyframes dfShake{0%,100%{translate:0}25%{translate:-5px}75%{translate:5px}}";
document.head.appendChild(css);
const pn=document.createElement("div");pn.id="diffPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");ui.start.appendChild(pn);modals.diff=pn;let mode="story";
const pc=v=>Math.round(Math.abs(1-v)*100)+"%";
const hardOpen=()=>dbg.on||(mode==="tower"?rec.towerHardOpen():rec.storyHardOpen());
const lockText=()=>mode==="tower"?tx(`마법의 탑 이지 ${TOWER_HARD_UNLOCK}F 돌파 시 해금`,`Clear floor ${TOWER_HARD_UNLOCK} of the Magic Tower on Easy to unlock`)+tx(` · 현재 이지 최고 ${rec.floorEasy()||0}F`,` · Easy best: ${rec.floorEasy()||0}F`):tx("스토리 이지 클리어 시 해금","Clear Story on Easy to unlock");
function paint(){const H=HARD,lk=!hardOpen();pn.setAttribute("aria-label",tx("난이도 선택","Choose difficulty"));
 pn.innerHTML='<div class="panel modal-panel wide-panel"><p class="eyebrow">DIFFICULTY</p><h2>'+tx("난이도 선택","Choose Difficulty")+'</h2><p class="df-mode">'+(mode==="tower"?tx("마법의 탑","Magic Tower"):tx("스토리","Story"))+'</p>'+(mode==="tower"&&towerSave.read()?'<button type="button" class="df-cont" data-cont>'+'<strong>▶ '+tx("이어하기","Continue")+'</strong><span>'+towerSave.summary()+'</span></button><p class="df-cont-note">'+tx("아래에서 새로 시작하면 이어하기 기록이 지워져요","Starting a new climb below erases this save")+'</p>':'')+'<div class="df-cards">'
  +'<button type="button" class="df-card df-easy" data-d="easy"><strong>EASY</strong><span>'+tx("이지 · 기본 난이도","Easy · Standard")+'</span><small>'+tx("지금까지의 기본 난이도예요. 캐릭터의 모든 능력과 패시브를 그대로 쓸 수 있어요.","The standard difficulty. Every character ability and passive works as normal.")+(mode==="tower"?tx(` 마법의 탑 목숨 ${TOWER_LIVES.easy}개.`,` Magic Tower: ${TOWER_LIVES.easy} lives.`):"")+'</small></button>'
  +'<button type="button" class="df-card df-hard'+(lk?' df-locked':'')+'" data-d="hard"'+(lk?' aria-disabled="true"':'')+'><strong>'+(lk?'🔒 ':'')+'HARD</strong>'+(lk?'<em class="df-lock">'+lockText()+'</em>':'')+'<span>'+tx("하드 · 디버프 적용","Hard · Debuffs applied")+'</span><ul>'
  +[[tx("최대 체력","Max HP"),"-"+pc(H.hp)],[tx("공격력","Attack"),"-"+pc(H.atk)],[tx("받는 피해","Damage taken"),"+"+pc(H.dmgTaken)],[tx("이동 속도","Move speed"),"-"+pc(H.spd)],[tx("공격 속도","Attack speed"),"-"+pc(1/H.rate)],[tx("흡수 범위","Pickup range"),"-"+pc(H.pick)],[tx("경험치","EXP"),"-"+pc(H.xp)],[tx("모든 회복량","All healing"),"-"+pc(H.heal)]].map(([a,b])=>'<li><i>'+a+'</i><b>'+b+'</b></li>').join("")
  +(mode==="tower"?'<li class="df-x"><i>'+tx("탑 목숨","Tower lives")+'</i><b>'+TOWER_LIVES.easy+" → "+TOWER_LIVES.hard+'</b></li>':"")+'<li class="df-x"><i>'+tx("캐릭터 패시브","Character passive")+'</i><b>'+tx("비활성화","Disabled")+'</b></li></ul></button></div>'
  +'<div class="panel-actions"><button class="ghost-button big" type="button" data-df-close>'+tx("돌아가기","Back")+'</button></div></div>';
 const cb=pn.querySelector("[data-cont]");if(cb){cb.addEventListener("click",()=>{closeModals();towerSave.cont()});cb.addEventListener("mouseenter",()=>cb.focus({preventScroll:true}))}
 pn.querySelectorAll("[data-d]").forEach(b=>{b.addEventListener("click",()=>{if(b.dataset.d==="hard"&&!hardOpen()){b.classList.remove("df-shake");void b.offsetWidth;b.classList.add("df-shake");return}if(mode==="tower")towerSave.del();settings.diff=b.dataset.d;saveSettings();closeModals();startGame(mode,b.dataset.d)});b.addEventListener("mouseenter",()=>b.focus({preventScroll:true}))});
 pn.querySelector("[data-df-close]").addEventListener("click",closeAndRefocus)}
pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
return{open(m,opener){mode=m==="tower"?"tower":"story";paint();openModal("diff",opener);const f=pn.querySelector("[data-cont]")||pn.querySelector('[data-d="'+(settings.diff==="hard"&&hardOpen()?"hard":"easy")+'"]');if(f)f.focus({preventScroll:true})}}})();

/* ================= 마법의 탑 메뉴 버튼 (본편 클리어 시 해금) ================= */
const towerBtn=(()=>{const b=document.createElement("button");b.id="towerButton";b.className="menu-btn";b.type="button";
const sb=$("startButton");sb.parentNode.insertBefore(b,sb.nextSibling);
const open=()=>dbg.on||rec.towerOpen();let hintT=0;
function refresh(){clearTimeout(hintT);b.style.opacity=open()?"":".6";b.style.letterSpacing="";b.style.textIndent="";b.textContent=(open()?"":"🔒 ")+tx("마법의 탑","Magic Tower")}
b.addEventListener("click",()=>{if(open()){diffUI.open("tower",b);return}clearTimeout(hintT);b.style.letterSpacing="0";b.style.textIndent="0";b.textContent=tx("스토리 이지 클리어 시 해금","Clear Story on Easy to unlock");hintT=setTimeout(refresh,1600)});
b.addEventListener("mouseenter",()=>b.focus({preventScroll:true}));refresh();return{refresh}})();

/* ===== 보스 테스트 모드: 주소 끝에 ?debug 를 붙이면 활성화 ===== */
if(/[?&#]debug/.test(location.search+location.hash)){
dbg.on=true;
const live=()=>state&&state.p&&!state.dead&&!state.won&&!state.choosing&&!document.body.classList.contains("on-title");
const flash=t=>{if(state)state.banner={text:t,t:1.6}};
function dbgBoss(n){if(!live())return;
 state.enemies=state.enemies.filter(e=>!e.boss&&e.type!=="lantern");state.eb=[];state.dark=0;state.win=null;state.winDone=false;
 state.night=n*10;state.nightT=NIGHT_LEN;state.bossNight=true;state.bossSpawned=false;
 state.p.x=WW/2;state.p.y=WH/2+H*.22;state.paused=false;ui.pause.classList.add("hidden");spawnBoss(n);state.bossSpawned=true}
function dbgPower(){if(!live())return;const p=state.p;p.arrowDamage+=2;p.arrowPierce++;p.arrowRate=Math.max(.3,p.arrowRate*.85);for(const id in SK){const pool=p.charId==="ignis"?IUP_EXTRA:p.charId==="zhuque"?ZUP_RARITY:p.charId==="hyunmu"?HUP_RARITY:p.charId==="baekho"?BUP_RARITY:p.charId==="cheongryong"?CUP_RARITY:p.charId==="qilin"?QUP_RARITY:WUP_RARITY;if(pool[id]&&skL(p,id)<SK[id].max)SK[id].apply()}if(p.charId==="zhuque")p.feathers=Math.min(FEATHER_MAX,(p.feathers||0)+1);if(p.charId==="hyunmu"){p.barMax=(p.barMax||2)+1;p.bar=p.barMax}p.speed*=1.05;p.maxHp+=20;p.hp=p.maxHp;flash("테스트 강화 +1")}
function dbgKill(){if(!live())return;for(const e of state.enemies)if(e.boss)e.hp=0}
// 레벨업: +1은 평소처럼 강화 카드 선택, 레벨 지정은 카드 없이 바로 이동 (이그니 진화 확인용)
function dbgLevel(){if(!live())return;xp(state.next-state.xp)}
function dbgLevelTo(L){if(!live())return;if(state.level>=L){flash(`이미 Lv ${state.level}`);return}let n=8;for(let i=1;i<L;i++)n=nextNeed(n);state.level=L;state.next=n;state.xp=0;ignisEvoCheck();if(!state.banner||!/진화|Evolved/.test(state.banner.text))flash(`Lv ${L}`);hud()}
const box=document.createElement("div");
box.style.cssText="position:absolute;right:8px;bottom:8px;z-index:60;display:flex;flex-wrap:wrap;gap:4px;max-width:330px;justify-content:flex-end;padding:6px;border-radius:8px;background:rgba(5,11,9,.78);font:12px monospace;color:#f2e8cf";
const mk=(label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="font:12px monospace;padding:4px 7px;border:1px solid #6b5a1e;border-radius:6px;background:#1d2b22;color:#ffe58a;cursor:pointer";b.addEventListener("click",e=>{e.currentTarget.blur();fn(b)});box.appendChild(b);return b};
const tag=document.createElement("div");tag.textContent="TEST MODE · 키 1~5 보스 / 6 무적 / 7 잡몹 / 8 강화 / 9 처치 / 0 레벨업";tag.style.cssText="width:100%;text-align:right;color:#ff9aa8";box.appendChild(tag);
const names=["N10 재의 왕","N20 박쥐 군주","N30 바위 수호자","N40 올빼미","N50 최종보스"];
names.forEach((n,i)=>mk(n,()=>dbgBoss(i+1)));mk("N45 혼등의 마녀",()=>{if(!live())return;state.enemies=state.enemies.filter(e=>!e.boss&&e.type!=="lantern");state.eb=[];state.dark=0;state.win=null;state.winDone=false;state.night=WITCH_NIGHT;state.nightT=NIGHT_LEN;state.bossNight=true;state.bossSpawned=false;state.paused=false;ui.pause.classList.add("hidden");spawnBoss("witch");state.bossSpawned=true});
const god=()=>{dbg.god=!dbg.god;gb.textContent="무적 "+(dbg.god?"ON":"OFF");flash("무적 "+(dbg.god?"ON":"OFF"))};
const mob=()=>{dbg.nomob=!dbg.nomob;mb.textContent="잡몹 "+(dbg.nomob?"OFF":"ON");if(dbg.nomob&&state)state.enemies=state.enemies.filter(e=>e.boss);flash("잡몹 "+(dbg.nomob?"OFF":"ON"))};
const gb=mk("무적 OFF",god),mb=mk("잡몹 ON",mob);
mk("강화 +",dbgPower);mk("보스 처치",dbgKill);mk("레벨 +1",dbgLevel);mk("Lv 20",()=>dbgLevelTo(20));mk("Lv 40",()=>dbgLevelTo(40));
const dbgFloor=f=>{if(!live()||state.mode!=="tower"){flash("마법의 탑에서만 쓸 수 있어요");return}state.enemies=state.enemies.filter(e=>!e.boss);state.eb=[];state.dark=0;state.portal=null;state.floor=f;state.floorKills=0;state.floorTarget=floorTarget(f);state.wardenSpawned=false;state.paused=false;ui.pause.classList.add("hidden");flash(f+"F")};
mk("탑 5F 수문장",()=>dbgFloor(5));mk("탑 100F 용",()=>dbgFloor(100));
(canvas.closest(".game-frame")||document.body).appendChild(box);
window.addEventListener("keydown",e=>{if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;const k=e.key;
 if(k>="1"&&k<="5")dbgBoss(+k);else if(k==="6")god();else if(k==="7")mob();else if(k==="8")dbgPower();else if(k==="9")dbgKill();else if(k==="0")dbgLevel()});
}
/* ================= 언어 전환: 화면 텍스트 (data-i18n 키 → 영어) ================= */
const I18N_EN={
aGame:`Game screen`,aCanvas:`Pixel survival game`,aHud:`Game status`,aTitle:`Title screen`,aMenu:`Main menu`,aSettings:`Settings`,aHowto:`How to Play`,aSkipKey:`Change wave skip key`,logo:`PIXEL SURVIVAL — The Last Ember`,mapTitle:`Change title background (M)`,
shards:`Ember shards`,time:`Time`,kills:`Kills`,pauseTop:`⏸ Pause`,titleTop:`⌂ Title`,skipTop:`⏭ Skip<span class="kb-only"> (<span class="skip-key-label">N</span>)</span>`,restartTop:`New game ↻`,
mapCap:`Scene`,tagline:`A baby dragon and the guardian beasts protect the last ember.<br>Gather the scattered ember shards and rekindle a fading world.`,
play:`Play`,settings:`Settings`,howto:`How to Play`,titleHint:`<kbd>↑</kbd><kbd>↓</kbd> Select · <kbd>Enter</kbd> Confirm · <kbd>F</kbd> Fullscreen`,version:`V0.37 · Guardians and Spirit Beasts`,
langHint:`Change the language used in the game`,
rowFs:`<strong>Fullscreen</strong><small>You can also toggle it with the F key</small>`,
rowFont:`<strong>Pixel font</strong><small>ON: dotted pixel letters · OFF: smooth regular font, easier to read (logo stays pixel)</small>`,
rowFx:`<strong>Ember effect</strong><small>Show embers drifting through the forest</small>`,
rowVig:`<strong>Dark screen edges</strong><small>Vignette effect for a night mood</small>`,
rowAuto:`<strong>Auto pause</strong><small>Pause the game when you leave the window</small>`,
rowSkip:`Wave skip key`,back:`Back`,
h3Controls:`Controls`,h3Goal:`Goal`,h3Foes:`Forest Foes`,h3Tips:`Survival Tips`,
hMove:`<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to move`,
hAuto:`Attacks fire <b>automatically</b>`,
hPause:`<kbd>P</kbd> Pause · <kbd>F</kbd> Fullscreen`,
hSkip:`<kbd class="skip-key-label">N</kbd> Skip wave <small>(not during boss fights · change the key in Settings)</small>`,
hSkipT:`Tap <b>⏭ Skip</b> at the top right to skip a wave <small>(not during boss fights)</small>`,
hJoy:`<b>Touch and drag</b> the screen to bring up a virtual joystick`,
hPauseT:`Tap <b>⏸</b> at the top right to pause`,
g1:`Survive as long as you can against the creatures of the cooling woods`,
g2:`Collect the ember shards <span class="gem"></span> that enemies drop to level up`,
g3:`Pick 1 of 3 upgrades each time you level up`,
foe1:`Ash Blob<small>Basic foe</small>`,foe2:`Frost Bat<small>Fast but weak</small>`,foe3:`Frost Rock<small>Tough and hits hard</small>`,
t1:`When the 10th NIGHT ends, a <b>boss</b> appears. Defeat it to move on to the next NIGHT — you'll heal and a shower of ember shards will drop.`,
t2:`Standing still gets you surrounded. Keep moving and herd enemies to one side.`,
t3:`A bigger shard pickup range makes leveling up much faster.`,
t4:`Open the <b>lava treasure chests</b> hidden in the woods for long-lasting bonus items.`,
chooseUp:`Choose an upgrade`,overTitle:`Your ember is still too weak.`,finalStats:`Time 00:00 · Kills 0`,retry:`Try again`,toTitle:`Title`,
pauseBadge:`Paused · <span class="kb-only">Press P to resume</span><span class="touch-only">Tap to resume</span>`,
rotate:`<span class="phone">📱</span>Please rotate your screen to <b>landscape</b><br><small>Landscape mode gives you a wider view</small>`,
endTitle:`Ignis made it home`,endText:`As the Chilling Shadow faded, the scattered embers lit the way back to the nest. The Mother Flame blazes once more.`,
t6:`Stand on an <b>altar</b> for 5 seconds to fill its gauge and pick a pure stat boost — attack, regeneration, max HP and more.`,
t5:`Clear the story to unlock the <b>Magic Tower</b>. Defeat enough foes on each floor to open the portal — every 5th floor, the Warden awaits. Every 100th floor, a legendary dragon appears. Each floor cleared grants a treasure item, and the tower grows harder as you climb.`,
recTitle:`Records · Achievements`,recAria:`Records and achievements`,tabR:`Records`,tabA:`Achievements`,tabC:`Challenges`,tabT:`Titles`,charTitle:`Characters`
};
function applyLang(){
 const E=isEN();document.documentElement.lang=E?"en":"ko";document.title=E?"PIXEL SURVIVAL · The Last Ember":"PIXEL SURVIVAL · 최후의 불씨";
 document.querySelectorAll("[data-i18n]").forEach(el=>{if(el.dataset.ko==null)el.dataset.ko=el.innerHTML;const en=I18N_EN[el.dataset.i18n];el.innerHTML=E&&en!=null?en:el.dataset.ko});
 for(const [sel,attr,key] of [["[data-i18n-aria]","aria-label","i18nAria"],["[data-i18n-title]","title","i18nTitle"]])
  document.querySelectorAll(sel).forEach(el=>{const ko=key+"Ko";if(el.dataset[ko]==null)el.dataset[ko]=el.getAttribute(attr)||"";const en=I18N_EN[el.dataset[key]];el.setAttribute(attr,E&&en!=null?en:el.dataset[ko])});
 syncSkipKey();if(skipKeyHint&&!listening)skipKeyHint.textContent=skipHint();syncMapBtn();rec.relang();chars.relang();if(window.__howtoPaint)window.__howtoPaint();if(window.__codexRelang)window.__codexRelang();if(window.__questRelang)window.__questRelang();if(window.__menuRelang)window.__menuRelang();if(window.__backupRelang)window.__backupRelang();if(window.__cloudRelang)window.__cloudRelang();logo.relang();towerBtn.refresh();syncSettings()}
$("langButton").addEventListener("click",()=>{settings.lang=isEN()?"ko":"en";saveSettings();applyLang()});
/* ================= 사운드: 칩튠 BGM (타이틀 / 인게임 / 마법의 탑) + 효과음 =================
   음원 파일 없이 Web Audio로 직접 연주해요. 곡마다 약 4분 길이로 구성되어 끝나면 처음부터 반복돼요.
   볼륨 기본값은 SOUND_DEF, 곡 구성은 SONGS에서 바꿀 수 있어요. */
const SOUND_DEF={master:.8,bgm:.55,atk:.6,sfx:.7};
const audio=(()=>{
const V=()=>{const v=settings.vol&&typeof settings.vol==="object"?settings.vol:(settings.vol={});for(const k in SOUND_DEF)if(typeof v[k]!=="number")v[k]=SOUND_DEF[k];return v};
let ac=null,master,comp,bus={},mus,dly,nb,W={},sched=0,cur=null,want="title",pos=null,nextT=0,duckV=1,lastKick=0;
const MUS_V=1.5,midi=n=>440*Math.pow(2,(n-69)/12);
/* 배경음악 mp3 — 같은 폴더에 파일이 있으면 그 곡을, 없으면(또는 파일을 직접 열었을 때) 코드로 만든 8비트 곡을 틀어요.
   FILE_V: mp3 음량 (8비트 곡과 비슷한 크기로 맞춘 값) · 오방천궁 · 구름 성소는 전용 8비트 곡을 그대로 써요 */
const TRACKS={title:"bgm_title.mp3",tower:"bgm_tower.mp3",field:"bgm_field.mp3"},FILE_V=.42,fbuf={};let fsrc=null,fileG=null;
function loadTracks(){if(!/^https?:$/.test(location.protocol))return;for(const k in TRACKS)fetch(TRACKS[k]).then(r=>{if(!r.ok)throw 0;return r.arrayBuffer()}).then(a=>new Promise((res,rej)=>ac.decodeAudioData(a,res,rej))).then(b=>{fbuf[k]=b;if(cur===k&&!fsrc)cur="__swap"}).catch(()=>{})}
function stopFile(){if(fsrc){try{fsrc.stop()}catch(_){}try{fsrc.disconnect()}catch(_){}fsrc=null}}
function pulseWave(d){const N=32,re=new Float32Array(N),im=new Float32Array(N);for(let n=1;n<N;n++){re[n]=Math.sin(2*Math.PI*n*d)/(Math.PI*n);im[n]=(1-Math.cos(2*Math.PI*n*d))/(Math.PI*n)}return ac.createPeriodicWave(re,im)}
function init(){if(ac)return true;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;
 try{ac=new AC()}catch(_){ac=null;return false}
 comp=ac.createDynamicsCompressor();comp.threshold.value=-12;comp.knee.value=8;comp.ratio.value=5;comp.attack.value=.004;comp.release.value=.18;comp.connect(ac.destination);
 master=ac.createGain();master.connect(comp);for(const k of["bgm","atk","sfx"]){bus[k]=ac.createGain();bus[k].connect(master)}
 mus=ac.createGain();mus.gain.value=0;mus.connect(bus.bgm);
 dly=ac.createDelay(1);const fb=ac.createGain(),wet=ac.createGain();fb.gain.value=.3;wet.gain.value=.26;dly.connect(fb);fb.connect(dly);dly.connect(wet);wet.connect(mus);
 const len=ac.sampleRate*2,b=ac.createBuffer(1,len,ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;nb=b;
 W.p12=pulseWave(.125);W.p25=pulseWave(.25);W.p50=pulseWave(.5);
 apply();sched=setInterval(tick,25);loadTracks();
 document.addEventListener("visibilitychange",()=>{if(!ac)return;if(document.hidden)ac.suspend().catch(()=>{});else ac.resume().catch(()=>{})});
 return true}
const curve=v=>Math.pow(Math.max(0,Math.min(1,v)),1.6);
function apply(){if(!ac)return;const v=V(),t=ac.currentTime;master.gain.setTargetAtTime(settings.mute?0:curve(v.master),t,.03);bus.bgm.gain.setTargetAtTime(curve(v.bgm),t,.03);bus.atk.gain.setTargetAtTime(curve(v.atk),t,.03);bus.sfx.gain.setTargetAtTime(curve(v.sfx),t,.03)}
function unlock(){if(!init())return;if(ac.state==="suspended"&&!document.hidden)ac.resume().catch(()=>{})}
for(const ev of["pointerdown","keydown","touchstart"])window.addEventListener(ev,unlock,{capture:true,passive:true});

/* ---------- 악기 ---------- */
function tone(dest,t,f,dur,vol,wave,o={}){const os=ac.createOscillator(),g=ac.createGain();
 if(typeof wave==="string")os.type=wave;else os.setPeriodicWave(wave);os.frequency.setValueAtTime(f,t);if(o.to)os.frequency.exponentialRampToValueAtTime(Math.max(20,o.to),t+(o.glide||dur));
 if(o.vib){const l=ac.createOscillator(),lg=ac.createGain();l.frequency.value=5.5;lg.gain.setValueAtTime(0,t);lg.gain.linearRampToValueAtTime(f*.012,t+Math.min(dur,.25));l.connect(lg);lg.connect(os.frequency);l.start(t);l.stop(t+dur+.05)}
 const a=o.a??.004,s=o.sus??.6;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+a);g.gain.exponentialRampToValueAtTime(Math.max(.0008,vol*s),t+Math.max(a+.001,dur*.7));g.gain.linearRampToValueAtTime(0,t+dur+(o.rel??.03));
 os.connect(g);g.connect(dest);if(o.send)g.connect(dly);os.start(t);os.stop(t+dur+(o.rel??.03)+.02)}
function noise(dest,t,dur,vol,o={}){const s=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain();s.buffer=nb;f.type=o.type||"highpass";f.frequency.setValueAtTime(o.f||6000,t);if(o.to)f.frequency.exponentialRampToValueAtTime(o.to,t+dur);f.Q.value=o.q||.8;
 g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+(o.a||.002));g.gain.exponentialRampToValueAtTime(.0008,t+dur);s.connect(f);f.connect(g);g.connect(dest);s.start(t,Math.random()*1.5);s.stop(t+dur+.02)}
const DR={
 k:(t,v,heavy)=>{tone(mus,t,heavy?120:150,heavy?.22:.14,.9*v,"sine",{to:heavy?38:45,glide:heavy?.18:.11,sus:.3,a:.002});noise(mus,t,.02,.12*v,{f:3000})},
 s:(t,v)=>{noise(mus,t,.16,.42*v,{type:"bandpass",f:1900,q:.9});tone(mus,t,190,.07,.25*v,"triangle",{to:130,sus:.3})},
 h:(t,v)=>noise(mus,t,.035,.16*v,{f:7500}),
 o:(t,v)=>noise(mus,t,.16,.12*v,{f:6500}),
 c:(t,v)=>noise(mus,t,1.1,.2*v,{f:4500,to:9000})};
/* ---------- 곡 데이터 ----------
   lead/hook: 16칸 = 1마디, 숫자 = 음계 단계(0 = 으뜸음), '-' = 이어서, '.' = 쉼표 */
const SC={minor:[0,2,3,5,7,8,10],harm:[0,2,3,5,7,8,11],pyeong:[0,2,5,7,9],penta:[0,2,4,7,9]};
const DP={
 none:{},
 light:{k:"x.......x.......",h:"..x...x...x...x."},
 soft:{k:"x.........x.....",h:"..x...x...x...x.",s:"............x..."},
 half:{k:"x.......x.......",s:"........x.......",h:"x.x.x.x.x.x.x.x."},
 full:{k:"x...x...x...x...",s:"....x.......x...",h:"x.x.x.x.x.x.x.x.",o:"..............x."},
 drive:{k:"x..x..x.x..x..x.",s:"....x.......x..x",h:"xxxxxxxxxxxxxxxx"},
 march:{k:"x..xx...x..xx...",s:"....x..x....x.xx",h:"x.x.x.x.x.x.x.x."},
 build:{k:"x...x...x...x..."},
 jang:{k:"x.....x...x.....",s:"...x.....x....x.",h:"x..x..x.x..x..x."},
 gong:{k:"x.......x.......",s:"........x.......",o:"x...............",h:"..x...x...x...x."}};
const BUILD_S=["....x.......x...","..x...x...x...x.","x.x.x.x.x.x.x.x.","xxxxxxxxxxxxxxxx"];
const FILL_S="....x...x.x.xxxx";
const SONGS={
 title:{bpm:92,root:69,arpOct:0,padOct:-12,scale:"minor",lead:"tri",leadV:.2,arpV:.06,bassV:.24,padV:.05,
  hooks:{A:"4 - - - - - 7 - 6 - 4 - - - 2 - | 5 - - - - - - - 4 - 2 - 4 - - - | 6 - - - - - 4 - 6 - 7 - 9 - - - | 8 - - - - - - - 7 - 6 - 3 - - -",
         B:"7 - - - 5 - - - 3 - 5 - 7 - 8 - | 9 - - - - - - - 7 - - - 4 - - - | 5 - - - 7 - - - 9 - 11 - 9 - 7 - | 8 - - - - - - - - - - - . . . ."},
  progs:{A:[0,5,2,6],B:[3,0,5,4],C:[5,6,0,0]},
  sections:[
   {bars:8,prog:"A",drums:"none",bass:"long",arp:1,pad:1},
   {bars:16,prog:"A",drums:"light",bass:"long",arp:1,pad:1,lead:"A"},
   {bars:16,prog:"B",drums:"soft",bass:"eighth",arp:1,pad:1,lead:"B"},
   {bars:16,prog:"A",drums:"soft",bass:"eighth",arp:2,pad:0,lead:"A",oct:1},
   {bars:8,prog:"C",drums:"none",bass:"long",arp:1,pad:1},
   {bars:16,prog:"B",drums:"soft",bass:"eighth",arp:2,pad:1,lead:"gen",seed:7},
   {bars:12,prog:"A",drums:"light",bass:"long",arp:1,pad:1,lead:"A"}]},
 field:{bpm:140,root:62,scale:"minor",lead:"p25",leadV:.13,arpV:.045,bassV:.3,padV:.035,
  hooks:{A:"4 - 7 - 4 - 2 - 4 - - 3 2 - 0 - | 2 - 5 - 7 - 5 - 4 - 2 - 0 - - - | 6 - 4 - 6 - 7 - 9 - - 7 6 - 4 - | 3 - 1 - 3 - 6 - 5 - - - 4 - - -",
         B:"7 - - - 5 - 7 - 8 - 7 - 5 - 3 - | 6 - - - 8 - - - 10 - 9 - 8 - - - | 9 - - - 7 - 6 - 4 - 6 - 7 - - - | 5 - - - 4 - 5 - 7 - - - . . 4 -"},
  progs:{A:[0,5,2,6],B:[3,6,2,5],C:[5,6,0,0],D:[5,6,3,4]},
  sections:[
   {bars:8,prog:"A",drums:"light",bass:"eighth",arp:1},
   {bars:16,prog:"A",drums:"full",bass:"drive",arp:1,lead:"A"},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,lead:"A",oct:1},
   {bars:16,prog:"B",drums:"half",bass:"eighth",arp:1,pad:1,lead:"B"},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,lead:"gen",seed:3},
   {bars:8,prog:"C",drums:"none",bass:"long",arp:1,pad:1},
   {bars:8,prog:"D",drums:"build",bass:"eighth",arp:2},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,lead:"A",crash:1},
   {bars:16,prog:"B",drums:"full",bass:"drive",arp:2,pad:1,lead:"B",oct:1},
   {bars:16,prog:"A",drums:"full",bass:"drive",arp:1,lead:"gen",seed:11},
   {bars:4,prog:"A",drums:"half",bass:"eighth",arp:1}]},
 palace:{bpm:108,root:62,scale:"pyeong",lead:"flute",leadV:.15,arpV:.05,arpW:"pluck",arpOct:12,bassV:.28,padV:.05,padOct:-12,heavy:1,
  hooks:{A:"5 - - - 4 - 3 - 4 - - - 2 - 3 - | 4 - - - - - 3 - 2 - 0 - 2 - - - | 3 - - - 4 - 5 - 7 - - - 6 - 5 - | 4 - - - - - - - 3 - 2 - 3 - - -",
         B:"7 - - - - - 6 - 5 - - - 4 - 5 - | 6 - - - 5 - 4 - 3 - - - - - - - | 2 - 3 - 4 - - - 5 - 4 - 3 - 2 - | 0 - - - - - - - - - - - . . . ."},
  progs:{A:[0,3,1,4],B:[2,0,3,4],C:[0,0,3,3]},
  sections:[
   {bars:8,prog:"C",drums:"gong",bass:"long",arp:1,pad:1},
   {bars:16,prog:"A",drums:"jang",bass:"long",arp:1,pad:1,lead:"A"},
   {bars:16,prog:"B",drums:"march",bass:"pulse",arp:1,lead:"B"},
   {bars:16,prog:"A",drums:"march",bass:"pulse",arp:2,lead:"A",oct:1,crash:1},
   {bars:8,prog:"C",drums:"gong",bass:"long",pad:1},
   {bars:16,prog:"A",drums:"jang",bass:"eighth",arp:1,pad:1,lead:"gen",seed:4},
   {bars:16,prog:"B",drums:"march",bass:"pulse",arp:2,lead:"B",oct:1},
   {bars:4,prog:"C",drums:"gong",bass:"long",pad:1}]},
 cloud:{bpm:92,root:67,scale:"penta",lead:"flute",leadV:.14,arpV:.055,arpW:"pluck",arpOct:12,bassV:.2,padV:.06,padOct:-12,
  hooks:{A:"4 - - - 5 - 7 - 6 - - - 5 - 4 - | 2 - - - - - - - 4 - 5 - 4 - - - | 5 - - - 6 - 7 - 9 - - - 7 - 6 - | 5 - - - - - - - 4 - - - . . . .",
         B:"7 - - - - - 9 - 7 - 6 - 5 - - - | 4 - - - 5 - 4 - 2 - - - - - - - | 3 - 4 - 5 - - - 7 - - - 6 - 5 - | 4 - - - - - - - - - - - . . . ."},
  progs:{A:[0,3,1,2],B:[3,2,0,4],C:[0,3,0,3]},
  sections:[
   {bars:8,prog:"C",drums:"none",bass:"long",arp:1,pad:1},
   {bars:16,prog:"A",drums:"light",bass:"long",arp:1,pad:1,lead:"A"},
   {bars:16,prog:"B",drums:"soft",bass:"eighth",arp:1,pad:1,lead:"B"},
   {bars:16,prog:"A",drums:"soft",bass:"eighth",arp:2,lead:"A",oct:1},
   {bars:8,prog:"C",drums:"none",bass:"long",pad:1},
   {bars:16,prog:"A",drums:"soft",bass:"eighth",arp:2,pad:1,lead:"gen",seed:9},
   {bars:16,prog:"B",drums:"light",bass:"long",arp:1,pad:1,lead:"B"},
   {bars:4,prog:"C",drums:"none",bass:"long",pad:1}]},
 tower:{bpm:124,root:64,scale:"harm",lead:"sq",leadV:.1,arpV:.05,bassV:.3,padV:.05,heavy:1,
  hooks:{A:"0 - 4 - 7 - 4 - 6 - 7 - 4 - 2 - | 5 - - - 4 - 5 - 7 - - - 9 - 7 - | 3 - 5 - 7 - 5 - 8 - 7 - 5 - 3 - | 4 - - - 6 - - - 1 - 2 - 1 - -1 -",
         B:"7 - - - 8 - 7 - 5 - - - 3 - 5 - | 9 - - - - - 7 - 9 - 11 - 9 - 7 - | 8 - - - 6 - - - 4 - 6 - 8 - - - | 7 - - - - - - - . . 4 - 6 - 7 -"},
  progs:{A:[0,5,3,4],B:[3,5,4,0],C:[0,1,0,1],D:[5,3,4,4]},
  sections:[
   {bars:8,prog:"C",drums:"light",bass:"pulse",arp:0,pad:1},
   {bars:16,prog:"A",drums:"march",bass:"pulse",arp:1,pad:1,lead:"A"},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,lead:"A",oct:1},
   {bars:16,prog:"B",drums:"march",bass:"pulse",arp:1,pad:1,lead:"B"},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,lead:"gen",seed:5},
   {bars:8,prog:"C",drums:"none",bass:"long",arp:1,pad:1},
   {bars:8,prog:"D",drums:"build",bass:"pulse",arp:2},
   {bars:16,prog:"A",drums:"drive",bass:"drive",arp:2,pad:1,lead:"A",crash:1},
   {bars:16,prog:"B",drums:"march",bass:"drive",arp:2,lead:"B",oct:1},
   {bars:4,prog:"C",drums:"half",bass:"pulse",arp:1}]}};
// 훅 문자열 해석: 공백으로 나눈 64칸 (숫자 = 음계 단계, '-' = 이어서, '.' = 쉼표, '|' = 마디 구분)
function prepHook(str){const a=str.split(/\s+/).filter(x=>x&&x!=="|").map(x=>x==="-"||x==="."?x:+x);if(a.length!==64)console.warn("hook length",a.length);while(a.length<64)a.push(".");return a.slice(0,64)}
for(const k in SONGS){const S=SONGS[k];S.step=60/S.bpm/4;S.sc=SC[S.scale];for(const h in S.hooks)S.hooks[h]=prepHook(S.hooks[h]);S.total=S.sections.reduce((a,s)=>a+s.bars,0);S.len=S.total*16*S.step}
const deg=(S,d)=>{const L=S.sc.length,o=Math.floor(d/L);return S.root+S.sc[((d%L)+L)%L]+12*o};
// 'gen' 섹션: 시드로 만든 4마디 프레이즈 (1·2마디 동기 반복, 4마디는 긴 음으로 마무리)
const RH=["x.x.x-x.x.x-x---","x---x-x-x---x-x-","x-xx-x-xx-x-x---","x--x--x-x-x-x---","x-x-x---x-xxx---"];
function genLead(S,prog,seed){let r=seed*9301+49297;const rnd=()=>(r=(r*9301+49297)%233280)/233280;const out=[];let prev=7;
 const r1=RH[Math.floor(rnd()*RH.length)],r2=RH[Math.floor(rnd()*RH.length)];
 for(let b=0;b<4;b++){const rh=b===3?"x---x---x-------":b===2?r1:(b?r2:r1),ch=prog[b%prog.length];
  for(let i=0;i<16;i++){const c=rh[i];if(c!=="x"){out.push(c==="-"?"-":".");continue}
   const strong=i%4===0,tones=[ch,ch+2,ch+4,ch+7,ch+9].filter(d=>d>=3&&d<=11);let n;
   if(strong||!tones.length)n=tones.length?tones.reduce((a,d)=>Math.abs(d-prev)<Math.abs(a-prev)?d:a,tones[0]):prev;else n=prev+(rnd()<.5?1:-1)*(rnd()<.7?1:2);
   if(b===3&&i===8)n=ch+7>11?ch:ch+7;n=Math.max(2,Math.min(12,n));out.push(n);prev=n}}
 return out}
for(const k in SONGS){const S=SONGS[k];for(const s of S.sections)if(s.lead==="gen")s.gen=genLead(S,S.progs[s.prog],s.seed||1)}

function play(name){if(!ac)return;stopFile();
 if(fbuf[name]&&settings.bgmFile!==false){cur=name;pos=null;if(!fileG){fileG=ac.createGain();fileG.gain.value=FILE_V;fileG.connect(mus)}const b=ac.createBufferSource();b.buffer=fbuf[name];b.loop=true;b.connect(fileG);b.start(ac.currentTime+.05);fsrc=b;
  mus.gain.cancelScheduledValues(ac.currentTime);mus.gain.setValueAtTime(0,ac.currentTime);mus.gain.linearRampToValueAtTime(MUS_V*duckV,ac.currentTime+.8);return}
 const S=SONGS[name];if(!S)return;cur=name;pos={S,sec:0,bar:0,st:0};nextT=ac.currentTime+.12;
 mus.gain.cancelScheduledValues(ac.currentTime);mus.gain.setValueAtTime(0,ac.currentTime);mus.gain.linearRampToValueAtTime(MUS_V*duckV,ac.currentTime+.8)}
function stepNote(t){const P=pos,S=P.S,sec=S.sections[P.sec],prog=S.progs[sec.prog],ch=prog[P.bar%prog.length],i=P.st,sd=S.step,lastBar=P.bar===sec.bars-1;
 // 드럼
 const dp=DP[sec.drums]||{},hv=S.heavy;
 if(dp.k&&dp.k[i]==="x")DR.k(t,1,hv);
 let sn=dp.s;if(sec.drums==="build")sn=BUILD_S[Math.min(3,Math.floor(P.bar/2))];else if(lastBar&&sec.drums!=="none"&&sec.drums!=="light"&&P.sec<S.sections.length-1)sn=FILL_S;
 if(sn&&sn[i]==="x")DR.s(t,sec.drums==="build"?.45+.55*(P.bar/(sec.bars-1||1))*(i/16*.4+.6):1);
 if(dp.h&&dp.h[i]==="x")DR.h(t,i%4===0?1:.7);if(dp.o&&dp.o[i]==="x")DR.o(t,1);
 if(sec.crash&&P.bar===0&&i===0)DR.c(t,1);
 // 베이스
 const bn=deg(S,ch)-24,bv=S.bassV;
 if(sec.bass==="long"&&i===0)tone(mus,t,midi(bn),sd*15,bv,"triangle",{sus:.8,a:.02});
 if(sec.bass==="eighth"&&i%2===0)tone(mus,t,midi(bn+(i%8===4?12:0)),sd*1.7,bv,"triangle",{sus:.7});
 if(sec.bass==="drive")tone(mus,t,midi(bn+(i%4===2?12:i%8===6?7:0)),sd*.9,bv,"triangle",{sus:.6});
 if(sec.bass==="pulse"&&(i%4===0||i%4===3))tone(mus,t,midi(bn),sd*(i%4===0?2.6:.8),bv,"triangle",{sus:.7});
 // 아르페지오 (화음 구성음을 빠르게)
 if(sec.arp&&(sec.arp===2||i%2===0)){const seq=[0,2,4,7,4,2],k=(sec.arp===2?i:i/2)%seq.length;tone(mus,t,midi(deg(S,ch+seq[k])+(S.arpOct??12)),sd*(S.arpW==="pluck"?2.4:.85),S.arpV,S.arpW==="pluck"?"triangle":W.p12,{sus:S.arpW==="pluck"?.12:.4})}
 // 패드 (마디 첫 박에 화음 길게)
 if(sec.pad&&i===0)for(const d of[0,2,4])tone(mus,t,midi(deg(S,ch+d)+(S.padOct||0)),sd*16,S.padV,"triangle",{a:.25,sus:.85,rel:.2});
 // 리드 멜로디
 const L=sec.lead?(sec.lead==="gen"?sec.gen:S.hooks[sec.lead]):null;
 if(L){const idx=(P.bar%4)*16+i,n=L[idx];if(typeof n==="number"){let len=1;while(idx+len<64&&L[idx+len]==="-")len++;
  const f=midi(deg(S,n+(sec.oct?7:0))),dur=sd*len*.92,wv=S.lead==="tri"||S.lead==="pluck"?"triangle":S.lead==="sq"?W.p50:S.lead==="flute"?"sine":W.p25;
  tone(mus,t,f,dur,S.leadV*(S.lead==="tri"?1.4:S.lead==="flute"?1.7:1),wv,{sus:S.lead==="pluck"?.12:.55,vib:len>=4||(S.lead==="flute"&&len>=2),send:1,a:S.lead==="flute"?.05:.004});if(S.lead==="flute"&&len>=2)noise(mus,t,.06,.025,{type:"bandpass",f:2400,q:1.2})}}
 // 진행
 P.st++;if(P.st>=16){P.st=0;P.bar++;if(P.bar>=sec.bars){P.bar=0;P.sec++;if(P.sec>=S.sections.length)P.sec=0}}}
let fadeEnd=0;
function tick(){if(!ac||ac.state!=="running")return;const now=ac.currentTime;
 if(want!==cur){if(cur&&!fadeEnd){fadeEnd=now+.5;mus.gain.cancelScheduledValues(now);mus.gain.setValueAtTime(mus.gain.value,now);mus.gain.linearRampToValueAtTime(0,fadeEnd)}
  if(!cur||now>=fadeEnd){fadeEnd=0;play(want)}else return}
 else if(fadeEnd){fadeEnd=0;mus.gain.cancelScheduledValues(now);mus.gain.setValueAtTime(mus.gain.value,now);mus.gain.linearRampToValueAtTime(MUS_V*duckV,now+.3)}
 if(!pos)return;if(nextT<now-.3)nextT=now+.05;
 while(nextT<now+.14){stepNote(nextT);nextT+=pos.S.step}}
function setDuck(v){if(!ac||v===duckV)return;duckV=v;if((pos||fsrc)&&!fadeEnd&&cur){const t=ac.currentTime;mus.gain.cancelScheduledValues(t);mus.gain.setValueAtTime(mus.gain.value,t);mus.gain.linearRampToValueAtTime(MUS_V*v,t+.35)}}

/* ---------- 효과음 ---------- */
const last={},GAP={hit:.045,kill:.04,gem:.05,bolt:.05,water:.06,feather:.06,qi:.08,whip:.08,boom:.09,fboom:.07,pulse:.15,hurt:.12,ui:.04};
let gemN=0,gemT=0;
const FX={
 bolt:(t,A)=>{tone(A,t,980,.075,.16,W.p25,{to:380,sus:.3});noise(A,t,.03,.05,{f:5000})},
 qi:(t,A)=>{noise(A,t,.16,.28,{type:"bandpass",f:700,to:3200,q:1.4,a:.01});tone(A,t,520,.1,.1,"sawtooth",{to:1100,sus:.3})},
 whip:(t,A)=>{noise(A,t,.11,.3,{type:"bandpass",f:3000,to:700,q:2,a:.01});noise(A,t+.07,.035,.25,{f:4000});tone(A,t+.07,1500,.03,.08,W.p12,{to:700})},
 water:(t,A)=>{tone(A,t,320,.09,.2,"sine",{to:950,sus:.4});tone(A,t+.03,500,.05,.08,"sine",{to:1300,sus:.3})},
 feather:(t,A)=>{tone(A,t,1500,.05,.08,W.p12,{to:2300,sus:.3});tone(A,t+.04,1700,.05,.06,W.p12,{to:2600,sus:.3})},
 boom:(t,A)=>{noise(A,t,.55,.5,{type:"lowpass",f:1200,to:110,a:.005});tone(A,t,95,.38,.45,"sine",{to:38,sus:.3})},
 zap:(t,A)=>{noise(A,t,.08,.22,{type:"bandpass",f:5200,q:3});tone(A,t,1400,.07,.07,W.p12,{to:420,sus:.3});tone(A,t+.02,2100,.05,.04,W.p12,{to:900,sus:.3})},
 thunder:(t,A)=>{noise(A,t,.5,.42,{type:"lowpass",f:2400,to:160,a:.004});tone(A,t,110,.4,.3,"sawtooth",{to:45,sus:.4});noise(A,t,.06,.3,{type:"bandpass",f:6000,q:2})},
 rain:(t,A)=>{noise(A,t,.9,.14,{type:"highpass",f:3500,a:.15});tone(A,t,520,.3,.05,"sine",{to:780,sus:.5})},
 claw:(t,A)=>{noise(A,t,.09,.32,{type:"bandpass",f:4200,to:1400,q:2.2,a:.004});noise(A,t+.03,.07,.2,{type:"bandpass",f:3600,to:1200,q:2.2});tone(A,t,900,.04,.05,W.p12,{to:500,sus:.3})},
 dash:(t,A)=>{noise(A,t,.22,.3,{type:"bandpass",f:600,to:3800,q:1.4,a:.01});tone(A,t,220,.16,.08,"sine",{to:660,sus:.4})},
 fboom:(t,A)=>{noise(A,t,.18,.22,{type:"lowpass",f:1800,to:250});tone(A,t,160,.12,.16,"sine",{to:60,sus:.3})},
 pulse:(t,A)=>{tone(A,t,240,.28,.2,"sine",{to:90,sus:.4});noise(A,t,.25,.18,{type:"lowpass",f:900,to:200})},
 wave:(t,A)=>{noise(A,t,.32,.3,{type:"bandpass",f:500,to:2200,q:1.2,a:.02});tone(A,t,300,.2,.12,"sine",{to:700,sus:.4})},
 hit:(t,A)=>tone(A,t,240,.03,.06,W.p50,{to:120,sus:.3}),
 kill:(t,A)=>tone(A,t,520,.05,.07,W.p25,{to:980,sus:.3}),
 hurt:(t,A)=>{tone(A,t,170,.15,.3,W.p50,{to:65,sus:.3});noise(A,t,.12,.2,{type:"lowpass",f:1500,to:300})},
 gem:(t,A)=>{const f=900*Math.pow(2,Math.min(gemN,12)/12);tone(A,t,f,.045,.07,"sine",{sus:.4});tone(A,t+.03,f*1.5,.04,.04,"sine",{sus:.4})},
 level:(t,A)=>[0,4,7,12,16].forEach((s,i)=>tone(A,t+i*.065,midi(72+s),.12,.13,W.p25,{sus:.5})),
 relic:(t,A)=>{[0,7,12,19].forEach((s,i)=>tone(A,t+i*.08,midi(76+s),.35,.11,"triangle",{sus:.5}));tone(A,t+.32,midi(95),.6,.05,"sine",{sus:.4})},
 altar:(t,A)=>[0,3,7,10,15].forEach((s,i)=>tone(A,t+i*.09,midi(69+s),.4,.1,"triangle",{sus:.5})),
 magnet:(t,A)=>{tone(A,t,300,.4,.14,W.p25,{to:1600,sus:.6});noise(A,t,.35,.08,{type:"bandpass",f:800,to:4000})},
 portal:(t,A)=>{for(let i=0;i<3;i++)tone(A,t+i*.05,600*(1+i*.26),.7,.06,"sine",{to:1300*(1+i*.2),sus:.6,a:.05})},
 floor:(t,A)=>{noise(A,t,.5,.22,{type:"bandpass",f:3000,to:300,q:1});tone(A,t,900,.45,.1,"sine",{to:200,sus:.5})},
 boss:(t,A)=>{tone(A,t,82,1.1,.3,"sawtooth",{to:52,sus:.7,a:.05});tone(A,t,123,1.1,.15,W.p25,{to:78,sus:.7,a:.05});noise(A,t,1,.25,{type:"lowpass",f:600,to:120,a:.1})},
 bar:(t,A)=>{noise(A,t,.16,.3,{f:3500});tone(A,t,1800,.12,.1,W.p12,{to:500,sus:.3})},
 revive:(t,A)=>[0,4,7,12,16,19].forEach((s,i)=>tone(A,t+i*.07,midi(67+s),.3,.12,W.p25,{sus:.6})),
 over:(t,A)=>[12,7,3,0].forEach((s,i)=>tone(A,t+i*.22,midi(57+s),.4,.14,"triangle",{sus:.6})),
 win:(t,A)=>[0,4,7,12,7,12,16].forEach((s,i)=>tone(A,t+i*.11,midi(72+s),.25,.12,W.p25,{sus:.6})),
 ui:(t,A)=>tone(A,t,880,.035,.06,W.p50,{sus:.4})};
const ATK=new Set(["zap","thunder","claw","dash","fboom","bolt","qi","whip","water","feather","boom","pulse","wave","hit","kill"]);
function sfx(n){if(!ac||ac.state!=="running"||!FX[n])return;const t=ac.currentTime;if(last[n]!=null&&t-last[n]<(GAP[n]||.03))return;last[n]=t;
 if(n==="gem"){gemN=t-gemT<.35?gemN+1:0;gemT=t}
 try{FX[n](t+.005,ATK.has(n)?bus.atk:bus.sfx)}catch(_){}}

/* ---------- 지금 어떤 곡을 틀지 (타이틀 / 인게임 / 마법의 탑) ---------- */
setInterval(()=>{const end=$("endingOverlay"),onTitle=!ui.start.classList.contains("hidden")||(end&&!end.classList.contains("hidden"));
 want=onTitle||!state||!state.p||!state.p.charId?"title":state.mode==="tower"?"tower":themeOf()==="palace"?"palace":themeOf()==="cloud"?"cloud":"field";
 setDuck(onTitle?1:state.dead?.25:state.paused?.4:1)},200);
return{sfx,apply,unlock,get ctx(){return ac},SONGS,reload(){if(cur)cur="__swap"},get track(){return fsrc?cur:null},_dbg:{prepHook,genLead}}})();

/* ---------- 게임 이벤트에 효과음 연결 ---------- */
(()=>{const S=audio.sfx;
const wrap=(f,fn)=>function(...a){const r=f.apply(this,a);try{fn(a,r)}catch(_){}return r};
const _arrow=arrow;arrow=function(){const p=state.p,n0=state.arrows.length,w0=p.whipT;const r=_arrow.apply(this,arguments);
 const c0=p.clawT;if(p.charId==="hyunmu"&&p.whipT>(w0||0)+.01)S("whip");else if(p.charId==="baekho"&&p.clawT>.19)S("claw");else if(p.charId==="cheongryong"&&state.fx.length&&state.fx[state.fx.length-1].type==="bolt"&&state.fx[state.fx.length-1].life===state.fx[state.fx.length-1].max)S(state.fx[state.fx.length-1].thunder?"thunder":"zap");else if(state.arrows.length>n0){const a=state.arrows[state.arrows.length-1];S(a.water?"water":a.qi?"qi":"bolt")}return r};
featherVolley=wrap(featherVolley,()=>S("feather"));
meteorBoom=wrap(meteorBoom,()=>S("boom"));
counterWave=wrap(counterWave,()=>S("wave"));
barrierBreak=wrap(barrierBreak,()=>S("bar"));
levelUp=wrap(levelUp,()=>S("level"));
altarChoice=wrap(altarChoice,()=>S("altar"));
grantRelic=wrap(grantRelic,()=>S("relic"));
magnetPickup=wrap(magnetPickup,()=>S("magnet"));
openPortal=wrap(openPortal,()=>S("portal"));
nextFloor=wrap(nextFloor,()=>S("floor"));
spawnBoss=wrap(spawnBoss,()=>S("boss"));
spawnWarden=wrap(spawnWarden,(a,r)=>{if(r)S("boss")});
spawnDragon=wrap(spawnDragon,(a,r)=>{if(r)S("boss")});
towerRespawn=wrap(towerRespawn,()=>S("revive"));
showEnding=wrap(showEnding,()=>S("win"));
const _die=die;die=function(){const p=state.p,rv=p.revived;const r=_die.apply(this,arguments);if(!rv&&p.revived)S("revive");else if(state.dead)S("over");return r};
const _hurt=hurt;hurt=function(e,n){const h=e&&e.hp;const r=_hurt.apply(this,arguments);if(e&&e.hp<h)S("hit");return r};
// 프레임마다: 처치 · 피격 · 불씨 조각 획득 · 펄스
const _update=update;update=function(dt){const s=state,p=s&&s.p,hp=p&&p.hp,k=s&&s.kills,g=s&&s.gems&&s.gems.length,pt=s&&s.pulseTimer;
 _update.apply(this,arguments);if(!s||s!==state||!p)return;
 if(p.hp<hp-.01&&!s.dead)S("hurt");if(s.kills>k)S("kill");if(s.gems.length<g&&!s.win)S("gem");if(p.pulse&&s.pulseTimer>pt+.5)S("pulse")};
document.addEventListener("click",e=>{if(e.target&&e.target.closest&&e.target.closest("button"))S("ui")},true);
})();

/* ================= 설정 > 소리 설정 창 ================= */
const soundUI=(()=>{
const css=document.createElement("style");
css.textContent=".snd-row{display:flex;align-items:center;gap:14px;padding:12px 18px;margin:0 0 12px;background:var(--panel2,#12281d);box-shadow:0 -3px 0 0 #24503b,0 3px 0 0 #24503b,-3px 0 0 0 #24503b,3px 0 0 0 #24503b}.snd-row label{flex:0 0 9.5em}.snd-row label strong{display:block;font-size:18px;font-weight:400}.snd-row label small{display:block;font-size:12px;color:var(--muted,#9db8a4)}.snd-row output{flex:0 0 3.2em;text-align:right;color:var(--gold,#ffd54a)}.snd-row:focus-within{box-shadow:0 -3px 0 0 var(--gold,#ffd54a),0 3px 0 0 var(--gold,#ffd54a),-3px 0 0 0 var(--gold,#ffd54a),3px 0 0 0 var(--gold,#ffd54a)}"
 +".snd-row input[type=range]{flex:1;min-width:0;height:22px;margin:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}.snd-row input[type=range]:focus{outline:none}"
 +".snd-row input[type=range]::-webkit-slider-runnable-track{height:10px;background:linear-gradient(90deg,var(--gold,#ffd54a) var(--p,50%),#0a140f var(--p,50%));box-shadow:0 0 0 3px #3a5a48}.snd-row input[type=range]::-moz-range-track{height:10px;background:#0a140f;box-shadow:0 0 0 3px #3a5a48}.snd-row input[type=range]::-moz-range-progress{height:10px;background:var(--gold,#ffd54a)}"
 +".snd-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:22px;margin-top:-6px;background:#fff3b0;border:0;box-shadow:0 0 0 3px #5a350a}.snd-row input[type=range]::-moz-range-thumb{width:16px;height:22px;border:0;border-radius:0;background:#fff3b0;box-shadow:0 0 0 3px #5a350a}"
 +".snd-mute .state-text{min-width:3em}.snd-off .snd-row{opacity:.45}#soundButton .row-right b{font-size:22px;color:var(--muted,#9db8a4)}@media (max-height:520px){.snd-row{padding:6px 12px;margin-bottom:8px}.snd-row label strong{font-size:15px}}";
document.head.appendChild(css);
// 설정 창에 '소리 설정' 줄 추가
const sp=$("settingsPanel"),row=document.createElement("button");row.id="soundButton";row.type="button";row.className="setting-row";
const lb=$("langButton");if(lb&&lb.parentNode)lb.parentNode.insertBefore(row,lb.nextSibling);else if(sp)sp.querySelector(".panel").appendChild(row);
function rowText(){row.innerHTML='<span class="row-text"><strong>'+tx("소리 설정","Sound")+'</strong><small>'+tx("마스터 · 배경음악 · 공격 · 효과음 볼륨","Master · Music · Attack · Effects volume")+'</small></span><span class="row-right"><b class="state-text">'+(settings.mute?tx("음소거","Muted"):Math.round(audio_v().master*100)+"%")+'</b><b aria-hidden="true">›</b></span>'}
const audio_v=()=>{const v=settings.vol||{};for(const k in SOUND_DEF)if(typeof v[k]!=="number")v[k]=SOUND_DEF[k];settings.vol=v;return v};
const pn=document.createElement("div");pn.id="soundPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");ui.start.appendChild(pn);modals.sound=pn;
const ROWS=[["master","마스터 볼륨","Master volume","전체 소리 크기","Overall loudness","ui"],["bgm","배경음악","Music","타이틀 · 인게임 · 마법의 탑 BGM","Title, in-game and Magic Tower music",null],["atk","공격 소리","Attack sounds","무기 공격 · 적 타격 · 처치","Weapon attacks, hits and kills","bolt"],["sfx","효과음","Effects","레벨업 · 획득 · 피격 · 보스 · 버튼","Level-up, pickups, damage, bosses, buttons","level"]];
function paint(){const v=audio_v();pn.setAttribute("aria-label",tx("소리 설정","Sound settings"));pn.classList.toggle("snd-off",!!settings.mute);
 pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">SOUND</p><h2>'+tx("소리 설정","Sound")+'</h2>'
 +'<button type="button" class="setting-row toggle snd-mute'+(settings.mute?"":" on")+'" role="switch" aria-checked="'+(!settings.mute)+'"><span class="row-text"><strong>'+tx("소리 켜기","Sound on")+'</strong><small>'+tx("끄면 모든 소리가 꺼져요","Turn off to mute everything")+'</small></span><span class="row-right"><span class="switch"><i></i></span><b class="state-text">'+(settings.mute?tx("꺼짐","Off"):tx("켜짐","On"))+'</b></span></button>'
 +ROWS.map(([k,ko,en,dk,de])=>'<div class="snd-row"><label for="vol-'+k+'"><strong>'+tx(ko,en)+'</strong><small>'+tx(dk,de)+'</small></label><input id="vol-'+k+'" type="range" min="0" max="100" step="5" value="'+Math.round(v[k]*100)+'" data-k="'+k+'" style="--p:'+Math.round(v[k]*100)+'%"><output>'+Math.round(v[k]*100)+'%</output></div>').join("")
 +'<div class="panel-actions"><button class="ghost-button big" type="button" data-snd-reset>'+tx("기본값","Defaults")+'</button><button class="primary-button" type="button" data-snd-back>'+tx("설정으로","Back")+'</button></div></div>';
 pn.querySelector(".snd-mute").addEventListener("click",()=>{settings.mute=!settings.mute;saveSettings();audio.unlock();audio.apply();paint();pn.querySelector(".snd-mute").focus({preventScroll:true})});
 pn.querySelectorAll("input[type=range]").forEach(r=>{const k=r.dataset.k,o=r.nextElementSibling;
  r.addEventListener("input",()=>{audio_v()[k]=r.value/100;r.style.setProperty("--p",r.value+"%");o.textContent=r.value+"%";audio.unlock();audio.apply()});
  r.addEventListener("change",()=>{saveSettings();const t=ROWS.find(x=>x[0]===k)[5];if(t)audio.sfx(t)})});
 pn.querySelector("[data-snd-reset]").addEventListener("click",()=>{settings.vol=Object.assign({},SOUND_DEF);settings.mute=false;saveSettings();audio.apply();paint();pn.querySelector("[data-snd-reset]").focus({preventScroll:true})});
 pn.querySelector("[data-snd-back]").addEventListener("click",back)}
let settingsOpener=null;
function back(){openModal("settings",settingsOpener);lastOpener=settingsOpener;rowText();row.focus({preventScroll:true})}
function open(){settingsOpener=lastOpener;paint();openModal("sound",row);const f=pn.querySelector(".snd-mute");if(f)f.focus({preventScroll:true})}
row.addEventListener("click",open);
pn.addEventListener("click",e=>{if(e.target===pn)back()});
window.addEventListener("keydown",e=>{if(e.key==="Escape"&&!pn.classList.contains("hidden")){e.stopImmediatePropagation();e.preventDefault();back()}},true);
rowText();
return{relang(){rowText()}}})();
const _applyLangS=applyLang;applyLang=function(){_applyLangS.apply(this,arguments);soundUI.relang()};

/* ================= 인게임 일시정지 메뉴 (P / Esc) : 계속하기 · 소리 설정 · 설정 · 타이틀로 ================= */
const pauseMenu=(()=>{
const css=document.createElement("style");
css.textContent="#pauseMenu{position:absolute;inset:0;z-index:44;display:grid;place-items:center;padding:16px;background:rgba(3,8,6,.62)}#pauseMenu.hidden{display:none}#pauseMenu .panel{width:min(880px,95vw);max-height:94vh;overflow:auto}.pm-wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start;text-align:left}.pm-build{font-size:13px;color:#d8e6d4}.pm-hero{display:flex;gap:10px;align-items:center;margin-bottom:8px}.pm-hero img{width:56px;height:56px;image-rendering:pixelated;object-fit:contain;background:rgba(0,0,0,.3);border:2px solid #24503b}.pm-hero strong{display:block;font-size:17px;color:#fff}.pm-hero small{color:#9db8a4}.pm-sec{margin:10px 0 4px;color:#ffd54a;font-size:12px;letter-spacing:.08em}.pm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 10px}.pm-stats span{display:flex;justify-content:space-between;gap:6px;padding:3px 6px;background:rgba(0,0,0,.28)}.pm-stats i{font-style:normal;color:#9db8a4;white-space:nowrap}.pm-stats span{white-space:nowrap;overflow:hidden}.pm-chips{display:flex;flex-wrap:wrap;gap:5px}.pm-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px 3px 4px;background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.12)}.pm-chip img{width:22px;height:22px;image-rendering:pixelated}.pm-chip b{font-weight:400;color:#ffcf6a}.pm-chip.sk{border-color:rgba(255,213,74,.55);background:rgba(60,44,10,.5)}.pm-none{color:#7a8a7c}@media (max-width:720px){.pm-wrap{grid-template-columns:1fr}.pm-build{order:2}.pm-stats{grid-template-columns:repeat(2,1fr)}}#pauseMenu h2{margin:4px 0 6px}"
 +".pm-info{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;margin:0 0 16px;font-size:13px;color:var(--muted,#9db8a4)}.pm-info b{font-weight:400;color:var(--gold,#ffd54a)}.pm-info .pm-hard{color:#ff8a94}"
 +".pm-list{display:flex;flex-direction:column;gap:12px}.pm-list button{position:relative;width:100%;padding:12px 18px;font:inherit;font-size:19px;letter-spacing:.12em;color:var(--ink,#e7f1df);text-align:center;background:var(--panel2,#12281d);border:0;cursor:pointer;box-shadow:0 -3px 0 0 #24503b,0 3px 0 0 #24503b,-3px 0 0 0 #24503b,3px 0 0 0 #24503b;transition:background .12s,box-shadow .12s,transform .1s}"
 +".pm-list button:hover,.pm-list button:focus{outline:none;background:#1a3b2a;transform:translateX(4px);box-shadow:0 -3px 0 0 var(--gold,#ffd54a),0 3px 0 0 var(--gold,#ffd54a),-3px 0 0 0 var(--gold,#ffd54a),3px 0 0 0 var(--gold,#ffd54a)}"
 +".pm-list button.pm-main{color:#2a1a05;background:#e3ac2c;box-shadow:0 -3px 0 0 #ffe08a,0 3px 0 0 #a8701a,-3px 0 0 0 #ffe08a,3px 0 0 0 #a8701a}.pm-list button.pm-main:hover,.pm-list button.pm-main:focus{background:#ffc93d}"
 +".pm-list button.pm-quit{color:#ffb0b8}.pm-list kbd{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:.65em;padding:0 5px}"
 +"@media (max-height:520px){.pm-list{gap:8px}.pm-list button{padding:8px 14px;font-size:16px}.pm-info{margin-bottom:8px}}";
document.head.appendChild(css);
const frame=canvas.closest(".game-frame")||document.body,el=document.createElement("div");el.id="pauseMenu";el.className="hidden";el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");frame.appendChild(el);
let sub=null;const home=ui.start;
const inRun=()=>state&&state.p&&state.p.charId!==undefined&&!state.dead&&!state.won&&!state.choosing&&ui.start.classList.contains("hidden");
const visible=()=>!el.classList.contains("hidden");
function info(){const s=state,parts=[];
 parts.push(s.mode==="tower"?`<span>${tx("층","Floor")} <b>${s.floor||1}F</b></span>`:`<span>NIGHT <b>${String(s.night).padStart(2,"0")}</b></span>`);
 parts.push(`<span>${tx("시간","Time")} <b>${fmtTime(s.time)}</b></span>`,`<span>${tx("레벨","Level")} <b>${s.level}</b></span>`,`<span>${tx("처치","Kills")} <b>${s.kills}</b></span>`);
 if(s.mode==="tower")parts.push(`<span>${tx("목숨","Lives")} <b>${s.lives}</b></span>`);
 if(s.diff==="hard")parts.push('<span class="pm-hard">HARD</span>');return parts.join("")}
// 지금 빌드: 캐릭터 · 진화 · 속성 · 능력치 · 고유 스킬 · 강화 · 무기 진화
function buildHTML(){const s=state,p=s.p,c=chars.get(p.charId),el2=CHAR_ELEM[p.charId]&&ELEM[CHAR_ELEM[p.charId]];
 const E=p.charId==="ignis"?(p.evo?IGN_EVO[p.evo]:null):(p.evo&&CHAR_EVO[p.charId]?CHAR_EVO[p.charId][p.evo]:null);
 const evoTxt=E?tf(E,"name"):tx("진화 전","Not evolved"),nextLv=p.charId==="ignis"?(IGN_EVO[(p.evo||0)+1]||{}).lv:(CHAR_EVO[p.charId]&&CHAR_EVO[p.charId][(p.evo||0)+1]||{}).lv;
 let h='<div class="pm-hero"><img alt="" src="'+(c&&c.img?c.img():"")+'"><div><strong>'+(c?tf(c,"name"):"")+'</strong><small>'+evoTxt+(nextLv?' · '+tx("다음 진화 Lv ","Next evo Lv ")+nextLv+(p.charId==="hwangryong"?tx(" (시련 보스)"," (trial boss)"):""):"")+(el2?' · <span style="color:'+el2.c+'">'+el2.icon+' '+tf(el2,"n")+' · '+tf(el2,"fx")+'</span>':'')+'</small></div></div>';
 const st=[[tx("체력","HP"),Math.ceil(p.hp)+"/"+p.maxHp],[tx("공격력","Attack"),Math.round((p.dmgMul||1)*100)+"%"],[tx("기본 피해","Base dmg"),fmt(p.arrowDamage)],[tx("공격 속도","Atk speed"),(1/p.arrowRate).toFixed(2)+tx("회/초","/s")],[tx("이동 속도","Speed"),Math.round(p.speed)],[tx("흡수 범위","Pickup"),Math.round(p.pickup)]];
 h+='<div class="pm-sec">'+tx("능력치","STATS")+'</div><div class="pm-stats">'+st.map(([a,b])=>'<span><i>'+a+'</i>'+b+'</span>').join("")+'</div>';
 const ups=Object.entries((s.rs&&s.rs.ups)||{}),sk=ups.filter(([id])=>SK[id]),ot=ups.filter(([id])=>!SK[id]);
 const chip=([id,u],isSk)=>'<span class="pm-chip'+(isSk?" sk":"")+'"><img alt="" src="'+u.icon+'">'+u.name+' <b>'+(isSk?"Lv "+skL(p,id)+"/"+SK[id].max:"×"+u.n)+'</b></span>';
 h+='<div class="pm-sec">'+tx("고유 스킬","UNIQUE SKILLS")+'</div><div class="pm-chips">'+(sk.length?sk.map(x=>chip(x,true)).join(""):'<span class="pm-none">'+tx("아직 없어요","None yet")+'</span>')+'</div>';
 h+='<div class="pm-sec">'+tx("강화","UPGRADES")+'</div><div class="pm-chips">'+(ot.length?ot.sort((a,b)=>b[1].n-a[1].n).map(x=>chip(x,false)).join(""):'<span class="pm-none">'+tx("아직 없어요","None yet")+'</span>')+'</div>';
 const ev=(s.rs&&s.rs.evo)||[];if(ev.length)h+='<div class="pm-sec">'+tx("무기 진화","WEAPON EVOLUTIONS")+'</div><div class="pm-chips">'+ev.map(v=>'<span class="pm-chip sk">'+v.icon+' '+v.name+'</span>').join("")+'</div>';
 return h}
function paint(){el.setAttribute("aria-label",tx("일시정지","Paused"));const tk=keyName(settings.titleKey||"t");
 el.innerHTML='<div class="panel"><p class="eyebrow">PAUSED</p><h2>'+tx("일시정지","Paused")+'</h2><p class="pm-info">'+info()+'</p><div class="pm-wrap"><div class="pm-build">'+buildHTML()+'</div><div class="pm-list">'
  +'<button type="button" class="pm-main" data-pm="resume">'+tx("계속하기","Resume")+'<kbd class="kb-only">P</kbd></button>'
  +'<button type="button" data-pm="sound">'+tx("소리 설정","Sound")+'</button>'
  +'<button type="button" data-pm="settings">'+tx("설정","Settings")+'</button>'
  +'<button type="button" class="pm-quit" data-pm="quit">'+tx("타이틀로 나가기","Quit to Title")+'<kbd class="kb-only">'+tk+'</kbd></button></div></div></div>';
 el.querySelectorAll("[data-pm]").forEach(b=>{b.addEventListener("click",()=>act(b.dataset.pm));b.addEventListener("mouseenter",()=>b.focus({preventScroll:true}))})}
function act(k){if(k==="resume")resume();else if(k==="quit")quitUI.open();else openSub(k)}
function open(){if(!inRun()||quitUI.open_)return;state.paused=true;ui.pause.classList.add("hidden");paint();el.classList.remove("hidden");const b=el.querySelector('[data-pm="resume"]');if(b)b.focus({preventScroll:true})}
function hide(){el.classList.add("hidden");if(sub)leaveSub()}
function resume(){hide();if(state&&!state.dead&&!state.choosing)state.paused=false;ui.pause.classList.add("hidden")}
// 설정 / 소리 창은 원래 타이틀 화면 안에 있어서, 일시정지 중에는 게임 화면 쪽으로 잠시 옮겨 와서 띄워요
function openSub(k){sub=k;el.classList.add("hidden");for(const m of[modals.settings,modals.sound])if(m)frame.appendChild(m);
 openModal("settings",null);if(k==="sound"){const sb=$("soundButton");if(sb)sb.click()}}
function leaveSub(){sub=null;closeModals();for(const m of[modals.settings,modals.sound])if(m&&m.parentNode!==home)home.appendChild(m)}
const watch=()=>{if(!sub)return;if(!openModalEl()){leaveSub();if(inRun()||state&&state.paused){paint();el.classList.remove("hidden");const b=el.querySelector(`[data-pm="${"settings"}"]`);if(b)b.focus({preventScroll:true})}}};
if(typeof MutationObserver==="function"){const mo=new MutationObserver(watch);for(const m of[modals.settings,modals.sound])if(m)mo.observe(m,{attributes:true,attributeFilter:["class"]})}
// 키 입력: 메뉴가 떠 있는 동안 P / Esc = 계속하기, 위·아래 = 선택 이동. 설정 창이 떠 있으면 Esc = 메뉴로
window.addEventListener("keydown",e=>{if(quitUI.open_)return;const k=e.key.toLowerCase();
 if(sub){if(k==="escape"&&modals.settings&&!modals.settings.classList.contains("hidden")){e.preventDefault();e.stopImmediatePropagation();closeModals()}
  else if(k==="p"){e.preventDefault();e.stopImmediatePropagation()}return}
 if(visible()){if(e.repeat&&(k==="p"||k==="escape")){e.stopImmediatePropagation();return}
  if(k==="p"||k==="escape"){e.preventDefault();e.stopImmediatePropagation();resume();return}
  if(k==="arrowdown"||k==="arrowup"||k==="w"||k==="s"){e.preventDefault();e.stopImmediatePropagation();const bs=[...el.querySelectorAll("button")],i=bs.indexOf(document.activeElement),n=i<0?0:(i+(k==="arrowdown"||k==="s"?1:-1)+bs.length)%bs.length;bs[n].focus({preventScroll:true});return}
  if(k===(settings.titleKey||"t")){e.preventDefault();e.stopImmediatePropagation();quitUI.open();return}
  if(k!=="enter"&&k!==" "&&k!=="tab"&&k!=="f")e.stopImmediatePropagation();return}
 if(k==="escape"&&!e.repeat&&inRun()&&!state.paused){e.preventDefault();open()}},true);
// 판이 끝나거나 타이틀로 나가면 메뉴를 닫고, 메뉴가 떠 있는 동안 정보(시간 등)를 갱신
setInterval(()=>{if(visible()&&(!state||!state.paused||state.dead||!ui.start.classList.contains("hidden")))hide();
 if(sub&&!ui.start.classList.contains("hidden"))leaveSub();else watch()},150);
return{open,resume,hide,get visible(){return visible()},get sub(){return sub}}})();
// 기존 일시정지(P · 일시정지 버튼 · 창을 벗어날 때 자동 일시정지)를 모두 이 메뉴로 연결
pause=function(){if(pauseMenu.visible)pauseMenu.resume();else pauseMenu.open()};
autoPause=function(force){if((force||settings.autoPause)&&state&&!state.dead&&!state.won&&!state.choosing&&ui.start.classList.contains("hidden")&&!pauseMenu.visible&&!pauseMenu.sub)pauseMenu.open()};

/* ================= 마법의 탑 이어하기: 층을 넘어갈 때마다 자동 저장 ================= */
const towerSave=(()=>{
const KEY="ps_tower_run_v1",SKIP=new Set(["x","y","anim","moving","face","swingT","swingA","whipT","whipA","invuln","cwT","auraT","vampBud","r"]);
const read=()=>{try{const d=JSON.parse(localStorage.getItem(KEY));return d&&d.v===1&&d.s&&d.p&&d.s.floor>0?d:null}catch(_){return null}};
const del=()=>{try{localStorage.removeItem(KEY)}catch(_){}};
function save(){const s=state,p=s&&s.p;if(!p||s.mode!=="tower"||s.dead)return;
 const P={};for(const k of Object.keys(p)){if(SKIP.has(k))continue;const v=p[k];if(typeof v==="number"||typeof v==="string"||typeof v==="boolean"||v===null)P[k]=v}
 P.hp=p.hp;
 const S={floor:s.floor,level:s.level,xp:s.xp,next:s.next,xpFrac:s.xpFrac||0,kills:s.kills,time:s.time,lives:s.lives,diff:s.diff,items:s.items||{},rs:s.rs};
 try{localStorage.setItem(KEY,JSON.stringify({v:1,at:Date.now(),s:S,p:P}))}catch(_){}}
let pending=null;
function restore(d){const s=state,p=s.p,P=d.p,S=d.s;
 p.charId=P.charId;for(const k of Object.keys(P))if(k!=="hp"&&k!=="healMul")p[k]=P[k];
 const hm=P.healMul;p.healMul=null;p.hp=Math.max(1,Math.min(P.maxHp||p.maxHp,P.hp));p.healMul=hm===undefined?null:hm;
 s.floor=S.floor;s.level=S.level;s.xp=S.xp;s.next=S.next;s.xpFrac=S.xpFrac;s.kills=S.kills;s._k=S.kills;s.time=S.time;s.lives=S.lives;s.items=S.items||{};if(S.rs)s.rs=S.rs;
 s.floorKills=0;s.floorTarget=floorTarget(s.floor);s.portal=null;s.wardenSpawned=false;s.enemies=[];s.eb=[];s.altars=[];placeAltar(260);toStart(p);
 s.banner={text:tx(`${s.floor}F · 이어하기`,`${s.floor}F · Continued`),t:2.6};burst(p.x,p.y,"#e9dcff",30);hud()}
const _reset=reset;reset=function(){const r=_reset.apply(this,arguments);if(pending){const d=pending;pending=null;try{restore(d)}catch(e){console.warn("tower continue failed",e)}}return r};
// 층 이동 직후 저장 · 탑에서 게임 오버가 되면 저장 삭제
const _next=nextFloor;nextFloor=function(){const r=_next.apply(this,arguments);save();return r};
const _end=end;end=function(){const r=_end.apply(this,arguments);if(state&&state.mode==="tower")del();return r};
function cont(){const d=read();if(!d)return false;pending=d;startGame("tower",d.s.diff);return true}
function summary(d){d=d||read();if(!d)return"";const c=chars.get(d.p.charId);return `${d.s.floor}F · LV ${d.s.level} · ${c?tf(c,"name"):d.p.charId} · ${d.s.diff==="hard"?"HARD":"EASY"} · ${fmtTime(d.s.time)}`}
return{read,del,save,cont,summary}})();

/* ================= 클리어 코인 상점: 영구 강화 =================
   각 항목: per = 단계당 효과 · cost = 단계별 가격(코인) · 마지막 단계 수가 최대 단계 */
const SHOP_ITEMS=[
 {id:"hp",icon:"❤️",name:"단단한 비늘",nameEn:"Tough Scales",desc:"시작 최대 체력 +5%",descEn:"Starting max HP +5%",per:.05,cost:[1,2,3,5,7]},
 {id:"atk",icon:"⚔️",name:"뜨거운 숨결",nameEn:"Hot Breath",desc:"모든 공격 피해 +3%",descEn:"All damage +3%",per:.03,cost:[2,3,4,6,8]},
 {id:"xp",icon:"⭐",name:"불씨 감각",nameEn:"Ember Sense",desc:"경험치 획득 +3%",descEn:"EXP gain +3%",per:.03,cost:[1,2,3,5,7]},
 {id:"spd",icon:"💨",name:"가벼운 발",nameEn:"Light Feet",desc:"이동 속도 +2%",descEn:"Move speed +2%",per:.02,cost:[2,3,5]},
 {id:"pick",icon:"🧲",name:"끌어당기는 손",nameEn:"Pulling Hands",desc:"흡수 범위 +6%",descEn:"Pickup range +6%",per:.06,cost:[1,2,3]},
 {id:"regen",icon:"💚",name:"따뜻한 둥지",nameEn:"Warm Nest",desc:"초당 최대 체력의 0.1% 회복",descEn:"Regenerate 0.1% of max HP per second",per:.001,cost:[2,3,5]},
 {id:"reroll",icon:"🎲",name:"다시 뽑기",nameEn:"Reroll",desc:"판마다 강화 카드 다시 뽑기 +1회",descEn:"+1 upgrade reroll per run",per:1,cost:[1,3,5]},
 {id:"life",icon:"🏯",name:"탑의 가호",nameEn:"Tower's Grace",desc:"마법의 탑 이지 목숨 +1",descEn:"+1 life in the Magic Tower (Easy)",per:1,cost:[6]}];
/* 코인 획득: 스토리 클리어 1개 (하드는 +hardBonus) · 마법의 탑은 한 판에서 towerEvery층마다 1개 */
const COIN_RULE={hardBonus:1,towerEvery:10};
const SHOP_KEY="ps_shop_v1";
function shopLv(){try{const d=JSON.parse(localStorage.getItem(SHOP_KEY));return d&&typeof d==="object"&&d.lv?d.lv:{}}catch(_){return{}}}
function shopApply(p){const L=shopLv(),g=id=>Math.max(0,Math.min((SHOP_ITEMS.find(i=>i.id===id)||{cost:[]}).cost.length,L[id]|0)),I=id=>SHOP_ITEMS.find(i=>i.id===id).per;
 if(g("hp")){p.maxHp=Math.round(p.maxHp*(1+I("hp")*g("hp")));p.hp=p.maxHp}
 if(g("atk"))p.dmgMul=(p.dmgMul||1)*(1+I("atk")*g("atk"));
 if(g("xp"))p.xpMul=(p.xpMul||1)+I("xp")*g("xp");
 if(g("spd"))p.speed*=1+I("spd")*g("spd");
 if(g("pick"))p.pickup*=1+I("pick")*g("pick");
 if(g("regen"))p.regen=(p.regen||0)+I("regen")*g("regen");
 state.rerolls=g("reroll");
 if(g("life")&&state.mode==="tower"&&state.diff!=="hard")state.lives+=g("life")}
const shopUI=(()=>{
const css=document.createElement("style");
css.textContent="#shopPanel .modal-panel{width:min(720px,95vw)}.sh-coin{text-align:center;margin:-4px 0 12px;font-size:15px;color:#d8c6a0}.sh-coin b{color:#ffcf6a;font-weight:400;margin-left:4px}.sh-coin img{width:16px;height:16px;vertical-align:-3px;image-rendering:pixelated}.sh-list{display:grid;grid-template-columns:1fr 1fr;gap:10px}"
 +".sh-item{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto auto;gap:2px 10px;padding:10px 12px;background:var(--panel2,#12281d);box-shadow:0 -2px 0 0 #24503b,0 2px 0 0 #24503b,-2px 0 0 0 #24503b,2px 0 0 0 #24503b}.sh-item .ic{grid-row:1/4;font-size:26px;line-height:1;align-self:center}.sh-item strong{font-weight:400;font-size:16px;color:#fff3b0}.sh-item small{font-size:12px;color:#bcd0bf}"
 +".sh-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.sh-pips{display:flex;gap:3px}.sh-pips i{width:12px;height:8px;background:#0a140f;box-shadow:0 0 0 1px #3a5a48}.sh-pips i.on{background:#ffd54a;box-shadow:0 0 0 1px #b57b1c}.sh-buy{padding:5px 12px;font:inherit;font-size:13px;color:#2a1a05;background:#e3ac2c;border:0;cursor:pointer;box-shadow:0 -2px 0 0 #ffe08a,0 2px 0 0 #a8701a,-2px 0 0 0 #ffe08a,2px 0 0 0 #a8701a}.sh-buy:hover,.sh-buy:focus{outline:none;background:#ffc93d}.sh-buy[disabled]{cursor:default;color:#8a8070;background:#2a2620;box-shadow:0 0 0 2px #3a342a}.sh-buy img{width:13px;height:13px;vertical-align:-2px;image-rendering:pixelated}"
 +".sh-note{margin:12px 0 0;text-align:center;font-size:12px;color:#9db8a4}.sh-max{color:#7dff9a;font-size:13px}@media (max-width:680px){.sh-list{grid-template-columns:1fr}}";
document.head.appendChild(css);
const coinImg=()=>rec.coinImg();
const pn=document.createElement("div");pn.id="shopPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");ui.start.appendChild(pn);modals.shop=pn;
const save=lv=>{try{localStorage.setItem(SHOP_KEY,JSON.stringify({lv}))}catch(_){}};
let msg="";
function paint(focusId){const L=shopLv(),coins=rec.coins(),ci=coinImg();pn.setAttribute("aria-label",tx("강화 상점","Upgrade Shop"));
 pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">SHOP</p><h2>'+tx("강화 상점","Upgrade Shop")+'</h2><p class="sh-coin">'+tx("보유 클리어 코인","Clear coins")+'<b>'+ci+' '+coins+'</b></p><div class="sh-list">'
 +SHOP_ITEMS.map(it=>{const lv=Math.min(it.cost.length,L[it.id]|0),max=lv>=it.cost.length,price=max?0:it.cost[lv],can=!max&&coins>=price;
  return '<div class="sh-item"><span class="ic">'+it.icon+'</span><strong>'+tf(it,"name")+'</strong><small>'+tf(it,"desc")+'</small><div class="sh-row"><span class="sh-pips">'+it.cost.map((_,i)=>'<i class="'+(i<lv?"on":"")+'"></i>').join("")+'</span>'
   +(max?'<span class="sh-max">MAX</span>':'<button type="button" class="sh-buy" data-buy="'+it.id+'"'+(can?"":" disabled")+'>'+ci+' '+price+'</button>')+'</div></div>'}).join("")
 +'</div><p class="sh-note">'+(msg||tx("코인은 일일·주간 퀘스트, 스토리 클리어(하드는 +1), 마법의 탑 10층마다 얻을 수 있어요. 강화는 다음 판부터 적용돼요.","Earn coins from daily/weekly quests, clearing the story (+1 on Hard) and every 10 floors in the Magic Tower. Upgrades apply from your next run."))+'</p>'
 +'<div class="panel-actions"><button class="ghost-button big" type="button" data-refund>'+tx("전부 환불","Refund all")+'</button><button class="primary-button" type="button" data-sh-close>'+tx("돌아가기","Back")+'</button></div></div>';
 pn.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buy(b.dataset.buy)));
 pn.querySelector("[data-sh-close]").addEventListener("click",closeAndRefocus);
 pn.querySelector("[data-refund]").addEventListener("click",refund);
 const f=focusId&&pn.querySelector('[data-buy="'+focusId+'"]:not([disabled])')||pn.querySelector("[data-sh-close]");if(f)f.focus({preventScroll:true});msg=""}
function buy(id){const it=SHOP_ITEMS.find(i=>i.id===id),L=shopLv(),lv=L[id]|0;if(!it||lv>=it.cost.length)return;if(!rec.spend(it.cost[lv]))return;L[id]=lv+1;save(L);msg=tx(`${tf(it,"name")} ${lv+1}단계!`,`${tf(it,"name")} level ${lv+1}!`);if(typeof audio!=="undefined")audio.sfx("level");paint(id)}
function refund(){const L=shopLv();let n=0;for(const it of SHOP_ITEMS){const lv=Math.min(it.cost.length,L[it.id]|0);for(let i=0;i<lv;i++)n+=it.cost[i]}if(!n)return;rec.addCoins(n,false);save({});msg=tx(`코인 ${n}개를 돌려받았어요`,`Refunded ${n} coins`);paint()}
pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
const btn=document.createElement("button");btn.id="shopButton";btn.className="menu-btn";btn.type="button";
const cb=$("charButton");if(cb&&cb.parentNode)cb.parentNode.insertBefore(btn,cb.nextSibling);
function label(){btn.textContent=tx("강화 상점","Upgrade Shop")}
btn.addEventListener("click",()=>{paint();openModal("shop",btn);const f=pn.querySelector(".sh-buy:not([disabled])")||pn.querySelector("[data-sh-close]");if(f)f.focus({preventScroll:true})});
btn.addEventListener("mouseenter",()=>btn.focus({preventScroll:true}));label();
return{relang(){label();if(!pn.classList.contains("hidden"))paint()}}})();
{const _al=applyLang;applyLang=function(){_al.apply(this,arguments);shopUI.relang()}}

/* ----- 레벨업 카드 다시 뽑기 (상점 '다시 뽑기') ----- */
{const panel=ui.choices.parentNode,rr=document.createElement("button");rr.type="button";rr.id="lvReroll";rr.className="ghost-button big hidden";rr.style.marginTop="14px";panel.appendChild(rr);
 const show=()=>{const n=state&&state.rerolls||0;rr.classList.toggle("hidden",!(n>0));rr.innerHTML="🎲 "+tx("다시 뽑기","Reroll")+" ("+n+')<kbd class="kb-only" style="margin-left:8px">R</kbd>'};
 const doRoll=()=>{if(!(state.rerolls>0)||!state.choosing)return;state.rerolls--;rolling=true;levelUp();rolling=false};let rolling=false;
 rr.addEventListener("click",doRoll);
 const _lu=levelUp;levelUp=function(){const r=_lu.apply(this,arguments);show();try{weaponEvo.decorate()}catch(_){}return r};
 const _ac=altarChoice;altarChoice=function(){const r=_ac.apply(this,arguments);rr.classList.add("hidden");return r};
 window.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="r"&&!e.repeat&&!rr.classList.contains("hidden")&&!ui.level.classList.contains("hidden")){e.preventDefault();doRoll()}})}
/* ----- 마법의 탑: 10층마다 클리어 코인 ----- */
{const _nf=nextFloor;nextFloor=function(){const r=_nf.apply(this,arguments);const f=state.floor-1;if(state.mode==="tower"&&f>0&&f%COIN_RULE.towerEvery===0){rec.addCoins(1,true);state.banner={text:tx(`${f}F 돌파! 클리어 코인 +1`,`Floor ${f} cleared! Clear coin +1`),t:2.6}}return r}}

syncSettings();applyLang();
state={time:0,paused:true,dead:false,p:{x:WW/2,y:WH/2,r:10},enemies:[],arrows:[],gems:[],magnets:[],particles:[],fx:[],eb:[],night:1,banner:null};render();ui.start.classList.add("hidden");intro.play(showTitle);

/* ================= 타이틀 메뉴 정리: 플레이 · 기록과 업적 · 설정 · 게임 방법 =================
   플레이 안에: 스토리 · 마법의 탑 · 캐릭터 · 강화 상점 / 기록과 업적 안에: 도감 */
(()=>{const menu=$("mainMenu");if(!menu)return;
 const css=document.createElement("style");css.textContent="#playPanel .modal-panel{width:min(480px,92vw)}#playPanel .pl-list{display:flex;flex-direction:column;gap:18px;width:min(340px,80vw);margin:14px auto 18px;text-align:center}#playPanel .pl-list .menu-btn{width:100%}#recordsPanel .rc-codex{margin-right:10px}";document.head.appendChild(css);
 const pn=document.createElement("div");pn.id="playPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");
 pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">PLAY</p><h2 class="pl-h"></h2><div class="pl-list"></div><div class="panel-actions"><button class="primary-button" type="button" data-pl-close></button></div></div>';
 ui.start.appendChild(pn);modals.play=pn;const list=pn.querySelector(".pl-list");
 const story=$("startButton");story.removeAttribute("data-i18n");story.classList.remove("primary");
 for(const id of ["startButton","towerButton","charButton","shopButton"]){const b=$(id);if(b)list.appendChild(b)}
 const play=document.createElement("button");play.id="playMenuButton";play.type="button";play.className="menu-btn primary";menu.insertBefore(play,menu.firstChild);
 play.addEventListener("click",()=>openModal("play",play));play.addEventListener("mouseenter",()=>play.focus({preventScroll:true}));
 pn.querySelector("[data-pl-close]").addEventListener("click",closeAndRefocus);pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
 // 메인 메뉴 순서: 플레이 · 설정 · 게임 방법 · 기록과 업적
 for(const id of ["settingsButton","howtoButton","recordsButton"]){const b=$(id);if(b)menu.appendChild(b)}
 // 도감은 기록과 업적 창 안으로
 const cx=$("codexButton"),rp=$("recordsPanel");if(cx&&rp){const acts=rp.querySelector(".panel-actions");cx.className="primary-button rc-codex";acts.insertBefore(cx,acts.firstChild)}
 function relang(){play.textContent=tx("플레이","Play");setTimeout(()=>{if(window.__questRelang)window.__questRelang()},0);story.textContent=tx("스토리","Story");pn.querySelector(".pl-h").textContent=tx("플레이","Play");pn.querySelector("[data-pl-close]").textContent=tx("돌아가기","Back");pn.setAttribute("aria-label",tx("플레이","Play"));if(cx)cx.textContent="📖 "+tx("도감","Codex")}
 relang();window.__menuRelang=relang})();


/* ================= 일일 · 주간 퀘스트 =================
   다 채우면 퀘스트 창에서 [받기]로 클리어 코인을 받아요. 일일은 매일 0시, 주간은 매주 월요일 0시(기기 시간)에 새로 바뀌어요.
   fixed: 항상 나오는 퀘스트 · pool에서 pick개를 날짜마다 골라요 · k: 세는 것 · g: 목표 · c: 보상 코인 — 숫자만 바꿔서 조절하세요 */
const QUEST={
 daily:{fixed:{k:"kill",g:10000,c:1},pick:2,pool:[{k:"boss",g:3,c:1},{k:"mapmob",g:300,c:1},{k:"night",g:25,c:1},{k:"floor",g:15,c:1},{k:"time",g:1800,c:1},{k:"elite",g:20,c:1}]},
 weekly:{fixed:{k:"kill",g:70000,c:3},pick:2,pool:[{k:"boss",g:25,c:2},{k:"mapmob",g:2500,c:2},{k:"clear",g:3,c:2},{k:"floor",g:100,c:2},{k:"time",g:14400,c:2},{k:"chars",g:4,c:2}]}};
const QTXT={kill:["몹 {g}마리 처치","Defeat {g} enemies"],boss:["보스 {g}마리 처치","Defeat {g} bosses"],mapmob:["맵 전용 몹 {g}마리 처치","Defeat {g} map-native foes"],night:["한 판에서 NIGHT {g} 도달 (스토리)","Reach NIGHT {g} in one story run"],floor:["마법의 탑 {g}층 오르기","Climb {g} Magic Tower floors"],time:["{g} 동안 플레이","Play for {g}"],elite:["마법의 탑 정예 {g}마리 처치","Defeat {g} tower elites"],clear:["스토리 {g}번 클리어","Clear the story {g} times"],chars:["서로 다른 캐릭터 {g}종으로 플레이","Play with {g} different characters"]};
const quests=(()=>{const KEY="ps_quest_v1";
 const pad=n=>String(n).padStart(2,"0"),dayKey=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
 const weekStart=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
 const hashS=t=>{let h=2166136261;for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
 function gen(kind,key){const Q=QUEST[kind];let r=hashS(kind+key)||1;const rnd=()=>{r=(Math.imul(r,1664525)+1013904223)>>>0;return r/4294967296};
  const pool=Q.pool.slice(),out=[Q.fixed];while(out.length<Q.pick+1&&pool.length)out.push(pool.splice(Math.floor(rnd()*pool.length),1)[0]);
  return out.map(q=>({k:q.k,g:q.g,c:q.c,p:0,done:0,got:0}))}
 let sv={},dirty=false;try{const r=JSON.parse(localStorage.getItem(KEY));if(r&&typeof r==="object")sv=r}catch(_){}
 const save=()=>{if(!dirty)return;dirty=false;try{localStorage.setItem(KEY,JSON.stringify(sv))}catch(_){}};
 function roll(){const now=new Date(),dk=dayKey(now),wk=dayKey(weekStart(now));let ch=false;
  if(sv.d!==dk||!Array.isArray(sv.dq)){sv.d=dk;sv.dq=gen("daily",dk);ch=true}
  if(sv.w!==wk||!Array.isArray(sv.wq)){sv.w=wk;sv.wq=gen("weekly",wk);ch=true}
  if(ch){dirty=true;save();refresh()}}
 const fmtDur=sec=>{sec=Math.max(0,Math.round(sec));if(sec>=86400){const d=Math.floor(sec/86400),hh=Math.floor(sec%86400/3600);return d+tx("일","d")+(hh?" "+hh+tx("시간","h"):"")}const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);return h?h+tx("시간","h")+(m?" "+m+tx("분","m"):""):m+tx("분","m")};
 const qName=q=>{const T=QTXT[q.k]||["?","?"];return tx(T[0],T[1]).replace("{g}",q.k==="time"?fmtDur(q.g):q.g.toLocaleString())};
 const qProg=q=>q.k==="time"?fmtDur(Math.min(q.p,q.g))+" / "+fmtDur(q.g):Math.floor(Math.min(q.p,q.g)).toLocaleString()+" / "+q.g.toLocaleString();
 function finish(q){q.p=q.g;q.done=1;dirty=true;save();refresh();
  if(state&&state.p&&!document.body.classList.contains("on-title"))state.banner={text:"📜 "+tx("퀘스트 완료! ","Quest complete! ")+qName(q),t:2.6};
  try{if(typeof audio!=="undefined"&&audio.sfx)audio.sfx("level")}catch(_){}}
 function add(k,n){roll();for(const L of [sv.dq,sv.wq])for(const q of L){if(q.k!==k||q.done)continue;
  if(k==="night")q.p=Math.max(q.p,n);else if(k==="chars"){q.set=q.set||[];if(!q.set.includes(n))q.set.push(n);q.p=q.set.length}else q.p+=n;
  dirty=true;if(q.p>=q.g)finish(q)}}
 const ready=()=>{roll();return[...sv.dq,...sv.wq].filter(q=>q.done&&!q.got).length};
 function claim(kind,i){const q=(kind==="d"?sv.dq:sv.wq)[i];if(!q||!q.done||q.got)return;q.got=1;dirty=true;save();rec.addCoins(q.c,true);refresh();paint()}
 setInterval(()=>{save();roll()},5000);window.addEventListener("pagehide",save);document.addEventListener("visibilitychange",()=>{if(document.hidden)save()});
 // ---- UI: 플레이 창 안의 [퀘스트] 버튼 + 퀘스트 창 ----
 const css=document.createElement("style");
 css.textContent=".q-dot{display:inline-block;min-width:18px;margin-left:8px;padding:0 5px;background:#e8442a;color:#fff;border:2px solid #2a0e08;font-size:12px;line-height:16px;vertical-align:2px}.q-dot:empty{display:none}#questPanel .modal-panel{width:min(620px,94vw)}.qs-coin{text-align:center;margin:-4px 0 10px;color:#d8c6a0}.qs-coin b{color:#ffcf6a;font-weight:400}.qs-body{max-height:54vh;overflow:auto;text-align:left;padding-right:4px}.qs-sec{margin-bottom:14px}.qs-sec h3{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px;font-size:16px;color:#ffcf6a;font-weight:400}.qs-sec h3 small{font-size:12px;color:#bfae88}.qs-row{display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border:2px solid #3a2a1a;background:rgba(10,6,4,.55)}.qs-row.done{border-color:#ffb04a}.qs-row.got{opacity:.55}.qs-main{flex:1;min-width:0}.qs-main strong{display:block;color:#fff;font-weight:400}.qs-main small{display:block;color:#c8bca0;font-size:12px;margin-top:3px}.qs-bar{height:6px;margin-top:5px;background:#2a1a10;border:1px solid #4a3420}.qs-bar i{display:block;height:100%;background:linear-gradient(90deg,#ff8a2a,#ffd54a)}.qs-rw{flex:none;font-size:13px;color:#ffcf6a;white-space:nowrap}.qs-btn{flex:none;min-width:64px;padding:6px 10px;border:2px solid #6b4a2a;background:rgba(20,10,6,.6);color:#8a7a68;font:inherit;cursor:default}.qs-btn.go{background:#ffb04a;border-color:#ffd54a;color:#2a0e08;cursor:pointer}";
 document.head.appendChild(css);
 const pn=document.createElement("div");pn.id="questPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");
 pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">QUESTS</p><h2 class="qs-h"></h2><p class="qs-coin"></p><div class="qs-body"></div><div class="panel-actions"><button class="primary-button" type="button" data-qs-close></button></div></div>';
 ui.start.appendChild(pn);modals.quest=pn;const body=pn.querySelector(".qs-body");
 const btn=document.createElement("button");btn.id="questButton";btn.type="button";btn.className="menu-btn";
 {const shop=$("shopButton");if(shop&&shop.parentNode)shop.parentNode.insertBefore(btn,shop);else{const pl=document.querySelector("#playPanel .pl-list");if(pl)pl.appendChild(btn)}}
 btn.addEventListener("click",()=>{roll();paint();openModal("quest",btn)});btn.addEventListener("mouseenter",()=>btn.focus({preventScroll:true}));
 pn.querySelector("[data-qs-close]").addEventListener("click",closeAndRefocus);pn.addEventListener("click",e=>{if(e.target===pn)closeAndRefocus()});
 body.addEventListener("click",e=>{const b=e.target.closest("[data-qc]");if(b)claim(b.dataset.qc[0],+b.dataset.qc.slice(1))});
 const dot=()=>{const n=ready();return'<span class="q-dot">'+(n||"")+'</span>'};
 function refresh(){if(!sv.dq)return;btn.innerHTML="📜 "+tx("퀘스트","Quests")+dot();const pm=$("playMenuButton");if(pm){pm.textContent=tx("플레이","Play");const n=ready();if(n)pm.insertAdjacentHTML("beforeend",'<span class="q-dot">'+n+'</span>')}}
 function sec(kind,L,title,left){return'<div class="qs-sec"><h3>'+title+'<small>'+tx("초기화까지 ","Resets in ")+fmtDur(left)+'</small></h3>'+L.map((q,i)=>{const k=Math.min(1,q.p/q.g);
  return'<div class="qs-row'+(q.got?" got":q.done?" done":"")+'"><div class="qs-main"><strong>'+qName(q)+'</strong><div class="qs-bar"><i style="width:'+(k*100).toFixed(1)+'%"></i></div><small>'+qProg(q)+'</small></div><span class="qs-rw">'+rec.coinImg()+q.c+'</span><button type="button" class="qs-btn'+(q.done&&!q.got?" go":"")+'" data-qc="'+kind+i+'"'+(q.done&&!q.got?"":" disabled")+'>'+(q.got?tx("완료","Done"):q.done?tx("받기","Claim"):tx("진행 중","In progress"))+'</button></div>'}).join("")+'</div>'}
 function paint(){roll();pn.setAttribute("aria-label",tx("퀘스트","Quests"));pn.querySelector(".qs-h").textContent=tx("퀘스트","Quests");pn.querySelector("[data-qs-close]").textContent=tx("돌아가기","Back");
  pn.querySelector(".qs-coin").innerHTML=tx("보유 클리어 코인 ","Clear coins ")+rec.coinImg()+"<b>"+rec.coins()+"</b>";
  const now=new Date(),tom=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1),nw=weekStart(now);nw.setDate(nw.getDate()+7);
  const st=body.scrollTop;body.innerHTML=sec("d",sv.dq,tx("일일 퀘스트","Daily Quests"),(tom-now)/1000)+sec("w",sv.wq,tx("주간 퀘스트","Weekly Quests"),(nw-now)/1000);body.scrollTop=st}
 setInterval(()=>{if(!pn.classList.contains("hidden"))paint()},20000);
 roll();refresh();window.__qAdd=add;window.__questRelang=()=>{refresh();if(!pn.classList.contains("hidden"))paint()};
 return{add,claim,ready,paint,get sv(){return sv},roll}})();

/* ================= 세이브 백업: 저장 코드 내보내기 · 불러오기 (설정 창) =================
   기록 · 업적 · 코인 · 캐릭터 · 상점 · 설정 · 탑 이어하기를 하나의 코드로 묶어요 */
(()=>{const sp=$("settingsPanel");if(!sp)return;const KEYS=["ps_save_v1","ps_chars_v1","ps_shop_v1","ps_settings_v1","ps_tower_run_v1","ps_quest_v1"],TAG="PSAVE1";
 const hash=t=>{let h=2166136261;for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")};
 const enc=o=>{const j=JSON.stringify(o),b=btoa(unescape(encodeURIComponent(j)));return TAG+"."+b+"."+hash(b)};
 const dec=code=>{const c=(code||"").replace(/\s+/g,"");const parts=c.split(".");if(parts.length!==3||parts[0]!==TAG)throw new Error("format");if(hash(parts[1])!==parts[2])throw new Error("checksum");const o=JSON.parse(decodeURIComponent(escape(atob(parts[1]))));if(!o||typeof o!=="object"||!o.d)throw new Error("data");return o};
 const read=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
 function exportCode(at){const d={};for(const k of KEYS){const v=read(k);if(v!=null)d[k]=v}return enc({v:1,at:at||Date.now(),d})}
 function dataHash(){const d={};for(const k of KEYS){const v=read(k);if(v!=null)d[k]=v}return hash(JSON.stringify(d))}
 // 저장 데이터를 통째로 바꾸고 다시 시작 (이후 화면을 닫을 때 옛 데이터가 다시 저장되지 않도록 잠가요)
 function applyObj(o,before){for(const k2 of KEYS){if(o.d[k2]!=null)localStorage.setItem(k2,o.d[k2]);else localStorage.removeItem(k2)}if(before)before();Storage.prototype.setItem=function(){};window.__saveLock=true;setTimeout(()=>location.reload(),600)}
 window.__saveCodec={exportCode,dec,dataHash,applyObj,summary:o=>{try{const sv=JSON.parse(o.d.ps_save_v1||"{}"),ch=JSON.parse(o.d.ps_chars_v1||"{}");return{coins:sv.coins|0,wins:(sv.total&&sv.total.wins)|0,ach:Object.keys(sv.ach||{}).length,chars:(ch.owned||[]).length||1}}catch(_){return{coins:0,wins:0,ach:0,chars:1}}}};
 const css=document.createElement("style");css.textContent="#backupPanel textarea{width:100%;height:84px;resize:vertical;margin:6px 0;padding:8px;font:12px/1.4 monospace;color:#e7f1df;background:#07100c;border:2px solid #24503b;word-break:break-all}#backupPanel h3{margin:10px 0 2px;font-size:17px;font-weight:400;color:#ffd54a}#backupPanel p.bk-note{margin:2px 0;font-size:13px;color:#9db8a4}#backupPanel .bk-row{display:flex;gap:8px;flex-wrap:wrap}#backupPanel .bk-row button{padding:8px 14px;font:inherit;font-size:14px;color:#e7f1df;background:#12281d;border:0;cursor:pointer;box-shadow:0 -2px 0 0 #24503b,0 2px 0 0 #24503b,-2px 0 0 0 #24503b,2px 0 0 0 #24503b}#backupPanel .bk-row button:hover,#backupPanel .bk-row button:focus{outline:none;background:#1a3b2a;color:#ffd54a}#backupPanel .bk-row button.warn{color:#ffb0b8}#backupPanel .bk-msg{min-height:1.4em;margin:6px 0 0;font-size:14px;color:#ffcf6a}";document.head.appendChild(css);
 const pn=document.createElement("div");pn.id="backupPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");ui.start.appendChild(pn);modals.backup=pn;
 let armed=false;
 function paint(){armed=false;pn.setAttribute("aria-label",tx("세이브 백업","Save backup"));
  pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">SAVE BACKUP</p><h2>'+tx("세이브 백업","Save Backup")+'</h2>'
  +'<p class="bk-note">'+tx("기록 · 업적 · 칭호 · 코인 · 캐릭터 · 강화 상점 · 설정 · 탑 이어하기가 모두 들어 있어요. 브라우저를 바꾸거나 캐시를 지우기 전에 저장해 두세요.","Includes records, achievements, titles, coins, characters, shop upgrades, settings and your tower continue. Save it before switching browsers or clearing your cache.")+'</p>'
  +'<h3>'+tx("내보내기","Export")+'</h3><textarea class="bk-out" readonly></textarea><div class="bk-row"><button type="button" data-bk="copy">📋 '+tx("코드 복사","Copy code")+'</button><button type="button" data-bk="file">💾 '+tx("파일로 저장","Save as file")+'</button></div>'
  +'<h3>'+tx("불러오기","Import")+'</h3><p class="bk-note">'+tx("저장 코드를 붙여 넣거나 백업 파일을 열어 주세요. 지금 기기의 저장 데이터를 덮어써요.","Paste a save code or open a backup file. This overwrites the save on this device.")+'</p><textarea class="bk-in" placeholder="PSAVE1...."></textarea><div class="bk-row"><button type="button" data-bk="open">📂 '+tx("파일 열기","Open file")+'</button><button type="button" class="warn" data-bk="load">⤴ '+tx("불러오기","Import")+'</button></div><input type="file" accept=".txt,text/plain" class="bk-file" hidden>'
  +'<p class="bk-msg"></p><div class="panel-actions"><button class="primary-button" type="button" data-bk="close">'+tx("돌아가기","Back")+'</button></div></div>';
  pn.querySelector(".bk-out").value=exportCode()}
 const msg=t=>{pn.querySelector(".bk-msg").textContent=t};
 pn.addEventListener("click",e=>{if(e.target===pn){closeAndRefocus();return}const b=e.target.closest("[data-bk]");if(!b)return;const k=b.dataset.bk,out=pn.querySelector(".bk-out"),inp=pn.querySelector(".bk-in");
  if(k==="close")closeAndRefocus();
  else if(k==="copy"){out.select();const done=()=>msg(tx("저장 코드를 복사했어요. 메모장 같은 곳에 붙여 넣어 보관하세요.","Code copied. Paste it somewhere safe."));if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(out.value).then(done,()=>{try{document.execCommand("copy");done()}catch(_){msg(tx("복사하지 못했어요. 코드를 직접 선택해 복사해 주세요.","Couldn't copy — please select and copy the code manually."))}});else{try{document.execCommand("copy");done()}catch(_){}}}
  else if(k==="file"){const d=new Date(),nm="pixel-survival-save-"+d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")+".txt",a=document.createElement("a");a.href=URL.createObjectURL(new Blob([out.value],{type:"text/plain"}));a.download=nm;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);msg(tx("백업 파일을 저장했어요: ","Saved backup file: ")+nm)}
  else if(k==="open")pn.querySelector(".bk-file").click();
  else if(k==="load"){let o;try{o=dec(inp.value)}catch(err){armed=false;b.textContent="⤴ "+tx("불러오기","Import");msg(tx("저장 코드가 올바르지 않아요. 코드 전체를 빠짐없이 붙여 넣었는지 확인해 주세요.","That save code isn't valid. Make sure you pasted the whole code."));return}
   if(!armed){armed=true;b.textContent="⚠ "+tx("정말 덮어쓸까요? 한 번 더 누르세요","Overwrite? Press again");const n=Object.keys(o.d).length;msg(tx(new Date(o.at).toLocaleString()+"에 만든 백업 ("+n+"개 항목)","Backup from "+new Date(o.at).toLocaleString()+" ("+n+" items)"));return}
   try{msg(tx("불러왔어요! 다시 시작할게요…","Imported! Restarting…"));applyObj(o)}catch(_){msg(tx("이 브라우저에 저장하지 못했어요.","Couldn't write to this browser's storage."))}}});
 pn.addEventListener("change",e=>{const f=e.target.closest(".bk-file");if(!f||!f.files||!f.files[0])return;const r=new FileReader();r.onload=()=>{pn.querySelector(".bk-in").value=String(r.result||"").trim();msg(tx("파일을 열었어요. ‘불러오기’를 눌러 주세요.","File loaded. Press Import."))};r.readAsText(f.files[0]);f.value=""});
 // 설정 창 맨 아래에 버튼 줄
 const row=document.createElement("button");row.type="button";row.className="setting-row";row.id="backupRow";const acts=sp.querySelector(".panel-actions");acts.parentNode.insertBefore(row,acts);
 function rowText(){row.innerHTML='<span class="row-text"><strong>'+tx("세이브 백업 · 불러오기","Save backup · Import")+'</strong><small>'+tx("저장 코드나 파일로 기록과 코인을 옮기고 지켜요","Move or protect your progress with a save code or file")+'</small></span><span class="row-right"><b class="state-text">💾</b></span>'}
 row.addEventListener("click",()=>{if(!document.body.classList.contains("on-title")){row.querySelector("small").textContent=tx("타이틀 화면에서만 할 수 있어요","Only available on the title screen");return}paint();openModal("backup",row)});
 rowText();window.__backupRelang=()=>{rowText();if(!pn.classList.contains("hidden"))paint()}})();


/* ================= 휴대폰 앱처럼 설치 (PWA) =================
   sw.js가 게임 파일을 저장해 두어 인터넷 없이도 켜져요. 설정 창의 [앱으로 설치]로 홈 화면에 추가할 수 있어요. */
(()=>{if("serviceWorker" in navigator&&/^https?:$/.test(location.protocol))window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
 const sp=$("settingsPanel");if(!sp)return;let deferred=null;
 const standalone=()=>matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches||navigator.standalone===true;
 const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
 const row=document.createElement("button");row.type="button";row.className="setting-row";row.id="installRow";
 const bk=$("backupRow"),acts=sp.querySelector(".panel-actions");(bk||acts).parentNode.insertBefore(row,bk||acts);
 let note="";
 function paint(){const inst=standalone();row.innerHTML='<span class="row-text"><strong>'+tx("앱으로 설치","Install as app")+'</strong><small>'+(note||(inst?tx("지금 앱으로 실행 중이에요","Running as an installed app"):deferred?tx("홈 화면에 아이콘을 만들어 앱처럼 실행해요 · 인터넷 없이도 켜져요","Add an icon to your home screen · works offline"):ios?tx("Safari 공유 버튼 → '홈 화면에 추가'를 눌러 주세요","In Safari, tap Share → 'Add to Home Screen'"):tx("브라우저 메뉴(⋮)에서 '앱 설치' 또는 '홈 화면에 추가'를 눌러 주세요","Use the browser menu (⋮) → 'Install app' or 'Add to Home screen'")))+'</small></span><span class="row-right"><b class="state-text">'+(inst?"✓":"📲")+'</b></span>'}
 window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;note="";paint()});
 window.addEventListener("appinstalled",()=>{deferred=null;note=tx("설치했어요! 홈 화면의 아이콘으로 실행해 보세요","Installed! Launch it from your home screen");paint()});
 row.addEventListener("click",async()=>{if(deferred){const d=deferred;deferred=null;try{d.prompt();const r=await d.userChoice;note=r&&r.outcome==="accepted"?tx("설치하고 있어요…","Installing…"):""}catch(_){}paint()}else{note="";paint()}});
 paint();const _r=window.__backupRelang;window.__backupRelang=()=>{if(_r)_r();note="";paint()}})();

/* ================= 클라우드 저장: 구글 로그인 → 자동 업로드 · 다른 기기에서 자동 불러오기 =================
   Firebase(Auth + Firestore)를 씁니다. 문서 위치: saves/{로그인 사용자 uid} = {code, at}
   · 로그인하면: 클라우드가 더 최신이면 내려받고(이 기기에도 새 진행이 있으면 어느 쪽을 쓸지 물어봐요), 아니면 올려요
   · 로그인 중에는 저장 데이터가 바뀔 때마다 30초 간격으로 자동 업로드 · 창을 닫거나 숨길 때도 업로드 */
const cloud=(()=>{const FB="https://www.gstatic.com/firebasejs/10.12.2/",META="ps_cloud_v1",enabled=!!(CLOUD_CONFIG.apiKey&&CLOUD_CONFIG.projectId)||!!window.__cloudMock;
 let svc=null,user=null,busy=false,status="",lastUp=0,ready=false,pending=false;
 const C=()=>window.__saveCodec;
 const meta=()=>{try{return JSON.parse(localStorage.getItem(META))||{}}catch(_){return{}}},setMeta=m=>{try{localStorage.setItem(META,JSON.stringify(m))}catch(_){}};
 async function load(){if(svc)return svc;if(window.__cloudMock)return svc=window.__cloudMock;
  const [A,U,F]=await Promise.all([import(FB+"firebase-app.js"),import(FB+"firebase-auth.js"),import(FB+"firebase-firestore.js")]);
  const app=A.initializeApp(CLOUD_CONFIG),au=U.getAuth(app),db=F.getFirestore(app);
  svc={onUser:cb=>U.onAuthStateChanged(au,cb),
   signIn:async()=>{const pv=new U.GoogleAuthProvider();try{await U.signInWithPopup(au,pv)}catch(e){if(e&&/popup-blocked|operation-not-supported/.test(e.code||""))await U.signInWithRedirect(au,pv);else throw e}},
   signOut:()=>U.signOut(au),
   get:async uid=>{const sn=await F.getDoc(F.doc(db,"saves",uid));return sn.exists()?sn.data():null},
   put:(uid,d)=>F.setDoc(F.doc(db,"saves",uid),d)};return svc}
 const fmt2=t=>{const d=new Date(t);return d.toLocaleDateString()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
 async function upload(force){if(!user||busy||window.__saveLock||pending)return;const h=C().dataHash(),m=meta();if(!force&&m.hash===h)return;busy=true;
  try{const at=Date.now();await svc.put(user.uid,{code:C().exportCode(at),at,v:1});setMeta({uid:user.uid,syncAt:at,hash:h});lastUp=Date.now();status=tx("동기화됨 ","Synced ")+fmt2(at)}catch(e){status=tx("업로드 실패 (나중에 다시 시도해요)","Upload failed (will retry)")}busy=false;paint()}
 async function syncOnLogin(){if(!user)return;busy=true;status=tx("클라우드 확인 중…","Checking cloud…");paint();let doc=null;
  try{doc=await svc.get(user.uid)}catch(e){busy=false;status=tx("클라우드에 연결하지 못했어요","Couldn't reach the cloud");paint();return}
  busy=false;const m=meta();
  if(!doc||!doc.code){await upload(true);return}
  let o;try{o=C().dec(doc.code)}catch(_){await upload(true);return}
  const localChanged=m.hash!==C().dataHash(),cloudNewer=m.uid!==user.uid||doc.at>(m.syncAt||0);
  if(!cloudNewer){await upload(false);return}
  const L=C().summary({d:(()=>{const d={};for(const k of ["ps_save_v1","ps_chars_v1"]){try{const v=localStorage.getItem(k);if(v!=null)d[k]=v}catch(_){}}return d})()}),R=C().summary(o);
  const localEmpty=!L.coins&&!L.wins&&!L.ach&&L.chars<=1;
  if(localEmpty||(!localChanged&&m.uid===user.uid)){download(o,doc.at);return}
  ask(o,doc.at,L,R)}
 function download(o,at){status=tx("클라우드 저장을 불러와요…","Loading cloud save…");paint();C().applyObj(o,()=>{try{localStorage.setItem(META,JSON.stringify({uid:user.uid,syncAt:at,hash:""}))}catch(_){}})}
 // ---- UI: 타이틀 왼쪽 위 칩 + 클라우드 창 ----
 const css=document.createElement("style");css.textContent="#cloudChip{position:absolute;top:88px;left:16px;z-index:3;padding:4px 10px;border:2px solid #2d5c44;background:rgba(4,12,9,.78);color:#cfe0cf;font:inherit;font-size:13px;cursor:pointer;box-shadow:3px 3px 0 #000}#cloudChip:hover,#cloudChip:focus-visible{border-color:#7fd0ff;outline:none}#cloudChip.on{border-color:#5ac8ff;color:#bfefff}.title-screen:has(.modal:not(.hidden)) #cloudChip{display:none}#cloudPanel .cl-st{margin:6px 0 12px;padding:10px 12px;background:rgba(0,0,0,.3);font-size:14px;color:#d8e6d4;line-height:1.6}#cloudPanel .cl-st b{color:#bfefff;font-weight:400}#cloudPanel .cl-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}#cloudPanel .cl-row button{padding:10px 16px;font:inherit;font-size:15px;color:#e7f1df;background:#12281d;border:0;cursor:pointer;box-shadow:0 -2px 0 0 #24503b,0 2px 0 0 #24503b,-2px 0 0 0 #24503b,2px 0 0 0 #24503b}#cloudPanel .cl-row button:hover,#cloudPanel .cl-row button:focus{outline:none;background:#1a3b2a;color:#ffd54a}#cloudPanel .cl-row button.g{color:#1a1a1a;background:#f4f4f4}#cloudPanel .cl-cmp{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 12px}#cloudPanel .cl-cmp div{padding:10px;background:rgba(0,0,0,.3);border:2px solid #24503b;font-size:13px;line-height:1.6}#cloudPanel .cl-cmp strong{display:block;color:#ffd54a;font-weight:400}#cloudPanel .cl-note{font-size:12px;color:#9db8a4}";document.head.appendChild(css);
 const chip=document.createElement("button");chip.id="cloudChip";chip.type="button";ui.start.appendChild(chip);
 const pn=document.createElement("div");pn.id="cloudPanel";pn.className="modal hidden";pn.setAttribute("role","dialog");ui.start.appendChild(pn);modals.cloud=pn;
 let askData=null;
 function ask(o,at,L,R){askData={o,at};pending=true;const row=(t,S,when)=>'<div><strong>'+t+'</strong>'+(when?tx("저장 시각 ","Saved ")+when+'<br>':'')+tx("클리어 코인 ","Coins ")+S.coins+' · '+tx("클리어 ","Clears ")+S.wins+'<br>'+tx("업적 ","Achievements ")+S.ach+' · '+tx("캐릭터 ","Characters ")+S.chars+'</div>';
  pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">CLOUD SAVE</p><h2>'+tx("어느 저장을 쓸까요?","Which save to keep?")+'</h2><p class="cl-note">'+tx("이 기기와 클라우드에 서로 다른 진행이 있어요. 고르지 않은 쪽은 덮어써져요.","This device and the cloud have different progress. The one you don't pick will be overwritten.")+'</p><div class="cl-cmp">'+row(tx("☁ 클라우드","☁ Cloud"),R,fmt2(at))+row(tx("💻 이 기기","💻 This device"),L,"")+'</div><div class="cl-row"><button type="button" data-cl="useCloud">☁ '+tx("클라우드 불러오기","Use cloud save")+'</button><button type="button" data-cl="useLocal">💻 '+tx("이 기기 저장 올리기","Keep this device")+'</button></div></div>';
  openModal("cloud",chip)}
 function paintPanel(){if(askData)return;const m=meta();
  pn.innerHTML='<div class="panel modal-panel"><p class="eyebrow">CLOUD SAVE</p><h2>'+tx("클라우드 저장","Cloud Save")+'</h2>'
  +(!enabled?'<p class="cl-st">'+tx("아직 클라우드 저장이 설정되지 않았어요. (게임 파일의 CLOUD_CONFIG에 Firebase 설정을 넣으면 켜져요)","Cloud save isn't configured yet. (Fill in CLOUD_CONFIG in the game file to enable it)")+'</p>'
   :user?'<p class="cl-st">'+tx("로그인: ","Signed in: ")+'<b>'+(user.name||user.email||"Google")+'</b><br>'+(status||(m.syncAt?tx("마지막 동기화 ","Last sync ")+fmt2(m.syncAt):""))+'<br><span class="cl-note">'+tx("진행이 바뀔 때마다 자동으로 올라가고, 다른 기기에서 같은 계정으로 로그인하면 이어서 할 수 있어요.","Progress uploads automatically, and you can continue on any device with the same account.")+'</span></p><div class="cl-row"><button type="button" data-cl="sync">⟳ '+tx("지금 동기화","Sync now")+'</button><button type="button" data-cl="out">'+tx("로그아웃","Sign out")+'</button></div>'
   :'<p class="cl-st">'+(status?status+'<br>':'')+tx("구글 계정으로 로그인하면 기록 · 코인 · 캐릭터가 자동으로 클라우드에 저장돼요. 브라우저를 바꾸거나 캐시를 지워도 다시 로그인하면 그대로예요.","Sign in with Google to save records, coins and characters to the cloud automatically. Switch browsers or clear your cache — just sign in again.")+'</p><div class="cl-row"><button type="button" class="g" data-cl="in">G&nbsp; '+tx("구글로 로그인","Sign in with Google")+'</button></div>')
  +'<div class="panel-actions"><button class="primary-button" type="button" data-cl="close">'+tx("돌아가기","Back")+'</button></div></div>'}
 function paint(){chip.classList.toggle("on",!!user);chip.innerHTML=!enabled?"☁ "+tx("클라우드 저장","Cloud save"):user?"☁ "+(busy?tx("동기화 중…","Syncing…"):tx("클라우드 저장 켜짐","Cloud save on")):"☁ "+tx("로그인하고 클라우드 저장","Sign in for cloud save");if(!pn.classList.contains("hidden"))paintPanel()}
 pn.addEventListener("click",async e=>{if(e.target===pn&&!askData){closeAndRefocus();return}const b=e.target.closest("[data-cl]");if(!b)return;const k=b.dataset.cl;
  if(k==="close")closeAndRefocus();
  else if(k==="in"){status=tx("로그인 창을 여는 중…","Opening sign-in…");paintPanel();try{await (await load()).signIn()}catch(err){status=tx("로그인하지 못했어요","Sign-in failed")+(err&&err.code?" ("+err.code+")":"");paint()}}
  else if(k==="out"){pending=false;try{await svc.signOut()}catch(_){}const m=meta();setMeta({...m,uid:""});user=null;status="";paint()}
  else if(k==="sync"){status=tx("동기화 중…","Syncing…");paintPanel();await syncOnLogin()}
  else if(k==="useCloud"&&askData){const a=askData;askData=null;pending=false;download(a.o,a.at)}
  else if(k==="useLocal"&&askData){askData=null;pending=false;closeAndRefocus();await upload(true)}});
 chip.addEventListener("click",async()=>{if(pending&&user){syncOnLogin();return}askData=null;paintPanel();openModal("cloud",chip);if(enabled&&!ready){try{await load()}catch(_){status=tx("클라우드 모듈을 불러오지 못했어요 (인터넷 연결을 확인해 주세요)","Couldn't load the cloud module (check your connection)");paint()}}});
 // 시작: 설정돼 있으면 로그인 상태를 확인
 async function start(){if(!enabled&&!window.__cloudMock){paint();return}try{const s2=await load();ready=true;s2.onUser(u=>{const was=user&&user.uid;user=u?{uid:u.uid,name:u.displayName,email:u.email}:null;paint();if(user&&was!==user.uid)syncOnLogin()})}catch(_){status=tx("클라우드 모듈을 불러오지 못했어요","Couldn't load the cloud module");paint()}}
 setInterval(()=>{if(user&&!busy&&Date.now()-lastUp>30000)upload(false)},5000);
 const flush=()=>{if(user&&!window.__saveLock)upload(false)};window.addEventListener("pagehide",flush);document.addEventListener("visibilitychange",()=>{if(document.hidden)flush()});
 window.__cloudRelang=paint;paint();setTimeout(start,0);return{upload,get user(){return user}}})();
})();