// --- KONFIGURATION ---
const API_VERSION = "v1beta";
const POLL_INTERVAL_MS = 2000; // Alle 2 Sekunden prüfen
const LOCK_TTL_MS = 180000; // 3 Minuten Timeout für verwaiste Locks
const AI_TIMEOUT_PER_TURN = 60000; // 60 Sekunden pro Turn
const AI_TIMEOUT_SLOW = 600000;     // 10 Min total für langsame Modelle (3 Pro)
const MAX_TURNS = 8; // Maximale Anzahl an Runden (Thought/Action Loops)

const DASHBOARD_FOLDERS_TO_SCAN = [
    "https://desk.tradeo.de/mailbox/3/27",  // Servershop24 -> Nicht zugewiesen
    "https://desk.tradeo.de/mailbox/3/155"  // Servershop24 -> Meine
];

// SYSTEM PROMPTS
// NOTE: workerPrompt & plannerPrompt wurden nach systemPrompts.js ausgelagert.
// Model Definitionen
const AI_MODELS = {
    "gemini-2.5-flash-lite": { id: "gemini-2.5-flash-lite", label: "2.5 Flash Lite", dropdownText: "gemini-2.5-flash-lite (sehr schnell)" },
    "gemini-2.5-flash": { id: "gemini-2.5-flash", label: "2.5 Flash", dropdownText: "gemini-2.5-flash (schnell)" },
    "gemini-2.5-pro": { id: "gemini-2.5-pro", label: "2.5 Pro", dropdownText: "gemini-2.5-pro (standard)" },
    "gemini-3-pro-preview": { id: "gemini-3-pro-preview", label: "3 Pro", dropdownText: "gemini-3-pro-preview (langsam)" }
};

// --- GLOBAL STATE ---
window.aiState = {
    lastDraft: "",     
    isRealMode: false,
    isGenerating: false,
    preventOverwrite: false,
    chatHistory: [], // Array von Objekten: { type: 'user'|'ai'|'draft', content: string }
    currentModel: "gemini-2.5-pro",
    // Ticket-spezifische, wiederverwendbare Tool-Ergebnisse (für Folgeprompts ohne erneute API Calls)
    lastToolDataByCid: {},
    // Cache management V3
    knownTickets: new Map(), // Map<TicketID, ContentHash>
    processingQueue: new Set() // Set<TicketID>
};

async function acquireLock(ticketId, type) {
    const lockKey = `processing_${ticketId}`;
    const result = await chrome.storage.local.get([lockKey]);
    const existingLock = result[lockKey];

    // Prüfen ob valider Lock existiert
    if (existingLock) {
        const age = Date.now() - existingLock.timestamp;
        // Wenn Lock jünger als TTL ist, respektieren wir ihn
        if (age < LOCK_TTL_MS) {
            // Wenn wir Hintergrund sind und Live schon dran ist -> Abbruch
            if (type === 'background' && existingLock.type === 'live') return false;
            // Wenn wir Hintergrund sind und Hintergrund schon dran ist -> Abbruch
            if (type === 'background' && existingLock.type === 'background') return false;
            
            // Wenn wir Live sind und Background läuft -> return 'WAIT' (Signal zum Warten)
            if (type === 'live' && existingLock.type === 'background') return 'WAIT';
        }
    }

    // Lock setzen
    await chrome.storage.local.set({
        [lockKey]: { timestamp: Date.now(), type: type }
    });
    return true;
}

async function releaseLock(ticketId) {
    await chrome.storage.local.remove(`processing_${ticketId}`);
}

// --- CORE LOOPS (HEARTBEAT) ---

function startHeartbeat() {
    console.log("Tradeo AI: Heartbeat & Observer gestartet.");

    // 1. Sofortige Ausführung beim Start (behebt den Initial-Delay)
    runLifecycleCheck();

    // 2. Observer für "Instant"-Reaktion bei DOM-Änderungen (z.B. Klick auf Ticket in Inbox)
    // Wir beobachten den Body, ob '#conv-layout-main' (der Ticket-View) reingeladen wird.
    const observer = new MutationObserver((mutations) => {
        const ticketViewPresent = document.getElementById('conv-layout-main');
        const uiMissing = !document.getElementById('tradeo-ai-copilot-zone');
        
        // Nur feuern, wenn wir im Ticket sind UND die UI noch fehlt
        if (ticketViewPresent && uiMissing) {
            runLifecycleCheck();
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });

    // 3. Langsamerer Interval für Hintergrund-Aufgaben (Inbox Scan etc.)
    setInterval(() => {
        runLifecycleCheck();
    }, POLL_INTERVAL_MS);
}

// Die Hauptlogik ausgelagert, damit wir sie sofort + per Interval + per Observer rufen können
function runLifecycleCheck() {
    const pageType = detectPageType();
    
    // 1. UI & Lokaler DOM Scan (Abhängig von der Sicht)
    if (pageType === 'ticket') {
        // Wir sind im Ticket -> UI Rendern falls noch nicht da
        if (!document.getElementById('tradeo-ai-copilot-zone')) {
            // Checken ob der Container wirklich bereit ist
            if(document.querySelector('.conv-reply-block') || document.querySelector('.conv-reply')) {
                initConversationUI();
            }
        }
    } 
    else if (pageType === 'inbox') {
        // Wir sind in einer Liste -> Scannen der SICHTBAREN Tabelle
        scanInboxTable();
    } 
    
    // 2. Globaler Hintergrund-Scan (ServerShop24 -> Nicht zugewiesen & Meine)
    // Das muss nicht bei jedem Millisekunden-Event laufen, daher kleiner Schutz:
    if (!window.aiState.isBackgroundScanning) {
        scanDashboardFolders();
    }
}

function detectPageType() {
    if (document.getElementById('conv-layout-main')) return 'ticket';
    if (document.querySelector('.table-conversations')) return 'inbox';
    if (document.querySelector('.dash-cards')) return 'dashboard';
    return 'unknown';
}

// --- LOGIC: INBOX SCANNER ---

// --- LOGIC: INBOX SCANNER ---

function scanInboxTable() {
    // 1. URL Check: Befinden wir uns in einem Ordner, der gescannt werden SOLL?
    const currentUrl = window.location.href;
    
    // Wir prüfen, ob die aktuelle URL mit einem der Einträge in DASHBOARD_FOLDERS_TO_SCAN übereinstimmt.
    // Wir achten darauf, dass wir Query-Parameter (?page=2) ignorieren oder korrekt behandeln,
    // um "falsche Freunde" (z.B. Ordner ID 27 vs 275) zu vermeiden.
    const isAllowedFolder = DASHBOARD_FOLDERS_TO_SCAN.some(allowedUrl => {
        // Fall A: Exakter Match (z.B. .../mailbox/3/27)
        if (currentUrl === allowedUrl) return true;
        // Fall B: Match mit Query Params (z.B. .../mailbox/3/27?page=2)
        if (currentUrl.startsWith(allowedUrl + '?')) return true;
        // Fall C: Match mit Slash (z.B. .../mailbox/3/27/...)
        if (currentUrl.startsWith(allowedUrl + '/')) return true;
        
        return false;
    });

    if (!isAllowedFolder) {
        // Wir sind in einem Ordner (z.B. Spam oder Kollegen), der nicht definiert ist.
        // -> Kein Pre-Fetch.
        return;
    }

    // 2. Scan durchführen (nur wenn erlaubt)
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
    // Schutzmechanismus: Wenn ein Scan noch läuft, nicht noch einen starten
    if (window.aiState.isBackgroundScanning) return;
    
    window.aiState.isBackgroundScanning = true;

    try {
        for (const url of DASHBOARD_FOLDERS_TO_SCAN) {
            try {
                // Wir fetchen die HTML der Ordner im Hintergrund
                const response = await fetch(url);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                
                // Suche nach Ticket-Zeilen im gefetchten HTML
                const rows = Array.from(doc.querySelectorAll('tr.conv-row[data-conversation_id]'));
                
                rows.forEach(row => {
                    const id = row.getAttribute('data-conversation_id');
                    const previewEl = row.querySelector('.conv-preview');
                    const previewText = previewEl ? previewEl.innerText.trim() : "no-preview";
                    
                    // Hash erstellen
                    const currentHash = `${id}_${previewText.substring(0, 50)}_${previewText.length}`;
                    
                    checkAndQueue(id, currentHash);
                });
            } catch (e) {
                console.warn(`Tradeo AI: Hintergrund-Scan Fehler bei ${url}:`, e);
            }
        }
    } finally {
        // Flag wieder freigeben, egal ob Fehler oder Erfolg
        window.aiState.isBackgroundScanning = false;
    }
}

// --- LOGIC: QUEUE MANAGEMENT ---

function checkAndQueue(id, currentHash) {
    if (window.aiState.processingQueue.has(id)) return; // Wird bereits verarbeitet
    
    // Prüfen ob Hash gleich ist (Cache hit im RAM)
    if (window.aiState.knownTickets.get(id) === currentHash) return;

    // Neu oder verändert
    window.aiState.processingQueue.add(id);
    
    processTicket(id, currentHash).then(() => {
        window.aiState.processingQueue.delete(id);
        window.aiState.knownTickets.set(id, currentHash);
    });
}

// --- LOGIC: QUEUE MANAGEMENT & PROCESSING ---

async function processTicket(id, incomingInboxHash) {
    try {
        // 1. Locking prüfen
        const lockAcquired = await acquireLock(id, 'background');
        if (!lockAcquired) {
            return;
        }

        const storageKey = `draft_${id}`;
        const storedRes = await chrome.storage.local.get([storageKey]);
        const storedData = storedRes[storageKey];

        // Abbruch wenn Inbox-Hash identisch
        if (storedData) {
            const lastInboxHash = storedData.inboxHash;
            if (lastInboxHash === incomingInboxHash) {
                await releaseLock(id); 
                return; 
            }
        }

        console.log(`[CID: ${id}] Tradeo AI: ⚡ Verarbeite Ticket im Hintergrund...`);

        const response = await fetch(`https://desk.tradeo.de/conversation/${id}`);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        
        const contextText = extractContextFromDOM(doc);
        const realContentHash = generateContentHash(contextText);

        if (!contextText || contextText.length < 50) {
            await releaseLock(id);
            return;
        }

        // Headless Draft erstellen
        const aiResult = await generateDraftHeadless(contextText, id);

        if (aiResult) {
            let initialHistory = [];
            
            // 1. KAREN START (Damit loadFromCache die Bubble initialisiert)
            // Dieser String muss exakt mit dem in loadFromCache übereinstimmen
            initialHistory.push({ type: "system", content: "Karen prüft, ob wir aus Plenty Daten brauchen..." });

            // 2. KAREN RESULT (Tools oder Log)
            // A: Tools wurden ausgeführt -> Structured Bubble
            if (aiResult.toolExec && aiResult.toolExec.summary) {
                initialHistory.push({ 
                    type: 'tool_exec', 
                    summary: aiResult.toolExec.summary, 
                    details: aiResult.toolExec.details,
                    calls: aiResult.toolExec.calls 
                });
            } 
            // B: Keine Tools -> Textnachricht (die loadFromCache als Karen erkennt)
            else if (aiResult.toolLogs && Array.isArray(aiResult.toolLogs)) {
                aiResult.toolLogs.forEach(logText => {
                    initialHistory.push({ type: 'system', content: logText });
                });
            }
            
            // 3. KEVIN DRAFT
            initialHistory.push({ type: 'draft', content: aiResult.draft });

            // 4. KEVIN REASONING
            // FIX: Fallback für Summary, falls AI mal leer zurückgab (selten, aber möglich)
            const safeSummary = aiResult.feedback && aiResult.feedback.trim() !== "" 
                ? aiResult.feedback 
                : "Automatisch vorbereitet";

            initialHistory.push({ 
                type: 'reasoning', 
                summary: safeSummary, 
                details: aiResult.reasoning || "" 
            });

            const data = {};
            data[storageKey] = {
                draft: aiResult.draft,
                feedback: aiResult.feedback,
                chatHistory: initialHistory,
                lastToolData: aiResult.lastToolData || null,
                timestamp: Date.now(),
                inboxHash: incomingInboxHash, 
                contentHash: realContentHash
            };
            
            await chrome.storage.local.set(data);
            console.log(`[CID: ${id}] Tradeo AI: ✅ Draft gespeichert (Hash: ${realContentHash}).`);
        }

    } catch (e) {
        console.error(`[CID: ${id}] Fehler bei Verarbeitung:`, e);
    } finally {
        await releaseLock(id);
    }
}

// --- API FUNCTIONS ---


async function generateDraftHeadless(contextText, ticketId = 'UNKNOWN') {
    const stored = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = stored.geminiApiKey;
    if (!apiKey) return null;

    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-3-pro");
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

    const headlessUserPrompt = "Analysiere das Ticket und erstelle einen Entwurf.";

    const primaryTask = async () => {
        // PHASE 1: PLAN
        const plan = await analyzeToolPlan(contextText, headlessUserPrompt, "", null, ticketId);

        // Tool Logs & Exec Info bauen
        const toolLogs = [];
        const toolExec = buildToolExecutionInfo(plan.tool_calls || []);
        
        // Konstante muss exakt zum Live-Modus passen für loadFromCache!
        const MSG_NO_TOOLS_NEEDED = "✅ Keine Datenabfrage nötig.";

        if (toolExec) {
            // Im Headless Modus loggen wir das Summary (wird aber meist durch toolExec Objekt ersetzt)
            toolLogs.push(toolExec.summary);
        } else {
            // WICHTIG: Exakt gleicher String wie im Live-Modus, ohne "Hintergrund:" Präfix
            toolLogs.push(MSG_NO_TOOLS_NEEDED);
        }

        // PHASE 2: EXECUTE
        const gatheredData = await executePlannedToolCalls(plan.tool_calls || [], ticketId);

        // PHASE 3: GENERATE
        const generatorPrompt = `
${workerPrompt}

=== HINTERGRUND-ANALYSE ===
Dies ist ein automatischer Scan eines Tickets.
WICHTIG: Du darfst KEINE Tools/Funktionen aufrufen – die Datenbeschaffung ist abgeschlossen.

=== HINTERGRUND-DATEN (PLENTY API ERGEBNISSE) ===
${JSON.stringify(gatheredData, null, 2)}

=== TICKET VERLAUF ===
${contextText}

=== AUFGABE ===
Erstelle einen Antwortentwurf im JSON-Format:
{
  "draft": "<html>...</html>",
  "reasoning": "kurze interne Begründung",
  "feedback": "kurzer Status/Headline"
}
`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: generatorPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const response = await callGeminiWithRotation(payload, currentModel);
        let rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        rawText = stripGeminiJson(rawText);

        let finalResponse;
        try {
            finalResponse = JSON.parse(rawText);
            if(!finalResponse.draft && finalResponse.text) finalResponse.draft = finalResponse.text;
        } catch (e) {
            finalResponse = { 
                draft: rawText.replace(/\n/g, '<br>'), 
                feedback: "Hinweis: AI Formatierung war kein JSON (Rohdaten)." 
            };
        }

        finalResponse.toolLogs = toolLogs;
        finalResponse.toolExec = toolExec;
        finalResponse.lastToolData = gatheredData;
        return finalResponse;
    };

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), dynamicTimeoutMs)
    );

    try {
        return await Promise.race([primaryTask(), timeoutPromise]);
    } catch (error) {
        console.warn(`[CID: ${ticketId}] Headless: Abbruch (${error.message}). Starte Fallback (ohne Tools).`);

        try {
            let contents = [{
                role: "user",
                parts: [{ text: `
${workerPrompt}
=== HINTERGRUND-ANALYSE ===
Automatischer Scan. Fallback ohne Datenabfrage.

=== TICKET VERLAUF ===
${contextText}

=== AUFGABE ===
Erstelle einen Antwortentwurf im JSON-Format (kein Tool-Calling).
`}]
            }];

            const fallbackResponse = await executeHeadlessLoop(contents, ticketId);
            
            if (fallbackResponse) {
                if (!fallbackResponse.toolLogs) fallbackResponse.toolLogs = [];
                // Auch hier sauberes Wording
                fallbackResponse.toolLogs.push("⚠️ Hintergrund: Fallback (Datenabfrage fehlgeschlagen).");
            }
            return fallbackResponse;
        } catch (fbError) {
            console.error(`[CID: ${ticketId}] Headless Fallback failed completely:`, fbError);
            return null;
        }
    }
}


