/**
 * GLTF/GLB 模型远程加载器
 * -------------------------------------------------------------
 * - 通过 URL 远程加载模型，模型文件不内嵌、不打包进 JS Bundle
 * - 支持 .gltf / .glb，可选 DRACO 压缩（解码器走公共 CDN）
 * - 加载进度回调驱动启动遮罩进度条
 * - 失败时按配置回退到内置程序化模型，保证教学页面始终可用
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { logger } from '../core/Logger.js';
import { ProceduralModel } from './ProceduralModel.js';

/** 归一化后模型包围盒的目标最大边长（场景单位） */
const TARGET_MAX_DIM = 6;

export class ModelLoader {
  /**
   * @param {object} config APP_CONFIG
   */
  constructor(config) {
    this.config = config;
    this.gltfLoader = new GLTFLoader();

    // DRACO 解码器远程加载（仅压缩模型实际需要时才会发起请求）
    const draco = new DRACOLoader();
    draco.setDecoderPath(config.dracoDecoderPath);
    this.gltfLoader.setDRACOLoader(draco);
  }

  /**
   * 加载模型
   * @param {(percent:number, text:string)=>void} onProgress 进度回调
   * @returns {Promise<{root:THREE.Group, isFallback:boolean}>}
   */
  async load(onProgress) {
    const url = this.config.modelUrl;
    try {
      onProgress?.(8, `正在远程下载模型：${url}`);
      logger.info(`开始远程加载 GLTF 模型：${url}`);

      // 预检：先 fetch 确认资源存在且为模型数据。
      // 作用：① 服务器对缺失文件返回 SPA 首页 HTML 时，GLTFLoader 内部会产生
      // 逃逸的异步 TypeError（解析扩展时读取 undefined.image），预检可绕开该库缺陷；
      // ② 给出更准确的中文错误提示。
      await this._preflight(url);
      onProgress?.(30, '模型资源校验通过，正在解析 GLTF…');

      const gltf = await this.gltfLoader.loadAsync(url, (event) => {
        if (event.total > 0) {
          const percent = 30 + Math.round((event.loaded / event.total) * 62);
          onProgress?.(
            percent,
            `模型下载中 ${(event.loaded / 1048576).toFixed(1)} / ${(event.total / 1048576).toFixed(1)} MB`
          );
        } else {
          onProgress?.(55, '模型数据流传输中…');
        }
      });

      const root = gltf.scene;
      root.name = root.name || 'coffee_cup_machine';
      this._prepareMeshes(root);
      onProgress?.(92, '模型解析完成，正在注册部件…');
      logger.info('GLTF 模型加载成功');
      return { root, isFallback: false };
    } catch (err) {
      if (!this.config.fallbackToProcedural) throw err;
      logger.warn(`远程模型加载失败（${err.message || err}），启用程序化兜底模型`);
      onProgress?.(60, '远程模型不可用，正在构建程序化教学模型…');
      const root = ProceduralModel.build();
      logger.warn('当前显示为程序化兜底模型，部件命名与正式 GLTF 模型完全一致，可无缝替换');
      return { root, isFallback: true };
    }
  }

  /**
   * 模型资源预检
   * - HTTP 状态必须 2xx
   * - GLB 二进制以魔数 0x46546C67（ASCII "glTF"）开头
   * - .gltf JSON 以 { 开头（允许 BOM/空白）
   * 不符合时抛出带中文说明的错误，由上层切换兜底模型
   */
  async _preflight(url) {
    let resp;
    try {
      resp = await fetch(url, { method: 'GET' });
    } catch (networkErr) {
      throw new Error(`网络请求失败：${networkErr.message || networkErr}`);
    }
    if (!resp.ok) {
      throw new Error(`模型地址返回 HTTP ${resp.status}（资源不存在或无访问权限）`);
    }
    // 只读前几个字节做魔数判断，不消费整个 body（GLTFLoader 会重新发起请求）
    const buf = await resp.clone().arrayBuffer();
    if (url.toLowerCase().endsWith('.glb')) {
      const magic = new Uint32Array(buf.slice(0, 4))[0];
      // 0x46546C67 即小端序的 "glTF"
      if (magic !== 0x46546c67) {
        throw new Error('文件不是有效的 GLB（缺少 glTF 二进制魔数），可能返回了 HTML 错误页');
      }
    } else {
      const head = new TextDecoder().decode(buf.slice(0, 64)).trimStart();
      if (!head.startsWith('{')) {
        throw new Error('文件不是有效的 GLTF JSON，可能返回了 HTML 错误页');
      }
    }
  }

  /**
   * 模型网格预处理：
   * - 统一开启阴影投射/接收
   * - 归一化缩放：把任意尺寸的模型缩放到教学场景合适大小
   * - 落地：包围盒底面贴到 y=0
   */
  _prepareMeshes(root) {
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      root.scale.multiplyScalar(TARGET_MAX_DIM / maxDim);
      root.updateMatrixWorld(true);
    }
    // 缩放后重新计算包围盒并落地
    const box2 = new THREE.Box3().setFromObject(root);
    root.position.y -= box2.min.y;
    root.updateMatrixWorld(true);
  }
}
