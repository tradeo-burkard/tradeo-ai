// --- KONFIGURATION ---
const API_VERSION = "v1beta";
const POLL_INTERVAL_MS = 2000; // Alle 2 Sekunden prüfen
const DASHBOARD_FOLDERS_TO_SCAN = [
    "https://desk.tradeo.de/mailbox/3/27",  // Servershop24 -> Nicht zugewiesen
    "https://desk.tradeo.de/mailbox/3/155"  // Servershop24 -> Meine
];

// SYSTEM PROMPT
const SYSTEM_PROMPT = `
Du bist ein erfahrener Support-Mitarbeiter der Firma "Tradeo / Servershop24".
Wir verkaufen Serverhardware, RAM und Storage.

VORGABEN:
1. Tonalität: Professionell, freundlich, direkt. Wir Siezen.
2. Preis: Webshop-Preise sind fix. Rabatte erst bei großen Mengen.
3. Fehler: Ehrlich zugeben.
4. Signatur: Weglassen (macht das System).

WICHTIG:
Antworte IMMER im validen JSON-Format.
Struktur:
{
  "draft": "Der Text für die E-Mail (HTML erlaubt)",
  "feedback": "Kurze Info an den Agent (z.B. 'Habe Rabatt abgelehnt')"
}
`;

// Model Definitionen
const AI_MODELS = {
    "gemini-2.5-flash-lite": { id: "gemini-2.5-flash-lite", label: "2.5 Flash Lite", dropdownText: "gemini-2.5-flash-lite (sehr schnell)" },
    "gemini-2.5-flash": { id: "gemini-2.5-flash", label: "2.5 Flash", dropdownText: "gemini-2.5-flash (schnell)" },
    "gemini-3-pro-preview": { id: "gemini-3-pro-preview", label: "3 Pro", dropdownText: "gemini-3-pro-preview (langsam)" }
};

// --- GLOBAL STATE ---
window.aiState = {
    lastDraft: "",     
    isRealMode: false,
    isGenerating: false,
    preventOverwrite: false,
    chatHistory: [],
    currentModel: "gemini-2.5-flash",
    // Cache management V3
    knownTickets: new Map(), // Map<TicketID, ContentHash>
    processingQueue: new Set() // Set<TicketID>
};

// --- CORE LOOPS (HEARTBEAT) ---

function startHeartbeat() {
    console.log("Tradeo AI: Heartbeat gestartet.");
    setInterval(() => {
        const pageType = detectPageType();
        
        if (pageType === 'ticket') {
            // Wir sind im Ticket -> UI Rendern falls noch nicht da
            if (!document.getElementById('tradeo-ai-copilot-zone')) initConversationUI();
        } 
        else if (pageType === 'inbox') {
            // Wir sind in einer Liste -> Scannen
            scanInboxTable();
        } 
        else if (pageType === 'dashboard') {
            // Wir sind auf dem Dashboard -> Hintergrund-Scan
            scanDashboardFolders();
        }
    }, POLL_INTERVAL_MS);
}

function detectPageType() {
    if (document.getElementById('conv-layout-main')) return 'ticket';
    if (document.querySelector('.table-conversations')) return 'inbox';
    if (document.querySelector('.dash-cards')) return 'dashboard';
    return 'unknown';
}

// --- LOGIC: INBOX SCANNER ---

function scanInboxTable() {
    const rows = Array.from(document.querySelectorAll('tr.conv-row[data-conversation_id]'));
    
    rows.forEach(row => {
        const id = row.getAttribute('data-conversation_id');
        const previewEl = row.querySelector('.conv-preview');
        const previewText = previewEl ? previewEl.innerText.trim() : "no-preview";
        
        // Hash erstellen um Änderungen zu erkennen
        const currentHash = `${id}_${previewText.substring(0, 50)}_${previewText.length}`;
        checkAndQueue(id, currentHash);
    });
}

// --- LOGIC: DASHBOARD SPIDER ---

