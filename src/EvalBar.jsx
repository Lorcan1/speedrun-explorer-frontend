import { useState, useEffect, useRef, useCallback } from "react";
import "./EvalBar.css";

// Depth presets
const DEPTH_MODES = {
  quick: { depth: 12, label: "Quick", description: "Fast analysis" },
  standard: { depth: 18, label: "Standard", description: "Balanced" },
  deep: { depth: 22, label: "Deep", description: "Thorough analysis" },
};

const DEBOUNCE_MS = 300;

// Parse UCI info line to extract evaluation
// isWhiteToMove: Stockfish reports from side-to-move perspective, we normalize to White's perspective
function parseUciInfo(line, isWhiteToMove) {
  const result = {
    depth: null,
    score: null,
    mate: null,
    pv: null,
    multipv: 1,
  };

  // Extract depth
  const depthMatch = line.match(/\bdepth (\d+)/);
  if (depthMatch) result.depth = parseInt(depthMatch[1], 10);

  // Extract multipv
  const multipvMatch = line.match(/\bmultipv (\d+)/);
  if (multipvMatch) result.multipv = parseInt(multipvMatch[1], 10);

  // Extract score (cp = centipawns, mate = mate in N)
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);

  // Flip factor: Stockfish reports from side-to-move perspective
  // We want White's perspective (positive = White winning)
  const flip = isWhiteToMove ? 1 : -1;

  if (cpMatch) {
    result.score = (parseInt(cpMatch[1], 10) / 100) * flip;
  } else if (mateMatch) {
    const mateIn = parseInt(mateMatch[1], 10) * flip;
    result.mate = mateIn;
    result.score = mateIn > 0 ? 100 : -100;
  }

  // Extract principal variation (best line)
  const pvMatch = line.match(/\bpv (.+)$/);
  if (pvMatch) result.pv = pvMatch[1].trim();

  return result;
}

// Convert score to bar percentage (0-100, where 50 is equal)
function scoreToPercent(score, mate) {
  if (mate !== null) {
    return mate > 0 ? 100 : 0;
  }
  if (score === null) return 50;

  // Sigmoid-like mapping: +-5 pawns maps to ~10-90%
  const clamped = Math.max(-10, Math.min(10, score));
  return 50 + (clamped / 10) * 50 * (1 - Math.abs(clamped) / 20);
}

// Format score for display
function formatScore(score, mate) {
  if (mate !== null) {
    return `M${Math.abs(mate)}`;
  }
  if (score === null) return "...";
  const sign = score > 0 ? "+" : "";
  return `${sign}${score.toFixed(1)}`;
}

