// plentyApi.js - Dynamische Authentifizierung
const PLENTY_BASE_URL = "https://p7843.my.plentysystems.com";

const COUNTRY_MAP={1:"Germany",2:"Austria",3:"Belgium",4:"Switzerland",5:"Cyprus",6:"Czech Republic",7:"Denmark",8:"Spain",9:"Estonia",10:"France",11:"Finland",12:"United Kingdom",13:"Greece",14:"Hungary",15:"Italy",16:"Ireland",17:"Luxembourg",18:"Latvia",19:"Malta",20:"Norway",21:"Netherlands",22:"Portugal",23:"Poland",24:"Sweden",25:"Singapore",26:"Slovakia",27:"Slovenia",28:"USA",29:"Australia",30:"Canada",31:"China",32:"Japan",33:"Lithuania",34:"Liechtenstein",35:"Monaco",36:"Mexico",37:"Canary Islands",38:"India",39:"Brazil",40:"Russia",41:"Romania",42:"Ceuta",43:"Melilla",44:"Bulgaria",45:"Kosovo",46:"Kyrgyzstan",47:"Kazakhstan",48:"Belarus",49:"Uzbekistan",50:"Morocco",51:"Armenia",52:"Albania",53:"Egypt",54:"Croatia",55:"Maldives",56:"Malaysia",57:"Hong Kong",58:"Yemen",59:"Israel",60:"Taiwan",61:"Guadeloupe",62:"Thailand",63:"Turkey",64:"Greek Islands",65:"Balearic Islands",66:"New Zealand",67:"Afghanistan",68:"Aland Islands",69:"Algeria",70:"American Samoa",71:"Andorra",72:"Angola",73:"Anguilla",74:"Antarctica",75:"Antigua and Barbuda",76:"Argentina",77:"Aruba",78:"Azerbaijan",79:"The Bahamas",80:"Bahrain",81:"Bangladesh",82:"Barbados",83:"Belize",84:"Benin",85:"Bermuda",86:"Bhutan",87:"Bolivia",88:"Bosnia and Herzegovina",89:"Botswana",90:"Bouvet Island",91:"British Indian Ocean Territory",92:"Brunei Darussalam",93:"Burkina Faso",94:"Burundi",95:"Cambodia",96:"Cameroon",97:"Cape Verde",98:"Cayman Islands",99:"Central African Republic",100:"Chad",101:"Chile",102:"Christmas Island",103:"Cocos Islands/Keeling Islands",104:"Columbia",105:"Comoros",106:"Congo",107:"Democratic Republic of the Congo",108:"Cook Islands",109:"Costa Rica",110:"Ivory coast",112:"Cuba",113:"Djibouti",114:"Dominica",115:"Dominican Republic",116:"Ecuador",117:"El Salvador",118:"Equatorial Guinea",119:"Eritrea",120:"Ethiopia",121:"Falkland Islands",122:"Faroe Islands",123:"Fiji",124:"French Guiana",125:"French Polynesia",126:"French Southern and Antarctic Lands",127:"Gabon",128:"Gambia",129:"Georgia",130:"Ghana",131:"Gibraltar",132:"Greenland",133:"Grenada",134:"Guam",135:"Guatemala",136:"Guernsey",137:"Guinea",138:"Guinea-Bissau",139:"Guyana",140:"Haiti",141:"Heard Island and McDonald Islands",142:"Vatican City",143:"Honduras",144:"Iceland",145:"Indonesia",146:"Iran",147:"Iraq",148:"Isle of Man",149:"Jamaica",150:"Jersey",151:"Jordan",152:"Kenya",153:"Kiribati",154:"Democratic People’s Republic of Korea",155:"Republic of Korea",156:"Kuwait",158:"Laos",159:"Lebanon",160:"Lesotho",161:"Liberia",162:"Libya",163:"Macao",164:"Macedonia",165:"Madagascar",166:"Malawi",168:"Mali",169:"Marshall Islands",170:"Martinique",171:"Mauritania",172:"Mauritius",173:"Mayotte",174:"Micronesia",175:"Moldova",176:"Mongolia",177:"Montenegro",178:"Montserrat",179:"Mozambique",180:"Myanmar",181:"Namibia",182:"Nauru",183:"Nepal",184:"Netherlands Antilles",185:"New Caledonia",186:"Nicaragua",187:"Niger",188:"Nigeria",189:"Niue",190:"Norfolk Island",191:"Northern Mariana Islands",192:"Oman",193:"Pakistan",194:"Palau",195:"Palestinian territories",196:"Panama",197:"Papua New Guinea",198:"Paraguay",199:"Peru",200:"Philippines",201:"Pitcairn Islands",202:"Puerto Rico",203:"Qatar",204:"Reunion",205:"Rwanda",206:"Saint Helena",207:"Saint Kitts and Nevis",208:"Saint Lucia",209:"Saint Pierre and Miquelon",210:"Saint Vincent and the Grenadines",211:"Samoa",212:"San Marino",213:"Sao Tome and Principe",214:"Saudi Arabia",215:"Senegal",216:"Serbia",217:"Seychelles",218:"Sierra Leone",219:"Solomon Islands",220:"Somalia",221:"South Africa",222:"South Georgia and the South Sandwich Islands",223:"Sri Lanka",224:"Sudan",225:"Suriname",226:"Spitsbergen and Jan Mayen",227:"Swaziland",228:"Syria",229:"Tajikistan",230:"Tanzania",231:"Timor-Leste",232:"Togo",233:"Tokelau",234:"Tonga",235:"Trinidad and Tobago",236:"Tunisia",237:"Turkmenistan",238:"Turks and Caicos Islands",239:"Tuvalu",240:"Uganda",241:"Ukraine",242:"United States Minor Outlying Islands",243:"Uruguay",244:"Vanuatu",245:"Venezuela",246:"Vietnam",247:"British Virgin Islands",248:"United States Virgin Islands",249:"Wallis and Futuna",250:"Western Sahara",252:"Zambia",253:"Zimbabwe",254:"United Arab Emirates",255:"Helgoland",256:"Buesingen",258:"Curaçao",259:"Sint Maarten",260:"BES Islands",261:"Saint Barthélemy",262:"Livigno",263:"Campione d’Italia",264:"Lake Lugano from Ponte Tresa to Porto Ceresio",265:"Northern Ireland",0:"Unknown"};
const CUSTOMER_CLASS_MAP={9:"Standard-Endkunden",10:"Standard-Firmenkunden",7:"Bestandskunden (dyn. mit Kauf)",4:"Oeffentliche Einrichtungen",11:"Rechnung freigegeben (ungeprüft)",5:"Rechnung freigegeben (incl. Credit Check)",16:"Kunde mit 30 Tage Zahlungsziel",15:"Kunde mit 60 Tagen Zahlungsziel",6:"KEINE Rechnung möglich",8:"Kunden mit 10% Rabatt",3:"Kunden mit 20% Rabatt",14:"Gesperrt"};
const ORDER_TYPES={1:"Auftrag (Order)",2:"Lieferauftrag (Delivery)",3:"Retoure (Return)",4:"Gutschrift (Credit Note)",5:"Gewährleistung (Warranty)",6:"Reparatur (Repair)",7:"Angebot (Offer)",8:"Vorbestellung (Advance Order)"};
const PAYMENTMETHOD_MAP={"1":"Nachnahme","2":"Rechnung","4":"Barzahlung","6000":"Vorkasse via Bankueberweisung","7001":"mollie: Credit card","7002":"mollie: Apple Pay","7003":"Amazon Pay","7004":"PayPal","7005":"PayPalExpress","7006":"PayPalPlus","7007":"PayPalInstallment","7051":"SOFORT","7052":"mollie: eps","7053":"mollie: iDEAL","7054":"mollie: Bancontact","7055":"mollie: Bank transfer","7056":"mollie: Belfius","7057":"mollie: Direct debit","7058":"mollie: Gift cards","7059":"mollie: Giropay","7060":"mollie: ING HomePay","7061":"mollie: KBC/CBC","7062":"mollie: Klarna Pay Later","7063":"mollie: Klarna Slice it","7064":"mollie: Paypal","7065":"mollie: Paysafecard","7066":"mollie: SOFORT Banking","7067":"mollie: Przelewy24","7072":"mollie: Klarna Pay Now","7075":"mollie: in3","7077":"PAYPAL_CARD","7078":"PAYPAL_UNBRANDED_CARD","7079":"PAYPAL_GIROPAY","7080":"PAYPAL_SEPA","7081":"PAYPAL_SOFORT","7082":"PAYPAL_PAY_LATER","7083":"PAYPAL_BANCONTACT","7084":"PAYPAL_BLIK","7085":"PAYPAL_EPS","7086":"PAYPAL_IDEAL","7087":"PAYPAL_MYBANK","7088":"PAYPAL_PRZELEWY24","7089":"PAYPAL_TRUSTLY","7090":"PAYPAL_PAY_UPON_INVOICE","7098":"mollie: Twint","7109":"PAYPAL_GOOGLE_PAY","7110":"PAYPAL_APPLE_PAY","7111":"mollie: Pay with Klarna","7112":"mollie: BLIK","7113":"mollie: Trustly","7114":"mollie: BANCOMAT Pay","7115":"mollie: Pay by Bank","7126":"Amazon Pay"}
const SHIPPING_PROFILES={"19":"DHL Paket (Standard)","23":"Speditionsversand","24":"Selbstabholung","27":"DHL Express (vor 12)","28":"DHL Express (vor 9)","29":"DHL Paket mit Nachnahme","34":"FedEx Economy Express","35":"y FedEx Economy","36":"UPS Standard","39":"DHL Express International","40":"kein Versand","41":"UPS Express Saver","43":"Kundenspezifischer/Individueller Versand","44":"UPS Express","45":"DHL Express (Samstag)","46":"Swiss Post","48":"DHL Standard Europaket"};
const ORDER_DATE_TYPE_MAP={"1":"Gelöscht am","2":"Erstellt am","3":"Zahlungseingang","4":"zuletzt aktualisiert","5":"Warenausgang am","6":"Retourniert am","7":"Zahlungsziel","8":"voraussichtliches Versanddatum","9":"Startdatum","10":"Enddatum","11":"voraussichtliches Lieferdatum","12":"Übertragungsdatum Marktplatz","13":"Kündigungsdatum","14":"Letzter Durchlauf","15":"Nächster Durchlauf","16":"Bestelldatum","17":"Abschlussdatum","18":"Spätestes Versanddatum","19":"Gültigkeitsdatum von der Bestellbestätigungseite","20":"Angebot gültig bis","21":"Erster Durchlauf","22":"Abrechnungszeitraum Start","23":"Abrechnungszeitraum Ende"};
const ORDER_PROPERTY_TYPE_MAP={"1":"Lager","2":"Versandprofil","3":"Zahlungsart","4":"Zahlungsstatus","5":"Externes Versandprofil","6":"Sprache in Dokumenten","7":"Externe Auftrags-ID","8":"Kundenzeichen","9":"Mahnstufe","10":"Verkäuferkonto","11":"Gewicht","12":"Breite","13":"Länge","14":"Höhe","15":"Markierung","16":"Externe Token-ID","17":"Externe Artikel-ID","18":"Gutscheincode","19":"Gutscheintyp","20":"Originallager bei Auftragsanlage","21":"Originalmenge bei Auftragsanlage","22":"Kategorie","23":"Marktplatzgebühr","24":"Warenbestand -teilweise- zurückgebucht","25":"Streitstatus","26":"Auftragsänderungen durch Endkunden verboten","27":"Intervaltyp","28":"Intervalwert","29":"Einheit","30":"Lagerort reserviert","31":"Externe Versandartikel-ID","32":"Anteilige Versandkosten","33":"Dokumentennummer","34":"Umsatzsteuer-Identifikationsnummer","35":"Retourengrund","36":"Artikelstatus","37":"Fulfillment-Center-ID","38":"Fulfillment-Center-Länderkürzel","39":"ID der zugehörigen Nachbestellungs-Position","40":"Listing-Typ","41":"Externe Auftragspositions-ID","42":"Retourenschlüssel-ID","43":"Kommunikationsschlüssel-ID","44":"Mit Amazon VCS","45":"Zahlungsvorgangs-ID","46":"Verkaufter Gutschein-Code","47":"Externer Umsatzsteuer-Service","48":"Auftragspositionsstatus","49":"Externe Lieferscheinnummer","50":"SAP-Bestellnummer","51":"Abrechnungs-ID","52":"Rabatt","53":"Artikel VPE","54":"Artikel Mindestabnahme","55":"Artikel Lieferzeit in Tagen","56":"Artikel Rabattfähigkeit","57":"Restwert des Artikels (in %)","58":"Retoure durch den Kunde","60":"Verkäufer-ID","61":"Berichts-ID","62":"Externe Quellauftrags-ID","63":"Bevorzugte Lagerort-ID","64":"Versandetikett von Amazon","65":"Mit Expressversand","66":"Ursprung des Auftrags","67":"Reparaturstatus","68":"Schnittstelle der Auftragsanlage","69":"ID des Amazon-Umsatzsteuer-Kalkulationsberichts","70":"Bezugskosten - Frachtkosten","71":"Bezugskosten - Verpackungskosten","72":"Bezugskosten - Transportversicherung","73":"Bezugskosten - Rollgeld","74":"Bezugskosten - Porto","75":"Bezugskosten - Zölle","76":"Bezugskosten - Vermittlungsgebühren","77":"Bezugskosten - Mindermengenzuschläge","78":"Bezugskosten - Sonstige Kosten","79":"ID der Amazon-Transaktion","80":"externe Retouren-ID","81":"Bestelleigenschaft-ID","82":"Wert der Bestelleigenschaft","83":"Bestelleigenschaft Gruppen-ID","84":"Auto fulfilled eBay order","85":"Lieferanten-Artikel-Bezeichnung","86":"Erzwinge Brutto- oder Netto-Auftrag","87":"Plenty ID des Abonnements","88":"Marktplatz Steuer-ID","89":"Marktplatz EORI","90":"Reverse-Charge-Verfahren gem. Artikel 194 der MwStSystRL","91":"Erstellung von internen steuerrelevanten Dokumenten verboten","92":"Altgerätemitnahme","93":"Multi-Channel Order Processing Auftragsstatus-ID","94":"Gepackt","95":"URL zu einer externen Datei mit Kundenanpassungen des Artikels","96":"URL zu einer externen Seite mit Kundenanpassungen des Artikels","97":"externe Erstattungs-ID","98":"SKU","99":"externer Status der Auftragsposition","100":"Berechnung von Teilpreisen in Abonnements","101":"Priority for picking","102":"Gutschriftsgrund","103":"Ist Transparenz","104":"Listing-ID","105":"Channel Layer: Externe Auftragspositions-ID","106":"Zolldatenübermittlung","107":"Rückwirkende Abrechnung in Abonnements","108":"Öko-Beteiligungsgebühr","109":"Verpackungsgebühr","110":"Verkaufskanal-Versand-ID","111":"Reservierungsfehler","992":"Handelsvertreter","993":"Ebay Kaufabbruchs-ID","994":"Mit Ebay Plus","995":"Fulfillment-Service","996":"Mit Click und Collect","997":"Mit Amazon TCS","998":"Ebay Zahlungsvorgangs-ID","999":"Einwilligung zur Datenübermittlung an den Versanddienstleister e","1000":"DHL Shipping (Versenden) - Aufpreis","1001":"DHL Shipping (Versenden) - Wunschtag","1002":"DHL Shipping (Versenden) - Wunschort","1003":"DHL Shipping (Versenden) - Wunschzeit","1004":"DHL Shipping (Versenden) - Name des Wunschnachbars","1005":"DHL Shipping (Versenden) - Adresse des Wunschnachbars","1006":"AmazonInboundShipment: Sendungs-Id","1007":"AmazonInboundShipment: Amazon Konto Id","1008":"eBay Fulfillment: Outbound order number","1009":"eBay Fulfillment: eBay fulfilled order","1010":"Id des OrderItems, zu dem dieses Upgrade Order Item geh�rt","1011":"Id des OrderItems, welches dieses Upgrade Order Item erfordert","1012":"Packed","1013":"Shopify Bestelldatum","1014":"GLS ShipIT - IdentPin:pin","1015":"GLS ShipIT - IdentPin:birthday","1016":"GLS ShipIT - ServiceDeposit","1017":"GLS ShipIT - DeliverAtWork:recipientName","1018":"GLS ShipIT - DeliverAtWork:alternateRecipientName","1019":"GLS ShipIT - DeliverAtWork:building","1020":"GLS ShipIT - DeliverAtWork:floor","1021":"GLS ShipIT - DeliverAtWork:room","1022":"GLS ShipIT - DeliverAtWork:phoneNumber"};
const ADDRESS_OPTION_TYPE_MAP={"1":"VAT number (USt-IdNr.)","2":"External address ID (Externe Adress-ID)","3":"Entry certificate (Eintrittsnachweis)","4":"Telephone (Telefon)","5":"Email (E-Mail)","6":"Post number (Postnummer)","7":"Personal id (Personen-ID)","8":"BBFC (age rating)","9":"Birthday (Geburtstag)","10":"Session ID","11":"Title (Titel)","12":"Contact person (Ansprechpartner)","13":"External customer ID (Externe Kunden-ID)","100":"(custom typeId 100)","101":"(custom typeId 101)"};

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

