// --- KONFIGURATION ---
const API_VERSION = "v1beta";

// SYSTEM PROMPT
const SYSTEM_PROMPT = `
Du bist ein erfahrener Support-Mitarbeiter der Firma "Tradeo / Servershop24".
Wir verkaufen Serverhardware, RAM und Storage.

VORGABEN:
1. Tonalität: Professionell, freundlich, direkt. Wir Siezen.
2. Preis: Webshop-Preise sind fix. Rabatte erst bei großen Mengen.
3. Fehler: Ehrlich zugeben.
4. Signatur: Weglassen (macht das System) also meinen Namen und MfG kannst dir schenken.

WICHTIG:
Antworte IMMER im validen JSON-Format.
Struktur:
{
  "draft": "Der Text für die E-Mail an den Kunden (HTML erlaubt, <br> für Zeilenumbruch)",
  "feedback": "Eine kurze Nachricht an mich (den Support-Agent), was du gemacht hast oder eine Rückfrage."
}
`;

// Model Definitionen
const AI_MODELS = {
    "gemini-2.5-flash-lite": { 
        id: "gemini-2.5-flash-lite", 
        label: "2.5 Flash Lite", 
        dropdownText: "gemini-2.5-flash-lite (sehr schnell)" 
    },
    "gemini-2.5-flash": { 
        id: "gemini-2.5-flash", 
        label: "2.5 Flash", 
        dropdownText: "gemini-2.5-flash (schnell)" 
    },
    "gemini-3-pro-preview": { 
        id: "gemini-3-pro-preview", 
        label: "3 Pro", 
        dropdownText: "gemini-3-pro-preview (langsam, deep thinking)" 
    }
};

