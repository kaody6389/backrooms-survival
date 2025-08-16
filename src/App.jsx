import React, { useEffect, useMemo, useRef, useState } from "react";

// --- Backrooms Webgame Starter ---
// Single-file React game scaffold inspired by the Backrooms.
// Controls: WASD / Arrow keys to move, M = minimap, H = help, R = restart, Space = drink Almond Water
// Goal: Explore Level 0, keep Sanity up, avoid Hounds, find the Exit Door.

// ===== Utilities =====
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Manhattan distance
function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// ===== Content generation =====
const TILE = {
  WALL: 0,
  FLOOR: 1,
};

function makeEmptyMap(w, h) {
  const map = new Array(h);
  for (let y = 0; y < h; y++) {
    map[y] = new Array(w);
    for (let x = 0; x < w; x++) {
      map[y][x] = {
        t: TILE.WALL,
        light: 0, // 0..1
        seen: false,
        item: null, // 'almond'
        exit: false,
      };
    }
  }
  return map;
}

function carve(map, x, y) {
  if (map[y] && map[y][x]) map[y][x].t = TILE.FLOOR;
}

function inBounds(map, x, y) {
  return y >= 0 && y < map.length && x >= 0 && x < map[0].length;
}

// Recursive backtracker maze (odd grid bias). Then punch a few rooms.
function generateLayout(w, h, rng) {
  const map = makeEmptyMap(w, h);

  const sx = (Math.floor(w / 2) | 1); // odd
  const sy = (Math.floor(h / 2) | 1);
  carve(map, sx, sy);

  const stack = [[sx, sy]];
  const dirs = [[2,0],[-2,0],[0,2],[0,-2]];

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const order = shuffle(rng, dirs);
    let moved = false;
    for (const [dx, dy] of order) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(map, nx, ny)) continue;
      if (map[ny][nx].t === TILE.WALL) {
        carve(map, nx, ny);
        carve(map, cx + dx/2, cy + dy/2); // open between
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // Punch rectangular rooms
  const roomCount = Math.floor((w*h)/400);
  for (let i = 0; i < roomCount; i++) {
    const rw = randInt(rng, 5, 9);
    const rh = randInt(rng, 4, 7);
    const rx = randInt(rng, 1, w - rw - 2);
    const ry = randInt(rng, 1, h - rh - 2);
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++)
        carve(map, x, y);
  }

  // Lights: place bright tiles that flicker later
  const lightCount = Math.floor((w*h)/200);
  for (let i = 0; i < lightCount; i++) {
    const lx = randInt(rng, 2, w-3);
    const ly = randInt(rng, 2, h-3);
    if (map[ly][lx].t === TILE.FLOOR) {
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const nx = lx + x, ny = ly + y;
          if (inBounds(map, nx, ny) && map[ny][nx].t === TILE.FLOOR) {
            const d = Math.sqrt(x*x + y*y);
            map[ny][nx].light = Math.max(map[ny][nx].light, clamp(1 - d/3, 0, 1));
          }
        }
      }
    }
  }

  return map;
}

function placeThings(map, rng) {
  const h = map.length, w = map[0].length;
  // Find all floor tiles
  const floors = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (map[y][x].t === TILE.FLOOR) floors.push([x,y]);

  const pick = () => floors.splice(Math.floor(rng()*floors.length),1)[0];

  // Player spawn
  const [px, py] = pick();

  // Exit far from player
  let ex = px, ey = py, bestD = -1;
  for (let i = 0; i < 200; i++) {
    const [x,y] = floors[Math.floor(rng()*floors.length)];
    const d = manhattan(px, py, x, y);
    if (d > bestD) { bestD = d; ex = x; ey = y; }
  }
  map[ey][ex].exit = true;

  // Almond Waters
  const awCount = Math.max(5, Math.floor(floors.length / 120));
  for (let i = 0; i < awCount; i++) {
    const [x,y] = pick();
    if (!map[y][x].exit) map[y][x].item = 'almond';
  }

  // Hounds
  const hounds = [];
  const hCount = Math.max(1, Math.floor(floors.length / 800));
  for (let i = 0; i < hCount; i++) {
    const [x,y] = pick();
    hounds.push({ x, y, cooldown: randInt(rng, 0, 2) });
  }

  return { px, py, hounds };
}