async function scanDashboardFolders() {
    for (const url of DASHBOARD_FOLDERS_TO_SCAN) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            
            const rows = Array.from(doc.querySelectorAll('tr.conv-row[data-conversation_id]'));
            
            rows.forEach(row => {
                const id = row.getAttribute('data-conversation_id');
                const previewEl = row.querySelector('.conv-preview');
                const previewText = previewEl ? previewEl.innerText.trim() : "no-preview";
                const currentHash = `${id}_${previewText.substring(0, 50)}_${previewText.length}`;
                
                checkAndQueue(id, currentHash);
            });
        } catch (e) {
            console.warn(`Tradeo AI: Konnte Dashboard-Ordner nicht scannen (${url}):`, e);
        }
    }
}

// --- LOGIC: QUEUE MANAGEMENT ---

function checkAndQueue(id, currentHash) {
    if (window.aiState.processingQueue.has(id)) return; // Wird bereits verarbeitet
    
    // Prüfen ob Hash gleich ist (Cache hit im RAM)
    if (window.aiState.knownTickets.get(id) === currentHash) return;

    // Neu oder verändert
    // console.log(`Tradeo AI: Ticket ${id} queueing...`);
    window.aiState.processingQueue.add(id);
    
    processTicket(id, currentHash).then(() => {
        window.aiState.processingQueue.delete(id);
        window.aiState.knownTickets.set(id, currentHash);
    });
}

async function processTicket(id, contentHash) {
    try {
        // Cache Check im Storage (Persistent)
        const storageKey = `draft_${id}`;
        const storedData = await chrome.storage.local.get([storageKey]);
        
        if (storedData[storageKey] && storedData[storageKey].contentHash === contentHash) {
            return; // Nichts zu tun, Daten im Storage sind aktuell
        }

        console.log(`Tradeo AI: ⚡ Verarbeite Ticket ${id} im Hintergrund...`);

        // Fetch
        const response = await fetch(`https://desk.tradeo.de/conversation/${id}`);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const contextText = extractContextFromDOM(doc);

        if (!contextText || contextText.length < 50) return;

        // Generate
        const aiResult = await generateDraftHeadless(contextText);

        if (aiResult) {
            const data = {};
            data[storageKey] = {
                draft: aiResult.draft,
                feedback: aiResult.feedback,
                timestamp: Date.now(),
                contentHash: contentHash
            };
            await chrome.storage.local.set(data);
            console.log(`Tradeo AI: ✅ Draft für Ticket ${id} gespeichert.`);
        }

        // Throttle
        await new Promise(r => setTimeout(r, 1000));

    } catch (e) {
        console.error(`Fehler bei Ticket ${id}:`, e);
    }
}

// --- API FUNCTIONS ---

async function generateDraftHeadless(contextText) {
    const stored = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = stored.geminiApiKey;
    if (!apiKey) return null;

    const finalPrompt = `
    ${SYSTEM_PROMPT}
    === VERLAUF ===
    ${contextText}
    === AUFGABE ===
    Analysiere das Ticket und erstelle einen passenden Antwortentwurf.
    `;

    const model = "gemini-2.5-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
        });
        const data = await response.json();
        let rawText = data.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        try { return JSON.parse(rawText); } catch(e) { return { draft: rawText, feedback: "Format Fehler" }; }
    } catch (e) {
        return null;
    }
}

function extractContextFromDOM(docRoot) {
    const mainContainer = docRoot.querySelector('#conv-layout-main');
    if (!mainContainer) return "";
    const clone = mainContainer.cloneNode(true);
    const myZone = clone.querySelector('#tradeo-ai-copilot-zone');
    if (myZone) myZone.remove();
    const editorBlock = clone.querySelector('.conv-reply-block');
    if(editorBlock) editorBlock.remove();
    return clone.innerText;
}

// --- UI LOGIC (TICKET VIEW) ---

