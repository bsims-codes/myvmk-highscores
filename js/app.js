/**
 * MyVMK High Scores Tracker
 * Frontend application for displaying and searching high scores
 */

const GAMES = ['castle-fireworks', 'pirates', 'haunted-mansion', 'jungle-cruise'];
const PACIFIC_TZ = 'America/Los_Angeles';

// State
let allTimeData = null;
let dailyDataCache = new Map();
let doubleCreditDays = new Set();
let userIndex = new Map(); // username -> { avatar, lastSeen, games: { gameId: { bestScore, date, rank } } }
let allUsernames = []; // sorted list of all usernames for autocomplete
let currentPeriod = 'today';
let currentSearchQuery = '';
let currentViewMode = 'all'; // 'all' or 'single'
let currentGame = 'castle-fireworks'; // current game when in single view mode
let trendCharts = new Map();
let userCharts = new Map();

// DOM Elements
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const gamesGrid = document.getElementById('gamesGrid');
const periodGrid = document.getElementById('periodGrid');
const periodTabsWrapper = document.querySelector('.period-tabs-wrapper');
const trendsSection = document.getElementById('trendsSection');
const userHistorySection = document.getElementById('userHistorySection');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearch');
const lastUpdatedEl = document.getElementById('lastUpdated');
const searchedUsernameEl = document.getElementById('searchedUsername');

/**
 * Get current date in Pacific Time
 */
function getPacificDate() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/**
 * Get yesterday's date in Pacific Time
 */
function getYesterdayPacific() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(yesterday);
}

/**
 * Get dates for the last N days
 */
function getLastNDays(n) {
  const dates = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dates.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: PACIFIC_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date));
  }
  return dates;
}

/**
 * Get dates for the current calendar month
 */
function getCurrentMonthDates() {
  const dates = [];
  const now = new Date();
  const pacificNow = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const [year, month] = pacificNow.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
    // Only include past dates
    if (dateStr <= pacificNow) {
      dates.push(dateStr);
    }
  }

  return dates;
}

/**
 * Fetch JSON data with error handling
 */
async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`Failed to fetch ${url}:`, error.message);
    return null;
  }
}

/**
 * Load all-time data
 */
async function loadAllTimeData() {
  allTimeData = await fetchJSON('data/all-time.json');
  return allTimeData;
}

/**
 * Load double credit days data
 */
async function loadDoubleCreditDays() {
  const data = await fetchJSON('data/double-credit-days.json');
  if (data?.dates) {
    doubleCreditDays = new Set(data.dates);
  }
  return doubleCreditDays;
}

/**
 * Load persistent user index from users.json
 */
async function loadUserIndex() {
  userIndex.clear();

  const usersData = await fetchJSON('data/users.json');
  if (!usersData?.users) {
    console.warn('No users.json found or empty');
    return;
  }

  // Convert object to Map
  for (const [username, userData] of Object.entries(usersData.users)) {
    userIndex.set(username, userData);
  }

  // Build sorted username list for autocomplete
  allUsernames = Array.from(userIndex.keys()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  console.log(`Loaded user index with ${allUsernames.length} users`);
}

/**
 * Load daily data for a specific date
 */
async function loadDailyData(date) {
  if (dailyDataCache.has(date)) {
    return dailyDataCache.get(date);
  }

  const data = await fetchJSON(`data/daily/${date}.json`);
  if (data) {
    dailyDataCache.set(date, data);
  }
  return data;
}

/**
 * Load data for multiple dates
 */
async function loadMultipleDays(dates) {
  const results = await Promise.all(dates.map(loadDailyData));
  return results.filter(Boolean);
}

/**
 * Aggregate scores across multiple days (best score per user)
 */
function aggregateScores(dailyDataArray, scoreType = 'yesterday') {
  const aggregated = {};

  for (const gameId of GAMES) {
    const userBestScores = new Map();

    for (const dayData of dailyDataArray) {
      const gameData = dayData.games?.[gameId];
      if (!gameData) continue;

      const scores = gameData[scoreType]?.scores || gameData.yesterday?.scores || [];
      for (const entry of scores) {
        const existing = userBestScores.get(entry.username);
        if (!existing || entry.score > existing.score) {
          userBestScores.set(entry.username, {
            username: entry.username,
            score: entry.score,
            date: dayData.date
          });
        }
      }
    }

    // Sort by score descending
    const sorted = Array.from(userBestScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        score: entry.score
      }));

    aggregated[gameId] = {
      scores: sorted,
      topAvatar: sorted[0]?.username ? findAvatarForUser(dailyDataArray, gameId, sorted[0].username) : null
    };
  }

  return aggregated;
}

