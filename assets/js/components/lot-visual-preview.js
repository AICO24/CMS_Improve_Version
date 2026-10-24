/**
 * Lot Visual Preview & 3D Ground-Level Inspection Component
 * Provides interactive visual preview of cemetery plot archetypes,
 * subterranean vault cutaways, terrain elevation, flood-safety certification,
 * and walking proximity for booking and mapping workflows.
 */
(function(window) {
    'use strict';

    const LOT_ARCHETYPES = {
        lawn: {
            id: 'lawn',
            name: 'Standard Lawn Lot',
            badge: '3D Lawn Turf View',
            capacity: '2 Caskets (Double-Depth Vault) + 4 Urns',
            dimensions: '1.0m × 2.44m (Standard Plot)',
            priceTier: '₱35,000 – ₱75,000',
            materials: {
                surface: 'Diamond-Polished Black Granite or Solid Cast Bronze',
                structure: 'Class-A High-Density Reinforced Concrete Sub-Vault',
                drainage: 'Sub-base Coarse Gravel Bed with Zero-Water Retention Runoff'
            },
            monumentRule: 'Flush ground-level bronze plaque or polished granite marker',
            perpetualCare: 'Included (Year-round turf manicuring, edging, and grounds security)',
            intermentPrivilege: 'Tiered double-depth underground vault + 4 cremation urns',
            elevationDesc: '+1.5m Above Water Table (100% Certified Flood-Free)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="pvLawnSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="60%" stop-color="#bae6fd"/>
            <stop offset="100%" stop-color="#f0fdf4"/>
        </linearGradient>
        <linearGradient id="pvLawnGrass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#22c55e"/>
            <stop offset="40%" stop-color="#16a34a"/>
            <stop offset="100%" stop-color="#15803d"/>
        </linearGradient>
        <linearGradient id="pvBronzeMarker" x1="0%" y1="0%" x2="100%" y2="50%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="30%" stop-color="#eab308"/>
            <stop offset="70%" stop-color="#ca8a04"/>
            <stop offset="100%" stop-color="#854d0e"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="85" fill="url(#pvLawnSky)"/>
    <circle cx="295" cy="28" r="16" fill="#fef08a" opacity="0.9"/>
    <path d="M0,85 Q85,75 170,82 T340,78 L340,160 L0,160 Z" fill="url(#pvLawnGrass)"/>
    <!-- Manicured Surrounding Turf -->
    <polygon points="50,105 290,105 320,152 20,152" fill="#15803d" stroke="#166534" stroke-width="1.5"/>
    <!-- Granite Base Slab -->
    <polygon points="68,110 272,110 292,145 48,145" fill="#0f172a" stroke="#334155" stroke-width="1.2"/>
    <!-- Cast Bronze Inlay Marker -->
    <polygon points="80,114 260,114 276,141 64,141" fill="url(#pvBronzeMarker)" stroke="#78350f" stroke-width="1"/>
    <text x="170" y="126" fill="#451a03" font-size="8.5" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif" letter-spacing="1.5">PERPETUAL MEMORIAL LOT</text>
    <line x1="95" y1="130" x2="245" y2="130" stroke="#713f12" stroke-width="0.8"/>
    <text x="170" y="138" fill="#713f12" font-size="6.5" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">1.0m × 2.44m DOUBLE-DEPTH CONCRETE VAULT</text>
    <!-- Flower Tribute -->
    <circle cx="58" cy="128" r="5" fill="#e11d48"/>
    <circle cx="53" cy="132" r="4" fill="#fbbf24"/>
    <circle cx="62" cy="133" r="4.5" fill="#ffffff"/>
    <!-- Badge -->
    <rect x="12" y="10" width="160" height="22" rx="5" fill="rgba(15, 23, 42, 0.85)"/>
    <text x="92" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D LAWN LOT PERSPECTIVE</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="70" fill="#e0f2fe"/>
    <rect x="0" y="70" width="340" height="20" fill="#16a34a"/>
    <rect x="0" y="90" width="340" height="70" fill="#3b2416"/>
    <!-- Ground Marker -->
    <rect x="95" y="65" width="150" height="8" rx="2" fill="#0f172a"/>
    <rect x="105" y="67" width="130" height="4" fill="#ca8a04"/>
    <!-- Vault Tier 1 (Upper Casket) -->
    <rect x="70" y="95" width="200" height="26" rx="3" fill="#cbd5e1" stroke="#1e293b" stroke-width="1.5"/>
    <text x="170" y="112" fill="#0f172a" font-size="8.5" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">UPPER CASKET CHAMBER (Depth: 1.2m)</text>
    <!-- Vault Tier 2 (Lower Casket) -->
    <rect x="70" y="125" width="200" height="26" rx="3" fill="#94a3b8" stroke="#1e293b" stroke-width="1.5"/>
    <text x="170" y="142" fill="#0f172a" font-size="8.5" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">LOWER CASKET CHAMBER (Depth: 2.0m)</text>
    <!-- Urn Compartment -->
    <rect x="235" y="96" width="32" height="24" rx="2" fill="#047857"/>
    <text x="251" y="111" fill="#ffffff" font-size="6.5" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">4 URNS</text>
    <rect x="10" y="10" width="135" height="22" rx="5" fill="rgba(15, 23, 42, 0.8)"/>
    <text x="77" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">VAULT CROSS-SECTION</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="16" y="14" width="308" height="132" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <rect x="28" y="24" width="84" height="48" rx="4" fill="#15803d" stroke="#22c55e" stroke-width="1"/>
    <text x="70" y="52" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">BERMUDA TURF</text>
    <rect x="120" y="24" width="98" height="48" rx="4" fill="#090d16" stroke="#64748b" stroke-width="1"/>
    <text x="169" y="48" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">BLACK GRANITE</text>
    <text x="169" y="60" fill="#94a3b8" font-size="6.5" text-anchor="middle" font-family="Inter, sans-serif">Diamond Polished</text>
    <rect x="226" y="24" width="86" height="48" rx="4" fill="#ca8a04" stroke="#fef08a" stroke-width="1"/>
    <text x="269" y="52" fill="#451a03" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">CAST BRONZE</text>
    <line x1="28" y1="84" x2="312" y2="84" stroke="#334155" stroke-width="1"/>
    <text x="36" y="104" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Sub-Vault: High-Density Reinforced Pre-Cast Concrete (Class-A)</text>
    <text x="36" y="120" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Drainage: Sealed Gravity Dry-Well with Gravel Bed (Zero Water Retention)</text>
    <text x="36" y="136" fill="#10b981" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Elevation: Elevated Topography (+1.5m above water table, Certified Flood-Free)</text>
</svg>`
        },
        garden: {
            id: 'garden',
            name: 'Garden Memorial Lot',
            badge: '3D Garden Terrace View',
            capacity: '4–8 Caskets + 8–16 Urns (Family Cluster)',
            dimensions: '2.0m × 2.5m (2–4 Lots Cluster)',
            priceTier: '₱200,000 – ₱650,000',
            materials: {
                surface: 'Raised White Marble Curb (24") with Granite Meditation Bench',
                structure: 'Multi-Vault Reinforced Concrete Cluster Pod',
                drainage: 'Integrated French Drain with Natural Subsurface Runoff'
            },
            monumentRule: 'Raised marble or granite curb (up to 24") with landscaped floral bed',
            perpetualCare: 'Included (Hedge pruning, curb stone washing, and perpetual security)',
            intermentPrivilege: 'Multi-generational family cluster (4–8 caskets + 8–16 urns)',
            elevationDesc: '+1.8m Above Water Table (Terraced Ground, 100% Flood-Free)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="pvGardSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="60%" stop-color="#bae6fd"/>
            <stop offset="100%" stop-color="#f0fdf4"/>
        </linearGradient>
        <linearGradient id="pvMarbleCurb" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="50%" stop-color="#f1f5f9"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <linearGradient id="pvGraniteHead" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="85" fill="url(#pvGardSky)"/>
    <circle cx="45" cy="28" r="16" fill="#fef08a" opacity="0.9"/>
    <rect x="0" y="85" width="340" height="75" fill="#15803d"/>
    <!-- Shrubbery Backdrop -->
    <circle cx="50" cy="80" r="20" fill="#166534"/>
    <circle cx="85" cy="82" r="16" fill="#15803d"/>
    <circle cx="285" cy="80" r="20" fill="#166534"/>
    <circle cx="255" cy="82" r="16" fill="#15803d"/>
    <!-- Raised 3D Marble Curb -->
    <polygon points="55,96 285,96 315,148 25,148" fill="url(#pvMarbleCurb)" stroke="#94a3b8" stroke-width="1.5"/>
    <polygon points="65,100 275,100 300,142 40,142" fill="#16a34a"/>
    <!-- Upright Granite Monument -->
    <path d="M140,48 L200,48 L204,115 L136,115 Z" fill="url(#pvGraniteHead)" stroke="#0f172a" stroke-width="1.5"/>
    <rect x="146" y="86" width="48" height="18" rx="2" fill="#ca8a04"/>
    <text x="170" y="98" fill="#ffffff" font-size="7" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">GARDEN ESTATE</text>
    <!-- Marble Meditation Bench -->
    <ellipse cx="90" cy="126" rx="28" ry="9" fill="#f8fafc" stroke="#64748b" stroke-width="1.2"/>
    <text x="90" y="128" fill="#475569" font-size="6" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">BENCH</text>
    <!-- Flowers -->
    <circle cx="240" cy="122" r="6" fill="#f43f5e"/>
    <circle cx="250" cy="120" r="5" fill="#fbbf24"/>
    <circle cx="260" cy="124" r="6" fill="#a855f7"/>
    <rect x="12" y="10" width="165" height="22" rx="5" fill="rgba(15, 23, 42, 0.8)"/>
    <text x="94" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D GARDEN LOT VIEW</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="105" fill="#bae6fd"/>
    <rect x="0" y="105" width="340" height="55" fill="#15803d"/>
    <polygon points="75,135 265,135 285,152 55,152" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
    <rect x="75" y="125" width="190" height="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
    <path d="M135,42 L205,42 L210,125 L130,125 Z" fill="#334155" stroke="#0f172a" stroke-width="1.5"/>
    <rect x="10" y="10" width="135" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="77" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">RAISED MARBLE CURB</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="16" y="14" width="308" height="132" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <text x="36" y="44" fill="#ffffff" font-size="9" font-weight="800" font-family="Inter, sans-serif">GARDEN MEMORIAL ARCHITECTURE</text>
    <text x="36" y="68" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Curbing: 24" White Carrara Honed Marble Perimeter Border</text>
    <text x="36" y="86" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Memorial: Upright Impala Black Granite Family Headstone</text>
    <text x="36" y="104" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Crypt Capacity: 4–8 Double-Depth Underground Concrete Vaults</text>
    <text x="36" y="122" fill="#10b981" font-size="8.5" font-weight="700" font-family="Inter, sans-serif">✓ Elevation: +1.8m Terrace Grade (Certified Zero-Flood Risk)</text>
</svg>`
        },
        columbarium: {
            id: 'columbarium',
            name: 'Columbarium Wall Niche',
            badge: '3D Columbarium Niche View',
            capacity: '2–4 Cremains Urns per Niche',
            dimensions: '0.4m × 0.4m × 0.6m (Single Niche)',
            priceTier: '₱25,000 – ₱150,000',
            materials: {
                surface: 'Italian Carrara White Marble with Engraved Bronze Plaque',
                structure: 'Modular High-Strength Fire-Rated Vault Wall',
                drainage: 'Indoor Climate-Controlled Sanctuary (Dust & Moisture Sealed)'
            },
            monumentRule: 'Polished engraved brass plate with tempered glass/marble face',
            perpetualCare: 'Included (Sanctuary hall upkeep, lighting, air conditioning & care)',
            intermentPrivilege: 'Niche compartment for 2–4 cremains urns or ossuary transfers',
            elevationDesc: '+2.5m (Indoor Sanctuary Hall, 100% Weatherproof)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="25" y="16" width="290" height="128" rx="6" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <!-- Grid Cells -->
    <rect x="35" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="99" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="185" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="249" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <!-- Highlighted Active Niche -->
    <rect x="97" y="62" width="146" height="38" rx="4" fill="#047857" stroke="#10b981" stroke-width="2"/>
    <rect x="100" y="65" width="70" height="32" rx="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
    <rect x="106" y="72" width="58" height="18" rx="2" fill="#ca8a04"/>
    <text x="135" y="84" fill="#0f172a" font-size="7" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">NICHE VAULT</text>
    <!-- Interior Chamber with Urns -->
    <rect x="173" y="65" width="67" height="32" rx="2" fill="#064e3b"/>
    <path d="M188,75 Q193,73 198,75 L196,87 L190,87 Z" fill="#f59e0b" stroke="#78350f" stroke-width="0.5"/>
    <path d="M210,75 Q215,73 220,75 L218,87 L212,87 Z" fill="#f59e0b" stroke="#78350f" stroke-width="0.5"/>
    <text x="207" y="94" fill="#a7f3d0" font-size="5" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">DUAL URN CAPACITY</text>
    <rect x="12" y="10" width="165" height="22" rx="5" fill="rgba(15, 23, 42, 0.85)"/>
    <text x="94" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D NICHE VAULT VIEW</text>
</svg>`,
            blueprintSvg: null,
            materialsSvg: null
        }
    };

    /**
     * Determine lot archetype from lot object metadata
     */
    function getLotArchetype(lot) {
        if (!lot) return LOT_ARCHETYPES.lawn;
        const typeStr = String(lot.lot_type || lot.lot_type_name || '').toLowerCase();
        const numStr = String(lot.lot_number || '').toLowerCase();
        const notesStr = String(lot.location_notes || '').toLowerCase();
        const combined = `${typeStr} ${numStr} ${notesStr}`;

        if (combined.includes('columb') || combined.includes('niche') || combined.includes('ossuary') || combined.includes('cremat')) {
            return LOT_ARCHETYPES.columbarium;
        }
        if (combined.includes('garden') || combined.includes('monument') || combined.includes('curb') || combined.includes('terrace')) {
            return LOT_ARCHETYPES.garden;
        }
        return LOT_ARCHETYPES.lawn;
    }

    /**
     * Compute spatial accessibility metrics, walking distance from Gate 1, and flood safety
     */
    function getLotSpatialMetrics(lot) {
        if (!lot) {
            return {
                walkingDist: '~65 meters',
                walkingTime: '~1 min walk from Main Gate',
                terrainElev: '+1.5m (Elevated Flood-Free Ground)',
                parkingDist: 'Main Avenue Curb (~15m away)',
                pathwayCond: 'Paved Smooth Concrete Walkway',
                isFloodFree: true
            };
        }

        const typeStr = String(lot.lot_type || lot.lot_type_name || '').toLowerCase();
        const isColumb = typeStr.includes('columb') || typeStr.includes('niche');
        const isGarden = typeStr.includes('garden');

        if (isColumb) {
            return {
                walkingDist: '~40 meters',
                walkingTime: '< 1 min walk from Porte-Cochère',
                terrainElev: '+2.5m (Indoor Sanctuary Hall Ground Floor)',
                parkingDist: 'Sanctuary Parking Bay (~10m away)',
                pathwayCond: 'Climate-Controlled Step-Free Interior Ramp',
                isFloodFree: true
            };
        }
        if (isGarden) {
            return {
                walkingDist: '~90 meters',
                walkingTime: '~1.5 mins walk from Gate 1',
                terrainElev: '+1.8m (Elevated Garden Terrace, Flood-Safe)',
                parkingDist: 'Garden Cluster Turnaround (~20m away)',
                pathwayCond: 'Smooth Paved Footway with Low Curbs',
                isFloodFree: true
            };
        }

        return {
            walkingDist: '~65 meters',
            walkingTime: '~1 min walk from Main Gate',
            terrainElev: '+1.5m (Certified Flood-Free Raised Grade)',
            parkingDist: 'Main Avenue Curb (~15m away)',
            pathwayCond: 'Paved Continuous Concrete Walkway (PWD Accessible)',
            isFloodFree: true
        };
    }

    /**
     * Open standalone Lot Visual Preview Modal
     * Works seamlessly in booking-assistant, cemetery-map, and my-bookings
     */
    function openLotVisualPreviewModal(lot, onSelectCallback = null) {
        if (!lot) return;

        let modal = document.getElementById('lotVisualPreviewModal');
        if (!modal) {
            modal = createModalMarkup();
            document.body.appendChild(modal);
        }

        const archetype = getLotArchetype(lot);
        const spatial = getLotSpatialMetrics(lot);
        const lotNumber = lot.lot_number || `Lot #${lot.lot_id}`;
        const sectionName = lot.section_name || 'Standard Section';
        const blockName = lot.block_name || 'Block';
        const price = Number(lot.price || 0);

        // Populate modal data
        document.getElementById('pvLotNumber').textContent = lotNumber;
        document.getElementById('pvSectionBlock').textContent = `${sectionName} • ${blockName}`;
        document.getElementById('pvArchetypeName').textContent = archetype.name;
        document.getElementById('pvPriceVal').textContent = price > 0 ? `₱${price.toLocaleString()}` : 'Official Rate';
        document.getElementById('pvCapacityVal').textContent = archetype.capacity;
        document.getElementById('pvDimensionsVal').textContent = lot.dimensions || archetype.dimensions;
        document.getElementById('pvMaterialsVal').textContent = archetype.materials.surface;
        document.getElementById('pvElevationVal').textContent = spatial.terrainElev;
        document.getElementById('pvWalkingVal').textContent = `${spatial.walkingDist} (${spatial.walkingTime})`;
        document.getElementById('pvPathwayVal').textContent = spatial.pathwayCond;

        // Render graphic
        const stage = document.getElementById('pvGraphicStage');
        stage.innerHTML = archetype.svg;

        // Wire tabs
        const tabPerspective = document.getElementById('pvTabPerspective');
        const tabBlueprint = document.getElementById('pvTabBlueprint');
        const tabMaterials = document.getElementById('pvTabMaterials');

        function activateTab(btn, svgContent) {
            [tabPerspective, tabBlueprint, tabMaterials].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            stage.innerHTML = svgContent;
        }

        tabPerspective.onclick = () => activateTab(tabPerspective, archetype.svg);
        tabBlueprint.onclick = () => activateTab(tabBlueprint, archetype.blueprintSvg || archetype.svg);
        tabMaterials.onclick = () => activateTab(tabMaterials, archetype.materialsSvg || archetype.svg);

        // Select button
        const selectBtn = document.getElementById('pvSelectBtn');
        if (typeof onSelectCallback === 'function') {
            selectBtn.style.display = 'inline-flex';
            selectBtn.onclick = () => {
                closeLotVisualPreviewModal();
                onSelectCallback(lot);
            };
        } else {
            selectBtn.style.display = 'none';
        }

        // Deep-link to map
        const mapLink = document.getElementById('pvViewMapLink');
        if (mapLink) {
            mapLink.href = `cemetery-map.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lotNumber)}`;
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeLotVisualPreviewModal() {
        const modal = document.getElementById('lotVisualPreviewModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    function createModalMarkup() {
        const wrap = document.createElement('div');
        wrap.className = 'lot-picker-modal-overlay';
        wrap.id = 'lotVisualPreviewModal';
        wrap.style.display = 'none';
        wrap.style.zIndex = '100010';

        wrap.innerHTML = `
            <div class="lot-picker-dialog lot-visual-preview-dialog" role="dialog" aria-modal="true" style="max-width: 720px; width: 95%;">
                <div class="lot-picker-header" style="background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff; padding: 16px 22px;">
                    <div class="lot-picker-title">
                        <i class="fas fa-eye" style="color: #10b981;"></i>
                        <div>
                            <div style="font-weight: 700; font-size: 1.1rem; color: #fff;" id="pvLotNumber">Lot Preview</div>
                            <small style="color: #94a3b8; font-size: 0.78rem;" id="pvSectionBlock">Section &amp; Block</small>
                        </div>
                    </div>
                    <button type="button" class="btn-close-modal" id="pvCloseModalBtn" aria-label="Close preview" style="color: #fff; background: none; border: none; font-size: 1.4rem; cursor: pointer;">&times;</button>
                </div>
                <div class="lot-picker-body" style="padding: 20px; max-height: calc(85vh - 120px); overflow-y: auto;">
                    <!-- 3D Vector Stage -->
                    <div style="background: #0f172a; border-radius: 10px; overflow: hidden; border: 1px solid #334155; position: relative;">
                        <div style="display: flex; gap: 4px; padding: 8px 12px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid #1e293b;">
                            <button type="button" class="btn btn-xs btn-archetype-tab active" id="pvTabPerspective" style="font-size:0.75rem; padding:4px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-eye"></i> 3D Perspective</button>
                            <button type="button" class="btn btn-xs btn-archetype-tab" id="pvTabBlueprint" style="font-size:0.75rem; padding:4px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-layer-group"></i> Vault Blueprint</button>
                            <button type="button" class="btn btn-xs btn-archetype-tab" id="pvTabMaterials" style="font-size:0.75rem; padding:4px 10px; border-radius:6px; cursor:pointer;"><i class="fas fa-gem"></i> Materials</button>
                        </div>
                        <div id="pvGraphicStage" style="height: 190px; width: 100%;">
                            <!-- Dynamic SVG -->
                        </div>
                    </div>

                    <!-- Flood Safety & Certified Badge -->
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;">
                        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; background: #ecfdf5; color: #047857; font-size: 0.78rem; font-weight: 700; border: 1px solid #a7f3d0;">
                            <i class="fas fa-shield-halved"></i> 100% Certified Flood-Free Elevation
                        </span>
                        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; background: #f0fdf4; color: #166534; font-size: 0.78rem; font-weight: 600; border: 1px solid #bbf7d0;">
                            <i class="fas fa-road"></i> Direct Paved Pathway Access
                        </span>
                        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 0.78rem; font-weight: 600; border: 1px solid #bfdbfe;">
                            <i class="fas fa-wheelchair"></i> PWD Accessible
                        </span>
                    </div>

                    <!-- Key Specifications Grid -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px;">
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Lot Archetype</span>
                            <strong style="font-size: 0.92rem; color: #0f172a;" id="pvArchetypeName">—</strong>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Official Plot Price</span>
                            <strong style="font-size: 1rem; color: #059669;" id="pvPriceVal">—</strong>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Interment Capacity</span>
                            <strong style="font-size: 0.88rem; color: #0f172a;" id="pvCapacityVal">—</strong>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Plot Dimensions</span>
                            <strong style="font-size: 0.88rem; color: #0f172a;" id="pvDimensionsVal">—</strong>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Topography &amp; Elevation</span>
                            <strong style="font-size: 0.88rem; color: #047857;" id="pvElevationVal">—</strong>
                        </div>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Proximity to Main Gate</span>
                            <strong style="font-size: 0.88rem; color: #0f172a;" id="pvWalkingVal">—</strong>
                        </div>
                        <div style="grid-column: 1 / -1; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px;">
                            <span style="display: block; font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Materials &amp; Memorial Guidelines</span>
                            <strong style="font-size: 0.85rem; color: #334155;" id="pvMaterialsVal">—</strong>
                        </div>
                    </div>
                </div>
                <div style="background: #f1f5f9; padding: 14px 22px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0;">
                    <a href="#" target="_blank" id="pvViewMapLink" class="btn btn-secondary" style="font-size: 0.84rem; padding: 7px 14px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                        <i class="fas fa-map-location-dot"></i> View on Cemetery Map
                    </a>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn btn-secondary" id="pvCloseBtn" style="padding: 7px 16px;">Back</button>
                        <button type="button" class="btn btn-primary" id="pvSelectBtn" style="padding: 7px 18px; font-weight: 600;">
                            <i class="fas fa-check-circle"></i> Select This Lot
                        </button>
                    </div>
                </div>
            </div>
        `;

        wrap.querySelector('#pvCloseModalBtn').onclick = closeLotVisualPreviewModal;
        wrap.querySelector('#pvCloseBtn').onclick = closeLotVisualPreviewModal;
        wrap.onclick = (e) => {
            if (e.target === wrap) closeLotVisualPreviewModal();
        };

        return wrap;
    }

    // Expose API
    window.LotVisualPreview = {
        getArchetype: getLotArchetype,
        getSpatialMetrics: getLotSpatialMetrics,
        openPreviewModal: openLotVisualPreviewModal,
        closePreviewModal: closeLotVisualPreviewModal
    };

})(window);

