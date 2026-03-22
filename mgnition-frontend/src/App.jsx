import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import modelsData from './data/models.json';
import showroomsData from './data/showrooms.json';
import modelVariantsData from './data/modelVariants.json';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';
const API_RECOMMEND = `${API_BASE}/recommend`;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const NAV_ITEMS = ['Home', 'Our Models', 'Recommended Cars', 'Compare', 'Saved Results', 'Showrooms', 'About Us'];

const HERO_IMG =
  '/hero-home-cyberster.jpg';

const fallbackModelImages = {
  mg5: 'https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg?auto=compress&cs=tinysrgb&w=1200',
  zs: 'https://images.pexels.com/photos/3874337/pexels-photo-3874337.jpeg?auto=compress&cs=tinysrgb&w=1200',
  zsev: 'https://images.pexels.com/photos/193991/pexels-photo-193991.jpeg?auto=compress&cs=tinysrgb&w=1200',
  mg4: 'https://images.pexels.com/photos/358070/pexels-photo-358070.jpeg?auto=compress&cs=tinysrgb&w=1200',
  vshev: 'https://images.pexels.com/photos/3674854/pexels-photo-3674854.jpeg?auto=compress&cs=tinysrgb&w=1200',
  mg3: 'https://images.pexels.com/photos/3729464/pexels-photo-3729464.jpeg?auto=compress&cs=tinysrgb&w=1200',
  maxus7: 'https://images.pexels.com/photos/892522/pexels-photo-892522.jpeg?auto=compress&cs=tinysrgb&w=1200',
  maxus9: 'https://images.pexels.com/photos/2365572/pexels-photo-2365572.jpeg?auto=compress&cs=tinysrgb&w=1200',
  es: 'https://images.pexels.com/photos/3156482/pexels-photo-3156482.jpeg?auto=compress&cs=tinysrgb&w=1200',
  im6: 'https://images.pexels.com/photos/1104768/pexels-photo-1104768.jpeg?auto=compress&cs=tinysrgb&w=1200',
  cyberster: 'https://images.pexels.com/photos/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1200',
  epplus: 'https://images.pexels.com/photos/358220/pexels-photo-358220.jpeg?auto=compress&cs=tinysrgb&w=1200',
  hs: 'https://images.pexels.com/photos/1035108/pexels-photo-1035108.jpeg?auto=compress&cs=tinysrgb&w=1200',
  hsphev: 'https://images.pexels.com/photos/210019/pexels-photo-210019.jpeg?auto=compress&cs=tinysrgb&w=1200',
  extender: 'https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg?auto=compress&cs=tinysrgb&w=1200',
  s5: 'https://images.pexels.com/photos/1149831/pexels-photo-1149831.jpeg?auto=compress&cs=tinysrgb&w=1200',
  default: 'https://images.pexels.com/photos/919073/pexels-photo-919073.jpeg?auto=compress&cs=tinysrgb&w=1200'
};

const quizQuestions = [
  {
    key: 'budget',
    type: 'single',
    prompt: 'What is your budget for your next MG?',
    options: ['Below 700,000 THB', '700,000 - 999,999 THB', '1,000,000 - 1,299,999 THB', '1,300,000 THB and above'],
  },
  {
    key: 'fuelType',
    type: 'single',
    prompt: 'Which type of fuel fits your lifestyle and driving habits?',
    options: ['Hybrid', 'Petrol (Gasoline)', 'Diesel', 'EV (Electric)'],
  },
  {
    key: 'seats',
    type: 'single',
    prompt: 'How many seats does your MG need?',
    options: ['2 seats', '3-5 seats', '5+ seats'],
  },
  {
    key: 'distance',
    type: 'single',
    prompt: 'On average, how far do you drive each day?',
    options: ['Short distance (0-30 km)', 'Medium commute (30-80 km)', 'Long commute (80-150 km)', 'Very long distance (Over 150 km)'],
  },
  {
    key: 'occupation',
    type: 'single',
    prompt: 'What is your occupation?',
    options: ['Student', 'Working Professional', 'Business Owner', 'Family-Oriented', 'Retired', 'Others'],
  },
  {
    key: 'hobbies',
    type: 'multi',
    prompt: 'What are your hobbies? (Choose more than one)',
    options: ['City Life & Socializing', 'Adventure & Travel', 'Relaxed & Minimalist Lifestyle', 'Outdoor Sports & Fitness'],
  },
  {
    key: 'usage',
    type: 'single',
    prompt: 'How do you use your car most of the time?',
    options: ['City commuting', 'Cargo & Practical use', 'Highway/Long-distance', 'Eco-conscious lifestyle'],
  },
  {
    key: 'preferredColors',
    type: 'multi',
    prompt: 'Which color would you prefer your car to be? (You may choose more than one)',
    options: ['Black', 'White', 'Silver/Grey', 'Blue', 'Red', 'Green', 'Beige/Champagne', 'No preference'],
  },
];

const PROVINCE_BY_PREFIX = {
  BKK: 'Bangkok',
  SPK: 'Samut Prakan',
  NON: 'Nonthaburi',
  PT: 'Pathum Thani',
  AY: 'Ayutthaya',
  AY0: 'Ayutthaya',
  AYT: 'Ayutthaya',
  SSK: 'Samut Sakhon',
  NPT: 'Nakhon Pathom',
  LBR: 'Lopburi',
  NRM: 'Nakhon Ratchasima',
  SRT: 'Surat Thani',
  SKN: 'Sakon Nakhon',
  PTN: 'Pattani',
  NRT: 'Narathiwat'
};

function normalizeProvince(v = '') {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

function postalFromAddress(address = '') {
  const m = address.match(/(\d{5})\s*$/);
  return m ? m[1] : '';
}

function provinceFromShowroom(showroom) {
  const code = String(showroom.id || '').slice(0, 3).toUpperCase();
  if (PROVINCE_BY_PREFIX[code]) return PROVINCE_BY_PREFIX[code];
  const m = String(showroom.address || '').match(/,\s*([^,\d]+)\s*\d{5}\s*$/i);
  if (m) return m[1].replace(/\s+Province$/i, '').trim();
  return 'Bangkok';
}

function normalizeColorLabel(raw = '') {
  return String(raw)
    .replace(/_/g, ' ')
    .replace(/\b(color|colours?|url|image|img)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeImageUrl(v = '') {
  return /^https?:\/\//i.test(String(v).trim());
}

function priceToNumber(value = '') {
  const num = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

function buildQuizReasons(answers = {}, car = {}) {
  const reasons = [];
  const priceNum = priceToNumber(car.price || car.starting_price || '');
  const seatsNum = Number(String(car.seats || '').replace(/[^\d]/g, '')) || 0;
  const fuelPrefRaw = String(answers.fuelType || answers.fuel_type || answers.fuel || '').toLowerCase();
  const fuelType = String(car.fuel || car.fuel_type || '').toLowerCase();

  const budgetText = String(answers.budget_choice || answers.budget || '').toLowerCase();
  const budgetLabel = String(answers.budget_choice || answers.budget || '').trim();
  if (budgetText && priceNum) {
    if (budgetText.includes('below 700') && priceNum <= 700000) {
      reasons.push(`Budget fit: You selected (${budgetLabel || 'Below 700,000 THB'}), and this car is ฿${priceNum.toLocaleString()}.`);
    } else if (budgetText.includes('700,000') && budgetText.includes('999') && priceNum >= 700000 && priceNum <= 999999) {
      reasons.push(`Budget fit: You selected (${budgetLabel || '700,000 - 999,999 THB'}), and this car is ฿${priceNum.toLocaleString()}.`);
    } else if (budgetText.includes('1,000,000') && priceNum >= 1000000 && priceNum <= 1299999) {
      reasons.push(`Budget fit: You selected (${budgetLabel || '1,000,000 - 1,299,999 THB'}), and this car is ฿${priceNum.toLocaleString()}.`);
    } else if (budgetText.includes('1,300,000') && priceNum >= 1300000) {
      reasons.push(`Budget fit: You selected (${budgetLabel || '1,300,000 THB and above'}), and this car is ฿${priceNum.toLocaleString()}.`);
    }
  }

  const seatLabel = String(answers.seat_choice || answers.seats || '').trim();
  const seatChoice = seatLabel.toLowerCase();
  if (seatChoice && seatsNum) {
    if (seatChoice.includes('2') && seatChoice.includes('seat') && seatsNum === 2) {
      reasons.push(`Seat fit: You selected (${seatLabel || '2 seats'}), and this car has ${seatsNum} seats.`);
    } else if (seatChoice.includes('3-5') && seatsNum >= 3 && seatsNum <= 5) {
      reasons.push(`Seat fit: You selected (${seatLabel || '3-5 seats'}), and this car has ${seatsNum} seats.`);
    } else if (seatChoice.includes('5') && seatsNum >= 5) {
      reasons.push(`Seat fit: You selected (${seatLabel || '5+ seats'}), and this car has ${seatsNum} seats.`);
    }
  }

  if (fuelPrefRaw) {
    const fuelMatch =
      (fuelPrefRaw.includes('ev') && fuelType.includes('ev') && !fuelType.includes('hybrid')) ||
      (fuelPrefRaw.includes('hybrid') && fuelType.includes('hybrid')) ||
      (fuelPrefRaw.includes('petrol') && fuelType.includes('petrol')) ||
      (fuelPrefRaw.includes('diesel') && fuelType.includes('diesel'));
    if (fuelMatch) {
      const label = answers.fuelType || answers.fuel_type || answers.fuel || 'Fuel';
      reasons.push(`Fuel fit: You selected (${label}), and this car matches that fuel preference.`);
    }
  }

  const distanceLabel = String(answers.daily_distance || answers.distance || '').trim();
  const distance = distanceLabel.toLowerCase();
  const rangeNum = Number(String(car.rangeKm || car.range_km || '').replace(/[^\d]/g, '')) || 0;
  if (distance && rangeNum) {
    reasons.push(`Range fit: You selected (${distanceLabel || 'daily distance'}), and this car supports about ${rangeNum} km.`);
  }

  const usage = Array.isArray(answers.usage) ? answers.usage.join(' ') : String(answers.usage || '');
  if (usage.toLowerCase().includes('city') && car.bodyType) {
    reasons.push(`Usage fit: You selected (${usage}), and this ${car.bodyType} body style suits that use.`);
  }

  return reasons.filter(Boolean).slice(0, 3);
}

function toReasonSnippet(reason = '') {
  const cleaned = String(reason || '').replace(/\s+/g, ' ').trim();
  return cleaned.replace(/[.!?]+$/g, '').trim();
}

function toPrimaryReasonClause(reason = '') {
  const snippet = toReasonSnippet(reason);
  if (!snippet) return '';
  const firstClause = snippet.split(',')[0].split(' and ')[0].trim();
  if (!firstClause) return '';
  return firstClause.charAt(0).toUpperCase() + firstClause.slice(1);
}

function extractSelectedQuizAnswer(reason = '') {
  const source = String(reason || '');
  const lower = source.toLowerCase();
  const marker = 'you selected (';
  const startIdx = lower.indexOf(marker);
  if (startIdx < 0) {
    // Fallback: capture the last balanced parenthetical group in the reason text.
    const groups = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') {
        if (depth === 0) start = i + 1;
        depth += 1;
      } else if (ch === ')' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const content = source.slice(start, i).trim();
          if (content) groups.push(content);
          start = -1;
        }
      }
    }
    return groups.length ? groups[groups.length - 1] : '';
  }

  let cursor = startIdx + marker.length;
  let depth = 1;
  let out = '';
  while (cursor < source.length && depth > 0) {
    const ch = source[cursor];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth > 0) out += ch;
    cursor += 1;
  }
  return out.trim();
}