// Greedy step towards player with tiny randomness; respects walls.
function stepHound(map, h, targetX, targetY, rng) {
  const dirs = shuffle(rng, [
    [1,0],[-1,0],[0,1],[0,-1]
  ]).sort((a,b)=>{
    const da = manhattan(h.x + a[0], h.y + a[1], targetX, targetY);
    const db = manhattan(h.x + b[0], h.y + b[1], targetX, targetY);
    return da - db;
  });
  for (const [dx, dy] of dirs) {
    const nx = h.x + dx, ny = h.y + dy;
    if (!inBounds(map, nx, ny)) continue;
    if (map[ny][nx].t === TILE.FLOOR) {
      h.x = nx; h.y = ny; return;
    }
  }
}

// ===== React Game =====
export default function BackroomsGame() {
  // World size & seed
  const [seed, setSeed] = useState(()=>{
    const saved = localStorage.getItem('br_seed');
    return saved ? parseInt(saved) : Math.floor(Math.random()*1e9);
  });
  const rng = useMemo(()=>mulberry32(seed), [seed]);

  const W = 46; // columns
  const H = 30; // rows

  const [map, setMap] = useState(()=>generateLayout(W,H,rng));
  const [player, setPlayer] = useState(()=>({ x: 0, y: 0 }));
  const [hounds, setHounds] = useState(()=>[]);
  const [sanity, setSanity] = useState(100);
  const [bottles, setBottles] = useState(0);
  const [turn, setTurn] = useState(0);
  const [message, setMessage] = useState("노란 형광등 아래의 축축한 카펫 냄새가 진동한다…");
  const [showMap, setShowMap] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [gameOver, setGameOver] = useState(null); // null | 'dead' | 'win'
  const [zoom, setZoom] = useState(18); // px per tile

  // One-time placement
  useEffect(()=>{
    const newMap = generateLayout(W,H,rng);
    const { px, py, hounds } = placeThings(newMap, rng);
    newMap[py][px].seen = true;
    setMap(newMap);
    setPlayer({ x: px, y: py });
    setHounds(hounds);
    setSanity(100);
    setBottles(0);
    setTurn(0);
    setMessage("알몬드 워터를 모으고 출구를 찾자. 하운드를 조심!");
    setGameOver(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Flicker lights slightly each turn
  useEffect(()=>{
    if (!map) return;
    setMap(prev => {
      const copy = prev.map(row => row.map(cell => ({...cell})));
      for (let y = 0; y < copy.length; y++) {
        for (let x = 0; x < copy[0].length; x++) {
          if (copy[y][x].light > 0) {
            const n = clamp(copy[y][x].light + (Math.random()-0.5)*0.05, 0.1, 1);
            copy[y][x].light = n;
          }
        }
      }
      return copy;
    });
  }, [turn]);

  // Key handling
  useEffect(()=>{
    function onKey(e){
      if (gameOver && e.key.toLowerCase() !== 'r') return;
      const key = e.key;
      if (key === 'm' || key === 'M') { setShowMap(v=>!v); return; }
      if (key === 'h' || key === 'H') { setShowHelp(v=>!v); return; }
      if (key === 'r' || key === 'R') { restart(); return; }
      if (key === ' ') { drink(); return; }
      let dx = 0, dy = 0;
      if (key === 'ArrowUp' || key === 'w' || key === 'W') dy = -1;
      else if (key === 'ArrowDown' || key === 's' || key === 'S') dy = 1;
      else if (key === 'ArrowLeft' || key === 'a' || key === 'A') dx = -1;
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') dx = 1;
      else return;
      e.preventDefault();
      step(dx, dy);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function restart(){
    setSeed(Math.floor(Math.random()*1e9));
  }

  function drink(){
    if (bottles <= 0 || gameOver) return;
    setBottles(bottles - 1);
    setSanity(s => clamp(s + 35, 0, 100));
    setMessage("알몬드 워터를 마셨다. 정신이 또렷해진다 (+35)");
  }

  function step(dx, dy){
    if (gameOver) return;
    const nx = clamp(player.x + dx, 0, W-1);
    const ny = clamp(player.y + dy, 0, H-1);
    if (map[ny][nx].t === TILE.FLOOR) {
      const copy = map.map(row => row.map(cell => ({...cell})));
      copy[ny][nx].seen = true;
      let msg = "";
      // Items
      if (copy[ny][nx].item === 'almond') {
        copy[ny][nx].item = null;
        setBottles(b => b + 1);
        msg = "알몬드 워터를 주웠다 (+1)";
      }
      // Exit
      if (copy[ny][nx].exit) {
        setMap(copy);
        setPlayer({x: nx, y: ny});
        setTurn(t => t+1);
        setGameOver('win');
        setMessage("축하합니다! 출구를 찾았습니다. R 키로 재시작.");
        return;
      }
      setMap(copy);
      setPlayer({x: nx, y: ny});
      // Sanity drain
      const light = copy[ny][nx].light;
      const drain = light > 0.4 ? 1 : 3;
      setSanity(s => clamp(s - drain, 0, 100));
      if (drain >= 3) msg = msg || "어둠 속에서 불안이 엄습한다 (-3)";
      if (msg) setMessage(msg);

      // Enemies update
      const nextH = hounds.map(h => ({...h}));
      for (const h of nextH) {
        if (h.cooldown > 0) { h.cooldown--; continue; }
        const d = manhattan(h.x, h.y, nx, ny);
        // If close, chase more aggressively
        if (d < 10 || Math.random() < 0.3) stepHound(map, h, nx, ny, Math.random);
      }
      setHounds(nextH);

      // Check collision with hounds
      if (nextH.some(h => h.x === nx && h.y === ny)) {
        setGameOver('dead');
        setMessage("하운드에게 붙잡혔다… R 키로 재시작.");
        return;
      }

      // Death by sanity
      if (sanity - drain <= 0) {
        setGameOver('dead');
        setMessage("정신이 붕괴됐다… R 키로 재시작.");
        return;
      }

      setTurn(t => t+1);
    }
  }

  // Persist seed
  useEffect(()=>{
    localStorage.setItem('br_seed', String(seed));
  }, [seed]);

  // Viewport & rendering
  const tilePx = clamp(zoom, 12, 28);
  const containerRef = useRef(null);

  // Scroll follow (optional)
  useEffect(()=>{
    const el = containerRef.current;
    if (!el) return;
    const cx = player.x * tilePx - el.clientWidth/2 + tilePx/2;
    const cy = player.y * tilePx - el.clientHeight/2 + tilePx/2;
    el.scrollTo({ left: cx, top: cy, behavior: 'smooth' });
  }, [player.x, player.y, tilePx]);

  function tileStyle(cell) {
    // Level 0 palette: sickly yellow, damp carpet, stained walls
    if (cell.t === TILE.WALL) {
      return { background: '#c6b55a', filter: 'brightness(0.85) saturate(0.9)' };
    }
    // Floor brightness from light; darker = lower sanity drain
    const base = 200 + Math.floor(cell.light * 30);
    const color = `rgb(${base}, ${base-10}, ${120})`; // dingy yellow-green
    return { background: color };
  }

  function cellGlyph(x,y,cell) {
    if (player.x === x && player.y === y) return '🙂';
    for (const h of hounds) if (h.x === x && h.y === y) return '🐕';
    if (cell.exit) return '🚪';
    if (cell.item === 'almond') return '🥤';
    return '';
  }

  return (
    <div className="w-full h-full p-3 bg-neutral-900 text-neutral-100">
      <div className="max-w-6xl mx-auto flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-bold">Backrooms: Level 0 — Webgame Starter</h1>
          <div className="flex items-center gap-2 text-sm">
            <button className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700" onClick={()=>setShowHelp(v=>!v)}>도움말</button>
            <button className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700" onClick={()=>setShowMap(v=>!v)}>미니맵</button>
            <button className="px-3 py-1 rounded-xl bg-neutral-800 hover:bg-neutral-700" onClick={restart}>재시작</button>
          </div>
        </header>

        {/* HUD */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-neutral-800/60 rounded-2xl shadow">
            <div className="text-sm mb-1">Sanity</div>
            <div className="w-full h-3 bg-neutral-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400" style={{width: `${sanity}%`}} />
            </div>
            <div className="mt-2 text-xs text-neutral-300">어두울수록 더 빨리 떨어집니다.</div>
          </div>
          <div className="p-3 bg-neutral-800/60 rounded-2xl shadow flex items-center justify-between">
            <div className="text-sm">Almond Water: <span className="font-semibold">{bottles}</span></div>
            <button onClick={drink} className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40" disabled={bottles<=0 || !!gameOver}>마시기 (Space)</button>
          </div>
          <div className="p-3 bg-neutral-800/60 rounded-2xl shadow flex items-center justify-between">
            <div className="text-sm">Turn: <span className="font-semibold">{turn}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Zoom</span>
              <input type="range" min={12} max={28} value={zoom} onChange={e=>setZoom(parseInt(e.target.value))} />
            </div>
          </div>
        </div>

        {/* Message */}
        <div className="p-3 bg-neutral-800/60 rounded-2xl shadow text-sm min-h-10">{message}</div>

        {/* Game viewport */}
        <div ref={containerRef} className="relative w-full h-[60vh] overflow-auto rounded-2xl bg-neutral-950 border border-neutral-800">
          <div className="relative" style={{
            width: map[0].length * tilePx,
            height: map.length * tilePx,
            display: 'grid',
            gridTemplateColumns: `repeat(${map[0].length}, ${tilePx}px)`,
            gridTemplateRows: `repeat(${map.length}, ${tilePx}px)`,
          }}>
            {map.map((row, y) => row.map((cell, x) => {
              const glyph = cellGlyph(x,y,cell);
              const seen = cell.seen || showMap;
              const style = seen ? tileStyle(cell) : { background: '#0b0b0b' };
              const isPlayer = player.x === x && player.y === y;
              const isEntity = hounds.some(h=>h.x===x&&h.y===y);
              const outline = isPlayer ? '0 0 0 2px rgba(59,130,246,0.9) inset' : isEntity ? '0 0 0 2px rgba(239,68,68,0.8) inset' : 'none';
              return (
                <div key={`${x},${y}`} style={{...style, width: tilePx, height: tilePx, boxShadow: outline}} className="relative select-none">
                  {seen && glyph && (
                    <div className="absolute inset-0 flex items-center justify-center text-[14px]">
                      {glyph}
                    </div>
                  )}
                </div>
              );
            }))}
          </div>
          {gameOver && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-sm mx-auto">
                <div className="text-2xl font-bold mb-2">{gameOver === 'win' ? '탈출 성공!' : '사망'}</div>
                <div className="text-sm text-neutral-300 mb-4">{gameOver === 'win' ? '레벨 0의 출구를 찾았습니다.' : '하운드에게 당했거나, 정신을 잃었습니다.'}</div>
                <div className="text-sm">R 키로 재시작</div>
              </div>
            </div>
          )}
        </div>

        {/* Help & Minimap */}
        {showHelp && (
          <div className="p-4 bg-neutral-800/60 rounded-2xl shadow text-sm leading-6">
            <div className="font-semibold mb-1">조작법</div>
            <ul className="list-disc list-inside space-y-1">
              <li>이동: WASD / 방향키</li>
              <li>알몬드 워터 마시기: Space</li>
              <li>미니맵: M</li>
              <li>도움말 토글: H</li>
              <li>재시작: R</li>
            </ul>
            <div className="font-semibold mt-3 mb-1">규칙</div>
            <ul className="list-disc list-inside space-y-1">
              <li>밝은 곳에 있을수록 정신력 감소가 적습니다.</li>
              <li>하운드는 플레이어를 느릿하게 추적합니다. 접촉하면 사망합니다.</li>
              <li>알몬드 워터를 모아 Space로 마시면 정신력이 회복됩니다.</li>
              <li>🚪 출구를 찾으면 승리!</li>
            </ul>
          </div>
        )}

        {showMap && (
          <div className="p-4 bg-neutral-800/60 rounded-2xl shadow">
            <div className="text-sm font-semibold mb-2">미니맵</div>
            <div className="grid gap-[2px]" style={{gridTemplateColumns: `repeat(${map[0].length}, 6px)`}}>
              {map.map((row,y)=>row.map((cell,x)=>{
                const seen = cell.seen;
                let bg = '#0b0b0b';
                if (seen) {
                  if (cell.t === TILE.WALL) bg = '#4a4520';
                  else if (player.x===x && player.y===y) bg = '#3b82f6';
                  else if (hounds.some(h=>h.x===x&&h.y===y)) bg = '#ef4444';
                  else if (cell.exit) bg = '#22c55e';
                  else bg = cell.light>0.4? '#b5a83f' : '#6b672c';
                }
                return <div key={`m${x},${y}`} style={{width:6,height:6,background:bg}} />
              }))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
          <div>Seed: <span className="font-mono">{seed}</span></div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700" onClick={()=>setSeed(Math.floor(Math.random()*1e9))}>새 맵 생성</button>
            <button className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700" onClick={()=>setShowHelp(v=>!v)}>{showHelp? '도움말 숨기기' : '도움말 보기'}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