function initConversationUI() {
    const mainContainer = document.getElementById('conv-layout-main');
    if (!mainContainer) return;

    const copilotContainer = document.createElement('div');
    copilotContainer.id = 'tradeo-ai-copilot-zone';
    copilotContainer.innerHTML = `
        <div id="tradeo-ai-dummy-draft"><em>🤖 Suche vorbereiteten Entwurf...</em></div>
        <div id="tradeo-ai-chat-history"></div>
        <div id="tradeo-ai-resize-handle" title="Höhe anpassen"></div>
        <div id="tradeo-ai-input-area">
            <div class="tradeo-ai-model-wrapper">
                <button id="tradeo-ai-model-btn" type="button">2.5 Flash</button>
                <div id="tradeo-ai-model-dropdown" class="hidden"></div>
            </div>
            <textarea id="tradeo-ai-input" placeholder="Anweisung an AI..."></textarea>
            <button id="tradeo-ai-send-btn">Go</button>
        </div>
    `;
    mainContainer.prepend(copilotContainer);
    
    const keyInput = document.createElement('input');
    keyInput.type = 'password'; keyInput.id = 'tradeo-apikey-input';
    keyInput.style.display = 'none'; keyInput.style.margin = '10px'; keyInput.style.width = '95%';
    keyInput.placeholder = 'API Key eingeben...';
    copilotContainer.prepend(keyInput);
    checkApiKeyUI();

    const originalReplyBtn = document.querySelector('.conv-reply');
    if(originalReplyBtn) setupButtons(originalReplyBtn);
    
    setupModelSelector();
    setupEditorObserver();
    setupResizeHandler();
    copilotContainer.style.display = 'block';

    // CACHE LOAD
    const match = window.location.href.match(/conversation\/(\d+)/);
    const ticketId = match ? match[1] : null;

    if (ticketId) {
        const storageKey = `draft_${ticketId}`;
        chrome.storage.local.get([storageKey], function(result) {
            const cached = result[storageKey];
            if (cached) {
                const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
                addDraftMessage(cached.draft);
                addChatMessage('ai', cached.feedback + " (Vorbereitet)");
                window.aiState.lastDraft = cached.draft;
                dummyDraft.innerHTML = cached.draft;
                flashElement(dummyDraft);
            } else {
                addChatMessage("system", "Kein Entwurf gefunden. Starte Live-Analyse...");
                runAI(true);
            }
        });
    } else {
        runAI(true);
    }
}

// --- UI HELPERS ---

function setupModelSelector() {
    const modelBtn = document.getElementById('tradeo-ai-model-btn');
    const modelDropdown = document.getElementById('tradeo-ai-model-dropdown');
    Object.values(AI_MODELS).forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        item.innerText = model.dropdownText;
        item.onclick = (e) => {
            window.aiState.currentModel = model.id;
            modelBtn.innerText = model.label;
            document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            modelDropdown.classList.add('hidden');
            e.stopPropagation();
        };
        modelDropdown.appendChild(item);
    });
    modelBtn.addEventListener('click', (e) => { e.stopPropagation(); modelDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => modelDropdown.classList.add('hidden'));
}

function setupButtons(originalReplyBtn) {
    const aiBtn = originalReplyBtn.cloneNode(true);
    aiBtn.classList.add('tradeo-ai-toolbar-btn');
    aiBtn.setAttribute('title', 'Mit AI Antworten');
    const icon = aiBtn.querySelector('.glyphicon') || aiBtn;
    if(icon) { icon.classList.remove('glyphicon-share-alt'); icon.classList.add('glyphicon-flash'); }
    originalReplyBtn.parentNode.insertBefore(aiBtn, originalReplyBtn.nextSibling);
    
    aiBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        originalReplyBtn.click();
        window.aiState.isRealMode = true; window.aiState.preventOverwrite = false;
        waitForSummernote(function(editable) {
            const content = window.aiState.lastDraft || document.getElementById('tradeo-ai-dummy-draft').innerHTML;
            setEditorContent(editable, content);
            document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        });
    });
    originalReplyBtn.addEventListener('click', () => {
        document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        window.aiState.isRealMode = true;
        if(window.aiState.isGenerating) window.aiState.preventOverwrite = true;
    });
    document.getElementById('tradeo-ai-send-btn').addEventListener('click', () => runAI());
    document.getElementById('tradeo-ai-input').addEventListener('keydown', (e) => { 
        if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAI(); }
    });
}

