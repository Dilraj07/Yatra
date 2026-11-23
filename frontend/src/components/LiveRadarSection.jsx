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
  { id: 'goa', name: 'Goa', emoji: '🏖️' },
  { id: 'agra', name: 'Agra', emoji: '🕌' },
  { id: 'bengaluru', name: 'Bengaluru', emoji: '💻' },
  { id: 'delhi', name: 'Delhi', emoji: '🏛️' },
  { id: 'jaipur', name: 'Jaipur', emoji: '🏰' },
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
        source: 'OpenStreetMap Live Radar',
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
      {/* Clean Modern Header Banner */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="eyebrow-mono text-black/60">REAL-TIME AIRSPACE & STAYS</span>
          <h2 className="display-lg mt-1 text-black">Live Flights & Hotels Radar</h2>
          <p className="text-xs text-neutral-500 max-w-2xl mt-1">
            Real-time commercial flights, local stays, and satellite ground conditions for your destination.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none bg-surface-soft px-3 py-1.5 rounded-lg border border-hairline text-slate-700">
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
            className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing...' : 'Ping Telemetry'}
          </button>
        </div>
      </div>

      {/* Destination Selector & Weather Bar */}
      <div className="bg-white border border-hairline rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold text-muted mr-1">SECTOR:</span>
            {PRESET_CITIES.map((c) => (
              <button
                key={c.id}
                onClick={() => handleCityChange(c.id)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                  selectedCity === c.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-surface-soft hover:bg-surface-card border border-hairline-soft'
                }`}
              >
                {c.emoji} {c.name}
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
          <div className="rounded-md bg-surface-soft p-3 flex flex-wrap items-center justify-between gap-4 border border-hairline-soft">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 text-amber-700">
                <Sun className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-muted font-mono uppercase">
                  {weatherData.city} Ground Conditions
                </div>
                <div className="text-base font-bold flex items-center gap-2">
                  <span>{weatherData.weather.temperature_c}°C</span>
                  <span className="text-xs font-normal text-muted">
                    ({weatherData.weather.condition})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs font-mono text-muted">
              <div className="flex items-center gap-1.5">
                <Wind className="w-4 h-4 text-primary" />
                <span>Wind: {weatherData.weather.windspeed_kmh} km/h</span>
              </div>
              <div>Coordinates: {weatherData.coordinates?.lat.toFixed(2)}°N, {weatherData.coordinates?.lon.toFixed(2)}°E</div>
              {lastUpdated && <div className="text-neutral-400">Last Ping: {lastUpdated}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Two-Column Grid: Live Flights & Real Hotels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Live Airspace Radar */}
        <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4 text-blue-600" />
              <span className="caption-mono font-bold">AIRSPACE RADAR · LIVE FLIGHT TELEMETRY</span>
            </div>
            <span className="text-xs font-mono text-muted bg-surface-soft px-2.5 py-0.5 rounded-pill border border-hairline">
              {flightsData?.flights?.length || 0} Aircraft on Screen
            </span>
          </div>

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {(flightsData?.flights || []).map((flight, idx) => (
              <div
                key={flight.icao24 + idx}
                className="rounded-xl bg-surface-soft p-3.5 space-y-2.5 border border-hairline hover:border-blue-400 transition-colors shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono font-bold px-2 py-0.5 rounded-md text-white shadow-2xs"
                      style={{ backgroundColor: flight.badge_color || '#1e40af' }}
                    >
                      {flight.callsign}
                    </span>
                    <span className="font-bold text-sm text-slate-900">{flight.airline}</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-pill border border-blue-200">
                    {flight.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono text-muted pt-2 border-t border-hairline">
                  <div>
                    <span className="text-[10px] block text-neutral-400">ALTITUDE</span>
                    <span className="font-bold text-foreground">
                      {flight.altitude_feet ? flight.altitude_feet.toLocaleString() + ' ft' : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] block text-neutral-400">SPEED</span>
                    <span className="font-bold text-foreground">
                      {flight.speed_kmh ? flight.speed_kmh + ' km/h' : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] block text-neutral-400">SOURCE</span>
                    <span className="text-emerald-700 font-bold">Live Flight Feed</span>
                  </div>
                </div>
              </div>
            ))}

            {(!flightsData?.flights || flightsData.flights.length === 0) && (
              <div className="p-8 text-center text-xs text-muted font-mono">
                Scanning sector airspace... Click "Ping Radar" to query active telemetry.
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Real Verified Hotels */}
        <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-hairline">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-emerald-600" />
              <span className="caption-mono font-bold">VERIFIED HOTELS · OPENSTREETMAP</span>
            </div>
            <span className="text-xs font-mono text-muted bg-surface-soft px-2.5 py-0.5 rounded-pill border border-hairline">
              {hotelsData?.hotels?.length || 0} Properties Found
            </span>
          </div>

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {(hotelsData?.hotels || []).map((hotel, idx) => (
              <div
                key={hotel.name + idx}
                className="rounded-xl bg-surface-soft p-3.5 space-y-2.5 border border-hairline hover:border-emerald-400 transition-colors shadow-2xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{hotel.name}</h4>
                    <p className="text-xs text-muted mt-0.5">{hotel.locality}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-sm text-orange-600">
                      ₹{hotel.est_cost_inr?.toLocaleString()}
                    </span>
                    <span className="text-[10px] block text-muted">/ night</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-hairline">
                  <div className="flex flex-wrap gap-1">
                    {(hotel.amenities || ['WiFi', 'AC']).slice(0, 3).map((am, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono bg-white px-2 py-0.5 rounded-md border border-hairline text-neutral-600"
                      >
                        {am}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => handleBookHotel(hotel)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3.5 rounded-pill text-xs flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Book with Razorpay
                  </button>
                </div>
              </div>
            ))}

            {(!hotelsData?.hotels || hotelsData.hotels.length === 0) && (
              <div className="p-8 text-center text-xs text-muted font-mono">
                Querying OpenStreetMap POI layer...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

