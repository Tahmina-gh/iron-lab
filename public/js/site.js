/* IRON LAB marketing site — behaviour. Data comes from /api (see server/routes). */

/* Unsplash HD photos (Unsplash License: free for commercial use). Change w= to resize. */
const U=(id,w=1400)=>`https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

/* ---------- nav ---------- */
const navEl=document.getElementById('siteNav');
addEventListener('scroll',()=>{navEl.classList.toggle('solid',scrollY>40);navEl.style.setProperty('--navtop',Math.max(0,36-scrollY)+'px');},{passive:true});
function closeM(){document.getElementById('mnav').classList.remove('open');}

/* ---------- magnetic buttons ---------- */
document.querySelectorAll('[data-magnet]').forEach(btn=>{
  btn.addEventListener('mousemove',e=>{
    const r=btn.getBoundingClientRect();
    btn.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.25}px, ${(e.clientY-r.top-r.height/2)*.35}px)`;
  });
  btn.addEventListener('mouseleave',()=>btn.style.transform='');
});

/* ---------- Training cards ---------- */
const training=[
 {name:'Strength',desc:'Build power and muscle with expert-led strength training.',img:U('1666121365392-b6f502f8b1c9')},
 {name:'Performance',desc:'Push your limits with high-performance conditioning.',img:U('1536922246289-88c42f957773')},
 {name:'Mobility',desc:'Move better, recover faster and train smarter.',img:U('1540206063137-4a88ca974d1a')}
];
document.getElementById('trainGrid').innerHTML=training.map(t=>`
  <div class="train-card">
    <div class="fbg" style="background-image:url('${t.img}')"></div>
    <div class="fgrad"></div>
    <h4>${t.name}</h4><p>${t.desc}</p>
  </div>`).join('');

/* ---------- Gym tour ---------- */
const zones=[
 {name:'Weight Floor',desc:'Free weights, power racks, and platforms for every lift.',img:U('1734630341082-0fec0e10126c',2000)},
 {name:'Cardio',desc:'Bright, window-lit cardio floor with class-integrated screens.',img:U('1637870473618-8c9fa7d11f0a',2000)},
 {name:'Functional Training',desc:'Turf lanes, sleds, and rigs for athletic conditioning.',img:U('1536922246289-88c42f957773',2000)},
 {name:'Boxing',desc:'Bag work, pad rounds, and ring time with a coach.',img:U('1716307043003-dbe6a5cc496e',2000)},
 {name:'Personal Training',desc:'One-on-one coaching in a dedicated, quieter corner of the floor.',img:U('1648542036561-e1d66a5ae2b1',2000)},
 {name:'Recovery',desc:'Guided stretch and mobility work to close out a session.',img:U('1540206063137-4a88ca974d1a',2000)}
];
const planRects=[[5,5,84,56],[93,5,52,56],[149,5,46,56],[5,65,52,60],[61,65,52,60],[117,65,78,60]];
document.getElementById('tourZones').innerHTML=zones.map((z,i)=>`<button class="tour-zone${i===0?' on':''}" data-i="${i}">${z.name}</button>`).join('');
document.getElementById('tourStage').innerHTML=zones.map((z,i)=>`<img src="${z.img}" alt="${z.name} at Iron Lab" class="${i===0?'on':''}" data-i="${i}">`).join('')+
  `<svg class="tour-map" viewBox="0 0 200 130" aria-label="Floor plan">${planRects.map((r,i)=>`<rect data-i="${i}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="2" class="${i===0?'on':''}"><title>${zones[i].name}</title></rect>`).join('')}</svg>`+
  `<div class="tour-cap" id="tourCap"><h4>${zones[0].name}</h4><p>${zones[0].desc}</p></div>`;