async function executeHeadlessLoop(contents, ticketId) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    
    // Kein Loop mehr, keine Tools Payload -> Einfacher Call
    const payload = { contents: contents };

    try {
        const data = await callGeminiWithRotation(payload, model);

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
        
        const content = candidate.content;
        const parts = content.parts || []; 
        
        if (parts.length === 0) {
            console.warn("Tradeo AI Headless: Gemini Content Parts sind leer.", candidate);
            throw new Error("GEMINI_SAFETY_FILTER_TRIGGERED");
        }

        let rawText = parts[0].text || ""; 
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let finalResponse = null;
        try { 
            finalResponse = JSON.parse(rawText); 
        } catch(e) { 
            if(rawText) finalResponse = { draft: rawText.replace(/\n/g, '<br>'), feedback: "Fallback (Raw Text)" }; 
        }
        
        return finalResponse;

    } catch (e) {
        console.error(`[CID: ${ticketId}] Headless Loop Error:`, e);
        return null;
    }
}

// =============================================================================
// FUNKTION: CONTEXT EXTRACTION (Robust V6 - Hash Source)
// =============================================================================
function extractContextFromDOM(docRoot) {
    const mainContainer = docRoot.querySelector('#conv-layout-main');
    if (!mainContainer) return "[]"; 

    const messages = [];
    // Threads von Alt nach Neu sortieren
    const threads = Array.from(mainContainer.querySelectorAll('.thread')).reverse();

    threads.forEach(thread => {
        // 1. SENDER: Whitespace normalisieren
        const personEl = thread.querySelector('.thread-person');
        const senderName = personEl ? personEl.textContent.trim().replace(/\s+/g, ' ') : "Unbekannt";

        // Filter: Entwürfe ignorieren (verhindert Hash-Änderung während des Tippens)
        if (senderName.includes("[Entwurf]") || senderName.includes("[Draft]")) {
            return; 
        }

        // 2. TYP & ID
        const threadId = thread.getAttribute('data-thread_id') || "unknown";
        let type = "unknown";
        if (thread.classList.contains('thread-type-note')) type = "internal_note";
        else if (thread.classList.contains('thread-type-customer')) type = "customer_message";
        else if (thread.classList.contains('thread-type-message')) type = "support_reply";

        // 3. ZEIT (ROBUST FIX)
        // Hintergrund (Raw HTML): Datum steht in 'title'.
        // Live (Bootstrap JS): Datum steht in 'data-original-title', 'title' ist leer.
        // Wir prüfen beide, um Konsistenz zu garantieren.
        const dateEl = thread.querySelector('.thread-date');
        let timestamp = "";
        if (dateEl) {
            timestamp = dateEl.getAttribute('data-original-title') || dateEl.getAttribute('title') || "";
        }
        timestamp = timestamp.trim();

        // 4. EMPFÄNGER (CC)
        let recipientsList = [];
        const recipientsContainer = thread.querySelector('.thread-recipients');
        if (recipientsContainer) {
            let rawText = recipientsContainer.textContent || ""; 
            rawText = rawText.replace(/^(An|Cc|Bcc|Von):\s*/gim, '').replace(/\n/g, ',');
            recipientsList = rawText.split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.toLowerCase().includes('an:')); 
        }

        // 5. NACHRICHT (DOM PARSER COMPATIBILITY FIX)
        // Problem: 'innerText' existiert im Background-Worker (DOMParser) nicht korrekt.
        // 'textContent' klebt aber "Hallo<br>Welt" zu "HalloWelt" zusammen.
        // Lösung: Wir klonen den Node, ersetzen Block-Elemente durch Spaces und nehmen dann textContent.
        let bodyText = "";
        const contentEl = thread.querySelector('.thread-content');
        if (contentEl) {
            // Klonen, um das Live-DOM nicht zu verändern
            const clone = contentEl.cloneNode(true);
            
            // Block-Breaks simulieren für textContent
            const blockTags = clone.querySelectorAll('br, p, div, li, tr');
            blockTags.forEach(tag => {
                // Füge ein Leerzeichen nach jedem Block-Element ein
                if(tag.parentNode) {
                    const space = document.createTextNode(' ');
                    tag.parentNode.insertBefore(space, tag.nextSibling);
                }
            });

            const rawText = clone.textContent || "";
            // Alles zu einer Zeile normalisieren -> Garantiert gleichen Hash
            bodyText = rawText.replace(/\s+/g, ' ').trim();
        }

        // 6. ANHÄNGE
        let fileList = [];
        const attachmentsEl = thread.querySelector('.thread-attachments');
        if (attachmentsEl) {
            fileList = Array.from(attachmentsEl.querySelectorAll('li')).map(li => {
                const link = li.querySelector('a.attachment-link');
                const sizeSpan = li.querySelector('.text-help');
                const name = link ? link.textContent.trim() : "";
                const size = sizeSpan ? sizeSpan.textContent.trim() : "";
                return name ? (size ? `${name} (${size})` : name) : null;
            }).filter(Boolean);
        }

        // Leere "Geister-Threads" ignorieren
        if (senderName === "Unbekannt" && type === "unknown" && !bodyText && fileList.length === 0) {
            return;
        }

        const msgObj = {
            id: threadId,      // ID garantiert Eindeutigkeit
            type: type,
            sender: senderName,
            time: timestamp,   // Jetzt stabil dank title/data-original-title Fallback
            msg: bodyText      // Jetzt stabil dank Normalisierung
        };
        
        if (recipientsList.length > 0) msgObj.cc = recipientsList;
        if (fileList.length > 0) msgObj.files = fileList;

        messages.push(msgObj);
    });

    return JSON.stringify(messages);
}

async function handleStartupSync(ticketId) {
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    
    // 1. Aktuellen Zustand des Tickets im Browser ermitteln (Hash)
    const currentText = extractContextFromDOM(document);
    const currentHash = generateContentHash(currentText);

    // console.log(`[CID: ${ticketId}] Startup Check. DOM-Hash: ${currentHash}`);

    // 2. Prüfen, ob Hintergrund-Prozess läuft
    const lockStatus = await acquireLock(ticketId, 'live');

    // --- SZENARIO A: Background läuft gerade (WAIT) ---
    if (lockStatus === 'WAIT') {
        console.log(`[CID: ${ticketId}] Background Job aktiv. Warte...`);
        
        renderChatMessage('system', "⏳ <strong>Pre-Fetch läuft...</strong><br>Ein Hintergrundprozess analysiert das Ticket.");
        dummyDraft.innerHTML = "<em>⏳ Warte auf Analyse...</em>";
        dummyDraft.style.display = 'block';

        const changeListener = (changes, area) => {
            if (area === 'local') {
                // Draft fertig
                if (changes[`draft_${ticketId}`]) {
                    const newData = changes[`draft_${ticketId}`].newValue;
                    // Hash Vergleich (sollte jetzt dank Timestamp-Fix passen!)
                    if (newData && newData.contentHash === currentHash) {
                        console.log(`[CID: ${ticketId}] Sync OK. Lade Cache.`);
                        chrome.storage.onChanged.removeListener(changeListener);
                        loadFromCache(ticketId);
                    } else if (newData) {
                        console.warn(`[CID: ${ticketId}] Sync Mismatch nach Wait (Stored: ${newData.contentHash} vs DOM: ${currentHash}).`);
                    }
                }
                // Lock weg
                else if (changes[`processing_${ticketId}`] && !changes[`processing_${ticketId}`].newValue) {
                    chrome.storage.onChanged.removeListener(changeListener);
                    setTimeout(async () => {
                        const res = await chrome.storage.local.get([`draft_${ticketId}`]);
                        const cached = res[`draft_${ticketId}`];
                        if (cached && cached.contentHash === currentHash) {
                            loadFromCache(ticketId);
                        } else {
                            console.warn(`[CID: ${ticketId}] Background fertig, aber Daten veraltet. Starte Live.`);
                            runAI(true);
                        }
                    }, 500);
                }
            }
        };
        chrome.storage.onChanged.addListener(changeListener);
        return; 
    }

    // --- SZENARIO B: Wir haben den Lock (Kein Background aktiv) ---
    await releaseLock(ticketId);

    const storageKey = `draft_${ticketId}`;
    const res = await chrome.storage.local.get([storageKey]);
    const cached = res[storageKey];

    if (cached) {
        // MATCH: Alles gut
        if (cached.contentHash === currentHash) {
            console.log(`[CID: ${ticketId}] Cache gültig. Lade...`);
            loadFromCache(ticketId);
            return;
        } 
        
        // MISMATCH: Inhalt anders
        console.warn(`[CID: ${ticketId}] ⚠️ HASH MISMATCH!`);
        console.warn(`Stored Hash: ${cached.contentHash} (Timestamp des Speicherpunkts: ${new Date(cached.timestamp).toLocaleTimeString()})`);
        console.warn(`Live Hash:   ${currentHash}`);
        
        // DEBUG: Zeige den String-Unterschied in der Konsole, falls verfügbar
        // Wir können den gespeicherten Context (leider nicht direkt den String) nicht sehen, 
        // aber wir sehen jetzt zumindest, DASS es nicht passt.
        
        // UI Reset
        dummyDraft.innerHTML = '<em>🤖 Ticket-Update erkannt! Analysiere neu...</em>';
        dummyDraft.style.display = 'block';
        flashElement(dummyDraft);
        const hist = document.getElementById('tradeo-ai-chat-history');
        if(hist) hist.innerHTML = '';
        
        // Live Start
        runAI(true);

    } else {
        // Kein Cache
        console.log(`[CID: ${ticketId}] Kein Cache. Starte Live...`);
        runAI(true);
    }
}

async function checkDraftExists(ticketId) {
    const res = await chrome.storage.local.get([`draft_${ticketId}`]);
    return !!res[`draft_${ticketId}`];
}

