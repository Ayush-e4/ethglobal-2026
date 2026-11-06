/**
 * The payment-success burst: confetti and sparks thrown from where the money landed, drawn with
 * WebGL2 on one full-screen canvas. Every particle's path is worked out in the vertex shader from
 * the time alone (velocity with air drag, then gravity), so the CPU only sets one number a frame.
 * The canvas exists only while the burst plays (about 1.8 s), then it's gone. No WebGL2 or the
 * person asked for reduced motion: nothing is drawn (the success mark still shows).
 */

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_vel;
in vec4 a_col;
in vec4 a_misc; // size, spin, life, shape
uniform float u_t;
uniform vec2 u_res;
uniform float u_dpr;
out vec4 v_col;
out float v_ang;
out float v_shape;
void main() {
  float life = a_misc.z;
  float t = min(u_t, life);
  float drag = 3.2;
  vec2 p = a_pos + a_vel * (1.0 - exp(-drag * t)) / drag + vec2(0.0, 520.0) * t * t * 0.5;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float fade = 1.0 - smoothstep(life * 0.55, life, u_t);
  float grow = smoothstep(0.0, 0.08, u_t);
  gl_PointSize = a_misc.x * u_dpr * grow * (0.55 + 0.45 * fade);
  v_col = vec4(a_col.rgb, a_col.a * fade);
  v_ang = a_misc.y * t;
  v_shape = a_misc.w;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec4 v_col;
in float v_ang;
in float v_shape;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(v_ang);
  float k = cos(v_ang);
  vec2 r = vec2(k * c.x - s * c.y, s * c.x + k * c.y);
  float a;
  if (v_shape > 0.5) {
    // A paper strip turning over: its width shrinks and grows like a flip.
    float flip = 0.08 + 0.2 * abs(cos(v_ang * 1.6));
    vec2 q = abs(r) - vec2(0.44, flip);
    a = 1.0 - smoothstep(0.0, 0.05, max(q.x, q.y));
  } else {
    a = 1.0 - smoothstep(0.18, 0.5, length(c));
  }
  float alpha = v_col.a * a;
  o = vec4(v_col.rgb * alpha, alpha);
}`;

// Shikigami's teal and saffron, success green, USDC blue, and gold for the sparks.
const PALETTE: [number, number, number][] = [
  [0.055, 0.353, 0.392],
  [0.949, 0.639, 0.227],
  [0.067, 0.451, 0.294],
  [0.153, 0.459, 0.792],
  [0.247, 0.714, 0.659],
];
const GOLD: [number, number, number] = [1, 0.82, 0.4];

const PER = 12; // floats per particle

function particles(x: number, y: number, n: number) {
  const data = new Float32Array(n * PER);
  for (let i = 0; i < n; i++) {
    const spark = i % 4 === 0;
    // Mostly outwards and up: a fountain, not a ring.
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (spark ? 2 : 1.55);
    const speed = (spark ? 900 : 520) * (0.35 + Math.random() * 0.75);
    const col = spark ? GOLD : (PALETTE[i % PALETTE.length] ?? GOLD);
    data.set(
      [
        x + (Math.random() - 0.5) * 24,
        y + (Math.random() - 0.5) * 24,
        Math.cos(ang) * speed,
        Math.sin(ang) * speed,
        col[0],
        col[1],
        col[2],
        1,
        spark ? 5 + Math.random() * 5 : 11 + Math.random() * 9,
        (Math.random() - 0.5) * 18,
        spark ? 0.6 + Math.random() * 0.5 : 1.1 + Math.random() * 0.7,
        spark ? 0 : 1,
      ],
      i * PER,
    );
  }
  return data;
}

function program(gl: WebGL2RenderingContext) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "");
  return p;
}

let lastAt = 0;

/** Throws the burst from `from` (an element's centre, or a point); safe to call anywhere. */
export function celebrate(from?: Element | { x: number; y: number } | null) {
  try {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    if (now - lastAt < 600) return; // one burst per moment (React may run an effect twice)
    lastAt = now;

    const w = window.innerWidth;
    const h = window.innerHeight;
    let x = w / 2;
    let y = h * 0.4;
    if (from instanceof Element) {
      const r = from.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (from) ({ x, y } = from);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.cssText = `position:fixed;inset:0;width:${w}px;height:${h}px;pointer-events:none;z-index:9999`;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
    if (!gl) return;
    document.body.append(canvas);

    const p = program(gl);
    const bindProgram = gl.useProgram.bind(gl); // (a WebGL call, not a React hook)
    bindProgram(p);
    const n = w < 500 ? 150 : 220;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, particles(x, y, n), gl.STATIC_DRAW);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, PER * 4, offset * 4);
    };
    attr("a_pos", 2, 0);
    attr("a_vel", 2, 2);
    attr("a_col", 4, 4);
    attr("a_misc", 4, 8);
    const uT = gl.getUniformLocation(p, "u_t");
    gl.uniform2f(gl.getUniformLocation(p, "u_res"), w, h);
    gl.uniform1f(gl.getUniformLocation(p, "u_dpr"), dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const start = performance.now();
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      if (t > 1.9 || document.visibilityState !== "visible") {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        canvas.remove();
        return;
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.POINTS, 0, n);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch {}
}
