import React, { useMemo, useState } from 'react';
import './App.css';

const WIZARD_STEPS = [
  {
    page: 1,
    key: 'style',
    title: 'MGNITION',
    subtitle: 'Tell us a bit about yourself to help us personalize your MG match.',
    type: 'single-card',
    autoAdvance: true,
    options: ['Classic & Timeless', 'Sporty & Bold', 'Luxury & Elegant']
  },
  {
    page: 2,
    key: 'budget',
    title: "What's your budget for your next MG?",
    type: 'single-list',
    autoAdvance: true,
    options: [
      'Below 700,000 THB',
      '1,000,000 – 1,299,999 THB',
      '700,000 – 999,999 THB',
      '1,300,000 THB and above'
    ]
  },
  {
    page: 3,
    key: 'postalCode',
    title: 'Enter your postal code so we can connect you with the nearest MG showroom.',
    type: 'input',
    placeholder: 'e.g. 10110'
  },
  {
    page: 4,
    key: 'usage',
    title: 'How do you use your car most of the time?',
    type: 'single-list',
    autoAdvance: true,
    options: ['City commuting', 'Cargo & Practical use', 'Highway/Long-distance', 'Eco-conscious lifestyle']
  },
  {
    page: 5,
    key: 'hobbies',
    title: 'What are your hobbies? (Choose more than one if needed)',
    type: 'multi-card',
    options: [
      'City Life & Socializing',
      'Adventure & Travel',
      'Relaxed & Minimalist Lifestyle',
      'Outdoor Sports & Fitness'
    ]
  },
  {
    page: 6,
    key: 'occupation',
    title: 'What is your Occupation?',
    type: 'single-list',
    autoAdvance: true,
    options: ['Student', 'Working Professional', 'Business Owner', 'Family-Oriented', 'Retired', 'Others']
  },
  {
    page: 7,
    key: 'distance',
    title: 'On average, how far do you drive each day?',
    type: 'single-list',
    autoAdvance: true,
    options: [
      'Short distance (0–30 km)',
      'Medium commute (30–80 km)',
      'Long commute (80–150 km)',
      'Very long distance (Over 150 km)'
    ]
  },
  {
    page: 8,
    key: 'seats',
    title: 'How many seats does your MG need?',
    type: 'single-seat',
    autoAdvance: true,
    options: ['2 seats', '3-5 seats', '5+ seats']
  },
  {
    page: 9,
    key: 'fuelType',
    title: 'Which type of fuel fits your lifestyle and driving habits?',
    type: 'single-list',
    autoAdvance: true,
    options: ['Hybrid', 'Petrol (Gasoline)', 'Diesel', 'EV (Electric)']
  }
];

const UI_SECTIONS = [
  'Wizard',
  'Authentication',
  'Car Details & Promos',
  'Browsing & Search',
  'Edit Flow',
  'Showrooms & Booking'
];

const sampleCars = [
  { model: 'ALL NEW MG5', price: 'Starting at 589,900 THB', color: 'Black sedan' },
  { model: 'ALL NEW MG COMET EV', price: 'Starting at 549,900 THB', color: 'Black mini EV' },
  { model: 'ALL NEW MG4', price: 'Starting at 869,000 THB', color: 'Blue hatchback' }
];