function loadFromCache(ticketId) {
    const storageKey = `draft_${ticketId}`;
    chrome.storage.local.get([storageKey], function(result) {
        const cached = result[storageKey];
        if (cached) {
            const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
            window.aiState.lastDraft = cached.draft;
            dummyDraft.innerHTML = cached.draft;

            // Wiederverwendbare Tool-Daten wiederherstellen
            if (cached.lastToolData) {
                window.aiState.lastToolDataByCid = window.aiState.lastToolDataByCid || {};
                window.aiState.lastToolDataByCid[ticketId] = cached.lastToolData;
            }
            
            // UI sichtbar machen
            dummyDraft.style.display = 'block'; 
            flashElement(dummyDraft);

            const histContainer = document.getElementById('tradeo-ai-chat-history');
            histContainer.innerHTML = ''; 
            
            // --- RESTORE LOGIC MIT VISUELLER ZUSAMMENFÜHRUNG ---
            if (cached.chatHistory && Array.isArray(cached.chatHistory)) {
                window.aiState.chatHistory = cached.chatHistory;
                
                let activeKarenBubble = null; // State Tracker für laufende Karen-Blase

                cached.chatHistory.forEach(msg => {
                    // 1. START: "Karen prüft" -> Erzeugt Karen Blase
                    if (msg.type === 'system' && msg.content.includes('Karen prüft')) {
                        if (!activeKarenBubble) {
                            activeKarenBubble = renderKarenBubble("Karen prüft, ob wir aus Plenty Daten brauchen...");
                        }
                        return; // Stop, wir rendern hier keine Textnachricht!
                    }

                    // 2. ENDE A: "Keine Tools" / "Cache genutzt" / "Fallback" -> Updated Karen
                    // FIX: "Fallback" und "Warnung" hinzugefügt, damit die Bubble auch bei Fehlern aufhört zu drehen
                    if (msg.type === 'system' && (
                        msg.content.includes('Keine neuen Tool-Aufrufe') || 
                        msg.content.includes('Keine Datenabfrage nötig') || 
                        msg.content.includes('Cache genutzt') ||
                        msg.content.includes('Fallback') ||
                        msg.content.includes('Warnung')
                    )) {
                        if (!activeKarenBubble) activeKarenBubble = renderKarenBubble("Karen prüft...");
                        // Bei Fallback/Warnung machen wir ein Warndreieck statt Haken, aber Status "finished"
                        const isWarning = msg.content.includes('Fallback') || msg.content.includes('Warnung');
                        const prefix = isWarning ? "⚠️ " : "✅ ";
                        
                        updateKarenBubble(activeKarenBubble, msg.content, null, true);
                        
                        // Visuelles Override für den Header, falls es ein Warning war (updateKarenBubble macht standardmäßig Haken)
                        if(isWarning) {
                            const header = activeKarenBubble.querySelector('.tool-header');
                            if(header) header.textContent = prefix + "Karen's Plenty Tool-To-Do (Info)";
                            activeKarenBubble.classList.add('finished'); // Grünlicher Hintergrund bleibt, ist ok für "Done"
                        }
                        
                        activeKarenBubble = null; // Reset für nächsten Zyklus
                        return;
                    }

                    // 3. ENDE B: Echte Tool Execution -> Updated Karen
                    if (msg.type === 'tool_exec') {
                        if (!activeKarenBubble) activeKarenBubble = renderKarenBubble("Karen prüft...");
                        updateKarenBubble(activeKarenBubble, msg.summary, msg.details, true); // Grün & Fertig
                        activeKarenBubble = null; // Reset
                        return;
                    }

                    // 4. Standard Nachrichten
                    if (msg.type === 'draft') {
                        renderDraftMessage(msg.content);
                    } else if (msg.type === 'user') {
                        renderChatMessage('user', msg.content);
                    } else if (msg.type === 'reasoning') {
                        renderReasoningMessage(msg.summary, msg.details);
                    } else if (msg.type === 'system') {
                        renderChatMessage('system', msg.content);
                    } else if (msg.type === 'ai') {
                        renderChatMessage('ai', msg.content); // Legacy
                    } else {
                        renderChatMessage('ai', msg.text || msg.content);
                    }
                });
            } else {
                // Fallback für ganz alte Daten ohne History Array
                const fallbackText = cached.feedback + " (Vorbereitet)";
                renderChatMessage('ai', fallbackText);
                window.aiState.chatHistory = [{ type: 'ai', content: fallbackText }];
            }

            setTimeout(scrollToBottom, 50);
        }
    });
}

/**
 * Überwacht den Chat-Verlauf auf Änderungen und stellt die UI bei Verlust wieder her.
 */
function setupThreadObserver() {
    if (window.aiState.threadObserverActive) return;

    const mainContainer = document.getElementById('conv-layout-main');
    if (!mainContainer) return;

    console.log("Tradeo AI: Starte Thread-Überwachung (Restore-Mode)...");
    window.aiState.threadObserverActive = true;

    // Initialen Text speichern
    const lastExistingThread = mainContainer.querySelector('.thread .thread-content');
    if (lastExistingThread) {
        window.aiState.lastThreadText = lastExistingThread.innerText.trim();
    }

    const observer = new MutationObserver((mutations) => {
        let shouldReset = false;
        let newTextContent = "";
        let isRedraw = false;

        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.classList.contains('thread') || 
                            node.classList.contains('conv-message') ||
                            node.id.startsWith('thread-')) {
                            
                            if (node.id.includes('tradeo-ai')) return;

                            const contentEl = node.querySelector('.thread-content');
                            const text = contentEl ? contentEl.innerText.trim() : node.innerText.trim();

                            // Vergleich: Ist es derselbe Inhalt?
                            if (text && text === window.aiState.lastThreadText) {
                                isRedraw = true;
                                return; 
                            }

                            newTextContent = text;
                            shouldReset = true;
                        }
                    }
                });
            }
        });

        // FALL A: Echter neuer Inhalt -> Alles Resetten
        if (shouldReset) {
            if (newTextContent) window.aiState.lastThreadText = newTextContent;
            resetUiToLoadingState();
        } 
        // FALL B: Redraw erkannt (Inhalt gleich) -> UI prüfen & Retten
        else if (isRedraw) {
            console.log("Tradeo AI: Redraw erkannt. Prüfe UI Integrität...");
            
            const zone = document.getElementById('tradeo-ai-copilot-zone');
            
            if (!zone) {
                // UI ist komplett weg -> Neu aufbauen im Restore Mode
                console.log("Tradeo AI: UI verloren gegangen. Stelle wieder her...");
                initConversationUI(true); 
            } else {
                // UI ist noch da, aber vielleicht nicht mehr ganz oben?
                // FreeScout schiebt oft neue Elemente davor
                const main = document.getElementById('conv-layout-main');
                if (main && main.firstChild !== zone) {
                    console.log("Tradeo AI: UI verrutscht. Schiebe nach oben...");
                    main.prepend(zone);
                }
            }
        }
    });

    observer.observe(mainContainer, { childList: true, subtree: true });
}

function initConversationUI(isRestore = false) {
    const mainContainer = document.getElementById('conv-layout-main');
    if (!mainContainer) return;

    if (document.getElementById('tradeo-ai-copilot-zone')) return;

    const copilotContainer = document.createElement('div');
    copilotContainer.id = 'tradeo-ai-copilot-zone';
    copilotContainer.classList.add('tradeo-collapsed');

    copilotContainer.innerHTML = `
        <div id="tradeo-ai-dummy-draft"><em>🤖 Bereite Antwortentwurf vor...</em></div>
        
        <div id="tradeo-ai-settings-panel">
            <div class="tradeo-setting-row">
                <label>Gemini API Keys (Einer pro Zeile)</label>
                <textarea id="setting-gemini-key" placeholder="Key 1 (Projekt A)&#10;Key 2 (Projekt B)&#10;..." rows="4" style="width:100%; border:1px solid #ccc; border-radius:4px; padding:6px; font-family:monospace; font-size:11px;"></textarea>
                <div style="font-size:10px; color:#666; margin-top:2px;">Bei "Rate Limit" Fehlern wird automatisch zum nächsten Key gewechselt.</div>
            </div>
            <div class="tradeo-setting-row">
                <label>Plenty Username</label>
                <input type="text" id="setting-plenty-user" placeholder="Dein Plenty Login">
            </div>
            <div class="tradeo-setting-row">
                <label>Plenty Password</label>
                <input type="password" id="setting-plenty-pass" placeholder="Dein Plenty Passwort">
            </div>
            <button id="tradeo-save-settings-btn" class="tradeo-save-btn">Speichern & Verbinden</button>
            <div id="tradeo-settings-status"></div>
        </div>

        <div id="tradeo-ai-expand-overlay">
            <button id="tradeo-ai-expand-btn">Ganzen Entwurf & AI Dialog anzeigen</button>
        </div>

        <div id="tradeo-ai-chat-history"></div>
        <div id="tradeo-ai-resize-handle" title="Höhe anpassen"></div>
        
        <div id="tradeo-ai-input-area">
            <button id="tradeo-ai-settings-btn" title="Einstellungen (API Keys)"><i class="glyphicon glyphicon-cog"></i></button>
            
            <div class="tradeo-ai-model-wrapper">
                <button id="tradeo-ai-model-btn" type="button">2.5 Pro</button>
                <div id="tradeo-ai-model-dropdown" class="hidden"></div>
            </div>

            <button id="tradeo-ai-mic-btn" title="Spracheingabe (Klick zum Starten/Stoppen)">🎤</button>
            
            <button id="tradeo-ai-send-btn">Go</button>

            <textarea id="tradeo-ai-input" placeholder="Anweisung an AI..."></textarea>
        </div>
    `;
    
    mainContainer.prepend(copilotContainer);
    
    // --- EVENT LISTENER ---
    setupSettingsLogic();
    const originalReplyBtn = document.querySelector('.conv-reply');
    if(originalReplyBtn) setupButtons(originalReplyBtn);
    document.getElementById('tradeo-ai-expand-btn').addEventListener('click', expandInterface);
    setupModelSelector();
    setupEditorObserver();
    setupResizeHandler();
    if (typeof setupVoiceInput === 'function') setupVoiceInput();

    copilotContainer.style.display = 'block';

    // --- LOGIK-WEICHE ---
    if (isRestore) {
        console.log("Tradeo AI: ♻️ Stelle UI aus RAM wieder her...");
        
        const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
        if (window.aiState.lastDraft) {
            dummyDraft.innerHTML = window.aiState.lastDraft;
            dummyDraft.style.display = 'block';
        }

        const histContainer = document.getElementById('tradeo-ai-chat-history');
        if (window.aiState.chatHistory && window.aiState.chatHistory.length > 0) {
            window.aiState.chatHistory.forEach(msg => {
                if (msg.type === 'draft') {
                    renderDraftMessage(msg.content);
                } else if (msg.type === 'user') {
                    renderChatMessage('user', msg.content);
                } else if (msg.type === 'ai') {
                    renderChatMessage('ai', msg.content);
                } else if (msg.type === 'system') {
                    renderChatMessage('system', msg.content);
                } else {
                    renderChatMessage('ai', msg.text || msg.content);
                }
            });
            
            // WICHTIG: Scroll to Bottom Sticky erzwingen
            setTimeout(() => { 
                scrollToBottom(); 
            }, 100);
        }

    } else {
        const ticketId = getTicketIdFromUrl();
        if (ticketId) {
            handleStartupSync(ticketId);
        } else {
            runAI(true);
        }
    }

    setupThreadObserver();
}

function setupVoiceInput() {
    const micBtn = document.getElementById('tradeo-ai-mic-btn');
    const inputField = document.getElementById('tradeo-ai-input');

    if (!('webkitSpeechRecognition' in window)) {
        micBtn.style.display = 'none'; 
        return;
    }

    const recognition = new webkitSpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = false; 
    recognition.lang = 'de-DE';

    let isRecording = false;

    recognition.onstart = function() {
        isRecording = true;
        micBtn.classList.add('recording');
        // Angepasster Placeholder Text
        inputField.setAttribute('placeholder', 'Diktat läuft... ("...und los" zum Senden)');
    };

    recognition.onend = function() {
        isRecording = false;
        micBtn.classList.remove('recording');
        inputField.setAttribute('placeholder', 'Anweisung an AI...');
    };

    recognition.onresult = function(event) {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                let transcript = event.results[i][0].transcript;
                console.log("Tradeo AI Speech Chunk:", transcript);

                // --- NEUER TRIGGER: "und los" ---
                // Sucht nach "und los" am Satzende (optional mit Satzzeichen)
                const triggerRegex = /(?:\s|^)und\s+los[\.\!\?]?$/i;
                
                let shouldAutoSubmit = false;

                if (triggerRegex.test(transcript)) {
                    shouldAutoSubmit = true;
                    // Entfernt "und los" aus dem Text
                    transcript = transcript.replace(triggerRegex, "").trim();
                }

                // --- TEXT EINFÜGEN ---
                if (transcript.length > 0) {
                    const currentVal = inputField.value;
                    if (currentVal.length > 0 && !currentVal.endsWith(' ')) {
                        inputField.value += " " + transcript;
                    } else {
                        inputField.value += transcript;
                    }
                    
                    inputField.dispatchEvent(new Event('input'));
                    inputField.scrollTop = inputField.scrollHeight; 
                }

                // --- AUTO SUBMIT ---
                if (shouldAutoSubmit) {
                    console.log("Tradeo AI: 'und los' erkannt -> Sende...");
                    recognition.stop(); 
                    
                    setTimeout(() => {
                        const sendBtn = document.getElementById('tradeo-ai-send-btn');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                        }
                    }, 300);
                    return; 
                }
            }
        }
    };

    recognition.onerror = function(event) {
        console.error("Tradeo AI Speech Error:", event.error);
        if (event.error !== 'no-speech') {
             micBtn.classList.remove('recording');
             isRecording = false;
        }
    };

    micBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (isRecording) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });
}

