// Aurora backend: Express server with simple API and mock data
// Node >= 18 required (built-in fetch)

const express = require('express');
const path = require('path');
const Astronomy = require('astronomy-engine');

const app = express();
const PORT = process.env.PORT || 3000;

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname)));

// In-memory cache
const cache = {
  solarwind: { data: null, ts: 0 },
  kp: { data: null, ts: 0 },
  rx: { data: null, ts: 0 },
  fmiBx: {}, // keyed by station: { data, ts }
  fmiRadar: {}, // keyed by sanitized tile request string
  weatherTemp: {}, // keyed by lat,lon
};
const TTL_MS = 4 * 60 * 1000; // 4 minutes
// Weather temperature cache TTL preference: 10 minutes
const WEATHER_TTL_MS = 10 * 60 * 1000;
// --- External endpoints (NOAA SWPC) & helpers ---
const SWPC_PLASMA_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const SWPC_MAG_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
const SWPC_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
// Optional time shift in minutes to align feeds to local preference
const TIME_OFFSET_MIN = (Number.parseInt(process.env.TIME_OFFSET_MIN || '0', 10) || 0);
// FMI OpenWMS Geoserver for radar tiles
const FMI_WMS_URL = 'https://openwms.fmi.fi/geoserver/wms';
// FMI Open Data API for magnetometer data
const FMI_OPEN_DATA_URL = 'https://opendata.fmi.fi/wfs';
// FMI station ID mapping (fmisid)
const FMI_STATION_IDS = {
  'KEV': 100007,
  'MAS': 100008,
  'KIL': 100009,
  'IVA': 129963,  // Ivalo (Inari Seitalaassa)
  'MUO': 100010,
  'PEL': 100011,
  'RAN': 100012,
  'OUJ': 100013,
  'MEK': 100014,
  'HAN': 100015,
  'NUR': 100016,
  'TAR': 100017
};
// Allowed radar layers (nationwide composites)
const FMI_RADAR_LAYERS = new Set([
  'Radar:radar_ppi_fikau_dbzv', // reflectivity
  'Radar:suomi_rr_eureffin',   // rainfall rate
]);

function toNumber(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  return Number.isFinite(n) ? n : null;
}
function round1(v) { return v == null ? null : Math.round(Number(v) * 10) / 10; }
function round2(v) { return v == null ? null : Math.round(Number(v) * 100) / 100; }

function parseSwpcArray(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const headers = arr[0].map((h) => String(h).toLowerCase());
  return arr.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    Object.keys(o).forEach((k) => {
      if (k !== 'time_tag' && o[k] !== null && o[k] !== undefined && o[k] !== '') {
        const n = toNumber(o[k]);
        if (n !== null) o[k] = n;
      }
    });
    return o;
  }).filter((o) => o.time_tag);
}

// Parse either SWPC "products" (array-of-arrays with header) or RTSW (array-of-objects) formats
function parseSwpc(json) {
  if (!Array.isArray(json) || json.length === 0) return [];
  // products format => delegate
  if (Array.isArray(json[0])) return parseSwpcArray(json);
  // rtsw format => array of objects
  if (typeof json[0] === 'object' && json[0] !== null) {
    return json.map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).toLowerCase();
        let val = v;
        if (key !== 'time_tag' && val !== null && val !== undefined && val !== '') {
          const n = toNumber(val);
          if (n !== null) val = n;
        }
        out[key] = val;
      }
      return out;
    }).filter((o) => o.time_tag);
  }
  return [];
}

function fmtHM(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function latestNonNull(rows, key) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = toNumber(rows[i] && rows[i][key]);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function latestFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = typeof arr[i] === 'number' ? arr[i] : toNumber(arr[i]);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

// Pick the first finite numeric value from a list of possible keys
function pick(row, keys) {
  if (!row) return null;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const n = toNumber(row[k]);
      if (n != null && Number.isFinite(n)) return n;
    }
  }
  return null;
}

function shiftIso(iso, minutes) {
  try {
    const d = parseToUTC(iso);
    const ms = d.getTime() + (minutes * 60 * 1000);
    return new Date(ms).toISOString();
  } catch (_) { return iso; }
}

