const MASTER_PASSWORD = "1234"; // Default password for deletion

function requirePassword(actionName) {
  const pwd = prompt(`Password is required to ${actionName}.\nEnter password:`);
  if (pwd === MASTER_PASSWORD) {
    return true;
  }
  if (pwd !== null) {
    alert("Incorrect password! Action denied.");
  }
  return false;
}

/* PDF BACKUP INDEXED DB */
const pdfDbName = "PdfBackupDB";
let pdfDb;
const initPdfDB = new Promise((resolve, reject) => {
  const request = indexedDB.open(pdfDbName, 1);
  request.onupgradeneeded = (e) => {
    pdfDb = e.target.result;
    if (!pdfDb.objectStoreNames.contains('pdfs')) {
      pdfDb.createObjectStore('pdfs', { keyPath: 'id', autoIncrement: true });
    }
  };
  request.onsuccess = (e) => { pdfDb = e.target.result; resolve(pdfDb); };
  request.onerror = (e) => reject(e);
});

async function savePdfToBackup(pdfObj) {
  await initPdfDB;
  return new Promise((resolve, reject) => {
    const tx = pdfDb.transaction('pdfs', 'readwrite');
    const store = tx.objectStore('pdfs');
    store.add(pdfObj);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

async function getPdfsDB() {
  await initPdfDB;
  return new Promise((resolve, reject) => {
    const tx = pdfDb.transaction('pdfs', 'readonly');
    const store = tx.objectStore('pdfs');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

async function openPdfGallery(query = '') {
  document.getElementById('pdf-gallery-modal').style.display = 'flex';
  const content = document.getElementById('pdf-gallery-content');
  content.innerHTML = '<p style="text-align:center;">Loading PDF backups...</p>';
  try {
    let pdfs = await getPdfsDB();
    if (query) {
      pdfs = pdfs.filter(p => (p.patientName || '').toLowerCase().includes(query) || (p.fileName || '').toLowerCase().includes(query));
    }
    if (pdfs.length === 0) {
      content.innerHTML = '<p style="text-align:center; margin-top:40px; color:#666; font-size:16px;">No PDFs found.</p>';
      return;
    }

    const groups = {};
    pdfs.forEach(p => {
      const dateStr = p.date || "Unknown Date";
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(p);
    });

    let html = '';
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(date => {
      html += `<div style="background:#fff; border-radius:8px; margin-bottom:15px; box-shadow:0 2px 8px rgba(0,0,0,0.1); overflow:hidden;">
        <div style="background:#b0bec5; padding:12px; font-weight:bold; font-size:15px; cursor:pointer; color:#000;" onclick="togglePdfFolder('${date}')">
          &#128193; ${date} (${groups[date].length} PDFs)
        </div>
        <div id="pdf-folder-${date}" style="display:${query ? 'flex' : 'none'}; padding:15px; gap:15px; flex-wrap:wrap; justify-content:center;">`;

      groups[date].forEach(p => {
        html += `<div style="width:100%; max-width:200px; background:#fafafa; border:1px solid #ccc; border-radius:6px; padding:10px; text-align:center; display:flex; flex-direction:column; justify-content:space-between;">
          <div style="font-size:36px; margin-bottom:10px;">📄</div>
          <div style="font-size:12px; margin-top:8px; word-wrap:break-word; color:#333; text-align:left;"><b>${p.patientName}</b><br/><span style="color:#666;">${p.fileName}</span></div>
          <div style="display:flex; gap:5px; margin-top:10px;">
            <button onclick="downloadBackupPdf(${p.id})" style="flex:1; background:#0288d1; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;">⬇️ Download</button>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = '<p style="text-align:center; color:red;">Error loading PDF backups.</p>';
  }
}

function togglePdfFolder(date) {
  const el = document.getElementById('pdf-folder-' + date);
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

function closePdfGallery() {
  document.getElementById('pdf-gallery-modal').style.display = 'none';
}

async function downloadBackupPdf(id) {
  const pdfs = await getPdfsDB();
  const pdf = pdfs.find(p => p.id === id);
  if (!pdf) return;

  const a = document.createElement('a');
  a.href = pdf.dataUrl;
  a.download = pdf.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// --- EXPORT & IMPORT FULL BACKUP ---

async function exportAllData() {
  const btn = window.event ? window.event.currentTarget : null;
  if (btn && btn.innerText) btn.innerText = "Exporting...";
  try {
    const backup = {
      timestamp: Date.now(),
      localStorage: {
        audit_history: localStorage.getItem('audit_history'),
        audit_v4: localStorage.getItem('audit_v4')
      },
      photos: [],
      pdfs: []
    };

    // Get Photos
    if (typeof getPhotosDB === 'function') {
      backup.photos = await getPhotosDB();
    }

    // Get PDFs
    backup.pdfs = await getPdfsDB();

    const dataStr = JSON.stringify(backup);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `Ayushman_Full_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Backup Exported Successfully! Keep this file safe.');
  } catch (e) {
    alert('Export Error: ' + e.message);
  } finally {
    if (btn && btn.innerHTML) btn.innerHTML = "&#128190; Export Backup";
  }
}

async function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!requirePassword("import and overwrite ALL current data with this backup file")) {
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // 1. Restore localStorage
      if (data.localStorage) {
        if (data.localStorage.audit_history) localStorage.setItem('audit_history', data.localStorage.audit_history);
        if (data.localStorage.audit_v4) localStorage.setItem('audit_v4', data.localStorage.audit_v4);
      }

      // 2. Restore Photos safely
      if (data.photos && data.photos.length > 0) {
        const photoDbReq = indexedDB.open("AuditPhotosDB", 1);
        await new Promise((resolve, reject) => {
          photoDbReq.onsuccess = (ev) => {
            const pDb = ev.target.result;
            if (pDb.objectStoreNames.contains('photos')) {
              const tx = pDb.transaction('photos', 'readwrite');
              const store = tx.objectStore('photos');
              store.clear();
              data.photos.forEach(p => store.put(p));
              tx.oncomplete = resolve;
              tx.onerror = reject;
            } else { resolve(); }
          };
          photoDbReq.onerror = reject;
        });
      }

      // 3. Restore PDFs safely
      if (data.pdfs && data.pdfs.length > 0) {
        await initPdfDB;
        await new Promise((resolve, reject) => {
          const tx = pdfDb.transaction('pdfs', 'readwrite');
          const store = tx.objectStore('pdfs');
          store.clear();
          data.pdfs.forEach(p => store.put(p));
          tx.oncomplete = resolve;
          tx.onerror = reject;
        });
      }

      alert("Data Imported Successfully! The app will now reload.");
      window.location.reload();

    } catch (err) {
      alert("Invalid backup file or error during import: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = ""; // Reset input
}
