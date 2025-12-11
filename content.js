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
Wir sind Spezialisten für professionelle, refurbished Enterprise-Hardware (Server, Storage, Netzwerk).

VORGABEN:
1. Tonalität: Professionell, freundlich, direkt. Wir Siezen ("Sie").
2. Preis: Webshop-Preise sind fix. Rabatte erst bei größeren Mengen (B2B).
3. Fehler/Probleme: Ehrlich zugeben, lösungsorientiert bleiben.
4. Signatur: Weglassen (wird vom System automatisch angefügt).
5. Formatierung: Achte auf regelmäßige Absatzbildung und verwende regelmäßig leere Zeilen für bessere Leserlichkeit
6. Bitte Fokus auf Sachen auf den Punkt bringen, kurz fassen. Das machts für Kunden einfacher und auch für uns Support-Mitarbeiter, die deine Antwortentwürfe überblicken und überprüfen müssen.
7. Sprache: Logischerweise immer in Kundensprache antworten.

WICHTIG ZUM VERLAUF:
Der übergebene Ticket-Verlauf ist UMGEKEHRT chronologisch sortiert. 
- Die OBERSTE Nachricht ist die NEUESTE (die, auf die wir meistens reagieren).
- Die UNTERSTE Nachricht ist der Ursprung (die älteste).

WISSEN ÜBER SERVERSHOP24 & PRODUKTE:
Geschäftsmodell:
   - Wir verkaufen "Refurbished" Hardware (Gebraucht, aber professionell aufbereitet und getestet). Bei Komponenten haben wir aber durchaus auch vereinzelt Neuware oder Renew-Ware (0h Betriebsstunden)
   - Slogan: "Gebraucht. Geprüft. Geliefert."
   - Zielgruppe: B2B, Admins, Rechenzentren, aber auch ambitionierte Homelab-Nutzer.

Artikelzustände:
   - vereinzelt Neuware verfügbar (v.A. Komponenten), aber selten bei Geräten und nie bei Servern. Aber es kann sein, dass wir mal nen Switch z.B. als Gerät als Neuware da haben.
   - Renew-Ware (0h Betriebsstunden) ohne OVP, unbenutzt
   - die meisten Komponenten sind gebraucht, die Server sind alle refurbished.

Zustand HDDs/SSDs:
   - Kunden fragen oft nach, wie viele Betriebsstunden und wie der Verschleiß ist und SMART Werte. Dazu können wir grundsätzlich keine Auskunft geben.
   - Ausnahme bei SSDs:
   - Renew / Neuware: 100% TBW verbleibend
   - gebraucht, neuwertig: >90% TBW verbleibend
   - gebraucht, sehr gut: 75-90% TBW verbleibend
   - gebraucht, gut: 50-75% TBW verbleibend

Gewährleistung:
   - 6 Monate für gewerbliche Kunden
   - 12 Monate für private Kunden
   - Wir bieten als Upgrade-Optionen auf die meisten Geräte Hardware Care Packs von unserem Servicepartner TechCare Solutions GmbH an, siehe nächsten Abschnitt.

Hardware Care Packs:
   - 1, 2, 3, 5 Jahre sind die Laufzeiten
   - Pickup & Return (weltweit verfügbar), Next Business Day (EU-Festland kein Problem, ansonsten auf Anfrage mit PLZ und Land Angabe), 24/7 Support (in Deutschland kein Problem, ansonsten auf Anfrage mit PLZ und Land Angabe) sind die Servicelevels
   - für Fremdgeräte fallen 10% Fremdgeräteaufschlag an.
   - Für Geräte von uns gilt normaler Preis im Webshop.
   - Verlängerungen von auslaufenden Care Packs, die bei uns gekauft wurden, bieten wir individuell mit 5% Rabatt an.

Widerrufsrecht:
   - nur für Privatkunden bis 14 Tage ab Zustelldatum
   - für Geschäftskunden ist im Normalfall eine Kulanzrücknahme möglich, wenn in gleicher Höhe anderweitig bestellt wird oder eine adäquate Alternative bestellt wird (bis zu 3 Monaten nach Zustellung).
   - falls wir keinen kompatiblen bzw. alternativen Ersatz im Sortiment haben, nehmen wir ggf. auch auf Kulanz zurück, ohne weitere Bestellung. Das aber im Normalfall nur im ersten Monat ab Zustellung.

