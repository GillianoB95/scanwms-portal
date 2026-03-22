/**
 * HS Lookup Table
 * Source of truth for product → HS code mapping.
 * Keywords are matched against the product description (case-insensitive, partial match).
 * More specific entries should come first.
 * To add a new product: add a line with keywords and the correct 10-digit EU CN code.
 */

const HS_TABLE = [
  // ── CLOTHING ────────────────────────────────────────────────────────────────
  { keywords: ['cotton t-shirt', 'cotton tshirt', 'men\'s t-shirt', 'women\'s t-shirt', 'cotton top'], hs: '6109100010' },
  { keywords: ['men\'s t-shirts', 'cotton men\'s t'], hs: '6109100010' },
  { keywords: ['cotton pants', 'cotton trousers', 'men\'s trousers', 'casual trousers', 'cotton casual trouser'], hs: '6203421100' },
  { keywords: ['cotton shorts', 'men\'s shorts'], hs: '6203691100' },
  { keywords: ['cotton shirt', 'dress shirt', 'cotton men\'s shirt'], hs: '6205200000' },
  { keywords: ['cotton sportswear', 'athletic wear', 'sports wear'], hs: '6211200000' },
  { keywords: ['casual clothes', 'casual clothing', 'cotton clothing', 'cotton clothes', 'casual wear'], hs: '6211420000' },
  { keywords: ['wool sweater', 'knitted sweater', 'woollen sweater'], hs: '6110110000' },
  { keywords: ['polyester pajamas', 'pyjamas', 'sleepwear'], hs: '6107210000' },
  { keywords: ['women\'s coat', 'ladies coat', 'winter coat'], hs: '6202130000' },
  { keywords: ['children\'s jacket', 'kids jacket', 'child jacket'], hs: '6201400000' },
  { keywords: ['cotton hat', 'cap', 'hats and caps'], hs: '6505000000' },

  // ── FOOTWEAR ─────────────────────────────────────────────────────────────────
  { keywords: ['basketball shoes', 'basketball sneakers'], hs: '6404110090' },
  { keywords: ['sports shoes', 'sports footwear', 'synthetic sports shoes', 'athletic shoes'], hs: '6404110000' },
  { keywords: ['leather shoes', 'men\'s leather shoes', 'women\'s leather shoes'], hs: '6403200000' },
  { keywords: ['men\'s shoes'], hs: '6403999600' },
  { keywords: ['women\'s shoes'], hs: '6403999300' },

  // ── BAGS & LUGGAGE ────────────────────────────────────────────────────────────
  { keywords: ['leather handbag', 'leather bag', 'leather purse'], hs: '4202210000' },
  { keywords: ['canvas tote bag', 'canvas bag', 'fabric bag', 'tote bag'], hs: '4202920000' },
  { keywords: ['fabric makeup bag', 'cosmetic bag', 'makeup bag', 'white makeup bag'], hs: '4202920000' },
  { keywords: ['printed phone bag', 'phone pouch', 'printed phone pouch'], hs: '4202920000' },
  { keywords: ['plastic luggage box', 'luggage box', 'luggage case', 'suitcase'], hs: '4202120000' },
  { keywords: ['travel bag', 'duffle bag', 'sports bag'], hs: '4202920000' },
  { keywords: ['watch box', 'jewelry box', 'fabric watch box', 'leather watch box'], hs: '4202920000' },
  { keywords: ['luggage rack', 'plastic luggage rack', 'metal luggage rack'], hs: '7326200000' },

  // ── LEATHER GOODS ─────────────────────────────────────────────────────────────
  { keywords: ['leather belt', 'leather waist belt'], hs: '4203300000' },
  { keywords: ['leather gloves', 'leather mitten'], hs: '4203210000' },

  // ── JEWELRY & ACCESSORIES ─────────────────────────────────────────────────────
  { keywords: ['metal hairpin', 'hair pin', 'hair clip'], hs: '9615110000' },
  { keywords: ['fashion jewelry', 'metal jewelry', 'plastic jewelry', 'imitation jewelry'], hs: '7117190000' },
  { keywords: ['wrist watch', 'quartz watch', 'analogue watch'], hs: '9102110000' },
  { keywords: ['plastic sunglasses', 'sunglasses'], hs: '9004100000' },
  { keywords: ['silicone wristband', 'rubber wristband', 'wristband'], hs: '3926200000' },
  { keywords: ['miniature keychain', 'metal keychain', 'keychain'], hs: '7326909800' },

  // ── ELECTRONICS ───────────────────────────────────────────────────────────────
  { keywords: ['wireless headset', 'bluetooth headset', 'earphones', 'earbuds'], hs: '8518300000' },
  { keywords: ['digital projector', 'multimedia projector', 'mini projector'], hs: '8528690000' },
  { keywords: ['car radio', 'car radio receiver', 'car stereo'], hs: '8527210000' },
  { keywords: ['digital voice recorder', 'digital recorder', 'voice recorder'], hs: '8519810000' },
  { keywords: ['digital timer', 'electronic timer', 'countdown timer'], hs: '9106900000' },
  { keywords: ['universal charger', 'phone charger', 'usb charger'], hs: '8504402000' },
  { keywords: ['power adapter', 'plug adapter', 'universal adapter', 'electrical adapter', 'travel adapter'], hs: '8504401100' },
  { keywords: ['electric beauty device', 'beauty device', 'facial massager'], hs: '8516800000' },
  { keywords: ['ultrasonic humidifier', 'humidifier', 'air humidifier'], hs: '8421210000' },
  { keywords: ['led flashlight', 'torch', 'flashlight'], hs: '8513100000' },
  { keywords: ['plastic microphone', 'microphone', 'karaoke mic'], hs: '8518100000' },
  { keywords: ['vacuum sealer', 'food sealer', 'plastic vacuum'], hs: '8422303090' },
  { keywords: ['led lamp', 'led table lamp', 'led light', 'desk lamp'], hs: '9405109900' },
  { keywords: ['power inverter', 'dc to ac inverter', 'car inverter'], hs: '8504402000' },

  // ── HOME & HOUSEHOLD ──────────────────────────────────────────────────────────
  { keywords: ['microfiber mop cloth', 'mop cloth', 'mop cleaning cloth', 'mop'], hs: '9603909800' },
  { keywords: ['rubber mouse pad', 'plastic mouse pad', 'mouse pad', 'mousepad'], hs: '3926909200' },
  { keywords: ['plastic photo frame', 'picture frame', 'photo frame'], hs: '3924900000' },
  { keywords: ['plastic collecting basket', 'storage basket', 'laundry basket'], hs: '3923900000' },
  { keywords: ['plastic bucket', 'plastic pail'], hs: '3923100000' },
  { keywords: ['plastic storage bag', 'zip bag', 'resealable bag', 'packaging bag'], hs: '3923210000' },
  { keywords: ['plastic storage container', 'storage container', 'food container'], hs: '3923100090' },
  { keywords: ['plastic storage box', 'organizer box'], hs: '3923100090' },
  { keywords: ['plastic cup', 'plastic mug', 'plastic drinking cup'], hs: '3924100000' },
  { keywords: ['glass container', 'glass jar', 'glass bottle'], hs: '7013490000' },
  { keywords: ['glass drinking vessel', 'drinking glass', 'glass cup'], hs: '7013280000' },
  { keywords: ['plastic flowerpot', 'flower pot', 'plant pot'], hs: '3924900000' },
  { keywords: ['plastic curtain rail', 'curtain rail', 'curtain rod'], hs: '3926300000' },
  { keywords: ['cardboard gift box', 'decorative cardboard box', 'gift box', 'cardboard box'], hs: '4819100000' },
  { keywords: ['plastic foot basin', 'foot basin', 'foot bath'], hs: '3924100000' },
  { keywords: ['glass water tank', 'water tank'], hs: '3925900000' },
  { keywords: ['wool blanket', 'fleece blanket', 'blanket'], hs: '6301200000' },
  { keywords: ['polyester pillow', 'decorative pillow', 'cushion', 'throw pillow'], hs: '9404904000' },
  { keywords: ['fabric seat cover', 'car seat cover', 'seat cover'], hs: '6304929000' },
  { keywords: ['sunshade net', 'shade net', 'sun shade'], hs: '6306120000' },
  { keywords: ['camping tent', 'outdoor tent', 'waterproof tent'], hs: '6306221000' },
  { keywords: ['polyester sunshade', 'polyester net', 'sunshade'], hs: '6306120000' },
  { keywords: ['wooden coat hanger', 'coat hanger', 'clothes hanger'], hs: '4421100000' },
  { keywords: ['thermal printing paper', 'thermal paper', 'receipt paper'], hs: '4809900000' },
  { keywords: ['kitchen grater', 'stainless steel grater', 'grater'], hs: '8214900000' },
  { keywords: ['bottle scrubber', 'bottle brush', 'cleaning brush'], hs: '9603909000' },
  { keywords: ['brass water tap', 'water tap', 'faucet'], hs: '8481200000' },
  { keywords: ['electric bread machine', 'bread maker', 'bread machine'], hs: '8516400000' },
  { keywords: ['plastic phone holder', 'phone holder', 'phone stand', 'mobile phone holder'], hs: '3926909790' },
  { keywords: ['plastic phone case', 'phone case', 'mobile phone case', 'silicone phone case'], hs: '3926909700' },
  { keywords: ['plastic air outlet', 'car air vent', 'air outlet'], hs: '8708991900' },
  { keywords: ['metal bracket', 'mounting bracket', 'wall bracket', 'metal frame'], hs: '7308900000' },
  { keywords: ['aluminum curtain rail', 'aluminium rail', 'curtain track'], hs: '7610900000' },
  { keywords: ['metal luggage rack', 'luggage stand'], hs: '7326200000' },
  { keywords: ['metal flag pole', 'flagpole'], hs: '7308900000' },
  { keywords: ['mechanical retarder', 'speed retarder'], hs: '8484100000' },
  { keywords: ['engine guard', 'engine cover', 'engine shield'], hs: '8708299000' },
  { keywords: ['central locking', 'door lock', 'car lock'], hs: '8301200000' },
  { keywords: ['glass wall mirror', 'wall mirror', 'mirror'], hs: '7009920000' },
  { keywords: ['plastic key tool', 'key tool', 'key organizer'], hs: '3926909000' },

  // ── WATCHES ────────────────────────────────────────────────────────────────────
  { keywords: ['ceramic cup', 'ceramic mug', 'ceramic coffee cup'], hs: '6912002310' },
  { keywords: ['ceramic flowerpot', 'ceramic vase', 'ceramic pot', 'porcelain pot'], hs: '6913100000' },
  { keywords: ['ceramic doll', 'porcelain doll', 'ceramic figurine'], hs: '6913900000' },

  // ── SPORTS & FITNESS ──────────────────────────────────────────────────────────
  { keywords: ['massage ball', 'rubber massage ball', 'therapy ball'], hs: '9019101000' },
  { keywords: ['abdominal wheel', 'ab wheel', 'abdominal roller'], hs: '9506919900' },
  { keywords: ['fitness resistance stick', 'resistance bar', 'metal fitness stick'], hs: '9506919000' },
  { keywords: ['metal ball picker', 'ball retriever', 'ball picker'], hs: '9506990000' },
  { keywords: ['yoga mat', 'exercise mat', 'foam mat'], hs: '9506919000' },
  { keywords: ['pet wheelchair', 'dog wheelchair', 'pet mobility'], hs: '9021900000' },
  { keywords: ['pet nail clippers', 'nail clippers', 'pet grooming'], hs: '8214200000' },
  { keywords: ['climbing rope', 'nylon rope', 'safety rope'], hs: '5607500000' },

  // ── TOYS ─────────────────────────────────────────────────────────────────────
  { keywords: ['plastic doll', 'stuffed doll', 'plush doll', 'toy doll', 'plush toy'], hs: '9503008900' },
  { keywords: ['die-cast car model', 'scale model car', 'toy car', 'miniature car'], hs: '9503003000' },
  { keywords: ['plastic toys', 'toy set', 'children\'s toy'], hs: '9503008900' },

  // ── MUSICAL INSTRUMENTS ────────────────────────────────────────────────────────
  { keywords: ['wooden musical instruments', 'musical instrument', 'percussion'], hs: '9206000000' },

  // ── PACKAGING & PAPER ─────────────────────────────────────────────────────────
  { keywords: ['bubble wrap', 'packing material', 'packaging material'], hs: '3921190000' },
  { keywords: ['heavy duty cardboard', 'cardboard boxes', 'shipping boxes'], hs: '4819100000' },
  { keywords: ['painting album', 'art album', 'sketchbook', 'art book'], hs: '4820300000' },
];

/**
 * Look up HS code for a product description.
 * Returns the HS code string if found, null if not found.
 */
function lookupHs(description) {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const entry of HS_TABLE) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return entry.hs;
      }
    }
  }
  return null;
}

/**
 * Quality check: returns issues found in a list of {description, hscode} pairs.
 */
function qualityCheck(rows) {
  const issues = [];

  // Check dots and wrong length
  rows.forEach((r, i) => {
    const hs = String(r.hscode || '');
    if (hs.includes('.')) issues.push({ row: i, type: 'dot', desc: r.description, hs });
    else if (hs.length !== 10) issues.push({ row: i, type: 'length', desc: r.description, hs });
  });

  // Check same HS → different descriptions (flag genuine mismatches)
  const hsToDescs = {};
  rows.forEach(r => {
    const hs = r.hscode;
    const desc = r.description;
    if (!hsToDescs[hs]) hsToDescs[hs] = new Set();
    hsToDescs[hs].add(desc);
  });
  Object.entries(hsToDescs).forEach(([hs, descs]) => {
    if (descs.size > 1) {
      issues.push({ type: 'shared_hs', hs, descs: [...descs] });
    }
  });

  return issues;
}

module.exports = { lookupHs, qualityCheck, HS_TABLE };
