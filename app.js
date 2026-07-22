/* app.js */
const wsUrl = "wss://apm.sket.site/ws";
const apiUrl = "https://apm.sket.site/api/dataset";
let socket;
let reconnectInterval = 3000;

// Inisialisasi awal saat halaman dimuat
document.addEventListener("DOMContentLoaded", () => {
    connectWebSocket();
    fetchDatabaseTable();
    setInterval(fetchDatabaseTable, 5000); // Polling tabel database setiap 5 detik
});

// 1. WebSocket Connection Manager
function connectWebSocket() {
    const ind = document.getElementById("connection-indicator");
    const text = document.getElementById("conn-text");

    socket = new WebSocket(wsUrl);

    socket.onopen = function () {
        ind.className = "conn-status connected";
        text.innerText = "Online";
        addLogEntry("SYSTEM", "Koneksi ke FastAPI Server berhasil terhubung.", "masuk");
    };

    socket.onmessage = function (event) {
        const payload = JSON.parse(event.data);

        // Tangani inisialisasi awal
        if (payload.type === "init") {
            if (payload.last_data) {
                updateSensorMetrics(payload.last_data);
                if (payload.last_data.pir_values) {
                    updateSeatClasses(payload.last_data.pir_values);
                }
            }
        }

        // Tangani pembaruan data sensor asinkron
        if (payload.type === "sensor_update") {
            updateSensorMetrics(payload.data);
            if (payload.data.pir_values) {
                updateSeatClasses(payload.data.pir_values);
                logSensorChanges(payload.data.pir_values);
            }
        }
    };

    socket.onclose = function () {
        ind.className = "conn-status disconnected";
        text.innerText = "Offline";
        addLogEntry("SYSTEM", "Koneksi terputus. Mencoba menghubungkan kembali dalam 3 detik...", "gelisah");
        setTimeout(connectWebSocket, reconnectInterval);
    };

    socket.onerror = function (err) {
        console.error("WebSocket Error: ", err);
        socket.close();
    };
}

// Helper untuk menentukan state kursi berdasarkan persentase gerakan PIR
function getMotionState(pirValue) {
    const val = (pirValue !== undefined && pirValue !== null) ? pirValue : 0;
    if (val <= 5) {
        return { state: 0, text: `Tidak Aktif (${Math.round(val)}%)`, label: "TIDAK_AKTIF" };
    } else if (val <= 40) {
        return { state: 1, text: `Gerak Rendah (${Math.round(val)}%)`, label: "GERAK_RENDAH" };
    } else {
        return { state: 2, text: `Gerak Tinggi (${Math.round(val)}%)`, label: "GERAK_TINGGI" };
    }
}

// 2. Update Environment Metrics di Layar
function updateSensorMetrics(data) {
    if (data.suhu !== undefined && data.suhu !== null) {
        document.getElementById("env-temp").innerText = data.suhu.toFixed(1) + " °C";
    }
    if (data.kelembapan !== undefined && data.kelembapan !== null) {
        document.getElementById("env-humidity").innerText = data.kelembapan.toFixed(1) + " %";
    }
    if (data.cahaya_lux !== undefined && data.cahaya_lux !== null) {
        document.getElementById("env-lux").innerText = Math.round(data.cahaya_lux) + " Lux";
    }
}

// 3. Update Visual Kursi Kelas
function updateSeatClasses(pirValues) {
    for (let i = 1; i <= 6; i++) {
        const val = pirValues[`pir_${i}`];
        // Jika data PIR kursi tertentu tidak ada dalam payload (misal hanya data env), abaikan
        if (val === undefined || val === null) {
            continue;
        }
        const desk = document.getElementById(`desk-${i}`);
        const status = document.getElementById(`status-${i}`);
        const stateInfo = getMotionState(val);

        desk.className = `desk state-${stateInfo.state}`;
        status.innerText = stateInfo.text;
    }
}

