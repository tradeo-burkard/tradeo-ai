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

// SYSTEM PROMPT
const SYSTEM_PROMPT = `
Du bist "Tradeo AI", der technische Support-Assistent für Servershop24.
Deine Aufgabe ist es, den Nachrichtenverlauf zu analysieren und einen perfekten, fachlich korrekten Antwortentwurf für den Support-Mitarbeiter zu erstellen.

### DATEN-FORMAT (WICHTIG):
Der Ticket-Verlauf wird dir als **JSON-Array** übergeben. Jedes Objekt darin ist eine Nachricht.
Felder pro Nachricht:
- "type": "customer_message" (Kunde), "support_reply" (Wir), "internal_note" (Interne Notiz - NICHT für den Kunden sichtbar!).
- "sender": Name des Absenders.
- "recipients": Empfänger und CCs (String).
- "time": Zeitpunkt.
- "body": Der Inhalt.
- "files": Anhänge (Array).

Achte streng darauf, **interne Notizen** ("type": "internal_note") nur als Kontext zu nutzen, aber niemals so zu tun, als hätte der Kunde diese Informationen!

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

**A. BEI BESTELLUNGEN (fetchOrderDetails):**
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
3. Interpretation von 0,00 EUR Artikeln: Wenn bei einem Artikel in orderItems das Feld amounts leer ist ([]), handelt es sich um eine Position ohne Berechnung (Preis 0,00 EUR).
   Dies sind in der Regel Bundle-Komponenten (Teil eines Sets), Austauschartikel (Gewährleistung) oder interne Verrechnungspositionen. Erwähne diese Artikel, aber weise keinen Preis aus.
4. Bundle-Bestandteile: Wenn orderItems mit der Bezeichnung "- " beginnen, sind das Bundle-Bestandteile und gehören zum ersten überstehenden Artikel, der KEINEN "- " Präfix hat.
5. shippingPackages: Hier ist das erste Array im Normalfall ohne Paketnummer (""), aber mit dem Gesamtgewicht der Bestellung. Dabei handelt es sich also nicht um ein physikalisches Paket, sondern nur
   um die automatische Gewichtserfassung. Die Folge-Arrays haben typischerweise keine Gewichtsangabe bzw. "0" als Gewicht, enthalten aber eine Paketnummer -> physikalische Pakete

**B. BEI ARTIKELN (fetchItemDetails / searchItemsByText):**

1. **Identifikator-Suche (fetchItemDetails):**
   - Nutze 'fetchItemDetails' IMMER dann, wenn du eine spezifische Nummer oder Kennung im Text erkennst.
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

**C. BEI KUNDEN (fetchCustomerDetails):**
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
  "response_language": "DE", falls Gesprächsverlauf auf deutsch war, oder "EN", falls englisch oder andere Sprache!
  "reasoning": "Warum so entschieden? (z.B. 'Lagerbestand ist 0 -> informiere Kunde')",
  "draft": "HTML Antworttext in der response_language ermittelten Sprache(<p>...</p>)",
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
        "name": "fetchOrderDetails",
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
        "name": "fetchItemDetails",
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
        "name": "fetchCustomerDetails",
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

async function processTicket(id, incomingInboxHash) {
    try {
        // 1. Locking prüfen
        const lockAcquired = await acquireLock(id, 'background');
        if (!lockAcquired) {
            // Log Level reduziert, um Konsole sauberer zu halten
            // console.log(`[CID: ${id}] Skip Pre-Fetch: Locked.`);
            return;
        }

        const storageKey = `draft_${id}`;
        const storedRes = await chrome.storage.local.get([storageKey]);
        const storedData = storedRes[storageKey];

        // Abbruch wenn Inbox-Hash identisch (Preview hat sich nicht geändert)
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
        
        // Nutzt jetzt die neue Logik ohne Zeitstempel
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
                contentHash: realContentHash // <--- Hash des bereinigten Textes speichern
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

    // --- TIMEOUT LOGIK (UPDATED) ---
    const currentModel = window.aiState.currentModel || "gemini-2.5-pro";
    const isSlowModel = currentModel.includes("gemini-3-pro");
    
    // FIX: Timeout mal Turns nehmen (außer bei Slow Model, da ist es ein Hard-Cap)
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

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

async function executeHeadlessLoop(contents, apiKeyIgnored, ticketId, allowTools) {
    // Info: apiKeyIgnored wird nicht mehr genutzt
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    
    let executedTools = [];
    let turnCount = 0;
    // FIX: Konstante nutzen
    const maxTurns = allowTools ? MAX_TURNS : 1;

    while (turnCount < maxTurns) {
        const payload = { contents: contents };
        if (allowTools) payload.tools = [{ function_declarations: GEMINI_TOOLS }];

        // --- HIER IST DIE ÄNDERUNG: Aufruf über Rotation ---
        const data = await callGeminiWithRotation(payload, model);
        // ----------------------------------------------------

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
        
        const content = candidate.content;
        const parts = content.parts || []; 
        
        if (parts.length === 0) {
            console.warn("Tradeo AI Headless: Gemini Content Parts sind leer. Trigger Fallback.", candidate);
            throw new Error("GEMINI_SAFETY_FILTER_TRIGGERED");
        }

        const functionCallPart = parts.find(p => p.functionCall);

        if (functionCallPart && allowTools) {
            const fnName = functionCallPart.functionCall.name;
            const fnArgs = functionCallPart.functionCall.args;
            
            executedTools.push(`⚙️ AI nutzt Tool: ${fnName}(${JSON.stringify(fnArgs)})`);
            // Tool Logic (gekürzt, da identisch zum Original)
            let functionResult = null;
            let actionName = '';
            let actionPayload = {};

            if (fnName === 'fetchOrderDetails') { actionName = 'GET_ORDER_FULL'; actionPayload = { orderId: fnArgs.orderId }; }
            else if (fnName === 'fetchItemDetails') { actionName = 'GET_ITEM_DETAILS'; actionPayload = { identifier: fnArgs.identifier }; }
            else if (fnName === 'fetchCustomerDetails') { actionName = 'GET_CUSTOMER_DETAILS'; actionPayload = { contactId: fnArgs.contactId }; }
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

// =============================================================================
// FUNKTION: CONTEXT EXTRACTION (JSON V4 - No Drafts)
// =============================================================================
/**
 * Extrahiert den strukturierten Text-Kontext für die AI als JSON-String.
 * Updates: 
 * - Ignoriert Nachrichten, wenn Sender "[Entwurf]" enthält (verhindert Hash-Änderung beim Tippen).
 * - "msg" statt "body", "cc" als Array.
 */
function extractContextFromDOM(docRoot) {
    const mainContainer = docRoot.querySelector('#conv-layout-main');
    if (!mainContainer) return "[]"; 

    const messages = [];
    // Reihenfolge im DOM ist meist: Neueste Oben -> Wir drehen um für Chronologie (Alt -> Neu)
    const threads = Array.from(mainContainer.querySelectorAll('.thread')).reverse();

    threads.forEach(thread => {
        // 1. SENDER & ZEIT (Zuerst holen für Filter)
        const personEl = thread.querySelector('.thread-person');
        const senderName = personEl ? personEl.innerText.trim().replace(/\s+/g, ' ') : "Unbekannt";

        // --- FILTER: ENTWÜRFE IGNORIEREN ---
        // Wenn dies ein Entwurf ist, brechen wir hier ab. 
        // Das verhindert, dass der Content-Hash sich ändert, während ein Agent tippt/speichert.
        if (senderName.includes("[Entwurf]") || senderName.includes("[Draft]")) {
            return; 
        }

        // 2. TYP BESTIMMUNG
        let type = "unknown";
        if (thread.classList.contains('thread-type-note')) {
            type = "internal_note";
        } else if (thread.classList.contains('thread-type-customer')) {
            type = "customer_message";
        } else if (thread.classList.contains('thread-type-message')) {
            type = "support_reply";
        }

        const dateEl = thread.querySelector('.thread-date');
        const timestamp = dateEl ? (dateEl.getAttribute('data-original-title') || dateEl.innerText.trim()) : "";

        // 3. EMPFÄNGER (CC) PARSING
        // Ziel: ["mail@a.com", "mail@b.com"] ohne "An:" Prefix
        let recipientsList = [];
        const recipientsContainer = thread.querySelector('.thread-recipients');
        if (recipientsContainer) {
            // Text holen (z.B. "An: a@b.com, c@d.com")
            let rawText = recipientsContainer.innerText;
            // Prefixes entfernen (An:, Cc:, Bcc:, Von:)
            rawText = rawText.replace(/^(An|Cc|Bcc|Von):\s*/gim, '').replace(/\n/g, ',');
            
            // Splitten am Komma und bereinigen
            recipientsList = rawText.split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.toLowerCase().includes('an:')); // Sicherheitsfilter
        }

        // 4. NACHRICHTEN-INHALT
        let bodyText = "";
        const contentEl = thread.querySelector('.thread-content');
        if (contentEl) {
            const clone = contentEl.cloneNode(true);
            bodyText = clone.innerText.trim();
        }

        // 5. ANHÄNGE
        let fileList = [];
        const attachmentsEl = thread.querySelector('.thread-attachments');
        if (attachmentsEl) {
            fileList = Array.from(attachmentsEl.querySelectorAll('li')).map(li => {
                const link = li.querySelector('a.attachment-link');
                const sizeSpan = li.querySelector('.text-help');
                const name = link ? link.innerText.trim() : "";
                const size = sizeSpan ? sizeSpan.innerText.trim() : "";
                return name ? (size ? `${name} (${size})` : name) : null;
            }).filter(Boolean);
        }

        // ✅ FIX: "Ghost/Placeholder"-Threads ignorieren (verhindert Re-Hashing)
        if (
            senderName === "Unbekannt" &&
            type === "unknown" &&
            (!bodyText || bodyText.trim() === "") &&
            recipientsList.length === 0 &&
            fileList.length === 0
        ) {
            return; // Thread komplett überspringen
        }

        // 6. JSON OBJEKT BAUEN
        const msgObj = {
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
        // MATCH: Alles gut
        if (cached.contentHash === currentHash) {
            console.log(`[CID: ${ticketId}] Cache gültig. Lade...`);
            loadFromCache(ticketId);
            return;
        } 
        
        // MISMATCH: Inhalt anders
        console.log(`[CID: ${ticketId}] Cache veraltet (Stored: ${cached.contentHash} vs DOM: ${currentHash}). Reset.`);
        
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
                        // Legacy Fallback für alte Nachrichten
                        renderChatMessage('ai', msg.content);
                    } else if (msg.type === 'reasoning') {
                        // NEU: Reasoning Message
                        renderReasoningMessage(msg.summary, msg.details);
                    } else if (msg.type === 'system') {
                        renderChatMessage('system', msg.content);
                    } else {
                        // Generic Fallback
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

// Render Funktion für Reasoning/Feedback (Blaue Box, klickbar)
function renderReasoningMessage(summary, details) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    if(!historyContainer) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'reasoning-msg'; 
    
    // Fallback falls Reasoning leer ist
    const safeDetails = details || "Keine detaillierte Begründung verfügbar.";

    msgDiv.innerHTML = `
        <div class="reasoning-header">AI (Reasoning anzeigen)</div>
        <div class="reasoning-summary">${summary}</div>
        <div class="reasoning-body">${safeDetails}</div>
    `;
    
    // Toggle Event
    msgDiv.onclick = (e) => {
        // Verhindert, dass Klicks im Body (z.B. beim Kopieren) das Ding zuklappen, falls gewünscht. 
        // Hier lassen wir es togglen bei Klick auf den Container.
        msgDiv.classList.toggle('expanded');
    };

    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function generateContentHash(str) {
    let hash = 0;
    if (str.length === 0) return 'hash_0';
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash | 0; // Convert to 32bit integer
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
    
    // FIX: Timeout mal Turns nehmen
    const dynamicTimeoutMs = isSlowModel ? AI_TIMEOUT_SLOW : (AI_TIMEOUT_PER_TURN * MAX_TURNS);

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

    // 1. Draft rendern
    renderDraftMessage(finalResponse.draft);
    window.aiState.chatHistory.push({ type: "draft", content: finalResponse.draft });
    
    // 2. Feedback & Reasoning rendern (NEU)
    if (finalResponse.feedback || finalResponse.reasoning) {
        const feedbackText = finalResponse.feedback || "Antwort erstellt.";
        const reasoningText = finalResponse.reasoning || ""; // Kann leer sein

        renderReasoningMessage(feedbackText, reasoningText);
        
        // WICHTIG: Wir speichern jetzt ein neues Objekt-Format für den Verlauf
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
                feedback: finalResponse.feedback, // Legacy field
                chatHistory: window.aiState.chatHistory,
                timestamp: Date.now(),
                inboxHash: preservedInboxHash,
                contentHash: currentHash 
            };
            
            const saveObj = {};
            saveObj[storageKey] = newData;
            chrome.storage.local.set(saveObj);
        });
    }
}

// Ersetze die Funktion executeGeminiLoop durch diese Version:
async function executeGeminiLoop(contents, apiKeyIgnored, cid, allowTools) {
    // Info: 'apiKeyIgnored' wird nicht mehr genutzt, wir holen die Liste intern in callGeminiWithRotation
    const model = window.aiState.currentModel || "gemini-2.5-pro";
    
    let turnCount = 0;
    // FIX: Konstante nutzen
    const maxTurns = allowTools ? MAX_TURNS : 1; 

    while (turnCount < maxTurns) {
        const payload = { contents: contents };
        
        if (allowTools) {
            payload.tools = [{ function_declarations: GEMINI_TOOLS }];
        }

        // --- HIER IST DIE ÄNDERUNG: Aufruf über Rotation ---
        const data = await callGeminiWithRotation(payload, model);
        // ----------------------------------------------------

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) throw new Error(`Leere Antwort (Reason: ${candidate?.finishReason})`);
        
        const content = candidate.content;
        const parts = content.parts || []; 
        
        if (parts.length === 0) {
            console.warn("Tradeo AI: Gemini Content Parts sind leer (Safety Filter?). Trigger Fallback.", candidate);
            throw new Error("GEMINI_SAFETY_FILTER_TRIGGERED");
        }

        const functionCallPart = parts.find(p => p.functionCall);

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

    if (fnName === 'fetchOrderDetails') {
        actionName = 'GET_ORDER_FULL'; actionPayload = { orderId: fnArgs.orderId };
    } else if (fnName === 'fetchItemDetails') {
        actionName = 'GET_ITEM_DETAILS'; actionPayload = { identifier: fnArgs.identifier };
    } else if (fnName === 'fetchCustomerDetails') {
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
    const stripHtmlToText = (html) => {
        if (!html) return "";
        let text = html;
        text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    };

    try {
        const searchText = (typeof rawSearch === 'string' ? rawSearch : '').trim();
        if (!searchText) { alert("Bitte Suchtext eingeben."); return; }

        console.clear();
        console.group(`🚀 DEBUG: Smart Item Search für "${searchText}" (NUR AKTIVE ARTIKEL)`);

        // Tokens
        const tokens = Array.from(new Set(searchText.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1)));
        console.log("📦 1. Tokens:", tokens);

        // Pre-Flight
        console.group("📊 2. Token-Analyse (Pre-Flight)");
        const stats = [];
        for (const token of tokens) {
            // UPDATED: &isActive=true hinzugefügt
            const p1 = callPlenty(`/rest/items/variations?itemsPerPage=1&lang=de&isActive=true&itemName=${encodeURIComponent(token)}`);
            const [r1] = await Promise.all([p1]);
            const cName = r1 ? r1.totalsCount : 0;
            console.log(`   👉 "${token}": Hits=${cName}`);
            stats.push({ token, total: cName });
        }
        console.groupEnd();

        const validStats = stats.filter(s => s.total > 0).sort((a, b) => a.total - b.total);
        if (validStats.length === 0) {
            console.warn("❌ Keine Treffer für irgendein Token (bei aktiven Artikeln).");
            console.groupEnd();
            return;
        }
        const winner = validStats[0];
        console.log(`🏆 3. Gewinner-Token: "${winner.token}"`);

        // Fetch Loop
        console.group(`📥 4. Lade ALLE Variationen für "${winner.token}"...`);
        let allCandidates = [];
        let page = 1;
        let hasMore = true;
        
        while(hasMore) {
            // UPDATED: &isActive=true hinzugefügt
            const res = await callPlenty(`/rest/items/variations?itemsPerPage=50&page=${page}&lang=de&isActive=true&itemName=${encodeURIComponent(winner.token)}`);
            if (res && res.entries) allCandidates.push(...res.entries);
            if (res.isLastPage || !res.entries || res.entries.length < 50) hasMore = false;
            else page++;
            if(page > 20) { hasMore = false; console.warn("   ⚠️ Abbruch: Zu viele Seiten (>20)."); }
        }
        
        const map = new Map();
        allCandidates.forEach(c => map.set(c.id, c));
        const uniqueCandidates = Array.from(map.values());
        console.log(`✅ Geladen: ${uniqueCandidates.length} Kandidaten.`);
        console.groupEnd();

        // Filtering & AI Object Bau
        console.group("🔍 5. Filterung & AI-Objekt Bau");
        let matches = 0;
        const limitDebug = 10; 
        // UPDATED FILTER:
        const bannedRegex = /(hardware\s*care\s*pack|upgrade|bundle)/i;
        const aiResults = [];
        
        for (const cand of uniqueCandidates) {
           try {
               const item = await callPlenty(`/rest/items/${cand.itemId}`);
               let apiName = "Unbekannt";
               let apiDesc = "";
               if(item.texts) {
                   const t = item.texts.find(x => x.lang === 'de') || item.texts[0];
                   if(t) {
                       apiName = [t.name1, t.name2, t.name3].filter(Boolean).join(" ");
                       apiDesc = t.description || "";
                   }
               }

               const fullText = (apiName + " " + apiDesc).toLowerCase();
               if (bannedRegex.test(fullText)) continue; // Filter Check
               
               const allIn = tokens.every(t => fullText.includes(t.toLowerCase()));
               
               if (allIn) {
                   matches++;
                   if (matches <= limitDebug) {
                       console.log(`   🔄 Lade Details für Match #${matches}: ${apiName}...`);
                       
                       const [stockRes, priceRes] = await Promise.all([
                           callPlenty(`/rest/items/${cand.itemId}/variations/${cand.id}/stock`).catch(() => []),
                           callPlenty(`/rest/items/${cand.itemId}/variations/${cand.id}/variation_sales_prices`).catch(() => [])
                       ]);

                       const stockNet = (stockRes && stockRes.length > 0) ? stockRes[0].netStock : 0;
                       const price = (priceRes && priceRes.length > 0) ? priceRes[0].price : "N/A";
                       
                       // SPLIT LOGIK (Name aus Desc, Desc Rest)
                       const cleanFullDesc = stripHtmlToText(apiDesc);
                       const lines = cleanFullDesc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                       
                       let derivedName = lines.length > 0 ? lines[0] : apiName;
                       derivedName = derivedName.replace(/^Beschreibung:\s*/i, '');
                       const derivedDesc = lines.length > 1 ? lines.slice(1).join('\n') : "";

                       const aiObj = {
                           articleNumber: String(cand.itemId),
                           model: cand.model,
                           name: derivedName,     
                           description: derivedDesc, 
                           stockNet: stockNet,
                           price: price
                       };
                       
                       aiResults.push(aiObj);
                   } else {
                       if (matches === limitDebug + 1) console.warn("   ⚠️ Weitere Details übersprungen (Debug Limit)...");
                   }
               }
           } catch(e) { console.error(e); }
        }
        console.groupEnd();

        console.log(`🎉 Ergebnis: ${matches} Treffer gefunden.`);
        if (aiResults.length > 0) {
            console.log("👇 WAS DIE AI BEKOMMT (Vorschau Top 10):");
            console.table(aiResults);
            if(aiResults[0].description) console.log("📜 Beispiel Description (Plain Text):", aiResults[0].description);
            else console.log("📜 Beispiel Description: (LEER - war identisch mit Name)");
        } else {
            console.warn("⚠️ Keine Ergebnisse für AI.");
        }
        console.log("✅ DEBUG FINISHED");
        console.groupEnd();

    } catch (err) {
        console.error("Debug Error:", err);
    }
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

