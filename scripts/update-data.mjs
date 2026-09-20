#!/usr/bin/env node
// Updates data/population.json with the latest ACS 1-year estimate for
// "Brazil" (Table C05006, variable C05006_063E - Place of Birth for the
// Foreign-Born Population) by US state.
//
// Data source: the same public, unauthenticated endpoint data.census.gov's
// own UI calls to render/download a table - no Census API key needed.
//   https://data.census.gov/api/access/data/table?g=010XX00US$0400000&id=ACSDT1Y<year>.C05006
//
// Usage:
//   node scripts/update-data.mjs                 # try the year after the latest one on file
//   node scripts/update-data.mjs 2025             # try a specific year
//   node scripts/update-data.mjs 2025 2026        # try a range of years
//
// Notes:
//   - The Census Bureau does not publish ACS 1-year estimates for 2020
//     (data collection was disrupted by the pandemic) - a missing year is
//     expected and the script records it as `null`, matching the historical
//     workbook this dataset was seeded from.
//   - The variable code is validated against the table's own group metadata
//     each run, in case the Census Bureau ever renumbers it.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'population.json');
const BRAZIL_LABEL = 'Brazil';
const US_GEO = '010XX00US$0400000'; // all states + DC + Puerto Rico

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Look up the current C05006 variable code for Brazil, in case the Census
// Bureau ever renumbers the group's variables between vintages.
async function findBrazilVariable(year) {
  const url = `https://api.census.gov/data/${year}/acs/acs1/groups/C05006.json`;
  const groups = await fetchJson(url);
  for (const [code, meta] of Object.entries(groups.variables ?? {})) {
    if (code.endsWith('E') && (meta.label ?? '').endsWith(BRAZIL_LABEL)) {
      return code;
    }
  }
  throw new Error(`Could not find a "${BRAZIL_LABEL}" variable in C05006 for ${year}`);
}

async function fetchYear(year) {
  const variable = await findBrazilVariable(year).catch(() => 'C05006_063E');
  const url = `https://data.census.gov/api/access/data/table?g=${encodeURIComponent(US_GEO)}&id=ACSDT1Y${year}.C05006`;
  const payload = await fetchJson(url);
  const rows = payload?.response?.data;
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(`No data returned for ${year}`);
  }
  const header = rows[0];
  const idxName = header.indexOf('NAME');
  const idxValue = header.indexOf(variable);
  if (idxName === -1 || idxValue === -1) {
    throw new Error(`Expected columns not found for ${year} (NAME=${idxName}, ${variable}=${idxValue})`);
  }
  const byState = new Map();
  for (const row of rows.slice(1)) {
    const name = row[idxName];
    if (name === 'Puerto Rico') continue; // dataset tracks the 50 states + DC only
    const value = Number(row[idxValue]);
    byState.set(name, Number.isFinite(value) ? value : null);
  }
  return byState;
}

async function loadDataset() {
  const raw = await readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveDataset(dataset) {
  await writeFile(DATA_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
}

function addYear(dataset, year, byState) {
  if (!dataset.years.includes(year)) {
    dataset.years.push(year);
    dataset.years.sort((a, b) => a - b);
  }
  for (const entry of dataset.states) {
    entry.values[year] = byState.has(entry.state) ? byState.get(entry.state) : null;
  }
  let total = 0;
  let anyValue = false;
  for (const entry of dataset.states) {
    const v = entry.values[year];
    if (typeof v === 'number') {
      total += v;
      anyValue = true;
    }
  }
  dataset.usTotal[year] = anyValue ? total : null;
}

async function main() {
  const dataset = await loadDataset();
  const args = process.argv.slice(2).map(Number).filter(Number.isFinite);

  let candidates;
  if (args.length === 0) {
    candidates = [Math.max(...dataset.years) + 1];
  } else if (args.length === 1) {
    candidates = [args[0]];
  } else {
    const [start, end] = args;
    candidates = [];
    for (let y = start; y <= end; y++) candidates.push(y);
  }

  let updated = false;
  for (const year of candidates) {
    process.stdout.write(`Fetching ACS 1-year ${year} (Table C05006, Brazil)... `);
    try {
      const byState = await fetchYear(year);
      addYear(dataset, year, byState);
      updated = true;
      console.log(`ok - US total: ${dataset.usTotal[year]?.toLocaleString('en-US') ?? 'n/a'}`);
    } catch (err) {
      console.log(`skipped (${err.message})`);
    }
  }

  if (updated) {
    dataset.lastUpdated = new Date().toISOString().slice(0, 10);
    await saveDataset(dataset);
    console.log(`\nSaved ${DATA_PATH}`);
  } else {
    console.log('\nNothing new to save.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