Bestellen auf Rechnung:
   - Bei Erstbestellung nur mit ordentlicher Bestell-PDF
   - Nur für Firmenkunden
   - Es wird grundsätzlich auftragseinzeln eine mögliche Rechnungsfreigabe geprüft, ggf. unter Abklärung mit unserem Kreditversicherer Atradius.
   - Abweichende Lieferanschriften werden im Regelfall nicht akzeptiert und führen zu einer Ablehnung.
   - Bei Ablehnung geht eine neue Bestellbestätigung mit Zahlungsinformationen für die Zahlung via Vorkasse

Typische Kundenanfragen
   - Kunden bitten oft um das Schicken eines Tracking Links sobald verfügbar. Das geht automatisch per E-Mail raus (Versandbestätigung mit Rechnung) ab Versand.

Artikel & Bundles (am Beispiel HPE DL380 Gen10):
   - "Base"-Server sind oft konfigurierbar.
   - Wichtige technische Details in der Beschreibung beachten:
     * Chassis-Typ: SFF (2.5") vs. LFF (3.5"). Nicht mischbar ohne Umbau!
     * Controller: "AROC" (Modular) vs. "Embedded" (S100i - nur SATA!). Raid-Controller sind essenziell für SAS-Platten.
     * Riser-Cages: Bestimmen, wie viele PCIe-Karten passen.
   - Lieferumfang: Standardmäßig OHNE Betriebssystem/Software, ohne Blindblenden, ohne Kabelarm, sofern nicht anders angegeben.

Upgrade-Struktur:
   - RAM: DDR4 ECC (Registered vs. Load Reduced beachten - nicht mischbar!).
   - HDD/SSD: Wir verkaufen Platten meist inkl. passendem Einbaurahmen (Tray/Caddy).
   - WICHTIG - RAM Upgrades ersetzen den Basis-RAM. Es steht immer da "RAM Upgrade auf 64GB" das heißt, insgesamt werden dann im Gerät eben 64GB sein.
   - WICHTIG - SSD- und HDD-Upgrades ersetzen die Basisfestplatten/Rahmen/Converter, falls vorhanden.
   - WICHTIG - es ist nur ein SSD- ODER HDD-Upgrade möglich, da der Wegfall der Basisfestplatten/Rahmen/Converter enthalten ist. Zwei Upgrades dieser Art würden also doppelten Rabatt bedeuten -> ungültige Upgrade-Konstellation
   - Care Packs: Wir bieten eigene "Hardware Care Packs" an (Service-Erweiterungen, z.B. Next Business Day, 24/7).

Zubehör:
   - Kunden vergessen oft: Rack-Schienen (Rails), Kabelmanagement-Arme, zusätzliche Netzteile (Redundanz), Lizenzen (Windows Server CALs/Cores).
   - Empfehle aktiv passendes Zubehör, wenn es im Kontext Sinn macht (z.B. "Benötigen Sie noch Rack-Schienen oder ein zweites Netzteil zur Absicherung?").

