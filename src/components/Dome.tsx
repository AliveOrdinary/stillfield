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

const float R  = 6.0;                     // dome radius
const vec3  LP = vec3(0.0, 0.62, -3.6);   // the lamp: hovering low over the
                                          // far floor, projected dead-centre
                                          // behind the pill on the horizon —
                                          // its bright core must stay hidden
                                          // by the button

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

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // ── camera: standing in the rotunda, fixed ──
  vec3 ro = vec3(0.0, 1.7, 3.6);
  vec3 fw = normalize(vec3(0.0, 3.3, -2.5) - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + (uv.x * rt + uv.y * up) * 0.95);  // ~87° fov

  // ── analytic hits: sphere (from inside) and floor ──
  float b = dot(ro, rd);
  float tSph = -b + sqrt(max(b * b - (dot(ro, ro) - R * R), 0.0));
  float tFl  = rd.y < -0.001 ? -ro.y / rd.y : 1e5;
  bool floorHit = tFl < tSph;
  float tHit = floorHit ? tFl : tSph;
  vec3 P = ro + rd * tHit;

  // lamp energy: slow breathing on top of the proximity swell
  float E = uGlow * (1.0 + 0.05 * sin(uTime * 0.45));

  // ── material: troweled plaster and honed stone — a medium mottle
  // under a fine tooth, present but never smoky ──
  vec3 n = floorHit ? vec3(0.0, 1.0, 0.0) : -normalize(P);
  float az = atan(P.z, P.x);
  float tex = floorHit
    ? fbm(P.xz * 1.7) * 0.45 + fbm(P.xz * 6.5) * 0.55
    : fbm(vec2(az * 3.2, P.y * 1.1)) * 0.45 + fbm(vec2(az * 9.0, P.y * 3.2)) * 0.55;
  float albedo = floorHit ? 0.40 + 0.34 * tex : 0.62 + 0.38 * tex;

  vec3 toL = LP - P;
  float d2 = dot(toL, toL) + 0.03;
  float lam = max(dot(n, toL * inversesqrt(d2)), 0.0);
  // softer-than-physical falloff so the lamp's rake reaches the far wall
  float K = floorHit ? 0.55 : 0.80;
  float I = albedo * lam * E * K / pow(d2, 0.72);

  if (!floorHit) {
    // the crown stays night-black even when the lamp swells
    I *= mix(1.0, 0.25, smoothstep(1.6, 4.8, P.y));
    // light contact occlusion where the wall meets the floor — kept thin
    // so the glow stays continuous across the seam
    I *= 0.78 + 0.22 * smoothstep(0.0, 0.45, P.y);
  } else {
    // polished stone: the lamp reflects toward the viewer, the smear
    // widening and dying off with distance from the lamp
    vec3 h = normalize(toL * inversesqrt(d2) + normalize(ro - P));
    I += E * 0.32 * pow(max(h.y, 0.0), 60.0) * exp(-length(P.xz - LP.xz) * 0.30);
  }

  // ambient spill: enough for the seam arc and the lower vault to emerge
  I += albedo * E * 0.05 * exp(-d2 * 0.022);

  // depth: the far side of the room recedes
  I *= mix(1.0, 0.5, clamp((tHit - 4.0) / 14.0, 0.0, 1.0));

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
  I += (hash(gl_FragCoord.xy * 0.71 + floor(uTime * 14.0)) - 0.5) * 0.04;

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

    // per-pixel shading — render under-resolution and upscale;
    // the film grain hides it completely
    const SCALE = 0.7;
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
