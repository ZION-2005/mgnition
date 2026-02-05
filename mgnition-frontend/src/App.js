import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import modelsData from './data/models.json';
import showroomsData from './data/showrooms.json';
import modelVariantsData from './data/modelVariants.json';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';
const API_RECOMMEND = `${API_BASE}/recommend`;
const NAV_ITEMS = ['Home', 'Our Models', 'Recommended Cars', 'Saved Results', 'Showrooms', 'About Us'];

const HERO_IMG =
  'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1900&q=80';
const RED_GARAGE_IMG =
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1400&q=80';

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
  { key: 'style', label: 'Style Preference', type: 'select', options: ['Classic & Timeless', 'Sporty & Bold', 'Luxury & Elegant'] },
  { key: 'budget', label: 'Budget', type: 'select', options: ['Below 700,000 THB', '700,000 – 999,999 THB', '1,000,000 – 1,299,999 THB', '1,300,000 THB and above'] },
  { key: 'postalCode', label: 'Postal Code', type: 'input', placeholder: 'e.g. 10110' },
  { key: 'usage', label: 'Car Usage', type: 'select', options: ['City commuting', 'Cargo & Practical use', 'Highway/Long-distance', 'Eco-conscious lifestyle'] },
  { key: 'hobbies', label: 'Hobbies', type: 'input', placeholder: 'e.g. Adventure & Travel, City Life' },
  { key: 'occupation', label: 'Occupation', type: 'select', options: ['Student', 'Working Professional', 'Business Owner', 'Family-Oriented', 'Retired', 'Others'] },
  { key: 'distance', label: 'Driving Distance', type: 'select', options: ['Short distance (0–30 km)', 'Medium commute (30–80 km)', 'Long commute (80–150 km)', 'Very long distance (Over 150 km)'] },
  { key: 'seats', label: 'Seats', type: 'select', options: ['2 seats', '3-5 seats', '5+ seats'] },
  { key: 'fuelType', label: 'Fuel Type', type: 'select', options: ['Hybrid', 'Petrol (Gasoline)', 'Diesel', 'EV (Electric)'] }
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