function cleanReasonFragment(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

function capitalizeFirst(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractModelTrait(reason = '') {
  const source = String(reason || '');
  const lower = source.toLowerCase();

  const fitPrefix = source.match(/^([A-Za-z ]+)\s*fit:/i)?.[1]?.trim().toLowerCase();
  if (fitPrefix === 'range') return 'driving range';
  if (fitPrefix === 'seat') return 'seat capacity';
  if (fitPrefix === 'fuel') return 'fuel type';
  if (fitPrefix === 'budget') return 'price range';
  if (fitPrefix === 'usage') return 'body style';
  if (fitPrefix === 'cargo') return 'cargo space';
  if (fitPrefix === 'power') return 'power';

  if (lower.includes('driving range')) return 'driving range';
  if (lower.includes('daily distance') || lower.includes('travel pattern') || lower.includes('commute')) return 'driving range';
  if (lower.includes('seat')) return 'seat capacity';
  if (lower.includes('fuel')) return 'fuel type';
  if (lower.includes('budget') || lower.includes('price')) return 'price range';
  if (lower.includes('cargo')) return 'cargo space';
  if (lower.includes('body style') || lower.includes('suv') || lower.includes('sedan')) return 'body style';
  if (lower.includes('horsepower') || lower.includes('performance') || lower.includes('power')) return 'power';

  const rangeMatch = source.match(/about\s+([\d,]+\s*km)/i);
  if (rangeMatch?.[1]) return rangeMatch[1].trim();

  const seatsMatch = source.match(/has\s+(\d+\s*seats?)/i);
  if (seatsMatch?.[1]) return seatsMatch[1].trim();

  const fuelMatch = source.match(/this car is\s+([^.,]+)/i);
  if (fuelMatch?.[1]) return fuelMatch[1].trim();

  const priceMatch = source.match(/this car is\s+([฿\d,.\sA-Za-z]+)/i);
  if (priceMatch?.[1]) return priceMatch[1].trim();

  if (lower.includes('body style') || lower.includes('suv')) {
    const bodyMatch = source.match(/this\s+([A-Za-z-]+)\s+body style/i);
    if (bodyMatch?.[1]) return `${bodyMatch[1]} body style`;
  }

  return '';
}

function buildRecommendationHeader(cars = []) {
  const topRawReason = (cars || [])
    .flatMap((car) => (Array.isArray(car?.explanation?.top_reasons) ? car.explanation.top_reasons : []))
    .find(Boolean);
  const selectedQuizAnswer = extractSelectedQuizAnswer(topRawReason);
  const modelTrait = extractModelTrait(topRawReason);
  const traitText = cleanReasonFragment(modelTrait);
  const answerText = cleanReasonFragment(selectedQuizAnswer);

  if (traitText && answerText) {
    return {
      title: 'Recommended Only For You',
      reason: `${capitalizeFirst(traitText)} suits your ${answerText}`
    };
  }

  if (answerText) {
    return {
      title: 'Recommended Only For You',
      reason: `This model suits your ${answerText}`
    };
  }

  const topReason = (cars || [])
    .flatMap((car) => (Array.isArray(car?.explanation?.top_reasons) ? car.explanation.top_reasons : []))
    .map((reason) => toPrimaryReasonClause(reason))
    .find(Boolean);
  const topReasonText = cleanReasonFragment(topReason);

  if (topReasonText) {
    return {
      title: 'Recommended Only For You',
      reason: topReasonText
    };
  }
  return {
    title: 'Recommended Only For You',
    reason: 'Based on your quiz preferences.'
  };
}

function extractColorImageMap(row) {
  if (!row || typeof row !== 'object') return {};
  if (row.Color_Images && typeof row.Color_Images === 'object') return row.Color_Images;
  if (row.colorImages && typeof row.colorImages === 'object') return row.colorImages;
  if (row.color_images && typeof row.color_images === 'object') return row.color_images;

  const out = {};
  Object.entries(row).forEach(([k, val]) => {
    const key = String(k || '');
    const value = String(val || '').trim();
    if (!looksLikeImageUrl(value)) return;
    const lower = key.toLowerCase();
    const hasColorSignal = lower.includes('color') || /(white|black|red|blue|silver|grey|gray|green|orange|yellow|beige|brown|pink|purple)/i.test(lower);
    if (!hasColorSignal) return;
    const label = normalizeColorLabel(key);
    if (label) out[label] = value;
  });

  const genericColor = String(row.Color || row.color || '').trim();
  const genericImage = String(row.Color_Image_URL || row.color_image_url || row.Image_URL || '').trim();
  if (genericColor && looksLikeImageUrl(genericImage)) {
    out[genericColor] = genericImage;
  }
  return out;
}

function pickColorImage(colorMap = {}, preferredColor = '', defaultColor = '') {
  const entries = Object.entries(colorMap || {});
  if (!entries.length) return '';
  const byName = (name) => entries.find(([k]) => k.toLowerCase() === String(name || '').toLowerCase())?.[1];
  return byName(preferredColor) || byName(defaultColor) || entries[0][1];
}

function modelImage(carOrModel, preferredColor = '') {
  const car = typeof carOrModel === 'object' ? carOrModel : null;
  const model = typeof carOrModel === 'string' ? carOrModel : (car?.model || '');
  const colorMap = car ? (car.colorImages || car.color_images || {}) : {};
  const colorImage = pickColorImage(colorMap, preferredColor, car?.defaultColor || car?.default_color);
  if (colorImage) return colorImage;

  const src = (car?.imagePageUrl || '').trim();
  if (/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return `https://image.thum.io/get/width/1200/crop/700/noanimate/${src}`;

  const key = model.toLowerCase();
  if (key.includes('zs ev')) return fallbackModelImages.zsev;
  if (key.includes('maxus 7')) return fallbackModelImages.maxus7;
  if (key.includes('maxus 9')) return fallbackModelImages.maxus9;
  if (key.includes('vs hev')) return fallbackModelImages.vshev;
  if (key.includes('cyberster')) return fallbackModelImages.cyberster;
  if (key.includes('ep plus')) return fallbackModelImages.epplus;
  if (key.includes('hs phev')) return fallbackModelImages.hsphev;
  if (key.includes('im6')) return fallbackModelImages.im6;
  if (key.includes('s5')) return fallbackModelImages.s5;
  if (key.includes('mg3')) return fallbackModelImages.mg3;
  if (key.includes('mg5')) return fallbackModelImages.mg5;
  if (key.includes('mg4')) return fallbackModelImages.mg4;
  if (key.includes('extender')) return fallbackModelImages.extender;
  if (key.includes('mg es')) return fallbackModelImages.es;
  if (key.includes('mg hs')) return fallbackModelImages.hs;
  if (key.includes('zs')) return fallbackModelImages.zs;
  return fallbackModelImages.default;
}

function mapApiResultsToModels(items, allModels, variantLookupMap) {
  return items
    .map((x) => {
      if (x.variant_key || x.variant) {
        const row = variantLookupMap.get(x.variant_key || '');
        const colorImages = x.colorImages || x.color_images || extractColorImageMap(row);
        return {
          variant_key: x.variant_key,
          model: x.model || x.name || 'MG Model',
          variant: x.variant || '',
          year: x.year || '',
          price: x.starting_price || x.price || 'N/A',
          fuel: x.fuel || '',
          seats: x.seats || '',
          bodyType: x.bodyType || x.body_type || '',
          imagePageUrl: x.imagePageUrl || x.image_url || '',
          colorImages,
          defaultColor: x.default_color || x.defaultColor || Object.keys(colorImages || {})[0] || '',
          score: x.score,
          explanation: x.explanation || null,
          ruleBreakdown: x.rule_breakdown || {}
        };
      }
      const name = (x.model || x.name || '').toLowerCase();
      const match = allModels.find((m) => m.model.toLowerCase().includes(name) || name.includes(m.model.toLowerCase()));
      if (match) return match;
      if (name) {
        return {
          model: x.model || x.name,
          price: x.starting_price || x.price || 'N/A',
          fuel: '',
          seats: '',
          bodyType: '',
          score: x.score,
          explanation: x.explanation || null,
          ruleBreakdown: x.rule_breakdown || {}
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normModelName(v = '') {
  return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

function fmtNumber(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return String(v || 'N/A');
  return n.toLocaleString();
}

function toDateInputValue(dateObj) {
  const d = new Date(dateObj);
  const offsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

function daysAgoInputValue(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateInputValue(d);
}

function modelPriceLabel(price = '') {
  const numericPrice = priceToNumber(price);
  if (numericPrice > 0) return `Starting from ฿${fmtNumber(numericPrice)}`;
  return `Starting from ${String(price || 'N/A')}`;
}

function isEvChoice(value = '') {
  const lower = String(value || '').toLowerCase();
  return (lower.includes('ev') || lower.includes('electric')) && !lower.includes('hev') && !lower.includes('hybrid');
}

function isBelow700kBudget(value = '') {
  return String(value || '').toLowerCase().includes('below 700');
}

function isTwoSeatChoice(value = '') {
  const lower = String(value || '').toLowerCase();
  return lower.includes('2') && lower.includes('seat');
}

function recommendationFixSuggestions(errorMessage = '', answers = {}) {
  const message = String(errorMessage || '').toLowerCase();
  if (!message.includes('hard constraints')) return [];

  const budget = String(answers.budget_choice || answers.budget || '').toLowerCase();
  const fuel = String(answers.fuelType || answers.fuel_type || answers.fuel || '').toLowerCase();
  const seats = String(answers.seat_choice || answers.seats || '').toLowerCase();

  const out = [];
  const wantsEv = isEvChoice(fuel);
  const below700k = isBelow700kBudget(budget);
  const twoSeats = isTwoSeatChoice(seats);

  if (wantsEv && below700k) {
    out.push('Increase budget to at least ฿709,900 for EV models.');
  }
  if (wantsEv) {
    out.push('Or switch fuel preference to Hybrid/Petrol for more options.');
  }
  out.push('Try relaxing one filter: budget, seats, or fuel type.');

  return [...new Set(out)].slice(0, 4);
}

function variantLabelFromKey(v = '') {
  const [model, variant, year] = String(v || '').split('|');
  const right = [variant, year].filter(Boolean).join(' • ');
  return right ? `${model} (${right})` : model || v;
}

const COLOR_HEX = {
  white: '#f5f5f5',
  black: '#121212',
  red: '#c52026',
  blue: '#2e6de6',
  silver: '#a5adb8',
  gray: '#8a8f98',
  grey: '#8a8f98',
  green: '#3e8c57',
  orange: '#d7772b',
  yellow: '#e9bc33',
  beige: '#c8b28c',
  brown: '#7e573e',
  pink: '#f08ab5',
  purple: '#8a5ad8'
};

const COLOR_NAME_HEX_OVERRIDES = {
  flame: '#c52026',
  bullet: '#aeb5bf',
  photon: '#f0cf45',
  'modern beige': '#c8b28c',
  'champagne titanium': '#b9ac92',
};

const MODEL_COLOR_FALLBACKS = {
  'mg4 electric': ['Arctic White', 'Volcano Orange', 'Black Knight', 'Andes Grey'],
  'mg zs ev': ['Arctic White', 'Black Knight', 'Silver Metallic'],
  'mg5': ['Pearl White', 'Andes Grey', 'Black Knight', 'Scarlet Red'],
  'mg3 hybrid+': ['Arctic White', 'Brixton Blue', 'Black Knight', 'Cosmic Silver'],
  'mg im6': ['Raphael Beige', 'Black Knight', 'Moonlight Silver']
};

function colorHexFromName(name = '') {
  const lower = String(name || '').toLowerCase().trim();
  if (!lower) return '#d9d9d9';

  const direct = COLOR_NAME_HEX_OVERRIDES[lower];
  if (direct) return direct;

  const overrideKey = Object.keys(COLOR_NAME_HEX_OVERRIDES).find((x) => lower.includes(x));
  if (overrideKey) return COLOR_NAME_HEX_OVERRIDES[overrideKey];

  const k = Object.keys(COLOR_HEX).find((x) => lower.includes(x));
  if (k) return COLOR_HEX[k];

  // Reuse simplification rules so marketing names still map to representative swatch colors.
  const simplified = simplifyColorName(lower).toLowerCase();
  return COLOR_HEX[simplified] || '#d9d9d9';
}

const SIMPLE_COLOR_RULES = [
  { name: 'Black', test: /black|knight|midnight|carbon|graphite/ },
  { name: 'White', test: /white|arctic|pearl|snow/ },
  { name: 'Grey', test: /grey|gray|granite|ash|slate/ },
  { name: 'Silver', test: /silver|metallic|titanium|chrome|bullet/ },
  { name: 'Red', test: /red|scarlet|ruby|crimson|flame/ },
  { name: 'Blue', test: /blue|navy|azure|sky|cobalt/ },
  { name: 'Green', test: /green|emerald|forest|olive/ },
  { name: 'Yellow', test: /yellow|gold|photon/ },
  { name: 'Orange', test: /orange|bronze|copper/ },
  { name: 'Brown', test: /brown|chocolate|coffee/ },
  { name: 'Beige', test: /beige|champagne|sand|khaki|modern beige/ },
  { name: 'Pink', test: /pink/ },
  { name: 'Purple', test: /purple|violet/ }
];

function simplifyColorName(raw = '') {
  const cleaned = normalizeColorLabel(raw);
  const lower = cleaned.toLowerCase();
  const match = SIMPLE_COLOR_RULES.find((rule) => rule.test.test(lower));
  return match ? match.name : '';
}

function collectModelColors(model, variantRows = []) {
  const colors = new Set();
  const map = model?.colorImages || model?.color_images || {};
  let keys = Object.keys(map || {});
  if (!keys.length && model?.model) {
    const row = variantRows.find((r) => normModelName(r.Model) === normModelName(model.model));
    if (row) keys = extractVariantColors(row);
  }
  keys.forEach((c) => {
    const simplified = simplifyColorName(c);
    if (simplified) colors.add(simplified);
  });
  return [...colors];
}

function extractVariantColors(row) {
  if (!row || typeof row !== 'object') return [];
  const map = extractColorImageMap(row);
  const mappedColors = Object.keys(map);
  if (mappedColors.length) return mappedColors;

  const modelKey = normModelName(row.Model || '');
  const fallbackKey = Object.keys(MODEL_COLOR_FALLBACKS).find((k) => modelKey.includes(k));
  return fallbackKey ? MODEL_COLOR_FALLBACKS[fallbackKey] : ['Arctic White', 'Black Knight', 'Silver Metallic'];
}

function estimateDistanceKm(lat, lng, province) {
  const p = String(province || '').toLowerCase();
  const center = p.includes('bangkok') ? { lat: 13.7563, lng: 100.5018 } : { lat: 13.7, lng: 100.6 };
  const la = parseCoordinateNumber(lat);
  const lo = parseCoordinateNumber(lng);
  if (Number.isNaN(la) || Number.isNaN(lo)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(la - center.lat);
  const dLng = toRad(lo - center.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(la)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (6371 * c).toFixed(1);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const a1 = parseCoordinateNumber(lat1);
  const o1 = parseCoordinateNumber(lng1);
  const a2 = parseCoordinateNumber(lat2);
  const o2 = parseCoordinateNumber(lng2);
  if ([a1, o1, a2, o2].some((v) => Number.isNaN(v))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parseCoordinateNumber(value) {
  if (typeof value === 'number') return value;
  let raw = String(value ?? '').trim();
  if (!raw) return Number.NaN;
  // Convert common locale format "13,815836" -> "13.815836"
  if (raw.includes(',') && !raw.includes('.')) {
    raw = raw.replace(/,/g, '.');
  } else {
    // Remove thousands separators when dot-decimal is already present.
    raw = raw.replace(/,/g, '');
  }
  // Keep only numeric tokens used in lat/lng strings.
  raw = raw.replace(/[^0-9.\-+eE]/g, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseShowroomCoord(showroom = {}) {
  const lat = parseCoordinateNumber(showroom.lat);
  const lng = parseCoordinateNumber(showroom.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

function isInsideThailandBounds(coord) {
  if (!coord) return false;
  return coord.lat >= 5.0 && coord.lat <= 21.0 && coord.lng >= 97.0 && coord.lng <= 106.5;
}

function normalizeGeoText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROVINCE_MATCH_ALIASES = {
  bangkok: ['krung thep maha nakhon', 'krungthep maha nakhon', 'krung thep', 'กรุงเทพมหานคร'],
  'samut prakan': ['chang wat samut prakan', 'สมุทรปราการ'],
  ayutthaya: ['phra nakhon si ayutthaya', 'พระนครศรีอยุธยา'],
  'nakhon pathom': ['chang wat nakhon pathom', 'นครปฐม'],
  lopburi: ['lop buri', 'chang wat lopburi', 'ลพบุรี'],
  'nakhon ratchasima': ['korat', 'chang wat nakhon ratchasima', 'นครราชสีมา'],
  'surat thani': ['chang wat surat thani', 'สุราษฎร์ธานี'],
  'sakon nakhon': ['chang wat sakon nakhon', 'สกลนคร'],
  pattani: ['chang wat pattani', 'ปัตตานี'],
  narathiwat: ['chang wat narathiwat', 'นราธิวาส']
};

function provinceAliases(province = '') {
  const normalized = normalizeProvince(province).replace(/\s+province$/i, '').trim();
  const aliases = PROVINCE_MATCH_ALIASES[normalized] || [];
  return [...new Set([normalized, ...aliases].map(normalizeGeoText).filter(Boolean))];
}

function geocodeResultText(result = {}) {
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const chunks = [result?.formatted_address || ''];
  components.forEach((c) => {
    chunks.push(c?.long_name || '');
    chunks.push(c?.short_name || '');
  });
  return normalizeGeoText(chunks.join(' '));
}

function geocodePostalMatches(result = {}, expectedPostal = '') {
  const postal = String(expectedPostal || '').trim();
  if (!postal) return true;
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const postalComp = components.find(
    (c) => Array.isArray(c?.types) && c.types.includes('postal_code')
  );
  if (postalComp) {
    const packed = `${postalComp.long_name || ''} ${postalComp.short_name || ''}`;
    return packed.includes(postal);
  }
  return geocodeResultText(result).includes(postal);
}

function geocodeProvinceMatches(result = {}, expectedProvince = '') {
  const aliases = provinceAliases(expectedProvince);
  if (!aliases.length) return true;
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const provinceComp = components.find(
    (c) => Array.isArray(c?.types) && c.types.includes('administrative_area_level_1')
  );
  const localityComp = components.find(
    (c) => Array.isArray(c?.types) && c.types.includes('locality')
  );
  const haystack = normalizeGeoText([
    provinceComp?.long_name,
    provinceComp?.short_name,
    localityComp?.long_name,
    localityComp?.short_name,
    geocodeResultText(result)
  ].filter(Boolean).join(' '));
  return aliases.some((alias) => haystack.includes(alias));
}

function pickBestGeocodeResult(results = [], showroom = {}) {
  const expectedPostal = postalFromAddress(showroom.address);
  const expectedProvince = provinceFromShowroom(showroom);
  const expectedAddress = normalizeGeoText(showroom.address);
  const expectedName = normalizeGeoText(showroom.name);
  let best = null;
  let bestScore = -1;

  results.forEach((result) => {
    const loc = result?.geometry?.location;
    const lat = typeof loc?.lat === 'function' ? Number(loc.lat()) : Number(loc?.lat);
    const lng = typeof loc?.lng === 'function' ? Number(loc.lng()) : Number(loc?.lng);
    const coord = Number.isNaN(lat) || Number.isNaN(lng) ? null : { lat, lng };
    if (!coord || !isInsideThailandBounds(coord)) return;

    const provinceOk = geocodeProvinceMatches(result, expectedProvince);
    const postalOk = geocodePostalMatches(result, expectedPostal);
    const resultText = geocodeResultText(result);

    // Quick lexical hint from address/name to avoid selecting unrelated places.
    let lexicalHits = 0;
    const probeTokens = [
      ...expectedAddress.split(' ').filter((t) => t.length >= 5),
      ...expectedName.split(' ').filter((t) => t.length >= 5),
    ].slice(0, 16);
    probeTokens.forEach((token) => {
      if (resultText.includes(token)) lexicalHits += 1;
    });

    let score = 0;
    if (provinceOk) score += 6;
    if (postalOk && expectedPostal) score += 8;
    score += Math.min(lexicalHits, 4);
    if (Array.isArray(result?.types) && (result.types.includes('street_address') || result.types.includes('premise'))) {
      score += 1;
    }

    // If no strong structured match, require at least some lexical overlap.
    const hasStrongStructuredMatch = provinceOk || (expectedPostal && postalOk);
    if (!hasStrongStructuredMatch && lexicalHits === 0) return;

    if (score > bestScore) {
      best = coord;
      bestScore = score;
    }
  });

  return bestScore >= 1 ? best : null;
}

function pickBestPlaceResult(results = [], showroom = {}) {
  const expectedPostal = postalFromAddress(showroom.address);
  const expectedProvince = provinceFromShowroom(showroom);
  const expectedAddress = normalizeGeoText(showroom.address);
  const expectedName = normalizeGeoText(showroom.name);
  const provinceAliasSet = provinceAliases(expectedProvince);
  let best = null;
  let bestScore = -1;

  results.forEach((result) => {
    const loc = result?.geometry?.location;
    const lat = typeof loc?.lat === 'function' ? Number(loc.lat()) : Number(loc?.lat);
    const lng = typeof loc?.lng === 'function' ? Number(loc.lng()) : Number(loc?.lng);
    const coord = Number.isNaN(lat) || Number.isNaN(lng) ? null : { lat, lng };
    if (!coord || !isInsideThailandBounds(coord)) return;

    const text = normalizeGeoText(
      [result?.name || '', result?.formatted_address || '', result?.vicinity || '']
        .join(' ')
    );
    const provinceOk = provinceAliasSet.length ? provinceAliasSet.some((alias) => text.includes(alias)) : false;
    const postalOk = expectedPostal ? text.includes(expectedPostal) : false;

    let lexicalHits = 0;
    const probeTokens = [
      ...expectedAddress.split(' ').filter((t) => t.length >= 5),
      ...expectedName.split(' ').filter((t) => t.length >= 5),
    ].slice(0, 16);
    probeTokens.forEach((token) => {
      if (text.includes(token)) lexicalHits += 1;
    });

    let score = 0;
    if (provinceOk) score += 6;
    if (postalOk) score += 8;
    score += Math.min(lexicalHits, 4);
    if (Array.isArray(result?.types) && result.types.includes('car_dealer')) score += 2;

    const hasStrongStructuredMatch = provinceOk || postalOk;
    if (!hasStrongStructuredMatch && lexicalHits === 0) return;

    if (score > bestScore) {
      best = coord;
      bestScore = score;
    }
  });

  return bestScore >= 1 ? best : null;
}

function isBangkokShowroom(showroom = {}) {
  const address = String(showroom.address || '');
  const name = String(showroom.name || '');
  return /bangkok/i.test(address) || /\(bangkok\)/i.test(name);
}

function normalizeSavedCar(item) {
  return {
    variant_key: item.variant_key,
    model: item.model,
    variant: item.variant,
    year: item.year,
    price: item.price,
    fuel: item.fuel,
    seats: item.seats,
    bodyType: item.bodyType || item.body_type,
    imagePageUrl: item.imagePageUrl || item.image_url || '',
    colorImages: item.colorImages || item.color_images || {},
    defaultColor: item.defaultColor || item.default_color || ''
  };
}

function savedCarKey(item) {
  return item.variant_key || `${item.model || ''}|${item.variant || ''}|${item.year || ''}`;
}

function navLabelForPage(pageName) {
  if (pageName === 'home' || pageName === 'onboarding') return 'Home';
  if (pageName === 'models') return 'Our Models';
  if (pageName === 'results') return 'Recommended Cars';
  if (pageName === 'compare') return 'Compare';
  if (pageName === 'profile') return '';
  if (pageName === 'saved') return 'Saved Results';
  if (pageName === 'showrooms' || pageName === 'map' || pageName === 'booking') return 'Showrooms';
  if (pageName === 'about') return 'About Us';
  if (pageName === 'admin') return 'Admin Dashboard';
  return '';
}

function hydrateSavedCar(item, variantMap, modelMap) {
  const base = normalizeSavedCar(item);
  const key = savedCarKey(base);
  const variantRow = variantMap.get(key);
  if (variantRow) {
    const mappedColors = extractColorImageMap(variantRow);
    return {
      ...base,
      variant_key: key,
      price: base.price || variantRow.Price_THB,
      fuel: base.fuel || variantRow.Fuel_Type,
      seats: base.seats || variantRow.Seats,
      bodyType: base.bodyType || variantRow.Body_Type,
      imagePageUrl: base.imagePageUrl || variantRow.Image_URL || '',
      colorImages: Object.keys(base.colorImages || {}).length ? base.colorImages : mappedColors,
      defaultColor: base.defaultColor || Object.keys(mappedColors)[0] || ''
    };
  }

  const modelFallback = modelMap.get(normModelName(base.model));
  if (!modelFallback) return { ...base, variant_key: key };
  return {
    ...base,
    variant_key: key,
    price: base.price || modelFallback.price,
    fuel: base.fuel || modelFallback.fuel,
    seats: base.seats || modelFallback.seats,
    bodyType: base.bodyType || modelFallback.bodyType,
    imagePageUrl: base.imagePageUrl || modelFallback.imagePageUrl || '',
    colorImages: Object.keys(base.colorImages || {}).length ? base.colorImages : (modelFallback.colorImages || {}),
    defaultColor: base.defaultColor || modelFallback.defaultColor || ''
  };
}

let googleMapsScriptPromise = null;

function loadGoogleMapsScript(apiKey) {
  if (!apiKey) return Promise.reject(new Error('Missing Google Maps API key.'));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps failed to load.'));
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps script.'));
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

function ShowroomGoogleMap({
  showrooms = [],
  selectedShowroom = null,
  userLocation = null,
  onSelectShowroom = () => {}
}) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const infoWindowRef = useRef(null);
  const geocodeStatusWarnedRef = useRef({});
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [resolvedCoordMap, setResolvedCoordMap] = useState({});

  const showroomCoordKey = useCallback((s) => String(s?.id || `${s?.name || ''}|${s?.address || ''}`), []);

  const esc = useCallback((v) => String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'), []);

  useEffect(() => {
    let cancelled = false;
    if (!GOOGLE_MAPS_API_KEY) return undefined;

    loadGoogleMapsScript(GOOGLE_MAPS_API_KEY)
      .then(() => {
        if (cancelled || !mapElRef.current) return;
        if (!mapRef.current) {
          const fallbackCenter = { lat: 13.7563, lng: 100.5018 };
          const userCenter = userLocation
            ? { lat: parseCoordinateNumber(userLocation.lat), lng: parseCoordinateNumber(userLocation.lng) }
            : null;
          const selectedCenter = selectedShowroom
            ? { lat: parseCoordinateNumber(selectedShowroom.lat), lng: parseCoordinateNumber(selectedShowroom.lng) }
            : null;
          const center = (selectedCenter && !Number.isNaN(selectedCenter.lat) && !Number.isNaN(selectedCenter.lng))
            ? selectedCenter
            : (userCenter && !Number.isNaN(userCenter.lat) && !Number.isNaN(userCenter.lng))
              ? userCenter
            : fallbackCenter;

          mapRef.current = new window.google.maps.Map(mapElRef.current, {
            center,
            zoom: selectedShowroom ? 12 : 10,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true
          });
          infoWindowRef.current = new window.google.maps.InfoWindow();
        }
        setMapReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapError(err?.message || 'Unable to load Google Maps.');
      });

    return () => {
      cancelled = true;
    };
  }, [mapReady, selectedShowroom, userLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return undefined;
    const lat = parseCoordinateNumber(userLocation?.lat);
    const lng = parseCoordinateNumber(userLocation?.lng);

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) return undefined;

    userMarkerRef.current = new window.google.maps.Marker({
      map: mapRef.current,
      position: { lat, lng },
      title: 'Your location',
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#1d4ed8',
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      zIndex: 2000
    });

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
    };
  }, [mapReady, userLocation]);

  useEffect(() => {
    if (!mapReady || !window.google?.maps?.Geocoder || !showrooms.length) return;
    let cancelled = false;
    const geocoder = new window.google.maps.Geocoder();
    const placesService = window.google?.maps?.places && mapRef.current
      ? new window.google.maps.places.PlacesService(mapRef.current)
      : null;
    const cacheKey = 'mgnition_showroom_geocode_cache_v2';

    let cached = {};
    try {
      cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    } catch (_err) {
      cached = {};
    }

    const initialUpdates = {};
    showrooms.forEach((s) => {
      const k = showroomCoordKey(s);
      const hit = cached[k];
      const lat = Number(hit?.lat);
      const lng = Number(hit?.lng);
      const expectedProvince = normalizeProvince(provinceFromShowroom(s));
      const expectedPostal = postalFromAddress(s.address);
      const hitProvince = normalizeProvince(hit?.province || '');
      const hitPostal = String(hit?.postal || '').trim();
      const hitAddress = String(hit?.address || '').trim();
      const expectedAddress = String(s.address || '').trim();
      const metadataOk = hitProvince === expectedProvince
        && (!expectedPostal || !hitPostal || hitPostal === expectedPostal)
        && (!hitAddress || normalizeGeoText(hitAddress) === normalizeGeoText(expectedAddress));

      if (!Number.isNaN(lat) && !Number.isNaN(lng) && metadataOk) {
        initialUpdates[k] = { lat, lng };
      }
    });
    if (Object.keys(initialUpdates).length) {
      setResolvedCoordMap((prev) => ({ ...prev, ...initialUpdates }));
    }

    const geocodeAddress = (showroom, address) =>
      new Promise((resolve) => {
        geocoder.geocode({ address, region: 'th', componentRestrictions: { country: 'TH' } }, (results, status) => {
          if (status !== 'OK' || !Array.isArray(results) || !results.length) {
            if (!geocodeStatusWarnedRef.current[status]) {
              // eslint-disable-next-line no-console
              console.warn(`[showroom-map] geocode failed: ${status}`, { address });
              geocodeStatusWarnedRef.current[status] = true;
            }
            resolve(null);
            return;
          }
          resolve(pickBestGeocodeResult(results, showroom));
        });
      });

    const placeSearchAddress = (showroom, query) =>
      new Promise((resolve) => {
        if (!placesService) {
          resolve(null);
          return;
        }
        placesService.textSearch({ query, region: 'th' }, (results, status) => {
          if (status !== 'OK' || !Array.isArray(results) || !results.length) {
            resolve(null);
            return;
          }
          resolve(pickBestPlaceResult(results, showroom));
        });
      });

    (async () => {
      const runtimeUpdates = {};
      let cacheChanged = false;
      for (const s of showrooms) {
        if (cancelled) return;
        const k = showroomCoordKey(s);
        const base = parseShowroomCoord(s);
        const fromCache = initialUpdates[k];
        const current = fromCache || base;
        const shouldGeocode = Boolean(s.address) && (!current || !isInsideThailandBounds(current));
        if (!shouldGeocode) continue;
        const queryCandidates = [
          String(s.address || '').trim(),
          `${String(s.name || '').trim()}, ${String(s.address || '').trim()}`,
          `${String(s.name || '').trim()}, ${provinceFromShowroom(s)}, Thailand`,
        ].filter(Boolean);

        let geocoded = null;
        for (const q of queryCandidates) {
          // eslint-disable-next-line no-await-in-loop
          geocoded = await geocodeAddress(s, q);
          if (!geocoded) {
            // eslint-disable-next-line no-await-in-loop
            geocoded = await placeSearchAddress(s, q);
          }
          if (geocoded && isInsideThailandBounds(geocoded)) break;
        }
        if (!geocoded || !isInsideThailandBounds(geocoded)) continue;
        runtimeUpdates[k] = geocoded;
        cached[k] = {
          ...geocoded,
          province: provinceFromShowroom(s),
          postal: postalFromAddress(s.address),
          address: String(s.address || '').trim()
        };
        cacheChanged = true;
      }
      if (cancelled) return;
      if (Object.keys(runtimeUpdates).length) {
        setResolvedCoordMap((prev) => ({ ...prev, ...runtimeUpdates }));
      }
      if (cacheChanged) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(cached));
        } catch (_err) {
          // ignore storage errors
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mapReady, showrooms, showroomCoordKey]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let validCount = 0;

    showrooms.forEach((s) => {
      const key = showroomCoordKey(s);
      const coord = resolvedCoordMap[key] || parseShowroomCoord(s);
      if (!coord) return;
      const { lat, lng } = coord;

      const marker = new window.google.maps.Marker({
        map: mapRef.current,
        position: { lat, lng },
        title: s.name
      });

      marker.addListener('click', () => {
        onSelectShowroom({ ...s, lat, lng });
        if (!infoWindowRef.current) return;
        const distance = s.smartDistanceKm ? `${s.smartDistanceKm} km` : '-';
        const content = `
          <div style="max-width:280px;font-family:Arial,sans-serif;line-height:1.45;">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">${esc(s.name)}</div>
            <div style="font-size:13px;margin-bottom:6px;">${esc(s.address)}</div>
            <div style="font-size:12px;color:#444;">Phone: ${esc(s.phone || '-')}</div>
            <div style="font-size:12px;color:#444;">Distance: ${esc(distance)}</div>
          </div>
        `;
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.open({
          map: mapRef.current,
          anchor: marker
        });
      });
      markersRef.current.push(marker);
      bounds.extend({ lat, lng });
      validCount += 1;
    });

    if (validCount === 0 && showrooms.length) {
      const missing = showrooms
        .filter((s) => !(resolvedCoordMap[showroomCoordKey(s)] || parseShowroomCoord(s)))
        .map((s) => s.id || s.name);
      // eslint-disable-next-line no-console
      console.warn('[showroom-map] no valid marker coordinates for selected province', missing);
    }

    if (validCount > 1) {
      mapRef.current.fitBounds(bounds, 64);
    } else if (validCount === 1) {
      mapRef.current.setCenter(bounds.getCenter());
      mapRef.current.setZoom(12);
    } else {
      const userLat = parseCoordinateNumber(userLocation?.lat);
      const userLng = parseCoordinateNumber(userLocation?.lng);
      if (!Number.isNaN(userLat) && !Number.isNaN(userLng)) {
        mapRef.current.setCenter({ lat: userLat, lng: userLng });
        mapRef.current.setZoom(11);
      }
    }
  }, [esc, mapReady, onSelectShowroom, resolvedCoordMap, showroomCoordKey, showrooms, userLocation]);

  useEffect(() => {
    if (!mapRef.current || !selectedShowroom) return;
    const key = showroomCoordKey(selectedShowroom);
    const coord = resolvedCoordMap[key] || parseShowroomCoord(selectedShowroom);
    if (!coord) return;
    mapRef.current.panTo(coord);
    mapRef.current.setZoom(17);
  }, [resolvedCoordMap, selectedShowroom, showroomCoordKey]);

  if (!GOOGLE_MAPS_API_KEY || mapError) {
    return (
      <iframe
        title="map"
        src="https://www.openstreetmap.org/export/embed.html?bbox=99.8%2C13.3%2C100.9%2C14.2&layer=mapnik"
      />
    );
  }

  return <div ref={mapElRef} className="google-map-canvas" aria-label="Google showroom map" />;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [activeNav, setActiveNav] = useState('Home');
  const [pageHistory, setPageHistory] = useState(['home']);
  const backNavRef = useRef(false);
  const autoHydrateRecommendationsRef = useRef(false);
  const impressionLogRef = useRef({});
  const homeSliderRef = useRef(null);
  const [homeSlideIndex, setHomeSlideIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [selectedCar, setSelectedCar] = useState(null);
  const [detailFromRecommendation, setDetailFromRecommendation] = useState(false);
  const [results, setResults] = useState([]);
  const [recommendError, setRecommendError] = useState('');
  const [detailRating, setDetailRating] = useState(0);
  const [detailRatingLoading, setDetailRatingLoading] = useState(false);
  const [detailRatingMessage, setDetailRatingMessage] = useState('');
  const [detailRatingError, setDetailRatingError] = useState('');
  const [showMoreReasons, setShowMoreReasons] = useState(false);
  const [province, setProvince] = useState('Bangkok');
  const [loading, setLoading] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [compareCars, setCompareCars] = useState([]);
  const [compareError, setCompareError] = useState('');
  const [selectedShowroom, setSelectedShowroom] = useState(null);
  const [showroomPostal, setShowroomPostal] = useState('');
  const [showroomModelPref, setShowroomModelPref] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [routeDistanceKmByShowroom, setRouteDistanceKmByShowroom] = useState({});
  const [showroomGeoLoading, setShowroomGeoLoading] = useState(false);
  const [showroomGeoError, setShowroomGeoError] = useState('');
  const mapSectionRef = useRef(null);
  const [bookingForm, setBookingForm] = useState({ model: '', variant_key: '', notes: '' });
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [modelFilters, setModelFilters] = useState({
    search: '',
    fuel: 'All',
    seats: 'All',
    bodyType: 'All',
    colors: [],
    maxPrice: ''
  });

  const currentQuestion = quizQuestions[onboardingStep] || null;

  const [token, setToken] = useState(localStorage.getItem('mgnition_token') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const isGuest = !token;
  const isAdmin = Boolean(currentUser?.is_admin);
  const adminAllowedNav = ['Home', 'Our Models', 'Showrooms', 'About Us'];
  const visibleNavItems = isAdmin
    ? adminAllowedNav
    : isGuest
      ? NAV_ITEMS.filter((item) => !['Recommended Cars', 'Compare', 'Saved Results'].includes(item))
      : NAV_ITEMS;
  const hasCompletedQuiz = useMemo(() => {
    return quizQuestions.every((q) => {
      const value = answers?.[q.key];
      if (q.type === 'multi') return Array.isArray(value) && value.length > 0;
      return Boolean(String(value || '').trim());
    });
  }, [answers]);
  const noMatchSuggestions = useMemo(
    () => recommendationFixSuggestions(recommendError, answers),
    [recommendError, answers]
  );

  const isOnboardingOptionDisabled = useCallback(
    (questionKey, option) => {
      const selectedBudget = answers.budget || answers.budget_choice || '';
      const selectedFuel = answers.fuelType || answers.fuel_type || '';

      if (questionKey === 'budget' && isBelow700kBudget(option) && isEvChoice(selectedFuel)) return true;
      if (questionKey === 'fuelType' && isEvChoice(option) && isBelow700kBudget(selectedBudget)) return true;
      return false;
    },
    [answers]
  );

  const onboardingConstraintNotes = useMemo(() => {
    if (!currentQuestion) return [];
    const selectedBudget = answers.budget || answers.budget_choice || '';
    const selectedFuel = answers.fuelType || answers.fuel_type || '';
    const notes = [];

    if (currentQuestion.key === 'budget' && isEvChoice(selectedFuel)) {
      notes.push("EV starts at around ฿709,900, so 'Below 700,000 THB' is unavailable.");
    }
    if (currentQuestion.key === 'fuelType' && isBelow700kBudget(selectedBudget)) {
      notes.push("At 'Below 700,000 THB', EV currently has no available models.");
    }

    return notes;
  }, [currentQuestion, answers]);

  useEffect(() => {
    if (page === 'booking' && (isGuest || isAdmin)) {
      setPage('showrooms');
    }
  }, [page, isGuest, isAdmin]);

  useEffect(() => {
    setProfileForm({
      full_name: currentUser?.full_name || '',
      phone: currentUser?.phone || '',
      email: currentUser?.email || '',
    });
  }, [currentUser?.full_name, currentUser?.phone, currentUser?.email]);

  useEffect(() => {
    setShowMoreReasons(false);
    setDetailRating(0);
    setDetailRatingMessage('');
    setDetailRatingError('');
  }, [selectedCar?.variant_key, selectedCar?.model, selectedCar?.variant]);
  const [savedCars, setSavedCars] = useState([]);
  const resultReasonMap = useMemo(() => {
    const map = new Map();
    results.forEach((r) => {
      if (r?.variant_key) map.set(r.variant_key, r);
      if (r?.model) map.set(String(r.model).toLowerCase(), r);
    });
    return map;
  }, [results]);
  const savedKeySet = useMemo(() => {
    const set = new Set();
    savedCars.forEach((c) => {
      if (c?.variant_key) set.add(c.variant_key);
      if (c?.model) set.add(String(c.model).toLowerCase());
    });
    return set;
  }, [savedCars]);

  const [authMode, setAuthMode] = useState('login');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [signupForm, setSignupForm] = useState({ full_name: '', phone: '', email: '', password: '', confirm_password: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [resetForm, setResetForm] = useState({ email: '', token: '', new_password: '', confirm_password: '' });
  const [resetMessage, setResetMessage] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '', email: '' });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [publicPromotions, setPublicPromotions] = useState([]);
  const [publicBestSellers, setPublicBestSellers] = useState([]);
  const [publicCarOfMonth, setPublicCarOfMonth] = useState([]);
  const [carOfMonthScope, setCarOfMonthScope] = useState('monthly');
  const [carOfMonthPeriod, setCarOfMonthPeriod] = useState('');
  const [carOfMonthError, setCarOfMonthError] = useState('');
  const [adminAnalytics, setAdminAnalytics] = useState(null);
  const [adminBookings, setAdminBookings] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminPromotions, setAdminPromotions] = useState([]);
  const [adminBestSellers, setAdminBestSellers] = useState([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminSection, setAdminSection] = useState('overview');
  const [analyticsRange, setAnalyticsRange] = useState(() => ({
    start_date: daysAgoInputValue(29),
    end_date: daysAgoInputValue(0),
    granularity: 'day',
    top_n: 5
  }));
  const [adminAnalyticsRangeData, setAdminAnalyticsRangeData] = useState(null);
  const [adminAnalyticsRangeLoading, setAdminAnalyticsRangeLoading] = useState(false);
  const [adminAnalyticsRangeError, setAdminAnalyticsRangeError] = useState('');
  const promoImageInputRef = useRef(null);
  const [promoImageName, setPromoImageName] = useState('');
  const [promoForm, setPromoForm] = useState({
    title: '',
    description: '',
    price_text: '',
    badge_text: '',
    image_url: '',
    model_name: '',
    variant_key: '',
    variant_name: '',
    start_date: '',
    end_date: ''
  });
  const [bestSellerForm, setBestSellerForm] = useState({
    model_name: '',
    variant_key: '',
    variant_name: '',
    rank: ''
  });

  const variantRows = useMemo(() => modelVariantsData.filter((r) => r.Model), []);
  const variantByKey = useMemo(() => {
    const map = new Map();
    variantRows.forEach((row) => {
      const key = `${row.Model || ''}|${row.Variant || ''}|${row.Year || ''}`;
      map.set(key, row);
    });
    return map;
  }, [variantRows]);

  const modelVariantKeyMap = useMemo(() => {
    const map = new Map();
    variantRows.forEach((row) => {
      if (!row.Model) return;
      const key = `${row.Model || ''}|${row.Variant || ''}|${row.Year || ''}`;
      if (!map.has(row.Model)) {
        map.set(row.Model, key);
      }
    });
    return map;
  }, [variantRows]);

  const impressionKeyForCar = useCallback(
    (car) => {
      if (!car) return '';
      return car.variant_key || modelVariantKeyMap.get(car.model) || '';
    },
    [modelVariantKeyMap]
  );

  const logImpressions = useCallback(
    async (variantKeys, source) => {
      const cleaned = (variantKeys || []).map((v) => String(v || '').trim()).filter(Boolean);
      if (!cleaned.length) return;
      const bucket = impressionLogRef.current[source] || new Set();
      const fresh = cleaned.filter((k) => !bucket.has(k));
      if (!fresh.length) return;
      fresh.forEach((k) => bucket.add(k));
      impressionLogRef.current[source] = bucket;

      try {
        await fetch(`${API_BASE}/impressions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ variant_keys: fresh, source })
        });
      } catch {
        // ignore logging failures
      }
    },
    [token]
  );

  const modelDefaults = useMemo(() => {
    const byModel = {};
    variantRows.forEach((row) => {
      const name = row.Model;
      if (!name || byModel[name]) return;
      const colorImages = extractColorImageMap(row);
      byModel[name] = {
        defaultColor: Object.keys(colorImages)[0] || '',
        colorImages
      };
    });
    return byModel;
  }, [variantRows]);

  const baseModels = useMemo(() => {
    return modelsData
      .filter((m) => m.model)
      .map((m) => ({
        ...m,
        colorImages: m.colorImages || m.color_images || modelDefaults[m.model]?.colorImages || {},
        defaultColor: m.defaultColor || m.default_color || modelDefaults[m.model]?.defaultColor || ''
      }));
  }, [modelDefaults]);
  const models = useMemo(() => [...baseModels], [baseModels]);
  const modelByName = useMemo(() => {
    const map = new Map();
    models.forEach((m) => map.set(normModelName(m.model), m));
    return map;
  }, [models]);

  const authCarImage = useMemo(() => {
    const preferred =
      models.find((m) => m.model.toLowerCase().includes('mg4')) ||
      models.find((m) => m.model.toLowerCase().includes('mg5')) ||
      models[0];
    return preferred ? modelImage(preferred) : fallbackModelImages.default;
  }, [models]);

  const bestSellerCars = useMemo(() => {
    if (publicBestSellers.length) {
      return publicBestSellers
        .map((item) => {
          const row = item.variant_key ? variantByKey.get(item.variant_key) : null;
          const base = row
            ? {
                variant_key: item.variant_key,
                model: row.Model,
                variant: row.Variant || item.variant_name || '',
                year: row.Year || '',
                price: row.Price_THB ? `${fmtNumber(row.Price_THB)} THB` : '',
                fuel: row.Fuel_Type || '',
                seats: row.Seats || '',
                bodyType: row.Body_Type || '',
                imagePageUrl: row.Image_URL || ''
              }
            : {
                model: item.model_name || '',
                variant: item.variant_name || '',
                variant_key: item.variant_key || '',
                price: ''
              };
          return hydrateSavedCar(base, variantByKey, modelByName);
        })
        .filter(Boolean);
    }
    const wanted = ['MG 3 Hybrid+', 'MG5', 'MG ZS'];
    const list = wanted
      .map((name) => models.find((m) => m.model.toLowerCase().includes(name.toLowerCase())))
      .filter(Boolean);
    return list.length ? list : models.slice(0, 3);
  }, [publicBestSellers, models, variantByKey, modelByName]);

  useEffect(() => {
    if (page !== 'home') return;
    const keys = bestSellerCars.map(impressionKeyForCar).filter(Boolean);
    logImpressions(keys, 'best_sellers');
  }, [page, bestSellerCars, impressionKeyForCar, logImpressions]);

  const carOfMonthCars = useMemo(() => {
    return (publicCarOfMonth || [])
      .slice(0, 1)
      .map((item) =>
        hydrateSavedCar(
          {
            variant_key: item.variant_key || '',
            model: item.model || '',
            variant: item.variant || '',
            year: item.year || '',
            price: item.price || item.starting_price || '',
            fuel: item.fuel || '',
            seats: item.seats || '',
            bodyType: item.bodyType || item.body_type || '',
            imagePageUrl: item.imagePageUrl || item.image_url || ''
          },
          variantByKey,
          modelByName
        )
      )
      .filter(Boolean);
  }, [publicCarOfMonth, variantByKey, modelByName]);

  useEffect(() => {
    if (page !== 'home') return;
    const keys = carOfMonthCars.map(impressionKeyForCar).filter(Boolean);
    logImpressions(keys, 'car_of_month');
  }, [page, carOfMonthCars, impressionKeyForCar, logImpressions]);

  const promoCars = useMemo(() => {
    const a = models.find((m) => m.model.toLowerCase().includes('vs hev')) || models.find((m) => m.model.toLowerCase().includes('mg5'));
    const b = models.find((m) => m.model.toLowerCase().includes('mg4')) || models[1];
    return [a, b].filter(Boolean);
  }, [models]);

  const bangkokShowrooms = useMemo(() => showroomsData.filter((s) => isBangkokShowroom(s)), []);
  const provinceOptions = useMemo(() => {
    const all = [...new Set(showroomsData.map((s) => provinceFromShowroom(s)))].filter(Boolean).sort();
    return all.length ? all : ['Bangkok'];
  }, []);

  const filteredShowrooms = useMemo(() => {
    const selected = normalizeProvince(province);
    return showroomsData.filter((s) => normalizeProvince(provinceFromShowroom(s)) === selected);
  }, [province]);

  const showroomModelOptions = useMemo(() => {
    return [...new Set(models.map((m) => m.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator?.geolocation) {
      setShowroomGeoError('Geolocation is not available in this browser.');
      return;
    }
    setShowroomGeoLoading(true);
    setShowroomGeoError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position?.coords?.latitude);
        const lng = Number(position?.coords?.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
          setShowroomGeoError('Could not read your location coordinates.');
          setShowroomGeoLoading(false);
          return;
        }
        const current = { lat, lng };
        setUserLocation(current);

        let nearest = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        showroomsData.forEach((s) => {
          const d = haversineKm(lat, lng, s.lat, s.lng);
          if (d === null || d >= nearestDistance) return;
          nearest = s;
          nearestDistance = d;
        });
        if (nearest) {
          setProvince(provinceFromShowroom(nearest));
          setSelectedShowroom(nearest);
        }

        setShowroomGeoLoading(false);
      },
      (err) => {
        const msg =
          err?.code === 1
            ? 'Location permission denied. Please allow location access and try again.'
            : err?.code === 3
              ? 'Location request timed out. Please try again.'
              : 'Unable to get your location right now.';
        setShowroomGeoError(msg);
        setShowroomGeoLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      }
    );
  }, []);

  const focusShowroomOnMap = useCallback((showroom, shouldScroll = false) => {
    if (!showroom) return;
    setSelectedShowroom(showroom);
    if (page !== 'map') setPage('map');
    if (shouldScroll || page !== 'map') {
      window.setTimeout(() => {
        mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [page]);

  const showroomKey = useCallback((s) => String(s?.id || `${s?.name || ''}|${s?.address || ''}`), []);
  const selectedShowroomKey = useMemo(
    () => showroomKey(selectedShowroom),
    [selectedShowroom, showroomKey]
  );

  useEffect(() => {
    let cancelled = false;
    const originLat = parseCoordinateNumber(userLocation?.lat);
    const originLng = parseCoordinateNumber(userLocation?.lng);
    if (Number.isNaN(originLat) || Number.isNaN(originLng) || !filteredShowrooms.length || !GOOGLE_MAPS_API_KEY) {
      setRouteDistanceKmByShowroom({});
      return undefined;
    }

    const toChunks = (list, size) => {
      const out = [];
      for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
      return out;
    };

    const destinations = filteredShowrooms
      .map((s) => {
        const coord = parseShowroomCoord(s);
        const destination = coord || String(s.address || '').trim() || String(s.name || '').trim();
        if (!destination) return null;
        return { key: showroomKey(s), destination };
      })
      .filter(Boolean);
    if (!destinations.length) {
      setRouteDistanceKmByShowroom({});
      return undefined;
    }

    const run = async () => {
      try {
        await loadGoogleMapsScript(GOOGLE_MAPS_API_KEY);
        if (!window.google?.maps?.DistanceMatrixService) {
          if (!cancelled) setRouteDistanceKmByShowroom({});
          return;
        }

        const service = new window.google.maps.DistanceMatrixService();
        const all = {};
        const chunks = toChunks(destinations, 25);
        for (const chunk of chunks) {
          // eslint-disable-next-line no-await-in-loop
          const elements = await new Promise((resolve, reject) => {
            service.getDistanceMatrix(
              {
                origins: [{ lat: originLat, lng: originLng }],
                destinations: chunk.map((x) => x.destination),
                travelMode: window.google.maps.TravelMode.DRIVING,
                unitSystem: window.google.maps.UnitSystem.METRIC,
              },
              (response, status) => {
                if (status !== 'OK' || !response?.rows?.[0]?.elements) {
                  reject(new Error(status || 'DISTANCE_ERROR'));
                  return;
                }
                resolve(response.rows[0].elements);
              }
            );
          });

          chunk.forEach((item, idx) => {
            const element = elements[idx];
            const meters = Number(element?.distance?.value);
            if (element?.status === 'OK' && Number.isFinite(meters)) {
              all[item.key] = meters / 1000;
            }
          });
        }

        if (!cancelled) setRouteDistanceKmByShowroom(all);
      } catch (_err) {
        if (!cancelled) setRouteDistanceKmByShowroom({});
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [filteredShowrooms, showroomKey, userLocation]);

  const showroomTarget = useMemo(() => {
    const userLat = parseCoordinateNumber(userLocation?.lat);
    const userLng = parseCoordinateNumber(userLocation?.lng);
    if (!Number.isNaN(userLat) && !Number.isNaN(userLng)) {
      return { lat: userLat, lng: userLng };
    }
    if (!filteredShowrooms.length) return null;
    const postal = String(showroomPostal || '').trim();
    const withPostal = filteredShowrooms.map((s) => ({ ...s, postal: postalFromAddress(s.address) }));

    const averageCenter = (list) => {
      if (!list.length) return null;
      const points = list
        .map((x) => ({ lat: parseCoordinateNumber(x.lat), lng: parseCoordinateNumber(x.lng) }))
        .filter((x) => !Number.isNaN(x.lat) && !Number.isNaN(x.lng));
      if (!points.length) return null;
      const lat = points.reduce((a, b) => a + b.lat, 0) / points.length;
      const lng = points.reduce((a, b) => a + b.lng, 0) / points.length;
      return { lat, lng };
    };

    if (postal.length >= 3) {
      const by3 = withPostal.filter((s) => s.postal && s.postal.startsWith(postal.slice(0, 3)));
      const c3 = averageCenter(by3);
      if (c3) return c3;
    }
    if (postal.length >= 2) {
      const by2 = withPostal.filter((s) => s.postal && s.postal.startsWith(postal.slice(0, 2)));
      const c2 = averageCenter(by2);
      if (c2) return c2;
    }
    return averageCenter(withPostal);
  }, [filteredShowrooms, showroomPostal, userLocation]);

  const smartShowrooms = useMemo(() => {
    const postal = String(showroomPostal || '').trim();
    return filteredShowrooms
      .map((s) => {
        const sPostal = postalFromAddress(s.address);
        let score = 20; // province match
        const reasons = ['Province match'];

        if (postal) {
          if (sPostal === postal) {
            score += 35;
            reasons.push('Exact postal code match');
          } else if (postal.length >= 3 && sPostal.startsWith(postal.slice(0, 3))) {
            score += 22;
            reasons.push('Postal zone match');
          } else if (postal.length >= 2 && sPostal.startsWith(postal.slice(0, 2))) {
            score += 12;
            reasons.push('Nearby postal prefix');
          }
        }

        let dist = null;
        if (showroomTarget) {
          const routed = routeDistanceKmByShowroom[showroomKey(s)];
          dist = Number.isFinite(routed)
            ? routed
            : haversineKm(showroomTarget.lat, showroomTarget.lng, s.lat, s.lng);
          if (dist !== null) {
            const distanceBonus = Math.max(0, 24 - dist * 2.1);
            score += distanceBonus;
            reasons.push(`Distance score (${dist.toFixed(1)} km)`);
          }
        }

        if (showroomModelPref) {
          score += 4;
          reasons.push(`Model preference captured (${showroomModelPref})`);
        }

        return {
          ...s,
          matchScore: Number(score.toFixed(1)),
          smartDistanceKm: dist !== null ? dist.toFixed(1) : estimateDistanceKm(s.lat, s.lng, province),
          reasons: reasons.slice(0, 3),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore || Number(a.smartDistanceKm || 0) - Number(b.smartDistanceKm || 0));
  }, [filteredShowrooms, province, routeDistanceKmByShowroom, showroomKey, showroomModelPref, showroomPostal, showroomTarget]);

  useEffect(() => {
    if (!smartShowrooms.length) {
      setSelectedShowroom(null);
      return;
    }
    if (!selectedShowroom) return;
    const found = smartShowrooms.some((s) => String(s.id) === String(selectedShowroom.id));
    if (!found) setSelectedShowroom(smartShowrooms[0]);
  }, [selectedShowroom, smartShowrooms]);

  const selectedModelVariants = useMemo(() => {
    if (!selectedCar?.model) return [];
    const selected = normModelName(selectedCar.model);
    const exact = variantRows.filter((r) => normModelName(r.Model) === selected);
    if (exact.length) return exact;
    return variantRows.filter((r) => {
      const model = normModelName(r.Model);
      return model.includes(selected) || selected.includes(model);
    });
  }, [selectedCar, variantRows]);

  const selectedVariant = useMemo(() => {
    if (!selectedModelVariants.length) return null;
    const match = selectedModelVariants.find((v, idx) => `${v.Model}|${v.Variant || ''}|${v.Year || ''}|${idx}` === selectedVariantId);
    return match || selectedModelVariants[0];
  }, [selectedModelVariants, selectedVariantId]);
  const selectedVariantKey = useMemo(
    () => (selectedVariant ? `${selectedVariant.Model}|${selectedVariant.Variant || ''}|${selectedVariant.Year || ''}` : ''),
    [selectedVariant]
  );

  useEffect(() => {
    if (page !== 'details') return;
    const key = selectedVariantKey || impressionKeyForCar(selectedCar);
    if (key) {
      logImpressions([key], 'details');
    }
  }, [page, selectedVariantKey, selectedCar, impressionKeyForCar, logImpressions]);

  const selectedVariantColorMap = useMemo(() => extractColorImageMap(selectedVariant), [selectedVariant]);
  const selectedVariantColors = useMemo(() => {
    const fromMap = Object.keys(selectedVariantColorMap || {});
    if (fromMap.length) return fromMap;
    return extractVariantColors(selectedVariant);
  }, [selectedVariant, selectedVariantColorMap]);

  useEffect(() => {
    if (!selectedModelVariants.length) {
      setSelectedVariantId('');
      return;
    }
    const id = `${selectedModelVariants[0].Model}|${selectedModelVariants[0].Variant || ''}|${selectedModelVariants[0].Year || ''}|0`;
    setSelectedVariantId(id);
  }, [selectedCar, selectedModelVariants]);

  useEffect(() => {
    if (!selectedVariantColors.length) {
      setSelectedColor('');
      return;
    }
    setSelectedColor(selectedVariantColors[0]);
  }, [selectedVariantColors]);

  const modelFilterChoices = useMemo(() => {
    return {
      fuels: ['All', ...new Set(models.map((m) => m.fuel).filter(Boolean))],
      seats: ['All', ...new Set(models.map((m) => String(m.seats || '').replace('.0', '')).filter(Boolean))],
      bodyTypes: ['All', ...new Set(models.map((m) => m.bodyType).filter(Boolean))]
    };
  }, [models]);

  const promoModelOptions = useMemo(() => {
    return [...new Set(variantRows.map((r) => String(r.Model || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [variantRows]);

  const promoVariantOptions = useMemo(() => {
    if (!promoForm.model_name) return [];
    return variantRows
      .filter((r) => normModelName(r.Model) === normModelName(promoForm.model_name))
      .map((r) => ({
        key: `${r.Model}|${r.Variant || ''}|${r.Year || ''}`,
        label: `${r.Variant || 'Base'}${r.Year ? ` (${String(r.Year).replace('.0', '')})` : ''}`
      }));
  }, [promoForm.model_name, variantRows]);

  const bestSellerModelOptions = useMemo(() => {
    return [...new Set(models.map((m) => String(m.model || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const bestSellerVariantOptions = useMemo(() => {
    if (!bestSellerForm.model_name) return [];
    return variantRows
      .filter((r) => normModelName(r.Model) === normModelName(bestSellerForm.model_name))
      .map((r) => ({
        key: `${r.Model}|${r.Variant || ''}|${r.Year || ''}`,
        label: `${r.Variant || 'Base'}${r.Year ? ` (${String(r.Year).replace('.0', '')})` : ''}`
      }));
  }, [bestSellerForm.model_name, variantRows]);

  const bookingModelOptions = useMemo(() => {
    return [...new Set(models.map((m) => String(m.model || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const bookingVariantOptions = useMemo(() => {
    if (!bookingForm.model) return [];
    return variantRows
      .filter((r) => normModelName(r.Model) === normModelName(bookingForm.model))
      .map((r) => ({
        key: `${r.Model}|${r.Variant || ''}|${r.Year || ''}`,
        label: `${r.Variant || 'Base'}${r.Year ? ` (${String(r.Year).replace('.0', '')})` : ''}`
      }));
  }, [bookingForm.model, variantRows]);

  const detailPromotions = useMemo(() => {
    if (!selectedCar) return [];
    const model = normModelName(selectedCar.model);
    return publicPromotions.filter((p) => {
      const promoVariantKey = String(p.variant_key || '').trim();
      const selectedKey = String(selectedVariantKey || '').trim();

      if (promoVariantKey && selectedKey && promoVariantKey === selectedKey) return true;
      if (p.model_name && normModelName(p.model_name) === model) return true;
      return false;
    });
  }, [publicPromotions, selectedCar, selectedVariantKey]);

  const resolvePromotionImage = (promo) => {
    if (!promo) return fallbackModelImages.default;
    if (promo.variant_key) {
      const row = variantByKey.get(promo.variant_key);
      if (row) {
        const m = extractColorImageMap(row);
        const first = Object.values(m)[0];
        if (first) return first;
      }
    }
    if (promo.model_name) {
      const modelMatch = modelByName.get(normModelName(promo.model_name));
      if (modelMatch) return modelImage(modelMatch);
    }
    return promo.image_url || fallbackModelImages.default;
  };

  const buildComparisonItem = (car) => {
    const baseKey = savedCarKey(car);
    const rowFromKey = variantByKey.get(baseKey);
    const rowFromModel =
      rowFromKey ||
      variantRows.find((r) => normModelName(r.Model) === normModelName(car.model) && (!car.variant || String(r.Variant || '').trim() === String(car.variant || '').trim())) ||
      variantRows.find((r) => normModelName(r.Model) === normModelName(car.model));

    return {
      key: baseKey,
      model: car.model || rowFromModel?.Model || 'MG Model',
      variant: car.variant || rowFromModel?.Variant || '',
      year: car.year || rowFromModel?.Year || '',
      image: modelImage(car),
      price: car.price || (rowFromModel?.Price_THB ? `${fmtNumber(rowFromModel.Price_THB)} THB` : 'N/A'),
      fuel: car.fuel || rowFromModel?.Fuel_Type || 'N/A',
      seats: String(car.seats || rowFromModel?.Seats || '').replace('.0', '') || 'N/A',
      bodyType: car.bodyType || rowFromModel?.Body_Type || 'N/A',
      rangeKm: rowFromModel?.Range_km ? `${fmtNumber(rowFromModel.Range_km)} km` : 'N/A',
      horsepower: rowFromModel?.Horsepower_hp ? `${fmtNumber(rowFromModel.Horsepower_hp)} hp` : 'N/A',
      torque: rowFromModel?.Torque_Nm ? `${fmtNumber(rowFromModel.Torque_Nm)} Nm` : 'N/A',
      cargo: rowFromModel?.Cargo_Liters ? `${fmtNumber(rowFromModel.Cargo_Liters)} L` : 'N/A',
      wheelbase: rowFromModel?.Wheelbase_mm ? `${fmtNumber(rowFromModel.Wheelbase_mm)} mm` : 'N/A',
      dimensions:
        rowFromModel?.Length_mm && rowFromModel?.Width_mm && rowFromModel?.Height_mm
          ? `${fmtNumber(rowFromModel.Length_mm)} x ${fmtNumber(rowFromModel.Width_mm)} x ${fmtNumber(rowFromModel.Height_mm)} mm`
          : 'N/A',
    };
  };

  const selectedDetailVariantForCompare = useMemo(() => {
    if (!selectedCar) return null;
    if (selectedVariant) {
      return {
        ...selectedCar,
        model: selectedVariant.Model || selectedCar.model,
        variant: selectedVariant.Variant || selectedCar.variant,
        year: selectedVariant.Year || selectedCar.year,
        variant_key: selectedVariantKey || selectedCar.variant_key,
        price: selectedVariant.Price_THB ? `${fmtNumber(selectedVariant.Price_THB)} THB` : selectedCar.price,
        fuel: selectedVariant.Fuel_Type || selectedCar.fuel,
        seats: selectedVariant.Seats || selectedCar.seats,
        bodyType: selectedVariant.Body_Type || selectedCar.bodyType,
      };
    }
    return selectedCar;
  }, [selectedCar, selectedVariant, selectedVariantKey]);

  const modelPriceBounds = useMemo(() => {
    const prices = models.map((m) => priceToNumber(m.price || '')).filter((n) => n > 0);
    if (!prices.length) return { min: 0, max: 2000000 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [models]);

  const defaultPriceValue = modelPriceBounds.max;
  const modelPriceValue = priceToNumber(modelFilters.maxPrice || defaultPriceValue);
  const priceSpan = Math.max(modelPriceBounds.max - modelPriceBounds.min, 1);
  const pricePercent = Math.min(
    100,
    Math.max(0, ((modelPriceValue - modelPriceBounds.min) / priceSpan) * 100)
  );

  const filteredModels = useMemo(() => {
    const search = modelFilters.search.trim().toLowerCase();
    const maxPrice = priceToNumber(modelFilters.maxPrice || modelPriceValue);
    return models.filter((m) => {
      const modelName = String(m.model || '').toLowerCase();
      const variantName = String(m.variant || '').toLowerCase();
      const haystack = `${modelName} ${variantName}`.trim();
      const priceNum = priceToNumber(m.price || '');
      const modelColors = collectModelColors(m, variantRows);
      const fuelValue = String(m.fuel || '').toLowerCase();

      if (search && !haystack.includes(search)) return false;
      if (modelFilters.fuel !== 'All') {
        const selectedFuel = String(modelFilters.fuel || '').toLowerCase();
        if (selectedFuel === 'hybrid') {
          if (!(fuelValue.includes('hybrid') || fuelValue.includes('plug-in hybrid') || fuelValue.includes('phev'))) {
            return false;
          }
        } else if (m.fuel !== modelFilters.fuel) {
          return false;
        }
      }
      if (modelFilters.seats !== 'All' && String(m.seats || '').replace('.0', '') !== modelFilters.seats) return false;
      if (modelFilters.bodyType !== 'All' && m.bodyType !== modelFilters.bodyType) return false;
      if (maxPrice && !Number.isNaN(priceNum) && priceNum > maxPrice) return false;
      if (modelFilters.colors.length && !modelFilters.colors.some((c) => modelColors.includes(c))) return false;
      return true;
    });
  }, [models, modelFilters, modelPriceValue]);

  useEffect(() => {
    if (page !== 'models') return;
    const keys = filteredModels.map(impressionKeyForCar).filter(Boolean);
    logImpressions(keys, 'models');
  }, [page, filteredModels, impressionKeyForCar, logImpressions]);

  const availableFilterColors = useMemo(() => {
    const set = new Set();
    models.forEach((m) => collectModelColors(m, variantRows).forEach((c) => set.add(c)));
    const order = ['Black', 'White', 'Grey', 'Silver', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Brown', 'Beige', 'Pink', 'Purple'];
    return order.filter((c) => set.has(c));
  }, [models, variantRows]);

  const refreshPublicPromotions = () => {
    fetch(`${API_BASE}/public/promotions`)
      .then((r) => r.json())
      .then((d) => setPublicPromotions(d.promotions || []))
      .catch(() => {});
  };

  const refreshPublicBestSellers = () => {
    fetch(`${API_BASE}/public/best-sellers`)
      .then((r) => r.json())
      .then((d) => setPublicBestSellers(d.best_sellers || []))
      .catch(() => {});
  };

  const refreshPublicCarOfMonth = () => {
    return fetch(`${API_BASE}/public/car-of-the-month`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setPublicCarOfMonth(d.cars || []);
        setCarOfMonthScope(d.scope || 'monthly');
        setCarOfMonthPeriod(d.period || '');
        setCarOfMonthError('');
      })
      .catch((err) => {
        setPublicCarOfMonth([]);
        setCarOfMonthError(err?.message || 'Unable to load car of the month.');
      });
  };

  const refreshAdminPromotions = () => {
    if (!token) return;
    fetch(`${API_BASE}/admin/promotions`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((d) => setAdminPromotions(d.promotions || []))
      .catch(() => {});
  };

  const refreshAdminBestSellers = () => {
    if (!token) return;
    fetch(`${API_BASE}/admin/best-sellers`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((d) => setAdminBestSellers(d.best_sellers || []))
      .catch(() => {});
  };

  const refreshAdminAnalyticsRange = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (analyticsRange.start_date) params.set('start_date', analyticsRange.start_date);
    if (analyticsRange.end_date) params.set('end_date', analyticsRange.end_date);
    if (analyticsRange.granularity) params.set('granularity', analyticsRange.granularity);
    if (analyticsRange.top_n) params.set('top_n', String(analyticsRange.top_n));

    setAdminAnalyticsRangeLoading(true);
    setAdminAnalyticsRangeError('');
    fetch(`${API_BASE}/admin/analytics?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((d) => setAdminAnalyticsRangeData(d))
      .catch((err) => setAdminAnalyticsRangeError(err?.message || 'Unable to load range analytics.'))
      .finally(() => setAdminAnalyticsRangeLoading(false));
  }, [token, analyticsRange]);

  const resetModelFilters = () => {
    setModelFilters({
      search: '',
      fuel: 'All',
      seats: 'All',
      bodyType: 'All',
      colors: [],
      maxPrice: ''
    });
  };


  useEffect(() => {
    refreshPublicPromotions();
    refreshPublicBestSellers();
    refreshPublicCarOfMonth();
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => {
        if (!r.ok) throw new Error('Invalid session');
        return r.json();
      })
      .then((data) => {
        setCurrentUser(data.user);
        setAnswers(data.profile?.quiz_answers || {});
        setSavedCars((data.saved_models || []).map((x) => hydrateSavedCar(x, variantByKey, modelByName)));
        refreshPublicCarOfMonth();
      })
      .catch(() => {
        localStorage.removeItem('mgnition_token');
        setToken('');
        setCurrentUser(null);
        setSavedCars([]);
      });
  }, [token, variantByKey, modelByName]);

  useEffect(() => {
    if (page !== 'home') return;
    refreshPublicCarOfMonth();
  }, [page]);

  useEffect(() => {
    if (page !== 'admin' || !token || !currentUser?.is_admin) return;
    fetch(`${API_BASE}/admin/analytics`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((d) => setAdminAnalytics(d))
      .catch(() => {});

    fetch(`${API_BASE}/admin/bookings`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((d) => setAdminBookings(d.bookings || []))
      .catch(() => {});

    fetch(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => r.json())
      .then((d) => setAdminUsers(d.users || []))
      .catch(() => {});

    refreshAdminPromotions();
    refreshAdminBestSellers();
  }, [page, token, currentUser]);

  useEffect(() => {
    if (page !== 'admin' || adminSection !== 'analytics' || !token || !currentUser?.is_admin) return;
    refreshAdminAnalyticsRange();
  }, [page, adminSection, token, currentUser, refreshAdminAnalyticsRange]);

  useEffect(() => {
    if (page === 'onboarding') setOnboardingStep(0);
  }, [page]);

  useEffect(() => {
    if (isGuest || isAdmin) {
      if (page === 'results' || page === 'compare' || page === 'saved') {
        setActiveNav('Home');
        setPage('home');
      }
    }
  }, [isGuest, isAdmin, page]);

  useEffect(() => {
    setPageHistory((prev) => {
      if (backNavRef.current) {
        backNavRef.current = false;
        return prev;
      }
      if (prev[prev.length - 1] === page) return prev;
      return [...prev, page];
    });
  }, [page]);

  const handleBack = () => {
    setPageHistory((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const target = next[next.length - 1];
      backNavRef.current = true;
      setPage(target);
      setActiveNav(navLabelForPage(target));
      return next;
    });
  };

  const scrollToHomeSlide = useCallback((index) => {
    const slider = homeSliderRef.current;
    if (!slider) return;
    const clampedIndex = Math.max(0, Math.min(index, 1));
    slider.scrollTo({ left: clampedIndex * slider.clientWidth, behavior: 'smooth' });
  }, []);

  const scrollToHomeContent = useCallback(() => {
    scrollToHomeSlide(1);
  }, [scrollToHomeSlide]);

  const handleHomeSliderScroll = useCallback((event) => {
    const slider = event.currentTarget;
    const width = slider.clientWidth || 1;
    const nextIndex = Math.round(slider.scrollLeft / width);
    setHomeSlideIndex((prev) => (prev === nextIndex ? prev : nextIndex));
  }, []);

  useEffect(() => {
    if (page !== 'home') return;
    setHomeSlideIndex(0);
    requestAnimationFrame(() => scrollToHomeSlide(0));
  }, [page, scrollToHomeSlide]);

  const onNav = (item) => {
    setActiveNav(item);
    if (item === 'Home') setPage('home');
    if (item === 'Our Models') setPage('models');
    if (item === 'Recommended Cars') setPage('results');
    if (item === 'Compare') setPage('compare');
    if (item === 'Saved Results') {
      if (!token) {
        setPage('auth');
        return;
      }
      setPage('saved');
    }
    if (item === 'Showrooms') setPage('showrooms');
    if (item === 'About Us') setPage('about');
    if (item === 'Admin Dashboard') {
      if (!currentUser?.is_admin) return;
      setPage('admin');
    }
  };

  const getFilteredLocalResults = () => {
    const budget = (answers.budget || '').toLowerCase();
    const fuel = (answers.fuelType || '').toLowerCase();
    const seats = (answers.seats || '').toLowerCase();

    return models
      .filter((m) => {
        const fuelOK = !fuel || m.fuel.toLowerCase().includes(fuel.split(' ')[0]);
        const seatsOK = !seats || String(m.seats).replace('.0', '').includes(seats.replace(/[^0-9+\-]/g, '').slice(0, 1));

        let budgetOK = true;
        const price = Number(String(m.price || '').replace(/[^\d]/g, ''));
        if (budget.includes('below 700')) budgetOK = price <= 700000;
        if (budget.includes('700,000') && budget.includes('999')) budgetOK = price >= 700000 && price <= 999999;
        if (budget.includes('1,000,000')) budgetOK = price >= 1000000 && price <= 1299999;
        if (budget.includes('1,300,000')) budgetOK = price >= 1300000;

        return fuelOK && seatsOK && budgetOK;
      })
      .slice(0, 3);
  };

  const ensureMinResults = (primary, fallback, minCount = 3) => {
    const seen = new Set();
    const out = [];
    const add = (item) => {
      if (!item) return;
      const key = savedCarKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };
    (primary || []).forEach(add);
    (fallback || []).forEach(add);
    return out.slice(0, minCount);
  };

  const onGetResults = async (targetPage = 'results', options = {}) => {
    const { silent = false, persistProfile = true } = options;
    setLoading(true);
    setRecommendError('');
    try {
      const payload = {
        ...answers,
        hobbies: Array.isArray(answers.hobbies)
          ? answers.hobbies
          : String(answers.hobbies || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
        preferredColors: Array.isArray(answers.preferredColors)
          ? answers.preferredColors
          : String(answers.preferredColors || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
      };

      if (token && persistProfile) {
        await fetch(`${API_BASE}/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ quiz_answers: payload })
        });
      }

      const res = await fetch(API_RECOMMEND, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || 'Recommendation engine unavailable.');
      }
      const data = await res.json();
      const mapped = mapApiResultsToModels(data.recommendations || data.results || [], models, variantByKey);
      if (!mapped.length) {
        setResults([]);
        setRecommendError(data.message || 'No matching cars found for your current preferences.');
        return;
      }
      const constrainedLocal = getFilteredLocalResults();
      const base = mapped.length ? mapped : constrainedLocal;
      // Do not inject unrelated models from global pools; keep fallback constrained.
      const merged = ensureMinResults(base, constrainedLocal, 3);
      setResults(merged.length ? merged : base);
    } catch (err) {
      setResults([]);
      setRecommendError(err?.message || 'Recommendation engine unavailable.');
    } finally {
      setLoading(false);
      if (!silent) {
        setActiveNav(targetPage === 'home' ? 'Home' : 'Recommended Cars');
        setPage(targetPage);
      }
    }
  };

  useEffect(() => {
    autoHydrateRecommendationsRef.current = false;
  }, [token]);

  useEffect(() => {
    if (!token || isAdmin || !hasCompletedQuiz) return;
    if (results.length > 0) {
      autoHydrateRecommendationsRef.current = true;
      return;
    }
    if (loading || autoHydrateRecommendationsRef.current) return;
    autoHydrateRecommendationsRef.current = true;
    onGetResults('home', { silent: true, persistProfile: false });
  }, [token, isAdmin, hasCompletedQuiz, results.length, loading]);

  const handleAddBestSeller = async (e) => {
    e.preventDefault();
    if (!token) return;
    try {
      const chosenVariant = bestSellerVariantOptions.find((v) => v.key === bestSellerForm.variant_key);
      const payload = {
        model_name: bestSellerForm.model_name,
        variant_key: bestSellerForm.variant_key,
        variant_name: chosenVariant?.label || bestSellerForm.variant_name || '',
        rank: bestSellerForm.rank
      };
      const res = await fetch(`${API_BASE}/admin/best-sellers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add best seller.');
      setAdminBestSellers(data.best_sellers || []);
      refreshPublicBestSellers();
      setBestSellerForm({ model_name: '', variant_key: '', variant_name: '', rank: '' });
      setAdminMessage('Best seller added.');
    } catch (err) {
      setAdminMessage(err.message);
    }
  };

  const handleBookingStatus = async (id, status) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/admin/bookings/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (res.ok && data.booking) {
        setAdminBookings((prev) => prev.map((row) => (row.id === id ? data.booking : row)));
      }
    } catch {
      // ignore update failure
    }
  };

  const handleSetBestSellerStatus = async (id, active) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/admin/best-sellers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ active })
    });
    const data = await res.json();
    if (res.ok) {
      setAdminBestSellers(data.best_sellers || []);
      refreshPublicBestSellers();
    }
  };

  const handleBestSellerRankChange = async (id, rank) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/admin/best-sellers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ rank })
    });
    const data = await res.json();
    if (res.ok) {
      setAdminBestSellers(data.best_sellers || []);
      refreshPublicBestSellers();
    }
  };

  const isQuestionAnswered = (q) => {
    if (!q) return false;
    const v = answers[q.key];
    if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
    return Boolean(String(v || '').trim());
  };

  const setSingleAnswer = (key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const toggleMultiAnswer = (key, option) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key] : [];
      const exists = current.includes(option);
      return {
        ...prev,
        [key]: exists ? current.filter((x) => x !== option) : [...current, option],
      };
    });
  };

  const handleOnboardingNext = async () => {
    if (!currentQuestion || !isQuestionAnswered(currentQuestion)) return;
    if (onboardingStep < quizQuestions.length - 1) {
      setOnboardingStep((s) => s + 1);
      return;
    }
    await onGetResults('results');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign up failed.');
      localStorage.setItem('mgnition_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      setActiveNav('Home');
      setPage('onboarding');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      localStorage.setItem('mgnition_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      const profileAnswers = data.profile?.quiz_answers || {};
      setAnswers(profileAnswers);
      setSavedCars((data.saved_models || []).map((x) => hydrateSavedCar(x, variantByKey, modelByName)));
      setActiveNav('Home');
      if (data.user?.is_admin) {
        setPage('home');
      } else {
        setPage(Object.keys(profileAnswers).length ? 'home' : 'onboarding');
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();
    setAuthError('');
    setResetMessage('');
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetForm.email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request reset.');
      setResetMessage(data.message || 'Reset request sent.');
      if (data.dev_token) {
        setResetForm((p) => ({ ...p, token: data.dev_token }));
        setResetMessage(`${data.message} (Dev token generated: ${data.dev_token})`);
      }
      setAuthMode('reset-confirm');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasswordResetConfirm = async (e) => {
    e.preventDefault();
    setAuthError('');
    setResetMessage('');
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetForm.token,
          new_password: resetForm.new_password,
          confirm_password: resetForm.confirm_password
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password.');
      setResetMessage(data.message || 'Password updated.');
      setAuthMode('login');
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    localStorage.removeItem('mgnition_token');
    setToken('');
    setCurrentUser(null);
    setSavedCars([]);
    setAdminUsers([]);
    setAnswers({});
    setProfileMessage('');
    setProfileError('');
    setPage('home');
    setActiveNav('Home');
    setPageHistory(['home']);
    setHomeSlideIndex(0);
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    if (!token) return;
    setProfileError('');
    setProfileMessage('');
    setProfileLoading(true);
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          full_name: profileForm.full_name,
          phone: profileForm.phone,
          email: profileForm.email,
          quiz_answers: answers
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile.');
      if (data.user) {
        setCurrentUser(data.user);
      }
      setProfileMessage(data.message || 'Profile updated.');
      if (currentUser?.is_admin) {
        setAdminUsers((prev) =>
          prev.map((row) => (row.id === data.user?.id ? { ...row, ...data.user, is_admin: data.user?.is_admin ? 1 : 0 } : row))
        );
      }
      setAdminBookings((prev) =>
        prev.map((row) =>
          row.user_id === data.user?.id
            ? { ...row, user_name: data.user?.full_name || row.user_name, user_email: data.user?.email || row.user_email, user_phone: data.user?.phone || row.user_phone }
            : row
        )
      );
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleAddPromotion = async (e) => {
    e.preventDefault();
    setAdminMessage('');
    const chosen = promoVariantOptions.find((v) => v.key === promoForm.variant_key);
    const payload = {
      ...promoForm,
      variant_name: chosen ? chosen.label : ''
    };
    const res = await fetch(`${API_BASE}/admin/promotions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Failed to add promotion.');
      return;
    }
    setAdminMessage('Promotion added successfully.');
    setPromoForm({
      title: '',
      description: '',
      price_text: '',
      badge_text: '',
      image_url: '',
      model_name: '',
      variant_key: '',
      variant_name: '',
      start_date: '',
      end_date: ''
    });
    setPromoImageName('');
    if (promoImageInputRef.current) promoImageInputRef.current.value = '';
    refreshPublicPromotions();
    refreshAdminPromotions();
  };

  const handlePromotionImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!String(file.type || '').startsWith('image/')) {
      setAdminMessage('Please select an image file (PNG, JPG, WEBP).');
      event.target.value = '';
      return;
    }

    const maxBytes = 3 * 1024 * 1024;
    if (file.size > maxBytes) {
      setAdminMessage('Image is too large. Please use a file under 3 MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = typeof reader.result === 'string' ? reader.result : '';
      if (!base64) {
        setAdminMessage('Could not read image file.');
        return;
      }
      setPromoForm((prev) => ({ ...prev, image_url: base64 }));
      setPromoImageName(file.name);
      setAdminMessage(`Image selected: ${file.name}`);
    };
    reader.onerror = () => {
      setAdminMessage('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  const clearPromotionImage = () => {
    setPromoForm((prev) => ({ ...prev, image_url: '' }));
    setPromoImageName('');
    if (promoImageInputRef.current) promoImageInputRef.current.value = '';
  };

  const handleDeletePromotion = async (promoId) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/admin/promotions/${promoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      refreshPublicPromotions();
      refreshAdminPromotions();
    } else {
      const data = await res.json().catch(() => ({}));
      setAdminMessage(data.error || 'Failed to delete promotion.');
    }
  };

  const handleSetPromotionStatus = async (promoId, isActive) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/admin/promotions/${promoId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ active: isActive })
    });
    if (res.ok) {
      refreshPublicPromotions();
      refreshAdminPromotions();
    } else {
      const data = await res.json().catch(() => ({}));
      setAdminMessage(data.error || 'Failed to update promotion.');
    }
  };

  const handleSaveModel = async (car, options = {}) => {
    if (!token) {
      setAuthMode('login');
      setPage('auth');
      setAuthError('Please sign in to save cars to your account.');
      return;
    }
    const res = await fetch(`${API_BASE}/saved-models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(car)
    });
    const data = await res.json();
    if (res.ok) {
      setSavedCars((data.saved_models || []).map((x) => hydrateSavedCar(x, variantByKey, modelByName)));
      refreshPublicCarOfMonth();
      if (!options.silent) {
        setActiveNav('Saved Results');
        setPage('saved');
      }
    }
  };

  const handleToggleSave = async (car) => {
    const key = savedCarKey(car);
    if (savedKeySet.has(key) || savedKeySet.has(String(car.model || '').toLowerCase())) {
      await handleRemoveSaved(key);
      return;
    }
    await handleSaveModel(car, { silent: true });
  };

  const handleViewDetails = async (car, options = {}) => {
    const fromRecommendation = options?.source === 'recommended';
    setDetailFromRecommendation(fromRecommendation);
    const fallback =
      resultReasonMap.get(car?.variant_key || '') ||
      resultReasonMap.get(String(car?.model || '').toLowerCase()) ||
      null;
    const enriched = fallback
      ? {
          ...car,
          explanation: car.explanation || fallback.explanation || null,
          reason: car.reason || fallback.reason || '',
          ruleBreakdown: car.ruleBreakdown || fallback.ruleBreakdown || {}
        }
      : car;
    setSelectedCar(enriched);
    setPage('details');
    if (!token) return;
    const payload = {
      variant_key: car.variant_key || `${car.model}|${car.variant || ''}|${car.year || ''}`,
      model: car.model,
      variant: car.variant,
      year: car.year
    };
    await fetch(`${API_BASE}/feedback/click`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  };

  const handleRateRecommendation = async (ratingValue) => {
    const rating = Number(ratingValue);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
    if (!token) {
      setAuthMode('login');
      setPage('auth');
      setAuthError('Please sign in to submit recommendation ratings.');
      return;
    }

    const fallbackVariant = selectedDetailVariantForCompare || selectedCar;
    const variantKey =
      selectedVariantKey ||
      fallbackVariant?.variant_key ||
      `${fallbackVariant?.model || ''}|${fallbackVariant?.variant || ''}|${fallbackVariant?.year || ''}`;
    if (!variantKey) {
      setDetailRatingError('Unable to submit rating for this car.');
      return;
    }

    setDetailRatingLoading(true);
    setDetailRatingError('');
    setDetailRatingMessage('');
    try {
      const res = await fetch(`${API_BASE}/feedback/rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          variant_key: variantKey,
          model: fallbackVariant?.model || '',
          variant: fallbackVariant?.variant || '',
          year: fallbackVariant?.year || '',
          rating,
          source: 'details'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to submit rating.');
      setDetailRating(rating);
      setDetailRatingMessage('Thanks. Your rating is now used to improve future recommendations.');
    } catch (err) {
      setDetailRatingError(err?.message || 'Unable to submit rating.');
    } finally {
      setDetailRatingLoading(false);
    }
  };

  const handleRemoveSaved = async (variantKey) => {
    if (!token) return;
    const encoded = encodeURIComponent(variantKey);
    const res = await fetch(`${API_BASE}/saved-models/${encoded}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      setSavedCars((data.saved_models || []).map((x) => hydrateSavedCar(x, variantByKey, modelByName)));
      refreshPublicCarOfMonth();
    }
  };

  const handleAddToCompare = (car) => {
    if (isGuest) {
      setAuthMode('login');
      setPage('auth');
      setAuthError('Please sign in to compare cars.');
      return;
    }
    const item = buildComparisonItem(car);
    setCompareError('');
    setCompareCars((prev) => {
      if (prev.find((x) => x.key === item.key)) return prev;
      if (prev.length >= 3) {
        setCompareError('You can compare up to 3 variants at a time.');
        return prev;
      }
      return [...prev, item];
    });
  };

  const handleRemoveCompare = (key) => {
    setCompareCars((prev) => prev.filter((x) => x.key !== key));
  };

  useEffect(() => {
    if (!selectedShowroom) return;
    setBookingForm((p) => ({
      ...p,
      model: p.model || '',
      variant_key: ''
    }));
  }, [selectedShowroom]);

  const handleBookConsultation = async () => {
    if (!token || isAdmin) {
      setAuthMode('login');
      setPage('auth');
      setAuthError('Please sign in to complete booking.');
      return;
    }
    const activeShowroom = selectedShowroom || smartShowrooms[0] || filteredShowrooms[0];
    if (!activeShowroom) {
      setBookingError('Please select a showroom first.');
      return;
    }
    if (!bookingForm.model) {
      setBookingError('Please choose a car model.');
      return;
    }

    setBookingLoading(true);
    setBookingError('');
    setBookingMessage('');
    try {
      const wasConfirmed = Boolean(confirmedBooking);
      const chosenVariant = bookingVariantOptions.find((x) => x.key === bookingForm.variant_key);
      const res = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          showroom_id: activeShowroom.id,
          showroom_name: activeShowroom.name,
          showroom_address: activeShowroom.address,
          province,
          model: bookingForm.model,
          variant_key: bookingForm.variant_key,
          variant: chosenVariant?.label || '',
          notes: bookingForm.notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed.');
      const bookingRow = data.booking || {};
      const snapshot = {
        booking_reference: bookingRow.booking_reference || '',
        showroom: activeShowroom.name,
        province,
        model: bookingForm.model,
        variant: chosenVariant?.label || 'Any variant',
        notes: bookingForm.notes || '',
        confirmedAt: new Date().toISOString()
      };
      setConfirmedBooking(snapshot);
      setBookingMessage(
        wasConfirmed
          ? `Booking updated${bookingRow.booking_reference ? ` (${bookingRow.booking_reference})` : ''}.`
          : `Booking confirmed${bookingRow.booking_reference ? ` (${bookingRow.booking_reference})` : ''}.`
      );
      setPage('booking');
    } catch (err) {
      setBookingError(err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const homeRecommendations = results.slice(0, 3);
  const recommendationHeader = useMemo(() => buildRecommendationHeader(results), [results]);
  const carOfMonthPeriodLabel = useMemo(() => {
    if (!carOfMonthPeriod) return 'this month';
    const [y, m] = String(carOfMonthPeriod).split('-');
    const idx = Number(m) - 1;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (idx >= 0 && idx < months.length && y) return `${months[idx]} ${y}`;
    return carOfMonthPeriod;
  }, [carOfMonthPeriod]);
  const landingStats = [
    { label: 'Models', value: modelsData.length },
    { label: 'Variants', value: modelVariantsData.length },
    { label: 'Showrooms', value: showroomsData.length }
  ];
  const adminTotals = {
    clicks: (adminAnalytics?.top_clicked_variants || []).reduce((sum, r) => sum + Number(r.cnt || 0), 0),
    saves: (adminAnalytics?.top_saved_variants || []).reduce((sum, r) => sum + Number(r.cnt || 0), 0),
    bookings: adminBookings.length,
    promos: publicPromotions.length
  };
  const activeAnalyticsData = adminSection === 'analytics' && adminAnalyticsRangeData ? adminAnalyticsRangeData : adminAnalytics;
  const topBookedVariants = activeAnalyticsData?.top_booked_variants || [];
  const impressionsTrend = activeAnalyticsData?.impressions_saves_trend || [];
  const savedTimeseriesPayload = activeAnalyticsData?.saved_variants_timeseries;
  const bookedTimeseriesPayload = activeAnalyticsData?.booked_cars_timeseries;
  const hasSavedTimeseries = Boolean(
    savedTimeseriesPayload &&
      Array.isArray(savedTimeseriesPayload.buckets) &&
      Array.isArray(savedTimeseriesPayload.series)
  );
  const hasBookedTimeseries = Boolean(
    bookedTimeseriesPayload &&
      Array.isArray(bookedTimeseriesPayload.buckets) &&
      Array.isArray(bookedTimeseriesPayload.series)
  );
  const savedVariantTimeBuckets = hasSavedTimeseries ? savedTimeseriesPayload.buckets : [];
  const savedVariantTimeSeries = hasSavedTimeseries ? savedTimeseriesPayload.series : [];
  const bookedVariantTimeBuckets = hasBookedTimeseries ? bookedTimeseriesPayload.buckets : [];
  const bookedVariantTimeSeries = hasBookedTimeseries ? bookedTimeseriesPayload.series : [];
  const topSavedVariantsAligned = useMemo(() => {
    if (!hasSavedTimeseries) return [];
    return savedVariantTimeSeries
      .map((row) => ({
        variant_key: row.variant_key,
        cnt: (Array.isArray(row.counts) ? row.counts : []).reduce((sum, x) => sum + Number(x || 0), 0)
      }))
      .sort((a, b) => Number(b.cnt || 0) - Number(a.cnt || 0));
  }, [hasSavedTimeseries, savedVariantTimeSeries]);
  const topBookedVariantsAligned = useMemo(() => {
    if (hasBookedTimeseries) {
      return bookedVariantTimeSeries
        .map((row) => ({
          variant_key: row.variant_key,
          cnt: (Array.isArray(row.counts) ? row.counts : []).reduce((sum, x) => sum + Number(x || 0), 0)
        }))
        .sort((a, b) => Number(b.cnt || 0) - Number(a.cnt || 0));
    }
    return topBookedVariants;
  }, [hasBookedTimeseries, bookedVariantTimeSeries, topBookedVariants]);
  const maxSavedCount = Math.max(1, ...topSavedVariantsAligned.map((r) => Number(r.cnt || 0)));
  const maxBookedCount = Math.max(1, ...topBookedVariantsAligned.map((r) => Number(r.cnt || 0)));
  const trendLabel = (d) => (d ? String(d).slice(5) : '');
  const bookingCountsByDate = useMemo(() => {
    const out = {};
    (adminBookings || []).forEach((b) => {
      const raw = String(b?.created_at || '');
      const d = raw.slice(0, 10);
      if (!d || d.length !== 10) return;
      out[d] = (out[d] || 0) + 1;
    });
    return out;
  }, [adminBookings]);
  const funnelTrend = useMemo(() => {
    const map = new Map();
    (impressionsTrend || []).forEach((row) => {
      const d = String(row?.date || '').slice(0, 10);
      if (!d) return;
      map.set(d, {
        date: d,
        impressions: Number(row?.impressions || 0),
        saves: Number(row?.saves || 0),
        bookings: 0
      });
    });
    Object.entries(bookingCountsByDate).forEach(([d, cnt]) => {
      if (!map.has(d)) {
        map.set(d, { date: d, impressions: 0, saves: 0, bookings: Number(cnt || 0) });
      } else {
        map.get(d).bookings = Number(cnt || 0);
      }
    });
    const rows = [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const sliced = rows.length > 14 ? rows.slice(-14) : rows;
    return sliced.map((r) => ({
      ...r,
      save_rate: r.impressions > 0 ? (r.saves / r.impressions) * 100 : 0,
      booking_rate: r.impressions > 0 ? (r.bookings / r.impressions) * 100 : 0
    }));
  }, [impressionsTrend, bookingCountsByDate]);
  const chartWidth = 600;
  const chartHeight = 200;
  const funnelPadLeft = 34;
  const funnelPadRight = 10;
  const funnelPadTop = 10;
  const funnelPadBottom = 22;
  const funnelInnerW = chartWidth - funnelPadLeft - funnelPadRight;
  const funnelInnerH = chartHeight - funnelPadTop - funnelPadBottom;
  const funnelSeries = [
    { key: 'impressions', label: 'Impressions', color: '#4a4a4a' },
    { key: 'saves', label: 'Saves', color: '#d71920' },
    { key: 'bookings', label: 'Bookings', color: '#1d4ed8' }
  ];
  const funnelBucketCount = funnelTrend.length;
  const funnelGroupWidth = funnelBucketCount ? funnelInnerW / funnelBucketCount : 0;
  const funnelBarGap = 2;
  const funnelBarWidth =
    funnelBucketCount && funnelSeries.length
      ? Math.max(4, (funnelGroupWidth - funnelBarGap * (funnelSeries.length + 1)) / funnelSeries.length)
      : 0;
  const funnelMaxCount = Math.max(
    1,
    ...funnelTrend.map((r) => Math.max(Number(r.impressions || 0), Number(r.saves || 0), Number(r.bookings || 0)))
  );
  const funnelTickMax = Math.ceil(funnelMaxCount);
  const funnelTickMid = Math.max(1, Math.ceil(funnelTickMax / 2));
  const funnelYAxisTicks = useMemo(
    () => [...new Set([0, funnelTickMid, funnelTickMax])].sort((a, b) => a - b),
    [funnelTickMid, funnelTickMax]
  );
  const funnelY = (value) => funnelPadTop + funnelInnerH - (Number(value || 0) / Math.max(1, funnelMaxCount)) * funnelInnerH;
  const funnelXTicks = useMemo(() => {
    if (!funnelBucketCount) return [];
    const mid = Math.floor((funnelBucketCount - 1) / 2);
    return [...new Set([0, mid, funnelBucketCount - 1])];
  }, [funnelBucketCount]);
  const avgSaveRate = funnelTrend.length
    ? (funnelTrend.reduce((sum, r) => sum + Number(r.save_rate || 0), 0) / funnelTrend.length)
    : 0;
  const avgBookingRate = funnelTrend.length
    ? (funnelTrend.reduce((sum, r) => sum + Number(r.booking_rate || 0), 0) / funnelTrend.length)
    : 0;
  const variantBucketCount = savedVariantTimeBuckets.length;
  const variantSeriesCount = savedVariantTimeSeries.length;
  const variantPadLeft = 34;
  const variantPadRight = 10;
  const variantPadTop = 10;
  const variantPadBottom = 22;
  const variantInnerW = chartWidth - variantPadLeft - variantPadRight;
  const variantInnerH = chartHeight - variantPadTop - variantPadBottom;
  const variantGroupWidth = variantBucketCount ? variantInnerW / variantBucketCount : 0;
  const variantBarGap = 2;
  const variantBarWidth =
    variantBucketCount && variantSeriesCount
      ? Math.max(4, (variantGroupWidth - variantBarGap * (variantSeriesCount + 1)) / variantSeriesCount)
      : 0;
  const variantTrendMax = Math.max(
    1,
    ...savedVariantTimeSeries.flatMap((row) => (Array.isArray(row?.counts) ? row.counts : [])).map((x) => Number(x || 0))
  );
  const trendLine = (field) =>
    impressionsTrend
      .map((d, idx) => {
        const value = Number(d[field] || 0);
        const x = chartPad + idx * trendStep;
        const y = chartPad + chartInnerH - (value / trendMax) * chartInnerH;
        return `${x},${y}`;
      })
      .join(' ');
  const variantTickMax = Math.ceil(variantTrendMax);
  const variantTickMid = Math.max(1, Math.ceil(variantTickMax / 2));
  const variantYAxisTicks = useMemo(
    () => [...new Set([0, variantTickMid, variantTickMax])].sort((a, b) => a - b),
    [variantTickMid, variantTickMax]
  );
  const variantY = (value) => variantPadTop + variantInnerH - (Number(value || 0) / Math.max(1, variantTrendMax)) * variantInnerH;
  const variantXTicks = useMemo(() => {
    if (!variantBucketCount) return [];
    const mid = Math.floor((variantBucketCount - 1) / 2);
    return [...new Set([0, mid, variantBucketCount - 1])];
  }, [variantBucketCount]);
  const variantLineColors = ['#d71920', '#111', '#2f6adf', '#2d8a4f', '#d97706', '#7c3aed', '#0f766e', '#9f1239', '#a16207', '#4b5563'];
  const bookedBucketCount = bookedVariantTimeBuckets.length;
  const bookedSeriesCount = bookedVariantTimeSeries.length;
  const bookedPadLeft = 34;
  const bookedPadRight = 10;
  const bookedPadTop = 10;
  const bookedPadBottom = 22;
  const bookedInnerW = chartWidth - bookedPadLeft - bookedPadRight;
  const bookedInnerH = chartHeight - bookedPadTop - bookedPadBottom;
  const bookedGroupWidth = bookedBucketCount ? bookedInnerW / bookedBucketCount : 0;
  const bookedBarGap = 2;
  const bookedBarWidth =
    bookedBucketCount && bookedSeriesCount
      ? Math.max(4, (bookedGroupWidth - bookedBarGap * (bookedSeriesCount + 1)) / bookedSeriesCount)
      : 0;
  const bookedTrendMax = Math.max(
    1,
    ...bookedVariantTimeSeries.flatMap((row) => (Array.isArray(row?.counts) ? row.counts : [])).map((x) => Number(x || 0))
  );
  const bookedTickMax = Math.ceil(bookedTrendMax);
  const bookedTickMid = Math.max(1, Math.ceil(bookedTickMax / 2));
  const bookedYAxisTicks = useMemo(
    () => [...new Set([0, bookedTickMid, bookedTickMax])].sort((a, b) => a - b),
    [bookedTickMid, bookedTickMax]
  );
  const bookedY = (value) => bookedPadTop + bookedInnerH - (Number(value || 0) / Math.max(1, bookedTrendMax)) * bookedInnerH;
  const bookedXTicks = useMemo(() => {
    if (!bookedBucketCount) return [];
    const mid = Math.floor((bookedBucketCount - 1) / 2);
    return [...new Set([0, mid, bookedBucketCount - 1])];
  }, [bookedBucketCount]);
  const adminNavItems = [
    { key: 'overview', label: 'Overview' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'users', label: 'Users' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'promotions', label: 'Promotions' },
    { key: 'best-sellers', label: 'Best Sellers' }
  ];

  return (
    <div className="app">
      {page !== 'onboarding' && page !== 'admin' && (
        <TopBar
          active={activeNav}
          navItems={visibleNavItems}
          onNav={onNav}
          onAuth={() => setPage('auth')}
          currentUser={currentUser}
          onProfile={() => {
            setActiveNav('');
            setProfileError('');
            setProfileMessage('');
            setPage('profile');
          }}
          onLogout={handleLogout}
        />
      )}
      {page === 'home' && (
        <div className="home-slider-shell">
          <div className="home-slider-track" ref={homeSliderRef} onScroll={handleHomeSliderScroll}>
            <section className="hero home-slide hero-slide" style={{ backgroundImage: `url(${HERO_IMG})` }}>
              <div className="hero-overlay">
                <p className="hero-eyebrow">MG Thailand • Elevated Driving Experience</p>
                <h1>YOUR IDEAL MG, JUST A CLICK AWAY</h1>
                <p className="hero-subtitle">
                  Discover tailored recommendations, premium promotions, and trusted showrooms with a sleek,
                  data-driven experience inspired by the best in automotive luxury.
                </p>
                <div className="hero-actions">
                  <button
                    className="btn black hero-cta"
                    onClick={scrollToHomeContent}
                    type="button"
                  >
                    Get Started
                  </button>
                  <button
                    className="btn ghost hero-secondary"
                    onClick={() => {
                      setActiveNav('Our Models');
                      setPage('models');
                    }}
                    type="button"
                  >
                    Explore Models
                  </button>
                </div>
                <div className="hero-stats">
                  {landingStats.map((stat) => (
                    <div key={stat.label} className="hero-stat">
                      <strong>{stat.value}</strong>
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hero-sheen" />
            </section>

            <section className="page-section home-content-section home-slide home-content-slide" id="home-content">
              <div className="right-content">
                <h2>
                  Pro<span>motion</span>
                </h2>
                {publicPromotions.length ? (
                  <div className="home-promo-row">
                    {publicPromotions.map((promo) => (
                      <article key={promo.id} className="home-promo-card">
                        <img src={resolvePromotionImage(promo)} alt={promo.title} />
                        <div className="home-promo-copy">
                          <h3>{promo.price_text || promo.title}</h3>
                          <p className="home-promo-desc">{promo.description || 'Limited-time offer from MGNITION'}</p>
                          <p className="home-promo-badge">{promo.badge_text || 'Limited Promotion'}</p>
                          {(promo.start_date || promo.end_date) && (
                            <p className="home-promo-date">
                              {promo.start_date || 'Now'} - {promo.end_date || 'Until stocks last'}
                            </p>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">No active promotions right now.</p>
                )}
              </div>

              <div className="right-content car-of-month-block">
                <h2>
                  Car Of <span>The Month</span>
                </h2>
                <p className="muted-text">
                  {carOfMonthScope === 'monthly'
                    ? `Most saved by users in ${carOfMonthPeriodLabel}.`
                    : `No saves in ${carOfMonthPeriodLabel} yet. Showing all-time most saved cars.`}
                </p>
                {!!carOfMonthError && <p className="auth-error">Car of the month unavailable: {carOfMonthError}</p>}
                {carOfMonthCars.length ? (
                  <div className="cards best-seller-row">
                    {carOfMonthCars.map((car) => (
                      <CarCard
                        key={`car-of-month-${savedCarKey(car)}`}
                        car={car}
                        onView={handleViewDetails}
                        onCompare={isGuest ? null : handleAddToCompare}
                        onSave={isGuest ? null : handleToggleSave}
                        isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">No user saves yet.</p>
                )}
              </div>

              {!isGuest && hasCompletedQuiz && (
                <>
                  <div className="home-section-head">
                    <div className="recommend-head-top">
                      <div className="recommend-head-copy">
                        <h1 className="recommend-title">{recommendationHeader.title}</h1>
                        <p className="recommend-subtitle">{recommendationHeader.reason}</p>
                      </div>
                    </div>
                    {recommendError && <p className="auth-error">{recommendError}</p>}
                    {!!noMatchSuggestions.length && (
                      <ul className="constraint-help-list">
                        {noMatchSuggestions.map((hint) => (
                          <li key={`home-hint-${hint}`}>{hint}</li>
                        ))}
                      </ul>
                    )}
                    {!token && (
                      <button className="btn light" type="button" onClick={() => { setAuthMode('signup'); setPage('auth'); }}>
                        Sign up to personalize recommendations
                      </button>
                    )}
                  </div>
                  <div className="cards three">
                    {homeRecommendations.map((car) => (
                      <CarCard
                        key={savedCarKey(car)}
                        car={car}
                        onView={(value) => handleViewDetails(value, { source: 'recommended' })}
                        onCompare={isGuest ? null : handleAddToCompare}
                        onSave={isGuest ? null : handleToggleSave}
                        isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                      />
                    ))}
                  </div>
                  {!recommendError && !homeRecommendations.length && (
                    <p className="muted-text">No recommendations yet. Complete or update the quiz to generate results.</p>
                  )}
                </>
              )}
              {!isGuest && !isAdmin && !hasCompletedQuiz && (
                <div className="quiz-banner">
                  <div>
                    <h3>Personalized Recommendations</h3>
                    <p>Take the quiz to unlock your best matches.</p>
                  </div>
                  <button className="btn light" type="button" onClick={() => setPage('onboarding')}>
                    Start Quiz
                  </button>
                </div>
              )}

              <div className="right-content best-sellers-block">
                <h2>
                  Best <span>sellers</span>
                </h2>
                <div className="cards best-seller-row">
                  {bestSellerCars.map((car) => (
                    <CarCard
                      key={savedCarKey(car)}
                      car={car}
                      onView={handleViewDetails}
                      onCompare={isGuest ? null : handleAddToCompare}
                      onSave={isGuest ? null : handleToggleSave}
                      isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className={homeSlideIndex === 1 ? 'home-slider-dots hidden' : 'home-slider-dots'} aria-label="Home sections">
            {[0, 1].map((idx) => (
              <button
                key={`home-dot-${idx}`}
                type="button"
                aria-label={idx === 0 ? 'Hero section' : 'Recommendations section'}
                className={homeSlideIndex === idx ? 'slider-dot active' : 'slider-dot'}
                onClick={() => scrollToHomeSlide(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {page === 'onboarding' && (
        <section className="page-section onboarding-shell">
          <div className="quiz-top-strip">
            <img src="/mgnition-logo-nav.png" alt="MGNITION" className="quiz-logo" />
          </div>
          <div className="onboarding-frame">
            <div className="onboarding-frame-head">
              <button
                className="quiz-icon-btn"
                type="button"
                onClick={() => {
                  if (onboardingStep > 0) setOnboardingStep((s) => s - 1);
                  else setPage('home');
                }}
              >
                ←
              </button>
              <button className="quiz-icon-btn" type="button" onClick={() => setPage('home')}>
                ×
              </button>
            </div>

            {currentQuestion && (
              <div className="onboarding-question-wrap">
                <p className="onboarding-progress">
                  Question {onboardingStep + 1} of {quizQuestions.length}
                </p>
                <h3>{currentQuestion.prompt}</h3>

                {currentQuestion.type === 'input' && (
                  <div className="onboarding-input-wrap">
                    <input
                      value={answers[currentQuestion.key] || ''}
                      onChange={(e) => setSingleAnswer(currentQuestion.key, e.target.value)}
                      placeholder={currentQuestion.placeholder || 'Type your answer'}
                    />
                  </div>
                )}

                {(currentQuestion.type === 'single' || currentQuestion.type === 'multi') && (
                  <div className="quiz-options-grid">
                    {currentQuestion.options.map((option) => {
                      const disabled = isOnboardingOptionDisabled(currentQuestion.key, option);
                      const selected =
                        currentQuestion.type === 'multi'
                          ? (Array.isArray(answers[currentQuestion.key]) && answers[currentQuestion.key].includes(option))
                          : answers[currentQuestion.key] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          className={
                            selected ? `quiz-option selected${disabled ? ' disabled' : ''}` : `quiz-option${disabled ? ' disabled' : ''}`
                          }
                          disabled={disabled}
                          onClick={() =>
                            disabled
                              ? null
                              :
                            currentQuestion.type === 'multi'
                              ? toggleMultiAnswer(currentQuestion.key, option)
                              : setSingleAnswer(currentQuestion.key, option)
                          }
                        >
                          <span className={selected ? 'box selected' : 'box'} />
                          <span>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!!onboardingConstraintNotes.length && (
                  <ul className="constraint-help-list onboarding-help">
                    {onboardingConstraintNotes.map((hint) => (
                      <li key={`quiz-hint-${hint}`}>{hint}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="onboarding-actions single-step">
              <button className="btn black" type="button" onClick={handleOnboardingNext} disabled={!isQuestionAnswered(currentQuestion) || loading}>
                {loading ? 'Saving...' : onboardingStep === quizQuestions.length - 1 ? 'Finish' : 'Next'}
              </button>
              <button className="btn light" type="button" onClick={() => setPage('home')}>
                Skip for now
              </button>
            </div>
          </div>
          <div className="quiz-bottom-strip" />
        </section>
      )}

      {page === 'results' && (
        <section className="page-section">
          <div className="recommend-head-top">
            <div className="recommend-head-copy">
              <h1 className="recommend-title">{recommendationHeader.title}</h1>
              <p className="recommend-subtitle">{recommendationHeader.reason}</p>
            </div>
            {hasCompletedQuiz && (
              <button
                className="btn light"
                type="button"
                onClick={() => {
                  setOnboardingStep(0);
                  setPage('onboarding');
                }}
              >
                Update Preferences
              </button>
            )}
          </div>
          {hasCompletedQuiz ? (
            <>
              {recommendError && <p className="auth-error">{recommendError}</p>}
              {!!noMatchSuggestions.length && (
                <ul className="constraint-help-list">
                  {noMatchSuggestions.map((hint) => (
                    <li key={`results-hint-${hint}`}>{hint}</li>
                  ))}
                </ul>
              )}
              <div className="cards three">
                {(recommendError ? [] : results).slice(0, 3).map((car) => (
                  <CarCard
                    key={savedCarKey(car)}
                    car={car}
                    onView={(value) => handleViewDetails(value, { source: 'recommended' })}
                    onCompare={isGuest ? null : handleAddToCompare}
                    onSave={isGuest ? null : handleToggleSave}
                    isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                  />
                ))}
              </div>
              {!recommendError && !results.length && (
                <p className="muted-text">No recommendations yet. Complete or update the quiz to generate results.</p>
              )}
            </>
          ) : (
            <div className="auth-box" style={{ maxWidth: 520 }}>
              <p className="auth-error">Complete the quiz to see your recommended cars.</p>
              <button className="btn black" type="button" onClick={() => setPage('onboarding')}>
                Start Quiz
              </button>
            </div>
          )}
        </section>
      )}

      {page === 'compare' && (
        <section className="page-section">
          <h1>Variant Comparison</h1>
          <h2>Compare up to 3 variants side-by-side</h2>
          {compareError && <p className="auth-error">{compareError}</p>}
          {!compareCars.length && (
            <p className="muted-text">No variants selected yet. Click "Add to Compare" from recommended cars, model cards, or details page.</p>
          )}
          {!!compareCars.length && (
            <>
              <div className="compare-header-actions">
                <button className="btn light" type="button" onClick={() => setCompareCars([])}>
                  Clear Compare List
                </button>
              </div>
              <div className="compare-grid">
                {compareCars.map((item) => (
                  <article key={item.key} className="compare-card">
                    <img src={item.image} alt={item.model} />
                    <h3>{item.model}</h3>
                    <p>{item.variant || 'Base variant'}{item.year ? ` (${String(item.year).replace('.0', '')})` : ''}</p>
                    <button className="btn light" type="button" onClick={() => handleRemoveCompare(item.key)}>
                      Remove
                    </button>
                  </article>
                ))}
              </div>
              <div className="compare-table-wrap">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Specification</th>
                      {compareCars.map((item) => (
                        <th key={`head-${item.key}`}>{item.model}{item.variant ? ` - ${item.variant}` : ''}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Starting Price', 'price'],
                      ['Fuel Type', 'fuel'],
                      ['Seats', 'seats'],
                      ['Body Type', 'bodyType'],
                      ['Range', 'rangeKm'],
                      ['Horsepower', 'horsepower'],
                      ['Torque', 'torque'],
                      ['Cargo', 'cargo'],
                      ['Wheelbase', 'wheelbase'],
                      ['Dimensions (L x W x H)', 'dimensions'],
                    ].map(([label, key]) => (
                      <tr key={`row-${key}`}>
                        <td>{label}</td>
                        {compareCars.map((item) => (
                          <td key={`${item.key}-${key}`}>{item[key]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {page === 'models' && (
        <section className="page-section">
          <h1>MG Models</h1>
          <div className="filters-panel">
            <div className="filters-panel-head">
              <div>
                <h3>Filters</h3>
              </div>
              <button className="filter-reset" type="button" onClick={resetModelFilters}>
                Reset
              </button>
            </div>
            <div className="model-filters">
              <label className="filter-field">
                <span>Search</span>
                <input
                  placeholder="Search model or variant"
                  value={modelFilters.search}
                  onChange={(e) => setModelFilters((p) => ({ ...p, search: e.target.value }))}
                />
              </label>
              <div className="filter-field chip-field">
                <span>Fuel Type</span>
                <div className="chip-row">
                  {modelFilterChoices.fuels.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={modelFilters.fuel === x ? 'filter-chip active' : 'filter-chip'}
                      onClick={() => setModelFilters((p) => ({ ...p, fuel: x }))}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-field chip-field">
                <span>Seats</span>
                <div className="chip-row">
                  {modelFilterChoices.seats.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={modelFilters.seats === x ? 'filter-chip active' : 'filter-chip'}
                      onClick={() => setModelFilters((p) => ({ ...p, seats: x }))}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-field chip-field">
                <span>Body Type</span>
                <div className="chip-row">
                  {modelFilterChoices.bodyTypes.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={modelFilters.bodyType === x ? 'filter-chip active' : 'filter-chip'}
                      onClick={() => setModelFilters((p) => ({ ...p, bodyType: x }))}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <label className="filter-field price-filter">
                <span>Price Range (THB)</span>
                <div className="price-range-meta">
                  <span>฿{fmtNumber(modelPriceBounds.min)}</span>
                  <span>฿{fmtNumber(modelPriceValue)}</span>
                </div>
                <input
                  className="price-range"
                  type="range"
                  min={modelPriceBounds.min}
                  max={modelPriceBounds.max}
                  step={10000}
                  value={modelPriceValue}
                  style={{
                    background: `linear-gradient(90deg, var(--red) ${pricePercent}%, #e9e6e6 ${pricePercent}%)`
                  }}
                  onChange={(e) => setModelFilters((p) => ({ ...p, maxPrice: e.target.value }))}
                />
              </label>
            </div>
            <div className="color-filter">
              <div className="color-filter-head">
                <span>Color</span>
                {modelFilters.colors.length > 0 && (
                  <button
                    type="button"
                    className="color-clear"
                    onClick={() => setModelFilters((p) => ({ ...p, colors: [] }))}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="color-grid">
                {availableFilterColors.map((color) => {
                  const selected = modelFilters.colors.includes(color);
                  return (
                    <button
                      key={color}
                      type="button"
                      className={selected ? 'color-chip selected' : 'color-chip'}
                      onClick={() =>
                        setModelFilters((p) => {
                          const current = p.colors || [];
                          return current.includes(color)
                            ? { ...p, colors: current.filter((c) => c !== color) }
                            : { ...p, colors: [...current, color] };
                        })
                      }
                    >
                      <span className="color-dot" style={{ background: colorHexFromName(color) }} />
                      <span className="color-label">{color}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="model-list-grid">
            {filteredModels.map((car) => (
              <button
                key={savedCarKey(car)}
                type="button"
                className="model-list-item"
                onClick={() => {
                  handleViewDetails(car);
                }}
              >
                <img src={modelImage(car)} alt={car.model} />
                <div className="model-list-content">
                  <strong>{car.model}</strong>
                  <span>{modelPriceLabel(car.price)}</span>
                </div>
              </button>
            ))}
          </div>
          {!filteredModels.length && <p className="muted-text">No models match your current filters.</p>}
        </section>
      )}

      {page === 'details' && selectedCar && (
        <section className="page-section">
          <h1>{selectedCar.model}</h1>
          <img
            className="detail-image"
            src={pickColorImage(selectedVariantColorMap, selectedColor, selectedCar.defaultColor) || modelImage(selectedCar, selectedColor)}
            alt={selectedCar.model}
          />
          <h3>Starting at {selectedCar.price}</h3>
          <div className="specs">
            <p><b>Fuel Type:</b> {selectedCar.fuel || 'N/A'}</p>
            <p><b>Seats:</b> {String(selectedCar.seats || '').replace('.0', '') || 'N/A'}</p>
            <p><b>Body Type:</b> {selectedCar.bodyType || 'N/A'}</p>
            <p><b>Available Variants:</b> {selectedModelVariants.length || 'N/A'}</p>
          </div>

          {detailFromRecommendation && (() => {
            const explicitTopReasons = selectedCar.explanation?.top_reasons || [];
            const explicitMoreReasons = selectedCar.explanation?.more_reasons || [];
            const fallbackReasons = buildQuizReasons(answers, selectedCar);
            const topReasons = explicitTopReasons.length ? explicitTopReasons.slice(0, 3) : fallbackReasons.slice(0, 3);
            const moreReasons = explicitTopReasons.length ? explicitMoreReasons.slice(0, 5) : [];
            return (
              !!topReasons.length && (
            <article className="detail-explainer">
              <h3>Why this was recommended</h3>
              <ul>
                {topReasons.map((reason, idx) => (
                  <li key={`reason-${idx}`}>{reason}</li>
                ))}
              </ul>
              {!!moreReasons.length && (
                <>
                  {showMoreReasons && (
                    <ul className="detail-explainer-more">
                      {moreReasons.map((reason, idx) => (
                        <li key={`reason-more-${idx}`}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  <div className="detail-explainer-actions">
                    <button
                      className="btn light"
                      type="button"
                      onClick={() => setShowMoreReasons((prev) => !prev)}
                    >
                      {showMoreReasons ? 'Show less' : 'Show more'}
                    </button>
                  </div>
                </>
              )}
            </article>
              )
            );
          })()}

          {detailFromRecommendation && !isGuest && (
            <article className="detail-rating-box">
              <h3>How well does this recommendation fit your needs?</h3>
              <div className="detail-rating-actions">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={`rate-${value}`}
                    type="button"
                    className={detailRating === value ? 'detail-rating-btn active' : 'detail-rating-btn'}
                    onClick={() => handleRateRecommendation(value)}
                    disabled={detailRatingLoading}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="muted-text">1 = poor fit, 5 = excellent fit.</p>
              {detailRatingError && <p className="auth-error">{detailRatingError}</p>}
              {detailRatingMessage && <p className="auth-ok">{detailRatingMessage}</p>}
            </article>
          )}

          {!!detailPromotions.length && (
            <div className="detail-promotions">
              <h3>Current Promotions</h3>
              {detailPromotions.map((promo) => (
                <article key={`detail-promo-${promo.id}`} className="detail-promo-card">
                  <img src={resolvePromotionImage(promo)} alt={promo.title} />
                  <div>
                    <h4>{promo.title}</h4>
                    <p>{promo.price_text || 'Special offer available'}</p>
                    {promo.badge_text && <p>{promo.badge_text}</p>}
                    {promo.description && <p>{promo.description}</p>}
                    {(promo.start_date || promo.end_date) && (
                      <p>
                        {promo.start_date || 'Now'} - {promo.end_date || 'Until stocks last'}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          <h3>Choose Variant</h3>
          {selectedModelVariants.length > 0 && (
            <div className="variant-tabs">
              {selectedModelVariants.map((row, idx) => {
                const id = `${row.Model}|${row.Variant || ''}|${row.Year || ''}|${idx}`;
                const active = id === selectedVariantId;
                return (
                  <button
                    key={id}
                    type="button"
                    className={active ? 'variant-tab active' : 'variant-tab'}
                    onClick={() => setSelectedVariantId(id)}
                  >
                    {row.Variant ? `${row.Variant}` : `Variant ${idx + 1}`}
                    {row.Year ? ` (${String(row.Year).replace('.0', '')})` : ''}
                  </button>
                );
              })}
            </div>
          )}

          {!!selectedVariant && (
            <article className="variant-focus-card">
              <div className="variant-head">
                <h4>{selectedVariant.Model}{selectedVariant.Variant ? ` - ${selectedVariant.Variant}` : ''}</h4>
                <p>{selectedVariant.Year ? `Model Year ${String(selectedVariant.Year).replace('.0', '')}` : 'Current model'}</p>
              </div>
              <p className="variant-price">Starting price {fmtNumber(selectedVariant.Price_THB)} THB</p>
              <div className="variant-specs">
                <p><b>Fuel Type:</b> {selectedVariant.Fuel_Type || 'N/A'}</p>
                <p><b>Body Type:</b> {selectedVariant.Body_Type || 'N/A'}</p>
                <p><b>Seats:</b> {String(selectedVariant.Seats || '').replace('.0', '') || 'N/A'}</p>
                <p><b>Driving Range:</b> {selectedVariant.Range_km ? `${fmtNumber(selectedVariant.Range_km)} km` : 'N/A'}</p>
                <p><b>Power:</b> {selectedVariant.Horsepower_hp ? `${fmtNumber(selectedVariant.Horsepower_hp)} hp` : 'N/A'}</p>
                <p><b>Torque:</b> {selectedVariant.Torque_Nm ? `${fmtNumber(selectedVariant.Torque_Nm)} Nm` : 'N/A'}</p>
                <p><b>Cargo Space:</b> {selectedVariant.Cargo_Liters ? `${fmtNumber(selectedVariant.Cargo_Liters)} L` : 'N/A'}</p>
                <p><b>Consumption:</b> {selectedVariant.Fuel_Consumption_kmL ? `${fmtNumber(selectedVariant.Fuel_Consumption_kmL)} km/L` : 'N/A'}</p>
                <p>
                  <b>Dimensions:</b>{' '}
                  {selectedVariant.Length_mm && selectedVariant.Width_mm && selectedVariant.Height_mm
                    ? `${fmtNumber(selectedVariant.Length_mm)} x ${fmtNumber(selectedVariant.Width_mm)} x ${fmtNumber(selectedVariant.Height_mm)} mm`
                    : 'N/A'}
                </p>
                <p><b>Wheelbase:</b> {selectedVariant.Wheelbase_mm ? `${fmtNumber(selectedVariant.Wheelbase_mm)} mm` : 'N/A'}</p>
              </div>

              <h4 className="color-title">Available Colors</h4>
              <div className="color-swatches">
                {selectedVariantColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={selectedColor === color ? 'color-chip active' : 'color-chip'}
                    onClick={() => setSelectedColor(color)}
                  >
                    <span className="dot" style={{ background: colorHexFromName(color) }} />
                    {color}
                  </button>
                ))}
              </div>
              {selectedColor && <p className="color-picked">Selected color: {selectedColor}</p>}
            </article>
          )}

          <h3>All Variant Details</h3>
          {selectedModelVariants.length ? (
            <div className="variant-cards">
              {selectedModelVariants.map((row, idx) => (
                <article className="variant-card" key={`${row.Model}-${row.Variant || idx}`}>
                  <div className="variant-head">
                    <h4>{row.Variant ? `${row.Model} - ${row.Variant}` : row.Model}</h4>
                    <p>{row.Year ? `Model Year ${row.Year}` : 'Current model'}</p>
                  </div>
                  <p className="variant-price">Starting price {fmtNumber(row.Price_THB)} THB</p>
                  <div className="variant-specs">
                    <p><b>Fuel Type:</b> {row.Fuel_Type || 'N/A'}</p>
                    <p><b>Body Type:</b> {row.Body_Type || 'N/A'}</p>
                    <p><b>Seats:</b> {row.Seats || 'N/A'}</p>
                    <p><b>Driving Range:</b> {row.Range_km ? `${fmtNumber(row.Range_km)} km` : 'N/A'}</p>
                    <p><b>Power:</b> {row.Horsepower_hp ? `${fmtNumber(row.Horsepower_hp)} hp` : 'N/A'}</p>
                    <p><b>Torque:</b> {row.Torque_Nm ? `${fmtNumber(row.Torque_Nm)} Nm` : 'N/A'}</p>
                    <p><b>Cargo Space:</b> {row.Cargo_Liters ? `${fmtNumber(row.Cargo_Liters)} L` : 'N/A'}</p>
                    <p><b>Consumption:</b> {row.Fuel_Consumption_kmL ? `${fmtNumber(row.Fuel_Consumption_kmL)} km/L` : 'N/A'}</p>
                    <p>
                      <b>Dimensions:</b>{' '}
                      {row.Length_mm && row.Width_mm && row.Height_mm
                        ? `${fmtNumber(row.Length_mm)} x ${fmtNumber(row.Width_mm)} x ${fmtNumber(row.Height_mm)} mm`
                        : 'N/A'}
                    </p>
                    <p><b>Wheelbase:</b> {row.Wheelbase_mm ? `${fmtNumber(row.Wheelbase_mm)} mm` : 'N/A'}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>No variant rows found in dataset for this model.</p>
          )}

          <div className="detail-actions">
            <button className="btn black" onClick={() => handleSaveModel(selectedCar)} type="button">
              Save to My Account
            </button>
            {!isGuest && (
              <>
                <button className="btn light" onClick={() => handleAddToCompare(selectedDetailVariantForCompare || selectedCar)} type="button">
                  Add Selected Variant to Compare
                </button>
                <button
                  className="btn light"
                  onClick={() => {
                    setActiveNav('Compare');
                    setPage('compare');
                  }}
                  type="button"
                >
                  Go to Compare
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {page === 'auth' && (
        <section className="auth-layout">
          <div className="auth-box">
            <button className="back" onClick={handleBack} type="button">←</button>
            <div className="auth-card">
              <div className="auth-brand">
                <span className="auth-brand-text">MGNITION</span>
              </div>
              <div className="auth-head">
                <p className="eyebrow">MGNITION ID</p>
                <h3>
                  {authMode === 'login' && 'Log in to your account'}
                  {authMode === 'signup' && 'Create your account'}
                  {authMode === 'reset-request' && 'Reset your password'}
                  {authMode === 'reset-confirm' && 'Set your new password'}
                </h3>
                <p className="auth-subtitle">
                  Access personalized recommendations, bookings, and exclusive MG promotions.
                </p>
              </div>
              <div className="auth-switch">
                <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')} type="button">Login</button>
                <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')} type="button">Sign Up</button>
                <button className={authMode.startsWith('reset') ? 'active' : ''} onClick={() => setAuthMode('reset-request')} type="button">Reset Password</button>
              </div>

            {authMode === 'login' && (
              <form onSubmit={handleLogin} className="auth-form">
                <input
                  placeholder="Email Address *"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                />
                <div className="auth-input-row">
                  <input
                    placeholder="Password *"
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                  />
                  <button
                    className="auth-toggle"
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                  >
                    {showLoginPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <label className="auth-remember">
                  <input type="checkbox" />
                  <span>Keep me signed in</span>
                </label>
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Signing in...' : 'LOGIN'}
                </button>
                <button className="link-btn" type="button" onClick={() => setAuthMode('reset-request')}>
                  Forgot your password?
                </button>
              </form>
            )}

            {authMode === 'signup' && (
              <form onSubmit={handleSignup} className="auth-form">
                <input
                  placeholder="Full Name *"
                  value={signupForm.full_name}
                  onChange={(e) => setSignupForm((p) => ({ ...p, full_name: e.target.value }))}
                />
                <input
                  placeholder="Phone Number"
                  value={signupForm.phone}
                  onChange={(e) => setSignupForm((p) => ({ ...p, phone: e.target.value }))}
                />
                <input
                  placeholder="Email Address *"
                  value={signupForm.email}
                  onChange={(e) => setSignupForm((p) => ({ ...p, email: e.target.value }))}
                />
                <div className="auth-input-row">
                  <input
                    placeholder="Password (min 8 chars) *"
                    type={showSignupPassword ? 'text' : 'password'}
                    value={signupForm.password}
                    onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))}
                  />
                  <button
                    className="auth-toggle"
                    type="button"
                    onClick={() => setShowSignupPassword((prev) => !prev)}
                  >
                    {showSignupPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="auth-input-row">
                  <input
                    placeholder="Confirm Password *"
                    type={showSignupConfirm ? 'text' : 'password'}
                    value={signupForm.confirm_password}
                    onChange={(e) => setSignupForm((p) => ({ ...p, confirm_password: e.target.value }))}
                  />
                  <button
                    className="auth-toggle"
                    type="button"
                    onClick={() => setShowSignupConfirm((prev) => !prev)}
                  >
                    {showSignupConfirm ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Creating account...' : 'CREATE ACCOUNT'}
                </button>
              </form>
            )}

            {authMode === 'reset-request' && (
              <form onSubmit={handlePasswordResetRequest} className="auth-form">
                <input
                  placeholder="Email Address *"
                  value={resetForm.email}
                  onChange={(e) => setResetForm((p) => ({ ...p, email: e.target.value }))}
                />
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Sending link...' : 'SEND RESET LINK'}
                </button>
              </form>
            )}

            {authMode === 'reset-confirm' && (
              <form onSubmit={handlePasswordResetConfirm} className="auth-form">
                <input
                  placeholder="Reset Token *"
                  value={resetForm.token}
                  onChange={(e) => setResetForm((p) => ({ ...p, token: e.target.value }))}
                />
                <div className="auth-input-row">
                  <input
                    placeholder="New Password *"
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetForm.new_password}
                    onChange={(e) => setResetForm((p) => ({ ...p, new_password: e.target.value }))}
                  />
                  <button
                    className="auth-toggle"
                    type="button"
                    onClick={() => setShowResetPassword((prev) => !prev)}
                  >
                    {showResetPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="auth-input-row">
                  <input
                    placeholder="Confirm New Password *"
                    type={showResetConfirm ? 'text' : 'password'}
                    value={resetForm.confirm_password}
                    onChange={(e) => setResetForm((p) => ({ ...p, confirm_password: e.target.value }))}
                  />
                  <button
                    className="auth-toggle"
                    type="button"
                    onClick={() => setShowResetConfirm((prev) => !prev)}
                  >
                    {showResetConfirm ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Updating password...' : 'UPDATE PASSWORD'}
                </button>
              </form>
            )}
            {authError && <p className="auth-error">{authError}</p>}
            {resetMessage && <p className="auth-ok">{resetMessage}</p>}
            </div>
          </div>
          <div className="auth-art" style={{ backgroundImage: `url(${authCarImage})` }}>
            <div className="auth-art-overlay">
              <p className="auth-art-eyebrow">MG Heritage</p>
              <h2>Drive the future with confidence</h2>
              <p>
                Join MGNITION for tailored model recommendations, showroom booking, and premium offers.
              </p>
            </div>
          </div>
        </section>
      )}

      {page === 'showrooms' && (
        <section className="page-section center showroom-page">
          <div className="showroom-hero">
            <div>
              <p className="eyebrow">Showroom Locator</p>
              <h2>Find a nearby MG showroom</h2>
              <p className="showroom-subtitle">
                {!isGuest && !isAdmin
                  ? 'Enter your province and optional postal code to match the nearest MG showroom and book a consultation.'
                  : 'Enter your province and optional postal code to match the nearest MG showroom.'}
              </p>
            </div>
            <div className="showroom-hero-card">
              <span className="hero-label">Service Hours</span>
              <strong>Daily 9:00 – 19:00</strong>
              <span className="hero-note">Support for test drives and promotions</span>
            </div>
          </div>

          <div className="showroom-locator-card">
            <div className="showroom-filters">
              <label className="showroom-field">
                <span>Province</span>
                <select value={province} onChange={(e) => setProvince(e.target.value)}>
                  {provinceOptions.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="showroom-field">
                <span>Postal code</span>
                <input
                  placeholder="e.g. 10110"
                  value={showroomPostal}
                  onChange={(e) => setShowroomPostal(e.target.value)}
                />
              </label>
              <label className="showroom-field">
                <span>Preferred model</span>
                <select value={showroomModelPref} onChange={(e) => setShowroomModelPref(e.target.value)}>
                  <option value="">Any model</option>
                  {showroomModelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="showroom-locator-actions">
              <button
                className="btn black"
                onClick={() => {
                  setSelectedShowroom((prev) => prev || smartShowrooms[0] || null);
                  setPage('map');
                }}
                type="button"
              >
                Find Showroom
              </button>
              <button
                className="btn light"
                onClick={handleUseCurrentLocation}
                type="button"
                disabled={showroomGeoLoading}
              >
                {showroomGeoLoading ? 'Locating...' : 'Use My Location'}
              </button>
              <span className="showroom-meta">
                {smartShowrooms.length} showroom{smartShowrooms.length === 1 ? '' : 's'} found in {province}
              </span>
              {userLocation && (
                <span className="showroom-meta">Using your exact location for distance ranking</span>
              )}
              {showroomGeoError && <span className="showroom-geo-error">{showroomGeoError}</span>}
            </div>
          </div>

          {smartShowrooms.length > 0 && (
            <div className="showroom-preview">
              {smartShowrooms.slice(0, 3).map((s) => (
                <article key={s.id} className="showroom-card">
                  <div className="showroom-card-head">
                    <div>
                      <span className="showroom-tag">MG Partner</span>
                      <h4>{s.name}</h4>
                      <p className="muted-text">{s.address}</p>
                    </div>
                    <div className="showroom-score">
                      <span className="showroom-distance">{s.smartDistanceKm || '-'} km</span>
                    </div>
                  </div>
                  <div className="showroom-card-meta">
                    <div>
                      <span className="meta-label">Phone</span>
                      <strong>{s.phone || '-'}</strong>
                    </div>
                  </div>
                  <div className="showroom-actions">
                    <button
                      className="btn light"
                      onClick={() => {
                        setSelectedShowroom(s);
                        setPage('map');
                      }}
                      type="button"
                    >
                      View details
                    </button>
                    {!isGuest && !isAdmin && (
                      <button
                        className="btn black"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedShowroom(s);
                          setPage('booking');
                        }}
                        type="button"
                      >
                        Book consultation
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {page === 'map' && (
        <section className="map-page" ref={mapSectionRef}>
          <ShowroomGoogleMap
            showrooms={smartShowrooms}
            selectedShowroom={selectedShowroom}
            userLocation={userLocation}
            onSelectShowroom={setSelectedShowroom}
          />
          <div className="showroom-list-wrap">
            <h3>Showrooms in {province}</h3>
            <div className="showroom-list">
              {smartShowrooms.map((s) => (
                <article
                  key={s.id}
                  className={`showroom-card showroom-card-clickable ${selectedShowroomKey === showroomKey(s) ? 'showroom-card-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => focusShowroomOnMap(s, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      focusShowroomOnMap(s, true);
                    }
                  }}
                >
                  <div className="showroom-card-head">
                    <h4>{s.name}</h4>
                    <span>{s.smartDistanceKm || '-'} KM</span>
                  </div>
                  <p><b>Distance:</b> {s.smartDistanceKm || '-'} km</p>
                  <p>{s.address}</p>
                  <p>Postal Code: {postalFromAddress(s.address) || '-'}</p>
                  <p>Phone: {s.phone || '-'}</p>
                  <div className="showroom-actions">
                    <button
                      className="btn light"
                      onClick={(e) => {
                        e.stopPropagation();
                        focusShowroomOnMap(s, true);
                      }}
                      type="button"
                    >
                      View Map
                    </button>
                    {!isGuest && !isAdmin && (
                      <button
                        className="btn black"
                        onClick={() => {
                          setSelectedShowroom(s);
                          setPage('booking');
                        }}
                        type="button"
                      >
                        Book Consultation
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!smartShowrooms.length && <p className="muted-text">No showroom found for this province.</p>}
          </div>
        </section>
      )}

      {page === 'booking' && !isGuest && !isAdmin && (
        <section className="page-section booking-page">
          {(() => {
            const showroomName = selectedShowroom?.name || smartShowrooms[0]?.name || filteredShowrooms[0]?.name || '';
            const variantLabel = bookingVariantOptions.find((v) => v.key === bookingForm.variant_key)?.label || 'Any variant';
            const summaryItems = [
              { key: 'booking_reference', label: 'Booking ID', value: confirmedBooking?.booking_reference || 'Will be generated after submit' },
              { key: 'user_name', label: 'Name', value: currentUser?.full_name || 'Guest' },
              { key: 'user_phone', label: 'Phone', value: currentUser?.phone || '-' },
              { key: 'showroom', label: 'Showroom', value: showroomName },
              { key: 'province', label: 'Province', value: province },
              { key: 'model', label: 'Model', value: bookingForm.model },
              { key: 'variant', label: 'Variant', value: variantLabel },
              { key: 'notes', label: 'Notes', value: bookingForm.notes }
            ];
            const statusFor = (key, value) => {
              const val = String(value || '').trim();
              if (key === 'booking_reference') return confirmedBooking?.booking_reference ? 'confirmed' : 'pending';
              if (!val) return 'missing';
              if (!confirmedBooking) return 'pending';
              const confirmedVal = String(confirmedBooking[key] || '').trim();
              if (!confirmedVal) return 'pending';
              return confirmedVal === val ? 'confirmed' : 'edited';
            };
            const itemsWithStatus = summaryItems.map((item) => ({
              ...item,
              status: statusFor(item.key, item.value)
            }));
            const hasChanges = confirmedBooking ? itemsWithStatus.some((x) => x.status === 'edited') : true;
            const confirmLabel = bookingLoading
              ? 'Submitting...'
              : confirmedBooking
                ? (hasChanges ? 'Update Booking' : 'Booking Confirmed')
                : 'Confirm Booking';

            return (
              <>
                <div className="booking-header">
                  <div>
                    <p className="eyebrow">Consultation Request</p>
                    <h1>Book a Showroom Consultation</h1>
                    <p className="booking-subtitle">
                      Review your details below. Any edits will update the status icons in the summary card.
                    </p>
                  </div>
                  <div className={`booking-status ${confirmedBooking ? 'confirmed' : 'draft'}`}>
                    <span>{confirmedBooking ? 'Confirmed' : 'Draft'}</span>
                    <small>{confirmedBooking?.booking_reference || (confirmedBooking ? 'Details saved' : 'Not submitted yet')}</small>
                  </div>
                </div>

                <div className="booking-grid">
                  <div className="booking-form-card">
                    <div className="booking-form">
                      <label>Selected Showroom</label>
                      <input value={showroomName} readOnly />
                      <label>Province</label>
                      <input value={province} readOnly />
                      <label>Car Model</label>
                      <select
                        value={bookingForm.model}
                        onChange={(e) => setBookingForm((p) => ({ ...p, model: e.target.value, variant_key: '' }))}
                      >
                        <option value="">Select model</option>
                        {bookingModelOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <label>Variant (optional)</label>
                      <select
                        value={bookingForm.variant_key}
                        onChange={(e) => setBookingForm((p) => ({ ...p, variant_key: e.target.value }))}
                        disabled={!bookingForm.model}
                      >
                        <option value="">Any variant</option>
                        {bookingVariantOptions.map((v) => (
                          <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                      </select>
                      <label>Notes (optional)</label>
                      <input
                        value={bookingForm.notes}
                        onChange={(e) => setBookingForm((p) => ({ ...p, notes: e.target.value }))}
                        placeholder="Preferred contact time, extra requests..."
                      />
                    </div>
                    <div className="booking-actions">
                      <button
                        className="btn black"
                        onClick={handleBookConsultation}
                        type="button"
                        disabled={bookingLoading || (confirmedBooking && !hasChanges)}
                      >
                        {confirmLabel}
                      </button>
                      {bookingError && <p className="auth-error">{bookingError}</p>}
                      {bookingMessage && <p className="auth-ok">{bookingMessage}</p>}
                    </div>
                  </div>

                  <div className="booking-summary">
                    <h3>Booking Summary</h3>
                    <p className="muted-text">Live preview of the details you entered.</p>
                    <ul className="summary-list">
                      {itemsWithStatus.map((item) => (
                        <li key={item.key} className="summary-item">
                          <span className={`summary-icon ${item.status}`} />
                          <div>
                            <span className="summary-label">{item.label}</span>
                            <strong className="summary-value">{item.value || '—'}</strong>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="booking-footer">
                  <button className="btn light" onClick={() => setPage('showrooms')} type="button">
                    Done
                  </button>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {page === 'saved' && (
        <section className="page-section">
          <h1>Saved Models</h1>
          {!token && <p>Please sign in to view your saved models.</p>}
          {token && !savedCars.length && <p>No saved models yet. Click "Save to My Account" on a car details page.</p>}
          {savedCars.map((car) => (
            <div className="saved-row" key={savedCarKey(car)}>
              <img src={modelImage(car)} alt={car.model} />
              <div>
                <h3>{car.model}</h3>
                <div className="tags">
                  <span>{car.bodyType || 'Body Type'}</span>
                  <span>{car.fuel || 'Fuel'}</span>
                  <span>{String(car.seats).replace('.0', '') || '-'} seat</span>
                </div>
                <div className="saved-actions">
                  <button className="btn black" onClick={() => handleViewDetails(car)} type="button">
                    View Details
                  </button>
                  {!isGuest && (
                    <button className="btn light" onClick={() => handleAddToCompare(car)} type="button">
                      Add to Compare
                    </button>
                  )}
                  <button
                    className="btn light"
                    onClick={() => handleRemoveSaved(car.variant_key || `${car.model}|${car.variant || ''}|${car.year || ''}`)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {page === 'profile' && currentUser && (
        <section className="page-section profile-page">
          <div className="profile-card">
            <div className="profile-card-head">
              <div>
                <p className="eyebrow">Account Profile</p>
                <h1>Update Your Details</h1>
                <p className="muted-text">Changes are synced to your account record, bookings, and admin dashboard.</p>
              </div>
              <div className="profile-meta">
                <span>{currentUser.is_admin ? 'Administrator' : 'Member'}</span>
                <small>Joined {String(currentUser.created_at || '').slice(0, 10) || '-'}</small>
              </div>
            </div>
            <form className="auth-form profile-form" onSubmit={handleProfileUpdate}>
              <input
                placeholder="Full Name *"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, full_name: e.target.value }))}
              />
              <input
                placeholder="Phone Number"
                value={profileForm.phone}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
              <input
                placeholder="Email Address *"
                value={profileForm.email}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
              />
              <div className="profile-actions">
                <button className="btn black" disabled={profileLoading} type="submit">
                  {profileLoading ? 'Saving...' : 'Save Profile'}
                </button>
                <button
                  className="btn light"
                  type="button"
                  onClick={() =>
                    setProfileForm({
                      full_name: currentUser?.full_name || '',
                      phone: currentUser?.phone || '',
                      email: currentUser?.email || '',
                    })
                  }
                >
                  Reset
                </button>
              </div>
              {profileError && <p className="auth-error">{profileError}</p>}
              {profileMessage && <p className="auth-ok">{profileMessage}</p>}
            </form>
          </div>
        </section>
      )}

      {page === 'about' && (
        <section className="page-section about-section">
          <h1>About MGNITION</h1>
          <h2>Senior Project - Academic Use Only</h2>
          <div className="about-card">
            <p>
              MGNITION is a senior project developed for academic purposes only. It is a web-based car recommendation system designed to demonstrate the application of software development and data-driven decision-making concepts. This project is not a commercial product and is intended solely for educational use.
            </p>
          </div>
          <div className="about-grid">
            <article className="about-mini-card">
              <h3>Project Focus</h3>
              <p>Frontend and backend system integration, recommendation logic, and data-driven user experience design.</p>
            </article>
            <article className="about-mini-card">
              <h3>Data and Content</h3>
              <p>Vehicle data, promotions, and showroom entries are used to support prototype simulation and research outcomes.</p>
            </article>
            <article className="about-mini-card">
              <h3>Accessibility Goal</h3>
              <p>Designed to be responsive and convenient across phones, tablets, laptops, and larger desktop screens.</p>
            </article>
          </div>
        </section>
      )}

      {page === 'admin' && currentUser?.is_admin && (
        <div className="admin-shell">
          <aside className="admin-sidebar">
            <div className="admin-brand">
              <span>MGNITION</span>
              <strong>Admin Console</strong>
            </div>
            <nav className="admin-nav">
              {adminNavItems.map((item) => (
                <button
                  key={item.key}
                  className={adminSection === item.key ? 'admin-nav-item active' : 'admin-nav-item'}
                  onClick={() => setAdminSection(item.key)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="admin-sidebar-footer">
              <button
                className="btn light"
                onClick={() => {
                  setActiveNav('Home');
                  setPage('home');
                }}
                type="button"
              >
                Back to Site
              </button>
              <button className="btn light" onClick={handleLogout} type="button">
                Log out
              </button>
            </div>
          </aside>
          <main className="admin-main">
            <header className="admin-header">
              <div>
                <p className="admin-eyebrow">Admin Console</p>
                <h1>MGNITION Operations</h1>
                <p className="admin-subtitle">Analytics, bookings, promotions, and model updates in one place.</p>
              </div>
              <div className="admin-header-user">
                <span>{currentUser?.full_name || 'Admin'}</span>
                <small>{currentUser?.email || ''}</small>
              </div>
            </header>

            {adminSection === 'overview' && (
              <>
                <div className="admin-kpi-grid">
                  <article className="admin-kpi">
                    <p>Total Clicks</p>
                    <strong>{adminTotals.clicks}</strong>
                    <span>Across top variants</span>
                  </article>
                  <article className="admin-kpi">
                    <p>Total Saves</p>
                    <strong>{adminTotals.saves}</strong>
                    <span>Saved by users</span>
                  </article>
                  <article className="admin-kpi">
                    <p>Bookings</p>
                    <strong>{adminTotals.bookings}</strong>
                    <span>Consultations requested</span>
                  </article>
                  <article className="admin-kpi">
                    <p>Active Promotions</p>
                    <strong>{adminTotals.promos}</strong>
                    <span>Visible in public site</span>
                  </article>
                </div>

                <div className="admin-overview-grid">
                  <article className="admin-card admin-card-wide">
                    <div className="admin-card-head">
                      <h3>Recent Bookings</h3>
                      <button className="btn light" type="button" onClick={() => setAdminSection('bookings')}>
                        View all
                      </button>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Booking ID</th>
                            <th>Date</th>
                            <th>User</th>
                            <th>Showroom</th>
                            <th>Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminBookings.slice(0, 5).map((row) => (
                            <tr key={`booking-preview-${row.id}`}>
                              <td>{row.booking_reference || '-'}</td>
                              <td>{row.created_at || '-'}</td>
                              <td>{row.user_name || '-'}</td>
                              <td>{row.showroom_name || '-'}</td>
                              <td>{row.model || '-'}</td>
                            </tr>
                          ))}
                          {!adminBookings.length && (
                            <tr>
                              <td colSpan={5}>No bookings yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  <article className="admin-card">
                    <h3>Top Saved Variants</h3>
                    <ul className="admin-list">
                      {(adminAnalytics?.top_saved_variants || []).map((r) => (
                        <li key={`save-${r.variant_key}`}>
                          <span>{variantLabelFromKey(r.variant_key)}</span>
                          <strong>{r.cnt}</strong>
                        </li>
                      ))}
                      {!adminAnalytics?.top_saved_variants?.length && <li>No save data yet.</li>}
                    </ul>
                  </article>
                </div>
              </>
            )}

            {adminSection === 'analytics' && (
              <>
                <div className="admin-grid admin-grid-analytics">
                  <article className="admin-card">
                    <div className="admin-card-head">
                      <h3>Top Saved Variants Time Series</h3>
                    </div>
                    <div className="admin-analytics-filters">
                      <label className="admin-filter-field">
                        <span>From</span>
                        <input
                          type="date"
                          value={analyticsRange.start_date}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, start_date: e.target.value }))}
                        />
                      </label>
                      <label className="admin-filter-field">
                        <span>To</span>
                        <input
                          type="date"
                          value={analyticsRange.end_date}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, end_date: e.target.value }))}
                        />
                      </label>
                      <label className="admin-filter-field">
                        <span>Bucket</span>
                        <select
                          value={analyticsRange.granularity}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, granularity: e.target.value }))}
                        >
                          <option value="day">Daily</option>
                          <option value="week">Weekly</option>
                          <option value="month">Monthly</option>
                        </select>
                      </label>
                      <label className="admin-filter-field">
                        <span>Top Variants</span>
                        <select
                          value={analyticsRange.top_n}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, top_n: Number(e.target.value) }))}
                        >
                          <option value={3}>Top 3</option>
                          <option value={5}>Top 5</option>
                          <option value={8}>Top 8</option>
                          <option value={10}>Top 10</option>
                        </select>
                      </label>
                    </div>
                    {adminAnalyticsRangeLoading && <p className="muted-text">Loading analytics...</p>}
                    {!!adminAnalyticsRangeError && <p className="auth-error">{adminAnalyticsRangeError}</p>}
                    {hasSavedTimeseries && savedVariantTimeSeries.length && savedVariantTimeBuckets.length ? (
                      <div className="admin-line-chart admin-line-chart-variants">
                        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Top saved variants time series">
                          {variantYAxisTicks.map((tick) => (
                            <g key={`variant-y-tick-${tick}`}>
                              <line
                                className="chart-grid"
                                x1={variantPadLeft}
                                y1={variantY(tick)}
                                x2={variantPadLeft + variantInnerW}
                                y2={variantY(tick)}
                              />
                              <text className="chart-axis-text" x={variantPadLeft - 6} y={variantY(tick) + 3} textAnchor="end">
                                {tick}
                              </text>
                            </g>
                          ))}
                          {savedVariantTimeSeries.map((row, seriesIdx) =>
                            (row.counts || []).map((value, bucketIdx) => {
                              const v = Number(value || 0);
                              if (v <= 0) return null;
                              const height = (v / variantTrendMax) * variantInnerH;
                              const x =
                                variantPadLeft +
                                bucketIdx * variantGroupWidth +
                                variantBarGap +
                                seriesIdx * (variantBarWidth + variantBarGap);
                              const y = variantPadTop + variantInnerH - height;
                              return (
                                <rect
                                  key={`variant-bar-${row.variant_key}-${bucketIdx}`}
                                  x={x}
                                  y={y}
                                  width={variantBarWidth}
                                  height={height}
                                  rx={2}
                                  ry={2}
                                  fill={variantLineColors[seriesIdx % variantLineColors.length]}
                                />
                              );
                            })
                          )}
                          {variantXTicks.map((bucketIdx) => (
                            <text
                              key={`variant-x-tick-${bucketIdx}`}
                              className="chart-x-text"
                              x={variantPadLeft + bucketIdx * variantGroupWidth + variantGroupWidth / 2}
                              y={chartHeight - 4}
                              textAnchor="middle"
                            >
                              {trendLabel(savedVariantTimeBuckets[bucketIdx])}
                            </text>
                          ))}
                        </svg>
                        <div className="admin-chart-legend admin-chart-legend-wrap">
                          {savedVariantTimeSeries.map((row, idx) => (
                            <span key={`variant-legend-${row.variant_key}`} className="legend-item">
                              <i className="legend-dot" style={{ background: variantLineColors[idx % variantLineColors.length] }} />
                              {variantLabelFromKey(row.variant_key)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : hasSavedTimeseries ? (
                      !adminAnalyticsRangeLoading && <p className="muted-text">No save data for selected time range.</p>
                    ) : (
                      !adminAnalyticsRangeLoading && (
                        <p className="muted-text">Time-series data is unavailable from current backend response.</p>
                      )
                    )}
                    <h4 className="admin-subsection-title">Total Saves in Selected Range</h4>
                    <div className="admin-chart">
                      {topSavedVariantsAligned.map((r) => (
                        <div className="admin-bar-row" key={`save-${r.variant_key}`}>
                          <span className="bar-label">{variantLabelFromKey(r.variant_key)}</span>
                          <div className="bar-track">
                            <span
                              className="bar-fill"
                              style={{ width: `${(Number(r.cnt || 0) / maxSavedCount) * 100}%` }}
                            />
                          </div>
                          <span className="bar-value">{r.cnt}</span>
                        </div>
                      ))}
                      {!topSavedVariantsAligned.length && !adminAnalyticsRangeLoading && <p className="muted-text">No save data yet.</p>}
                    </div>
                  </article>

                  <article className="admin-card">
                    <div className="admin-card-head">
                      <h3>Most Booked Cars Timeline</h3>
                    </div>
                    <div className="admin-analytics-filters">
                      <label className="admin-filter-field">
                        <span>From</span>
                        <input
                          type="date"
                          value={analyticsRange.start_date}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, start_date: e.target.value }))}
                        />
                      </label>
                      <label className="admin-filter-field">
                        <span>To</span>
                        <input
                          type="date"
                          value={analyticsRange.end_date}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, end_date: e.target.value }))}
                        />
                      </label>
                      <label className="admin-filter-field">
                        <span>Bucket</span>
                        <select
                          value={analyticsRange.granularity}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, granularity: e.target.value }))}
                        >
                          <option value="day">Daily</option>
                          <option value="week">Weekly</option>
                          <option value="month">Monthly</option>
                        </select>
                      </label>
                      <label className="admin-filter-field">
                        <span>Top Variants</span>
                        <select
                          value={analyticsRange.top_n}
                          onChange={(e) => setAnalyticsRange((prev) => ({ ...prev, top_n: Number(e.target.value) }))}
                        >
                          <option value={3}>Top 3</option>
                          <option value={5}>Top 5</option>
                          <option value={8}>Top 8</option>
                          <option value={10}>Top 10</option>
                        </select>
                      </label>
                    </div>
                    {hasBookedTimeseries && bookedVariantTimeSeries.length && bookedVariantTimeBuckets.length ? (
                      <div className="admin-line-chart admin-line-chart-variants">
                        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Most booked cars time series">
                          {bookedYAxisTicks.map((tick) => (
                            <g key={`booked-y-tick-${tick}`}>
                              <line
                                className="chart-grid"
                                x1={bookedPadLeft}
                                y1={bookedY(tick)}
                                x2={bookedPadLeft + bookedInnerW}
                                y2={bookedY(tick)}
                              />
                              <text className="chart-axis-text" x={bookedPadLeft - 6} y={bookedY(tick) + 3} textAnchor="end">
                                {tick}
                              </text>
                            </g>
                          ))}
                          {bookedVariantTimeSeries.map((row, seriesIdx) =>
                            (row.counts || []).map((value, bucketIdx) => {
                              const v = Number(value || 0);
                              if (v <= 0) return null;
                              const height = (v / bookedTrendMax) * bookedInnerH;
                              const x =
                                bookedPadLeft +
                                bucketIdx * bookedGroupWidth +
                                bookedBarGap +
                                seriesIdx * (bookedBarWidth + bookedBarGap);
                              const y = bookedPadTop + bookedInnerH - height;
                              return (
                                <rect
                                  key={`booked-bar-${row.variant_key}-${bucketIdx}`}
                                  x={x}
                                  y={y}
                                  width={bookedBarWidth}
                                  height={height}
                                  rx={2}
                                  ry={2}
                                  fill={variantLineColors[seriesIdx % variantLineColors.length]}
                                />
                              );
                            })
                          )}
                          {bookedXTicks.map((bucketIdx) => (
                            <text
                              key={`booked-x-tick-${bucketIdx}`}
                              className="chart-x-text"
                              x={bookedPadLeft + bucketIdx * bookedGroupWidth + bookedGroupWidth / 2}
                              y={chartHeight - 4}
                              textAnchor="middle"
                            >
                              {trendLabel(bookedVariantTimeBuckets[bucketIdx])}
                            </text>
                          ))}
                        </svg>
                        <div className="admin-chart-legend admin-chart-legend-wrap">
                          {bookedVariantTimeSeries.map((row, idx) => (
                            <span key={`booked-legend-${row.variant_key}`} className="legend-item">
                              <i className="legend-dot" style={{ background: variantLineColors[idx % variantLineColors.length] }} />
                              {variantLabelFromKey(row.variant_key)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : hasBookedTimeseries ? (
                      !adminAnalyticsRangeLoading && <p className="muted-text">No booking data for selected time range.</p>
                    ) : (
                      !adminAnalyticsRangeLoading && (
                        <p className="muted-text">Booking time-series data is unavailable from current backend response.</p>
                      )
                    )}
                    <h4 className="admin-subsection-title">Total Bookings in Selected Range</h4>
                    <div className="admin-chart">
                      {topBookedVariantsAligned.map((row) => (
                        <div className="admin-bar-row" key={`booked-${row.variant_key}`}>
                          <span className="bar-label">{variantLabelFromKey(row.variant_key)}</span>
                          <div className="bar-track">
                            <span
                              className="bar-fill"
                              style={{ width: `${(Number(row.cnt || 0) / maxBookedCount) * 100}%` }}
                            />
                          </div>
                          <span className="bar-value">{row.cnt}</span>
                        </div>
                      ))}
                      {!topBookedVariantsAligned.length && <p className="muted-text">No booking data yet.</p>}
                    </div>
                  </article>
                </div>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Recommendation Funnel Trend</h3>
                  </div>
                  {funnelTrend.length ? (
                    <div className="admin-line-chart">
                      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Recommendation funnel trend">
                        {funnelYAxisTicks.map((tick) => (
                          <g key={`funnel-y-tick-${tick}`}>
                            <line
                              className="chart-grid"
                              x1={funnelPadLeft}
                              y1={funnelY(tick)}
                              x2={funnelPadLeft + funnelInnerW}
                              y2={funnelY(tick)}
                            />
                            <text className="chart-axis-text" x={funnelPadLeft - 6} y={funnelY(tick) + 3} textAnchor="end">
                              {tick}
                            </text>
                          </g>
                        ))}
                        {funnelTrend.map((row, bucketIdx) =>
                          funnelSeries.map((series, seriesIdx) => {
                            const value = Number(row[series.key] || 0);
                            if (value <= 0) return null;
                            const height = (value / funnelMaxCount) * funnelInnerH;
                            const x =
                              funnelPadLeft +
                              bucketIdx * funnelGroupWidth +
                              funnelBarGap +
                              seriesIdx * (funnelBarWidth + funnelBarGap);
                            const y = funnelPadTop + funnelInnerH - height;
                            return (
                              <rect
                                key={`funnel-${series.key}-${bucketIdx}`}
                                x={x}
                                y={y}
                                width={funnelBarWidth}
                                height={height}
                                rx={2}
                                ry={2}
                                fill={series.color}
                              />
                            );
                          })
                        )}
                        {funnelXTicks.map((bucketIdx) => (
                          <text
                            key={`funnel-x-tick-${bucketIdx}`}
                            className="chart-x-text"
                            x={funnelPadLeft + bucketIdx * funnelGroupWidth + funnelGroupWidth / 2}
                            y={chartHeight - 4}
                            textAnchor="middle"
                          >
                            {trendLabel(funnelTrend[bucketIdx]?.date)}
                          </text>
                        ))}
                      </svg>
                      <div className="admin-chart-legend">
                        {funnelSeries.map((s) => (
                          <span className="legend-item" key={`funnel-legend-${s.key}`}>
                            <i className="legend-dot" style={{ background: s.color }} />
                            {s.label}
                          </span>
                        ))}
                      </div>
                      <div className="admin-funnel-metrics">
                        <span>Avg Save Rate: {avgSaveRate.toFixed(2)}%</span>
                        <span>Avg Booking Rate: {avgBookingRate.toFixed(2)}%</span>
                      </div>
                    </div>
                  ) : (
                    <p className="muted-text">No trend data yet.</p>
                  )}
                </article>
              </>
            )}

            {adminSection === 'users' && (
              <article className="admin-card">
                <div className="admin-card-head">
                  <h3>Registered Users</h3>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>User ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Role</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map((row) => (
                        <tr key={`user-${row.id}`}>
                          <td>{row.id}</td>
                          <td>{row.full_name || '-'}</td>
                          <td>{row.email || '-'}</td>
                          <td>{row.phone || '-'}</td>
                          <td>{row.is_admin ? 'Admin' : 'User'}</td>
                          <td>{row.created_at || '-'}</td>
                        </tr>
                      ))}
                      {!adminUsers.length && (
                        <tr>
                          <td colSpan={6}>No users found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            )}

            {adminSection === 'bookings' && (
              <article className="admin-card">
                <div className="admin-card-head">
                  <h3>Consultation Bookings</h3>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Booking ID</th>
                        <th>Date</th>
                        <th>User</th>
                        <th>Contact</th>
                        <th>Showroom</th>
                        <th>Model</th>
                        <th>Variant</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminBookings.map((row) => (
                        <tr key={`booking-${row.id}`}>
                          <td>{row.booking_reference || '-'}</td>
                          <td>{row.created_at || '-'}</td>
                          <td>{row.user_name || '-'}</td>
                          <td>{row.user_email || '-'} / {row.user_phone || '-'}</td>
                          <td>{row.showroom_name || '-'} ({row.province || '-'})</td>
                          <td>{row.model || '-'}</td>
                          <td>{row.variant || 'Any variant'}</td>
                          <td>
                            <select
                              className="admin-status"
                              value={row.status || 'pending'}
                              onChange={(e) => handleBookingStatus(row.id, e.target.value)}
                            >
                              <option value="pending">Pending</option>
                              <option value="accepted">Accept</option>
                              <option value="rejected">Reject</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                      {!adminBookings.length && (
                        <tr>
                          <td colSpan={8}>No bookings yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            )}

            {adminSection === 'promotions' && (
              <>
                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Publish Promotion</h3>
                  </div>
                  <form className="auth-form" onSubmit={handleAddPromotion}>
                    <input placeholder="Title *" value={promoForm.title} onChange={(e) => setPromoForm((p) => ({ ...p, title: e.target.value }))} />
                    <select value={promoForm.model_name} onChange={(e) => setPromoForm((p) => ({ ...p, model_name: e.target.value, variant_key: '', variant_name: '' }))}>
                      <option value="">Apply to All Models (General Promotion)</option>
                      {promoModelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={promoForm.variant_key}
                      onChange={(e) => setPromoForm((p) => ({ ...p, variant_key: e.target.value }))}
                      disabled={!promoForm.model_name}
                    >
                      <option value="">All variants of selected model</option>
                      {promoVariantOptions.map((v) => (
                        <option key={v.key} value={v.key}>{v.label}</option>
                      ))}
                    </select>
                    <input placeholder="Price Text" value={promoForm.price_text} onChange={(e) => setPromoForm((p) => ({ ...p, price_text: e.target.value }))} />
                    <input placeholder="Badge Text" value={promoForm.badge_text} onChange={(e) => setPromoForm((p) => ({ ...p, badge_text: e.target.value }))} />
                    <input placeholder="Start Date (YYYY-MM-DD)" value={promoForm.start_date} onChange={(e) => setPromoForm((p) => ({ ...p, start_date: e.target.value }))} />
                    <input placeholder="End Date (YYYY-MM-DD)" value={promoForm.end_date} onChange={(e) => setPromoForm((p) => ({ ...p, end_date: e.target.value }))} />
                    <input placeholder="Description" value={promoForm.description} onChange={(e) => setPromoForm((p) => ({ ...p, description: e.target.value }))} />
                    <div className="promo-upload-block">
                      <label htmlFor="promo-image-upload" className="promo-upload-label">Upload photo from device</label>
                      <input
                        id="promo-image-upload"
                        ref={promoImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePromotionImageUpload}
                      />
                      <div className="promo-upload-meta">
                        <span>{promoImageName ? `Selected: ${promoImageName}` : 'Supported: PNG, JPG, WEBP (max 3 MB)'}</span>
                        <button
                          type="button"
                          className="promo-upload-clear"
                          onClick={clearPromotionImage}
                          disabled={!promoForm.image_url}
                        >
                          Clear Image
                        </button>
                      </div>
                      {!!promoForm.image_url && (
                        <img className="promo-upload-preview" src={promoForm.image_url} alt="Promotion preview" />
                      )}
                    </div>
                    <button className="btn black full" type="submit">Publish Promotion</button>
                  </form>
                </article>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Promotion History</h3>
                  </div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Model</th>
                          <th>Variant</th>
                          <th>Dates</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminPromotions.map((promo) => (
                          <tr key={`promo-${promo.id}`}>
                            <td>{promo.title || '-'}</td>
                            <td>{promo.model_name || '-'}</td>
                            <td>{promo.variant_name || (promo.variant_key ? variantLabelFromKey(promo.variant_key) : '-')}</td>
                            <td>
                              {promo.start_date || '-'} {promo.end_date ? `→ ${promo.end_date}` : ''}
                            </td>
                            <td>
                              <select
                                className="admin-status"
                                value={promo.active ? 'active' : 'inactive'}
                                onChange={(e) => handleSetPromotionStatus(promo.id, e.target.value === 'active')}
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                        {!adminPromotions.length && (
                          <tr>
                            <td colSpan={5}>No promotions yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </>
            )}


            {adminSection === 'best-sellers' && (
              <>
                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Manage Best Sellers</h3>
                  </div>
                  <form className="auth-form" onSubmit={handleAddBestSeller}>
                    <select
                      value={bestSellerForm.model_name}
                      onChange={(e) => setBestSellerForm((p) => ({ ...p, model_name: e.target.value, variant_key: '', variant_name: '' }))}
                      required
                    >
                      <option value="">Select Model *</option>
                      {bestSellerModelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={bestSellerForm.variant_key}
                      onChange={(e) => setBestSellerForm((p) => ({ ...p, variant_key: e.target.value }))}
                      disabled={!bestSellerForm.model_name || !bestSellerVariantOptions.length}
                    >
                      <option value="">Any variant</option>
                      {bestSellerVariantOptions.map((v) => (
                        <option key={v.key} value={v.key}>{v.label}</option>
                      ))}
                    </select>
                    <input
                      placeholder="Rank (1 = highest)"
                      value={bestSellerForm.rank}
                      onChange={(e) => setBestSellerForm((p) => ({ ...p, rank: e.target.value }))}
                    />
                    <button className="btn black full" type="submit">Add Best Seller</button>
                  </form>
                </article>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Best Seller List</h3>
                  </div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Variant</th>
                          <th>Rank</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminBestSellers.map((row) => (
                          <tr key={`best-${row.id}`}>
                            <td>{row.model_name}</td>
                            <td>{row.variant_name || (row.variant_key ? variantLabelFromKey(row.variant_key) : '-')}</td>
                            <td>
                              <input
                                className="admin-rank-input"
                                type="number"
                                min="1"
                                value={row.rank || 1}
                                onChange={(e) => handleBestSellerRankChange(row.id, e.target.value)}
                              />
                            </td>
                            <td>
                              <select
                                className="admin-status"
                                value={row.active ? 'active' : 'inactive'}
                                onChange={(e) => handleSetBestSellerStatus(row.id, e.target.value === 'active')}
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                        {!adminBestSellers.length && (
                          <tr>
                            <td colSpan={4}>No best sellers yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </>
            )}

            {adminMessage && <p className="auth-ok">{adminMessage}</p>}
          </main>
        </div>
      )}
    </div>
  );
}

function TopBar({ active, navItems, onNav, onAuth, currentUser, onProfile, onLogout }) {
  const items = navItems || NAV_ITEMS;
  return (
    <header className="topbar">
      <img src="/mgnition-logo-nav.png" alt="MGNITION" />
      <nav>
        {items.map((item) => (
          <button key={item} className={active === item ? 'nav active' : 'nav'} onClick={() => onNav(item)} type="button">
            {item}
          </button>
        ))}
        {currentUser?.is_admin && (
          <button className={active === 'Admin Dashboard' ? 'nav active' : 'nav'} onClick={() => onNav('Admin Dashboard')} type="button">
            Admin Dashboard
          </button>
        )}
      </nav>
      <div className="auth-buttons">
        {currentUser ? (
          <>
            <button className="user-chip user-chip-btn" onClick={onProfile} type="button">
              {currentUser.full_name}
            </button>
            <button className="btn light" onClick={onLogout} type="button">Log out</button>
          </>
        ) : (
          <>
            <button className="btn light" onClick={onAuth} type="button">Sign Up</button>
            <button className="btn light" onClick={onAuth} type="button">Log in</button>
          </>
        )}
      </div>
    </header>
  );
}

function CarCard({ car, onView, onCompare, onSave, isSaved }) {
  const reasons = (car.explanation?.top_reasons || []).slice(0, 2);
  const meta = [
    car.fuel && String(car.fuel),
    car.seats ? `${car.seats} Seats` : '',
    car.bodyType && String(car.bodyType)
  ].filter(Boolean);
  return (
    <article className="car-card">
      {onSave && (
        <button
          className={isSaved ? 'save-icon saved' : 'save-icon'}
          type="button"
          title="Save to My Account"
          onClick={(e) => {
            e.stopPropagation();
            onSave(car);
          }}
        >
          {isSaved ? '★' : '☆'}
        </button>
      )}
      <img src={modelImage(car)} alt={car.model} />
      <h3>{car.model}</h3>
      {car.variant && <p className="car-card-variant">Variant: {car.variant}</p>}
      <p className="car-card-price">Starting {car.price}</p>
      {!!meta.length && (
        <div className="car-card-meta">
          {meta.map((item) => (
            <span key={`${savedCarKey(car)}-${item}`}>{item}</span>
          ))}
        </div>
      )}
      {!!reasons.length && (
        <div className="reason-list">
          {reasons.map((reason, idx) => (
            <p key={`${savedCarKey(car)}-reason-${idx}`} className="reason-item">
              {reason}
            </p>
          ))}
        </div>
      )}
      <div className="car-card-actions">
        <button className="btn black" onClick={() => onView(car)} type="button">
          View Details
        </button>
        {onCompare && (
          <button className="btn light" onClick={() => onCompare(car)} type="button">
            Add to Compare
          </button>
        )}
      </div>
    </article>
  );
}
