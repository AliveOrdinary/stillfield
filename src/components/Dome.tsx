import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/*
  The dome interior. A sphere rendered from the inside (BackSide) with the camera
  standing on the floor, so the visitor is *inside* a curved chamber: concentric
  stone courses on the curved surface, a soft oculus at the crown, a dark floor
  with a pool of light. Monochrome, high-contrast. Decorative only (aria-hidden);
  all real content is server-rendered HTML.
*/

const GLSL_NOISE = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return v;
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  varying float vDepth;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  varying float vDepth;

  uniform float uTime;
  uniform float uFreq;
  uniform float uSharp;
  uniform vec3  uInk;
  uniform vec3  uBg;
  uniform float uGrain;
  uniform float uContrast;
  uniform vec2  uRes;
  ${GLSL_NOISE}

  void main() {
    vec3 d = normalize(vDir);
    float phi = acos(clamp(d.y, -1.0, 1.0));    // 0 at the crown, grows downward
    float theta = atan(d.z, d.x);               // azimuth around the vault

    // smooth stereographic frame across the crown (no pole pinch)
    vec2 suv = d.xz / (1.0 + d.y + 0.001);

    // troweled-concrete grain: gentle anisotropic streaks that run *up* the
    // vault (fast around the azimuth, slow up the rise) over a finer mottle
    float streak = fbm(vec2(theta * 5.0, phi * 1.3 - uTime * 0.008));
    float mottle = fbm(suv * 13.0);
    float tex = mix(streak, mottle, 0.55);

    float poleFade = smoothstep(0.0, 0.10, phi);

    // only a whisper of concentric courses, warped by the stone
    float course = pow(0.5 + 0.5 * cos(phi * uFreq + (tex - 0.5) * 1.3), uSharp);
    course *= poleFade;

    // dark recessed crown ringed by a broad, soft halo spilling down the vault
    float crown = smoothstep(0.80, 0.0, phi);
    float halo  = smoothstep(1.75, 0.08, phi);

    // detail carries down to where the wall meets the floor
    float upper = smoothstep(-0.16, 0.40, d.y);

    // assemble — deliberately dim; the texture only just emerges from the dark
    float light = 0.10;
    light += tex * 0.17;
    light += course * 0.045;
    light += pow(halo, 1.4) * 0.11;
    light += crown * 0.05;
    light *= (0.55 + 0.75 * tex);
    light *= upper;

    // atmospheric depth: the far reaches recede and dim
    float depth = clamp((vDepth - 6.0) / 28.0, 0.0, 1.0);
    light = mix(light, light * 0.45, depth);

    // film grain
    light += (hash(gl_FragCoord.xy * 0.7 + floor(uTime * 18.0)) - 0.5) * uGrain * upper;

    // screen-space vignette — edges fall away to black
    vec2 sc = gl_FragCoord.xy / uRes;
    float vig = smoothstep(1.12, 0.32, distance(sc, vec2(0.5, 0.56)));
    light *= vig;

    float I = pow(clamp(light, 0.0, 1.0), uContrast);
    gl_FragColor = vec4(mix(uBg, uInk, I), 1.0);
  }
`;

const floorVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const floorFragment = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform vec3  uInk;
  uniform vec3  uBg;
  uniform float uGrain;
  ${GLSL_NOISE}

  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);

    // polished stone floor — the lightest surface in the room. Brightens toward
    // the far horizon where it meets the wall, dimming back toward the camera.
    float far   = smoothstep(8.5, -9.0, vWorld.z);     // 0 near camera → 1 far
    float sheen = smoothstep(10.0, 0.0, r);

    // faint vertical reflection streaks of the vault drawn across the polish
    float reflect = fbm(vec2(p.x * 0.8, vWorld.z * 0.22 + uTime * 0.012));

    float I = (0.13 + 0.17 * far) * sheen;
    I *= (0.7 + 0.55 * reflect);
    I += (hash(gl_FragCoord.xy * 0.7 + floor(uTime * 18.0)) - 0.5) * uGrain * 0.4;
    I *= smoothstep(10.0, 7.0, r);                     // soft seam with the wall
    gl_FragColor = vec4(mix(uBg, uInk, clamp(I, 0.0, 1.0)), 1.0);
  }
`;

export default function Dome() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    // standing on the floor, looking forward and a little up
    const camera = new THREE.PerspectiveCamera(82, 1, 0.1, 100);
    camera.position.set(0, 1.6, 8.5);
    const lookTarget = new THREE.Vector3(0, 4.4, 0.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x030304, 1);
    host.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uFreq: { value: 26.0 },
      uSharp: { value: 3.0 },
      uInk: { value: new THREE.Color(0xf4f2ee) },
      uBg: { value: new THREE.Color(0x030304) },
      uGrain: { value: 0.09 },
      uContrast: { value: 1.25 },
      uRes: { value: new THREE.Vector2(1, 1) },
    };

    // icosphere: uniform triangles, no pole vertex → no spoke at the crown
    const geometry = new THREE.IcosahedronGeometry(10, 6);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
    });
    const dome = new THREE.Mesh(geometry, material);
    dome.scale.y = 2.4;            // tall, tapered vault so the upper courses
                                   // keep receding in perspective like the lower
    scene.add(dome);

    // floor disc
    const floorGeo = new THREE.CircleGeometry(10, 96);
    const floorMat = new THREE.ShaderMaterial({
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
      uniforms,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const resize = () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(w * dpr, h * dpr);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // barely-there mouse parallax
    const target = new THREE.Vector2(0, 0);
    const eased = new THREE.Vector2(0, 0);
    const onMove = (e: MouseEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    if (!reduce) window.addEventListener('mousemove', onMove);

    const clock = new THREE.Clock();
    let raf = 0;
    let ready = false;
    const markReady = () => {
      if (ready) return;
      ready = true;
      host.classList.add('is-ready');
    };
    const render = () => {
      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;
      eased.x += (target.x - eased.x) * 0.02;
      eased.y += (target.y - eased.y) * 0.02;
      const driftX = reduce ? 0 : Math.sin(t * 0.04) * 0.008;
      const driftY = reduce ? 0 : Math.sin(t * 0.031) * 0.005;
      camera.lookAt(
        lookTarget.x + eased.x * 0.1 + driftX * 5,
        lookTarget.y - eased.y * 0.08 + driftY * 5,
        lookTarget.z,
      );
      renderer.render(scene, camera);
      markReady();
      raf = requestAnimationFrame(render);
    };

    if (reduce) {
      camera.lookAt(lookTarget);
      renderer.render(scene, camera);
      markReady();
    } else {
      raf = requestAnimationFrame(render);
    }

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduce) {
        raf = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      geometry.dispose();
      material.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="dome-canvas" ref={hostRef} aria-hidden="true" />;
}
