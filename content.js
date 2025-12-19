// --- KONFIGURATION ---
const API_VERSION = "v1beta";
const POLL_INTERVAL_MS = 2000; // Alle 2 Sekunden prüfen
const LOCK_TTL_MS = 180000; // 3 Minuten Timeout für verwaiste Locks
const AI_TIMEOUT_PER_TURN = 60000; // 60 Sekunden pro Turn
const AI_TIMEOUT_SLOW = 600000;     // 10 Min total für langsame Modelle (3 Pro)
const MAX_TURNS = 8; // Maximale Anzahl an Runden (Thought/Action Loops)

// Feature-Flag: Hintergrund-Überwachung / Pre-Fetch komplett abschalten
// (Revert: einfach auf true setzen)
const ENABLE_BACKGROUND_PREFETCH = true;

const DASHBOARD_FOLDERS_TO_SCAN = [
    "https://desk.tradeo.de/mailbox/3/27",  // Servershop24 -> Nicht zugewiesen
    "https://desk.tradeo.de/mailbox/3/155"  // Servershop24 -> Meine
    //"https://desk.tradeo.de/mailbox/3/29" // Servershop24 -> Zugewiesen
];

// SYSTEM PROMPTS
// NOTE: workerPrompt & plannerPrompt wurden nach systemPrompts.js ausgelagert.
// Model Definitionen
const AI_MODELS = {
    "gemini-2.5-flash-lite": { id: "gemini-2.5-flash-lite", label: "2.5 Flash Lite", dropdownText: "gemini-2.5-flash-lite (sehr schnell)" },
    "gemini-2.5-flash": { id: "gemini-2.5-flash", label: "2.5 Flash", dropdownText: "gemini-2.5-flash (schnell)" },
    "gemini-2.5-pro": { id: "gemini-2.5-pro", label: "2.5 Pro", dropdownText: "gemini-2.5-pro (standard)" },
    //"gemini-3-pro-preview": { id: "gemini-3-pro-preview", label: "3 Pro", dropdownText: "gemini-3-pro-preview (langsam)" }
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

    // 3. Polling nur, wenn Background-Prefetch aktiv ist
    if (ENABLE_BACKGROUND_PREFETCH) {
        setInterval(() => {
            runLifecycleCheck();
        }, POLL_INTERVAL_MS);
    }
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
        // Inbox-Scan nur, wenn Background-Prefetch aktiv ist
        if (ENABLE_BACKGROUND_PREFETCH) scanInboxTable();
    } 
    
    // 2. Globaler Hintergrund-Scan nur, wenn Background-Prefetch aktiv ist
    if (ENABLE_BACKGROUND_PREFETCH && !window.aiState.isBackgroundScanning) {
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
    // 1. Notbremse: Wenn User gerade in DIESEM Ticket ist, darf Background NICHTS tun.
    const activeId = getTicketIdFromUrl();
    if (activeId && String(id) === String(activeId)) {
        return;
    }

    try {
        // 2. Locking prüfen
        const lockAcquired = await acquireLock(id, 'background');
        if (!lockAcquired) {
            return;
        }

        const storageKey = `draft_${id}`;
        const storedRes = await chrome.storage.local.get([storageKey]);
        let storedData = storedRes[storageKey];

        // 3. Quick Check: Wenn Inbox-Hash exakt matcht -> Alles aktuell, Abbruch.
        if (storedData && storedData.inboxHash === incomingInboxHash) {
            await releaseLock(id); 
            return; 
        }

        // HINWEIS: Hier haben wir früher blind dem "manual_live" Hash vertraut. 
        // Das machen wir jetzt NICHT mehr. Wir prüfen erst den echten Inhalt.

        // console.log(`[CID: ${id}] Tradeo AI: ⚡ Prüfe Ticket auf inhaltliche Änderungen...`);

        // 4. Content Fetch & Hash Calculation (Die Wahrheit holen)
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

        // 5. Smart Sync Check (Der "Hand und Fuß" Fix)
        // Wir vergleichen den echten Inhalt (ContentHash) mit dem gespeicherten.
        if (storedData && storedData.contentHash === realContentHash) {
            // INHALT IST GLEICH: Der Unterschied im Inbox-Hash war nur kosmetisch 
            // (z.B. "manual_live_..." vs. echter Hash), aber es gibt keine neuen Nachrichten.
            
            // Wir "heilen" den Inbox-Hash, damit der Scanner beim nächsten Mal Ruhe gibt.
            if (storedData.inboxHash !== incomingInboxHash) {
                console.log(`[CID: ${id}] 🛠️ Content identisch. Synchronisiere nur Inbox-Hash.`);
                storedData.inboxHash = incomingInboxHash;
                await chrome.storage.local.set({ [storageKey]: storedData });
                
                // RAM Cache updaten
                window.aiState.knownTickets.set(id, incomingInboxHash);
            }
            
            // WICHTIG: Abbruch! Wir starten KEINE neue Generierung, da Inhalt gleich ist.
            await releaseLock(id);
            return;
        }

        // 6. Wenn wir hier sind, hat sich der CONTENT geändert (z.B. neue Notiz) -> Headless Starten!
        console.log(`[CID: ${id}] 🔄 Änderung erkannt! (Hash: ${realContentHash}). Starte Headless Analysis...`);

        // Headless Draft erstellen
        const aiResult = await generateDraftHeadless(contextText, id);

        if (aiResult) {
            let initialHistory = [];
            
            // 1. KAREN START
            initialHistory.push({ type: "system", content: "Karen prüft, ob wir aus Plenty Daten brauchen..." });

            // 2. KAREN RESULT
            if (aiResult.toolExec && aiResult.toolExec.summary) {
                initialHistory.push({ 
                    type: 'tool_exec', 
                    summary: aiResult.toolExec.summary, 
                    details: aiResult.toolExec.details,
                    calls: aiResult.toolExec.calls 
                });
            } 
            else if (aiResult.toolLogs && Array.isArray(aiResult.toolLogs)) {
                aiResult.toolLogs.forEach(logText => {
                    initialHistory.push({ type: 'system', content: logText });
                });
            }
            
            // 3. KEVIN DRAFT
            initialHistory.push({ type: 'draft', content: aiResult.draft });

            // 4. KEVIN REASONING
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
            console.log(`[CID: ${id}] Tradeo AI: ✅ Draft aktualisiert.`);
        }

    } catch (e) {
        console.error(`[CID: ${id}] Fehler bei Verarbeitung:`, e);
    } finally {
        await releaseLock(id);
    }
}

// --- API FUNCTIONS ---