function setupSettingsLogic() {
    const panel = document.getElementById('tradeo-ai-settings-panel');
    const btn = document.getElementById('tradeo-ai-settings-btn');
    const saveBtn = document.getElementById('tradeo-save-settings-btn');
    const statusDiv = document.getElementById('tradeo-settings-status');

    // Toggle Panel
    btn.addEventListener('click', () => {
        panel.classList.toggle('visible');
        if (panel.classList.contains('visible')) {
            // Beim Öffnen Werte laden
            chrome.storage.local.get(['geminiApiKeys', 'geminiApiKey', 'plentyUser', 'plentyPass'], (res) => {
                // Migration: Falls alter Single-Key existiert, aber keine Liste -> nutze Single Key
                let keysToShow = "";
                if (res.geminiApiKeys && Array.isArray(res.geminiApiKeys)) {
                    keysToShow = res.geminiApiKeys.join('\n');
                } else if (res.geminiApiKey) {
                    keysToShow = res.geminiApiKey;
                }
                
                document.getElementById('setting-gemini-key').value = keysToShow;
                document.getElementById('setting-plenty-user').value = res.plentyUser || '';
                document.getElementById('setting-plenty-pass').value = res.plentyPass || '';
            });
        }
    });

    // Save Action
    saveBtn.addEventListener('click', async () => {
        const rawKeys = document.getElementById('setting-gemini-key').value;
        const pUser = document.getElementById('setting-plenty-user').value.trim();
        const pPass = document.getElementById('setting-plenty-pass').value.trim();

        // Keys verarbeiten: Splitten, Trimmen, Leere Zeilen entfernen
        const keyList = rawKeys.split('\n')
            .map(k => k.trim())
            .filter(k => k.length > 5); // Mindestlänge Check

        statusDiv.innerText = "Speichere...";
        
        // Speichern
        await chrome.storage.local.set({
            geminiApiKeys: keyList,     // Neue Liste speichern
            geminiApiKey: keyList[0],   // Ersten Key als Fallback für Legacy-Funktionen speichern
            plentyUser: pUser,
            plentyPass: pPass,
            plentyToken: null 
        });

        // Test der Verbindung (optional)
        if (pUser && pPass) {
             statusDiv.innerText = "Teste Plenty Verbindung...";
             try {
                 await callPlenty('/rest/login', 'POST', { username: pUser, password: pPass });
                 statusDiv.innerText = `✅ Gespeichert (${keyList.length} API Keys) & Plenty Verbunden!`;
                 statusDiv.style.color = "green";
                 setTimeout(() => panel.classList.remove('visible'), 1500);
             } catch (e) {
                 statusDiv.innerText = "❌ Fehler: " + e;
                 statusDiv.style.color = "red";
             }
        } else {
            statusDiv.innerText = `✅ Gespeichert (${keyList.length} Gemini Keys)`;
            setTimeout(() => panel.classList.remove('visible'), 1000);
        }
    });
}

// Neue Funktion zum Ausklappen mit Scroll-Fix
// acceptingFocus: Wenn true (oder Event-Objekt), wird das Input-Feld fokussiert.
function expandInterface(acceptingFocus = true) {
    const zone = document.getElementById('tradeo-ai-copilot-zone');
    if (zone) {
        zone.classList.remove('tradeo-collapsed');
        
        // FIX: Timeout ist wichtig für Rendering
        setTimeout(() => {
            scrollToBottom(); // Scrollt nur den internen Chat-Verlauf
            
            // Nur fokussieren, wenn gewünscht (verhindert Focus-War mit Editor)
            // Prüfen ob acceptingFocus truthy ist (fängt auch das Event-Objekt ab)
            if (acceptingFocus) {
                const input = document.getElementById('tradeo-ai-input');
                // FIX: preventScroll: true verhindert das Springen des ganzen Browsers!
                if(input) input.focus({ preventScroll: true });
            }
        }, 50);
    }
}

// --- HELPERS ---

// =============================================================================
// NEU: KAREN BUBBLE LOGIC (Merge von Analyse & Tools)
// =============================================================================

function renderKarenBubble(initialText) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return null;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'karen-msg';

    // Einfache Struktur am Anfang
    msgDiv.innerHTML = `
        <div class="tool-header">Karen legt los...</div>
        <div class="tool-summary">${initialText}</div>
        <div class="tool-body"></div>
    `;

    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
    return msgDiv;
}

function updateKarenBubble(msgDiv, summaryText, detailsText, isFinished = false) {
    if (!msgDiv) return;

    const header = msgDiv.querySelector('.tool-header');
    const summary = msgDiv.querySelector('.tool-summary');
    const body = msgDiv.querySelector('.tool-body');

    // Standard-Header während des Ladens
    if (header && !isFinished) header.textContent = "Karen's Plenty Tool-To-Do (Details)";
    
    if (summary) summary.textContent = summaryText;
    
    // Body / Details Logik
    if (body && detailsText) {
        body.textContent = detailsText;
        body.style.display = 'none'; // Reset display state
        
        // Klick-Handler nur hinzufügen, wenn Details da sind
        msgDiv.onclick = (e) => {
            // Verhindert, dass Klicks beim Selektieren feuern
            if (window.getSelection().toString().length > 0) return;
            
            msgDiv.classList.toggle('expanded');
            
            // Header Text dynamisch anpassen beim Auf-/Zuklappen
            if (header) {
                const prefix = isFinished ? "✅ " : "";
                // Wenn expanded -> (Verbergen), sonst -> (Details)
                header.textContent = msgDiv.classList.contains('expanded') 
                    ? prefix + "Karen's Plenty Tool-To-Do (Verbergen)" 
                    : prefix + "Karen's Plenty Tool-To-Do (Details)";
            }
            
            // Body Sichtbarkeit toggeln
            if (msgDiv.classList.contains('expanded')) {
                body.style.display = 'block';
            } else {
                body.style.display = 'none';
            }
        };
        // Cursor Pointer, damit man sieht, dass es klickbar ist
        msgDiv.style.cursor = 'pointer';

    } else if (body) {
        body.style.display = 'none';
        msgDiv.onclick = null; // Klick entfernen wenn keine Details
        msgDiv.style.cursor = 'default';
    }

    // Fertig-Status Logik
    if (isFinished) {
        msgDiv.classList.add('finished');
        if(header) {
            // FIX: Header Text abhängig davon, ob Details existieren
            if (detailsText) {
                header.textContent = "✅ Karen's Plenty Tool-To-Do (Details)";
            } else {
                header.textContent = "✅ Karen's Plenty Tool-To-Do";
            }
        }
    }
}

// UPDATE: Draft Render Funktion (unterstützt jetzt Update eines existierenden Elements)
function renderDraftMessage(htmlContent, isLoading = false, targetElement = null) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return null;

    let msgDiv = targetElement;

    if (!msgDiv) {
        msgDiv = document.createElement('div');
        historyContainer.appendChild(msgDiv);
    }

    if (isLoading) {
        msgDiv.className = 'draft-msg loading msg-loading';
        msgDiv.innerHTML = `
            <div class="draft-header"><span class="icon">⏳</span> Kevin tippt Entwurf</div>
        `;
        historyContainer.scrollTop = historyContainer.scrollHeight;
        return msgDiv;
    }

    // Normaler Render (Inhalt da)
    msgDiv.className = 'draft-msg'; // Loading klasse weg
    msgDiv.innerHTML = `
        <div class="draft-header"><span class="icon">📄</span> Kevin's Entwurf (Anzeigen)</div>
        <div class="draft-body">${htmlContent}
            <div class="draft-actions">
                <button class="draft-btn btn-copy">📋 Kopieren</button>
                <button class="draft-btn primary btn-adopt">⚡ Übernehmen</button>
            </div>
        </div>`;
    
    // Events neu binden (da innerHTML überschrieben wurde)
    const headerBtn = msgDiv.querySelector('.draft-header');
    headerBtn.onclick = () => {
        msgDiv.classList.toggle('expanded');
        if (msgDiv.classList.contains('expanded')) {
            headerBtn.innerHTML = '<span class="icon">📄</span> Kevin\'s Entwurf (Verbergen)';
        } else {
            headerBtn.innerHTML = '<span class="icon">📄</span> Kevin\'s Entwurf (Anzeigen)';
        }
    };

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

    historyContainer.scrollTop = historyContainer.scrollHeight;
    return msgDiv;
}

// UPDATE: Reasoning Render Funktion (unterstützt jetzt Update eines existierenden Elements)
function renderReasoningMessage(summary, details, isLoading = false, targetElement = null) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return null;

    let msgDiv = targetElement;
    if (!msgDiv) {
        msgDiv = document.createElement('div');
        historyContainer.appendChild(msgDiv);
    }

    if (isLoading) {
        msgDiv.className = 'reasoning-msg loading msg-loading';
        msgDiv.innerHTML = `
            <div class="reasoning-header">Kevin denkt nach</div>
        `;
        historyContainer.scrollTop = historyContainer.scrollHeight;
        return msgDiv;
    }

    // Fertig
    msgDiv.className = 'reasoning-msg'; 
    const safeDetails = details || "Keine detaillierte Begründung verfügbar.";

    msgDiv.innerHTML = `
        <div class="reasoning-header">Kevin (Reasoning anzeigen)</div>
        <div class="reasoning-summary">${summary}</div>
        <div class="reasoning-body">${safeDetails}</div>
    `;
    
    msgDiv.onclick = (e) => {
        msgDiv.classList.toggle('expanded');
        const header = msgDiv.querySelector('.reasoning-header');
        if (msgDiv.classList.contains('expanded')) {
            header.textContent = "Kevin (Reasoning verbergen)";
        } else {
            header.textContent = "Kevin (Reasoning anzeigen)";
        }
    };

    historyContainer.scrollTop = historyContainer.scrollHeight;
    return msgDiv;
}

// =============================================================================
// HELPER: SINGLE TICKET RESET
// =============================================================================
async function performSingleTicketReset() {
    const ticketId = getTicketIdFromUrl();
    if (!ticketId) {
        console.warn("Tradeo AI: Kein Ticket-ID für Reset gefunden.");
        return;
    }

    console.log(`🔄 Tradeo AI: Starte Reset für Ticket #${ticketId}...`);

    // 1. Storage NUR für dieses Ticket löschen
    await chrome.storage.local.remove([`draft_${ticketId}`, `processing_${ticketId}`]);

    // 2. RAM State für dieses Ticket bereinigen
    if (window.aiState) {
        window.aiState.knownTickets.delete(ticketId);
        // Da wir uns gerade in diesem Ticket befinden, leeren wir auch den aktuellen View-State
        window.aiState.chatHistory = [];
        window.aiState.lastDraft = "";
        // Wichtig: auch ggf. gecachte Tool-Ergebnisse für dieses Ticket löschen
        if (window.aiState.lastToolDataByCid) {
            delete window.aiState.lastToolDataByCid[ticketId];
        }
    }

    // 3. UI Resetten
    const historyDiv = document.getElementById('tradeo-ai-chat-history');
    if (historyDiv) historyDiv.innerHTML = '';
    
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    if (dummyDraft) {
        dummyDraft.innerHTML = '<em>🔄 Ticket wird neu eingelesen...</em>';
        dummyDraft.style.display = 'block';
    }
    
    // Input leeren
    const input = document.getElementById('tradeo-ai-input');
    if (input) input.value = '';

    // 4. Neu-Initialisierung anstoßen
    // Da der Cache gelöscht ist, wird handleStartupSync dies als "neues Ticket" erkennen 
    // und automatisch runAI(true) feuern.
    expandInterface(); // UI sicherheitshalber aufklappen
    handleStartupSync(ticketId);
}

// =============================================================================
// NEU: TOOL EXECUTION MESSAGE (Expandable + Persistent)
// =============================================================================
function formatToolCallArgs(args) {
    if (!args || typeof args !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(args)) {
        if (v === null || typeof v === 'undefined') continue;
        if (typeof v === 'string') parts.push(`${k}="${v}"`);
        else parts.push(`${k}=${JSON.stringify(v)}`);
    }
    return parts.join(', ');
}

function buildToolExecutionInfo(toolCalls) {
    const calls = Array.isArray(toolCalls) ? toolCalls : [];
    if (!calls.length) return null;

    const uniqueNames = [];
    const seen = new Set();
    for (const c of calls) {
        const n = c?.name || 'unknownTool';
        if (!seen.has(n)) { seen.add(n); uniqueNames.push(n); }
    }

    const summary = `Ausführen: ${uniqueNames.join(', ')}`;
    const detailsLines = calls.map(c => {
        const name = c?.name || 'unknownTool';
        const argsStr = formatToolCallArgs(c?.args);
        return argsStr ? `${name}(${argsStr})` : `${name}()`;
    });

    return {
        summary,
        details: detailsLines.join('\n'),
        calls: calls
    };
}

