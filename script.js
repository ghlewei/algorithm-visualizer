/* ============================================================
   Algorithm Visualizer — Core Logic
   
   Architecture:
   - Generator-based sort algorithms (yield at each step)
   - Canvas rendering for 1000–10000 elements
   - Web Audio API for satisfying swap sounds
   - Completion sweep animation with ascending tones
   ============================================================ */

// ──────────────────────────────────────────
// DOM References
// ──────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const algorithmSelect = document.getElementById('algorithm');
const sizeSlider = document.getElementById('array-size');
const speedSlider = document.getElementById('speed');
const sizeLabel = document.getElementById('size-value');
const speedLabel = document.getElementById('speed-value');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────
let array = [];
let isSorting = false;
let stopRequested = false;
let audioCtx = null;

// ──────────────────────────────────────────
// Audio Engine (Web Audio API)
// ──────────────────────────────────────────
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

/**
 * Play a short sine-wave beep.
 * Pitch is mapped from `value` — higher value → higher pitch.
 */
function playTone(value, maxVal, duration = 0.06) {
    if (!audioCtx || audioCtx.state !== 'running') return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    // Map value to frequency: 180 Hz → 1400 Hz
    const freq = 180 + (value / maxVal) * 1220;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    // Quick plucky envelope
    gain.gain.setValueAtTime(0.09, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// ──────────────────────────────────────────
// Canvas Helpers
// ──────────────────────────────────────────
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
}

/** Return an HSL color string. Hue mapped 0°–300° (red → magenta). */
function barHue(value, n) {
    return (value / n) * 300;
}

function barColor(value, n) {
    return `hsl(${barHue(value, n)}, 85%, 55%)`;
}

/**
 * Render the array to canvas.
 * @param {Object} highlights  – { compare: [], swap: [] }
 */
function render(highlights = {}) {
    const { compare = [], swap = [] } = highlights;
    const n = array.length;
    const w = canvas.width;
    const h = canvas.height;
    const barW = w / n;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < n; i++) {
        const barH = (array[i] / n) * h;

        if (swap.includes(i)) {
            // Swap highlight — red with glow
            ctx.fillStyle = '#ff4455';
        } else if (compare.includes(i)) {
            // Compare highlight — yellow
            ctx.fillStyle = '#ffdd44';
        } else {
            // Default — rainbow gradient based on value
            ctx.fillStyle = barColor(array[i], n);
        }

        ctx.fillRect(
            i * barW,
            h - barH,
            Math.max(barW - 0.5, 0.8),
            barH
        );
    }
}

// ──────────────────────────────────────────
// Array Generation
// ──────────────────────────────────────────
function generateArray(size) {
    // Values 1..n, then Fisher-Yates shuffle
    array = Array.from({ length: size }, (_, i) => i + 1);
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ──────────────────────────────────────────
// Speed Calculation
// ──────────────────────────────────────────
/**
 * Returns how many sort operations to process per animation frame.
 * Exponential scale so slow speeds show individual steps and fast speeds
 * complete quickly even for O(n²) bubble sort.
 */
function getOpsPerFrame() {
    const speed = parseInt(speedSlider.value); // 1–100
    // speed  1 → 1
    // speed 25 → 10
    // speed 50 → 100
    // speed 75 → 1 000
    // speed100 → 10 000
    return Math.max(1, Math.round(Math.pow(10, speed / 25)));
}

// ──────────────────────────────────────────
// Sort Algorithms (Generator Functions)
// ──────────────────────────────────────────

/** Bubble Sort — O(n²) */
function* bubbleSortGen(arr) {
    const n = arr.length;
    for (let i = 0; i < n - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n - i - 1; j++) {
            yield { type: 'compare', indices: [j, j + 1] };
            if (arr[j] > arr[j + 1]) {
                [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
                yield { type: 'swap', indices: [j, j + 1] };
                swapped = true;
            }
        }
        if (!swapped) break; // Early exit if already sorted
    }
}

/** Quick Sort — O(n log n) average */
function* quickSortGen(arr, lo = 0, hi = arr.length - 1) {
    if (lo >= hi) return;

    // Partition (Lomuto scheme)
    const pivot = arr[hi];
    let i = lo;

    for (let j = lo; j < hi; j++) {
        yield { type: 'compare', indices: [j, hi] };
        if (arr[j] < pivot) {
            if (i !== j) {
                [arr[i], arr[j]] = [arr[j], arr[i]];
                yield { type: 'swap', indices: [i, j] };
            }
            i++;
        }
    }

    if (i !== hi) {
        [arr[i], arr[hi]] = [arr[hi], arr[i]];
        yield { type: 'swap', indices: [i, hi] };
    }

    yield* quickSortGen(arr, lo, i - 1);
    yield* quickSortGen(arr, i + 1, hi);
}

// ──────────────────────────────────────────
// Completion Sweep Animation
// ──────────────────────────────────────────
async function sweepAnimation() {
    const n = array.length;
    const w = canvas.width;
    const h = canvas.height;
    const barW = w / n;

    // Complete the sweep in roughly 2 seconds at 60 fps → ~120 frames
    const barsPerFrame = Math.max(1, Math.ceil(n / 120));

    let swept = 0;

    while (swept < n) {
        if (stopRequested) return;

        swept = Math.min(swept + barsPerFrame, n);

        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < n; i++) {
            const barH = (array[i] / n) * h;

            if (i < swept) {
                // Swept — brighter, glowing version of rainbow
                const hue = barHue(array[i], n);
                ctx.fillStyle = `hsl(${hue}, 100%, 72%)`;
            } else {
                ctx.fillStyle = barColor(array[i], n);
            }

            ctx.fillRect(
                i * barW,
                h - barH,
                Math.max(barW - 0.5, 0.8),
                barH
            );
        }

        // Ascending tone during sweep
        playTone(array[Math.min(swept - 1, n - 1)], n, 0.04);

        await new Promise(resolve => requestAnimationFrame(resolve));
    }
}