function setupEditorObserver() {
    const editorBlock = document.querySelector('.conv-reply-block');
    if (!editorBlock) return;
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                const isHidden = editorBlock.classList.contains('hidden') || editorBlock.style.display === 'none';
                if (isHidden) {
                    window.aiState.isRealMode = false; window.aiState.preventOverwrite = false;
                    const dummy = document.getElementById('tradeo-ai-dummy-draft');
                    if (dummy) {
                        if(window.aiState.lastDraft) dummy.innerHTML = window.aiState.lastDraft;
                        dummy.style.display = 'block';
                    }
                } else {
                    const dummy = document.getElementById('tradeo-ai-dummy-draft');
                    if(dummy) dummy.style.display = 'none';
                }
            }
        });
    }).observe(editorBlock, { attributes: true });
}

async function runAI(isInitial = false) {
    const btn = document.getElementById('tradeo-ai-send-btn');
    const input = document.getElementById('tradeo-ai-input');
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    const apiKeyInput = document.getElementById('tradeo-apikey-input');
    let userPrompt = input.value.trim();
    
    window.aiState.isGenerating = true;
    if (isInitial) userPrompt = "Analysiere das Ticket und erstelle einen passenden Antwortentwurf.";
    else { if (!userPrompt) return; addChatMessage('user', userPrompt); window.aiState.chatHistory.push({role: "User", text: userPrompt}); }

    let apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        const stored = await chrome.storage.local.get(['geminiApiKey']);
        apiKey = stored.geminiApiKey;
    }
    if (!apiKey) { window.aiState.isGenerating = false; return; }

    btn.disabled = true; btn.innerText = "...";
    
    const contextText = extractContextFromDOM(document);
    const historyString = window.aiState.chatHistory.map(e => `${e.role}: ${e.text}`).join("\n");
    const currentDraft = window.aiState.isRealMode ? document.querySelector('.note-editable')?.innerHTML : dummyDraft.innerHTML;

    const finalPrompt = `
    ${SYSTEM_PROMPT}
    === HINTERGRUND ===
    TICKET VERLAUF:
    ${contextText}
    === AKTUELLER STATUS ===
    DERZEITIGER ENTWURF: "${currentDraft}"
    === HISTORIE ===
    ${historyString}
    === NEUE ANWEISUNG ===
    User: ${userPrompt}
    `;

    const model = window.aiState.currentModel || "gemini-2.5-flash";

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "API Error");

        let rawText = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        let jsonResponse;
        try { jsonResponse = JSON.parse(rawText); } catch(e) { jsonResponse = { draft: rawText, feedback: "Format Fehler" }; }

        addDraftMessage(jsonResponse.draft);
        addChatMessage('ai', jsonResponse.feedback);
        window.aiState.chatHistory.push({role: "AI", text: jsonResponse.feedback});
        window.aiState.lastDraft = jsonResponse.draft;
        
        if (window.aiState.isRealMode && !window.aiState.preventOverwrite) {
            const editable = document.querySelector('.note-editable');
            if (editable) setEditorContent(editable, jsonResponse.draft);
        } else {
            dummyDraft.innerHTML = jsonResponse.draft;
            if(!window.aiState.preventOverwrite && !window.aiState.isRealMode) { dummyDraft.style.display = 'block'; flashElement(dummyDraft); }
        }
        if(!isInitial) input.value = '';
    } catch(e) {
        addChatMessage('system', "Error: " + e.message);
    } finally {
        btn.disabled = false; btn.innerText = "Go"; window.aiState.isGenerating = false; window.aiState.preventOverwrite = false;
    }
}

