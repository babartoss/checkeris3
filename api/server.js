// api/server.js - Express web app for IS3 Lottery Checker
const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config({ quiet: true });  // Tắt log dotenv

const app = express();

const API_KEY = process.env.NEYNAR_API_KEY;
const CAST_HASH = process.env.CAST_HASH;

const headers = {
  accept: 'application/json',
  api_key: API_KEY,
  'x-neynar-experimental': 'true',  // Keep basic spam filtering
};

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
  let skippedDuplicates = 0;

  // Sort by timestamp ascending
  allReplies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const reply of allReplies) {
    if (numberMap.size >= 100) break;

    const fid = reply.author.fid;
    const username = reply.author.username;
    const text = reply.text.trim();
    const timestamp = reply.timestamp;
    const number = extractNumberFromText(text);

    if (!number || seenFids.has(fid)) continue;

    if (numberMap.has(number)) {
      skippedDuplicates++;
      continue;
    }

    numberMap.set(number, {
      username,
      fid,
      number,
      timestamp,
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

  // Write players.json
  fs.writeFileSync('players.json', JSON.stringify(fullList, null, 2));

  return {
    totalReplies: allReplies.length,
    skippedDuplicates,
    fullList,
    totalPlayers: fullList.length,
    isFull: fullList.length >= 100,
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
          body { font-family: Arial; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h1>IS3 Lottery Players List (Real-time Update)</h1>
        <p>Total replies fetched: ${data.totalReplies}</p>
        <p>Number of comments skipped due to duplicates: ${data.skippedDuplicates}</p>
        <p>Total valid players: ${data.totalPlayers}</p>
        ${data.isFull ? '<p style="color: green;">📢 Reached 100 participants!</p>' : ''}
        <table>
          <tr><th>Number</th><th>Username</th><th>FID</th><th>Timestamp</th></tr>
  `;

  for (let i = 0; i <= 99; i++) {
    const num = i.toString().padStart(2, '0');
    const entry = data.fullList.find(e => e.number === num);
    html += `<tr><td>${num}</td><td>${entry ? `@${entry.username}` : '❌ Not selected yet'}</td><td>${entry ? entry.fid : ''}</td><td>${entry ? entry.timestamp : ''}</td></tr>`;
  }

  html += `
        </table>
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
  res.json(data.fullList);
});

// Listen on port if running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;