/**
 * Find avatar for a user from daily data
 * @param {boolean} prioritizeHighscores - If true, check highscores first (for all-time lookups)
 */
function findAvatarForUser(dailyDataArray, gameId, username, prioritizeHighscores = false) {
  // For all-time scores, prioritize highscores period since that's where all-time records live
  const periods = prioritizeHighscores
    ? ['highscores', 'yesterday', 'today']
    : ['yesterday', 'today', 'highscores'];

  for (const dayData of dailyDataArray) {
    const gameData = dayData.games?.[gameId];
    if (!gameData) continue;

    for (const period of periods) {
      if (gameData[period]?.scores?.[0]?.username === username) {
        return gameData[period].topAvatar;
      }
    }
  }
  return null;
}

/**
 * Get scores for the selected period
 */
async function getScoresForPeriod(period) {
  switch (period) {
    case 'today': {
      const todayDate = getPacificDate();
      let data = await loadDailyData(todayDate);

      // If today's file doesn't exist yet, try yesterday's file as fallback
      if (!data) {
        const yesterdayDate = getYesterdayPacific();
        data = await loadDailyData(yesterdayDate);
      }

      if (!data) return null;

      const result = {};
      for (const gameId of GAMES) {
        const gameData = data.games?.[gameId];
        result[gameId] = {
          scores: gameData?.today?.scores || [],
          topAvatar: gameData?.today?.topAvatar
        };
      }
      return result;
    }

    case 'yesterday': {
      const yesterdayDate = getYesterdayPacific();
      const data = await loadDailyData(yesterdayDate);
      if (!data) {
        // Try today's file which contains yesterday's scores
        const todayDate = getPacificDate();
        const todayData = await loadDailyData(todayDate);
        if (todayData) {
          const result = {};
          for (const gameId of GAMES) {
            const gameData = todayData.games?.[gameId];
            result[gameId] = {
              scores: gameData?.yesterday?.scores || [],
              topAvatar: gameData?.yesterday?.topAvatar
            };
          }
          return result;
        }
        return null;
      }
      const result = {};
      for (const gameId of GAMES) {
        const gameData = data.games?.[gameId];
        result[gameId] = {
          scores: gameData?.yesterday?.scores || [],
          topAvatar: gameData?.yesterday?.topAvatar
        };
      }
      return result;
    }

    case 'week': {
      const dates = getLastNDays(7);
      const dailyData = await loadMultipleDays(dates);
      if (dailyData.length === 0) return null;
      return aggregateScores(dailyData, 'yesterday');
    }

    case 'month': {
      const dates = getCurrentMonthDates();
      const dailyData = await loadMultipleDays(dates);
      if (dailyData.length === 0) return null;
      return aggregateScores(dailyData, 'yesterday');
    }

    case 'alltime': {
      if (!allTimeData) return null;

      // Load recent daily data to find correct avatars
      // Search through 30 days to ensure we find the user even if they haven't played recently
      // The 'highscores' section in daily files contains all-time records, so this should work
      const dates = getLastNDays(30);
      const dailyData = await loadMultipleDays(dates);

      const result = {};
      for (const gameId of GAMES) {
        const gameData = allTimeData.games?.[gameId];
        const scores = gameData?.scores?.slice(0, 10) || [];
        const topPlayer = scores[0];

        // Find the correct avatar for the #1 player from daily data, prioritizing highscores
        const topAvatar = topPlayer && dailyData.length > 0
          ? findAvatarForUser(dailyData, gameId, topPlayer.username, true)
          : gameData?.topAvatar; // fallback to data file avatar if no daily data

        result[gameId] = {
          scores,
          topAvatar
        };
      }
      return result;
    }

    default:
      return null;
  }
}

/**
 * Render a single leaderboard
 */
