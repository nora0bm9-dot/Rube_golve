// --- Continuous In-Browser Recognition ---
let liveRecognitionBuffer = [];
let lastBrowserPredictTime = 0;

function handleLiveBrowserPrediction(values) {
    if (!recognitionEnabled || connectionMode !== "webserial") return;
    
    liveRecognitionBuffer.push({
        time: performance.now(),
        values
    });
    
    // Keep last 150 readings (~3 seconds)
    if (liveRecognitionBuffer.length > 150) {
        liveRecognitionBuffer.shift();
    }
    
    const now = performance.now();
    // Run prediction every 1000ms if we have enough readings
    if (now - lastBrowserPredictTime > 1000 && liveRecognitionBuffer.length >= TIME_POINTS) {
        lastBrowserPredictTime = now;
        
        // Take the latest ~2 seconds of readings
        const sampleReadings = liveRecognitionBuffer.slice(-80);
        const features360 = resampleTo10Points(sampleReadings);
        
        if (features360 && typeof predictWithBrowserModel === "function") {
            const res = predictWithBrowserModel(features360);
            const pred = res.prediction || "�";
            
            prediction.textContent = pred.replace(/_/g, " ");
            confidence.textContent = ${res.confidence}%;
            confidence-bar.style.width = ${Math.min(100, res.confidence)}%;
            
            if (pred !== "�") {
                translation.textContent = ${translations[pred] || pred} � In-Browser AI (%);
                if (pred !== lastPrediction) {
                    addHistory(pred, res.confidence);
                    if (pred === "HELLO" || res.confidence >= 70) {
                        speakWord(pred);
                    }
                    lastPrediction = pred;
                }
            } else {
                translation.textContent = "Perform a gesture with the sensor glove...";
            }
        }
    }
}
/**
 * Ruby Glove - Frontend Application
 * Supports Web Serial API (Chrome / Edge / Opera) at 115200 baud
 * and fallback/companion to Local Python Flask Backend.
 */

const $ = (id) => document.getElementById(id);

const translations = {
    HELLO: "Hello",
    THANK_YOU: "Thank you",
    YES: "Yes",
    NO: "No",
    PLEASE: "Please",
    OK: "Okay"
};

// ─── Application State ──────────────────────────────────────────────────
let connectionMode = "webserial"; // "webserial" or "backend"
let serialPort = null;
let serialReader = null;
let isSerialReading = false;
let recognitionEnabled = false;
let lastPrediction = "";
let historyItems = [];

// Local backend endpoint
const BACKEND_URL = "http://127.0.0.1:5000";

// Live sensor buffer
const SENSOR_COUNT = 6;
const VALUES_PER_LINE = 36;
let latestSensors = [];
let validReadingsCount = 0;

// Data Collection State
let isCollecting = false;
let collectedSamplesInMemory = []; // for browser CSV export
let collectionWindowReadings = [];
let collectionStartTime = 0;
const CAPTURE_DURATION_MS = 2000;
const TIME_POINTS = 10;

// ─── Waveform Animation ────────────────────────────────────────────────
function animateWaveform(sensors) {
    const waveform = $("waveform");
    if (!waveform) return;
    if (!waveform.children.length) {
        waveform.innerHTML = Array.from({ length: 32 }, () => "<span></span>").join("");
    }

    [...waveform.children].forEach((bar, index) => {
        const sensor = sensors[index % sensors.length];
        if (!sensor) return;
        const values = [sensor.ax, sensor.ay, sensor.az, sensor.gx, sensor.gy, sensor.gz];
        const val = Math.abs(values[index % values.length] || 0);
        bar.style.height = `${8 + Math.min(val * 15, 42)}px`;
    });
}

// ─── Render 6 MPU6050 Sensor Cards ──────────────────────────────────────
function renderSensors(sensors) {
    if (!sensors || sensors.length !== 6) return;
    const grid = $("sensor-grid");
    if (!grid) return;

    grid.innerHTML = sensors.map(s => `
        <div class="sensor-card">
            <div class="sensor-title">
                <span>MPU6050 #${s.id}</span>
                <span>● LIVE</span>
            </div>
            <div class="sensor-values">
                <div class="sensor-value">Ax<b>${Number(s.ax).toFixed(2)}</b></div>
                <div class="sensor-value">Ay<b>${Number(s.ay).toFixed(2)}</b></div>
                <div class="sensor-value">Az<b>${Number(s.az).toFixed(2)}</b></div>
                <div class="sensor-value">Gx<b>${Number(s.gx).toFixed(2)}</b></div>
                <div class="sensor-value">Gy<b>${Number(s.gy).toFixed(2)}</b></div>
                <div class="sensor-value">Gz<b>${Number(s.gz).toFixed(2)}</b></div>
            </div>
        </div>
    `).join("");

    animateWaveform(sensors);
}

