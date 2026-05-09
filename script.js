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
const csvColumnSelect = document.getElementById('csv-column');
const loadCsvBtn = document.getElementById('load-csv-btn');
const csvPreviewContainer = document.getElementById('csv-preview-container');
const csvTable = document.getElementById('csv-table');
const closePreviewBtn = document.getElementById('close-preview-btn');

// ──────────────────────────────────────────
// State
// ──────────────────────────────────────────
let array = [];
let arrayMax = 1;
let csvRawData = [];
let isCsvMode = false;
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
function barHue(value, maxVal) {
    return (value / maxVal) * 300;
}

function barColor(value, maxVal) {
    return `hsl(${barHue(value, maxVal)}, 85%, 55%)`;
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
        const barH = (array[i] / arrayMax) * h;

        if (swap.includes(i)) {
            // Swap highlight — red with glow
            ctx.fillStyle = '#ff4455';
        } else if (compare.includes(i)) {
            // Compare highlight — yellow
            ctx.fillStyle = '#ffdd44';
        } else {
            // Default — rainbow gradient based on value
            ctx.fillStyle = barColor(array[i], arrayMax);
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
    arrayMax = size;
    isCsvMode = false;
    sizeSlider.disabled = false;
    sizeLabel.textContent = size;
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
            const barH = (array[i] / arrayMax) * h;

            if (i < swept) {
                // Swept — brighter, glowing version of rainbow
                const hue = barHue(array[i], arrayMax);
                ctx.fillStyle = `hsl(${hue}, 100%, 72%)`;
            } else {
                ctx.fillStyle = barColor(array[i], arrayMax);
            }

            ctx.fillRect(
                i * barW,
                h - barH,
                Math.max(barW - 0.5, 0.8),
                barH
            );
        }

        // Ascending tone during sweep
        playTone(array[Math.min(swept - 1, n - 1)], arrayMax, 0.04);

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
            playTone(soundValue, arrayMax);
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
// CSV Handling
// ──────────────────────────────────────────
function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = '';
        } else {
            cur += char;
        }
    }
    result.push(cur.trim());
    return result;
}

async function fetchAndParseCSV() {
    try {
        const response = await fetch('test.csv');
        const text = await response.text();
        const lines = text.trim().split(/\r?\n/);
        
        if (lines.length > 0) {
            csvRawData = lines.map(parseCSVLine);
            const headers = csvRawData[0];
            
            csvColumnSelect.innerHTML = '';
            headers.forEach((header, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = header;
                if (header.toLowerCase() === 'age') {
                    option.selected = true;
                }
                csvColumnSelect.appendChild(option);
            });
            loadCsvBtn.disabled = false;
        }
    } catch (err) {
        console.error('Failed to load CSV:', err);
        csvColumnSelect.innerHTML = '<option value="">Error Loading CSV</option>';
    }
}

function renderCSVTable() {
    csvTable.innerHTML = '';
    if (csvRawData.length === 0) return;
    
    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    csvRawData[0].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    csvTable.appendChild(thead);
    
    // Body (first 5 rows)
    const tbody = document.createElement('tbody');
    for (let i = 1; i <= Math.min(5, csvRawData.length - 1); i++) {
        const tr = document.createElement('tr');
        csvRawData[i].forEach(val => {
            const td = document.createElement('td');
            td.textContent = val;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }
    csvTable.appendChild(tbody);
    csvPreviewContainer.style.display = 'block';
}

function loadCSVData() {
    if (csvRawData.length < 2) return;
    
    const colIndex = parseInt(csvColumnSelect.value);
    const colName = csvRawData[0][colIndex];
    let newArray = [];
    let numericSum = 0;
    let numericCount = 0;
    let hasNonNumeric = false;
    
    // Extract column
    for (let i = 1; i < csvRawData.length; i++) {
        const valStr = csvRawData[i][colIndex];
        if (valStr !== '' && valStr !== undefined) {
            const valNum = Number(valStr);
            if (isNaN(valNum)) {
                hasNonNumeric = true;
            } else {
                numericSum += valNum;
                numericCount++;
            }
        }
    }
    
    if (hasNonNumeric) {
        alert(`Warning: The column "${colName}" contains non-numeric data. These will be treated as missing values or could cause issues.`);
    }
    
    const mean = numericCount > 0 ? numericSum / numericCount : 0;
    
    // Impute and build array
    for (let i = 1; i < csvRawData.length; i++) {
        const valStr = csvRawData[i][colIndex];
        if (valStr === '' || valStr === undefined) {
            newArray.push(mean);
        } else {
            const valNum = Number(valStr);
            newArray.push(isNaN(valNum) ? mean : valNum);
        }
    }
    
    if (isSorting) {
        stopRequested = true;
    }
    
    setTimeout(() => {
        array = newArray;
        arrayMax = Math.max(1, ...array);
        isCsvMode = true;
        sizeSlider.disabled = true;
        sizeLabel.textContent = `${array.length} (CSV)`;
        renderCSVTable();
        resizeCanvas();
        render();
        startBtn.textContent = '▶ ソート開始';
    }, 50);
}

// ──────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────
function lockControls(locked) {
    sizeSlider.disabled = isCsvMode ? true : locked;
    algorithmSelect.disabled = locked;
    startBtn.disabled = locked;
    loadCsvBtn.disabled = locked;
    csvColumnSelect.disabled = locked;
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

loadCsvBtn.addEventListener('click', () => {
    loadCSVData();
});

closePreviewBtn.addEventListener('click', () => {
    csvPreviewContainer.style.display = 'none';
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
    fetchAndParseCSV();
    resizeCanvas();
    render();
})();
