// api/server.js - Express web app for IS3 Lottery Checker
const express = require('express');
const axios = require('axios');
require('dotenv').config({ quiet: true });  // Tắt log dotenv

const app = express();

const API_KEY = process.env.NEYNAR_API_KEY;
const CAST_HASH = process.env.CAST_HASH;

const headers = {
  accept: 'application/json',
  api_key: API_KEY,
  'x-neynar-experimental': 'true',  // Keep basic spam filtering
};

// Hàm fetch cast details to get creation timestamp
async function fetchCast() {
  const url = `https://api.neynar.com/v2/farcaster/cast?identifier=${CAST_HASH}&type=hash`;
  try {
    const res = await axios.get(url, { headers });
    return res.data.cast.timestamp;  // Return cast creation timestamp
  } catch (error) {
    console.error('❌ Error fetching cast details:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function fetchConversation(cursor = '') {
  // Use sort_type=chron for chronological order, remove fold to get full without quality filtering
  const url = `https://api.neynar.com/v2/farcaster/cast/conversation/?identifier=${CAST_HASH}&type=hash&reply_depth=2&include_chronological_parent_casts=false&viewer_fid=1&sort_type=chron&limit=50${cursor ? `&cursor=${cursor}` : ''}`;
  try {
    const res = await axios.get(url, { headers });
    return res.data;
  } catch (error) {
    console.error('❌ Error fetching Neynar API:', error.response ? error.response.data : error.message);
    throw error;
  }
}

function extractNumberFromText(text) {
  const match = text.match(/\b\d{1,2}\b/);
  if (!match) return null;
  let num = parseInt(match[0]);
  if (num < 0 || num > 99) return null;
  return num.toString().padStart(2, '0');
}

async function getPlayersData() {
  let allReplies = [];
  let cursor = '';
  let round = 0;

  // Fetch cast creation timestamp to dynamically set cutoff
  let castTimestamp;
  try {
    castTimestamp = await fetchCast();
  } catch (error) {
    return { error: 'Unable to fetch cast details for cutoff time.' };
  }

  // Calculate cutoff: 05:45 PM VN (UTC+7) on the same day as cast creation
  const castDate = new Date(castTimestamp);  // UTC time
  // Set to 10:45 AM UTC (equivalent to 05:45 PM VN)
  const cutoffDate = new Date(castDate);
  cutoffDate.setUTCHours(10, 45, 0, 0);  // 10:45 UTC = 17:45 VN
  const CUTOFF_TIMESTAMP = cutoffDate.getTime();

  try {
    while (true) {
      const result = await fetchConversation(cursor);
      const replies = result.conversation.cast.direct_replies || [];
      allReplies.push(...replies);
      if (!result.next?.cursor) break;
      cursor = result.next.cursor;
      round++;
      if (round > 10) break;  // Max ~500 replies
    }
  } catch (error) {
    return { error: 'Unable to fetch data from Neynar.' };
  }

  const seenFids = new Set();
  const numberMap = new Map();
  const skippedList = [];  // Invalid list with reason

  // Sort by timestamp ascending
  allReplies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const reply of allReplies) {
    if (numberMap.size >= 100) break;

    const fid = reply.author.fid;
    const username = reply.author.username;
    const text = reply.text.trim();
    const timestamp = new Date(reply.timestamp).getTime();
    const number = extractNumberFromText(text);

    if (timestamp > CUTOFF_TIMESTAMP) {
      skippedList.push({ username, fid, number: number || 'Invalid', timestamp: reply.timestamp, reason: 'After cutoff time (05:45 PM VN)', type: 'late' });
      continue;
    }

    if (!number) {
      skippedList.push({ username, fid, number: 'Invalid', timestamp: reply.timestamp, reason: 'No valid number (00-99) found', type: 'invalid' });
      continue;
    }

    let skipReason = null;
    if (seenFids.has(fid)) skipReason = 'Duplicate FID (user already selected)';
    else if (numberMap.has(number)) skipReason = 'Duplicate number (already selected by earlier user)';

    if (skipReason) {
      skippedList.push({ username, fid, number, timestamp: reply.timestamp, reason: skipReason, type: 'invalid' });
      continue;
    }

    numberMap.set(number, {
      username,
      fid,
      number,
      timestamp: reply.timestamp,
      comment: text,
    });
    seenFids.add(fid);
  }

  const fullList = [];
  for (let i = 0; i <= 99; i++) {
    const num = i.toString().padStart(2, '0');
    const entry = numberMap.get(num);
    if (entry) fullList.push(entry);
  }

  const totalSelected = fullList.length;
  const totalUnselected = 100 - totalSelected;

  return {
    totalReplies: allReplies.length,
    skippedList,  // Invalid list
    fullList,
    totalSelected,
    totalUnselected,
    isFull: totalSelected >= 100,
  };
}

// Main route: Display HTML
app.get('/', async (req, res) => {
  const data = await getPlayersData();
  if (data.error) {
    return res.status(500).send(`<h1>Error: ${data.error}</h1>`);
  }

  let html = `
    <html>
      <head>
        <title>IS3 Lottery Checker</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          h1, h2 { color: #333; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .stats { background-color: #f9f9f9; padding: 10px; border: 1px solid #ddd; margin-bottom: 20px; }
          .note { font-style: italic; color: #666; }
          .valid-row { background-color: lightgreen; }
          .invalid-row { background-color: lightyellow; }
          .late-row { background-color: lightpink; }
        </style>
      </head>
      <body>
        <h1>ROUND 3 IS3 Lottery Players List (Real-time Update)</h1>
        <p class="note">Data updated in real-time on each page load. Refresh to see latest. Cutoff time: 10:45 AM UTC (after this, comments are late and invalid).</p>

        <div class="stats">
          <h2>Statistics</h2>
          <p>Total replies fetched: ${data.totalReplies}</p>
          <p>Total valid selections: ${data.totalSelected}</p>
          <p>Total unselected numbers: ${data.totalUnselected}</p>
          <p>Total invalid comments: ${data.skippedList.length}</p>
          ${data.isFull ? '<p style="color: green;">📢 Reached 100 participants!</p>' : ''}
        </div>

        <h2>Valid Players List (00-99)</h2>
        <table>
          <tr><th>Number</th><th>Username</th><th>FID</th><th>Timestamp</th></tr>
  `;

  for (let i = 0; i <= 99; i++) {
    const num = i.toString().padStart(2, '0');
    const entry = data.fullList.find(e => e.number === num);
    html += `<tr class="valid-row"><td>${num}</td><td>${entry ? `@${entry.username}` : '❌ Not selected yet'}</td><td>${entry ? entry.fid : ''}</td><td>${entry ? entry.timestamp : ''}</td></tr>`;
  }

  html += `
        </table>

        <h2>Invalid Comments List</h2>
        <table>
          <tr><th>Username</th><th>FID</th><th>Number</th><th>Timestamp</th><th>Reason</th></tr>
  `;

  data.skippedList.forEach(skip => {
    const rowClass = skip.type === 'late' ? 'late-row' : 'invalid-row';
    html += `<tr class="${rowClass}"><td>@${skip.username}</td><td>${skip.fid}</td><td>${skip.number}</td><td>${skip.timestamp}</td><td>${skip.reason}</td></tr>`;
  });

  html += `
        </table>

        <h2>Lottery Results Today</h2>
        <script language="javascript" src="//www.minhngoc.com.vn/jquery/jquery-1.7.2.js"></script>
        <link rel="stylesheet" type="text/css" href="//www.minhngoc.com.vn/style/bangketqua_mini.css"/>
        <div id="box_kqxs_minhngoc">
          <script language="javascript">
            bgcolor="#bfbfbf";
            titlecolor="#730038";
            dbcolor="#000000";
            fsize="12px";
            kqwidth="300px";
          </script>
          <script language="javascript" src="//www.minhngoc.com.vn/getkqxs/mien-bac.js"></script>
        </div>
      </body>
    </html>
  `;

  res.send(html);
});

// API route: Return JSON
app.get('/api/players', async (req, res) => {
  const data = await getPlayersData();
  if (data.error) {
    return res.status(500).json({ error: data.error });
  }
  res.json({ valid: data.fullList, invalid: data.skippedList, stats: { totalSelected: data.totalSelected, totalUnselected: data.totalUnselected } });
});

// Listen on port if running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;