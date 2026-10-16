// ============================================================
//  坦克大战 - 游戏引擎（纯 Canvas，无第三方依赖）
// ============================================================

export const TILE = 32;
export const COLS = 15;
export const ROWS = 15;
export const WIDTH = COLS * TILE; // 480
export const HEIGHT = ROWS * TILE; // 480

const TANK_SIZE = 24;
const LANE_OFFSET = (TILE - TANK_SIZE) / 2; // 4
const ALIGN_SPEED = 200; // 自动对齐“车道”的速度
const MAX_PARTICLES = 260;

// 地块类型
const T = {
  EMPTY: 0,
  BRICK: 1, // 砖墙（可摧毁）
  STEEL: 2, // 钢墙（高级火力可摧毁）
  WATER: 3, // 河流（阻挡坦克，子弹可穿过）
  GRASS: 4, // 草丛（坦克可穿过，遮挡视线）
  BASE: 5, // 基地（被摧毁则失败）
};

const SOLID = new Set([T.BRICK, T.STEEL, T.WATER, T.BASE]);

const DIR_VEC = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const DIRS = ["up", "down", "left", "right"];

// 敌人类型
const ENEMY_TYPES = {
  basic: { speed: 62, bulletSpeed: 230, hp: 1, points: 100, color: "#c8ccd0", fire: [0.9, 1.8] },
  fast: { speed: 112, bulletSpeed: 250, hp: 1, points: 200, color: "#7fd7ff", fire: [0.8, 1.6] },
  power: { speed: 72, bulletSpeed: 340, hp: 1, points: 300, color: "#ffd24a", fire: [0.6, 1.2] },
  armor: { speed: 58, bulletSpeed: 250, hp: 4, points: 400, color: "#8ee06a", fire: [0.9, 1.7] },
};

// 道具
const POWERUPS = ["star", "shield", "life", "bomb", "clock"];

// ---------- 工具函数 ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function tileCenter(c, r) {
  return { x: c * TILE + LANE_OFFSET, y: r * TILE + LANE_OFFSET };
}

// 生成关卡地图（程序化，逐关变化）
function generateLevel(level) {
  const rnd = mulberry32((level * 2654435761) >>> 0);
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.EMPTY));

  // 基地 + 护墙
  g[14][7] = T.BASE;
  g[13][6] = T.BRICK;
  g[13][7] = T.BRICK;
  g[13][8] = T.BRICK;
  g[14][6] = T.BRICK;
  g[14][8] = T.BRICK;

  const reserved = new Set();
  const add = (c, r) => {
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) reserved.add(r * COLS + c);
  };
  // 敌人出生点周围
  for (const [c, r] of [[0, 0], [7, 0], [14, 0]]) {
    for (let dc = -1; dc <= 1; dc++) for (let dr = 0; dr <= 1; dr++) add(c + dc, r + dr);
  }
  // 玩家出生区
  for (let c = 3; c <= 5; c++) for (let r = 13; r <= 14; r++) add(c, r);
  // 基地周围
  for (let c = 4; c <= 10; c++) for (let r = 12; r <= 14; r++) add(c, r);

  for (let r = 1; r <= 12; r++) {
    for (let c = 0; c < 8; c++) {
      const mc = COLS - 1 - c;
      if (reserved.has(r * COLS + c) || reserved.has(r * COLS + mc)) continue;
      const q = rnd();
      let t = T.EMPTY;
      if (q < 0.13) t = T.BRICK;
      else if (q < 0.185) t = T.STEEL;
      else if (q < 0.215) t = T.WATER;
      else if (q < 0.25) t = T.GRASS;
      g[r][c] = t;
      g[r][mc] = t;
    }
    // 中间通道保持可通行
    if (g[r][7] === T.STEEL || g[r][7] === T.WATER) g[r][7] = T.EMPTY;
  }

  // 顶部出生行清空
  for (let c = 0; c < COLS; c++) g[0][c] = T.EMPTY;
  return g;
}

