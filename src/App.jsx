import { useState } from "react";
import { useEffect } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import "./App.css";

const URL = 'http://127.0.0.1:8000/fen_next_move';

export default function App() {

  const [gameState, setGameState] = useState(null);
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState([]);

  async function fetchNextMove(fen){
    try{
      const response = await fetch(`${URL}?fen=${encodeURIComponent(fen)}`);
      const json = await response.json();
      setGameState(json);
      console.log(json);
    } catch (err){
      console.error("Failed to fetch next move:", err)
    }
  }

  useEffect(() => {
    fetchNextMove(game.fen());
  }, [])

  function onPieceDrop({ sourceSquare, targetSquare }) {
    try {
      const gameCopy = new Chess(game.fen());
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });

      if (move === null) return false;

      setGame(gameCopy);

      setHistory(prev => [...prev, move.san]);

      fetchNextMove(gameCopy.fen());

      return true;
    } catch {
      return false;
    }
  }

  const moveRows = [];
  for (let i = 0; i < history.length; i += 2) {
    moveRows.push({
      number: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1] || "",
    });
  }

  function resetGame() {
    setGame(new Chess());
    setHistory([]);
  }

  return (
    <div className="app-container">
      <div className="main-row">

        {/* Your exact working Board */}
        <div className="board-wrapper">
          <Chessboard
            options={{
              position: game.fen(),
              onPieceDrop: onPieceDrop,
            }}
          />
        </div>

        {/* Tables stacked to the right of the board */}
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
                      <td className="move-san">{row.white}</td>
                      <td className="move-san">{row.black}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Next Moves Table */}
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
                      className={index % 2 === 0 ? "even-row" : "odd-row"}
                    >
                      <td className="move-san">{row.san}</td>
                      <td className="move-count">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>
      </div>

      {/* Reset Button */}
      <button className="reset-button" onClick={resetGame}>
        New Game
      </button>
    </div>
  );
}