async function generateDraftHeadless(contextText, ticketId = 'UNKNOWN') {
    const { vertexCredentials } = await chrome.storage.local.get(['vertexCredentials']);
    const hasVertexCreds = Array.isArray(vertexCredentials)
        && vertexCredentials.some(c => c && c.projectId);

    if (!hasVertexCreds) return null;

    const currentModel = window.aiState.currentModel || "gemini-2.5-flash";
    const isSlowModel = currentModel.includes("gemini-2.5-pro");
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

    const headlessUserPrompt = "Analysiere das Ticket und erstelle einen Entwurf.";

    const primaryTask = async () => {
        // --- SCHRITT 0: CONTEXT PATCHING (Zuerst!) ---
        let languageInstruction = ""; 
        const freshTranslations = await getTranslations(ticketId);
        
        if (Object.keys(freshTranslations).length > 0) {
             try {
                const contextArr = JSON.parse(contextText); 
                let patched = false;
                const detectedLangs = new Set();

                contextArr.forEach(msg => {
                    const t = freshTranslations[msg.id] || freshTranslations[`thread-${msg.id}`];
                    if (t && t.text) {
                        msg.msg = `[TRANSLATION FROM ${t.lang}]: ${t.text}`;
                        if (t.lang !== 'DE' && t.lang !== 'EN') detectedLangs.add(t.lang);
                        patched = true;
                    }
                });

                if(patched) {
                    contextText = JSON.stringify(contextArr);
                    console.log(`[CID: ${ticketId}] 🌐 Headless Context VOR Karen-Call gepatcht.`);
                    if (detectedLangs.size > 0) {
                        const langsStr = Array.from(detectedLangs).join(',');
                        languageInstruction = `ACHTUNG: Fremdsprache erkannt (${langsStr}). Antworte ZWINGEND auf ENGLISCH.`;
                    }
                }
             } catch(e) {
                 console.warn("Headless Translation Patch failed:", e);
             }
        }

        // --- SCHRITT 1: PLAN (Karen) ---
        const plan = await analyzeToolPlan(contextText, headlessUserPrompt, "", null, ticketId);

        // Tool Logs & Exec Info bauen
        const toolLogs = [];
        const toolExec = buildToolExecutionInfo(plan.tool_calls || []);
        const MSG_NO_TOOLS_NEEDED = "✅ Keine Datenabfrage nötig.";

        if (toolExec) {
            toolLogs.push(toolExec.summary);
        } else {
            toolLogs.push(MSG_NO_TOOLS_NEEDED);
        }

        // --- SCHRITT 2: EXECUTE (Tools) ---
        const gatheredData = await executePlannedToolCalls(plan.tool_calls || [], ticketId);

        // --- DEBUG LOGGING START ---
        // FIX: Hier stand vorher 'cid' statt 'ticketId' -> ReferenceError
        console.groupCollapsed(`🤖 AI Payload Debug (Headless CID: ${ticketId})`);
        console.log("1. Headless Object:", gatheredData);
        const debugString = gatheredData ? JSON.stringify(gatheredData) : "null";
        console.log("2. Final String to AI (Minified):", debugString);
        console.log(`3. Payload Size: ~${debugString.length} chars`);
        console.groupEnd();
        // --- DEBUG LOGGING END ---

        // --- SCHRITT 3: GENERATE (Kevin) ---
        const generatorPrompt = `
${workerPrompt}

=== HINTERGRUND-ANALYSE ===
Dies ist ein automatischer Scan eines Tickets.
WICHTIG: Du darfst KEINE Tools/Funktionen aufrufen – die Datenbeschaffung ist abgeschlossen.

=== HINTERGRUND-DATEN (PLENTY API ERGEBNISSE) ===
${JSON.stringify(gatheredData)}

=== TICKET VERLAUF ===
${contextText}

=== AUFGABE ===
${languageInstruction}
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
// FUNKTION: CONTEXT EXTRACTION (Robust V7 - Structure Preserved + Backup Logic)
// =============================================================================
function extractContextFromDOM(docRoot) {
    const mainContainer = docRoot.querySelector('#conv-layout-main');
    if (!mainContainer) return "[]"; 

    const messages = [];
    const threads = Array.from(mainContainer.querySelectorAll('.thread')).reverse();

    threads.forEach(thread => {
        // --- FIX: NESTED THREADS IGNORIEREN ---
        // Wenn ein Thread-Element einen weiteren .thread in sich trägt, ist es nur ein Wrapper (z.B. thread-type-new).
        // Wir ignorieren den Wrapper, da der innere Thread separat in dieser Schleife auftaucht.
        if (thread.querySelector('.thread')) return;
        
        // 1. SENDER
        const personEl = thread.querySelector('.thread-person');
        const senderName = personEl ? personEl.textContent.trim().replace(/\s+/g, ' ') : "Unbekannt";

        if (senderName.includes("[Entwurf]") || senderName.includes("[Draft]")) return; 

        // 2. TYP & ID
        const threadId = thread.getAttribute('data-thread_id') || "unknown";
        let type = "unknown";
        if (thread.classList.contains('thread-type-note')) type = "internal_note";
        else if (thread.classList.contains('thread-type-customer')) type = "customer_message";
        else if (thread.classList.contains('thread-type-message')) type = "support_reply";

        // 3. ZEIT
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

        // 5. NACHRICHT (Struktur-Erhaltend!)
        let bodyText = "";
        const contentEl = thread.querySelector('.thread-content');
        
        if (contentEl) {
            // --- NEU: BACKUP CHECK ---
            if (thread.dataset.originalContent) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = thread.dataset.originalContent;
                processCloneContent(tempDiv); // Helper nutzen
                
                const rawText = tempDiv.textContent || "";
                let cleaned = rawText.replace(/[ \t]+/g, ' ');
                cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');
                bodyText = cleaned.trim();
            } else {
                const clone = contentEl.cloneNode(true);
                processCloneContent(clone); // Helper nutzen
                
                const rawText = clone.textContent || "";
                let cleaned = rawText.replace(/[ \t]+/g, ' ');
                cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');
                bodyText = cleaned.trim();
            }
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

        if (senderName === "Unbekannt" && type === "unknown" && !bodyText && fileList.length === 0) return;

        const msgObj = {
            id: threadId,
            type: type,
            sender: senderName,
            time: timestamp,
            msg: bodyText 
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
        // MATCH
        if (cached.contentHash === currentHash) {
            console.log(`[CID: ${ticketId}] Cache gültig. Lade...`);
            loadFromCache(ticketId);
            applyTranslationsToUi(ticketId); // <--- HIER EINFÜGEN
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
 * UPDATE: Erzwingt jetzt aggressiv die Positionierung der AI GANZ OBEN, wenn neue Nachrichten reinkommen.
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
        let triggerUiUpdate = false; 

        mutations.forEach((mutation) => {
            // 1. CHECK: Hinzugefügte Knoten
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.classList.contains('thread') || 
                            node.classList.contains('conv-message') ||
                            (node.id && node.id.startsWith('thread-'))) {
                            
                            if (node.id && node.id.includes('tradeo-ai')) return;

                            const contentEl = node.querySelector('.thread-content');
                            const text = contentEl ? contentEl.innerText.trim() : node.innerText.trim();

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

            // 2. CHECK: Entfernte Knoten
            if (mutation.removedNodes.length > 0) {
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        // FIX: Wenn "Neue Nachricht" Banner (.thread-type-new) entfernt wird:
                        // Kein Reset, ABER wir triggern UI Update (Buttons) und Positions-Check.
                        if (node.classList.contains('thread-type-new')) {
                            triggerUiUpdate = true;
                            return; 
                        }

                        if (node.classList.contains('thread') || 
                            node.classList.contains('conv-message') ||
                            (node.id && node.id.startsWith('thread-'))) {
                            
                            if (node.id && node.id.includes('tradeo-ai')) return;

                            console.log("Tradeo AI: Echte Nachricht/Notiz gelöscht -> Resetting...");
                            shouldReset = true;
                        }
                    }
                });
            }
        });

        // --- POSITIONS KORREKTUR (Der "Türsteher") ---
        // FreeScout schiebt neue Threads gerne an Position 0.
        // Wenn wir im "Lesemodus" (Editor zu) sind, muss die AI Zone aber an Position 0 sein.
        const copilotZone = document.getElementById('tradeo-ai-copilot-zone');
        if (copilotZone) {
            const editorBlock = document.querySelector('.conv-reply-block');
            // Prüfen: Ist Editor offen? (Dann gehört AI nach unten -> macht repositionCopilotZone)
            const isEditorOpen = editorBlock && !editorBlock.classList.contains('hidden') && editorBlock.style.display !== 'none';
            
            // Wenn Editor ZU ist (Lesemodus), muss AI ganz oben sein.
            // Hat sich der neue Thread vorgedrängelt (firstChild != copilotZone)? -> Korrigieren!
            if (!isEditorOpen && mainContainer.firstChild !== copilotZone) {
                // console.log("Tradeo AI: Korrigiere Position (Zone wieder nach ganz oben).");
                mainContainer.prepend(copilotZone);
            }
        }

        // --- REAKTIONEN ---

        // FALL A: Echter neuer Inhalt -> Reset (lädt AI neu und positioniert sich eh neu)
        if (shouldReset) {
            if (newTextContent) window.aiState.lastThreadText = newTextContent;
            resetUiToLoadingState();
        } 
        // FALL B: Banner entfernt -> Nur UI nachladen (Buttons)
        else if (triggerUiUpdate) {
            const cid = getTicketIdFromUrl();
            if (cid) applyTranslationsToUi(cid);
        }
        // FALL C: Redraw -> UI retten
        else if (isRedraw) {
            if (!copilotZone) {
                initConversationUI(true); 
            } else {
                if (mainContainer.firstChild !== copilotZone) {
                    mainContainer.prepend(copilotZone);
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
                <label>Vertex AI Projekte (Rotation via User-OAuth)</label>
                
                <div class="tradeo-api-pair-header">
                    <span style="flex:1">Google Cloud Project ID</span>
                    <span style="width:24px"></span>
                </div>

                <div id="tradeo-api-rows-container">
                    </div>
                
                <button id="tradeo-add-api-row-btn" type="button">+ Weiteres Projekt hinzufügen</button>

                <div style="font-size:10px; color:#666; margin-top:2px;">
                    Bei "Rate Limit" (429) wird automatisch zum nächsten Projekt gewechselt.
                    <br>OAuth Login passiert beim ersten Call automatisch (Google Popup).
                </div>
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
            <button id="tradeo-ai-settings-btn" title="Einstellungen"><i class="glyphicon glyphicon-cog"></i></button>
            
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
    const container = document.getElementById('tradeo-api-rows-container');
    const addBtn = document.getElementById('tradeo-add-api-row-btn');

    // Helper: Neue Zeile rendern
    const renderRow = (pId = "") => {
        const row = document.createElement('div');
        row.className = 'tradeo-api-pair-row';
        row.innerHTML = `
            <input type="text" class="input-pid" placeholder="Project ID" value="${pId}">
            <button class="tradeo-remove-row-btn" title="Entfernen">&times;</button>
        `;

        row.querySelector('.tradeo-remove-row-btn').addEventListener('click', () => row.remove());
        container.appendChild(row);
    };

    // Add Button Handler
    addBtn.addEventListener('click', () => renderRow());

    // Toggle Panel
    btn.addEventListener('click', () => {
        panel.classList.toggle('visible');
        if (panel.classList.contains('visible')) {
            // Beim Öffnen Werte laden
            chrome.storage.local.get(['vertexCredentials', 'plentyUser', 'plentyPass'], (res) => {
                // UI leeren
                container.innerHTML = '';

                let creds = res.vertexCredentials;

                // Migration Check: Falls user noch alte 'geminiApiKeys' hat, aber keine 'vertexCredentials'
                // Da wir die Project ID nicht raten können, starten wir leer oder mit Platzhalter.
                if (!creds || !Array.isArray(creds) || creds.length === 0) {
                    renderRow(""); // Eine leere Zeile als Start
                } else {
                    // Migration: falls alte Objekte noch {projectId,key} haben -> Key ignorieren
                    creds.forEach(c => renderRow(c?.projectId || ""));
                }
                
                document.getElementById('setting-plenty-user').value = res.plentyUser || '';
                document.getElementById('setting-plenty-pass').value = res.plentyPass || '';
            });
        }
    });

    // Save Action
    saveBtn.addEventListener('click', async () => {
        const pUser = document.getElementById('setting-plenty-user').value.trim();
        const pPass = document.getElementById('setting-plenty-pass').value.trim();

        // Credentials auslesen
        const rows = Array.from(container.querySelectorAll('.tradeo-api-pair-row'));
        const newCredentials = [];

        rows.forEach(row => {
            const pid = row.querySelector('.input-pid').value.trim();
            if (pid) newCredentials.push({ projectId: pid });
        });

        if (newCredentials.length === 0) {
            statusDiv.innerText = "⚠️ Bitte mindestens eine Project ID eingeben.";
            statusDiv.style.color = "orange";
            return;
        }

        statusDiv.innerText = "Speichere...";
        
        // Speichern
        await chrome.storage.local.set({
            vertexCredentials: newCredentials, // NEUES FORMAT
            // Legacy Keys löschen oder null setzen, um Verwirrung zu vermeiden
            geminiApiKeys: null, 
            geminiApiKey: null,   
            plentyUser: pUser,
            plentyPass: pPass
        });

        // Test der Verbindung (Plenty)
        if (pUser && pPass) {
             statusDiv.innerText = "Teste Plenty Verbindung...";
             try {
                 await callPlenty('/rest/login', 'POST', { username: pUser, password: pPass });
                 statusDiv.innerText = `✅ Gespeichert (${newCredentials.length} Credentials) & Plenty Verbunden!`;
                 statusDiv.style.color = "green";
                 setTimeout(() => panel.classList.remove('visible'), 1500);
             } catch (e) {
                 statusDiv.innerText = "❌ Fehler: " + e;
                 statusDiv.style.color = "red";
             }
        } else {
            statusDiv.innerText = `✅ Gespeichert (${newCredentials.length} Credentials)`;
            statusDiv.style.color = "green";
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
    const ticketId = getTicketIdFromUrl() || "UNKNOWN";
    if (ticketId === 'UNKNOWN') {
        console.warn("Tradeo AI: Kein Ticket-ID für Reset gefunden.");
        return;
    }

    console.log(`🔄 Tradeo AI: Starte Reset für Ticket #${ticketId}...`);

    // 1. Storage für dieses Ticket löschen (INKLUSIVE Übersetzungen!)
    await chrome.storage.local.remove([
        `draft_${ticketId}`, 
        `processing_${ticketId}`,
        `translations_${ticketId}` // <--- NEU: Löscht die gespeicherten Übersetzungen
    ]);

    // 2. RAM State für dieses Ticket bereinigen
    if (window.aiState) {
        window.aiState.knownTickets.delete(ticketId);
        window.aiState.chatHistory = [];
        window.aiState.lastDraft = "";
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

    // NEU: Badges aus der UI entfernen (damit man sieht, dass sie weg sind)
    document.querySelectorAll('.karen-translation-wrapper').forEach(el => el.remove());
    // Originaltexte wiederherstellen (optional, aber sauberer)
    document.querySelectorAll('.thread').forEach(t => {
        if(t.dataset.originalContent) {
            const contentEl = t.querySelector('.thread-content');
            if(contentEl) contentEl.innerHTML = t.dataset.originalContent;
            delete t.dataset.originalContent;
        }
    });

    // 4. Neu-Initialisierung anstoßen
    expandInterface(); 
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
        dummyDraft.innerHTML = '<em>🤖 Conversation-Änderung erkannt! Analysiere Ticket neu...</em>';
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
    
    // Sicherheitshalber leeren, falls UI neu aufgebaut wird
    modelDropdown.innerHTML = '';

    Object.values(AI_MODELS).forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        item.innerText = model.dropdownText;

        // FIX: Initial prüfen, ob dies das aktive Model ist und Klasse setzen
        if (model.id === window.aiState.currentModel) {
            item.classList.add('selected');
            // Button Label synchronisieren (falls Default abweicht)
            if (modelBtn) modelBtn.innerText = model.label;
        }

        item.onclick = (e) => {
            window.aiState.currentModel = model.id;
            modelBtn.innerText = model.label;
            
            // Visuelles Update aller Items
            const container = document.getElementById('tradeo-ai-model-dropdown');
            if (container) {
                container.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
            }
            item.classList.add('selected');
            
            modelDropdown.classList.add('hidden');
            e.stopPropagation();
        };
        modelDropdown.appendChild(item);
    });

    // Toggle Handler (Direct assignment verhindert Listener-Duplikate bei Re-Init)
    modelBtn.onclick = (e) => { 
        e.stopPropagation(); 
        modelDropdown.classList.toggle('hidden'); 
    };

    // Global Close Handler (nur einmal registrieren via Flag oder simpler Check)
    if (!window._tradeoGlobalClickInit) {
        document.addEventListener('click', () => {
            const dd = document.getElementById('tradeo-ai-model-dropdown');
            if (dd) dd.classList.add('hidden');
        });
        window._tradeoGlobalClickInit = true;
    }
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

    const { vertexCredentials } = await chrome.storage.local.get(['vertexCredentials']);
    const hasVertexCreds = Array.isArray(vertexCredentials) && vertexCredentials.some(c => c && c.projectId);

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
        input.value = ''; 
    }

    if (!hasVertexCreds) {
        renderChatMessage('system', "⚠️ Keine Vertex AI Credentials gefunden (Project ID).");
        await releaseLock(cid);
        return;
    }

    window.aiState.isGenerating = true;
    if(btn) { btn.disabled = true; btn.innerText = "⏳"; }

    // --- NEU: Zuerst UI-Check ---
    await applyTranslationsToUi(cid);

    let contextText = extractContextFromDOM(document);

    // --- NEU: Context für KEVIN patchen ---
    const knownTranslations = await getTranslations(cid);
    if (Object.keys(knownTranslations).length > 0) {
        try {
            const contextArr = JSON.parse(contextText);
            let patched = false;
            
            contextArr.forEach(msg => {
                const t = knownTranslations[msg.id] || knownTranslations[`thread-${msg.id}`];
                if (t && t.text) {
                    msg.msg = `[TRANSLATION FROM ${t.lang}]: ${t.text}`;
                    patched = true;
                }
            });
            
            if (patched) {
                console.log(`[CID: ${cid}] 🌐 Context für Kevin gepatcht mit Übersetzungen.`);
                contextText = JSON.stringify(contextArr);
            }
        } catch (e) {
            console.warn("Translation Patch failed:", e);
        }
    }

    const currentDraft = window.aiState.isRealMode ? document.querySelector('.note-editable')?.innerHTML : dummyDraft.innerHTML;

    const historyString = window.aiState.chatHistory.map(e => {
        if(e.type === 'draft') return ""; 
        const role = e.type === 'user' ? 'User' : 'AI';
        return `${role}: ${e.content}`;
    }).join("\n");

    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-2.5-pro"); 
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

    const karenStartText = "Karen prüft, ob wir aus Plenty Daten brauchen...";
    const karenBubble = renderKarenBubble(karenStartText);
    window.aiState.chatHistory.push({ type: "system", content: karenStartText });

    const primaryTask = async () => {
        const lastToolData = (window.aiState.lastToolDataByCid && window.aiState.lastToolDataByCid[cid]) ? window.aiState.lastToolDataByCid[cid] : null;
        
        // HIER passiert jetzt die Übersetzung "on the fly" im Planner
        const plan = await analyzeToolPlan(contextText, userPrompt, currentDraft, lastToolData, cid);

        const forceRefresh = wantsFreshData(userPrompt);
        const editOnly = isLikelyEditOnly(userPrompt);
        // content.js - Innerhalb von runAI(), ca. Zeile 1560

        // ... (Vorheriger Code: const forceRefresh = ... const editOnly = ...)

        let toolCallsToExecute = Array.isArray(plan.tool_calls) ? plan.tool_calls : [];
        
        // FIX: Aggressive Unterdrückung entfernt. 
        // Wir vertrauen Karen: Wenn sie Tools plant, obwohl sie "lastToolData" im Prompt gesehen hat,
        // dann braucht sie vermutlich neue Daten (z.B. andere Region bei Versand).
        // Wir blocken NUR, wenn es sich zu 100% nur um eine Text-Umformulierung handelt.
        
        if (editOnly && !forceRefresh && toolCallsToExecute.length > 0) {
            console.log(`[CID: ${cid}] Planner wollte Tools, aber User-Prompt ist reines 'Edit-Only' -> Unterdrücke Calls.`);
            toolCallsToExecute = [];
        }

        // ALTER CODE (GELÖSCHT/KOMMENTIERT), DER DEN FEHLER VERURSACHT HAT:
        /*
        if (!forceRefresh && lastToolData && toolCallsToExecute.length > 0) {
            console.log(`[CID: ${cid}] Unterdrücke neue Tool-Abfragen: vorhandene Daten vorhanden.`);
            toolCallsToExecute = [];
        }
        */

        const toolExec = buildToolExecutionInfo(toolCallsToExecute);
        
        // ... (Weiter im Code mit const MSG_TOOLS_SKIPPED_CACHE ...)
        
        const MSG_TOOLS_SKIPPED_CACHE = "♻️ Keine neuen Tool-Aufrufe (Daten vorhanden).";
        const MSG_NO_TOOLS_NEEDED = "✅ Keine Datenabfrage nötig.";

        if (toolExec) {
            updateKarenBubble(karenBubble, toolExec.summary, toolExec.details);
            window.aiState.chatHistory.push({
                type: "tool_exec",
                summary: toolExec.summary,
                details: toolExec.details,
                calls: toolExec.calls
            });
        } else {
            let noToolsMsg = lastToolData ? MSG_TOOLS_SKIPPED_CACHE : MSG_NO_TOOLS_NEEDED;
            updateKarenBubble(karenBubble, noToolsMsg, null);
            window.aiState.chatHistory.push({ type: "system", content: noToolsMsg });
        }

        // EXECUTE
        let gatheredData = null;
        if (toolCallsToExecute.length > 0) {
            const freshData = await executePlannedToolCalls(toolCallsToExecute, cid);
            gatheredData = mergeToolData(lastToolData, freshData);
            window.aiState.lastToolDataByCid = window.aiState.lastToolDataByCid || {};
            window.aiState.lastToolDataByCid[cid] = gatheredData;
        } else {
            gatheredData = lastToolData;
        }

        // --- DEBUG LOGGING START ---
        console.groupCollapsed(`🤖 AI Payload Debug (Live CID: ${cid})`);
        console.log("1. Live Object (Interactive):", gatheredData);
        const debugString = gatheredData ? JSON.stringify(gatheredData) : "null";
        console.log("2. Final String to AI (Minified):", debugString);
        console.log(`3. Payload Size: ~${debugString.length} chars`);
        console.groupEnd();
        // --- DEBUG LOGGING END ---

        // FINISH KAREN
        let finalStatus = "";
        if (toolExec) finalStatus = toolExec.summary;
        else if (lastToolData) finalStatus = MSG_TOOLS_SKIPPED_CACHE;
        else finalStatus = MSG_NO_TOOLS_NEEDED;

        updateKarenBubble(karenBubble, finalStatus, toolExec ? toolExec.details : null, true);

        // KEVIN START
        const draftPlaceholder = renderDraftMessage(null, true);
        const reasoningPlaceholder = renderReasoningMessage(null, null, true);

        // --- OPTIONAL: Context NOCHMAL patchen ---
        const freshTranslations = await getTranslations(cid);
        if (Object.keys(freshTranslations).length > 0) {
             try {
                const contextArr = JSON.parse(extractContextFromDOM(document)); 
                contextArr.forEach(msg => {
                    const t = freshTranslations[msg.id] || freshTranslations[`thread-${msg.id}`];
                    if (t && t.text) msg.msg = `[TRANSLATION FROM ${t.lang}]: ${t.text}`;
                });
                contextText = JSON.stringify(contextArr);
             } catch(e) {}
        }

        const generatorPrompt = `
${workerPrompt}

=== HINTERGRUND-DATEN (PLENTY API ERGEBNISSE) ===
${gatheredData ? JSON.stringify(gatheredData) : "null"}

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
        const finalData = await Promise.race([primaryTask(), timeoutPromise]);
        
        handleAiSuccess(
            finalData.result, 
            isInitial, 
            input, 
            dummyDraft, 
            cid, 
            finalData.placeholders 
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
    if (finalResponse.feedback || finalResponse.reasoning || finalResponse.rma_check) {
        const feedbackText = finalResponse.feedback || "Antwort erstellt.";
        
        // --- RMA VISUALISIERUNG START ---
        let reasoningText = "";
        
        // Prüfen, ob das neue rma_check Objekt da ist
        if (finalResponse.rma_check && finalResponse.rma_check.is_rma_case) {
            const rma = finalResponse.rma_check;
            // Wir nutzen HTML-Tags, da renderReasoningMessage innerHTML nutzt
            reasoningText += `🛡️ <b>RMA-Analyse:</b>\n`;
            reasoningText += `• Entscheidung: <b>${rma.decision}</b>\n`;
            reasoningText += `• Bestand vs. Retoure: ${rma.item_stock_net} vs ${rma.return_quantity}\n`;
            reasoningText += `• Logik: ${rma.reasoning}\n\n`;
            reasoningText += `--- Allgemein ---\n`;
        }
        // --- RMA VISUALISIERUNG ENDE ---

        reasoningText += (finalResponse.reasoning || ""); 
        if (!reasoningText) reasoningText = "Keine detaillierte Begründung.";
        
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
    } else if (fnName === 'fetchShippingCosts') {
        actionName = 'GET_SHIPPING_COSTS';
        actionPayload = { regions: fnArgs.regions };
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
const FORCE_REFRESH_KEYWORDS_RE = /\b(nochmal\w*|erneut|aktuell\w*|refresh\w*|neu\s*(?:laden|abfragen|prüfen|checken)|verifizier\w*|fetch\w*|abgleich\w*|aktualisier\w*|such\w*|find\w*|schau\w*|guck\w*|abruf\w*|biet\w*|anbiet\w*|recherchier\w*|prüf\w*|check\w*|scan\w*|ermittel\w*)\b/i;

// content.js

// UPDATE: Aggressive Suche nach Wortstämmen mit \w*
// Findet: "versand", "versandkosten", "lieferung", "lieferstatus", "bestellung", "bestellnummer", "pakete", "produktbeschreibung" etc.
const EXPLICIT_DATA_REQUEST_RE = /\b(bestell\w*|order|tracking|liefer\w*|versand\w*|paket\w*|lager\w*|bestand|verfügbarkeit|preis\w*|kundendaten|adresse|telefon|email|zoll|gewicht|herkunft|artikel\w*|item\w*|produkt\w*|sku|ean|seriennummer|sn|modell)\b/i;

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

    if (name === 'fetchShippingCosts') {
        // Erlaube nur valide Regionen, default auf WW falls Karen Quatsch macht
        const validRegions = ['DE', 'AT', 'CH', 'EU', 'WW'];
        
        // Input normalisieren: Sicherstellen, dass es ein Array ist
        let rawRegions = [];
        if (Array.isArray(args.regions)) {
            rawRegions = args.regions;
        } else if (args.region) {
            // Fallback, falls LLM aus Gewohnheit "region" (Singular) nutzt
            rawRegions = [args.region];
        } else {
            rawRegions = ['DE', 'AT', 'CH', 'EU', 'WW'];
        }

        const cleanedRegions = rawRegions.map(r => {
            let region = String(r || "").toUpperCase();
            
            // Mapping-Logik für Karen-Fehler
            if (region === 'GERMANY' || region === 'DEUTSCHLAND') region = 'DE';
            if (region === 'AUSTRIA' || region === 'ÖSTERREICH') region = 'AT';
            if (region === 'SWITZERLAND' || region === 'SCHWEIZ') region = 'CH';
            
            if (!validRegions.includes(region)) return 'WW';
            return region;
        });

        // Duplikate entfernen und leere Einträge vermeiden
        const uniqueRegions = [...new Set(cleanedRegions)].filter(Boolean);
        
        return { ...call, args: { regions: uniqueRegions.length > 0 ? uniqueRegions : ['WW'] } };
    }

    return null;
}

function stripGeminiJson(rawText) {
    if (!rawText) return "";
    return rawText.replace(/```json/g, '').replace(/```/g, '').trim();
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function restoreImages(translatedText, originalHtml) {
    if (!originalHtml || !translatedText.includes('__IMG_')) return translatedText;
    
    try {
        // Wir parsen das Original-HTML, um an die echten <img> Tags zu kommen
        const parser = new DOMParser();
        const doc = parser.parseFromString(originalHtml, 'text/html');
        // Die Reihenfolge von querySelectorAll ist stabil (Document Order), 
        // daher passt Index 0 hier zu Index 0 aus processCloneContent.
        const images = doc.querySelectorAll('img');
        
        // Regex sucht nach __IMG_0__, __IMG_15__ etc.
        return translatedText.replace(/__IMG_(\d+)__/g, (match, index) => {
            const img = images[parseInt(index, 10)];
            // Wenn Bild gefunden, das komplette HTML-Tag zurückgeben, sonst den Marker entfernen
            return img ? img.outerHTML : ''; 
        });
    } catch(e) {
        console.warn("Tradeo AI: Fehler beim Wiederherstellen der Bilder:", e);
        return translatedText; // Fallback auf Text mit Markern
    }
}

// Helper für Text-Aufbereitung (wichtig für stabilen Hash)
function processCloneContent(element) {
    // 1. NEU: Bilder durch eindeutige, durchnummerierte Platzhalter ersetzen
    const images = element.querySelectorAll('img');
    images.forEach((img, index) => {
        // Spaces wichtig, damit es nicht mit Worten verschmilzt
        const placeholder = document.createTextNode(` __IMG_${index}__ `);
        img.parentNode.replaceChild(placeholder, img);
    });

    // 2. Breaks behandeln
    const brs = element.querySelectorAll('br');
    brs.forEach(br => br.replaceWith('\n'));

    // 3. Block-Elemente behandeln
    const blocks = element.querySelectorAll('p, div, li, tr, h1, h2, h3');
    blocks.forEach(tag => {
        if(tag.parentNode) {
            const newline = document.createTextNode('\n');
            tag.parentNode.insertBefore(newline, tag);
        }
    });
}

async function saveTranslations(ticketId, newTranslations) {
    if (!newTranslations || Object.keys(newTranslations).length === 0) return;

    const key = `translations_${ticketId}`;
    const storage = await chrome.storage.local.get([key]);
    const existing = storage[key] || {};

    const merged = { ...existing, ...newTranslations };
    
    await chrome.storage.local.set({ [key]: merged });
    console.log(`[CID: ${ticketId}] 🌐 Karen hat ${Object.keys(newTranslations).length} Übersetzungen gespeichert.`);
}


async function getTranslations(ticketId) {
    const key = `translations_${ticketId}`;
    const storage = await chrome.storage.local.get([key]);
    return storage[key] || {};
}

/**
 * Injiziert die Badges und Toggles in die FreeScout Threads
 */
async function applyTranslationsToUi(ticketId) {
    const translations = await getTranslations(ticketId);
    if (Object.keys(translations).length === 0) return;

    const threads = document.querySelectorAll('.thread');
    
    threads.forEach(threadEl => {
        // NEU: Wenn der Thread noch im "Neue Nachricht" Wrapper steckt -> Finger weg!
        // Wir warten, bis der User auf "Anzeigen" klickt und der Wrapper weg ist.
        if (threadEl.closest('.thread-type-new')) return;

        const threadId = threadEl.getAttribute('data-thread_id'); 
        if(!threadId) return;

        let transData = translations[threadId] || translations[`thread-${threadId}`];
        if (!transData) return;

        if (threadEl.querySelector('.karen-translation-wrapper')) return;

        const infoEl = threadEl.querySelector('.thread-info');
        const contentEl = threadEl.querySelector('.thread-content');

        if (infoEl && contentEl) {
            const wrapper = document.createElement('span');
            wrapper.className = 'karen-translation-wrapper';
            
            // Button bekommt initial die Klasse 'is-original' (Blau)
            wrapper.innerHTML = `
                <span class="karen-badge">Translated by Karen</span>
                <button class="karen-toggle-btn is-original" type="button">Original (${transData.lang})</button>
            `;

            // Insert links neben Status
            const statusEl = infoEl.querySelector('.thread-status');
            if (statusEl) {
                infoEl.insertBefore(wrapper, statusEl);
            } else {
                infoEl.appendChild(wrapper);
            }

            // WICHTIG: Original sichern FÜR DIE ANZEIGE
            if (!threadEl.dataset.originalContent) {
                threadEl.dataset.originalContent = contentEl.innerHTML;
            }

            // --- NEU: HTML Mapping Logic ---
            // 1. Newlines zu <br> (Standard Textverarbeitung)
            let translatedHtmlRaw = transData.text.replace(/\n/g, '<br>');

            // 2. Bilder wiederherstellen (Mapping via Marker & Original Content)
            const translatedHtml = restoreImages(translatedHtmlRaw, threadEl.dataset.originalContent);

            contentEl.innerHTML = translatedHtml; 

            const btn = wrapper.querySelector('.karen-toggle-btn');
            
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isShowingTranslated = btn.textContent.includes('Original');
                
                if (isShowingTranslated) {
                    contentEl.innerHTML = threadEl.dataset.originalContent;
                    btn.textContent = "Englisch (Karen)";
                    btn.classList.remove('is-original');
                    btn.classList.add('is-translated');
                } else {
                    contentEl.innerHTML = translatedHtml;
                    btn.textContent = `Original (${transData.lang})`;
                    btn.classList.remove('is-translated');
                    btn.classList.add('is-original');
                }
            });
        }
    });
}

/**
 * SCHRITT 1: Planner / Analyzer
 * Gibt NUR einen Plan zurück: welche vorhandenen Tools (fetchOrderDetails, fetchItemDetails, fetchCustomerDetails, searchItemsByText)
 * sollen mit welchen Args aufgerufen werden.
 */
async function analyzeToolPlan(contextText, userPrompt, currentDraft, lastToolData, cid) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";

    const safeDraft = (currentDraft || "").toString();
    const safeLast = lastToolData ? JSON.stringify(lastToolData) : "null";
    
    // Prompt Konstruktion (unverändert)
    const fullPlannerPrompt = `${plannerPrompt}

=== TICKET VERLAUF ===
${contextText}

=== AKTUELLER ENTWURF (kann bereits alle Fakten enthalten) ===
${safeDraft}

=== LETZTE TOOL-ERGEBNISSE (falls vorhanden, zum Wiederverwenden) ===
${safeLast}

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

    // --- NEU: TRANSLATIONS HANDLING ---
    if (plan.translations && typeof plan.translations === 'object') {
        // WICHTIG: Wir warten mit 'await', damit die Daten sicher im Storage sind,
        // bevor der nächste Schritt (z.B. Context Patching) versucht, sie zu lesen.
        await saveTranslations(cid, plan.translations);
        
        // UI Update versuchen (feuert nur, wenn wir zufällig gerade in diesem Ticket sind)
        applyTranslationsToUi(cid);
    }
    // ----------------------------------

    if (!isPlainObject(plan)) plan = { type: "plan", schema_version: "plan.v1", tool_calls: [] };
    if (!Array.isArray(plan.tool_calls)) plan.tool_calls = [];

    const allowed = new Set(["fetchOrderDetails","fetchItemDetails","fetchCustomerDetails","searchItemsByText", "fetchShippingCosts"]);
    plan.tool_calls = plan.tool_calls
        .filter(c => isPlainObject(c) && allowed.has(c.name) && isPlainObject(c.args))
        .slice(0, 50)
        .map((c, idx) => ({
            call_id: typeof c.call_id === 'string' && c.call_id ? c.call_id : `c${idx+1}`,
            name: c.name,
            args: c.args,
            purpose: typeof c.purpose === 'string' ? c.purpose : ""
        }))
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
 * FIX: Nutzt Arrays für alle Datentypen, um Überschreiben bei mehreren Calls zu verhindern.
 */
async function executePlannedToolCalls(toolCalls, cid) {
    const gathered = {
        meta: { executedAt: new Date().toISOString(), cid },
        orders: [],       
        customers: [],    
        items: [],
        searchResults: [],
        shipping: [] // <--- NEU
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

    for (const r of results) {
        // Wir speichern nur r.data, um den Wrapper (call_id, args...) loszuwerden -> spart Tokens
        // FIX: Push in Arrays statt Zuweisung
        if (r.name === 'fetchOrderDetails') gathered.orders.push(r.data);
        else if (r.name === 'fetchCustomerDetails') gathered.customers.push(r.data);
        else if (r.name === 'fetchItemDetails') gathered.items.push(r.data);
        else if (r.name === 'searchItemsByText') gathered.searchResults.push(r.data);
        else if (r.name === 'fetchShippingCosts' && Array.isArray(r.data)) gathered.shipping.push(...r.data); 
    }

    return gathered;
}

// =============================================================================
// HELPER: FULL RESET (GLOBAL)
// =============================================================================
async function performFullReset() {
    console.log("💣 Tradeo AI: Starte kompletten Reset...");
    
    try {
        const allData = await chrome.storage.local.get(null);
        
        // 1. Lösche Drafts UND Translations UND Locks (Global)
        const keysToRemove = Object.keys(allData).filter(key => 
            key.startsWith('draft_') || 
            key.startsWith('processing_') ||
            key.startsWith('translations_') 
        );
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`🗑️ Storage: ${keysToRemove.length} Einträge gelöscht.`);
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

    // --- 3. UI CLEANUP (Das Upgrade für das aktuelle Ticket) ---
    
    // A) Input Feld leeren
    const input = document.getElementById('tradeo-ai-input');
    if (input) input.value = '';

    // B) Badges entfernen & TEXT WIEDERHERSTELLEN (Wichtig!)
    document.querySelectorAll('.karen-translation-wrapper').forEach(el => el.remove());
    
    document.querySelectorAll('.thread').forEach(t => {
        // Prüfen ob Original-Inhalt gesichert war -> Zurückschreiben
        if(t.dataset.originalContent) {
            const contentEl = t.querySelector('.thread-content');
            if(contentEl) contentEl.innerHTML = t.dataset.originalContent;
            // Backup-Attribut löschen, damit alles wie neu ist
            delete t.dataset.originalContent;
        }
    });

    // C) Chat History Feedback
    const historyDiv = document.getElementById('tradeo-ai-chat-history');
    if (historyDiv) {
        historyDiv.innerHTML = '<div style="padding:20px; text-align:center; color:#856404; background:#fff3cd; border:1px solid #ffeeba; margin:10px; border-radius:4px;"><strong>♻️ Globaler Reset erfolgreich!</strong><br>Alles gelöscht.<br>Lade AI neu...</div>';
    }

    // D) Dummy Draft Status
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    if (dummyDraft) {
        dummyDraft.innerHTML = '<em>🔄 Globaler Reset... Lade neu...</em>';
        dummyDraft.style.display = 'block';
    }

    // 4. Automatisch neu starten
    setTimeout(() => {
        console.log("🔄 Starte AI neu...");
        runAI(true); 
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

// --- In content.js -> renderChatMessage ersetzen ---

// --- In content.js -> renderChatMessage ersetzen ---

function renderChatMessage(role, text) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;
    const msgDiv = document.createElement('div');
    
    // role kann 'user', 'ai' oder 'system' sein
    if (role === 'user') { 
        msgDiv.className = 'user-msg'; 
        
        const temp = document.createElement('div');
        temp.textContent = text;
        // Umbrüche in <br> wandeln für korrekte Anzeige
        const safeHtml = temp.innerHTML.replace(/\n/g, '<br>');

        // NEU: Label und Content getrennt für sauberes CSS-Positioning
        msgDiv.innerHTML = `
            <span class="msg-label">DU</span>
            <div class="msg-content">${safeHtml}</div>
        `;
        
    } else if (role === 'ai') { 
        msgDiv.className = 'ai-msg'; 
        msgDiv.innerHTML = `<strong>AI</strong> ${text}`; 
    } else { 
        // System Nachrichten
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
 * Führt einen Vertex AI API Call mit Projekt-Rotation durch.
 * Wenn ein Projekt ein Rate-Limit (429) hat, wird das nächste Project/Projekt Paar versucht.
 */
async function callGeminiWithRotation(payload, model) {
    const storage = await chrome.storage.local.get(['vertexCredentials']);
    const credentials = storage.vertexCredentials;

    if (!credentials || !Array.isArray(credentials) || credentials.length === 0) {
        throw new Error("Keine Vertex Projekte gefunden. Bitte Project IDs in den Einstellungen hinterlegen.");
    }

    // SAFETY SETTINGS (wie gehabt)
    if (!payload.safetySettings) {
        payload.safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ];
    }

    // Token via Background holen (chrome.identity geht nicht im Content Script direkt)
    const getToken = () => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'GET_GCP_TOKEN' }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!res || !res.success || !res.token) return reject(new Error(res?.error || "NO_TOKEN"));
            resolve(res.token);
        });
    });

    const clearToken = () => new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'CLEAR_GCP_TOKEN' }, () => resolve());
    });

    let token = await getToken();
    let lastError = null;

    for (let i = 0; i < credentials.length; i++) {
        const entry = credentials[i];
        const currentProject = entry?.projectId;
        if (!currentProject) continue;

        const LOCATION = "europe-west4";
        const API_VERSION = "v1";

        const endpoint =
            `https://${LOCATION}-aiplatform.googleapis.com/${API_VERSION}` +
            `/projects/${currentProject}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;

        const doFetch = async () => fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        try {
            let response = await doFetch();

            // Token abgelaufen/invalid -> einmal Token reset + neu holen + retry
            if (response.status === 401) {
                console.warn(`Tradeo AI: 401 (Token) bei Project ${currentProject}. Token wird erneuert...`);
                await clearToken();
                token = await getToken();
                response = await doFetch();
            }

            if (!response.ok) {
                if (response.status === 429) {
                    console.warn(`Tradeo AI: Project ${currentProject} Rate Limit (429). Wechsle zum nächsten Projekt...`);
                    continue;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `API Error: ${response.status}`;

                if (response.status === 403) {
                    console.warn(`Tradeo AI: Project ${currentProject} Permission Denied (403). Wechsle...`);
                    lastError = new Error(`Permission Denied: ${errMsg}`);
                    continue;
                }

                throw new Error(errMsg);
            }

            return await response.json();

        } catch (error) {
            lastError = error;
            console.warn(`Tradeo AI: Fehler bei Project ${currentProject}:`, error.message);
        }
    }

    throw new Error(`Alle ${credentials.length} Projekte fehlgeschlagen. Letzter Fehler: ${lastError?.message}`);
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

    // Helper: Smart Stock Berechnung (ASYNC / Validierung)
    // Muss exakt der Logik in calculateSmartStockLocal (Global) entsprechen
    const calculateSmartStockLocal = async (stockEntries, currentVariationId) => {
        if (!Array.isArray(stockEntries) || stockEntries.length === 0) return "Unendlich";
        const targetId = Number(currentVariationId);

        // 1. Check: Ist es ein Bundle (Warehouse 2)?
        const hasWarehouse2 = stockEntries.some(e => Number(e.variationId) === targetId && Number(e.warehouseId) === 2);

        if (hasWarehouse2) {
            // BUNDLE LOGIK
            const bundleComponents = await fetchBundleComponentsViaBackground(targetId);
            
            const componentStocks = {};
            stockEntries.forEach(e => {
                const vId = Number(e.variationId);
                if (vId !== targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    const safeVal = isNaN(val) ? 0 : val;
                    componentStocks[vId] = (componentStocks[vId] || 0) + safeVal;
                }
            });

            if (!bundleComponents || bundleComponents.length === 0) {
                const totals = Object.values(componentStocks);
                return totals.length > 0 ? Math.min(...totals) : 0;
            }

            let maxBundles = Infinity;
            for (const comp of bundleComponents) {
                const compId = Number(comp.componentVariationId);
                const needed = Number(comp.componentQuantity) || 1;
                
                const available = componentStocks[compId] || 0;
                const possible = Math.floor(available / needed);

                if (possible < maxBundles) {
                    maxBundles = possible;
                }
            }
            return (maxBundles === Infinity) ? 0 : maxBundles;

        } else {
            // STANDARD LOGIK
            return stockEntries.reduce((acc, e) => {
                if (Number(e.variationId) === targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    return acc + (isNaN(val) ? 0 : val);
                }
                return acc;
            }, 0);
        }
    };

    try {
        // 1. Die normale Suche ausführen
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'SEARCH_ITEMS_BY_TEXT',
                searchText,
                mode: 'nameAndDescription',
                maxResults: 30,
                onlyWithStock: false 
            }, (res) => resolve(res));
        });

        const ms = (performance.now() - t0).toFixed(1);

        if (response && response.success) {
            console.log(`✅ Fertig in ${ms}ms`);
            
            // Kopie der Ergebnisse für Tabelle
            let results = [...(response.data?.results || [])];
            results.sort((a, b) => b.stockNet - a.stockNet);

            console.log(`Gefunden: ${results.length} Artikel`);
            console.table(results);
            
            // --- RAW STOCK DATA FETCH & VALIDATION ---
            if (results.length > 0) {
                const topResults = results.slice(0, 5); // Nur Top 5 prüfen
                
                console.groupCollapsed(`📦 RAW STOCK VALIDATION (Top 5 Checks)`);
                
                for (const item of topResults) {
                    // Wir brauchen ItemID und VariationID. 
                    // Das Tool liefert oft 'id' als ItemID oder 'itemId'. Wir prüfen beides.
                    const itemId = item.itemId || item.id || item.itemNumber; 
                    const vid = item.variationId;

                    if (vid && itemId) {
                        try {
                            const endpoint = `/rest/items/${itemId}/variations/${vid}/stock`;
                            
                            const rawRes = await new Promise(resolve => {
                                chrome.runtime.sendMessage({
                                    action: 'PLENTY_API_CALL',
                                    endpoint: endpoint,
                                    method: 'GET'
                                }, resolve);
                            });

                            if (rawRes && rawRes.success) {
                                // ASYNC Check
                                const computed = await calculateSmartStockLocal(rawRes.data, vid);
                                const match = computed === item.stockNet;
                                const icon = match ? "✅" : "⚠️";

                                console.log(`${icon} Item ${itemId} / Var ${vid} -> Tool: ${item.stockNet} | Computed: ${computed}`);
                                
                                if (!match) {
                                    console.warn(`Mismatch bei Var ${vid}!`, rawRes.data);
                                }
                            } else {
                                console.warn(`Fehler bei Raw Stock Fetch für Var ${vid}`, rawRes);
                            }
                        } catch (err) {
                            console.error("Fehler im Loop:", err);
                        }
                    } else {
                        console.warn("Item übersprungen (ID fehlt):", item);
                    }
                }
                console.groupEnd();
            }

            console.log("%c📋 FINAL AI DATA (Das bekommt Gemini):", "background: #222; color: #bada55; padding: 4px; font-weight: bold;");
            console.log(JSON.stringify(response.data, null, 2));

        } else {
            console.error("❌ Fehler:", response);
        }
    } catch (e) {
        console.error("🔥 Critical Error:", e);
    }

    console.groupEnd();
};

window.debugPlentyItemDetails = async function(identifier) {
    console.clear();
    console.group(`🚀 DEBUG: fetchItemDetails für Identifier "${identifier}"`);
    console.log("⏳ Sende Anfrage an Background Script...");

    // Helper: Smart Stock Berechnung (ASYNC / Validierung)
    // Muss exakt der Logik in calculateSmartStockLocal (Global) entsprechen
    const calculateSmartStockLocal = async (stockEntries, currentVariationId) => {
        if (!Array.isArray(stockEntries) || stockEntries.length === 0) return "Unendlich";
        const targetId = Number(currentVariationId);

        // 1. Check: Ist es ein Bundle (Warehouse 2)?
        const hasWarehouse2 = stockEntries.some(e => Number(e.variationId) === targetId && Number(e.warehouseId) === 2);

        if (hasWarehouse2) {
            // BUNDLE LOGIK
            // Wir nutzen die globale Helper-Funktion (muss in content.js existieren)
            const bundleComponents = await fetchBundleComponentsViaBackground(targetId);
            
            // Bestände aller Variationen summieren (außer dem Bundle-Hauptartikel selbst)
            const componentStocks = {};
            stockEntries.forEach(e => {
                const vId = Number(e.variationId);
                if (vId !== targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    const safeVal = isNaN(val) ? 0 : val;
                    componentStocks[vId] = (componentStocks[vId] || 0) + safeVal;
                }
            });

            if (!bundleComponents || bundleComponents.length === 0) {
                // Fallback ohne Rezept -> Minimum der gefundenen Teile
                const totals = Object.values(componentStocks);
                return totals.length > 0 ? Math.min(...totals) : 0;
            }

            // Rezept matchen
            let maxBundles = Infinity;
            for (const comp of bundleComponents) {
                const compId = Number(comp.componentVariationId);
                const needed = Number(comp.componentQuantity) || 1;
                
                const available = componentStocks[compId] || 0;
                const possible = Math.floor(available / needed);

                if (possible < maxBundles) {
                    maxBundles = possible;
                }
            }
            return (maxBundles === Infinity) ? 0 : maxBundles;

        } else {
            // STANDARD LOGIK
            return stockEntries.reduce((acc, e) => {
                if (Number(e.variationId) === targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    return acc + (isNaN(val) ? 0 : val);
                }
                return acc;
            }, 0);
        }
    };

    const fetchRawStock = async (itemId, variationId) => {
        const endpoint = `/rest/items/${itemId}/variations/${variationId}/stock`;
        const rawRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "PLENTY_API_CALL", endpoint, method: "GET" }, resolve);
        });
        return { endpoint, rawRes };
    };

    const debugOne = async (label, itemId, variationId, aiStockNet) => {
        console.groupCollapsed(`📦 RAW STOCK CHECK ${label} (Item ${itemId}, Var ${variationId})`);
        const { endpoint, rawRes } = await fetchRawStock(itemId, variationId);

        if (!rawRes || !rawRes.success) {
            console.warn("❌ RAW Stock Call fehlgeschlagen:", rawRes);
            console.groupEnd();
            return;
        }

        const rawArr = rawRes.data;
        // console.log(`GET ${endpoint} (Raw Entries: ${rawArr.length})`);
        // console.dir(rawArr);

        // AWAIT HIER WICHTIG FÜR BUNDLES
        const computed = await calculateSmartStockLocal(rawArr, variationId);

        const match = computed === aiStockNet;
        const icon = match ? "✅" : "⚠️";

        console.log(`${icon} AI Result: ${aiStockNet} | Computed Validation: ${computed}`);

        if (!match) {
            console.warn("Mismatch! Die AI API hat einen anderen Wert berechnet als die lokale Validierung.");
            console.log("Raw Data:", rawArr);
        }
        console.groupEnd();
    };

    try {
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: "GET_ITEM_DETAILS",
                identifier: identifier
            }, resolve);
        });

        if (response && response.success) {
            const data = response.data;
            console.log("✅ API Success! Die Daten sind da.");

            if (data.meta && data.meta.type === "PLENTY_ITEM_AMBIGUOUS") {
                console.warn(`⚠️ Ergebnis ist MEHRDEUTIG (${data.candidates.length} Kandidaten).`);
                for (let i = 0; i < data.candidates.length; i++) {
                    const c = data.candidates[i];
                    if (c.variation && c.item) {
                        // Hier greifen wir jetzt auf das korrekte stockNet zu
                        await debugOne(`#${i + 1}`, c.variation.itemId, c.variation.id, c.stockNet);
                    }
                }
            } else if (data.variation) {
                // Single Match
                const itemId = data.variation.itemId;
                const variationId = data.variation.id;
                const stockVal = data.stockNet; 

                console.log(`ℹ️ Eindeutiger Treffer: VarID ${variationId}`);
                if (itemId && variationId) {
                    await debugOne("(single)", itemId, variationId, stockVal);
                }
            }
            
            console.log("%c📋 FINAL AI DATA (Das bekommt Gemini):", "background: #222; color: #bada55; padding: 4px; font-weight: bold;");
            console.log(JSON.stringify(data, null, 2));

        } else {
            console.error("❌ API Error oder kein Ergebnis:", response);
            if (response && response.error) console.error("Details:", response.error);
        }

    } catch (e) {
        console.error("🔥 Critical Error during debug call:", e);
    }

    console.groupEnd();
};

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
 * Simuliert den Tool-Call UND prüft die Smart-Stock Berechnung (inkl. Async Bundle Check) pro Position.
 */
