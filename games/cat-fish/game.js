(function(){
  const startBtn = document.getElementById('start');
  const restartBtn = document.getElementById('restart');
  const scoreVal = document.getElementById('score-val');
  const measureCount = document.getElementById('measure-count');
  const playArea = document.getElementById('play-area');
  const catEl = document.getElementById('cat');
  const bearEl = document.getElementById('bear');
  const fishLayer = document.getElementById('fish-layer');

  let audioCtx = null;
  let score = 0;
  let totalMeasures = 10;
  let beatsPerMeasure = 4;
  let bpm = 100; // feel free to tweak
  let secondsPerBeat = () => 60 / bpm;
  let scheduled = [];
  let activeNoteInstances = [];
  let started = false;

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

  function schedule(){
    scheduled = [];
    const startTime = audioCtx.currentTime + 0.6; // give a little lead

    for(let m=0;m<totalMeasures;m++){
      const measureStart = startTime + m * beatsPerMeasure * secondsPerBeat();
      const pattern = generatePatternForMeasure(m);
      // pattern is array of offsets in beats (may be fractional for eighths/triplets)
      pattern.forEach(offsetBeat => {
        const t = measureStart + offsetBeat * secondsPerBeat();
        scheduled.push({time:t, measure:m});
      });
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
    const patterns = [];
    if(m < 4){
      // quarters, maybe rests
      for(let b=0;b<4;b++){
        if(Math.random() < 0.75) patterns.push(b); // 75% note
      }
      // ensure at least one note
      if(patterns.length===0) patterns.push(0);
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
    }
    return patterns;
  }

  function triggerNote(item){
    const isCatMeasure = (item.measure % 2 === 0); // cat first
    const t = item.time;
    if(isCatMeasure){
      // meow and throw fish
      playMeow(t);
      // create fish animation at slightly after sound for visibility
      setTimeout(()=>createFishAnimation(t, item), 80);
      // register active note for hit detection
      activeNoteInstances.push({time:t, hit:false, measure:item.measure});
      // prune old
      setTimeout(()=>{
        // remove instance after hit window passes
        activeNoteInstances = activeNoteInstances.filter(n=>Math.abs(n.time - audioCtx.currentTime) < 4);
      }, 4000);
    } else {
      // bear measure: optionally play munch animation if previous notes were hit
      // play a small ambient or movement to indicate bear's turn
      // no explicit sound here; munch happens on successful hit
    }

    // update measure UI
    const measureNumber = item.measure + 1;
    measureCount.textContent = measureNumber + ' / ' + totalMeasures + ' 小節';
  }

  function createFishAnimation(scheduledTime, item){
    // compute positions
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

    // force reflow then animate using transform
    requestAnimationFrame(()=>{
      fish.style.transform = `translate(${endX - startX}px, ${endY - startY}px)`;
    });

    // remove after travel
    setTimeout(()=>{
      fish.style.opacity = '0';
      setTimeout(()=>{ fish.remove(); }, 300);
    }, 650);
  }

  function findNearestActiveNote(time){
    const hitWindow = 0.26; // seconds
    let best = null;
    let bestDt = hitWindow;
    activeNoteInstances.forEach(n => {
      if(n.hit) return;
      const dt = Math.abs(n.time - time);
      if(dt <= bestDt){ bestDt = dt; best = n; }
    });
    return best;
  }

  function onUserInput(evt){
    // start audio context on first user interaction
    ensureAudio();
    const t = audioCtx.currentTime;
    const note = findNearestActiveNote(t);
    if(note){
      note.hit = true;
      // increment score and play munch
      score += 1;
      scoreVal.textContent = score;
      playMunch(t);
      // show quick bear eat animation
      bearEl.classList.add('hit');
      setTimeout(()=>bearEl.classList.remove('hit'), 220);
    } else {
      // small miss feedback: flash cat
      catEl.classList.add('hit');
      setTimeout(()=>catEl.classList.remove('hit'), 160);
    }
  }

  function startGame(){
    if(started) return;
    started = true;
    score = 0; scoreVal.textContent = score;
    ensureAudio();
    schedule();
    // attach input
    window.addEventListener('click', onUserInput);
    window.addEventListener('touchstart', onUserInput);
  }

  function endGame(){
    started = false;
    window.removeEventListener('click', onUserInput);
    window.removeEventListener('touchstart', onUserInput);
    alert('終了！ クマが食べた数: ' + score);
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

  // small helper: allow tapping anywhere before start to resume audio on mobile
  document.addEventListener('touchstart', function once(){ if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume(); } document.removeEventListener('touchstart', once); });

})();
