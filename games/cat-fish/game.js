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
  // judgement thresholds (seconds) — tightened per user request
  // Perfect requires close timing; Good allows modest offset; overall hit window limited
  const JUDGE_PERF = 0.12;  // perfect window: 120ms
  const JUDGE_GOOD = 0.25;  // good window: 250ms
  let hitWindow = 0.5; // maximum allowed for any hit (tweakable) (500ms)
  // Fish travel: control speed via BPM. TRAVEL_BEATS = how many beats it takes for a fish to travel from cat to bear
  const TRAVEL_BEATS = 1.0; // 1 beat by default -> travel time = secondsPerBeat() * 1000 * TRAVEL_BEATS

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
  function playBearMeasure(catMeasureIndex){
    const notes = notesByMeasure[catMeasureIndex] || [];
    if(notes.length === 0) return;
    notes.forEach(n => {
      const munchTime = n.munchTime || (n.time + beatsPerMeasure * secondsPerBeat()); // use precomputed munchTime
      // schedule visual bear munch and fish removal (and audio only if eaten)
      const ms = Math.max(0, (munchTime - (audioCtx ? audioCtx.currentTime : 0)) * 1000 - 10);
      setTimeout(()=>{
        try{
          const f = n.fishEl;
          // Treat a note as eaten if it was judged Good or Perfect, or if n.hit is true (backwards-compat)
          if((n.status === 'Perfect' || n.status === 'Good') || n.hit){
            // Player hit this note: play munch and show bear eating regardless of fish DOM presence
            playMunch(munchTime);
            bearEl.classList.add('hit');
            bearEl.classList.add('eating');
            setTimeout(()=>bearEl.classList.remove('hit'), 160);
            setTimeout(()=>bearEl.classList.remove('eating'), 360);
            // animate bite and remove fish if present
            if(f && f.parentElement){
              f.style.transition = 'transform 160ms ease, opacity 180ms ease';
              f.style.transform += ' scale(0.3)';
              f.style.opacity = '0';
              setTimeout(()=>{ if(f && f.parentElement) f.remove(); }, 220);
            }
            // mark as eaten so continuation doesn't run
            try{ n.eaten = true; }catch(e){}
          } else {
            // Missed note: do nothing for bear animation; fish should continue past the bear
            // ensure fish will continue: if fish still exists, trigger continuation now
            if(f && f.parentElement){
              try{
                const areaRectLocal = playArea.getBoundingClientRect();
                const extraX = Math.max(160, areaRectLocal.width * 0.18);
                f.style.transition = 'transform 700ms linear, opacity 300ms ease';
                f.style.transform = `translate(${(bearEl.getBoundingClientRect().left - areaRectLocal.left) + extraX}px, ${f.style.top || 0})`;
                setTimeout(()=>{ if(f && f.parentElement) f.remove(); }, 900);
              }catch(e){ }
            }
          }
        }catch(e){ /* ignore */ }
      }, ms);
    });

    // schedule deletion of these notes after the last munch finishes so memory is freed
    try{
      const lastMunch = notes.reduce((acc,n)=>Math.max(acc, n.munchTime||0), 0);
      const delayMs = Math.max(300, Math.round((lastMunch - (audioCtx?audioCtx.currentTime:Date.now()/1000)) * 1000) + 300);
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
    fish.innerHTML = '<img src="images/fish.svg" alt="fish">';
    fishLayer.appendChild(fish);
    // starting position (relative to playArea)
    const startX = catRect.left + catRect.width/2 - areaRect.left - 32; // center - half fish width
    const startY = catRect.top + catRect.height/2 - areaRect.top - 16;
    const endX = bearRect.left + bearRect.width/2 - areaRect.left - 32;
    const endY = bearRect.top + bearRect.height/2 - areaRect.top - 16;
    fish.style.left = startX + 'px';
    fish.style.top = startY + 'px';
    fish.style.opacity = '1';
    // ensure no transform applied yet (start from origin)
    fish.style.transform = 'translate(0,0)';

    // store reference so bear can eat this specific fish later
    if(item) item.fishEl = fish;

    // compute when to start (ms relative to now) using audioCtx time to stay in sync
    const now = audioCtx ? audioCtx.currentTime : null;
    const startDelayMs = now ? Math.max(0, (scheduledTime - now) * 1000) : 0;

    // compute when the bear will eat this fish: same offset in the next measure
    const munchTime = (item && item.time) ? (item.time + beatsPerMeasure * secondsPerBeat()) : (scheduledTime + beatsPerMeasure * secondsPerBeat());

    // travelMs = time from scheduledTime to munchTime so fish arrives when bear eats
    const travelMs = Math.max(120, Math.round((munchTime - scheduledTime) * 1000));

    // set inline transition to match travelMs
    fish.style.transition = `transform ${travelMs}ms linear, opacity 250ms ease`;

    // schedule the transform to start exactly at the scheduledTime
    const startAnim = () => requestAnimationFrame(()=>{
      fish.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
    });

    setTimeout(()=>{ startAnim(); }, startDelayMs);

    // highlight the fish as it approaches the bear so players can clearly see when to tap
    try{
      const approachStart = Math.max(0, (munchTime - hitWindow) - (audioCtx ? audioCtx.currentTime : 0));
      const approachEnd = Math.max(0.05, (munchTime + 0.06) - (audioCtx ? audioCtx.currentTime : 0));
      const approachStartMs = Math.round(approachStart * 1000);
      const approachDurationMs = Math.round((approachEnd + 0) * 1000) + 20; // small cushion

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

    // Do NOT remove fish here - it should be removed by playBearMeasure when the bear eats the fish (visual bite animation).
    // However, if a fish was missed (not eaten) it should continue past the bear instead of stopping.
    // schedule a continuation after arrival (munchTime) to move the fish past the bear if still present
    const contDelayMs = startDelayMs + travelMs + 30; // shortly after arrival
    setTimeout(()=>{
      try{
        // only continue past the bear if the note was NOT eaten (i.e., not eaten by bear)
        if(item && item.eaten) return;
        if(fish && fish.parentElement){
          // move further to the right (past bear)
          const extraX = Math.max(160, areaRect.width * 0.18); // ensure noticeable pass-by
          fish.style.transition = 'transform 700ms linear, opacity 300ms ease';
          fish.style.transform = `translate(${endX - startX + extraX}px, ${endY - startY}px)`;
          // remove after it moves past
          setTimeout(()=>{ if(fish && fish.parentElement) fish.remove(); }, 900);
        }
      }catch(e){ }
    }, contDelayMs);

    // safety: long timeout fallback in case something else prevents removal
    setTimeout(()=>{ if(fish && fish.parentElement) fish.remove(); }, (startDelayMs + travelMs + 4000));

    // Helper: when a player hits a note, animate the fish quickly to the bear so it looks
    // like the fish is being eaten at the bear's mouth, then remove it. This preserves
    // the scheduled bear "eating" animation (playBearMeasure) which still runs at
    // the measure's munchTime for the measure-level feedback and scoring.
    function animateFishToBear(note, quickMs){
      try{
        const f = note && note.fishEl;
        if(!f || !f.parentElement) return;
        const areaRect2 = playArea.getBoundingClientRect();
        const catRect2 = catEl.getBoundingClientRect();
        const bearRect2 = bearEl.getBoundingClientRect();
        const startX2 = catRect2.left + catRect2.width/2 - areaRect2.left - 32;
        const startY2 = catRect2.top + catRect2.height/2 - areaRect2.top - 16;
        const endX2 = bearRect2.left + bearRect2.width/2 - areaRect2.left - 32;
        const endY2 = bearRect2.top + bearRect2.height/2 - areaRect2.top - 16;
        // use a short transition so the fish visibly travels to the bear
        f.style.transition = `transform ${Math.max(80, quickMs)}ms ease, opacity ${Math.max(120, Math.round(quickMs*1.1))}ms ease`;
        // move to bear and slightly shrink for "eaten" feeling
        requestAnimationFrame(()=>{
           f.style.transform = `translate(${endX2 - startX2}px, ${endY2 - startY2}px) scale(0.36)`;
           f.style.opacity = '0';
        });
        // remove after the quick animation completes
        setTimeout(()=>{ try{ if(f && f.parentElement) f.remove(); }catch(e){} }, Math.max(quickMs,120) + 80);
        // mark visual taken so continuation doesn't try to move it later
        try{ note.eaten = true; note._visualTaken = true; }catch(e){}
      }catch(e){ /* ignore */ }
    }
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
        // animate fish to bear quickly so it looks like the bear eats it (keeps visual at bear)
        try{
          animateFishToBear(note, 180);
        }catch(e){}
        // ensure flagged as eaten for later logic
        try{ note.eaten = true; }catch(e){}
      } else if(dt <= JUDGE_GOOD){
        note.status = 'Good';
        note.hit = true;
        showJudgement('Good');
        playSuccess(t);
        // animate fish to bear quickly so it looks like the bear eats it (keeps visual at bear)
        try{
          animateFishToBear(note, 180);
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
            // threshold: 80px on desktop, scaled down on small screens
            const threshold = (window.innerWidth < 600) ? 56 : 80;
            if(dist <= threshold) accepted = true;
          }
        }catch(e){}

        if(accepted){
          note.status = 'Good';
          note.hit = true;
          showJudgement('Good');
          playSuccess(t);
          // animate to bear for visible feedback and mark eaten
          try{ animateFishToBear(note, 200); }catch(e){}
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
            // animate to bear for visible feedback and mark eaten
            try{ animateFishToBear(note, 200); }catch(e){}
            try{ note.eaten = true; }catch(e){}
          } else {
            note.status = 'Miss';
            note.hit = false;
            showJudgement('Miss');
          }
        }
      }

      // visual feedback on the fish itself; actual munch/play happens during bear measure
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

})();
