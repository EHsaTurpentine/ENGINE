// Full-colour browser runtime for THE LEGEND OF WHEMBEE.
// The original Playdate Lua runs unchanged inside wasmoon.  shim.lua maps the Playdate API onto
// the __j_* functions below; this file draws in colour on a 1600x960 canvas (4 canvas pixels per
// logical 400x240 pixel), plays the chiptunes through WebAudio and handles input.  skin.js adds the
// painted rooms, sprites and UI on top, and skin.lua swaps the game's drawing code for them.
(function () {
    'use strict';
    const W = 400, H = 240, S = 4;
    const DATA = window.WHEMBEE_DATA;
    const ASSETS = window.CASSETS || { sprites: {}, tiles: {} };

    // ------------------------------------------------------------------
    // Palette for any code still drawing in black and white
    // ------------------------------------------------------------------
    const THEME = { ink: '#1d1830', paper: '#f2e7c9', bg: '#f2e7c9' };

    // ------------------------------------------------------------------
    // Surfaces: a canvas whose context is scaled so we draw in logical pixels
    // ------------------------------------------------------------------
    function Surface(lw, lh, canvas) {
        this.lw = lw; this.lh = lh;
        this.cv = canvas || document.createElement('canvas');
        this.cv.width = Math.max(1, Math.round(lw * S));
        this.cv.height = Math.max(1, Math.round(lh * S));
        this.ctx = this.cv.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;
        this.tint = {};
    }
    const mainCanvas = document.createElement('canvas');
    const screen = new Surface(W, H, mainCanvas);
    const images = [];        // Lua image ids -> { cv, lw, lh, surf }
    let target = screen;

    function freshState() { return { fill: THEME.ink, alpha: 1, lw: 1, ox: 0, oy: 0, mode: 0, clear: false }; }
    let st = freshState();
    const ctxStack = [];

    function colorOf(c) { return c === 0 ? THEME.ink : c === 1 ? THEME.paper : THEME.paper; }
    function setColor(c) { st.fill = colorOf(c); st.alpha = 1; st.clear = c === 2; }
    function setHex(hex) { st.fill = hex; st.alpha = 1; st.clear = false; }
    function setDitherPattern(alpha) { st.alpha = 1 - Math.max(0, Math.min(1, alpha)); }

    function begin() {
        const c = target.ctx;
        c.setTransform(S, 0, 0, S, st.ox * S, st.oy * S);
        c.globalAlpha = st.alpha;
        c.fillStyle = st.fill;
        c.strokeStyle = st.fill;
        c.lineWidth = Math.max(1, st.lw);
        return c;
    }
    const T = Math.trunc;

    function fillRect(x, y, w, h) {
        if (w <= 0 || h <= 0) return;
        const c = begin();
        c.fillRect(T(x), T(y), T(w), T(h));
    }
    function drawRect(x, y, w, h) {
        const c = begin();
        const lw = Math.max(1, T(st.lw));
        c.lineWidth = lw;
        c.strokeRect(T(x) + lw / 2, T(y) + lw / 2, T(w) - lw, T(h) - lw);
    }
    function drawLine(x1, y1, x2, y2) {
        const c = begin();
        c.beginPath();
        c.moveTo(x1 + 0.5, y1 + 0.5);
        c.lineTo(x2 + 0.5, y2 + 0.5);
        c.stroke();
    }
    function polyPath(c, a) {
        c.beginPath();
        for (let i = 0; i + 1 < a.length; i += 2) {
            if (i === 0) c.moveTo(a[i], a[i + 1]); else c.lineTo(a[i], a[i + 1]);
        }
        c.closePath();
    }
    function ellipse(c, x, y, w, h) {
        c.beginPath();
        c.ellipse(x + w / 2, y + h / 2, Math.max(0.01, w / 2), Math.max(0.01, h / 2), 0, 0, Math.PI * 2);
    }
    function roundRect(c, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    // ------------------------------------------------------------------
    // Images.  A Lua image is { cv, lw, lh }: its canvas is lw*S x lh*S for generated ones,
    // or the art's own resolution for loaded sprites (drawn scaled to lw x lh logical pixels).
    // ------------------------------------------------------------------
    const spriteImgs = {};   // name -> HTMLImageElement
    function loadSprite(name) {
        return new Promise((res) => {
            const meta = ASSETS.sprites[name];
            if (!meta) return res();
            const im = new Image();
            im.onload = () => { spriteImgs[name] = im; res(); };
            im.onerror = () => { console.warn('missing sprite', meta.file); res(); };
            im.src = meta.file;
        });
    }
    const tileImgs = {};
    function loadTile(name, src) {
        return new Promise((res) => {
            const im = new Image();
            im.onload = () => { tileImgs[name] = im; res(); };
            im.onerror = () => { console.warn('missing image', src); res(); };
            im.src = src;
        });
    }

    // Fallback for sprites with no colour art yet: the 1-bit original in the theme colours.
    function packedToCanvas(entry) {
        const [w, h, b64] = entry;
        const bin = atob(b64);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        const id = c.createImageData(w, h);
        const ink = [0x1d, 0x18, 0x30], pap = [0xf2, 0xe7, 0xc9];
        for (let i = 0; i < w * h; i++) {
            const v = bin.charCodeAt(i), col = v === 0 ? ink : pap;
            id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2];
            id.data[i * 4 + 3] = v === 2 ? 0 : 255;
        }
        c.putImageData(id, 0, 0);
        return cv;
    }

    function newImage(o) { images.push(o); return images.length - 1; }

    function drawImg(img, x, y, flip) {
        const c = target.ctx;
        const m = st.mode;
        c.setTransform(S, 0, 0, S, st.ox * S, st.oy * S);
        c.globalAlpha = st.alpha;
        c.imageSmoothingEnabled = false;
        let src = img.cv;
        if (m === 3 || m === 4 || m === 7) src = tinted(img, m === 4 ? THEME.ink : THEME.paper);
        const fx = flip === 1 || flip === 3, fy = flip === 2 || flip === 3;
        if (fx || fy) {
            c.save();
            c.translate(x + (fx ? img.lw : 0), y + (fy ? img.lh : 0));
            c.scale(fx ? -1 : 1, fy ? -1 : 1);
            c.drawImage(src, 0, 0, img.lw, img.lh);
            c.restore();
        } else {
            c.drawImage(src, T(x), T(y), img.lw, img.lh);
        }
    }
    function tinted(img, color) {
        let t = img.tint[color];
        if (!t) {
            t = document.createElement('canvas');
            t.width = img.cv.width; t.height = img.cv.height;
            const c = t.getContext('2d');
            c.drawImage(img.cv, 0, 0);
            c.globalCompositeOperation = 'source-in';
            c.fillStyle = color;
            c.fillRect(0, 0, t.width, t.height);
            img.tint[color] = t;
        }
        return t;
    }

    // ------------------------------------------------------------------
    // Text: Press Start 2P, 7 logical px tall; *bold* spans are drawn gold with a dark shadow
    // ------------------------------------------------------------------
    const FONT_LOGICAL = 7, LINE_H = 18;
    const FONT = `${FONT_LOGICAL * S}px "Press Start 2P", "Courier New", monospace`;
    const meas = document.createElement('canvas').getContext('2d');
    function parseRuns(text, bold) {
        const runs = [];
        let cur = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '*') {
                if (text[i + 1] === '*') { cur += '*'; i++; continue; }
                if (cur) runs.push([cur, bold]);
                cur = '';
                bold = !bold;
            } else cur += ch;
        }
        if (cur) runs.push([cur, bold]);
        return { runs, bold };
    }
    function plainWidth(s) { return s.length * FONT_LOGICAL; }
    function lineWidth(text) {
        let w = 0;
        for (const [t] of parseRuns(text, false).runs) w += plainWidth(t);
        return w;
    }
    function textWidth(text) {
        let w = 0;
        for (const line of String(text).split('\n')) w = Math.max(w, lineWidth(line));
        return w;
    }
    function textHeight(text) { return String(text).split('\n').length * LINE_H; }

    function drawLineText(text, x, y, bold) {
        const c = target.ctx;
        c.setTransform(S, 0, 0, S, st.ox * S, st.oy * S);
        c.font = FONT;
        c.textBaseline = 'top';
        c.imageSmoothingEnabled = false;
        const onDark = st.mode === 3 || st.mode === 7;
        const base = onDark ? THEME.paper : THEME.ink;
        const parsed = parseRuns(text, bold);
        let cx = T(x);
        const cy = T(y) + 3;
        for (const [s, b] of parsed.runs) {
            const col = b ? (onDark ? '#ffd84a' : '#9c3b12') : base;
            // draw at canvas resolution: text is laid out in logical units, scaled up
            c.save();
            c.scale(1 / S, 1 / S);
            if (onDark || b) {
                c.globalAlpha = 0.85;
                c.fillStyle = onDark ? '#05030d' : '#f2e7c9';
                c.fillText(s, cx * S + 3, cy * S + 3);
            }
            c.globalAlpha = 1;
            c.fillStyle = col;
            c.fillText(s, cx * S, cy * S);
            c.restore();
            cx += plainWidth(s);
        }
        return parsed.bold;
    }
    function drawText(text, x, y) {
        let bold = false;
        String(text).split('\n').forEach((line, i) => { bold = drawLineText(line, x, y + i * LINE_H, bold); });
    }
    function drawTextAligned(text, x, y, align) {
        let bold = false;
        String(text).split('\n').forEach((line, i) => {
            const w = lineWidth(line);
            const lx = align === 2 ? x - w / 2 : align === 1 ? x - w : x;
            bold = drawLineText(line, Math.round(lx), y + i * LINE_H, bold);
        });
    }
    function drawTextInRect(text, x, y, w, h, align) {
        const lines = [];
        for (const para of String(text).split('\n')) {
            let line = '';
            for (const word of para.split(' ')) {
                const trial = line ? line + ' ' + word : word;
                if (line && lineWidth(trial) > w) { lines.push(line); line = word; } else line = trial;
            }
            lines.push(line);
        }
        let bold = false;
        lines.forEach((line, i) => {
            if ((i + 1) * LINE_H > h + 4) return;
            const lw = lineWidth(line);
            const lx = align === 2 ? x + (w - lw) / 2 : align === 1 ? x + w - lw : x;
            bold = drawLineText(line, Math.round(lx), y + i * LINE_H, bold);
        });
    }

    // ------------------------------------------------------------------
    // Input: held buttons, edge detection per frame, and the crank
    // ------------------------------------------------------------------
    const KEYMAP = {
        ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8,
        KeyZ: 16, KeyJ: 16, ShiftLeft: 16, Backspace: 16,
        KeyX: 32, KeyK: 32, Space: 32, Enter: 32,
    };
    let held = 0, pending = 0, cur = 0, prev = 0, just = 0, released = 0;
    let crankKeys = 0, crankPending = 0, crankFrame = 0, crankPos = 0;
    const CRANK_KEY_SPEED = 20;
    function press(mask) { held |= mask; pending |= mask; }
    function release(mask) { held &= ~mask; }
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyE') { crankKeys = 1; e.preventDefault(); return; }
        if (e.code === 'KeyQ') { crankKeys = -1; e.preventDefault(); return; }
        const m = KEYMAP[e.code];
        if (m) { e.preventDefault(); if (!e.repeat) press(m); }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'KeyE' || e.code === 'KeyQ') { crankKeys = 0; return; }
        const m = KEYMAP[e.code];
        if (m) release(m);
    });
    window.addEventListener('blur', () => { held = 0; crankKeys = 0; });
    function stepInput() {
        cur = held | pending;
        just = (cur & ~prev) | pending;
        released = prev & ~cur;
        prev = held;
        pending = 0;
        crankFrame = crankPending + crankKeys * CRANK_KEY_SPEED;
        crankPending = 0;
        crankPos = ((crankPos + crankFrame) % 360 + 360) % 360;
        PD.onCrankMoved && PD.onCrankMoved(crankPos);
    }

    // ------------------------------------------------------------------
    // Audio
    // ------------------------------------------------------------------
    let actx = null, master = null, noiseBuf = null, mGain = null, sGain = null, reverb = null;
    const synths = [], insts = [], tracks = [], seqs = [];
    let audioMuted = false;

    function makeReverb() {
        const len = Math.floor(actx.sampleRate * 1.3);
        const buf = actx.createBuffer(2, len, actx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        const conv = actx.createConvolver();
        conv.buffer = buf;
        return conv;
    }
    function ensureAudio() {
        try {
            if (!actx) {
                actx = new (window.AudioContext || window.webkitAudioContext)();
                master = actx.createGain();
                master.gain.value = audioMuted ? 0 : 0.6;
                const comp = actx.createDynamicsCompressor();
                master.connect(comp);
                comp.connect(actx.destination);
                reverb = makeReverb();
                const wet = actx.createGain();
                wet.gain.value = 0.22;
                reverb.connect(wet);
                wet.connect(master);
                noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
                const d = noiseBuf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            }
            if (actx.state === 'suspended') actx.resume();
        } catch (e) { console.warn('audio unavailable', e); }
    }
    const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
    function synthNew(w) {
        synths.push({ wave: WAVES[w] || 'square', vol: 1, a: 0, d: 0.1, s: 1, r: 0.05, cur: null });
        return synths.length - 1;
    }
    function cutVoice(v, t) {
        if (!v || v.end <= t) return;
        try {
            if (v.gain.gain.cancelAndHoldAtTime) v.gain.gain.cancelAndHoldAtTime(t);
            else v.gain.gain.cancelScheduledValues(t);
            v.gain.gain.linearRampToValueAtTime(0, t + 0.006);
            v.src.stop(t + 0.01);
            v.end = t + 0.01;
        } catch (e) { /* already stopped */ }
    }
    function musicBus() {
        if (!mGain) {
            mGain = actx.createGain(); mGain.gain.value = 0.8; mGain.connect(master);
            const send = actx.createGain(); send.gain.value = 0.5; mGain.connect(send); send.connect(reverb);
        }
        return mGain;
    }
    function sfxBus() { if (!sGain) { sGain = actx.createGain(); sGain.gain.value = 1; sGain.connect(master); } return sGain; }
    function playSynth(id, freq, vel, len, when, owner) {
        if (!actx || actx.state !== 'running') return null;
        const s = synths[id];
        if (!s) return null;
        const t = Math.max(when || 0, actx.currentTime);
        cutVoice(s.cur, t);
        let src;
        if (s.wave === 'noise') {
            src = actx.createBufferSource();
            src.buffer = noiseBuf; src.loop = true;
            src.playbackRate.value = Math.max(0.1, Math.min(4, freq / 261.63));
        } else {
            src = actx.createOscillator();
            src.type = s.wave;
            src.frequency.value = freq;
            if (owner === 'music' && s.wave === 'square') src.detune.value = (id % 2 ? 6 : -6); // a touch of chorus
        }
        const g = actx.createGain();
        const peak = Math.max(0, s.vol * vel * (s.wave === 'square' ? 0.6 : 1));
        const a = Math.max(0.001, s.a), d = Math.max(0.001, s.d), r = Math.max(0.005, s.r);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + a);
        g.gain.linearRampToValueAtTime(peak * s.s, t + a + d);
        const hold = len > 0 ? Math.max(len, a + d) : 1.5;
        g.gain.setValueAtTime(peak * s.s, t + hold);
        g.gain.linearRampToValueAtTime(0, t + hold + r);
        let node = src;
        if (owner === 'music' && s.wave === 'square') {
            const lp = actx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 3200;
            src.connect(lp); node = lp;
        }
        node.connect(g);
        g.connect(owner === 'music' ? musicBus() : sfxBus());
        src.start(t);
        const end = t + hold + r + 0.02;
        src.stop(end);
        const v = { src, gain: g, end };
        s.cur = v;
        return v;
    }
    const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const velOf = (v) => v > 1 ? v / 127 : v;
    function instNew() { insts.push({ voices: [], vol: 1 }); return insts.length - 1; }
    function seqNew() {
        seqs.push({ tempo: 4, tracks: [], loopStart: 1, loopEnd: 0, loops: -1, playing: false, step: 1, next: 0, voices: [] });
        return seqs.length - 1;
    }
    function seqLength(q) {
        let n = 0;
        for (const tid of q.tracks) for (const nt of tracks[tid].notes) n = Math.max(n, nt.step + Math.max(1, Math.ceil(nt.len)) - 1);
        return n;
    }
    function seqPump() {
        if (!actx || actx.state !== 'running') return;
        const horizon = actx.currentTime + 0.15;
        for (const q of seqs) {
            if (!q.playing) continue;
            const dur = 1 / q.tempo;
            const last = q.loops >= 0 && q.loopEnd > 0 ? q.loopEnd : q.len;
            while (q.next < horizon && q.playing) {
                if (q.next < actx.currentTime - 0.25) q.next = actx.currentTime;
                for (const tid of q.tracks) {
                    const tr = tracks[tid];
                    const inst = insts[tr.inst];
                    if (!inst) continue;
                    const list = tr.byStep.get(q.step);
                    if (!list) continue;
                    for (const nt of list) {
                        for (const sid of inst.voices) {
                            const v = playSynth(sid, midiHz(nt.note), velOf(nt.vel) * inst.vol, nt.len * dur, q.next, 'music');
                            if (v) q.voices.push(v);
                        }
                    }
                }
                q.cur = q.step;
                q.step++;
                q.next += dur;
                if (q.step > last) {
                    if (q.loops === 0 || q.loopsLeft > 0) {
                        if (q.loops > 0) q.loopsLeft--;
                        q.step = q.loopStart;
                    } else q.playing = false;
                }
            }
            if (q.voices.length > 64) q.voices = q.voices.filter((v) => v.end > actx.currentTime);
        }
    }
    setInterval(seqPump, 25);

    // ------------------------------------------------------------------
    // Functions exposed to Lua as __j_<name>
    // ------------------------------------------------------------------
    let t0 = performance.now();
    let refreshRate = 30;
    const menu = [];
    const J = {
        clear(c) {
            const ctx = target.ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            if (c === 2 && target !== screen) { ctx.clearRect(0, 0, target.cv.width, target.cv.height); return; }
            ctx.fillStyle = c === 0 ? THEME.ink : THEME.bg;
            ctx.fillRect(0, 0, target.cv.width, target.cv.height);
        },
        setColor, setHex, setDitherPattern,
        setLineWidth(w) { st.lw = w; },
        setDrawOffset(x, y) { st.ox = T(x || 0); st.oy = T(y || 0); },
        getDrawOffsetX() { return st.ox; },
        getDrawOffsetY() { return st.oy; },
        setImageDrawMode(m) { st.mode = m; },
        setBackgroundColor() { },
        fillRect, drawRect, drawLine,
        drawPixel(x, y) { fillRect(x, y, 1, 1); },
        fillCircleAtPoint(x, y, r) { const c = begin(); ellipse(c, x - r, y - r, r * 2, r * 2); c.fill(); },
        drawCircleAtPoint(x, y, r) { const c = begin(); ellipse(c, x - r + 0.5, y - r + 0.5, r * 2, r * 2); c.stroke(); },
        fillEllipseInRect(x, y, w, h) { const c = begin(); ellipse(c, x, y, w, h); c.fill(); },
        drawEllipseInRect(x, y, w, h) { const c = begin(); ellipse(c, x + 0.5, y + 0.5, w, h); c.stroke(); },
        fillTriangle(...a) { const c = begin(); polyPath(c, a); c.fill(); },
        drawTriangle(...a) { const c = begin(); polyPath(c, a); c.stroke(); },
        fillPolygon(...a) { const c = begin(); polyPath(c, a); c.fill(); },
        drawPolygon(...a) { const c = begin(); polyPath(c, a); c.stroke(); },
        fillRoundRect(x, y, w, h, r) { const c = begin(); roundRect(c, x, y, w, h, r); c.fill(); },
        drawRoundRect(x, y, w, h, r) { const c = begin(); roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r); c.stroke(); },

        drawText, drawTextAligned, drawTextInRect, textWidth, textHeight,
        fontHeight() { return LINE_H; },

        imgLoad(path) {
            const key = String(path).replace(/\.png$/, '');
            const name = key.replace(/^images\//, '');
            const orig = DATA.images[key];
            const meta = ASSETS.sprites[name];
            const lw = orig ? orig[0] : (meta ? meta.w : 16), lh = orig ? orig[1] : (meta ? meta.h : 16);
            if (spriteImgs[name]) return newImage({ cv: spriteImgs[name], lw: meta.w || lw, lh: meta.h || lh, tint: {}, name });
            if (orig) return newImage({ cv: packedToCanvas(orig), lw, lh, tint: {}, name });
            console.warn('missing image', path);
            return -1;
        },
        imgNew(w, h, c) {
            const s = new Surface(T(w), T(h));
            if (c !== 2) { s.ctx.fillStyle = c === 0 ? THEME.ink : THEME.paper; s.ctx.fillRect(0, 0, s.cv.width, s.cv.height); }
            return newImage({ cv: s.cv, lw: s.lw, lh: s.lh, surf: s, tint: {} });
        },
        imgW(id) { return images[id].lw; },
        imgH(id) { return images[id].lh; },
        imgDraw(id, x, y, flip) { drawImg(images[id], x, y, flip); },
        imgClear(id, c) { const s = images[id].surf; if (s) { s.ctx.setTransform(1, 0, 0, 1, 0, 0); s.ctx.clearRect(0, 0, s.cv.width, s.cv.height); } },
        imgScaled(id, sx, sy) {
            const im = images[id];
            const s = new Surface(Math.max(1, Math.round(im.lw * sx)), Math.max(1, Math.round(im.lh * sy)));
            s.ctx.imageSmoothingEnabled = false;
            s.ctx.drawImage(im.cv, 0, 0, s.cv.width, s.cv.height);
            return newImage({ cv: s.cv, lw: s.lw, lh: s.lh, surf: s, tint: {} });
        },
        pushContext(id) {
            ctxStack.push({ st, target });
            st = freshState();
            target = id >= 0 && images[id].surf ? images[id].surf : screen;
        },
        popContext() {
            const c = ctxStack.pop();
            if (c) { st = c.st; target = c.target; }
        },

        buttonIsPressed(m) { return (cur & m) !== 0; },
        buttonJustPressed(m) { return (just & m) !== 0; },
        buttonJustReleased(m) { return (released & m) !== 0; },
        crankChange() { return crankFrame; },
        crankPosition() { return crankPos; },
        millis() { return Math.floor(performance.now() - t0); },
        epoch() { return Math.floor(Date.now() / 1000) - 946684800; },
        setRefreshRate(r) { refreshRate = r > 0 ? Math.min(50, r) : 30; },
        menuAdd(i, title, value) { menu.push({ i, title, value }); PD.onMenu && PD.onMenu(menu); },

        synthNew,
        synthSetVolume(id, v) { synths[id].vol = v; },
        synthSetADSR(id, a, d, s, r) { Object.assign(synths[id], { a, d, s, r }); },
        synthPlay(id, note, vel, len) { playSynth(id, midiHz(note), velOf(vel), len, 0, 'sfx'); },
        synthPlayFreq(id, f, vel, len) { playSynth(id, f, velOf(vel), len, 0, 'sfx'); },
        synthOff(id) { if (actx) cutVoice(synths[id].cur, actx.currentTime); },
        instNew,
        instAddVoice(i, s) { insts[i].voices.push(s); },
        instSetVolume(i, v) { insts[i].vol = v; },
        seqNew,
        seqSetTempo(id, t) { seqs[id].tempo = t; },
        seqAddTrack(id) {
            tracks.push({ inst: -1, notes: [], byStep: new Map() });
            seqs[id].tracks.push(tracks.length - 1);
            return tracks.length - 1;
        },
        trackSetInst(t, i) { tracks[t].inst = i; },
        trackAddNote(t, step, note, len, vel) {
            const n = { step, note, len, vel };
            tracks[t].notes.push(n);
            const m = tracks[t].byStep;
            if (!m.has(step)) m.set(step, []);
            m.get(step).push(n);
        },
        seqSetLoops(id, a, b, n) { Object.assign(seqs[id], { loopStart: a, loopEnd: b, loops: n }); },
        seqPlay(id) {
            const q = seqs[id];
            q.len = seqLength(q);
            if (q.loops >= 0 && q.loopEnd <= 0) q.loopEnd = q.len;
            q.loopsLeft = q.loops > 0 ? q.loops : 0;
            q.step = 1;
            q.playing = true;
            q.next = actx ? actx.currentTime + 0.03 : 0;
            seqPump();
        },
        seqStop(id) {
            const q = seqs[id];
            q.playing = false;
            if (actx) for (const v of q.voices) cutVoice(v, actx.currentTime);
            q.voices = [];
        },
        seqIsPlaying(id) { return seqs[id].playing ? 1 : 0; },
        seqStep(id) { return seqs[id].cur || 1; },

        source(name) {
            const src = DATA.lua[name];
            return src === undefined ? '' : translateLua(src);
        },
        sourceFewerLocals(name) {
            return J.source(name).replace(/^local function ([A-Za-z_]\w*)\s*\(/gm, 'function $1(');
        },
        luaError(msg) { PD.onError(msg); },
    };

    // Playdate Lua adds compound assignment (a += b).  Rewrite it to plain Lua: a = a + (b).
    function translateLua(src) {
        src = src.replace(/^﻿/, '');
        return src.split('\n').map(translateLine).join('\n');
    }
    const LHS = /([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^\]\n]+\])*)\s*([+\-*\/%])=(?!=)/g;
    function translateLine(line) {
        if (!/[+\-*\/%]=/.test(line)) return line;
        let res = '', pos = 0;
        LHS.lastIndex = 0;
        let m;
        while ((m = LHS.exec(line)) !== null) {
            const before = line.slice(pos, m.index);
            if (inStringOrComment(line, m.index)) continue;
            const start = m.index + m[0].length;
            const end = rhsEnd(line, start);
            res += before + `${m[1]} = ${m[1]} ${m[2]} (${line.slice(start, end).trim()})`;
            pos = end;
            LHS.lastIndex = end;
        }
        return res + line.slice(pos);
    }
    function inStringOrComment(line, idx) {
        let q = null;
        for (let i = 0; i < idx; i++) {
            const c = line[i];
            if (q) { if (c === '\\') i++; else if (c === q) q = null; }
            else if (c === '"' || c === "'") q = c;
            else if (c === '-' && line[i + 1] === '-') return true;
        }
        return q !== null;
    }
    function rhsEnd(line, i) {
        let depth = 0, q = null;
        for (; i < line.length; i++) {
            const c = line[i];
            if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
            if (c === '"' || c === "'") { q = c; continue; }
            if (c === '(' || c === '{' || c === '[') depth++;
            else if (c === ')' || c === '}' || c === ']') depth--;
            else if (depth === 0) {
                if (c === ';') return i;
                if (c === '-' && line[i + 1] === '-') return i;
                if (/\s/.test(c)) {
                    const rest = line.slice(i + 1);
                    if (/^(end|else|elseif|then|do|local|return|if|for|while)\b/.test(rest)) return i;
                }
            }
        }
        return line.length;
    }

    // ------------------------------------------------------------------
    // Boot and frame loop
    // ------------------------------------------------------------------
    let lua = null, frameFn = null, running = false, failed = false;
    let lastT = 0, acc = 0;
    let shown = null, sctx = null;

    function present() {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.drawImage(mainCanvas, 0, 0);
    }
    function tick() {
        stepInput();
        PD.frames++;
        st = freshState();
        target = screen;
        ctxStack.length = 0;
        const t = performance.now();
        let ok;
        try { ok = frameFn(); } catch (e) { PD.onError(String(e && e.stack || e)); ok = false; }
        PD.busyMs += performance.now() - t;
        if (ok === false) running = false;
        return ok !== false;
    }
    function loop(now) {
        if (!running) return;
        const step = 1000 / refreshRate;
        acc += Math.min(250, now - lastT);
        lastT = now;
        let n = 0;
        while (acc >= step && n < 3 && running) {
            acc -= step;
            n++;
            tick();
        }
        if (n > 0) present();
        if (running) requestAnimationFrame(loop);
    }

    const PD = {
        frames: 0, busyMs: 0, S, J, THEME, images, tileImgs, spriteImgs, Surface,
        get screen() { return screen; },
        get target() { return target; },
        S_: S,
        onError(msg) { failed = true; running = false; console.error(msg); },
        onMenu: null,
        onCrankMoved: null,
        // let skin.js add Lua-callable functions
        extend(fns) { Object.assign(J, fns); },
        advance(n, buttons) {
            for (let i = 0; i < (n || 1) && running; i++) {
                if (buttons !== undefined) { pending |= buttons & ~held; held = buttons; }
                tick();
            }
            if (buttons !== undefined) held = 0;
            present();
        },
        async init(canvas) {
            shown = canvas;
            canvas.width = W * S; canvas.height = H * S;
            sctx = canvas.getContext('2d');
            sctx.imageSmoothingEnabled = false;
            try { await document.fonts.load(`${FONT_LOGICAL * S}px "Press Start 2P"`); } catch (e) { /* fallback font */ }
            await Promise.all([
                ...Object.keys(ASSETS.sprites).map(loadSprite),
                ...Object.entries(ASSETS.tiles).map(([k, v]) => loadTile('tiles/' + k, v)),
                ...Object.entries(ASSETS.rooms || {}).map(([k, v]) => loadTile('rooms/' + k, v)),
                ...Object.entries(ASSETS.scenes || {}).map(([k, v]) => loadTile('scenes/' + k, v)),
            ]);
            if (PD.onAssets) PD.onAssets();
            if (PD.drawLaunch) PD.drawLaunch(screen);
            present();
            const bin = atob(window.WASMOON_WASM_B64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
            const factory = new window.wasmoon.LuaFactory(url);
            lua = await factory.createEngine({ injectObjects: false, enableProxy: false });
            for (const [k, fn] of Object.entries(J)) lua.global.set('__j_' + k, fn);
            await lua.doString(DATA.shim);
        },
        start() {
            ensureAudio();
            t0 = performance.now();
            const boot = lua.global.get('__boot');
            let ok;
            try { ok = boot(); } catch (e) { PD.onError(String(e && e.stack || e)); return; }
            if (ok === false || failed) return;
            frameFn = lua.global.get('__frame');
            running = true;
            lastT = performance.now();
            acc = 1000 / refreshRate;
            requestAnimationFrame(loop);
        },
        ensureAudio, press, release,
        addCrank(deg) { crankPending += deg; },
        toggleMenu(i, on) {
            const fn = lua && lua.global.get('__menuToggle');
            if (fn) fn(i, on ? 1 : 0);
        },
        setMuted(m) { audioMuted = m; if (master) master.gain.value = m ? 0 : 0.6; },
        runLua(code) { return lua.doStringSync(code); },
        translateLua,
    };
    window.PD = PD;
})();