// --- STANDARD UTILS ---

function checkApiKeyUI() {
    chrome.storage.local.get(['geminiApiKey'], function(result) {
        const input = document.getElementById('tradeo-apikey-input');
        if (input) input.style.display = !result.geminiApiKey ? 'block' : 'none';
    });
}

function waitForSummernote(callback) {
    let attempts = 0;
    const interval = setInterval(() => {
        const editable = document.querySelector('.note-editable');
        if (editable && editable.offsetParent !== null) { 
            clearInterval(interval);
            callback(editable);
        }
        attempts++;
        if (attempts > 20) clearInterval(interval);
    }, 100);
}

function setEditorContent(editableElement, htmlContent) {
    if (!editableElement) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    editableElement.innerHTML = htmlContent;
    editableElement.dispatchEvent(new Event('input', { bubbles: true }));
    editableElement.focus({ preventScroll: true });
    window.scrollTo(scrollX, scrollY);
    const flashTarget = editableElement.closest('.note-editor') || editableElement;
    flashElement(flashTarget);
}

function addChatMessage(role, text) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;
    const msgDiv = document.createElement('div');
    if (role === 'user') { msgDiv.className = 'user-msg'; msgDiv.innerHTML = `<strong>DU</strong> ${text}`; }
    else if (role === 'ai') { msgDiv.className = 'ai-msg'; msgDiv.innerHTML = `<strong>AI</strong> ${text}`; }
    else { msgDiv.className = 'ai-msg'; msgDiv.style.fontStyle = 'italic'; msgDiv.innerHTML = text; }
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function flashElement(element) {
    if (!element) return;
    element.classList.remove('tradeo-flash-active');
    void element.offsetWidth;
    element.classList.add('tradeo-flash-active');
    setTimeout(() => { element.classList.remove('tradeo-flash-active'); }, 1200);
}

function addDraftMessage(htmlContent) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'draft-msg'; 
    msgDiv.innerHTML = `
        <div class="draft-header"><span class="icon">📄</span> Entwurf (Klicken zum Anzeigen)</div>
        <div class="draft-body">${htmlContent}
            <div class="draft-actions">
                <button class="draft-btn btn-copy">📋 Kopieren</button>
                <button class="draft-btn primary btn-adopt">⚡ Übernehmen</button>
            </div>
        </div>`;
    msgDiv.querySelector('.draft-header').onclick = () => msgDiv.classList.toggle('expanded');
    msgDiv.querySelector('.btn-copy').onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(htmlContent);
    };
    msgDiv.querySelector('.btn-adopt').onclick = (e) => {
        e.stopPropagation();
        window.aiState.lastDraft = htmlContent;
        const editorBlock = document.querySelector('.conv-reply-block');
        const replyBtn = document.querySelector('.conv-reply');
        if (editorBlock && !editorBlock.classList.contains('hidden') && editorBlock.style.display !== 'none') {
            const editable = document.querySelector('.note-editable');
            if (editable) { window.aiState.isRealMode = true; setEditorContent(editable, htmlContent); }
        } else if (replyBtn) {
            window.aiState.isRealMode = true; replyBtn.click();
            waitForSummernote((editable) => setEditorContent(editable, htmlContent));
        }
    };
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function setupResizeHandler() {
    const resizer = document.getElementById('tradeo-ai-resize-handle');
    const chatHistory = document.getElementById('tradeo-ai-chat-history');
    if (resizer && chatHistory) {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = chatHistory.offsetHeight;
            const doDrag = (e) => {
                const newHeight = startHeight + (e.clientY - startY);
                if (newHeight >= 120) chatHistory.style.height = newHeight + 'px';
            };
            const stopDrag = () => {
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            };
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }
}

// --- BOOTSTRAP ---
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHeartbeat);
else startHeartbeat();