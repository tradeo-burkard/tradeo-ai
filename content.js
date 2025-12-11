// --- KONFIGURATION ---
const API_VERSION = "v1beta";
const POLL_INTERVAL_MS = 2000; // Alle 2 Sekunden prüfen
const DASHBOARD_FOLDERS_TO_SCAN = [
    "https://desk.tradeo.de/mailbox/3/27",  // Servershop24 -> Nicht zugewiesen
    "https://desk.tradeo.de/mailbox/3/155"  // Servershop24 -> Meine
];

// SYSTEM PROMPT
const SYSTEM_PROMPT = `
Du bist "Tradeo AI", der technische Support-Assistent für Servershop24.
Deine Aufgabe ist es, den Nachrichtenverlauf zu analysieren und einen perfekten, fachlich korrekten Antwortentwurf für den Support-Mitarbeiter zu erstellen.

### FACHWISSEN & UNTERNEHMENSDETAILS:

1. **Geschäftsmodell:**
   - Wir verkaufen professionelle, refurbished Enterprise-Hardware (Server, Storage, Netzwerk).
   - Slogan: "Gebraucht. Geprüft. Geliefert."
   - Zielgruppe: B2B, Admins, Rechenzentren, ambitionierte Homelab-Nutzer.

2. **Artikelzustände & Abnutzung (TBW / Betriebsstunden):**
   - **Geräte/Server:** Sind refurbished (gebraucht, aufbereitet).
   - **Komponenten:** Teils Neuware oder Renew-Ware (0h Betriebsstunden, ohne OVP).
   - **HDD/SSD Verschleiß:**
     - Bei HDDs geben wir grundsätzlich KEINE Auskunft zu Betriebsstunden oder SMART-Werten.
     - Bei SSDs geben wir Auskunft über die verbleibende Lebensdauer (TBW - Total Bytes Written):
       * Renew / Neuware: 100% TBW verbleibend.
       * Gebraucht, neuwertig: >90% TBW verbleibend.
       * Gebraucht, sehr gut: 75-90% TBW verbleibend.
       * Gebraucht, gut: 50-75% TBW verbleibend.

3. **Gewährleistung & Garantie:**
   - Standard: 6 Monate für gewerbliche Kunden (B2B), 12 Monate für Privatkunden (B2C).
   - **Hardware Care Packs:** Laufzeiten 1-5 Jahre, Service (NBD, 24/7). 10% Aufschlag für Fremdgeräte.

4. **Widerrufsrecht & Rücknahme:**
   - Privatkunden: 14 Tage ab Zustellung.
   - Geschäftskunden: Kein generelles Widerrufsrecht (nur Kulanz bei Neubestellung).

5. **Technische Regeln:**
   - RAM: DDR4 ECC (Registered vs. Load Reduced nicht mischbar).
   - Storage: Nur ein Upgrade-Kit pro Server möglich (da Basiskomponenten entfallen).

---

### INTERPRETATION VON DATEN (TOOL USE):

Nutze die abgerufenen JSON-Daten intelligent, um Kontext zu schaffen. Kopiere keine JSON-Werte 1:1, sondern formuliere Sätze.

**A. BEI BESTELLUNGEN (getOrderDetails):**
1. **Status & Versand:**
   - **Status 7 (Warenausgang):** Das Paket wurde an den Logistiker übergeben.
   - **Tracking:** Prüfe das Feld 'shippingPackages'. Wenn dort eine 'packageNumber' steht, gib diese IMMER an.
   - **Tracking-Link (ON THE FLY):** Generiere selbstständig einen passenden, klickbaren Tracking-Link für den Kunden.
     * **Logik:** Nutze dein Wissen über URL-Strukturen der Logistiker (DHL, UPS, DPD, GLS) basierend auf dem erkannten Anbieter in 'shippingInfo.provider'.
     * **Sprache:** Passe die URL wenn möglich an die Kundensprache an (z.B. 'dhl.de/de/...' vs 'dhl.de/en/...').
     * **Parameter:** Achte penibel auf die korrekten URL-Parameter (z.B. 'piececode' für DHL, 'tracknum' für UPS, 'match' für GLS).
   - **Versandart:** Nutze das Feld 'shippingInfo.profileName' (z.B. "DHL Paket" oder "UPS Standard"), um dem Kunden zu bestätigen, womit versendet wurde.
   - **Datum:** Nutze das Datum mit der typeId 7 (Warenausgang) aus der 'dates'-Liste für das Versanddatum.
   - **Erwartete Laufzeit / Zustelldatum(sbereich):** Schätze das Zustelldatum unter Angabe von "normalerweise" unter Berücksichtigung von Zielland und Versanddatum und Versandart und dessen typische Zustellzeit ins Zielland (recherchieren).
2. **Warnung:** Sage NIEMALS "ist zugestellt", nur weil Status 7 ist. Status 7 heißt nur "versendet".

**B. BEI ARTIKELN (getItemDetails):**
1. **Intelligente Suche:**
   - **Priorität:** Ist die Eingabe eine 6-stellige Zahl, die mit '1' beginnt (z.B. 105400), sucht das Tool zuerst exakt nach dieser Artikelnummer/ID.
   - **Fallback:** Findet dies nichts (oder passt das Format nicht), sucht es breit nach Barcodes (EAN), Teilenummern (Model) und Nummern.
   - Das ist nützlich, wenn Kunden Teilenummern (z.B. "X-500-AB") senden, die keine Artikelnummern sind.
2. **Mehrere Ergebnisse (Ambiguity):**
   - Falls "PLENTY_ITEM_AMBIGUOUS" zurückkommt, passen mehrere Artikel (z.B. gleiche Teilenummer bei Varianten).
   - Analysiere die Liste 'candidates' und wähle den logischsten Artikel für den Kundenkontext.
3. **Verfügbarkeit:**
   - Prüfe 'stockNet' (>0 = Lagernd). Achte bei Namen auf "Refurbished" für Garantiehinweise.

**C. BEI KUNDEN (getCustomerDetails):**
1. **Kontext:**
   - Wenn der Kunde fragt "Wo ist meine Bestellung?", aber die letzte Order in der 'recentOrders'-Liste Monate her ist: Frage höflich nach der aktuellen Bestellnummer.
   - Wenn die letzte Order vor 1-3 Tagen war und Status < 7 hat: Informiere, dass sie noch in Bearbeitung ist.
2. **Adresse:**
   - Abgleich Rechnungs- vs. Lieferadresse nur erwähnen, wenn explizit danach gefragt wird oder Unstimmigkeiten erkennbar sind.

---

### TECHNISCHE ANWEISUNGEN FÜR DIE ANTWORT (CRITICAL RULES):

1. **SPRACHE (PRIORITÄT 1):**
   - Analysiere SOFORT die Sprache der *letzten* Nachricht des Kunden.
   - Englisch -> Antwort Englisch.
   - Deutsch -> Antwort Deutsch.

2. **FORMATIERUNG (PRIORITÄT 2 - HTML EDITOR):**
   - Der Output wird direkt in einen HTML-Editor eingefügt.
   - Nutze **<p>** für jeden neuen Absatz.
   - Nutze **<br>** für einfache Zeilenumbrüche.
   - Nutze **<ul><li>Punkt</li></ul>** für Aufzählungen.
   - KEIN Markdown (**fett** -> <b>fett</b>).

3. **TONALITÄT:**
   - Professionell, freundlich, "Sie"-Form. Keine Signatur am Ende.

### OUTPUT FORMAT (JSON ONLY):
{
  "detected_language": "DE" oder "EN",
  "reasoning": "Warum so entschieden? (z.B. 'Lagerbestand ist 0 -> informiere Kunde')",
  "draft": "HTML Antworttext (<p>...</p>)",
  "feedback": "Kurze Info an Agent (z.B. 'Habe Lagerbestand geprüft: 5 Stück verfügbar')"
}
`;

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
    // Cache management V3
    knownTickets: new Map(), // Map<TicketID, ContentHash>
    processingQueue: new Set() // Set<TicketID>
};

