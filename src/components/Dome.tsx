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
  ${GLSL_NOISE}

  void main() {
    vec3 d = normalize(vDir);
    float phi = acos(clamp(d.y, -1.0, 1.0));    // 0 at the crown

    // stone texture in a stereographic frame — smooth across the crown
    vec2 suv = d.xz / (1.0 + d.y + 0.001);
    float tex = fbm(suv * 9.0 + vec2(0.0, uTime * 0.015));

    float poleFade = smoothstep(0.0, 0.14, phi);

    // concentric courses, slightly warped by the stone
    float course = pow(0.5 + 0.5 * cos(phi * uFreq + (tex - 0.5) * 1.1), uSharp);
    course *= poleFade;

    // soft oculus at the crown + a broad misty halo spilling down from it
    float crown = pow(smoothstep(1.05, 0.0, phi), 2.0);
    float haze = smoothstep(1.7, 0.0, phi);

    // the dome carries detail down toward the horizon, where it meets the floor
    float upper = smoothstep(-0.12, 0.42, d.y);

    float light = course * (0.34 + 0.95 * crown);
    light += crown * 0.75;
    light += pow(haze, 1.6) * 0.12;
    light *= (0.45 + 0.95 * tex);
    light *= upper;

    // atmospheric depth: the far reaches (apex, back wall) recede and dim
    float depth = clamp((vDepth - 6.0) / 26.0, 0.0, 1.0);
    light = mix(light, light * 0.6, depth);

    // film grain
    light += (hash(gl_FragCoord.xy * 0.7 + floor(uTime * 18.0)) - 0.5) * uGrain * upper;

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
    float pool = pow(smoothstep(9.0, 0.0, r), 1.8);
    float tex = fbm(p * 0.6 + vec2(0.0, uTime * 0.01));
    float I = pool * (0.5 + 0.7 * tex) * 0.32;
    I += (hash(gl_FragCoord.xy * 0.7 + floor(uTime * 18.0)) - 0.5) * uGrain * 0.5;
    I *= smoothstep(10.0, 7.0, r);
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
    renderer.setClearColor(0x040405, 1);
    host.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uFreq: { value: 40.0 },
      uSharp: { value: 5.5 },
      uInk: { value: new THREE.Color(0xf4f2ee) },
      uBg: { value: new THREE.Color(0x040405) },
      uGrain: { value: 0.12 },
      uContrast: { value: 1.5 },
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