ANTWORT FORMAT:
Antworte IMMER im validen JSON-Format.
Struktur:
{
  "draft": "Der Text für die E-Mail (HTML erlaubt)",
  "feedback": "Kurze Info an den Agent (z.B. 'Habe auf fehlende Rails hingewiesen')"
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
    chatHistory: [], // Array von Objekten: { type: 'user'|'ai'|'draft', content: string }
    currentModel: "gemini-2.5-flash",
    // Cache management V3
    knownTickets: new Map(), // Map<TicketID, ContentHash>
    processingQueue: new Set() // Set<TicketID>
};

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
        
        // FIX: Wir prüfen jetzt auch, ob 'chatHistory' existiert. 
        // Wenn nicht (altes Format), verarbeiten wir neu, auch wenn der Hash gleich ist.
        if (storedData[storageKey] 
            && storedData[storageKey].contentHash === contentHash 
            && storedData[storageKey].chatHistory 
            && Array.isArray(storedData[storageKey].chatHistory)
        ) {
            return; // Nichts zu tun, Daten sind aktuell und im neuen Format
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
            // FIX: Initialer Verlauf mit Draft-Bubble UND Text
            const initialHistory = [
                { type: 'draft', content: aiResult.draft },
                { type: 'ai', content: aiResult.feedback + " (Vorbereitet)" }
            ];

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

    // Neues HTML Layout mit Settings Panel
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
                <button id="tradeo-ai-model-btn" type="button">2.5 Flash</button>
                <div id="tradeo-ai-model-dropdown" class="hidden"></div>
            </div>
            <textarea id="tradeo-ai-input" placeholder="Anweisung an AI..."></textarea>
            <button id="tradeo-ai-send-btn">Go</button>
        </div>
    `;
    mainContainer.prepend(copilotContainer);
    
    // UI Event Listener laden
    setupSettingsLogic(); // <--- NEU
    
    const originalReplyBtn = document.querySelector('.conv-reply');
    if(originalReplyBtn) setupButtons(originalReplyBtn);
    
    document.getElementById('tradeo-ai-expand-btn').addEventListener('click', expandInterface);

    setupModelSelector();
    setupEditorObserver();
    setupResizeHandler();
    copilotContainer.style.display = 'block';

    // Cache laden (Unverändert)
    const ticketId = getTicketIdFromUrl();
    if (ticketId) {
        const storageKey = `draft_${ticketId}`;
        chrome.storage.local.get([storageKey], function(result) {
            const cached = result[storageKey];
            if (cached) {
                const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
                window.aiState.lastDraft = cached.draft;
                dummyDraft.innerHTML = cached.draft;
                
                document.getElementById('tradeo-ai-chat-history').innerHTML = ''; 
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
            } else {
                renderChatMessage("system", "Kein Entwurf gefunden. Starte Live-Analyse...");
                runAI(true);
            }
        });
    } else {
        runAI(true);
    }
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

// Neue Funktion zum Ausklappen
function expandInterface() {
    const zone = document.getElementById('tradeo-ai-copilot-zone');
    if (zone) {
        zone.classList.remove('tradeo-collapsed');
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
    
    // --- FIX: API Key Logik bereinigt ---
    // Wir holen den Key jetzt immer frisch aus dem Storage, da er im Settings-Panel gespeichert wird.
    const storageData = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = storageData.geminiApiKey;

    let userPrompt = "";

    // 1. User Input verarbeiten (außer bei Init)
    if (isInitial) {
        userPrompt = "Analysiere das Ticket und erstelle einen passenden Antwortentwurf.";
    } else { 
        userPrompt = input.value.trim();
        if (!userPrompt) return; 
        
        // UI rendern
        renderChatMessage('user', userPrompt); 
        
        // In State speichern
        window.aiState.chatHistory.push({ type: "user", content: userPrompt }); 
    }

    // Check: Haben wir einen Key?
    if (!apiKey) {
        renderChatMessage('system', "⚠️ Kein API Key gefunden. Bitte oben auf das Zahnrad klicken und Key speichern.");
        // Optional: Settings Panel automatisch öffnen
        document.getElementById('tradeo-ai-settings-panel').classList.add('visible');
        expandInterface();
        window.aiState.isGenerating = false; 
        return; 
    }

    window.aiState.isGenerating = true;
    if(btn) { btn.disabled = true; btn.innerText = "..."; }
    
    const contextText = extractContextFromDOM(document);
    // Verlauf für Prompt aufbereiten (nur Text-Inhalt)
    const historyString = window.aiState.chatHistory.map(e => {
        if(e.type === 'draft') return ""; // Drafts nicht in den Prompt Kontext (zu lang/irrelevant)
        const role = e.type === 'user' ? 'User' : 'AI';
        return `${role}: ${e.content}`;
    }).join("\n");
    
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

        // 2. Draft verarbeiten
        renderDraftMessage(jsonResponse.draft);
        window.aiState.chatHistory.push({ type: "draft", content: jsonResponse.draft });
        
        // 3. Feedback verarbeiten
        renderChatMessage('ai', jsonResponse.feedback);
        window.aiState.chatHistory.push({ type: "ai", content: jsonResponse.feedback });
        
        // Status Update
        window.aiState.lastDraft = jsonResponse.draft;
        
        if (window.aiState.isRealMode && !window.aiState.preventOverwrite) {
            const editable = document.querySelector('.note-editable');
            if (editable) setEditorContent(editable, jsonResponse.draft);
        } else {
            dummyDraft.innerHTML = jsonResponse.draft;
            if(!window.aiState.preventOverwrite && !window.aiState.isRealMode) { dummyDraft.style.display = 'block'; flashElement(dummyDraft); }
        }
        if(!isInitial && input) input.value = '';

        // --- PERSISTENZ SPEICHERN ---
        // Speichert das komplette History Array inkl. Drafts
        const ticketId = getTicketIdFromUrl();
        if (ticketId) {
            const storageKey = `draft_${ticketId}`;
            // Alten Hash holen
            chrome.storage.local.get([storageKey], function(res) {
                const oldData = res[storageKey] || {};
                const currentHash = oldData.contentHash || "modified_by_user";

                const newData = {
                    draft: jsonResponse.draft,
                    feedback: jsonResponse.feedback,
                    chatHistory: window.aiState.chatHistory, 
                    timestamp: Date.now(),
                    contentHash: currentHash
                };
                
                const saveObj = {};
                saveObj[storageKey] = newData;
                chrome.storage.local.set(saveObj);
            });
        }
        // ---------------------------------

    } catch(e) {
        renderChatMessage('system', "Error: " + e.message);
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Go"; }
        window.aiState.isGenerating = false; 
        window.aiState.preventOverwrite = false;
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

/**
 * TEST: Holt Order Item Properties (aus deinem Screenshot)
 * Endpoint: /rest/orders/items/{orderItemId}/properties
 * * Nutzung: window.testItemProperties() in der Konsole eingeben.
 * (Sucht sich automatisch eine gültige Item-ID aus dem letzten Auftrag, damit du nicht suchen musst)
 */
window.testItemProperties = async function(manualItemId = null) {
    console.log("🕵️ Starte Test für Order Item Properties...");

    try {
        let itemId = manualItemId;

        // 1. Wenn keine ID übergeben wurde, holen wir uns schnell eine echte aus dem letzten Auftrag
        if (!itemId) {
            console.log("Keine ID angegeben. Suche nach dem neuesten Auftrag...");
            // Wir laden den letzten Auftrag inkl. OrderItems
            const orders = await callPlenty('/rest/orders?itemsPerPage=1&with[]=orderItems');
            
            if (orders.entries && orders.entries.length > 0 && orders.entries[0].orderItems.length > 0) {
                const order = orders.entries[0];
                itemId = order.orderItems[0].id; // Nimm das erste Item
                console.log(`💡 Gefunden: Auftrag ID ${order.id}, nutze Item ID ${itemId}`);
            } else {
                console.warn("❌ Keine Aufträge oder Items im System gefunden.");
                alert("Konnte keine Test-ID finden (System leer?).");
                return;
            }
        }

        // 2. Der eigentliche Call aus deinem Screenshot
        console.log(`🚀 Rufe Properties für Item ${itemId} ab...`);
        const endpoint = `/rest/orders/items/${itemId}/properties`;
        
        const data = await callPlenty(endpoint);

        // 3. Ergebnis
        console.log("✅ ERGEBNIS (Properties):", data);
        
        if (Array.isArray(data) && data.length === 0) {
            alert(`Abruf erfolgreich für Item ${itemId}, aber Liste war leer ( [] ).`);
        } else {
            alert(`Erfolg! Daten für Item ${itemId} geladen. Siehe Konsole (F12).`);
        }

    } catch (e) {
        console.error("❌ Fehler beim Test:", e);
        alert("Fehler: " + e);
    }
};