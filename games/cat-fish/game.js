(function(){
  const startBtn = document.getElementById('start');
  const restartBtn = document.getElementById('restart');
  const scoreVal = document.getElementById('score-val');
  const playArea = document.getElementById('play-area');
  const catEl = document.getElementById('cat');
  const bearEl = document.getElementById('bear');
  const fishLayer = document.getElementById('fish-layer');
  const tapArea = document.getElementById('tap-area');
  const judgementEl = document.getElementById('judgement');
  const difficultySelect = document.getElementById('difficulty');
  const bpmInput = document.getElementById('bpm-input');
  const turnBanner = document.getElementById('turn-banner');

  let audioCtx = null;
  let score = 0;
  let totalMeasures = 10;
  let beatsPerMeasure = 4;
  let bpm = 70; // slower tempo (adjustable)
  let secondsPerBeat = () => 60 / bpm;
  let scheduled = [];
  let activeNoteInstances = [];
  // counter to track how many approaching notes are active so hit-zone isn't removed prematurely
  let approachCount = 0;
  let notesByMeasure = {}; // measure index -> array of note objects {time, status}
  let started = false;
  // judgement thresholds (seconds) — tightened as requested
  // Perfect requires very close timing; Good allows a smaller offset
  const JUDGE_PERF = 0.08;  // perfect window: 80ms (stricter)
  const JUDGE_GOOD = 0.16;  // good window: 160ms (stricter)
  let hitWindow = 0.35; // maximum allowed for any hit (350ms)
  // Fish travel: control speed via BPM. TRAVEL_BEATS = how many beats it takes for a fish to travel from cat to bear
  const TRAVEL_BEATS = 1.0; // 1 beat by default -> travel time = secondsPerBeat() * 1000 * TRAVEL_BEATS

  // ---- Bear image state helper ----
  // NOTE: BEAR_EATING_SRC のパスはお使いの画像ファイル名に合わせて変更してください
  const BEAR_IDLE_SRC = 'images/bear.png';
  const BEAR_EATING_SRC = 'images/bear-eating.png';

  function setBearEating(isEating){
    bearEl.classList.toggle('hit', isEating);
    bearEl.classList.toggle('eating', isEating);
    const img = bearEl.querySelector('img');
    if(img) img.src = isEating ? BEAR_EATING_SRC : BEAR_IDLE_SRC;
  }

  // ---- Cat image state helper (魚を投げる瞬間の画像切り替え) ----
  // 待機時の画像はHTMLに元々設定されているsrcをそのまま記憶しておき、それに戻す。
  const CAT_SHOOT_SRC = 'images/cat-shoot.png';

  function setCatShooting(isShooting){
    catEl.classList.toggle('shoot', isShooting);
    const img = catEl.querySelector('img');
    if(!img) return;
    if(isShooting){
      // 初回だけ、切り替え前（待機時）のsrcを記憶しておく
      if(!img.dataset.idleSrc) img.dataset.idleSrc = img.getAttribute('src');
      img.src = CAT_SHOOT_SRC;
    } else {
      img.src = img.dataset.idleSrc || img.src;
    }
  }

  // ---- Perfect/Good 判定範囲の可視化（クマの上に重ねる半透明の円） ----
  // NOTE: 実際の判定は時間ベースで行われる。ここでのpx半径は、
  //       Miss時の距離ベース救済判定（onUserInput内のthreshold=80/56px）に合わせた「目安」の表示。
  let goodZoneEl = null;
  let perfectZoneEl = null;

  function ensureZoneStyles(){
    if(document.getElementById('judge-zone-style')) return;
    const style = document.createElement('style');
    style.id = 'judge-zone-style';
    style.textContent = `
      .judge-zone{position:absolute;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);box-sizing:border-box;z-index:3;}
      .judge-zone.good{background:rgba(220,40,40,0.20);border:1px solid rgba(220,40,40,0.35);}
      .judge-zone.perfect{background:rgba(40,180,90,0.30);border:1px solid rgba(40,180,90,0.5);}
    `;
    document.head.appendChild(style);
  }

  function ensureZoneElements(){
    ensureZoneStyles();
    if(!goodZoneEl){
      goodZoneEl = document.createElement('div');
      goodZoneEl.className = 'judge-zone good';
      playArea.appendChild(goodZoneEl);
    }
    if(!perfectZoneEl){
      perfectZoneEl = document.createElement('div');
      perfectZoneEl.className = 'judge-zone perfect';
      playArea.appendChild(perfectZoneEl);
    }
  }

  function updateZoneOverlay(){
    if(!goodZoneEl || !perfectZoneEl) return;
    const areaRect = playArea.getBoundingClientRect();
    const bearRect = bearEl.getBoundingClientRect();
    const cx = bearRect.left + bearRect.width/2 - areaRect.left;
    const cy = bearRect.top + bearRect.height/2 - areaRect.top;

    // onUserInput内の距離救済判定と同じ半径をGoodの目安として使用（より厳しい判定）
    const goodRadius = (window.innerWidth < 600) ? 28 : 40;
    const perfectRadius = Math.round(goodRadius * 0.5);

    goodZoneEl.style.left = cx + 'px';
    goodZoneEl.style.top = cy + 'px';
    goodZoneEl.style.width = (goodRadius * 2) + 'px';
    goodZoneEl.style.height = (goodRadius * 2) + 'px';

    perfectZoneEl.style.left = cx + 'px';
    perfectZoneEl.style.top = cy + 'px';
    perfectZoneEl.style.width = (perfectRadius * 2) + 'px';
    perfectZoneEl.style.height = (perfectRadius * 2) + 'px';
  }

  function ensureAudio(){
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function playMeow(time){
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(700, time);
    o.frequency.exponentialRampToValueAtTime(350, time + 0.22);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(time); o.stop(time + 0.3);
  }

  function playMunch(time){
    ensureAudio();
    const bufferSize = 0.2 * audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * Math.exp(-i/ (bufferSize/4));
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    src.connect(g); g.connect(audioCtx.destination);
    src.start(time);
  }

  // short success tone for Good
  function playSuccess(time){
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(600, time);
    o.frequency.exponentialRampToValueAtTime(880, time + 0.06);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.14, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(time); o.stop(time + 0.22);
  }

  // brighter accent for Perfect
  function playPerfect(time){
    ensureAudio();
    const o1 = audioCtx.createOscillator();
    const o2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o1.type = 'sine';
    o2.type = 'sawtooth';
    o1.frequency.setValueAtTime(900, time);
    o2.frequency.setValueAtTime(1200, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.18, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    o1.connect(g); o2.connect(g); g.connect(audioCtx.destination);
    o1.start(time); o2.start(time);
    o1.stop(time + 0.18); o2.stop(time + 0.18);
  }

  function schedule(){
    scheduled = [];
    notesByMeasure = {};
    const startTime = audioCtx.currentTime + 0.6; // give a little lead

    for(let m=0;m<totalMeasures;m++){
      const measureStart = startTime + m * beatsPerMeasure * secondsPerBeat();
      if(m % 2 === 0){
        // cat measure: schedule fish/meow notes according to generated pattern
        const pattern = generatePatternForMeasure(m);
        notesByMeasure[m] = [];
        // pattern is array of offsets in beats (may be fractional for eighths/triplets)
        pattern.forEach(offsetBeat => {
          const t = measureStart + offsetBeat * secondsPerBeat();
          const measureEnd = measureStart + beatsPerMeasure * secondsPerBeat();
          const munchTime = t + beatsPerMeasure * secondsPerBeat();
          const noteObj = {time: t, measure: m, measureEnd: measureEnd, munchTime: munchTime, kind: 'cat', hit: false, status: 'pending'};
          scheduled.push(noteObj);
          notesByMeasure[m].push(noteObj);
          activeNoteInstances.push(noteObj);
          // schedule visual hit zone for this note around its munchTime (show for hitWindow*2)
          const hz = document.getElementById('hit-zone');
          if(hz){
           const showMs = Math.max(0, (munchTime - audioCtx.currentTime) * 1000 - (hitWindow*1000));
           setTimeout(()=>{ hz.classList.add('active'); }, showMs);
           setTimeout(()=>{ hz.classList.remove('active'); }, showMs + hitWindow*2000 + 60);
          }
        });

            // schedule banner to show which turn this measure is
            try{
              const bannerTime = measureStart;
              const msBanner = Math.max(0, (bannerTime - audioCtx.currentTime) * 1000);
              setTimeout(()=>showTurnBanner(m), msBanner);
            }catch(e){}

            // schedule bear measure to play munches for the notes in this measure (after this measure ends)
            if(m + 1 < totalMeasures){
              const nextMeasureStart = measureStart + beatsPerMeasure * secondsPerBeat();
              // start bear munches shortly after measure end
              const bearStart = measureStart + beatsPerMeasure * secondsPerBeat() + 0.08; // 80ms after measure end
              const msBear = Math.max(0, (bearStart - audioCtx.currentTime) * 1000);
              setTimeout(()=>playBearMeasure(m), msBear);
            }

      } else {
        // odd measures are bear measures; their beats are scheduled by playBearMeasure from previous cat measure
      }
    }

    // sort just in case
    scheduled.sort((a,b)=>a.time-b.time);

    // schedule callbacks
    scheduled.forEach(item => {
      const ms = Math.max(0, (item.time - audioCtx.currentTime) * 1000 - 10);
      setTimeout(()=>triggerNote(item), ms);
    });

    // schedule end
    const endTime = startTime + totalMeasures * beatsPerMeasure * secondsPerBeat();
    setTimeout(()=>endGame(), Math.max(0, (endTime - audioCtx.currentTime)*1000 + 200));
  }

  function generatePatternForMeasure(m){
    // Simple progression: first 4 measures mostly quarter notes (with occasional rest)
    // later measures introduce eighths and triplets
    let patterns = [];
    if(m < 4){
      // quarters, maybe rests
      for(let b=0;b<4;b++){
        if(Math.random() < 0.75) patterns.push(b); // 75% note
      }
      // ensure at least two notes (no all-rest measures, and require >=2 clicks)
      while(patterns.length < 2){
        const pick = Math.floor(Math.random()*4);
        if(!patterns.includes(pick)) patterns.push(pick);
      }
    } else {
      // split beats into subdivisions
      for(let b=0;b<4;b++){
        const r = Math.random();
        if(r < 0.5){
          // quarter
          patterns.push(b);
        } else if(r < 0.8){
          // two eighths
          patterns.push(b + 0);
          patterns.push(b + 0.5);
        } else {
          // triplet
          patterns.push(b + 0);
          patterns.push(b + 1/3);
          patterns.push(b + 2/3);
        }
      }
      // ensure at least two notes as well
      if(patterns.length < 2){
        patterns.push(0);
        patterns.push(1);
      }
    }

    // make offsets unique and sorted
    patterns = Array.from(new Set(patterns)).sort((a,b)=>a-b);
    return patterns;
  }

  function triggerNote(item){
    const t = item.time;
    if(item.kind === 'cat'){
      // cat note: meow and throw fish
      playMeow(t);
      // 投げる瞬間、猫の画像を投げポーズに切り替えて少ししたら元に戻す
      setCatShooting(true);
      setTimeout(()=>setCatShooting(false), 250);
      // schedule fish animation to align with the scheduled audio time
      createFishAnimation(t, item);
      // prune old instances after this note window passes
      // keep future notes, only remove notes that are long in the past
      setTimeout(()=>{
        const now = audioCtx ? audioCtx.currentTime : Date.now()/1000;
        // remove notes whose munchTime/time are more than 1.5s in the past
        activeNoteInstances = activeNoteInstances.filter(n => ((n.munchTime||n.time) > (now - 1.5)));
      }, 4000);
    }

    // update measure UI (measure count removed per user request)
    // could update turn-banner instead if needed
  }

  // play the bear's munches for a completed cat measure
  // NOTE: この関数はスコア判定と「食べた時の演出/効果音」だけを担当します。
  // 魚自体の動き（右へ通過し続ける／捕獲されて消える）はここでは一切触りません。
  // - Miss の場合: 魚は createFishAnimation で開始した動きのまま、そのまま右へ通過し続けます（何もしない）。
  // - Hit(Good/Perfect) の場合: タップ時点で animateFishToBear() により既に魚は消えているはずなので、
  //   ここでは念のためのフォールバック処理のみ行います。
  function playBearMeasure(catMeasureIndex){
    const notes = notesByMeasure[catMeasureIndex] || [];
    if(notes.length === 0) return;
    // Good判定の許容幅(JUDGE_GOOD)より後に最終判定するための余裕
    const DECISION_BUFFER_MS = Math.round(JUDGE_GOOD * 1000) + 60; // ≒220ms
    notes.forEach(n => {
      const munchTime = n.munchTime || (n.time + beatsPerMeasure * secondsPerBeat()); // use precomputed munchTime
      const ms = Math.max(0, (munchTime - (audioCtx ? audioCtx.currentTime : 0)) * 1000 + DECISION_BUFFER_MS);
      setTimeout(()=>{
        try{
          const eaten = (n.status === 'Perfect' || n.status === 'Good') || n.hit;
          if(eaten){
            // 捕獲成功: 効果音とクマの演出
            playMunch(munchTime);
            setBearEating(true);
            setTimeout(()=>setBearEating(false), 360);
            // フォールバック: 何らかの理由でまだ魚が残っていれば消す
            const f = n.fishEl;
            if(f && f.parentElement){
              f.style.transition = 'transform 160ms ease, opacity 180ms ease';
              f.style.transform = 'scale(0.3)';
              f.style.opacity = '0';
              setTimeout(()=>{ if(f && f.parentElement) f.remove(); }, 220);
            }
            try{ n.eaten = true; }catch(e){}
          }
          // Miss の場合はここでは何もしない。魚は自然に右へ通過し続ける。
        }catch(e){ /* ignore */ }
      }, ms);
    });

    // schedule deletion of these notes after the last munch finishes so memory is freed
    try{
      const lastMunch = notes.reduce((acc,n)=>Math.max(acc, n.munchTime||0), 0);
      const delayMs = Math.max(300, Math.round((lastMunch - (audioCtx?audioCtx.currentTime:Date.now()/1000)) * 1000) + DECISION_BUFFER_MS + 300);
      // after visual munches, evaluate the measure (so score updates after bear finishes)
      setTimeout(()=>{ try{ evaluateMeasure(catMeasureIndex); }catch(e){} }, delayMs + 40);
      // then delete notes to free memory
      setTimeout(()=>{ try{ delete notesByMeasure[catMeasureIndex]; }catch(e){} }, delayMs + 200);
    }catch(e){};

    // show banner for bear measure as well (mirror the next measure index if desired)
    try{
      const bannerMs = Math.max(0, ((notes[0] && notes[0].munchTime) ? notes[0].munchTime - audioCtx.currentTime : 0) * 1000);
      setTimeout(()=>{
        // show Bear turn slightly before munches so user sees it
        showTurnBanner(catMeasureIndex + 1);
      }, bannerMs);
    }catch(e){}
  }

  function createFishAnimation(scheduledTime, item){
    // compute positions now, but start animation exactly at scheduledTime using audioCtx for sync
    const catRect = catEl.getBoundingClientRect();
    const bearRect = bearEl.getBoundingClientRect();
    const areaRect = playArea.getBoundingClientRect();
    const fish = document.createElement('div');
    fish.className = 'fish';
    fish.innerHTML = '<img src="images/fish.png" alt="fish">';
    fishLayer.appendChild(fish);
    // starting position (relative to playArea)
    const startX = catRect.left + catRect.width/2 - areaRect.left - 32; // center - half fish width
    const startY = catRect.top + catRect.height/2 - areaRect.top - 16;
    const endX = bearRect.left + bearRect.width/2 - areaRect.left - 32;
    const endY = bearRect.top + bearRect.height/2 - areaRect.top - 16;

    // 位置は left/top で管理し、transform は捕獲時の縮小演出専用に空けておく
    fish.style.left = startX + 'px';
    fish.style.top = startY + 'px';
    fish.style.opacity = '1';
    fish.style.transform = 'scale(1)';

    // store reference so bear/tap handler can find this specific fish later
    if(item) item.fishEl = fish;

    // compute when to start (ms relative to now) using audioCtx time to stay in sync
    const now = audioCtx ? audioCtx.currentTime : null;
    const startDelayMs = now ? Math.max(0, (scheduledTime - now) * 1000) : 0;

    // compute when the bear will eat this fish: same offset in the next measure
    const munchTime = (item && item.time) ? (item.time + beatsPerMeasure * secondsPerBeat()) : (scheduledTime + beatsPerMeasure * secondsPerBeat());

    // travelMs = time from scheduledTime to munchTime so fish arrives (passes) the bear position exactly then
    const travelMs = Math.max(120, Math.round((munchTime - scheduledTime) * 1000));

    // 捕まえられなかった場合、魚は止まらず同じ速度のまま画面外まで右へ通過し続ける。
    // クマの位置に到達する時刻(munchTime)はこれまで通り保ったまま、その先も一直線に進める。
    const overshoot = Math.max(160, areaRect.width * 0.25); // 画面外へ十分出るための余白
    const finalX = areaRect.width + overshoot; // 通過後の最終到達地点（画面右端の外）
    const rateX = (endX - startX) / travelMs; // クマに届くまでと同じ速度(px/ms)を維持
    const totalDurationMsX = rateX > 0
      ? Math.max(travelMs, Math.round((finalX - startX) / rateX))
      : travelMs + 900;

    // X（左右）は画面外まで届く長い遷移、Y（上下）はクマの高さに着いたらそこで止まる短い遷移
    fish.style.transition = `left ${totalDurationMsX}ms linear, top ${travelMs}ms linear, opacity 250ms ease`;

    setTimeout(()=>{
      requestAnimationFrame(()=>{
        fish.style.left = finalX + 'px';
        fish.style.top = endY + 'px';
      });
    }, startDelayMs);

    // highlight the fish as it approaches the bear so players can clearly see when to tap
    try{
      const approachStart = Math.max(0, (munchTime - hitWindow) - (audioCtx ? audioCtx.currentTime : 0));
      const approachEnd = Math.max(0.05, (munchTime + 0.06) - (audioCtx ? audioCtx.currentTime : 0));
      const approachStartMs = Math.round(approachStart * 1000);

      // schedule adding 'approach' class
      setTimeout(()=>{
        fish.classList.add('approach');
        // increment global approach counter and activate hit-zone
        approachCount++;
        const hz = document.getElementById('hit-zone');
        if(hz) hz.classList.add('active');
      }, approachStartMs);

      // schedule removal of approach class shortly after munchTime
      setTimeout(()=>{
        fish.classList.remove('approach');
        approachCount = Math.max(0, approachCount - 1);
        const hz = document.getElementById('hit-zone');
        if(hz && approachCount === 0) hz.classList.remove('active');
      }, approachStartMs + travelMs + 100); // ensure removal after arrival
    }catch(e){ /* ignore scheduling issues */ }

    // NOTE: ここでは「捕まえ損ねたら魚を消す/戻す」処理は行わない。
    // 魚は上のtransitionで最初から画面外まで一直線に進むようスケジュール済みなので、
    // Missの場合は何もしなくても自然に通過していく。
    // Good/Perfect で捕獲された場合のみ animateFishToBear() が割り込んで消す。

    // safety: 万一取り残された場合の保険（画面外まで進み切った後に確実に除去）
    setTimeout(()=>{ if(fish && fish.parentElement) fish.remove(); }, startDelayMs + totalDurationMsX + 500);

    // Helper: when a player hits a note (Good/Perfect), stop the fish exactly where it currently is
    // on screen, then shrink+fade it out so it looks like the bear caught and ate it there.
    function animateFishToBear(note, quickMs){
      try{
        const f = note && note.fishEl;
        if(!f) return;
        // mark as eaten so playBearMeasure's fallback doesn't double-handle it
        try{ note.eaten = true; note._visualTaken = true; }catch(e){}

        // 現在の見た目上の位置を確定させてから消すアニメーションに切り替える（急なジャンプを防ぐ）
        try{
          const areaRectNow = playArea.getBoundingClientRect();
          const fRectNow = f.getBoundingClientRect();
          const curLeft = fRectNow.left - areaRectNow.left;
          const curTop = fRectNow.top - areaRectNow.top;
          f.style.transition = 'none';
          f.style.left = curLeft + 'px';
          f.style.top = curTop + 'px';
          // 強制リフローで位置確定を反映させる
          void f.offsetWidth;
        }catch(e){}

        const dur = Math.max(60, quickMs);
        try{
          f.style.transition = `transform ${dur}ms ease, opacity ${Math.max(60, Math.round(dur*0.9))}ms ease`;
          f.style.transform = 'scale(0.36)';
          f.style.opacity = '0';
        }catch(e){}
        setTimeout(()=>{ try{ if(f && f.parentElement) f.remove(); }catch(e){} }, dur + 40);

        // immediate small bear feedback so player sees the bear eat right away
        try{
          setBearEating(true);
          const bi = bearEl.querySelector && bearEl.querySelector('img');
          if(bi){ bi.style.transition = 'transform 160ms ease'; bi.style.transform = 'translateY(-6px) scale(1.04)'; setTimeout(()=>{ try{ bi.style.transform = ''; }catch(e){} }, 260); }
          setTimeout(()=>{ try{ setBearEating(false); }catch(e){} }, 360);
        }catch(e){}
      }catch(e){ /* ignore */ }
    }

    // 呼び出し元(onUserInput)から使えるよう note に紐付けておく
    if(item) item._animateFishToBear = animateFishToBear;
  }

  function findNearestActiveNote(time){
    let best = null;
    let bestDt = hitWindow;
    activeNoteInstances.forEach(n => {
      if(n.hit) return;
      const dt = Math.abs((n.munchTime || n.time) - time);
      if(dt <= bestDt){ bestDt = dt; best = n; }
    });
    return best;
  }

  function showJudgement(kind){
    if(!judgementEl) return;
    judgementEl.textContent = kind;
    judgementEl.className = 'judgement show ' + kind.toLowerCase();
    // flash hit-zone for positive judgements to give clearer feedback
    try{
      const hz = document.getElementById('hit-zone');
      if(hz && (kind === 'Perfect' || kind === 'Good')){
        hz.classList.add('flash');
        setTimeout(()=>{ if(hz) hz.classList.remove('flash'); }, 260);
      }
    }catch(e){}
    clearTimeout(judgementEl._timer);
    judgementEl._timer = setTimeout(()=>{
      if(judgementEl){ judgementEl.className = 'judgement'; }
    }, 600);
  }

  // show a banner indicating whose turn it is; measureIndex is 0-based
  function showTurnBanner(measureIndex){
    if(!turnBanner) return;
    const isCat = (measureIndex % 2 === 0);
    turnBanner.textContent = isCat ? 'Cat のターン' : 'Bear のターン';
    turnBanner.classList.remove('hidden','cat','bear');
    turnBanner.classList.add(isCat ? 'cat' : 'bear');
    // make visible
    turnBanner.classList.remove('hidden');
    clearTimeout(turnBanner._timer);
    // hide after measure duration (slightly less to avoid overlap)
    const durMs = Math.max(300, Math.round(beatsPerMeasure * secondsPerBeat() * 1000) - 80);
    turnBanner._timer = setTimeout(()=>{ if(turnBanner) turnBanner.classList.add('hidden'); }, durMs);
  }

  function showMeasureResult(points){
    if(!judgementEl) return;
    judgementEl.textContent = (points>0?('+'+points+' pt'):'0 pt');
    judgementEl.className = 'judgement show measure';
    clearTimeout(judgementEl._timer);
    judgementEl._timer = setTimeout(()=>{ if(judgementEl) judgementEl.className = 'judgement'; }, 700);
  }

  function evaluateMeasure(m){
    const notes = notesByMeasure[m] || [];
    if(notes.length === 0){ return; } // safety
    // convert pending -> Miss
    notes.forEach(n => { if(!n.status || n.status === 'pending') n.status = 'Miss'; });
    // determine award: all Perfect => 2, all not Miss =>1, else 0
    const allPerfect = notes.length>0 && notes.every(n => n.status === 'Perfect');
    const noneMiss = notes.length>0 && notes.every(n => n.status !== 'Miss');
    let award = 0;
    if(allPerfect) award = 2;
    else if(noneMiss) award = 1;
    // update score and show result
    score += award;
    scoreVal.textContent = score;
    showMeasureResult(award);

    // NOTE: do not delete notesByMeasure here — keep notes available for the bear playback
    // (deletion will happen after bear munch visual in playBearMeasure)
  }

  function onUserInput(evt){
    // start audio context on first user interaction
    ensureAudio();
    const t = audioCtx.currentTime;
    const note = findNearestActiveNote(t);
    if(note){
      // mark that the player attempted this note; only mark .hit when judgement is Good/Perfect
      note.attempted = true;
      note.hitTime = t;
      // judgement calculation: compare against munchTime (when fish reaches bear)
      const targetTime = (note.munchTime || note.time);
      const dt = Math.abs(targetTime - t);

      if(dt <= JUDGE_PERF){
        note.status = 'Perfect';
        note.hit = true;
        showJudgement('Perfect');
        playPerfect(t);
        // 魚をその場で止めて消す（捕獲演出）
        try{
          if(note._animateFishToBear) note._animateFishToBear(note, 180);
        }catch(e){}
        // ensure flagged as eaten for later logic
        try{ note.eaten = true; }catch(e){}
      } else if(dt <= JUDGE_GOOD){
        note.status = 'Good';
        note.hit = true;
        showJudgement('Good');
        playSuccess(t);
        // 魚をその場で止めて消す（捕獲演出）
        try{
          if(note._animateFishToBear) note._animateFishToBear(note, 180);
        }catch(e){}
        // ensure flagged as eaten for later logic
        try{ note.eaten = true; }catch(e){}
      } else {
        // if the fish has visual 'approach' class, allow a forgiving Good even if slightly outside time
        let accepted = false;
        try{ if(note.fishEl && note.fishEl.classList.contains('approach')) accepted = true; }catch(e){}
        // additional visual proximity check: if fish is very close on screen, accept as Good
        try{
          if(!accepted && note.fishEl && bearEl){
            const fR = note.fishEl.getBoundingClientRect();
            const bR = bearEl.getBoundingClientRect();
            const fx = fR.left + fR.width/2; const fy = fR.top + fR.height/2;
            const bx = bR.left + bR.width/2; const by = bR.top + bR.height/2;
            const dist = Math.hypot(fx-bx, fy-by);
            // threshold: 40px on desktop, scaled down on small screens (より厳しい判定)
            const threshold = (window.innerWidth < 600) ? 28 : 40;
            if(dist <= threshold) accepted = true;
          }
        }catch(e){}

        if(accepted){
          note.status = 'Good';
          note.hit = true;
          showJudgement('Good');
          playSuccess(t);
          // 魚をその場で止めて消す（捕獲演出）
          try{ if(note._animateFishToBear) note._animateFishToBear(note, 200); }catch(e){}
          try{ note.eaten = true; }catch(e){}
        } else {
          // as a last resort, if there are closely spaced notes, accept half-distance to neighbor as Good
          let acceptedByNeighbor = false;
          try{
            // find second nearest active note (not the same one)
            let secondDt = Infinity;
            activeNoteInstances.forEach(n2 => {
              if(n2 === note || n2.hit) return;
              const d2 = Math.abs((n2.munchTime||n2.time) - t);
              if(d2 < secondDt) secondDt = d2;
            });
            if(secondDt < Infinity){
              // if user's tap is closer than half the gap to neighbor, accept as Good
              const gap = secondDt + Math.abs((note.munchTime||note.time) - t);
              if(Math.abs((note.munchTime||note.time) - t) <= (gap/2 + 0.02)) acceptedByNeighbor = true;
            }
          }catch(e){}
          if(acceptedByNeighbor){
            note.status = 'Good';
            note.hit = true;
            showJudgement('Good');
            playSuccess(t);
            // 魚をその場で止めて消す（捕獲演出）
            try{ if(note._animateFishToBear) note._animateFishToBear(note, 200); }catch(e){}
            try{ note.eaten = true; }catch(e){}
          } else {
            note.status = 'Miss';
            note.hit = false;
            showJudgement('Miss');
            // Miss の場合は魚には触れない。既に開始している「右へ通過し続ける」動きのまま進む。
          }
        }
      }

      // visual feedback on the fish itself (捕獲されず通過中の魚にも軽くフィードバックを出す)
      try{ if(note.fishEl) note.fishEl.classList.add('hit'); }catch(e){}
      setTimeout(()=>{ try{ if(note.fishEl) note.fishEl.classList.remove('hit'); }catch(e){} }, 220);
    } else {
      // small miss feedback: flash cat
      catEl.classList.add('hit');
      setTimeout(()=>catEl.classList.remove('hit'), 160);
      showJudgement('Miss');
    }
  }

  function startGame(){
    if(started) return;
    // lock BPM from UI at start
    if(bpmInput && !isNaN(Number(bpmInput.value))){
      bpm = Math.max(30, Math.min(240, Number(bpmInput.value)));
    } else if(difficultySelect){
      const val = difficultySelect.value;
      if(val === 'easy') bpm = 60;
      else if(val === 'normal') bpm = 70;
      else if(val === 'hard') bpm = 90;
    }
    // freeze secondsPerBeat to the chosen bpm
    const lockedBpm = bpm;
    secondsPerBeat = () => 60 / lockedBpm;

    started = true;
    score = 0; scoreVal.textContent = score;
    ensureAudio();
    setBearEating(false);
    setCatShooting(false);
    ensureZoneElements();
    updateZoneOverlay();

    // disable controls while playing
    if(difficultySelect) difficultySelect.disabled = true;
    if(bpmInput) bpmInput.disabled = true;
    startBtn.disabled = true;

    schedule();
    // attach input to tap area if present, otherwise global
    if(tapArea){
      tapArea.addEventListener('click', onUserInput);
      tapArea.addEventListener('touchstart', onUserInput);
    } else {
      window.addEventListener('click', onUserInput);
      window.addEventListener('touchstart', onUserInput);
    }
  }

  function endGame(){
    started = false;
    if(tapArea){
      tapArea.removeEventListener('click', onUserInput);
      tapArea.removeEventListener('touchstart', onUserInput);
    }
    window.removeEventListener('click', onUserInput);
    window.removeEventListener('touchstart', onUserInput);
    // re-enable controls
    if(difficultySelect) difficultySelect.disabled = false;
    if(bpmInput) bpmInput.disabled = false;
    startBtn.disabled = false;
    setBearEating(false);
    setCatShooting(false);
    // hide turn banner
    try{ if(turnBanner){ turnBanner.classList.add('hidden'); clearTimeout(turnBanner._timer); } }catch(e){}
    alert('終了！ スコア: ' + score + ' 点');
  }

  startBtn.addEventListener('click', ()=>{
    ensureAudio();
    // resume context on some browsers
    if(audioCtx.state === 'suspended') audioCtx.resume();
    startGame();
  });
  restartBtn.addEventListener('click', ()=>{
    // reload simple
    location.reload();
  });

  // difficulty / bpm controls
  if(difficultySelect){
    difficultySelect.addEventListener('change', ()=>{
      if(started) return; // ignore changes while playing
      const val = difficultySelect.value;
      if(val === 'easy') bpm = 60;
      else if(val === 'normal') bpm = 70;
      else if(val === 'hard') bpm = 90;
      if(bpmInput) bpmInput.value = bpm;
      secondsPerBeat = () => 60 / bpm;
    });
  }
  if(bpmInput){
    bpmInput.addEventListener('change', ()=>{
      if(started) return; // ignore changes while playing
      const v = Number(bpmInput.value) || bpm;
      bpm = Math.max(30, Math.min(240, v));
      secondsPerBeat = () => 60 / bpm;
    });
  }

  // small helper: allow tapping anywhere before start to resume audio on mobile
  document.addEventListener('touchstart', function once(){ if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); } document.removeEventListener('touchstart', once); });

  // ---- 判定範囲オーバーレイの初期化 ----
  // ページ読み込み時点でクマの上に円を表示し、リサイズ時にも位置・サイズを追従させる
  ensureZoneElements();
  updateZoneOverlay();
  window.addEventListener('resize', updateZoneOverlay);

})();