function generateContentHash(str) {
    let hash = 0;
    if (!str || str.length === 0) return 'hash_0';
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash | 0; 
    }
    return 'hash_' + hash;
}

/**
 * Verschiebt die AI Zone je nach Kontext.
 * position = 'top' -> Oben im Chat (Prepend)
 * position = 'bottom' -> Unter dem Editor-Block (InsertAfter)
 */
function repositionCopilotZone(position) {
    const zone = document.getElementById('tradeo-ai-copilot-zone');
    const mainContainer = document.getElementById('conv-layout-main');
    const editorBlock = document.querySelector('.conv-reply-block');

    if (!zone || !mainContainer) return;

    if (position === 'bottom' && editorBlock) {
        // Verschiebe Zone NACH dem Editor-Block
        // (InsertAfter Logic via insertBefore + nextSibling)
        editorBlock.parentNode.insertBefore(zone, editorBlock.nextSibling);
    } else {
        // Standard: Schiebe Zone wieder ganz nach oben
        mainContainer.prepend(zone);
    }
}

/**
 * Setzt UI und Speicher zurück, um einen "Frischen Start" zu erzwingen.
 */
async function resetUiToLoadingState() {
    console.log("Tradeo AI: 🔄 Neuer Inhalt! Resetting UI & Cache...");
    
    const ticketId = getTicketIdFromUrl();
    if (!ticketId) return;

    // 1. WICHTIG: Cache löschen, damit keine alten Antworten geladen werden
    await chrome.storage.local.remove(`draft_${ticketId}`);
    
    // 2. Internen State leeren (ABER lastThreadText behalten!)
    const preservedThreadText = window.aiState.lastThreadText; // <--- Sichern
    
    window.aiState.lastDraft = "";
    window.aiState.chatHistory = [];
    
    // Wichtig: auch ggf. gecachte Tool-Ergebnisse für dieses Ticket löschen
    if (window.aiState.lastToolDataByCid) {
        delete window.aiState.lastToolDataByCid[ticketId];
    }
    // Wiederherstellen für den Observer
    window.aiState.lastThreadText = preservedThreadText; // <--- Zurückschreiben

    // 3. UI Elemente holen
    const copilotZone = document.getElementById('tradeo-ai-copilot-zone');
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    const inputArea = document.getElementById('tradeo-ai-input');
    const mainContainer = document.getElementById('conv-layout-main');

    // 4. UI Reset durchführen
    if (copilotZone && mainContainer) {
        // Zwingend wieder ganz nach oben schieben (falls FreeScout was davor geschoben hat)
        mainContainer.prepend(copilotZone);
        
        // Einklappen (Overlay und Expand-Button wieder aktivieren)
        copilotZone.classList.add('tradeo-collapsed');
    }

    if (dummyDraft) {
        // Platzhalter anzeigen
        dummyDraft.innerHTML = '<em>🤖 Neuer Thread erkannt! Analysiere Ticket neu...</em>';
        dummyDraft.style.display = 'block';
        
        // Visuellen Effekt auslösen
        flashElement(dummyDraft); 
    }

    if (historyContainer) {
        // Chatverlauf komplett leeren
        historyContainer.innerHTML = '';
    }
    
    if (inputArea) {
        inputArea.value = '';
    }

    // 5. Prozess neu anstoßen
    // Da der Cache gelöscht ist, wird handleStartupSync jetzt runAI(true) feuern -> Live Generierung
    handleStartupSync(ticketId);
}

/**
 * Extrahiert die Conversation ID aus der URL.
 * FreeScout URL Format: /conversation/{id}/{slug}
 */
function getCurrentConversationId() {
    try {
        const match = window.location.href.match(/conversation\/(\d+)/);
        return match ? match[1] : 'UNKNOWN';
    } catch (e) {
        return 'ERR_EXTRACT';
    }
}

// --- HELPER: Scroll to Bottom ---
function scrollToBottom() {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if (historyContainer) {
        // Wir setzen es auf scrollHeight, um ganz nach unten zu springen
        historyContainer.scrollTop = historyContainer.scrollHeight;
    }
}

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
    // 1. AI Button erstellen (Blitz)
    const aiBtn = originalReplyBtn.cloneNode(true);
    aiBtn.classList.add('tradeo-ai-toolbar-btn');
    aiBtn.setAttribute('title', 'Mit AI Antworten');
    const icon = aiBtn.querySelector('.glyphicon') || aiBtn;
    if(icon) { icon.classList.remove('glyphicon-share-alt'); icon.classList.add('glyphicon-flash'); }
    
    // Einfügen NACH dem Original-Button
    originalReplyBtn.parentNode.insertBefore(aiBtn, originalReplyBtn.nextSibling);
    
    // 2. Neuer "Reset" Button (Nur aktuelles Ticket)
    // Soll genau so aussehen wie der alte
    const singleResetBtn = document.createElement('button'); 
    singleResetBtn.className = 'btn btn-default tradeo-ai-reset-btn'; 
    singleResetBtn.innerHTML = '<i class="glyphicon glyphicon-refresh"></i> Reset';
    singleResetBtn.setAttribute('title', 'Dieses Ticket neu einlesen & AI zurücksetzen');
    singleResetBtn.style.marginRight = "4px"; // Kleiner Abstand zum Full Reset
    
    // Einfügen NACH dem AI-Button
    aiBtn.parentNode.insertBefore(singleResetBtn, aiBtn.nextSibling);

    // 3. Umbenannter "FULL AI Reset" Button (Alles löschen)
    const fullResetBtn = document.createElement('button'); 
    fullResetBtn.className = 'btn btn-default tradeo-ai-reset-btn'; 
    fullResetBtn.innerHTML = '<i class="glyphicon glyphicon-trash"></i> FULL AI Reset';
    fullResetBtn.setAttribute('title', 'ACHTUNG: Löscht ALLE gespeicherten Daten aller Tickets (Globaler Reset)');
    
    // Einfügen NACH dem Single Reset Button
    singleResetBtn.parentNode.insertBefore(fullResetBtn, singleResetBtn.nextSibling);

    // --- Event Listener ---

    // Logic: Single Ticket Reset
    singleResetBtn.addEventListener('click', function(e) {
        e.preventDefault(); 
        e.stopPropagation();
        performSingleTicketReset();
    });

    // Logic: Full Reset (Global)
    fullResetBtn.addEventListener('click', function(e) {
        e.preventDefault(); 
        e.stopPropagation();
        // Bestätigung optional, da "destruktiv"
        if(confirm("Wirklich ALLES zurücksetzen? Dies löscht das Gedächtnis der AI für ALLE Tickets.")) {
            performFullReset();
        }
    });

    // Logic: AI Button (Blitz)
    aiBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        expandInterface(false); 
        originalReplyBtn.click();
        window.aiState.isRealMode = true; window.aiState.preventOverwrite = false;
        waitForSummernote(function(editable) {
            const content = window.aiState.lastDraft || document.getElementById('tradeo-ai-dummy-draft').innerHTML;
            setEditorContent(editable, content);
            document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        });
    });

    // Logic: Original Button Hooks
    originalReplyBtn.addEventListener('click', () => {
        window.aiState.isRealMode = true;
        if(window.aiState.isGenerating) window.aiState.preventOverwrite = true;
    });

    // Logic: Send Button & Enter
    document.getElementById('tradeo-ai-send-btn').addEventListener('click', () => runAI());

    document.getElementById('tradeo-ai-input').addEventListener('keydown', (e) => { 
        if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAI(); }
    });
}

function setupEditorObserver() {
    const editorBlock = document.querySelector('.conv-reply-block');
    if (!editorBlock) return;

    // Initial Check
    const isInitiallyHidden = editorBlock.classList.contains('hidden') || editorBlock.style.display === 'none';
    if (!isInitiallyHidden) {
        repositionCopilotZone('bottom');
    }

    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                const isHidden = editorBlock.classList.contains('hidden') || editorBlock.style.display === 'none';
                
                const dummy = document.getElementById('tradeo-ai-dummy-draft');
                
                if (isHidden) {
                    // --- EDITOR IST ZU (Lesemodus) ---
                    window.aiState.isRealMode = false; 
                    window.aiState.preventOverwrite = false;
                    
                    // Zone nach OBEN schieben
                    repositionCopilotZone('top');

                    if (dummy) {
                        if(window.aiState.lastDraft) dummy.innerHTML = window.aiState.lastDraft;
                        dummy.style.display = 'block';
                    }
                } else {
                    // --- EDITOR IST OFFEN (Schreibmodus) ---
                    
                    // Zone nach UNTEN schieben (unter den Editor)
                    repositionCopilotZone('bottom');

                    // WICHTIG: Dummy Draft NICHT verstecken, sondern anzeigen (als Referenz)
                    if(dummy) {
                        // Optional: Styling anpassen, damit es eher wie eine "Referenz" aussieht
                        dummy.style.display = 'block'; 
                    }
                }
            }
        });
    }).observe(editorBlock, { attributes: true });
}