// Ensure ambiguous timestamps are treated as UTC (RTSW may omit 'Z')
function parseToUTC(s) {
  const str = String(s || '');
  // If tz marker exists, standardize and parse
  if (/Z|[+\-]\d\d:?\d\d$/.test(str)) return new Date(str.replace(' ', 'T'));
  // No tz marker: assume UTC
  return new Date(str.replace(' ', 'T') + 'Z');
}

function normalizeUtcIso(s) {
  try {
    const d = parseToUTC(s);
    return d.toISOString();
  } catch (_) { return s; }
}

// --- Mock data generators (replace with real fetchers later) ---
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function mockSolarwindData() {
  const now = new Date();
  const points = 60; // last 60 minutes
  const labels = [];
  const times = [];
  const speed = [];
  const density = [];

  let baseSpeed = 450 + Math.random() * 50; // km/s
  let baseDensity = 6 + Math.random() * 3; // p/cc

  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 1000);
    labels.push(fmtTime(t));
    times.push(t.toISOString());
    // gentle variations
    const s = baseSpeed + Math.sin(i / 8) * 15 + (Math.random() - 0.5) * 8;
    const d = baseDensity + Math.cos(i / 10) * 1 + (Math.random() - 0.5) * 0.6;
    speed.push(Math.max(250, Number(s.toFixed(1))));
    density.push(Math.max(0.1, Number(d.toFixed(2))));
  }

  const bz = Number((-5 + Math.random() * 10).toFixed(1)); // -5..+5 nT
  const bt = Number((7 + Math.random() * 6).toFixed(1)); // 7..13 nT

  return {
    updatedAt: times[points - 1],
    now: {
      bz,
      bt,
      speed: speed[points - 1],
      density: density[points - 1],
    },
    labels,
    times,
    speed,
    density,
  };
}

function mockKpData() {
  const now = new Date();
  const steps = 8; // last 24h, 3h steps
  const labels = [];
  const values = [];
  for (let i = steps - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3 * 60 * 60 * 1000);
    labels.push(`${pad(t.getDate())}/${pad(t.getMonth() + 1)} ${pad(t.getHours())}:00`);
    const k = Math.max(0, Math.min(9, 2.5 + Math.sin(i / 2) * 1.3 + (Math.random() - 0.5) * 1.2));
    values.push(Number(k.toFixed(1)));
  }
  return {
    updatedAt: now.toISOString(),
    now: values[steps - 1],
    labels,
    values,
  };
}

function mockRxData() {
  const states = ['low', 'moderate', 'high'];
  const now = new Date();
  const idx = Math.floor(Math.random() * states.length);
  return { updatedAt: now.toISOString(), now: states[idx] };
}

// --- FMI: Realtime Magnetometer Bx (stub/mock until HDF parsing is added) ---
const FMI_STATIONS = ['KEV','MAS','KIL','IVA','MUO','PEL','RAN','OUJ','MEK','HAN','NUR','TAR'];

// Parse XML response from FMI Open Data API
function parseFmiMagnetometerXml(xmlText) {
  const rows = [];
  try {
    // Simple XML parsing without external dependencies
    // Extract BsWfsElement entries
    const entries = xmlText.match(/<BsWfs:BsWfsElement>[\s\S]*?<\/BsWfs:BsWfsElement>/g) || [];
    
    let currentTime = null;
    let bx = null;
    let bz = null;
    let station = null;
    
    for (const entry of entries) {
      // Extract time
      const timeMatch = entry.match(/<BsWfs:Time>(.*?)<\/BsWfs:Time>/);
      if (timeMatch) {
        // If we have previous data, save it
        if (currentTime && (bx !== null || bz !== null)) {
          rows.push({ time: currentTime, bx, bz, station });
        }
        
        currentTime = timeMatch[1];
        bx = null;
        bz = null;
      }
      
      // Extract parameter name and value
      const paramNameMatch = entry.match(/<BsWfs:ParameterName>(.*?)<\/BsWfs:ParameterName>/);
      const paramValueMatch = entry.match(/<BsWfs:ParameterValue>(.*?)<\/BsWfs:ParameterValue>/);
      
      if (paramNameMatch && paramValueMatch) {
        const paramName = paramNameMatch[1];
        const paramValue = parseFloat(paramValueMatch[1]);
        
        if (paramName === 'BX') {
          bx = Number.isFinite(paramValue) ? paramValue : null;
        } else if (paramName === 'BZ') {
          bz = Number.isFinite(paramValue) ? paramValue : null;
        }
      }
      
      // Extract station info from gml:name if available
      const stationMatch = entry.match(/<gml:name>(.*?)<\/gml:name>/);
      if (stationMatch) {
        station = stationMatch[1];
      }
    }
    
    // Don't forget the last entry
    if (currentTime && (bx !== null || bz !== null)) {
      rows.push({ time: currentTime, bx, bz, station });
    }
    
    return rows;
  } catch (e) {
    console.error('Error parsing FMI magnetometer XML', e);
    return [];
  }
}