function renderLeaderboard(gameId, data, searchQuery = '') {
  const leaderboardEl = document.getElementById(`${gameId}-leaderboard`);
  const avatarEl = document.getElementById(`${gameId}-avatar`);

  if (!leaderboardEl) return;

  // Clear existing content
  leaderboardEl.innerHTML = '';

  const scores = data?.scores || [];
  const topPlayer = scores[0];
  const searchLower = searchQuery.toLowerCase();

  // Render top player section with avatar and info
  if (avatarEl) {
    if (topPlayer) {
      const isHighlighted = searchQuery && topPlayer.username.toLowerCase().includes(searchLower);
      const avatarImg = data?.topAvatar
        ? `<img src="data/avatars/${data.topAvatar}" alt="${escapeHtml(topPlayer.username)}" onerror="this.outerHTML='<div class=\\'avatar-placeholder\\'></div>'">`
        : '<div class="avatar-placeholder"></div>';

      avatarEl.innerHTML = `
        ${avatarImg}
        <div class="top-player-info${isHighlighted ? ' highlighted' : ''}">
          <span class="top-player-rank">#1</span>
          <span class="top-player-name">${escapeHtml(topPlayer.username)}</span>
          <span class="top-player-score">${topPlayer.score.toLocaleString()}</span>
        </div>
      `;
    } else {
      avatarEl.innerHTML = '<div class="avatar-placeholder"></div><div class="top-player-info"><span class="top-player-name">No data</span></div>';
    }
  }

  // Render scores 2-10 in leaderboard
  if (scores.length <= 1) {
    leaderboardEl.innerHTML = '<li class="empty-state">No additional scores</li>';
    return;
  }

  for (const entry of scores.slice(1)) {
    const li = document.createElement('li');
    const isHighlighted = searchQuery && entry.username.toLowerCase().includes(searchLower);

    li.className = `rank-${entry.rank}${isHighlighted ? ' highlighted' : ''}`;
    li.innerHTML = `
      <span class="rank">${entry.rank}</span>
      <span class="username">${escapeHtml(entry.username)}</span>
      <span class="score">${entry.score.toLocaleString()}</span>
    `;

    leaderboardEl.appendChild(li);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render all leaderboards for current period
 */
async function renderAllLeaderboards() {
  if (currentViewMode === 'single') {
    // Single game view - show all periods for selected game
    gamesGrid.style.display = 'none';
    periodGrid.style.display = 'grid';

    // Apply game-specific class to period cards for styling
    const gameClass = getGameClass(currentGame);
    const periods = ['today', 'yesterday', 'week', 'month', 'alltime'];
    for (const period of periods) {
      const periodCard = document.querySelector(`.game-card[data-period="${period}"]`);
      if (periodCard) {
        // Remove all game classes
        periodCard.classList.remove('fireworks', 'pirates', 'haunted', 'jungle');
        // Add current game class
        periodCard.classList.add(gameClass);
      }

      const data = await getScoresForPeriod(period);
      const gameData = data?.[currentGame];

      renderPeriodLeaderboard(period, currentGame, gameData, currentSearchQuery);
    }
  } else {
    // All games view - show all games for current period
    gamesGrid.style.display = 'grid';
    periodGrid.style.display = 'none';

    const data = await getScoresForPeriod(currentPeriod);

    if (!data) {
      // Show empty state for all games
      for (const gameId of GAMES) {
        renderLeaderboard(gameId, null, currentSearchQuery);
      }
      return;
    }

    for (const gameId of GAMES) {
      renderLeaderboard(gameId, data[gameId], currentSearchQuery);
    }
  }
}

/**
 * Render a leaderboard for a specific period (used in single game view)
 */
function renderPeriodLeaderboard(period, gameId, data, searchQuery = '') {
  const leaderboardEl = document.getElementById(`period-${period}-leaderboard`);
  const avatarEl = document.getElementById(`period-${period}-avatar`);

  if (!leaderboardEl) return;

  // Clear existing content
  leaderboardEl.innerHTML = '';

  const scores = data?.scores || [];
  const topPlayer = scores[0];
  const searchLower = searchQuery.toLowerCase();

  // Render top player section with avatar and info
  if (avatarEl) {
    if (topPlayer) {
      const isHighlighted = searchQuery && topPlayer.username.toLowerCase().includes(searchLower);
      const avatarImg = data?.topAvatar
        ? `<img src="data/avatars/${data.topAvatar}" alt="${escapeHtml(topPlayer.username)}" onerror="this.outerHTML='<div class=\\'avatar-placeholder\\'></div>'">`
        : '<div class="avatar-placeholder"></div>';

      avatarEl.innerHTML = `
        ${avatarImg}
        <div class="top-player-info${isHighlighted ? ' highlighted' : ''}">
          <span class="top-player-rank">#1</span>
          <span class="top-player-name">${escapeHtml(topPlayer.username)}</span>
          <span class="top-player-score">${topPlayer.score.toLocaleString()}</span>
        </div>
      `;
    } else {
      avatarEl.innerHTML = '<div class="avatar-placeholder"></div><div class="top-player-info"><span class="top-player-name">No data</span></div>';
    }
  }

  // Render scores 2-10 in leaderboard
  if (scores.length <= 1) {
    leaderboardEl.innerHTML = '<li class="empty-state">No additional scores</li>';
    return;
  }

  for (const entry of scores.slice(1)) {
    const li = document.createElement('li');
    const isHighlighted = searchQuery && entry.username.toLowerCase().includes(searchLower);

    li.className = `rank-${entry.rank}${isHighlighted ? ' highlighted' : ''}`;
    li.innerHTML = `
      <span class="rank">${entry.rank}</span>
      <span class="username">${escapeHtml(entry.username)}</span>
      <span class="score">${entry.score.toLocaleString()}</span>
    `;

    leaderboardEl.appendChild(li);
  }
}

/**
 * Get CSS class name for a game
 */
function getGameClass(gameId) {
  const classMap = {
    'castle-fireworks': 'fireworks',
    'pirates': 'pirates',
    'haunted-mansion': 'haunted',
    'jungle-cruise': 'jungle'
  };
  return classMap[gameId] || gameId;
}

/**
 * Create trend chart for a game
 */
function createTrendChart(gameId, data) {
  const canvas = document.getElementById(`chart-${gameId}`);
  if (!canvas) return;

  // Destroy existing chart if any
  if (trendCharts.has(gameId)) {
    trendCharts.get(gameId).destroy();
  }

  const ctx = canvas.getContext('2d');
  const gameColor = getGameColor(gameId);

  // Build per-point styling arrays
  const pointStyles = [];
  const pointColors = [];
  const pointBorderColors = [];
  const pointRadii = [];

  for (let i = 0; i < data.scores.length; i++) {
    const isDouble = data.isDoubleCreditDay?.[i];
    const isLow = data.isLowParticipation?.[i];

    if (isDouble && isLow) {
      // Both: star with orange color
      pointStyles.push('star');
      pointColors.push('#ff9500');
      pointBorderColors.push('#ff6600');
      pointRadii.push(7);
    } else if (isDouble) {
      // Double credit day: gold star
      pointStyles.push('star');
      pointColors.push('#ffd700');
      pointBorderColors.push('#ffaa00');
      pointRadii.push(7);
    } else if (isLow) {
      // Low participation: red triangle
      pointStyles.push('triangle');
      pointColors.push('#ff4757');
      pointBorderColors.push('#ff3344');
      pointRadii.push(5);
    } else {
      // Normal day: circle
      pointStyles.push('circle');
      pointColors.push(gameColor);
      pointBorderColors.push(gameColor);
      pointRadii.push(3);
    }
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Top Score',
        data: data.scores,
        borderColor: gameColor,
        backgroundColor: getGameColor(gameId, 0.1),
        fill: true,
        tension: 0.4,
        pointStyle: pointStyles,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointBorderColors,
        pointRadius: pointRadii,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const idx = context.dataIndex;
              const lines = [`Score: ${context.parsed.y.toLocaleString()}`];
              if (data.isDoubleCreditDay?.[idx]) {
                lines.push('Double Credit Day');
              }
              if (data.isLowParticipation?.[idx]) {
                lines.push('Low Participation (<10 players)');
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0c0',
            maxTicksLimit: 7
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0c0',
            callback: (value) => value.toLocaleString()
          }
        }
      }
    }
  });

  trendCharts.set(gameId, chart);
}

