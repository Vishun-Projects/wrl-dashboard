const fs = require('fs');
const path = require('path');
const http = require('http');

// Helper to make queries via db-proxy
async function postQuery(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/db-proxy',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function parseCSVLine(line) {
  // Simple CSV parser for single line (handles quotes if any, but this CSV looks clean)
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  const csvPath = path.join(__dirname, '../../../../docs/PincodMatrix.csv');
  console.log('Reading CSV from:', csvPath);
  
  if (!fs.existsSync(csvPath)) {
    console.error('CSV file not found!');
    return;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/);
  console.log(`Total rows in CSV: ${lines.length}`);

  const header = parseCSVLine(lines[0]);
  console.log('Header:', header);

  // Indexes: regionname(0), divisionname(1), officename(2), pincode(3), district(4), statename(5), latitude(6), longitude(7)
  const pincodeMap = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = parseCSVLine(line);
    if (parts.length < 8) continue;

    const pincode = parts[3];
    const district = parts[4];
    const state = parts[5];
    const latStr = parts[6];
    const lngStr = parts[7];

    if (!pincode || pincode.length !== 6 || isNaN(pincode)) continue;

    const lat = latStr !== 'NA' && !isNaN(latStr) ? parseFloat(latStr) : null;
    const lng = lngStr !== 'NA' && !isNaN(lngStr) ? parseFloat(lngStr) : null;

    if (!pincodeMap[pincode]) {
      pincodeMap[pincode] = {
        state: state,
        district: district,
        coords: []
      };
    }

    if (lat && lng) {
      // Basic bounds check to ensure it's in India
      // India bounds approx: Lat 6 to 38, Lng 68 to 98
      if (lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98) {
        pincodeMap[pincode].coords.push({ lat, lng });
      }
    }
  }

  const uniquePincodes = Object.keys(pincodeMap);
  console.log(`Unique pincodes in CSV: ${uniquePincodes.length}`);

  // Fetch unique pincodes from the database (mstparty)
  console.log('Querying database for unique pincodes...');
  let dbPincodes = [];
  try {
    const res = await postQuery({
      rawSql: `
        SELECT DISTINCT vinstpostalcode
        FROM mstparty (NOLOCK)
        WHERE vinstpostalcode IS NOT NULL AND vinstpostalcode <> ''
      `
    });
    dbPincodes = res.data.map(r => r.vinstpostalcode.trim()).filter(p => p.length === 6 && !isNaN(p));
    console.log(`Unique pincodes in mstparty: ${dbPincodes.length}`);
  } catch (err) {
    console.error('Error querying DB:', err.message);
  }

  // Count how many DB pincodes exist in our CSV mapping
  let matchCount = 0;
  let missingCount = 0;
  const missingPincodes = [];
  for (const dbPin of dbPincodes) {
    if (pincodeMap[dbPin]) {
      matchCount++;
    } else {
      missingCount++;
      missingPincodes.push(dbPin);
    }
  }

  console.log(`Matching pincodes: ${matchCount}`);
  console.log(`Missing pincodes: ${missingCount}`);
  if (missingPincodes.length > 0) {
    console.log('Sample missing pincodes:', missingPincodes.slice(0, 10));
  }

  // Build a optimized JSON file
  // For each pincode, resolve the average coordinate
  const optimizedMap = {};
  for (const pin of uniquePincodes) {
    const entry = pincodeMap[pin];
    let finalLat = null;
    let finalLng = null;
    if (entry.coords.length > 0) {
      let sumLat = 0;
      let sumLng = 0;
      for (const c of entry.coords) {
        sumLat += c.lat;
        sumLng += c.lng;
      }
      finalLat = parseFloat((sumLat / entry.coords.length).toFixed(6));
      finalLng = parseFloat((sumLng / entry.coords.length).toFixed(6));
    }
    
    optimizedMap[pin] = {
      s: entry.state,
      d: entry.district,
      lt: finalLat,
      lg: finalLng
    };
  }

  // Save the optimized JSON file
  const outPath = path.join(__dirname, 'pincode_map.json');
  fs.writeFileSync(outPath, JSON.stringify(optimizedMap, null, 2));
  console.log(`Saved optimized JSON map to ${outPath}. File size: ${Math.round(fs.statSync(outPath).size / 1024)} KB`);
}

main().catch(console.error);