window.debugOrderDetails = async function(orderId) {
    console.clear();
    console.group(`🚀 DEBUG: fetchOrderDetails für Order ID "${orderId}"`);
    console.log("⏳ Sende Anfragen an Background Script...");

    // Helper: Smart Stock Berechnung (ASYNC / Validierung)
    // Muss exakt der Logik in calculateSmartStockLocal (Global) entsprechen
    const calculateSmartStockLocal = async (stockEntries, currentVariationId) => {
        if (!Array.isArray(stockEntries) || stockEntries.length === 0) return "Unendlich";
        const targetId = Number(currentVariationId);

        // 1. Check: Ist es ein Bundle (Warehouse 2)?
        const hasWarehouse2 = stockEntries.some(e => Number(e.variationId) === targetId && Number(e.warehouseId) === 2);

        if (hasWarehouse2) {
            // BUNDLE LOGIK
            // Wir nutzen die globale Helper-Funktion (muss im Scope existieren, siehe unten in content.js)
            const bundleComponents = await fetchBundleComponentsViaBackground(targetId);
            
            // Bestände aller Variationen summieren (außer dem Bundle-Hauptartikel selbst)
            const componentStocks = {};
            stockEntries.forEach(e => {
                const vId = Number(e.variationId);
                if (vId !== targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    const safeVal = isNaN(val) ? 0 : val;
                    componentStocks[vId] = (componentStocks[vId] || 0) + safeVal;
                }
            });

            if (!bundleComponents || bundleComponents.length === 0) {
                // Fallback ohne Rezept -> Minimum der gefundenen Teile
                const totals = Object.values(componentStocks);
                return totals.length > 0 ? Math.min(...totals) : 0;
            }

            // Rezept matchen
            let maxBundles = Infinity;
            for (const comp of bundleComponents) {
                const compId = Number(comp.componentVariationId);
                const needed = Number(comp.componentQuantity) || 1;
                
                const available = componentStocks[compId] || 0;
                const possible = Math.floor(available / needed);

                if (possible < maxBundles) {
                    maxBundles = possible;
                }
            }
            return (maxBundles === Infinity) ? 0 : maxBundles;

        } else {
            // STANDARD LOGIK (Summe des Artikels über alle Lager)
            return stockEntries.reduce((acc, e) => {
                if (Number(e.variationId) === targetId) {
                    const val = parseFloat(e.netStock || e.stockNet || 0);
                    return acc + (isNaN(val) ? 0 : val);
                }
                return acc;
            }, 0);
        }
    };

    try {
        // 1. Die AI-Funktion aufrufen (die jetzt Smart Stock nutzt)
        const aiResponse = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
                action: 'GET_ORDER_FULL', 
                orderId: orderId 
            }, (res) => resolve(res));
        });

        if (aiResponse && aiResponse.success) {
            const data = aiResponse.data;
            console.log("✅ API Success! Die Daten sind da.");
            
            // Order Info Header
            if (data.order) {
                console.group(`🛒 Order ${data.order.id} (${data.order.statusName})`);
                console.log("Erstellt am:", new Date(data.order.createdAt).toLocaleString());
                
                // Deep Dive in die Bestandsprüfung
                if (data.stocks && data.stocks.length > 0) {
                    console.groupCollapsed("📦 SMART STOCK VALIDIERUNG (Pro Position)");
                    
                    for (const stockEntry of data.stocks) {
                        const vid = stockEntry.variationId;
                        const aiStock = stockEntry.stockNet;
                        
                        // Wir müssen die ItemID herausfinden, um den Raw-Endpoint zu prüfen
                        try {
                            const varRes = await new Promise(res => chrome.runtime.sendMessage({
                                action: 'PLENTY_API_CALL',
                                endpoint: `/rest/items/variations/${vid}`,
                                method: 'GET'
                            }, res));

                            if(varRes && varRes.success && varRes.data.itemId) {
                                const itemId = varRes.data.itemId;
                                const endpoint = `/rest/items/${itemId}/variations/${vid}/stock`;
                                
                                // RAW Stock abrufen
                                const rawStockRes = await new Promise(res => chrome.runtime.sendMessage({
                                    action: 'PLENTY_API_CALL',
                                    endpoint: endpoint,
                                    method: 'GET'
                                }, res));

                                if(rawStockRes && rawStockRes.success) {
                                    // AWAIT HIER WICHTIG FÜR BUNDLES
                                    const computed = await calculateSmartStockLocal(rawStockRes.data, vid);
                                    
                                    const match = computed === aiStock;
                                    const icon = match ? "✅" : "⚠️";
                                    
                                    console.log(`${icon} Var ${vid} (Item ${itemId}) -> AI-Result: ${aiStock} | Computed Validation: ${computed}`);
                                    if(!match) {
                                        console.warn(`Mismatch! AI sagt ${aiStock}, lokale Berechnung sagt ${computed}. Raw Data:`, rawStockRes.data);
                                    }
                                } else {
                                    console.warn(`Konnte Raw Stock nicht laden für Var ${vid}`);
                                }

                            } else {
                                console.warn(`Konnte ItemID nicht auflösen für Var ${vid}`);
                            }
                        } catch(err) {
                            console.error(err);
                        }
                    }
                    console.groupEnd();
                } else {
                    console.warn("⚠️ Keine Stock-Informationen in der AI-Antwort gefunden.");
                }

                console.groupEnd();
            }

            console.log("%c📋 FINAL AI DATA (Das bekommt Gemini):", "background: #222; color: #bada55; padding: 4px; font-weight: bold;");
            // Ausgabe als reiner Text (schön formatiert)
            console.log(JSON.stringify(data, null, 2));

        } else {
            console.error("❌ AI API Error oder kein Ergebnis:", aiResponse);
            if (aiResponse && aiResponse.error) {
                console.error("Details:", aiResponse.error);
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


// --- HELPER: Bundle-Komponenten via Background abfragen ---
async function fetchBundleComponentsViaBackground(variationId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "proxyPlentyApi", // Wir nutzen den existierenden Proxy-Mechanismus oder einen neuen
            endpoint: `/rest/items/variations?id=${variationId}&with=variationBundleComponents`
        }, (response) => {
            if (response && response.success && response.data) {
                const variation = (response.data.entries && response.data.entries.length > 0) ? response.data.entries[0] : null;
                if (variation && Array.isArray(variation.variationBundleComponents)) {
                    resolve(variation.variationBundleComponents);
                    return;
                }
            }
            // Fallback: Leeres Array bei Fehler
            resolve([]); 
        });
    });
}

