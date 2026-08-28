import { useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

export default function App() {
  // 1. State for the board (your working setup)
  const [game, setGame] = useState(new Chess());
  
  // 2. NEW: Dedicated state for the move history
  const [history, setHistory] = useState([]);

  function onPieceDrop({ sourceSquare, targetSquare }) {
    try {
      const gameCopy = new Chess(game.fen());
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });

      if (move === null) return false;

      // Update the board state
      setGame(gameCopy);
      
      // NEW: Update the history state with the move's notation (e.g., "e4", "Nf3")
      setHistory(prev => [...prev, move.san]);

      return true;
    } catch {
      return false;
    }
  }

  // Format the history array into rows (White move, Black move)
  const moveRows = [];
  for (let i = 0; i < history.length; i += 2) {
    moveRows.push({
      number: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1] || "", 
    });
  }

  // Reset both the board and the history
  function resetGame() {
    setGame(new Chess());
    setHistory([]); 
  }

  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      justifyContent: "center", 
      alignItems: "center", 
      marginTop: "30px", 
      fontFamily: "sans-serif" 
    }}>
      
      {/* Your exact working Board */}
      <div style={{ width: "400px", height: "400px" }}>
        <Chessboard 
          options={{
            position: game.fen(),
            onPieceDrop: onPieceDrop,
          }} 
        />
      </div>

      {/* Move History Table */}
      <div style={{ 
        width: "400px", 
        marginTop: "20px", 
        maxHeight: "250px", 
        overflowY: "auto", 
        border: "1px solid #ccc", 
        borderRadius: "4px" 
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "center", fontSize: "14px" }}>
          <thead style={{ position: "sticky", top: 0, backgroundColor: "#f8f9fa" }}>
            <tr>
              <th style={{ padding: "8px", borderBottom: "2px solid #ddd" }}>#</th>
              <th style={{ padding: "8px", borderBottom: "2px solid #ddd" }}>White</th>
              <th style={{ padding: "8px", borderBottom: "2px solid #ddd" }}>Black</th>
            </tr>
          </thead>
          <tbody>
            {moveRows.length === 0 ? (
              <tr>
                <td colSpan="3" style={{ padding: "12px", color: "#888" }}>Game start</td>
              </tr>
            ) : (
              moveRows.map((row) => (
                <tr key={row.number} style={{ backgroundColor: row.number % 2 === 0 ? "#fcfcfc" : "#fff" }}>
                  <td style={{ padding: "6px", color: "#666" }}>{row.number}.</td>
                  <td style={{ padding: "6px", fontWeight: "bold" }}>{row.white}</td>
                  <td style={{ padding: "6px", fontWeight: "bold" }}>{row.black}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Reset Button */}
      <button 
        onClick={resetGame}
        style={{ 
          marginTop: "15px", 
          padding: "8px 16px", 
          cursor: "pointer", 
          borderRadius: "4px", 
          border: "1px solid #ccc", 
          backgroundColor: "#fff" 
        }}
      >
        New Game
      </button>
    </div>
  );
}