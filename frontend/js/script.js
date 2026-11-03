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
        
        if (features360) {
            const res = predictFromTrainingSamples(features360);
            const pred = res.prediction || "—";
            
            prediction.textContent = pred.replace(/_/g, " ");
            confidence.textContent = `${res.confidence}%`;
            $("confidence-bar").style.width = `${Math.min(100, res.confidence)}%`;
            
            if (pred !== "—") {
                translation.textContent = `${translations[pred] || pred} · In-Browser AI (${res.confidence}%)`;
                if (pred !== lastPrediction) {
                    addHistory(pred, res.confidence);
                    lastPrediction = pred;
                }
                maybeSpeakPrediction(pred, res.confidence);
            } else {
                translation.textContent = "Perform a gesture with the sensor glove...";
                lastPrediction = "";
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

// â”€â”€â”€ Application State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let connectionMode = "webserial"; // "webserial" or "backend"
let serialPort = null;
let serialReader = null;
let isSerialReading = false;
let recognitionEnabled = false;
let lastPrediction = "";
let lastAutoSpokenAt = 0;
let historyItems = [];
let referenceSamples = [];
let batchLabel = "";
let batchRemaining = 0;
let batchTotal = 0;
let isCollecting = false;
let batchInProgress = false;

// Local backend endpoint
const BACKEND_URL = "http://127.0.0.1:5000";

// Live sensor buffer
const SENSOR_COUNT = 6;
const VALUES_PER_LINE = 36;
let latestSensors = [];
let validReadingsCount = 0;

// Data Collection State
let collectedSamplesInMemory = [];
const COLLECTION_STORAGE_KEY = "ruby-glove-collected-samples-v2";
const LEGACY_COLLECTION_STORAGE_KEY = "ruby-glove-collected-samples";
let collectionWindowReadings = [];
let collectionStartTime = 0;
const CAPTURE_DURATION_MS = 2000;
const TIME_POINTS = 10;
const AUTO_SPEECH_INTERVAL_MS = 3000;

// â”€â”€â”€ Waveform Animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Render 6 MPU6050 Sensor Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderSensors(sensors) {
    if (!sensors || sensors.length !== 6) return;
    const grid = $("sensor-grid");
    if (!grid) return;

    const offlineSensors = [];
    grid.innerHTML = sensors.map(s => {
        const values = [s.ax, s.ay, s.az, s.gx, s.gy, s.gz].map(Number);
        const isOffline = values.every(value => Number.isFinite(value) && Math.abs(value) < 0.0005);
        if (isOffline) offlineSensors.push(s.id);
        const displayValue = value => isOffline ? "--" : Number(value).toFixed(2);
        return `
        <div class="sensor-card${isOffline ? " sensor-offline" : ""}">
            <div class="sensor-title">
                <span>MPU6050 #${s.id}</span>
                <span class="sensor-state">${isOffline ? "NO DATA" : "LIVE"}</span>
            </div>
            <div class="sensor-values">
                <div class="sensor-value">Ax<b>${displayValue(s.ax)}</b></div>
                <div class="sensor-value">Ay<b>${displayValue(s.ay)}</b></div>
                <div class="sensor-value">Az<b>${displayValue(s.az)}</b></div>
                <div class="sensor-value">Gx<b>${displayValue(s.gx)}</b></div>
                <div class="sensor-value">Gy<b>${displayValue(s.gy)}</b></div>
                <div class="sensor-value">Gz<b>${displayValue(s.gz)}</b></div>
            </div>
        </div>
    `;
    }).join("");

    const health = $("sensor-health");
    if (health) {
        health.hidden = offlineSensors.length === 0;
        health.textContent = offlineSensors.length
            ? `No sensor readings from MPU6050 #${offlineSensors.join(", #")}. Check sensor power, I2C wiring, and PCA9548A channel connections.`
            : "";
    }

    animateWaveform(sensors);
}

// â”€â”€â”€ Parse 36 CSV Values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Speech Synthesis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

function predictFromTrainingSamples(features) {
    const samples = [...referenceSamples, ...collectedSamplesInMemory];
    if (!samples.length || features.length !== 360) {
        return { prediction: "—", confidence: 0 };
    }

    const nearest = samples
        .map(sample => {
            let squaredDistance = 0;
            for (let index = 0; index < features.length; index++) {
                const delta = features[index] - sample.features[index];
                squaredDistance += delta * delta;
            }
            return { label: sample.label, distance: Math.sqrt(squaredDistance / features.length) };
        })
        .sort((left, right) => left.distance - right.distance)
        .slice(0, Math.min(5, samples.length));

    const weights = new Map();
    let totalWeight = 0;
    for (const neighbor of nearest) {
        const weight = 1 / Math.max(neighbor.distance, 0.0001);
        weights.set(neighbor.label, (weights.get(neighbor.label) || 0) + weight);
        totalWeight += weight;
    }

    const [prediction, winningWeight] = [...weights.entries()]
        .sort((left, right) => right[1] - left[1])[0];
    const confidence = Math.round((winningWeight / totalWeight) * 100);
    return {
        prediction: confidence >= 40 ? prediction : "—",
        confidence
    };
}

function maybeSpeakPrediction(word, confidence) {
    if (Number(confidence) < 70) return;
    const now = Date.now();
    if (now - lastAutoSpokenAt < AUTO_SPEECH_INTERVAL_MS) return;
    speakWord(word);
    lastAutoSpokenAt = now;
}

// â”€â”€â”€ History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Web Serial API Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        $("connect-btn").textContent = "ðŸ”Œ Disconnect ESP32";
        $("serial-chip").textContent = "115200 BAUD Â· CONNECTED";
        $("signal-legend").textContent = "â— SENSOR STREAM ACTIVE";
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
    $("connect-btn").textContent = "ðŸ”Œ Connect ESP32";
    $("serial-chip").textContent = "115200 BAUD Â· 36 VALUES";
    $("signal-legend").textContent = "â— AWAITING SERIAL STREAM";
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

// â”€â”€â”€ Resample Sequence to 10 Time Points (360 features) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function resampleTo10Points(readings) {
    if (readings.length < TIME_POINTS) return null;

    const flattened = [];
    for (let i = 0; i < TIME_POINTS; i++) {
        const index = Math.floor((i * readings.length) / TIME_POINTS);
        flattened.push(...readings[index].values);
    }
    return flattened; // Exactly 360 values
}

