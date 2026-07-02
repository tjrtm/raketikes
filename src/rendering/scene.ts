import * as THREE from 'three';
import { S } from '../game/settings';

export class Rendering {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a14);
    this.scene.fog = new THREE.FogExp2(0x070a14, 0.0038);

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

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setFov(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