export default function EvalBar({ fen, enabled, onToggle, darkMode }) {
  const [depthMode, setDepthMode] = useState(() => {
    return localStorage.getItem("eval-depth-mode") || "standard";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [evaluation, setEvaluation] = useState({
    score: null,
    mate: null,
    depth: 0,
    bestMove: null,
    isAnalyzing: false,
    error: null,
  });
  const [workerReady, setWorkerReady] = useState(false);

  const workerRef = useRef(null);
  const debounceRef = useRef(null);
  const settingsRef = useRef(null);
  const currentFenRef = useRef(fen); // Track current FEN for side-to-move detection
  const expectedAnalysisIdRef = useRef(0); // What analysis we're waiting for
  const activeAnalysisIdRef = useRef(0); // What analysis is currently running

  // Persist depth mode
  useEffect(() => {
    localStorage.setItem("eval-depth-mode", depthMode);
  }, [depthMode]);

  // Close settings dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    }
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSettings]);

  // Initialize worker when enabled
  useEffect(() => {
    if (!enabled) {
      // Cleanup when disabled
      if (workerRef.current) {
        workerRef.current.postMessage("quit");
        workerRef.current.terminate();
        workerRef.current = null;
        setWorkerReady(false);
      }
      setEvaluation({
        score: null,
        mate: null,
        depth: 0,
        bestMove: null,
        isAnalyzing: false,
        error: null,
      });
      return;
    }

    let worker = null;

    // Load Stockfish from local files (public/stockfish/)
    async function initWorker() {
      try {
        // Use local Stockfish 18 lite - standard chess, accurate evals
        worker = new Worker("/stockfish/stockfish-18-lite-single.js");

        worker.onmessage = (e) => {
          const message = typeof e.data === "string" ? e.data : e.data?.toString();
          if (!message) return;

          // Log engine version on startup
          if (message.startsWith("id name")) {
            console.log("Engine:", message);
          }

          // Handle UCI ready
          if (message === "uciok") {
            setWorkerReady(true);
            setEvaluation((prev) => ({ ...prev, error: null }));
            return;
          }

          // Ignore stale messages from previous analysis
          if (activeAnalysisIdRef.current !== expectedAnalysisIdRef.current) {
            return;
          }

          // Parse UCI info messages
          if (message.startsWith("info") && message.includes("score")) {
            // Determine side to move from FEN (2nd field is 'w' or 'b')
            const sideToMove = currentFenRef.current?.split(" ")[1];
            const isWhiteToMove = sideToMove === "w";
            const parsed = parseUciInfo(message, isWhiteToMove);
            if (parsed.depth !== null && parsed.multipv === 1) {
              setEvaluation((prev) => ({
                ...prev,
                score: parsed.score,
                mate: parsed.mate,
                depth: parsed.depth,
                bestMove: parsed.pv ? parsed.pv.split(" ")[0] : prev.bestMove,
                isAnalyzing: true,
              }));
            }
          } else if (message.startsWith("bestmove")) {
            const move = message.split(" ")[1];
            setEvaluation((prev) => ({
              ...prev,
              bestMove: move,
              isAnalyzing: false,
            }));
          }
        };

        worker.onerror = (e) => {
          setEvaluation((prev) => ({
            ...prev,
            error: e.message || "Failed to load Stockfish",
            isAnalyzing: false,
          }));
        };

        workerRef.current = worker;

        // Initialize UCI
        worker.postMessage("uci");
      } catch (error) {
        setEvaluation((prev) => ({
          ...prev,
          error: error.message || "Failed to load Stockfish",
          isAnalyzing: false,
        }));
      }
    }

    initWorker();

    return () => {
      if (worker) {
        worker.postMessage("quit");
        worker.terminate();
      }
    };
  }, [enabled]);

  // Analyze position with debounce
  const analyzePosition = useCallback(
    (fenToAnalyze) => {
      if (!workerRef.current || !workerReady) return;

      const { depth } = DEPTH_MODES[depthMode];

      setEvaluation((prev) => ({
        ...prev,
        isAnalyzing: true,
        depth: 0,
      }));

      // Mark this analysis as active - messages will only be processed if IDs match
      activeAnalysisIdRef.current = expectedAnalysisIdRef.current;

      // Send UCI commands directly
      workerRef.current.postMessage("stop");
      workerRef.current.postMessage("ucinewgame");
      workerRef.current.postMessage("setoption name MultiPV value 1");
      workerRef.current.postMessage(`position fen ${fenToAnalyze}`);
      workerRef.current.postMessage(`go depth ${depth}`);
    },
    [workerReady, depthMode]
  );

  // Debounced position change handler
  useEffect(() => {
    if (!enabled || !workerReady) return;

    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Stop current analysis and reset display
    if (workerRef.current) {
      workerRef.current.postMessage("stop");
    }

    // Increment expected ID - any messages with old activeId will be ignored
    expectedAnalysisIdRef.current += 1;

    // Update FEN ref synchronously before analysis starts
    currentFenRef.current = fen;

    // Keep previous score/bar position, just show we're recalculating
    setEvaluation((prev) => ({
      ...prev,
      depth: 0,
      isAnalyzing: true,
    }));

    // Debounce new analysis
    debounceRef.current = setTimeout(() => {
      analyzePosition(fen);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [fen, enabled, workerReady, analyzePosition]);

  // Determine who's winning based on evaluation
  const whitePercent = scoreToPercent(evaluation.score, evaluation.mate);
  const isWhiteWinning = whitePercent > 50;

  // Show "..." when recalculating (depth 0), but keep bar at previous position
  const isRecalculating = evaluation.isAnalyzing && evaluation.depth === 0;
  const displayScore = isRecalculating
    ? "..."
    : formatScore(evaluation.score, evaluation.mate);

  return (
    <div className={`eval-container${darkMode ? " dark" : ""}`}>
      {/* Toggle and settings row */}
      <div className="eval-header">
        <label className="eval-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="eval-toggle-label">Eval</span>
        </label>

        {enabled && (
          <div className="eval-settings-wrapper" ref={settingsRef}>
            <button
              className="eval-settings-btn"
              onClick={() => setShowSettings((s) => !s)}
              title="Analysis settings"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </button>

            {showSettings && (
              <div className="eval-settings-dropdown">
                <div className="eval-settings-title">Analysis Depth</div>
                {Object.entries(DEPTH_MODES).map(([key, { label, description }]) => (
                  <button
                    key={key}
                    className={`eval-settings-option${depthMode === key ? " active" : ""}`}
                    onClick={() => {
                      setDepthMode(key);
                      setShowSettings(false);
                      // Re-analyze with new depth
                      if (workerReady) {
                        analyzePosition(fen);
                      }
                    }}
                  >
                    <span className="option-label">{label}</span>
                    <span className="option-desc">{description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Eval bar visualization */}
      {enabled && (
        <div className="eval-bar-wrapper">
          {evaluation.error ? (
            <div className="eval-error" title={evaluation.error}>
              Error loading engine
            </div>
          ) : !workerReady ? (
            <div className="eval-loading">Loading Stockfish...</div>
          ) : (
            <>
              <div className="eval-bar">
                <div
                  className="eval-bar-white"
                  style={{ height: `${whitePercent}%` }}
                />
                <div
                  className="eval-bar-black"
                  style={{ height: `${100 - whitePercent}%` }}
                />
              </div>
              <div className={`eval-score${isWhiteWinning ? " white" : " black"}`}>
                {displayScore}
              </div>
              <div className="eval-depth">
                d{evaluation.depth}
                {evaluation.isAnalyzing && <span className="eval-analyzing">...</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
