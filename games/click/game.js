const startButton = document.getElementById("start");
const scoreText = document.getElementById("score");
const timeText = document.getElementById("time");
const holes = [...document.querySelectorAll(".mole")];

const rarityConfig = {
    normal: { points: 1, durationMin: 800, durationMax: 1300, imageKey: "normal" },
    rare: { points: 3, durationMin: 500, durationMax: 850, imageKey: "rare" },
    epic: { points: 5, durationMin: 300, durationMax: 550, imageKey: "epic" },
};

let score = 0;
let timeLeft = 30;
let timer = null;
let waveTimer = null;
const holeTimers = new Map();

startButton.addEventListener("click", startGame);

holes.forEach((hole) => {
    hole.addEventListener("click", () => {
        if (!hole.classList.contains("visible")) {
            return;
        }

        const points = Number(hole.dataset.points || rarityConfig.normal.points);
        score += points;
        scoreText.textContent = `スコア：${score}`;

        const image = hole.querySelector(".mole-image");
        const pointsBadge = hole.querySelector(".mole-points");
        if (image) {
            image.src = image.dataset.hit;
        }
        if (pointsBadge) {
            pointsBadge.textContent = `+${points}`;
        }

        clearHoleTimer(hole);
        hole.disabled = true;

        setTimeout(() => {
            hideHole(hole);
        }, 160);
    });
});

function startGame() {
    score = 0;
    timeLeft = 30;

    scoreText.textContent = "スコア：0";
    timeText.textContent = "残り時間：30秒";

    startButton.disabled = true;
    clearInterval(timer);
    clearTimeout(waveTimer);
    clearAllHoleTimers();
    hideAllMoles();

    timer = setInterval(() => {
        timeLeft--;
        timeText.textContent = `残り時間：${timeLeft}秒`;

        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);

    scheduleWave();
}

function scheduleWave() {
    if (timeLeft <= 0) {
        return;
    }

    const waveCount = getWaveCount();
    const availableHoles = holes.filter((hole) => !hole.classList.contains("visible"));
    const selected = [];

    while (selected.length < waveCount && availableHoles.length > 0) {
        const index = Math.floor(Math.random() * availableHoles.length);
        const hole = availableHoles.splice(index, 1)[0];
        selected.push(hole);
    }

    selected.forEach((hole) => {
        showHole(hole);
    });

    const interval = getWaveInterval();
    waveTimer = setTimeout(() => {
        if (timeLeft > 0) {
            scheduleWave();
        }
    }, interval);
}

function getWaveCount() {
    const progress = 1 - timeLeft / 30;
    const baseCount = 1 + Math.floor(progress * 4);
    const bonusChance = Math.random() < Math.min(progress * 1.5, 0.9);
    return Math.min(5, baseCount + (bonusChance ? 1 : 0));
}

function getWaveInterval() {
    const progress = 1 - timeLeft / 30;
    const minInterval = 400;
    const maxInterval = 1600;
    return Math.max(minInterval, maxInterval - progress * 1100);
}

function showHole(hole) {
    const rarityRoll = Math.random();
    let rarity = "normal";
    if (rarityRoll > 0.7 && rarityRoll <= 0.95) {
        rarity = "rare";
    } else if (rarityRoll > 0.95) {
        rarity = "epic";
    }

    const config = rarityConfig[rarity];
    const image = hole.querySelector(".mole-image");
    const pointsBadge = hole.querySelector(".mole-points");

    hole.dataset.rarity = rarity;
    hole.dataset.points = String(config.points);
    hole.classList.add("visible");
    hole.disabled = false;

    if (image) {
        image.src = image.dataset[config.imageKey];
    }
    if (pointsBadge) {
        pointsBadge.textContent = String(config.points);
    }

    const duration = config.durationMin + Math.random() * (config.durationMax - config.durationMin);
    const timeoutId = setTimeout(() => {
        hideHole(hole);
    }, duration);
    holeTimers.set(hole, timeoutId);
}

function hideHole(hole) {
    clearHoleTimer(hole);
    const image = hole.querySelector(".mole-image");
    const pointsBadge = hole.querySelector(".mole-points");
    if (image) {
        image.src = image.dataset.normal;
    }
    if (pointsBadge) {
        pointsBadge.textContent = "1";
    }

    hole.dataset.rarity = "normal";
    hole.dataset.points = "1";
    hole.classList.remove("visible");
    hole.disabled = true;
}

function clearHoleTimer(hole) {
    if (holeTimers.has(hole)) {
        clearTimeout(holeTimers.get(hole));
        holeTimers.delete(hole);
    }
}

function clearAllHoleTimers() {
    holeTimers.forEach((timeoutId) => clearTimeout(timeoutId));
    holeTimers.clear();
}

function hideAllMoles() {
    holes.forEach((hole) => {
        hideHole(hole);
    });
}

function endGame() {
    clearInterval(timer);
    clearTimeout(waveTimer);
    clearAllHoleTimers();
    hideAllMoles();
    startButton.disabled = false;

    alert(`終了！\nあなたのスコアは ${score} 点です！`);
}
