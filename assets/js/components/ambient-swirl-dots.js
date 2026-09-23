/**
 * Ambient Swirl Dots Animation (HTML5 Canvas Particle Vortex)
 * Cyclic Animation Lifecycle:
 *  1. APPEAR: 3 seconds (Vivid swirling dots appear)
 *  2. DISAPPEAR: 15 seconds (Fade out, completely hidden)
 *  3. GLOW: 25 seconds (Fade in, ultra-radiant glowing emerald dots with halo rings & bloom)
 *  4. FADE & DISAPPEAR: 15 seconds (Fades out, dormant)
 *  -> Loops continuously
 */
(function () {
    'use strict';

    class SwirlDotsVortex {
        constructor() {
            this.canvas = null;
            this.ctx = null;
            this.dots = [];
            this.vortexes = [];
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.animId = null;
            this.isDark = false;
            this.mouse = { x: this.width * 0.65, y: this.height * 0.45, active: false };
            this.isRunning = true;

            // Cyclic Timeline Configuration (Exact User Specification)
            this.stages = [
                {
                    name: 'appear',
                    duration: 3000,    // 3 seconds appear
                    isGlow: false,
                    isHidden: false,
                    fadeInDuration: 600,
                    fadeOutDuration: 600
                },
                {
                    name: 'disappear_1',
                    duration: 15000,   // 15 seconds disappear
                    isGlow: false,
                    isHidden: true,
                    fadeInDuration: 0,
                    fadeOutDuration: 0
                },
                {
                    name: 'glow',
                    duration: 25000,   // 20-25s (25 seconds) ultra glow
                    isGlow: true,
                    isHidden: false,
                    fadeInDuration: 900,
                    fadeOutDuration: 900
                },
                {
                    name: 'disappear_2',
                    duration: 15000,   // 15 seconds fade out & disappear again
                    isGlow: false,
                    isHidden: true,
                    fadeInDuration: 0,
                    fadeOutDuration: 0
                }
            ];

            this.currentStageIndex = 0;
            this.stageStartTime = performance.now();
            this.currentAlpha = 1.0;
            this.isGlowActive = false;

            this.init();
        }

        init() {
            // Find or create canvas
            this.canvas = document.getElementById('ambientSwirlDotsCanvas');
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.id = 'ambientSwirlDotsCanvas';
                this.canvas.setAttribute('aria-hidden', 'true');

                const wrapper = document.querySelector('.ambient-swirl-canvas') || document.body;
                wrapper.appendChild(this.canvas);
            }

            this.ctx = this.canvas.getContext('2d', { alpha: true });
            if (!this.ctx) return;

            this.updateTheme();
            this.resize();
            this.createVortexes();
            this.createDots();
            this.bindEvents();

            this.stageStartTime = performance.now();
            this.animate();
        }

        updateTheme() {
            const body = document.body;
            const theme = body.getAttribute('data-theme') || localStorage.getItem('cms-theme') || 'light';
            this.isDark = (theme === 'dark');
        }

        resize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);

            this.canvas.width = Math.floor(this.width * this.dpr);
            this.canvas.height = Math.floor(this.height * this.dpr);
            this.canvas.style.width = this.width + 'px';
            this.canvas.style.height = this.height + 'px';

            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.scale(this.dpr, this.dpr);

            if (this.vortexes.length > 0) {
                this.vortexes[0].x = this.width * 0.70;
                this.vortexes[0].y = this.height * 0.38;
                if (this.vortexes[1]) {
                    this.vortexes[1].x = this.width * 0.25;
                    this.vortexes[1].y = this.height * 0.72;
                }
            }
        }

        createVortexes() {
            this.vortexes = [
                {
                    // Primary Vortex: Right-Center
                    x: this.width * 0.70,
                    y: this.height * 0.38,
                    radius: Math.max(this.width, this.height) * 0.60,
                    speed: 0.0009, // Mabagal lang
                    direction: 1 // clockwise
                },
                {
                    // Secondary Vortex: Left-Bottom
                    x: this.width * 0.25,
                    y: this.height * 0.72,
                    radius: Math.max(this.width, this.height) * 0.50,
                    speed: 0.0007, // Mabagal lang
                    direction: -1 // counter-clockwise
                }
            ];
        }

        createDots() {
            // Kontian lang ang bilang ng mga dots (humigit-kumulang 40-52 dots lamang para malinis at hindi masikip)
            const count = Math.min(Math.max(Math.floor((this.width * this.height) / 25000), 38), 52);
            this.dots = [];

            for (let i = 0; i < count; i++) {
                const assignedVortex = i % 2;
                const vortex = this.vortexes[assignedVortex];

                const maxDist = vortex.radius;
                const dist = Math.pow(Math.random(), 0.75) * maxDist + 25;
                const armOffset = (Math.floor(Math.random() * 4) * (Math.PI * 2 / 4));
                const angle = Math.random() * Math.PI * 2 + armOffset;

                // 2.5px to 6.2px for elegant, clear firefly / ember presence
                const baseRadius = 2.5 + Math.random() * 3.5;

                this.dots.push({
                    vortexIndex: assignedVortex,
                    dist: dist,
                    angle: angle,
                    // Mabagal na ikot (Slow, serene majestic swirl motion)
                    angularSpeed: (0.0007 + Math.random() * 0.0008) * (assignedVortex === 0 ? 1 : -1),
                    radius: baseRadius,
                    pulseSpeed: 0.007 + Math.random() * 0.012,
                    pulseVal: Math.random() * Math.PI * 2,
                    colorType: Math.floor(Math.random() * 4),
                    alpha: 0.85 + Math.random() * 0.15,
                    trail: []
                });
            }
        }

        getPalette() {
            if (this.isDark) {
                if (this.isGlowActive) {
                    // Ultra-luminous vibrant glowing tones in dark mode
                    return [
                        'rgba(52, 211, 153, ',  // Bright emerald
                        'rgba(110, 231, 183, ', // Vivid mint neon
                        'rgba(45, 212, 191, ',  // Luminous cyan
                        'rgba(74, 222, 128, '   // Electric spring green
                    ];
                }
                return [
                    'rgba(52, 211, 153, ',
                    'rgba(16, 185, 129, ',
                    'rgba(110, 231, 183, ',
                    'rgba(45, 212, 191, '
                ];
            } else {
                if (this.isGlowActive) {
                    // Ultra-radiant glowing forest & emerald aura in light mode
                    return [
                        'rgba(16, 185, 129, ',  // Electric emerald
                        'rgba(5, 150, 105, ',   // Deep rich jade
                        'rgba(34, 197, 94, ',   // Radiant green
                        'rgba(22, 101, 52, '    // Forest anchor
                    ];
                }
                return [
                    'rgba(22, 101, 52, ',
                    'rgba(16, 140, 85, ',
                    'rgba(5, 150, 105, ',
                    'rgba(44, 94, 71, '
                ];
            }
        }

        bindEvents() {
            window.addEventListener('resize', () => this.resize(), { passive: true });

            window.addEventListener('mousemove', (e) => {
                this.mouse.x = e.clientX;
                this.mouse.y = e.clientY;
                this.mouse.active = true;
            }, { passive: true });

            document.addEventListener('visibilitychange', () => {
                this.isRunning = !document.hidden;
                if (this.isRunning) {
                    this.stageStartTime = performance.now();
                    this.animate();
                }
            });

            // Watch for theme toggle
            const themeObserver = new MutationObserver(() => {
                this.updateTheme();
            });
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
        }

        updateTimeline(now) {
            const currentStage = this.stages[this.currentStageIndex];
            const elapsed = now - this.stageStartTime;

            // Transition to next stage when duration reached
            if (elapsed >= currentStage.duration) {
                this.currentStageIndex = (this.currentStageIndex + 1) % this.stages.length;
                this.stageStartTime = now;
                return this.updateTimeline(now);
            }

            this.isGlowActive = currentStage.isGlow;

            if (currentStage.isHidden) {
                this.currentAlpha = 0.0;
                return;
            }

            // Calculate smooth fade-in and fade-out within the visible stage
            let alpha = 1.0;
            const fadeIn = currentStage.fadeInDuration || 0;
            const fadeOut = currentStage.fadeOutDuration || 0;

            if (fadeIn > 0 && elapsed < fadeIn) {
                alpha = elapsed / fadeIn;
            } else if (fadeOut > 0 && elapsed > (currentStage.duration - fadeOut)) {
                alpha = Math.max(0, (currentStage.duration - elapsed) / fadeOut);
            }

            this.currentAlpha = Math.max(0, Math.min(1, alpha));
        }

        update() {
            const width = this.width;
            const height = this.height;

            if (this.mouse.active) {
                const targetVx = width * 0.70 + (this.mouse.x - width * 0.5) * 0.06;
                const targetVy = height * 0.38 + (this.mouse.y - height * 0.5) * 0.06;
                this.vortexes[0].x += (targetVx - this.vortexes[0].x) * 0.04;
                this.vortexes[0].y += (targetVy - this.vortexes[0].y) * 0.04;
            }

            for (let i = 0; i < this.dots.length; i++) {
                const dot = this.dots[i];
                const vortex = this.vortexes[dot.vortexIndex];

                const distFactor = Math.max(0.35, 1.2 - (dot.dist / vortex.radius) * 0.7);
                dot.angle += dot.angularSpeed * distFactor;

                dot.pulseVal += dot.pulseSpeed;
                const wobble = Math.sin(dot.pulseVal) * (this.isGlowActive ? 12 : 8);
                const currentDist = dot.dist + wobble;

                const x = vortex.x + Math.cos(dot.angle) * currentDist;
                const y = vortex.y + Math.sin(dot.angle) * (currentDist * 0.65);

                dot.x = x;
                dot.y = y;

                dot.trail.push({ x: x, y: y });
                const maxTrail = this.isGlowActive ? 7 : 4;
                if (dot.trail.length > maxTrail) {
                    dot.trail.shift();
                }
            }
        }

        draw() {
            const ctx = this.ctx;

            // Clear canvas completely each frame
            ctx.clearRect(0, 0, this.width, this.height);

            // If in disappear stage or zero alpha, canvas stays totally clear
            if (this.currentAlpha <= 0.005) {
                return;
            }

            const palette = this.getPalette();
            const globalAlpha = this.currentAlpha;
            const isGlow = this.isGlowActive;

            // 1. Draw subtle connecting filaments between close swirling dots
            const maxConnectDist = isGlow ? 120 : 100;
            const maxConnectDistSq = maxConnectDist * maxConnectDist;
            const lineBaseColor = this.isDark
                ? (isGlow ? '110, 231, 183' : '52, 211, 153')
                : (isGlow ? '34, 197, 94' : '16, 140, 85');

            ctx.lineWidth = isGlow ? 1.2 : 0.85;
            for (let i = 0; i < this.dots.length; i += 2) {
                const d1 = this.dots[i];
                if (!d1.x || d1.x < -40 || d1.x > this.width + 40) continue;

                for (let j = i + 1; j < this.dots.length; j += 2) {
                    const d2 = this.dots[j];
                    if (d1.vortexIndex !== d2.vortexIndex) continue;

                    const dx = d1.x - d2.x;
                    const dy = d1.y - d2.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq < maxConnectDistSq) {
                        const baseAlpha = (1 - distSq / maxConnectDistSq) * (isGlow ? 0.45 : 0.22);
                        const finalLineAlpha = baseAlpha * globalAlpha;
                        ctx.strokeStyle = `rgba(${lineBaseColor}, ${finalLineAlpha})`;
                        ctx.beginPath();
                        ctx.moveTo(d1.x, d1.y);
                        ctx.lineTo(d2.x, d2.y);
                        ctx.stroke();
                    }
                }
            }

            // 2. Draw swirling dots, trails, and radiant glow halo
            for (let i = 0; i < this.dots.length; i++) {
                const dot = this.dots[i];
                if (!dot.x) continue;

                const colorPrefix = palette[dot.colorType];
                const pulseScale = isGlow ? 0.28 : 0.16;
                const currentRadius = dot.radius * (0.90 + Math.sin(dot.pulseVal) * pulseScale);
                const finalDotAlpha = dot.alpha * globalAlpha;

                // Motion Trail (comet swirl tail)
                if (dot.trail.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(dot.trail[0].x, dot.trail[0].y);
                    for (let t = 1; t < dot.trail.length; t++) {
                        ctx.lineTo(dot.trail[t].x, dot.trail[t].y);
                    }
                    const trailAlpha = finalDotAlpha * (isGlow ? 0.50 : 0.30);
                    ctx.strokeStyle = colorPrefix + trailAlpha + ')';
                    ctx.lineWidth = currentRadius * (isGlow ? 1.0 : 0.85);
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }

                // GLOW MODE: Draw outer radiant bloom halo
                if (isGlow) {
                    // Outer diffuse bloom halo
                    ctx.beginPath();
                    ctx.arc(dot.x, dot.y, currentRadius * 2.5, 0, Math.PI * 2);
                    const haloAlpha = finalDotAlpha * (this.isDark ? 0.35 : 0.22);
                    ctx.fillStyle = colorPrefix + haloAlpha + ')';
                    ctx.fill();

                    // Canvas shadow glow
                    ctx.shadowColor = colorPrefix + (finalDotAlpha * 0.95) + ')';
                    ctx.shadowBlur = this.isDark ? 22 : 16;
                } else if (this.isDark) {
                    ctx.shadowColor = colorPrefix + (finalDotAlpha * 0.70) + ')';
                    ctx.shadowBlur = 6;
                } else {
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                }

                // Core Swirling Dot
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, currentRadius, 0, Math.PI * 2);
                ctx.fillStyle = colorPrefix + finalDotAlpha + ')';
                ctx.fill();

                // Luminous center spark on dots
                if (isGlow || currentRadius > 3.0) {
                    ctx.beginPath();
                    ctx.arc(dot.x, dot.y, currentRadius * (isGlow ? 0.55 : 0.40), 0, Math.PI * 2);
                    const sparkAlpha = isGlow ? (finalDotAlpha * 0.95) : (finalDotAlpha * 0.75);
                    ctx.fillStyle = this.isDark ? `rgba(255, 255, 255, ${sparkAlpha})` : `rgba(255, 255, 255, ${sparkAlpha * 0.85})`;
                    ctx.fill();
                }
            }

            // Reset shadow blur
            ctx.shadowBlur = 0;
        }

        animate() {
            if (!this.isRunning) return;

            const now = performance.now();
            this.updateTimeline(now);

            // Only update positions and redraw if visible or fading
            if (this.currentAlpha > 0.005) {
                this.update();
                this.draw();
            } else {
                // Completely clear when hidden to save CPU/GPU
                this.ctx.clearRect(0, 0, this.width, this.height);
                this.update(); // Keep vortex rotating in background so it flows seamlessly on next appear
            }

            this.animId = requestAnimationFrame(() => this.animate());
        }
    }

    // Auto boot on DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.ambientSwirlVortex = new SwirlDotsVortex();
        });
    } else {
        window.ambientSwirlVortex = new SwirlDotsVortex();
    }
})();