// TOOL DEFINITION FÜR GEMINI
const GEMINI_TOOLS = [
    {
        "name": "getOrderDetails",
        "description": "Ruft vollständige Details einer Bestellung ab. ENTHÄLT JETZT AUCH: Tracking-Nummern (Paketnummern), Versanddienstleister (z.B. DHL, UPS) und den genauen Status. Nutze dies immer, wenn nach dem 'Status', 'Wo ist mein Paket' oder einer Bestellnummer gefragt wird.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "orderId": {
                    "type": "STRING",
                    "description": "Die ID der Bestellung, z.B. 581769"
                }
            },
            "required": ["orderId"]
        }
    },
    {
        "name": "getItemDetails",
        "description": "Ruft Artikelinformationen ab, inklusive Name, Variationen und aktuellem Lagerbestand (Netto). Nutze dies bei Fragen zu Artikelnummern oder Verfügbarkeit.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "identifier": {
                    "type": "STRING",
                    "description": "Die Artikelnummer (Variation Number) oder die Variations-ID."
                }
            },
            "required": ["identifier"]
        }
    },
    {
        "name": "getCustomerDetails",
        "description": "Ruft Kundenstammdaten (Klasse, Adresse etc.) und die letzten Bestellungen dieses Kunden ab. Nutze dies, wenn eine Kundennummer (Contact ID) genannt wird.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "contactId": {
                    "type": "STRING",
                    "description": "Die ID des Kunden (Contact ID)."
                }
            },
            "required": ["contactId"]
        }
    }
];

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