function init() {
    const originalReplyBtn = document.querySelector('.conv-reply');
    if (!originalReplyBtn || document.getElementById('tradeo-ai-copilot-zone')) return;

    // 1. UI INJECTION
    const mainContainer = document.getElementById('conv-layout-main');
    if (!mainContainer) return;

    const copilotContainer = document.createElement('div');
    copilotContainer.id = 'tradeo-ai-copilot-zone';
    
    // HTML mit neuem Model-Selector Wrapper
    copilotContainer.innerHTML = `
        <div id="tradeo-ai-dummy-draft">
            <em>🤖 AI analysiert das Ticket...</em>
        </div>
        <div id="tradeo-ai-chat-history">
        </div>
        <div id="tradeo-ai-resize-handle" title="Höhe anpassen"></div>
        <div id="tradeo-ai-input-area">
            <div class="tradeo-ai-model-wrapper">
                <button id="tradeo-ai-model-btn" type="button">2.5 Flash</button>
                <div id="tradeo-ai-model-dropdown" class="hidden">
                    </div>
            </div>
            <textarea id="tradeo-ai-input" placeholder="Anweisung an AI (z.B. 'Kürzer fassen' oder 'Rabatt anbieten')..."></textarea>
            <button id="tradeo-ai-send-btn">Go</button>
        </div>
    `;

    mainContainer.prepend(copilotContainer);
    
    // API Key Input
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id = 'tradeo-apikey-input';
    keyInput.placeholder = 'API Key eingeben...';
    keyInput.style.display = 'none';
    keyInput.style.margin = '10px';
    keyInput.style.width = '95%';
    copilotContainer.prepend(keyInput);

    checkApiKeyUI();

    // 2. STATE & BUTTONS
    window.aiState = {
        lastDraft: "",     
        isRealMode: false,
        chatHistory: [],
        currentModel: "gemini-2.5-flash" // Default
    };

    // --- MODEL SELECTOR LOGIC ---
    const modelBtn = document.getElementById('tradeo-ai-model-btn');
    const modelDropdown = document.getElementById('tradeo-ai-model-dropdown');

    // Dropdown füllen
    Object.values(AI_MODELS).forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        if(model.id === window.aiState.currentModel) item.classList.add('selected');
        item.innerText = model.dropdownText;
        item.onclick = (e) => {
            // State Update
            window.aiState.currentModel = model.id;
            
            // UI Update
            modelBtn.innerText = model.label;
            document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            modelDropdown.classList.add('hidden');
            e.stopPropagation();
        };
        modelDropdown.appendChild(item);
    });

    // Toggle Dropdown
    modelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdown.classList.toggle('hidden');
    });

    // Close on click outside
    document.addEventListener('click', () => {
        if (!modelDropdown.classList.contains('hidden')) {
            modelDropdown.classList.add('hidden');
        }
    });

    // --- EXISTING LOGIC ---

    const aiBtn = originalReplyBtn.cloneNode(true);
    aiBtn.classList.add('tradeo-ai-toolbar-btn');
    aiBtn.setAttribute('data-original-title', 'Mit AI Antworten');
    aiBtn.setAttribute('title', 'Mit AI Antworten');
    
    const icon = aiBtn.classList.contains('glyphicon') ? aiBtn : aiBtn.querySelector('.glyphicon');
    if (icon) {
        icon.classList.remove('glyphicon-share-alt');
        icon.classList.add('glyphicon-flash');
    }

    originalReplyBtn.parentNode.insertBefore(aiBtn, originalReplyBtn.nextSibling);

    // Event Listeners (Rest wie gehabt)
    aiBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        originalReplyBtn.click();
        window.aiState.isRealMode = true;
        waitForSummernote(function(editable) {
            const contentToTransfer = window.aiState.lastDraft || document.getElementById('tradeo-ai-dummy-draft').innerHTML;
            setEditorContent(editable, contentToTransfer);
            document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        });
    });

    originalReplyBtn.addEventListener('click', function() {
        window.aiState.isRealMode = true;
        document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
    });

    document.body.addEventListener('click', function(e) {
        if (e.target.closest('button[aria-label="Verwerfen"]') || e.target.closest('.glyphicon-trash')) {
            window.aiState.isRealMode = false;
            const dummy = document.getElementById('tradeo-ai-dummy-draft');
            if (dummy) {
                if(window.aiState.lastDraft) dummy.innerHTML = window.aiState.lastDraft;
                dummy.style.display = 'block';
            }
        }
    });

    document.getElementById('tradeo-ai-send-btn').addEventListener('click', () => runAI());
    document.getElementById('tradeo-ai-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            runAI();
        }
    });

    // Resize Handler (unverändert)
    const resizer = document.getElementById('tradeo-ai-resize-handle');
    const chatHistory = document.getElementById('tradeo-ai-chat-history');

    if (resizer && chatHistory) {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = chatHistory.offsetHeight;
            
            function doDrag(e) {
                const newHeight = startHeight + (e.clientY - startY);
                if (newHeight >= 120) { 
                    chatHistory.style.height = newHeight + 'px';
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                }
            }
            function stopDrag() {
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
            }
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    }

    // Auto Start
    copilotContainer.style.display = 'block';
    addChatMessage("system", "Starte AI...");
    runAI(true);
}

