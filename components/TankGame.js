"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Game, WIDTH, HEIGHT } from "../lib/game";

const KEYMAP = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "fire",
  KeyJ: "fire",
};

const EMPTY_HUD = {
  score: 0,
  lives: 3,
  level: 1,
  enemies: 0,
  power: 0,
  status: "menu",
  frozen: false,
};

export default function TankGame() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [hud, setHud] = useState(EMPTY_HUD);
  const [soundOn, setSoundOn] = useState(true);
  const [high, setHigh] = useState(0);

  // 初始化游戏
  useEffect(() => {
    const game = new Game(canvasRef.current, {
      sound: true,
      onUpdate: (s) => setHud(s),
    });
    gameRef.current = game;

    const saved = Number(localStorage.getItem("tank-high") || 0);
    setHigh(saved);

    const onKeyDown = (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        e.preventDefault();
        game.input[action] = true;
        return;
      }
      if (e.code === "Enter") {
        e.preventDefault();
        if (game.status === "menu" || game.status === "gameover") {
          game.setSound(soundOn);
          game.startGame();
        } else if (game.status === "paused") {
          game.resume();
        }
      } else if (e.code === "KeyP" || e.code === "Escape") {
        e.preventDefault();
        game.togglePause();
      }
    };
    const onKeyUp = (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        e.preventDefault();
        game.input[action] = false;
      }
    };
    const onBlur = () => {
      for (const k of Object.keys(game.input)) game.input[k] = false;
      game.pause();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      game.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 记录最高分
  useEffect(() => {
    if (hud.score > high) {
      setHigh(hud.score);
      try {
        localStorage.setItem("tank-high", String(hud.score));
      } catch (e) {
        /* ignore */
      }
    }
  }, [hud.score, high]);

  const start = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.setSound(soundOn);
    g.startGame();
  }, [soundOn]);

  const togglePause = useCallback(() => {
    gameRef.current?.togglePause();
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((s) => {
      const next = !s;
      gameRef.current?.setSound(next);
      return next;
    });
  }, []);

  // 触屏方向键
  const bind = useCallback(
    (action) => ({
      onPointerDown: (e) => {
        e.preventDefault();
        if (gameRef.current) gameRef.current.input[action] = true;
      },
      onPointerUp: (e) => {
        e.preventDefault();
        if (gameRef.current) gameRef.current.input[action] = false;
      },
      onPointerLeave: () => {
        if (gameRef.current) gameRef.current.input[action] = false;
      },
      onPointerCancel: () => {
        if (gameRef.current) gameRef.current.input[action] = false;
      },
    }),
    []
  );

  const status = hud.status;
  const showOverlay = status === "menu" || status === "paused" || status === "gameover";

  return (
    <div className="wrap">
      <h1 className="title">欢坦克大战 · TANK BATTLE</h1>

      <div className="hud">
        <div className="hud-item">
          <span className="label">分数</span>
          <span className="value">{hud.score}</span>
        </div>
        <div className="hud-item">
          <span className="label">最高</span>
          <span className="value">{high}</span>
        </div>
        <div className="hud-item">
          <span className="label">生命</span>
          <span className="value lives">
            {Array.from({ length: hud.lives }).map((_, i) => (
              <span key={i} className="heart" />
            ))}
            {hud.lives === 0 && <span className="empty">—</span>}
          </span>
        </div>
        <div className="hud-item">
          <span className="label">关卡</span>
          <span className="value">{hud.level}</span>
        </div>
        <div className="hud-item">
          <span className="label">剩余敌人</span>
          <span className="value">{hud.enemies}</span>
        </div>
        <div className="hud-item">
          <span className="label">火力</span>
          <span className="value power">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className={`pip ${i < hud.power ? "on" : ""}`} />
            ))}
          </span>
        </div>
      </div>

      <div className="stage" style={{ maxWidth: WIDTH }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="canvas"
          style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        />

        {showOverlay && (
          <div className="overlay">
            {status === "menu" && (
              <>
                <h2>坦克大战</h2>
                <p className="sub">守住基地，消灭所有敌方坦克！</p>
                <button className="btn primary" onClick={start}>
                  开始游戏 (Enter)
                </button>
              </>
            )}
            {status === "paused" && (
              <>
                <h2>已暂停</h2>
                <button className="btn primary" onClick={togglePause}>
                  继续 (P)
                </button>
              </>
            )}
            {status === "gameover" && (
              <>
                <h2>游戏结束</h2>
                <p className="sub">
                  本局得分 <b>{hud.score}</b>
                </p>
                <button className="btn primary" onClick={start}>
                  再来一局 (Enter)
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {hud.frozen && <div className="freeze-tip">⏱ 敌人已冻结</div>}

      <div className="toolbar">
        <button className="btn" onClick={start}>
          重新开始
        </button>
        <button className="btn" onClick={togglePause} disabled={status === "menu" || status === "gameover"}>
          {status === "paused" ? "继续" : "暂停"}
        </button>
        <button className="btn" onClick={toggleSound}>
          {soundOn ? "🔊 音效开" : "🔇 音效关"}
        </button>
      </div>

      {/* 触屏控制 */}
      <div className="touch">
        <div className="dpad">
          <button className="tbtn up" {...bind("up")} aria-label="上">
            ▲
          </button>
          <button className="tbtn left" {...bind("left")} aria-label="左">
            ◀
          </button>
          <button className="tbtn right" {...bind("right")} aria-label="右">
            ▶
          </button>
          <button className="tbtn down" {...bind("down")} aria-label="下">
            ▼
          </button>
        </div>
        <button className="tbtn fire" {...bind("fire")} aria-label="开火">
          开火
        </button>
      </div>

      <div className="help">
        <p>
          <b>操作：</b> 方向键 / WASD 移动 · 空格 / J 开火 · P 暂停
        </p>
        <p className="tips">
          砖墙可被击穿，钢墙需满级火力才能摧毁，河流无法通行但子弹可飞过，草丛会遮挡视线。捡拾道具：
          星=火力升级，盾=护盾，命=加命，弹=全屏清敌，钟=冻结敌人。
        </p>
      </div>
    </div>
  );
}