// 4. Log Perubahan Gerakan ke Panel Log Aktif
let lastStates = {};
function logSensorChanges(pirValues) {
    for (let i = 1; i <= 6; i++) {
        const val = pirValues[`pir_${i}`];
        // Jika data PIR kursi tertentu tidak ada dalam payload, abaikan
        if (val === undefined || val === null) {
            continue;
        }
        const stateInfo = getMotionState(val);
        const last = lastStates[`kursi_${i}`];

        if (stateInfo.label !== last) {
            if (stateInfo.label === "GERAK_TINGGI") {
                addLogEntry(`KURSI ${i}`, `Gerakan aktif terdeteksi! (${Math.round(val)}%)`, "gelisah");
            } else if (stateInfo.label === "GERAK_RENDAH") {
                addLogEntry(`KURSI ${i}`, `Gerakan rendah terdeteksi. (${Math.round(val)}%)`, "tenang");
            } else if (stateInfo.label === "TIDAK_AKTIF" && last !== undefined) {
                addLogEntry(`KURSI ${i}`, `Tidak ada aktivitas gerak. (${Math.round(val)}%)`, "masuk");
            }
            lastStates[`kursi_${i}`] = stateInfo.label;
        }
    }
}

// 5. Tambah Item Log ke Feed Box
function addLogEntry(source, message, typeClass) {
    const feed = document.getElementById("log-feed");
    if (!feed) return;

    const time = new Date().toLocaleTimeString('id-ID');

    const item = document.createElement("div");
    item.className = `log-item ${typeClass}`;
    item.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span><strong>${source}:</strong> ${message}</span>
    `;

    feed.appendChild(item);
    feed.scrollTop = feed.scrollHeight; // Auto scroll ke paling bawah

    // Batasi jumlah log yang tampil
    while (feed.children.length > 50) {
        feed.removeChild(feed.firstChild);
    }
}

// Fungsi membersihkan panel log (dipanggil dari onclick tombol Clear)
function clearLogs() {
    const feed = document.getElementById("log-feed");
    if (feed) {
        feed.innerHTML = "";
    }
}

// 6. Polling Data 10 Rekaman Terakhir dari Database MongoDB
function fetchDatabaseTable() {
    fetch(`${apiUrl}?page=1&limit=10`)
        .then(res => res.json())
        .then(resData => {
            const tbody = document.getElementById("db-table-body");
            if (!tbody) return;

            tbody.innerHTML = "";

            if (!resData.data || resData.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted);">Belum ada data sensor masuk.</td></tr>`;
                return;
            }

            resData.data.forEach(row => {
                const tr = document.createElement("tr");

                // Parse timestamp
                let timeStr = "--:--:--";
                if (row.timestamp) {
                    const dateObj = new Date(row.timestamp);
                    timeStr = dateObj.toLocaleTimeString('id-ID') + " (" + dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) + ")";
                }

                // Buat badge PIR
                let pirCells = "";
                for (let i = 1; i <= 6; i++) {
                    const val = row[`pir_${i}`];
                    if (val === undefined || val === null) {
                        pirCells += `<td><span class="badge-inline k">-</span></td>`;
                    } else {
                        const labelClass = val > 40 ? 'g' : (val > 5 ? 't' : 'k');
                        pirCells += `<td><span class="badge-inline ${labelClass}">${Math.round(val)}%</span></td>`;
                    }
                }

                tr.innerHTML = `
                    <td style="font-family:'JetBrains Mono', monospace; font-weight:500;">${timeStr}</td>
                    <td>${row.suhu !== undefined && row.suhu !== null ? row.suhu.toFixed(1) + " °C" : "-"}</td>
                    <td>${row.kelembapan !== undefined && row.kelembapan !== null ? row.kelembapan.toFixed(1) + " %" : "-"}</td>
                    <td>${row.cahaya_lux !== undefined && row.cahaya_lux !== null ? Math.round(row.cahaya_lux) + " Lx" : "-"}</td>
                    ${pirCells}
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            console.log("Gagal memuat data tabel dari API");
        });
}

// 7. Unduh Ekspor CSV
function exportCSV() {
    window.open(`${apiUrl}/export`, '_blank');
}