// ============================================================
export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx.imageSmoothingEnabled = false;

    this.onUpdate = opts.onUpdate || (() => {});
    this.soundOn = opts.sound !== false;

    this.input = { up: false, down: false, left: false, right: false, fire: false };
    this.time = 0;
    this._sig = "";
    this.emitAcc = 0;

    // 初始展示第 1 关背景（菜单状态，不跑逻辑）
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.grid = generateLevel(1);
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.powerups = [];
    this.floatTexts = [];
    this.player = null;
    this.banner = null;
    this.status = "menu";

    this.raf = 0;
    this.last = 0;
    this.loop = this.loop.bind(this);
    this.start();
  }

  // ---------------- 生命周期 ----------------
  start() {
    if (this.raf) return;
    this.last = typeof performance !== "undefined" ? performance.now() : 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      if (this.actx) this.actx.close();
    } catch (e) {
      /* ignore */
    }
  }

  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    this.time += dt;
    if (this.status === "playing") this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  }

  setSound(on) {
    this.soundOn = on;
  }

  // ---------------- 流程控制 ----------------
  startGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.setupLevel();
    this.status = "playing";
    this.setBanner("第 1 关", 1.6);
    this.emit(true);
  }

  pause() {
    if (this.status === "playing") {
      this.status = "paused";
      this.emit(true);
    }
  }

  resume() {
    if (this.status === "paused") {
      this.status = "playing";
      this.emit(true);
    }
  }

  togglePause() {
    if (this.status === "playing") this.pause();
    else if (this.status === "paused") this.resume();
  }

  gameOver(reason) {
    if (this.status === "gameover") return;
    this.status = "gameover";
    this.gameOverReason = reason || "lives";
    this.sfx("over");
    this.emit(true);
  }

  setupLevel() {
    this.grid = generateLevel(this.level);
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.powerups = [];
    this.floatTexts = [];
    this.levelClearTimer = 0;
    this.freezeTimer = 0;
    this.spawnIndex = 0;
    this.spawnTimer = 1.0;
    this.spawnInterval = Math.max(0.85, 2.2 - this.level * 0.12);
    this.maxOnField = Math.min(6, 3 + Math.floor((this.level - 1) / 2));
    this.enemiesRemaining = Math.min(20, 8 + this.level * 2);

    const { x, y } = tileCenter(4, 14);
    this.player = this.makeTank({
      x,
      y,
      isPlayer: true,
      dir: "up",
      speed: 132,
      hp: 1,
    });
    this.applyPower(this.player, 0);
    this.player.spawnTimer = 1.2;
    this.player.shieldTimer = 2.5;

    this.emit(true);
  }

  nextLevel() {
    this.level++;
    this.setupLevel();
    this.setBanner(`第 ${this.level} 关`, 1.6);
    this.emit(true);
  }

  setBanner(text, dur) {
    this.banner = { text, t: dur, max: dur };
  }

  // ---------------- 坦克工厂 ----------------
  makeTank(o) {
    return {
      x: o.x,
      y: o.y,
      size: TANK_SIZE,
      dir: o.dir || "up",
      speed: o.speed || 60,
      isPlayer: !!o.isPlayer,
      alive: true,
      hp: o.hp || 1,
      maxHp: o.hp || 1,
      type: o.type || "basic",
      points: o.points || 0,
      color: o.color || "#c8ccd0",
      cool: 0,
      fireRange: o.fire || [1, 2],
      bulletSpeed: o.bulletSpeed || 240,
      maxBullets: 1,
      canBreakSteel: false,
      power: 0,
      spawnTimer: 0,
      shieldTimer: 0,
      flashTimer: 0,
      think: 0,
      blocked: false,
      moving: false,
      trackPhase: 0,
      flashing: false, // 击杀必掉道具
    };
  }

  applyPower(p, power) {
    p.power = power;
    p.maxBullets = power >= 2 ? 2 : 1;
    p.bulletSpeed = 250 + power * 45;
    p.fireRange = [Math.max(0.22, 0.42 - power * 0.05), Math.max(0.3, 0.55 - power * 0.05)];
    p.cool = 0;
    p.canBreakSteel = power >= 3;
  }

  // ---------------- 主更新 ----------------
  update(dt) {
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePowerups(dt);
    this.updateEffects(dt);

    // 关卡清空检测
    if (
      this.status === "playing" &&
      !this.levelClearTimer &&
      this.enemiesRemaining <= 0 &&
      this.enemies.filter((e) => e.alive).length === 0
    ) {
      this.levelClearTimer = 2.4;
      this.setBanner("关卡通过！", 2.2);
      this.sfx("clear");
    }
    if (this.levelClearTimer > 0) {
      this.levelClearTimer -= dt;
      if (this.levelClearTimer <= 0 && this.status === "playing") this.nextLevel();
    }

    // 清理
    this.enemies = this.enemies.filter((e) => e.alive);
    this.bullets = this.bullets.filter((b) => b.alive);
    this.powerups = this.powerups.filter((p) => p.alive && p.t > 0);

    // 节流同步 HUD
    this.emitAcc += dt;
    if (this.emitAcc >= 0.1) {
      this.emitAcc = 0;
      this.emit();
    }
  }

  // ---------------- 玩家 ----------------
  updatePlayer(dt) {
    const p = this.player;
    if (!p || !p.alive) return;
    if (p.shieldTimer > 0) p.shieldTimer -= dt;
    if (p.flashTimer > 0) p.flashTimer -= dt;
    if (p.spawnTimer > 0) {
      p.spawnTimer -= dt;
      return;
    }
    const inp = this.input;
    let dir = null;
    if (inp.up) dir = "up";
    else if (inp.down) dir = "down";
    else if (inp.left) dir = "left";
    else if (inp.right) dir = "right";
    if (dir) {
      p.dir = dir;
      p.moving = true;
      this.moveTank(p, dt);
    } else {
      p.moving = false;
    }

    p.cool -= dt;
    if (inp.fire && p.cool <= 0 && this.bulletCount(p) < p.maxBullets) {
      this.shoot(p);
      p.cool = p.fireRange[0];
    }
  }

  // ---------------- 敌人 ----------------
  updateEnemies(dt) {
    if (this.freezeTimer > 0) this.freezeTimer -= dt;

    // 出生
    this.spawnTimer -= dt;
    const aliveCount = this.enemies.filter((e) => e.alive).length;
    if (
      this.status === "playing" &&
      !this.levelClearTimer &&
      this.spawnTimer <= 0 &&
      this.enemiesRemaining > 0 &&
      aliveCount < this.maxOnField
    ) {
      if (this.spawnEnemy()) {
        this.enemiesRemaining--;
        this.spawnTimer = this.spawnInterval;
      } else {
        this.spawnTimer = 0.4;
      }
    }

    const frozen = this.freezeTimer > 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.spawnTimer > 0) {
        e.spawnTimer -= dt;
        continue;
      }
      if (e.flashTimer > 0) e.flashTimer -= dt;
      if (frozen) continue;

      e.think -= dt;
      if (e.think <= 0 || e.blocked) {
        e.dir = this.chooseDir(e);
        e.think = rand(Math.random, 0.4, 1.3);
        e.blocked = false;
      }
      e.moving = true;
      this.moveTank(e, dt);
      e.cool -= dt;
      if (e.cool <= 0 && this.bulletCount(e) < 1) {
        this.shoot(e);
        e.cool = rand(Math.random, e.fireRange[0], e.fireRange[1]);
      }
    }
  }

  spawnEnemy() {
    const pts = [[0, 0], [7, 0], [14, 0]];
    for (let i = 0; i < pts.length; i++) {
      const idx = (this.spawnIndex + i) % pts.length;
      const [c, r] = pts[idx];
      const { x, y } = tileCenter(c, r);
      const rect = { x, y, w: TANK_SIZE, h: TANK_SIZE };
      let free = true;
      for (const e of this.enemies) {
        if (e.alive && overlap(rect, { x: e.x, y: e.y, w: e.size, h: e.size })) {
          free = false;
          break;
        }
      }
      if (
        this.player &&
        this.player.alive &&
        overlap(rect, { x: this.player.x, y: this.player.y, w: this.player.size, h: this.player.size })
      ) {
        free = false;
      }
      if (!free) continue;

      this.spawnIndex = (idx + 1) % pts.length;
      const type = this.pickEnemyType();
      const def = ENEMY_TYPES[type];
      const tank = this.makeTank({
        x,
        y,
        dir: "down",
        speed: def.speed,
        hp: def.hp,
        type,
        points: def.points,
        color: def.color,
        bulletSpeed: def.bulletSpeed,
        fire: def.fire,
      });
      tank.spawnTimer = 1.0;
      tank.think = rand(Math.random, 0.2, 0.8);
      tank.flashing = Math.random() < 0.25;
      this.enemies.push(tank);
      return true;
    }
    return false;
  }

  pickEnemyType() {
    const lv = this.level;
    const w = {
      basic: Math.max(0.12, 0.72 - lv * 0.06),
      fast: 0.14 + lv * 0.012,
      power: 0.07 + lv * 0.02,
      armor: Math.min(0.34, 0.04 + lv * 0.03),
    };
    const total = w.basic + w.fast + w.power + w.armor;
    let r = Math.random() * total;
    for (const k of Object.keys(w)) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return "basic";
  }

  chooseDir(e) {
    let target = { x: 7 * TILE + 16, y: 14 * TILE + 16 }; // 基地
    if (this.player && this.player.alive && Math.random() < 0.5) {
      target = { x: this.player.x + this.player.size / 2, y: this.player.y + this.player.size / 2 };
    }
    const dx = target.x - (e.x + e.size / 2);
    const dy = target.y - (e.y + e.size / 2);
    const preferred = [];
    if (Math.abs(dx) > 10) preferred.push(dx > 0 ? "right" : "left");
    if (Math.abs(dy) > 10) preferred.push(dy > 0 ? "down" : "up");
    if (Math.random() < 0.22) preferred.length = 0;

    const others = DIRS.slice().sort(() => Math.random() - 0.5);
    const list = [...preferred, ...others];
    for (const d of list) {
      if (!this.blockedDir(e, d)) return d;
    }
    return DIRS[Math.floor(Math.random() * DIRS.length)];
  }

  blockedDir(tank, dir) {
    const [vx, vy] = DIR_VEC[dir];
    const step = 3;
    return this.tankCollides(tank, tank.x + vx * step, tank.y + vy * step);
  }

  // ---------------- 移动与碰撞 ----------------
  moveTank(tank, dt) {
    const [vx, vy] = DIR_VEC[tank.dir];
    const spd = tank.speed * dt;

    // 自动对齐到车道，方便穿过缝隙
    if (vx !== 0) {
      const targetY = Math.round((tank.y - LANE_OFFSET) / TILE) * TILE + LANE_OFFSET;
      const d = targetY - tank.y;
      const step = Math.sign(d) * Math.min(Math.abs(d), ALIGN_SPEED * dt);
      if (step !== 0 && !this.tankCollides(tank, tank.x, tank.y + step)) tank.y += step;
    } else {
      const targetX = Math.round((tank.x - LANE_OFFSET) / TILE) * TILE + LANE_OFFSET;
      const d = targetX - tank.x;
      const step = Math.sign(d) * Math.min(Math.abs(d), ALIGN_SPEED * dt);
      if (step !== 0 && !this.tankCollides(tank, tank.x + step, tank.y)) tank.x += step;
    }

    const nx = tank.x + vx * spd;
    const ny = tank.y + vy * spd;
    if (!this.tankCollides(tank, nx, ny)) {
      tank.x = nx;
      tank.y = ny;
      tank.trackPhase += spd;
      tank.blocked = false;
    } else {
      tank.blocked = true;
    }
  }

  tankCollides(tank, x, y) {
    const rect = { x: x + 1, y: y + 1, w: tank.size - 2, h: tank.size - 2 };
    if (this.solidAt(rect)) return true;
    const others = [];
    if (this.player && this.player !== tank) others.push(this.player);
    for (const e of this.enemies) others.push(e);
    for (const o of others) {
      if (o === tank || !o.alive || o.spawnTimer > 0) continue;
      if (overlap(rect, { x: o.x + 2, y: o.y + 2, w: o.size - 4, h: o.size - 4 })) return true;
    }
    return false;
  }

  solidAt(rect) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > WIDTH || rect.y + rect.h > HEIGHT) return true;
    const c0 = Math.floor(rect.x / TILE);
    const c1 = Math.floor((rect.x + rect.w - 0.01) / TILE);
    const r0 = Math.floor(rect.y / TILE);
    const r1 = Math.floor((rect.y + rect.h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true;
        if (SOLID.has(this.grid[r][c])) return true;
      }
    }
    return false;
  }

  // ---------------- 射击 ----------------
  bulletCount(tank) {
    let n = 0;
    for (const b of this.bullets) if (b.owner === tank && b.alive) n++;
    return n;
  }

  shoot(tank) {
    const cx = tank.x + tank.size / 2;
    const cy = tank.y + tank.size / 2;
    const [vx, vy] = DIR_VEC[tank.dir];
    const off = tank.size / 2 + 2;
    this.bullets.push({
      x: cx + vx * off - 3,
      y: cy + vy * off - 3,
      w: 6,
      h: 6,
      vx: vx * tank.bulletSpeed,
      vy: vy * tank.bulletSpeed,
      owner: tank,
      fromPlayer: tank.isPlayer,
      power: tank.power || 0,
      canBreakSteel: !!tank.canBreakSteel,
      alive: true,
    });
    this.sfx("shoot");
  }

  updateBullets(dt) {
    for (const b of this.bullets) {
      if (!b.alive) continue;
      const dist = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 7));
      for (let s = 0; s < steps && b.alive; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        this.bulletCollide(b);
      }
    }
  }

  bulletCollide(b) {
    if (b.x < -10 || b.y < -10 || b.x > WIDTH + 10 || b.y > HEIGHT + 10) {
      b.alive = false;
      return;
    }
    if (b.x < 0 || b.y < 0 || b.x + b.w > WIDTH || b.y + b.h > HEIGHT) {
      b.alive = false;
      this.spark(b.x + b.w / 2, b.y + b.h / 2);
      return;
    }

    // 与地块
    const c0 = Math.floor(b.x / TILE);
    const c1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const r0 = Math.floor(b.y / TILE);
    const r1 = Math.floor((b.y + b.h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
        const t = this.grid[r][c];
        if (t === T.BRICK) {
          this.grid[r][c] = T.EMPTY;
          this.boom(c * TILE + 16, r * TILE + 16, 7, "#c2703a");
          b.alive = false;
          this.sfx("hit");
          return;
        }
        if (t === T.STEEL) {
          if (b.fromPlayer && b.canBreakSteel) {
            this.grid[r][c] = T.EMPTY;
            this.boom(c * TILE + 16, r * TILE + 16, 8, "#cfd8e3");
            this.sfx("hit");
          } else {
            this.spark(b.x + b.w / 2, b.y + b.h / 2);
            this.sfx("clank");
          }
          b.alive = false;
          return;
        }
        if (t === T.BASE) {
          b.alive = false;
          this.destroyBase();
          return;
        }
      }
    }

    // 与坦克
    if (b.fromPlayer) {
      for (const e of this.enemies) {
        if (!e.alive || e.spawnTimer > 0) continue;
        if (overlap(b, { x: e.x, y: e.y, w: e.size, h: e.size })) {
          b.alive = false;
          this.damageEnemy(e);
          return;
        }
      }
    } else {
      const p = this.player;
      if (p && p.alive && p.spawnTimer <= 0 && overlap(b, { x: p.x, y: p.y, w: p.size, h: p.size })) {
        b.alive = false;
        this.damagePlayer(p);
        return;
      }
    }

    // 子弹对撞
    for (const o of this.bullets) {
      if (o === b || !o.alive) continue;
      if (o.fromPlayer !== b.fromPlayer && overlap(b, o)) {
        o.alive = false;
        b.alive = false;
        this.spark(b.x + 3, b.y + 3);
        return;
      }
    }
  }

  // ---------------- 伤害与死亡 ----------------
  damageEnemy(e) {
    e.hp--;
    if (e.hp <= 0) {
      this.killEnemy(e, true);
    } else {
      e.flashTimer = 0.12;
      this.sfx("clank");
      this.boom(e.x + e.size / 2, e.y + e.size / 2, 5, "#ffffff");
    }
  }

  killEnemy(e, byPlayer) {
    if (!e.alive) return;
    e.alive = false;
    this.boom(e.x + e.size / 2, e.y + e.size / 2, 18, "#ffb347");
    this.boom(e.x + e.size / 2, e.y + e.size / 2, 10, "#ff5a3c");
    this.sfx("explode");
    if (byPlayer) {
      this.score += e.points;
      this.addFloat(e.x + e.size / 2, e.y, `+${e.points}`, "#ffe27a");
    }
    // 掉落道具
    if (e.flashing || Math.random() < 0.1) this.dropPowerup(e.x, e.y);
  }

  damagePlayer(p) {
    if (p.shieldTimer > 0 || p.spawnTimer > 0) {
      this.spark(p.x + p.size / 2, p.y + p.size / 2);
      return;
    }
    p.alive = false;
    this.boom(p.x + p.size / 2, p.y + p.size / 2, 22, "#ffd24a");
    this.sfx("explode");
    this.lives--;
    if (this.lives < 0) {
      this.gameOver("lives");
      return;
    }
    // 复活
    const { x, y } = tileCenter(4, 14);
    p.x = x;
    p.y = y;
    p.dir = "up";
    p.alive = true;
    p.spawnTimer = 1.4;
    p.shieldTimer = 2.5;
    this.applyPower(p, 0);
    this.emit(true);
  }

  destroyBase() {
    if (this.status === "gameover") return;
    const bx = 7 * TILE + 16;
    const by = 14 * TILE + 16;
    this.boom(bx, by, 40, "#ffb347");
    this.boom(bx, by, 26, "#ff3c3c");
    this.grid[14][7] = T.EMPTY;
    this.sfx("explode");
    this.gameOver("base");
  }

  // ---------------- 道具 ----------------
  dropPowerup(x, y) {
    const type = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
    this.powerups.push({ x, y, w: 24, h: 24, type, t: 12, alive: true, phase: 0 });
  }

  updatePowerups(dt) {
    const p = this.player;
    for (const pu of this.powerups) {
      if (!pu.alive) continue;
      pu.t -= dt;
      pu.phase += dt * 6;
      if (pu.t <= 0) {
        pu.alive = false;
        continue;
      }
      if (p && p.alive && overlap({ x: p.x, y: p.y, w: p.size, h: p.size }, pu)) {
        pu.alive = false;
        this.collectPowerup(pu.type);
      }
    }
  }

  collectPowerup(type) {
    const p = this.player;
    this.sfx("power");
    this.addFloat((p ? p.x + p.size / 2 : WIDTH / 2), (p ? p.y : HEIGHT / 2), this.powerLabel(type), "#8ef0ff");
    switch (type) {
      case "star":
        if (p) this.applyPower(p, Math.min(3, p.power + 1));
        break;
      case "shield":
        if (p) p.shieldTimer = 9;
        break;
      case "life":
        this.lives++;
        break;
      case "bomb":
        for (const e of this.enemies.slice()) this.killEnemy(e, true);
        break;
      case "clock":
        this.freezeTimer = 7;
        break;
      default:
        break;
    }
    this.emit(true);
  }

  powerLabel(type) {
    return { star: "火力+1", shield: "护盾", life: "加命", bomb: "全灭", clock: "冻结" }[type] || "道具";
  }

  // ---------------- 粒子 / 特效 ----------------
  boom(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const sp = rand(Math.random, 30, 190);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(Math.random, 0.25, 0.7),
        max: 0.7,
        size: rand(Math.random, 1.5, 4),
        color,
        gravity: 0,
      });
    }
  }

  spark(x, y) {
    for (let i = 0; i < 6; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const sp = rand(Math.random, 20, 90);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.2,
        max: 0.2,
        size: 1.6,
        color: "#ffe9a8",
        gravity: 0,
      });
    }
  }

  addFloat(x, y, text, color) {
    this.floatTexts.push({ x, y, text, color, life: 1.0, max: 1.0 });
  }

  updateEffects(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floatTexts) {
      f.life -= dt;
      f.y -= 24 * dt;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.life > 0);
  }

  // ---------------- HUD 同步 ----------------
  emit(force) {
    const aliveEnemies = this.enemies.filter((e) => e.alive).length;
    const hud = {
      score: this.score,
      lives: Math.max(0, this.lives),
      level: this.level,
      enemies: Math.max(0, this.enemiesRemaining + aliveEnemies),
      power: this.player ? this.player.power : 0,
      status: this.status,
      frozen: this.freezeTimer > 0,
    };
    const sig = JSON.stringify(hud);
    if (force || sig !== this._sig) {
      this._sig = sig;
      this.onUpdate(hud);
    }
  }

  // ---------------- 渲染 ----------------
  render() {
    const ctx = this.ctx;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 地块（草丛最后画）
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = this.grid[r][c];
        const x = c * TILE;
        const y = r * TILE;
        if (t === T.BRICK) this.drawBrick(x, y);
        else if (t === T.STEEL) this.drawSteel(x, y);
        else if (t === T.WATER) this.drawWater(x, y, c, r);
        else if (t === T.BASE) this.drawBase(x, y);
      }
    }

    // 道具
    for (const pu of this.powerups) if (pu.alive) this.drawPowerup(pu);

    // 坦克
    if (this.player && this.player.alive) this.drawTank(this.player);
    for (const e of this.enemies) if (e.alive) this.drawTank(e);

    // 子弹
    for (const b of this.bullets) {
      if (!b.alive) continue;
      ctx.fillStyle = b.fromPlayer ? "#ffffff" : "#ff9d5c";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.fromPlayer ? "rgba(255,255,255,0.35)" : "rgba(255,157,92,0.35)";
      ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    }

    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // 草丛覆盖层
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] === T.GRASS) this.drawGrass(c * TILE, r * TILE, c, r);
      }
    }

    // 飘字
    ctx.textAlign = "center";
    ctx.font = "bold 12px ui-monospace, monospace";
    for (const f of this.floatTexts) {
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // 冻结提示
    if (this.freezeTimer > 0 && this.status === "playing") {
      ctx.fillStyle = "rgba(120,220,255,0.06)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // 横幅
    if (this.banner) {
      const a = Math.min(1, this.banner.t * 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, HEIGHT / 2 - 28, WIDTH, 56);
      ctx.fillStyle = "#ffe27a";
      ctx.font = "bold 24px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.banner.text, WIDTH / 2, HEIGHT / 2);
      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";
    }
  }

  drawBrick(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#8a4b2a";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#a85c34";
    for (let i = 0; i < 4; i++) {
      const yy = y + i * 8;
      const offset = (i % 2) * 8;
      for (let j = -1; j < 3; j++) {
        const xx = x + offset + j * 16;
        ctx.fillRect(xx + 1, yy + 1, 14, 6);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  drawSteel(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#9aa6b2";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#c3ccd6";
    ctx.fillRect(x + 2, y + 2, 12, 12);
    ctx.fillRect(x + 18, y + 2, 12, 12);
    ctx.fillRect(x + 2, y + 18, 12, 12);
    ctx.fillRect(x + 18, y + 18, 12, 12);
    ctx.fillStyle = "#6b7783";
    ctx.fillRect(x + 6, y + 6, 4, 4);
    ctx.fillRect(x + 22, y + 6, 4, 4);
    ctx.fillRect(x + 6, y + 22, 4, 4);
    ctx.fillRect(x + 22, y + 22, 4, 4);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  drawWater(x, y, c, r) {
    const ctx = this.ctx;
    ctx.fillStyle = "#173456";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#2b5f9e";
    for (let i = 0; i < 2; i++) {
      const yy = y + 10 + i * 12;
      const off = Math.sin(this.time * 2 + (c + r) * 0.6 + i) * 4;
      ctx.fillRect(x + 4 + off, yy, 12, 3);
      ctx.fillRect(x + 18 + off, yy + 4, 10, 3);
    }
  }

  drawGrass(x, y, c, r) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1d6b2c";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#2f9440";
    for (let i = 0; i < 7; i++) {
      const px = x + ((c * 7 + i * 13 + r * 5) % TILE);
      const py = y + ((r * 11 + i * 17 + c * 3) % TILE);
      ctx.fillRect(px, py, 3, 5);
      ctx.fillRect(px + 2, py + 2, 3, 4);
    }
  }

  drawBase(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#5a3218";
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 5);
    ctx.lineTo(x + 25, y + 19);
    ctx.lineTo(x + 7, y + 19);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 16, y + 8, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 12);
    ctx.lineTo(x + 1, y + 20);
    ctx.lineTo(x + 10, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 24, y + 12);
    ctx.lineTo(x + 31, y + 20);
    ctx.lineTo(x + 22, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8a6d1f";
    ctx.fillRect(x + 4, y + 21, 24, 7);
  }

  drawTank(tank) {
    const ctx = this.ctx;
    const cx = tank.x + tank.size / 2;
    const cy = tank.y + tank.size / 2;
    const s = tank.size / 24; // 缩放

    // 出生动画
    if (tank.spawnTimer > 0) {
      const k = tank.spawnTimer / 1.2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.time * 10);
      ctx.strokeStyle = "#8ef0ff";
      ctx.lineWidth = 2;
      const R = 4 + (1 - k) * 16;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos((i * Math.PI) / 2) * R, Math.sin((i * Math.PI) / 2) * R);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    const angle = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[tank.dir];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    let body = tank.color;
    if (!tank.isPlayer && tank.flashTimer > 0) body = "#ffffff";
    if (tank.isPlayer && tank.power >= 3) body = "#ffe066";
    if (tank.flashing && Math.floor(this.time * 8) % 2 === 0) body = "#ffffff";

    // 履带
    ctx.fillStyle = "#3a4048";
    ctx.fillRect(-12 * s, -12 * s, 5 * s, 24 * s);
    ctx.fillRect(7 * s, -12 * s, 5 * s, 24 * s);
    // 履带纹路（随移动滚动）
    ctx.fillStyle = "#20252b";
    for (let i = 0; i < 5; i++) {
      const t = ((i * 5 + (tank.trackPhase % 5)) % 24) - 12;
      ctx.fillRect(-12 * s, t * s, 5 * s, 1.6 * s);
      ctx.fillRect(7 * s, t * s, 5 * s, 1.6 * s);
    }

    // 车身
    ctx.fillStyle = body;
    ctx.fillRect(-8 * s, -11 * s, 16 * s, 22 * s);
    // 高光
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(-8 * s, -11 * s, 16 * s, 4 * s);
    // 炮塔
    ctx.fillStyle = tank.isPlayer ? "#3d3d3d" : "#4a4f57";
    ctx.beginPath();
    ctx.arc(0, 0, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();
    // 炮管
    ctx.fillStyle = body;
    const barrel = tank.power >= 2 ? 15 : 13;
    ctx.fillRect(-1.8 * s, -barrel * s, 3.6 * s, barrel * s);
    if (tank.power >= 2) {
      ctx.fillRect(-5.4 * s, -barrel * s, 3 * s, 8 * s);
      ctx.fillRect(2.4 * s, -barrel * s, 3 * s, 8 * s);
    }
    ctx.restore();

    // 护盾
    if (tank.shieldTimer > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(120,220,255,${0.5 + 0.4 * Math.sin(this.time * 12)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 装甲敌人血条
    if (!tank.isPlayer && tank.maxHp > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(tank.x, tank.y - 4, tank.size, 3);
      ctx.fillStyle = "#8ee06a";
      ctx.fillRect(tank.x, tank.y - 4, (tank.size * tank.hp) / tank.maxHp, 3);
    }
  }

  drawPowerup(pu) {
    const ctx = this.ctx;
    const cx = pu.x + 12;
    const cy = pu.y + 12;
    const blink = pu.t < 3 && Math.floor(pu.t * 8) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-12, -12, 24, 24);

    if (pu.type === "star") {
      ctx.fillStyle = "#ffd24a";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 9 : 4;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    } else if (pu.type === "shield") {
      ctx.fillStyle = "#7fd7ff";
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(8, -5);
      ctx.lineTo(8, 3);
      ctx.lineTo(0, 9);
      ctx.lineTo(-8, 3);
      ctx.lineTo(-8, -5);
      ctx.closePath();
      ctx.fill();
    } else if (pu.type === "life") {
      ctx.fillStyle = "#8ee06a";
      ctx.fillRect(-8, -6, 16, 12);
      ctx.fillRect(-2, -10, 4, 6);
    } else if (pu.type === "bomb") {
      ctx.fillStyle = "#ff5a3c";
      ctx.beginPath();
      ctx.arc(0, 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffd24a";
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(5, -11);
      ctx.stroke();
    } else if (pu.type === "clock") {
      ctx.fillStyle = "#8ef0ff";
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -5);
      ctx.moveTo(0, 0);
      ctx.lineTo(4, 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- 音效（WebAudio 合成，无需资源文件） ----------------
  sfx(type) {
    if (!this.soundOn || typeof window === "undefined") return;
    try {
      if (!this.actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.actx = new AC();
      }
      const ctx = this.actx;
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      const mk = (freq, freq2, dur, kind, vol) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = kind;
        o.frequency.setValueAtTime(freq, t);
        if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      };
      switch (type) {
        case "shoot":
          mk(520, 180, 0.08, "square", 0.05);
          break;
        case "hit":
          mk(240, 90, 0.09, "square", 0.06);
          break;
        case "clank":
          mk(1400, 700, 0.05, "triangle", 0.04);
          break;
        case "explode":
          mk(180, 40, 0.28, "sawtooth", 0.09);
          break;
        case "power":
          mk(660, 1320, 0.16, "sine", 0.07);
          break;
        case "clear":
          mk(523, 1046, 0.35, "sine", 0.08);
          break;
        case "over":
          mk(300, 60, 0.7, "sawtooth", 0.1);
          break;
        default:
          break;
      }
    } catch (e) {
      /* 忽略音频错误 */
    }
  }
}