// Fetch real FMI magnetometer data
async function fetchFmiMagnetometerData(stationCode, minutes) {
  try {
    console.log('Fetching FMI data for station:', stationCode); // Debug logging
    const fmisid = FMI_STATION_IDS[stationCode] || FMI_STATION_IDS.KEV;
    console.log('Using fmisid:', fmisid); // Debug logging
    
    // Use the current system time as endTime
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - minutes * 60 * 1000);
    
    // Try without the parameters parameter first, as it seems to be causing issues
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      storedquery_id: 'fmi::observations::magnetometer::simple',
      starttime: startTime.toISOString(),
      endtime: endTime.toISOString(),
      timestep: '60', // 1-minute intervals
      fmisid: fmisid.toString()
    });
    
    const url = `${FMI_OPEN_DATA_URL}?${params.toString()}`;
    
    console.log('FMI API URL:', url); // Debug logging
    
    const response = await fetch(url, { 
      method: 'GET',
      headers: { 'Accept': 'application/xml' }
    });
    
    if (!response.ok) {
      throw new Error(`FMI API error: ${response.status}`);
    }
    
    const xmlText = await response.text();
    const rows = parseFmiMagnetometerXml(xmlText);
    
    // Filter to only include the requested time range
    const cutoffTime = new Date(endTime.getTime() - minutes * 60 * 1000);
    return rows.filter(row => new Date(row.time) >= cutoffTime);
  } catch (e) {
    console.error('Error fetching FMI magnetometer data', e);
    // Fallback to mock data if real data fetch fails
    return mockFmiBxData(stationCode, minutes);
  }
}

function mockFmiBxData(station = 'KEV', minutes = 60) {
  // Workaround for system clock issue - use a fixed reference time
  const systemTime = Date.now();
  const referenceTime = new Date('2024-08-29T00:00:00Z').getTime(); // Use a recent date
  const timeOffset = systemTime - referenceTime;
  const adjustedNow = systemTime - timeOffset;
  
  const step = 5; // 5-min cadence
  const rows = [];
  const points = Math.max(1, Math.floor(minutes / step));
  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(adjustedNow - i * step * 60 * 1000);
    // Simple synthetic variation centered around 0 with small trend per station
    const phase = (i / points) * Math.PI * 2;
    const bias = (FMI_STATIONS.indexOf(station) % 4) * 5; // slight station-dependent offset
    const bx = Math.round((Math.sin(phase) * 30 + Math.cos(phase * 0.5) * 10 + bias) * 10) / 10; // nT
    rows.push({ time: t.toISOString(), bx, station });
  }
  return rows;
}