function App() {
  const [tab, setTab] = useState('Wizard');
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({ hobbies: [] });
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [recommendations, setRecommendations] = useState([]);

  const currentStep = WIZARD_STEPS[stepIndex];
  const isSplash = stepIndex === WIZARD_STEPS.length;

  const parsedRecommendations = useMemo(() => {
    if (recommendations.length) return recommendations;
    return sampleCars;
  }, [recommendations]);

  const setAnswer = (key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const selectOption = (option) => {
    if (!currentStep) return;
    if (currentStep.type === 'multi-card') {
      const current = answers[currentStep.key] || [];
      const updated = current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
      setAnswer(currentStep.key, updated);
      return;
    }

    setAnswer(currentStep.key, option);
    if (currentStep.autoAdvance) {
      setTimeout(() => goNext(true), 180);
    }
  };

  const isStepValid = () => {
    if (!currentStep) return true;
    const value = answers[currentStep.key];
    if (currentStep.type === 'input') return Boolean(value && String(value).trim());
    if (currentStep.type === 'multi-card') return Array.isArray(value) && value.length > 0;
    return Boolean(value);
  };

  const goNext = async (silent = false) => {
    if (!silent && !isStepValid()) return;

    if (stepIndex === WIZARD_STEPS.length - 1) {
      setStepIndex(WIZARD_STEPS.length);
      await fetchRecommendations();
      return;
    }

    setStepIndex((prev) => Math.min(prev + 1, WIZARD_STEPS.length));
  };

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((prev) => prev - 1);
  };

  const resetWizard = () => {
    setStepIndex(0);
    setAnswers({ hobbies: [] });
    setApiError('');
    setRecommendations([]);
    setLoading(false);
  };

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      setApiError('');

      const response = await fetch('http://localhost:5001/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers)
      });

      if (!response.ok) throw new Error(`Request failed (${response.status})`);

      const data = await response.json();
      const cars = data.recommendations || data.results || data.cars || [];
      setRecommendations(Array.isArray(cars) ? cars : []);
      setTab('Browsing & Search');
    } catch (error) {
      setApiError('Could not connect to recommendation API. Showing demo cards instead.');
      setRecommendations([]);
      setTab('Browsing & Search');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>MGNITION</h1>
        <div className="tab-row">
          {UI_SECTIONS.map((section) => (
            <button
              key={section}
              className={`tab-btn ${tab === section ? 'active' : ''}`}
              onClick={() => setTab(section)}
              type="button"
            >
              {section}
            </button>
          ))}
        </div>
      </header>

      <main className="main-card">
        {tab === 'Wizard' && (
          <section>
            {!isSplash ? (
              <>
                <p className="step-meta">Page {currentStep.page} of 10</p>
                <h2>{currentStep.title}</h2>
                {currentStep.subtitle && <p className="muted">{currentStep.subtitle}</p>}

                {(currentStep.type === 'single-card' || currentStep.type === 'multi-card') && (
                  <div className="card-grid">
                    {currentStep.options.map((option) => {
                      const selected = Array.isArray(answers[currentStep.key])
                        ? answers[currentStep.key].includes(option)
                        : answers[currentStep.key] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          className={`option-card ${selected ? 'selected' : ''}`}
                          onClick={() => selectOption(option)}
                        >
                          <span className="checkbox" />
                          <span>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {(currentStep.type === 'single-list' || currentStep.type === 'single-seat') && (
                  <div className={currentStep.type === 'single-seat' ? 'seat-grid' : 'list-grid'}>
                    {currentStep.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`list-option ${answers[currentStep.key] === option ? 'selected' : ''}`}
                        onClick={() => selectOption(option)}
                      >
                        <span className="checkbox" />
                        <span>{option}</span>
                      </button>
                    ))}
                  </div>
                )}

                {currentStep.type === 'input' && (
                  <input
                    type="number"
                    className="text-input"
                    placeholder={currentStep.placeholder}
                    value={answers[currentStep.key] || ''}
                    onChange={(event) => setAnswer(currentStep.key, event.target.value)}
                  />
                )}

                <div className="action-row">
                  <button type="button" className="ghost-btn" onClick={goBack} disabled={stepIndex === 0}>
                    Back
                  </button>
                  {!currentStep.autoAdvance && (
                    <button type="button" className="primary-btn" onClick={() => goNext(false)}>
                      Next
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="splash-screen">
                <h2>MGNITION</h2>
                <p>{loading ? 'Finding your ideal MG...' : 'Ready.'}</p>
              </div>
            )}
            {apiError && <p className="error-msg">{apiError}</p>}
          </section>
        )}

        {tab === 'Authentication' && (
          <section className="stack">
            <article className="panel">
              <div className="panel-head">
                <span aria-hidden="true">←</span>
                <h3>Sign up</h3>
              </div>
              <input className="text-input" placeholder="Enter your email" />
              <input className="text-input" placeholder="Enter your Password" type="password" />
              <input className="text-input" placeholder="Re-enter your Password" type="password" />
              <button className="dark-btn">Create Account</button>
            </article>

            <article className="panel">
              <h3>Log in or sign up</h3>
              <input className="text-input" placeholder="Email Address" />
              <input className="text-input" placeholder="Password" type="password" />
              <div className="link-row">
                <a href="#0">Forget your Password?</a>
                <a href="#0">sign up</a>
              </div>
              <button className="dark-btn">LOGIN</button>
              <BottomNav />
            </article>
          </section>
        )}

        {tab === 'Car Details & Promos' && (
          <section className="stack">
            <article className="panel">
              <h3>Suitable for:</h3>
              <ul>
                <li>Students</li>
                <li>First-time EV buyers</li>
                <li>City driving</li>
                <li>Budget-conscious users</li>
              </ul>
            </article>

            <article className="panel">
              <h3>Promotion</h3>
              <div className="badge-row">
                <span className="badge">FREE MG Home Charger</span>
                <span className="badge">FREE installation</span>
                <span className="badge">Lifetime Warranty</span>
              </div>
              <p className="price">Special starting price: 549,900 THB</p>
            </article>

            <article className="panel">
              <h3>Suitable for:</h3>
              <ul>
                <li>Family</li>
                <li>Road trips</li>
                <li>Users needing space & comfort</li>
              </ul>
              <div className="badge-row">
                <span className="badge">FREE MG Home Charger</span>
                <span className="badge">FREE installation</span>
                <span className="badge">Lifetime Warranty</span>
              </div>
              <p className="price">Special starting price: 679,900 THB</p>
            </article>

            <article className="panel">
              <h3>Banners</h3>
              <div className="banner">MG VS HEV — 679,900 THB — Lifetime Warranty</div>
              <div className="banner">MG4 — 549,900 THB — Lifetime Warranty</div>
              <div className="label-row">
                <span>MG ZS</span>
                <span>MG5 (Compact Sedan)</span>
                <span>MG3 (Hatchback)</span>
              </div>
            </article>
          </section>
        )}

        {tab === 'Browsing & Search' && (
          <section className="stack">
            <article className="panel">
              <h3>Comparison / Results Grid</h3>
              <div className="compare-grid">
                <CarCard name="White MG (Hatchback)" button="View Details" />
                <CarCard name="Black MG5 (Sedan)" button="View Details" />
              </div>
              <BottomNav />
            </article>

            <article className="panel">
              <h3>Advanced Search Filter</h3>
              <input className="text-input" placeholder="Search model..." />
              <div className="filter-grid">
                <input className="text-input" placeholder="Fuel Type (e.g., Diesel)" />
                <input className="text-input" placeholder="Range (km)" />
                <input className="text-input" placeholder="Seats" />
                <input className="text-input" placeholder="Body Type" />
              </div>
              <label className="slider-wrap">
                Price (THB): 500,000 - 1,400,000
                <input type="range" min="500000" max="1400000" defaultValue="900000" />
              </label>
            </article>

            <article className="panel hero">
              <h2>YOUR IDEAL MG, JUST A CLICK AWAY</h2>
              <button className="primary-btn">Get Started</button>
              <p>MG 7</p>
            </article>

            <article className="panel">
              <h3>Best Matches Based On Your Preferences</h3>
              <div className="compare-grid">
                {parsedRecommendations.map((car, index) => (
                  <CarCard
                    key={`${car.model || car.name || 'car'}-${index}`}
                    name={car.model || car.name || `Model ${index + 1}`}
                    subtitle={car.price || car.starting_price || 'Starting price unavailable'}
                    button="View Details"
                  />
                ))}
              </div>
              <button className="ghost-btn" onClick={resetWizard} type="button">
                Restart Wizard
              </button>
            </article>
          </section>
        )}

        {tab === 'Edit Flow' && (
          <section className="stack">
            {[
              'Seats (2 seats / 5+ seats / 3-5 seats)',
              'Postal Code (e.g. 10110)',
              'Usage (City, Highway, Cargo, Eco)',
              'Hobbies (City Life, Outdoor, Adventure, Relaxed)',
              'Occupation (Student, Working Professional, Business Owner, Family-Oriented, Retired, Others)',
              'Style (Classic, Sporty, Luxury)',
              'Distance (Short, Long, Medium, Very long)',
              'Fuel (EV, Petrol, Diesel, Hybrid)',
              'Budget (Below 700k, 700k-999k, 1M-1.3M, 1.3M+)'
            ].map((line) => (
              <article key={line} className="panel compact">
                <h3>{line}</h3>
                <button className="primary-btn">Next</button>
              </article>
            ))}
          </section>
        )}

        {tab === 'Showrooms & Booking' && (
          <section className="stack">
            <article className="panel">
              <h3>Find Showroom</h3>
              <p>Enter your province so that we can connect you with the nearest MG Show Room.</p>
              <select className="text-input" defaultValue="">
                <option value="" disabled>
                  Province
                </option>
                <option>Bangkok</option>
                <option>Chiang Mai</option>
                <option>Phuket</option>
              </select>
              <button className="primary-btn">FIND SHOW ROOM</button>
            </article>

            <article className="panel">
              <h3>Booking Confirmed!</h3>
              <p>We are pleased to inform that your request has been received...</p>
              <div className="details-grid">
                <span>Name: Simon</span>
                <span>Phone: 091234567</span>
                <span>Showroom Branch: MG Rama 4</span>
                <span>City: Bangkok</span>
              </div>
              <button className="primary-btn">Done</button>
            </article>

            <article className="panel">
              <h3>Map Interface</h3>
              <div className="map-box">
                <span className="pin" style={{ top: '20%', left: '24%' }} />
                <span className="pin" style={{ top: '44%', left: '48%' }} />
                <span className="pin" style={{ top: '62%', left: '65%' }} />
              </div>
              <div className="nearest-card">
                <strong>Nearest MG Showroom from you</strong>
                <p>MG Rama 4 Showroom</p>
                <p>Distance: 2.3 km</p>
                <p>Address: Rama 4 Road, Bangkok</p>
                <button className="primary-btn">Book Consultation</button>
              </div>
            </article>

            <article className="panel">
              <h3>ALL NEW MG4</h3>
              <div className="spec-card">Blue MG4 Image Placeholder</div>
              <div className="details-grid">
                <span>Fuel Type: 100% Electric</span>
                <span>Range: Up to 450 km</span>
                <span>Battery: 64 kWh</span>
                <span>Power: 201 hp</span>
                <span>Acceleration: 0-100 in 7.7s</span>
                <span>Drive: RWD</span>
              </div>
              <p className="price">Starting at 869,000 baht</p>
              <button className="ghost-btn">Save</button>
            </article>

            <article className="panel">
              <h3>Saved Models</h3>
              <div className="chip-row">
                <span className="chip">Sedan</span>
                <span className="chip">Petrol</span>
                <span className="chip">4 seat</span>
                <span className="chip">Sporty</span>
              </div>
              <CarCard name="ALL NEW MG5" subtitle="Black MG5" button="View Details" />
              <CarCard name="ALL NEW MG COMET EV" subtitle="Hatchback • EV" button="View Details" />
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav">
      {['Home', 'Our Models', 'Saved Results', 'Showrooms', 'About Us'].map((item) => (
        <button type="button" key={item}>
          {item}
        </button>
      ))}
    </nav>
  );
}

function CarCard({ name, subtitle, button }) {
  return (
    <div className="car-card">
      <div className="car-image">Car Image</div>
      <h4>{name}</h4>
      {subtitle && <p className="muted">{subtitle}</p>}
      <button className="primary-btn">{button}</button>
    </div>
  );
}

export default App;
