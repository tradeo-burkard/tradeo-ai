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

    // NEU: Spezifischer Call für den AI Agent ("Function Calling")
    if (request.action === 'GET_ORDER_FULL') {
        fetchFullOrderDetails(request.orderId)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                 sendResponse({ success: false, error: error.toString() });
            });
        return true; // Async wait
    }
});