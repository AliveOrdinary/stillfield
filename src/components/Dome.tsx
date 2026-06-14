import { useEffect, useRef } from 'react';

/*
  The dome. A single full-screen fragment shader on raw WebGL (no three.js):
  the camera stands inside a vast, sealed, black rotunda — no opening, no
  sky. The only light in the room is the lamp: a low glow at the Register
  pill's position on the floor, lighting the chamber from below and falling
  to true black overhead. The camera never moves — the room is dead still;
  the only motion is the lamp's slow breathing, and its swell when the
  pointer nears the button. Decorative only (aria-hidden); all real content
  is server-rendered HTML.
*/

const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uGlow;   // lamp energy: boot ramp × pointer proximity, 0..1

// ── the room: a true rotunda ──
// one continuous tall ellipsoid: walls rise steeply from the floor (radius
// RC) and curve over into a dome at the crown (height RY). A single smooth
// surface — no drum/dome join, so no seam line on the wall.
const float RC = 6.0;                      // room radius at the floor
const float RY = 10.0;                     // crown height (taller than wide → dome)
const vec3  LP = vec3(0.0, 0.62, -3.6);    // the lamp: low over the far floor,
                                           // projected dead-centre behind the
                                           // pill on the horizon; its bright
                                           // core stays hidden by the button

