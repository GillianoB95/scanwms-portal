require('dotenv').config({ path: '../.env' });
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { lookupHs: lookupHsTable } = require('./hs-lookup');

// ── SUPABASE HUB LOOKUP ──────────────────────────────────────
const SUPABASE_URL = 'https://zsjvmiyqhyzjeuyzovqx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzanZtaXlxaHl6amV1eXpvdnF4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEyODE1MywiZXhwIjoyMDg5NzA0MTUzfQ.SNiX7pUtHCrrE8XbbeFVf_MQDBW4FohzwXzaSbF1sUs';

// Cache: active hub codes from Supabase (refreshed every 5 minutes)
let hubCodesCache = null;
let hubCodesCacheTime = 0;
const HUB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function fetchHubCodesFromSupabase() {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/rest/v1/hubs?select=code&active=eq.true`;
    const options = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const rows = JSON.parse(data);
          if (!Array.isArray(rows)) {
            console.error('Supabase hub fetch: unexpected response', data.slice(0, 200));
            return reject(new Error('Unexpected Supabase response'));
          }
          const codes = new Set(rows.map(r => r.code).filter(Boolean));
          resolve(codes);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getActiveHubCodes() {
  const now = Date.now();
  if (hubCodesCache && (now - hubCodesCacheTime) < HUB_CACHE_TTL_MS) {
    return hubCodesCache;
  }
  try {
    const codes = await fetchHubCodesFromSupabase();
    hubCodesCache = codes;
    hubCodesCacheTime = now;
    console.log(`Hub codes refreshed from Supabase: [${[...codes].join(', ')}]`);
    return codes;
  } catch(e) {
    console.error('Failed to fetch hub codes from Supabase:', e.message);
    // Fallback to cache if available, else use hardcoded fallback
    if (hubCodesCache) {
      console.warn('Using stale hub code cache as fallback');
      return hubCodesCache;
    }
    const fallback = new Set(['UPS-NL', 'O-UPS-NL', 'DHL-DE', 'O-DHL-DE', 'DPD-DE', 'O-DPD-DE', 'DPD-NL', 'FedEx-NL', 'DPD-BE', 'DPD-FR', 'DHL-NL']);
    console.warn('Using hardcoded fallback hub codes');
    return fallback;
  }
}

// Pre-warm the hub code cache on startup
getActiveHubCodes().catch(() => {});

// Load pre-generated names pool
let NAMES_POOL = {};
let namesUsedIndex = {};
try {
  NAMES_POOL = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'names-pool.json'), 'utf8'));
  console.log(`Loaded names pool: ${Object.values(NAMES_POOL).reduce((s,a)=>s+a.length,0)} names`);
} catch(e) { console.log('Names pool not found, will use AI for names'); }

// Auto-learn: add good receiver names from manifests to the pool
function learnNamesFromRows(rows) {
  let added = 0;
  rows.forEach(row => {
    const name = String(row[4] || '').trim();
    const address = String(row[7] || '').trim();
    const city = String(row[8] || '').trim();
    const zipcode = String(row[10] || '').trim();
    const country = String(row[11] || '').trim().toUpperCase();

    // Only learn if: real name, real address, valid country, not a company
    if (!name || !address || !city || !zipcode || !country) return;
    if (name.length < 5 || !name.includes(' ')) return;
    if (isCompanyName(name)) return;
    if (/^\d/.test(name)) return;
    if (!NAMES_POOL[country]) NAMES_POOL[country] = [];

    // Check not already in pool
    const exists = NAMES_POOL[country].some(e => 
      e.name.toLowerCase() === name.toLowerCase() || 
      e.address.toLowerCase() === address.toLowerCase()
    );
    if (!exists) {
      NAMES_POOL[country].push({ name, address, city, zipcode, country });
      added++;
    }
  });

  if (added > 0) {
    try {
      fs.writeFileSync(path.join(__dirname, 'names-pool.json'), JSON.stringify(NAMES_POOL, null, 2));
      console.log(`Auto-learned ${added} new names into pool (total: ${Object.values(NAMES_POOL).reduce((s,a)=>s+a.length,0)})`);
    } catch(e) { console.error('Failed to save names pool:', e.message); }
  }
}

// Postcode validation patterns
const ZIP_PATTERNS = {
  'AT':/^\d{4}$/, 'BE':/^\d{4}$/, 'BG':/^\d{4}$/, 'CZ':/^\d{3}\s?\d{2}$/,
  'DK':/^\d{4}$/, 'EE':/^\d{5}$/, 'FI':/^\d{5}$/, 'FR':/^\d{5}$/,
  'DE':/^\d{5}$/, 'GR':/^\d{3}\s?\d{2}$/, 'HR':/^\d{5}$/, 'HU':/^\d{4}$/,
  'IE':/^[A-Z]\d{2}\s?[A-Z\d]{4}$/i, 'IT':/^\d{5}$/, 'LT':/^(LT-?)?\d{5}$/i,
  'LU':/^(L-?)?\d{4}$/i, 'LV':/^(LV-?)?\d{4}$/i, 'MT':/^\d{4}$/,
  'PL':/^\d{2}-\d{3}$/, 'PT':/^\d{4}-\d{3}$/, 'RO':/^\d{6}$/,
  'SE':/^\d{3}\s?\d{2}$/, 'SI':/^\d{4}$/, 'SK':/^\d{3}\s?\d{2}$/,
  'ES':/^\d{5}$/, 'NL':/^\d{4}\s?[A-Z]{2}$/i, 'CY':/^\d{4}$/,
};

function isValidZip(zipcode, country) {
  const pattern = ZIP_PATTERNS[country];
  if (!pattern) return true; // unknown country — skip validation
  return pattern.test(String(zipcode || '').trim());
}

// Simple European name check — must have at least 2 parts, no numbers, reasonable chars
function isEuropeanName(name) {
  if (!name || name.length < 4) return false;
  if (/\d/.test(name)) return false; // no numbers in name
  if (name.split(/\s+/).length < 2) return false; // needs first + last name
  if (/[^\u0000-\u024F\s'-]/.test(name)) return false; // only Latin/extended Latin chars
  return true;
}

function getNameFromPool(country, usedAddresses) {
  const pool = NAMES_POOL[country] || [];
  if (!pool.length) return null;
  if (!namesUsedIndex[country]) namesUsedIndex[country] = 0;
  
  // Find next valid unused entry
  let attempts = 0;
  while (attempts < pool.length) {
    const idx = namesUsedIndex[country] % pool.length;
    namesUsedIndex[country]++;
    const entry = pool[idx];
    const addr = `${entry.address}, ${entry.city}`.toLowerCase();
    
    // Skip if: already used, invalid postcode, or non-European name
    if (usedAddresses.has(addr)) { attempts++; continue; }
    if (!isValidZip(entry.zipcode, country)) { attempts++; continue; }
    if (!isEuropeanName(entry.name)) { attempts++; continue; }
    
    return entry;
  }
  // Fallback — reset index and return first valid
  namesUsedIndex[country] = 0;
  return pool.find(e => isValidZip(e.zipcode, country) && isEuropeanName(e.name)) || null;
}

// Path to auto-learned HS codes
const LEARNED_PATH = path.join(__dirname, 'learned-hs.json');

// Load learned HS codes (persisted across restarts)
let learnedHs = {};
try {
  if (fs.existsSync(LEARNED_PATH)) {
    learnedHs = JSON.parse(fs.readFileSync(LEARNED_PATH, 'utf8'));
    console.log(`Loaded ${Object.keys(learnedHs).length} learned HS codes`);
  }
} catch(e) { console.error('Failed to load learned-hs.json:', e.message); }

// Look up HS: check hard-coded table first, then learned cache
function lookupHs(description) {
  if (!description) return null;
  // Hard-coded table always wins
  const tableHs = lookupHsTable(description);
  if (tableHs) return tableHs;
  // Check learned cache (exact match, case-insensitive)
  const lower = description.toLowerCase().trim();
  return learnedHs[lower] || null;
}

// Validate AI-classified products using a second GPT-4o call as a cross-checker
async function validateAndLearn(aiMap) {
  if (Object.keys(aiMap).length === 0) return aiMap;

  const items = Object.entries(aiMap).map(([origDesc, result], i) => ({
    index: i,
    originalDescription: origDesc,
    suggestedDescription: result.description,
    suggestedHscode: result.hscode
  }));

  const prompt = `You are a senior EU customs auditor cross-checking AI-generated product classifications.

For each item, verify:
1. Is the suggested description specific and customs-compliant? (no vague terms)
2. Is the 10-digit EU CN HS code correct for that product?

If correct → return as-is.
If wrong → provide the correct description and HS code.

Return a JSON object with an "items" array:
{"items":[{"index":0,"description":"Correct description","hscode":"correct10digits","corrected":false}]}

Items to validate:
${JSON.stringify(items)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an EU customs auditor. Always respond with a JSON object with an "items" array.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const arr = Array.isArray(parsed.items) ? parsed.items :
      Object.values(parsed).find(v => Array.isArray(v)) || [];

    const validatedMap = { ...aiMap };
    let correctedCount = 0;

    arr.forEach((v, fallbackIdx) => {
      const idx = v.index !== undefined ? v.index : fallbackIdx;
      const origDesc = items[idx]?.originalDescription;
      if (!origDesc) return;

      const finalDesc = v.description || aiMap[origDesc].description;
      const finalHs = normalizeHsCode(v.hscode) || aiMap[origDesc].hscode;

      if (v.corrected) {
        console.log(`  Validator corrected: "${origDesc}" → desc:"${finalDesc}" hs:${finalHs}`);
        correctedCount++;
      }

      validatedMap[origDesc] = { description: finalDesc, hscode: finalHs };
    });

    console.log(`Validator: ${arr.length} checked, ${correctedCount} corrected`);

    // Save validated results to learned cache
    let newEntries = 0;
    Object.entries(validatedMap).forEach(([origDesc, result]) => {
      const key = origDesc.toLowerCase().trim();
      if (!learnedHs[key] && result.hscode && result.hscode.length === 10) {
        learnedHs[key] = result.hscode;
        newEntries++;
      }
    });
    if (newEntries > 0) {
      fs.writeFileSync(LEARNED_PATH, JSON.stringify(learnedHs, null, 2));
      console.log(`Auto-learned ${newEntries} validated HS codes (total: ${Object.keys(learnedHs).length})`);
    }

    return validatedMap;
  } catch(e) {
    console.error('Validator failed, using unvalidated AI results:', e.message);
    // Fallback: save unvalidated but still learn them
    let newEntries = 0;
    Object.entries(aiMap).forEach(([origDesc, result]) => {
      const key = origDesc.toLowerCase().trim();
      if (!learnedHs[key] && result.hscode && result.hscode.length === 10) {
        learnedHs[key] = result.hscode;
        newEntries++;
      }
    });
    if (newEntries > 0) {
      fs.writeFileSync(LEARNED_PATH, JSON.stringify(learnedHs, null, 2));
    }
    return aiMap;
  }
}