async function runAI(isInitial = false) {
    const btn = document.getElementById('tradeo-ai-send-btn');
    const input = document.getElementById('tradeo-ai-input');
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    const cid = getTicketIdFromUrl() || "UNKNOWN";

    const lock = await acquireLock(cid, 'live');
    if (lock === 'WAIT') {
        renderChatMessage('system', '⏳ Hintergrundanalyse läuft gerade – bitte kurz erneut senden.');
        return;
    }
    if (lock === false) return;

    const storageData = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = storageData.geminiApiKey;

    let userPrompt = "";
    if (isInitial) {
        userPrompt = "Analysiere das Ticket und erstelle einen Entwurf.";
    } else { 
        userPrompt = input.value.trim();
        if (!userPrompt) {
            await releaseLock(cid);
            return; 
        }
        renderChatMessage('user', userPrompt); 
        window.aiState.chatHistory.push({ type: "user", content: userPrompt }); 
    }

    if (!apiKey) {
        renderChatMessage('system', "⚠️ Kein API Key gefunden.");
        await releaseLock(cid);
        return; 
    }

    window.aiState.isGenerating = true;
    if(btn) { btn.disabled = true; btn.innerText = "⏳"; }

    const contextText = extractContextFromDOM(document);
    const currentDraft = window.aiState.isRealMode ? document.querySelector('.note-editable')?.innerHTML : dummyDraft.innerHTML;

    const historyString = window.aiState.chatHistory.map(e => {
        if(e.type === 'draft') return ""; 
        const role = e.type === 'user' ? 'User' : 'AI';
        return `${role}: ${e.content}`;
    }).join("\n");

    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-3-pro"); 
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

    // 1. START: Karen Bubble erstellen (UI)
    const karenStartText = "Karen prüft, ob wir aus Plenty Daten brauchen...";
    const karenBubble = renderKarenBubble(karenStartText);

    // 2. START: History Eintrag synchron halten (WICHTIG für Reload)
    window.aiState.chatHistory.push({ type: "system", content: karenStartText });

    const primaryTask = async () => {
        // --- PHASE 1: PLAN ---
        
        const lastToolData = (window.aiState.lastToolDataByCid && window.aiState.lastToolDataByCid[cid]) ? window.aiState.lastToolDataByCid[cid] : null;
        const plan = await analyzeToolPlan(contextText, userPrompt, currentDraft, lastToolData, cid);

        // "Triggerhappy" Schutz
        const forceRefresh = wantsFreshData(userPrompt);
        const editOnly = isLikelyEditOnly(userPrompt);
        let toolCallsToExecute = Array.isArray(plan.tool_calls) ? plan.tool_calls : [];
        
        if (!forceRefresh && lastToolData && toolCallsToExecute.length > 0) {
            console.log(`[CID: ${cid}] Unterdrücke neue Tool-Abfragen: vorhandene Daten vorhanden und kein expliziter Refresh.`);
            toolCallsToExecute = [];
        } else if (!forceRefresh && editOnly && toolCallsToExecute.length > 0) {
            console.log(`[CID: ${cid}] Planner wollte Tools, aber Prompt ist Edit-Only. Unterdrücke neue Abfragen.`);
            toolCallsToExecute = [];
        }

        // --- UPDATE KAREN BUBBLE (PLAN) ---
        const toolExec = buildToolExecutionInfo(toolCallsToExecute);
        
        // Konstanten für konsistente Nachrichten (Live & Cache)
        const MSG_TOOLS_SKIPPED_CACHE = "♻️ Keine neuen Tool-Aufrufe (Daten vorhanden).";
        const MSG_NO_TOOLS_NEEDED = "✅ Keine Datenabfrage nötig.";

        if (toolExec) {
            // Zeige an, welche Tools geplant sind
            updateKarenBubble(karenBubble, toolExec.summary, toolExec.details);
            
            // History Update: Wir merken uns, was Karen getan hat
            window.aiState.chatHistory.push({
                type: "tool_exec",
                summary: toolExec.summary,
                details: toolExec.details,
                calls: toolExec.calls
            });
        } else {
            // Keine Tools nötig
            let noToolsMsg = "";
            if (lastToolData) {
                noToolsMsg = MSG_TOOLS_SKIPPED_CACHE;
            } else {
                noToolsMsg = MSG_NO_TOOLS_NEEDED;
            }
            
            updateKarenBubble(karenBubble, noToolsMsg, null);
            window.aiState.chatHistory.push({ type: "system", content: noToolsMsg });
        }

        // --- PHASE 2: EXECUTE (JS) ---
        let gatheredData = null;
        if (toolCallsToExecute.length > 0) {
            gatheredData = await executePlannedToolCalls(toolCallsToExecute, cid);
            window.aiState.lastToolDataByCid = window.aiState.lastToolDataByCid || {};
            window.aiState.lastToolDataByCid[cid] = gatheredData;
        } else {
            gatheredData = lastToolData;
        }

        // --- KAREN FINISH & KEVIN START ---
        // 1. Karen grün machen
        // FIX: Hier nutzen wir exakt dieselben Strings wie oben für Konsistenz
        let finalStatus = "";
        if (toolExec) {
            finalStatus = toolExec.summary;
        } else if (lastToolData) {
            finalStatus = MSG_TOOLS_SKIPPED_CACHE;
        } else {
            finalStatus = MSG_NO_TOOLS_NEEDED;
        }

        updateKarenBubble(karenBubble, finalStatus, toolExec ? toolExec.details : null, true);

        // 2. Kevin Bubbles sofort anzeigen (Loading State)
        const draftPlaceholder = renderDraftMessage(null, true);
        const reasoningPlaceholder = renderReasoningMessage(null, null, true);


        // --- PHASE 3: GENERATE ---
        const generatorPrompt = `
${workerPrompt}

=== HINTERGRUND-DATEN (PLENTY API ERGEBNISSE) ===
Falls hier "null" steht, wurden für diese Runde keine neuen Daten abgefragt – nutze dann den aktuellen Entwurf als Faktenbasis.
Wenn Daten vorhanden sind: Nutze sie als Faktenbasis. Wenn Felder fehlen oder ok=false ist, sage das kurz und frage gezielt nach.
WICHTIG: Du darfst KEINE Tools/Funktionen aufrufen – die Datenbeschaffung ist abgeschlossen.
${gatheredData ? JSON.stringify(gatheredData, null, 2) : "null"}

=== TICKET VERLAUF ===
${contextText}

=== CHAT HISTORIE (Kontext) ===
${historyString}

=== AKTUELLER ENTWURF ===
"${currentDraft}"

=== ANWEISUNG ===
${userPrompt}

AUFGABE:
Gib NUR ein JSON-Objekt zurück im Format:
{
  "draft": "<html>...</html>",
  "reasoning": "kurze interne Begründung",
  "feedback": "kurzer Status/Headline"
}
`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: generatorPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const response = await callGeminiWithRotation(payload, currentModel);
        let rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        rawText = stripGeminiJson(rawText);

        try {
            const jsonResp = JSON.parse(rawText);
            if(!jsonResp.draft && jsonResp.text) jsonResp.draft = jsonResp.text;
            
            // Result an die Handler weitergeben (mit Referenz auf die Placeholders)
            return { result: jsonResp, placeholders: { draft: draftPlaceholder, reasoning: reasoningPlaceholder } };

        } catch (e) {
            return { 
                result: { 
                    draft: rawText.replace(/\n/g, '<br>'), 
                    feedback: "Hinweis: AI Formatierung war kein JSON (Rohdaten)."
                },
                placeholders: { draft: draftPlaceholder, reasoning: reasoningPlaceholder }
            };
        }
    };

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), dynamicTimeoutMs)
    );

    try {
        // Wir erwarten jetzt ein Objekt { result: ..., placeholders: ... }
        const finalData = await Promise.race([primaryTask(), timeoutPromise]);
        
        handleAiSuccess(
            finalData.result, 
            isInitial, 
            input, 
            dummyDraft, 
            cid, 
            finalData.placeholders // Neue Params
        );

    } catch (error) {
        console.warn(`[CID: ${cid}] Tradeo AI: Abbruch (${error.message}). Starte Fallback.`);

        try {
            // FALLBACK LOGIC
            let fallbackPrompt = `
ACHTUNG: Die vorherige Verarbeitung ist fehlgeschlagen (${error.message}).
Bitte erstelle jetzt sofort eine Antwort basierend NUR auf dem Text.
Versuche NICHT, Tools zu nutzen.
Ursprüngliche Anweisung: ${userPrompt || "Analysiere Ticket"}
`;
            let contents = [{
                role: "user",
                parts: [{ text: `
${workerPrompt}
=== TICKET VERLAUF ===
${contextText}
=== CHAT HISTORIE ===
${historyString}
=== NOTFALL MODUS ===
${fallbackPrompt}
`}]
            }];
            
            // Rendere Placeholder für Fallback falls noch nicht da
            const fbDraftEl = renderDraftMessage(null, true);
            const fbReasonEl = renderReasoningMessage(null, null, true);

            const fallbackResponse = await executeGeminiLoop(contents, cid);
            
            handleAiSuccess(
                fallbackResponse, 
                isInitial, 
                input, 
                dummyDraft, 
                cid, 
                { draft: fbDraftEl, reasoning: fbReasonEl }
            );

        } catch (fallbackError) {
            renderChatMessage('system', "❌ Fallback fehlgeschlagen.");
            console.error(`[CID: ${cid}] Fallback Error:`, fallbackError);
        }
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Go"; }
        window.aiState.isGenerating = false; 
        await releaseLock(cid);
    }
}

// Helper: Gemeinsame Erfolgsverarbeitung für Main & Fallback
function handleAiSuccess(finalResponse, isInitial, input, dummyDraft, ticketId, placeholders = null) {
    if (!finalResponse) throw new Error("Keine Antwort erhalten");

    // 1. Draft rendern (Update des Placeholders falls vorhanden)
    const targetDraftEl = placeholders ? placeholders.draft : null;
    renderDraftMessage(finalResponse.draft, false, targetDraftEl);
    
    window.aiState.chatHistory.push({ type: "draft", content: finalResponse.draft });
    
    // 2. Feedback & Reasoning rendern
    if (finalResponse.feedback || finalResponse.reasoning) {
        const feedbackText = finalResponse.feedback || "Antwort erstellt.";
        const reasoningText = finalResponse.reasoning || ""; 
        
        const targetReasonEl = placeholders ? placeholders.reasoning : null;
        renderReasoningMessage(feedbackText, reasoningText, false, targetReasonEl);
        
        window.aiState.chatHistory.push({ 
            type: "reasoning", 
            summary: feedbackText, 
            details: reasoningText 
        });
    }
    
    window.aiState.lastDraft = finalResponse.draft;
    
    // Editor Logik
    if (window.aiState.isRealMode && !window.aiState.preventOverwrite) {
        const editable = document.querySelector('.note-editable');
        if (editable) setEditorContent(editable, finalResponse.draft);
    } else {
        if(dummyDraft) dummyDraft.innerHTML = finalResponse.draft;
        if(!window.aiState.preventOverwrite && !window.aiState.isRealMode && dummyDraft) { 
            dummyDraft.style.display = 'block'; 
            flashElement(dummyDraft); 
        }
    }
    if(!isInitial && input) input.value = '';

    // Speichern
    if (ticketId) {
        const contextText = extractContextFromDOM(document);
        const currentHash = generateContentHash(contextText);

        const storageKey = `draft_${ticketId}`;
        chrome.storage.local.get([storageKey], function(res) {
            const oldData = res[storageKey] || {};
            const preservedInboxHash = oldData.inboxHash || "manual_live_" + Date.now();

            const newData = {
                draft: finalResponse.draft,
                feedback: finalResponse.feedback,
                chatHistory: window.aiState.chatHistory,
                lastToolData: (window.aiState.lastToolDataByCid && window.aiState.lastToolDataByCid[ticketId]) ? window.aiState.lastToolDataByCid[ticketId] : null,
                timestamp: Date.now (),
                inboxHash: preservedInboxHash,
                contentHash: currentHash 
            };
            
            const saveObj = {};
            saveObj[storageKey] = newData;
            chrome.storage.local.set(saveObj);
        });
    }
}

async function executeGeminiLoop(contents, cid) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    
    // Einfacher Aufruf ohne Tools
    const payload = { contents: contents };

    const data = await callGeminiWithRotation(payload, model);

    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
    
    const content = candidate.content;
    const parts = content.parts || []; 
    
    if (parts.length === 0) {
        console.warn("Tradeo AI: Gemini Content Parts sind leer.", candidate);
        throw new Error("GEMINI_SAFETY_FILTER_TRIGGERED");
    }

    let rawText = parts[0].text || "";
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    try { 
        let jsonResp = JSON.parse(rawText);
        if(!jsonResp.draft && jsonResp.text) jsonResp.draft = jsonResp.text;
        return jsonResp;
    } catch(e) { 
        return { 
            draft: rawText.replace(/\n/g, '<br>'), 
            feedback: "Hinweis: AI Formatierung war kein JSON (Rohdaten)." 
        }; 
    }
}

// Helper: Tool Ausführung ausgelagert
async function executeToolAction(fnName, fnArgs, cid) {
    let actionName = '';
    let actionPayload = {};

    if (fnName === 'fetchOrderDetails') {
        actionName = 'GET_ORDER_FULL'; actionPayload = { orderId: fnArgs.orderId };
    } else if (fnName === 'fetchItemDetails') {
        actionName = 'GET_ITEM_DETAILS'; actionPayload = { identifier: fnArgs.identifier };
    } else if (fnName === 'fetchCustomerDetails') {
        actionName = 'GET_CUSTOMER_DETAILS'; actionPayload = { contactId: fnArgs.contactId };
    } else if (fnName === 'searchItemsByText') {
        actionName = 'SEARCH_ITEMS_BY_TEXT';
        actionPayload = { 
            searchText: fnArgs.searchText, 
            mode: fnArgs.mode || 'nameAndDescription', 
            maxResults: fnArgs.maxResults || 30,
            onlyWithStock: (typeof fnArgs.onlyWithStock === 'boolean') ? fnArgs.onlyWithStock : true // Default true
        };
    }

    if (!actionName) return { error: "Unknown Tool" };
    // ... rest of function remains same
    const apiResult = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: actionName, ...actionPayload }, (response) => {
             if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
             else resolve(response);
        });
    });
    
    return apiResult && apiResult.success ? apiResult.data : { error: apiResult ? apiResult.error : "API Fail" };
}



// =============================================================================
// Planner-Worker Helpers (LLM plant, Extension führt aus)
// =============================================================================

// Heuristiken, um unnötige Tool-Re-Queries bei Folgeprompts (reine Umformulierungen) zu verhindern.
// "refresh" Keywords lassen bewusst neue Abfragen zu.
// UPDATE: Massive Erweiterung um Wortstämme wie "biet..." (biete, bieten, bietest), "prüf...", "check..." etc.
const FORCE_REFRESH_KEYWORDS_RE = /\b(nochmal|erneut|aktuell|refresh|neu\s*(?:laden|abfragen|prüfen|checken)|verifizieren|abgleichen|aktualisier\w*|such\w*|find\w*|schau\w*|guck\w*|abruf\w*|biet\w*|anbiet\w*|recherchier\w*|prüf\w*|check\w*|scan\w*|ermittel\w*)\b/i;

// Wenn der User *explizit* neue Fakten will, dürfen Tools laufen.
// UPDATE: Artikelnummern-Pattern und spezifische Hardware-Begriffe ergänzt.
const EXPLICIT_DATA_REQUEST_RE = /\b(bestell(?:status|nummer)?|order|tracking|liefer(?:status)?|versand|paket|lager(?:bestand)?|bestand|verfügbarkeit|preis|kundendaten|adresse|telefon|email|zoll|gewicht|herkunft|artikel|item|produkt|sku|ean|seriennummer|sn|modell)\b/i;

// Typische "nur umformulieren/ergänzen"-Prompts.
const EDIT_ONLY_RE = /\b(umformulieren|umformulierung|formuliere?n?|schreib\w*\s+um|korrigier\w*|rechtschreib\w*|ton(?:alität)?|freundlicher|kürzer|länger|struktur|format|unverändert|sonst\s+unverändert|nur\s+.*ergänz\w*|bitte\s+.*ergänz\w*|ergänz\w*|hinweis)\b/i;

function wantsFreshData(userPrompt) {
    const p = (userPrompt || "").trim();
    if (!p) return false;
    return FORCE_REFRESH_KEYWORDS_RE.test(p) || EXPLICIT_DATA_REQUEST_RE.test(p);
}

function isLikelyEditOnly(userPrompt) {
    const p = (userPrompt || "").trim();
    if (!p) return false;
    // Edit-Only nur dann, wenn NICHT gleichzeitig explizit nach neuen Daten gefragt wird.
    return EDIT_ONLY_RE.test(p) && !wantsFreshData(p);
}

function containsPlaceholderToken(s) {
    const str = String(s || "");
    // Beispiel: "c1.customer_contact_id" oder "c2.order.id" etc.
    return /\bc\d+\./i.test(str) || /\bfrom\b/i.test(str) || /\b\w+_from\b/i.test(str);
}