// ─── Parse 36 CSV Values ──────────────────────────────────────────────
function parse36Values(line) {
    if (!line) return null;
    const parts = line.trim().split(/[, ]+/);
    if (parts.length !== VALUES_PER_LINE) return null;

    const values = [];
    for (let i = 0; i < VALUES_PER_LINE; i++) {
        const v = parseFloat(parts[i]);
        if (isNaN(v) || !isFinite(v)) return null;
        values.push(v);
    }
    return values;
}

function valuesToSensorCards(values) {
    const cards = [];
    for (let i = 0; i < SENSOR_COUNT; i++) {
        const o = i * 6;
        cards.push({
            id: i + 1,
            ax: values[o],
            ay: values[o + 1],
            az: values[o + 2],
            gx: values[o + 3],
            gy: values[o + 4],
            gz: values[o + 5]
        });
    }
    return cards;
}

// ─── Speech Synthesis ─────────────────────────────────────────────────
function speakWord(word) {
    if (!("speechSynthesis" in window)) {
        $("translation").textContent = "Speech is not supported in this browser.";
        return;
    }
    window.speechSynthesis.cancel();
    const text = translations[word] || word.replace(/_/g, " ");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
}

// ─── History ──────────────────────────────────────────────────────────
function addHistory(word, confidence) {
    if (historyItems.length && historyItems[0].word === word) return;

    historyItems.unshift({
        word,
        confidence: Number(confidence) || 0,
        time: new Date().toLocaleTimeString()
    });
    historyItems = historyItems.slice(0, 8);

    $("history").innerHTML = historyItems.map(item => `
        <div class="history-item">
            <span>${item.word.replace(/_/g, " ")} <small>${item.time}</small></span>
            <span>${item.confidence.toFixed(1)}%</span>
        </div>
    `).join("");
}

// ─── Web Serial API Implementation ────────────────────────────────────
async function connectWebSerial() {
    if (!("serial" in navigator)) {
        alert("Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera.");
        return;
    }

    try {
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 115200 });

        $("app-status").innerHTML = `<span class="pulse"></span> SERIAL CONNECTED`;
        $("app-status").classList.add("connected");
        $("connect-btn").textContent = "🔌 Disconnect ESP32";
        $("serial-chip").textContent = "115200 BAUD · CONNECTED";
        $("signal-legend").textContent = "● SENSOR STREAM ACTIVE";
        $("translation").textContent = "ESP32 connected via Web Serial. Ready!";

        readSerialLoop();
    } catch (err) {
        console.error("Web Serial connection error:", err);
        $("translation").textContent = `Connection cancelled or failed: ${err.message}`;
    }
}

async function disconnectWebSerial() {
    isSerialReading = false;
    if (serialReader) {
        try {
            await serialReader.cancel();
        } catch (e) {}
        serialReader = null;
    }
    if (serialPort) {
        try {
            await serialPort.close();
        } catch (e) {}
        serialPort = null;
    }

    $("app-status").innerHTML = `<span class="pulse"></span> DISCONNECTED`;
    $("app-status").classList.remove("connected");
    $("connect-btn").textContent = "🔌 Connect ESP32";
    $("serial-chip").textContent = "115200 BAUD · 36 VALUES";
    $("signal-legend").textContent = "● AWAITING SERIAL STREAM";
    $("translation").textContent = "ESP32 disconnected.";
}

async function readSerialLoop() {
    isSerialReading = true;
    const decoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    serialReader = reader;

    let buffer = "";

    try {
        while (isSerialReading) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                buffer += value;
                const lines = buffer.split("\n");
                buffer = lines.pop(); // keep remainder

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;
                    const values = parse36Values(line);
                    if (!values) continue; // ignore non-36 diagnostic lines

                    validReadingsCount++;
                    latestSensors = valuesToSensorCards(values);
                    renderSensors(latestSensors);
handleLiveBrowserPrediction(values);

                    // If collection window is active
                    if (isCollecting) {
                        collectionWindowReadings.push({
                            time: performance.now(),
                            values
                        });
                        $("window-readings-count").textContent = `${collectionWindowReadings.length} / 10+`;
                    }
                }
            }
        }
    } catch (err) {
        console.warn("Serial loop ended:", err);
    } finally {
        reader.releaseLock();
    }
}