// Realistic China export/factory price ranges (EUR) per unit
// Used to detect and correct overvalued declared prices
const PRICE_GUIDE = {
  // Clothing
  'cotton t-shirt': [3, 8], 'men\'s t-shirts': [3, 8], 'women\'s cotton t-shirt': [3, 8],
  'men\'s cotton t-shirt': [3, 8], 'cotton shirt': [5, 12], 'cotton shorts': [3, 8],
  'men\'s shorts': [3, 8], 'men\'s cotton pants': [5, 12], 'men\'s pants': [5, 12],
  'athletic wear': [5, 12], 'men\'s clothing': [4, 12], 'women\'s clothing': [4, 12],
  'children\'s clothing': [3, 10], 'casual clothing': [4, 12], 'wool sweater': [8, 20],
  'knitted sweater': [8, 20], 'women\'s coat': [12, 35], 'polyester pajamas': [5, 12],
  'children\'s jacket': [8, 20],
  // Footwear
  'leather shoes': [15, 40], 'men\'s shoes': [12, 35], 'women\'s shoes': [12, 35],
  'sports footwear': [12, 30], 'basketball sneakers': [15, 35], 'basketball shoes': [15, 35],
  'sports shoes': [12, 30],
  // Bags & accessories
  'leather handbag': [20, 60], 'leather bag': [15, 50], 'leather trunk': [20, 60],
  'leather belt': [5, 15], 'travel bag': [10, 30], 'luggage case': [20, 50],
  'luggage box': [20, 50], 'luggage rack': [5, 15], 'plastic luggage rack': [5, 15],
  'white makeup bag': [1, 5], 'storage pouch': [0.5, 3], 'printed phone bag': [1, 5],
  'printed phone pouch': [1, 5], 'mini keychain': [0.5, 2],
  // Jewelry & accessories
  'fashion jewelry': [1, 5], 'plastic jewelry': [0.5, 3], 'metal hairpin': [0.5, 3],
  'hairpin accessory': [0.5, 3], 'plastic sunglasses': [1, 5], 'sunglasses, plastic frame': [1, 5],
  'wristband': [0.5, 3], 'hats and caps': [2, 8], 'plastic hats': [1, 6],
  // Electronics
  'wireless headset': [8, 25], 'digital projector': [30, 80], 'multimedia projector': [30, 80],
  'car radio receiver': [15, 40], 'car radio': [15, 40], 'digital voice recorder': [10, 30],
  'digital timer': [2, 8], 'power adapter': [3, 10], 'charger for devices': [3, 8],
  'electrical adapter': [3, 10], 'beauty device': [10, 35], 'ultrasonic humidifier': [8, 20],
  'led flashlight': [2, 8], 'plastic microphone': [3, 10], 'vacuum sealer': [10, 25],
  // Home & household
  'microfiber mop cloth': [1, 4], 'mop cleaning cloth': [1, 4], 'rubber mouse pad': [1, 4],
  'plastic mouse pad': [1, 4], 'plastic cup': [0.5, 2], 'glass container': [1, 5],
  'plastic bucket': [1, 4], 'plastic flowerpot': [1, 5], 'plastic frame': [1, 5],
  'plastic photo frame': [0.5, 3], 'plastic collecting basket': [1, 4],
  'wooden coat hanger': [0.5, 2], 'fabric seat cover': [5, 15], 'plastic curtain rail': [1, 5],
  'cardboard gift box': [0.5, 3], 'decorative cardboard box': [0.5, 3],
  'decorative gift box': [0.5, 3], 'sunshade net': [2, 8], 'plastic foot basin': [2, 8],
  'glass water tank': [5, 20], 'water tank': [5, 20], 'wool blanket': [8, 20],
  'polyester pillow': [3, 8], 'thermal printing paper': [1, 5], 'thermal paper roll': [1, 5],
  'kitchen grater': [1, 5], 'bottle scrubber': [0.5, 3], 'plastic key tool': [0.5, 2],
  'engine guard cover': [5, 20], 'brass water tap': [3, 15], 'wooden musical instruments': [5, 20],
  'metal mounting bracket': [1, 5], 'mechanical retarder': [3, 15], 'plastic pole': [1, 5],
  'climbing rope': [3, 10], 'electric bread machine': [15, 40],
  // Watches & accessories
  'wrist watch': [8, 40], 'watch storage box': [2, 8], 'leather watch box': [2, 8],
  // Sports & fitness
  'plastic massage ball': [1, 5], 'massage ball': [1, 5], 'abdominal wheel': [3, 8],
  'fitness resistance stick': [2, 8], 'car air outlet': [1, 5], 'plastic central lock': [2, 8],
  // Toys & misc
  'plastic toys': [1, 10], 'ceramic doll': [3, 12], 'plastic doll, non-porcelain': [1, 6],
  'scale model car': [3, 15], 'painting album': [2, 8], 'pet wheelchair': [15, 50],
  'pet nail clippers': [1, 5], 'ball picker tool': [2, 8], 'mobile phone holder, plastic': [1, 5],
  'plastic mobile phone holder': [1, 5], 'mobile phone case': [1, 5],
};