// --- Fetchers (currently mock). Replace with real NOAA/FMI calls and caching ---
async function getSolarwind() {
  const now = Date.now();
  if (cache.solarwind.data && now - cache.solarwind.ts < TTL_MS) return cache.solarwind.data;
  try {
    const [plasmaRes, magRes] = await Promise.all([
      fetch(SWPC_PLASMA_URL, { cache: 'no-store' }),
      fetch(SWPC_MAG_URL, { cache: 'no-store' }),
    ]);
    if (!plasmaRes.ok || !magRes.ok) throw new Error(`SWPC HTTP ${plasmaRes.status}/${magRes.status}`);
    const [plasmaJson, magJson] = await Promise.all([plasmaRes.json(), magRes.json()]);
    const plasma = parseSwpc(plasmaJson);
    const mag = parseSwpc(magJson);

    const pMap = new Map(plasma.map((r) => [r.time_tag, r]));
    const mMap = new Map(mag.map((r) => [r.time_tag, r]));
    const times = Array.from(new Set([...pMap.keys(), ...mMap.keys()])).sort((a, b) => new Date(a) - new Date(b));
    const tail = times.slice(-60); // about last 60 minutes

    const labels = [];
    const timesOut = [];
    const speed = [];
    const density = [];
    const bzArr = [];
    const btArr = [];
    for (const t of tail) {
      const p = pMap.get(t);
      const m = mMap.get(t);
      const norm = normalizeUtcIso(t);
      const shifted = TIME_OFFSET_MIN ? shiftIso(norm, TIME_OFFSET_MIN) : norm;
      labels.push(fmtHM(shifted));
      timesOut.push(shifted);
      const sp = pick(p, ['speed', 'flow_speed', 'bulk_speed', 'v', 'proton_speed']);
      const de = pick(p, ['density', 'proton_density', 'n']);
      speed.push(sp != null ? round1(sp) : null);
      density.push(de != null ? round2(de) : null);
      const bzv = pick(m, ['bz_gsm', 'bz', 'bz_gse']);
      const btv = pick(m, ['bt', 'bt_total']);
      bzArr.push(bzv != null ? round1(bzv) : null);
      btArr.push(btv != null ? round1(btv) : null);
    }

    // Compute 'now' aligned to the most recent timestamp that exists in BOTH feeds
    let nowVals = { bz: null, bt: null, speed: null, density: null };
    let nowTimeAligned = null;
    let alignedRawT = null;
    for (let i = times.length - 1; i >= 0; i--) {
      const t = times[i];
      const p = pMap.get(t);
      const m = mMap.get(t);
      if (!p || !m) continue;
      const bz = pick(m, ['bz_gsm', 'bz', 'bz_gse']);
      const bt = pick(m, ['bt', 'bt_total']);
      const sp = pick(p, ['speed', 'flow_speed', 'bulk_speed', 'v', 'proton_speed']);
      const de = pick(p, ['density', 'proton_density', 'n']);
      if ([bz, bt, sp, de].every((v) => v != null && Number.isFinite(v))) {
        nowVals = { bz: round1(bz), bt: round1(bt), speed: round1(sp), density: round2(de) };
        const norm = normalizeUtcIso(t);
        nowTimeAligned = TIME_OFFSET_MIN ? shiftIso(norm, TIME_OFFSET_MIN) : norm;
        alignedRawT = t;
        break;
      }
    }
    // Fallback if alignment fails
    if (nowVals.bz == null && nowVals.bt == null && nowVals.speed == null && nowVals.density == null) {
      nowVals = {
        bz: round1(latestNonNull(mag, 'bz_gsm')),
        bt: round1(latestNonNull(mag, 'bt')),
        // Prefer last finite values from the arrays used to render charts
        speed: round1(latestFinite(speed) ?? latestNonNull(plasma, 'speed')),
        density: round2(latestFinite(density) ?? latestNonNull(plasma, 'density')),
      };
    }

    // Determine satellite from last magnetometer record if available
    let satLabel = 'DSCOVR/ACE (RTSW)';
    if (alignedRawT) {
      const mNow = mMap.get(alignedRawT);
      if (mNow && typeof mNow === 'object') {
        const satRaw = mNow.satellite || mNow.sat || mNow.sc || mNow.observatory || mNow.source || null;
        if (satRaw && String(satRaw).trim()) {
          const s = String(satRaw).toUpperCase();
          if (s.includes('ACE')) satLabel = 'ACE (RTSW)';
          else if (s.includes('DSCOVR')) satLabel = 'DSCOVR (RTSW)';
          else satLabel = `${String(satRaw)} (RTSW)`;
        }
      }
    }

    const out = {
      // Prefer the aligned timestamp where all metrics are valid, else fall back
      updatedAt: nowTimeAligned ? nowTimeAligned : (timesOut.length ? timesOut[timesOut.length - 1] : new Date().toISOString()),
      now: nowVals,
      labels,
      times: timesOut,
      speed,
      density,
      bz: bzArr,
      bt: btArr,
      source: { satellite: satLabel, provider: 'NOAA SWPC' },
    };
    cache.solarwind = { data: out, ts: now };
    return out;
  } catch (e) {
    console.error('getSolarwind fallback', e);
    const data = mockSolarwindData();
    cache.solarwind = { data, ts: now };
    return data;
  }
}