/**
 * DEBUG / LOCAL VERSION: Berechnet den Bestand (jetzt ASYNC!)
 * Nutzt Messaging zum Background Script für Bundle-Nachlade-Aktionen.
 */
async function calculateSmartStockLocal(stockEntries, currentVariationId) {
    if (!Array.isArray(stockEntries) || stockEntries.length === 0) return "Unendlich";

    const targetId = Number(currentVariationId);

    // 1. Prüfen: Ist es ein Bundle?
    const hasWarehouse2 = stockEntries.some(e => 
        Number(e.variationId) === targetId && Number(e.warehouseId) === 2
    );

    if (hasWarehouse2) {
        // CASE A: BUNDLE LOGIK
        console.log(`[SmartStockLocal] Bundle erkannt für VarID ${targetId}. Frage Komponenten ab...`);

        // 2. Bundle-Rezept über Background holen (Async!)
        const bundleComponents = await fetchBundleComponentsViaBackground(targetId);
        
        // 3. Bestände der Komponenten summieren
        const componentStocks = {};
        stockEntries.forEach(e => {
            const vId = Number(e.variationId);
            if (vId !== targetId) {
                const val = parseFloat(e.netStock || e.stockNet || 0);
                const safeVal = isNaN(val) ? 0 : val;
                componentStocks[vId] = (componentStocks[vId] || 0) + safeVal;
            }
        });

        // 4. Berechnung
        if (bundleComponents.length === 0) {
            console.warn("[SmartStockLocal] Keine Bundle-Komponenten gefunden (oder API Fehler). Nutze Fallback-Minimum.");
            const totals = Object.values(componentStocks);
            return totals.length > 0 ? Math.min(...totals) : 0;
        }

        let maxBundles = Infinity;

        for (const comp of bundleComponents) {
            const compId = Number(comp.componentVariationId);
            const needed = Number(comp.componentQuantity) || 1;
            
            const available = componentStocks[compId] || 0;
            const possible = Math.floor(available / needed);

            if (possible < maxBundles) {
                maxBundles = possible;
            }
        }

        return (maxBundles === Infinity) ? 0 : maxBundles;

    } else {
        // CASE B: STANDARD LOGIK
        return stockEntries.reduce((acc, e) => {
            if (Number(e.variationId) === targetId) {
                const val = parseFloat(e.netStock || e.stockNet || 0);
                return acc + (isNaN(val) ? 0 : val);
            }
            return acc;
        }, 0);
    }
}