function setZone(i){
  document.querySelectorAll('.tour-zone').forEach(z=>z.classList.toggle('on',z.dataset.i===String(i)));
  document.querySelectorAll('.tour-map rect').forEach(r=>r.classList.toggle('on',r.dataset.i===String(i)));
  document.querySelectorAll('.tour-stage img').forEach(img=>img.classList.toggle('on',img.dataset.i===String(i)));
  document.getElementById('tourCap').innerHTML=`<h4>${zones[i].name}</h4><p>${zones[i].desc}</p>`;
}
document.getElementById('tourZones').addEventListener('click',e=>{if(e.target.classList.contains('tour-zone'))setZone(e.target.dataset.i);});
document.querySelectorAll('.tour-map rect').forEach(r=>{
  r.addEventListener('click',()=>setZone(r.dataset.i));
  r.addEventListener('mouseenter',()=>setZone(r.dataset.i));
});

/* ---------- Plan finder ---------- */
const answers={};
let step=1;
const opts=document.querySelectorAll('.f-opt');
opts.forEach(o=>o.addEventListener('click',()=>{
  const group=o.parentElement;
  group.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  o.classList.add('sel');
  answers[group.dataset.q]=o.dataset.v;
  document.getElementById('fNext').disabled=false;
}));
function paintProgress(){for(let i=1;i<=5;i++){document.getElementById('p'+i).style.width=(i<=step?100:0)+'%';}}
function finderNext(){
  if(step<5){
    document.querySelector(`.f-q[data-step="${step}"]`).classList.remove('active');
    step++;
    document.querySelector(`.f-q[data-step="${step}"]`).classList.add('active');
    document.getElementById('fBack').style.visibility='visible';
    const sel=document.querySelector(`.f-q[data-step="${step}"]`).querySelector('.sel');
    document.getElementById('fNext').disabled=!sel;
    if(step===5)document.getElementById('fNext').textContent='See My Plan';
  } else {
    showResult();
  }
  paintProgress();
}
function finderBack(){
  if(step===1)return;
  document.querySelector(`.f-q[data-step="${step}"]`).classList.remove('active');
  step--;
  document.querySelector(`.f-q[data-step="${step}"]`).classList.add('active');
  if(step===1)document.getElementById('fBack').style.visibility='hidden';
  document.getElementById('fNext').textContent='Next';
  document.getElementById('fNext').disabled=false;
  paintProgress();
}
async function showResult(){
  document.querySelector('.f-q[data-step="5"]').classList.remove('active');
  document.getElementById('fNav').style.display='none';
  document.getElementById('fResult').classList.add('active');
  const tier=document.getElementById('fTier'),why=document.getElementById('fWhy'),extra=document.getElementById('fExtra');
  tier.textContent='…';why.textContent='Matching you to a plan…';extra.innerHTML='';
  try{
    const r=await api('/quiz',{body:{goal:answers.goal,exp:answers.exp,freq:answers.freq,style:answers.style,time:answers.time}});
    tier.textContent=r.plan.name.toUpperCase();why.textContent=r.why;
    const bits=[];
    if(r.classes&&r.classes.length)bits.push('<strong style="color:var(--white)">Classes to try:</strong> '+r.classes.map(c=>esc(c.name)).join(', '));
    if(r.trainer)bits.push('<strong style="color:var(--white)">Suggested coach:</strong> '+esc(r.trainer.name)+' ('+esc(r.trainer.specialty)+')');
    extra.innerHTML=bits.join('<br>');
  }catch(e){tier.textContent='—';why.textContent=e.message;}
}
function restartFinder(){
  step=1;
  document.querySelectorAll('.f-q').forEach(q=>q.classList.remove('active'));
  document.querySelector('.f-q[data-step="1"]').classList.add('active');
  document.getElementById('fResult').classList.remove('active');
  document.getElementById('fNav').style.display='flex';
  document.getElementById('fBack').style.visibility='hidden';
  document.getElementById('fNext').textContent='Next';
  document.getElementById('fNext').disabled=true;
  document.querySelectorAll('.f-opt.sel').forEach(o=>o.classList.remove('sel'));
  paintProgress();
}
paintProgress();

