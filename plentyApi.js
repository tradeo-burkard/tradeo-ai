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

/**
 * Holt komplexe Order-Details inkl. Items, Bestand UND ADRESSEN.
 */
async function fetchFullOrderDetails(orderId) {
    try {
        // 1. Hole Order mit Basis-Relationen
        const orderData = await makePlentyCall(`/rest/orders/${orderId}?with[]=orderItems&with[]=relations&with[]=amounts&with[]=dates&with[]=addressRelations`);
        
        if (!orderData) throw new Error("Order not found");

        const result = {
            meta: { type: "PLENTY_ORDER_FULL_EXPORT", orderId: orderId, timestamp: new Date().toISOString() },
            order: orderData,
            stocks: [],
            addresses: [] // Hier kommen die Klartext-Adressen rein
        };

        // 2. Adressen auflösen (NEU)
        // Wir schauen in die addressRelations (Rechnung=1, Lieferung=2) und holen die Details
        if (orderData.addressRelations && orderData.addressRelations.length > 0) {
            const addressPromises = orderData.addressRelations.map(async (rel) => {
                try {
                    // API Call für die echte Adresse
                    const addrDetail = await makePlentyCall(`/rest/accounts/addresses/${rel.addressId}`);
                    // Wir fügen den Typ (Rechnung/Lieferung) hinzu, damit die AI es unterscheiden kann
                    return { 
                        relationType: rel.typeId === 1 ? "Billing/Rechnung" : (rel.typeId === 2 ? "Shipping/Lieferung" : "Other"),
                        ...addrDetail 
                    };
                } catch (e) {
                    console.warn(`Konnte Adresse ${rel.addressId} nicht laden`, e);
                    return null;
                }
            });
            
            // Warten bis alle Adressen geladen sind und null-Werte filtern
            const loadedAddresses = await Promise.all(addressPromises);
            result.addresses = loadedAddresses.filter(a => a !== null);
        }

        // 3. Bestände holen (wie gehabt)
        const variationIds = orderData.orderItems
            .filter(item => item.typeId === 3 || item.typeId === 1)
            .map(item => item.itemVariationId);

        const uniqueVarIds = [...new Set(variationIds)];

        const stockPromises = uniqueVarIds.map(async (vid) => {
            try {
                const stockData = await makePlentyCall(`/rest/stockmanagement/stock?variationId=${vid}&warehouseId=1`);
                return { variationId: vid, data: stockData };
            } catch (e) {
                return { variationId: vid, error: "Could not fetch stock" };
            }
        });

        result.stocks = await Promise.all(stockPromises);

        return result;

    } catch (error) {
        console.error("Fehler beim Holen der Full Order Details:", error);
        throw error;
    }
}