// =============================================================================
// HELPER: TOOL DATA MERGING (PERSISTENCE & UPDATES)
// =============================================================================
function mergeToolData(oldData, newData) {
    if (!oldData) return newData;
    if (!newData) return oldData;

    // Wir starten mit einer Kopie der alten Daten
    const merged = JSON.parse(JSON.stringify(oldData));
    
    // Metadata aktualisieren (Zeitstempel vom Neuesten)
    merged.meta = { ...merged.meta, ...newData.meta, mergedAt: new Date().toISOString() };

    // Helper zum Mergen von Arrays: UPDATE bei gleicher ID
    const mergeArray = (key, idPath) => {
        if (!newData[key] || !Array.isArray(newData[key])) return;
        if (!merged[key]) merged[key] = [];

        newData[key].forEach(newItem => {
            // ID des neuen Items ermitteln
            const newId = idPath.split('.').reduce((obj, i) => obj ? obj[i] : null, newItem);
            
            if (!newId) {
                // Fallback: Ohne ID einfach hinzufügen
                merged[key].push(newItem);
                return;
            }

            // Prüfen, ob wir das Item schon haben
            const existingIndex = merged[key].findIndex(oldItem => {
                const oldId = idPath.split('.').reduce((obj, i) => obj ? obj[i] : null, oldItem);
                return String(oldId) === String(newId);
            });

            if (existingIndex >= 0) {
                // UPDATE: Existierenden Eintrag mit neuem überschreiben (z.B. neuer Lagerbestand)
                merged[key][existingIndex] = newItem;
            } else {
                // ADD: Neu hinzufügen
                merged[key].push(newItem);
            }
        });
    };

    // Die spezifischen Arrays mergen
    mergeArray('orders', 'order.id');
    mergeArray('customers', 'contact.id');
    mergeArray('items', 'variation.id');
    
    // SearchResults Update-Logik (basierend auf variationId)
    if (newData.searchResults && Array.isArray(newData.searchResults)) {
         if (!merged.searchResults) merged.searchResults = [];
         
         newData.searchResults.forEach(newItem => {
             const existingIndex = merged.searchResults.findIndex(r => r.variationId === newItem.variationId);
             
             if (existingIndex >= 0) {
                 // Update (z.B. geänderter Bestand in Suchergebnis)
                 merged.searchResults[existingIndex] = newItem;
             } else {
                 merged.searchResults.push(newItem);
             }
         });
    }

    // Am Ende der Funktion mergeToolData einfügen (vor return merged):
    if (newData.shipping && Array.isArray(newData.shipping)) {
         if (!merged.shipping) merged.shipping = [];
         // Einfaches Adden, da Shipping-Infos meist statisch sind
         newData.shipping.forEach(s => merged.shipping.push(s));
    }

    return merged;
}