/**
 * Get color for a game
 */
function getGameColor(gameId, alpha = 1) {
  const colors = {
    'castle-fireworks': `rgba(255, 107, 157, ${alpha})`,
    'pirates': `rgba(78, 205, 196, ${alpha})`,
    'haunted-mansion': `rgba(157, 78, 221, ${alpha})`,
    'jungle-cruise': `rgba(124, 181, 24, ${alpha})`
  };
  return colors[gameId] || `rgba(107, 76, 230, ${alpha})`;
}

/**
 * Load and render trend charts
 */
async function loadTrendCharts() {
  const dates = getLastNDays(30).reverse();
  const dailyData = await loadMultipleDays(dates);

  if (dailyData.length === 0) {
    trendsSection.style.display = 'none';
    return;
  }

  trendsSection.style.display = 'block';

  for (const gameId of GAMES) {
    const chartData = {
      labels: [],
      scores: [],
      rawDates: [],
      isDoubleCreditDay: [],
      isLowParticipation: []
    };

    for (const dayData of dailyData.sort((a, b) => a.date.localeCompare(b.date))) {
      const gameData = dayData.games?.[gameId];
      const scores = gameData?.yesterday?.scores || gameData?.highscores?.scores || [];
      const topScore = scores[0]?.score || 0;

      if (topScore > 0) {
        chartData.labels.push(formatDateShort(dayData.date));
        chartData.scores.push(topScore);
        chartData.rawDates.push(dayData.date);
        chartData.isDoubleCreditDay.push(doubleCreditDays.has(dayData.date));
        chartData.isLowParticipation.push(scores.length < 10);
      }
    }

    if (chartData.scores.length > 0) {
      createTrendChart(gameId, chartData);
    }
  }
}

