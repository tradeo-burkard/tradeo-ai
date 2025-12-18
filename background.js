importScripts('itemDb.generated.js', 'plentyApi.js');

// --- GOOGLE OAUTH (for Vertex) ---
function getGoogleAuthToken({ interactive }) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(chrome.runtime.lastError || new Error("NO_TOKEN"));
                return;
            }
            resolve(token);
        });
    });
}

function removeCachedToken(token) {
    return new Promise((resolve) => {
        if (!token) return resolve();
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // --- Vertex OAuth helpers ---
    if (request.action === 'GET_GCP_TOKEN') {
        getGoogleAuthToken({ interactive: true })
            .then(token => sendResponse({ success: true, token }))
            .catch(err => sendResponse({ success: false, error: String(err?.message || err) }));
        return true;
    }

    if (request.action === 'CLEAR_GCP_TOKEN') {
        chrome.identity.getAuthToken({ interactive: false }, async (token) => {
            await removeCachedToken(token);
            sendResponse({ success: true });
        });
        return true;
    }

    // Generischer API Call
    if (request.action === 'PLENTY_API_CALL') {
        makePlentyCall(request.endpoint, request.method, request.body)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                const isAuthError = error.message === "MISSING_CREDENTIALS" || error.message.includes("Login Failed");
                sendResponse({ success: false, error: error.toString(), authRequired: isAuthError });
            });
        return true;
    }

    // Order Details (Bestehend)
    if (request.action === 'GET_ORDER_FULL') {
        fetchOrderDetails(request.orderId)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.toString() }));
        return true; // Async wait
    }

    // NEU: Artikel Details
    if (request.action === 'GET_ITEM_DETAILS') {
        fetchItemDetails(request.identifier)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.toString() }));
        return true; // Async wait
    }

    // NEU: Kunden Details
    if (request.action === 'GET_CUSTOMER_DETAILS') {
        fetchCustomerDetails(request.contactId)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.toString() }));
        return true; // Async wait
    }

    if (request.action === 'SEARCH_ITEMS_BY_TEXT') {
        searchItemsByText(request.searchText, {
            mode: request.mode,
            maxResults: request.maxResults,
            onlyWithStock: request.onlyWithStock
        })
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.toString() }));
        return true; // Async wait
    }
});
