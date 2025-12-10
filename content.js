// --- KONFIGURATION ---

// Das Modell. "gemini-1.5-flash" ist ideal für Speed & Kosten.
// Wenn du später auf 2.5 oder 3.0 wechseln willst, ändere einfach diesen String.
const MODEL_NAME = "gemini-2.5-flash"; 
const API_VERSION = "v1beta";

// SYSTEM PROMPT
const SYSTEM_PROMPT = `
Du bist ein erfahrener Support-Mitarbeiter der Firma "Tradeo / Servershop24".
Wir verkaufen Serverhardware, RAM und Storage.

VORGABEN:
1. Tonalität: Professionell, freundlich, direkt. Wir Siezen (außer bei offensichtlichem Du).
2. Preis: Webshop-Preise sind scharf kalkuliert. Rabatte erst bei Projektmengen (>20-30 Stk) prüfen.
3. Fehler: Wenn wir (Tradeo) Fehler gemacht haben, geben wir das ehrlich zu.
4. Stil: Keine Phrasendrescherei. Kurz und hilfreich für den Kunden.
5. Signatur: Bitte immer Signatur weglassen. Das MfG und Name wird automatisch hinzugefügt!
`;


function init() {
    // 1. Sidebar suchen (FreeScout Standard oder Fallback)
    let sidebarContainer = document.getElementById('sidebar') || document.querySelector('.thread-sidebar') || document.getElementById('conv-layout-main');
    
    // Check, ob Widget schon existiert
    if (document.getElementById('tradeo-ai-box')) return;

    // 2. Widget HTML erstellen
    const container = document.createElement('div');
    container.id = 'tradeo-ai-box';
    
    // Styles für den Fallback (falls Sidebar fehlt)
    if (!document.getElementById('sidebar') && !document.querySelector('.thread-sidebar')) {
        container.style.position = "fixed";
        container.style.bottom = "20px";
        container.style.right = "20px";
        container.style.width = "300px";
        container.style.zIndex = "9999";
        container.style.backgroundColor = "white";
        container.style.boxShadow = "0 0 10px rgba(0,0,0,0.2)";
    }
    
    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #4285f4; margin-bottom: 10px; padding-bottom: 5px;">
            <h3 style="margin:0; font-size:14px; font-weight:bold; color:#333;">⚡ Tradeo AI</h3>
            <a href="#" id="tradeo-reset-key" style="font-size:10px; color:#888; text-decoration:none; display:none;">(Key ändern)</a>
        </div>
        
        <input type="password" id="tradeo-apikey-input" placeholder="Google API Key hier einfügen..." />
        
        <div>
            <textarea id="tradeo-ai-input" rows="4" placeholder="Befehl eingeben (Enter zum Senden)"></textarea>
        </div>
        
        <button id="tradeo-ai-btn">Antwort generieren 🚀</button>
        <div id="tradeo-ai-result"></div>
    `;

    // Widget einfügen
    if (sidebarContainer && (sidebarContainer.id === 'sidebar' || sidebarContainer.className.includes('sidebar'))) {
        sidebarContainer.prepend(container);
    } else {
        document.body.appendChild(container);
    }

    // --- LOGIK: API KEY HANDLING ---
    const apiKeyInput = document.getElementById('tradeo-apikey-input');
    const resetLink = document.getElementById('tradeo-reset-key');

    // Key beim Laden prüfen
    chrome.storage.local.get(['geminiApiKey'], function(result) {
        if (result.geminiApiKey) {
            apiKeyInput.style.display = 'none'; // Input verstecken
            resetLink.style.display = 'block';  // Reset Link zeigen
        }
    });

    // Reset Link Klick
    resetLink.addEventListener('click', function(e) {
        e.preventDefault();
        // Key löschen
        chrome.storage.local.remove(['geminiApiKey'], function() {
            apiKeyInput.value = '';
            apiKeyInput.style.display = 'block'; // Input zeigen
            resetLink.style.display = 'none';    // Link verstecken
            alert("API Key gelöscht. Bitte neuen eingeben.");
        });
    });

    // --- LOGIK: ENTER TASTE ---
    const inputField = document.getElementById('tradeo-ai-input');
    inputField.addEventListener('keydown', function(e) {
        // Wenn Enter gedrückt wird (OHNE Shift) -> Senden
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Verhindert den Zeilenumbruch im Feld
            runAI();
        }
    });

    // Button Klick
    document.getElementById('tradeo-ai-btn').addEventListener('click', runAI);
}


async function runAI() {
    const btn = document.getElementById('tradeo-ai-btn');
    const resultBox = document.getElementById('tradeo-ai-result');
    const userPromptInput = document.getElementById('tradeo-ai-input');
    const userPrompt = userPromptInput.value.trim();
    const apiKeyInput = document.getElementById('tradeo-apikey-input');
    
    if (!userPrompt) { 
        // Kleiner visueller Shake oder Fokus, wenn leer
        userPromptInput.focus();
        return; 
    }

    let apiKey = apiKeyInput.value.trim();

    // Key holen (Input oder Storage)
    if (!apiKey) {
        const stored = await chrome.storage.local.get(['geminiApiKey']);
        apiKey = stored.geminiApiKey;
    }

    if (!apiKey) {
        alert("Bitte API Key eingeben!");
        apiKeyInput.focus();
        return;
    }

    // Key speichern (falls neu eingegeben)
    if (apiKeyInput.value.trim()) {
        chrome.storage.local.set({geminiApiKey: apiKey}, function() {
            apiKeyInput.style.display = 'none';
            document.getElementById('tradeo-reset-key').style.display = 'block';
        });
    }

    // UI Feedback
    btn.disabled = true;
    const originalBtnText = btn.innerText;
    btn.innerText = "Denke nach... 🧠";
    resultBox.style.display = 'block';
    resultBox.innerText = "Lese Chat...";
    resultBox.style.color = "#666";
    resultBox.style.opacity = "0.7";

    // Chat lesen
    const chatContainer = document.getElementById('conv-layout-main');
    let chatContext = chatContainer ? chatContainer.innerText : "Kein Chatverlauf gefunden.";

    // Prompt bauen
    const finalPrompt = `
    SYSTEM: ${SYSTEM_PROMPT}
    CHATVERLAUF: ${chatContext}
    AUFGABE: ${userPrompt}
    Antworte direkt mit dem E-Mail-Text.
    `;

    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
    
    const requestBody = {
        contents: [{ parts: [{ text: finalPrompt }] }]
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            // Spezielle Fehlermeldung bei falschem Modellnamen
            if (data.error && data.error.message.includes("not found")) {
                 throw new Error(`Modell '${MODEL_NAME}' nicht gefunden. Bitte Modellnamen im Code prüfen.`);
            }
            throw new Error(data.error ? data.error.message : response.statusText);
        }

        const aiText = data.candidates[0].content.parts[0].text;
        resultBox.innerText = aiText;
        resultBox.style.color = "#000";
        resultBox.style.opacity = "1";

    } catch (error) {
        resultBox.innerHTML = `⚠️ <strong>Fehler:</strong><br>${error.message}`;
        resultBox.style.color = "#d93025";
    } finally {
        btn.disabled = false;
        btn.innerText = originalBtnText;
    }
}

setTimeout(init, 1500);