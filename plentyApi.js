// plentyApi.js - Dynamische Authentifizierung

const PLENTY_BASE_URL = "https://p7843.my.plentysystems.com";
const COUNTRY_MAP={1:"Germany",2:"Austria",3:"Belgium",4:"Switzerland",5:"Cyprus",6:"Czech Republic",7:"Denmark",8:"Spain",9:"Estonia",10:"France",11:"Finland",12:"United Kingdom",13:"Greece",14:"Hungary",15:"Italy",16:"Ireland",17:"Luxembourg",18:"Latvia",19:"Malta",20:"Norway",21:"Netherlands",22:"Portugal",23:"Poland",24:"Sweden",25:"Singapore",26:"Slovakia",27:"Slovenia",28:"USA",29:"Australia",30:"Canada",31:"China",32:"Japan",33:"Lithuania",34:"Liechtenstein",35:"Monaco",36:"Mexico",37:"Canary Islands",38:"India",39:"Brazil",40:"Russia",41:"Romania",42:"Ceuta",43:"Melilla",44:"Bulgaria",45:"Kosovo",46:"Kyrgyzstan",47:"Kazakhstan",48:"Belarus",49:"Uzbekistan",50:"Morocco",51:"Armenia",52:"Albania",53:"Egypt",54:"Croatia",55:"Maldives",56:"Malaysia",57:"Hong Kong",58:"Yemen",59:"Israel",60:"Taiwan",61:"Guadeloupe",62:"Thailand",63:"Turkey",64:"Greek Islands",65:"Balearic Islands",66:"New Zealand",67:"Afghanistan",68:"Aland Islands",69:"Algeria",70:"American Samoa",71:"Andorra",72:"Angola",73:"Anguilla",74:"Antarctica",75:"Antigua and Barbuda",76:"Argentina",77:"Aruba",78:"Azerbaijan",79:"The Bahamas",80:"Bahrain",81:"Bangladesh",82:"Barbados",83:"Belize",84:"Benin",85:"Bermuda",86:"Bhutan",87:"Bolivia",88:"Bosnia and Herzegovina",89:"Botswana",90:"Bouvet Island",91:"British Indian Ocean Territory",92:"Brunei Darussalam",93:"Burkina Faso",94:"Burundi",95:"Cambodia",96:"Cameroon",97:"Cape Verde",98:"Cayman Islands",99:"Central African Republic",100:"Chad",101:"Chile",102:"Christmas Island",103:"Cocos Islands/Keeling Islands",104:"Columbia",105:"Comoros",106:"Congo",107:"Democratic Republic of the Congo",108:"Cook Islands",109:"Costa Rica",110:"Ivory coast",112:"Cuba",113:"Djibouti",114:"Dominica",115:"Dominican Republic",116:"Ecuador",117:"El Salvador",118:"Equatorial Guinea",119:"Eritrea",120:"Ethiopia",121:"Falkland Islands",122:"Faroe Islands",123:"Fiji",124:"French Guiana",125:"French Polynesia",126:"French Southern and Antarctic Lands",127:"Gabon",128:"Gambia",129:"Georgia",130:"Ghana",131:"Gibraltar",132:"Greenland",133:"Grenada",134:"Guam",135:"Guatemala",136:"Guernsey",137:"Guinea",138:"Guinea-Bissau",139:"Guyana",140:"Haiti",141:"Heard Island and McDonald Islands",142:"Vatican City",143:"Honduras",144:"Iceland",145:"Indonesia",146:"Iran",147:"Iraq",148:"Isle of Man",149:"Jamaica",150:"Jersey",151:"Jordan",152:"Kenya",153:"Kiribati",154:"Democratic People’s Republic of Korea",155:"Republic of Korea",156:"Kuwait",158:"Laos",159:"Lebanon",160:"Lesotho",161:"Liberia",162:"Libya",163:"Macao",164:"Macedonia",165:"Madagascar",166:"Malawi",168:"Mali",169:"Marshall Islands",170:"Martinique",171:"Mauritania",172:"Mauritius",173:"Mayotte",174:"Micronesia",175:"Moldova",176:"Mongolia",177:"Montenegro",178:"Montserrat",179:"Mozambique",180:"Myanmar",181:"Namibia",182:"Nauru",183:"Nepal",184:"Netherlands Antilles",185:"New Caledonia",186:"Nicaragua",187:"Niger",188:"Nigeria",189:"Niue",190:"Norfolk Island",191:"Northern Mariana Islands",192:"Oman",193:"Pakistan",194:"Palau",195:"Palestinian territories",196:"Panama",197:"Papua New Guinea",198:"Paraguay",199:"Peru",200:"Philippines",201:"Pitcairn Islands",202:"Puerto Rico",203:"Qatar",204:"Reunion",205:"Rwanda",206:"Saint Helena",207:"Saint Kitts and Nevis",208:"Saint Lucia",209:"Saint Pierre and Miquelon",210:"Saint Vincent and the Grenadines",211:"Samoa",212:"San Marino",213:"Sao Tome and Principe",214:"Saudi Arabia",215:"Senegal",216:"Serbia",217:"Seychelles",218:"Sierra Leone",219:"Solomon Islands",220:"Somalia",221:"South Africa",222:"South Georgia and the South Sandwich Islands",223:"Sri Lanka",224:"Sudan",225:"Suriname",226:"Spitsbergen and Jan Mayen",227:"Swaziland",228:"Syria",229:"Tajikistan",230:"Tanzania",231:"Timor-Leste",232:"Togo",233:"Tokelau",234:"Tonga",235:"Trinidad and Tobago",236:"Tunisia",237:"Turkmenistan",238:"Turks and Caicos Islands",239:"Tuvalu",240:"Uganda",241:"Ukraine",242:"United States Minor Outlying Islands",243:"Uruguay",244:"Vanuatu",245:"Venezuela",246:"Vietnam",247:"British Virgin Islands",248:"United States Virgin Islands",249:"Wallis and Futuna",250:"Western Sahara",252:"Zambia",253:"Zimbabwe",254:"United Arab Emirates",255:"Helgoland",256:"Buesingen",258:"Curaçao",259:"Sint Maarten",260:"BES Islands",261:"Saint Barthélemy",262:"Livigno",263:"Campione d’Italia",264:"Lake Lugano from Ponte Tresa to Porto Ceresio",265:"Northern Ireland",0:"Unknown"};

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
 * Hilfsfunktion: Wandelt HTML in reinen Text um, behält aber Zeilenumbrüche.
 * Funktioniert auch im Service Worker (ohne DOM).
 */