function checkApiKeyUI() {
    chrome.storage.local.get(['geminiApiKey'], function(result) {
        const input = document.getElementById('tradeo-apikey-input');
        if (!result.geminiApiKey) input.style.display = 'block';
        else input.style.display = 'none';
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

    // 1. Scroll-Position merken
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    editableElement.innerHTML = htmlContent;
    editableElement.dispatchEvent(new Event('input', { bubbles: true }));
    
    // 2. Fokus ohne Scrollen
    editableElement.focus({ preventScroll: true });

    // 3. Scroll wiederherstellen
    window.scrollTo(scrollX, scrollY);

    // 4. NEU: Visuelles Feedback
    // Wir flashen das Elternelement (oft .note-editor), damit der Rahmen schön aussieht
    // Falls Summernote Struktur anders ist, nehmen wir direkt das Element.
    const flashTarget = editableElement.closest('.note-editor') || editableElement;
    flashElement(flashTarget);
}

// --- HISTORY FUNKTIONEN ---

function addChatMessage(role, text) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    const msgDiv = document.createElement('div');
    
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

function flashElement(element) {
    if (!element) return;
    
    // Animation resetten, falls sie gerade läuft (für schnelle Updates hintereinander)
    element.classList.remove('tradeo-flash-active');
    
    // "Reflow" erzwingen (Magic Trick, damit der Browser die CSS-Animation neu startet)
    void element.offsetWidth;
    
    element.classList.add('tradeo-flash-active');
    
    // Klasse nach Animation aufräumen
    setTimeout(() => {
        element.classList.remove('tradeo-flash-active');
    }, 1200);
}

function addDraftMessage(htmlContent) {
    const historyContainer = document.getElementById('tradeo-ai-chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'draft-msg'; 
    
    msgDiv.innerHTML = `
        <div class="draft-header">
            <span class="icon">📄</span> Entwurf (Klicken zum Anzeigen)
        </div>
        <div class="draft-body">
            ${htmlContent}
            <div class="draft-actions">
                <button class="draft-btn btn-copy">📋 Kopieren</button>
                <button class="draft-btn primary btn-adopt">⚡ Übernehmen</button>
            </div>
        </div>
    `;

    msgDiv.querySelector('.draft-header').addEventListener('click', function() {
        msgDiv.classList.toggle('expanded');
    });

    msgDiv.querySelector('.btn-copy').addEventListener('click', function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(htmlContent).then(() => {
            const btn = e.target;
            const originalText = btn.innerText;
            btn.innerText = "✅ Kopiert!";
            setTimeout(() => btn.innerText = originalText, 1500);
        });
    });

    msgDiv.querySelector('.btn-adopt').addEventListener('click', function(e) {
        e.stopPropagation();
        
        window.aiState.lastDraft = htmlContent;

        if (window.aiState.isRealMode) {
             const editable = document.querySelector('.note-editable');
             if (editable) setEditorContent(editable, htmlContent);
        } else {
            const dummy = document.getElementById('tradeo-ai-dummy-draft');
            if (dummy) {
                dummy.innerHTML = htmlContent;
                dummy.style.display = 'block';
            }
        }
        
        const btn = e.target;
        btn.innerText = "✅ Übernommen";
        setTimeout(() => btn.innerText = "⚡ Übernehmen", 1500);
    });

    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}


// --- CORE AI LOGIK ---

async function runAI(isInitial = false) {
    const btn = document.getElementById('tradeo-ai-send-btn');
    const input = document.getElementById('tradeo-ai-input');
    const dummyDraft = document.getElementById('tradeo-ai-dummy-draft');
    const apiKeyInput = document.getElementById('tradeo-apikey-input');

    let userPrompt = input.value.trim();
    
    // State Check
    let currentDraftContent = "";
    if (window.aiState.isRealMode) {
        const editable = document.querySelector('.note-editable');
        if (editable) currentDraftContent = editable.innerHTML;
    } else {
        if (!isInitial) currentDraftContent = dummyDraft.innerHTML;
    }

    if (isInitial) {
        userPrompt = "Analysiere das Ticket und erstelle einen passenden Antwortentwurf.";
    } else {
        if (!userPrompt) return;
        addChatMessage('user', userPrompt);
        window.aiState.chatHistory.push({role: "User", text: userPrompt});
    }

    // API Key
    let apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        const stored = await chrome.storage.local.get(['geminiApiKey']);
        apiKey = stored.geminiApiKey;
    }
    if (!apiKey) return;

    btn.disabled = true;
    btn.innerText = "...";

    // Kontext lesen
    const mainContainer = document.getElementById('conv-layout-main');
    let contextText = "";
    if (mainContainer) {
        const clone = mainContainer.cloneNode(true);
        const myZone = clone.querySelector('#tradeo-ai-copilot-zone');
        if (myZone) myZone.remove();
        const editorBlock = clone.querySelector('.conv-reply-block');
        if(editorBlock) editorBlock.remove();
        contextText = clone.innerText;
    }

    const historyString = window.aiState.chatHistory.map(entry => `${entry.role}: ${entry.text}`).join("\n");

    const finalPrompt = `
    ${SYSTEM_PROMPT}
    
    === HINTERGRUND ===
    TICKET VERLAUF:
    ${contextText}

    === AKTUELLER STATUS ===
    DERZEITIGER ENTWURF (Daran arbeiten wir):
    "${currentDraftContent}"

    === UNSER GESPRÄCHSVERLAUF BISHER ===
    ${historyString}

    === NEUE ANWEISUNG ===
    User: ${userPrompt}
    `;

    // DYNAMIC MODEL SELECTION
    const selectedModel = window.aiState.currentModel || "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${selectedModel}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "API Error");

        let rawText = data.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let jsonResponse;
        try {
            jsonResponse = JSON.parse(rawText);
        } catch (e) {
            jsonResponse = { draft: rawText, feedback: "Format Fehler." };
        }

        // 1. Historie
        addDraftMessage(jsonResponse.draft);
        addChatMessage('ai', jsonResponse.feedback);
        window.aiState.chatHistory.push({role: "AI", text: jsonResponse.feedback});

        // 2. Update
        window.aiState.lastDraft = jsonResponse.draft;

        if (window.aiState.isRealMode) {
            const editable = document.querySelector('.note-editable');
            if (editable) {
                setEditorContent(editable, jsonResponse.draft);
            } else {
                dummyDraft.innerHTML = jsonResponse.draft;
                dummyDraft.style.display = 'block';
                window.aiState.isRealMode = false;
                flashElement(dummyDraft);
            }
        } else {
            dummyDraft.innerHTML = jsonResponse.draft;
            dummyDraft.style.display = 'block';
            flashElement(dummyDraft);
        }

        if (!isInitial) input.value = '';

    } catch (error) {
        addChatMessage('system', `<span style="color:red">Fehler (${selectedModel}): ${error.message}</span>`);
    } finally {
        btn.disabled = false;
        btn.innerText = "Go";
    }
}