// ──────────────────────────────────────────
// Main Sort Runner
// ──────────────────────────────────────────
async function runSort() {
    initAudio();
    isSorting = true;
    stopRequested = false;
    lockControls(true);

    const algo = algorithmSelect.value;
    const gen = algo === 'bubble'
        ? bubbleSortGen(array)
        : quickSortGen(array);

    let compareIndices = [];
    let swapIndices = [];

    while (true) {
        if (stopRequested) break;

        const opsPerFrame = getOpsPerFrame();
        let soundValue = null;

        for (let op = 0; op < opsPerFrame; op++) {
            const result = gen.next();

            if (result.done) {
                // Sort complete → sweep!
                render();
                await sweepAnimation();
                isSorting = false;
                lockControls(false);
                startBtn.textContent = '▶ ソート開始';
                return;
            }

            const step = result.value;
            if (step.type === 'compare') {
                compareIndices = step.indices;
                swapIndices = [];
            } else if (step.type === 'swap') {
                swapIndices = step.indices;
                compareIndices = [];
                soundValue = Math.max(
                    array[step.indices[0]],
                    array[step.indices[1]]
                );
            }
        }

        // Render this frame
        render({ compare: compareIndices, swap: swapIndices });

        // Play sound for the last swap in this batch
        if (soundValue !== null) {
            playTone(soundValue, array.length);
        }

        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    // Stopped mid-sort
    isSorting = false;
    lockControls(false);
    startBtn.textContent = '▶ ソート開始';
    render();
}

// ──────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────
function lockControls(locked) {
    sizeSlider.disabled = locked;
    algorithmSelect.disabled = locked;
    startBtn.disabled = locked;
}

function resetArray() {
    if (isSorting) {
        stopRequested = true;
    }

    // Small delay so the sort loop can exit gracefully
    setTimeout(() => {
        const size = parseInt(sizeSlider.value);
        generateArray(size);
        resizeCanvas();
        render();
        startBtn.textContent = '▶ ソート開始';
    }, 50);
}

// ──────────────────────────────────────────
// Event Listeners
// ──────────────────────────────────────────
sizeSlider.addEventListener('input', (e) => {
    sizeLabel.textContent = e.target.value;
    if (!isSorting) {
        generateArray(parseInt(e.target.value));
        resizeCanvas();
        render();
    }
});

speedSlider.addEventListener('input', (e) => {
    speedLabel.textContent = e.target.value;
});

startBtn.addEventListener('click', () => {
    if (!isSorting) {
        startBtn.textContent = '⏳ ソート中...';
        runSort();
    }
});

resetBtn.addEventListener('click', () => {
    resetArray();
});

window.addEventListener('resize', () => {
    resizeCanvas();
    render();
});

// ──────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────
(function init() {
    const size = parseInt(sizeSlider.value);
    generateArray(size);
    resizeCanvas();
    render();
})();