// =========================
// LOCAL DB SEARCH (FAST)
// =========================

let __DB_READY = false;
let __DB_META = null;
let __HAY_FULL = null;   // string[]
let __HAY_NAME = null;   // string[]
let __ITEM_ID = null;    // number[]
let __NAME = null;       // string[]
let __DESC = null;       // string[]

function __normQueryToken(s) {
    // Muss zur Build-Normalisierung passen (Umlaute -> ae/oe/ue, ß -> ss)
    return String(s || "")
        .toLowerCase()
        .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Sicherheit für Akzente
        .trim();
}

function __ensureDbCache() {
    if (__DB_READY) return;

    const DB = (typeof self !== "undefined" && Array.isArray(self.TRADEO_ITEM_DB)) ? self.TRADEO_ITEM_DB : null;
    if (!DB || DB.length === 0) {
        __DB_READY = true;
        __HAY_FULL = [];
        __HAY_NAME = [];
        __ITEM_ID = [];
        __NAME = [];
        __DESC = [];
        __DB_META = (typeof self !== "undefined" ? self.TRADEO_ITEM_DB_META : null) || null;
        return;
    }

    __DB_META = (typeof self !== "undefined" ? self.TRADEO_ITEM_DB_META : null) || null;

    const n = DB.length;
    __HAY_FULL = new Array(n);
    __HAY_NAME = new Array(n);
    __ITEM_ID = new Array(n);
    __NAME = new Array(n);
    __DESC = new Array(n);

    for (let i = 0; i < n; i++) {
        const rec = DB[i] || {};
        const itemId = Number(rec.itemId ?? rec.id ?? rec.i);

        const name = String(rec.name ?? rec.n ?? "");
        const desc = String(rec.description ?? rec.d ?? "");

        // t ist idealerweise schon: name+desc, html stripped, lowercased, whitespace-normalized
        // Wenn t fehlt, bauen wir es einmalig aus name+desc.
        const t = String(rec.t ?? rec.text ?? "").trim();
        const hayFull = t ? t : __normQueryToken(name + "\n" + stripHtmlToText(desc)).replace(/\s+/g, " ");

        // Für mode:"name" wollen wir wirklich nur den Namen durchsuchen (wenn vorhanden)
        const hayName = name ? __normQueryToken(name).replace(/\s+/g, " ") : hayFull;

        __ITEM_ID[i] = itemId;
        __NAME[i] = name;
        __DESC[i] = desc;
        __HAY_FULL[i] = hayFull;
        __HAY_NAME[i] = hayName;
    }

    __DB_READY = true;
}

