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

const COUNTRY_MAP = {
    1: "Germany",
    2: "Austria",
    3: "Belgium",
    4: "Switzerland",
    5: "Cyprus",
    6: "Czech Republic",
    7: "Denmark",
    8: "Spain",
    9: "Estonia",
    10: "France",
    11: "Finland",
    12: "United Kingdom",
    13: "Greece",
    14: "Hungary",
    15: "Italy",
    16: "Ireland",
    17: "Luxembourg",
    18: "Latvia",
    19: "Malta",
    20: "Norway",
    21: "Netherlands",
    22: "Portugal",
    23: "Poland",
    24: "Sweden",
    25: "Singapore",
    26: "Slovakia",
    27: "Slovenia",
    28: "USA",
    29: "Australia",
    30: "Canada",
    31: "China",
    32: "Japan",
    33: "Lithuania",
    34: "Liechtenstein",
    35: "Monaco",
    36: "Mexico",
    37: "Canary Islands",
    38: "India",
    39: "Brazil",
    40: "Russia",
    41: "Romania",
    42: "Ceuta",
    43: "Melilla",
    44: "Bulgaria",
    45: "Kosovo",
    46: "Kyrgyzstan",
    47: "Kazakhstan",
    48: "Belarus",
    49: "Uzbekistan",
    50: "Morocco",
    51: "Armenia",
    52: "Albania",
    53: "Egypt",
    54: "Croatia",
    55: "Maldives",
    56: "Malaysia",
    57: "Hong Kong",
    58: "Yemen",
    59: "Israel",
    60: "Taiwan",
    61: "Guadeloupe",
    62: "Thailand",
    63: "Turkey",
    64: "Greek Islands",
    65: "Balearic Islands",
    66: "New Zealand",
    67: "Afghanistan",
    68: "Aland Islands",
    69: "Algeria",
    70: "American Samoa",
    71: "Andorra",
    72: "Angola",
    73: "Anguilla",
    74: "Antarctica",
    75: "Antigua and Barbuda",
    76: "Argentina",
    77: "Aruba",
    78: "Azerbaijan",
    79: "The Bahamas",
    80: "Bahrain",
    81: "Bangladesh",
    82: "Barbados",
    83: "Belize",
    84: "Benin",
    85: "Bermuda",
    86: "Bhutan",
    87: "Bolivia",
    88: "Bosnia and Herzegovina",
    89: "Botswana",
    90: "Bouvet Island",
    91: "British Indian Ocean Territory",
    92: "Brunei Darussalam",
    93: "Burkina Faso",
    94: "Burundi",
    95: "Cambodia",
    96: "Cameroon",
    97: "Cape Verde",
    98: "Cayman Islands",
    99: "Central African Republic",
    100: "Chad",
    101: "Chile",
    102: "Christmas Island",
    103: "Cocos Islands/Keeling Islands",
    104: "Columbia",
    105: "Comoros",
    106: "Congo",
    107: "Democratic Republic of the Congo",
    108: "Cook Islands",
    109: "Costa Rica",
    110: "Ivory coast",
    112: "Cuba",
    113: "Djibouti",
    114: "Dominica",
    115: "Dominican Republic",
    116: "Ecuador",
    117: "El Salvador",
    118: "Equatorial Guinea",
    119: "Eritrea",
    120: "Ethiopia",
    121: "Falkland Islands",
    122: "Faroe Islands",
    123: "Fiji",
    124: "French Guiana",
    125: "French Polynesia",
    126: "French Southern and Antarctic Lands",
    127: "Gabon",
    128: "Gambia",
    129: "Georgia",
    130: "Ghana",
    131: "Gibraltar",
    132: "Greenland",
    133: "Grenada",
    134: "Guam",
    135: "Guatemala",
    136: "Guernsey",
    137: "Guinea",
    138: "Guinea-Bissau",
    139: "Guyana",
    140: "Haiti",
    141: "Heard Island and McDonald Islands",
    142: "Vatican City",
    143: "Honduras",
    144: "Iceland",
    145: "Indonesia",
    146: "Iran",
    147: "Iraq",
    148: "Isle of Man",
    149: "Jamaica",
    150: "Jersey",
    151: "Jordan",
    152: "Kenya",
    153: "Kiribati",
    154: "Democratic People’s Republic of Korea",
    155: "Republic of Korea",
    156: "Kuwait",
    158: "Laos",
    159: "Lebanon",
    160: "Lesotho",
    161: "Liberia",
    162: "Libya",
    163: "Macao",
    164: "Macedonia",
    165: "Madagascar",
    166: "Malawi",
    168: "Mali",
    169: "Marshall Islands",
    170: "Martinique",
    171: "Mauritania",
    172: "Mauritius",
    173: "Mayotte",
    174: "Micronesia",
    175: "Moldova",
    176: "Mongolia",
    177: "Montenegro",
    178: "Montserrat",
    179: "Mozambique",
    180: "Myanmar",
    181: "Namibia",
    182: "Nauru",
    183: "Nepal",
    184: "Netherlands Antilles",
    185: "New Caledonia",
    186: "Nicaragua",
    187: "Niger",
    188: "Nigeria",
    189: "Niue",
    190: "Norfolk Island",
    191: "Northern Mariana Islands",
    192: "Oman",
    193: "Pakistan",
    194: "Palau",
    195: "Palestinian territories",
    196: "Panama",
    197: "Papua New Guinea",
    198: "Paraguay",
    199: "Peru",
    200: "Philippines",
    201: "Pitcairn Islands",
    202: "Puerto Rico",
    203: "Qatar",
    204: "Reunion",
    205: "Rwanda",
    206: "Saint Helena",
    207: "Saint Kitts and Nevis",
    208: "Saint Lucia",
    209: "Saint Pierre and Miquelon",
    210: "Saint Vincent and the Grenadines",
    211: "Samoa",
    212: "San Marino",
    213: "Sao Tome and Principe",
    214: "Saudi Arabia",
    215: "Senegal",
    216: "Serbia",
    217: "Seychelles",
    218: "Sierra Leone",
    219: "Solomon Islands",
    220: "Somalia",
    221: "South Africa",
    222: "South Georgia and the South Sandwich Islands",
    223: "Sri Lanka",
    224: "Sudan",
    225: "Suriname",
    226: "Spitsbergen and Jan Mayen",
    227: "Swaziland",
    228: "Syria",
    229: "Tajikistan",
    230: "Tanzania",
    231: "Timor-Leste",
    232: "Togo",
    233: "Tokelau",
    234: "Tonga",
    235: "Trinidad and Tobago",
    236: "Tunisia",
    237: "Turkmenistan",
    238: "Turks and Caicos Islands",
    239: "Tuvalu",
    240: "Uganda",
    241: "Ukraine",
    242: "United States Minor Outlying Islands",
    243: "Uruguay",
    244: "Vanuatu",
    245: "Venezuela",
    246: "Vietnam",
    247: "British Virgin Islands",
    248: "United States Virgin Islands",
    249: "Wallis and Futuna",
    250: "Western Sahara",
    252: "Zambia",
    253: "Zimbabwe",
    254: "United Arab Emirates",
    255: "Helgoland",
    256: "Buesingen",
    258: "Curaçao",
    259: "Sint Maarten",
    260: "BES Islands",
    261: "Saint Barthélemy",
    262: "Livigno",
    263: "Campione d’Italia",
    264: "Lake Lugano from Ponte Tresa to Porto Ceresio",
    265: "Northern Ireland",
    0: "Unknown"
};

