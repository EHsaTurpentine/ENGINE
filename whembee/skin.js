// Colour-skin helpers for engine.js: painted rooms and full-screen scenes, shadows and glows.
(function () {
    'use strict';
    const PD = window.PD, S = PD.S;
    const roomCache = new Map();

    PD.extend({
        // A painted room as a Lua image (400x224 logical), or -1 if none was generated.
        roomImage(level, idx) {
            const key = `rooms/L${level}_R${idx}`;
            if (roomCache.has(key)) return roomCache.get(key);
            const src = PD.tileImgs[key];
            let id = -1;
            if (src) {
                const surf = new PD.Surface(400, 224);
                surf.ctx.imageSmoothingEnabled = false;   // art is 2 px per logical px: integer scale stays crisp
                surf.ctx.drawImage(src, 0, 0, surf.cv.width, surf.cv.height);
                id = PD.images.push({ cv: surf.cv, lw: 400, lh: 224, surf, tint: {} }) - 1;
            }
            roomCache.set(key, id);
            return id;
        },
        hasScene(name) { return PD.tileImgs['scenes/' + name] ? 1 : 0; },
        // Draw a painted scene stretched over a logical rect (the current draw offset applies).
        sceneDraw(name, x, y, w, h, alpha) {
            const im = PD.tileImgs['scenes/' + name];
            if (!im) return;
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            c.globalAlpha = alpha === undefined ? 1 : alpha;
            c.imageSmoothingEnabled = false;
            c.drawImage(im, x, y, w, h);
            c.globalAlpha = 1;
        },
        // soft elliptical contact shadow (logical coords; the context is already scaled by S)
        shadow(cx, cy, w, h, a) {
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            const g = c.createRadialGradient(cx, cy, 0.5, cx, cy, w / 2);
            g.addColorStop(0, `rgba(10,6,24,${a})`);
            g.addColorStop(1, 'rgba(10,6,24,0)');
            c.save();
            c.translate(cx, cy);
            c.scale(1, h / w);
            c.translate(-cx, -cy);
            c.fillStyle = g;
            c.fillRect(cx - w / 2, cy - w / 2, w, w);
            c.restore();
        },
        // vertical gradient rect: top colour -> bottom colour
        gradRect(x, y, w, h, c1, c2, alpha) {
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            const g = c.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, c1); g.addColorStop(1, c2);
            c.globalAlpha = alpha === undefined ? 1 : alpha;
            c.fillStyle = g;
            c.fillRect(x, y, w, h);
            c.globalAlpha = 1;
        },
        // radial glow
        glow(cx, cy, r, color, alpha) {
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
            c.globalAlpha = alpha === undefined ? 1 : alpha;
            c.fillStyle = g;
            c.fillRect(cx - r, cy - r, r * 2, r * 2);
            c.globalAlpha = 1;
        },
        // draw a sprite by asset name at logical (x,y) bottom-centred, optional flip and alpha
        spriteAt(name, cx, bottom, flip, alpha) {
            const im = PD.spriteImgs[name];
            const meta = (window.CASSETS.sprites || {})[name];
            if (!im || !meta) return 0;
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            c.globalAlpha = alpha === undefined ? 1 : alpha;
            const x = Math.round(cx - meta.w / 2), y = Math.round(bottom - meta.h);
            if (flip) {
                c.save(); c.translate(x + meta.w, y); c.scale(-1, 1);
                c.drawImage(im, 0, 0, meta.w, meta.h); c.restore();
            } else c.drawImage(im, x, y, meta.w, meta.h);
            c.globalAlpha = 1;
            return 1;
        },
        // rounded dark panel with a gold frame (logical coords)
        panel(x, y, w, h, alpha, gold) {
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            const rr = (inset, r) => {
                const x0 = x + inset, y0 = y + inset, w0 = w - inset * 2, h0 = h - inset * 2;
                c.beginPath();
                c.moveTo(x0 + r, y0); c.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r); c.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r);
                c.arcTo(x0, y0 + h0, x0, y0, r); c.arcTo(x0, y0, x0 + w0, y0, r); c.closePath();
            };
            const g = c.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, '#2c2354'); g.addColorStop(1, '#150f29');
            c.globalAlpha = alpha === undefined ? 0.94 : alpha;
            rr(0, 4); c.fillStyle = g; c.fill();
            c.globalAlpha = 1;
            rr(0.5, 4); c.lineWidth = 1.5; c.strokeStyle = gold === 0 ? '#6d5fa6' : '#e8b93c'; c.stroke();
            rr(2, 3); c.lineWidth = 0.6; c.strokeStyle = '#6d5fa6'; c.stroke();
        },
        // big outlined display text, centred on cx (logical coords, size in logical px)
        bigText(text, cx, y, size, c1, c2, outline) {
            const c = PD.target.ctx;
            c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
            c.font = `${size}px "Press Start 2P", monospace`;
            c.textAlign = 'center'; c.textBaseline = 'top';
            c.lineJoin = 'round';
            c.lineWidth = Math.max(2, size * 0.3);
            c.strokeStyle = outline || '#1a0f2e';
            c.strokeText(text, cx, y + size * 0.14);
            c.strokeText(text, cx, y);
            const g = c.createLinearGradient(0, y, 0, y + size);
            g.addColorStop(0, c1 || '#fff2a8'); g.addColorStop(1, c2 || '#f0a020');
            c.fillStyle = g;
            c.fillText(text, cx, y);
            c.textAlign = 'left';
        },
        hasSprite(name) { return PD.spriteImgs[name] ? 1 : 0; },
    });

    // splash shown before the first click: the title painting and logo
    PD.drawLaunch = (screen) => {
        const prev = PD.target;
        const c = screen.ctx;
        c.setTransform(S, 0, 0, S, PD.J.getDrawOffsetX() * S, PD.J.getDrawOffsetY() * S);
        const bg = PD.tileImgs['scenes/title'];
        if (bg) { c.imageSmoothingEnabled = false; c.drawImage(bg, 0, 0, 400, 240); }
        else {
            const g = c.createLinearGradient(0, 0, 0, 240);
            g.addColorStop(0, '#2b2160'); g.addColorStop(1, '#8a3b5c');
            c.fillStyle = g; c.fillRect(0, 0, 400, 240);
        }
        PD.J.bigText && 0;
        const J = PD.J;
        const savedTarget = PD.target;
        J.bigText('THE LEGEND OF', 200, 16, 9, '#ffffff', '#bfd6ff', '#14102a');
        J.bigText('WHEMBEE', 200, 30, 30, '#fff2a8', '#f0a020', '#2a1146');
    };
})();