async function __mapLimit(arr, limit, fn) {
    const out = new Array(arr.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
        while (true) {
            const i = idx++;
            if (i >= arr.length) return;
            out[i] = await fn(arr[i], i);
        }
    });
    await Promise.all(workers);
    return out;
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
 * UPDATED: Stripping von Timestamps (Properties, Dates, Amounts) und shippedAt entfernt.
 */
async function fetchOrderDetails(orderId) {
    try {
        // 1. Hole Order mit Basis-Relationen + shippingPackages
        const orderData = await makePlentyCall(`/rest/orders/${orderId}?with[]=orderItems&with[]=relations&with[]=amounts&with[]=dates&with[]=addressRelations&with[]=shippingPackages`);
        
        if (!orderData) throw new Error("Order not found");

        const result = {
            meta: { type: "PLENTY_ORDER_FULL_EXPORT", orderId: orderId, timestamp: new Date().toISOString() },
            // Wird unten überschrieben durch bereinigte Version
            order: orderData,
            stocks: [],
            addresses: [],
            shippingInfo: {
                destinationCountry: "Unknown" 
                // shippedAt entfernt (Anforderung)
            }
        };

        // (Logik für shippedAt entfernt)

        // 2. Adressen auflösen & Zielland ermitteln
        if (orderData.addressRelations && orderData.addressRelations.length > 0) {
            const addressPromises = orderData.addressRelations.map(async (rel) => {
                try {
                    const addrDetail = await makePlentyCall(`/rest/accounts/addresses/${rel.addressId}`);
                    
                    // Prüfen ob dies die Lieferadresse ist (TypeId 2) -> Zielland bestimmen
                    if (rel.typeId === 2 && addrDetail) {
                        const cId = addrDetail.countryId;
                        result.shippingInfo.destinationCountry = COUNTRY_MAP[cId] || `Land-ID ${cId}`;
                    }

                    // --- ADDRESS STRIPPING ---
                    const { 
                        id, stateId, readOnly, checkedAt, createdAt, updatedAt, title, contactPerson, 
                        options, 
                        ...cleanAddr 
                    } = addrDetail;

                    // --- ADDRESS OPTIONS STRIPPING & MAPPING ---
                    const cleanOptions = (options || []).map(opt => ({
                        typeId: opt.typeId,
                        typeName: ADDRESS_OPTION_TYPE_MAP[String(opt.typeId)] || `Unknown (${opt.typeId})`,
                        value: opt.value
                    }));

                    return { 
                        relationType: rel.typeId === 1 ? "Billing/Rechnung" : (rel.typeId === 2 ? "Shipping/Lieferung" : "Other"),
                        ...cleanAddr,
                        options: cleanOptions
                    };
                } catch (e) {
                    return null;
                }
            });
            const loadedAddresses = await Promise.all(addressPromises);
            result.addresses = loadedAddresses.filter(a => a !== null);
        }

        // 3. Bestände holen & STRIPPEN
        if (orderData.orderItems) {
            const variationIds = orderData.orderItems
                .filter(item => item.typeId === 3 || item.typeId === 1) // Artikel & Variationen
                .map(item => item.itemVariationId);
            
            const uniqueVarIds = [...new Set(variationIds)];
            
            const stockPromises = uniqueVarIds.map(async (vid) => {
                try {
                    const stockData = await makePlentyCall(`/rest/stockmanagement/stock?variationId=${vid}&warehouseId=1`);
                    
                    let net = 0;
                    if (stockData && Array.isArray(stockData.entries) && stockData.entries.length > 0) {
                        net = parseFloat(stockData.entries[0].stockNet || 0);
                    }

                    return { variationId: vid, stockNet: net };
                } catch (e) {
                    return { variationId: vid, stockNet: 0, error: "Fetch Fail" };
                }
            });
            result.stocks = await Promise.all(stockPromises);
        }

        // --- 5. DATA STRIPPING (Rest der Order Daten) ---
        
        const removeOrderId = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const { orderId, ...rest } = obj;
            return rest;
        };

        const cleanList = (list) => (list || []).map(removeOrderId);

        // Spezielle Funktion für Amounts (entfernt orderId, createdAt, updatedAt auch in vats)
        const cleanAmountsList = (list) => (list || []).map(a => {
            const { orderId, createdAt, updatedAt, vats, ...rest } = a;
            
            const cleanVats = (vats || []).map(v => {
                const { orderAmountId, createdAt: ca, updatedAt: ua, ...vRest } = v;
                return vRest;
            });

            return { ...rest, vats: cleanVats };
        });

        // Relations: Filtert Warehouse raus UND entfernt orderId
        const cleanRelations = (orderData.relations || [])
            .filter(r => r.referenceType !== 'warehouse')
            .map(removeOrderId);

        // DATES Cleaner (Stripped createdAt, updatedAt)
        const cleanDates = (list) => (list || []).map(d => {
            const { orderId, typeId, createdAt, updatedAt, ...rest } = d;
            const newObj = { typeId, ...rest };
            const resolvedName = ORDER_DATE_TYPE_MAP[String(typeId)];
            if (resolvedName) newObj.typeName = resolvedName;
            return newObj;
        });

        // PROPERTIES Cleaner (Stripped createdAt, updatedAt)
        const cleanProperties = (list) => (list || []).reduce((acc, p) => {
            if (!p) return acc;
            if (p.typeId == 1) return acc; // TypeId 1 (Lager) ignorieren

            const { orderId, typeId, value, createdAt, updatedAt, ...rest } = p;
            const newObj = { typeId };
            const resolvedTypeName = ORDER_PROPERTY_TYPE_MAP[String(typeId)];
            if (resolvedTypeName) newObj.typeName = resolvedTypeName;

            if (typeId === 2) {
                const resolvedProfile = SHIPPING_PROFILES[String(value)];
                newObj.versandprofilName = resolvedProfile || `Unbekannt (ID: ${value})`;
            }
            if (typeId === 3) {
                const resolvedPayment = PAYMENTMETHOD_MAP[String(value)];
                if (resolvedPayment) newObj.paymentMethodName = resolvedPayment;
            }
            
            acc.push({ ...newObj, value, ...rest });
            return acc;
        }, []);


        // Items: MASSIVE REDUKTION (Original Logic)
        const cleanItems = (orderData.orderItems || []).map(item => {
            let cleanAmounts = (item.amounts || []).map(amt => ({
                purchasePrice: amt.purchasePrice,
                priceOriginalGross: amt.priceOriginalGross,
                priceOriginalNet: amt.priceOriginalNet,
                priceGross: amt.priceGross,
                priceNet: amt.priceNet,
                surcharge: amt.surcharge,
                discount: amt.discount
            }));

            cleanAmounts = cleanAmounts.filter(a => 
                (a.purchasePrice || 0) !== 0 ||
                (a.priceOriginalGross || 0) !== 0 ||
                (a.priceOriginalNet || 0) !== 0 ||
                (a.priceGross || 0) !== 0 ||
                (a.priceNet || 0) !== 0
            );

            return {
                itemVariationId: item.itemVariationId,
                quantity: item.quantity,
                orderItemName: item.orderItemName,
                amounts: cleanAmounts
            };
        });

        // SHIPPING PACKAGES Cleaner
        const cleanShippingPackages = (orderData.shippingPackages || []).map(p => ({
            weight: p.weight,
            packageNumber: p.packageNumber
        }));

        const cleanOrder = {
            id: orderData.id,
            statusName: orderData.statusName,
            statusId: orderData.statusId,
            typeId: orderData.typeId,
            lockStatus: orderData.lockStatus,
            createdAt: orderData.createdAt,
            updatedAt: orderData.updatedAt,
            ownerId: orderData.ownerId,
            relations: cleanRelations,
            properties: cleanProperties(orderData.properties), 
            dates: cleanDates(orderData.dates),             
            amounts: cleanAmountsList(orderData.amounts), // Neue Funktion genutzt
            orderReferences: cleanList(orderData.orderReferences),
            orderItems: cleanItems, 
            shippingPackages: cleanShippingPackages
        };

        result.order = cleanOrder;

        return result;

    } catch (error) {
        console.error("Fehler beim Holen der Full Order Details:", error);
        throw error;
    }
}

