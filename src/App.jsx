import { useState, useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import "./App.css";

const API_URL = 'http://127.0.0.1:8000/fen_next_move';
const GAMES_API_URL = 'http://127.0.0.1:8000/fen_games';
const FILTER_OPTIONS_API_URL = 'http://127.0.0.1:8000/filter_options';
const START_FEN = new Chess().fen();

// Extracts the video ID from either "youtube.com/watch?v=ID" or
// "youtu.be/ID?t=123" style URLs, so we can build a thumbnail image URL
// without needing a YouTube API key.
function getYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const match = u.pathname.match(/\/(embed|v)\/([^/]+)/);
    return match ? match[2] : null;
  } catch {
    return null;
  }
}

export default function App() {
  // --- Core state ---
  // `positions` is the full timeline of the game: one entry per position,
  // starting with the initial position (san: null) and one entry per move after.
  // `currentIndex` is a pointer into that array — "which position am I viewing".
  // The board is always rendered from positions[currentIndex], NOT from a
  // separately-tracked "current game" object. This is what makes scrolling
  // back through moves possible without losing the rest of the game.
  const [positions, setPositions] = useState([{ fen: START_FEN, san: null }]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [gameState, setGameState] = useState(null);
  const [gamesAtPosition, setGamesAtPosition] = useState({ games: [], total_games: 0 });
  const [fenCopied, setFenCopied] = useState(false);
  const [boardOrientation, setBoardOrientation] = useState("white");

  // --- Pagination state ---
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);

  // --- Sorting state ---
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");

  // --- Filter state ---
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState([]);
  const [selectedSpeedrunners, setSelectedSpeedrunners] = useState([]);
  const [videoSearch, setVideoSearch] = useState("");
  const [seriesSearch, setSeriesSearch] = useState("");
  const [speedrunnerSearch, setSpeedrunnerSearch] = useState("");
  // Rating filters
  const [speedrunnerRatingMin, setSpeedrunnerRatingMin] = useState("");
  const [speedrunnerRatingMax, setSpeedrunnerRatingMax] = useState("");
  const [opponentRatingMin, setOpponentRatingMin] = useState("");
  const [opponentRatingMax, setOpponentRatingMax] = useState("");
  // Color filter: "all", "white", or "black"
  const [selectedColor, setSelectedColor] = useState("all");
  // Result filter: array of selected results (game outcome: 1-0, 0-1, 1/2-1/2)
  const [selectedResults, setSelectedResults] = useState([]);
  // Speedrunner result filter: array of w, l, d
  const [selectedSpeedrunnerResults, setSelectedSpeedrunnerResults] = useState([]);
  // Date range filter
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filterPanelRef = useRef(null);
  // Suggestions from API
  const [videoSuggestions, setVideoSuggestions] = useState([]);
  const [seriesSuggestions, setSeriesSuggestions] = useState([]);
  const [speedrunnerSuggestions, setSpeedrunnerSuggestions] = useState([]);

  // Dark mode, persisted across visits.
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("chess-app-theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    localStorage.setItem("chess-app-theme", darkMode ? "dark" : "light");
    // Toggle on <html> too, not just the container — this is what lets us
    // theme the page background outside .app-container (body margins,
    // areas the container doesn't cover, etc.) rather than just the box.
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // Ref to whichever move cell is currently active, so we can scroll it
  // into view when the pointer moves — see the effect below.
  const currentMoveRef = useRef(null);

  // Close filter panel when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    }
    if (filterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [filterOpen]);

  const currentFen = positions[currentIndex].fen;
  const isAtLatest = currentIndex === positions.length - 1;

  // Keep the move-history list scrolled to whatever move is active.
  // `block: "nearest"` is important here — it only scrolls the nearest
  // scrollable ancestor (the .move-history box itself) just enough to
  // bring the cell into view, rather than scrolling the whole page.
  useEffect(() => {
    currentMoveRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentIndex]);

  // --- Build filter query params ---
  function buildFilterParams() {
    const params = new URLSearchParams();

    // Multi-select fields: append each value (backend accepts lists)
    selectedVideos.forEach(v => params.append("video_titles", v));
    selectedSeries.forEach(s => params.append("series_names", s));
    selectedSpeedrunners.forEach(s => params.append("speedrunner_names", s));
    selectedResults.forEach(r => params.append("result", r));
    selectedSpeedrunnerResults.forEach(r => params.append("speedrunner_result", r));

    console.log("buildFilterParams:", params.toString());

    // Rating ranges
    if (speedrunnerRatingMin) params.set("min_elo_speedrunner", speedrunnerRatingMin);
    if (speedrunnerRatingMax) params.set("max_elo_speedrunner", speedrunnerRatingMax);
    if (opponentRatingMin) params.set("min_elo_opponent", opponentRatingMin);
    if (opponentRatingMax) params.set("max_elo_opponent", opponentRatingMax);

    // Color filter
    if (selectedColor !== "all") params.set("speedrun_player_colour_filter", selectedColor);

    // Date range
    if (dateFrom) params.set("min_game_date", dateFrom);
    if (dateTo) params.set("max_game_date", dateTo);

    return params;
  }

  // --- Fetch backend suggestions for whatever position is currently displayed ---
  async function fetchNextMove(fen) {
    try {
      const params = buildFilterParams();
      params.set("fen", fen);
      const response = await fetch(`${API_URL}?${params.toString()}`);
      const json = await response.json();
      setGameState(json);
    } catch (err) {
      console.error("Failed to fetch next move:", err);
    }
  }

  useEffect(() => {
    fetchNextMove(currentFen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // --- Fetch games at the current position (debounced) ---
  async function fetchGamesAtPosition(fen, page = 1, limit = 25, sort = "") {
    try {
      const params = buildFilterParams();
      params.set("fen", fen);
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      if (sort) params.set("sort", sort);
      const response = await fetch(`${GAMES_API_URL}?${params.toString()}`);
      const json = await response.json();
      setGamesAtPosition(json);
    } catch (err) {
      console.error("Failed to fetch games at position:", err);
    }
  }

  // Reset to page 1 when filters or position change
  useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // Fetch games when page, filters, sort, or position change
  useEffect(() => {
    console.log("Fetching games - page:", currentPage, "sort:", sortColumn, sortDirection);
    const sortParam = sortColumn ? (sortDirection === "desc" ? `-${sortColumn}` : sortColumn) : "";
    const timer = setTimeout(() => {
      fetchGamesAtPosition(currentFen, currentPage, itemsPerPage, sortParam);
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen, currentPage, itemsPerPage, sortColumn, sortDirection, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // --- Fetch filter options (autocomplete suggestions) ---
  async function fetchFilterOptions(colType, search, setSuggestions) {
    if (!search.trim()) {
      setSuggestions([]);
      return;
    }
    try {
      const params = buildFilterParams();
      params.set("col_type", colType);
      params.set("search", search);
      params.set("limit", "10");
      const response = await fetch(`${FILTER_OPTIONS_API_URL}?${params.toString()}`);
      const json = await response.json();
      setSuggestions(json.options || json || []);
    } catch (err) {
      console.error(`Failed to fetch filter options for ${colType}:`, err);
      setSuggestions([]);
    }
  }

  // Debounced fetch for video suggestions
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFilterOptions("video_title", videoSearch, setVideoSuggestions);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSearch, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // Debounced fetch for series suggestions
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFilterOptions("series", seriesSearch, setSeriesSuggestions);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesSearch, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // Debounced fetch for speedrunner suggestions
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFilterOptions("speedrunner", speedrunnerSearch, setSpeedrunnerSuggestions);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedrunnerSearch, selectedVideos, selectedSeries, selectedSpeedrunners, selectedResults, selectedSpeedrunnerResults,
      speedrunnerRatingMin, speedrunnerRatingMax, opponentRatingMin, opponentRatingMax,
      selectedColor, dateFrom, dateTo]);

  // --- Making a move ---
  // Shared by both drag-and-drop (onPieceDrop) and clicking a suggested
  // move in the "next moves" table — chess.js's .move() accepts either
  // a {from, to, promotion} object or a plain SAN string, so one function
  // handles both input shapes.
  function applyMove(moveInput) {
    try {
      const gameCopy = new Chess(currentFen);
      const move = gameCopy.move(moveInput);

      if (move === null) return false;

      const newPosition = { fen: gameCopy.fen(), san: move.san };

      // If we're reviewing an earlier position and make a move, this
      // discards whatever came after currentIndex and starts a new line
      // from here — i.e. moving while scrolled back = "try a different
      // line", which also doubles as move deletion for anything after
      // the point you moved from.
      setPositions(prev => [...prev.slice(0, currentIndex + 1), newPosition]);
      setCurrentIndex(currentIndex + 1);

      return true;
    } catch {
      return false;
    }
  }

  function onPieceDrop({ sourceSquare, targetSquare }) {
    return applyMove({ from: sourceSquare, to: targetSquare, promotion: "q" });
  }

  // --- Navigation ---
  function goToStart() {
    setCurrentIndex(0);
  }
  function goBack() {
    setCurrentIndex(i => Math.max(0, i - 1));
  }
  function goForward() {
    setCurrentIndex(i => Math.min(positions.length - 1, i + 1));
  }
  function goToEnd() {
    setCurrentIndex(positions.length - 1);
  }
  function goToIndex(index) {
    setCurrentIndex(index);
  }

  // Keyboard support: left/right arrows step one move at a time,
  // up/down and Home/End jump to the start/latest position.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      } else if (e.key === "ArrowDown" || e.key === "Home") {
        e.preventDefault();
        goToStart();
      } else if (e.key === "ArrowUp" || e.key === "End") {
        e.preventDefault();
        goToEnd();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);

  // --- Deleting a move ---
  // Removes the move at `index` (a positions-array index, NOT a display
  // move-number) and everything that came after it, since a later move
  // can't exist without the one before it.
  function deleteMoveAt(index) {
    setPositions(prev => prev.slice(0, index));
    setCurrentIndex(prevIndex => Math.min(prevIndex, index - 1));
  }

  function resetGame() {
    setPositions([{ fen: START_FEN, san: null }]);
    setCurrentIndex(0);
  }

  // Copies the currently displayed FEN to the clipboard and briefly
  // shows a "Copied!" confirmation on the button.
  function copyFen() {
    navigator.clipboard
      .writeText(currentFen)
      .then(() => {
        setFenCopied(true);
        setTimeout(() => setFenCopied(false), 1500);
      })
      .catch((err) => console.error("Failed to copy FEN:", err));
  }

  // --- Filter logic ---
  // Backend handles filtering, so filteredGames = allGames
  const allGames = gamesAtPosition.games || [];
  const filteredGames = allGames;

  // Filter out already-selected items from suggestions
  const filteredVideoSuggestions = videoSuggestions.filter(v => !selectedVideos.includes(v));
  const filteredSeriesSuggestions = seriesSuggestions.filter(s => !selectedSeries.includes(s));
  const filteredSpeedrunnerSuggestions = speedrunnerSuggestions.filter(s => !selectedSpeedrunners.includes(s));

  const hasActiveFilters = selectedVideos.length > 0 || selectedSeries.length > 0 || selectedSpeedrunners.length > 0 ||
    speedrunnerRatingMin || speedrunnerRatingMax || opponentRatingMin || opponentRatingMax ||
    selectedColor !== "all" || selectedResults.length > 0 || selectedSpeedrunnerResults.length > 0 || dateFrom || dateTo;

  const activeFilterCount = selectedVideos.length + selectedSeries.length + selectedSpeedrunners.length +
    (speedrunnerRatingMin || speedrunnerRatingMax ? 1 : 0) +
    (opponentRatingMin || opponentRatingMax ? 1 : 0) +
    (selectedColor !== "all" ? 1 : 0) +
    selectedResults.length +
    selectedSpeedrunnerResults.length +
    (dateFrom || dateTo ? 1 : 0);

  function clearAllFilters() {
    setSelectedVideos([]);
    setSelectedSeries([]);
    setSelectedSpeedrunners([]);
    setVideoSearch("");
    setSeriesSearch("");
    setSpeedrunnerSearch("");
    setSpeedrunnerRatingMin("");
    setSpeedrunnerRatingMax("");
    setOpponentRatingMin("");
    setOpponentRatingMax("");
    setSelectedColor("all");
    setSelectedResults([]);
    setSelectedSpeedrunnerResults([]);
    setDateFrom("");
    setDateTo("");
  }

  function toggleResult(result) {
    setSelectedResults(arr =>
      arr.includes(result) ? arr.filter(r => r !== result) : [...arr, result]
    );
  }

  function toggleSpeedrunnerResult(result) {
    setSelectedSpeedrunnerResults(arr =>
      arr.includes(result) ? arr.filter(r => r !== result) : [...arr, result]
    );
  }

  function handleSort(column) {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(d => d === "asc" ? "desc" : "asc");
    } else {
      // New column, start with ascending
      setSortColumn(column);
      setSortDirection("asc");
    }
    setCurrentPage(1); // Reset to first page when sorting
  }

  function getSortIndicator(column) {
    if (sortColumn !== column) return null;
    return sortDirection === "asc" ? " ▲" : " ▼";
  }

  // --- Pagination logic ---
  const totalCount = gamesAtPosition.total_games || 0;
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  function getPageNumbers() {
    const pages = [];
    const windowSize = 2; // pages on each side of current

    // Always show page 1
    pages.push(1);

    // Calculate window around current page
    const windowStart = Math.max(2, currentPage - windowSize);
    const windowEnd = Math.min(totalPages - 1, currentPage + windowSize);

    // Add ellipsis after page 1 if needed
    if (windowStart > 2) {
      pages.push("...");
    }

    // Add pages in window
    for (let i = windowStart; i <= windowEnd; i++) {
      pages.push(i);
    }

    // Add ellipsis before last page if needed
    if (windowEnd < totalPages - 1) {
      pages.push("...");
    }

    // Always show last page (if more than 1 page)
    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  }

  // --- Build move-pair rows for the table from positions (skipping the
  // starting position at index 0, which has no move) ---
  const moves = positions.slice(1); // each has { fen, san }
  const moveRows = [];
  for (let i = 0; i < moves.length; i += 2) {
    moveRows.push({
      number: Math.floor(i / 2) + 1,
      white: moves[i],
      whiteIndex: i + 1, // index into `positions`
      black: moves[i + 1] || null,
      blackIndex: i + 2,
    });
  }

  return (
    <div className={"app-container" + (darkMode ? " dark" : "")}>
      <button
        className="theme-toggle"
        onClick={() => setDarkMode(d => !d)}
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      >
        {darkMode ? "\u2600\ufe0f" : "\ud83c\udf19"}
      </button>

      <div className="main-row">

        <div className="board-wrapper">
          <Chessboard
            options={{
              position: currentFen,
              onPieceDrop: onPieceDrop,
              boardOrientation: boardOrientation,
            }}
          />
        </div>

        <div className="side-panel">

          {/* Move History Table */}
          <div className="move-history">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>White</th>
                  <th>Black</th>
                </tr>
              </thead>
              <tbody>
                {moveRows.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan="3">Game start</td>
                  </tr>
                ) : (
                  moveRows.map((row) => (
                    <tr
                      key={row.number}
                      className={row.number % 2 === 0 ? "even-row" : "odd-row"}
                    >
                      <td className="move-number">{row.number}.</td>
                      <td
                        ref={currentIndex === row.whiteIndex ? currentMoveRef : null}
                        className={
                          "move-san clickable" +
                          (currentIndex === row.whiteIndex ? " current-move" : "")
                        }
                        onClick={() => goToIndex(row.whiteIndex)}
                      >
                        {row.white.san}
                        <span
                          className="delete-move"
                          title="Delete from here"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMoveAt(row.whiteIndex);
                          }}
                        >
                          &times;
                        </span>
                      </td>
                      <td
                        ref={currentIndex === row.blackIndex ? currentMoveRef : null}
                        className={
                          "move-san" +
                          (row.black ? " clickable" : "") +
                          (currentIndex === row.blackIndex ? " current-move" : "")
                        }
                        onClick={() => row.black && goToIndex(row.blackIndex)}
                      >
                        {row.black && (
                          <>
                            {row.black.san}
                            <span
                              className="delete-move"
                              title="Delete from here"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteMoveAt(row.blackIndex);
                              }}
                            >
                              &times;
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Next Moves Table (backend suggestions for the CURRENT position) */}
          <div className="game-history">
            <table>
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Games</th>
                  <th className="watch-col"></th>
                </tr>
              </thead>
              <tbody>
                {!gameState?.next_moves || gameState.next_moves.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan="3">No games found</td>
                  </tr>
                ) : (
                  [...gameState.next_moves]
                    .sort((a, b) => b.count - a.count)
                    .map((row, index) => (
                    <tr
                      key={row.san}
                      className={
                        (index % 2 === 0 ? "even-row" : "odd-row") + " clickable"
                      }
                      onClick={() => applyMove(row.san)}
                      title={`Play ${row.san}`}
                    >
                      <td className="move-san">{row.san}</td>
                      <td className="move-count">{row.count}</td>
                      <td className="watch-cell">
                        {row.count === 1 && row.games?.[0]?.youtube_url && (
                          <span
                            className="watch-btn"
                            title="Watch on YouTube"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(row.games[0].youtube_url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            &#9654;
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Game Endings — shown when games actually finished at this
                position. Each termination type (checkmate, resignation,
                etc.) is its own bucket; under it, every individual game
                that ended that way is listed and links out to its
                YouTube VOD. */}
            {gameState?.game_endings?.length > 0 && (
              <div className="endings-section">
                {gameState.game_endings.map((bucket) => (
                  <div key={bucket.termination} className="ending-bucket">
                    <div className="ending-header">
                      <span>{bucket.termination}</span>
                      <span className="ending-count">{bucket.count}</span>
                    </div>
                    <table className="games-table">
                      <colgroup>
                        <col className="col-thumb" />
                        <col className="col-players" />
                        <col className="col-elo" />
                        <col className="col-result" />
                        <col className="col-date" />
                      </colgroup>
                      <tbody>
                        {bucket.games.map((g, i) => {
                          const whiteName =
                            g.speedrun_player_colour === "white" ? "Speedrunner" : g.opponent;
                          const blackName =
                            g.speedrun_player_colour === "white" ? g.opponent : "Speedrunner";
                          const videoId = getYouTubeId(g.youtube_url);
                          return (
                            <tr
                              key={i}
                              className="game-row"
                              onClick={() => window.open(g.youtube_url, "_blank", "noopener,noreferrer")}
                              title="Watch on YouTube"
                            >
                              <td className="thumb-cell">
                                <div className="thumb-wrapper">
                                  {videoId ? (
                                    <img
                                      className="thumb-img"
                                      src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                                      alt={`${whiteName} vs ${blackName} thumbnail`}
                                      loading="lazy"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling?.style && (e.target.nextSibling.style.display = 'flex');
                                      }}
                                    />
                                  ) : null}
                                  <div className="thumb-placeholder" style={videoId ? {display: 'none'} : {}}>&#9654;</div>
                                  {g.chesscom_url && (
                                    <span
                                      className="chesscom-badge"
                                      title="View this game on Chess.com"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(g.chesscom_url, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      &#9823;
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="players-cell">
                                <div className="cell-stack">
                                  <div className="player-name">{whiteName}</div>
                                  <div className="player-name">{blackName}</div>
                                </div>
                              </td>
                              <td className="elo-cell">
                                <div className="cell-stack cell-stack-right">
                                  <div>{g.white_elo}</div>
                                  <div>{g.black_elo}</div>
                                </div>
                              </td>
                              <td className="result-cell">{g.result}</td>
                              <td className="date-cell">{g.game_date}
                                
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Navigation controls - vertical strip */}
        <div className="nav-controls-vertical">
          <button onClick={goToStart} disabled={currentIndex === 0} title="First move (Down)">
            ⏮
          </button>
          <button onClick={goBack} disabled={currentIndex === 0} title="Previous (←)">
            ◀
          </button>
          <button onClick={goForward} disabled={isAtLatest} title="Next (→)">
            ▶
          </button>
          <button onClick={goToEnd} disabled={isAtLatest} title="Last move (Up)">
            ⏭
          </button>
          <button className="reset-btn" onClick={resetGame} disabled={positions.length === 1} title="New Game">
            ↺
          </button>
          <button onClick={() => setBoardOrientation(o => o === "white" ? "black" : "white")} title="Flip Board">
            ⇅
          </button>
        </div>
      </div>

      {/* Games at Position Table */}
      <div className="games-at-position" ref={filterPanelRef}>
        {/* Filter Panel - positioned to the left, bottom touching table */}
        {filterOpen && (
          <div className="filter-panel">
            <div className="filter-section">
              <label className="filter-label">Video</label>
              <div className="filter-chips">
                {selectedVideos.map(v => (
                  <span key={v} className="filter-chip">
                    <span className="filter-chip-text">{v}</span>
                    <button onClick={() => setSelectedVideos(arr => arr.filter(x => x !== v))}>&times;</button>
                  </span>
                ))}
              </div>
              <div className="filter-search-wrapper">
                <input
                  type="text"
                  className="filter-search"
                  placeholder="Search videos..."
                  value={videoSearch}
                  onChange={e => setVideoSearch(e.target.value)}
                />
                {videoSearch && (
                  <button className="filter-search-clear" onClick={() => setVideoSearch("")}>&times;</button>
                )}
              </div>
              {videoSearch && filteredVideoSuggestions.length > 0 && (
                <ul className="filter-suggestions">
                  {filteredVideoSuggestions.slice(0, 10).map(v => (
                    <li key={v} title={v} onClick={() => { setSelectedVideos(arr => [...arr, v]); setVideoSearch(""); }}>
                      {v}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="filter-section">
              <label className="filter-label">Series</label>
              <div className="filter-chips">
                {selectedSeries.map(s => (
                  <span key={s} className="filter-chip">
                    <span className="filter-chip-text">{s}</span>
                    <button onClick={() => setSelectedSeries(arr => arr.filter(x => x !== s))}>&times;</button>
                  </span>
                ))}
              </div>
              <div className="filter-search-wrapper">
                <input
                  type="text"
                  className="filter-search"
                  placeholder="Search series..."
                  value={seriesSearch}
                  onChange={e => setSeriesSearch(e.target.value)}
                />
                {seriesSearch && (
                  <button className="filter-search-clear" onClick={() => setSeriesSearch("")}>&times;</button>
                )}
              </div>
              {seriesSearch && filteredSeriesSuggestions.length > 0 && (
                <ul className="filter-suggestions">
                  {filteredSeriesSuggestions.slice(0, 10).map(s => (
                    <li key={s} title={s} onClick={() => { setSelectedSeries(arr => [...arr, s]); setSeriesSearch(""); }}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="filter-section">
              <label className="filter-label">Speedrunner</label>
              <div className="filter-chips">
                {selectedSpeedrunners.map(s => (
                  <span key={s} className="filter-chip">
                    <span className="filter-chip-text">{s}</span>
                    <button onClick={() => setSelectedSpeedrunners(arr => arr.filter(x => x !== s))}>&times;</button>
                  </span>
                ))}
              </div>
              <div className="filter-search-wrapper">
                <input
                  type="text"
                  className="filter-search"
                  placeholder="Search speedrunners..."
                  value={speedrunnerSearch}
                  onChange={e => setSpeedrunnerSearch(e.target.value)}
                />
                {speedrunnerSearch && (
                  <button className="filter-search-clear" onClick={() => setSpeedrunnerSearch("")}>&times;</button>
                )}
              </div>
              {speedrunnerSearch && filteredSpeedrunnerSuggestions.length > 0 && (
                <ul className="filter-suggestions">
                  {filteredSpeedrunnerSuggestions.slice(0, 10).map(s => (
                    <li key={s} title={s} onClick={() => { setSelectedSpeedrunners(arr => [...arr, s]); setSpeedrunnerSearch(""); }}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="filter-section">
              <label className="filter-label">Speedrunner Rating</label>
              <div className="filter-range">
                <input
                  type="number"
                  className="filter-range-input"
                  placeholder="Min"
                  min="0"
                  max="4000"
                  value={speedrunnerRatingMin}
                  onChange={e => setSpeedrunnerRatingMin(e.target.value.replace(/\D/g, ""))}
                />
                <span className="filter-range-sep">-</span>
                <input
                  type="number"
                  className="filter-range-input"
                  placeholder="Max"
                  min="0"
                  max="4000"
                  value={speedrunnerRatingMax}
                  onChange={e => setSpeedrunnerRatingMax(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>

            <div className="filter-section">
              <label className="filter-label">Opponent Rating</label>
              <div className="filter-range">
                <input
                  type="number"
                  className="filter-range-input"
                  placeholder="Min"
                  min="0"
                  max="4000"
                  value={opponentRatingMin}
                  onChange={e => setOpponentRatingMin(e.target.value.replace(/\D/g, ""))}
                />
                <span className="filter-range-sep">-</span>
                <input
                  type="number"
                  className="filter-range-input"
                  placeholder="Max"
                  min="0"
                  max="4000"
                  value={opponentRatingMax}
                  onChange={e => setOpponentRatingMax(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>

            <div className="filter-section">
              <label className="filter-label">Speedrunner Colour</label>
              <div className="filter-toggle-group">
                <button
                  className={"filter-toggle" + (selectedColor === "all" ? " active" : "")}
                  onClick={() => setSelectedColor("all")}
                >
                  All
                </button>
                <button
                  className={"filter-toggle" + (selectedColor === "white" ? " active" : "")}
                  onClick={() => setSelectedColor("white")}
                >
                  White
                </button>
                <button
                  className={"filter-toggle" + (selectedColor === "black" ? " active" : "")}
                  onClick={() => setSelectedColor("black")}
                >
                  Black
                </button>
              </div>
            </div>

            <div className="filter-section">
              <label className="filter-label">Game Result</label>
              <div className="filter-toggle-group">
                <button
                  className={"filter-toggle" + (selectedResults.includes("1-0") ? " active" : "")}
                  onClick={() => toggleResult("1-0")}
                >
                  1-0
                </button>
                <button
                  className={"filter-toggle" + (selectedResults.includes("0-1") ? " active" : "")}
                  onClick={() => toggleResult("0-1")}
                >
                  0-1
                </button>
                <button
                  className={"filter-toggle" + (selectedResults.includes("1/2-1/2") ? " active" : "")}
                  onClick={() => toggleResult("1/2-1/2")}
                >
                  Draw
                </button>
              </div>
            </div>

            <div className="filter-section">
              <label className="filter-label">Speedrunner Result</label>
              <div className="filter-toggle-group">
                <button
                  className={"filter-toggle" + (selectedSpeedrunnerResults.includes("win") ? " active" : "")}
                  onClick={() => toggleSpeedrunnerResult("win")}
                >
                  Win
                </button>
                <button
                  className={"filter-toggle" + (selectedSpeedrunnerResults.includes("loss") ? " active" : "")}
                  onClick={() => toggleSpeedrunnerResult("loss")}
                >
                  Loss
                </button>
                <button
                  className={"filter-toggle" + (selectedSpeedrunnerResults.includes("draw") ? " active" : "")}
                  onClick={() => toggleSpeedrunnerResult("draw")}
                >
                  Draw
                </button>
              </div>
            </div>

            <div className="filter-section">
              <label className="filter-label">Date</label>
              <div className="filter-range">
                <input
                  type="date"
                  className="filter-date-input"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                />
                <span className="filter-range-sep">-</span>
                <input
                  type="date"
                  className="filter-date-input"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {hasActiveFilters && (
              <button className="filter-clear-all" onClick={clearAllFilters}>
                Clear all filters
              </button>
            )}
          </div>
        )}

        <div className="games-at-position-table-wrapper">
          <table className="games-at-position-table">
            <thead>
              <tr>
                <th className="gap-col-thumb">
                  <button
                    className={"filter-btn" + (hasActiveFilters ? " active" : "")}
                    title="Filter games"
                    onClick={() => setFilterOpen(o => !o)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                    {hasActiveFilters && (
                      <span className="filter-badge">{activeFilterCount}</span>
                    )}
                  </button>
                </th>
                <th className="gap-col-video sortable" onClick={() => handleSort("video_title")}>
                  Video{getSortIndicator("video_title")}
                </th>
                <th className="gap-col-series sortable" onClick={() => handleSort("series")}>
                  Series{getSortIndicator("series")}
                </th>
                <th className="gap-col-speedrunner sortable" onClick={() => handleSort("speedrunner")}>
                  Speedrunner{getSortIndicator("speedrunner")}
                </th>
                <th className="gap-col-rating sortable" onClick={() => handleSort("speedrunner_elo")}>
                  Rating{getSortIndicator("speedrunner_elo")}
                </th>
                <th className="gap-col-color">Color</th>
                <th className="gap-col-result">Result</th>
                <th className="gap-col-date sortable" onClick={() => handleSort("game_date")}>
                  Date{getSortIndicator("game_date")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredGames.map((game, index) => {
                const videoId = getYouTubeId(game.youtube_url);
                return (
                  <tr
                    key={game.id}
                    className={(index % 2 === 0 ? "even-row" : "odd-row") + " game-row"}
                    onClick={() => window.open(game.youtube_url, "_blank", "noopener,noreferrer")}
                    title="Watch on YouTube"
                  >
                    <td className="gap-thumb-cell">
                      <div className="thumb-wrapper">
                        {videoId ? (
                          <img
                            className="thumb-img"
                            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                            alt={game.video_title}
                            loading="lazy"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling?.style && (e.target.nextSibling.style.display = 'flex');
                            }}
                          />
                        ) : null}
                        <div className="thumb-placeholder" style={videoId ? {display: 'none'} : {}}>&#9654;</div>
                        {game.chesscom_url && (
                          <span
                            className="chesscom-badge"
                            title="View on Chess.com"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(game.chesscom_url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            &#9823;
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="gap-video-cell">{game.video_title}</td>
                    <td className="gap-series-cell">{game.series}</td>
                    <td className="gap-speedrunner-cell">{game.speedrunner}</td>
                    <td className="gap-rating-cell">
                      {game.speedrunner_elo} vs {game.opponent_elo}
                    </td>
                    <td className="gap-color-cell">
                      <span className={`color-icon ${game.speedrunner_colour}`}>
                        {game.speedrunner_colour === "white" ? "♔" : "♚"}
                      </span>
                    </td>
                    <td className="gap-result-cell">{game.result}</td>
                    <td className="gap-date-cell">{game.game_date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              title="First page"
            >
              «
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              title="Previous page"
            >
              ‹
            </button>

            {getPageNumbers().map((page, idx) =>
              page === "..." ? (
                <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
              ) : (
                <button
                  key={page}
                  className={`pagination-btn${currentPage === page ? " active" : ""}`}
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              )
            )}

            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              title="Next page"
            >
              ›
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              title="Last page"
            >
              »
            </button>

            <span className="pagination-info">
              {totalCount} games
            </span>
          </div>
        )}
      </div>

      {/* Controls sit below the whole board+tables row */}
      <div className="controls-bar">
1        <div className="fen-display">
          <input
            type="text"
            className="fen-input"
            value={currentFen}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button className="fen-copy-button" onClick={copyFen}>
            {fenCopied ? "Copied!" : "Copy FEN"}
          </button>
        </div>
      </div>
    </div>
  );
}