"use client";

import { useEffect, useRef } from "react";

/**
 * The chirp, made visible: a WebGL2 orb whose edge follows what the microphone hears across the
 * chirp band (1.9–6.4 kHz) in real time. Each of 16 bands pushes out its own part of the rim, so
 * a chirp ripples the orb and a quiet room leaves it breathing. When a request is heard it warms
 * to saffron. One fragment shader on a small canvas; no WebGL2 or reduced motion: a soft pulse.
 */
const BANDS = 16;

const VERT = `#version 300 es
in vec2 a_p;
out vec2 v_uv;
void main() { v_uv = a_p; gl_Position = vec4(a_p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_t;
uniform float u_heard;
uniform float u_b[${BANDS}];
out vec4 o;
float band(float a) {
  // The rim goes once round the bands and back, so it meets itself without a seam.
  float x = abs(fract(a / 6.2831853 + 0.5) * 2.0 - 1.0) * float(${BANDS - 1});
  int i = int(floor(x));
  int j = min(i + 1, ${BANDS - 1});
  return mix(u_b[i], u_b[j], smoothstep(0.0, 1.0, fract(x)));
}
void main() {
  vec2 p = v_uv;
  float r = length(p);
  float a = atan(p.y, p.x);
  float s = a + u_t * 0.35;
  // Averaged with its neighbours, so the rim stays a soft blob, never a jagged star.
  float b = (band(s - 0.22) + 2.0 * band(s) + band(s + 0.22)) * 0.25;
  float breathe = 0.02 * sin(u_t * 1.6) + 0.012 * sin(a * 3.0 + u_t * 1.1);
  float R = 0.5 + breathe + 0.18 * b;
  vec3 teal = vec3(0.055, 0.353, 0.392);
  vec3 mint = vec3(0.247, 0.714, 0.659);
  vec3 saffron = vec3(0.949, 0.639, 0.227);
  vec3 core = mix(mix(mint, teal, smoothstep(0.0, R, r)), saffron, u_heard * 0.85);
  float inside = 1.0 - smoothstep(R - 0.012, R + 0.012, r);
  // Rings moving outwards, like sound.
  float rings = 0.5 + 0.5 * sin(r * 34.0 - u_t * 7.0);
  float glow = exp(-max(r - R, 0.0) * 9.0) * (0.35 + 0.65 * b) * (1.0 - inside);
  vec3 col = core * (0.82 + 0.18 * rings * inside) ;
  float alpha = inside + glow * 0.6;
  vec3 halo = mix(mint, saffron, u_heard);
  vec3 outc = mix(halo, col, inside);
  o = vec4(outc * alpha, alpha);
}`;

export function ListenOrb({
  levels,
  heard,
  size = 200,
}: {
  levels: () => number[] | null;
  heard: boolean;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const read = useRef(levels);
  read.current = levels;
  const heardNow = useRef(heard);
  heardNow.current = heard;
  const fallback = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = !still ? c?.getContext("webgl2", { premultipliedAlpha: true }) : null;
    if (!c || !gl) {
      if (c) c.style.display = "none";
      if (fallback.current) fallback.current.style.display = "block";
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = Math.round(size * dpr);
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("shader");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      c.style.display = "none";
      if (fallback.current) fallback.current.style.display = "block";
      return;
    }
    const bindProgram = gl.useProgram.bind(gl); // (a WebGL call, not a React hook)
    bindProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, c.width, c.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const uT = gl.getUniformLocation(prog, "u_t");
    const uH = gl.getUniformLocation(prog, "u_heard");
    const uB = gl.getUniformLocation(prog, "u_b");

    const smooth = new Float32Array(BANDS);
    let warm = 0;
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.visibilityState !== "visible") return;
      const now = read.current() ?? [];
      for (let i = 0; i < BANDS; i++) {
        const v = now[i] ?? 0;
        // Quick to rise, slow to fall: a chirp snaps the rim out, then it settles.
        smooth[i] += (v - (smooth[i] ?? 0)) * (v > (smooth[i] ?? 0) ? 0.5 : 0.08);
      }
      warm += ((heardNow.current ? 1 : 0) - warm) * 0.06;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, (performance.now() - start) / 1000);
      gl.uniform1f(uH, warm);
      gl.uniform1fv(uB, smooth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [size]);

  return (
    <span
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <canvas ref={canvas} aria-hidden style={{ width: size, height: size }} />
      <span
        ref={fallback}
        aria-hidden
        className="hidden size-24 animate-pulse rounded-full bg-teal-soft ring-8 ring-teal-soft/50"
      />
    </span>
  );
}