async function getKp() {
  const now = Date.now();
  if (cache.kp.data && now - cache.kp.ts < TTL_MS) return cache.kp.data;
  try {
    const res = await fetch(SWPC_KP_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = parseSwpcArray(json);
    if (!rows.length) throw new Error('No Kp rows');
    const keys = Object.keys(rows[0]);
    const kpKey = keys.includes('kp') ? 'kp' : (keys.includes('kp_index') ? 'kp_index' : 'kp');
    const last8 = rows.slice(-8);
    const labels = last8.map((r) => {
      const d = new Date(r.time_tag);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:00`;
    });
    const values = last8.map((r) => round1(toNumber(r[kpKey])));
    const out = {
      updatedAt: new Date().toISOString(),
      now: values[values.length - 1],
      labels,
      values,
    };
    cache.kp = { data: out, ts: now };
    return out;
  } catch (e) {
    console.error('getKp fallback', e);
    const data = mockKpData();
    cache.kp = { data, ts: now };
    return data;
  }
}

async function getRx() {
  const now = Date.now();
  if (cache.rx.data && now - cache.rx.ts < TTL_MS) return cache.rx.data;
  const data = mockRxData();
  cache.rx = { data, ts: now };
  return data;
}

// --- Open-Meteo: Current Weather Temperature ---
async function getWeatherTemperature(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const now = Date.now();
  const ent = cache.weatherTemp[key];
  if (ent && now - ent.ts < WEATHER_TTL_MS) return ent.data;

  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,cloud_cover`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const j = await r.json();
    const current = j?.current;
    const temp = Number.isFinite(current?.temperature_2m) ? current.temperature_2m : null;
    const cloud = Number.isFinite(current?.cloud_cover) ? current.cloud_cover : null;

    // Use the reliable timestamp from the API response
    // The time is in ISO 8601 format, e.g., "2024-09-01T10:00"
    // It needs to be converted to a full ISO string with 'Z' for UTC.
    const apiTime = current?.time ? `${current.time}Z` : new Date().toISOString();
    const updatedAt = new Date(apiTime).toISOString();

    const out = {
      updatedAt,
      location: { latitude: lat, longitude: lon },
      temperatureC: temp != null ? Math.round(temp * 10) / 10 : null,
      cloudCover: cloud,
      units: { temperature: 'C', cloudCover: '%' },
      source: { provider: 'Open-Meteo', url: 'https://open-meteo.com/' },
    };
    cache.weatherTemp[key] = { data: out, ts: now };
    return out;
  } catch (e) {
    console.error('getWeatherTemperature error', e);
    const out = { updatedAt: new Date().toISOString(), location: { latitude: lat, longitude: lon }, temperatureC: null, cloudCover: null, units: { temperature: 'C', cloudCover: '%' }, source: { provider: 'Open-Meteo' } };
    cache.weatherTemp[key] = { data: out, ts: now };
    return out;
  }
}


async function getFmiBx(station = 'KEV', minutes = 60) {
  const key = `${station}-${minutes}`;
  const now = Date.now();
  const entry = cache.fmiBx[key];
  if (entry && now - entry.ts < TTL_MS) return entry.data;
  
  // Fetch real FMI magnetometer data (including Bx and Bz)
  const rows = await fetchFmiMagnetometerData(station, minutes);
  
  const data = {
    station,
    minutes,
    stations: FMI_STATIONS,
    rows,
    times: rows.map(r => r.time),
    bx: rows.map(r => r.bx),
    bz: rows.map(r => r.bz), // Add Bz component
    updatedAt: rows.length ? rows[rows.length - 1].time : new Date().toISOString(),
    source: { provider: 'FMI IMAGE', credit: 'Finnish Meteorological Institute', url: 'https://space.fmi.fi/image/' },
  };
  cache.fmiBx[key] = { data, ts: now };
  return data;
}

// --- API ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- FMI Radar WMS proxy (tiles) ---
app.get('/api/fmi/radar', async (req, res) => {
  try {
    // Required/allowed params for WMS 1.1.1 GetMap + WebMercator tiles
    const q = req.query || {};
    const version = '1.1.1';
    const service = 'WMS';
    const requestType = 'GetMap';
    const format = 'image/png';
    const transparent = 'true';
    const width = '256';
    const height = '256';
    const srs = 'EPSG:3857';

    // Layers: validate allowlist, support comma-separated
    const rawLayers = String(q.layers || 'Radar:radar_ppi_fikau_dbzv');
    const layers = rawLayers
      .split(',')
      .map(s => s.trim())
      .filter(s => s && FMI_RADAR_LAYERS.has(s));
    if (!layers.length) {
      return res.status(400).json({ error: 'Invalid or missing layers' });
    }

    // BBOX: four comma-separated numbers (WebMercator range clamp)
    const bboxStr = String(q.bbox || '');
    const parts = bboxStr.split(',').map(s => Number.parseFloat(s));
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'Invalid bbox' });
    }
    const clamp = (v) => Math.max(-20037508.342789244, Math.min(20037508.342789244, v));
    const bbox = parts.map(clamp).join(',');

    // Optional params
    const styles = String(q.styles || '');
    // TIME is optional; forward if ISO-like to avoid abuse
    const time = q.time && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(q.time)) ? String(q.time) : undefined;

    // Build sanitized upstream URL
    const usp = new URL(FMI_WMS_URL);
    usp.searchParams.set('SERVICE', service);
    usp.searchParams.set('REQUEST', requestType);
    usp.searchParams.set('VERSION', version);
    usp.searchParams.set('FORMAT', format);
    usp.searchParams.set('TRANSPARENT', transparent);
    usp.searchParams.set('WIDTH', width);
    usp.searchParams.set('HEIGHT', height);
    usp.searchParams.set('SRS', srs);
    usp.searchParams.set('LAYERS', layers.join(','));
    usp.searchParams.set('STYLES', styles);
    usp.searchParams.set('BBOX', bbox);
    // Forward CRS param if client used VERSION 1.3.0 semantics (not default here) — we ignore to keep 1.1.1 stable
    if (time) usp.searchParams.set('TIME', time);
    // Some clients add TILED=TRUE; allowed but not required
    if (String(q.tiled || '').toLowerCase() === 'true') usp.searchParams.set('TILED', 'true');

    const key = usp.search; // cache key by sanitized query string
    const now = Date.now();
    const ent = cache.fmiRadar[key];
    if (ent && now - ent.ts < TTL_MS) {
      res.setHeader('Content-Type', ent.ct);
      res.setHeader('Cache-Control', 'public, max-age=240');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(ent.buf);
    }

    const upstream = await fetch(usp.toString(), { redirect: 'follow', cache: 'no-store' });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }
    const ct = (upstream.headers.get('content-type') || '').toLowerCase();
    const ab = await upstream.arrayBuffer();
    const buf = Buffer.from(ab);
    const contentType = ct.startsWith('image/') ? ct : 'image/png';
    cache.fmiRadar[key] = { buf, ct: contentType, ts: now };
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=240');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buf);
  } catch (err) {
    console.error('fmi/radar proxy error', err);
    res.status(502).json({ error: 'Failed to fetch radar tile' });
  }
});

