const startButton = document.getElementById("start");
const clickButton = document.getElementById("click-button");
const scoreText = document.getElementById("score");
const timeText = document.getElementById("time");

let score = 0;
let timeLeft = 30;
let timer = null;

// ゲーム開始
startButton.addEventListener("click", () => {
    score = 0;
    timeLeft = 30;

    scoreText.textContent = "スコア：0";
    timeText.textContent = "残り時間：30秒";

    startButton.disabled = true;
    clickButton.style.display = "block";

    moveButton();

    timer = setInterval(() => {
        timeLeft--;

        timeText.textContent = `残り時間：${timeLeft}秒`;

        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
});

// ボタンをクリック
clickButton.addEventListener("click", () => {
    score++;

    scoreText.textContent = `スコア：${score}`;

    moveButton();
});

// ボタンをランダムな位置に移動
function moveButton() {
    const game = document.getElementById("game");

    const maxX = game.clientWidth - clickButton.offsetWidth;
    const maxY = game.clientHeight - clickButton.offsetHeight;

    const x = Math.random() * maxX;
    const y = Math.random() * maxY;

    clickButton.style.left = `${x}px`;
    clickButton.style.top = `${y}px`;
}

// ゲーム終了
function endGame() {
    clearInterval(timer);

    clickButton.style.display = "none";
    startButton.disabled = false;

    alert(`終了！\nあなたのスコアは ${score} 回です！`);
}
