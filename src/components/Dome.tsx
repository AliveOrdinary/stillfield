import { useEffect, useRef } from 'react';

/*
  The dome. A single full-screen fragment shader on raw WebGL (no three.js):
  the camera stands inside a vast monochrome rotunda, raymarched analytically
  (sphere + floor), with a circular oculus at the crown. Through the oculus:
  the bright, churning noise of the world. Falling from it: a volumetric
  shaft of light — the only thing that moves in the room — landing in a pool
  on the floor where the CTA sits. Decorative only (aria-hidden); all real
  content is server-rendered HTML.
*/

const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uSway;   // eased mouse parallax, [-1,1]

const float R  = 6.0;                       // dome radius
const vec3  OC = vec3(0.0, 6.0, 0.0);       // oculus centre (crown)
const float OR = 0.78;                      // oculus radius
const vec3  LD = normalize(vec3(0.0, -1.0, -0.26)); // light, leaning into the room

// ── noise ──────────────────────────────────────────
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { v += a * vnoise3(p); p *= 2.1; a *= 0.5; }
  return v;
}

// does a surface point see the sun disc through the oculus?
float sunVis(vec3 P) {
  float t = (OC.y - P.y) / (-LD.y);                 // march toward the sky
  vec2 X = P.xz + (-LD.xz) * t;
  return smoothstep(OR + 0.22, OR - 0.30, length(X - OC.xz));
}

// distance from a point to the beam axis, vs the beam's local radius
float beamCore(vec3 P) {
  vec3 w = P - OC;
  float along = dot(w, LD);
  if (along < 0.0) return 0.0;
  float d = length(w - along * LD);
  float rad = OR * (1.0 + 0.07 * along);            // gentle spread
  return smoothstep(rad * 1.9, rad * 0.45, d);
}

float plaster(vec3 P) {
  float az = atan(P.z, P.x);
  float streak = fbm(vec2(az * 2.6, P.y * 0.85));
  float mottle = fbm(P.xz * 1.4 + P.y * 0.7);
  return mix(streak, mottle, 0.5);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // ── camera: standing in the rotunda, looking gently up ──
  vec3 ro = vec3(0.0, 1.7, 3.6);
  vec3 ta = vec3(uSway.x * 0.55, 3.3 - uSway.y * 0.45, -2.5);
  vec3 fw = normalize(ta - ro);
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

  float I = 0.0;       // scalar luminance — the room is monochrome

  if (!floorHit && length(P.xz) < OR * 1.35 && P.y > 0.0) {
    // ── the oculus: the world outside, bright and churning ──
    float d = length(P.xz) / OR;
    float disc = smoothstep(1.06, 0.94, d);
    float churn = fbm(P.xz * 2.4 + vec2(uTime * 0.05, -uTime * 0.032));
    float sky = 1.25 * (0.78 + 0.45 * churn);
    sky *= 0.72 + 0.28 * smoothstep(1.0, 0.25, d);   // limb darkening
    I += disc * sky;
    // rim: the stone edge catches the light
    I += smoothstep(0.13, 0.0, abs(d - 1.0)) * 0.30;
  } else {
    float tex = plaster(P);
    if (floorHit) {
      // ── floor: dark stone, lit by the pool ──
      float base = 0.030 + 0.045 * tex;
      float seam = smoothstep(R, R - 1.6, length(P.xz));   // AO at the wall
      float pool = sunVis(P) * 1.0;
      pool *= 0.82 + 0.36 * fbm(P.xz * 3.0);               // texture in the light
      // faint sheen reflecting the crown, directly under it
      float sheen = 0.05 * smoothstep(3.6, 0.4, length(P.xz - OC.xz));
      I += (base + sheen) * seam + pool;
    } else {
      // ── the vault: plaster catching skylight from the crown ──
      vec3 n = -normalize(P);
      vec3 toO = OC - P;
      float dd = dot(toO, toO);
      float skylight = max(dot(n, toO / sqrt(dd)), 0.0) * (4.3 / dd);
      float base = 0.022 + 0.05 * tex;
      float bounce = 0.012 * max(dot(n, vec3(0.0, -1.0, 0.0)), 0.0); // floor glow
      float sun = sunVis(P) * max(dot(n, -LD), 0.0) * 0.7;
      I += base + skylight * (0.55 + 0.5 * tex) + bounce + sun;
      // courses: the faintest concentric whisper on the vault
      float phi = acos(clamp(normalize(P).y, -1.0, 1.0));
      I += pow(0.5 + 0.5 * cos(phi * 38.0 + tex * 2.0), 8.0) * 0.012;
    }

    // depth: the far side of the room recedes
    I *= mix(1.0, 0.55, clamp((tHit - 4.0) / 14.0, 0.0, 1.0));
  }

  // ── the shaft of light: march the haze inside the beam ──
  float jit = hash(gl_FragCoord.xy + fract(uTime) * 61.7);
  float tMax = min(tHit, 13.0);
  float dt = tMax / 26.0;
  float vol = 0.0;
  for (int i = 0; i < 26; i++) {
    vec3 Q = ro + rd * ((float(i) + jit) * dt);
    float core = beamCore(Q);
    if (core <= 0.001) continue;
    float dust = 0.55 + 0.75 * fbm3(Q * vec3(0.9, 0.45, 0.9)
                  + vec3(uTime * 0.016, -uTime * 0.05, 0.0));
    float fall = exp(-max(dot(Q - OC, LD), 0.0) * 0.10);    // fades as it falls
    vol += core * dust * fall * dt;
  }
  I += vol * 0.20;

  // ── grade: soft knee, vignette, grain ──
  I = 1.0 - exp(-I * 1.5);
  vec2 sc = gl_FragCoord.xy / uRes;
  I *= smoothstep(1.25, 0.45, distance(sc, vec2(0.5, 0.52)));
  I += (hash(gl_FragCoord.xy * 0.71 + floor(uTime * 14.0)) - 0.5) * 0.055;

  vec3 ink = vec3(0.925, 0.949, 0.973);   // cool daylight through the oculus
  vec3 bg  = vec3(0.024, 0.024, 0.027);
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
    const uSway = gl.getUniformLocation(prog, 'uSway');

    // the raymarch is per-pixel heavy — render under-resolution and upscale;
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

    // barely-there parallax + slow breathing drift
    const target = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    const onMove = (e: MouseEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    if (!reduce) window.addEventListener('mousemove', onMove);

    const t0 = performance.now();
    let raf = 0;
    let ready = false;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      eased.x += (target.x - eased.x) * 0.02;
      eased.y += (target.y - eased.y) * 0.02;
      const driftX = reduce ? 0 : Math.sin(t * 0.05) * 0.05;
      const driftY = reduce ? 0 : Math.sin(t * 0.037) * 0.04;
      gl.uniform1f(uTime, reduce ? 0 : t);
      gl.uniform2f(uSway, eased.x * 0.3 + driftX, eased.y * 0.25 + driftY);
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