app.get('/api/solarwind', async (_req, res) => {
  try {
    const data = await getSolarwind();
    res.json(data);
  } catch (err) {
    console.error('solarwind error', err);
    res.status(500).json({ error: 'Failed to load solar wind data' });
  }
});

app.get('/api/kp', async (_req, res) => {
  try {
    const data = await getKp();
    res.json(data);
  } catch (err) {
    console.error('kp error', err);
    res.status(500).json({ error: 'Failed to load Kp data' });
  }
});

app.get('/api/rx', async (_req, res) => {
  try {
    const data = await getRx();
    res.json(data);
  } catch (err) {
    console.error('rx error', err);
    res.status(500).json({ error: 'Failed to load RX data' });
  }
});

// --- Weather Temperature (Open-Meteo) ---
app.get('/api/weather', async (req, res) => {
  try {
    // Default to Tesjoki coordinates if not provided
    const lat = Number.parseFloat(String(req.query.lat ?? '60.4728'));
    const lon = Number.parseFloat(String(req.query.lon ?? '26.3042'));
    const latOk = Number.isFinite(lat) && lat >= -90 && lat <= 90;
    const lonOk = Number.isFinite(lon) && lon >= -180 && lon <= 180;
    const la = latOk ? lat : 60.4728;
    const lo = lonOk ? lon : 26.3042;
    const data = await getWeatherTemperature(la, lo);
    res.json(data);
  } catch (err) {
    console.error('weather error', err);
    res.status(500).json({ error: 'Failed to load weather temperature' });
  }
});