/* ---------- Cinematic video playlist ---------- */
const cineSection=document.getElementById('cineSection'),cinePlay=document.getElementById('cinePlay'),cineIcon=document.getElementById('cineIcon');
const cineVids=[...cineSection.querySelectorAll('video')];
const PLAY='<path d="M8 5v14l11-7z"/>',PAUSE='<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
let cineIdx=0,cineTimer=null;
function cineStop(){cineVids.forEach(v=>v.pause());clearInterval(cineTimer);cineSection.classList.remove('playing');cineIcon.innerHTML=PLAY;}
function cineStart(){
  cineVids[cineIdx].play().catch(()=>{});
  cineSection.classList.add('playing');cineIcon.innerHTML=PAUSE;
  cineTimer=setInterval(()=>{
    const old=cineVids[cineIdx];cineIdx=(cineIdx+1)%cineVids.length;const nv=cineVids[cineIdx];
    nv.currentTime=0;nv.play().catch(()=>{});nv.classList.add('on');old.classList.remove('on');
    setTimeout(()=>{if(old!==cineVids[cineIdx])old.pause();},2400);
  },7000);
}
cinePlay.addEventListener('click',()=>cineSection.classList.contains('playing')?cineStop():cineStart());
new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)cineStop();}),{threshold:.2}).observe(cineSection);

/* ---------- Hero: video crossfade + slow parallax ---------- */
const heroVids=[...document.querySelectorAll('.hero-bgvideo video')];
let heroIdx=0;
setInterval(()=>{
  const old=heroVids[heroIdx];heroIdx=(heroIdx+1)%heroVids.length;const nv=heroVids[heroIdx];
  nv.currentTime=0;nv.play().catch(()=>{});nv.classList.add('on');old.classList.remove('on');
},8000);
const heroBg=document.querySelector('.hero-bgvideo');
addEventListener('scroll',()=>{if(scrollY<innerHeight)heroBg.style.transform=`translateY(${scrollY*.22}px) scale(1.06)`;},{passive:true});


/* =====================================================================
   LIVE DATA + BOOKING — everything below talks to the real backend API
   ===================================================================== */
let ME=null,CONTENT=null,PENDING=null;
const IMGS={tr:['1704223523169-52feeed90365','1571732154690-f6d1c3e5178a','1636581563867-1ecab574858f','1540206063137-4a88ca974d1a'],
  fac:['1674834727206-4bc272bfd8da','1637870473618-8c9fa7d11f0a','1536922246289-88c42f957773','1716306886418-f84f6d4c2f3a','1648235692910-947cb90ddd97','1540206063137-4a88ca974d1a'],
  st:['1672344048213-76b6e77304bd','1590487988256-9ed24133863e','1526506118085-60ce8714f8c5','1689877020200-403d8542d95d']};
const pick=(arr,i,w)=>U(arr[i%arr.length],w);
const asArr=(s)=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);

async function refreshMe(){try{ME=(await api('/auth/me')).user;}catch(_){ME=null;}paintAccount();}
function paintAccount(){
  const a=document.getElementById('navAccount'),m=document.getElementById('mnavAccount');
  const href=ME?homeFor(ME.role):'/login.html',txt=ME?'My account':'Log in';
  [a,m].forEach(el=>{if(el){el.href=href;el.textContent=txt;}});
}
function needLogin(msg,then){PENDING=then;openAuth(msg);}
function memberOnly(){ if(ME&&ME.role!=='member'){toast('Booking is for member accounts. Use the member sign-up to book.','err');return false;} return true; }