/**
 * Format date for chart labels
 */
function formatDateShort(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Search for a user's history
 */
async function searchUserHistory(username) {
  if (!username) {
    userHistorySection.style.display = 'none';
    return;
  }

  searchedUsernameEl.textContent = username;

  const dates = getLastNDays(30).reverse();
  const dailyData = await loadMultipleDays(dates);

  if (dailyData.length === 0) {
    userHistorySection.style.display = 'none';
    return;
  }

  let hasData = false;

  for (const gameId of GAMES) {
    const chartData = {
      labels: [],
      scores: []
    };

    for (const dayData of dailyData.sort((a, b) => a.date.localeCompare(b.date))) {
      const gameData = dayData.games?.[gameId];
      const allScores = [
        ...(gameData?.yesterday?.scores || []),
        ...(gameData?.today?.scores || []),
        ...(gameData?.highscores?.scores || [])
      ];

      const userScore = allScores.find(s =>
        s.username.toLowerCase() === username.toLowerCase()
      );

      if (userScore) {
        chartData.labels.push(formatDateShort(dayData.date));
        chartData.scores.push(userScore.score);
        hasData = true;
      }
    }

    createUserHistoryChart(gameId, chartData);
  }

  userHistorySection.style.display = hasData ? 'block' : 'none';
}

/**
 * Create user history chart
 */
function createUserHistoryChart(gameId, data) {
  const canvas = document.getElementById(`user-chart-${gameId}`);
  if (!canvas) return;

  // Destroy existing chart if any
  if (userCharts.has(gameId)) {
    userCharts.get(gameId).destroy();
  }

  const ctx = canvas.getContext('2d');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Score',
        data: data.scores,
        borderColor: getGameColor(gameId),
        backgroundColor: getGameColor(gameId, 0.1),
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0c0'
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#a0a0c0',
            callback: (value) => value.toLocaleString()
          }
        }
      }
    }
  });

  userCharts.set(gameId, chart);
}

/**
 * Handle period tab click
 */
function handlePeriodChange(period) {
  currentPeriod = period;

  // Update active tab
  document.querySelectorAll('.period-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.period === period);
  });

  renderAllLeaderboards();
}

/**
 * Handle search input
 */
function handleSearch(query) {
  currentSearchQuery = query.trim();
  clearSearchBtn.style.display = currentSearchQuery ? 'block' : 'none';

  renderAllLeaderboards();

  // Debounced user history search
  clearTimeout(handleSearch.timeout);
  handleSearch.timeout = setTimeout(() => {
    if (currentSearchQuery.length >= 2) {
      searchUserHistory(currentSearchQuery);
    } else {
      userHistorySection.style.display = 'none';
    }
  }, 300);
}

