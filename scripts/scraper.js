import * as cheerio from 'cheerio';
import { format, subDays } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

const HIGHSCORES_URL = 'https://www.myvmk.com/highscores';
const PACIFIC_TZ = 'America/Los_Angeles';

// Game configuration - maps CSS class patterns to game IDs
const GAMES = [
  { id: 'castle-fireworks', name: 'Castle Fireworks Remixed', cssClass: null }, // First game, no special class
  { id: 'pirates', name: 'Pirates of the Caribbean', cssClass: 'potc' },
  { id: 'haunted-mansion', name: 'Haunted Mansion', cssClass: 'hm' },
  { id: 'jungle-cruise', name: 'Jungle Cruise', cssClass: 'junglecruise' }
];

/**
 * Fetch the highscores page HTML
 */
async function fetchHighscoresPage() {
  console.log(`Fetching ${HIGHSCORES_URL}...`);
  const response = await fetch(HIGHSCORES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch highscores: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Parse score entries from a list element
 * Format: "Username - Score"
 */
function parseScores(ul) {
  const scores = [];
  ul.find('li').each((index, li) => {
    const text = cheerio.load(li).text().trim();
    // Match "Username - Score" pattern
    const match = text.match(/^(.+?)\s*-\s*(\d+)$/);
    if (match) {
      scores.push({
        rank: index + 1,
        username: match[1].trim(),
        score: parseInt(match[2], 10)
      });
    }
  });
  return scores;
}

/**
 * Extract avatar filename from URL
 */
function extractAvatarFilename(url) {
  if (!url) return null;
  const match = url.match(/([a-f0-9]+\.png)$/i);
  return match ? match[1] : null;
}

/**
 * Download avatar image to local storage
 */
async function downloadAvatar(url, filename) {
  if (!url || !filename) return null;

  const localPath = path.join(AVATARS_DIR, filename);

  // Check if already downloaded
  try {
    await fs.access(localPath);
    console.log(`Avatar already exists: ${filename}`);
    return filename;
  } catch {
    // File doesn't exist, download it
  }

  try {
    console.log(`Downloading avatar: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to download avatar: ${response.status}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(localPath, buffer);
    console.log(`Saved avatar: ${filename}`);
    return filename;
  } catch (error) {
    console.error(`Error downloading avatar: ${error.message}`);
    return null;
  }
}

/**
 * Parse a single game section from the page
 */
function parseGameSection($, highscoresDiv, gameConfig) {
  const columns = highscoresDiv.find('.col-md-4');

  const result = {
    name: gameConfig.name,
    today: { topAvatar: null, scores: [] },
    yesterday: { topAvatar: null, scores: [] },
    highscores: { topAvatar: null, scores: [] }
  };

  columns.each((index, col) => {
    const $col = $(col);
    const title = $col.find('.scores-title h4').text().trim().toLowerCase();
    const avatarUrl = $col.find('center img').attr('src') || null;
    const avatarFilename = extractAvatarFilename(avatarUrl);
    const ul = $col.find('ul');
    const scores = parseScores(ul);

    if (title === 'today') {
      result.today = { topAvatar: avatarFilename, topAvatarUrl: avatarUrl, scores };
    } else if (title === 'yesterday') {
      result.yesterday = { topAvatar: avatarFilename, topAvatarUrl: avatarUrl, scores };
    } else if (title === 'highscores') {
      result.highscores = { topAvatar: avatarFilename, topAvatarUrl: avatarUrl, scores };
    }
  });

  return result;
}

/**
 * Parse all games from the HTML
 */
function parseAllGames(html) {
  const $ = cheerio.load(html);
  const games = {};

  // Find all highscores sections
  const highscoresDivs = $('.highscores');

  highscoresDivs.each((index, div) => {
    const $div = $(div);
    const gameConfig = GAMES[index];

    if (!gameConfig) {
      console.warn(`Found more highscores sections than expected games at index ${index}`);
      return;
    }

    games[gameConfig.id] = parseGameSection($, $div, gameConfig);
  });

  return games;
}

/**
 * Get the current date in Pacific Time
 */
function getPacificDate() {
  const now = new Date();
  const pacificNow = toZonedTime(now, PACIFIC_TZ);
  return format(pacificNow, 'yyyy-MM-dd');
}

/**
 * Save daily snapshot
 */
async function saveDailySnapshot(games, date) {
  const snapshot = {
    date: date,
    scrapedAt: new Date().toISOString(),
    games: {}
  };

  // Clean up avatar URLs from the saved data (keep only filenames)
  for (const [gameId, gameData] of Object.entries(games)) {
    snapshot.games[gameId] = {
      name: gameData.name,
      today: {
        topAvatar: gameData.today.topAvatar,
        scores: gameData.today.scores
      },
      yesterday: {
        topAvatar: gameData.yesterday.topAvatar,
        scores: gameData.yesterday.scores
      },
      highscores: {
        topAvatar: gameData.highscores.topAvatar,
        scores: gameData.highscores.scores
      }
    };
  }

  const filename = `${date}.json`;
  const filepath = path.join(DAILY_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2));
  console.log(`Saved daily snapshot: ${filename}`);
  return snapshot;
}

/**
 * Update all-time high scores
 */
async function updateAllTimeScores(games, date) {
  const allTimePath = path.join(DATA_DIR, 'all-time.json');

  let allTime;
  try {
    const existing = await fs.readFile(allTimePath, 'utf-8');
    allTime = JSON.parse(existing);
  } catch {
    // Initialize if doesn't exist
    allTime = {
      lastUpdated: date,
      games: {}
    };
  }

  // Update with new high scores
  for (const [gameId, gameData] of Object.entries(games)) {
    if (!allTime.games[gameId]) {
      // First time seeing this game - use highscores from source as baseline
      allTime.games[gameId] = {
        name: gameData.name,
        topAvatar: gameData.highscores.topAvatar,
        scores: gameData.highscores.scores.map(s => ({
          ...s,
          achievedOn: date
        }))
      };
      continue;
    }

    const existing = allTime.games[gameId];
    const existingScoreMap = new Map(existing.scores.map(s => [s.username, s]));

    // Merge in new scores from the source's highscores column
    for (const newScore of gameData.highscores.scores) {
      const existingScore = existingScoreMap.get(newScore.username);
      if (!existingScore || newScore.score > existingScore.score) {
        existingScoreMap.set(newScore.username, {
          ...newScore,
          achievedOn: date
        });
      }
    }

    // Also check today's scores for new records
    for (const newScore of gameData.today.scores) {
      const existingScore = existingScoreMap.get(newScore.username);
      if (!existingScore || newScore.score > existingScore.score) {
        existingScoreMap.set(newScore.username, {
          ...newScore,
          achievedOn: date
        });
      }
    }

    // Sort by score descending and take top entries
    const sortedScores = Array.from(existingScoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 50); // Keep top 50 all-time

    // Re-rank
    sortedScores.forEach((s, i) => s.rank = i + 1);

    existing.scores = sortedScores;
    existing.topAvatar = sortedScores[0]?.achievedOn === date
      ? (gameData.today.topAvatar || gameData.highscores.topAvatar || existing.topAvatar)
      : existing.topAvatar;
  }

  allTime.lastUpdated = date;
  await fs.writeFile(allTimePath, JSON.stringify(allTime, null, 2));
  console.log('Updated all-time.json');
  return allTime;
}

/**
 * Download all top player avatars
 */
async function downloadAllAvatars(games) {
  const avatarUrls = new Set();

  for (const gameData of Object.values(games)) {
    if (gameData.today.topAvatarUrl) avatarUrls.add(gameData.today.topAvatarUrl);
    if (gameData.yesterday.topAvatarUrl) avatarUrls.add(gameData.yesterday.topAvatarUrl);
    if (gameData.highscores.topAvatarUrl) avatarUrls.add(gameData.highscores.topAvatarUrl);
  }

  for (const url of avatarUrls) {
    const filename = extractAvatarFilename(url);
    if (filename) {
      await downloadAvatar(url, filename);
    }
  }
}

/**
 * Main scraper function
 */
async function main() {
  console.log('=== MyVMK High Scores Scraper ===');
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    // Ensure directories exist
    await fs.mkdir(DAILY_DIR, { recursive: true });
    await fs.mkdir(AVATARS_DIR, { recursive: true });

    // Fetch and parse
    const html = await fetchHighscoresPage();
    const games = parseAllGames(html);

    // Validate we got all games
    const gameCount = Object.keys(games).length;
    if (gameCount !== GAMES.length) {
      console.warn(`Warning: Expected ${GAMES.length} games, found ${gameCount}`);
    }

    // Get Pacific Time date
    const pacificDate = getPacificDate();
    console.log(`Pacific Time date: ${pacificDate}`);

    // Download avatars
    await downloadAllAvatars(games);

    // Save daily snapshot
    await saveDailySnapshot(games, pacificDate);

    // Update all-time scores
    await updateAllTimeScores(games, pacificDate);

    console.log('=== Scrape completed successfully ===');
  } catch (error) {
    console.error('Scrape failed:', error);
    process.exit(1);
  }
}

main();
