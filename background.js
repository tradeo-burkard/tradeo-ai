importScripts('plentyApi.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PLENTY_API_CALL') {
        makePlentyCall(request.endpoint, request.method, request.body)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => {
                // Fehlerbehandlung: Speziell prüfen ob Credentials fehlen
                const isAuthError = error.message === "MISSING_CREDENTIALS" || error.message.includes("Login Failed");
                sendResponse({ success: false, error: error.toString(), authRequired: isAuthError });
            });
        return true; // Async wait
    }
});