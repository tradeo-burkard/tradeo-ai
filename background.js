importScripts('plentyApi.js');

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
        // Wir rufen direkt die Hauptfunktion auf, die Optionen erwarten kann
        searchItemsByText(request.searchText, { mode: request.mode, maxResults: request.maxResults })
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }
});