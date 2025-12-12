// --- KONFIGURATION ---
const API_VERSION = "v1beta";
const POLL_INTERVAL_MS = 2000; // Alle 2 Sekunden prüfen
const LOCK_TTL_MS = 180000; // 3 Minuten Timeout für verwaiste Locks
const AI_TIMEOUT_STANDARD = 180000; // 2 Min für Standard-Modelle (Flash, 2.5 Pro)
const AI_TIMEOUT_SLOW = 600000;     // 10 Min für langsame Modelle (3 Pro)

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

**B. BEI ARTIKELN (getItemDetails / searchItemsByText):**

1. **Identifikator-Suche (getItemDetails):**
   - Nutze 'getItemDetails' IMMER dann, wenn du eine spezifische Nummer oder Kennung im Text erkennst.
   - Das Tool prüft in dieser Reihenfolge:
     1. Exakte Variation-ID oder Item-ID.
     2. Exakte Variationsnummer (z.B. 'SVR-12345').
     3. Breite Suche nach EAN/Barcode, Hersteller-Teilenummer (MPN), Modellname (z.B. '0JY57X', 'HPE P408i-a') oder SKU.
   - **Mehrdeutigkeit (PLENTY_ITEM_AMBIGUOUS):** Findet das Tool mehrere Artikel, erhältst du eine Liste von 'candidates'.
     * Analysiere die Kandidaten: Ist einer davon aktiv ('isActive': true) und hat Bestand ('stockNet' > 0)? Bevorzuge diesen.
     * Wenn unklar, liste dem Kunden die Optionen auf.

2. **Freitext-Suche (searchItemsByText):**
   - Nutze dies nur, wenn der Kunde explizit nach Text sucht (z.B. 'Suche Dell Server mit 128GB RAM').
   - **Logik (Smart Token Intersection):** Das Tool findet nur Artikel, die ALLE Wörter deiner Suchanfrage enthalten (im Namen oder der Beschreibung).
   - **Tipp:** Halte den Suchtext kurz und prägnant (z.B. 'Dell R740 128GB' statt 'Ich suche einen Dell R740 mit 128GB').

3. **WICHTIG: ARTIKELNUMMERN & BEZEICHNUNGEN:**
   - **Die richtige Nummer:** Im Tool-Output findest du das Feld 'articleNumber'. Dies ist meist identisch mit der 'itemId' (z.B. 105400). **Kommuniziere IMMER diese Nummer an den Kunden.**
   - **Interne Nummern:** Ignoriere Felder wie 'variationNumber' (oft beginnend mit 'VAR-' oder 'SVR-'), es sei denn, der Kunde fragt spezifisch danach. Diese sind intern.
   - **Name:** Nutze den vollen Artikelnamen aus dem Feld 'name'.

