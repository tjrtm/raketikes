import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, VignetteEffect,
} from 'postprocessing';
import { S } from '../game/settings';

/**
 * Renderer + post pipeline. HDR (half-float) frame buffer -> bloom on
 * over-bright neon (HDR MeshBasicMaterial colors > 1 bloom selectively)
 * -> SMAA -> subtle vignette, tone mapped with AgX (better hue retention
 * on saturated neon than ACES). The `postfx` setting drops back to a plain
 * forward render for weak GPUs.
 */
export class Rendering {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  private composer: EffectComposer;

  constructor(canvas: HTMLCanvasElement) {
    // AA comes from SMAA in the composer (the canvas keeps a depth buffer so
    // the plain-render fallback still works when postfx is off)
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a14);
    this.scene.fog = new THREE.FogExp2(0x070a14, 0.0038);

    // image-based lighting so car paint/ball PBR picks up soft reflections (no assets)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(S.cameraFov, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 6, 40);

    this.hemi = new THREE.HemisphereLight(0x93a7ff, 0x2a3450, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    this.sun.position.set(35, 60, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.0, // only HDR (>1) emitters bloom: neon trim, boost, goal glow
      luminanceSmoothing: 0.2,
      intensity: 1.1,
      radius: 0.72,
    });
    this.composer.addPass(new EffectPass(this.camera, bloom, new SMAAEffect(), new VignetteEffect({ darkness: 0.42, offset: 0.28 })));

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    if (S.postfx) {
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
