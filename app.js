(function () {
  "use strict";

  const C = window.QUEST_CONTENT;
  const STORAGE_KEY = "nihongo-trip-quest-v1";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const app = $("#app");
  const exerciseDialog = $("#exerciseDialog");
  const phraseDialog = $("#phraseDialog");
  const defaultProgress = {
    version:1, welcomed:false, xp:0, streak:0, lastCompletedDate:null,
    completedLessons:[], completedModules:{}, mistakes:[], favorites:[],
    assessments:{}, streakShieldWeek:null, preferredSpeed:1
  };
  let progress = loadProgress();
  let currentView = "today";
  let selectedLessonId = null;
  let activeAudio = null;
  let recognition = null;
  let recorder = null;
  let recordingChunks = [];
  let recordingUrl = null;
  const QUESTION_COUNTS = {katakana:10,review:8,dialogue:5,listening:4,speaking:3};

  function loadProgress() {
    try { return {...structuredClone(defaultProgress), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")}; }
    catch (_) { return structuredClone(defaultProgress); }
  }
  function saveProgress() { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function localNoon(iso) { const [y,m,d] = iso.split("-").map(Number); return new Date(y,m-1,d,12); }
  function dayDiff(a,b) { return Math.round((localNoon(b)-localNoon(a))/86400000); }
  function displayDate(iso) {
    const d=localNoon(iso); return `${d.getMonth()+1}月${d.getDate()}日 · ${"日一二三四五六"[d.getDay()]}`;
  }
  function getLessonForDate(date=todayIso()) {
    if (date < C.start) return C.lessons[0];
    if (date > C.end) return C.lessons[C.lessons.length-1];
    return C.lessons.find(l=>l.date===date) || C.lessons[0];
  }
  function isTravelTime() { return todayIso() >= C.travelStart; }
  function weekKey(iso) {
    const d=localNoon(iso); const jan=new Date(d.getFullYear(),0,1,12);
    return `${d.getFullYear()}-${Math.ceil((((d-jan)/86400000)+jan.getDay()+1)/7)}`;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }
  function shuffle(items) { return [...items].sort(()=>Math.random()-.5); }
  function toast(message) {
    const el=$("#toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),2200);
  }
  function stopMedia() {
    if (activeAudio) { activeAudio.pause(); activeAudio=null; }
    if (recognition) { try { recognition.abort(); } catch (_) {} recognition=null; }
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (_) {} }
    recorder=null;
  }
  function speak(text, rate=1) {
    if (!("speechSynthesis" in window)) return toast("当前浏览器不支持语音播放");
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text); u.lang="ja-JP"; u.rate=rate; speechSynthesis.speak(u);
  }
  function nav(view) {
    stopMedia(); currentView=view; closeDrawer();
    $$(".bottom-nav button").forEach(b=>b.classList.toggle("active", b.dataset.view===view));
    if(view==="today") renderToday();
    else if(view==="passport") renderPassport();
    else if(view==="dialogue-review") renderDialogueReview();
    else if(view==="travel") renderTravel();
    else if(view==="makeup") renderMakeup();
    else if(view==="bonus") renderBonus();
    else if(view==="settings") renderSettings();
    app.focus(); window.scrollTo({top:0,behavior:"smooth"});
  }

  function openDrawer() { $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden","false"); $("#scrim").hidden=false; }
  function closeDrawer() { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden","true"); $("#scrim").hidden=true; }

  function activeLesson() {
    if (selectedLessonId) return C.lessons.find(l=>l.id===selectedLessonId) || getLessonForDate();
    return getLessonForDate();
  }
  function moduleDone(lesson,id) { return (progress.completedModules[lesson.id]||[]).includes(id); }
  function allModulesDone(lesson) { return lesson.modules.every(m=>moduleDone(lesson,m.id)); }
  function completionPct() { return Math.round(progress.completedLessons.length/C.lessons.length*100); }

  function renderToday() {
    if (isTravelTime() && !selectedLessonId) return renderTravel(true);
    const lesson=activeLesson();
    const pct=Math.min(100,Math.round(lesson.index/C.lessons.length*100));
    const route=Math.min(100,Math.round(((lesson.index-1)/(C.lessons.length-1))*100));
    const dayLabel = selectedLessonId && lesson.date!==todayIso() ? `补关 · ${displayDate(lesson.date)}` : displayDate(lesson.date);
    app.innerHTML=`
      <section class="hero">
        <div class="eyebrow">${escapeHtml(dayLabel)} ${lesson.weeklyBoss?"· BOSS DAY":""}</div>
        <h1>${escapeHtml(lesson.title)}</h1>
        <p>${escapeHtml(lesson.subtitle)}。完成五项任务，盖下今天的旅行印章。</p>
        <div class="hero-meta"><span class="pill">第 ${lesson.index}/79 天</span><span class="pill">核心 60 分钟</span><span class="pill">${escapeHtml(lesson.place)}</span></div>
        <div class="route-line" style="--route-progress:${route}%">
          ${["出发","札幌","洞爷","函馆","东京"].map((x,i)=>`<span class="route-stop ${route>=i*25?"done":""}"><i></i>${x}</span>`).join("")}
        </div>
      </section>
      <section class="stat-strip">
        <div class="stat"><strong>${progress.streak}</strong><small>连续天数</small></div>
        <div class="stat"><strong>${progress.xp}</strong><small>旅行 XP</small></div>
        <div class="stat"><strong>${pct}%</strong><small>路线进度</small></div>
      </section>
      <div class="section-head"><div><h2>今日任务</h2><p>五关共30题，合计60分钟</p></div><button data-go="bonus">加练</button></div>
      <section class="mission-list">
        ${lesson.modules.map(m=>missionCard(lesson,m)).join("")}
      </section>
      <button class="primary full completion-cta" id="completeDay" ${allModulesDone(lesson)?"":"disabled"}>${progress.completedLessons.includes(lesson.id)?"今日印章已盖好":"完成今天 · 盖旅行印章"}</button>
      ${selectedLessonId?`<button class="ghost full" style="margin-top:10px" id="backToday">返回今天</button>`:""}
    `;
    $$("[data-module]",app).forEach(b=>b.addEventListener("click",()=>openExercise(lesson,b.dataset.module)));
    $("#completeDay").addEventListener("click",()=>completeLesson(lesson));
    $("[data-go='bonus']").addEventListener("click",()=>nav("bonus"));
    if($("#backToday")) $("#backToday").addEventListener("click",()=>{selectedLessonId=null;renderToday();});
  }

  function missionCard(lesson,m) {
    const meta=C.moduleMeta[m.id]; const done=moduleDone(lesson,m.id);
    return `<button class="mission-card ${done?"done":""}" data-module="${m.id}">
      <span class="mission-icon">${meta.icon}</span>
      <span class="mission-copy"><strong>${meta.name} · ${m.minutes}分钟</strong><small>${QUESTION_COUNTS[m.id]}题 · ${meta.hint}</small></span>
      <span class="mission-status">${done?"✓ 完成":"开始 ›"}</span>
    </button>`;
  }

  function openExercise(lesson,moduleId) {
    const module=lesson.modules.find(m=>m.id===moduleId); if(!module)return;
    const renderers={katakana:renderKatakana,review:renderReview,dialogue:renderDialogue,listening:renderListening,speaking:renderSpeaking};
    renderers[moduleId](lesson,module);
    exerciseDialog.showModal();
  }
  function shell(label,title,body,actions="",question=null) {
    const doneCount=activeLesson().modules.filter(m=>moduleDone(activeLesson(),m.id)).length;
    const progressValue=question?Math.round((question.completed/question.total)*100):doneCount*20;
    const progressLabel=question?`${question.index+1}/${question.total}题`:`${doneCount}/5`;
    return `<div class="exercise-shell">
      <div class="exercise-top"><button class="dialog-close" data-exit>×</button><div class="bar"><i style="width:${progressValue}%"></i></div><strong>${progressLabel}</strong></div>
      <div class="exercise-body"><div class="exercise-label">${label}</div><h2>${title}</h2>${body}</div>
      <div class="exercise-actions">${actions}</div>
    </div>`;
  }
  function bindExit() { $("[data-exit]",exerciseDialog).addEventListener("click",()=>{stopMedia();exerciseDialog.close();}); }
  function questionSequence(pool,anchor,count=5) {
    const start=Math.max(0,pool.findIndex(item=>item.id===anchor.id));
    return Array.from({length:Math.min(count,pool.length)},(_,i)=>pool[(start+i)%pool.length]);
  }
  function questionNav(index,total,done) {
    return `<button class="ghost" data-prev ${index===0?"disabled":""}>← 上一题</button><span class="question-counter">${index+1} / ${total}</span><button class="primary" data-next ${done?"":"disabled"}>${index===total-1?"完成本关":"下一题 →"}</button>`;
  }
  function questionMeta(index,states,total) {
    return {index,total,completed:states.filter(state=>state?.done).length};
  }
  function bindQuestionNav(index,states,draw,finish) {
    const previous=$("[data-prev]",exerciseDialog);
    const next=$("[data-next]",exerciseDialog);
    if(previous)previous.addEventListener("click",()=>{stopMedia();draw(index-1);});
    if(next)next.addEventListener("click",()=>{
      if(!states[index]?.done)return;
      stopMedia();
      if(index===states.length-1){
        if(states.every(state=>state?.done))finish();
        else toast("还有题目没有完成");
      } else draw(index+1);
    });
  }
  function finishModule(lesson,moduleId,score=true) {
    const list=progress.completedModules[lesson.id]||[];
    if(!list.includes(moduleId)) { list.push(moduleId); progress.completedModules[lesson.id]=list; progress.xp+=10; }
    if (lesson.phase==="final" && ["listening","speaking"].includes(moduleId)) {
      progress.assessments[lesson.id] = {...(progress.assessments[lesson.id]||{}),[moduleId]:score};
    }
    saveProgress(); stopMedia(); exerciseDialog.close(); renderToday(); toast("完成一关 · +10 XP");
  }
  function addMistake(type,id) {
    const existing=progress.mistakes.find(m=>m.type===type&&m.refId===id);
    if(existing) { existing.stage=0; existing.due=offsetIso(todayIso(),1); }
    else progress.mistakes.push({id:`${type}-${id}-${Date.now()}`,type,refId:id,stage:0,due:offsetIso(todayIso(),1)});
    saveProgress();
  }
  function offsetIso(iso,n) { const d=localNoon(iso); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

  function renderKatakana(lesson,module) {
    const items=questionSequence(C.katakana,module.item,QUESTION_COUNTS.katakana);
    const states=Array(items.length).fill(null);
    function draw(index) {
      const item=items[index];
      const previous=states[index];
      const choices=previous?.choices||shuffle([item,...shuffle(C.katakana.filter(x=>x.id!==item.id)).slice(0,2)]);
      exerciseDialog.innerHTML=shell("KATAKANA SPRINT","认出这个旅行词",`
        <div class="jp-large">${item.jp}</div><p class="kana">来自英语：${item.source}</p>
        <div class="choice-grid">${choices.map(c=>{const chosen=previous?.selected===c.id;const cls=previous?.done?(c.id===item.id?"correct":chosen?"wrong":""):"";return `<button data-choice="${c.id}" class="${cls}" ${previous?.done?"disabled":""}>${c.cn}</button>`;}).join("")}</div>
        <div class="answer-panel ${previous?.done?"show":""}" id="answerPanel"><strong>${item.jp}</strong> · ${item.cn}<br><small>点击播放，跟读三遍</small></div>
        <button class="ghost full inline-practice" data-audio>▶ 发音</button>
      `,questionNav(index,items.length,previous?.done),questionMeta(index,states,items.length));
      bindExit();
      $$("[data-choice]",exerciseDialog).forEach(button=>button.addEventListener("click",()=>{
        if(states[index]?.done)return;
        const ok=button.dataset.choice===item.id;
        states[index]={done:true,selected:button.dataset.choice,choices};
        if(!ok)addMistake("katakana",item.id);
        draw(index);
      }));
      $("[data-audio]",exerciseDialog).addEventListener("click",()=>speak(item.jp,.9));
      bindQuestionNav(index,states,draw,()=>finishModule(lesson,module.id));
    }
    draw(0);
  }

  function mistakeItem(m) {
    if(!m)return null;
    const pool=m.type==="katakana"?C.katakana:m.type==="announcement"?C.announcements:C.dialogues;
    return pool.find(x=>x.id===m.refId)||null;
  }
  function renderReview(lesson,module) {
    const dueEntries=progress.mistakes.filter(m=>m.due<=todayIso()).map(m=>({item:mistakeItem(m),mistake:m})).filter(entry=>entry.item);
    const entries=[];
    dueEntries.forEach(entry=>{if(entries.length<QUESTION_COUNTS.review&&!entries.some(x=>x.item.id===entry.item.id))entries.push(entry);});
    questionSequence(C.dialogues,module.item,C.dialogues.length).forEach(item=>{if(entries.length<QUESTION_COUNTS.review&&!entries.some(x=>x.item.id===item.id))entries.push({item,mistake:null});});
    const states=Array(entries.length).fill(null);
    function draw(index) {
      const {item,mistake}=entries[index];
      const state=states[index]||{};
      const isKat=Boolean(item.source);
      const question=isKat?`${item.jp} 是什么意思？`:(item.prompt||"你还记得这句广播吗？");
      const jp=item.jp; const kana=item.kana||`来自英语：${item.source}`; const cn=item.cn;
      exerciseDialog.innerHTML=shell("SPACED REVIEW",mistake?"到期错题回炉":"热身复习",`
        <p>${escapeHtml(question)}</p>
        <div class="answer-panel ${state.revealed||state.done?"show":""}" id="answerPanel"><div class="jp-large" style="font-size:27px">${jp}</div><p class="kana">${kana}</p><div class="translation">${cn}</div>${state.done?`<p class="question-result">${state.result==="good"?"✓ 已记住":"↺ 已加入复习"}</p>`:""}</div>
        ${state.revealed||state.done?"":`<button class="secondary full" id="reveal" style="margin-top:20px">显示答案</button>`}
        ${state.revealed&&!state.done?`<div class="review-result-actions"><button class="ghost" data-result="hard">还要复习</button><button class="primary" data-result="good">记住了</button></div>`:""}
      `,questionNav(index,entries.length,state.done),questionMeta(index,states,entries.length));
      bindExit();
      if($("#reveal",exerciseDialog))$("#reveal",exerciseDialog).addEventListener("click",()=>{states[index]={...state,revealed:true,done:false};speak(jp,.88);draw(index);});
      $$("[data-result]",exerciseDialog).forEach(button=>button.addEventListener("click",()=>{
        if(states[index]?.done)return;
        const result=button.dataset.result;
        if(mistake){
          if(result==="good"){
            mistake.stage++;
            const gaps=[1,3,7];
            if(mistake.stage>=gaps.length)progress.mistakes=progress.mistakes.filter(x=>x.id!==mistake.id);
            else mistake.due=offsetIso(todayIso(),gaps[mistake.stage]);
          } else mistake.due=offsetIso(todayIso(),1);
          saveProgress();
        }
        states[index]={revealed:true,done:true,result};
        draw(index);
      }));
      bindQuestionNav(index,states,draw,()=>finishModule(lesson,module.id));
    }
    draw(0);
  }

  function renderDialogue(lesson,module) {
    const items=questionSequence(C.dialogues,module.item,QUESTION_COUNTS.dialogue);
    const states=Array(items.length).fill(null);
    function draw(index) {
      const item=items[index];
      const state=states[index];
      exerciseDialog.innerHTML=shell("SCENE DIALOGUE",item.theme,`
        <p>${item.prompt}</p><div class="choice-grid">${item.choices.map((choice,i)=>{const chosen=state?.selected===i;const cls=state?.done?(i===item.answer?"correct":chosen?"wrong":""):"";return `<button data-choice="${i}" class="${cls}" ${state?.done?"disabled":""}>${choice}</button>`;}).join("")}</div>
        <div class="answer-panel ${state?.done?"show":""}" id="answerPanel"><div class="jp-ruby dialogue-ruby">${item.ruby||escapeHtml(item.jp)}</div><div class="translation">${item.cn}</div></div>
        <button class="ghost full inline-practice" data-audio>▶ 听答案并跟读</button>
      `,questionNav(index,items.length,state?.done),questionMeta(index,states,items.length));
      bindExit();
      $$("[data-choice]",exerciseDialog).forEach(button=>button.addEventListener("click",()=>{
        if(states[index]?.done)return;
        const selected=Number(button.dataset.choice); const ok=selected===item.answer;
        states[index]={done:true,selected};
        if(!ok)addMistake("dialogue",item.id);
        speak(item.jp,.88); draw(index);
      }));
      $("[data-audio]",exerciseDialog).addEventListener("click",()=>speak(item.jp,.88));
      bindQuestionNav(index,states,draw,()=>finishModule(lesson,module.id));
    }
    draw(0);
  }

  function playAnnouncement(item,rate) {
    stopMedia(); activeAudio=new Audio(item.audio); activeAudio.playbackRate=rate;
    activeAudio.play().catch(()=>{ activeAudio=null; speak(item.jp,rate); });
  }
  function renderListening(lesson,module) {
    const items=questionSequence(C.announcements,module.item,QUESTION_COUNTS.listening);
    const states=items.map(item=>({done:false,selected:[],options:shuffle([...item.keywords,...item.distractors]).slice(0,7)}));
    let rate=progress.preferredSpeed||1;
    function draw(index) {
      const item=items[index]; const state=states[index];
      exerciseDialog.innerHTML=shell("STATION ANNOUNCEMENT",item.title,`
        <p>先不看原文，播放广播并选出你听到的关键信息。</p>
        <div class="speed-note">清晰学习版 · 日语系统声线 · 可调语速</div>
        <div class="audio-controls"><button data-speed=".75">0.75×</button><button data-speed="1">1×</button><button data-speed="1.15">1.15×</button></div>
        <button class="ghost full" id="playAudio">▶ 播放广播</button>
        <div class="choice-grid keyword-grid">${state.options.map(option=>{
          const selected=state.selected.includes(option); const correct=item.keywords.includes(option);
          const cls=state.done?(selected&&correct?"correct":correct?"missed":selected?"wrong":""):selected?"selected":"";
          const feedback=state.done?(selected&&correct?"选对":correct?"漏选":selected?"错选":""):"";
          return `<button data-keyword="${escapeHtml(option)}" class="${cls}" ${state.done?"disabled":""}><span>${escapeHtml(option)}</span>${feedback?`<small>${feedback}</small>`:""}</button>`;
        }).join("")}</div>
        ${state.done?`<div class="question-result">抓到 ${state.hits}/${item.keywords.length} 个关键词</div>`:`<button class="secondary full inline-practice" id="checkListen">检查关键词</button>`}
        <div class="answer-panel ${state.done?"show":""}" id="answerPanel"><div class="jp-ruby">${item.ruby||escapeHtml(item.jp)}</div><div class="translation">${item.cn}</div></div>
      `,questionNav(index,items.length,state.done),questionMeta(index,states,items.length));
      bindExit();
      $$("[data-speed]",exerciseDialog).forEach(button=>{button.classList.toggle("active",Number(button.dataset.speed)===rate);button.addEventListener("click",()=>{rate=Number(button.dataset.speed);progress.preferredSpeed=rate;saveProgress();$$('[data-speed]',exerciseDialog).forEach(x=>x.classList.toggle('active',x===button));playAnnouncement(item,rate);});});
      $("#playAudio",exerciseDialog).addEventListener("click",()=>playAnnouncement(item,rate));
      $$("[data-keyword]",exerciseDialog).forEach(button=>button.addEventListener("click",()=>{
        if(state.done)return;
        const keyword=button.dataset.keyword;
        if(state.selected.includes(keyword))state.selected=state.selected.filter(x=>x!==keyword);
        else state.selected.push(keyword);
        draw(index);
      }));
      if($("#checkListen",exerciseDialog))$("#checkListen",exerciseDialog).addEventListener("click",()=>{
        const hits=item.keywords.filter(keyword=>state.selected.includes(keyword)).length;
        state.hits=hits; state.score=hits/item.keywords.length; state.done=true;
        if(state.score<.66)addMistake("announcement",item.id);
        draw(index);
      });
      bindQuestionNav(index,states,draw,()=>{
        const passed=states.filter(state=>state.score>=.8).length/items.length>=.8;
        finishModule(lesson,module.id,passed);
      });
    }
    draw(0);
  }

  function normalized(s) { return String(s||"").replace(/[\s、。！？,.!?]/g,"").replace(/ヶ/g,"ケ").toLowerCase(); }
  function scoreSpeech(transcript,keywords) { const t=normalized(transcript); const hits=keywords.filter(k=>t.includes(normalized(k))).length; return {hits,total:keywords.length,pass:hits>=Math.max(1,Math.ceil(keywords.length*.5))}; }
  function renderSpeaking(lesson,module) {
    const items=questionSequence(C.bosses,module.item,QUESTION_COUNTS.speaking);
    const states=Array(items.length).fill(null);
    function draw(index) {
      const item=items[index]; const state=states[index];
      exerciseDialog.innerHTML=shell("SPEAKING BOSS",item.scene,`
        <p>${item.ask}</p><button class="ghost full" id="showModel">需要提示</button>
        <div class="answer-panel ${state?.done?"show":""}" id="answerPanel"><strong>${item.answer}</strong><p class="kana">${item.kana}</p><button class="ghost" id="hearModel">▶ 听示范</button></div>
        ${state?.done?`<div class="question-result">${state.pass?"✓ 关键表达达标":"✓ 已完成自评"}</div>`:`<button class="mic-orb" id="micButton" aria-label="开始口语识别">🎙</button><div class="transcript" id="transcript">点一下麦克风，用日语回答</div><div id="speechFallback"></div><div class="speaking-check-actions"><button class="ghost" id="selfRetry">再说一次</button><button class="primary" id="selfPass" disabled>确认本题</button></div>`}
      `,questionNav(index,items.length,state?.done),questionMeta(index,states,items.length));
      bindExit();
      $("#showModel",exerciseDialog).addEventListener("click",()=>$("#answerPanel",exerciseDialog).classList.add("show"));
      $("#hearModel",exerciseDialog).addEventListener("click",()=>speak(item.answer,.86));
      if($("#micButton",exerciseDialog))$("#micButton",exerciseDialog).addEventListener("click",()=>startRecognition(item));
      if($("#selfRetry",exerciseDialog))$("#selfRetry",exerciseDialog).addEventListener("click",()=>{$("#transcript",exerciseDialog).textContent="点一下麦克风，再试一次";$("#selfPass",exerciseDialog).disabled=true;});
      if($("#selfPass",exerciseDialog))$("#selfPass",exerciseDialog).addEventListener("click",()=>{
        states[index]={done:true,pass:$("#selfPass",exerciseDialog).dataset.pass==="true"};
        stopMedia(); draw(index);
      });
      bindQuestionNav(index,states,draw,()=>{
        const passed=states.filter(state=>state.pass).length/items.length>=.8;
        finishModule(lesson,module.id,passed);
      });
    }
    draw(0);
  }

  function startRecognition(item) {
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition) return showRecorderFallback(item);
    recognition=new SpeechRecognition(); recognition.lang="ja-JP"; recognition.interimResults=false; recognition.maxAlternatives=3;
    const mic=$("#micButton",exerciseDialog); mic.classList.add("listening"); $("#transcript",exerciseDialog).textContent="正在听…说完后稍等一下";
    recognition.onresult=e=>{
      const alternatives=Array.from(e.results[0]).map(x=>x.transcript); const best=alternatives.map(t=>({t,s:scoreSpeech(t,item.keywords)})).sort((a,b)=>b.s.hits-a.s.hits)[0];
      mic.classList.remove("listening"); $("#transcript",exerciseDialog).innerHTML=`识别到：<strong>${escapeHtml(best.t)}</strong><br>${best.s.pass?`抓到 ${best.s.hits}/${best.s.total} 个关键表达，过关！`:`抓到 ${best.s.hits}/${best.s.total} 个关键表达，再试一次或自评。`}`;
      $("#selfPass",exerciseDialog).disabled=false; $("#selfPass",exerciseDialog).dataset.pass=String(best.s.pass);
      if(!best.s.pass)$("#answerPanel",exerciseDialog).classList.add("show"); recognition=null;
    };
    recognition.onerror=e=>{mic.classList.remove("listening"); recognition=null; if(["not-allowed","service-not-allowed","audio-capture"].includes(e.error))showRecorderFallback(item);else{$("#transcript",exerciseDialog).textContent="这次没听清，可以再试或改用录音自评。";showRecorderFallback(item);}};
    recognition.onend=()=>mic.classList.remove("listening");
    try{recognition.start();}catch(_){showRecorderFallback(item);}
  }

  async function showRecorderFallback(item) {
    const box=$("#speechFallback",exerciseDialog); $("#answerPanel",exerciseDialog).classList.add("show");
    box.innerHTML=`<div class="translation"><strong>录音回放自评</strong><br><small>录音只保留在当前页面，关闭即删除。</small><br><button class="secondary" id="recordButton" style="margin-top:10px">● 开始录音</button><div id="recordPlayback"></div></div>`;
    $("#transcript",exerciseDialog).textContent="自动识别不可用。请录下回答，与示范对照。";
    const btn=$("#recordButton",exerciseDialog);
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){btn.textContent="当前浏览器无法录音 · 可直接自评";btn.disabled=true;$("#selfPass",exerciseDialog).disabled=false;$("#selfPass",exerciseDialog).dataset.pass="true";return;}
    btn.addEventListener("click",async()=>{
      if(recorder&&recorder.state==="recording"){recorder.stop();btn.textContent="● 开始录音";return;}
      try{
        const stream=await navigator.mediaDevices.getUserMedia({audio:true}); recordingChunks=[]; recorder=new MediaRecorder(stream);
        recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};
        recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());if(recordingUrl)URL.revokeObjectURL(recordingUrl);recordingUrl=URL.createObjectURL(new Blob(recordingChunks,{type:recorder.mimeType}));$("#recordPlayback",exerciseDialog).innerHTML=`<audio controls src="${recordingUrl}" style="width:100%;margin-top:10px"></audio>`;$("#selfPass",exerciseDialog).disabled=false;$("#selfPass",exerciseDialog).dataset.pass="true";};
        recorder.start(); btn.textContent="■ 停止并回放";
      }catch(_){btn.textContent="麦克风未授权 · 可直接自评";btn.disabled=true;$("#selfPass",exerciseDialog).disabled=false;$("#selfPass",exerciseDialog).dataset.pass="true";}
    });
  }

  function completeLesson(lesson) {
    if(!allModulesDone(lesson))return;
    if(!progress.completedLessons.includes(lesson.id)){
      progress.completedLessons.push(lesson.id); progress.xp+=50;
      const last=progress.lastCompletedDate;
      if(!last)progress.streak=1;
      else { const gap=dayDiff(last,lesson.date); if(gap===1)progress.streak+=1; else if(gap===2&&progress.streakShieldWeek!==weekKey(lesson.date)){progress.streak+=1;progress.streakShieldWeek=weekKey(lesson.date);toast("使用本周连胜保护");} else if(gap>1)progress.streak=1; }
      if(!last||lesson.date>last)progress.lastCompletedDate=lesson.date;
      saveProgress();
    }
    renderToday(); toast("旅行印章已盖下 · +50 XP");
  }

  function renderPassport() {
    const earned=progress.completedLessons.length; const phaseCounts=C.phases.map(p=>C.lessons.filter(l=>l.phase===p.id&&progress.completedLessons.includes(l.id)).length);
    const finalLessons=C.lessons.slice(-5); const listenScores=finalLessons.map(l=>progress.assessments[l.id]?.listening).filter(v=>v!==undefined); const speechPass=finalLessons.filter(l=>progress.assessments[l.id]?.speaking===true).length;
    const ready=listenScores.length===5&&listenScores.filter(Boolean).length>=4&&speechPass>=4;
    app.innerHTML=`
      <section class="hero"><div class="eyebrow">TRAVEL PASSPORT</div><h1>我的旅行护照</h1><p>每一次开口，都是一次提前抵达。</p><div class="hero-meta"><span class="pill">${earned} 枚印章</span><span class="pill">${progress.xp} XP</span><span class="pill">${progress.streak} 天连胜</span></div></section>
      <div class="section-head"><div><h2>路线完成度</h2><p>${earned}/79 站</p></div><strong>${completionPct()}%</strong></div>
      <div class="progress-bar"><i style="width:${completionPct()}%"></i></div>
      <div class="section-head"><div><h2>阶段印章</h2><p>完成一个阶段即可盖满</p></div></div>
      <section class="stamp-grid">${C.phases.map((p,i)=>{const total=C.lessons.filter(l=>l.phase===p.id).length;const done=phaseCounts[i];return `<div class="stamp ${done===total?"earned":""}">${p.name}<br>${done}/${total}</div>`;}).join("")}</section>
      <div class="section-head"><div><h2>对话复习册</h2><p>回看已经完成的场景对话</p></div><button id="openDialogueReview">打开复习册</button></div>
      <div class="section-head"><div><h2>出发就绪度</h2><p>最后5天累计评估</p></div></div>
      <section class="panel"><div class="final-score">${ready?"READY":`${Math.round(((listenScores.filter(Boolean).length+speechPass)/10)*100)||0}%`}</div><p>交通广播达标 ${listenScores.filter(Boolean).length}/5 · 口语情境通过 ${speechPass}/5</p><p>${ready?"你已达到本次旅行的出发标准。":"完成12月21—25日的无中文模拟，广播至少4/5、口语至少4/5即可通关。"}</p></section>`;
    $("#openDialogueReview").addEventListener("click",()=>nav("dialogue-review"));
  }

  function dialogueItemsForLesson(lesson) {
    const module=lesson.modules.find(item=>item.id==="dialogue");
    return module?questionSequence(C.dialogues,module.item,QUESTION_COUNTS.dialogue):[];
  }
  function renderDialogueReview() {
    const lessons=C.lessons.filter(lesson=>moduleDone(lesson,"dialogue")).reverse();
    const sentenceCount=lessons.reduce((total,lesson)=>total+dialogueItemsForLesson(lesson).length,0);
    app.innerHTML=`
      <section class="hero"><div class="eyebrow">DIALOGUE REVIEW</div><h1>对话复习册</h1><p>完成场景对话关卡后，当天练过的句子会自动收进这里。</p><div class="hero-meta"><span class="pill">${lessons.length} 个学习日</span><span class="pill">${sentenceCount} 条对话</span><span class="pill">可反复播放</span></div></section>
      <div class="section-head"><div><h2>已完成的对话</h2><p>按学习日期倒序排列</p></div></div>
      <section class="review-days">${lessons.length?lessons.map((lesson,index)=>`
        <details class="review-day" ${index===0?"open":""}>
          <summary><span><strong>${displayDate(lesson.date)}</strong><small>${escapeHtml(lesson.phaseName)} · ${escapeHtml(lesson.place)}</small></span><span>${QUESTION_COUNTS.dialogue}句⌄</span></summary>
          <div class="dialogue-review-list">${dialogueItemsForLesson(lesson).map(item=>`
            <article class="dialogue-review-card">
              <div class="dialogue-review-head"><span>${escapeHtml(item.theme)}</span><button data-review-audio="${item.id}" aria-label="播放${escapeHtml(item.jp)}">▶ 播放</button></div>
              <div class="jp-ruby dialogue-review-ruby">${item.ruby||escapeHtml(item.jp)}</div>
              <p>${escapeHtml(item.cn)}</p>
            </article>`).join("")}</div>
        </details>`).join(""):`<div class="empty">完成一次“场景对话”关卡后，这里就会出现你的第一组复习内容。</div>`}</section>`;
    $$("[data-review-audio]",app).forEach(button=>button.addEventListener("click",()=>{
      const item=C.dialogues.find(dialogue=>dialogue.id===button.dataset.reviewAudio);
      if(item)speak(item.jp,.88);
    }));
  }

  function renderTravel(fromAuto=false) {
    let category="交通故障";
    const categories=["收藏",...new Set(C.phrases.map(p=>p.category))];
    app.innerHTML=`
      <section class="hero"><div class="eyebrow">${fromAuto?"TRIP MODE IS ON":"OFFLINE TRIP MODE"}</div><h1>现在就能用的日语</h1><p>点开短句后放大给对方看，也可以直接播放日语。关键内容已缓存；实时运行状态仍需联网查看官方信息。</p><div class="hero-meta"><span class="pill">离线短句</span><span class="pill">大字展示</span><span class="pill">语音播放</span></div></section>
      <div class="section-head"><div><h2>急用短句</h2><p>先选场景，再点开一句</p></div></div>
      <div class="phrase-cats">${categories.map(c=>`<button data-category="${c}" class="${c===category?"active":""}">${c}</button>`).join("")}</div>
      <section class="phrase-list" id="phraseList"></section>
      <div class="section-head"><div><h2>实时运行信息</h2><p>会离开本站，需要网络</p></div></div>
      <section class="official-links">
        <a href="https://www3.jrhokkaido.co.jp/webunkou/index_en.html" target="_blank" rel="noopener">JR北海道运行信息 <span>↗</span></a>
        <a href="https://www.jrhokkaido.co.jp/global/english/train/" target="_blank" rel="noopener">JR北海道路线与列车 <span>↗</span></a>
        <a href="https://www.tokyometro.jp/lang_en/" target="_blank" rel="noopener">东京Metro <span>↗</span></a>
      </section>`;
    renderPhraseList(category);
    $$("[data-category]",app).forEach(b=>b.addEventListener("click",()=>{$$("[data-category]",app).forEach(x=>x.classList.toggle("active",x===b));renderPhraseList(b.dataset.category);}));
  }
  function renderPhraseList(category) {
    const list=category==="收藏"?C.phrases.filter(p=>progress.favorites.includes(p.id)):C.phrases.filter(p=>p.category===category);
    $("#phraseList").innerHTML=list.length?list.map(p=>`<article class="phrase-card"><button data-phrase="${p.id}"><span><strong>${p.jp}</strong><small>${p.cn}</small></span><span>›</span></button><button class="favorite ${progress.favorites.includes(p.id)?"on":""}" data-favorite="${p.id}" aria-label="收藏">★</button></article>`).join(""):`<div class="empty">还没有收藏短句</div>`;
    $$("[data-phrase]",app).forEach(b=>b.addEventListener("click",()=>showPhrase(b.dataset.phrase)));
    $$("[data-favorite]",app).forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.favorite;if(progress.favorites.includes(id))progress.favorites=progress.favorites.filter(x=>x!==id);else progress.favorites.push(id);saveProgress();b.classList.toggle("on");toast(b.classList.contains("on")?"已收藏，可离线查看":"已取消收藏");}));
  }
  function showPhrase(id) {
    const p=C.phrases.find(x=>x.id===id); if(!p)return;
    $("#phraseDisplay").innerHTML=`<div class="phrase-display-jp">${p.jp}</div><div class="phrase-display-kana">${p.kana}</div><div class="phrase-display-cn">${p.cn}</div><button class="primary full" id="playPhrase">▶ 播放给对方听</button>`;
    $("#playPhrase").addEventListener("click",()=>speak(p.jp,.82)); phraseDialog.showModal();
  }

  function renderMakeup() {
    const today=todayIso(); const available=C.lessons.filter(l=>l.date<=today&&!progress.completedLessons.includes(l.id)).reverse();
    app.innerHTML=`<section class="hero"><div class="eyebrow">MAKE-UP STATIONS</div><h1>补关车站</h1><p>漏掉的关卡不会消失。任选一天继续，完成后照样获得印章。</p></section><div class="section-head"><div><h2>等待补关</h2><p>${available.length} 个车站</p></div></div><section class="calendar-list">${available.length?available.map(l=>`<div class="calendar-item"><span class="mission-icon">${l.index}</span><span><strong>${displayDate(l.date)}</strong><small>${l.phaseName}</small></span><button data-makeup="${l.id}">补关</button></div>`).join(""):`<div class="empty">没有漏掉的车站，很稳！</div>`}</section>`;
    $$("[data-makeup]",app).forEach(b=>b.addEventListener("click",()=>{selectedLessonId=b.dataset.makeup;nav("today");}));
  }

  function renderBonus() {
    const lesson=activeLesson(); const dialog=lesson.modules.find(m=>m.id==="dialogue").item; const ann=lesson.modules.find(m=>m.id==="listening").item;
    app.innerHTML=`<section class="hero"><div class="eyebrow">BONUS 30—60 MIN</div><h1>今天想再走远一点</h1><p>加练不影响今日完成状态。选一项15分钟，或四项全部完成。</p></section>
      <div class="section-head"><div><h2>可选加练</h2><p>每项约15分钟</p></div></div>
      <section class="mission-list">
        <button class="mission-card" data-bonus="shadow"><span class="mission-icon">影</span><span class="mission-copy"><strong>影子跟读</strong><small>${dialog.jp}</small></span><span class="mission-status">开始 ›</span></button>
        <button class="mission-card" data-bonus="fast"><span class="mission-icon">速</span><span class="mission-copy"><strong>1.15倍广播</strong><small>${ann.title}</small></span><span class="mission-status">播放 ›</span></button>
        <button class="mission-card" data-bonus="blind"><span class="mission-icon">無</span><span class="mission-copy"><strong>无中文字幕</strong><small>只听日语，复述场景含义</small></span><span class="mission-status">开始 ›</span></button>
        <button class="mission-card" data-bonus="mixed"><span class="mission-icon">混</span><span class="mission-copy"><strong>混合场景挑战</strong><small>随机抽取旅行急用表达</small></span><span class="mission-status">抽取 ›</span></button>
      </section>`;
    $$("[data-bonus]",app).forEach(b=>b.addEventListener("click",()=>{
      if(b.dataset.bonus==="fast"){playAnnouncement(ann,1.15);toast("正在播放1.15倍广播");}
      else if(b.dataset.bonus==="shadow"){speak(dialog.jp,.86);toast("听一句，跟一句，连续五遍");}
      else { const p=C.phrases[Math.floor(Math.random()*C.phrases.length)]; showPhrase(p.id); }
    }));
  }

  function renderSettings() {
    app.innerHTML=`<section class="hero"><div class="eyebrow">SETTINGS & DATA</div><h1>设置与数据</h1><p>所有学习记录只在这台设备上。本站没有账号，也不会云同步。</p></section>
      <div class="section-head"><div><h2>使用设置</h2></div></div>
      <section class="panel">
        <div class="setting-row"><span><strong>添加到iPhone主屏幕</strong><br><small>Safari分享 → 添加到主屏幕</small></span><button class="ghost" id="installHelp">查看</button></div>
        <div class="setting-row"><span><strong>默认广播速度</strong><br><small>${progress.preferredSpeed||1}×</small></span><button class="ghost" id="speedSetting">切换</button></div>
        <div class="setting-row"><span><strong>本机进度</strong><br><small>${progress.completedLessons.length}天 · ${progress.xp} XP</small></span><button class="ghost danger" id="resetData">清除</button></div>
      </section>`;
    $("#installHelp").addEventListener("click",()=>alert("在 iPhone 的 Safari 中打开本站，点击底部“分享”按钮，再选择“添加到主屏幕”。之后就能像 App 一样打开。"));
    $("#speedSetting").addEventListener("click",()=>{const speeds=[.75,1,1.15];progress.preferredSpeed=speeds[(speeds.indexOf(progress.preferredSpeed||1)+1)%speeds.length];saveProgress();renderSettings();});
    $("#resetData").addEventListener("click",()=>{if(confirm("确定清除全部学习记录吗？此操作无法恢复。")){localStorage.removeItem(STORAGE_KEY);progress=structuredClone(defaultProgress);location.reload();}});
  }

  function init() {
    $("#menuButton").addEventListener("click",openDrawer); $("#closeMenu").addEventListener("click",closeDrawer); $("#scrim").addEventListener("click",closeDrawer); $("#homeButton").addEventListener("click",()=>{selectedLessonId=null;nav("today");});
    $$(".bottom-nav [data-view]").forEach(b=>b.addEventListener("click",()=>{selectedLessonId=null;nav(b.dataset.view);}));
    $$("[data-drawer-view]").forEach(b=>b.addEventListener("click",()=>nav(b.dataset.drawerView)));
    $$('[data-close-dialog]').forEach(b=>b.addEventListener("click",()=>$("#"+b.dataset.closeDialog).close()));
    exerciseDialog.addEventListener("close",stopMedia); phraseDialog.addEventListener("close",()=>speechSynthesis?.cancel());
    if(!progress.welcomed){$("#welcomeDialog").showModal();$("#acceptWelcome").addEventListener("click",()=>{progress.welcomed=true;saveProgress();$("#welcomeDialog").close();});}
    renderToday();
    if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
  init();
})();
