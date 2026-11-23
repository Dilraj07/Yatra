import React, { useState, useEffect, useCallback } from 'react';
import {
  Compass,
  Radio,
  Plane,
  Building,
  Sun,
  Wind,
  RefreshCw,
  CreditCard,
  PlusCircle,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { openRazorpayCheckout } from '../api/payment';

const PRESET_CITIES = [
  { id: 'goa', name: 'Goa' },
  { id: 'agra', name: 'Agra' },
  { id: 'bengaluru', name: 'Bengaluru' },
  { id: 'delhi', name: 'Delhi' },
  { id: 'jaipur', name: 'Jaipur' },
];

export default function LiveRadarSection({ activeTripId, tripDetail, onRefresh, notify }) {
  const [selectedCity, setSelectedCity] = useState('goa');
  const [customCity, setCustomCity] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [flightsData, setFlightsData] = useState(null);
  const [hotelsData, setHotelsData] = useState(null);
  const [weatherData, setWeatherData] = useState(null);

  const fetchLiveFeeds = useCallback(async (cityKey) => {
    setLoading(true);
    try {
      const city = cityKey || selectedCity;
      const [flightsRes, hotelsRes, weatherRes] = await Promise.all([
        apiRequest(`/api/radar/flights?city=${encodeURIComponent(city)}`).catch(() => null),
        apiRequest(`/api/radar/hotels?city=${encodeURIComponent(city)}`).catch(() => null),
        apiRequest(`/api/radar/weather?city=${encodeURIComponent(city)}`).catch(() => null),
      ]);

      if (flightsRes) setFlightsData(flightsRes);
      if (hotelsRes) setHotelsData(hotelsRes);
      if (weatherRes) setWeatherData(weatherRes);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      if (notify) notify('error', 'Live radar feed error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedCity, notify]);

  // Initial load and on city change
  useEffect(() => {
    fetchLiveFeeds(selectedCity);
  }, [selectedCity, fetchLiveFeeds]);

  // Auto-refresh interval (every 15s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLiveFeeds(selectedCity);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedCity, fetchLiveFeeds]);

  function handleCityChange(cityId) {
    setSelectedCity(cityId);
    setCustomCity('');
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (!customCity.trim()) return;
    setSelectedCity(customCity.trim().toLowerCase());
  }

  async function handleBookHotel(hotel) {
    openRazorpayCheckout({
      amountInr: hotel.est_cost_inr || 4500,
      description: `Instant Live Booking: ${hotel.name}`,
      notes: {
        hotel_name: hotel.name,
        locality: hotel.locality,
        trip_id: String(activeTripId || 1),
        source: 'Accommodations Live Radar',
      },
      onSuccess: (paymentResp) => {
        if (notify) {
          notify(
            'success',
            `Confirmed! Room booked at ${hotel.name}. Payment ID: ${paymentResp.razorpay_payment_id}`
          );
        }
      },
      onFailure: (err) => {
        if (notify) notify('error', err.message);
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Header Banner - Matching Trip Workspace */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-xs font-semibold uppercase tracking-wider bg-block-lime text-black border border-black/10">
                <Radio className="w-3.5 h-3.5" /> Live Radar
              </span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-pill bg-surface-soft border border-hairline text-black/70">
                Live Feed Active
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-black">
              Flights & Accommodations Radar
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-black/60 pt-0.5">
              <span className="flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-black/40" /> Commercial Airspace
              </span>
              <span className="flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-black/40" /> Verified Accommodations
              </span>
              <span className="flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-black/40" /> Ground Conditions
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none bg-surface-soft px-3 py-1.5 rounded-pill border border-hairline text-black/70">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-black"
              />
              <span>Auto-poll (15s)</span>
            </label>
            <button
              onClick={() => fetchLiveFeeds(selectedCity)}
              disabled={loading}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Refreshing...' : 'Ping Telemetry'}
            </button>
          </div>
        </div>
      </div>

      {/* Sector Selector & Live Weather Bar */}
      <div className="bg-white border border-hairline rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold text-black/50 mr-1">SECTOR:</span>
            {PRESET_CITIES.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCityChange(c.id)}
                className={`text-xs px-3.5 py-1.5 rounded-pill font-semibold transition-all ${
                  selectedCity === c.id
                    ? 'bg-black text-white shadow-xs'
                    : 'bg-surface-soft text-black/70 hover:bg-hairline hover:text-black border border-hairline'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              placeholder="Search city (e.g. Manali, Kochi)..."
              value={customCity}
              onChange={(e) => setCustomCity(e.target.value)}
              className="field-input text-xs py-1.5 px-3 w-48"
            />
            <button type="submit" className="btn-secondary text-xs py-1.5 px-3">
              Track
            </button>
          </form>
        </div>

        {/* Live Weather Widget */}
        {weatherData?.weather && (
          <div className="rounded-xl bg-surface-soft p-3.5 flex flex-wrap items-center justify-between gap-4 border border-hairline">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white border border-hairline text-black flex items-center justify-center font-bold shadow-2xs">
                <Sun className="w-4 h-4 text-black/70" />
              </div>
              <div>
                <div className="text-xs text-black/50 font-mono uppercase">
                  {weatherData.city} Ground Conditions
                </div>
                <div className="text-base font-bold text-black flex items-center gap-2">
                  <span>{weatherData.weather.temperature_c}°C</span>
                  <span className="text-xs font-normal text-black/60">
                    ({weatherData.weather.condition})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs font-mono text-black/60">
              <div className="flex items-center gap-1.5">
                <Wind className="w-3.5 h-3.5 text-black/40" />
                <span>Wind: {weatherData.weather.windspeed_kmh} km/h</span>
              </div>
              <div>
                Coordinates: {weatherData.coordinates?.lat.toFixed(2)}°N, {weatherData.coordinates?.lon.toFixed(2)}°E
              </div>
              {lastUpdated && <div className="text-black/40">Last Ping: {lastUpdated}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Two-Column Grid: Live Flights & Real Accommodations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Live Airspace Radar */}
        <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4 text-black" />
              <span className="caption-mono font-bold text-black">AIRSPACE RADAR · LIVE FLIGHT TELEMETRY</span>
            </div>
            <span className="text-xs font-mono text-black/60 bg-surface-soft px-2.5 py-0.5 rounded-pill border border-hairline">
              {flightsData?.flights?.length || 0} Aircraft on Screen
            </span>
          </div>

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {(flightsData?.flights || []).map((flight, idx) => (
              <div
                key={flight.icao24 + idx}
                className="rounded-xl bg-surface-soft p-3.5 space-y-2.5 border border-hairline shadow-2xs hover:border-black/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono font-bold px-2 py-0.5 rounded-md text-white shadow-2xs"
                      style={{ backgroundColor: flight.badge_color || '#0f172a' }}
                    >
                      {flight.callsign}
                    </span>
                    <span className="font-bold text-sm text-black">{flight.airline}</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-black/70 bg-white px-2.5 py-0.5 rounded-pill border border-hairline">
                    {flight.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono text-black/60 pt-2 border-t border-hairline">
                  <div>
                    <span className="text-[10px] block text-black/40">ALTITUDE</span>
                    <span className="font-bold text-black">
                      {flight.altitude_feet ? flight.altitude_feet.toLocaleString() + ' ft' : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] block text-black/40">SPEED</span>
                    <span className="font-bold text-black">
                      {flight.speed_kmh ? flight.speed_kmh + ' km/h' : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] block text-black/40">SOURCE</span>
                    <span className="text-emerald-700 font-bold">Live Flight Feed</span>
                  </div>
                </div>
              </div>
            ))}

            {(!flightsData?.flights || flightsData.flights.length === 0) && (
              <div className="p-8 text-center text-xs text-black/50 font-mono">
                Scanning sector airspace... Click "Ping Telemetry" to query active telemetry.
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Real Verified Accommodations */}
        <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-black" />
              <span className="caption-mono font-bold text-black">VERIFIED ACCOMMODATIONS</span>
            </div>
            <span className="text-xs font-mono text-black/60 bg-surface-soft px-2.5 py-0.5 rounded-pill border border-hairline">
              {hotelsData?.hotels?.length || 0} Properties Found
            </span>
          </div>

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {(hotelsData?.hotels || []).map((hotel, idx) => (
              <div
                key={hotel.name + idx}
                className="rounded-xl bg-surface-soft p-3.5 space-y-2.5 border border-hairline shadow-2xs hover:border-black/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-black">{hotel.name}</h4>
                    <p className="text-xs text-black/60 mt-0.5">{hotel.locality}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-sm text-black">
                      ₹{hotel.est_cost_inr?.toLocaleString()}
                    </span>
                    <span className="text-[10px] block text-black/40">/ night</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-hairline">
                  <div className="flex flex-wrap gap-1">
                    {(hotel.amenities || ['WiFi', 'AC']).slice(0, 3).map((am, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono bg-white px-2 py-0.5 rounded-md border border-hairline text-black/70"
                      >
                        {am}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => handleBookHotel(hotel)}
                    className="btn-success py-1.5 px-3.5 rounded-pill text-xs flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer font-semibold"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Book with Razorpay
                  </button>
                </div>
              </div>
            ))}

            {(!hotelsData?.hotels || hotelsData.hotels.length === 0) && (
              <div className="p-8 text-center text-xs text-black/50 font-mono">
                Querying verified accommodation properties...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