function validateAndNormalizeToolCall(call) {
    if (!call || typeof call !== 'object') return null;
    const name = call.name;
    const args = call.args || {};
    if (!name || typeof name !== 'string' || typeof args !== 'object') return null;

    // Drop placeholder args (keine "Verweise" zulassen)
    for (const k of Object.keys(args)) {
        if (containsPlaceholderToken(args[k])) return null;
    }

    if (name === 'fetchOrderDetails') {
        const orderId = String(args.orderId || "").trim();
        if (!orderId || !/^\d+$/.test(orderId)) return null;
        return { ...call, args: { orderId } };
    }

    if (name === 'fetchCustomerDetails') {
        const contactId = String(args.contactId || "").trim();
        if (!contactId || !/^\d+$/.test(contactId)) return null;
        return { ...call, args: { contactId } };
    }

    if (name === 'fetchItemDetails') {
        const identifier = String(args.identifier || "").trim();
        if (!identifier || identifier.length > 96) return null;
        return { ...call, args: { identifier } };
    }

    if (name === 'searchItemsByText') {
        const searchText = String(args.searchText || "").trim();
        if (!searchText || searchText.length < 3) return null;
        const mode = (args.mode === 'nameAndDescription' || args.mode === 'name') ? args.mode : 'name';
        
        let maxResults = Number(args.maxResults);
        if (!Number.isFinite(maxResults)) maxResults = 10;
        maxResults = Math.max(1, Math.min(25, Math.floor(maxResults)));
        
        // NEU: Boolean Check
        let onlyWithStock = true;
        if (typeof args.onlyWithStock === 'boolean') onlyWithStock = args.onlyWithStock;

        return { ...call, args: { searchText, mode, maxResults, onlyWithStock } };
    }

    return null;
}

function stripGeminiJson(rawText) {
    if (!rawText) return "";
    return rawText.replace(/```json/g, '').replace(/```/g, '').trim();
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/**
 * SCHRITT 1: Planner / Analyzer
 * Gibt NUR einen Plan zurück: welche vorhandenen Tools (fetchOrderDetails, fetchItemDetails, fetchCustomerDetails, searchItemsByText)
 * sollen mit welchen Args aufgerufen werden.
 */
async function analyzeToolPlan(contextText, userPrompt, currentDraft, lastToolData, cid) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";

    const safeDraft = (currentDraft || "").toString();
    const safeLast = lastToolData ? JSON.stringify(lastToolData) : "null";
    const trimmedLast = safeLast.length > 12000 ? safeLast.slice(0, 12000) + "\n... (gekürzt)" : safeLast;
    // Planner prompt is defined in systemPrompts.js (as const plannerPrompt)
    const fullPlannerPrompt = `${plannerPrompt}

=== TICKET VERLAUF ===
${contextText}

=== AKTUELLER ENTWURF (kann bereits alle Fakten enthalten) ===
${safeDraft}

=== LETZTE TOOL-ERGEBNISSE (falls vorhanden, zum Wiederverwenden) ===
${trimmedLast}

=== USER ANWEISUNG ===
${userPrompt}
`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: fullPlannerPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };

    const response = await callGeminiWithRotation(payload, model);
    const raw = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = stripGeminiJson(raw);

    let plan;
    try { plan = JSON.parse(cleaned); }
    catch (e) {
        console.error(`[CID: ${cid}] Planner JSON parse failed:`, e, cleaned);
        return { type: "plan", schema_version: "plan.v1", tool_calls: [], notes: "JSON_PARSE_ERROR", needs_more_info: [] };
    }

    // Minimal Validation / Sanitization
    if (!isPlainObject(plan)) plan = { type: "plan", schema_version: "plan.v1", tool_calls: [] };
    if (!Array.isArray(plan.tool_calls)) plan.tool_calls = [];

    const allowed = new Set(["fetchOrderDetails","fetchItemDetails","fetchCustomerDetails","searchItemsByText"]);
    plan.tool_calls = plan.tool_calls
        .filter(c => isPlainObject(c) && allowed.has(c.name) && isPlainObject(c.args))
        .slice(0, 6)
        .map((c, idx) => ({
            call_id: typeof c.call_id === 'string' && c.call_id ? c.call_id : `c${idx+1}`,
            name: c.name,
            args: c.args,
            purpose: typeof c.purpose === 'string' ? c.purpose : ""
        }))
        // harte Validierung (keine Platzhalter wie "c1.xxx")
        .map(validateAndNormalizeToolCall)
        .filter(Boolean);

    if (!Array.isArray(plan.needs_more_info)) plan.needs_more_info = [];
    if (typeof plan.notes !== 'string') plan.notes = "";
    plan.type = "plan";
    plan.schema_version = plan.schema_version || "plan.v1";

    return plan;
}

/**
 * SCHRITT 2: Worker / Executor
 * Führt die Tool-Calls parallel aus (über bestehendes executeToolAction).
 * Liefert ein kompaktes Ergebnisobjekt für den Generator.
 */
async function executePlannedToolCalls(toolCalls, cid) {
    const gathered = {
        meta: { executedAt: new Date().toISOString(), cid },
        order: null,
        customer: null,
        items: [],
        searchResults: null,
        raw: [] // für Debug
    };

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return gathered;

    // Dedup (name + args)
    const seen = new Set();
    const unique = [];
    for (const c of toolCalls) {
        const key = `${c.name}::${JSON.stringify(c.args)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(c);
    }

    const results = await Promise.all(unique.map(async (c) => {
        const data = await executeToolAction(c.name, c.args, cid);
        const ok = !(data && typeof data === 'object' && data.error);
        return { call_id: c.call_id, name: c.name, args: c.args, ok, data };
    }));

    gathered.raw = results;

    for (const r of results) {
        if (r.name === 'fetchOrderDetails') gathered.order = r;
        else if (r.name === 'fetchCustomerDetails') gathered.customer = r;
        else if (r.name === 'fetchItemDetails') gathered.items.push(r);
        else if (r.name === 'searchItemsByText') gathered.searchResults = r;
    }

    return gathered;
}

// --- STANDARD UTILS ---

// --- DEBUGGING / KONSOLE ---
// Wurde umgebaut von window.resetAI zu interner Funktion für den Button
async function performFullReset() {
    console.log("💣 Tradeo AI: Starte kompletten Reset...");
    
    // 1. Storage bereinigen (Nur Ticket-Daten, API Key behalten)
    try {
        const allData = await chrome.storage.local.get(null);
        const keysToRemove = Object.keys(allData).filter(key => key.startsWith('draft_'));
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`🗑️ Storage: ${keysToRemove.length} Tickets/Entwürfe gelöscht.`);
        } else {
            console.log("ℹ️ Storage: War bereits sauber.");
        }
    } catch (e) {
        console.error("Fehler beim Storage-Reset:", e);
    }

    // 2. RAM State resetten
    if (window.aiState) {
        window.aiState.knownTickets = new Map();
        window.aiState.processingQueue = new Set();
        window.aiState.chatHistory = [];
        window.aiState.lastDraft = "";
        window.aiState.lastToolDataByCid = {};
        console.log("🧠 RAM: State zurückgesetzt.");
    }

    // 3. UI Feedback
    const historyDiv = document.getElementById('tradeo-ai-chat-history');
    if (historyDiv) historyDiv.innerHTML = '<div style="padding:20px; text-align:center; color:#856404; background:#fff3cd; border:1px solid #ffeeba; margin:10px; border-radius:4px;"><strong>♻️ Reset erfolgreich!</strong><br>Der Verlauf wurde gelöscht.<br>Lade AI neu...</div>';
    
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    if (dummyDraft) dummyDraft.innerHTML = '<em>Reset...</em>';

    // 4. Automatisch neu starten nach kurzem Delay
    setTimeout(() => {
        console.log("🔄 Starte AI neu...");
        runAI(true); // Neustart mit Initial-Prompt
    }, 1500);
}

function getTicketIdFromUrl() {
    const match = window.location.href.match(/conversation\/(\d+)/);
    return match ? match[1] : null;
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

// Render Funktion für Text (Blau/Weiß)
function renderChatMessage(role, text) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;
    const msgDiv = document.createElement('div');
    
    // role kann 'user', 'ai' oder 'system' sein
    if (role === 'user') { 
        msgDiv.className = 'user-msg'; 
        msgDiv.innerHTML = `<strong>DU</strong> ${text}`; 
    } else if (role === 'ai') { 
        msgDiv.className = 'ai-msg'; 
        msgDiv.innerHTML = `<strong>AI</strong> ${text}`; 
    } else { 
        msgDiv.className = 'ai-msg'; 
        msgDiv.style.fontStyle = 'italic'; 
        msgDiv.innerHTML = text; 
    }
    
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

// Render Funktion für Warnungen (Orange Box)
function renderWarningMessage(text) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'warning-msg'; 
    msgDiv.innerHTML = `<strong>⚠️ System-Hinweis</strong>${text}`;
    
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

function setupResizeHandler() {
    const resizer = document.getElementById('tradeo-ai-resize-handle');
    const chatHistory = document.getElementById('tradeo-ai-chat-history');
    
    if (resizer && chatHistory) {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = chatHistory.offsetHeight;
            
            const doDrag = (e) => {
                // Berechne neue Höhe
                const newHeight = startHeight + (e.clientY - startY);
                
                if (newHeight >= 120) {
                    chatHistory.style.height = newHeight + 'px';
                    // FIX: Bottom Sticky während des Resizens erzwingen
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }
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

/**
 * Führt einen Gemini API Call mit Key-Rotation durch.
 * Wenn ein Key ein Rate-Limit (429) hat, wird der nächste versucht.
 */
async function callGeminiWithRotation(payload, model) {
    // 1. Keys aus Storage holen
    const storage = await chrome.storage.local.get(['geminiApiKeys', 'geminiApiKey']);
    let keys = storage.geminiApiKeys;

    // Fallback für alte Installationen
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
        if (storage.geminiApiKey) keys = [storage.geminiApiKey];
        else throw new Error("Kein Gemini API Key gefunden. Bitte in den Einstellungen hinterlegen.");
    }

    // --- SAFETY SETTINGS HINZUFÜGEN (WICHTIG!) ---
    // Verhindert "parts.length 0" bei Wörtern wie "kill", "dead", "attack" etc.
    if (!payload.safetySettings) {
        payload.safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ];
    }
    // ---------------------------------------------

    let lastError = null;

    // 2. Loop durch die Keys
    for (let i = 0; i < keys.length; i++) {
        const currentKey = keys[i];
        const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${currentKey}`;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // 3. Fehlerbehandlung
            if (!response.ok) {
                // WICHTIG: 429 = Resource Exhausted (Rate Limit)
                if (response.status === 429) {
                    console.warn(`Tradeo AI: Key ${i+1} Rate Limit (429). Wechsle zum nächsten Key...`);
                    continue; // Springe zum nächsten Key im Loop
                }
                
                // Bei anderen Fehlern (z.B. 400 Bad Request) bringt Key-Wechsel nichts -> Fehler werfen
                const errData = await response.json();
                throw new Error(errData.error?.message || `API Error: ${response.status}`);
            }

            // 4. Erfolg!
            return await response.json();

        } catch (error) {
            lastError = error;
            // Wenn es ein Netzwerkfehler war, ggf. auch rotieren? 
            if (error.message.includes("API Error") && !error.message.includes("429")) {
                 throw error; // Harter API Fehler (z.B. Bad Request) -> Abbruch
            }
        }
    }

    // Wenn wir hier ankommen, haben alle Keys versagt
    throw new Error(`Alle ${keys.length} API Keys fehlgeschlagen. Letzter Fehler: ${lastError?.message}`);
}

// --- BOOTSTRAP ---
function bootstrapTradeo() {
    startHeartbeat();                 // deine bestehende Logik (AI-UI etc.)
    initPlentyApiDebugButtons(); // unser neuer Debug-Button
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapTradeo);
} else {
    bootstrapTradeo();
}


// --- PLENTY BRIDGE ---
async function callPlenty(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'PLENTY_API_CALL',
            endpoint: endpoint,
            method: method,
            body: body
        }, (response) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            if (response && response.success) {
                resolve(response.data);
            } else {
                // Wenn Auth fehlt -> Settings öffnen
                if (response && response.authRequired) {
                    const panel = document.getElementById('tradeo-ai-settings-panel');
                    if(panel) {
                        panel.classList.add('visible');
                        document.getElementById('tradeo-settings-status').innerText = "⚠️ Bitte Plenty Zugangsdaten eingeben!";
                        document.getElementById('tradeo-settings-status').style.color = "red";
                        expandInterface(); // Aufklappen damit man es sieht
                    }
                }
                reject(response ? response.error : "Unknown Error");
            }
        });
    });
}

// Test-Funktion für die Konsole (damit du siehst, ob es klappt)
window.testPlentyConnection = async function() {
    console.log("Test: Rufe Auftragsstatus ab...");
    try {
        // Beispiel: Hole die erste Seite der Aufträge (nur zum Test)
        const data = await callPlenty('/rest/orders?itemsPerPage=1');
        console.log("✅ Plentymarkets Verbindung erfolgreich!", data);
        alert("Verbindung zu Plentymarkets steht! Check Konsole für Daten.");
    } catch (e) {
        console.error("❌ Verbindung fehlgeschlagen:", e);
        alert("Fehler bei Plenty Verbindung: " + e);
    }
};

