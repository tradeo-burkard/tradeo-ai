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

// DATEI: tradeo-burkard/tradeo-ai/tradeo-ai-main/plentyApi.js
// Ersetze die Funktion fetchFullOrderDetails komplett durch diese Version:

/**
 * Holt komplexe Order-Details inkl. Items, Bestand, ADRESSEN und TRACKING.
 */
async function fetchFullOrderDetails(orderId) {
    try {
        // 1. Hole Order mit Basis-Relationen + shippingPackages (NEU)
        // wir fügen 'shippingPackages' hinzu, um Tracking-Codes zu erhalten
        const orderData = await makePlentyCall(`/rest/orders/${orderId}?with[]=orderItems&with[]=relations&with[]=amounts&with[]=dates&with[]=addressRelations&with[]=shippingPackages`);
        
        if (!orderData) throw new Error("Order not found");

        const result = {
            meta: { type: "PLENTY_ORDER_FULL_EXPORT", orderId: orderId, timestamp: new Date().toISOString() },
            order: orderData,
            stocks: [],
            addresses: [],
            shippingInfo: {
                profileName: "Unknown",
                provider: "Unknown"
            }
        };

        // 2. Adressen auflösen
        if (orderData.addressRelations && orderData.addressRelations.length > 0) {
            const addressPromises = orderData.addressRelations.map(async (rel) => {
                try {
                    const addrDetail = await makePlentyCall(`/rest/accounts/addresses/${rel.addressId}`);
                    return { 
                        relationType: rel.typeId === 1 ? "Billing/Rechnung" : (rel.typeId === 2 ? "Shipping/Lieferung" : "Other"),
                        ...addrDetail 
                    };
                } catch (e) {
                    return null;
                }
            });
            const loadedAddresses = await Promise.all(addressPromises);
            result.addresses = loadedAddresses.filter(a => a !== null);
        }

        // 3. Bestände holen
        if (orderData.orderItems) {
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
        }

        // 4. (NEU) Versandart-Name auflösen
        // Die Order enthält meist shippingProfileId. Wir holen den Klartext-Namen dazu.
        if (orderData.shippingProfileId) {
            try {
                const profileData = await makePlentyCall(`/rest/orders/shipping/profiles/${orderData.shippingProfileId}`);
                // Struktur variiert je nach Plenty-Version, wir versuchen backendName oder name
                result.shippingInfo.profileName = profileData.backendName || profileData.name || ("ID_" + orderData.shippingProfileId);
                
                // Versuch den Provider abzuleiten (DHL, UPS, etc.)
                const lowerName = result.shippingInfo.profileName.toLowerCase();
                if (lowerName.includes('dhl')) result.shippingInfo.provider = "DHL";
                else if (lowerName.includes('ups')) result.shippingInfo.provider = "UPS";
                else if (lowerName.includes('gls')) result.shippingInfo.provider = "GLS";
                else if (lowerName.includes('spedition')) result.shippingInfo.provider = "Spedition";
                
            } catch (e) {
                console.warn("Konnte Shipping Profile nicht laden:", e);
                result.shippingInfo.error = e.toString();
            }
        }

        return result;

    } catch (error) {
        console.error("Fehler beim Holen der Full Order Details:", error);
        throw error;
    }
}

/**
 * Holt Artikeldetails (Variation) und Netto-Bestand.
 * Versucht zuerst die Suche über Variation-ID, dann über Artikelnummer.
 */
async function fetchItemDetails(identifier) {
    try {
        let variationData = null;

        // 1. Versuch: Direkter Abruf über ID (falls numerisch)
        if (!isNaN(identifier)) {
            try {
                // Wir nutzen die Search-Route, da sie flexibler ist
                const response = await makePlentyCall(`/rest/items/variations?id=${identifier}`);
                if (response.entries && response.entries.length > 0) {
                    variationData = response.entries[0];
                }
            } catch (e) {
                console.log("Keine Variation mit ID gefunden, versuche Nummer...");
            }
        }

        // 2. Versuch: Suche über exakte Nummer (falls noch nichts gefunden)
        if (!variationData) {
            const response = await makePlentyCall(`/rest/items/variations?numberExact=${encodeURIComponent(identifier)}`);
            if (response.entries && response.entries.length > 0) {
                variationData = response.entries[0];
            }
        }

        if (!variationData) throw new Error(`Artikel/Variation '${identifier}' nicht gefunden.`);

        const variationId = variationData.id;
        const itemId = variationData.itemId;

        // 3. Zusatzdaten laden (Bestand & Basis-Artikeldaten für Name)
        const [stockData, itemBaseData] = await Promise.all([
            makePlentyCall(`/rest/stockmanagement/stock?variationId=${variationId}&warehouseId=1`), // Warehouse 1 als Standard
            makePlentyCall(`/rest/items/${itemId}`)
        ]);

        return {
            meta: { type: "PLENTY_ITEM_EXPORT", timestamp: new Date().toISOString() },
            variation: variationData,
            item: itemBaseData, // Enthält oft den allgemeinen Namen
            stock: stockData
        };

    } catch (error) {
        console.error("Fehler bei fetchItemDetails:", error);
        throw error;
    }
}

/**
 * Holt Kundendaten und die letzten Bestellungen.
 */
async function fetchCustomerDetails(contactId) {
    try {
        // 1. Stammdaten holen
        const contactData = await makePlentyCall(`/rest/accounts/contacts/${contactId}`);
        
        // 2. Letzte 5 Bestellungen holen (absteigend sortiert)
        // itemsPerPage=5, sortierte nach ID desc (neueste zuerst)
        const orderHistory = await makePlentyCall(`/rest/orders?contactId=${contactId}&itemsPerPage=5&sortBy=id&sortOrder=desc`);

        // 3. Rechnungsadresse(n) holen (optional, aber nützlich für Kontext)
        // Wir nehmen hier vereinfacht an, dass wir die Adressen aus den Orders oder separat laden könnten.
        // Um API-Calls zu sparen, verlassen wir uns erstmal auf die Stammdaten und Orders.

        return {
            meta: { type: "PLENTY_CUSTOMER_EXPORT", timestamp: new Date().toISOString() },
            contact: contactData,
            recentOrders: orderHistory.entries || [] 
        };

    } catch (error) {
        console.error("Fehler bei fetchCustomerDetails:", error);
        throw error;
    }
}