/**
 * Holt Kundendaten und die letzten Bestellungen (Stripped Version).
 * UPDATED: Erweitertes Contact-Objekt inkl. Blocked-Status, Rating, Login-Daten etc.
 * UPDATED: Wandelt classId in lesbaren className um.
 */
async function fetchCustomerDetails(contactId) {
    try {
        // 1. Stammdaten holen
        const contactData = await makePlentyCall(`/rest/accounts/contacts/${contactId}`);
        
        // 2. Letzte 5 Bestellungen holen (absteigend sortiert)
        const orderHistory = await makePlentyCall(`/rest/orders?contactId=${contactId}&itemsPerPage=5&sortBy=id&sortOrder=desc`);

        // --- HELPER: Order Typen Mapping ---
        const ORDER_TYPES = {
            1: "Auftrag (Order)",
            2: "Lieferauftrag (Delivery)",
            3: "Retoure (Return)",
            4: "Gutschrift (Credit Note)",
            5: "Gewährleistung (Warranty)",
            6: "Reparatur (Repair)",
            7: "Angebot (Offer)",
            8: "Vorbestellung (Advance Order)"
        };

        // --- DATA STRIPPING (Optimierung für AI Kontext) ---

        // A. Kontakt bereinigen (Erweitert um alle angeforderten Felder)
        // Mapping der Kundenklasse
        const rawClassId = contactData.classId;
        const resolvedClassName = CUSTOMER_CLASS_MAP[rawClassId] || `Unbekannt (ID: ${rawClassId})`;

        const cleanContact = {
            id: contactData.id,
            typeId: contactData.typeId, 
            firstName: contactData.firstName,
            lastName: contactData.lastName,
            gender: contactData.gender,
            title: contactData.title,
            formOfAddress: contactData.formOfAddress,
            
            // HIER IST DIE ÄNDERUNG: className statt classId
            className: resolvedClassName,

            blocked: contactData.blocked,
            rating: contactData.rating,
            bookAccount: contactData.bookAccount,
            lang: contactData.lang,
            referrerId: contactData.referrerId,
            userId: contactData.userId,
            
            // Zeitstempel & Status
            lastLoginAt: contactData.lastLoginAt,
            lastOrderAt: contactData.lastOrderAt,
            createdAt: contactData.createdAt,
            updatedAt: contactData.updatedAt,
            
            // Kontakt
            email: contactData.email,
            privatePhone: contactData.privatePhone,
            privateMobile: contactData.privateMobile,
            ebayName: contactData.ebayName,
            
            // Zahlungsziel (Root Level)
            timeForPaymentAllowedDays: contactData.timeForPaymentAllowedDays,

            // Accounts: Firmendaten & Finanzdaten
            accounts: (contactData.accounts || []).map(acc => ({
                id: acc.id,
                companyName: acc.companyName,
                taxIdNumber: acc.taxIdNumber,
                // Wir behalten die Finanzdaten drin, falls verfügbar, da sie für den Support wichtig sind
                dealerMinOrderValue: acc.dealerMinOrderValue, 
                valuta: acc.valuta, 
                timeForPaymentAllowedDays: acc.timeForPaymentAllowedDays, 
                deliveryTime: acc.deliveryTime
            }))
        };

        // B. Orders bereinigen (Erweitert um Finanzdaten & Typ)
        const cleanOrders = (orderHistory.entries || []).map(o => {
            // Beträge extrahieren (nehmen den ersten Amount-Eintrag, meist Systemwährung)
            const amt = (o.amounts && o.amounts.length > 0) ? o.amounts[0] : {};

            return {
                id: o.id,
                // Typ: ID und lesbarer Name
                typeId: o.typeId,
                typeName: ORDER_TYPES[o.typeId] || `Andere (ID: ${o.typeId})`,
                statusName: o.statusName,
                createdAt: o.createdAt,
                
                // Finanz-Details der Order
                invoiceTotal: amt.invoiceTotal || 0,
                paidAmount: amt.paidAmount || 0, // Wichtig um zu sehen ob bezahlt
                currency: amt.currency || "EUR",
                exchangeRate: amt.exchangeRate || 1,
                isNet: amt.isNet || false // Sagt uns ob Netto oder Brutto
            };
        });

        return {
            meta: { type: "PLENTY_CUSTOMER_EXPORT", timestamp: new Date().toISOString() },
            contact: cleanContact,
            recentOrders: cleanOrders
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
        const seenIds = new Set(); 

        // --- Helper: Response normalisieren ---
        const extractEntries = (res) => {
            if (!res) return [];
            if (Array.isArray(res)) return res;
            if (Array.isArray(res.entries)) return res.entries;
            if (Array.isArray(res.variations)) return res.variations;
            return [];
        };

        const addCandidates = (entries) => {
            for (const entry of entries || []) {
                if (!entry || typeof entry.id === "undefined") continue;
                if (!seenIds.has(entry.id)) {
                    seenIds.add(entry.id);
                    candidates.push(entry);
                }
            }
        };

        // --- Helper: Einheitliche Formatierung (Stripping) ---
        // Dies garantiert, dass Single-Match und Multi-Match exakt gleiche Strukturen liefern
        const formatItemData = (variation, item, stockEntries) => {
            // 1. Variation bereinigen
            const cleanVariation = {
                id: variation.id,
                itemId: variation.itemId,
                model: variation.model,
                purchasePrice: variation.purchasePrice,
                weightG: variation.weightG,
                weightNetG: variation.weightNetG,
                widthMM: variation.widthMM,
                lengthMM: variation.lengthMM,
                heightMM: variation.heightMM,
                customsTariffNumber: variation.customsTariffNumber
            };

            // 2. Item bereinigen & Country ID auflösen
            const countryName = COUNTRY_MAP[item.producingCountryId] || `Unknown (ID: ${item.producingCountryId})`;

            // HTML Cleaning anwenden (wie in searchItemsByText)
            const cleanTexts = (item.texts || []).map(t => ({
                name1: t.name1,
                // WICHTIG: HTML tags entfernen und in lesbaren Text wandeln
                description: stripHtmlToText(t.description),
                technicalData: stripHtmlToText(t.technicalData)
            }));

            const cleanItem = {
                id: item.id,
                producingCountry: countryName,
                texts: cleanTexts
            };

            // 3. Stock bereinigen
            const cleanStock = (stockEntries || []).map(s => ({
                itemId: s.itemId,
                // Fallback für verschiedene API Feldnamen (netStock vs stockNet)
                stockNet: (typeof s.stockNet !== 'undefined') ? s.stockNet : ((typeof s.netStock !== 'undefined') ? s.netStock : 0),
                variationId: s.variationId
            }));

            return {
                variation: cleanVariation,
                item: cleanItem,
                stock: cleanStock
            };
        };

        // --- Helper: Daten laden für einen Kandidaten ---
        const loadFullData = async (variation) => {
            const itemId = variation.itemId;
            const variationId = variation.id;

            // Wir holen Item & Stock (Warehouse 1 als Standard für Konsistenz)
            const [stockData, itemBaseData] = await Promise.all([
                makePlentyCall(`/rest/stockmanagement/stock?variationId=${variationId}&warehouseId=1`),
                makePlentyCall(`/rest/items/${itemId}`)
            ]);

            const stockEntries = extractEntries(stockData);
            return formatItemData(variation, itemBaseData, stockEntries);
        };

        const isNumeric = /^\d+$/.test(identifier);
        
        // --- SUCHE (Identisch zu vorher) ---
        // 1. Varianten-Suche (ID, ItemID, Number)
        const searchVariations = async (params, label) => {
            const qs = new URLSearchParams({ itemsPerPage: "50", isActive: "true", ...params }).toString();
            try {
                const res = await makePlentyCall(`/rest/items/variations?${qs}`);
                addCandidates(extractEntries(res));
            } catch (e) { console.warn(`Suche ${label} failed`, e); }
        };

        if (isNumeric) {
            await searchVariations({ id: identifier }, "id");
            if (!candidates.length) await searchVariations({ itemId: identifier }, "itemId");
            if (!candidates.length) await searchVariations({ numberExact: identifier }, "numberExact");
            if (!candidates.length) {
                // Fallback ID Path
                try {
                    const res = await makePlentyCall(`/rest/items/${identifier}/variations?isActive=true`);
                    addCandidates(extractEntries(res));
                    if (candidates.length) searchMethod = "itemId_path";
                } catch(e) {}
            }
            if (candidates.length > 0 && searchMethod === "unknown") searchMethod = "priority_numeric";
        }

        if (candidates.length === 0) {
            // Breite Suche
            const tasks = [
                searchVariations({ numberExact: identifier }, "numberExact"),
                searchVariations({ numberFuzzy: identifier }, "numberFuzzy"),
                searchVariations({ barcode: identifier }, "barcode"),
                searchVariations({ itemName: identifier }, "itemName"),
                searchVariations({ itemDescription: identifier }, "itemDescription"),
                searchVariations({ model: identifier }, "model"),
                searchVariations({ supplierNumber: identifier }, "supplierNumber"),
                searchVariations({ sku: identifier }, "sku")
            ];
            await Promise.all(tasks);
            if (candidates.length > 0) searchMethod = "broad_search";
        }

        // --- ERGEBNISSE VERARBEITEN ---

        if (candidates.length === 0) {
            throw new Error(`Artikel '${identifier}' nicht gefunden.`);
        }

        // CASE A: Single Match
        if (candidates.length === 1) {
            const data = await loadFullData(candidates[0]);
            return {
                meta: { type: "PLENTY_ITEM_EXPORT", timestamp: new Date().toISOString(), searchMethod },
                ...data // Spreadet variation, item, stock
            };
        }

        // CASE B: Multi Match (Ambiguous)
        // Wir laden für die Top 5 die Details und formatieren sie EXAKT wie beim Single Match
        const topCandidates = candidates.slice(0, 5);
        
        const detailedCandidates = await Promise.all(
            topCandidates.map(async (cand) => {
                try {
                    return await loadFullData(cand);
                } catch (e) {
                    return { error: "Details konnten nicht geladen werden", id: cand.id };
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
            candidates: detailedCandidates // Array von Objekten mit { variation, item, stock }
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

async function searchItemsByText(searchText, options = {}) {
    __ensureDbCache();

    // ---- Optionen / Modi parsen ----
    let mode = "nameAndDescription";
    let maxResults = 25;
    let onlyWithStock = true; // STANDARD: Nur Artikel mit Bestand anzeigen

    if (typeof options === "string") {
        mode = (options === "name") ? "name" : "nameAndDescription";
    } else if (options && typeof options === "object") {
        if (options.mode === "name") mode = "name";
        if (typeof options.maxResults === "number") maxResults = options.maxResults;
        // Expliziter Check auf Boolean, damit man es auch auf false setzen kann
        if (typeof options.onlyWithStock === "boolean") onlyWithStock = options.onlyWithStock;
    }
    
    // Safety Limits
    maxResults = Math.max(1, Math.min(50, Math.floor(maxResults)));

    const q = String(searchText || "").trim();
    if (!q) return { meta: { type: "EMPTY" }, results: [] };

    // 1) Tokens bilden + normalisieren
    let tokens = q.split(/\s+/)
        .map(__normQueryToken)
        .filter(t => t.length > 1);

    tokens = Array.from(new Set(tokens));

    if (tokens.length === 0) return { meta: { type: "EMPTY" }, results: [] };
    tokens.sort((a, b) => b.length - a.length);

    // 2) Reiner DB-Scan
    const hayArr = (mode === "name") ? __HAY_NAME : __HAY_FULL;
    const hits = [];
    
    for (let i = 0; i < hayArr.length; i++) {
        const hay = hayArr[i];
        if (!hay) continue;

        let ok = true;
        let score = 0;

        for (let k = 0; k < tokens.length; k++) {
            const tok = tokens[k];
            const pos = hay.indexOf(tok);
            if (pos === -1) { ok = false; break; }
            score += pos; 
        }
        if (!ok) continue;

        hits.push({ i, score });
    }

    if (hits.length === 0) {
        return {
            meta: {
                type: "PLENTY_ITEM_DB_SEARCH_FAST",
                dbSize: hayArr.length,
                mode,
                tokens,
                matchesFound: 0,
                returned: 0
            },
            results: []
        };
    }

    // 3) Sortieren nach Text-Relevanz (bester Score zuerst)
    hits.sort((a, b) => a.score - b.score);

    // 4) Filtering (Blacklist)
    const FORBIDDEN_TERMS = ["-upgrade", "hardware care pack", "-bundle", "cto:"];
    const validHits = hits.filter(hit => {
        const rawName = (__NAME[hit.i] || "").toLowerCase();
        return !FORBIDDEN_TERMS.some(term => rawName.includes(term));
    });

    // 5) Buffer-Logic:
    // Da wir gleich noch nach Bestand filtern wollen, müssen wir mehr Items anreichern,
    // als wir am Ende ausgeben wollen (sonst stehen wir mit leeren Händen da).
    // Wir nehmen Faktor 3, aber maximal 100 Items, um die API nicht zu sprengen.
    const bufferSize = Math.min(100, maxResults * 3);
    const topCandidates = validHits.slice(0, bufferSize);

    // 6) Enrichment: Daten holen (Stock & Price)
    const enrichOne = async (hit) => {
        const idx = hit.i;
        const itemId = __ITEM_ID[idx];
        const dbName = __NAME[idx];
        const dbDescHtml = __DESC[idx];

        try {
            const item = await makePlentyCall(`/rest/items/${itemId}?with=variations&lang=de`);
            const vars = Array.isArray(item?.variations) ? item.variations : [];
            
            // Beste Variante finden
            let v = vars.find(x => x?.isActive === true && x?.isMain === true)
                 || vars.find(x => x?.isActive === true)
                 || vars[0]
                 || null;

            const variationId = v?.id;
            const model = v?.model || "";

            let stockNet = 0;
            let price = "N/A";

            if (variationId) {
                const [stockRes, priceRes] = await Promise.all([
                    makePlentyCall(`/rest/items/${itemId}/variations/${variationId}/stock`).catch(() => []),
                    makePlentyCall(`/rest/items/${itemId}/variations/${variationId}/variation_sales_prices`).catch(() => [])
                ]);

                stockNet = (Array.isArray(stockRes) && stockRes[0] && (stockRes[0].netStock ?? stockRes[0].stockNet) != null)
                    ? parseFloat(stockRes[0].netStock ?? stockRes[0].stockNet)
                    : 0;

                price = (Array.isArray(priceRes) && priceRes[0] && priceRes[0].price != null)
                    ? priceRes[0].price
                    : "N/A";
            }

            const descText = stripHtmlToText(dbDescHtml);
            const lines = descText.split("\n").map(s => s.trim()).filter(Boolean);
            let name = (dbName || lines[0] || String(itemId)).replace(/^Beschreibung:\s*/i, "").trim();
            let description = (lines.length > 1) ? lines.slice(1).join("\n") : "";

            return {
                itemNumber: String(itemId),
                variationId: variationId,
                model,
                name,
                description,
                stockNet, // Ist jetzt garantiert number
                price
            };
        } catch (e) {
            console.warn("Enrich failed for Item " + itemId, e);
            return null;
        }
    };

    let results = await __mapLimit(topCandidates, 20, enrichOne);
    // Fehlerhafte Enrichments rausfiltern
    results = results.filter(r => r !== null);

    // 7) Filter: Nur Bestand? (Standard: JA)
    if (onlyWithStock) {
        results = results.filter(r => r.stockNet > 0);
    }

    // 8) Sortierung: Höchster Bestand zuerst!
    results.sort((a, b) => b.stockNet - a.stockNet);

    // 9) Finaler Cut auf gewünschte Anzahl
    results = results.slice(0, maxResults);

    return {
        meta: {
            type: "PLENTY_ITEM_DB_SEARCH_FAST",
            dbSize: hayArr.length,
            mode,
            tokens,
            matchesFound: hits.length, // Treffer im Textindex
            returned: results.length,  // Nach Filter & Limit
            sortedBy: "stockNet desc",
            onlyWithStock
        },
        results
    };
}