/**
 * Handle view mode change
 */
function handleViewModeChange(viewMode) {
  currentViewMode = viewMode;

  // Update active view toggle button
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewMode);
  });

  // Show/hide game selector wrapper and period tabs wrapper
  const gameSelectorWrapper = document.querySelector('.game-selector-wrapper');
  if (viewMode === 'single') {
    gameSelectorWrapper.style.display = 'block';
    periodTabsWrapper.style.display = 'none';
  } else {
    gameSelectorWrapper.style.display = 'none';
    periodTabsWrapper.style.display = 'block';
  }

  renderAllLeaderboards();
}

/**
 * Handle game selection (in single game view)
 */
function handleGameSelection(gameId) {
  currentGame = gameId;

  // Update active game selector button
  document.querySelectorAll('.game-selector-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.game === gameId);
  });

  renderAllLeaderboards();
}

/**
 * Initialize the application
 */
async function init() {
  try {
    // Load all-time data and double credit days
    await loadAllTimeData();
    await loadDoubleCreditDays();

    // Load today's data to get "yesterday" scores
    const todayDate = getPacificDate();
    await loadDailyData(todayDate);

    // Also try yesterday's file
    const yesterdayDate = getYesterdayPacific();
    await loadDailyData(yesterdayDate);

    // Load persistent user index for autocomplete and user cards
    await loadUserIndex();

    // Update last updated time (use daily data's scrapedAt for more precise time)
    const todayData = dailyDataCache.get(todayDate);
    if (todayData?.scrapedAt) {
      lastUpdatedEl.textContent = formatDateTime(todayData.scrapedAt);
    } else if (allTimeData?.lastUpdated) {
      lastUpdatedEl.textContent = formatDate(allTimeData.lastUpdated);
    } else {
      lastUpdatedEl.textContent = 'Not available';
    }

    // Show content
    loadingState.style.display = 'none';
    gamesGrid.style.display = 'grid';

    // Render initial leaderboards
    await renderAllLeaderboards();

    // Load trend charts
    await loadTrendCharts();

  } catch (error) {
    console.error('Initialization failed:', error);
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
  }
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format date and time for display
 */
function formatDateTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// ===== Autocomplete =====
let autocompleteVisible = false;
let selectedAutocompleteIndex = -1;

function showAutocomplete(query) {
  const dropdown = document.getElementById('autocompleteDropdown');
  if (!dropdown) return;

  if (!query || query.length < 1) {
    hideAutocomplete();
    return;
  }

  // Get the last term being typed (for comma-separated input)
  const terms = query.split(',').map(t => t.trim());
  const currentTerm = terms[terms.length - 1].toLowerCase();

  if (!currentTerm) {
    hideAutocomplete();
    return;
  }

  // Filter usernames
  const matches = allUsernames
    .filter(name => name.toLowerCase().includes(currentTerm))
    .slice(0, 8);

  if (matches.length === 0) {
    hideAutocomplete();
    return;
  }

  // Build dropdown HTML
  dropdown.innerHTML = matches.map((name, idx) => `
    <div class="autocomplete-item${idx === selectedAutocompleteIndex ? ' selected' : ''}" data-username="${escapeHtml(name)}">
      ${escapeHtml(name)}
    </div>
  `).join('');

  dropdown.style.display = 'block';
  autocompleteVisible = true;
}

function hideAutocomplete() {
  const dropdown = document.getElementById('autocompleteDropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  autocompleteVisible = false;
  selectedAutocompleteIndex = -1;
}

function selectAutocompleteItem(username) {
  addUserCard(username);
  searchInput.focus();
}

// ===== Inline User Cards =====
const GAME_ICONS = {
  'castle-fireworks': '🎆',
  'pirates': '🏴‍☠️',
  'haunted-mansion': '👻',
  'jungle-cruise': '🌴'
};

const GAME_NAMES = {
  'castle-fireworks': 'Fireworks',
  'pirates': 'POTC',
  'haunted-mansion': 'Haunted Mansion',
  'jungle-cruise': 'Jungle Cruise'
};

// Track displayed user cards
let displayedUsers = new Set();

function createUserCardHtml(name, includeRemoveBtn = true) {
  const user = userIndex.get(name);
  const removeBtn = includeRemoveBtn
    ? `<button class="user-card-remove" data-username="${escapeHtml(name)}" aria-label="Remove">&times;</button>`
    : '';

  if (!user) {
    return `
      <div class="user-card" data-username="${escapeHtml(name)}">
        ${removeBtn}
        <div class="user-card-header">
          <div class="user-avatar-placeholder"></div>
          <div class="user-card-info">
            <h3 class="user-card-name">${escapeHtml(name)}</h3>
            <p class="user-card-subtitle">User not found</p>
          </div>
        </div>
      </div>
    `;
  }

  const avatarHtml = user.avatar
    ? `<img src="data/avatars/${user.avatar}" alt="${escapeHtml(name)}" class="user-card-avatar" onerror="this.outerHTML='<div class=\\'user-avatar-placeholder\\'></div>'">`
    : '<div class="user-avatar-placeholder"></div>';

  const lastSeenFormatted = user.lastSeen
    ? formatDateShort(user.lastSeen)
    : 'Unknown';

  const gamesHtml = GAMES.map(gameId => {
    const gameData = user.games[gameId];
    if (!gameData || !gameData.bestScore) {
      return `
        <div class="user-game-row">
          <span class="user-game-icon">${GAME_ICONS[gameId]}</span>
          <span class="user-game-name">${GAME_NAMES[gameId]}</span>
          <span class="user-game-score">—</span>
          <span class="user-game-context">No data</span>
        </div>
      `;
    }

    let context = '';
    if (gameData.allTimeRank && gameData.allTimeRank <= 10) {
      context = `#${gameData.allTimeRank} All-Time`;
    } else if (gameData.date && gameData.rank) {
      context = `Top ${gameData.rank} • ${formatDateShort(gameData.date)}`;
    }

    return `
      <div class="user-game-row">
        <span class="user-game-icon">${GAME_ICONS[gameId]}</span>
        <span class="user-game-name">${GAME_NAMES[gameId]}</span>
        <span class="user-game-score">${gameData.bestScore.toLocaleString()}</span>
        <span class="user-game-context">${context}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="user-card" data-username="${escapeHtml(name)}">
      ${removeBtn}
      <div class="user-card-header">
        ${avatarHtml}
        <div class="user-card-info">
          <h3 class="user-card-name">${escapeHtml(name)}</h3>
          <p class="user-card-subtitle">Last seen: ${lastSeenFormatted}</p>
        </div>
      </div>
      <div class="user-card-games">
        ${gamesHtml}
      </div>
    </div>
  `;
}

function addUserCard(username) {
  // Find exact match (case-insensitive)
  const exactMatch = allUsernames.find(u => u.toLowerCase() === username.toLowerCase());
  const name = exactMatch || username;

  // Don't add duplicate
  if (displayedUsers.has(name.toLowerCase())) {
    return;
  }

  displayedUsers.add(name.toLowerCase());

  const container = document.getElementById('userCardsInline');
  if (!container) return;

  // Add the card
  const cardHtml = createUserCardHtml(name);
  container.insertAdjacentHTML('beforeend', cardHtml);
  container.style.display = 'flex';

  // Clear search input and hide autocomplete
  searchInput.value = '';
  hideAutocomplete();

  // Show clear button when cards are displayed
  clearSearchBtn.style.display = 'block';
}

function removeUserCard(username) {
  const lowerName = username.toLowerCase();
  displayedUsers.delete(lowerName);

  const container = document.getElementById('userCardsInline');
  if (!container) return;

  const card = container.querySelector(`.user-card[data-username="${username}"]`);
  if (card) {
    card.remove();
  }

  // Hide container and clear button if empty
  if (displayedUsers.size === 0) {
    container.style.display = 'none';
    if (!searchInput.value) {
      clearSearchBtn.style.display = 'none';
    }
  }
}

function clearAllUserCards() {
  displayedUsers.clear();
  const container = document.getElementById('userCardsInline');
  if (container) {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

// Handle remove button clicks
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('user-card-remove')) {
    const username = e.target.dataset.username;
    if (username) {
      removeUserCard(username);
    }
  }
});

// Event Listeners
document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => handleViewModeChange(btn.dataset.view));
});