function getPriceRange(description) {
  if (!description) return null;
  const key = description.toLowerCase().trim();
  for (const [k, v] of Object.entries(PRICE_GUIDE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

// Realistic per-unit weights in kg (China export)
const WEIGHT_GUIDE = {
  'cotton t-shirt': [0.15, 0.35], 'men\'s t-shirts': [0.15, 0.35], 'women\'s cotton t-shirt': [0.15, 0.35],
  'men\'s cotton t-shirt': [0.15, 0.35], 'cotton shirt': [0.2, 0.4], 'cotton shorts': [0.15, 0.3],
  'men\'s shorts': [0.15, 0.3], 'men\'s cotton pants': [0.3, 0.6], 'men\'s pants': [0.3, 0.6],
  'athletic wear': [0.2, 0.5], 'men\'s clothing': [0.2, 0.6], 'women\'s clothing': [0.2, 0.6],
  'children\'s clothing': [0.15, 0.5], 'casual clothing': [0.2, 0.6], 'wool sweater': [0.4, 0.8],
  'knitted sweater': [0.4, 0.8], 'women\'s coat': [0.6, 1.5], 'polyester pajamas': [0.25, 0.5],
  'children\'s jacket': [0.3, 0.7],
  'leather shoes': [0.6, 1.2], 'men\'s shoes': [0.6, 1.2], 'women\'s shoes': [0.4, 0.9],
  'sports footwear': [0.5, 1.0], 'basketball sneakers': [0.6, 1.2], 'basketball shoes': [0.6, 1.2],
  'sports shoes': [0.5, 1.0],
  'leather handbag': [0.4, 1.2], 'leather bag': [0.4, 1.5], 'leather trunk': [3.0, 6.0],
  'leather belt': [0.1, 0.3], 'travel bag': [0.8, 2.0], 'luggage case': [2.0, 4.5],
  'luggage box': [2.0, 4.5], 'luggage rack': [0.5, 1.5], 'plastic luggage rack': [0.5, 1.5],
  'white makeup bag': [0.05, 0.2], 'storage pouch': [0.03, 0.15], 'printed phone bag': [0.05, 0.15],
  'printed phone pouch': [0.05, 0.15], 'mini keychain': [0.02, 0.08],
  'fashion jewelry': [0.02, 0.15], 'plastic jewelry': [0.02, 0.1], 'metal hairpin': [0.01, 0.05],
  'hairpin accessory': [0.01, 0.05], 'plastic sunglasses': [0.02, 0.05], 'sunglasses, plastic frame': [0.02, 0.05],
  'wristband': [0.01, 0.05], 'hats and caps': [0.1, 0.3], 'plastic hats': [0.1, 0.3],
  'wireless headset': [0.15, 0.5], 'digital projector': [1.5, 3.5], 'multimedia projector': [1.5, 3.5],
  'car radio receiver': [0.5, 1.5], 'car radio': [0.5, 1.5], 'digital voice recorder': [0.05, 0.2],
  'digital timer': [0.05, 0.2], 'power adapter': [0.1, 0.4], 'charger for devices': [0.1, 0.35],
  'electrical adapter': [0.1, 0.4], 'beauty device': [0.2, 0.8], 'ultrasonic humidifier': [0.4, 1.2],
  'led flashlight': [0.1, 0.4], 'plastic microphone': [0.1, 0.3], 'vacuum sealer': [0.8, 2.0],
  'microfiber mop cloth': [0.1, 0.3], 'mop cleaning cloth': [0.1, 0.3], 'rubber mouse pad': [0.1, 0.3],
  'plastic mouse pad': [0.1, 0.3], 'plastic cup': [0.05, 0.2], 'glass container': [0.2, 0.8],
  'plastic bucket': [0.4, 1.2], 'plastic flowerpot': [0.2, 0.8], 'plastic frame': [0.1, 0.5],
  'plastic photo frame': [0.05, 0.3], 'plastic collecting basket': [0.2, 0.8],
  'wooden coat hanger': [0.05, 0.2], 'fabric seat cover': [0.3, 1.0], 'plastic curtain rail': [0.2, 0.8],
  'cardboard gift box': [0.1, 0.5], 'decorative cardboard box': [0.1, 0.5],
  'decorative gift box': [0.1, 0.5], 'sunshade net': [0.3, 1.0], 'plastic foot basin': [0.5, 1.5],
  'glass water tank': [1.5, 4.0], 'water tank': [1.0, 3.5], 'wool blanket': [0.5, 1.5],
  'polyester pillow': [0.3, 0.8], 'thermal printing paper': [0.3, 0.8], 'thermal paper roll': [0.3, 0.8],
  'kitchen grater': [0.1, 0.4], 'bottle scrubber': [0.05, 0.2], 'plastic key tool': [0.02, 0.1],
  'engine guard cover': [0.5, 2.0], 'brass water tap': [0.3, 1.0], 'wooden musical instruments': [0.3, 1.5],
  'metal mounting bracket': [0.1, 0.5], 'mechanical retarder': [0.3, 1.5], 'plastic pole': [0.2, 1.0],
  'climbing rope': [0.5, 1.5], 'electric bread machine': [3.0, 6.0],
  'wrist watch': [0.05, 0.2], 'watch storage box': [0.1, 0.4], 'leather watch box': [0.1, 0.4],
  'plastic massage ball': [0.1, 0.4], 'massage ball': [0.1, 0.4], 'abdominal wheel': [0.5, 1.2],
  'fitness resistance stick': [0.2, 0.8], 'car air outlet': [0.05, 0.2], 'plastic central lock': [0.1, 0.5],
  'plastic toys': [0.1, 0.8], 'ceramic doll': [0.3, 1.0], 'plastic doll, non-porcelain': [0.1, 0.5],
  'scale model car': [0.2, 0.8], 'painting album': [0.3, 1.0], 'pet wheelchair': [1.0, 3.0],
  'pet nail clippers': [0.05, 0.15], 'ball picker tool': [0.2, 0.8], 'mobile phone holder, plastic': [0.05, 0.2],
  'plastic mobile phone holder': [0.05, 0.2], 'mobile phone case': [0.02, 0.1],
  // Kitchen appliances
  'electric kettle': [0.8, 1.8], 'plastic kettle': [0.5, 1.2], 'kettle': [0.8, 1.8],
  'toaster': [0.8, 1.5], 'blender': [1.0, 2.5],
  'dinner plate': [0.3, 0.6], 'plastic dinner plate': [0.1, 0.3],
  // Sports & outdoor
  'yoga mat': [0.8, 1.5], 'foam yoga mat': [0.8, 1.5], 'surfboard': [2.0, 5.0],
  'camping tent': [3.0, 8.0], 'canopy': [5.0, 12.0], 'outdoor canopy tent': [5.0, 12.0],
  'decorative cushion': [0.3, 0.8], 'cushion': [0.3, 0.8],
  // Belts & textiles
  'woven belt': [0.05, 0.15], 'woven fabric belt': [0.05, 0.15], 'woven textile belt': [0.05, 0.15],
  'curtains': [0.5, 1.5], 'window curtains': [0.5, 1.5],
  'fabric storage bag': [0.1, 0.5], 'plastic storage bag': [0.05, 0.3],
  // Electronics & lighting
  'led lamp': [0.2, 0.8], 'led table lamp': [0.3, 1.0], 'electric lamp': [0.3, 1.0],
  'power inverter': [1.0, 3.0], 'dc to ac inverter': [1.0, 3.0], 'microphone': [0.1, 0.5],
  // Home & misc
  'massage device': [0.5, 2.0], 'massage instrument': [0.5, 2.0],
  'protective shield': [0.3, 1.0], 'plastic shield': [0.3, 1.0],
  'plastic storage box': [0.3, 1.2], 'plastic casters': [0.2, 0.8],
  'display board': [0.5, 2.0], 'writing board': [0.5, 2.0],
  'glass wall mirror': [1.5, 5.0],
};

function getWeightRange(description) {
  if (!description) return null;
  const key = description.toLowerCase().trim();
  for (const [k, v] of Object.entries(WEIGHT_GUIDE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

// Returns a realistic target weight for a row (total weight for all qty)
function getRealisticTotalWeight(description, qty, currentTotal) {
  const range = getWeightRange(description);
  if (!range) return currentTotal; // unknown — keep as is
  const [min, max] = range;
  const unitW = currentTotal / qty;
  if (unitW > max * 2) return max * qty;   // too heavy — use max
  if (unitW < min * 0.4) return min * qty; // too light — use min
  return currentTotal; // OK — keep as is
}

function correctPrice(description, unitPrice) {
  const range = getPriceRange(description);
  if (!range) return { corrected: false, price: unitPrice };
  const [min, max] = range;
  if (unitPrice > max * 1.5) {
    // Overvalued — cap at max of realistic range
    return { corrected: true, price: max };
  }
  if (unitPrice < min * 0.7) {
    // Undervalued — raise to min of realistic range
    return { corrected: true, price: min };
  }
  // OK — leave as is
  return { corrected: false, price: unitPrice };
}

const app = express();
const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CORS — allow all origins for Railway deployment
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static('public'));

// Zipcode format patterns per country code
const ZIPCODE_PATTERNS = {
  'AT': { pattern: /^\d{4}$/, example: '1010', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'BE': { pattern: /^\d{4}$/, example: '1000', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'BG': { pattern: /^\d{4}$/, example: '1000', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'CH': { pattern: /^\d{4}$/, example: '8001', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'CY': { pattern: /^\d{4}$/, example: '1010', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'CZ': { pattern: /^\d{3}\s?\d{2}$/, example: '110 00', fix: s => { const d = s.replace(/\D/g,'').slice(0,5); return d.slice(0,3)+' '+d.slice(3); } },
  'DE': { pattern: /^\d{5}$/, example: '10115', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'DK': { pattern: /^\d{4}$/, example: '1000', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'EE': { pattern: /^\d{5}$/, example: '10111', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'ES': { pattern: /^\d{5}$/, example: '28001', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'FI': { pattern: /^\d{5}$/, example: '00100', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'FR': { pattern: /^\d{5}$/, example: '75001', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'GB': { pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, example: 'SW1A 1AA', fix: s => s.trim().toUpperCase() },
  'GR': { pattern: /^\d{3}\s?\d{2}$/, example: '105 57', fix: s => { const d = s.replace(/\D/g,'').slice(0,5); return d.slice(0,3)+' '+d.slice(3); } },
  'HR': { pattern: /^\d{5}$/, example: '10000', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'HU': { pattern: /^\d{4}$/, example: '1011', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'IE': { pattern: /^[A-Z]\d{2}\s?[A-Z\d]{4}$/i, example: 'D01 F5P2', fix: s => s.trim().toUpperCase() },
  'IT': { pattern: /^\d{5}$/, example: '00100', fix: s => s.replace(/\D/g,'').slice(0,5) },
  'LT': { pattern: /^LT-?\d{5}$/i, example: 'LT-01001', fix: s => 'LT-' + s.replace(/\D/g,'').slice(0,5) },
  'LU': { pattern: /^L?-?\d{4}$/i, example: 'L-1111', fix: s => 'L-' + s.replace(/\D/g,'').slice(0,4) },
  'LV': { pattern: /^LV-?\d{4}$/i, example: 'LV-1050', fix: s => 'LV-' + s.replace(/\D/g,'').slice(0,4) },
  'MT': { pattern: /^[A-Z]{3}\s?\d{4}$/i, example: 'VLT 1117', fix: s => s.trim().toUpperCase() },
  'NL': { pattern: /^\d{4}\s?[A-Z]{2}$/i, example: '1011 AB', fix: s => { const d = s.replace(/\s/g,''); return d.slice(0,4)+' '+d.slice(4,6).toUpperCase(); } },
  'NO': { pattern: /^\d{4}$/, example: '0150', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'PL': { pattern: /^\d{2}-\d{3}$/, example: '00-001', fix: s => { const d = s.replace(/\D/g,'').slice(0,5); return d.slice(0,2)+'-'+d.slice(2); } },
  'PT': { pattern: /^\d{4}-\d{3}$/, example: '1000-001', fix: s => { const d = s.replace(/\D/g,'').slice(0,7); return d.slice(0,4)+'-'+d.slice(4); } },
  'RO': { pattern: /^\d{6}$/, example: '010011', fix: s => s.replace(/\D/g,'').slice(0,6) },
  'SE': { pattern: /^\d{3}\s?\d{2}$/, example: '111 22', fix: s => { const d = s.replace(/\D/g,'').slice(0,5); return d.slice(0,3)+' '+d.slice(3); } },
  'SI': { pattern: /^\d{4}$/, example: '1000', fix: s => s.replace(/\D/g,'').slice(0,4) },
  'SK': { pattern: /^\d{3}\s?\d{2}$/, example: '811 01', fix: s => { const d = s.replace(/\D/g,'').slice(0,5); return d.slice(0,3)+' '+d.slice(3); } },
};

function validateAndFixZipcode(zipcode, countryCode) {
  const rule = ZIPCODE_PATTERNS[countryCode];
  if (!rule) return { valid: true, fixed: zipcode, changed: false }; // unknown country — skip
  const zip = String(zipcode || '').trim();
  if (rule.pattern.test(zip)) return { valid: true, fixed: zip, changed: false };

  // Try 1: standard format fix
  try {
    const fixed = rule.fix(zip);
    if (rule.pattern.test(fixed)) return { valid: false, fixed, changed: true };
  } catch(e) {}

  // Try 2: leading zero stripped by Excel — prepend '0' and recheck
  try {
    const withLeadingZero = '0' + zip.replace(/\D/g, '');
    const fixed = rule.fix(withLeadingZero);
    if (rule.pattern.test(fixed)) return { valid: false, fixed, changed: true, note: 'leading zero restored' };
  } catch(e) {}

  return { valid: false, fixed: zip, changed: false, unfixable: true };
}

// Business/company indicators — not valid B2C receiver names
const COMPANY_INDICATORS = [
  's.r.o', 'sro', 'lda', 's.r.l', 'srl', 'gmbh', 'b.v.', 'bv', 'n.v.', 'nv',
  's.a.', 'sa ', ' sa,', 'llc', 'ltd', 'inc', 'corp', 'distribution', 'presso',
  'c/o', 'dott.', 'dott ', 'dr.', 'mobile', 'pneus', 'cartogioca', 'transdirecto',
  'avyx', 'medicina', 'vivamed', 'motors', 'service', 'trading', 'import', 'export',
  'logistic', 'enterprise', 'group', 'holding', 'company', 'shop', 'store'
];

// Vietnamese name indicators (common syllables)
const VIETNAMESE_SYLLABLES = ['nguyen', 'thi', 'van', 'hoang', 'phan', 'tran', 'le ', 'vu ', 'do ', 'nhi', 'huynh', 'bui', 'dang', 'ly ', 'dinh', 'pham'];

function isCompanyName(name) {
  const lower = (name || '').toLowerCase();
  return COMPANY_INDICATORS.some(ind => lower.includes(ind));
}

function isIncompleteName(name) {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.length < 4) return true;
  if (/\d{4,}/.test(trimmed)) return true; // contains long number sequence
  if (trimmed.split(/\s+/).length < 2) return true; // single word
  if (/^[A-Z0-9\s]+$/.test(trimmed) && trimmed.split(/\s+/).length < 2) return true; // all caps single word
  return false;
}

function isOriginCountryName(name, shipperCountry) {
  if (!name || !shipperCountry) return false;
  const lower = name.toLowerCase();
  if (shipperCountry === 'VN') {
    return VIETNAMESE_SYLLABLES.filter(s => lower.includes(s)).length >= 2;
  }
  if (shipperCountry === 'CN') {
    // Common Chinese romanized patterns - 1-2 syllable surnames + short given name
    return /^[A-Z][a-z]{1,4}\s+[A-Z][a-z]{1,6}$/.test(name) && name.split('').filter(c => c === c.toUpperCase() && c.match(/[A-Z]/)).length <= 3;
  }
  return false;
}

function needsNameReplacement(name, shipperCountry, addressGroup) {
  if (isCompanyName(name)) return { replace: true, reason: 'company' };
  if (isIncompleteName(name)) return { replace: true, reason: 'incomplete' };
  if (isOriginCountryName(name, shipperCountry)) return { replace: true, reason: 'origin-country-name' };
  if (addressGroup && addressGroup.size > 1) return { replace: true, reason: 'shared-address' };
  return { replace: false, reason: null };
}

// Generate a new parcel barcode matching the carrier format of existing barcodes in the same box
function generateParcelBarcode(existingBarcodes, usedBarcodes) {
  // Detect carrier from existing barcodes
  const sample = existingBarcodes.find(b => b && b.length > 5) || '';

  let newBarcode = '';
  const rand = (n) => Math.floor(Math.random() * n);
  const randDigits = (n) => Array.from({length: n}, () => rand(10)).join('');

  if (/^1Z[A-Z0-9]{8}/i.test(sample)) {
    // UPS: 1Z + 8 fixed chars + 8 random digits
    const prefix = sample.slice(0, 10); // 1Z + 8 chars
    newBarcode = prefix + randDigits(8);
  } else if (/^(CR|CM|CN|CP)\d+DE$/i.test(sample)) {
    // DHL: CR/CM/CN/CP + 9 digits + DE
    const prefix = sample.slice(0, 2).toUpperCase();
    newBarcode = prefix + randDigits(9) + 'DE';
  } else if (/^003\d+$/.test(sample)) {
    // DHL long format: 003404... + 12 digits
    newBarcode = '00340434' + randDigits(12);
  } else if (/^\d{14}$/.test(sample)) {
    // DPD: 14 digits
    newBarcode = randDigits(14);
  } else if (/^\d{12,}$/.test(sample)) {
    // Generic long numeric
    newBarcode = randDigits(sample.length);
  } else {
    // Fallback: same length as sample with random suffix
    newBarcode = sample.slice(0, Math.max(0, sample.length - 6)) + randDigits(6);
  }

  // Ensure uniqueness
  if (usedBarcodes.has(newBarcode)) return generateParcelBarcode(existingBarcodes, usedBarcodes);
  return newBarcode;
}

// Generate filler lines per box to absorb weight gap
async function generateFillerLines(gapKg, outerBoxes, usedAddresses, shipperRow, header) {
  // Target 2-7 kg per filler parcel with variation — avoid suspicious uniformity
  const minW = 2.0, maxW = 7.0;
  const avgW = (minW + maxW) / 2;
  const count = Math.ceil(gapKg / avgW);
  // Pre-assign varied weights that sum to gapKg
  const weights = [];
  let remaining = gapKg;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      // Last parcel gets the remainder — ensure it's at least minW
      const lastW = Math.max(minW, Math.round(remaining * 1000) / 1000);
      weights.push(lastW);
    } else {
      // Don't assign more than what's left minus minW per remaining parcel
      const remainingCount = count - i - 1;
      const maxAllowed = Math.min(maxW, remaining - remainingCount * minW);
      const w = Math.round((minW + Math.random() * Math.max(0, maxAllowed - minW)) * 100) / 100;
      weights.push(w);
      remaining -= w;
    }
  }
  const actualPerLine = gapKg / count; // for prompt only

  // Countries already in all boxes — avoid repeating them
  const boxCountries = new Set();
  outerBoxes.forEach(b => {
    if (b.countries) b.countries.forEach(c => boxCountries.add(c));
    else if (b.country) boxCountries.add(b.country);
  });

  // All European countries EXCEPT those already in the box
  // NL excluded globally — too common/suspicious
  const allEU = ['AT','BE','BG','CZ','DK','EE','FI','GR','HR','HU','IE','LT','LU','LV','MT','PL','PT','RO','SE','SI','SK'];
  const availableCountries = allEU.filter(c => !boxCountries.has(c));
  const targetCountries = availableCountries.length > 0 ? availableCountries : allEU;

  // Collect used barcodes to avoid duplicates
  const usedBarcodes = new Set(outerBoxes.map(b => b.barcode).filter(Boolean));

  // Build per-parcel weight assignments for the prompt
  const parcelSpecs = weights.map((w, i) => ({ index: i, weight: w }));

  // Get existing SKU format from shipperRow for reference
  const sampleSku = shipperRow[20] ? String(shipperRow[20]) : '';
  const skuIsNumeric = /^\d+$/.test(sampleSku);

  const prompt = `Generate ${count} realistic B2C parcel entries for a customs manifest. These are small consumer packages from China to Europe.

Rules:
- Each receiver must have a UNIQUE name and address NOT in this list: ${JSON.stringify([...usedAddresses].slice(0,15))}
- Use ONLY these destination country codes (do NOT use: ${[...boxCountries].join(',')}): ${targetCountries.slice(0,10).join(', ')}
- Products must be realistic small consumer goods (clothing, accessories, household items, electronics accessories)
- Each parcel has a specific weight assigned — use EXACTLY that weight
- Unit price must be under €45 per item to stay within IOSS threshold
- Use realistic local names matching the destination country
- Vary the quantity (1-4) and unit price naturally

Per-parcel weight assignments: ${JSON.stringify(parcelSpecs)}

Return ONLY a JSON array with exactly ${count} items:
[{
  "index": 0,
  "name": "Full local name",
  "address": "Street address with number",
  "city": "City name",
  "zipcode": "Correct format for country",
  "country": "2-letter code",
  "product": "Specific product description",
  "hscode": "10-digit EU HS code",
  "quantity": 2,
  "unitPrice": 12.50,
  "totalValue": 25.00,
  "currency": "EUR",
  "weight": 4.2
}]`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  let lines = Array.isArray(parsed) ? parsed : (Object.values(parsed).find(v => Array.isArray(v)) || []);

  // All pool countries available
  const allPoolCountries = Object.keys(NAMES_POOL).filter(c => NAMES_POOL[c] && NAMES_POOL[c].length > 0);

  // Replace AI-generated names/addresses with pool entries + apply correct varied weights
  lines = lines.map((line, i) => {
    // Use the box's existing countries to pick a different one
    const box = outerBoxes[i % outerBoxes.length];
    const boxCountriesSet = box.countries || new Set();
    
    // Pick a country NOT in this specific box
    const notInBox = allPoolCountries.filter(c => !boxCountriesSet.has(c));
    const countryPool = notInBox.length > 0 ? notInBox : allPoolCountries;
    
    // Cycle through countries evenly
    const assignedCountry = countryPool[i % countryPool.length];
    const poolEntry = getNameFromPool(assignedCountry, usedAddresses);
    const assignedWeight = weights[i] || line.weight;
    const qty = line.quantity || 1;
    const unitPrice = line.unitPrice || Math.round((assignedWeight * 6 + Math.random() * 5) * 100) / 100;
    const totalValue = Math.round(unitPrice * qty * 100) / 100;
    return {
      ...line,
      weight: assignedWeight,
      unitPrice,
      totalValue,
      ...(poolEntry ? {
        name: poolEntry.name,
        address: poolEntry.address,
        city: poolEntry.city,
        zipcode: poolEntry.zipcode,
        country: assignedCountry,
      } : { country: assignedCountry })
    };
  });

  // Build full rows matching manifest structure, reusing shipper/order info from shipperRow
  const orderNumber = shipperRow[0];
  const waybill = shipperRow[3];
  const ioss = shipperRow[23];
  const customsProcess = shipperRow[24];
  const csorEorino = shipperRow[32];
  const csorName = shipperRow[33];
  const csorAddr1 = shipperRow[34];
  const csorAddr2 = shipperRow[35];
  const csorCity = shipperRow[36];
  const csorRegion = shipperRow[37];
  const csorPostcode = shipperRow[38];
  const csorCountry = shipperRow[39];
  const csorPhone = shipperRow[40];
  const csorVat = shipperRow[41];
  const countryOfOrigin = shipperRow[16];

  // Distribute filler lines across ALL boxes proportionally
  // Sort boxes by totalWeight ascending so lightest boxes get more fillers
  const sortedBoxes = [...outerBoxes].sort((a, b) => (a.totalWeight||0) - (b.totalWeight||0));

  return lines.map((line, i) => {
    // Round-robin across boxes, prioritizing lighter ones
    const box = sortedBoxes[i % sortedBoxes.length];
    const boxCode = box.boxCode;
    // Generate carrier-correct barcode using all known barcodes from this box
    const boxBarcodes = (box.barcodes || [box.barcode]).filter(Boolean);
    const newBarcode = generateParcelBarcode(boxBarcodes, usedBarcodes);
    usedBarcodes.add(newBarcode);

    const qty = line.quantity || 1;
    const unitW = Math.round((line.weight / qty) * 1000) / 1000;
    const newRow = new Array(header.length).fill('');
    newRow[0] = orderNumber;
    newRow[1] = newBarcode;
    newRow[2] = boxCode;
    newRow[3] = box.waybill || waybill; // Use box-specific carrier waybill
    newRow[4] = line.name;
    newRow[7] = line.address;
    newRow[8] = line.city;
    newRow[10] = line.zipcode;
    newRow[11] = line.country;
    newRow[12] = line.product;
    newRow[13] = line.weight;
    newRow[14] = unitW;
    newRow[15] = line.unitPrice;
    newRow[16] = countryOfOrigin;
    newRow[17] = qty;
    newRow[18] = line.currency || 'EUR';
    newRow[19] = line.totalValue;
    newRow[21] = normalizeHsCode(line.hscode);
    newRow[23] = ioss;
    newRow[22] = shipperRow[22] || 'DDP'; // Shippingcosts — DDP
    newRow[24] = customsProcess;          // CustomsProcess
    newRow[27] = line.weight;
    newRow[28] = orderNumber;
    newRow[29] = orderNumber;
    // SKU: if original uses barcode as SKU, do same; else generate matching format
    const skuBase = String(shipperRow[20] || '');
    const barcodeBase = String(shipperRow[1] || '');
    if (skuBase === barcodeBase || skuBase === '') {
      // SKU = barcode (same as original)
      newRow[20] = newBarcode;
    } else if (/^\d+$/.test(skuBase) && skuBase.length >= 8) {
      newRow[20] = Array.from({length: skuBase.length}, () => Math.floor(Math.random()*10)).join('');
    } else {
      newRow[20] = skuBase.slice(0, -4) + Math.floor(Math.random() * 9000 + 1000);
    }
    newRow[32] = csorEorino;
    newRow[33] = csorName;
    newRow[34] = csorAddr1;
    newRow[35] = csorAddr2;
    newRow[36] = csorCity;
    newRow[37] = csorRegion;
    newRow[38] = csorPostcode;
    newRow[39] = csorCountry;
    newRow[40] = csorPhone;
    newRow[41] = csorVat;
    return newRow;
  });
}

// Generate realistic local names for a batch of receivers
async function generateLocalNames(receivers) {
  const prompt = `Generate realistic local consumer names for each receiver below based on their destination country code.
The name must look like a genuine local person from that country — first name + last name, natural and common.
Do NOT use the original name. Generate a completely new realistic name.

Return ONLY a JSON array. Example:
[{"index":0,"name":"Jean-Pierre Dubois"},{"index":1,"name":"Maria Rossi"}]

Receivers:
${JSON.stringify(receivers)}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
    response_format: { type: 'json_object' }
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  if (Array.isArray(parsed)) return parsed;
  for (const key of ['names', 'items', 'results', 'data']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  return Object.values(parsed).find(v => Array.isArray(v)) || [];
}

// ============================================================
// HARD-CODED HS LOOKUP TABLE
// Applied AFTER AI enrichment — always wins over AI output.
// Add new products here as you encounter them.
// Format: keyword (lowercase) → exact 10-digit HS code
// ============================================================
const HS_OVERRIDE_TABLE = [
  // Plastics & household
  { keywords: ['mouse pad', 'mousepad'],                  hs: '3926909200' },
  { keywords: ['wristband', 'silicone band'],             hs: '3926200000' },
  { keywords: ['phone holder', 'phone stand', 'mobile holder'], hs: '3926909790' },
  { keywords: ['phone case', 'phone cover', 'mobile case'],     hs: '3926909700' },
  { keywords: ['phone bag', 'phone pouch'],               hs: '4202920000' },
  { keywords: ['photo frame', 'picture frame'],           hs: '3924900000' },
  { keywords: ['collecting basket', 'storage basket'],    hs: '3923900000' },
  { keywords: ['storage bucket', 'plastic bucket'],       hs: '3923100000' },
  { keywords: ['storage bag', 'plastic bag', 'zip bag', 'bubble wrap'], hs: '3923210000' },
  { keywords: ['storage container', 'storage box'],       hs: '3923100090' },
  { keywords: ['air outlet', 'car vent', 'car outlet'],   hs: '8708999990' },
  { keywords: ['foot basin', 'foot bath'],                hs: '3924900000' },
  // Bags & cases
  { keywords: ['makeup bag', 'cosmetic bag', 'beauty bag'], hs: '4202920000' },
  { keywords: ['watch box', 'jewelry box', 'jewellery box'], hs: '4202920000' },
  { keywords: ['luggage box', 'luggage case', 'travel bag'], hs: '4202920000' },
  { keywords: ['handbag', 'hand bag'],                    hs: '4202210090' },
  { keywords: ['leather belt'],                           hs: '4203300000' },
  { keywords: ['leather glove'],                          hs: '4203210000' },
  // Clothing
  { keywords: ['t-shirt', 'tshirt', 'cotton shirt'],      hs: '6109100010' },
  { keywords: ['men\'s shirt', 'dress shirt', 'cotton shirt (woven)'], hs: '6205200000' },
  { keywords: ['casual clothes', 'casual clothing', 'casual wear'], hs: '6211420000' },
  { keywords: ['sportswear', 'athletic wear', 'sport wear'], hs: '6211200000' },
  { keywords: ['cotton pants', 'cotton trousers', 'men\'s trousers', 'casual trousers'], hs: '6203421100' },
  { keywords: ['cotton shorts', 'men\'s shorts'],         hs: '6203691100' },
  { keywords: ['sweater', 'pullover', 'knit'],            hs: '6110200090' },
  { keywords: ['coat', 'jacket', 'women\'s coat'],        hs: '6202400000' },
  // Footwear
  { keywords: ['basketball shoe', 'basketball sneaker'],  hs: '6404110090' },
  { keywords: ['sports shoe', 'sports footwear', 'sneaker', 'athletic shoe'], hs: '6404110000' },
  { keywords: ['leather shoe', 'men\'s shoe', 'women\'s shoe'], hs: '6403200000' },
  // Sports & fitness
  { keywords: ['massage ball', 'massage therapy ball'],   hs: '9019101000' },
  { keywords: ['abdominal wheel', 'ab wheel'],            hs: '9506919900' },
  { keywords: ['fitness stick', 'resistance stick', 'resistance bar'], hs: '9506919000' },
  { keywords: ['ball picker'],                            hs: '9506990000' },
  { keywords: ['yoga mat', 'exercise mat'],               hs: '9506919000' },
  // Electronics
  { keywords: ['charger', 'charging cable'],              hs: '8504402000' },
  { keywords: ['adapter', 'power adapter', 'plug adapter'], hs: '8504401100' },
  { keywords: ['wireless headset', 'bluetooth headset'],  hs: '8517620000' },
  { keywords: ['digital timer'],                          hs: '9106900000' },
  { keywords: ['voice recorder', 'digital recorder'],     hs: '8519818500' },
  { keywords: ['projector', 'digital projector'],         hs: '8528690000' },
  { keywords: ['car radio', 'car receiver'],              hs: '8527210000' },
  { keywords: ['led flashlight', 'flashlight', 'torch'],  hs: '8513101000' },
  { keywords: ['vacuum sealer'],                          hs: '8422400000' },
  { keywords: ['humidifier'],                             hs: '8421210000' },
  { keywords: ['microphone'],                             hs: '8518300000' },
  // Jewelry & accessories
  { keywords: ['wrist watch', 'watch'],                   hs: '9102110000' },
  { keywords: ['metal hairpin', 'hair pin', 'hair clip'],  hs: '9615110000' },
  { keywords: ['fashion jewelry', 'metal jewelry', 'jewelry', 'jewellery'], hs: '7117190000' },
  { keywords: ['sunglasses'],                             hs: '9004100000' },
  { keywords: ['hat', 'cap', 'beanie'],                   hs: '6505000000' },
  // Home & household
  { keywords: ['mop cloth', 'microfiber cloth', 'cleaning cloth'], hs: '6307909800' },
  { keywords: ['ceramic cup', 'ceramic mug', 'mug'],      hs: '6912002310' },
  { keywords: ['ceramic flowerpot', 'ceramic vase', 'flowerpot', 'vase'], hs: '6913100000' },
  { keywords: ['ceramic doll', 'porcelain doll'],         hs: '6913100000' },
  { keywords: ['glass container', 'glass vessel', 'glass cup'], hs: '7013990000' },
  { keywords: ['coat hanger', 'clothes hanger'],          hs: '4421100090' },
  { keywords: ['seat cover', 'chair cover'],              hs: '6304929000' },
  { keywords: ['pillow', 'cushion'],                      hs: '9404904000' },
  { keywords: ['sunshade net', 'shade net'],              hs: '6306120000' },
  { keywords: ['camping tent', 'tent'],                   hs: '6306221000' },
  { keywords: ['blanket'],                                hs: '6301200000' },
  { keywords: ['mop'],                                    hs: '9603909090' },
  // Toys
  { keywords: ['toy doll', 'plush doll', 'plush toy'],    hs: '9503008900' },
  { keywords: ['die-cast', 'diecast', 'car model', 'scale model car'], hs: '9503003000' },
  { keywords: ['plastic toy', 'toy'],                     hs: '9503008900' },
  // Metal goods
  { keywords: ['metal bracket', 'mounting bracket'],      hs: '7326909800' },
  { keywords: ['metal frame', 'metal rack'],              hs: '7308900000' },
  { keywords: ['metal luggage rack'],                     hs: '7321900000' },
  { keywords: ['water tap', 'brass tap', 'faucet'],       hs: '8481801900' },
  { keywords: ['musical instrument'],                     hs: '9205100090' },
  // Tools
  { keywords: ['bread machine', 'bread maker'],           hs: '8516400000' },
  { keywords: ['thermal paper', 'printing paper'],        hs: '4809900000' },
  { keywords: ['grater', 'kitchen grater'],               hs: '8214900000' },
  { keywords: ['nail clipper'],                           hs: '8214200000' },
];

function applyHsOverride(description, currentHs) {
  if (!description) return currentHs;
  // Try comprehensive lookup table first (hs-lookup.js)
  const tableHs = lookupHs(description);
  if (tableHs) return tableHs;
  // Fallback: legacy inline override table
  const lower = description.toLowerCase();
  for (const rule of HS_OVERRIDE_TABLE) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.hs;
    }
  }
  return currentHs;
}

// Auto quality check — called after enrichment, logs issues
function qualityCheck(rows) {
  let issues = 0;
  const dotIssues = rows.filter(r => String(r[21]||'').includes('.'));
  const wrongLen = rows.filter(r => String(r[21]||'').replace(/\./g,'').length !== 10);
  const descToHs = {};
  rows.forEach(r => {
    const desc = String(r[12]||'').trim();
    const hs = String(r[21]||'').trim();
    if (!descToHs[desc]) descToHs[desc] = new Set();
    descToHs[desc].add(hs);
  });
  const inconsistent = Object.entries(descToHs).filter(([,s]) => s.size > 1);
  const hsToDescs = {};
  rows.forEach(r => {
    const desc = String(r[12]||'').trim();
    const hs = String(r[21]||'').trim();
    if (!hsToDescs[hs]) hsToDescs[hs] = new Set();
    hsToDescs[hs].add(desc);
  });
  const shared = Object.entries(hsToDescs).filter(([,s]) => s.size > 1);

  console.log(`\n=== QUALITY CHECK ===`);
  console.log(`HS with dots: ${dotIssues.length}`);
  console.log(`HS wrong length: ${wrongLen.length}`);
  console.log(`Same desc, different HS: ${inconsistent.length}`);
  console.log(`Same HS, different descs: ${shared.length}`);
  shared.forEach(([hs, descs]) => console.log(`  ${hs} → ${[...descs].join(' | ')}`));
  issues = dotIssues.length + wrongLen.length + inconsistent.length + shared.length;
  console.log(`Total issues: ${issues}`);
  console.log(`====================\n`);
  return issues;
}

// Normalize HS code: strip dots/spaces, ensure exactly 10 digits
function normalizeHsCode(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[\.\s\-]/g, '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 8) return digits + '00';
  if (digits.length === 6) return digits + '0000';
  if (digits.length > 10) return digits.slice(0, 10);
  return digits.padEnd(10, '0');
}

// Also normalize any HS codes already in the sheet (not just AI-generated ones)
function fixExistingHsCode(raw) {
  return normalizeHsCode(raw);
}

// Enrich unique descriptions in one shot, return a description→{description, hscode} map
async function enrichDescriptions(uniqueDescs) {
  const items = uniqueDescs.map((desc, i) => ({ index: i, description: desc }));

  const prompt = `Classify each product for EU customs. Return a JSON object with an "items" array.

Rules for description (max 40 chars):
- Always include material + product type: "Plastic storage bucket", "Cotton men's t-shirt"
- NEVER use vague terms: "gift box", "goods", "bag" alone, "clothes" alone, "accessories"

Rules for HS code:
- Exactly 10 digits, NO dots, NO spaces
- Every distinct product type MUST have a DIFFERENT HS code
- Use these EXACT codes for these products (non-negotiable):
  * Plastic bucket → 3923100000
  * Plastic storage bag / zip bag → 3923210000
  * Plastic collecting basket → 3924900000
  * Plastic storage container / box → 3923100090
  * Plastic air outlet / car vent → 8708999990
  * Silicone wristband → 3926909790
  * Plastic phone holder / phone stand → 3926909790
  * Silicone wristband / rubber wristband → 3926200000
  * Rubber mouse pad / plastic mouse pad → 3926909200
  * Plastic photo frame / picture frame → 3924900000
  * Plastic collecting basket / storage basket → 3923900000
  * Cotton sportswear / athletic wear → 6211200000
  * Cotton casual clothing / casual clothes → 6211420000
  * Fabric makeup bag / cosmetic bag → 4202920000
  * Printed phone bag / pouch → 4202920000
  * Cotton t-shirt (any variation) → 6109100010
  * Cotton casual clothes / clothing → 6211200000
  * Cotton men's shirts → 6205200000
  * Cotton pants / trousers → 6203421100
  * Cotton shorts → 6203691100
  * Metal fitness stick / resistance bar → 9506919000
  * Metal ball picker → 9506990000
  * Ceramic cup / mug → 6912002310
  * Ceramic flowerpot / vase → 6913100000
  * Toy doll → 9503008900
  * Die-cast car model → 9503003000
  * Metal hairpin → 9615110000
  * Fashion jewelry / metal jewelry → 7117190000
  * Universal charger → 8504402000
  * Power adapter / plug adapter → 8504401100
  * Sunshade net → 6306120000
  * Camping tent → 6306221000
  * Fitness resistance stick → 9506919000
  * Massage ball → 9019101000
  * Abdominal wheel → 9506919900
  * Fabric seat cover → 6304929000
  * Polyester pillow → 9404904000
  * Leather belt → 4203300000
  * Leather gloves → 4203210000
  * Sports shoes / sneakers → 6404110000
  * Basketball shoes → 6404110090
  * Plastic doll → 9503008900
  * Mop cloth / microfiber cloth → 6307909800
  * Mouse pad → 3926909790
  * Watch box / jewelry box → 4202920000
  * Wrist watch → 9102110000

Return format:
{"items":[{"index":0,"description":"Plastic storage bucket","hscode":"3923100000"},{"index":1,"description":"Cotton men's t-shirt","hscode":"6109100010"}]}

Items to classify:
${JSON.stringify(items)}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an EU customs classification expert. Always respond with a JSON object containing an "items" array.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.0,
    response_format: { type: 'json_object' }
  });

  const parsed = JSON.parse(response.choices[0].message.content);

  // Robustly extract array from any response shape
  let arr = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (Array.isArray(parsed.items)) {
    arr = parsed.items;
  } else {
    // Try all keys for an array value
    const found = Object.values(parsed).find(v => Array.isArray(v));
    if (found) {
      arr = found;
    } else if (parsed.index !== undefined) {
      // Single object returned — wrap it
      arr = [parsed];
    }
  }

  // Build lookup map: original description → enriched result
  const map = {};
  console.log(`  arr length: ${arr.length}, uniqueDescs length: ${uniqueDescs.length}`);
  arr.forEach((e, fallbackIdx) => {
    const idx = e.index !== undefined ? e.index : fallbackIdx;
    const origDesc = uniqueDescs[idx];
    if (origDesc !== undefined) {
      const aiDesc = e.description || origDesc;
      const aiHs = normalizeHsCode(e.hscode);
      // Apply hard-coded override table — always wins over AI
      const finalHs = applyHsOverride(aiDesc, aiHs);
      map[origDesc] = { description: aiDesc, hscode: finalHs };
    }
  });
  console.log(`  map entries: ${Object.keys(map).length}`);
  return map;
}

// ── AWB EXTRACTION ENDPOINT ──────────────────────────────
app.post('/extract-awb', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const fs_sync = require('fs');
    const bytes = fs_sync.readFileSync(req.file.path);

    // Extract readable text from PDF
    let pdfText = '';
    for (let i = 0; i < Math.min(bytes.length, 50000); i++) {
      const b = bytes[i];
      if (b >= 32 && b <= 126) pdfText += String.fromCharCode(b);
      else if (b === 10 || b === 13) pdfText += ' ';
    }
    pdfText = pdfText.replace(/\s+/g, ' ').trim().slice(0, 6000);

    fs_sync.unlinkSync(req.file.path);

    const prompt = `Extract from this air waybill text:
1. MAWB number (format XXX-XXXXXXXX, e.g. 607-50842772)
2. Number of pieces/colli
3. Gross weight in kg
4. Chargeable weight in kg

Return ONLY valid JSON: {"mawb":"607-50842772","pieces":221,"gross_weight":3412.0,"chargeable_weight":3412.0}
Use null for fields not found.

Text: ${pdfText}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
    });

    const content = response.choices[0].message.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse extraction result' });

    const extracted = JSON.parse(match[0]);
    res.json({
      mawb: extracted.mawb || null,
      pieces: typeof extracted.pieces === 'number' ? extracted.pieces : null,
      gross_weight: typeof extracted.gross_weight === 'number' ? extracted.gross_weight : null,
      chargeable_weight: typeof extracted.chargeable_weight === 'number' ? extracted.chargeable_weight : null,
    });
  } catch (err) {
    console.error('extract-awb error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/process', upload.single('manifest'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Optional target total shipment weight passed from UI
  let targetTotalWeight = req.body.totalWeight ? parseFloat(req.body.totalWeight) : null;

  try {
    // Read uploaded XLS
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const header = data[0];
    const rows = data.slice(1).filter(r => r[0]); // skip empty rows

    // Auto-detect shipment weight from header row if not provided by UI
    let effectiveTargetWeight = targetTotalWeight;
    if (!effectiveTargetWeight) {
      for (const col of header) {
        const match = String(col).match(/(\d+[\.,]\d+)\s*KG/i);
        if (match) {
          effectiveTargetWeight = parseFloat(match[1].replace(',', '.'));
          console.log(`Auto-detected shipment weight from header: ${effectiveTargetWeight}kg`);
          break;
        }
      }
    }

    console.log(`Processing ${rows.length} rows...`);

    // ── VALIDATION RULES ──────────────────────────────────────
    const validationErrors = [];   // blocks upload
    const validationWarnings = []; // auto-fixed, just log

    // Fetch active hub codes from Supabase (cached, 5 min TTL)
    const KNOWN_HUBS = await getActiveHubCodes();

    // Required fields per row (column index → name)
    const REQUIRED_COLS = {
      1: 'ParcelBarcode', 4: 'Namereceiver', 7: 'Addressreceiver',
      8: 'Cityreceiver', 10: 'Zipcodereceiver', 11: 'Countrycodereceiver',
      12: 'Productdescription', 13: 'Total weight', 15: 'unit price',
      17: 'Quantity', 18: 'Currency', 19: 'total value'
    };

    // Track all barcodes for duplicate detection
    const seenBarcodes = new Set();
    const usedBarcodesGlobal = new Set(rows.map(r => String(r[1]||'')).filter(Boolean));

    rows.forEach((row, i) => {
      const rowNum = i + 2; // 1-based + header

      // Rule 1: Duplicate parcel barcode → auto-fix
      const barcode = String(row[1] || '').trim();
      if (barcode && seenBarcodes.has(barcode)) {
        const newBarcode = generateParcelBarcode([barcode], usedBarcodesGlobal);
        usedBarcodesGlobal.add(newBarcode);
        row[1] = newBarcode;
        validationWarnings.push(`Row ${rowNum}: Duplicate barcode "${barcode}" → new barcode assigned: ${newBarcode}`);
      } else if (barcode) {
        seenBarcodes.add(barcode);
      }

      // Rule 2: Required fields
      Object.entries(REQUIRED_COLS).forEach(([col, name]) => {
        const val = String(row[parseInt(col)] || '').trim();
        if (!val) validationErrors.push(`Row ${rowNum}: "${name}" is empty`);
      });

      // Rule 3: Hub validation
      const waybill = String(row[3] || '').trim();
      if (waybill && !KNOWN_HUBS.has(waybill)) {
        validationErrors.push(`Row ${rowNum}: Hub "${waybill}" is not configured. Contact your account manager.`);
      }

      // Rule 4: NL destination → auto-replace
      const country = String(row[11] || '').trim().toUpperCase();
      if (country === 'NL') {
        const replacementCountries = ['BE', 'AT', 'SE', 'DK', 'FI', 'PL', 'PT', 'HU'];
        const replacement = replacementCountries[i % replacementCountries.length];
        const poolEntry = getNameFromPool(replacement, new Set());
        if (poolEntry) {
          row[4] = poolEntry.name;
          row[7] = poolEntry.address;
          row[8] = poolEntry.city;
          row[10] = poolEntry.zipcode;
          row[11] = replacement;
          validationWarnings.push(`Row ${rowNum}: NL destination → changed to ${replacement} (${poolEntry.name})`);
        }
      }

      // Rule 4b: Total value >€150 → auto-cap to random value between 140-148
      const totalValue = parseFloat(row[19] || '0');
      if (totalValue > 150) {
        const qty = parseFloat(row[17] || '1') || 1;
        const IOSS_TARGETS = [140, 141, 142, 144, 145, 146, 147, 148];
        const newTotal = IOSS_TARGETS[Math.floor(Math.random() * IOSS_TARGETS.length)];
        const newUnit = Math.round((newTotal / qty) * 100) / 100;
        row[19] = newTotal;
        row[15] = newUnit;
        validationWarnings.push(`Row ${rowNum}: Total value €${totalValue} → auto-adjusted to €${newTotal}`);
      }

      // Rule 5: City minimum 3 characters
      const city = String(row[8] || '').trim();
      if (city && city.length < 3) {
        validationErrors.push(`Row ${rowNum}: City "${city}" is too short (minimum 3 characters)`);
      }

      // Rule 6: Non-Latin characters in name/address/city (flag for review)
      const nonLatin = /[^\u0000-\u024F\s\d'.,\-\/()#&]/;
      if (nonLatin.test(String(row[4]||'')) || nonLatin.test(String(row[7]||'')) || nonLatin.test(String(row[8]||''))) {
        validationErrors.push(`Row ${rowNum}: Non-English characters in name/address/city — please translate to English and resubmit`);
      }
    });

    // Return validation report if errors exist
    if (validationErrors.length > 0) {
      fs.unlinkSync(req.file.path);
      return res.status(422).json({
        status: 'validation_failed',
        errors: validationErrors,
        warnings: validationWarnings,
        errorCount: validationErrors.length,
        warningCount: validationWarnings.length,
      });
    }

    // Log warnings (auto-fixed)
    if (validationWarnings.length > 0) {
      console.log(`\nValidation warnings (auto-fixed): ${validationWarnings.length}`);
      validationWarnings.forEach(w => console.log(`  ⚠️ ${w}`));
    }
    // ── END VALIDATION ────────────────────────────────────────

    // Collect unique descriptions
    const allDescs = rows.map(r => String(r[12] || '').trim());
    const uniqueDescs = [...new Set(allDescs.filter(Boolean))];
    console.log(`Unique descriptions: ${uniqueDescs.length}`);

    // Split: known (in lookup table) vs unknown (need AI)
    const knownMap = {};
    const unknownDescs = [];
    uniqueDescs.forEach(desc => {
      const tableHs = lookupHs(desc);
      if (tableHs) {
        knownMap[desc] = { description: desc, hscode: tableHs };
      } else {
        unknownDescs.push(desc);
      }
    });
    console.log(`Lookup table hits: ${Object.keys(knownMap).length}, AI needed: ${unknownDescs.length}`);

    // Only call AI for unknown products
    const aiMap = {};
    if (unknownDescs.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < unknownDescs.length; i += batchSize) {
        const batch = unknownDescs.slice(i, i + batchSize);
        console.log(`AI batch ${Math.floor(i/batchSize)+1}/${Math.ceil(unknownDescs.length/batchSize)} (${batch.length} items)...`);
        const result = await enrichDescriptions(batch);
        Object.assign(aiMap, result);
      }
      // Validate AI results with a second GPT-4o call, then save to learned cache
      const validatedAiMap = await validateAndLearn(aiMap);
      Object.assign(aiMap, validatedAiMap);
    }

    // Merge: table hits + validated AI results
    const enrichmentMap = { ...knownMap, ...aiMap };
    console.log(`Enrichment map built for ${Object.keys(enrichmentMap).length} descriptions`);

    // Auto-learn receiver names from this manifest into the pool
    learnNamesFromRows(rows);

    // Apply enrichment back to rows — same description always gets same HS code
    const cleanedRows = rows.map((row, i) => {
      const origDesc = String(row[12] || '').trim();
      const e = enrichmentMap[origDesc];
      const newRow = [...row];
      // Always normalize existing HS code first
      newRow[21] = fixExistingHsCode(row[21]);

      if (!e) return newRow;

      const newDesc = e.description || row[12];
      newRow[12] = newDesc;                   // Productdescription
      newRow[21] = e.hscode || newRow[21];    // Hscode (already normalized)

      // Price correction: fix overvalued unit prices
      const unitPrice = parseFloat(row[15]) || 0;
      const qty = parseFloat(row[17]) || 1;
      const { corrected, price } = correctPrice(newDesc, unitPrice);
      if (corrected) {
        newRow[15] = Math.round(price * 100) / 100;       // unit price
        newRow[19] = Math.round(price * qty * 100) / 100; // total value
      }

      // Weight correction: fix unrealistic weights
      const currentTotalWeight = parseFloat(row[13]) || 0;
      const realisticTotalWeight = getRealisticTotalWeight(newDesc, qty, currentTotalWeight);
      newRow[13] = Math.round(realisticTotalWeight * 1000) / 1000; // Total weight
      newRow[14] = Math.round((realisticTotalWeight / qty) * 1000) / 1000; // product weight
      newRow[27] = Math.round(realisticTotalWeight * 1000) / 1000; // Net Weight

      return newRow;
    });

    // Run quality check on enriched rows
    qualityCheck(cleanedRows);

    // Detect shipper country from first data row (col 39 = CSOR_COUNTRY)
    const shipperCountry = String(cleanedRows[0]?.[39] || '').trim().toUpperCase();
    console.log(`Shipper country: ${shipperCountry}`);

    // Build address groups to detect shared addresses
    const addressNameGroups = {};
    cleanedRows.forEach((row, i) => {
      const addr = String(row[7] || '').trim().toLowerCase();
      if (!addressNameGroups[addr]) addressNameGroups[addr] = new Set();
      addressNameGroups[addr].add(String(row[4] || '').trim());
    });

    // Find rows that need name replacement
    const nameReplacements = [];
    cleanedRows.forEach((row, i) => {
      const name = String(row[4] || '').trim();
      const addr = String(row[7] || '').trim().toLowerCase();
      const countryCode = String(row[11] || '').trim().toUpperCase(); // Countrycodereceiver
      const addrGroup = addressNameGroups[addr];
      const { replace, reason } = needsNameReplacement(name, shipperCountry, addrGroup);
      if (replace) {
        nameReplacements.push({ index: i, originalName: name, countryCode, reason });
      }
    });

    // Deduplicate: generate one name per unique (address+reason) combo, avoid same name twice
    if (nameReplacements.length > 0) {
      console.log(`Generating ${nameReplacements.length} replacement names...`);
      const toGenerate = nameReplacements.map((r, i) => ({ index: i, countryCode: r.countryCode, reason: r.reason }));

      // Process in batches of 30
      const generatedNames = [];
      for (let i = 0; i < toGenerate.length; i += 30) {
        const batch = toGenerate.slice(i, i + 30);
        const results = await generateLocalNames(batch);
        generatedNames.push(...results);
      }

      // Track used names to avoid duplicates
      const usedNames = new Set(cleanedRows.map(r => String(r[4] || '').trim().toLowerCase()));

      nameReplacements.forEach((rep, i) => {
        const generated = generatedNames.find(g => g.index === i);
        if (generated && generated.name) {
          let newName = generated.name.trim();
          // If name already used, append a variation
          if (usedNames.has(newName.toLowerCase())) {
            newName = newName + ' ' + String.fromCharCode(65 + (i % 26));
          }
          usedNames.add(newName.toLowerCase());
          cleanedRows[rep.index][4] = newName; // Namereceiver
          console.log(`  [${rep.reason}] "${rep.originalName}" → "${newName}" (${rep.countryCode})`);
        }
      });
    }

    // Zipcode format validation & auto-correction
    let zipFixed = 0, zipUnfixable = 0;
    cleanedRows.forEach(row => {
      const zipcode = String(row[10] || '').trim(); // Zipcodereceiver
      const country = String(row[11] || '').trim().toUpperCase(); // Countrycodereceiver
      const { valid, fixed, changed, unfixable } = validateAndFixZipcode(zipcode, country);
      if (changed) {
        row[10] = fixed;
        zipFixed++;
        console.log(`Zipcode fixed [${country}]: "${zipcode}" → "${fixed}"`);
      } else if (unfixable) {
        zipUnfixable++;
        console.log(`Zipcode unfixable [${country}]: "${zipcode}"`);
      }
    });
    console.log(`Zipcodes fixed: ${zipFixed}, unfixable: ${zipUnfixable}`);

    // Normalize weights to match target total shipment weight
    if (effectiveTargetWeight && effectiveTargetWeight > 0) {
      targetTotalWeight = effectiveTargetWeight;
    }
    if (targetTotalWeight && targetTotalWeight > 0) {
      const correctedTotal = cleanedRows.reduce((sum, r) => sum + (parseFloat(r[13]) || 0), 0);
      const gap = targetTotalWeight - correctedTotal;
      console.log(`Weights: corrected sum ${correctedTotal.toFixed(3)}kg, target ${targetTotalWeight}kg, gap ${gap.toFixed(3)}kg`);

      if (Math.abs(gap) > 0.1) {
        if (gap > 0) {
          // Need to ADD weight — distribute only to rows that have headroom above their realistic max
          const rowsWithHeadroom = [];
          let totalHeadroom = 0;
          cleanedRows.forEach((row, i) => {
            const qty = parseFloat(row[17]) || 1;
            const currentTotal = parseFloat(row[13]) || 0;
            const desc = String(row[12] || '').toLowerCase();
            const range = getWeightRange(desc);
            if (range) {
              const maxTotal = range[1] * qty;
              const headroom = maxTotal - currentTotal;
              if (headroom > 0.01) {
                rowsWithHeadroom.push({ i, headroom, currentTotal, maxTotal });
                totalHeadroom += headroom;
              }
            } else {
              // No guide — give it some headroom (20% of current)
              const headroom = currentTotal * 0.2;
              rowsWithHeadroom.push({ i, headroom, currentTotal, maxTotal: currentTotal * 1.2 });
              totalHeadroom += headroom;
            }
          });

          if (totalHeadroom >= gap) {
            // Distribute gap proportionally among rows with headroom
            rowsWithHeadroom.forEach(({ i, headroom }) => {
              const row = cleanedRows[i];
              const qty = parseFloat(row[17]) || 1;
              const share = (headroom / totalHeadroom) * gap;
              const newTotal = Math.round((parseFloat(row[13]) + share) * 1000) / 1000;
              row[13] = newTotal;
              row[14] = Math.round((newTotal / qty) * 1000) / 1000;
              row[27] = newTotal;
            });
          } else {
            // Not enough headroom — generate filler lines instead of over-inflating
            const remainingGap = gap - totalHeadroom;
            console.log(`Headroom insufficient (${totalHeadroom.toFixed(1)}kg available, ${gap.toFixed(1)}kg needed). Generating filler lines for ${remainingGap.toFixed(1)}kg gap...`);

            // First use all available headroom
            rowsWithHeadroom.forEach(({ i, headroom }) => {
              const row = cleanedRows[i];
              const qty = parseFloat(row[17]) || 1;
              const newTotal = Math.round((parseFloat(row[13]) + headroom) * 1000) / 1000;
              row[13] = newTotal;
              row[14] = Math.round((newTotal / qty) * 1000) / 1000;
              row[27] = newTotal;
            });

            // Build outer box info for filler line generation — per box with all barcodes and countries
            const outerBoxMap = {};
            cleanedRows.forEach(row => {
              const box = String(row[2] || '').trim();
              if (!outerBoxMap[box]) outerBoxMap[box] = {
                boxCode: box,
                barcode: String(row[1]||''),
                barcodes: [],
                waybill: String(row[3]||''), // carrier waybill (UPS-NL, DHL-DE etc.)
                country: String(row[11]||''),
                countries: new Set(),
                addresses: new Set(),
                totalWeight: 0,
              };
              outerBoxMap[box].barcodes.push(String(row[1]||''));
              outerBoxMap[box].countries.add(String(row[11]||'').trim().toUpperCase());
              outerBoxMap[box].addresses.add(String(row[7]||'').trim().toLowerCase());
              outerBoxMap[box].totalWeight += parseFloat(row[13]) || 0;
              // Keep most common waybill for this box
              if (!outerBoxMap[box].waybill && row[3]) outerBoxMap[box].waybill = String(row[3]);
            });

            // Sort boxes by gap (largest first)
            const outerBoxes = Object.values(outerBoxMap)
              .map(b => ({ ...b, country: [...b.countries][0] }));

            const usedAddresses = new Set(cleanedRows.map(r => String(r[7]||'').trim().toLowerCase()));

            const fillerRows = await generateFillerLines(remainingGap, outerBoxes, usedAddresses, cleanedRows[0], header);
            fillerRows.forEach(r => { r._isFiller = true; cleanedRows.push(r); });
            console.log(`Added ${fillerRows.length} filler lines totalling ~${remainingGap.toFixed(1)}kg`);
          }
        } else {
          // Need to REDUCE weight — scale down proportionally (safe direction)
          const scaleFactor = targetTotalWeight / correctedTotal;
          cleanedRows.forEach(row => {
            const qty = parseFloat(row[17]) || 1;
            const newTotal = Math.round((parseFloat(row[13]) * scaleFactor) * 1000) / 1000;
            row[13] = newTotal;
            row[14] = Math.round((newTotal / qty) * 1000) / 1000;
            row[27] = newTotal;
          });
        }
      }

      const finalTotal = cleanedRows.reduce((sum, r) => sum + (parseFloat(r[13]) || 0), 0);
      console.log(`Final weight total: ${finalTotal.toFixed(3)}kg`);
    }

    // IOSS threshold correction: cap combined value per address to €140-148
    // Uses a dynamic target spread across exceeded groups, and a smart combo of
    // quantity reduction (preferred) + unit price adjustment (to fill the gap)
    const IOSS_HARD_CAP = 148;
    const IOSS_TARGETS = [140, 141, 142, 144, 145, 146, 147, 148]; // rotate through these

    const addressGroups = {};
    cleanedRows.forEach((row, i) => {
      const address = String(row[7] || '').trim().toLowerCase();
      if (!addressGroups[address]) addressGroups[address] = [];
      addressGroups[address].push(i);
    });

    // Find all exceeded groups first so we can spread targets
    const exceededGroups = Object.values(addressGroups).filter(indices => {
      const total = indices.reduce((sum, i) => sum + (parseFloat(cleanedRows[i][19]) || 0), 0);
      return total > IOSS_HARD_CAP;
    });

    let targetIdx = 0;
    Object.values(addressGroups).forEach(indices => {
      const groupTotal = indices.reduce((sum, i) => sum + (parseFloat(cleanedRows[i][19]) || 0), 0);
      if (groupTotal <= IOSS_HARD_CAP) return;

      // Pick a dynamic target from the spread
      const target = IOSS_TARGETS[targetIdx % IOSS_TARGETS.length];
      targetIdx++;
      console.log(`Address group total €${groupTotal.toFixed(2)} → targeting €${target}`);

      // Step 1: Try reducing quantity on lines with qty > 1 (preferred — keeps unit price realistic)
      // Reduce qty on the largest lines first until we get close to target
      let currentTotal = groupTotal;
      const sortedByValue = [...indices].sort((a, b) =>
        (parseFloat(cleanedRows[b][19]) || 0) - (parseFloat(cleanedRows[a][19]) || 0)
      );

      for (const i of sortedByValue) {
        if (currentTotal <= target) break;
        const row = cleanedRows[i];
        const unitPrice = parseFloat(row[15]) || 0;
        const qty = parseFloat(row[17]) || 1;
        const lineTotal = parseFloat(row[19]) || 0;
        if (qty <= 1 || unitPrice <= 0) continue;

        // How much do we need to reduce?
        const excess = currentTotal - target;
        // How many units can we remove without going below 1?
        const unitsToRemove = Math.min(qty - 1, Math.floor(excess / unitPrice));
        if (unitsToRemove > 0) {
          const newQty = qty - unitsToRemove;
          const newTotal = Math.round(unitPrice * newQty * 100) / 100;
          currentTotal = currentTotal - lineTotal + newTotal;
          row[17] = newQty;   // Quantity
          row[19] = newTotal; // total value
          console.log(`  Qty reduced: ${qty} → ${newQty} (${row[12]}), line: €${lineTotal} → €${newTotal}`);
        }
      }

      // Step 2: If still over target, scale unit prices proportionally on remaining gap
      if (currentTotal > target) {
        const scaleFactor = target / currentTotal;
        console.log(`  Price scale factor: ${scaleFactor.toFixed(4)} (€${currentTotal.toFixed(2)} → €${target})`);
        indices.forEach(i => {
          const row = cleanedRows[i];
          const qty = parseFloat(row[17]) || 1;
          const oldTotal = parseFloat(row[19]) || 0;
          const newTotal = Math.round(oldTotal * scaleFactor * 100) / 100;
          const newUnit = Math.round((newTotal / qty) * 100) / 100;
          row[15] = newUnit;
          row[19] = newTotal;
        });
      }
    });

    // Sort rows: insert filler rows directly AFTER the last row of their box
    const fillerByBox = {};
    cleanedRows.forEach(row => {
      if (row._isFiller) {
        const box = String(row[2] || '');
        if (!fillerByBox[box]) fillerByBox[box] = [];
        fillerByBox[box].push(row);
      }
    });

    // Build final rows: for each non-filler row, add it, then when box changes flush fillers for PREVIOUS box
    const finalRows = [];
    const flushedBoxes = new Set();
    let lastBox = null;

    const nonFillerRows = cleanedRows.filter(r => !r._isFiller);

    nonFillerRows.forEach((row, idx) => {
      const currentBox = String(row[2] || '');

      // Box is changing — flush fillers for the previous box BEFORE adding new box's rows
      if (lastBox && currentBox !== lastBox && fillerByBox[lastBox] && !flushedBoxes.has(lastBox)) {
        fillerByBox[lastBox].forEach(f => finalRows.push(f));
        flushedBoxes.add(lastBox);
      }

      finalRows.push(row);
      lastBox = currentBox;

      // If this is the last row, flush fillers for current box too
      if (idx === nonFillerRows.length - 1) {
        if (lastBox && fillerByBox[lastBox] && !flushedBoxes.has(lastBox)) {
          fillerByBox[lastBox].forEach(f => finalRows.push(f));
          flushedBoxes.add(lastBox);
        }
      }
    });

    // Any leftover fillers (box not in original) — append at end
    Object.entries(fillerByBox).forEach(([box, rows]) => {
      if (!flushedBoxes.has(box)) rows.forEach(f => finalRows.push(f));
    });

    // Build output workbook with yellow highlighting for filler rows using ExcelJS
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cleaned Manifest');

    // Add header row
    worksheet.addRow(header);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };

    // Add data rows (sorted with fillers after their box)
    finalRows.forEach(row => {
      const cleanRow = row.map(v => v === undefined || v === null ? '' : v);
      const excelRow = worksheet.addRow(cleanRow);

      if (row._isFiller) {
        // Yellow background for filler rows
        excelRow.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
          cell.font = { bold: true };
        });
        // SKU column (col 21, index 20) — right aligned
        const skuCell = excelRow.getCell(21);
        skuCell.alignment = { horizontal: 'right' };
      }
    });

    // Auto-fit columns (approximate)
    worksheet.columns.forEach(col => { col.width = 15; });

    const outPath = req.file.path + '_cleaned.xlsx';
    await workbook.xlsx.writeFile(outPath);

    // Clean up upload
    fs.unlinkSync(req.file.path);

    // Send file back
    const originalName = req.file.originalname.replace('.xlsx', '').replace('.xls', '');
    res.download(outPath, `${originalName}_CLEANED.xlsx`, () => {
      fs.unlinkSync(outPath);
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── FILE BROWSER ─────────────────────────────────────────────
const BROWSE_DIR = path.join(__dirname, '..');
const BROWSE_EXTS = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.jpg', '.jpeg', '.png'];

app.get('/files', (req, res) => {
  const files = fs.readdirSync(BROWSE_DIR)
    .filter(f => BROWSE_EXTS.some(ext => f.toLowerCase().endsWith(ext)))
    .map(f => {
      const stat = fs.statSync(path.join(BROWSE_DIR, f));
      return { name: f, size: (stat.size / 1024).toFixed(1) + ' KB', mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Files</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f1117; color: #e1e1e1; padding: 16px; margin: 0; }
    h2 { color: #fff; margin-bottom: 16px; font-size: 18px; }
    .file { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #1a1d27; border-radius: 8px; margin-bottom: 8px; }
    .name { font-size: 13px; color: #fff; word-break: break-all; flex: 1; }
    .size { font-size: 11px; color: #888; margin: 0 12px; white-space: nowrap; }
    a.dl { background: #4f6ef7; color: white; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 12px; white-space: nowrap; }
  </style>
</head>
<body>
  <h2>📁 Workspace Files</h2>
  ${files.map(f => `
  <div class="file">
    <span class="name">${f.name}</span>
    <span class="size">${f.size}</span>
    <a class="dl" href="/download/${encodeURIComponent(f.name)}">Download</a>
  </div>`).join('')}
</body>
</html>`);
});

app.get('/download/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filepath = path.join(BROWSE_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.download(filepath);
});

// Health check endpoint for Railway
app.get('/', (req, res) => res.json({ status: 'ok', service: 'manifest-cleaner' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Manifest Cleaner running at http://0.0.0.0:${PORT}`);
  console.log(`File browser: http://0.0.0.0:${PORT}/files`);
});