app.get('/api/fmi/bx', async (req, res) => {
  try {
    const qStationRaw = String(req.query.station || 'KEV').toUpperCase();
    const station = FMI_STATIONS.includes(qStationRaw) ? qStationRaw : 'KEV';
    let minutes = parseInt(String(req.query.minutes || '60'), 10);
    if (!Number.isFinite(minutes)) minutes = 60;
    minutes = Math.max(5, Math.min(180, minutes));
    const data = await getFmiBx(station, minutes);
    console.log(`[DEBUG] /api/fmi/bx station: ${station}, minutes: ${minutes}, returned rows: ${data.rows.length}`);
    res.json(data);
  } catch (err) {
    console.error('fmi/bx error', err);
    res.status(500).json({ error: 'Failed to load FMI Bx data' });
  }
});


// --- Solar imagery proxy (limited allowlist) ---
const SOLAR_IMG_SOURCES = {
  soho_sunspot: 'https://soho.nascom.nasa.gov/data/sunspot/latest.jpg',
};

app.get('/api/solarimage', async (req, res) => {
  try {
    const key = String(req.query.src || 'soho_sunspot');
    const url = SOLAR_IMG_SOURCES[key];
    if (!url) {
      return res.status(400).json({ error: 'Invalid image source' });
    }
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct.startsWith('image/') ? ct : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    const ab = await r.arrayBuffer();
    res.send(Buffer.from(ab));
  } catch (err) {
    console.error('solarimage proxy error', err);
    res.status(502).json({ error: 'Failed to fetch solar image' });
  }
});

// Helper function to get moon phase name
function getMoonPhaseName(phase) {
  // phase is a percentage (0-100)
  if (phase < 0 || phase > 100) return 'Unknown';
  if (phase < 6.25) return 'New Moon';
  if (phase < 18.75) return 'Waxing Crescent';
  if (phase < 31.25) return 'First Quarter';
  if (phase < 43.75) return 'Waxing Gibbous';
  if (phase < 56.25) return 'Full Moon';
  if (phase < 68.75) return 'Waning Gibbous';
  if (phase < 81.25) return 'Last Quarter';
  if (phase < 93.75) return 'Waning Crescent';
  return 'New Moon';
}