document.querySelectorAll('.game-selector-btn').forEach(btn => {
  btn.addEventListener('click', () => handleGameSelection(btn.dataset.game));
});

document.querySelectorAll('.period-tab').forEach(tab => {
  tab.addEventListener('click', () => handlePeriodChange(tab.dataset.period));
});

searchInput.addEventListener('input', (e) => {
  handleSearch(e.target.value);
  showAutocomplete(e.target.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (autocompleteVisible) {
    const items = document.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
      updateAutocompleteSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
      updateAutocompleteSelection(items);
    } else if (e.key === 'Enter' && selectedAutocompleteIndex >= 0) {
      e.preventDefault();
      const selectedItem = items[selectedAutocompleteIndex];
      if (selectedItem) {
        selectAutocompleteItem(selectedItem.dataset.username);
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Try to add a card if there's an exact match
      const query = searchInput.value.trim();
      if (query) {
        const match = allUsernames.find(u => u.toLowerCase() === query.toLowerCase());
        if (match) {
          addUserCard(match);
        }
      }
      hideAutocomplete();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      const match = allUsernames.find(u => u.toLowerCase() === query.toLowerCase());
      if (match) {
        addUserCard(match);
      }
    }
  }
});

searchInput.addEventListener('blur', () => {
  // Delay to allow click events on dropdown items
  setTimeout(hideAutocomplete, 150);
});

// Autocomplete dropdown click handling
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('autocomplete-item')) {
    selectAutocompleteItem(e.target.dataset.username);
  }
});

