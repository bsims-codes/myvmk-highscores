/**
 * Seed users.json from existing daily data files
 * Run this once to create the initial persistent user index
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const GAME_IDS = ['castle-fireworks', 'pirates', 'haunted-mansion', 'jungle-cruise'];

async function seedUsersIndex() {
  console.log('=== Seeding users.json from daily data ===');

  const users = {};

  // Read all daily files
  const files = await fs.readdir(DAILY_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

  console.log(`Found ${jsonFiles.length} daily files`);

  for (const file of jsonFiles) {
    const filepath = path.join(DAILY_DIR, file);
    const data = JSON.parse(await fs.readFile(filepath, 'utf-8'));
    const date = data.date;

    if (!data.games) continue;

    for (const gameId of GAME_IDS) {
      const gameData = data.games[gameId];
      if (!gameData) continue;

      // Process all score periods
      for (const period of ['yesterday', 'today', 'highscores']) {
        const periodData = gameData[period];
        if (!periodData?.scores) continue;

        const scores = periodData.scores;
        const topAvatar = periodData.topAvatar;

        scores.forEach((entry, idx) => {
          const username = entry.username;
          const score = entry.score;
          const rank = entry.rank || idx + 1;

          // Initialize user if not exists
          if (!users[username]) {
            users[username] = {
              avatar: null,
              lastSeen: null,
              lastAppearance: null,
              games: {}
            };
          }

          const user = users[username];

          // Update avatar if this user is #1 and we have an avatar
          if (rank === 1 && topAvatar) {
            user.avatar = topAvatar;
          }

          // Update last seen date and last appearance
          if (!user.lastSeen || date > user.lastSeen) {
            user.lastSeen = date;
            user.lastAppearance = { game: gameId, rank, date };
          } else if (date === user.lastSeen && rank < (user.lastAppearance?.rank || 999)) {
            // Same day but better rank
            user.lastAppearance = { game: gameId, rank, date };
          }

          // Initialize game stats if not exists
          if (!user.games[gameId]) {
            user.games[gameId] = { bestScore: 0, date: null, rank: null };
          }

          // Update best score if this is better
          if (score > user.games[gameId].bestScore) {
            user.games[gameId].bestScore = score;
            user.games[gameId].date = date;
            user.games[gameId].rank = rank;
          }
        });
      }
    }
  }

  // Update all-time rankings from all-time.json
  try {
    const allTimeData = await fs.readFile(path.join(DATA_DIR, 'all-time.json'), 'utf-8');
    const allTime = JSON.parse(allTimeData);

    for (const gameId of GAME_IDS) {
      const scores = allTime.games?.[gameId]?.scores || [];
      scores.forEach((entry, idx) => {
        const username = entry.username;
        const rank = idx + 1;

        if (users[username] && users[username].games[gameId]) {
          users[username].games[gameId].allTimeRank = rank;
        }
      });
    }
  } catch (error) {
    console.warn('Could not update all-time rankings:', error.message);
  }

  const usersData = {
    lastUpdated: new Date().toISOString().split('T')[0],
    userCount: Object.keys(users).length,
    users
  };

  await fs.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));
  console.log(`Created users.json with ${usersData.userCount} users`);
}

seedUsersIndex().catch(console.error);