// (Bestehende Funktion unverändert, hier nur damit der Block komplett ist)
window.debugPlentyItemSearch = async function(rawSearch) {
    const stripHtmlToText = (html) => {
        if (!html) return "";
        let text = html;
        text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    };

    try {
        const searchText = (typeof rawSearch === 'string' ? rawSearch : '').trim();
        if (!searchText) { alert("Bitte Suchtext eingeben."); return; }

        console.clear();
        console.group(`🚀 DEBUG: Smart Item Search für "${searchText}" (NUR AKTIVE ARTIKEL)`);

        // Tokens
        const tokens = Array.from(new Set(searchText.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1)));
        console.log("📦 1. Tokens:", tokens);

        // Pre-Flight
        console.group("📊 2. Token-Analyse (Pre-Flight)");
        const stats = [];
        for (const token of tokens) {
            const p1 = callPlenty(`/rest/items/variations?itemsPerPage=1&lang=de&isActive=true&itemName=${encodeURIComponent(token)}`);
            const [r1] = await Promise.all([p1]);
            const cName = r1 ? r1.totalsCount : 0;
            console.log(`   👉 "${token}": Hits=${cName}`);
            stats.push({ token, total: cName });
        }
        console.groupEnd();

        const validStats = stats.filter(s => s.total > 0).sort((a, b) => a.total - b.total);
        if (validStats.length === 0) {
            console.warn("❌ Keine Treffer für irgendein Token (bei aktiven Artikeln).");
            console.groupEnd();
            return;
        }
        const winner = validStats[0];
        console.log(`🏆 3. Gewinner-Token: "${winner.token}"`);

        // Fetch Loop
        console.group(`📥 4. Lade ALLE Variationen für "${winner.token}"...`);
        let allCandidates = [];
        let page = 1;
        let hasMore = true;
        
        while(hasMore) {
            const res = await callPlenty(`/rest/items/variations?itemsPerPage=50&page=${page}&lang=de&isActive=true&itemName=${encodeURIComponent(winner.token)}`);
            if (res && res.entries) allCandidates.push(...res.entries);
            if (res.isLastPage || !res.entries || res.entries.length < 50) hasMore = false;
            else page++;
            if(page > 20) { hasMore = false; console.warn("   ⚠️ Abbruch: Zu viele Seiten (>20)."); }
        }
        
        const map = new Map();
        allCandidates.forEach(c => map.set(c.id, c));
        const uniqueCandidates = Array.from(map.values());
        console.log(`✅ Geladen: ${uniqueCandidates.length} Kandidaten.`);
        console.groupEnd();

        // Filtering & AI Object Bau
        console.group("🔍 5. Filterung & AI-Objekt Bau");
        let matches = 0;
        const limitDebug = 10; 
        const bannedRegex = /(hardware\s*care\s*pack|upgrade|bundle)/i;
        const aiResults = [];
        
        for (const cand of uniqueCandidates) {
           try {
               const item = await callPlenty(`/rest/items/${cand.itemId}`);
               let apiName = "Unbekannt";
               let apiDesc = "";
               if(item.texts) {
                   const t = item.texts.find(x => x.lang === 'de') || item.texts[0];
                   if(t) {
                       apiName = [t.name1, t.name2, t.name3].filter(Boolean).join(" ");
                       apiDesc = t.description || "";
                   }
               }

               const fullText = (apiName + " " + apiDesc).toLowerCase();
               if (bannedRegex.test(fullText)) continue; 
               
               const allIn = tokens.every(t => fullText.includes(t.toLowerCase()));
               
               if (allIn) {
                   matches++;
                   if (matches <= limitDebug) {
                       console.log(`   🔄 Lade Details für Match #${matches}: ${apiName}...`);
                       
                       const [stockRes, priceRes] = await Promise.all([
                           callPlenty(`/rest/items/${cand.itemId}/variations/${cand.id}/stock`).catch(() => []),
                           callPlenty(`/rest/items/${cand.itemId}/variations/${cand.id}/variation_sales_prices`).catch(() => [])
                       ]);

                       const stockNet = (stockRes && stockRes.length > 0) ? stockRes[0].netStock : 0;
                       const price = (priceRes && priceRes.length > 0) ? priceRes[0].price : "N/A";
                       
                       const cleanFullDesc = stripHtmlToText(apiDesc);
                       const lines = cleanFullDesc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                       
                       let derivedName = lines.length > 0 ? lines[0] : apiName;
                       derivedName = derivedName.replace(/^Beschreibung:\s*/i, '');
                       const derivedDesc = lines.length > 1 ? lines.slice(1).join('\n') : "";

                       const aiObj = {
                           articleNumber: String(cand.itemId),
                           model: cand.model,
                           name: derivedName,     
                           description: derivedDesc, 
                           stockNet: stockNet,
                           price: price
                       };
                       
                       aiResults.push(aiObj);
                   } else {
                       if (matches === limitDebug + 1) console.warn("   ⚠️ Weitere Details übersprungen (Debug Limit)...");
                   }
               }
           } catch(e) { console.error(e); }
        }
        console.groupEnd();

        console.log(`🎉 Ergebnis: ${matches} Treffer gefunden.`);
        if (aiResults.length > 0) {
            console.log("👇 WAS DIE AI BEKOMMT (Vorschau Top 10):");
            console.table(aiResults);
        } else {
            console.warn("⚠️ Keine Ergebnisse für AI.");
        }
        console.log("✅ DEBUG FINISHED");
        console.groupEnd();

    } catch (err) {
        console.error("Debug Error:", err);
    }
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