/**
 * Holt komplexe Order-Details inkl. Items, Bestand, ADRESSEN, TRACKING und ZIELLAND.
 */
async function fetchFullOrderDetails(orderId) {
    try {
        // 1. Hole Order mit Basis-Relationen + shippingPackages
        const orderData = await makePlentyCall(`/rest/orders/${orderId}?with[]=orderItems&with[]=relations&with[]=amounts&with[]=dates&with[]=addressRelations&with[]=shippingPackages`);
        
        if (!orderData) throw new Error("Order not found");

        const result = {
            meta: { type: "PLENTY_ORDER_FULL_EXPORT", orderId: orderId, timestamp: new Date().toISOString() },
            order: orderData,
            stocks: [],
            addresses: [],
            shippingInfo: {
                profileName: "Unknown",
                provider: "Unknown",
                destinationCountry: "Unknown", // Wird unten befüllt
                shippedAt: null
            }
        };

        // Datum des Warenausgangs finden (Status 7 Datum oder exitDate)
        if (orderData.dates) {
            const exitDateObj = orderData.dates.find(d => d.typeId === 7); // Warenausgang
            if (exitDateObj) result.shippingInfo.shippedAt = exitDateObj.date;
        }

        // 2. Adressen auflösen & Zielland ermitteln
        if (orderData.addressRelations && orderData.addressRelations.length > 0) {
            const addressPromises = orderData.addressRelations.map(async (rel) => {
                try {
                    const addrDetail = await makePlentyCall(`/rest/accounts/addresses/${rel.addressId}`);
                    
                    // Prüfen ob dies die Lieferadresse ist (TypeId 2)
                    if (rel.typeId === 2 && addrDetail) {
                        const cId = addrDetail.countryId;
                        // Fallback: Wenn ID nicht in Liste, zeige die rohe ID
                        result.shippingInfo.destinationCountry = COUNTRY_MAP[cId] || `Land-ID ${cId}`;
                    }

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
                .filter(item => item.typeId === 3 || item.typeId === 1) // Artikel & Variationen
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

        // 4. Versandart-Name auflösen & Provider bestimmen
        if (orderData.shippingProfileId) {
            try {
                const profileData = await makePlentyCall(`/rest/orders/shipping/profiles/${orderData.shippingProfileId}`);
                result.shippingInfo.profileName = profileData.backendName || profileData.name || ("ID_" + orderData.shippingProfileId);
                
                const lowerName = result.shippingInfo.profileName.toLowerCase();
                if (lowerName.includes('dhl')) result.shippingInfo.provider = "DHL";
                else if (lowerName.includes('ups')) result.shippingInfo.provider = "UPS";
                else if (lowerName.includes('gls')) result.shippingInfo.provider = "GLS";
                else if (lowerName.includes('dpd')) result.shippingInfo.provider = "DPD";
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

// DATEI: tradeo-burkard/tradeo-ai/tradeo-ai-main/plentyApi.js
// (Ersetze die bestehende fetchItemDetails Funktion mit dieser Version)

// DATEI: tradeo-burkard/tradeo-ai/tradeo-ai-main/plentyApi.js

async function fetchItemDetails(identifier) {
    try {
        let candidates = [];
        let searchMethod = "unknown";
        const seenIds = new Set(); // Duplikate vermeiden

        // Helper: Lädt vollständige Daten für eine einzelne Variation
        const loadFullData = async (variation) => {
             const itemId = variation.itemId;
             const variationId = variation.id;
             
             const [stockData, itemBaseData] = await Promise.all([
                makePlentyCall(`/rest/stockmanagement/stock?variationId=${variationId}&warehouseId=1`), 
                makePlentyCall(`/rest/items/${itemId}`)
            ]);
            
            return {
                meta: { type: "PLENTY_ITEM_EXPORT", timestamp: new Date().toISOString(), searchMethod },
                variation: variation,
                item: itemBaseData, 
                stock: stockData
            };
        };

        // --- HEURISTIK: Interne ID/Nummer (6-stellig, beginnt mit 1) ---
        // Z.B. 104250. Wenn das zutrifft, suchen wir primär danach.
        const isInternalNumberFormat = /^1\d{5}$/.test(identifier);

        if (isInternalNumberFormat) {
            console.log(`Tradeo AI: '${identifier}' entspricht internem ID-Schema (6-stellig, beginnt mit 1). Prüfe priorisiert...`);
            
            // Priorisierter Check: Nur ID und NumberExact
            const priorityChecks = [
                makePlentyCall(`/rest/items/variations?id=${identifier}`).then(res => res.entries || []).catch(() => []),
                makePlentyCall(`/rest/items/variations?numberExact=${encodeURIComponent(identifier)}`).then(res => res.entries || []).catch(() => [])
            ];

            const priorityResults = await Promise.all(priorityChecks);
            
            // Ergebnisse sammeln
            for (const entries of priorityResults) {
                for (const entry of entries) {
                    if (!seenIds.has(entry.id)) {
                        candidates.push(entry);
                        seenIds.add(entry.id);
                    }
                }
            }

            if (candidates.length > 0) {
                 console.log("Treffer via ID/Nummer-Priorisierung gefunden.");
                 searchMethod = "priority_id_match";
            } else {
                console.log("Kein Treffer trotz ID-Format. Falle zurück auf breite Suche...");
            }
        }

        // --- FALLBACK: Breite Suche (Barcode, Model, ID, Nummer) ---
        // Läuft, wenn NICHT priorisiert gefunden wurde (oder Format nicht passte)
        if (candidates.length === 0) {
            console.log(`Tradeo AI: Starte breite Suche für '${identifier}'...`);
            
            const searchPromises = [];

            // A) ID (nur wenn numerisch UND wir es oben nicht schon erfolglos geprüft haben)
            if (!isNaN(identifier) && !isInternalNumberFormat) {
                 searchPromises.push(
                    makePlentyCall(`/rest/items/variations?id=${identifier}`)
                    .then(res => ({ type: 'id', entries: res.entries }))
                    .catch(() => ({ type: 'id', entries: [] }))
                );
            }

            // B) Exakte Nummer (nur wenn oben nicht schon geprüft)
            if (!isInternalNumberFormat) {
                 searchPromises.push(
                    makePlentyCall(`/rest/items/variations?numberExact=${encodeURIComponent(identifier)}`)
                    .then(res => ({ type: 'numberExact', entries: res.entries }))
                    .catch(() => ({ type: 'numberExact', entries: [] }))
                );
            }

            // C) Barcode / EAN (immer prüfen im Fallback)
            searchPromises.push(
                makePlentyCall(`/rest/items/variations?barcode=${encodeURIComponent(identifier)}`)
                .then(res => ({ type: 'barcode', entries: res.entries }))
                .catch(() => ({ type: 'barcode', entries: [] }))
            );

            // D) Model (Teilenummer) - WICHTIG für Support!
            searchPromises.push(
                makePlentyCall(`/rest/items/variations?model=${encodeURIComponent(identifier)}`)
                .then(res => ({ type: 'model', entries: res.entries }))
                .catch(() => ({ type: 'model', entries: [] }))
            );

            const results = await Promise.all(searchPromises);

            for (const res of results) {
                if (res.entries && res.entries.length > 0) {
                    for (const entry of res.entries) {
                        if (!seenIds.has(entry.id)) {
                            candidates.push(entry);
                            seenIds.add(entry.id);
                        }
                    }
                }
            }
        }

        // --- FALLBACK 2: Fuzzy Suche (wenn immer noch nichts) ---
        if (candidates.length === 0) {
            console.log("Keine exakten Treffer. Versuche Fuzzy-Suche...");
            try {
                const fuzzyRes = await makePlentyCall(`/rest/items/variations?numberFuzzy=${encodeURIComponent(identifier)}`);
                if (fuzzyRes.entries) {
                    fuzzyRes.entries.forEach(entry => {
                        if (!seenIds.has(entry.id)) {
                            candidates.push(entry);
                            seenIds.add(entry.id);
                        }
                    });
                }
            } catch (e) {
                console.warn("Fuzzy search failed:", e);
            }
        }

        // --- SCHRITT 3: Ergebnisaufbereitung ---
        
        if (candidates.length === 0) {
            throw new Error(`Artikel/Variation '${identifier}' konnte nicht gefunden werden (weder als ID, Nummer, EAN noch Model).`);
        }

        // Fall A: Genau ein Treffer
        if (candidates.length === 1) {
            if (searchMethod === "unknown") searchMethod = "single_match";
            return await loadFullData(candidates[0]);
        }

        // Fall B: Mehrere Treffer
        console.log(`Ambige Ergebnisse: ${candidates.length} gefunden. Lade Details für Top 5...`);
        
        const topCandidates = candidates.slice(0, 5);
        const candidatesWithContext = await Promise.all(topCandidates.map(async (cand) => {
            try {
                const itemBase = await makePlentyCall(`/rest/items/${cand.itemId}`);
                const name = (itemBase.texts && itemBase.texts.length > 0) ? itemBase.texts[0].name1 : "Unbekannt";
                
                const stock = await makePlentyCall(`/rest/stockmanagement/stock?variationId=${cand.id}&warehouseId=1`);
                const netStock = stock && stock.length > 0 ? stock[0].netStock : 0;

                return {
                    id: cand.id,
                    number: cand.number,
                    model: cand.model,
                    name: name,
                    stockNet: netStock,
                    isActive: cand.isActive
                };
            } catch (e) {
                return { id: cand.id, number: cand.number, error: "Details fehlerhaft" };
            }
        }));

        return {
            meta: { type: "PLENTY_ITEM_AMBIGUOUS", count: candidates.length, searchedFor: identifier, timestamp: new Date().toISOString() },
            message: `Es wurden ${candidates.length} passende Artikel gefunden (Suche nach '${identifier}').`,
            candidates: candidatesWithContext
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