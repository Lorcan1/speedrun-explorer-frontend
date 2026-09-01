import { useState, useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import "./App.css";

const URL = 'http://127.0.0.1:8000/fen_next_move';
const START_FEN = new Chess().fen();

// Extracts the video ID from either "youtube.com/watch?v=ID" or
// "youtu.be/ID?t=123" style URLs, so we can build a thumbnail image URL
// without needing a YouTube API key.
function getYouTubeId(url) {
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
  const [fenCopied, setFenCopied] = useState(false);

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

  const currentFen = positions[currentIndex].fen;
  const isAtLatest = currentIndex === positions.length - 1;

  // Keep the move-history list scrolled to whatever move is active.
  // `block: "nearest"` is important here — it only scrolls the nearest
  // scrollable ancestor (the .move-history box itself) just enough to
  // bring the cell into view, rather than scrolling the whole page.
  useEffect(() => {
    currentMoveRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentIndex]);

  // --- Fetch backend suggestions for whatever position is currently displayed ---
  async function fetchNextMove(fen) {
    try {
      const response = await fetch(`${URL}?fen=${encodeURIComponent(fen)}`);
      const json = await response.json();
      setGameState(json);
    } catch (err) {
      console.error("Failed to fetch next move:", err);
    }
  }

  useEffect(() => {
    fetchNextMove(currentFen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen]);

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
  // Home/End jump to the start/latest position.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      } else if (e.key === "Home") {
        e.preventDefault();
        goToStart();
      } else if (e.key === "End") {
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
                </tr>
              </thead>
              <tbody>
                {!gameState?.next_moves || gameState.next_moves.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan="2">No games found</td>
                  </tr>
                ) : (
                  gameState.next_moves.map((row, index) => (
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
                                    />
                                  ) : (
                                    <div className="thumb-placeholder">&#9654;</div>
                                  )}
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
                              <td className="date-cell">{g.game_date}</td>
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
      </div>

      {/* Controls sit below the whole board+tables row, not just the board */}
      <div className="controls-bar">
        <div className="nav-controls">
          <button onClick={goToStart} disabled={currentIndex === 0} title="Start (Home)">
            |&lt;
          </button>
          <button onClick={goBack} disabled={currentIndex === 0} title="Back (\u2190)">
            &lt;
          </button>
          <button onClick={goForward} disabled={isAtLatest} title="Forward (\u2192)">
            &gt;
          </button>
          <button onClick={goToEnd} disabled={isAtLatest} title="End (End)">
            &gt;|
          </button>
        </div>

        <div className="fen-display">
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

        <button className="reset-button" onClick={resetGame}>
          New Game
        </button>
      </div>
    </div>
  );
}