function openAuth(msg,mode='login'){
  const signup=mode==='signup';
  const box=openModal(`<h3>${signup?'Create your account':'Log in'}</h3><p class="sub">${esc(msg||'Access your bookings, memberships and progress.')}</p>
    <form id="authForm" novalidate>${signup?field('Full name','name',{required:1,autocomplete:'name'}):''}${field('Email','email',{type:'email',required:1,autocomplete:'email'})}${field('Password','password',{type:'password',required:1,autocomplete:signup?'new-password':'current-password'})}
    <p class="form-err" role="alert"></p><button class="btn btn-primary btn-block" type="submit">${signup?'Create account':'Log in'}</button></form>
    <p style="margin-top:14px;font-size:13.5px;color:var(--silver-dim);text-align:center">${signup?'Have an account?':'New here?'} <button class="link" id="swap">${signup?'Log in':'Create an account'}</button>${signup?'':' · <a class="link" href="/forgot.html">Forgot password?</a>'}</p>`);
  $('#swap',box).onclick=()=>openAuth(msg,signup?'login':'signup');
  bindForm($('#authForm',box),async(v)=>{
    await api(signup?'/auth/signup':'/auth/login',{body:v});
    await refreshMe();closeModal();toast(signup?'Welcome to Iron Lab!':'Welcome back.');
    if(PENDING){const f=PENDING;PENDING=null;f();}
  });
}

/* ---- free trial + tour lead forms ---- */
const TIMES=[['','Any time'],...Array.from({length:15},(_,i)=>{const h=String(6+i).padStart(2,'0')+':00';return [h,fmtTime(h)];})];
function leadDone(title,msg){openModal(`<div style="text-align:center;padding:14px 0"><div style="width:52px;height:52px;border-radius:50%;background:rgba(211,47,47,.12);border:1px solid var(--accent);color:var(--accent);display:grid;place-items:center;margin:0 auto 18px;font-size:24px">✓</div><h3>${esc(title)}</h3><p class="sub">${esc(msg)}</p><button class="btn btn-outline btn-block" onclick="closeModal()">Done</button></div>`);}
function openTrial(){
  const box=openModal(`<h3>Start your free trial</h3><p class="sub">Tell us a little about you and when you'd like to come in.</p>
    <form id="trialForm" novalidate>${field('Full name','name',{required:1,autocomplete:'name'})}
    <div class="row2">${field('Email','email',{type:'email',required:1,autocomplete:'email'})}${field('Phone','phone',{type:'tel',required:1,autocomplete:'tel'})}</div>
    <div class="row2">${field('Age','age',{type:'number',min:14,max:100})}${field('Experience level','experience_level',{options:['Beginner','Intermediate','Advanced']})}</div>
    ${field('Fitness goal','goal',{options:['Build muscle','Lose weight','Improve strength','Improve endurance','Improve mobility','General fitness']})}
    <div class="row2">${field('Preferred date','preferred_date',{type:'date',min:today(),required:1})}${field('Preferred time','preferred_time',{options:TIMES})}</div>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><p class="form-err" role="alert"></p><button class="btn btn-primary btn-block" type="submit">Request free trial</button></form>`,true);
  bindForm($('#trialForm',box),async(v)=>{const r=await api('/trials',{body:v});leadDone("You're on the list.",r.message);});
}
function openTour(){
  const box=openModal(`<h3>Book a gym tour</h3><p class="sub">See the floor, meet a coach and ask anything. Takes about 30 minutes.</p>
    <form id="tourForm" novalidate>${field('Full name','name',{required:1,autocomplete:'name'})}<div class="row2">${field('Email','email',{type:'email',required:1})}${field('Phone','phone',{type:'tel',required:1})}</div>
    <div class="row2">${field('Date','date',{type:'date',min:today(),required:1})}${field('Time','time',{options:TIMES.slice(1)})}</div>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><p class="form-err" role="alert"></p><button class="btn btn-primary btn-block" type="submit">Request tour</button></form>`);
  bindForm($('#tourForm',box),async(v)=>{const r=await api('/tours',{body:v});leadDone('Tour requested.',r.message);});
}
async function submitContact(e){
  e.preventDefault();const f=e.target,err=document.getElementById('contactErr'),ok=document.getElementById('contactOk'),btn=f.querySelector('button[type=submit]');
  err.textContent='';ok.style.display='none';btn.disabled=true;const old=btn.textContent;btn.textContent='Sending…';
  try{const r=await api('/contact',{body:Object.fromEntries(new FormData(f).entries())});ok.textContent=r.message;ok.style.display='block';f.reset();}
  catch(x){err.textContent=x.message;}finally{btn.disabled=false;btn.textContent=old;}
  return false;
}