// ─── Resample Sequence to 10 Time Points (360 features) ────────────────
function resampleTo10Points(readings) {
    if (readings.length < TIME_POINTS) return null;

    const flattened = [];
    for (let i = 0; i < TIME_POINTS; i++) {
        const index = Math.floor((i * readings.length) / TIME_POINTS);
        flattened.push(...readings[index].values);
    }
    return flattened; // Exactly 360 values
}

// ─── Data Collection Handler ──────────────────────────────────────────
async function triggerCollection() {
    const targetLabel = getActiveLabel();
    if (!targetLabel) {
        alert("Please select or enter a valid gesture label.");
        return;
    }

    if (connectionMode === "backend") {
        // Send request to Python backend
        $("collection-feedback").textContent = `Recording ${targetLabel} via Python backend...`;
        $("record-btn").disabled = true;
        try {
            const resp = await fetch(`${BACKEND_URL}/api/collect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: targetLabel })
            });
            const data = await resp.json();
            if (data.success) {
                $("total-samples-count").textContent = data.total_samples;
                $("window-readings-count").textContent = `${data.readings} readings`;
                $("collection-feedback").textContent = `✓ Sample saved to ${data.file}! (${data.total_samples} total)`;
            } else {
                $("collection-feedback").textContent = `Error: ${data.error}`;
            }
        } catch (e) {
            $("collection-feedback").textContent = `Backend error: ${e.message}`;
        } finally {
            $("record-btn").disabled = false;
        }
        return;
    }

    // In Web Serial mode
    if (!serialPort || !isSerialReading) {
        alert("Please connect to the ESP32 first using Web Serial.");
        return;
    }

    if (isCollecting) return;

    isCollecting = true;
    collectionWindowReadings = [];
    collectionStartTime = performance.now();
    $("record-btn").disabled = true;
    $("record-btn").textContent = "⏳ Recording (2s)... Hold steady";
    $("collection-feedback").textContent = `Capturing motion pattern for "${targetLabel}"...`;

    setTimeout(() => {
        isCollecting = false;
        $("record-btn").disabled = false;
        $("record-btn").textContent = "⏺ Record Gesture Sample (2s)";

        const count = collectionWindowReadings.length;
        if (count < TIME_POINTS) {
            $("collection-feedback").textContent = `⚠ Only received ${count} valid readings. Need at least 10. Try again.`;
            return;
        }

        const features360 = resampleTo10Points(collectionWindowReadings);
        if (!features360) {
            $("collection-feedback").textContent = "Failed to resample readings.";
            return;
        }

        collectedSamplesInMemory.push({
            label: targetLabel,
            features: features360
        });

        $("total-samples-count").textContent = collectedSamplesInMemory.length;
        $("collection-feedback").textContent = `✓ Recorded sample #${collectedSamplesInMemory.length} for ${targetLabel}! (${count} readings resampled to 360 features)`;
    }, CAPTURE_DURATION_MS);
}

// ─── Export CSV from In-Browser Collection ──────────────────────────────
function exportCSV() {
    if (!collectedSamplesInMemory.length) {
        alert("No samples recorded in this browser session yet. Record samples first!");
        return;
    }

    const header = Array.from({ length: 360 }, (_, i) => `feature_${String(i + 1).padStart(3, "0")}`);
    header.push("label");

    const rows = [header.join(",")];
    for (const item of collectedSamplesInMemory) {
        const row = [...item.features.map(v => v.toFixed(4)), item.label];
        rows.push(row.join(","));
    }

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gesture_dataset_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function getActiveLabel() {
    const select = $("gesture-select");
    if (select.value === "CUSTOM") {
        return $("custom-label-input").value.trim().toUpperCase() || "CUSTOM";
    }
    return select.value;
}

// ─── Local Backend Integration ────────────────────────────────────────
async function updateBackendStatus() {
    if (connectionMode !== "backend") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/status`);
        if (!res.ok) throw new Error("Status failed");
        const status = await res.json();

        const parts = [
            status.serial_connected ? `${status.port} CONNECTED` : `${status.port} DISCONNECTED`,
            status.model_loaded ? "MODEL LOADED" : "NO MODEL"
        ];
        $("app-status").innerHTML = `<span class="pulse"></span> ${parts.join(" · ")}`;
        $("serial-chip").textContent = `${status.port} · 6 MPU6050`;
        recognitionEnabled = status.recognition_enabled;
        $("start-btn").textContent = recognitionEnabled ? "⏸ Pause recognition" : "▶ Start recognition";

        if (!status.serial_connected) {
            $("translation").textContent = `ESP32 not open on ${status.port}. Click Connect to open.`;
        }
    } catch (e) {
        $("app-status").textContent = "LOCAL BACKEND OFFLINE";
    }
}

async function updateBackendPrediction() {
    if (connectionMode !== "backend" || !recognitionEnabled) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/predict`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.sensors && data.sensors.length === 6) {
            renderSensors(data.sensors);
        }

        const pred = data.prediction || "—";
        $("prediction").textContent = pred.replace(/_/g, " ");
        $("confidence").textContent = `${data.confidence || 0}%`;
        $("confidence-bar").style.width = `${Math.min(100, data.confidence || 0)}%`;

        if (pred !== "—") {
            $("translation").textContent = `${translations[pred] || pred} (Confidence: ${data.confidence}%)`;
            if (pred !== lastPrediction) {
                addHistory(pred, data.confidence || 0);
                if (pred === "HELLO") speakWord(pred);
                lastPrediction = pred;
            }
        }
    } catch (e) {}
}