function initPlentyApiDebugButtons() {
    if (window.__plentyDebugBtnInit) return;
    window.__plentyDebugBtnInit = true;

    // Helper zum Erstellen von Buttons
    const createBtn = (id, text, bottomPx, onClick) => {
        const btn = document.createElement("button");
        btn.id = id;
        btn.textContent = text;
        btn.style.cssText = `
            position: fixed;
            bottom: ${bottomPx}px;
            right: 10px;
            z-index: 99999;
            padding: 6px 10px;
            font-size: 11px;
            background: #222;
            color: #fff;
            border-radius: 4px;
            border: 1px solid #555;
            cursor: pointer;
            opacity: 0.7;
            font-family: system-ui, sans-serif;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            text-align: left;
            min-width: 180px;
        `;
        btn.addEventListener("mouseenter", () => btn.style.opacity = "1");
        btn.addEventListener("mouseleave", () => btn.style.opacity = "0.7");
        btn.addEventListener("click", onClick);
        document.body.appendChild(btn);
    };

    // 1. Button: Search Items (Textsuche) - Ganz unten
    createBtn("tradeo-plenty-debug-btn", "🧪 Item Search Debug", 10, async () => {
        const defaultSearch = "1.8tb 12g sas 10k festplatte dell 14g";
        const last = window.__lastPlentyDebugSearch || defaultSearch;
        const input = prompt("Plenty Artikelsuche Debug – Suchtext eingeben:", last);
        if (!input) return;
        window.__lastPlentyDebugSearch = input;
        await window.debugPlentyItemSearch(input);
    });

    // 2. Button: Item Details (Identifier) - Mitte unten
    createBtn("tradeo-plenty-details-btn", "📦 Item Details Debug", 50, async () => {
        const defaultId = "HMAA4GR7AJR8N-XN"; 
        const last = window.__lastPlentyDebugDetails || defaultId;
        const input = prompt("Plenty Item Details Debug – Identifier eingeben (ID, Nummer, MPN):", last);
        if (!input) return;
        window.__lastPlentyDebugDetails = input;
        await window.debugPlentyItemDetails(input);
    });

    // 3. Button: Customer Details (Contact ID) - Mitte oben
    createBtn("tradeo-plenty-customer-btn", "👤 Customer Details Debug", 90, async () => {
        // Versuchen, eine Customer ID aus dem DOM zu extrahieren (als Default)
        let defaultId = "278542";
        const customerLink = document.querySelector('.customer-name');
        if (customerLink) {
            const match = customerLink.href.match(/customers\/(\d+)/);
            if (match) defaultId = match[1];
        }

        const last = window.__lastPlentyCustomerDebug || defaultId;
        const input = prompt("Plenty Customer Debug – Contact ID eingeben:", last);
        if (!input) return;
        window.__lastPlentyCustomerDebug = input;
        await window.debugCustomerDetails(input);
    });

    // 4. Button: Order Details (Order ID) - Oben
    createBtn("tradeo-plenty-order-btn", "🛒 Order Details Debug", 130, async () => {
        const defaultId = "581866"; // Beispiel ID
        const last = window.__lastPlentyOrderDebug || defaultId;
        const input = prompt("Plenty Order Debug – Order ID eingeben:", last);
        if (!input) return;
        window.__lastPlentyOrderDebug = input;
        await window.debugOrderDetails(input);
    });
}

window.debugPlentyItemSearch = async function(rawSearch) {
    const searchText = String(rawSearch || "").trim();
    if (!searchText) { alert("Bitte Suchtext eingeben."); return; }

    console.clear();
    console.group(`🚀 DEBUG: DB Item Search für "${searchText}"`);

    const t0 = performance.now();

    try {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'SEARCH_ITEMS_BY_TEXT',
                searchText,
                mode: 'nameAndDescription', // oder 'name'
                maxResults: 30,
                onlyWithStock: true // <--- NEU: Explizit setzen (Standard der AI)
            }, (res) => resolve(res));
        });

        const ms = (performance.now() - t0).toFixed(1);

        if (response && response.success) {
            console.log(`✅ Fertig in ${ms}ms`);
            console.log("META:", response.data?.meta);
            // Info: Sortierung ist jetzt automatisch nach stockNet absteigend
            console.table(response.data?.results || []);
            console.log("📋 JSON Output:");
            console.log(JSON.stringify(response.data, null, 2));
        } else {
            console.error("❌ Fehler:", response);
        }
    } catch (e) {
        console.error("🔥 Critical Error:", e);
    }

    console.groupEnd();
};

/**
 * NEUE DEBUG FUNKTION FÜR ITEM DETAILS
 * Simuliert exakt den Tool-Call, den die AI machen würde.
 */
window.debugPlentyItemDetails = async function(identifier) {
    console.clear();
    console.group(`🚀 DEBUG: fetchItemDetails für Identifier "${identifier}"`);
    console.log("⏳ Sende Anfrage an Background Script...");

    try {
        // Wir nutzen sendMessage, um exakt den Weg der AI zu simulieren (über background.js -> plentyApi.js)
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
                action: 'GET_ITEM_DETAILS', 
                identifier: identifier 
            }, (res) => resolve(res));
        });

        if (response && response.success) {
            console.log("✅ API Success! Rückgabe an die AI:");
            console.dir(response.data); // Interaktives Objekt
            
            // --- NEU: Preview der Text-Bereinigung ---
            if (response.data.item && response.data.item.texts && response.data.item.texts.length > 0) {
                const txt = response.data.item.texts[0];
                console.group("📝 Text Formatting Check");
                console.log("Name:", txt.name1);
                console.log("Description (Cleaned):", txt.description);
                console.log("TechData (Cleaned):", txt.technicalData);
                console.groupEnd();
            } else if (response.data.candidates && response.data.candidates.length > 0) {
                // Bei Multi-Match den ersten Kandidaten prüfen
                const txt = response.data.candidates[0].item.texts[0];
                console.group("📝 Text Formatting Check (Candidate 1)");
                console.log("Description (Cleaned):", txt ? txt.description : "N/A");
                console.groupEnd();
            }
            // -----------------------------------------

            console.log("📋 JSON Output (für Copy/Paste):");
            console.log(JSON.stringify(response.data, null, 2));

            // Kurze Analyse für den Entwickler
            if (response.data.meta && response.data.meta.type === "PLENTY_ITEM_AMBIGUOUS") {
                console.warn(`⚠️ Ergebnis ist MEHRDEUTIG. Gefundene Kandidaten: ${response.data.candidates.length}`);
            } else if (response.data.variation) {
                console.log(`ℹ️ Eindeutiger Treffer: ID ${response.data.variation.id}, Bestand (Net): ${calculateNetStockDebug(response.data.stock)}`);
            }
        } else {
            console.error("❌ API Error oder kein Ergebnis:", response);
            if (response && response.error) {
                console.error("Details:", response.error);
            }
        }

    } catch (e) {
        console.error("🔥 Critical Error during debug call:", e);
    }
    console.groupEnd();
};

// Kleiner Helper für die Konsolenausgabe des Bestands (nur Visualisierung)
function calculateNetStockDebug(stockEntries) {
    if (!Array.isArray(stockEntries)) return 0;
    return stockEntries.reduce((acc, entry) => {
        const net = parseFloat(entry.netStock || entry.stockNet || 0);
        return acc + (isNaN(net) ? 0 : net);
    }, 0);
}

/**
 * NEUE DEBUG FUNKTION FÜR CUSTOMER DETAILS
 * Simuliert den Tool-Call, den die AI machen würde, um Kundendaten zu holen.
 */
window.debugCustomerDetails = async function(contactId) {
    console.clear();
    console.group(`🚀 DEBUG: fetchCustomerDetails für Contact ID "${contactId}"`);
    console.log("⏳ Sende Anfrage an Background Script...");

    try {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
                action: 'GET_CUSTOMER_DETAILS', 
                contactId: contactId 
            }, (res) => resolve(res));
        });

        if (response && response.success) {
            console.log("✅ API Success! Rückgabe an die AI:");
            console.dir(response.data); // Interaktives Objekt
            
            // Kurze Übersicht
            if (response.data.contact) {
                console.group("👤 Kontakt-Check");
                console.log("ID:", response.data.contact.id);
                console.log("Name:", response.data.contact.firstName, response.data.contact.lastName);
                console.log("E-Mail:", response.data.contact.email);
                console.groupEnd();
            }

            if (response.data.recentOrders && Array.isArray(response.data.recentOrders)) {
                console.group(`📦 Letzte Bestellungen (${response.data.recentOrders.length})`);
                response.data.recentOrders.forEach(o => {
                    console.log(`Order ${o.id} vom ${new Date(o.createdAt).toLocaleDateString()} (Status: ${o.statusId})`);
                });
                console.groupEnd();
            }

            console.log("📋 JSON Output (für Copy/Paste):");
            console.log(JSON.stringify(response.data, null, 2));

        } else {
            console.error("❌ API Error oder kein Ergebnis:", response);
            if (response && response.error) {
                console.error("Details:", response.error);
            }
        }

    } catch (e) {
        console.error("🔥 Critical Error during debug call:", e);
    }
    console.groupEnd();
};

/**
 * NEUE DEBUG FUNKTION FÜR ORDER DETAILS
 * Simuliert den Tool-Call für Bestellinformationen.
 */
window.debugOrderDetails = async function(orderId) {
    console.clear();
    console.group(`🚀 DEBUG: fetchOrderDetails für Order ID "${orderId}"`);
    console.log("⏳ Sende Anfrage an Background Script...");

    try {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
                action: 'GET_ORDER_FULL', 
                orderId: orderId 
            }, (res) => resolve(res));
        });

        if (response && response.success) {
            console.log("✅ API Success! Rückgabe an die AI:");
            const data = response.data;
            console.dir(data); // Interaktives Objekt
            
            // Kurze Übersicht für schnellen Check
            if (data.order) {
                console.group("🛒 Order Check");
                console.log("ID:", data.order.id);
                console.log("Status:", `${data.order.statusId} (${data.order.statusName})`);
                console.log("Erstellt am:", new Date(data.order.createdAt).toLocaleString());
                console.groupEnd();
            }

            if (data.shippingInfo) {
                console.group("🚚 Versand & Tracking");
                console.log("Provider:", data.shippingInfo.provider);
                console.log("Profil:", data.shippingInfo.profileName);
                console.log("Zielland:", data.shippingInfo.destinationCountry);
                if (data.order.shippingPackages && data.order.shippingPackages.length > 0) {
                    console.table(data.order.shippingPackages.map(p => ({ PakrNr: p.packageNumber, Gewicht: p.weightG + 'g' })));
                } else {
                    console.warn("⚠️ Keine Paketnummern (shippingPackages) gefunden.");
                }
                console.groupEnd();
            }

            if (data.addresses && Array.isArray(data.addresses)) {
                console.group(`🏠 Adressen (${data.addresses.length})`);
                data.addresses.forEach(addr => {
                    console.log(`[${addr.relationType}] ${addr.name1 || ''} ${addr.name2 || ''}, ${addr.town} (${addr.countryName})`);
                });
                console.groupEnd();
            }

            console.log("📋 JSON Output (für Copy/Paste):");
            console.log(JSON.stringify(data, null, 2));

        } else {
            console.error("❌ API Error oder kein Ergebnis:", response);
            if (response && response.error) {
                console.error("Details:", response.error);
            }
        }

    } catch (e) {
        console.error("🔥 Critical Error during debug call:", e);
    }
    console.groupEnd();
};

// =============================================================================
// 🕵️ DEBUG: AI CONTEXT DUMP (PRETTY JSON)
// =============================================================================
(function debugDumpContextOnLoad() {
    const runDump = () => {
        const ticketView = document.getElementById('conv-layout-main');
        if (!ticketView) return;

        console.groupCollapsed("🕵️ Tradeo AI DEBUG: Ticket Context Preview");

        try {
            let ticketId = "UNKNOWN";
            const match = window.location.href.match(/conversation\/(\d+)/);
            if(match) ticketId = match[1];

            if (typeof extractContextFromDOM === 'function') {
                // 1. Den String holen, den die AI bekommt (minified)
                const rawJsonString = extractContextFromDOM(document);
                
                // 2. Für die Konsole hübsch machen (in Objekt zurückwandeln)
                let prettyData = "Fehler beim Parsen";
                try {
                    prettyData = JSON.parse(rawJsonString);
                } catch (e) {
                    prettyData = rawJsonString; // Fallback falls kein valides JSON
                }

                console.log(`%cTicket ID: ${ticketId}`, "font-weight:bold; color: #009fe3; font-size: 12px;");
                console.log(`%cToken-Effizienz: Gesendet wird MINIFIED JSON (Länge: ${rawJsonString.length} Zeichen).`, "color: #555; font-style: italic;");
                
                console.log("%c▼▼▼ AI KONTEXT (PRETTY OBJECT) ▼▼▼", "background: #222; color: #bada55; padding: 4px; font-weight: bold; display: block; margin-top: 10px;");
                
                // Hier loggen wir das echte Objekt -> Chrome macht es interaktiv/bunt
                console.log(prettyData);
                
                console.log("%c▲▲▲ ENDE ▲▲▲", "background: #222; color: #ff6b6b; padding: 4px; font-weight: bold; display: block; margin-bottom: 10px;");

            } else {
                console.error("❌ Funktion 'extractContextFromDOM' nicht gefunden.");
            }

        } catch (e) {
            console.error("❌ Fehler beim Debug-Dump:", e);
        }

        console.groupEnd();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runDump);
    } else {
        setTimeout(runDump, 1000); 
    }
})();