// --- BOOTSTRAP / LOADER LOGIC ---
// Smart-Loader: Wartet auf DOM-Stabilisierung (Debounce) statt starrer Pause.

let bootTimer = null;

function tryStartApp(observer = null) {
    const replyBtn = document.querySelector('.conv-reply');
    const mainContainer = document.getElementById('conv-layout-main');
    const alreadyInitialized = document.getElementById('tradeo-ai-copilot-zone');

    // 1. Basic Checks: Sind wir am richtigen Ort und noch nicht gestartet?
    if (!replyBtn || !mainContainer || alreadyInitialized) return;

    // 2. Content Check: Sind Threads vorhanden?
    const threadCount = mainContainer.querySelectorAll('.thread').length;
    if (threadCount === 0) return;

    // 3. DEBOUNCE (Die Sicherheits-Magie):
    // Wir haben Threads gefunden. Aber wir warten 50ms ab, ob noch mehr HTML "reinrieselt".
    // Jede neue DOM-Änderung setzt diesen Timer zurück.
    // Erst wenn 50ms lang "Ruhe" ist, starten wir. Das ist für das Auge sofort, garantiert aber Vollständigkeit.
    
    if (bootTimer) clearTimeout(bootTimer);

    bootTimer = setTimeout(() => {
        // Jetzt ist der DOM stabil -> Starten!
        if (observer) observer.disconnect();
        console.log(`Tradeo AI: Start trigger (${threadCount} threads detected).`);
        init();
    }, 50);
}

// Start-Trigger
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryStartApp());
} else {
    tryStartApp();
}

// Observer für AJAX-Navigationen und dynamisches Nachladen
const observer = new MutationObserver(() => tryStartApp(observer));
observer.observe(document.body, { childList: true, subtree: true });