async function toggleBackendRecognition() {
    if (connectionMode === "backend") {
        try {
            const resp = await fetch(`${BACKEND_URL}/api/control`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: !recognitionEnabled })
            });
            const data = await resp.json();
            recognitionEnabled = data.enabled;
            $("start-btn").textContent = recognitionEnabled ? "⏸ Pause recognition" : "▶ Start recognition";
        } catch (e) {
            alert(`Could not toggle recognition: ${e.message}`);
        }
    } else {
        // Web serial mode: toggle simulated / client classification
        recognitionEnabled = !recognitionEnabled;
        $("start-btn").textContent = recognitionEnabled ? "⏸ Pause recognition" : "▶ Start recognition";
        $("translation").textContent = recognitionEnabled
            ? "Live Web Serial stream active. Recording gesture windows..."
            : "Recognition paused.";
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────
$("connect-btn").addEventListener("click", () => {
    if (connectionMode === "webserial") {
        if (serialPort) {
            disconnectWebSerial();
        } else {
            connectWebSerial();
        }
    } else {
        // Local backend connect
        fetch(`${BACKEND_URL}/api/connect`, { method: "POST" })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    updateBackendStatus();
                } else {
                    alert(`Failed to connect to ${d.port}`);
                }
            })
            .catch(e => alert(`Backend unreachable: ${e.message}`));
    }
});

$("mode-webserial").addEventListener("click", () => {
    connectionMode = "webserial";
    $("mode-webserial").classList.add("active");
    $("mode-backend").classList.remove("active");
    $("connect-btn").textContent = serialPort ? "🔌 Disconnect ESP32" : "🔌 Connect ESP32 (Web Serial)";
});

$("mode-backend").addEventListener("click", () => {
    connectionMode = "backend";
    $("mode-backend").classList.add("active");
    $("mode-webserial").classList.remove("active");
    $("connect-btn").textContent = "🔌 Connect ESP32 (COM4)";
    updateBackendStatus();
});

$("gesture-select").addEventListener("change", (e) => {
    const isCustom = e.target.value === "CUSTOM";
    $("custom-label-input").style.display = isCustom ? "block" : "none";
    $("active-target-label").textContent = getActiveLabel();
});

$("custom-label-input").addEventListener("input", () => {
    $("active-target-label").textContent = getActiveLabel();
});

$("record-btn").addEventListener("click", triggerCollection);
$("export-csv-btn").addEventListener("click", exportCSV);

$("start-btn").addEventListener("click", toggleBackendRecognition);
$("speak-btn").addEventListener("click", () => {
    const word = lastPrediction || getActiveLabel();
    if (word) speakWord(word);
});

$("clear-history").addEventListener("click", () => {
    historyItems = [];
    $("history").innerHTML = '<p class="empty-state">Your predictions will appear here.</p>';
});

// Shortcut: press space to trigger collection if focused on page
window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        triggerCollection();
    }
});

// Periodic polling for backend mode
setInterval(updateBackendStatus, 3000);
setInterval(updateBackendPrediction, 500);

// Init
$("active-target-label").textContent = getActiveLabel();

