/**
 * 灯光系统
 * -------------------------------------------------------------
 * 三点布光（主光 + 辅光 + 轮廓光）+ 半球环境光：
 *  - 主光：平行光，开启阴影，模拟厂房顶部光源
 *  - 辅光：冷色弱填充，消除暗部死黑
 *  - 轮廓光：逆光勾勒机构边缘，提升层次
 *  - 半球光：天地色漫反射，配合 HDR 关闭时的兜底照明
 */
import * as THREE from 'three';

export class LightingRig {
  /**
   * @param {THREE.Scene} scene
   * @param {object} rendererConfig APP_CONFIG.renderer（取阴影贴图尺寸）
   */
  constructor(scene, rendererConfig) {
    this.scene = scene;
    this.rendererConfig = rendererConfig;
    this.group = new THREE.Group();
    this.group.name = 'lighting_rig';
    this.keyLight = null;
  }

  /** 创建并挂载全部光源 */
  setup() {
    // —— 半球环境光：天空浅蓝、地面深灰，提供柔和的环境漫反射 ——
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a2f38, 0.55);
    hemi.name = 'hemi_light';

    // —— 主光：暖色平行光，带软阴影 ——
    this.keyLight = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.keyLight.name = 'key_light';
    this.keyLight.position.set(6, 10, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(
      this.rendererConfig.shadowMapSize,
      this.rendererConfig.shadowMapSize
    );
    // 阴影相机正交范围，覆盖整机活动区域
    const s = 7;
    this.keyLight.shadow.camera.left = -s;
    this.keyLight.shadow.camera.right = s;
    this.keyLight.shadow.camera.top = s;
    this.keyLight.shadow.camera.bottom = -s;
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 30;
    this.keyLight.shadow.bias = -0.0004; // 消除阴影痤疮
    this.keyLight.shadow.radius = 4; // PCFSoft 下的柔和半径
    this.keyLight.target.position.set(0, 0.6, 0);

    // —— 辅光：冷色，无阴影，仅做暗部补光 ——
    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.7);
    fillLight.name = 'fill_light';
    fillLight.position.set(-7, 4, -4);

    // —— 轮廓光：侧后方逆光，强度略高以勾边 ——
    const rimLight = new THREE.DirectionalLight(0xffd9a0, 1.1);
    rimLight.name = 'rim_light';
    rimLight.position.set(-3, 5, -8);

    this.group.add(hemi, this.keyLight, fillLight, rimLight, this.keyLight.target);
    this.scene.add(this.group);
  }

  /**
   * 阴影总开关（性能降级调用）
   * @param {boolean} enabled
   */
  setShadowEnabled(enabled) {
    this.keyLight.castShadow = enabled;
  }
}