async function processTicket(id, contentHash) {
    try {
        // Cache Check im Storage (Persistent)
        const storageKey = `draft_${id}`;
        const storedData = await chrome.storage.local.get([storageKey]);
        
        if (storedData[storageKey] 
            && storedData[storageKey].contentHash === contentHash 
            && storedData[storageKey].chatHistory 
            && Array.isArray(storedData[storageKey].chatHistory)
        ) {
            return; // Nichts zu tun
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
        const aiResult = await generateDraftHeadless(contextText, id);

        if (aiResult) {
            // FIX START: Tool Logs in History integrieren
            let initialHistory = [];

            // 1. Wenn Tools genutzt wurden, füge sie als System-Nachrichten hinzu
            if (aiResult.toolLogs && Array.isArray(aiResult.toolLogs)) {
                aiResult.toolLogs.forEach(logText => {
                    initialHistory.push({ type: 'system', content: logText });
                });
            }

            // 2. Draft und Feedback hinzufügen
            initialHistory.push({ type: 'draft', content: aiResult.draft });
            initialHistory.push({ type: 'ai', content: aiResult.feedback + " (Vorbereitet)" });
            // FIX END

            const data = {};
            data[storageKey] = {
                draft: aiResult.draft,
                feedback: aiResult.feedback,
                chatHistory: initialHistory,
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

async function generateDraftHeadless(contextText, ticketId = 'UNKNOWN') {
    const stored = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = stored.geminiApiKey;
    if (!apiKey) return null;

    // Strengerer Prompt für den Headless Mode, damit er Tools wirklich nutzt
    const headlessPrompt = `
    ${SYSTEM_PROMPT}
    === HINTERGRUND-ANALYSE ===
    Dies ist ein automatischer Scan eines Tickets.
    
    === TICKET VERLAUF ===
    ${contextText}
    
    === AUFGABE ===
    1. Analysiere den Text.
    2. WICHTIG: Wenn eine Bestellnummer (Order ID), Artikelnummer oder Kundennummer vorkommt, NUTZE DIE BEREITGESTELLTEN TOOLS (getOrderDetails, etc.), um echte Daten abzurufen.
    3. Erfinde KEINE Daten. Wenn du Tools nutzen kannst, tu es.
    4. Erstelle basierend auf den ECHTEN Daten einen Antwortentwurf im JSON-Format.
    `;

    // Initialer Context Aufbau
    let contents = [{
        role: "user",
        parts: [{ text: headlessPrompt }]
    }];

    const model = window.aiState.currentModel || "gemini-2.5-pro"; // Nutze eingestelltes Modell
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`;

    // NEU: Array zum Sammeln der ausgeführten Tools für die History
    let executedTools = [];

    try {
        let finalResponse = null;
        let turnCount = 0;
        const maxTurns = 3; // Sicherheitslimit für API Calls

        // --- SCHLEIFE FÜR MULTI-TURN (Tool Use im Hintergrund) ---
        while (turnCount < maxTurns) {
            
            const payload = {
                contents: contents,
                tools: [{ function_declarations: GEMINI_TOOLS }] // WICHTIG: Tools mitgeben!
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || "Headless API Error");

            const candidate = data.candidates?.[0];
            
            // Fall 1: Keine Kandidaten oder Content wurde wegen Safety/Filter blockiert
            if (!candidate || !candidate.content || !candidate.content.parts) {
                console.warn(`Tradeo AI Headless: ⚠️ Antwort blockiert oder leer. FinishReason: ${candidate?.finishReason}`);
                return null; // Abbruch, da wir nichts verarbeiten können
            }

            const content = candidate.content;
            const parts = content.parts;

            // Hat die AI einen FUNCTION CALL?
            const functionCallPart = parts.find(p => p.functionCall);

            if (functionCallPart) {
                const fnName = functionCallPart.functionCall.name;
                const fnArgs = functionCallPart.functionCall.args;
                
                // NEU: Log für die UI History speichern
                const toolLogText = `⚙️ AI nutzt Tool: ${fnName}(${JSON.stringify(fnArgs)})`;
                executedTools.push(toolLogText);

                console.log(`Tradeo AI Headless: ⚙️ Rufe Tool ${fnName} mit`, fnArgs);

                // Tool ausführen (via Background Script)
                let functionResult = null;
                let actionName = '';
                let actionPayload = {};

                if (fnName === 'getOrderDetails') {
                    actionName = 'GET_ORDER_FULL';
                    actionPayload = { orderId: fnArgs.orderId };
                } else if (fnName === 'getItemDetails') {
                    actionName = 'GET_ITEM_DETAILS';
                    actionPayload = { identifier: fnArgs.identifier };
                } else if (fnName === 'getCustomerDetails') {
                    actionName = 'GET_CUSTOMER_DETAILS';
                    actionPayload = { contactId: fnArgs.contactId };
                }

                if (actionName) {
                    // API Call via Background.js
                    const apiResult = await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: actionName, ...actionPayload }, (response) => {
                             resolve(response);
                        });
                    });
                    
                    if(apiResult && apiResult.success) {
                        functionResult = apiResult.data;
                        console.log(`Tradeo AI Headless [CID: ${ticketId}]: ✅ Tool ${fnName} erfolgreich.`);
                    } else {
                        console.warn(`Tradeo AI Headless [CID: ${ticketId}]: ❌ Tool ${fnName} fehlgeschlagen.`, apiResult);
                        functionResult = { error: apiResult ? apiResult.error : "Unknown Error" };
                    }
                } else {
                    functionResult = { error: "Tool not implemented" };
                }

                // Verlauf aktualisieren (Response an AI zurückfüttern)
                contents.push(content); 
                contents.push({
                    role: "function",
                    parts: [{
                        functionResponse: {
                            name: fnName,
                            response: { name: fnName, content: functionResult }
                        }
                    }]
                });

                turnCount++;
                continue; // Nächste Runde (AI soll jetzt mit den Daten antworten)
            }

            // Keine Function Call -> Finale Text-Antwort
            let rawText = parts[0].text || ""; 
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            
            try { 
                finalResponse = JSON.parse(rawText); 
            } catch(e) { 
                console.warn("Tradeo AI Headless JSON Parse Error. Fallback auf Raw Text.");
                if(rawText) {
                    finalResponse = { 
                        draft: rawText.replace(/\n/g, '<br>'), 
                        feedback: "Automatisch generiert (Formatierung evtl. abweichend)" 
                    }; 
                } else {
                    return null;
                }
            }
            break; // Loop beenden
        }

        // NEU: Logs an das Resultat anhängen, damit processTicket sie nutzen kann
        if (finalResponse) {
            finalResponse.toolLogs = executedTools;
        }

        return finalResponse;

    } catch (e) {
        console.error(`Tradeo AI Headless Error [CID: ${ticketId}]:`, e);
        return null;
    }
}

function extractContextFromDOM(docRoot) {
    const mainContainer = docRoot.querySelector('#conv-layout-main');
    if (!mainContainer) return "";
    
    const clone = mainContainer.cloneNode(true);
    
    // 1. Entferne unsere eigene AI Zone
    const myZone = clone.querySelector('#tradeo-ai-copilot-zone');
    if (myZone) myZone.remove();
    
    // 2. Entferne den Editor-Block (falls sichtbar)
    const editorBlock = clone.querySelector('.conv-reply-block');
    if(editorBlock) editorBlock.remove();

    // 3. NEU: Entferne Dropdown-Menüs und UI-Buttons aus den Nachrichten
    clone.querySelectorAll('.dropdown-menu, .thread-options, .conv-action-wrapper').forEach(el => el.remove());

    // 4. NEU: Formatierung bereinigen (Mehrfache Leerzeilen reduzieren)
    let cleanText = clone.innerText;
    cleanText = cleanText.replace(/\n\s*\n/g, '\n\n').trim();

    return cleanText;
}

// --- UI LOGIC (TICKET VIEW) ---

function initConversationUI() {
    const mainContainer = document.getElementById('conv-layout-main');
    if (!mainContainer) return;

    const copilotContainer = document.createElement('div');
    copilotContainer.id = 'tradeo-ai-copilot-zone';
    copilotContainer.classList.add('tradeo-collapsed');

    // Layout Update: Mic Button nach rechts verschoben
    copilotContainer.innerHTML = `
        <div id="tradeo-ai-dummy-draft"><em>🤖 Bereite Antwortentwurf vor...</em></div>
        
        <div id="tradeo-ai-settings-panel">
            <div class="tradeo-setting-row">
                <label>Gemini API Key</label>
                <input type="password" id="setting-gemini-key" placeholder="AI Key hier...">
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
    
    // UI Event Listener laden
    setupSettingsLogic();
    
    const originalReplyBtn = document.querySelector('.conv-reply');
    if(originalReplyBtn) setupButtons(originalReplyBtn);
    
    document.getElementById('tradeo-ai-expand-btn').addEventListener('click', expandInterface);

    setupModelSelector();
    setupEditorObserver();
    setupResizeHandler();
    
    // Voice Input aktivieren
    if (typeof setupVoiceInput === 'function') setupVoiceInput();

    copilotContainer.style.display = 'block';

    // Cache laden
    const ticketId = getTicketIdFromUrl();
    if (ticketId) {
        const storageKey = `draft_${ticketId}`;
        chrome.storage.local.get([storageKey], function(result) {
            const cached = result[storageKey];
            if (cached) {
                const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
                window.aiState.lastDraft = cached.draft;
                dummyDraft.innerHTML = cached.draft;
                
                const histContainer = document.getElementById('tradeo-ai-chat-history');
                histContainer.innerHTML = ''; 
                
                if (cached.chatHistory && Array.isArray(cached.chatHistory)) {
                    window.aiState.chatHistory = cached.chatHistory;
                    cached.chatHistory.forEach(msg => {
                        if (msg.type === 'draft') renderDraftMessage(msg.content);
                        else if (msg.type === 'user') renderChatMessage('user', msg.content);
                        else if (msg.type === 'ai') renderChatMessage('ai', msg.content);
                        else renderChatMessage('ai', msg.text || msg.content);
                    });
                } else {
                    const fallbackText = cached.feedback + " (Vorbereitet)";
                    renderChatMessage('ai', fallbackText);
                    window.aiState.chatHistory = [{ type: 'ai', content: fallbackText }];
                }

                // FIX: Sicherstellen, dass wir ganz unten sind nach dem Laden
                // Ein kurzer Timeout hilft, falls Bilder/Styles noch rendern
                setTimeout(scrollToBottom, 50);

            } else {
                renderChatMessage("system", "Kein Entwurf gefunden. Starte Live-Analyse...");
                runAI(true);
            }
        });
    } else {
        runAI(true);
    }
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
            chrome.storage.local.get(['geminiApiKey', 'plentyUser', 'plentyPass'], (res) => {
                document.getElementById('setting-gemini-key').value = res.geminiApiKey || '';
                document.getElementById('setting-plenty-user').value = res.plentyUser || '';
                document.getElementById('setting-plenty-pass').value = res.plentyPass || '';
            });
        }
    });

    // Save Action
    saveBtn.addEventListener('click', async () => {
        const geminiKey = document.getElementById('setting-gemini-key').value.trim();
        const pUser = document.getElementById('setting-plenty-user').value.trim();
        const pPass = document.getElementById('setting-plenty-pass').value.trim();

        statusDiv.innerText = "Speichere...";
        
        // Speichern
        await chrome.storage.local.set({
            geminiApiKey: geminiKey,
            plentyUser: pUser,
            plentyPass: pPass,
            plentyToken: null // Token resetten bei neuen Daten
        });

        // Test der Verbindung (optional)
        if (pUser && pPass) {
             statusDiv.innerText = "Teste Plenty Verbindung...";
             try {
                 // Einfacher Test-Call (z.B. Login erzwingen)
                 await callPlenty('/rest/login', 'POST', { username: pUser, password: pPass });
                 statusDiv.innerText = "✅ Gespeichert & Verbunden!";
                 statusDiv.style.color = "green";
                 setTimeout(() => panel.classList.remove('visible'), 1500);
             } catch (e) {
                 statusDiv.innerText = "❌ Fehler: " + e;
                 statusDiv.style.color = "red";
             }
        } else {
            statusDiv.innerText = "✅ Gespeichert (Nur Gemini)";
            setTimeout(() => panel.classList.remove('visible'), 1000);
        }
    });
}

// Neue Funktion zum Ausklappen mit Scroll-Fix
function expandInterface() {
    const zone = document.getElementById('tradeo-ai-copilot-zone');
    if (zone) {
        zone.classList.remove('tradeo-collapsed');
        
        // FIX: Scrollen, sobald das Element sichtbar wird
        // Kleiner Timeout ist wichtig, damit der Browser das 'display: block' erst rendern kann
        setTimeout(() => {
            scrollToBottom();
            // Fokus ins Eingabefeld setzen (optional, aber nice to have)
            const input = document.getElementById('tradeo-ai-input');
            if(input) input.focus();
        }, 50);
    }
}

// --- HELPERS ---

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
    // 1. AI Button erstellen (wie bisher)
    const aiBtn = originalReplyBtn.cloneNode(true);
    aiBtn.classList.add('tradeo-ai-toolbar-btn');
    aiBtn.setAttribute('title', 'Mit AI Antworten');
    const icon = aiBtn.querySelector('.glyphicon') || aiBtn;
    if(icon) { icon.classList.remove('glyphicon-share-alt'); icon.classList.add('glyphicon-flash'); }
    
    // Einfügen NACH dem Original-Button
    originalReplyBtn.parentNode.insertBefore(aiBtn, originalReplyBtn.nextSibling);
    
    // 2. Reset Button erstellen
    const resetBtn = document.createElement('button'); 
    resetBtn.className = 'btn btn-default tradeo-ai-reset-btn'; 
    resetBtn.innerHTML = '<i class="glyphicon glyphicon-refresh"></i> Reset';
    resetBtn.setAttribute('title', 'AI Gedächtnis löschen & neu starten');
    
    // Einfügen NACH dem AI-Button
    aiBtn.parentNode.insertBefore(resetBtn, aiBtn.nextSibling);

    // --- Event Listener ---

    // Logic: Reset Button
    resetBtn.addEventListener('click', function(e) {
        e.preventDefault(); 
        e.stopPropagation();
        expandInterface(); // Reset soll auch Interface öffnen
        performFullReset();
    });

    // Logic: AI Button (Blitz)
    aiBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        
        expandInterface(); // WICHTIG: Klick auf Blitz öffnet alles!

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
        document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
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
    
    const storageData = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = storageData.geminiApiKey;

    let userPrompt = "";

    if (isInitial) {
        userPrompt = "Analysiere das Ticket. Wenn eine Bestellnummer zu finden ist, prüfe deren Status. Erstelle dann einen Antwortentwurf.";
    } else { 
        userPrompt = input.value.trim();
        if (!userPrompt) return; 
        
        // 1. User Input sofort anzeigen & im RAM speichern
        renderChatMessage('user', userPrompt); 
        window.aiState.chatHistory.push({ type: "user", content: userPrompt }); 
    }

    if (!apiKey) {
        renderChatMessage('system', "⚠️ Kein API Key gefunden.");
        return; 
    }

    window.aiState.isGenerating = true;
    if(btn) { btn.disabled = true; btn.innerText = "..."; }
    
    // Kontext bauen
    const contextText = extractContextFromDOM(document);
    const historyString = window.aiState.chatHistory.map(e => {
        if(e.type === 'draft') return ""; 
        const role = e.type === 'user' ? 'User' : 'AI';
        return `${role}: ${e.content}`;
    }).join("\n");
    
    const currentDraft = window.aiState.isRealMode ? document.querySelector('.note-editable')?.innerHTML : dummyDraft.innerHTML;

    // Initialer Prompt-Content
    let contents = [
        {
            role: "user",
            parts: [{ text: `
                ${SYSTEM_PROMPT}
                === TICKET VERLAUF ===
                ${contextText}
                === AKTUELLER ENTWURF ===
                "${currentDraft}"
                === CHAT HISTORIE ===
                ${historyString}
                === ANWEISUNG ===
                ${userPrompt}
            `}]
        }
    ];

    const model = window.aiState.currentModel || "gemini-2.5-pro";
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`;

    try {
        // --- SCHLEIFE FÜR MULTI-TURN (Tool Use) ---
        let finalResponse = null;
        let turnCount = 0;
        const maxTurns = 3; // Sicherheitslimit

        while (turnCount < maxTurns) {
            
            // Payload mit Tools
            const payload = {
                contents: contents,
                tools: [{ function_declarations: GEMINI_TOOLS }]
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || "API Error");

            const candidate = data.candidates[0];
            const content = candidate.content;
            const parts = content.parts;

            // Hat die AI einen FUNCTION CALL?
            const functionCallPart = parts.find(p => p.functionCall);

            if (functionCallPart) {
                const fnName = functionCallPart.functionCall.name;
                const fnArgs = functionCallPart.functionCall.args;
                
                renderChatMessage('system', `⚙️ AI ruft Tool: ${fnName}(${JSON.stringify(fnArgs)})`);
                console.log("Tradeo AI: Function Call detected:", fnName, fnArgs);

                // Tool ausführen
                let functionResult = null;
                let actionName = '';
                let actionPayload = {};

                // Mapping der Tools auf Background Actions
                if (fnName === 'getOrderDetails') {
                    actionName = 'GET_ORDER_FULL';
                    actionPayload = { orderId: fnArgs.orderId };
                } else if (fnName === 'getItemDetails') {
                    actionName = 'GET_ITEM_DETAILS';
                    actionPayload = { identifier: fnArgs.identifier };
                } else if (fnName === 'getCustomerDetails') {
                    actionName = 'GET_CUSTOMER_DETAILS';
                    actionPayload = { contactId: fnArgs.contactId };
                }

                if (actionName) {
                    const apiResult = await new Promise(resolve => {
                        chrome.runtime.sendMessage({ action: actionName, ...actionPayload }, (response) => {
                             resolve(response);
                        });
                    });
                    
                    if(apiResult && apiResult.success) {
                        functionResult = apiResult.data;
                    } else {
                        functionResult = { error: apiResult ? apiResult.error : "Unknown Error" };
                    }
                } else {
                    functionResult = { error: "Tool not implemented in frontend" };
                }

                // Verlauf aktualisieren
                contents.push(content); 
                contents.push({
                    role: "function",
                    parts: [{
                        functionResponse: {
                            name: fnName,
                            response: { name: fnName, content: functionResult }
                        }
                    }]
                });

                turnCount++;
                continue; 
            }

            // Keine Function Call -> Finale Antwort
            let rawText = parts[0].text;
            // Markdown Code-Blocks entfernen
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            
            try { 
                finalResponse = JSON.parse(rawText); 
                
                // LOGGING: Sehen, was die AI erkannt hat
                if(finalResponse.detected_language) {
                    console.log("Tradeo AI Language Detect:", finalResponse.detected_language);
                }
                
                // Fallback, falls 'draft' fehlt aber 'text' da ist (Halluzination)
                if(!finalResponse.draft && finalResponse.text) finalResponse.draft = finalResponse.text;

            } catch(e) { 
                console.warn("Tradeo AI JSON Parse Error:", e);
                // Fallback: Wenn JSON kaputt ist, nehmen wir den Raw Text, wandeln Newlines in <br> um
                const fallbackHtml = rawText.replace(/\n/g, '<br>');
                finalResponse = { 
                    draft: fallbackHtml, 
                    feedback: "Achtung: AI Formatierung war fehlerhaft, Rohdaten werden angezeigt." 
                }; 
            }
            break; // Loop beenden
        }

        if (finalResponse) {
            // UI Updates
            renderDraftMessage(finalResponse.draft);
            window.aiState.chatHistory.push({ type: "draft", content: finalResponse.draft });
            
            renderChatMessage('ai', finalResponse.feedback);
            window.aiState.chatHistory.push({ type: "ai", content: finalResponse.feedback });
            
            window.aiState.lastDraft = finalResponse.draft;
            
            if (window.aiState.isRealMode && !window.aiState.preventOverwrite) {
                const editable = document.querySelector('.note-editable');
                if (editable) setEditorContent(editable, finalResponse.draft);
            } else {
                dummyDraft.innerHTML = finalResponse.draft;
                if(!window.aiState.preventOverwrite && !window.aiState.isRealMode) { 
                    dummyDraft.style.display = 'block'; 
                    flashElement(dummyDraft); 
                }
            }
            if(!isInitial && input) input.value = '';

            // --- PERSISTENZ SPEICHERN (FIX) ---
            // Wir speichern JETZT den neuen Verlauf (inkl. User Prompt und neuer AI Antwort)
            const ticketId = getTicketIdFromUrl();
            if (ticketId) {
                const storageKey = `draft_${ticketId}`;
                // Alten Hash holen um ihn beizubehalten
                chrome.storage.local.get([storageKey], function(res) {
                    const oldData = res[storageKey] || {};
                    const currentHash = oldData.contentHash || "modified_by_user";

                    const newData = {
                        draft: finalResponse.draft,
                        feedback: finalResponse.feedback,
                        chatHistory: window.aiState.chatHistory, // Hier ist jetzt alles drin
                        timestamp: Date.now(),
                        contentHash: currentHash
                    };
                    
                    const saveObj = {};
                    saveObj[storageKey] = newData;
                    chrome.storage.local.set(saveObj, () => {
                        console.log("Tradeo AI: Verlauf gespeichert.");
                    });
                });
            }
            // ------------------------------------
        }

    } catch(e) {
        renderChatMessage('system', "Error: " + e.message);
        console.error(e);
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Go"; }
        window.aiState.isGenerating = false; 
    }
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

// Render Funktion für Draft (Gelbe Box)
function renderDraftMessage(htmlContent) {
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
    
    // Event Listeners direkt anhängen
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

// --- BOOTSTRAP ---
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHeartbeat);
else startHeartbeat();

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
