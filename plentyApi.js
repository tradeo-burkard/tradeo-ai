// plentyApi.js - Dynamische Authentifizierung

const PLENTY_BASE_URL = "https://p7843.my.plentysystems.com";

/**
 * Holt Credentials aus dem Speicher, loggt sich ein und gibt den Token zurück.
 */
async function getPlentyToken() {
    // 1. Credentials und gecachten Token holen (FIX: Name korrigiert auf 'plentyTokenExpiresAt')
    const storage = await chrome.storage.local.get(['plentyUser', 'plentyPass', 'plentyToken', 'plentyTokenExpiresAt']);
    
    // Check: Token noch gültig? (Puffer 5 Min)
    if (storage.plentyToken && storage.plentyTokenExpiresAt && Date.now() < (storage.plentyTokenExpiresAt - 300000)) {
        console.log("Tradeo AI: Nutze gecachten Plenty Token.");
        return storage.plentyToken;
    }

    // 2. Keine gültigen Daten? Wir müssen uns neu einloggen.
    // Check: Haben wir überhaupt Zugangsdaten?
    if (!storage.plentyUser || !storage.plentyPass) {
        throw new Error("MISSING_CREDENTIALS"); // UI muss darauf reagieren
    }

    console.log("Tradeo Background: Login bei Plentymarkets...");

    const response = await fetch(`${PLENTY_BASE_URL}/rest/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            username: storage.plentyUser,
            password: storage.plentyPass
        })
    });

    if (!response.ok) {
        throw new Error(`Plenty Login Failed: ${response.status}`);
    }

    const data = await response.json();
    
    // 3. Neuen Token speichern
    const expiresAt = Date.now() + (data.expires_in * 1000);
    await chrome.storage.local.set({
        plentyToken: data.access_token,
        plentyTokenExpiresAt: expiresAt
    });
    
    return data.access_token;
}

/**
 * Führt API Call aus
 */
async function makePlentyCall(endpoint, method = 'GET', body = null) {
    try {
        const token = await getPlentyToken();
        
        if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;

        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (body) options.body = JSON.stringify(body);

        const response = await fetch(`${PLENTY_BASE_URL}${endpoint}`, options);

        // 401 Retry Logic (Falls Token genau in der Millisekunde ablief)
        if (response.status === 401) {
            await chrome.storage.local.remove('plentyToken'); // Token löschen
            const newToken = await getPlentyToken(); // Neu holen
            options.headers['Authorization'] = `Bearer ${newToken}`;
            return fetch(`${PLENTY_BASE_URL}${endpoint}`, options).then(res => res.json());
        }

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`API Error ${response.status}: ${txt}`);
        }

        return await response.json();

    } catch (error) {
        // Fehler weiterreichen, damit UI ihn anzeigen kann
        throw error;
    }
}