/* ---- memberships ---- */
function renderPlans(){
  const plans=CONTENT.plans;
  document.getElementById('plansGrid').innerHTML=plans.map((p,i)=>`
    <div class="plan-card glass${i===1?' hi':''}">
      <div class="plan-photo" style="background-image:url('${pick(['1637430308606-86576d8fef3c','1734630341082-0fec0e10126c','1716307043003-dbe6a5cc496e'],i,900)}')"></div>
      <div class="plan-body"><p class="plan-tag">${i===1?'Most Chosen':i===2?'All Access':'Get Moving'}</p><h3>${esc(p.name)}</h3>
        <div class="plan-price"><b>${money(p.monthly_price)}</b><span>/ month${p.yearly_price?` · or ${money(p.yearly_price)} / year`:''}</span></div>
        <ul class="plan-feats"><li><span><b style="color:var(--white);font-weight:600">Gym access</b> ${esc(asArr(p.benefits)[0]||'All training zones')}</span></li>
          <li><span><b style="color:var(--white);font-weight:600">Classes</b> ${esc(p.classes_included)}</span></li>
          <li><span><b style="color:var(--white);font-weight:600">Personal training</b> ${p.pt_sessions_included?p.pt_sessions_included+' per month':'à la carte'}</span></li>
          <li><span><b style="color:var(--white);font-weight:600">Recovery</b> ${esc(p.recovery_access)}</span></li>
          <li><span><b style="color:var(--white);font-weight:600">Guest access</b> ${p.guest_passes>100?'Unlimited':p.guest_passes?p.guest_passes+' per month':'none'}</span></li></ul>
        <button class="btn ${i===1?'btn-primary':'btn-outline'} btn-block" data-plan="${p.id}">Choose ${esc(p.name)}</button></div></div>`).join('');
  const rows=[['Monthly price',p=>money(p.monthly_price)],['Yearly price',p=>p.yearly_price?money(p.yearly_price):'—'],['Classes',p=>p.classes_included],['Personal training',p=>p.pt_sessions_included?p.pt_sessions_included+' / month':'À la carte'],['Recovery',p=>p.recovery_access],['Guest access',p=>p.guest_passes>100?'Unlimited':p.guest_passes?p.guest_passes+' / month':'None']];
  document.getElementById('cmpTable').innerHTML=`<table><thead><tr><th>Feature</th>${plans.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td>${plans.map(p=>`<td>${esc(String(r[1](p)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function toggleCompare(){document.getElementById('cmpTable').classList.toggle('open');}
function buyPlan(plan){
  if(!ME)return needLogin('Create an account or log in to join '+plan.name+'.',()=>buyPlan(plan));
  if(!memberOnly())return;
  const box=openModal(`<h3>Join ${esc(plan.name)}</h3><p class="sub">${esc(plan.description||'')}</p>
    ${field('Billing','cycle',{options:[['monthly',`Monthly · ${money(plan.monthly_price)}`],...(plan.yearly_price?[['yearly',`Yearly · ${money(plan.yearly_price)} (2 months free)`]]:[])]})}
    <p class="muted small" style="margin-bottom:14px">You'll be taken to secure checkout. Card details are handled by the payment provider and never stored by Iron Lab.</p><button class="btn btn-primary btn-block" id="pay">Continue to payment</button>`);
  $('#pay',box).onclick=(ev)=>withBtn(ev.target,async()=>{
    const r=await api('/memberships/purchase',{body:{plan_id:plan.id,billing_cycle:$('#f_cycle',box).value}});
    if(r.redirect_url){location.href=r.redirect_url;return;}
    closeModal();toast(r.message);setTimeout(()=>{location.href='/dashboard/member.html#membership';},900);
  });
}

/* ---- classes (live availability) ---- */
let CLASS_FILTER='All',CLASSES=[];
async function loadClasses(){
  try{CLASSES=(await api('/classes')).classes;}catch(e){document.getElementById('classGrid').innerHTML=`<p class="form-err">${esc(e.message)}</p>`;return;}
  const types=['All',...new Set(CLASSES.map(c=>c.type))];
  document.getElementById('classFilters').innerHTML=types.map(t=>`<div class="chip${t===CLASS_FILTER?' on':''}" data-t="${esc(t)}" tabindex="0" role="button">${esc(t)}</div>`).join('');
  document.getElementById('classGrid').innerHTML=CLASSES.filter(c=>CLASS_FILTER==='All'||c.type===CLASS_FILTER).map(c=>`
    <div class="class-card glass"><p class="day">${esc(c.day_name)} · ${fmtTime(c.start_time)}</p><h4>${esc(c.name)}</h4>
      <p>${esc(c.type)} with ${esc(c.trainer_name||'an Iron Lab coach')}</p>
      <p style="margin-top:8px;font-size:13px"><strong style="color:var(--white)">${c.booked} / ${c.capacity}</strong> booked · ${c.full?'<span style="color:#ff8a8f">FULLY BOOKED</span>':c.remaining+' spot'+(c.remaining===1?'':'s')+' remaining'}</p>
      ${c.my_status?`<button class="btn-ghost" style="margin-top:12px" data-ccancel="${c.id}">${c.my_status==='booked'?'Booked ✓ — cancel':'On waitlist — leave'}</button>`
        :`<button class="btn-ghost" style="margin-top:12px" data-cbook="${c.id}">${c.full?'Join waitlist':'Reserve spot'}</button>`}</div>`).join('')||'<p class="lede">No classes scheduled.</p>';
}
async function bookClass(id,waitlist){
  if(!ME)return needLogin('Log in to reserve your spot.',()=>bookClass(id,waitlist));
  if(!memberOnly())return;
  try{const r=await api(`/classes/${id}/book`,{body:{waitlist:!!waitlist}});toast(r.message);}
  catch(e){
    if(e.status===402){toast(e.message,'err');document.getElementById('memberships').scrollIntoView({behavior:'smooth'});}
    else if(e.status===409&&e.data&&e.data.can_waitlist){if(confirm('This class is fully booked. Join the waitlist? We will book you in automatically if a spot opens.'))return bookClass(id,true);}
    else toast(e.message,'err');
  }
  loadClasses();
}

/* ---- trainers ---- */
function renderTrainers(){
  document.getElementById('trainerGrid').innerHTML=CONTENT.trainers.map((t,i)=>`
    <div class="t-card glass"><div class="t-photo"><img src="${esc(t.photo_url||pick(IMGS.tr,i,1000))}" alt="${esc(t.name)}" loading="lazy"><i></i></div>
      <div class="t-body"><h4>${esc(t.name)}</h4><p class="t-spec">${esc(t.specialty)}</p>
        <div class="t-meta"><span>${t.experience_years} years experience</span><span>${esc(t.certifications||'')}</span><span>From ${money(t.session_price)} / session</span></div>
        <p class="t-bio">${esc(t.bio)}</p><button class="btn btn-outline btn-block" data-trainer="${t.id}">Book Session</button></div></div>`).join('');
}
function bookTrainer(id){
  const t=CONTENT.trainers.find(x=>x.id==id);
  if(!ME)return needLogin('Log in to book a session with '+t.name+'.',()=>bookTrainer(id));
  if(!memberOnly())return;
  const box=openModal(`<h3>Book ${esc(t.name)}</h3><p class="sub">${esc(t.specialty)} · ${money(t.session_price)} per 60-minute session (sessions included in your plan are free).</p>
    ${field('Date','date',{type:'date',min:today(),value:today()})}<div id="slots" class="filters"></div><p class="form-err" role="alert"></p><div id="slotAct"></div>`,true);
  let chosen=null;
  const load=async()=>{chosen=null;$('#slotAct',box).innerHTML='';
    try{const s=await api(`/trainers/${id}/slots?date=${$('#f_date',box).value}`);
      $('#slots',box).innerHTML=s.slots.length?s.slots.map(x=>`<div class="chip" ${x.available?'':'style="opacity:.35;text-decoration:line-through;pointer-events:none"'} data-slot="${x.start_time}" tabindex="0" role="button">${fmtTime(x.start_time)}</div>`).join(''):'<p class="muted small">No availability on this day — try another date.</p>';}
    catch(e){$('.form-err',box).textContent=e.message;}};
  $('#f_date',box).onchange=load;load();
  box.addEventListener('click',(ev)=>{const b=ev.target.closest('[data-slot]');if(!b)return;
    $$('[data-slot]',box).forEach(x=>x.classList.toggle('on',x===b));chosen=b.dataset.slot;
    $('#slotAct',box).innerHTML='<button class="btn btn-primary btn-block" id="confirmSlot">Confirm booking</button>';
    $('#confirmSlot',box).onclick=(e2)=>withBtn(e2.target,async()=>{
      try{const r=await api(`/trainers/${id}/book`,{body:{date:$('#f_date',box).value,start_time:chosen}});
        if(r.redirect_url){location.href=r.redirect_url;return;}closeModal();toast(r.message);}
      catch(x){$('.form-err',box).textContent=x.message;await load();throw x;}});});
}

/* ---- render everything from the CMS-backed API ---- */
function renderContent(){
  const s=CONTENT.settings;
  if(s.hero_headline){const w=String(s.hero_headline).trim().split(/\s+/),k=Math.ceil(w.length/2);document.querySelector('.hero h1').innerHTML=esc(w.slice(0,k).join(' '))+'<br><span class="accent">'+esc(w.slice(k).join(' '))+'</span>';}
  if(s.hero_subhead)document.querySelector('.hero-sub').textContent=s.hero_subhead;
  if(s.hero_video_url&&/^https?:\/\//.test(s.hero_video_url)){const v=document.querySelector('.hero-bgvideo video');if(v){v.innerHTML='<source src="'+esc(s.hero_video_url)+'" type="video/mp4">';v.load();v.play().catch(()=>{});}}
  if(s.announcement){const p=document.createElement('p');p.className='eyebrow';p.style.cssText='margin-bottom:14px;padding:8px 12px;border:1px solid var(--line2);display:inline-block';p.textContent=s.announcement;document.querySelector('.hero-copy').prepend(p);}
  if(s.whatsapp_number&&/^\d{7,15}$/.test(s.whatsapp_number)){window.WA_URL='https://wa.me/'+s.whatsapp_number;const w=document.getElementById('waLink');if(w)w.href=window.WA_URL;}
  renderPlans();renderTrainers();
  document.getElementById('facTrack').innerHTML=CONTENT.facilities.map((f,i)=>`
    <div class="fac-card glass"><div class="fbg" style="background-image:url('${esc(f.image_url||pick(IMGS.fac,i,1600))}')"></div><div class="fgrad"></div><h4>${esc(f.name)}</h4><p>${esc(f.description)}</p></div>`).join('');
  document.getElementById('storyGrid').innerHTML=CONTENT.testimonials.map((t,i)=>`
    <div class="res-card"><div class="fbg" style="background-image:url('${esc(t.photo_url||pick(IMGS.st,i,1000))}')"></div><p class="dur">${esc(t.duration)}</p>
      <div><div class="res-metric" style="font-size:clamp(44px,6vw,76px)">${esc(t.goal)}</div><h4 style="margin-top:18px">${esc(t.member_name)} <span style="color:var(--accent);font-size:15px">${'★'.repeat(t.rating||5)}</span></h4><p class="res" style="margin-top:8px">${esc(t.result)}</p></div></div>`).join('')||'<p class="lede">Member stories coming soon.</p>';
  document.getElementById('faqList').innerHTML=CONTENT.faqs.map((f,i)=>`
    <div class="faq-item" id="faq${i}"><button class="faq-q" onclick="toggleFaq(${i})">${esc(f.question)}<i></i></button><div class="faq-a"><p>${esc(f.answer)}</p></div></div>`).join('');
}
function toggleFaq(i){document.getElementById('faq'+i).classList.toggle('open');}

/* ---- delegated clicks (no inline handlers on dynamic HTML) ---- */
document.addEventListener('click',(e)=>{
  const t=e.target.closest('[data-plan],[data-cbook],[data-ccancel],[data-trainer],.chip[data-t]');if(!t)return;
  if(t.dataset.plan)return buyPlan(CONTENT.plans.find(p=>p.id==t.dataset.plan));
  if(t.dataset.cbook){return bookClass(Number(t.dataset.cbook),false);}
  if(t.dataset.ccancel){if(confirm('Cancel this booking?'))api(`/classes/${t.dataset.ccancel}/cancel`,{body:{}}).then(r=>{toast(r.message);loadClasses();}).catch(x=>toast(x.message,'err'));return;}
  if(t.dataset.trainer)return bookTrainer(t.dataset.trainer);
  if(t.dataset.t){CLASS_FILTER=t.dataset.t;loadClasses();}
});

async function renderDynamic(){
  await refreshMe();
  try{CONTENT=await api('/public/content');renderContent();}
  catch(e){toast('Could not load site content: '+e.message,'err');}
  await loadClasses();
  try{if(!sessionStorage.getItem('il_pv')){sessionStorage.setItem('il_pv','1');api('/track',{body:{event:'page_view'}}).catch(()=>{});}}catch(_){}
}

function startMotion(){
/* ---------- Reveals: masked headlines + slow fades ---------- */
document.querySelectorAll('.hero h1,.section-head h2,.experience h2,.cine h2,.final h2').forEach(h=>{h.innerHTML=`<span class="rt"><span>${h.innerHTML}</span></span>`;});
const revealTargets=document.querySelectorAll('.rt,.hero-sub,.hero-ctas,.train-card,.t-card,.plans,.res-card,.fac-track,.tour-layout,.finder-wrap,.class-grid');
const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target);}}),{threshold:.12,rootMargin:'0px 0px -6% 0px'});
revealTargets.forEach(el=>{
  if(!el.classList.contains('rt')){
    el.classList.add('rv');
    if(el.matches('.train-card,.t-card,.res-card'))el.style.transitionDelay=[...el.parentElement.children].indexOf(el)*.12+'s';
  }
  io.observe(el);
});
document.querySelectorAll('.hero-sub,.hero-ctas').forEach((el,i)=>el.style.transitionDelay=(.35+i*.2)+'s');

/* ---------- Cursor + horizontal drag ---------- */
if(matchMedia('(hover:hover) and (pointer:fine)').matches){
  const cur=document.getElementById('cursor');cur.style.display='block';
  let tx=0,ty=0,cx=0,cy=0;
  addEventListener('mousemove',e=>{tx=e.clientX;ty=e.clientY;});
  (function loop(){cx+=(tx-cx)*.16;cy+=(ty-cy)*.16;cur.style.transform=`translate(${cx}px,${cy}px) translate(-50%,-50%)`;requestAnimationFrame(loop);})();
  document.addEventListener('mouseover',e=>cur.classList.toggle('big',!!e.target.closest('a,button,.f-opt,.chip,.tour-map rect')));
}
document.querySelectorAll('.wide-scroll').forEach(el=>{
  let down=false,sx=0,sl=0;
  el.addEventListener('mousedown',e=>{down=true;sx=e.pageX;sl=el.scrollLeft;el.classList.add('drag');});
  addEventListener('mouseup',()=>{down=false;el.classList.remove('drag');});
  el.addEventListener('mousemove',e=>{if(down)el.scrollLeft=sl-(e.pageX-sx)*1.2;});
});

}

renderDynamic().catch(()=>{}).finally(startMotion);