function updateAutocompleteSelection(items) {
  items.forEach((item, idx) => {
    item.classList.toggle('selected', idx === selectedAutocompleteIndex);
  });
}

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  handleSearch('');
  hideAutocomplete();
  clearAllUserCards();
});

// Game selector carousel arrow functionality
const gameSelector = document.querySelector('.game-selector');
const gameSelectorLeftArrow = document.querySelector('.game-selector-arrow.left');
const gameSelectorRightArrow = document.querySelector('.game-selector-arrow.right');

if (gameSelectorLeftArrow && gameSelectorRightArrow && gameSelector) {
  gameSelectorLeftArrow.addEventListener('click', () => {
    gameSelector.scrollBy({ left: -100, behavior: 'smooth' });
  });
  gameSelectorRightArrow.addEventListener('click', () => {
    gameSelector.scrollBy({ left: 100, behavior: 'smooth' });
  });
}

// Period tabs carousel arrow functionality
const periodTabs = document.querySelector('.period-tabs');
const periodTabsLeftArrow = document.querySelector('.period-tabs-arrow.left');
const periodTabsRightArrow = document.querySelector('.period-tabs-arrow.right');

if (periodTabsLeftArrow && periodTabsRightArrow && periodTabs) {
  periodTabsLeftArrow.addEventListener('click', () => {
    periodTabs.scrollBy({ left: -120, behavior: 'smooth' });
  });
  periodTabsRightArrow.addEventListener('click', () => {
    periodTabs.scrollBy({ left: 120, behavior: 'smooth' });
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ===== Twinkling Stars Background =====
function createStars() {
  const container = document.getElementById('stars');
  if (!container) return;

  // Clear existing stars
  container.innerHTML = '';

  // Generate stars based on screen size
  const count = Math.floor(window.innerWidth * window.innerHeight / 5000);

  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + 'vw';
    star.style.top = Math.random() * 100 + 'vh';
    star.style.setProperty('--delay', Math.random() * 4 + 's');
    star.style.setProperty('--duration', (2 + Math.random() * 3) + 's');

    // Vary star sizes
    const size = Math.random() < 0.3 ? 3 : Math.random() < 0.6 ? 2 : 1;
    star.style.width = size + 'px';
    star.style.height = size + 'px';

    container.appendChild(star);
  }
}

// Initialize stars
createStars();

// Regenerate stars on resize (debounced)
let starsResizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(starsResizeTimeout);
  starsResizeTimeout = setTimeout(createStars, 250);
});