function stripHtmlToText(html) {
    if (!html) return "";
    let text = html;
    // 1. Wichtige Block-Breaks in Newlines wandeln
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
    // 2. Alle restlichen HTML Tags entfernen
    text = text.replace(/<[^>]+>/g, '');
    // 3. Gängige Entities auflösen
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // 4. Whitespace bereinigen (max 2 Newlines hintereinander)
    text = text.replace(/[ \t]+/g, ' '); // Tabs/Spaces stauchen
    text = text.replace(/\n\s*\n/g, '\n'); // Leere Zeilen stauchen
    return text.trim();
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

async function fetchItemDetails(identifierRaw) {
    try {
        const identifier = String(identifierRaw).trim();
        let candidates = [];
        let searchMethod = "unknown";
        const seenIds = new Set(); // Duplikate vermeiden

        // --- Helper: Response normalisieren (Array ODER { entries: [...] }) ---
        const extractEntries = (res) => {
            if (!res) return [];
            if (Array.isArray(res)) return res;
            if (Array.isArray(res.entries)) return res.entries;
            if (Array.isArray(res.variations)) return res.variations;
            return [];
        };

        // --- Helper: Kandidaten hinzufügen ---
        const addCandidates = (entries) => {
            for (const entry of entries || []) {
                if (!entry || typeof entry.id === "undefined") continue;
                if (!seenIds.has(entry.id)) {
                    seenIds.add(entry.id);
                    candidates.push(entry);
                }
            }
        };

        // --- Helper: kleine Zahl-Utility ---
        const asNumber = (value) => {
            const n = parseFloat(value);
            return Number.isFinite(n) ? n : 0;
        };

        // --- Helper: Net-Stock aus einem einzelnen Stock-Entry bestimmen ---
        const computeNetStockEntry = (entry) => {
            if (!entry || typeof entry !== "object") return 0;

            // 1) Bevorzugt Felder wie netStock / stockNet
            if (entry.netStock != null) return asNumber(entry.netStock);
            if (entry.stockNet != null) return asNumber(entry.stockNet);

            // 2) Fallback: physical - reserved
            const physical = asNumber(
                entry.physicalStock ??
                entry.stockPhysical ??
                entry.physical ??
                0
            );
            const reserved = asNumber(
                entry.reservedStock ??
                entry.stockReserved ??
                entry.reserved ??
                0
            );

            if (physical !== 0 || reserved !== 0) {
                return physical - reserved;
            }

            // 3) Letzter Fallback: alles andere ignorieren → 0
            return 0;
        };

        // --- Helper: Summe über alle Lager (Variante B) ---
        const loadNetStockAllWarehouses = async (variationId) => {
            // 1. Versuch: ohne warehouseId → alle Lager
            let stockData = await makePlentyCall(
                `/rest/stockmanagement/stock?variationId=${variationId}`
            );
            let stockEntries = extractEntries(stockData);

            // Wenn Plenty hier nichts liefert, Fallback auf warehouseId=1
            if (!stockEntries.length) {
                stockData = await makePlentyCall(
                    `/rest/stockmanagement/stock?variationId=${variationId}&warehouseId=1`
                );
                stockEntries = extractEntries(stockData);
            }

            const netStockTotal = stockEntries.reduce((acc, entry) => {
                return acc + computeNetStockEntry(entry);
            }, 0);

            // Kleines Debug-Logging, um die Struktur zu sehen
            if (stockEntries.length) {
                console.log("Tradeo AI: Stock-Debug", {
                    variationId,
                    warehouses: stockEntries.map(e => e.warehouseId),
                    sampleEntry: stockEntries[0],
                    netStockTotal
                });
            } else {
                console.log("Tradeo AI: Stock-Debug", {
                    variationId,
                    warehouses: [],
                    netStockTotal: 0
                });
            }

            return netStockTotal;
        };

        // --- Helper: /rest/items/variations Suche ---
        const searchVariations = async (params, label) => {
            const qs = new URLSearchParams({
                itemsPerPage: "50",
                ...params
            }).toString();

            const url = `/rest/items/variations?${qs}`;
            console.log(`Tradeo AI: Suche '${label}' → ${url}`);

            try {
                const res = await makePlentyCall(url);
                const entries = extractEntries(res);
                console.log(`Tradeo AI: Suche '${label}' → ${entries.length} Treffer`);
                addCandidates(entries);
            } catch (e) {
                console.warn(`Tradeo AI: Suche '${label}' fehlgeschlagen:`, e);
            }
        };

        // --- Helper: Vollständige Daten für eine Variation laden (Single-Treffer) ---
        const loadFullData = async (variation) => {
            const itemId = variation.itemId;
            const variationId = variation.id;

            const [stockData, itemBaseData] = await Promise.all([
                // hier lässt du das Verhalten wie bisher (nur Lager 1),
                // damit der Export sich nicht ändert
                makePlentyCall(`/rest/stockmanagement/stock?variationId=${variationId}&warehouseId=1`),
                makePlentyCall(`/rest/items/${itemId}`)
            ]);

            const stockEntries = extractEntries(stockData);

            return {
                meta: {
                    type: "PLENTY_ITEM_EXPORT",
                    timestamp: new Date().toISOString(),
                    searchMethod
                },
                variation,
                item: itemBaseData,
                stock: stockEntries
            };
        };

        const isNumeric = /^\d+$/.test(identifier);
        const isInternalNumberFormat = /^1\d{5}$/.test(identifier); // 6-stellig, beginnt mit 1

        // =====================================================================
        // 1. PRIORISIERTE SUCHE: Variation-ID / Item-ID / numberExact
        // =====================================================================
        if (isNumeric) {
            console.log(`Tradeo AI: Numerischer Identifier '${identifier}' – prüfe ID-Varianten...`);

            // a) Variation-ID direkt
            await searchVariations({ id: identifier }, "priority:variationId");

            // b) Item-ID (Artikel-ID → alle Variationen zu diesem Artikel)
            if (candidates.length === 0) {
                await searchVariations({ itemId: identifier }, "priority:itemId");
            }

            // c) exakte Variationsnummer (numberExact)
            if (candidates.length === 0) {
                await searchVariations({ numberExact: identifier }, "priority:numberExact");
            }

            // d) HARDCODED-FALLBACK: /rest/items/{itemId}/variations → Item-ID aus UI
            if (candidates.length === 0) {
                try {
                    console.log(`Tradeo AI: Fallback: /rest/items/${identifier}/variations ...`);
                    const res = await makePlentyCall(`/rest/items/${identifier}/variations`);
                    const entries = extractEntries(res);
                    console.log(`Tradeo AI: /rest/items/${identifier}/variations → ${entries.length} Treffer`);
                    addCandidates(entries);
                    if (entries.length > 0) {
                        searchMethod = "itemId_path";
                    }
                } catch (e) {
                    console.warn("Tradeo AI: Fallback /rest/items/{itemId}/variations fehlgeschlagen:", e);
                }
            }

            if (candidates.length > 0 && searchMethod === "unknown") {
                searchMethod = isInternalNumberFormat ? "priority_internal_numeric" : "priority_numeric";
            }
        }

        // =====================================================================
        // 2. BREITE SUCHE:
        //    numberExact/numberFuzzy, barcode, itemName, itemDescription, supplierNumber, supplierNumberFuzzy, sku
        // =====================================================================
        if (candidates.length === 0) {
            console.log(`Tradeo AI: Starte breite Suche für '${identifier}'...`);

            const tasks = [];

            // Exakte & fuzzy Variationsnummer
            tasks.push(searchVariations({ numberExact: identifier }, "numberExact"));
            tasks.push(searchVariations({ numberFuzzy: identifier }, "numberFuzzy"));

            // Barcode / EAN
            tasks.push(searchVariations({ barcode: identifier }, "barcode"));

            // Freitext im Artikelnamen
            tasks.push(searchVariations({ itemName: identifier }, "itemName"));

            // Freitext in der Beschreibung
            tasks.push(searchVariations({ itemDescription: identifier }, "itemDescription"));

            // WICHTIG: Suche im Feld "Model" (für MPNs wie M386A8K40BM2-CTD)
            tasks.push(searchVariations({ model: identifier }, "model"));

            // Lieferantennummer
            tasks.push(searchVariations({ supplierNumber: identifier }, "supplierNumber"));
            tasks.push(searchVariations({ supplierNumberFuzzy: identifier }, "supplierNumberFuzzy"));

            // SKU (z.B. Marktplatz-SKU)
            tasks.push(searchVariations({ sku: identifier }, "sku"));

            await Promise.all(tasks);

            if (candidates.length > 0 && searchMethod === "unknown") {
                searchMethod = "broad_search";
            }
        }

        // =====================================================================
        // 3. KEIN TREFFER → Fehler
        // =====================================================================
        if (candidates.length === 0) {
            throw new Error(
                `Artikel/Variation '${identifier}' konnte nicht gefunden werden (weder via Variation-ID, Item-ID, Nummer, Barcode, Name, Beschreibung noch Supplier/SKU).`
            );
        }

        // =====================================================================
        // 4. GENAU EIN TREFFER → direkt exportieren
        // =====================================================================
        if (candidates.length === 1) {
            if (searchMethod === "unknown") searchMethod = "single_match";
            return await loadFullData(candidates[0]);
        }

        // =====================================================================
        // 5. MEHRERE TREFFER → Kandidatenliste mit Kontext (Variante B für Net-Stock)
        // =====================================================================
        console.log(`Tradeo AI: Ambige Ergebnisse – ${candidates.length} Treffer. Lade Details für Top 5...`);

        const topCandidates = candidates.slice(0, 5);

        const candidatesWithContext = await Promise.all(
            topCandidates.map(async (cand) => {
                try {
                    const itemBase = await makePlentyCall(`/rest/items/${cand.itemId}`);
                    let name = "Unbekannt";

                    if (itemBase && itemBase.texts && itemBase.texts.length > 0) {
                        const t = itemBase.texts[0];
                        name = t.name1 || t.name2 || t.name3 || "Unbekannt";
                    }

                    // Variante B: Net-Stock über alle Lager summieren
                    const netStock = await loadNetStockAllWarehouses(cand.id);

                    return {
                        id: cand.id,
                        itemId: cand.itemId,
                        number: cand.number,
                        model: cand.model, // kommt aus Variation-Objekt
                        name,
                        stockNet: netStock,
                        isActive: cand.isActive
                    };
                } catch (e) {
                    console.warn("Tradeo AI: Kandidat-Detailabruf fehlgeschlagen:", e);
                    return {
                        id: cand.id,
                        itemId: cand.itemId,
                        number: cand.number,
                        model: cand.model,
                        error: "Details fehlerhaft"
                    };
                }
            })
        );

        return {
            meta: {
                type: "PLENTY_ITEM_AMBIGUOUS",
                count: candidates.length,
                searchedFor: identifier,
                searchMethod,
                timestamp: new Date().toISOString()
            },
            message: `Es wurden ${candidates.length} passende Artikel gefunden (Suche nach '${identifier}').`,
            candidates: candidatesWithContext
        };
    } catch (error) {
        console.error("Fehler bei fetchItemDetails:", error);
        throw error;
    }
}


// --- plentyApi.js ---

/**
 * Hilfsfunktion: Führt einen "Pre-Flight" Check für Tokens durch, um die Trefferanzahl zu ermitteln.
 * UPDATED: Filtert jetzt serverseitig nach aktiven Artikeln (&isActive=true).
 */
async function getTokenStats(tokens, searchInDescription) {
    const stats = [];
    
    const checks = tokens.map(async (token) => {
        try {
            // Wir fragen nur 1 Item ab, uns interessiert nur 'totalsCount' im Response
            // WICHTIG: &isActive=true hinzugefügt
            const p1 = makePlentyCall(`/rest/items/variations?itemsPerPage=1&lang=de&isActive=true&itemName=${encodeURIComponent(token)}`);
            let p2 = Promise.resolve({ totalsCount: 0 });
            
            if (searchInDescription) {
                // WICHTIG: &isActive=true hinzugefügt
                p2 = makePlentyCall(`/rest/items/variations?itemsPerPage=1&lang=de&isActive=true&itemDescription=${encodeURIComponent(token)}`);
            }
            
            const [resName, resDesc] = await Promise.all([p1, p2]);
            
            const countName = resName ? resName.totalsCount : 0;
            const countDesc = resDesc ? resDesc.totalsCount : 0;
            
            // Wir addieren die Counts als Schätzwert
            return { 
                token, 
                count: countName + countDesc,
                details: { name: countName, desc: countDesc }
            };
        } catch (e) {
            console.warn(`Token Check failed for '${token}':`, e);
            return { token, count: Infinity }; // Fehlerhafte Tokens bestrafen
        }
    });

    return Promise.all(checks);
}

/**
 * Hilfsfunktion: Lädt ALLE Ergebnisse für ein bestimmtes Kriterium via Pagination.
 * UPDATED: Filtert standardmäßig nach aktiven Artikeln.
 */
async function fetchAllVariations(params) {
    let allEntries = [];
    let page = 1;
    const itemsPerPage = 50; 
    let hasMore = true;

    while (hasMore) {
        const qp = new URLSearchParams({
            itemsPerPage: String(itemsPerPage),
            page: String(page),
            lang: 'de',
            isActive: 'true', // <--- WICHTIG: Nur aktive Varianten laden
            ...params
        });

        try {
            const res = await makePlentyCall(`/rest/items/variations?${qp.toString()}`);
            if (res && Array.isArray(res.entries)) {
                allEntries.push(...res.entries);
                
                // Check ob wir am Ende sind
                if (res.isLastPage || res.entries.length < itemsPerPage) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
            
            // Safety Break: Verhindere Endlosschleifen bei extrem vielen Artikeln (> 2000)
            if (page > 40) { 
                console.warn("Tradeo AI: Fetch Limit erreicht (2000 Items). Breche ab.");
                hasMore = false; 
            }

        } catch (e) {
            console.warn(`Fetch Page ${page} failed:`, e);
            hasMore = false;
        }
    }
    
    return allEntries;
}

// --- plentyApi.js ---
// (Ersetze die gesamte searchItemsByText Funktion mit dieser Version)

async function searchItemsByText(searchText, options = {}) {
    // ---- Optionen / Modi parsen ----
    let mode = "name";
    let maxResults = 50; 

    if (typeof options === "string") {
        mode = options === "nameAndDescription" ? "nameAndDescription" : "name";
    } else if (options && typeof options === "object") {
        if (options.mode === "nameAndDescription") mode = "nameAndDescription";
        if (typeof options.maxResults === "number") maxResults = options.maxResults;
    }

    const searchInDescription = mode === "nameAndDescription";

    // ---- Input validieren ----
    if (!searchText || typeof searchText !== "string" || !searchText.trim()) {
        throw new Error("searchItemsByText: Suchstring fehlt oder ist leer.");
    }

    const searchRaw = searchText.trim();
    const tokens = Array.from(new Set(searchRaw.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1)));

    if (tokens.length === 0) return { meta: { type: "EMPTY" }, results: [] };

    console.log(`Tradeo AI SmartSearch: Analysiere Tokens: ${JSON.stringify(tokens)}`);

    // 1. STATS
    const stats = await getTokenStats(tokens, searchInDescription);
    const validStats = stats.filter(s => s.count > 0).sort((a, b) => a.count - b.count);

    if (validStats.length === 0) {
        return { meta: { type: "NO_MATCH_ANY_TOKEN", searchText: searchRaw }, results: [] };
    }

    const winner = validStats[0];
    console.log(`Tradeo AI SmartSearch: Gewinner ist '${winner.token}' mit ca. ${winner.count} Treffern.`);

    // 2. FETCH ALL
    const pName = fetchAllVariations({ itemName: winner.token });
    let pDesc = Promise.resolve([]);
    if (searchInDescription) {
        pDesc = fetchAllVariations({ itemDescription: winner.token });
    }

    const [hitsName, hitsDesc] = await Promise.all([pName, pDesc]);
    
    // Deduplizieren
    const candidateMap = new Map();
    [...hitsName, ...hitsDesc].forEach(v => {
        if(v && v.id) candidateMap.set(v.id, v);
    });

    const candidates = Array.from(candidateMap.values());
    console.log(`Tradeo AI SmartSearch: ${candidates.length} Kandidaten geladen. Starte Filterung...`);

    // 3. FILTERING
    const itemCache = new Map();
    const enrichedResults = [];
    
    // UPDATED FILTER REGEX: "bundle" und "upgrade" (solo) verboten
    const bannedRegex = /(hardware\s*care\s*pack|upgrade|bundle)/i;

    const extractNameAndDescription = (item) => {
        let name = "";
        let description = "";
        if (item && Array.isArray(item.texts) && item.texts.length > 0) {
            const textDe = item.texts.find(t => t.lang === "de") || item.texts[0];
            if (textDe) {
                const parts = [textDe.name1, textDe.name2, textDe.name3].filter(Boolean);
                name = parts.join(" ").trim();
                description = (textDe.description || "").trim();
            }
        }
        return { name, description };
    };

    const tokenRegexes = tokens.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

    for (const variation of candidates) {
        const itemId = variation.itemId;
        const variationId = variation.id;

        let item = itemCache.get(itemId);
        if (!item) {
            try {
                item = await makePlentyCall(`/rest/items/${itemId}`);
                itemCache.set(itemId, item);
            } catch (e) { continue; }
        }

        const { name: apiName, description: apiDesc } = extractNameAndDescription(item);
        
        // Suche auf Basis der API-Daten (Original)
        const fullTextForSearch = (apiName + " " + (searchInDescription ? apiDesc : "")).toLowerCase();

        // Ban-Check
        if (bannedRegex.test(fullTextForSearch)) continue;

        // TOKEN CHECK
        const allTokensMatch = tokenRegexes.every(rx => rx.test(apiName) || (searchInDescription && rx.test(apiDesc)));

        if (!allTokensMatch) continue;

        // Treffer! Daten anreichern.
        let stock = [];
        let variationSalesPrices = [];

        try {
            const [stockRes, vspRes] = await Promise.all([
                makePlentyCall(`/rest/items/${itemId}/variations/${variationId}/stock`).catch(() => []),
                makePlentyCall(`/rest/items/${itemId}/variations/${variationId}/variation_sales_prices`).catch(() => [])
            ]);
            stock = Array.isArray(stockRes) ? stockRes : [];
            if (Array.isArray(vspRes)) variationSalesPrices = vspRes;
        } catch (e) { /* ignore */ }

        // --- NAMEN & BESCHREIBUNG AUFBEREITEN ---
        // 1. HTML entfernen
        const cleanFullDesc = stripHtmlToText(apiDesc);
        // 2. In Zeilen splitten
        const lines = cleanFullDesc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // 3. Name ableiten (Zeile 1)
        let derivedName = lines.length > 0 ? lines[0] : apiName; // Fallback auf API Name wenn leer
        // "Beschreibung:" Prefix entfernen, falls vorhanden
        derivedName = derivedName.replace(/^Beschreibung:\s*/i, '');

        // 4. Beschreibung ableiten (Restliche Zeilen), um Dopplung zu vermeiden
        const derivedDesc = lines.length > 1 ? lines.slice(1).join('\n') : "";

        enrichedResults.push({
            articleNumber: String(itemId),
            model: variation.model,
            name: derivedName,     // AI Name = Zeile 1 der Beschreibung
            description: derivedDesc, // AI Desc = Rest der Beschreibung
            stockNet: (stock && stock.length > 0) ? stock[0].netStock : 0,
            price: (variationSalesPrices && variationSalesPrices.length > 0) ? variationSalesPrices[0].price : "N/A"
        });
    }

    const finalResults = enrichedResults.slice(0, maxResults);

    return {
        meta: {
            type: "PLENTY_ITEM_SMART_SEARCH",
            searchText: searchRaw,
            strategy: `WinnerToken: ${winner.token} (${winner.count} Hits)`,
            matchesFound: enrichedResults.length,
            timestamp: new Date().toISOString()
        },
        results: finalResults
    };
}

async function searchItemsByNameText(searchString) {
    return searchItemsByText(searchString, { mode: "name" });
}

async function searchItemsByNameAndDescriptionText(searchString) {
    return searchItemsByText(searchString, { mode: "nameAndDescription" });
}

