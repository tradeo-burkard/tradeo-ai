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
        isGenerating: false,      // NEU: Arbeitet die AI gerade?
        preventOverwrite: false,  // NEU: Verhindert Schreiben in Editor wenn true
        chatHistory: [],
        currentModel: "gemini-2.5-flash"
    };

    // --- MODEL SELECTOR LOGIC ---
    const modelBtn = document.getElementById('tradeo-ai-model-btn');
    const modelDropdown = document.getElementById('tradeo-ai-model-dropdown');

    Object.values(AI_MODELS).forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        if(model.id === window.aiState.currentModel) item.classList.add('selected');
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

    modelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        if (!modelDropdown.classList.contains('hidden')) {
            modelDropdown.classList.add('hidden');
        }
    });

    // --- EXISTING LOGIC & OBSERVER ---

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

    // Observer starten, um zu erkennen, wann der Editor geschlossen wird
    setupEditorObserver();

    // EVENT LISTENER: AI Button
    aiBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        originalReplyBtn.click(); // Öffnet den echten Editor
        
        window.aiState.isRealMode = true;
        window.aiState.preventOverwrite = false; // Hier wollen wir explizit überschreiben
        
        waitForSummernote(function(editable) {
            const contentToTransfer = window.aiState.lastDraft || document.getElementById('tradeo-ai-dummy-draft').innerHTML;
            setEditorContent(editable, contentToTransfer);
            document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        });
    });

    // EVENT LISTENER: Original Antworten Button
    originalReplyBtn.addEventListener('click', function() {
        // UI sofort aufräumen: Dummy weg
        document.getElementById('tradeo-ai-dummy-draft').style.display = 'none';
        
        // Logik: Wir sind jetzt im "echten" Modus
        window.aiState.isRealMode = true;

        // ABER: Wenn die AI gerade noch am Denken ist (Start-Trigger), 
        // darf sie uns nicht den Text überschreiben, sobald sie fertig ist.
        if (window.aiState.isGenerating) {
            console.log("AI arbeitet noch -> Overwrite verhindern");
            window.aiState.preventOverwrite = true;
        }
    });

    // Der alte "Trash-Click-Listener" wurde entfernt, da der Observer das jetzt zuverlässig macht.

    document.getElementById('tradeo-ai-send-btn').addEventListener('click', () => runAI());
    document.getElementById('tradeo-ai-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            runAI();
        }
    });

    // Resize Handler
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

// --- NEU: MUTATION OBSERVER FÜR DEN EDITOR ---
function setupEditorObserver() {
    const editorBlock = document.querySelector('.conv-reply-block');
    if (!editorBlock) return;

    // Wir beobachten Attribut-Änderungen (speziell 'class' und 'style')
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                // Check: Ist der Editor versteckt?
                // FreeScout nutzt meistens die Klasse 'hidden' oder display:none
                const isHidden = editorBlock.classList.contains('hidden') || editorBlock.style.display === 'none';
                
                if (isHidden) {
                    // Editor ist zu (wurde gelöscht, gesendet oder verworfen)
                    // -> Reset State
                    window.aiState.isRealMode = false;
                    window.aiState.preventOverwrite = false;
                    
                    // -> Show Dummy Draft
                    const dummy = document.getElementById('tradeo-ai-dummy-draft');
                    if (dummy) {
                        // Inhalt auffrischen falls nötig
                        if(window.aiState.lastDraft) dummy.innerHTML = window.aiState.lastDraft;
                        dummy.style.display = 'block';
                    }
                } else {
                    // Editor ist offen
                    // -> Hide Dummy Draft (Sicherheitshalber, falls Button-Logik versagt)
                    const dummy = document.getElementById('tradeo-ai-dummy-draft');
                    if (dummy) dummy.style.display = 'none';
                }
            }
        });
    });

    observer.observe(editorBlock, { attributes: true });
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
    element.classList.remove('tradeo-flash-active');
    void element.offsetWidth;
    element.classList.add('tradeo-flash-active');
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

        // Klügere Logik beim Übernehmen:
        // Wir schauen, ob der Editor sichtbar ist, nicht nur auf die Variable
        const editorBlock = document.querySelector('.conv-reply-block');
        const isEditorVisible = editorBlock && !editorBlock.classList.contains('hidden');

        if (window.aiState.isRealMode || isEditorVisible) {
             const editable = document.querySelector('.note-editable');
             if (editable) {
                 setEditorContent(editable, htmlContent);
             } else {
                 // Fallback: Editor aufmachen
                 document.querySelector('.conv-reply').click();
                 waitForSummernote((ed) => setEditorContent(ed, htmlContent));
             }
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
    
    // State setzen
    window.aiState.isGenerating = true;

    // Content Check
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
    if (!apiKey) {
        window.aiState.isGenerating = false;
        return;
    }

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

        // 2. Update Logic
        window.aiState.lastDraft = jsonResponse.draft;

        // CHECK: Darf ich in den Editor schreiben?
        // Bedingung: RealMode ist an UND wir haben KEIN Prevent-Flag
        if (window.aiState.isRealMode && !window.aiState.preventOverwrite) {
            const editable = document.querySelector('.note-editable');
            if (editable) {
                setEditorContent(editable, jsonResponse.draft);
            } else {
                // Fallback, falls Element nicht gefunden, doch in Dummy
                dummyDraft.innerHTML = jsonResponse.draft;
                // Nicht anzeigen, da User im RealMode ist (aber ohne Editor?) - Edge Case.
            }
        } else {
            // Wir schreiben NUR in den Dummy Draft
            // Das passiert, wenn:
            // a) Editor zu ist (Standard)
            // b) preventOverwrite gesetzt ist (User hat manuell geklickt während AI lief)
            dummyDraft.innerHTML = jsonResponse.draft;
            
            // Wenn preventOverwrite an war, ist der Dummy versteckt (durch den Klick).
            // Wir lassen ihn versteckt, damit der User nicht gestört wird.
            // Falls preventOverwrite NICHT an war (also AI im Hintergrund fertig wurde ohne Klick), 
            // zeigen wir ihn an.
            if (!window.aiState.preventOverwrite && !window.aiState.isRealMode) {
                 dummyDraft.style.display = 'block';
                 flashElement(dummyDraft);
            } else {
                console.log("AI fertig, Update im Hintergrund in Dummy Draft gespeichert.");
            }
        }

        if (!isInitial) input.value = '';

    } catch (error) {
        addChatMessage('system', `<span style="color:red">Fehler (${selectedModel}): ${error.message}</span>`);
    } finally {
        btn.disabled = false;
        btn.innerText = "Go";
        window.aiState.isGenerating = false;
        window.aiState.preventOverwrite = false; // Flag resetten für nächste Runde
    }
}

// --- BOOTSTRAP / LOADER LOGIC ---

let bootTimer = null;

function tryStartApp(observer = null) {
    const replyBtn = document.querySelector('.conv-reply');
    const mainContainer = document.getElementById('conv-layout-main');
    const alreadyInitialized = document.getElementById('tradeo-ai-copilot-zone');

    if (!replyBtn || !mainContainer || alreadyInitialized) return;

    const threadCount = mainContainer.querySelectorAll('.thread').length;
    if (threadCount === 0) return;

    if (bootTimer) clearTimeout(bootTimer);

    bootTimer = setTimeout(() => {
        if (observer) observer.disconnect();
        console.log(`Tradeo AI: Start trigger (${threadCount} threads detected).`);
        init();
    }, 50);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tryStartApp());
} else {
    tryStartApp();
}

const observer = new MutationObserver(() => tryStartApp(observer));
observer.observe(document.body, { childList: true, subtree: true });