// â”€â”€â”€ Data Collection Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerCollection() {
    if (isCollecting) return;
    if (!batchInProgress) {
        batchLabel = getActiveLabel();
        const requestedSamples = Number.parseInt($("sample-count-input").value, 10);
        if (!batchLabel || !Number.isInteger(requestedSamples) || requestedSamples < 1 || requestedSamples > 500) {
            $("collection-feedback").textContent = "Enter a label and a batch size between 1 and 500.";
            return;
        }
        batchRemaining = requestedSamples;
        batchTotal = requestedSamples;
        batchInProgress = true;
    }

    if (connectionMode === "backend") {
        $("collection-feedback").textContent = `Recording ${batchLabel} sample ${batchTotal - batchRemaining + 1}/${batchTotal}...`;
        $("record-btn").disabled = true;
        try {
            const resp = await fetch(`${BACKEND_URL}/api/collect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: batchLabel })
            });
            const data = await resp.json();
            if (data.success) {
                $("total-samples-count").textContent = data.total_samples;
                $("window-readings-count").textContent = `${data.readings} readings`;
                completeBatchSample(`Sample saved to ${data.file} (${data.total_samples} total).`);
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

    isCollecting = true;
    collectionWindowReadings = [];
    collectionStartTime = performance.now();
    $("record-btn").disabled = true;
    $("record-btn").textContent = "â³ Recording (2s)... Hold steady";
    $("collection-feedback").textContent =
        `Capturing "${batchLabel}" sample ${batchTotal - batchRemaining + 1}/${batchTotal}. Hold the gesture steady...`;

    setTimeout(() => {
        isCollecting = false;
        $("record-btn").disabled = false;
        $("record-btn").textContent = "âº Record Gesture Sample (2s)";

        const count = collectionWindowReadings.length;
        if (count < TIME_POINTS) {
            $("record-btn").textContent = "⏺ Retry this sample";
            $("collection-feedback").textContent =
                `Only received ${count} valid readings. Press Enter or click to retry this sample.`;
            return;
        }

        const features360 = resampleTo10Points(collectionWindowReadings);
        if (!features360) {
            $("record-btn").textContent = "⏺ Retry this sample";
            $("collection-feedback").textContent = "Failed to resample readings.";
            return;
        }

        const sample = {
            label: batchLabel,
            features: features360
        };
        collectedSamplesInMemory.push(sample);

        updateGestureOptions();
        const saved = persistCollectedSamples();
        completeBatchSample(
            saved
                ? `Saved sample in this browser (${count} readings).`
                : `Sample is only available until this tab closes (${count} readings); export the CSV now.`
        );
    }, CAPTURE_DURATION_MS);
}

function persistCollectedSamples() {
    try {
        localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(collectedSamplesInMemory));
        return true;
    } catch (error) {
        console.error("Could not persist collected samples in browser storage:", error);
        return false;
    }
}

function completeBatchSample(message) {
    batchRemaining -= 1;
    $("record-btn").disabled = false;
    if (batchRemaining === 0) {
        batchInProgress = false;
        $("record-btn").textContent = "⏺ Start another batch";
        $("collection-feedback").textContent =
            `${message} Finished all ${batchTotal} ${batchLabel} samples.`;
        return;
    }

    $("record-btn").textContent = `⏺ Record next sample (${batchRemaining} left)`;
    $("collection-feedback").textContent =
        `${message} Press Enter or click the button to record ${batchLabel} sample ${batchTotal - batchRemaining + 1}/${batchTotal}.`;
}

function updateGestureOptions() {
    const select = $("gesture-select");
    const customOption = select.querySelector('option[value="CUSTOM"]');
    const labels = new Set([
        ...referenceSamples.map(sample => sample.label),
        ...collectedSamplesInMemory.map(sample => sample.label)
    ]);

    for (const label of labels) {
        if (select.querySelector(`option[value="${label}"]`)) continue;
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label.replace(/_/g, " ");
        select.insertBefore(option, customOption);
    }

    $("total-samples-count").textContent = referenceSamples.length + collectedSamplesInMemory.length;
}

async function loadHelloTrainingSamples() {
    try {
        let response = await fetch("data/HELLO.csv");
        if (!response.ok) {
            response = await fetch("../data/HELLO.csv");
        }
        if (!response.ok) throw new Error(`HELLO dataset request failed (${response.status}).`);
        const csv = await response.text();
        referenceSamples = csv.split(/\r?\n/).flatMap(line => {
            const row = line.trim().split(",");
            if (row.length !== 361 || row[360].trim().toUpperCase() !== "HELLO") return [];
            const features = row.slice(0, 360).map(Number);
            return features.every(Number.isFinite) ? [{ label: "HELLO", features }] : [];
        });
        updateGestureOptions();
        $("collection-feedback").textContent =
            `Loaded ${referenceSamples.length} retained HELLO samples. New samples are stored and learned in this browser only.`;
    } catch (error) {
        console.error("Could not load retained HELLO samples:", error);
        $("collection-feedback").textContent =
            "HELLO reference data could not be loaded. Open the published GitHub Pages link or a local web server.";
    }
}

// â”€â”€â”€ Export CSV from In-Browser Collection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    URL.revokeObjectURL(url);
}

function getActiveLabel() {
    const select = $("gesture-select");
    if (select.value === "CUSTOM") {
        const label = $("custom-label-input").value.trim().toUpperCase();
        return /^[A-Z0-9][A-Z0-9_-]*$/.test(label) ? label : "";
    }
    return select.value;
}

// â”€â”€â”€ Local Backend Integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        $("app-status").innerHTML = `<span class="pulse"></span> ${parts.join(" Â· ")}`;
        $("serial-chip").textContent = `${status.port} Â· 6 MPU6050`;
        recognitionEnabled = status.recognition_enabled;
        $("start-btn").textContent = recognitionEnabled ? "â¸ Pause recognition" : "â–¶ Start recognition";

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

        const pred = data.prediction || "â€”";
        $("prediction").textContent = pred.replace(/_/g, " ");
        $("confidence").textContent = `${data.confidence || 0}%`;
        $("confidence-bar").style.width = `${Math.min(100, data.confidence || 0)}%`;

        if (pred !== "â€”") {
            $("translation").textContent = `${translations[pred] || pred} (Confidence: ${data.confidence}%)`;
            if (pred !== lastPrediction) {
                addHistory(pred, data.confidence || 0);
                lastPrediction = pred;
            }
            maybeSpeakPrediction(pred, data.confidence);
        } else {
            lastPrediction = "";
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
            $("start-btn").textContent = recognitionEnabled ? "â¸ Pause recognition" : "â–¶ Start recognition";
        } catch (e) {
            alert(`Could not toggle recognition: ${e.message}`);
        }
    } else {
        // Web serial mode: toggle simulated / client classification
        recognitionEnabled = !recognitionEnabled;
        $("start-btn").textContent = recognitionEnabled ? "â¸ Pause recognition" : "â–¶ Start recognition";
        $("translation").textContent = recognitionEnabled
            ? "Live Web Serial stream active. Recording gesture windows..."
            : "Recognition paused.";
    }
}

// â”€â”€â”€ Event Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    $("connect-btn").textContent = serialPort ? "ðŸ”Œ Disconnect ESP32" : "ðŸ”Œ Connect ESP32 (Web Serial)";
});

$("mode-backend").addEventListener("click", () => {
    connectionMode = "backend";
    $("mode-backend").classList.add("active");
    $("mode-webserial").classList.remove("active");
    $("connect-btn").textContent = "ðŸ”Œ Connect ESP32 (COM4)";
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

$("sample-count-input").addEventListener("input", () => {
    if (!batchInProgress) {
        $("record-btn").textContent = `⏺ Start ${$("sample-count-input").value}-sample batch`;
    }
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
    if (e.code === "Enter" && e.target === document.body && batchInProgress && !isCollecting) {
        e.preventDefault();
        triggerCollection();
        return;
    }
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
try {
    const storedSamples = localStorage.getItem(COLLECTION_STORAGE_KEY);
    if (storedSamples) {
        const parsedSamples = JSON.parse(storedSamples);
        if (!Array.isArray(parsedSamples)) {
            throw new Error("Stored samples are not a list.");
        }
        collectedSamplesInMemory = parsedSamples.filter(sample =>
            sample &&
            typeof sample.label === "string" &&
            /^[A-Z0-9][A-Z0-9_-]*$/.test(sample.label.toUpperCase()) &&
            Array.isArray(sample.features) &&
            sample.features.length === 360 &&
            sample.features.every(Number.isFinite)
        ).map(sample => ({ ...sample, label: sample.label.toUpperCase() }));
    } else {
        const legacySamples = localStorage.getItem(LEGACY_COLLECTION_STORAGE_KEY);
        if (legacySamples) {
            const parsedSamples = JSON.parse(legacySamples);
            if (!Array.isArray(parsedSamples)) {
                throw new Error("Legacy browser samples are not a list.");
            }
            collectedSamplesInMemory = parsedSamples.filter(sample =>
                sample &&
                typeof sample.label === "string" &&
                sample.label.toUpperCase() === "HELLO" &&
                Array.isArray(sample.features) &&
                sample.features.length === 360 &&
                sample.features.every(Number.isFinite)
            );
            localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(collectedSamplesInMemory));
        }
    }
    localStorage.removeItem(LEGACY_COLLECTION_STORAGE_KEY);
} catch (error) {
    console.error("Could not load saved browser samples:", error);
    $("collection-feedback").textContent =
        "Saved browser samples could not be loaded. Check browser storage or export a backup.";
}
updateGestureOptions();
loadHelloTrainingSamples();