// --- FMI Magnetometer Real-time Text Endpoint ---
app.get('/api/fmi/textdata', async (req, res) => {
  const station = (req.query.station || '').toUpperCase();
  const validStations = ['KEV','MAS','KIL','IVA','MUO','PEL','RAN','OUJ','MEK','HAN','NUR','TAR','SOD'];
  if (!validStations.includes(station)) {
    return res.status(400).json({ error: 'Invalid station code' });
  }
  const url = `https://space.fmi.fi/image/realtime/UT/${station}/${station}data_24.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch data');
    const text = await response.text();
    const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith('---') && !l.startsWith('YYYY'));
    const times = [], bx = [], by = [], bz = [];
    let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for (const line of lines) {
      const m = line.match(/^(\d{4}) (\d{2}) (\d{2}) (\d{2}) (\d{2}) (\d{2})\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
      if (!m) continue;
      const [_, yyyy, MM, dd, hh, mm, ss, x, y, z] = m;
      const date = new Date(Date.UTC(+yyyy, +MM-1, +dd, +hh, +mm, +ss));
      times.push(date.toISOString());
      const xval = +x, yval = +y, zval = +z;
      bx.push(xval); by.push(yval); bz.push(zval);
      if (xval < minX) minX = xval;
      if (xval > maxX) maxX = xval;
      if (zval < minZ) minZ = zval;
      if (zval > maxZ) maxZ = zval;
    }
    res.json({ station, times, bx, by, bz, minX, maxX, minZ, maxZ });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch or parse data', details: err.message });
  }
});

// --- Solar and Lunar data endpoint ---
app.get('/api/solarlunar', async (req, res) => {
  try {
    // Get the observer's location (Helsinki coordinates as default)
    const latitude = parseFloat(req.query.lat) || 60.1699;
    const longitude = parseFloat(req.query.lon) || 24.9384;
    
    // Use current time if not specified
    const date = req.query.date ? new Date(req.query.date) : new Date();
    
    // Create observer object using Astronomy Engine's Observer class
    const observer = new Astronomy.Observer(latitude, longitude, 0); // height = 0 meters
    
    // Calculate solar events (limitDays = 365, metersAboveGround = 0)
    const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, date, 365, 0);
    const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, date, 365, 0);
    
    // Calculate solar position
    const sunEquator = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
    const sunHorizon = Astronomy.Horizon(date, observer, sunEquator.ra, sunEquator.dec, 'normal');
    
    // Calculate lunar events (limitDays = 365, metersAboveGround = 0)
    const moonrise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, 1, date, 365, 0);
    const moonset = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, date, 365, 0);
    
    // Calculate moon phase
    const moonPhase = Astronomy.MoonPhase(date);
    
    // Calculate twilight times (limitDays = 365)
    const blueHourDawnStart = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, 1, date, 365, -6.0);
    const blueHourDawnEnd = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, 1, date, 365, -4.0);
    const blueHourDuskStart = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, date, 365, -4.0);
    const blueHourDuskEnd = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, date, 365, -6.0);
    
    const goldenHourDawnStart = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, 1, date, 365, -4.0);
    const goldenHourDawnEnd = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, 1, date, 365, 6.0);
    const goldenHourDuskStart = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, date, 365, 6.0);
    const goldenHourDuskEnd = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, date, 365, -4.0);
    
    // Format times for display
    const formatTime = (dateObj) => {
      if (!dateObj || !dateObj.date) return null;
      return { date: dateObj.date };
    };
    
    const solarData = {
      sunrise: formatTime(sunrise),
      sunset: formatTime(sunset),
      sunAltitude: Math.round(sunHorizon.altitude * 10) / 10,
      sunAzimuth: Math.round(sunHorizon.azimuth * 10) / 10,
      sunRightAscension: Math.round(sunEquator.ra * 1000) / 1000,
      sunDeclination: Math.round(sunEquator.dec * 1000) / 1000
    };
    
    const lunarData = {
      moonrise: formatTime(moonrise),
      moonset: formatTime(moonset),
      moonPhase: Math.round(moonPhase * 10) / 10,
      moonPhaseName: getMoonPhaseName(moonPhase)
    };
    
    const twilightData = {
      blueHour: {
        dawn: {
          start: formatTime(blueHourDawnStart),
          end: formatTime(blueHourDawnEnd)
        },
        dusk: {
          start: formatTime(blueHourDuskStart),
          end: formatTime(blueHourDuskEnd)
        }
      },
      goldenHour: {
        dawn: {
          start: formatTime(goldenHourDawnStart),
          end: formatTime(goldenHourDawnEnd)
        },
        dusk: {
          start: formatTime(goldenHourDuskStart),
          end: formatTime(goldenHourDuskEnd)
        }
      }
    };
    
    res.json({
      date: date.toISOString(),
      location: { latitude, longitude },
      solar: solarData,
      lunar: lunarData,
      twilight: twilightData
    });
  } catch (err) {
    console.error('solarlunar error', err);
    res.status(500).json({ error: 'Failed to calculate solar and lunar data' });
  }
});

// Keep cache warm
async function refreshAll() {
  try { await getSolarwind(); } catch (_) {}
  try { await getKp(); } catch (_) {}
  try { await getRx(); } catch (_) {}
  // Try multiple FMI stations but handle errors individually
  try { await getFmiBx('KEV', 60); } catch (_) {}
  try { await getFmiBx('MAS', 60); } catch (_) {}
  try { await getFmiBx('KIL', 60); } catch (_) {}
  try { await getFmiBx('IVA', 60); } catch (_) {}
  try { await getFmiBx('MUO', 60); } catch (_) {}
  try { await getFmiBx('PEL', 60); } catch (_) {}
  try { await getFmiBx('RAN', 60); } catch (_) {}
  try { await getFmiBx('OUJ', 60); } catch (_) {}
  try { await getFmiBx('MEK', 60); } catch (_) {}
  try { await getFmiBx('HAN', 60); } catch (_) {}
  try { await getFmiBx('NUR', 60); } catch (_) {}
  try { await getFmiBx('TAR', 60); } catch (_) {}
}
setInterval(refreshAll, TTL_MS);

// Start server immediately, don't block on initial data fetch
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aurora server running at http://0.0.0.0:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Server listening on port ${PORT}`);
  // Refresh data after server starts
  setTimeout(() => {
    refreshAll().catch(err => console.error('Initial data refresh failed:', err));
  }, 1000);
});