function modelImage(carOrModel) {
  const car = typeof carOrModel === 'object' ? carOrModel : null;
  const model = typeof carOrModel === 'string' ? carOrModel : (car?.model || '');
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

function mapApiResultsToModels(items, allModels) {
  return items
    .map((x) => {
      if (x.variant_key || x.variant) {
        return {
          variant_key: x.variant_key,
          model: x.model || x.name || 'MG Model',
          variant: x.variant || '',
          year: x.year || '',
          price: x.starting_price || x.price || 'N/A',
          fuel: x.fuel || '',
          seats: x.seats || '',
          bodyType: x.bodyType || x.body_type || '',
          imagePageUrl: x.imagePageUrl || x.image_url || ''
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
          bodyType: ''
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
    imagePageUrl: item.imagePageUrl || item.image_url || ''
  };
}

export default function App() {
  const [page, setPage] = useState('home');
  const [activeNav, setActiveNav] = useState('Home');
  const [answers, setAnswers] = useState({});
  const [selectedCar, setSelectedCar] = useState(null);
  const [results, setResults] = useState([]);
  const [province, setProvince] = useState('Bangkok');
  const [loading, setLoading] = useState(false);

  const [token, setToken] = useState(localStorage.getItem('mgnition_token') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [savedCars, setSavedCars] = useState([]);
  const [authMode, setAuthMode] = useState('login');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [signupForm, setSignupForm] = useState({ full_name: '', phone: '', email: '', password: '', confirm_password: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });

  const models = useMemo(() => modelsData.filter((m) => m.model), []);
  const variantRows = useMemo(() => modelVariantsData.filter((r) => r.Model), []);

  const bestSellerCars = useMemo(() => {
    const wanted = ['MG 3 Hybrid+', 'MG5', 'MG ZS'];
    const list = wanted
      .map((name) => models.find((m) => m.model.toLowerCase().includes(name.toLowerCase())))
      .filter(Boolean);
    return list.length ? list : models.slice(0, 3);
  }, [models]);

  const promoCars = useMemo(() => {
    const a = models.find((m) => m.model.toLowerCase().includes('vs hev')) || models.find((m) => m.model.toLowerCase().includes('mg5'));
    const b = models.find((m) => m.model.toLowerCase().includes('mg4')) || models[1];
    return [a, b].filter(Boolean);
  }, [models]);

  const provinceOptions = useMemo(() => {
    const all = [...new Set(showroomsData.map((s) => provinceFromShowroom(s)))].sort();
    return all.length ? all : ['Bangkok'];
  }, []);

  const filteredShowrooms = useMemo(() => {
    const selected = normalizeProvince(province);
    return showroomsData.filter((s) => normalizeProvince(provinceFromShowroom(s)) === selected);
  }, [province]);

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

  const modelsByFuel = useMemo(() => {
    const grouped = {};
    models.forEach((m) => {
      const key = (m.fuel || 'Other').trim();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    });
    return grouped;
  }, [models]);

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
        setSavedCars((data.saved_models || []).map(normalizeSavedCar));
      })
      .catch(() => {
        localStorage.removeItem('mgnition_token');
        setToken('');
        setCurrentUser(null);
        setSavedCars([]);
      });
  }, [token]);

  const onNav = (item) => {
    setActiveNav(item);
    if (item === 'Home') setPage('home');
    if (item === 'Our Models') setPage('models');
    if (item === 'Recommended Cars') setPage('results');
    if (item === 'Saved Results') {
      if (!token) {
        setPage('auth');
        return;
      }
      setPage('saved');
    }
    if (item === 'Showrooms') setPage('showrooms');
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

  const onGetResults = async () => {
    setLoading(true);
    try {
      const payload = {
        ...answers,
        hobbies: String(answers.hobbies || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
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
      const mapped = mapApiResultsToModels(data.recommendations || data.results || [], models);
      setResults(mapped.length ? mapped : getFilteredLocalResults());
    } catch {
      setResults(getFilteredLocalResults());
    } finally {
      setLoading(false);
      setActiveNav('Recommended Cars');
      setPage('results');
    }
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
      setPage('home');
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
      setAnswers(data.profile?.quiz_answers || {});
      setSavedCars((data.saved_models || []).map(normalizeSavedCar));
      setPage('home');
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
    setPage('home');
    setActiveNav('Home');
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
      setSavedCars((data.saved_models || []).map(normalizeSavedCar));
      setActiveNav('Saved Results');
      setPage('saved');
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
    if (res.ok) setSavedCars((data.saved_models || []).map(normalizeSavedCar));
  };

  return (
    <div className="app">
      <TopBar
        active={activeNav}
        onNav={onNav}
        onAuth={() => setPage('auth')}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {page === 'home' && (
        <section className="hero" style={{ backgroundImage: `url(${HERO_IMG})` }}>
          <div className="hero-overlay">
            <h1>YOUR IDEAL MG, JUST A CLICK AWAY</h1>
            <button className="btn black" onClick={() => setPage('discover')} type="button">
              Get Started
            </button>
          </div>
          <p className="hero-badge">MG 7</p>
        </section>
      )}

      {page === 'discover' && (
        <section className="discover-shell">
          <div className="left-photo" style={{ backgroundImage: `url(${RED_GARAGE_IMG})` }}>
            <aside className="filter-panel fixed">
              <h3>Find your MG</h3>
              {quizQuestions.map((q) => (
                <div key={q.key} className="q-row">
                  <label>{q.label}</label>
                  {q.type === 'input' ? (
                    <input
                      value={answers[q.key] || ''}
                      onChange={(e) => setAnswers((p) => ({ ...p, [q.key]: e.target.value }))}
                      placeholder={q.placeholder || q.label}
                    />
                  ) : (
                    <select value={answers[q.key] || ''} onChange={(e) => setAnswers((p) => ({ ...p, [q.key]: e.target.value }))}>
                      <option value="">Select</option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              <button className="btn black full" type="button" onClick={onGetResults}>
                {loading ? 'Loading...' : 'Get Results'}
              </button>
              {currentUser && <p className="persist-note">Signed in as {currentUser.full_name}. Your quiz answers are saved.</p>}
            </aside>
          </div>

          <div className="discover-feed">
            <div className="right-content">
              <h2>
                Best <span>sellers</span>
              </h2>
              <div className="cards two">
                {bestSellerCars.map((car) => (
                  <CarCard key={car.model} car={car} onView={(c) => { setSelectedCar(c); setPage('details'); }} />
                ))}
              </div>
            </div>

            <div className="right-content">
              <h2>
                Pro<span>motion</span>
              </h2>
              {promoCars.map((car) => (
                <div key={car.model} className="promo-card">
                  <img src={modelImage(car)} alt={car.model} />
                  <div>
                    <h3>Special starting price: {car.price}</h3>
                    <p>FREE MG Home Charger</p>
                    <p>FREE installation</p>
                    <p>Lifetime Warranty</p>
                    <p>Suitable for city driving and family use</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {page === 'results' && (
        <section className="page-section">
          <h1>Recommended Cars</h1>
          <h2>Best Matches Based On Your Preferences</h2>
          <button className="btn light" type="button" onClick={() => { setActiveNav('Our Models'); setPage('models'); }}>
            Back to Our Models
          </button>
          <div className="cards three">
            {(results.length ? results : bestSellerCars).slice(0, 3).map((car) => (
              <CarCard key={car.model} car={car} onView={(c) => { setSelectedCar(c); setPage('details'); }} />
            ))}
          </div>
        </section>
      )}

      {page === 'models' && (
        <section className="page-section">
          <h1>Our Models</h1>
          <h2>All Cars In Our Database</h2>
          {Object.entries(modelsByFuel).map(([fuel, fuelModels]) => (
            <div key={fuel} className="model-list-group">
              <h3>{fuel}</h3>
              <div className="model-list-grid">
                {fuelModels.map((car) => (
                  <button
                    key={car.model}
                    type="button"
                    className="model-list-item"
                    onClick={() => {
                      setSelectedCar(car);
                      setPage('details');
                    }}
                  >
                    <img src={modelImage(car)} alt={car.model} />
                    <div>
                      <strong>{car.model}</strong>
                      <span>Starting price {car.price}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {page === 'details' && selectedCar && (
        <section className="page-section">
          <h1>{selectedCar.model}</h1>
          <img className="detail-image" src={modelImage(selectedCar)} alt={selectedCar.model} />
          <h3>Starting at {selectedCar.price}</h3>
          <div className="specs">
            <p><b>Fuel Type:</b> {selectedCar.fuel || 'N/A'}</p>
            <p><b>Seats:</b> {String(selectedCar.seats || '').replace('.0', '') || 'N/A'}</p>
            <p><b>Body Type:</b> {selectedCar.bodyType || 'N/A'}</p>
            <p><b>Available Variants:</b> {selectedModelVariants.length || 'N/A'}</p>
          </div>

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

          <button className="btn black" onClick={() => handleSaveModel(selectedCar)} type="button">
            Save to My Account
          </button>
        </section>
      )}

      {page === 'auth' && (
        <section className="auth-layout">
          <div className="auth-box">
            <button className="back" onClick={() => setPage('home')} type="button">←</button>
            <img src="/mgnition-logo.png" alt="logo" className="auth-logo" />
            <h3>{authMode === 'login' ? 'Log in to your account' : 'Create your account'}</h3>
            <div className="auth-switch">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')} type="button">Login</button>
              <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')} type="button">Sign Up</button>
            </div>

            {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="auth-form">
                <input
                  placeholder="Email Address *"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                />
                <input
                  placeholder="Password *"
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                />
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Signing in...' : 'LOGIN'}
                </button>
              </form>
            ) : (
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
                <input
                  placeholder="Password (min 8 chars) *"
                  type="password"
                  value={signupForm.password}
                  onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))}
                />
                <input
                  placeholder="Confirm Password *"
                  type="password"
                  value={signupForm.confirm_password}
                  onChange={(e) => setSignupForm((p) => ({ ...p, confirm_password: e.target.value }))}
                />
                <button className="btn black full" disabled={authLoading} type="submit">
                  {authLoading ? 'Creating account...' : 'CREATE ACCOUNT'}
                </button>
              </form>
            )}
            {authError && <p className="auth-error">{authError}</p>}
          </div>
          <div className="auth-art" style={{ backgroundImage: `url(${RED_GARAGE_IMG})` }} />
        </section>
      )}

      {page === 'showrooms' && (
        <section className="page-section center">
          <h2>Enter your province so that we can connect you with the nearest MG Show Room.</h2>
          <select value={province} onChange={(e) => setProvince(e.target.value)}>
            {provinceOptions.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className="btn black" onClick={() => setPage('map')} type="button">
            FIND SHOW ROOM
          </button>
          {filteredShowrooms.length > 0 && (
            <div className="showroom-preview">
              {filteredShowrooms.slice(0, 3).map((s) => (
                <article key={s.id} className="showroom-card">
                  <div className="showroom-card-head">
                    <h4>{s.name}</h4>
                    <span>{estimateDistanceKm(s.lat, s.lng, province) || '-'} KM</span>
                  </div>
                  <p>{s.address}</p>
                  <p>Phone: {s.phone || '-'}</p>
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
              {filteredShowrooms.map((s) => (
                <article key={s.id} className="showroom-card">
                  <div className="showroom-card-head">
                    <h4>{s.name}</h4>
                    <span>{estimateDistanceKm(s.lat, s.lng, province) || '-'} KM</span>
                  </div>
                  <p>{s.address}</p>
                  <p>Postal Code: {postalFromAddress(s.address) || '-'}</p>
                  <p>Phone: {s.phone || '-'}</p>
                  <div className="showroom-actions">
                    <a
                      className="btn light"
                      href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Map
                    </a>
                    <button className="btn black" onClick={() => setPage('booking')} type="button">
                      Book Consultation
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!filteredShowrooms.length && <p className="muted-text">No showroom found for this province.</p>}
          </div>
        </section>
      )}

      {page === 'booking' && (
        <section className="page-section">
          <h1>Booking Confirmed!</h1>
          <p>We are pleased to inform that your request has been received and confirmed.</p>
          <div className="booking-box">
            <h3>Booking details</h3>
            <p>Name: {currentUser?.full_name || 'Guest'}</p>
            <p>Phone: {currentUser?.phone || '-'}</p>
            <p>Showroom Branch: {filteredShowrooms[0]?.name || 'MG Rama 4 showroom'}</p>
            <p>City: {province}</p>
          </div>
          <button className="btn light" onClick={() => setPage('home')} type="button">
            Done
          </button>
        </section>
      )}

      {page === 'saved' && (
        <section className="page-section">
          <h1>Saved Models</h1>
          {!token && <p>Please sign in to view your saved models.</p>}
          {token && !savedCars.length && <p>No saved models yet. Click "Save to My Account" on a car details page.</p>}
          {savedCars.map((car) => (
            <div className="saved-row" key={car.model}>
              <img src={modelImage(car)} alt={car.model} />
              <div>
                <h3>{car.model}</h3>
                <div className="tags">
                  <span>{car.bodyType || 'Body Type'}</span>
                  <span>{car.fuel || 'Fuel'}</span>
                  <span>{String(car.seats).replace('.0', '') || '-'} seat</span>
                </div>
                <div className="saved-actions">
                  <button className="btn black" onClick={() => { setSelectedCar(car); setPage('details'); }} type="button">
                    View Details
                  </button>
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
    </div>
  );
}

function TopBar({ active, onNav, onAuth, currentUser, onLogout }) {
  return (
    <header className="topbar">
      <img src="/mgnition-logo.png" alt="MGNITION" />
      <nav>
        {NAV_ITEMS.map((item) => (
          <button key={item} className={active === item ? 'nav active' : 'nav'} onClick={() => onNav(item)} type="button">
            {item}
          </button>
        ))}
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

function CarCard({ car, onView }) {
  return (
    <article className="car-card">
      <img src={modelImage(car)} alt={car.model} />
      <h3>{car.model}</h3>
      {car.variant && <p>Variant: {car.variant}</p>}
      <p>Starting {car.price}</p>
      <button className="btn black" onClick={() => onView(car)} type="button">
        View Details
      </button>
    </article>
  );
}