4. **VERFÜGBARKEIT & PREISE (SalesPrice & Stock):**
   - **Lagerbestand:** Der Wert 'stockNet' ist bereits die Summe aus allen verfügbaren Vertriebslagern.
     * 'stockNet' > 0: Sofort lieferbar.
     * 'stockNet' <= 0: Aktuell nicht lagernd (prüfe, ob es ein Beschaffungsartikel ist oder biete Alternativen).
   - **Preise (Sales Prices):** Du erhältst eine Liste 'variationSalesPrices'.
     * Wähle den Preis intelligent anhand der Herkunft des Kunden (z.B. CHF für Schweiz, EUR für EU).
     * Achte auf Brutto/Netto-Kennzeichnung in den Metadaten.
   - **Filter:** Artikel wie 'Hardware Care Packs' oder 'Upgrade auf' werden von der Suche oft schon ausgefiltert, achte dennoch darauf, keine reinen Service-Artikel als Hardware zu verkaufen.

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
        "description": "Ruft vollständige Details einer Bestellung ab. ENTHÄLT Tracking-Nummern (Paketnummern), Versanddienstleister (z.B. DHL, UPS) und den genauen Status. Nutze dies immer, wenn nach dem 'Status', 'Wo ist mein Paket' oder einer Bestellnummer gefragt wird.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "orderId": {
                    "type": "STRING",
                    "description": "Die ID der Bestellung, z.B. 581769."
                }
            },
            "required": ["orderId"]
        }
    },
    {
        "name": "getItemDetails",
        "description": "Ruft detaillierte Artikelinformationen für EINEN Artikel ab, inklusive Variation, Item-Basisdaten und Lagerbestand der Variation. Nutze dies, wenn der Kunde dir eine eindeutige Kennung nennt (Artikelnummer, Item-ID, Variations-ID, EAN/Barcode oder Teilenummer/Modell). Das Tool verwendet eine Heuristik: zuerst 6-stellige interne Nummern, dann IDs, Nummern, Barcodes und Modelle. Bei Mehrtreffern liefert es einen Ambiguity-Status mit Kandidatenliste.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "identifier": {
                    "type": "STRING",
                    "description": "Eindeutige Kennung: interne Artikelnummer (z.B. 105400), Item-ID, Variations-ID, EAN/Barcode oder Teilenummer/Modell (z.B. '0JY57X')."
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
    },
    {
        "name": "searchItemsByText",
        "description": "Führt eine textbasierte Artikelsuche in Plentymarkets durch. Nutze dieses Tool nur, wenn der Benutzer EXPLIZIT darum bittet, Artikel anhand eines Textes, Artikelnamens oder Teilstrings zu suchen (z.B. 'DELL 1.8TB 12G 10K SAS'). Das Tool sucht zuerst nach exakten Treffern im Artikelnamen (und optional in der Beschreibung) und fällt dann auf eine Baustein-Suche zurück, bei der alle Wörter des Suchtexts enthalten sein müssen. Es liefert pro Treffer umfangreiche Daten (Variation, Item, Lagerbestand, Verkaufspreise und SalesPrice-Metadaten). Ergebnisse mit 'hardware care pack' oder 'upgrade auf' im Namen/Beschreibung werden intern herausgefiltert.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "searchText": {
                    "type": "STRING",
                    "description": "Der relevante Suchtext, z.B. 'DELL 1.8TB 12G 10K SAS' oder eine Teilenummer wie '0JY57X'. NICHT den gesamten Satz übergeben, sondern nur den eigentlichen Suchbegriff."
                },
                "mode": {
                    "type": "STRING",
                    "description": "Suchmodus: 'name' durchsucht nur Artikelnamen; 'nameAndDescription' durchsucht Artikelnamen UND Artikelbeschreibungen.",
                    "enum": ["name", "nameAndDescription"]
                },
                "maxResults": {
                    "type": "NUMBER",
                    "description": "(Optional) Maximale Anzahl Treffer, die zurückgegeben werden sollen. Standard ist 30."
                }
            },
            "required": ["searchText"]
        }
    }
];

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

// --- LOGIC: QUEUE MANAGEMENT & PROCESSING ---

async function processTicket(id, incomingInboxHash) {
    try {
        // 1. Locking prüfen
        const lockAcquired = await acquireLock(id, 'background');
        if (!lockAcquired) {
            console.log(`[CID: ${id}] Skip Pre-Fetch: Bereits in Bearbeitung oder Locked.`);
            return;
        }

        const storageKey = `draft_${id}`;
        const storedRes = await chrome.storage.local.get([storageKey]);
        const storedData = storedRes[storageKey];

        if (storedData) {
            const lastKnownHash = storedData.inboxHash || storedData.contentHash;
            if (lastKnownHash === incomingInboxHash || (lastKnownHash && lastKnownHash.startsWith('manual_save'))) {
                await releaseLock(id); // Wichtig: Lock freigeben
                return; 
            }
        }

        console.log(`[CID: ${id}] Tradeo AI: ⚡ Verarbeite Ticket im Hintergrund...`);

        const response = await fetch(`https://desk.tradeo.de/conversation/${id}`);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const contextText = extractContextFromDOM(doc);

        if (!contextText || contextText.length < 50) {
            await releaseLock(id);
            return;
        }

        // Headless Draft erstellen
        const aiResult = await generateDraftHeadless(contextText, id);

        if (aiResult) {
            let initialHistory = [];
            if (aiResult.toolLogs && Array.isArray(aiResult.toolLogs)) {
                aiResult.toolLogs.forEach(logText => initialHistory.push({ type: 'system', content: logText }));
            }
            initialHistory.push({ type: 'draft', content: aiResult.draft });
            initialHistory.push({ type: 'ai', content: aiResult.feedback + " (Automatisch vorbereitet)" });

            const data = {};
            data[storageKey] = {
                draft: aiResult.draft,
                feedback: aiResult.feedback,
                chatHistory: initialHistory,
                timestamp: Date.now(),
                inboxHash: incomingInboxHash, 
                contentHash: incomingInboxHash 
            };
            
            await chrome.storage.local.set(data);
            console.log(`[CID: ${id}] Tradeo AI: ✅ Draft gespeichert.`);
        }

    } catch (e) {
        console.error(`[CID: ${id}] Fehler bei Verarbeitung:`, e);
    } finally {
        // IMMER Lock freigeben, auch bei Fehler
        await releaseLock(id);
    }
}

