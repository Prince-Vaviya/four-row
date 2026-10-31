import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { ArrowLeft, ArrowUpRight, Check, CircleHelp, Copy, Crown, Link2, LoaderCircle, RotateCcw, Sparkles, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import './style.css';

const socket = io({ autoConnect: false, path: '/api/socket.io', transports: ['websocket'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 4000 });
const getToken = () => { let token = localStorage.getItem('fourrow-token'); if (!token) { token = crypto.randomUUID(); localStorage.setItem('fourrow-token', token); } return token; };
const storedToken = getToken();
const COLORS = ['#f0a443', '#e76756'];

function App() {
  const params = new URLSearchParams(location.search);
  const [screen, setScreen] = useState('home');
  const [name, setName] = useState(localStorage.getItem('fourrow-name') || '');
  const [joinCode, setJoinCode] = useState((params.get('room') || '').toUpperCase());
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(sessionStorage.getItem('fourrow-player') || '');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [sound, setSound] = useState(true);
  const [toast, setToast] = useState('');
  const [hoverCol, setHoverCol] = useState(null);
  const me = room?.players.find((p) => p.id === playerId);
  const myIndex = room?.players.findIndex((p) => p.id === playerId) ?? -1;
  const opponent = room?.players.find((p) => p.id !== playerId);
  const myTurn = room?.status === 'playing' && room.turn === myIndex;
  const activePlayer = room?.players[room.turn];

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => {
      setConnected(true); setError('');
      const resumeCode = new URLSearchParams(location.search).get('room');
      const savedPlayer = sessionStorage.getItem('fourrow-player');
      if (resumeCode && savedPlayer) {
        socket.emit('room:join', { code: resumeCode, name: localStorage.getItem('fourrow-name') || 'Player', token: storedToken }, (result) => {
          if (result?.ok) { setPlayerId(result.playerId); setError(''); }
          else if (result?.error) setError(result.error);
        });
      }
    });
    socket.on('connect_error', (cause) => { setConnected(false); setError(cause.message || 'The realtime service is unavailable. Try again shortly.'); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', (state) => { setRoom(state); setScreen('game'); setBusy(false); });
    return () => { socket.off('connect'); socket.off('connect_error'); socket.off('disconnect'); socket.off('room:state'); };
  }, []);

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(''), 2400); return () => clearTimeout(t); }
  }, [toast]);

  const act = (event, payload, onSuccess) => {
    setBusy(true); setError('');
    socket.timeout(6000).emit(event, payload, (err, result) => {
      setBusy(false);
      if (err) { setError('Connection is taking a while. Check your network and try again.'); return; }
      if (!result?.ok) { setError(result?.error || 'Something went wrong. Please try again.'); return; }
      onSuccess?.(result);
    });
  };
  const saveName = () => { const normalized = name.trim().slice(0, 18); const finalName = normalized || 'Player'; setName(finalName); localStorage.setItem('fourrow-name', finalName); return finalName; };
  const createRoom = () => { const finalName = saveName(); act('room:create', { name: finalName, token: storedToken }, ({ playerId: id, code }) => { setPlayerId(id); sessionStorage.setItem('fourrow-player', id); history.replaceState({}, '', `?room=${code}`); }); };
  const joinRoom = (event) => { event?.preventDefault(); const finalName = saveName(); act('room:join', { name: finalName, token: storedToken, code: joinCode }, ({ playerId: id, code }) => { setPlayerId(id); sessionStorage.setItem('fourrow-player', id); history.replaceState({}, '', `?room=${code}`); }); };
  const leaveRoom = () => { socket.emit('room:leave', { code: room?.code, playerId }); setRoom(null); setScreen('home'); setError(''); history.replaceState({}, '', location.pathname); };
  const playColumn = (column) => { if (!myTurn || room.board[0][column]) return; act('move', { code: room.code, playerId, column }); };
  const copyInvite = async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room.code}`); setCopied(true); setToast('Invite link copied'); setTimeout(() => setCopied(false), 1800); };
  const playAgain = () => act('game:rematch', { code: room.code, playerId });
  const pieceClass = (piece) => piece ? `piece piece-${piece}` : 'piece';

  return <main className={`app-shell ${screen === 'game' ? 'in-game' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={leaveRoom} aria-label="Back to home"><span className="brand-mark"><i /><i /><i /><i /></span><span>four<span className="brand-accent">/</span>row</span></button>
      <div className="top-actions"><span className={`connection ${connected ? 'online' : ''}`}><span className="connection-dot" />{connected ? 'CONNECTED' : 'RECONNECTING'}</span><button className="icon-btn" onClick={() => setShowRules(true)} aria-label="How to play"><CircleHelp size={19} /></button></div>
    </header>

    {screen === 'home' ? <section className="home-layout">
      <div className="home-copy"><div className="eyebrow"><span className="eyebrow-line" /> THE CLASSIC, A LITTLE BRIGHTER</div><h1>A little<br/><em>friendly</em> rivalry.</h1><p className="intro">Four in a row. Two players. One very satisfying win. Grab a friend and make your move.</p>
        <div className="home-cards">
          <button className="action-card create-card" disabled={busy || !connected} onClick={createRoom}><span className="card-icon"><Sparkles size={20}/></span><span className="card-title">Start a new game</span><span className="card-sub">Create a room & invite a friend</span><ArrowUpRight className="card-arrow" size={20}/></button>
          <form className="action-card join-card" onSubmit={joinRoom}><span className="card-icon muted-icon"><Link2 size={19}/></span><label htmlFor="room-code" className="card-title">Join a game</label><span className="card-sub">Have a room code? Enter it here</span><div className="join-row"><input id="room-code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ROOM CODE" maxLength={6} autoComplete="off"/><button className="join-button" disabled={busy || !connected || joinCode.length < 4} aria-label="Join room"><ArrowUpRight size={19}/></button></div></form>
        </div>
        <label className="name-field"><span>YOUR NAME</span><input value={name} onChange={(e) => setName(e.target.value.slice(0, 18))} placeholder="e.g. Alex" maxLength={18}/></label>
        {error && <div className="error-note">{error}</div>}
        <div className="home-foot"><span><span className="mini-dot"/> FREE TO PLAY</span><span>NO ACCOUNT NEEDED</span></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="sunburst"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-note note-top">YOUR TURN <span>↗</span></div><div className="art-board">{Array.from({length: 42}, (_, i) => <div key={i} className={`art-cell ${(i === 8 || i === 15 || i === 22 || i === 29) ? 'warm' : [3, 10, 17, 18, 24, 31].includes(i) ? 'red' : ''}`}>{(i === 8 || i === 15 || i === 22 || i === 29 || [3, 10, 17, 18, 24, 31].includes(i)) && <span/>}</div>)}</div><div className="hero-note note-bottom">FIRST TO CONNECT FOUR <span>✳</span></div><div className="floating-star">✳</div><div className="floating-plus">+</div></div>
    </section> : <section className="game-layout">
      <div className="game-head"><div><button className="back-link" onClick={leaveRoom}><ArrowLeft size={16}/> BACK</button><div className="game-title-row"><h1>Make your move<span>.</span></h1><span className="room-chip">ROOM {room?.code}</span></div><p className="game-caption">A little focus. A little luck. A lot of bragging rights.</p></div><button className="share-button" onClick={copyInvite}>{copied ? <Check size={17}/> : <Copy size={17}/>}<span>{copied ? 'Copied!' : 'Invite a friend'}</span></button></div>
      <div className="game-main">
        <div className="board-column">
          <div className={`turn-banner ${myTurn ? 'your-turn' : ''} ${room?.status !== 'playing' ? 'quiet-turn' : ''} ${room?.status === 'won' ? (room.winner === playerId ? 'result-win' : 'result-loss') : ''}`}><div className="turn-disc" style={{'--player-color': COLORS[room?.turn || 0]}}>{room?.status === 'playing' ? <span/> : room?.status === 'won' && room.winner === playerId ? <Crown size={15}/> : null}</div><div><b>{room?.status === 'waiting' ? 'Waiting for a friend' : room?.status === 'won' ? (room.winner === playerId ? 'You won!' : 'You lose — better luck next time!') : room?.status === 'draw' ? 'It’s a draw!' : myTurn ? 'Your move' : `${activePlayer?.name || 'Opponent'} is up`}</b><small>{room?.status === 'waiting' ? 'Share the room link to get started' : room?.status === 'playing' ? (myTurn ? 'Choose any column to drop your disc' : 'Hang tight — your turn is next') : room?.status === 'won' ? (room.winner === playerId ? 'Four connected. Brilliantly played!' : 'Your friend connected four. Play again for a rematch.') : room?.status === 'draw' ? 'No spaces left on the board' : 'Four connected. Nicely played.'}</small></div>{room?.status === 'playing' && <span className="turn-count">{room.board.flat().filter(Boolean).length}<i>/42</i></span>}</div>
          <div className={`board-wrap ${!myTurn ? 'not-turn' : ''}`} onMouseLeave={() => setHoverCol(null)}><div className="column-hints">{Array.from({length:7}, (_, c) => <button key={c} className={`column-hint ${hoverCol === c ? 'hovered' : ''}`} onMouseEnter={() => setHoverCol(c)} onClick={() => playColumn(c)} disabled={!myTurn || room?.board[0][c] !== 0} aria-label={`Drop in column ${c+1}`}><span>↓</span></button>)}</div><div className="board">{room?.board.map((row, r) => row.map((piece, c) => <button key={`${r}-${c}`} className={`cell ${room.winningCells?.some(([wr,wc]) => wr===r&&wc===c) ? 'winning-cell' : ''} ${room.lastMove?.row===r&&room.lastMove?.column===c ? 'last-cell' : ''}`} onClick={() => playColumn(c)} onMouseEnter={() => setHoverCol(c)} disabled={!myTurn || room.board[0][c] !== 0 || room.status !== 'playing'} aria-label={`Row ${r+1}, column ${c+1}${piece ? `, ${room.players[piece-1]?.name || 'occupied'}` : ''}`}><span className={pieceClass(piece)}>{piece ? <i/> : null}</span></button>))}</div></div>
          <div className="board-legend"><span><i className="legend-disc legend-one"/> You’re <b>{me?.name || 'Player 1'}</b></span><span className="legend-center">DROP A DISC TO PLAY</span><span><i className="legend-disc legend-two"/> {opponent?.name || 'Player 2'}</span></div>
        </div>
        <aside className="side-panel"><div className="score-card"><div className="panel-label">AT THE TABLE <span>✳</span></div>{[me, opponent].map((p, i) => <div key={p?.id || i} className={`player-row ${room?.status === 'playing' && room.players[room.turn]?.id === p?.id ? 'player-active' : ''}`}><div className={`avatar avatar-${i+1}`}>{p?.name?.slice(0,1).toUpperCase() || <span>?</span>}</div><div className="player-info"><b>{p?.name || 'Waiting for player…'}{p?.id === playerId && <small>YOU</small>}</b><span>{!p ? 'Send them the room link' : p.connected ? (i === 0 ? 'Playing as amber' : 'Playing as coral') : 'Reconnecting…'}</span></div>{p?.connected && <span className="online-indicator"/>}</div>)}</div><div className="rules-card"><div className="panel-label">HOW TO WIN <span>01 — 03</span></div><div className="rule-item"><span>01</span><p>Take turns dropping one disc into any open column.</p></div><div className="rule-item"><span>02</span><p>Connect four of your color in any direction.</p></div><div className="rule-item"><span>03</span><p>Fill the board? That’s a draw. Go again!</p></div><button className="rules-link" onClick={() => setShowRules(true)}>FULL RULES <ArrowUpRight size={15}/></button></div><div className="best-of"><span>BEST PLAYED WITH</span><b>Someone you like beating.</b><div>✳ &nbsp; good luck out there</div></div></aside>
      </div>
      {error && <div className="error-note game-error">{error}</div>}
      {(room?.status === 'won' || room?.status === 'draw') && <button className="rematch-button" disabled={busy} onClick={playAgain}><RotateCcw size={17}/> Play again</button>}
    </section>}
    <footer className="footer"><span>MADE FOR FRIENDLY COMPETITION</span><span className="footer-right">A CLASSIC, RECONNECTED <span>✳</span></span></footer>
    {showRules && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowRules(false)}><div className="rules-modal"><button className="modal-close" onClick={() => setShowRules(false)}>×</button><div className="eyebrow"><span className="eyebrow-line"/> THE RULES</div><h2>Four in a row.<br/><em>That’s the whole idea.</em></h2><ol><li><span>01</span><p>Two players take turns dropping a disc into one of the seven columns. Discs fall to the lowest open space.</p></li><li><span>02</span><p>Connect four of your own discs in a line — across, up and down, or diagonally — to win.</p></li><li><span>03</span><p>If every spot fills before someone connects four, it’s a draw. Start a rematch and switch it up.</p></li></ol><button className="modal-done" onClick={() => setShowRules(false)}>GOT IT <ArrowUpRight size={16}/></button></div></div>}
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
