import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import modelsData from './data/models.json';
import showroomsData from './data/showrooms.json';
import modelVariantsData from './data/modelVariants.json';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';
const API_RECOMMEND = `${API_BASE}/recommend`;
const NAV_ITEMS = ['Home', 'Our Models', 'Recommended Cars', 'Compare', 'Saved Results', 'Showrooms', 'About Us'];

const HERO_IMG =
  'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1900&q=80';

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
    key: 'style',
    type: 'single',
    prompt: 'What design style feels most like you?',
    options: ['Classic & Timeless', 'Sporty & Bold', 'Luxury & Elegant'],
  },
  {
    key: 'budget',
    type: 'single',
    prompt: 'What is your budget for your next MG?',
    options: ['Below 700,000 THB', '700,000 - 999,999 THB', '1,000,000 - 1,299,999 THB', '1,300,000 THB and above'],
  },
  {
    key: 'postalCode',
    type: 'input',
    prompt: 'Enter your postal code so we can match nearby showrooms',
    placeholder: 'e.g. 10110',
  },
  {
    key: 'usage',
    type: 'single',
    prompt: 'How do you use your car most of the time?',
    options: ['City commuting', 'Cargo & Practical use', 'Highway/Long-distance', 'Eco-conscious lifestyle'],
  },
  {
    key: 'hobbies',
    type: 'multi',
    prompt: 'What are your hobbies? (Choose more than one)',
    options: ['City Life & Socializing', 'Adventure & Travel', 'Relaxed & Minimalist Lifestyle', 'Outdoor Sports & Fitness'],
  },
  {
    key: 'occupation',
    type: 'single',
    prompt: 'What is your occupation?',
    options: ['Student', 'Working Professional', 'Business Owner', 'Family-Oriented', 'Retired', 'Others'],
  },
  {
    key: 'distance',
    type: 'single',
    prompt: 'On average, how far do you drive each day?',
    options: ['Short distance (0-30 km)', 'Medium commute (30-80 km)', 'Long commute (80-150 km)', 'Very long distance (Over 150 km)'],
  },
  {
    key: 'seats',
    type: 'single',
    prompt: 'How many seats does your MG need?',
    options: ['2 seats', '3-5 seats', '5+ seats'],
  },
  {
    key: 'fuelType',
    type: 'single',
    prompt: 'Which type of fuel fits your lifestyle and driving habits?',
    options: ['Hybrid', 'Petrol (Gasoline)', 'Diesel', 'EV (Electric)'],
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
  SSK: 'Samut Sakhon',
  NPT: 'Nakhon Pathom'
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
  if (m) return m[1].trim();
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
  if (budgetText && priceNum) {
    if (budgetText.includes('below 700') && priceNum <= 700000) {
      reasons.push(`Budget fit: ฿${priceNum.toLocaleString()} is within your range (below ฿700,000).`);
    } else if (budgetText.includes('700,000') && budgetText.includes('999') && priceNum >= 700000 && priceNum <= 999999) {
      reasons.push(`Budget fit: ฿${priceNum.toLocaleString()} matches your ฿700,000–฿999,999 range.`);
    } else if (budgetText.includes('1,000,000') && priceNum >= 1000000 && priceNum <= 1299999) {
      reasons.push(`Budget fit: ฿${priceNum.toLocaleString()} matches your ฿1,000,000–฿1,299,999 range.`);
    } else if (budgetText.includes('1,300,000') && priceNum >= 1300000) {
      reasons.push(`Budget fit: ฿${priceNum.toLocaleString()} fits your premium budget range.`);
    }
  }

  const seatChoice = String(answers.seat_choice || answers.seats || '').toLowerCase();
  if (seatChoice && seatsNum) {
    if (seatChoice.includes('2') && seatChoice.includes('seat') && seatsNum === 2) {
      reasons.push(`Seats: ${seatsNum} seats matches your preference.`);
    } else if (seatChoice.includes('3-5') && seatsNum >= 3 && seatsNum <= 5) {
      reasons.push(`Seats: ${seatsNum} seats matches your family use.`);
    } else if (seatChoice.includes('5') && seatsNum >= 5) {
      reasons.push(`Seats: ${seatsNum} seats fits your group size.`);
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
      reasons.push(`Fuel: ${label} aligns with your eco preference.`);
    }
  }

  const distance = String(answers.daily_distance || answers.distance || '').toLowerCase();
  const rangeNum = Number(String(car.rangeKm || car.range_km || '').replace(/[^\d]/g, '')) || 0;
  if (distance && rangeNum) {
    reasons.push(`Range: ${rangeNum} km fits your daily distance.`);
  }

  const usage = Array.isArray(answers.usage) ? answers.usage.join(' ') : String(answers.usage || '');
  if (usage.toLowerCase().includes('city') && car.bodyType) {
    reasons.push(`Body type: ${car.bodyType} suits city driving.`);
  }

  return reasons.filter(Boolean).slice(0, 3);
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

const MODEL_COLOR_FALLBACKS = {
  'mg4 electric': ['Arctic White', 'Volcano Orange', 'Black Knight', 'Andes Grey'],
  'mg zs ev': ['Arctic White', 'Black Knight', 'Silver Metallic'],
  'mg5': ['Pearl White', 'Andes Grey', 'Black Knight', 'Scarlet Red'],
  'mg3 hybrid+': ['Arctic White', 'Brixton Blue', 'Black Knight', 'Cosmic Silver'],
  'mg im6': ['Raphael Beige', 'Black Knight', 'Moonlight Silver']
};

function colorHexFromName(name = '') {
  const lower = String(name).toLowerCase();
  const k = Object.keys(COLOR_HEX).find((x) => lower.includes(x));
  return k ? COLOR_HEX[k] : '#d9d9d9';
}

const SIMPLE_COLOR_RULES = [
  { name: 'Black', test: /black|knight|midnight|carbon|graphite/ },
  { name: 'White', test: /white|arctic|pearl|snow/ },
  { name: 'Grey', test: /grey|gray|granite|ash|slate/ },
  { name: 'Silver', test: /silver|metallic|titanium|chrome/ },
  { name: 'Red', test: /red|scarlet|ruby|crimson/ },
  { name: 'Blue', test: /blue|navy|azure|sky|cobalt/ },
  { name: 'Green', test: /green|emerald|forest|olive/ },
  { name: 'Yellow', test: /yellow|gold/ },
  { name: 'Orange', test: /orange|bronze|copper/ },
  { name: 'Brown', test: /brown|chocolate|coffee/ },
  { name: 'Beige', test: /beige|champagne|sand|khaki/ },
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
  const la = Number(lat);
  const lo = Number(lng);
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
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if ([a1, o1, a2, o2].some((v) => Number.isNaN(v))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

export default function App() {
  const [page, setPage] = useState('landing');
  const [activeNav, setActiveNav] = useState('');
  const [pageHistory, setPageHistory] = useState(['landing']);
  const backNavRef = useRef(false);
  const [answers, setAnswers] = useState({});
  const [selectedCar, setSelectedCar] = useState(null);
  const [results, setResults] = useState([]);
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
  const hasQuizAnswers = useMemo(() => {
    return Object.values(answers || {}).some((v) => {
      if (Array.isArray(v)) return v.length > 0;
      return Boolean(String(v || '').trim());
    });
  }, [answers]);
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
  const [publicPromotions, setPublicPromotions] = useState([]);
  const [publicBestSellers, setPublicBestSellers] = useState([]);
  const [publicAdminModels, setPublicAdminModels] = useState([]);
  const [adminAnalytics, setAdminAnalytics] = useState(null);
  const [adminBookings, setAdminBookings] = useState([]);
  const [adminPromotions, setAdminPromotions] = useState([]);
  const [adminBestSellers, setAdminBestSellers] = useState([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminSection, setAdminSection] = useState('overview');
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
  const [adminModelForm, setAdminModelForm] = useState({
    model: '',
    variant: '',
    year: '',
    price_thb: '',
    fuel_type: '',
    seats: '',
    body_type: '',
    horsepower_hp: '',
    torque_nm: '',
    range_km: '',
    cargo_liters: '',
    image_url: ''
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
  const models = useMemo(() => [...baseModels, ...publicAdminModels], [baseModels, publicAdminModels]);
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

  const promoCars = useMemo(() => {
    const a = models.find((m) => m.model.toLowerCase().includes('vs hev')) || models.find((m) => m.model.toLowerCase().includes('mg5'));
    const b = models.find((m) => m.model.toLowerCase().includes('mg4')) || models[1];
    return [a, b].filter(Boolean);
  }, [models]);

  const provinceOptions = useMemo(() => {
    const all = [...new Set(showroomsData.map((s) => provinceFromShowroom(s)))].sort();
    return all.length ? all : ['Bangkok'];
  }, []);

  useEffect(() => {
    if (!showroomPostal && answers.postalCode) {
      setShowroomPostal(String(answers.postalCode));
    }
  }, [answers, showroomPostal]);

  const filteredShowrooms = useMemo(() => {
    const selected = normalizeProvince(province);
    return showroomsData.filter((s) => normalizeProvince(provinceFromShowroom(s)) === selected);
  }, [province]);

  const showroomModelOptions = useMemo(() => {
    return [...new Set(models.map((m) => m.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const showroomTarget = useMemo(() => {
    if (!filteredShowrooms.length) return null;
    const postal = String(showroomPostal || '').trim();
    const withPostal = filteredShowrooms.map((s) => ({ ...s, postal: postalFromAddress(s.address) }));

    const averageCenter = (list) => {
      if (!list.length) return null;
      const points = list
        .map((x) => ({ lat: Number(x.lat), lng: Number(x.lng) }))
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
  }, [filteredShowrooms, showroomPostal]);

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
          dist = haversineKm(showroomTarget.lat, showroomTarget.lng, s.lat, s.lng);
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
  }, [filteredShowrooms, province, showroomPostal, showroomTarget, showroomModelPref]);

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
      if (p.variant_key && selectedVariantKey) return p.variant_key === selectedVariantKey;
      if (p.model_name) return normModelName(p.model_name) === model;
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

  const defaultPriceValue = Math.round((modelPriceBounds.min + modelPriceBounds.max) / 2);
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

      if (search && !haystack.includes(search)) return false;
      if (modelFilters.fuel !== 'All' && m.fuel !== modelFilters.fuel) return false;
      if (modelFilters.seats !== 'All' && String(m.seats || '').replace('.0', '') !== modelFilters.seats) return false;
      if (modelFilters.bodyType !== 'All' && m.bodyType !== modelFilters.bodyType) return false;
      if (maxPrice && !Number.isNaN(priceNum) && priceNum > maxPrice) return false;
      if (modelFilters.colors.length && !modelFilters.colors.some((c) => modelColors.includes(c))) return false;
      return true;
    });
  }, [models, modelFilters, modelPriceValue]);

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

    fetch(`${API_BASE}/public/admin-models`)
      .then((r) => r.json())
      .then((d) => setPublicAdminModels(d.models || []))
      .catch(() => {});
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
      })
      .catch(() => {
        localStorage.removeItem('mgnition_token');
        setToken('');
        setCurrentUser(null);
        setSavedCars([]);
      });
  }, [token, variantByKey, modelByName]);

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

    refreshAdminPromotions();
    refreshAdminBestSellers();
  }, [page, token, currentUser]);

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

  const onGetResults = async (targetPage = 'results') => {
    setLoading(true);
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

      if (token) {
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
      if (!res.ok) throw new Error('fallback');
      const data = await res.json();
      const mapped = mapApiResultsToModels(data.recommendations || data.results || [], models, variantByKey);
      setResults(mapped.length ? mapped : getFilteredLocalResults());
    } catch {
      setResults(getFilteredLocalResults());
    } finally {
      setLoading(false);
      setActiveNav(targetPage === 'home' ? 'Home' : 'Recommended Cars');
      setPage(targetPage);
    }
  };

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
    await onGetResults('home');
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
    setAnswers({});
    setPage('landing');
    setActiveNav('');
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
    refreshPublicPromotions();
    refreshAdminPromotions();
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

  const handleAddAdminModel = async (e) => {
    e.preventDefault();
    setAdminMessage('');
    const res = await fetch(`${API_BASE}/admin/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(adminModelForm)
    });
    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Failed to add model.');
      return;
    }
    setAdminMessage('Model added successfully.');
    setAdminModelForm({
      model: '',
      variant: '',
      year: '',
      price_thb: '',
      fuel_type: '',
      seats: '',
      body_type: '',
      horsepower_hp: '',
      torque_nm: '',
      range_km: '',
      cargo_liters: '',
      image_url: ''
    });
    fetch(`${API_BASE}/public/admin-models`)
      .then((r) => r.json())
      .then((d) => setPublicAdminModels(d.models || []))
      .catch(() => {});
  };

  const handleSaveModel = async (car) => {
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
      setActiveNav('Saved Results');
      setPage('saved');
    }
  };

  const handleViewDetails = async (car) => {
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

  const handleRemoveSaved = async (variantKey) => {
    if (!token) return;
    const encoded = encodeURIComponent(variantKey);
    const res = await fetch(`${API_BASE}/saved-models/${encoded}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) setSavedCars((data.saved_models || []).map((x) => hydrateSavedCar(x, variantByKey, modelByName)));
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
    if (!token) {
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
      const snapshot = {
        showroom: activeShowroom.name,
        province,
        model: bookingForm.model,
        variant: chosenVariant?.label || 'Any variant',
        notes: bookingForm.notes || '',
        confirmedAt: new Date().toISOString()
      };
      setConfirmedBooking(snapshot);
      setBookingMessage(wasConfirmed ? 'Booking updated. Admin can now see the latest details.' : 'Booking confirmed. Admin can now see this booking.');
      setPage('booking');
    } catch (err) {
      setBookingError(err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const homeRecommendations = (results.length ? results : getFilteredLocalResults()).slice(0, 3);
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
  const adminNavItems = [
    { key: 'overview', label: 'Overview' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'promotions', label: 'Promotions' },
    { key: 'models', label: 'Models' },
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
          onLogout={handleLogout}
        />
      )}
      {page === 'landing' && (
        <>
          <section className="hero" style={{ backgroundImage: `url(${HERO_IMG})` }}>
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
                  onClick={() => {
                    setActiveNav('Home');
                    setPage('home');
                  }}
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
        </>
      )}

      {page === 'home' && (
        <>
          <section className="page-section" id="home-content">
            {!isGuest && hasQuizAnswers && (
              <>
                <div className="home-section-head">
                  <h1>Recommended Cars</h1>
                  <h2>Best Matches Based On Your Preferences</h2>
                  {token && hasQuizAnswers && (
                    <button className="btn light" type="button" onClick={() => setPage('onboarding')}>
                      Update Preferences
                    </button>
                  )}
                  {!token && (
                    <button className="btn light" type="button" onClick={() => { setAuthMode('signup'); setPage('auth'); }}>
                      Sign up to personalize recommendations
                    </button>
                  )}
                </div>
                <div className="cards three">
                  {(homeRecommendations.length ? homeRecommendations : bestSellerCars).map((car) => (
                    <CarCard
                      key={savedCarKey(car)}
                      car={car}
                      onView={handleViewDetails}
                      onCompare={isGuest ? null : handleAddToCompare}
                      onSave={isGuest ? null : handleSaveModel}
                      isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                    />
                  ))}
                </div>
              </>
            )}
            {!isGuest && !isAdmin && !hasQuizAnswers && (
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
                    onSave={isGuest ? null : handleSaveModel}
                    isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                  />
                ))}
              </div>
            </div>

            <div className="right-content">
              <h2>
                Pro<span>motion</span>
              </h2>
              {publicPromotions.length ? (
                publicPromotions.map((promo) => (
                  <div key={promo.id} className="promo-card">
                    <img src={resolvePromotionImage(promo)} alt={promo.title} />
                    <div>
                      <h3>{promo.price_text || promo.title}</h3>
                      <p>{promo.description || 'Limited-time offer from MGNITION'}</p>
                      <p>{promo.badge_text || 'Limited Promotion'}</p>
                      {(promo.start_date || promo.end_date) && (
                        <p>
                          {promo.start_date || 'Now'} - {promo.end_date || 'Until stocks last'}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted-text">No active promotions right now.</p>
              )}
            </div>
          </section>
        </>
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
                      const selected =
                        currentQuestion.type === 'multi'
                          ? (Array.isArray(answers[currentQuestion.key]) && answers[currentQuestion.key].includes(option))
                          : answers[currentQuestion.key] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          className={selected ? 'quiz-option selected' : 'quiz-option'}
                          onClick={() =>
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
          <h1>Recommended Cars</h1>
          <h2>Best Matches Based On Your Preferences</h2>
          {hasQuizAnswers ? (
            <>
              <button className="btn light" type="button" onClick={() => { setActiveNav('Our Models'); setPage('models'); }}>
                Back to Our Models
              </button>
              <div className="cards three">
                {(results.length ? results : bestSellerCars).slice(0, 3).map((car) => (
                  <CarCard
                    key={savedCarKey(car)}
                    car={car}
                    onView={handleViewDetails}
                    onCompare={isGuest ? null : handleAddToCompare}
                    onSave={isGuest ? null : handleSaveModel}
                    isSaved={savedKeySet.has(car.variant_key) || savedKeySet.has(String(car.model || '').toLowerCase())}
                  />
                ))}
              </div>
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
                <div>
                  <strong>{car.model}</strong>
                  <span>Starting price {car.price}</span>
                  {car.variant && <span>Variant: {car.variant}</span>}
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

          {(() => {
            const explicitReasons = selectedCar.explanation?.top_reasons || [];
            const fallbackReasons = buildQuizReasons(answers, selectedCar);
            const reasons = explicitReasons.length ? explicitReasons : fallbackReasons;
            return (
              !!reasons.length && (
            <article className="detail-explainer">
              <h3>Why this was recommended</h3>
              <ul>
                {reasons.map((reason, idx) => (
                  <li key={`reason-${idx}`}>{reason}</li>
                ))}
              </ul>
            </article>
              )
            );
          })()}

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
                Enter your province and optional postal code to match the nearest MG showroom and book a consultation.
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
              <span className="showroom-meta">
                {smartShowrooms.length} showroom{smartShowrooms.length === 1 ? '' : 's'} found in {province}
              </span>
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
                      <span className="showroom-match">Match {s.matchScore || 0}</span>
                    </div>
                  </div>
                  <div className="showroom-card-meta">
                    <div>
                      <span className="meta-label">Phone</span>
                      <strong>{s.phone || '-'}</strong>
                    </div>
                    <div className="meta-tags">
                      {(s.reasons || []).slice(0, 2).map((reason) => (
                        <span key={reason} className="tag-pill">{reason}</span>
                      ))}
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
                    <button
                      className="btn black"
                      onClick={() => {
                        setSelectedShowroom(s);
                        setPage('booking');
                      }}
                      type="button"
                    >
                      Book consultation
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {page === 'map' && (
        <section className="map-page">
          <iframe title="map" src="https://www.openstreetmap.org/export/embed.html?bbox=99.8%2C13.3%2C100.9%2C14.2&layer=mapnik" />
          <div className="showroom-list-wrap">
            <h3>Showrooms in {province}</h3>
            <div className="showroom-list">
              {smartShowrooms.map((s) => (
                <article key={s.id} className="showroom-card">
                  <div className="showroom-card-head">
                    <h4>{s.name}</h4>
                    <span>{s.smartDistanceKm || '-'} KM</span>
                  </div>
                  <p><b>Smart Match:</b> {s.matchScore || 0}</p>
                  <p>{s.address}</p>
                  <p>Postal Code: {postalFromAddress(s.address) || '-'}</p>
                  <p>Phone: {s.phone || '-'}</p>
                  <p className="muted-text">{(s.reasons || []).join(' • ')}</p>
                  <div className="showroom-actions">
                    <a
                      className="btn light"
                      href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Map
                    </a>
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
                  </div>
                </article>
              ))}
            </div>
            {!smartShowrooms.length && <p className="muted-text">No showroom found for this province.</p>}
          </div>
        </section>
      )}

      {page === 'booking' && (
        <section className="page-section booking-page">
          {(() => {
            const showroomName = selectedShowroom?.name || smartShowrooms[0]?.name || filteredShowrooms[0]?.name || '';
            const variantLabel = bookingVariantOptions.find((v) => v.key === bookingForm.variant_key)?.label || 'Any variant';
            const summaryItems = [
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
                    <small>{confirmedBooking ? 'Details saved' : 'Not submitted yet'}</small>
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
                            <th>Date</th>
                            <th>User</th>
                            <th>Showroom</th>
                            <th>Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminBookings.slice(0, 5).map((row) => (
                            <tr key={`booking-preview-${row.id}`}>
                              <td>{row.created_at || '-'}</td>
                              <td>{row.user_name || '-'}</td>
                              <td>{row.showroom_name || '-'}</td>
                              <td>{row.model || '-'}</td>
                            </tr>
                          ))}
                          {!adminBookings.length && (
                            <tr>
                              <td colSpan={4}>No bookings yet.</td>
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
                <div className="admin-grid">
                  <article className="admin-card">
                    <h3>Top Clicked Variants</h3>
                    <ul className="admin-list">
                      {(adminAnalytics?.top_clicked_variants || []).map((r) => (
                        <li key={`click-${r.variant_key}`}>
                          <span>{variantLabelFromKey(r.variant_key)}</span>
                          <strong>{r.cnt}</strong>
                        </li>
                      ))}
                      {!adminAnalytics?.top_clicked_variants?.length && <li>No click data yet.</li>}
                    </ul>
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

                  <article className="admin-card">
                    <h3>Top Booked Variants</h3>
                    <ul className="admin-list">
                      {(adminAnalytics?.top_booked_variants || []).map((r) => (
                        <li key={`booking-rank-${r.variant_key}`}>
                          <span>{variantLabelFromKey(r.variant_key)}</span>
                          <strong>{r.cnt}</strong>
                        </li>
                      ))}
                      {!adminAnalytics?.top_booked_variants?.length && <li>No booking data yet.</li>}
                    </ul>
                  </article>
                </div>

                <article className="admin-card">
                  <div className="admin-card-head">
                    <h3>Conversion by Quiz Segment</h3>
                  </div>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Segment (Fuel | Budget)</th>
                          <th>Impressions</th>
                          <th>Saves</th>
                          <th>Conversion Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(adminAnalytics?.conversion_by_quiz_segment || []).map((row) => (
                          <tr key={row.segment}>
                            <td>{row.segment}</td>
                            <td>{row.impressions}</td>
                            <td>{row.saves}</td>
                            <td>{row.conversion_rate}%</td>
                          </tr>
                        ))}
                        {!adminAnalytics?.conversion_by_quiz_segment?.length && (
                          <tr>
                            <td colSpan={4}>No conversion data yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              </>
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
                          <td>{row.created_at || '-'}</td>
                          <td>{row.user_name || '-'}</td>
                          <td>{row.user_email || '-'} / {row.user_phone || '-'}</td>
                          <td>{row.showroom_name || '-'} ({row.province || '-'})</td>
                          <td>{row.model || '-'}</td>
                          <td>{row.variant || 'Any variant'}</td>
                          <td>{row.status || 'pending'}</td>
                        </tr>
                      ))}
                      {!adminBookings.length && (
                        <tr>
                          <td colSpan={7}>No bookings yet.</td>
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
                    <input placeholder="Image URL" value={promoForm.image_url} onChange={(e) => setPromoForm((p) => ({ ...p, image_url: e.target.value }))} />
                    <input placeholder="Start Date (YYYY-MM-DD)" value={promoForm.start_date} onChange={(e) => setPromoForm((p) => ({ ...p, start_date: e.target.value }))} />
                    <input placeholder="End Date (YYYY-MM-DD)" value={promoForm.end_date} onChange={(e) => setPromoForm((p) => ({ ...p, end_date: e.target.value }))} />
                    <input placeholder="Description" value={promoForm.description} onChange={(e) => setPromoForm((p) => ({ ...p, description: e.target.value }))} />
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


            {adminSection === 'models' && (
              <article className="admin-card">
                <div className="admin-card-head">
                  <h3>Add Car Model / Variant</h3>
                </div>
                <form className="auth-form" onSubmit={handleAddAdminModel}>
                  <input placeholder="Model *" value={adminModelForm.model} onChange={(e) => setAdminModelForm((p) => ({ ...p, model: e.target.value }))} />
                  <input placeholder="Variant" value={adminModelForm.variant} onChange={(e) => setAdminModelForm((p) => ({ ...p, variant: e.target.value }))} />
                  <input placeholder="Year" value={adminModelForm.year} onChange={(e) => setAdminModelForm((p) => ({ ...p, year: e.target.value }))} />
                  <input placeholder="Price (THB)" value={adminModelForm.price_thb} onChange={(e) => setAdminModelForm((p) => ({ ...p, price_thb: e.target.value }))} />
                  <input placeholder="Fuel Type" value={adminModelForm.fuel_type} onChange={(e) => setAdminModelForm((p) => ({ ...p, fuel_type: e.target.value }))} />
                  <input placeholder="Seats" value={adminModelForm.seats} onChange={(e) => setAdminModelForm((p) => ({ ...p, seats: e.target.value }))} />
                  <input placeholder="Body Type" value={adminModelForm.body_type} onChange={(e) => setAdminModelForm((p) => ({ ...p, body_type: e.target.value }))} />
                  <input placeholder="Horsepower (hp)" value={adminModelForm.horsepower_hp} onChange={(e) => setAdminModelForm((p) => ({ ...p, horsepower_hp: e.target.value }))} />
                  <input placeholder="Torque (Nm)" value={adminModelForm.torque_nm} onChange={(e) => setAdminModelForm((p) => ({ ...p, torque_nm: e.target.value }))} />
                  <input placeholder="Range (km)" value={adminModelForm.range_km} onChange={(e) => setAdminModelForm((p) => ({ ...p, range_km: e.target.value }))} />
                  <input placeholder="Cargo (Liters)" value={adminModelForm.cargo_liters} onChange={(e) => setAdminModelForm((p) => ({ ...p, cargo_liters: e.target.value }))} />
                  <input placeholder="Image URL" value={adminModelForm.image_url} onChange={(e) => setAdminModelForm((p) => ({ ...p, image_url: e.target.value }))} />
                  <button className="btn black full" type="submit">Add Model</button>
                </form>
              </article>
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

function TopBar({ active, navItems, onNav, onAuth, currentUser, onLogout }) {
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
            <span className="user-chip">{currentUser.full_name}</span>
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