// ── noise ──────────────────────────────────────────
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
// high-quality per-pixel hash for the film grain (Dave Hoskins). The cheap
// hash() above has a visible lattice when frozen — this one is clean noise.
float grain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// troweled-plaster height field: a long sweeping stroke under a finer
// tooth. A gentle domain warp keeps it organic — never a regular stripe.
float surf(vec2 uv) {
  uv += (fbm(uv * 0.9 + 17.0) - 0.5) * 0.7;          // warp the strokes
  return fbm(uv * vec2(0.8, 1.25)) * 0.60 + fbm(uv * 3.6) * 0.40;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // ── camera: standing in the rotunda, fixed ──
  vec3 ro = vec3(0.0, 1.7, 4.6);
  vec3 fw = normalize(vec3(0.0, 3.6, -2.5) - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + (uv.x * rt + uv.y * up) * 0.95);  // ~87° fov

  // ── analytic interior hits: floor + the ellipsoid wall, nearest wins ──
  float tFl = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;

  // ellipsoid: solve in unit-sphere space (scale y by RC/RY), far root
  vec3 sc3 = vec3(1.0 / RC, 1.0 / RY, 1.0 / RC);
  vec3 roS = ro * sc3;
  vec3 rdS = rd * sc3;
  float a = dot(rdS, rdS);
  float b = dot(roS, rdS);
  float c = dot(roS, roS) - 1.0;
  float disc = b * b - a * c;
  float tWall = disc > 0.0 ? (-b + sqrt(disc)) / a : 1e9;

  bool floorHit = tFl < tWall;
  float tHit = floorHit ? tFl : tWall;
  vec3 P = ro + rd * tHit;

  // ── surface frame: normal + tangent basis + texture coords ──
  vec3 n, tu, tv;
  vec2 suv;
  if (floorHit) {
    n = vec3(0.0, 1.0, 0.0);
    tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0);
    suv = P.xz * 0.42;
  } else {
    n = -normalize(P * sc3 * sc3);                    // inward ellipsoid normal
    float azm = atan(P.z, P.x);
    tu = normalize(vec3(-sin(azm), 0.0, cos(azm)));   // around
    tv = normalize(cross(n, tu));                     // up the vault
    suv = vec2(azm * RC, P.y) * 0.42;                 // continuous everywhere
  }

  // bump: perturb the normal by the plaster gradient, so the lamp's
  // grazing light catches real micro-relief (the cure for "artificial")
  float e = 0.05;
  float h0 = surf(suv);
  float hu = surf(suv + vec2(e, 0.0));
  float hv = surf(suv + vec2(0.0, e));
  float bumpAmp = floorHit ? 0.05 : 0.22;
  n = normalize(n - (tu * (hu - h0) + tv * (hv - h0)) / e * bumpAmp);

  float albedo = floorHit ? 0.42 + 0.30 * h0 : 0.60 + 0.40 * h0;

  // lamp energy: slow breathing on top of the proximity swell
  float E = uGlow * (1.0 + 0.05 * sin(uTime * 0.45));

  vec3 toL = LP - P;
  float d2 = dot(toL, toL) + 0.03;
  vec3 L = toL * inversesqrt(d2);
  float lam = max(dot(n, L), 0.0);
  // softer-than-physical falloff so the lamp's rake reaches the far wall
  float K = floorHit ? 0.55 : 0.80;
  float I = albedo * lam * E * K / pow(d2, 0.72);

  if (!floorHit) {
    // the crown recedes to night-black even when the lamp swells
    I *= mix(1.0, 0.18, smoothstep(2.5, 7.5, P.y));
    // thin contact occlusion at the floor seam, glow still continuous
    I *= 0.80 + 0.20 * smoothstep(0.0, 0.5, P.y);
  } else {
    // honed stone: the lamp reflects as a vertical streak running toward
    // the viewer — narrow across, long in depth, like moonlight on water.
    // The streak (not a round pool) is what reads the floor as flat.
    vec3 hlf = normalize(L + normalize(ro - P));
    vec2 dxz = P.xz - LP.xz;
    float streak = exp(-(abs(dxz.x) * 1.15 + abs(dxz.y) * 0.20));
    I += E * 0.34 * pow(max(dot(n, hlf), 0.0), 40.0) * streak;
  }

  // ambient spill: enough for the seam arc and the lower vault to emerge
  I += albedo * E * 0.05 * exp(-d2 * 0.022);

  // depth: the far side of the room recedes
  I *= mix(1.0, 0.5, clamp((tHit - 4.0) / 16.0, 0.0, 1.0));

  // ── the lamp's halo: a soft sphere of light in the air ──
  vec3 w = LP - ro;
  float tc = dot(w, rd);
  if (tc > 0.0 && tc < tHit + 0.5) {
    float h2 = dot(w, w) - tc * tc;
    I += E * 0.016 / (0.012 + h2 * 3.2);
  }

  // ── grade: hard knee — true white at the lamp, true black above ──
  I = 1.0 - exp(-I * 1.7);
  vec2 sc = gl_FragCoord.xy / uRes;
  I *= smoothstep(1.35, 0.5, distance(sc, vec2(0.5, 0.55)));
  // static film grain + a touch more in the shadows to break 8-bit
  // banding. Fixed (no per-frame reseed) so the still room never shimmers.
  float g = grain(gl_FragCoord.xy) - 0.5;
  I += g * (0.022 + 0.030 * (1.0 - smoothstep(0.0, 0.30, I)));

  vec3 ink = vec3(0.945, 0.945, 0.953);
  vec3 bg  = vec3(0.012, 0.012, 0.014);
  gl_FragColor = vec4(mix(bg, ink, clamp(I, 0.0, 1.0)), 1.0);
}
`;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export default function Dome() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        host.dataset.glerr = gl.getShaderInfoLog(sh) ?? 'compile failed';
        console.error('Dome shader:', host.dataset.glerr);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      host.dataset.glerr = gl.getProgramInfoLog(prog) ?? 'link failed';
      return;
    }
    gl.useProgram(prog);

    // one full-screen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uGlow = gl.getUniformLocation(prog, 'uGlow');

    // render at device resolution — under-resolution + CSS upscale beats
    // against the screen grid and shows as interlacing in the dark gradient
    const SCALE = 1.0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * SCALE;
      canvas.width = Math.round(host.clientWidth * dpr);
      canvas.height = Math.round(host.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    // "the light notices you": lamp swells as the pointer nears the
    // Register pill. No parallax — the room itself never moves.
    const pill = document.querySelector<HTMLElement>('.register');
    // ?lit pins the lamp at full glow (for OG/screenshot renders)
    const lit = new URLSearchParams(location.search).has('lit');
    let prox = lit ? 1 : 0;  // 0 far → 1 on the button
    let proxEased = 0;
    const onMove = (e: MouseEvent) => {
      if (!pill || lit) return;
      const r = pill.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const reach = Math.min(window.innerWidth, window.innerHeight) * 0.55;
      prox = Math.max(0, 1 - Math.hypot(dx, dy) / reach);
    };
    if (!reduce) window.addEventListener('mousemove', onMove);

    const t0 = performance.now();
    let raf = 0;
    let ready = false;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      proxEased += (prox - proxEased) * 0.03;
      const boot = reduce ? 1 : Math.min(1, t / 2.2);        // the lamp ignites
      gl.uniform1f(uTime, reduce ? 0 : t);
      gl.uniform1f(uGlow, boot * boot * (0.62 + 0.38 * proxEased));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!ready) { ready = true; host.classList.add('is-ready'); }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      canvas.remove();
    };
  }, []);

  return <div className="dome-canvas" ref={hostRef} aria-hidden="true" />;
}
