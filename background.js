importScripts('itemDb.generated.js', 'plentyApi.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Generischer API Call
    if (request.action === 'PLENTY_API_CALL') {
        makePlentyCall(request.endpoint, request.method, request.body)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                const isAuthError = error.message === "MISSING_CREDENTIALS" || error.message.includes("Login Failed");
                sendResponse({ success: false, error: error.toString(), authRequired: isAuthError });
            });
        return true; // Async wait
    }

    // NEU: LLM Chat (RunPod / OpenAI-compatible) via Background fetch (CORS-safe)
    if (request.action === 'LLM_CHAT') {
        (async () => {
            try {
                const { llmBaseUrl, llmApiKey } = await chrome.storage.local.get(['llmBaseUrl', 'llmApiKey']);
                if (!llmBaseUrl || !llmApiKey) throw new Error("LLM nicht konfiguriert (Base URL / API Key fehlt).");

                const base = llmBaseUrl.replace(/\/$/, '');
                const url = `${base}/chat/completions`;

                const controller = new AbortController();
                const timeoutMs = Number(request.timeoutMs || 60000);
                const t = setTimeout(() => controller.abort(), timeoutMs);

                const resp = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${llmApiKey}`
                    },
                    body: JSON.stringify(request.payload),
                    signal: controller.signal
                }).finally(() => clearTimeout(t));

                const text = await resp.text();
                let data;
                try { data = JSON.parse(text); } catch { data = { raw: text }; }

                if (!resp.ok) {
                    const msg = data?.error?.message || `LLM API Error: ${resp.status}`;
                    sendResponse({ success: false, status: resp.status, error: msg, data });
                    return;
                }

                sendResponse({ success: true, status: resp.status, data });
            } catch (e) {
                sendResponse({ success: false, error: e?.message || String(e) });
            }
        })();

        return true; // Async
    }


    // Order Details (Bestehend)
    if (request.action === 'GET_ORDER_FULL') {
        fetchOrderDetails(request.orderId)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }

    // NEU: Artikel Details
    if (request.action === 'GET_ITEM_DETAILS') {
        fetchItemDetails(request.identifier)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }

    // NEU: Kunden Details
    if (request.action === 'GET_CUSTOMER_DETAILS') {
        fetchCustomerDetails(request.contactId)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }

    if (request.action === 'SEARCH_ITEMS_BY_TEXT') {
        // Wir rufen direkt die Hauptfunktion auf
        // WICHTIG: onlyWithStock Parameter hinzugefügt
        searchItemsByText(request.searchText, { 
            mode: request.mode, 
            maxResults: request.maxResults,
            onlyWithStock: request.onlyWithStock 
        })
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }
});