// --- API FUNCTIONS ---

async function generateDraftHeadless(contextText, ticketId = 'UNKNOWN') {
    const stored = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = stored.geminiApiKey;
    if (!apiKey) return null;

    // --- TIMEOUT LOGIK (UPDATED) ---
    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-3-pro");
    // Nutzung der neuen Konstanten:
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : AI_TIMEOUT_STANDARD;

    const headlessPrompt = `
    ${SYSTEM_PROMPT}
    === HINTERGRUND-ANALYSE ===
    Dies ist ein automatischer Scan eines Tickets.
    === TICKET VERLAUF ===
    ${contextText}
    === AUFGABE ===
    1. Wenn möglich, nutze Tools für echte Daten.
    2. Erstelle einen Antwortentwurf JSON.
    `;

    // 1. HAUPT-TASK
    const primaryTask = async () => {
        let contents = [{ role: "user", parts: [{ text: headlessPrompt }] }];
        return await executeHeadlessLoop(contents, apiKey, ticketId, true);
    };

    // 2. TIMEOUT
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), dynamicTimeoutMs)
    );

    try {
        const finalResponse = await Promise.race([primaryTask(), timeoutPromise]);
        return finalResponse;

    } catch (error) {
        console.warn(`[CID: ${ticketId}] Tradeo AI Headless: Fail/Timeout. Starte Fallback.`, error);
        
        // 3. FALLBACK
        try {
            const min = Math.round(dynamicTimeoutMs / 60000);
            const fallbackReason = error.message === "TIMEOUT" ? `Timeout (>${min}min)` : "Fehler";
            
            const warningLog = `⚠️ Background-Scan abgebrochen (${fallbackReason}). Fallback-Modus aktiv.`;
            
            let contents = [{ role: "user", parts: [{ text: `
                ${headlessPrompt}
                ACHTUNG: Tool-Nutzung fehlgeschlagen. 
                Erstelle Antwort NUR basierend auf Text. Erfinde keine Daten.
            ` }] }];

            const fallbackResponse = await executeHeadlessLoop(contents, apiKey, ticketId, false);
            
            if (fallbackResponse) {
                if (!fallbackResponse.toolLogs) fallbackResponse.toolLogs = [];
                fallbackResponse.toolLogs.push(warningLog);
            }
            return fallbackResponse;

        } catch (fbError) {
            console.error(`[CID: ${ticketId}] Headless Fallback failed completely:`, fbError);
            return null;
        }
    }
}

