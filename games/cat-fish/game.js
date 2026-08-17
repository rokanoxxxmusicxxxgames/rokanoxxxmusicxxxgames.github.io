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
  let bpm = 70;
  let secondsPerBeat = () => 60 / bpm;
  let scheduled = [];
  let activeNoteInstances = [];
  let notesByMeasure = {};
  let started = false;

  // 判定時間
  const JUDGE_PERF = 0.08;  // Perfect: ±80ms
  const JUDGE_GOOD = 0.16;  // Good: ±160ms
  let hitWindow = 0.35;     // 最大判定範囲: ±350ms

  // 魚が猫からクマまで移動する時間
  const TRAVEL_BEATS = 1.0;

  // --------------------------------------------------
  // クマ画像の状態
  // --------------------------------------------------

  const BEAR_IDLE_SRC = 'images/bear.png';
  const BEAR_EATING_SRC = 'images/bear-eating.png';

  function setBearEating(isEating){
    bearEl.classList.toggle('hit', isEating);
    bearEl.classList.toggle('eating', isEating);

    const img = bearEl.querySelector('img');

    if(img){
      img.src = isEating ? BEAR_EATING_SRC : BEAR_IDLE_SRC;
    }
  }

  // --------------------------------------------------
  // 猫画像の状態
  // --------------------------------------------------

  const CAT_SHOOT_SRC = 'images/cat-shoot.png';

  function setCatShooting(isShooting){
    catEl.classList.toggle('shoot', isShooting);

    const img = catEl.querySelector('img');

    if(!img) return;

    if(isShooting){
      if(!img.dataset.idleSrc){
        img.dataset.idleSrc = img.getAttribute('src');
      }

      img.src = CAT_SHOOT_SRC;
    }else{
      img.src = img.dataset.idleSrc || img.src;
    }
  }

  // --------------------------------------------------
  // オーディオ
  // --------------------------------------------------

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

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(time);
    o.stop(time + 0.3);
  }

  function playMunch(time){
    ensureAudio();

    const bufferSize = 0.2 * audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(
      1,
      bufferSize,
      audioCtx.sampleRate
    );

    const data = buf.getChannelData(0);

    for(let i = 0; i < bufferSize; i++){
      data[i] =
        (Math.random() * 2 - 1) *
        Math.exp(-i / (bufferSize / 4));
    }

    const src = audioCtx.createBufferSource();
    src.buffer = buf;

    const g = audioCtx.createGain();

    g.gain.setValueAtTime(0.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    src.connect(g);
    g.connect(audioCtx.destination);

    src.start(time);
  }

  // Goodの効果音
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

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(time);
    o.stop(time + 0.22);
  }

  // Perfectの効果音
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

    o1.connect(g);
    o2.connect(g);
    g.connect(audioCtx.destination);

    o1.start(time);
    o2.start(time);

    o1.stop(time + 0.18);
    o2.stop(time + 0.18);
  }

  // --------------------------------------------------
  // ノーツのスケジュール
  // --------------------------------------------------

  function schedule(){
    scheduled = [];
    notesByMeasure = {};

    const startTime = audioCtx.currentTime + 0.6;

    for(let m = 0; m < totalMeasures; m++){

      const measureStart =
        startTime +
        m * beatsPerMeasure * secondsPerBeat();

      if(m % 2 === 0){

        const pattern = generatePatternForMeasure(m);

        notesByMeasure[m] = [];

        pattern.forEach(offsetBeat => {

          const t =
            measureStart +
            offsetBeat * secondsPerBeat();

          const measureEnd =
            measureStart +
            beatsPerMeasure * secondsPerBeat();

          const munchTime =
            t +
            beatsPerMeasure * secondsPerBeat();

          const noteObj = {
            time: t,
            measure: m,
            measureEnd: measureEnd,
            munchTime: munchTime,
            kind: 'cat',
            hit: false,
            status: 'pending'
          };

          scheduled.push(noteObj);
          notesByMeasure[m].push(noteObj);
          activeNoteInstances.push(noteObj);
        });

        // 猫ターンのバナー
        try{
          const bannerTime = measureStart;

          const msBanner =
            Math.max(
              0,
              (bannerTime - audioCtx.currentTime) * 1000
            );

          setTimeout(() => {
            showTurnBanner(m);
          }, msBanner);

        }catch(e){}

        // クマターン
        if(m + 1 < totalMeasures){

          const bearStart =
            measureStart +
            beatsPerMeasure * secondsPerBeat() +
            0.08;

          const msBear =
            Math.max(
              0,
              (bearStart - audioCtx.currentTime) * 1000
            );

          setTimeout(() => {
            playBearMeasure(m);
          }, msBear);
        }

      }else{
        // odd measures are bear measures
      }
    }

    // 時間順に並べる
    scheduled.sort((a,b) => a.time - b.time);

    // ノーツを発生させる
    scheduled.forEach(item => {

      const ms =
        Math.max(
          0,
          (item.time - audioCtx.currentTime) * 1000 - 10
        );

      setTimeout(() => {
        triggerNote(item);
      }, ms);
    });

    // ゲーム終了
    const endTime =
      startTime +
      totalMeasures *
      beatsPerMeasure *
      secondsPerBeat();

    setTimeout(() => {
      endGame();
    }, Math.max(
      0,
      (endTime - audioCtx.currentTime) * 1000 + 200
    ));
  }

  // --------------------------------------------------
  // ノーツパターン生成
  // --------------------------------------------------

  function generatePatternForMeasure(m){

    let patterns = [];

    if(m < 4){

      // 最初の4小節は4分音符中心
      for(let b = 0; b < 4; b++){

        if(Math.random() < 0.75){
          patterns.push(b);
        }
      }

      // 最低2個
      while(patterns.length < 2){

        const pick =
          Math.floor(Math.random() * 4);

        if(!patterns.includes(pick)){
          patterns.push(pick);
        }
      }

    }else{

      // 後半は8分音符や3連符
      for(let b = 0; b < 4; b++){

        const r = Math.random();

        if(r < 0.5){

          // 4分音符
          patterns.push(b);

        }else if(r < 0.8){

          // 8分音符
          patterns.push(b);
          patterns.push(b + 0.5);

        }else{

          // 3連符
          patterns.push(b);
          patterns.push(b + 1 / 3);
          patterns.push(b + 2 / 3);
        }
      }

      // 最低2個
      if(patterns.length < 2){
        patterns.push(0);
        patterns.push(1);
      }
    }

    // 重複削除＋ソート
    patterns =
      Array.from(new Set(patterns))
      .sort((a,b) => a - b);

    return patterns;
  }

  // --------------------------------------------------
  // ノーツ発生
  // --------------------------------------------------

  function triggerNote(item){

    const t = item.time;

    if(item.kind === 'cat'){

      // 猫の鳴き声
      playMeow(t);

      // 猫を投げポーズに変更
      setCatShooting(true);

      setTimeout(() => {
        setCatShooting(false);
      }, 250);

      // 魚を投げる
      createFishAnimation(t, item);

      // 古いノーツを整理
      setTimeout(() => {

        const now =
          audioCtx
            ? audioCtx.currentTime
            : Date.now() / 1000;

        activeNoteInstances =
          activeNoteInstances.filter(
            n =>
              ((n.munchTime || n.time) >
              (now - 1.5))
          );

      }, 4000);
    }
  }

  // --------------------------------------------------
  // クマが魚を食べる
  // --------------------------------------------------

  function playBearMeasure(catMeasureIndex){

    const notes =
      notesByMeasure[catMeasureIndex] || [];

    if(notes.length === 0) return;

    const DECISION_BUFFER_MS =
      Math.round(JUDGE_GOOD * 1000) + 60;

    notes.forEach(n => {

      const munchTime =
        n.munchTime ||
        (
          n.time +
          beatsPerMeasure *
          secondsPerBeat()
        );

      const ms =
        Math.max(
          0,
          (
            munchTime -
            (
              audioCtx
                ? audioCtx.currentTime
                : 0
            )
          ) * 1000 +
          DECISION_BUFFER_MS
        );

      setTimeout(() => {

        try{

          const eaten =
            (
              n.status === 'Perfect' ||
              n.status === 'Good'
            ) ||
            n.hit;

          if(eaten){

            // 食べる音
            playMunch(munchTime);

            // クマを食べるポーズへ
            setBearEating(true);

            setTimeout(() => {
              setBearEating(false);
            }, 360);

            // 念のため魚を削除
            const f = n.fishEl;

            if(f && f.parentElement){

              f.style.transition =
                'transform 160ms ease, opacity 180ms ease';

              f.style.transform = 'scale(0.3)';
              f.style.opacity = '0';

              setTimeout(() => {

                if(f && f.parentElement){
                  f.remove();
                }

              }, 220);
            }

            try{
              n.eaten = true;
            }catch(e){}
          }

        }catch(e){}
      }, ms);
    });

    // ノーツ整理＋小節評価
    try{

      const lastMunch =
        notes.reduce(
          (acc,n) =>
            Math.max(acc, n.munchTime || 0),
          0
        );

      const delayMs =
        Math.max(
          300,
          Math.round(
            (
              lastMunch -
              (
                audioCtx
                  ? audioCtx.currentTime
                  : Date.now() / 1000
              )
            ) * 1000
          ) +
          DECISION_BUFFER_MS +
          300
        );

      setTimeout(() => {

        try{
          evaluateMeasure(catMeasureIndex);
        }catch(e){}

      }, delayMs + 40);

      setTimeout(() => {

        try{
          delete notesByMeasure[catMeasureIndex];
        }catch(e){}

      }, delayMs + 200);

    }catch(e){}

    // クマターン表示
    try{

      const bannerMs =
        Math.max(
          0,
          (
            (
              notes[0] &&
              notes[0].munchTime
            )
              ? notes[0].munchTime -
                audioCtx.currentTime
              : 0
          ) * 1000
        );

      setTimeout(() => {

        showTurnBanner(
          catMeasureIndex + 1
        );

      }, bannerMs);

    }catch(e){}
  }

  // --------------------------------------------------
  // 魚のアニメーション
  // --------------------------------------------------

  function createFishAnimation(scheduledTime, item){

    const catRect =
      catEl.getBoundingClientRect();

    const bearRect =
      bearEl.getBoundingClientRect();

    const areaRect =
      playArea.getBoundingClientRect();

    const fish =
      document.createElement('div');

    fish.className = 'fish';

    fish.innerHTML =
      '<img src="images/fish.png" alt="fish">';

    fishLayer.appendChild(fish);

    // ----------------------------------------------
    // 開始位置
    // 猫の右端のすぐ隣から出す
    // ----------------------------------------------

    const startX =
      catRect.right -
      areaRect.left -
      5;

    const startY =
      catRect.top +
      catRect.height / 2 -
      areaRect.top -
      16;

    // ----------------------------------------------
    // クマ側の位置
    // ----------------------------------------------

    const endX =
      bearRect.left +
      bearRect.width / 2 -
      areaRect.left -
      32;

    const endY =
      bearRect.top +
      bearRect.height / 2 -
      areaRect.top -
      16;

    // ----------------------------------------------
    // 初期状態
    // ----------------------------------------------

    fish.style.left =
      startX + 'px';

    fish.style.top =
      startY + 'px';

    fish.style.opacity = '1';
    fish.style.transform = 'scale(1)';

    // ノートに魚を保存
    if(item){
      item.fishEl = fish;
    }

    // ----------------------------------------------
    // アニメーション開始タイミング
    // ----------------------------------------------

    const now =
      audioCtx
        ? audioCtx.currentTime
        : null;

    const startDelayMs =
      now
        ? Math.max(
            0,
            (scheduledTime - now) * 1000
          )
        : 0;

    // ----------------------------------------------
    // クマに到達する時間
    // ----------------------------------------------

    const munchTime =
      (
        item &&
        item.time
      )
        ? (
            item.time +
            beatsPerMeasure *
            secondsPerBeat()
          )
        : (
            scheduledTime +
            beatsPerMeasure *
            secondsPerBeat()
          );

    const travelMs =
      Math.max(
        120,
        Math.round(
          (munchTime - scheduledTime) * 1000
        )
      );

    // ----------------------------------------------
    // 画面外まで進ませる
    // ----------------------------------------------

    const overshoot =
      Math.max(
        160,
        areaRect.width * 0.25
      );

    const finalX =
      areaRect.width +
      overshoot;

    // クマまでの速度
    const rateX =
      (endX - startX) /
      travelMs;

    // 画面外まで進む時間
    const totalDurationMsX =
      rateX > 0
        ? Math.max(
            travelMs,
            Math.round(
              (finalX - startX) /
              rateX
            )
          )
        : travelMs + 900;

    // ----------------------------------------------
    // アニメーション設定
    // ----------------------------------------------

    fish.style.transition =
      `left ${totalDurationMsX}ms linear, ` +
      `top ${travelMs}ms linear, ` +
      `opacity 250ms ease`;

    // アニメーション開始
    setTimeout(() => {

      requestAnimationFrame(() => {

        fish.style.left =
          finalX + 'px';

        fish.style.top =
          endY + 'px';
      });

    }, startDelayMs);

    // ----------------------------------------------
    // 注意：
    // 以前あった「魚が近づくと光る」処理は削除
    // ----------------------------------------------

    // Missの場合はそのまま画面外へ進む。
    // Good / Perfectの場合だけ、
    // animateFishToBear() が割り込んで魚を消す。

    // ----------------------------------------------
    // 念のため画面外到達後に削除
    // ----------------------------------------------

    setTimeout(() => {

      if(fish && fish.parentElement){
        fish.remove();
      }

    }, startDelayMs + totalDurationMsX + 500);

    // ----------------------------------------------
    // Good / Perfect時の魚捕獲アニメーション
    // ----------------------------------------------

    function animateFishToBear(note, quickMs){

      try{

        const f =
          note &&
          note.fishEl;

        if(!f) return;

        try{
          note.eaten = true;
          note._visualTaken = true;
        }catch(e){}

        // 現在位置を確定
        try{

          const areaRectNow =
            playArea.getBoundingClientRect();

          const fRectNow =
            f.getBoundingClientRect();

          const curLeft =
            fRectNow.left -
            areaRectNow.left;

          const curTop =
            fRectNow.top -
            areaRectNow.top;

          f.style.transition = 'none';

          f.style.left =
            curLeft + 'px';

          f.style.top =
            curTop + 'px';

          void f.offsetWidth;

        }catch(e){}

        // 魚を縮小して消す
        const dur =
          Math.max(60, quickMs);

        try{

          f.style.transition =
            `transform ${dur}ms ease, ` +
            `opacity ${Math.max(
              60,
              Math.round(dur * 0.9)
            )}ms ease`;

          f.style.transform =
            'scale(0.36)';

          f.style.opacity = '0';

        }catch(e){}

        setTimeout(() => {

          try{

            if(f && f.parentElement){
              f.remove();
            }

          }catch(e){}

        }, dur + 40);

        // クマの食べる演出
        try{

          setBearEating(true);

          const bi =
            bearEl.querySelector &&
            bearEl.querySelector('img');

          if(bi){

            bi.style.transition =
              'transform 160ms ease';

            bi.style.transform =
              'translateY(-6px) scale(1.04)';

            setTimeout(() => {

              try{
                bi.style.transform = '';
              }catch(e){}

            }, 260);
          }

          setTimeout(() => {

            try{
              setBearEating(false);
            }catch(e){}

          }, 360);

        }catch(e){}

      }catch(e){}
    }

    // onUserInputから呼べるようにする
    if(item){
      item._animateFishToBear =
        animateFishToBear;
    }
  }

  // --------------------------------------------------
  // 一番近いノーツを探す
  // --------------------------------------------------

  function findNearestActiveNote(time){

    let best = null;
    let bestDt = hitWindow;

    activeNoteInstances.forEach(n => {

      if(n.hit) return;

      const dt =
        Math.abs(
          (n.munchTime || n.time) -
          time
        );

      if(dt <= bestDt){

        bestDt = dt;
        best = n;
      }
    });

    return best;
  }

  // --------------------------------------------------
  // 判定表示
  // --------------------------------------------------

  function showJudgement(kind){

    if(!judgementEl) return;

    judgementEl.textContent = kind;

    judgementEl.className =
      'judgement show ' +
      kind.toLowerCase();

    // 光る演出は削除
    // Perfect / Good / Miss の文字だけ表示する

    clearTimeout(
      judgementEl._timer
    );

    judgementEl._timer =
      setTimeout(() => {

        if(judgementEl){
          judgementEl.className =
            'judgement';
        }

      }, 600);
  }

  // --------------------------------------------------
  // ターン表示
  // --------------------------------------------------

  function showTurnBanner(measureIndex){

    if(!turnBanner) return;

    const isCat =
      measureIndex % 2 === 0;

    turnBanner.textContent =
      isCat
        ? 'Cat のターン'
        : 'Bear のターン';

    turnBanner.classList.remove(
      'hidden',
      'cat',
      'bear'
    );

    turnBanner.classList.add(
      isCat ? 'cat' : 'bear'
    );

    turnBanner.classList.remove(
      'hidden'
    );

    clearTimeout(
      turnBanner._timer
    );

    const durMs =
      Math.max(
        300,
        Math.round(
          beatsPerMeasure *
          secondsPerBeat() *
          1000
        ) - 80
      );

    turnBanner._timer =
      setTimeout(() => {

        if(turnBanner){
          turnBanner.classList.add(
            'hidden'
          );
        }

      }, durMs);
  }

  // --------------------------------------------------
  // 小節結果
  // --------------------------------------------------

  function showMeasureResult(points){

    if(!judgementEl) return;

    judgementEl.textContent =
      points > 0
        ? ('+' + points + ' pt')
        : '0 pt';

    judgementEl.className =
      'judgement show measure';

    clearTimeout(
      judgementEl._timer
    );

    judgementEl._timer =
      setTimeout(() => {

        if(judgementEl){
          judgementEl.className =
            'judgement';
        }

      }, 700);
  }

  // --------------------------------------------------
  // 小節評価
  // --------------------------------------------------

  function evaluateMeasure(m){

    const notes =
      notesByMeasure[m] || [];

    if(notes.length === 0){
      return;
    }

    // 未判定はMiss
    notes.forEach(n => {

      if(
        !n.status ||
        n.status === 'pending'
      ){
        n.status = 'Miss';
      }

    });

    // 全Perfectなら2点
    const allPerfect =
      notes.length > 0 &&
      notes.every(
        n => n.status === 'Perfect'
      );

    // 全部Missでなければ1点
    const noneMiss =
      notes.length > 0 &&
      notes.every(
        n => n.status !== 'Miss'
      );

    let award = 0;

    if(allPerfect){
      award = 2;
    }else if(noneMiss){
      award = 1;
    }

    score += award;

    scoreVal.textContent =
      score;

    showMeasureResult(
      award
    );
  }

  // --------------------------------------------------
  // タップ処理
  // --------------------------------------------------

  function onUserInput(evt){

    // 最初の操作でAudioContextを開始
    ensureAudio();

    const t =
      audioCtx.currentTime;

    const note =
      findNearestActiveNote(t);

    if(note){

      note.attempted = true;
      note.hitTime = t;

      // クマに魚が到着する時間
      const targetTime =
        note.munchTime ||
        note.time;

      const dt =
        Math.abs(
          targetTime - t
        );

      // ----------------------------------------------
      // Perfect
      // ----------------------------------------------

      if(dt <= JUDGE_PERF){

        note.status = 'Perfect';
        note.hit = true;

        showJudgement(
          'Perfect'
        );

        playPerfect(t);

        // 魚を捕まえる
        try{

          if(note._animateFishToBear){
            note._animateFishToBear(
              note,
              180
            );
          }

        }catch(e){}

        try{
          note.eaten = true;
        }catch(e){}

      }

      // ----------------------------------------------
      // Good
      // ----------------------------------------------

      else if(dt <= JUDGE_GOOD){

        note.status = 'Good';
        note.hit = true;

        showJudgement(
          'Good'
        );

        playSuccess(t);

        // 魚を捕まえる
        try{

          if(note._animateFishToBear){
            note._animateFishToBear(
              note,
              180
            );
          }

        }catch(e){}

        try{
          note.eaten = true;
        }catch(e){}

      }

      // ----------------------------------------------
      // Goodの救済判定
      // ----------------------------------------------

      else{

        let accepted = false;

        // 魚がクマに近い場合
        try{

          if(
            !accepted &&
            note.fishEl &&
            bearEl
          ){

            const fR =
              note.fishEl
              .getBoundingClientRect();

            const bR =
              bearEl
              .getBoundingClientRect();

            const fx =
              fR.left +
              fR.width / 2;

            const fy =
              fR.top +
              fR.height / 2;

            const bx =
              bR.left +
              bR.width / 2;

            const by =
              bR.top +
              bR.height / 2;

            const dist =
              Math.hypot(
                fx - bx,
                fy - by
              );

            const threshold =
              window.innerWidth < 600
                ? 28
                : 40;

            if(dist <= threshold){
              accepted = true;
            }
          }

        }catch(e){}

        // --------------------------------------------
        // Goodとして受け付ける
        // --------------------------------------------

        if(accepted){

          note.status = 'Good';
          note.hit = true;

          showJudgement(
            'Good'
          );

          playSuccess(t);

          try{

            if(note._animateFishToBear){
              note._animateFishToBear(
                note,
                200
              );
            }

          }catch(e){}

          try{
            note.eaten = true;
          }catch(e){}

        }

        // --------------------------------------------
        // 隣のノーツとの間隔を使った救済判定
        // --------------------------------------------

        else{

          let acceptedByNeighbor =
            false;

          try{

            let secondDt =
              Infinity;

            activeNoteInstances.forEach(
              n2 => {

                if(
                  n2 === note ||
                  n2.hit
                ){
                  return;
                }

                const d2 =
                  Math.abs(
                    (
                      n2.munchTime ||
                      n2.time
                    ) - t
                  );

                if(d2 < secondDt){
                  secondDt = d2;
                }
              }
            );

            if(secondDt < Infinity){

              const gap =
                secondDt +
                Math.abs(
                  (
                    note.munchTime ||
                    note.time
                  ) - t
                );

              if(
                Math.abs(
                  (
                    note.munchTime ||
                    note.time
                  ) - t
                ) <=
                (gap / 2 + 0.02)
              ){
                acceptedByNeighbor = true;
              }
            }

          }catch(e){}

          if(acceptedByNeighbor){

            note.status = 'Good';
            note.hit = true;

            showJudgement(
              'Good'
            );

            playSuccess(t);

            try{

              if(note._animateFishToBear){
                note._animateFishToBear(
                  note,
                  200
                );
              }

            }catch(e){}

            try{
              note.eaten = true;
            }catch(e){}

          }else{

            // Miss
            note.status = 'Miss';
            note.hit = false;

            showJudgement(
              'Miss'
            );

            // 魚はそのまま右へ進む
          }
        }
      }

      // ----------------------------------------------
      // 魚を捕まえたときの軽い演出
      // ----------------------------------------------

      try{

        if(
          note.fishEl &&
          note.hit
        ){
          note.fishEl.classList.add(
            'hit'
          );

          setTimeout(() => {

            try{

              if(note.fishEl){
                note.fishEl.classList.remove(
                  'hit'
                );
              }

            }catch(e){}

          }, 220);
        }

      }catch(e){}

    }else{

      // ノーツがないタイミングでタップした場合
      catEl.classList.add(
        'hit'
      );

      setTimeout(() => {
        catEl.classList.remove(
          'hit'
        );
      }, 160);

      showJudgement(
        'Miss'
      );
    }
  }

  // --------------------------------------------------
  // ゲーム開始
  // --------------------------------------------------

  function startGame(){

    if(started) return;

    // BPMをUIから取得
    if(
      bpmInput &&
      !isNaN(
        Number(bpmInput.value)
      )
    ){

      bpm =
        Math.max(
          30,
          Math.min(
            240,
            Number(
              bpmInput.value
            )
          )
        );

    }else if(difficultySelect){

      const val =
        difficultySelect.value;

      if(val === 'easy'){
        bpm = 60;
      }else if(val === 'normal'){
        bpm = 70;
      }else if(val === 'hard'){
        bpm = 90;
      }
    }

    // BPMを固定
    const lockedBpm = bpm;

    secondsPerBeat =
      () => 60 / lockedBpm;

    started = true;

    score = 0;

    scoreVal.textContent =
      score;

    ensureAudio();

    setBearEating(false);
    setCatShooting(false);

    // 判定範囲の表示処理は削除

    // 操作設定を無効化
    if(difficultySelect){
      difficultySelect.disabled =
        true;
    }

    if(bpmInput){
      bpmInput.disabled =
        true;
    }

    startBtn.disabled = true;

    // ゲーム開始
    schedule();

    // タップイベント
    if(tapArea){

      tapArea.addEventListener(
        'click',
        onUserInput
      );

      tapArea.addEventListener(
        'touchstart',
        onUserInput
      );

    }else{

      window.addEventListener(
        'click',
        onUserInput
      );

      window.addEventListener(
        'touchstart',
        onUserInput
      );
    }
  }

  // --------------------------------------------------
  // ゲーム終了
  // --------------------------------------------------

  function endGame(){

    started = false;

    if(tapArea){

      tapArea.removeEventListener(
        'click',
        onUserInput
      );

      tapArea.removeEventListener(
        'touchstart',
        onUserInput
      );
    }

    window.removeEventListener(
      'click',
      onUserInput
    );

    window.removeEventListener(
      'touchstart',
      onUserInput
    );

    // 操作設定を再有効化
    if(difficultySelect){
      difficultySelect.disabled =
        false;
    }

    if(bpmInput){
      bpmInput.disabled =
        false;
    }

    startBtn.disabled = false;

    setBearEating(false);
    setCatShooting(false);

    // ターン表示を消す
    try{

      if(turnBanner){

        turnBanner.classList.add(
          'hidden'
        );

        clearTimeout(
          turnBanner._timer
        );
      }

    }catch(e){}

    alert(
      '終了！ スコア: ' +
      score +
      ' 点'
    );
  }

  // --------------------------------------------------
  // スタートボタン
  // --------------------------------------------------

  startBtn.addEventListener(
    'click',
    () => {

      ensureAudio();

      if(
        audioCtx.state ===
        'suspended'
      ){
        audioCtx.resume();
      }

      startGame();
    }
  );

  // --------------------------------------------------
  // リスタート
  // --------------------------------------------------

  restartBtn.addEventListener(
    'click',
    () => {

      location.reload();

    }
  );

  // --------------------------------------------------
  // 難易度変更
  // --------------------------------------------------

  if(difficultySelect){

    difficultySelect.addEventListener(
      'change',
      () => {

        if(started) return;

        const val =
          difficultySelect.value;

        if(val === 'easy'){
          bpm = 60;
        }else if(val === 'normal'){
          bpm = 70;
        }else if(val === 'hard'){
          bpm = 90;
        }

        if(bpmInput){
          bpmInput.value = bpm;
        }

        secondsPerBeat =
          () => 60 / bpm;
      }
    );
  }

  // --------------------------------------------------
  // BPM変更
  // --------------------------------------------------

  if(bpmInput){

    bpmInput.addEventListener(
      'change',
      () => {

        if(started) return;

        const v =
          Number(
            bpmInput.value
          ) || bpm;

        bpm =
          Math.max(
            30,
            Math.min(
              240,
              v
            )
          );

        secondsPerBeat =
          () => 60 / bpm;
      }
    );
  }

  // --------------------------------------------------
  // スマホのAudioContext対策
  // --------------------------------------------------

  document.addEventListener(
    'touchstart',
    function once(){

      if(
        audioCtx &&
        audioCtx.state ===
        'suspended'
      ){
        audioCtx.resume();
      }

      document.removeEventListener(
        'touchstart',
        once
      );
    }
  );

})();