// Helper: Headless Loop
async function executeHeadlessLoop(contents, apiKey, ticketId, allowTools) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`;
    
    let executedTools = [];
    let turnCount = 0;
    const maxTurns = allowTools ? 3 : 1;

    while (turnCount < maxTurns) {
        const payload = { contents: contents };
        if (allowTools) payload.tools = [{ function_declarations: GEMINI_TOOLS }];

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "API Error");

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
        
        const content = candidate.content;
        // FIX: Sicherstellen, dass parts ein Array ist
        const parts = content.parts || []; 
        
        if (parts.length === 0) {
            // Manchmal ist parts leer, aber der finishReason sagt was passiert ist.
            // Wir werfen keinen harten Fehler, sondern geben null zurück, damit der Loop sauber beendet oder retry macht.
            console.warn("Tradeo AI: Gemini Content Parts sind leer.", candidate);
            return { draft: "", feedback: "API lieferte leeren Inhalt (evtl. Safety Filter)." };
        }

        const functionCallPart = parts.find(p => p.functionCall);

        if (functionCallPart && allowTools) {
            const fnName = functionCallPart.functionCall.name;
            const fnArgs = functionCallPart.functionCall.args;
            
            executedTools.push(`⚙️ AI nutzt Tool: ${fnName}(${JSON.stringify(fnArgs)})`);
            console.log(`[CID: ${ticketId}] Headless Tool: ${fnName}`);

            // Tool Logic
            let functionResult = null;
            let actionName = '';
            let actionPayload = {};

            if (fnName === 'getOrderDetails') { actionName = 'GET_ORDER_FULL'; actionPayload = { orderId: fnArgs.orderId }; }
            else if (fnName === 'getItemDetails') { actionName = 'GET_ITEM_DETAILS'; actionPayload = { identifier: fnArgs.identifier }; }
            else if (fnName === 'getCustomerDetails') { actionName = 'GET_CUSTOMER_DETAILS'; actionPayload = { contactId: fnArgs.contactId }; }
            else if (fnName === 'searchItemsByText') { actionName = 'SEARCH_ITEMS_BY_TEXT'; actionPayload = { searchText: fnArgs.searchText, mode: 'name', maxResults: 30 }; }

            if (actionName) {
                const apiResult = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: actionName, ...actionPayload }, (response) => resolve(response));
                });
                functionResult = (apiResult && apiResult.success) ? apiResult.data : { error: "Error" };
            } else {
                functionResult = { error: "Unknown" };
            }

            contents.push(content); 
            contents.push({
                role: "function",
                parts: [{ functionResponse: { name: fnName, response: { name: fnName, content: functionResult } } }]
            });
            turnCount++;
            continue; 
        }

        let rawText = parts[0].text || ""; 
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        let finalResponse = null;
        try { 
            finalResponse = JSON.parse(rawText); 
        } catch(e) { 
            if(rawText) finalResponse = { draft: rawText.replace(/\n/g, '<br>'), feedback: "Fallback (Raw Text)" }; 
        }
        
        if (finalResponse) {
            finalResponse.toolLogs = executedTools;
            return finalResponse;
        }
        break;
    }
    return null;
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

// Suche die Funktion initConversationUI und ersetze den Cache-Lade-Block (am Ende der Funktion) oder die ganze Funktion:

// --- NEUE FUNKTION: STARTUP SYNC ---
async function handleStartupSync(ticketId) {
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    
    // 1. Versuchen Lock zu bekommen ('live')
    // Gibt 'WAIT' zurück, wenn background gerade läuft
    const lockStatus = await acquireLock(ticketId, 'live');

    // SCENARIO A: Background läuft gerade (WAIT)
    if (lockStatus === 'WAIT') {
        console.log("Tradeo AI: Background Job aktiv. Warte auf Fertigstellung...");
        renderChatMessage('system', "⏳ <strong>Pre-Fetch läuft...</strong><br>Ein Hintergrundprozess analysiert dieses Ticket gerade. Bitte warten...");
        dummyDraft.innerHTML = "<em>⏳ Warte auf Hintergrund-Analyse...</em>";

        // Listener für Changes im Storage
        const changeListener = (changes, area) => {
            if (area === 'local') {
                // Check 1: Draft wurde erstellt
                if (changes[`draft_${ticketId}`]) {
                    console.log("Tradeo AI: Background fertig (Draft da). Lade...");
                    chrome.storage.onChanged.removeListener(changeListener);
                    loadFromCache(ticketId); // Helper Funktion unten
                }
                // Check 2: Lock wurde entfernt (Fertig oder Error)
                else if (changes[`processing_${ticketId}`] && !changes[`processing_${ticketId}`].newValue) {
                    console.log("Tradeo AI: Background fertig (Lock weg). Prüfe Ergebnis...");
                    chrome.storage.onChanged.removeListener(changeListener);
                    
                    // Kurz warten, damit Write sicher durch ist
                    setTimeout(async () => {
                        const hasDraft = await checkDraftExists(ticketId);
                        if (hasDraft) {
                            loadFromCache(ticketId);
                        } else {
                            renderChatMessage('system', "⚠️ Background Scan abgebrochen. Starte Live-Analyse.");
                            runAI(true); // Fallback auf Live
                        }
                    }, 500);
                }
            }
        };
        chrome.storage.onChanged.addListener(changeListener);
        return; 
    }

    // SCENARIO B: Wir haben den Lock (oder es gab keinen) -> Prüfen ob Cache da ist
    // Zuerst Lock wieder freigeben, da loadFromCache nichts tut und runAI sich selbst lockt
    await releaseLock(ticketId);

    const hasDraft = await checkDraftExists(ticketId);
    if (hasDraft) {
        loadFromCache(ticketId);
    } else {
        // Kein Draft, kein Background -> Wir starten Live
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
            
            // UI sichtbar machen, falls noch eingeklappt
            dummyDraft.style.display = 'block'; 
            flashElement(dummyDraft);

            const histContainer = document.getElementById('tradeo-ai-chat-history');
            histContainer.innerHTML = ''; 
            
            if (cached.chatHistory && Array.isArray(cached.chatHistory)) {
                window.aiState.chatHistory = cached.chatHistory;
                cached.chatHistory.forEach(msg => {
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
            } else {
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
        
        // WICHTIG: false übergeben, damit NICHT ins AI-Input fokussiert wird.
        // Das verhindert Sprünge, da gleich danach der Editor den Fokus holt.
        expandInterface(false); 

        originalReplyBtn.click();
        window.aiState.isRealMode = true; window.aiState.preventOverwrite = false;
        waitForSummernote(function(editable) {
            const content = window.aiState.lastDraft || document.getElementById('tradeo-ai-dummy-draft').innerHTML;
            setEditorContent(editable, content);
            // Info: setEditorContent kümmert sich bereits um preventScroll für den Editor
            document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        });
    });

    // Logic: Original Button Hooks
    originalReplyBtn.addEventListener('click', () => {
        // ENTFERNT: document.getElementById('tradeo-ai-dummy-draft').style.display = 'none'; 
        
        // Wir setzen nur den Modus, den Rest macht der Observer (Verschieben + Anzeigen)
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

// Suche die Funktion runAI und ersetze sie durch diese Version:

// Suche die Funktion runAI und ersetze sie durch diese Version:

async function runAI(isInitial = false) {
    const btn = document.getElementById('tradeo-ai-send-btn');
    const input = document.getElementById('tradeo-ai-input');
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    const cid = getTicketIdFromUrl() || "UNKNOWN";

    // --- LOCK SETZEN FÜR LIVE MODUS ---
    // Wir setzen den Lock ohne Prüfung auf 'WAIT', da runAI() die aktive Ausführung ist.
    // Falls ein Background-Prozess läuft, wurde das vorher in initConversationUI abgefangen.
    // Hier sagen wir explizit: "Ich bin jetzt der Chef".
    await acquireLock(cid, 'live'); 

    const storageData = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = storageData.geminiApiKey;

    let userPrompt = "";

    if (isInitial) {
        userPrompt = "Analysiere das Ticket. Wenn eine Bestellnummer zu finden ist, prüfe deren Status. Erstelle dann einen Antwortentwurf.";
    } else { 
        userPrompt = input.value.trim();
        if (!userPrompt) {
            await releaseLock(cid); // Lock weg bei leerer Eingabe
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
    if(btn) { btn.disabled = true; btn.innerText = "..."; }

    const contextText = extractContextFromDOM(document);
    const currentDraft = window.aiState.isRealMode ? document.querySelector('.note-editable')?.innerHTML : dummyDraft.innerHTML;
    
    const historyString = window.aiState.chatHistory.map(e => {
        if(e.type === 'draft') return ""; 
        const role = e.type === 'user' ? 'User' : 'AI';
        return `${role}: ${e.content}`;
    }).join("\n");

    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-3-pro"); 
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : AI_TIMEOUT_STANDARD; 

    // 1. HAUPT-TASK
    const primaryTask = async () => {
        let contents = [{
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
        }];
        return await executeGeminiLoop(contents, apiKey, cid, true);
    };

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), dynamicTimeoutMs)
    );

    try {
        const finalResponse = await Promise.race([primaryTask(), timeoutPromise]);
        handleAiSuccess(finalResponse, isInitial, input, dummyDraft, cid);

    } catch (error) {
        console.warn(`[CID: ${cid}] Tradeo AI: Abbruch (${error.message}). Starte Fallback.`);
        
        let reasonText = "Ein Fehler ist aufgetreten";
        if (error.message === "TIMEOUT") {
            const min = Math.round(dynamicTimeoutMs / 60000);
            reasonText = `Zeitüberschreitung (Limit: ${min} Min)`;
        }

        const warningText = `${reasonText}. Starte Notfall-Modus ohne Tools...`;
        renderWarningMessage(warningText);
        window.aiState.chatHistory.push({ type: "system", content: warningText });

        try {
            let fallbackPrompt = `
                ACHTUNG: Die vorherige Verarbeitung ist fehlgeschlagen (${error.message}).
                Bitte erstelle jetzt sofort eine Antwort basierend NUR auf dem Text.
                Versuche NICHT, Tools zu nutzen.
                Ursprüngliche Anweisung: ${userPrompt || "Analysiere Ticket"}
            `;

            let contents = [{
                role: "user",
                parts: [{ text: `
                    ${SYSTEM_PROMPT}
                    === TICKET VERLAUF ===
                    ${contextText}
                    === CHAT HISTORIE ===
                    ${historyString}
                    === NOTFALL MODUS ===
                    ${fallbackPrompt}
                `}]
            }];

            const fallbackResponse = await executeGeminiLoop(contents, apiKey, cid, false);
            handleAiSuccess(fallbackResponse, isInitial, input, dummyDraft, cid);

        } catch (fallbackError) {
            renderChatMessage('system', "❌ Fallback fehlgeschlagen.");
            console.error(`[CID: ${cid}] Fallback Error:`, fallbackError);
        }
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Go"; }
        window.aiState.isGenerating = false; 
        await releaseLock(cid); // Lock freigeben
    }
}

// Helper: Gemeinsame Erfolgsverarbeitung für Main & Fallback
function handleAiSuccess(finalResponse, isInitial, input, dummyDraft, ticketId) {
    if (!finalResponse) throw new Error("Keine Antwort erhalten");

    renderDraftMessage(finalResponse.draft);
    window.aiState.chatHistory.push({ type: "draft", content: finalResponse.draft });
    
    if (finalResponse.feedback) {
        renderChatMessage('ai', finalResponse.feedback);
        window.aiState.chatHistory.push({ type: "ai", content: finalResponse.feedback });
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
        const storageKey = `draft_${ticketId}`;
        chrome.storage.local.get([storageKey], function(res) {
            const oldData = res[storageKey] || {};
            const preservedInboxHash = oldData.inboxHash || oldData.contentHash || "manual_save_" + Date.now();

            const newData = {
                draft: finalResponse.draft,
                feedback: finalResponse.feedback,
                chatHistory: window.aiState.chatHistory,
                timestamp: Date.now(),
                inboxHash: preservedInboxHash,
                contentHash: preservedInboxHash
            };
            
            const saveObj = {};
            saveObj[storageKey] = newData;
            chrome.storage.local.set(saveObj);
        });
    }
}

// Helper: Ausgelagerter Loop (Verwendet von runAI und Fallback)
async function executeGeminiLoop(contents, apiKey, cid, allowTools) {
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`;
    
    let turnCount = 0;
    const maxTurns = allowTools ? 3 : 1; // Ohne Tools nur 1 Turn erlaubt

    while (turnCount < maxTurns) {
        const payload = { contents: contents };
        
        // Tools nur hinzufügen, wenn erlaubt
        if (allowTools) {
            payload.tools = [{ function_declarations: GEMINI_TOOLS }];
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || `API Error: ${response.status}`);

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
        
        const content = candidate.content;
        // FIX: Sicherstellen, dass parts ein Array ist
        const parts = content.parts || []; 
        
        if (parts.length === 0) {
            // Manchmal ist parts leer, aber der finishReason sagt was passiert ist.
            // Wir werfen keinen harten Fehler, sondern geben null zurück, damit der Loop sauber beendet oder retry macht.
            console.warn("Tradeo AI: Gemini Content Parts sind leer.", candidate);
            return { draft: "", feedback: "API lieferte leeren Inhalt (evtl. Safety Filter)." };
        }

        const functionCallPart = parts.find(p => p.functionCall);

        // Wenn Function Call und Tools erlaubt sind
        if (functionCallPart && allowTools) {
            const fnName = functionCallPart.functionCall.name;
            const fnArgs = functionCallPart.functionCall.args;
            
            const logText = `⚙️ AI ruft Tool: ${fnName}(${JSON.stringify(fnArgs)})`;
            renderChatMessage('system', logText);
            window.aiState.chatHistory.push({ type: "system", content: logText });
            console.log(`[CID: ${cid}] Tool Exec: ${fnName}`);

            let functionResult = await executeToolAction(fnName, fnArgs, cid);

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

        // Kein Function Call oder Tools verboten -> Parsen
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
    throw new Error("Max Turns erreicht ohne Ergebnis");
}

// Helper: Tool Ausführung ausgelagert
async function executeToolAction(fnName, fnArgs, cid) {
    let actionName = '';
    let actionPayload = {};

    if (fnName === 'getOrderDetails') {
        actionName = 'GET_ORDER_FULL'; actionPayload = { orderId: fnArgs.orderId };
    } else if (fnName === 'getItemDetails') {
        actionName = 'GET_ITEM_DETAILS'; actionPayload = { identifier: fnArgs.identifier };
    } else if (fnName === 'getCustomerDetails') {
        actionName = 'GET_CUSTOMER_DETAILS'; actionPayload = { contactId: fnArgs.contactId };
    } else if (fnName === 'searchItemsByText') {
        actionName = 'SEARCH_ITEMS_BY_TEXT';
        actionPayload = { searchText: fnArgs.searchText, mode: fnArgs.mode || 'name', maxResults: fnArgs.maxResults || 30 };
    }

    if (!actionName) return { error: "Unknown Tool" };

    const apiResult = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: actionName, ...actionPayload }, (response) => {
             if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
             else resolve(response);
        });
    });
    
    return apiResult && apiResult.success ? apiResult.data : { error: apiResult ? apiResult.error : "API Fail" };
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
function bootstrapTradeo() {
    startHeartbeat();                 // deine bestehende Logik (AI-UI etc.)
    initPlentyItemSearchDebugButton(); // unser neuer Debug-Button
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

// --- content.js (Debug Update) ---

window.debugPlentyItemSearch = async function(rawSearch) {
    try {
        const searchText = (typeof rawSearch === 'string' ? rawSearch : '').trim();
        if (!searchText) { alert("Bitte Suchtext eingeben."); return; }

        console.clear();
        console.group(`🚀 DEBUG: Smart Item Search für "${searchText}"`);

        // 1. Tokens
        const tokens = Array.from(new Set(searchText.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1)));
        console.log("📦 1. Tokens:", tokens);

        // 2. Pre-Flight
        console.group("📊 2. Token-Analyse (Pre-Flight)");
        const stats = [];
        for (const token of tokens) {
            console.log(`Prüfe Token: "${token}"...`);
            const p1 = callPlenty(`/rest/items/variations?itemsPerPage=1&lang=de&itemName=${encodeURIComponent(token)}`);
            const p2 = callPlenty(`/rest/items/variations?itemsPerPage=1&lang=de&itemDescription=${encodeURIComponent(token)}`);
            
            const [r1, r2] = await Promise.all([p1, p2]);
            const cName = r1 ? r1.totalsCount : 0;
            const cDesc = r2 ? r2.totalsCount : 0;
            const total = cName + cDesc;
            
            console.log(`   👉 "${token}": Name=${cName}, Desc=${cDesc} | Σ = ${total}`);
            stats.push({ token, total });
        }
        console.groupEnd();

        // 3. Gewinner
        const validStats = stats.filter(s => s.total > 0).sort((a, b) => a.total - b.total);
        if (validStats.length === 0) {
            console.warn("❌ Keine Treffer für irgendein Token.");
            console.groupEnd();
            return;
        }
        const winner = validStats[0];
        console.log(`🏆 3. Gewinner-Token: "${winner.token}" (Kleinste Menge: ${winner.total})`);

        // 4. Fetch Loop
        console.group(`📥 4. Lade ALLE Variationen für "${winner.token}"...`);
        let allCandidates = [];
        let page = 1;
        let hasMore = true;
        
        while(hasMore) {
            console.log(`   Lade Seite ${page}...`);
            const pName = callPlenty(`/rest/items/variations?itemsPerPage=50&page=${page}&lang=de&itemName=${encodeURIComponent(winner.token)}`);
            const pDesc = callPlenty(`/rest/items/variations?itemsPerPage=50&page=${page}&lang=de&itemDescription=${encodeURIComponent(winner.token)}`);
            
            const [rName, rDesc] = await Promise.all([pName, pDesc]);
            const entries = [...(rName.entries || []), ...(rDesc.entries || [])];
            
            if (entries.length > 0) allCandidates.push(...entries);
            
            const lastPageName = rName.isLastPage;
            const lastPageDesc = rDesc.isLastPage;
            
            if (lastPageName && lastPageDesc) hasMore = false;
            else page++;
            
            if(page > 10) { console.warn("   ⚠️ Debug-Limit erreicht (10 Seiten)"); hasMore = false; }
        }
        
        const map = new Map();
        allCandidates.forEach(c => map.set(c.id, c));
        const uniqueCandidates = Array.from(map.values());
        console.log(`✅ Geladen: ${uniqueCandidates.length} einzigartige Kandidaten.`);
        console.groupEnd();

        // 5. Filtering
        console.group("🔍 5. Filterung (Matching)");
        let matches = 0;
        const limitDebug = 5; 
        
        for (const cand of uniqueCandidates) {
            if (uniqueCandidates.length > 200 && matches < 1) {
                console.log("   (Zu viele Kandidaten für Detail-Log, zeige nur Zusammenfassung...)");
            }
            
            if (matches < limitDebug) {
               try {
                   // Item Details holen für Name Check
                   const item = await callPlenty(`/rest/items/${cand.itemId}`);
                   let name = "???";
                   if(item.texts && item.texts[0]) name = item.texts[0].name1;
                   
                   const fullString = JSON.stringify(item).toLowerCase();
                   const allIn = tokens.every(t => fullString.includes(t.toLowerCase()));
                   
                   if (allIn) {
                       // HIER: Anzeige angepasst, damit du siehst was die AI später als "ArticleNumber" bekommt
                       console.log(`   ✅ MATCH: [Artikel: ${cand.itemId} | Var: ${cand.id}] ${name}`);
                       matches++;
                   }
               } catch(e) { console.error(e); }
            } else {
                matches++;
            }
        }
        console.log(`🎉 5. Ergebnis: Ca. ${matches} echte Treffer.`);
        console.groupEnd();
        console.log("✅ DEBUG FINISHED");
        console.groupEnd();

    } catch (err) {
        console.error("Debug Error:", err);
    }
};

function initPlentyItemSearchDebugButton() {
    if (window.__plentyDebugBtnInit) return;
    window.__plentyDebugBtnInit = true;

    const btn = document.createElement("button");
    btn.id = "tradeo-plenty-debug-btn";
    btn.textContent = "🧪 Plenty Search Debug";
    btn.style.cssText = `
        position: fixed;
        bottom: 10px;
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
    `;

    btn.addEventListener("mouseenter", () => btn.style.opacity = "1");
    btn.addEventListener("mouseleave", () => btn.style.opacity = "0.7");

    btn.addEventListener("click", async () => {
        const last = window.__lastPlentyDebugSearch || "";
        const input = prompt("Plenty Artikelsuche Debug – Suchtext eingeben:", last);
        if (!input) return;
        window.__lastPlentyDebugSearch = input;
        await window.debugPlentyItemSearch(input);
    });

    document.body.appendChild(btn);
}
